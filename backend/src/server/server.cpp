#include "cme/server/server.hpp"
#include "cme/version.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <uWebSockets/App.h>
#include <libusockets.h>
#include <iostream>
#include <filesystem>
#include <chrono>
#include <cctype>
#include <vector>
#include <utility>

namespace cme::server {

namespace {

void write_cors_headers(auto* res) {
    res->writeHeader("Access-Control-Allow-Origin", "*");
    res->writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Remote-User, X-Remote-Email, X-Asset-Filename");
    res->writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
}

void send_json(
    auto* res,
    std::string_view status,
    const nlohmann::json& payload,
    const std::vector<std::pair<std::string, std::string>>& extra_headers = {}
) {
    res->writeStatus(status);
    write_cors_headers(res);
    res->writeHeader("Content-Type", "application/json");
    for (const auto& [name, val] : extra_headers) {
        res->writeHeader(name, val);
    }
    res->end(payload.dump(2));
}

std::string url_decode(std::string_view in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            auto hex_val = [](int c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int h = hex_val(in[i + 1]);
            int l = hex_val(in[i + 2]);
            if (h >= 0 && l >= 0) {
                out.push_back(static_cast<char>((h << 4) | l));
                i += 2;
                continue;
            }
        }
        out.push_back(in[i]);
    }
    return out;
}

} // namespace

Server::Server(config::AppConfig config)
    : config_(std::move(config)) {}

Server::~Server() {
    stop();
}

nlohmann::json Server::get_health_status() {
    auto now = std::chrono::system_clock::now();
    int64_t uptime = std::chrono::duration_cast<std::chrono::seconds>(now - start_time_).count();

    nlohmann::json health;
    health["version"] = CME_VERSION_STRING;
    health["uptime_seconds"] = uptime;
    health["active_collab_rooms"] = 0;

    bool overall_healthy = true;

    // Database health & latency check
    nlohmann::json db_status;
    if (db_pool_) {
        auto t0 = std::chrono::steady_clock::now();
        auto conn_res = db_pool_->acquire();
        if (conn_res.has_value()) {
            try {
                pqxx::work tx(conn_res->get());
                tx.exec("SELECT 1;");
                auto t1 = std::chrono::steady_clock::now();
                double latency = std::chrono::duration<double, std::milli>(t1 - t0).count();
                db_status["status"] = "connected";
                db_status["latency_ms"] = latency;
            } catch (const std::exception& e) {
                db_status["status"] = "error";
                db_status["error"] = e.what();
                overall_healthy = false;
            }
        } else {
            db_status["status"] = "unavailable";
            overall_healthy = false;
        }
    } else {
        db_status["status"] = "disconnected";
        overall_healthy = false;
    }
    health["database"] = db_status;

    // Storage health & capacity check
    nlohmann::json storage_status;
    if (storage_) {
        std::error_code ec;
        auto space = std::filesystem::space(storage_->content_root(), ec);
        if (!ec) {
            storage_status["status"] = "writable";
            storage_status["free_bytes"] = space.available;
        } else {
            storage_status["status"] = "error";
            overall_healthy = false;
        }
    } else {
        storage_status["status"] = "unconfigured";
        overall_healthy = false;
    }
    health["storage"] = storage_status;

    health["status"] = overall_healthy ? "healthy" : "degraded";

    return health;
}

Result<std::optional<auth::UserIdentity>> Server::authenticate_request(
    std::string_view auth_header,
    std::string_view cookie_header,
    std::string_view remote_user_header,
    std::string_view remote_email_header
) {
    // 1. Session token in Authorization: Bearer <token>
    if (auto token = auth::extract_bearer_token(auth_header)) {
        if (session_manager_) {
            auto val_res = session_manager_->validate_token(*token);
            if (val_res.has_value() && val_res.value().has_value()) {
                return val_res;
            }
        }
    }

    // 2. Session cookie in Cookie: cme_session=<token>
    if (auto cookie = auth::extract_cookie_token(cookie_header, "cme_session")) {
        if (session_manager_) {
            auto val_res = session_manager_->validate_token(*cookie);
            if (val_res.has_value() && val_res.value().has_value()) {
                return val_res;
            }
        }
    }

    // 3. Delegated authentication via reverse-proxy header
    if (!remote_user_header.empty()) {
        if (delegated_provider_) {
            return delegated_provider_->authenticate(
                std::string(remote_user_header),
                std::string(remote_email_header)
            );
        }
    }

    return std::nullopt;
}

Result<db::AccessLevel> Server::evaluate_access(
    const auth::UserIdentity& user,
    const std::string& document_id,
    const std::string& fs_path
) {
    if (user.is_system_admin) {
        return db::AccessLevel::Admin;
    }

    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    return db::PermissionEngine::check_permission(
        conn_res->get(),
        user.user_id,
        document_id,
        fs_path
    );
}

Result<void> Server::start() {
    start_time_ = std::chrono::system_clock::now();
    is_running_ = true;

    // 1. Initialize POSIX Storage
    try {
        storage_ = std::make_shared<storage::PosixStorageBackend>(config_.storage.root_path);
        std::cout << "[INFO] Storage backend initialized at: " << config_.storage.root_path << "\n";
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Failed to initialize storage backend: " << e.what() << "\n";
        return std::unexpected(ErrorCode::IoError);
    }

    // 2. Initialize Database Connection Pool
    try {
        db_pool_ = db::ConnectionPool::create(
            config_.database.url,
            config_.database.pool_size
        );
        std::cout << "[INFO] PostgreSQL connection pool initialized ("
                  << config_.database.pool_size << " connections).\n";
    } catch (const std::exception& e) {
        std::cerr << "[WARN] Could not connect to database on startup: " << e.what()
                  << " (server will start in degraded mode)\n";
    }

    // 3. Initialize AuthN & AuthZ Subsystems
    admin_provider_ = auth::create_admin_provider(config_.authz);
    session_manager_ = std::make_shared<auth::SessionManager>(db_pool_, admin_provider_);
    delegated_provider_ = std::make_shared<auth::DelegatedAuthProvider>(
        db_pool_,
        admin_provider_,
        config_.authn.delegated_header,
        config_.authn.delegated_email_header
    );
    challenge_provider_ = std::make_shared<auth::ChallengeAuthProvider>(db_pool_, admin_provider_);

    // 4. Initialize Document Management Service
    document_service_ = std::make_shared<document::DocumentService>(db_pool_, storage_);

    // 5. Configure uWebSockets App
    uWS::App app;
    uws_loop_ = uWS::Loop::get();

    // CORS Preflight handler
    app.options("/*", [](auto *res, auto *req) {
        (void)req;
        res->writeStatus("204 No Content");
        write_cors_headers(res);
        res->end();
    });

    // GET /api/v1/health
    app.get("/api/v1/health", [this](auto *res, auto *req) {
        (void)req;
        nlohmann::json health = get_health_status();
        std::string_view status = (health["status"] == "healthy") ? "200 OK" : "503 Service Unavailable";
        send_json(res, status, health);
    });

    // POST /api/v1/auth/login
    app.post("/api/v1/auth/login", [this](auto *res, auto *req) {
        std::string ip = std::string(res->getRemoteAddressAsText());
        std::string user_agent = std::string(req->getHeader("user-agent"));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);

        res->onAborted([aborted]() {
            *aborted = true;
        });

        res->onData([this, res, body, aborted, ip, user_agent](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) {
                return;
            }

            std::string username;
            std::string password;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("username") && json["username"].is_string()) {
                    username = json["username"].get<std::string>();
                }
                if (json.contains("password") && json["password"].is_string()) {
                    password = json["password"].get<std::string>();
                }
            } catch (...) {}

            if (username.empty() || password.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Username and password required"}});
                return;
            }

            auto auth_res = challenge_provider_->authenticate_credentials(username, password);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Invalid credentials"}});
                return;
            }

            auto user = *auth_res.value();
            auto sess_res = session_manager_->create_session(
                user.user_id,
                config_.authn.session_ttl_hours,
                ip,
                user_agent
            );

            if (!sess_res.has_value()) {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to create session"}});
                return;
            }

            auto session = sess_res.value();
            int max_age_seconds = config_.authn.session_ttl_hours * 3600;
            std::string cookie_val = "cme_session=" + session.raw_token +
                "; Path=/; Max-Age=" + std::to_string(max_age_seconds) +
                "; HttpOnly; SameSite=Lax";

            nlohmann::json resp;
            resp["token"] = session.raw_token;
            resp["expires_at"] = session.expires_at;
            resp["user"] = user.to_json();

            send_json(res, "200 OK", resp, {{"Set-Cookie", cookie_val}});
        });
    });

    // POST /api/v1/auth/logout
    app.post("/api/v1/auth/logout", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));

        auto token = auth::extract_bearer_token(auth_hdr);
        if (!token) {
            token = auth::extract_cookie_token(cookie_hdr, "cme_session");
        }

        if (token && session_manager_) {
            session_manager_->revoke_session(*token);
        }

        send_json(res, "200 OK", {{"status", "logged_out"}}, {
            {"Set-Cookie", "cme_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax"}
        });
    });

    // GET /api/v1/auth/me
    app.get("/api/v1/auth/me", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));

        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {
                {"error", "Unauthorized"},
                {"message", "Authentication required"}
            });
            return;
        }

        auto user = *auth_res.value();
        std::vector<std::string> effective_teams;
        if (db_pool_) {
            auto conn_res = db_pool_->acquire();
            if (conn_res.has_value()) {
                auto teams_res = db::PermissionEngine::get_effective_teams(conn_res->get(), user.user_id);
                if (teams_res.has_value()) {
                    effective_teams = teams_res.value();
                }
            }
        }

        nlohmann::json resp;
        resp["user"] = user.to_json();
        resp["effective_teams"] = effective_teams;

        send_json(res, "200 OK", resp);
    });

    // POST /api/v1/auth/tokens
    app.post("/api/v1/auth/tokens", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));

        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        std::string ip = std::string(res->getRemoteAddressAsText());
        std::string user_agent = std::string(req->getHeader("user-agent"));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);

        res->onAborted([aborted]() {
            *aborted = true;
        });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, ip, user_agent](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) {
                return;
            }

            std::optional<auth::UserIdentity> user;
            int ttl_hours = config_.authn.session_ttl_hours;

            // 1. Try body credentials
            if (!body->empty()) {
                try {
                    auto json = nlohmann::json::parse(*body);
                    if (json.contains("ttl_hours") && json["ttl_hours"].is_number_integer()) {
                        ttl_hours = json["ttl_hours"].get<int>();
                    }
                    if (json.contains("username") && json["username"].is_string() &&
                        json.contains("password") && json["password"].is_string()) {
                        std::string u = json["username"].get<std::string>();
                        std::string p = json["password"].get<std::string>();
                        auto c_res = challenge_provider_->authenticate_credentials(u, p);
                        if (c_res.has_value() && c_res.value().has_value()) {
                            user = *c_res.value();
                        }
                    }
                } catch (...) {}
            }

            // 2. If no credentials in body, try headers / existing session
            if (!user.has_value()) {
                auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
                if (auth_res.has_value() && auth_res.value().has_value()) {
                    user = *auth_res.value();
                }
            }

            if (!user.has_value()) {
                send_json(res, "401 Unauthorized", {
                    {"error", "Unauthorized"},
                    {"message", "Valid credentials or session required to issue personal access token"}
                });
                return;
            }

            auto sess_res = session_manager_->create_session(
                user->user_id,
                ttl_hours,
                ip,
                user_agent
            );

            if (!sess_res.has_value()) {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to issue token"}});
                return;
            }

            auto session = sess_res.value();
            nlohmann::json resp;
            resp["token"] = session.raw_token;
            resp["expires_at"] = session.expires_at;
            resp["user"] = user->to_json();

            send_json(res, "201 Created", resp);
        });
    });

    // GET /api/v1/auth/tokens
    app.get("/api/v1/auth/tokens", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));

        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto user = *auth_res.value();
        auto list_res = session_manager_->list_user_sessions(user.user_id);
        if (!list_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to retrieve tokens"}});
            return;
        }

        nlohmann::json tokens_json = nlohmann::json::array();
        for (const auto& item : list_res.value()) {
            tokens_json.push_back(item.to_json());
        }

        send_json(res, "200 OK", {{"tokens", tokens_json}});
    });

    // =========================================================================
    // Workspace & Document CRUD REST Endpoints (Step 2.3)
    // =========================================================================

    // GET /api/v1/workspaces/tree
    app.get("/api/v1/workspaces/tree", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto tree_res = document_service_->get_workspace_tree(*auth_res.value());
        if (!tree_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to load workspace tree"}});
            return;
        }

        send_json(res, "200 OK", {{"tree", tree_res.value()}});
    });

    // GET /api/v1/documents/by-path
    app.get("/api/v1/documents/by-path", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        if (path_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Query parameter 'path' is required"}});
            return;
        }

        auto doc_res = document_service_->get_document_by_path(path_param, *auth_res.value());
        if (!doc_res.has_value()) {
            if (doc_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (doc_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to retrieve document"}});
            }
            return;
        }

        send_json(res, "200 OK", doc_res.value().to_json(true));
    });

    // POST /api/v1/documents
    app.post("/api/v1/documents", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            document::CreateDocumentRequest create_req;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("path") && json["path"].is_string()) {
                    create_req.path = json["path"].get<std::string>();
                }
                if (json.contains("content") && json["content"].is_string()) {
                    create_req.content = json["content"].get<std::string>();
                }
                if (json.contains("title") && json["title"].is_string()) {
                    create_req.title = json["title"].get<std::string>();
                }
                if (json.contains("is_bundle") && json["is_bundle"].is_boolean()) {
                    create_req.is_bundle = json["is_bundle"].get<bool>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (create_req.path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Field 'path' is required"}});
                return;
            }

            auto doc_res = document_service_->create_document(create_req, *auth_res.value());
            if (!doc_res.has_value()) {
                if (doc_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Document already exists at path"}});
                } else if (doc_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (doc_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to create document"}});
                }
                return;
            }

            send_json(res, "201 Created", doc_res.value().to_json(true));
        });
    });

    // GET /api/v1/documents/:id/raw
    app.get("/api/v1/documents/:id/raw", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto raw_res = document_service_->get_document_raw(doc_id, *auth_res.value());
        if (!raw_res.has_value()) {
            if (raw_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (raw_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to read document"}});
            }
            return;
        }

        res->writeStatus("200 OK");
        write_cors_headers(res);
        res->writeHeader("Content-Type", "text/markdown; charset=utf-8");
        res->end(raw_res.value());
    });

    // PATCH /api/v1/documents/:id/move
    app.patch("/api/v1/documents/:id/move", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string new_path;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("new_path") && json["new_path"].is_string()) {
                    new_path = json["new_path"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (new_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Field 'new_path' is required"}});
                return;
            }

            auto doc_res = document_service_->move_document(doc_id, new_path, *auth_res.value());
            if (!doc_res.has_value()) {
                if (doc_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else if (doc_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (doc_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Target path already exists"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to move document"}});
                }
                return;
            }

            send_json(res, "200 OK", doc_res.value().to_json(false));
        });
    });

    // POST /api/v1/documents/:id/assets
    app.post("/api/v1/documents/:id/assets", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string fn_query = url_decode(req->getQuery("filename"));
        std::string fn_header = std::string(req->getHeader("x-asset-filename"));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, fn_query, fn_header, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string filename = !fn_query.empty() ? fn_query : fn_header;
            std::string_view data = *body;

            // Optional JSON format {"filename": "...", "content": "..."}
            if (filename.empty() && !body->empty() && body->front() == '{') {
                try {
                    auto json = nlohmann::json::parse(*body);
                    if (json.contains("filename") && json["filename"].is_string()) {
                        filename = json["filename"].get<std::string>();
                    }
                    if (json.contains("content") && json["content"].is_string()) {
                        *body = json["content"].get<std::string>();
                        data = *body;
                    }
                } catch (...) {}
            }

            if (filename.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Asset filename required via ?filename= query, X-Asset-Filename header, or JSON body"}});
                return;
            }

            auto upload_res = document_service_->upload_asset(doc_id, filename, data, *auth_res.value());
            if (!upload_res.has_value()) {
                if (upload_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else if (upload_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to upload asset"}});
                }
                return;
            }

            send_json(res, "201 Created", {
                {"filename", filename},
                {"path", upload_res.value()}
            });
        });
    });

    // GET /api/v1/documents/:id/assets/:filename
    app.get("/api/v1/documents/:id/assets/:filename", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string filename = std::string(req->getParameter(1));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto asset_res = document_service_->read_asset(doc_id, filename, *auth_res.value());
        if (!asset_res.has_value()) {
            if (asset_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Asset not found"}});
            } else if (asset_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to read asset"}});
            }
            return;
        }

        std::string content_type = "application/octet-stream";
        if (filename.ends_with(".png")) content_type = "image/png";
        else if (filename.ends_with(".jpg") || filename.ends_with(".jpeg")) content_type = "image/jpeg";
        else if (filename.ends_with(".svg")) content_type = "image/svg+xml";
        else if (filename.ends_with(".webp")) content_type = "image/webp";

        res->writeStatus("200 OK");
        write_cors_headers(res);
        res->writeHeader("Content-Type", content_type);
        res->end(asset_res.value());
    });

    // GET /api/v1/documents/:id
    app.get("/api/v1/documents/:id", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto doc_res = document_service_->get_document_by_id(doc_id, *auth_res.value());
        if (!doc_res.has_value()) {
            if (doc_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (doc_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to read document"}});
            }
            return;
        }

        send_json(res, "200 OK", doc_res.value().to_json(true));
    });

    // PUT /api/v1/documents/:id
    app.put("/api/v1/documents/:id", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string content;
            std::optional<std::string> title;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("content") && json["content"].is_string()) {
                    content = json["content"].get<std::string>();
                }
                if (json.contains("title") && json["title"].is_string()) {
                    title = json["title"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            auto doc_res = document_service_->update_document(doc_id, content, title, *auth_res.value());
            if (!doc_res.has_value()) {
                if (doc_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else if (doc_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to update document"}});
                }
                return;
            }

            send_json(res, "200 OK", doc_res.value().to_json(true));
        });
    });

    // DELETE /api/v1/documents/:id
    app.del("/api/v1/documents/:id", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto del_res = document_service_->delete_document(doc_id, *auth_res.value());
        if (!del_res.has_value()) {
            if (del_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (del_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to delete document"}});
            }
            return;
        }

        send_json(res, "200 OK", {{"status", "deleted"}, {"trash_id", del_res.value()}});
    });

    // Bind listener
    app.listen(config_.server.bind, config_.server.port, [this](auto *token) {
        if (token) {
            us_listen_socket_ = token;
            std::cout << "[INFO] CME Server listening on http://"
                      << config_.server.bind << ":" << config_.server.port << "\n";
        } else {
            std::cerr << "[FATAL] Failed to listen on "
                      << config_.server.bind << ":" << config_.server.port << "\n";
            is_running_ = false;
        }
    });

    if (!is_running_) {
        return std::unexpected(ErrorCode::IoError);
    }

    // Run epoll event loop (blocks until loop is stopped)
    app.run();

    return {};
}

void Server::stop() {
    if (is_running_.exchange(false)) {
        if (uws_loop_) {
            auto *loop = static_cast<uWS::Loop*>(uws_loop_);
            loop->defer([this]() {
                if (us_listen_socket_) {
                    us_listen_socket_close(0, static_cast<struct us_listen_socket_t*>(us_listen_socket_));
                    us_listen_socket_ = nullptr;
                }
            });
        }
    }
}

} // namespace cme::server
