#include "cme/server/server.hpp"
#include "cme/version.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/renderer/markdown_renderer.hpp"
#include "cme/collab/collab_socket_data.hpp"
#include "cme/collab/document_room.hpp"
#include <uWebSockets/App.h>
#include <libusockets.h>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <chrono>
#include <cctype>
#include <vector>
#include <span>
#include <utility>

namespace cme::server {

namespace {

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

std::string_view get_mime_type(const std::filesystem::path& path) {
    auto ext = path.extension().string();
    if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
    if (ext == ".js" || ext == ".mjs") return "application/javascript; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".json") return "application/json";
    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif") return "image/gif";
    if (ext == ".webp") return "image/webp";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".ico") return "image/x-icon";
    if (ext == ".woff") return "font/woff";
    if (ext == ".woff2") return "font/woff2";
    if (ext == ".ttf") return "font/ttf";
    if (ext == ".otf") return "font/otf";
    if (ext == ".eot") return "application/vnd.ms-fontobject";
    if (ext == ".wasm") return "application/wasm";
    if (ext == ".map") return "application/json";
    if (ext == ".txt") return "text/plain; charset=utf-8";
    return "application/octet-stream";
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
    health["active_collab_rooms"] = room_manager_ ? room_manager_->active_room_count() : 0;

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

    if (lease_manager_) {
        health["instance_lease"] = {
            {"held", lease_manager_->is_held()},
            {"holder_id", lease_manager_->holder_id()},
            {"lease_name", lease_manager_->lease_name()}
        };
    }

    // Storage health & capacity check
    nlohmann::json storage_status;
    if (storage_) {
        auto health_res = storage_->check_health();
        if (health_res.has_value()) {
            storage_status["status"] = health_res->status;
            storage_status["backend"] = health_res->backend_type;
            if (health_res->free_bytes.has_value()) {
                storage_status["free_bytes"] = *health_res->free_bytes;
            }
            if (health_res->total_bytes.has_value()) {
                storage_status["total_bytes"] = *health_res->total_bytes;
            }
            if (!health_res->message.empty()) {
                storage_status["message"] = health_res->message;
            }
            if (health_res->status == "error") {
                overall_healthy = false;
            }
        } else {
            storage_status["status"] = "error";
            storage_status["error"] = to_string(health_res.error());
            overall_healthy = false;
        }
    } else {
        storage_status["status"] = "unconfigured";
        overall_healthy = false;
    }
    health["storage"] = storage_status;

    // Persistence subsystem metrics (Step 3.3)
    nlohmann::json persistence_status;
    if (persistence_worker_) {
        persistence_status["status"] = persistence_worker_->is_running() ? "running" : "stopped";
        persistence_status["total_flushes"] = persistence_worker_->total_flushes();
        persistence_status["total_snapshots"] = persistence_worker_->total_snapshots();
        persistence_status["total_evictions"] = persistence_worker_->total_evictions();
        auto failed_rooms = persistence_worker_->failed_flush_rooms();
        persistence_status["dirty_rooms_failed_flush"] = failed_rooms;
        if (!failed_rooms.empty()) {
            overall_healthy = false;
        }
    } else {
        persistence_status["status"] = "unconfigured";
    }
    health["persistence"] = persistence_status;
    health["backup_barrier_active"] = is_backup_barrier_active();

    health["status"] = overall_healthy ? "healthy" : "degraded";

    return health;
}

size_t Server::prepare_backup() {
    backup_barrier_active_.store(true);
    size_t flushed = 0;
    if (persistence_worker_) {
        flushed = persistence_worker_->flush_all_dirty();
    }
    std::cout << "[INFO] Backup coordination barrier activated. Flushed " << flushed << " dirty rooms to disk.\n";
    return flushed;
}

void Server::release_backup() {
    backup_barrier_active_.store(false);

    std::vector<QueuedBarrierUpdate> pending;
    {
        std::lock_guard lock(barrier_queue_mutex_);
        pending = std::move(barrier_update_queue_);
        barrier_update_queue_.clear();
    }

    if (!pending.empty()) {
        std::cout << "[INFO] Draining " << pending.size() << " queued collaborative updates after barrier release.\n";
        for (const auto& item : pending) {
            if (!room_manager_) continue;
            auto room = room_manager_->get_room(item.document_id);
            if (!room) continue;

            std::span<const uint8_t> update_data(
                reinterpret_cast<const uint8_t*>(item.update_data.data()),
                item.update_data.size()
            );
            auto apply_res = room->apply_client_update(update_data);
            if (apply_res.has_value()) {
                std::string broadcast_msg;
                broadcast_msg.reserve(2 + item.update_data.size());
                broadcast_msg.push_back('\x00');
                broadcast_msg.push_back('\x03'); // SyncUpdate
                broadcast_msg.append(item.update_data);
                broadcast_to_room(item.document_id, broadcast_msg, true);
            }
        }
    }

    std::cout << "[INFO] Backup coordination barrier released. Normal write mutations resumed.\n";
}

Result<std::optional<auth::UserIdentity>> Server::authenticate_request(
    std::string_view auth_header,
    std::string_view cookie_header,
    std::string_view remote_user_header,
    std::string_view remote_email_header,
    std::function<std::string(std::string_view)> header_lookup
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
                std::string(remote_email_header),
                std::move(header_lookup)
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

    // 1. Initialize Storage Backend (pluggable from config)
    auto storage_res = storage::create_storage_backend(config_.storage);
    if (!storage_res.has_value()) {
        std::cerr << "[ERROR] Failed to initialize storage backend ('" << config_.storage.backend
                  << "'): " << to_string(storage_res.error()) << "\n";
        return std::unexpected(storage_res.error());
    }
    storage_ = *storage_res;
    std::cout << "[INFO] Storage backend ('" << config_.storage.backend << "') initialized.\n";
    if (!config_.storage.mounts.empty()) {
        std::cout << "[INFO] Configured " << config_.storage.mounts.size() << " storage mount(s):\n";
        for (const auto& m : config_.storage.mounts) {
            std::cout << "  - Prefix: '" << m.prefix << "' -> Host Path: " << m.path << "\n";
        }
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

    // 2.1 Enforce Single-Instance Lease (Issue #8 & Standby Wait)
    if (config_.database.lease_enabled && db_pool_) {
        lease_manager_ = std::make_shared<db::InstanceLeaseManager>(
            db_pool_,
            config_.database.lease_name,
            config_.database.lease_ttl_seconds,
            config_.database.lease_renew_interval_seconds
        );

        Result<bool> lease_res;
        if (config_.database.lease_wait) {
            lease_res = lease_manager_->acquire_or_wait(
                config_.database.lease_retry_interval_seconds,
                config_.database.lease_acquire_timeout_seconds,
                [this]() { return !is_running_.load(); }
            );
        } else {
            lease_res = lease_manager_->acquire();
        }

        if (!lease_res.has_value() || !lease_res.value()) {
            if (!is_running_) {
                std::cout << "[INFO] Server startup cancelled before lease was acquired.\n";
                return {};
            }
            std::cerr << "[FATAL] Failed to acquire instance lease: another CME instance is currently running.\n";
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        lease_manager_->start_heartbeat([this]() {
            std::cerr << "[FATAL] Lost instance lease! Shutting down server to prevent split-brain.\n";
            this->stop();
        });
    }

    // 3. Initialize AuthN & AuthZ Subsystems
    admin_provider_ = auth::create_admin_provider(config_.authz);
    session_manager_ = std::make_shared<auth::SessionManager>(db_pool_, admin_provider_);
    delegated_provider_ = std::make_shared<auth::DelegatedAuthProvider>(
        db_pool_,
        admin_provider_,
        config_.authn.delegated_header,
        config_.authn.delegated_email_header,
        config_.authn.get_effective_required_headers()
    );
    challenge_provider_ = std::make_shared<auth::ChallengeAuthProvider>(db_pool_, admin_provider_);

    // 4. Initialize Document Management Service
    document_service_ = std::make_shared<document::DocumentService>(db_pool_, storage_);

    // 5. Initialize Admin Management Services (Step 2.5)
    user_service_ = std::make_shared<admin::UserService>(db_pool_);
    team_service_ = std::make_shared<admin::TeamService>(db_pool_);

    // 6. Initialize Collaborative Room Coordinator (Step 3.1)
    room_manager_ = std::make_shared<collab::RoomManager>();

    // 7. Initialize Persistence Worker (Step 3.3)
    persistence_worker_ = std::make_shared<collab::PersistenceWorker>(
        room_manager_,
        storage_,
        db_pool_,
        persistence_config_
    );
    persistence_worker_->set_paused_predicate([this]() {
        return is_backup_barrier_active();
    });
    persistence_worker_->start();

    // 8. Initialize Review Engine Service (Step 3.4)
    review_service_ = std::make_shared<review::ReviewService>(db_pool_, document_service_);

    // 8.5 Initialize Snippet Fetcher
    snippet_fetcher_ = std::make_shared<snippet::SnippetFetcher>(config_.snippets);

    // 9. Configure uWebSockets App
    uWS::App app;
    uws_loop_ = uWS::Loop::get();
    uws_app_ = &app;

    // CORS Preflight handler
    app.options("/*", [this](auto *res, auto *req) {
        std::string origin = std::string(req->getHeader("origin"));
        res->writeStatus("204 No Content");
        write_cors_headers(res, origin);
        res->end();
    });

    auto check_barrier = [this](auto* res) -> bool {
        if (is_backup_barrier_active()) {
            send_json(res, "503 Service Unavailable", {
                {"error", "Backup in progress"},
                {"retry_after", 2}
            }, {{"Retry-After", "2"}});
            return true;
        }
        return false;
    };

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

            std::vector<std::string> effective_team_names;
            std::vector<std::string> effective_team_ids;
            if (db_pool_) {
                auto conn_res = db_pool_->acquire();
                if (conn_res.has_value()) {
                    auto names_res = db::PermissionEngine::get_effective_team_names(conn_res->get(), user.user_id);
                    if (names_res.has_value()) {
                        effective_team_names = names_res.value();
                    }
                    auto ids_res = db::PermissionEngine::get_effective_teams(conn_res->get(), user.user_id);
                    if (ids_res.has_value()) {
                        effective_team_ids = ids_res.value();
                    }
                }
            }

            nlohmann::json resp;
            resp["token"] = session.raw_token;
            resp["expires_at"] = session.expires_at;
            resp["user"] = user.to_json();
            resp["effective_teams"] = effective_team_names;
            resp["effective_team_ids"] = effective_team_ids;
            resp["user"]["effective_teams"] = effective_team_names;
            resp["user"]["effective_team_ids"] = effective_team_ids;

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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {
                {"error", "Unauthorized"},
                {"message", "Authentication required"}
            });
            return;
        }

        auto user = *auth_res.value();
        std::vector<std::string> effective_team_names;
        std::vector<std::string> effective_team_ids;
        if (db_pool_) {
            auto conn_res = db_pool_->acquire();
            if (conn_res.has_value()) {
                auto names_res = db::PermissionEngine::get_effective_team_names(conn_res->get(), user.user_id);
                if (names_res.has_value()) {
                    effective_team_names = names_res.value();
                }
                auto ids_res = db::PermissionEngine::get_effective_teams(conn_res->get(), user.user_id);
                if (ids_res.has_value()) {
                    effective_team_ids = ids_res.value();
                }
            }
        }

        nlohmann::json resp = user.to_json();
        resp["user"] = user.to_json();
        resp["effective_teams"] = effective_team_names;
        resp["effective_team_ids"] = effective_team_ids;
        resp["authn_provider"] = config_.authn.provider;
        resp["can_change_password"] = (config_.authn.provider == "challenge");
        resp["user"]["authn_provider"] = config_.authn.provider;
        resp["user"]["can_change_password"] = (config_.authn.provider == "challenge");
        resp["user"]["effective_teams"] = effective_team_names;
        resp["user"]["effective_team_ids"] = effective_team_ids;

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
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);

        res->onAborted([aborted]() {
            *aborted = true;
        });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, ip, user_agent, header_lookup](std::string_view chunk, bool is_last) {
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
                auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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

    // POST /api/v1/workspaces/directories
    app.post("/api/v1/workspaces/directories", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string dir_path;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("path") && json["path"].is_string()) {
                    dir_path = json["path"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (dir_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Field 'path' is required"}});
                return;
            }

            auto dir_res = document_service_->create_directory(dir_path, *auth_res.value());
            if (!dir_res.has_value()) {
                if (dir_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (dir_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to create directory"}});
                }
                return;
            }

            send_json(res, "201 Created", nlohmann::json{{"path", dir_res.value()}, {"is_directory", true}});
        });
    });

    // PATCH /api/v1/workspaces/directories (and POST /move, /rename)
    auto handle_rename_dir = [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string old_path;
            std::string new_path;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("old_path") && json["old_path"].is_string()) {
                    old_path = json["old_path"].get<std::string>();
                } else if (json.contains("path") && json["path"].is_string()) {
                    old_path = json["path"].get<std::string>();
                }
                if (json.contains("new_path") && json["new_path"].is_string()) {
                    new_path = json["new_path"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (old_path.empty() || new_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Fields 'old_path' (or 'path') and 'new_path' are required"}});
                return;
            }

            auto rename_res = document_service_->rename_directory(old_path, new_path, *auth_res.value());
            if (!rename_res.has_value()) {
                if (rename_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (rename_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Directory not found"}});
                } else if (rename_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Destination path already exists"}});
                } else if (rename_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to rename directory"}});
                }
                return;
            }

            send_json(res, "200 OK", {
                {"status", "success"},
                {"old_path", old_path},
                {"new_path", rename_res.value()}
            });
        });
    };

    app.patch("/api/v1/workspaces/directories", handle_rename_dir);
    app.post("/api/v1/workspaces/directories/move", handle_rename_dir);
    app.post("/api/v1/workspaces/directories/rename", handle_rename_dir);

    // DELETE /api/v1/workspaces/directories (and POST /delete)
    auto handle_delete_dir = [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        std::string query_path = url_decode(req->getQuery("path"));
        if (query_path.empty()) {
            query_path = url_decode(req->getQuery("directory_path"));
        }

        if (!query_path.empty()) {
            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            auto del_res = document_service_->delete_directory(query_path, *auth_res.value());
            if (!del_res.has_value()) {
                if (del_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (del_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Directory not found"}});
                } else if (del_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to delete directory"}});
                }
                return;
            }

            send_json(res, "200 OK", {
                {"status", "success"},
                {"path", query_path},
                {"trash_id", del_res.value()}
            });
            return;
        }

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string dir_path;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("path") && json["path"].is_string()) {
                    dir_path = json["path"].get<std::string>();
                } else if (json.contains("directory_path") && json["directory_path"].is_string()) {
                    dir_path = json["directory_path"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (dir_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Field 'path' is required"}});
                return;
            }

            auto del_res = document_service_->delete_directory(dir_path, *auth_res.value());
            if (!del_res.has_value()) {
                if (del_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (del_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Directory not found"}});
                } else if (del_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to delete directory"}});
                }
                return;
            }

            send_json(res, "200 OK", {
                {"status", "success"},
                {"path", dir_path},
                {"trash_id", del_res.value()}
            });
        });
    };

    app.del("/api/v1/workspaces/directories", handle_delete_dir);
    app.post("/api/v1/workspaces/directories/delete", handle_delete_dir);

    // POST /api/v1/workspaces/files?path=<relative_path>
    app.post("/api/v1/workspaces/files", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        std::string path_query = url_decode(req->getQuery("path"));
        std::string path_header = std::string(req->getHeader("x-file-path"));
        std::string target_path = !path_query.empty() ? path_query : path_header;
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, target_path, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            if (target_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "File path is required via ?path= query or X-File-Path header"}});
                return;
            }

            auto upload_res = document_service_->upload_workspace_file(target_path, *body, *auth_res.value());
            if (!upload_res.has_value()) {
                if (upload_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (upload_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid path specification"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to upload workspace file"}});
                }
                return;
            }

            send_json(res, "201 Created", upload_res.value().to_json(false));
        });
    });

    // GET /api/v1/workspaces/files?path=<relative_path>
    app.get("/api/v1/workspaces/files", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string token_query = url_decode(req->getQuery("token"));
        if (auth_hdr.empty() && !token_query.empty()) {
            auth_hdr = "Bearer " + token_query;
        }
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        if (path_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Query parameter 'path' is required"}});
            return;
        }

        auto file_res = document_service_->read_workspace_file(path_param, *auth_res.value());
        if (!file_res.has_value()) {
            if (file_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "File not found"}});
            } else if (file_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to read file"}});
            }
            return;
        }

        std::string lower_p = path_param;
        for (auto& c : lower_p) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        std::string content_type = "application/octet-stream";
        if (lower_p.ends_with(".png")) content_type = "image/png";
        else if (lower_p.ends_with(".jpg") || lower_p.ends_with(".jpeg")) content_type = "image/jpeg";
        else if (lower_p.ends_with(".gif")) content_type = "image/gif";
        else if (lower_p.ends_with(".svg")) content_type = "image/svg+xml";
        else if (lower_p.ends_with(".webp")) content_type = "image/webp";
        else if (lower_p.ends_with(".ico")) content_type = "image/x-icon";
        else if (lower_p.ends_with(".bmp")) content_type = "image/bmp";
        else if (lower_p.ends_with(".pdf")) content_type = "application/pdf";
        else if (lower_p.ends_with(".txt") || lower_p.ends_with(".log") || lower_p.ends_with(".md")) content_type = "text/plain; charset=utf-8";
        else if (lower_p.ends_with(".csv")) content_type = "text/csv; charset=utf-8";
        else if (lower_p.ends_with(".json")) content_type = "application/json; charset=utf-8";
        else if (lower_p.ends_with(".html") || lower_p.ends_with(".htm")) content_type = "text/html; charset=utf-8";
        else if (lower_p.ends_with(".xml")) content_type = "application/xml; charset=utf-8";
        else if (lower_p.ends_with(".mp4")) content_type = "video/mp4";
        else if (lower_p.ends_with(".webm")) content_type = "video/webm";
        else if (lower_p.ends_with(".mp3")) content_type = "audio/mpeg";
        else if (lower_p.ends_with(".wav")) content_type = "audio/wav";

        res->writeStatus("200 OK");
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", content_type);
        res->writeHeader("Content-Disposition", "inline");
        res->end(file_res.value());
    });

    // GET /api/v1/workspaces/bundles/zip?path=<relative_path>
    app.get("/api/v1/workspaces/bundles/zip", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string token_query = url_decode(req->getQuery("token"));
        if (auth_hdr.empty() && !token_query.empty()) {
            auth_hdr = "Bearer " + token_query;
        }
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        if (path_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Query parameter 'path' is required"}});
            return;
        }

        auto zip_res = document_service_->export_bundle_zip(path_param, *auth_res.value());
        if (!zip_res.has_value()) {
            if (zip_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Bundle or file not found"}});
            } else if (zip_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to export bundle zip"}});
            }
            return;
        }

        std::filesystem::path fp(path_param);
        std::string fn = fp.filename().string();
        if (fn.empty()) fn = "bundle";
        if (!fn.ends_with(".zip")) fn += ".zip";

        res->writeStatus("200 OK");
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", "application/zip");
        res->writeHeader("Content-Disposition", "attachment; filename=\"" + fn + "\"");
        res->end(zip_res.value());
    });

    // GET /api/v1/documents/:id/bundle.zip
    app.get("/api/v1/documents/:id/bundle.zip", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string token_query = url_decode(req->getQuery("token"));
        if (auth_hdr.empty() && !token_query.empty()) {
            auth_hdr = "Bearer " + token_query;
        }
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto zip_res = document_service_->export_document_bundle_zip(doc_id, *auth_res.value());
        if (!zip_res.has_value()) {
            if (zip_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (zip_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to export bundle zip"}});
            }
            return;
        }

        res->writeStatus("200 OK");
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", "application/zip");
        res->writeHeader("Content-Disposition", "attachment; filename=\"bundle.zip\"");
        res->end(zip_res.value());
    });

    // GET /api/v1/workspaces/snippet-proxy?url=<encoded_url_or_endpoint>
    app.get("/api/v1/workspaces/snippet-proxy", [this](auto *res, auto *req) {
        std::string url_param = url_decode(req->getQuery("url"));
        if (url_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Missing url parameter"}}, {}, req->getHeader("origin"));
            return;
        }

        if (!snippet_fetcher_) {
            send_json(res, "500 Internal Server Error", {{"error", "Snippet fetcher not initialized"}}, {}, req->getHeader("origin"));
            return;
        }

        auto fetch_res = snippet_fetcher_->fetch(url_param);
        if (!fetch_res.success) {
            std::string status_str = "502 Bad Gateway";
            if (fetch_res.http_status == 400) status_str = "400 Bad Request";
            else if (fetch_res.http_status == 403) status_str = "403 Forbidden";
            else if (fetch_res.http_status == 404) status_str = "404 Not Found";

            send_json(res, status_str, {{"error", fetch_res.error_message}}, {}, req->getHeader("origin"));
            return;
        }

        res->writeStatus("200 OK");
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", "text/plain; charset=utf-8");
        res->writeHeader("Cache-Control", "public, max-age=60");
        res->end(fetch_res.content);
    });

    // GET /api/v1/workspaces/snippet-endpoints
    app.get("/api/v1/workspaces/snippet-endpoints", [this](auto *res, auto *req) {
        if (!snippet_fetcher_) {
            send_json(res, "200 OK", {
                {"endpoints", nlohmann::json::array()},
                {"allowed_hosts", nlohmann::json::array()}
            }, {}, req->getHeader("origin"));
            return;
        }

        send_json(res, "200 OK", {
            {"endpoints", snippet_fetcher_->list_endpoint_names()},
            {"allowed_hosts", snippet_fetcher_->list_allowed_hosts()}
        }, {}, req->getHeader("origin"));
    });

    // GET /api/v1/workspaces/directory-details?path=<relative_path>
    app.get("/api/v1/workspaces/directory-details", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        auto dash_res = document_service_->get_directory_dashboard(path_param, *auth_res.value());
        if (!dash_res.has_value()) {
            if (dash_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Directory not found"}});
            } else if (dash_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to get directory details"}});
            }
            return;
        }

        send_json(res, "200 OK", dash_res.value());
    });

    // GET /api/v1/workspaces/permissions?target_type=...&target_id=...&directory_path=...
    app.get("/api/v1/workspaces/permissions", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string target_type = url_decode(req->getQuery("target_type"));
        std::string target_id = url_decode(req->getQuery("target_id"));
        std::string directory_path = url_decode(req->getQuery("directory_path"));
        if (target_type.empty()) {
            target_type = !target_id.empty() ? "DOCUMENT" : "DIRECTORY";
        }
        for (auto& c : target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

        auto perm_res = document_service_->get_node_permissions(target_type, target_id, directory_path, *auth_res.value());
        if (!perm_res.has_value()) {
            if (perm_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Node not found"}});
            } else if (perm_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to retrieve permissions"}});
            }
            return;
        }

        send_json(res, "200 OK", perm_res.value());
    });

    // POST /api/v1/workspaces/permissions
    app.post("/api/v1/workspaces/permissions", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string target_type;
            std::string target_id;
            std::string dir_path;
            std::string grantee_type;
            std::string grantee_id;
            std::string access_level;
            bool is_inheritable = true;

            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("target_type") && json["target_type"].is_string()) target_type = json["target_type"].get<std::string>();
                if (json.contains("target_id") && json["target_id"].is_string()) target_id = json["target_id"].get<std::string>();
                if (json.contains("directory_path") && json["directory_path"].is_string()) dir_path = json["directory_path"].get<std::string>();
                if (json.contains("grantee_type") && json["grantee_type"].is_string()) grantee_type = json["grantee_type"].get<std::string>();
                if (json.contains("grantee_id") && json["grantee_id"].is_string()) grantee_id = json["grantee_id"].get<std::string>();
                if (json.contains("access_level") && json["access_level"].is_string()) access_level = json["access_level"].get<std::string>();
                if (json.contains("is_inheritable") && json["is_inheritable"].is_boolean()) is_inheritable = json["is_inheritable"].get<bool>();
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (target_type.empty()) {
                target_type = !target_id.empty() ? "DOCUMENT" : "DIRECTORY";
            }
            for (auto& c : target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

            auto set_res = document_service_->set_node_permission(
                target_type, target_id, dir_path, grantee_type, grantee_id, access_level, is_inheritable, *auth_res.value()
            );
            if (!set_res.has_value()) {
                if (set_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (set_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid permission parameters"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to set permission"}});
                }
                return;
            }

            send_json(res, "200 OK", set_res.value());
        });
    });

    // POST /api/v1/workspaces/permissions/test
    app.post("/api/v1/workspaces/permissions/test", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string target_type;
            std::string target_id;
            std::string dir_path;
            std::string subject_type;
            std::string subject_id;

            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("target_type") && json["target_type"].is_string()) target_type = json["target_type"].get<std::string>();
                if (json.contains("target_id") && json["target_id"].is_string()) target_id = json["target_id"].get<std::string>();
                if (json.contains("directory_path") && json["directory_path"].is_string()) dir_path = json["directory_path"].get<std::string>();
                if (json.contains("subject_type") && json["subject_type"].is_string()) subject_type = json["subject_type"].get<std::string>();
                if (json.contains("subject_id") && json["subject_id"].is_string()) subject_id = json["subject_id"].get<std::string>();
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (target_type.empty()) {
                target_type = !target_id.empty() ? "DOCUMENT" : "DIRECTORY";
            }
            for (auto& c : target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

            auto test_res = document_service_->test_node_permission(
                target_type, target_id, dir_path, subject_type, subject_id, *auth_res.value()
            );
            if (!test_res.has_value()) {
                if (test_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else if (test_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Target or subject not found"}});
                } else if (test_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid test parameters"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to test permissions"}});
                }
                return;
            }

            send_json(res, "200 OK", test_res.value());
        });
    });

    // GET /api/v1/workspaces/permissions/test
    app.get("/api/v1/workspaces/permissions/test", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string target_type = url_decode(req->getQuery("target_type"));
        std::string target_id = url_decode(req->getQuery("target_id"));
        std::string dir_path = url_decode(req->getQuery("directory_path"));
        std::string subject_type = url_decode(req->getQuery("subject_type"));
        std::string subject_id = url_decode(req->getQuery("subject_id"));

        if (target_type.empty()) {
            target_type = !target_id.empty() ? "DOCUMENT" : "DIRECTORY";
        }
        for (auto& c : target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

        auto test_res = document_service_->test_node_permission(
            target_type, target_id, dir_path, subject_type, subject_id, *auth_res.value()
        );
        if (!test_res.has_value()) {
            if (test_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else if (test_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Target or subject not found"}});
            } else if (test_res.error() == ErrorCode::InvalidArgument) {
                send_json(res, "400 Bad Request", {{"error", "Invalid test parameters"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to test permissions"}});
            }
            return;
        }

        send_json(res, "200 OK", test_res.value());
    });

    // DELETE /api/v1/workspaces/permissions/:id
    app.del("/api/v1/workspaces/permissions/:id", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string perm_id_str = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        int64_t perm_id = 0;
        try {
            perm_id = std::stoll(perm_id_str);
        } catch (...) {
            send_json(res, "400 Bad Request", {{"error", "Invalid permission ID"}});
            return;
        }

        auto del_res = document_service_->delete_node_permission(perm_id, *auth_res.value());
        if (!del_res.has_value()) {
            if (del_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else if (del_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Permission not found"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to delete permission"}});
            }
            return;
        }

        send_json(res, "200 OK", {{"status", "deleted"}});
    });

    // PATCH /api/v1/workspaces/permissions/owner
    app.patch("/api/v1/workspaces/permissions/owner", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string target_type;
            std::string target_id;
            std::string dir_path;
            std::string new_owner_user_id;
            std::string new_owner_team_id;

            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("target_type") && json["target_type"].is_string()) target_type = json["target_type"].get<std::string>();
                if (json.contains("target_id") && json["target_id"].is_string()) target_id = json["target_id"].get<std::string>();
                if (json.contains("directory_path") && json["directory_path"].is_string()) dir_path = json["directory_path"].get<std::string>();
                if (json.contains("new_owner_user_id") && json["new_owner_user_id"].is_string()) new_owner_user_id = json["new_owner_user_id"].get<std::string>();
                if (json.contains("new_owner_team_id") && json["new_owner_team_id"].is_string()) new_owner_team_id = json["new_owner_team_id"].get<std::string>();
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (target_type.empty()) {
                target_type = !target_id.empty() ? "DOCUMENT" : "DIRECTORY";
            }
            for (auto& c : target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

            auto trans_res = document_service_->transfer_node_ownership(
                target_type, target_id, dir_path, new_owner_user_id, new_owner_team_id, *auth_res.value()
            );
            if (!trans_res.has_value()) {
                if (trans_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to transfer ownership"}});
                }
                return;
            }

            send_json(res, "200 OK", {{"status", "transferred"}});
        });
    });

    // GET /api/v1/workspaces/principals
    app.get("/api/v1/workspaces/principals", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto princ_res = document_service_->get_assignable_principals(*auth_res.value());
        if (!princ_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to retrieve principals"}});
            return;
        }

        send_json(res, "200 OK", princ_res.value());
    });

    // GET /api/v1/documents/by-path/html
    app.get("/api/v1/documents/by-path/html", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        if (path_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Query parameter 'path' is required"}});
            return;
        }

        size_t hash_pos = path_param.find('#');
        if (hash_pos != std::string::npos) {
            path_param = path_param.substr(0, hash_pos);
        }

        std::string standalone_param = std::string(req->getQuery("standalone"));
        std::string reviews_param = std::string(req->getQuery("include_reviews"));
        bool standalone = (standalone_param == "true" || standalone_param == "1");
        bool include_reviews = (reviews_param == "true" || reviews_param == "1");

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

        renderer::ReviewBundle reviews;
        if (include_reviews) {
            auto reviews_res = document_service_->get_document_reviews(doc_res.value().id, *auth_res.value());
            if (reviews_res.has_value()) {
                reviews = std::move(reviews_res.value());
            }
        }

        renderer::RenderOptions opts{
            .standalone = standalone,
            .title = doc_res.value().title.empty() ? "Document" : doc_res.value().title,
            .include_reviews = include_reviews
        };

        std::string content = doc_res.value().content;
        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc_res.value().id);
            if (active_room) {
                content = active_room->get_content();
            }
        }

        std::string html = renderer::MarkdownRenderer::render_to_html(content, opts, reviews);
        send_html(res, "200 OK", html);
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string path_param = url_decode(req->getQuery("path"));
        if (path_param.empty()) {
            send_json(res, "400 Bad Request", {{"error", "Query parameter 'path' is required"}});
            return;
        }

        size_t hash_pos = path_param.find('#');
        if (hash_pos != std::string::npos) {
            path_param = path_param.substr(0, hash_pos);
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

        auto doc = doc_res.value();
        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc.id);
            if (active_room) {
                doc.content = active_room->get_content();
            }
        }

        send_json(res, "200 OK", doc.to_json(true));
    });

    // POST /api/v1/documents
    app.post("/api/v1/documents", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
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
                if (json.contains("number_headers") && json["number_headers"].is_boolean()) {
                    create_req.number_headers = json["number_headers"].get<bool>();
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

    // GET /api/v1/documents/:id/html
    app.get("/api/v1/documents/:id/html", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string standalone_param = std::string(req->getQuery("standalone"));
        std::string reviews_param = std::string(req->getQuery("include_reviews"));
        bool standalone = (standalone_param == "true" || standalone_param == "1");
        bool include_reviews = (reviews_param == "true" || reviews_param == "1");

        auto doc_res = document_service_->get_document_by_id(doc_id, *auth_res.value());
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

        renderer::ReviewBundle reviews;
        if (include_reviews) {
            auto reviews_res = document_service_->get_document_reviews(doc_id, *auth_res.value());
            if (reviews_res.has_value()) {
                reviews = std::move(reviews_res.value());
            }
        }

        renderer::RenderOptions opts{
            .standalone = standalone,
            .title = doc_res.value().title.empty() ? "Document" : doc_res.value().title,
            .include_reviews = include_reviews
        };

        std::string content = doc_res.value().content;
        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc_res.value().id);
            if (active_room) {
                content = active_room->get_content();
            }
        }

        std::string html = renderer::MarkdownRenderer::render_to_html(content, opts, reviews);
        send_html(res, "200 OK", html);
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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

        std::string raw_content = raw_res.value();
        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc_id);
            if (active_room) {
                raw_content = active_room->get_content();
            }
        }

        res->writeStatus("200 OK");
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", "text/markdown; charset=utf-8");
        res->end(raw_content);
    });

    // PATCH /api/v1/documents/:id/move
    app.patch("/api/v1/documents/:id/move", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string new_path;
            std::optional<std::string> req_title;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("new_path") && json["new_path"].is_string()) {
                    new_path = json["new_path"].get<std::string>();
                }
                if (json.contains("title") && json["title"].is_string()) {
                    req_title = json["title"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (new_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Field 'new_path' is required"}});
                return;
            }

            auto doc_res = document_service_->move_document(doc_id, new_path, *auth_res.value(), req_title);
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

            if (room_manager_) {
                auto active_room = room_manager_->get_room(doc_id);
                if (active_room) {
                    active_room->set_fs_path(doc_res.value().path);
                }
            }

            send_json(res, "200 OK", doc_res.value().to_json(false));
        });
    });

    // POST /api/v1/documents/:id/convert
    app.post("/api/v1/documents/:id/convert", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto conv_res = document_service_->convert_document(doc_id, *auth_res.value());
        if (!conv_res.has_value()) {
            if (conv_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (conv_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else if (conv_res.error() == ErrorCode::AlreadyExists) {
                send_json(res, "409 Conflict", {{"error", "Target destination already exists"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to convert document"}});
            }
            return;
        }

        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc_id);
            if (active_room) {
                active_room->set_fs_path(conv_res.value().path);
            }
        }

        send_json(res, "200 OK", conv_res.value().to_json(false));
    });

    // POST /api/v1/documents/:id/assets
    app.post("/api/v1/documents/:id/assets", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
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
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, fn_query, fn_header, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
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

            send_json(res, "201 Created", nlohmann::json{
                {"filename", filename},
                {"path", upload_res.value()}
            });
        });
    });

    // POST /api/v1/documents/:id/assets/import
    app.post("/api/v1/documents/:id/assets/import", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string source_path;
            std::string target_filename;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("source_path") && json["source_path"].is_string()) {
                    source_path = json["source_path"].get<std::string>();
                }
                if (json.contains("target_filename") && json["target_filename"].is_string()) {
                    target_filename = json["target_filename"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (source_path.empty()) {
                send_json(res, "400 Bad Request", {{"error", "source_path is required"}});
                return;
            }

            auto import_res = document_service_->import_asset_from_workspace(doc_id, source_path, target_filename, *auth_res.value());
            if (!import_res.has_value()) {
                if (import_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document or source file not found"}});
                } else if (import_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to import asset"}});
                }
                return;
            }

            std::string final_fn = target_filename;
            if (final_fn.empty()) {
                final_fn = std::filesystem::path(source_path).filename().string();
            }

            send_json(res, "201 Created", nlohmann::json{
                {"filename", final_fn},
                {"path", import_res.value()}
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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
        write_cors_headers(res, req->getHeader("origin"));
        res->writeHeader("Content-Type", content_type);
        res->end(asset_res.value());
    });

    // GET /api/v1/documents/:id/assets
    app.get("/api/v1/documents/:id/assets", [this](auto *res, auto *req) {
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto assets_res = document_service_->list_document_assets(doc_id, *auth_res.value());
        if (!assets_res.has_value()) {
            if (assets_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (assets_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list assets"}});
            }
            return;
        }

        send_json(res, "200 OK", assets_res.value());
    });

    // DELETE /api/v1/documents/:id/assets/:filename
    app.del("/api/v1/documents/:id/assets/:filename", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string filename = url_decode(req->getParameter(1));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto del_res = document_service_->delete_document_asset(doc_id, filename, *auth_res.value());
        if (!del_res.has_value()) {
            if (del_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Asset not found"}});
            } else if (del_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Permission denied"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to delete asset"}});
            }
            return;
        }

        send_json(res, "200 OK", {{"status", "deleted"}});
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

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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

        auto doc = doc_res.value();
        if (room_manager_) {
            auto active_room = room_manager_->get_room(doc.id);
            if (active_room) {
                doc.content = active_room->get_content();
            }
        }

        send_json(res, "200 OK", doc.to_json(true));
    });

    // PUT /api/v1/documents/:id
    app.put("/api/v1/documents/:id", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::string content;
            std::optional<std::string> opt_content;
            std::optional<std::string> title;
            std::optional<bool> number_headers;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("content") && json["content"].is_string()) {
                    opt_content = json["content"].get<std::string>();
                }
                if (json.contains("title") && json["title"].is_string()) {
                    title = json["title"].get<std::string>();
                }
                if (json.contains("number_headers") && json["number_headers"].is_boolean()) {
                    number_headers = json["number_headers"].get<bool>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            auto doc_res = document_service_->update_document(doc_id, opt_content, title, *auth_res.value(), number_headers);
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

            auto doc = doc_res.value();
            if (room_manager_) {
                auto active_room = room_manager_->get_room(doc.id);
                if (active_room) {
                    if (opt_content.has_value()) {
                        active_room->set_content(*opt_content);
                        auto diff = active_room->compute_sync_step2({});
                        if (!diff.empty()) {
                            std::string sync_msg;
                            sync_msg.reserve(2 + diff.size());
                            sync_msg.push_back('\x00');
                            sync_msg.push_back('\x02'); // Subtype 0x02: SyncStep2
                            sync_msg.append(reinterpret_cast<const char*>(diff.data()), diff.size());
                            broadcast_to_room(doc.id, sync_msg, true);
                            if (storage_) {
                                storage_->save_crdt_state(doc.id, diff);
                            }
                        }
                    }
                    doc.content = active_room->get_content();
                }
            }

            send_json(res, "200 OK", doc.to_json(true));
        });
    });

    // PATCH /api/v1/documents/:id
    app.patch("/api/v1/documents/:id", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        auto header_lookup = make_header_lookup(req);

        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, doc_id, auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, header_lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }

            std::optional<std::string> opt_content;
            std::optional<std::string> title;
            std::optional<bool> number_headers;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("content") && json["content"].is_string()) {
                    opt_content = json["content"].get<std::string>();
                }
                if (json.contains("title") && json["title"].is_string()) {
                    title = json["title"].get<std::string>();
                }
                if (json.contains("number_headers") && json["number_headers"].is_boolean()) {
                    number_headers = json["number_headers"].get<bool>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            auto doc_res = document_service_->update_document(doc_id, opt_content, title, *auth_res.value(), number_headers);
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

            auto doc = doc_res.value();
            if (room_manager_) {
                auto active_room = room_manager_->get_room(doc.id);
                if (active_room) {
                    if (opt_content.has_value()) {
                        active_room->set_content(*opt_content);
                        auto diff = active_room->compute_sync_step2({});
                        if (!diff.empty()) {
                            std::string sync_msg;
                            sync_msg.reserve(2 + diff.size());
                            sync_msg.push_back('\x00');
                            sync_msg.push_back('\x02'); // Subtype 0x02: SyncStep2
                            sync_msg.append(reinterpret_cast<const char*>(diff.data()), diff.size());
                            broadcast_to_room(doc.id, sync_msg, true);
                            if (storage_) {
                                storage_->save_crdt_state(doc.id, diff);
                            }
                        }
                    }
                    doc.content = active_room->get_content();
                }
            }

            send_json(res, "200 OK", doc.to_json(true));
        });
    });

    // DELETE /api/v1/documents/:id
    app.del("/api/v1/documents/:id", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string doc_id = std::string(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
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

    // GET /api/v1/users/me/recents
    app.get("/api/v1/users/me/recents", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string limit_param = std::string(req->getQuery("limit"));
        size_t limit = limit_param.empty() ? 20 : std::stoul(limit_param);

        auto recents_res = document_service_->get_recent_documents(*auth_res.value(), limit);
        if (!recents_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to retrieve recents"}});
            return;
        }

        send_json(res, "200 OK", {{"recents", recents_res.value()}});
    });

    // PATCH /api/v1/users/me & PUT /api/v1/users/me: Self-service profile and password update
    auto handle_update_me = [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));
        std::string req_origin = std::string(req->getHeader("origin"));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {
                {"error", "Unauthorized"},
                {"message", "Authentication required"}
            }, {}, req_origin);
            return;
        }

        auto user = *auth_res.value();
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, user, req_origin](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            admin::UpdateUserRequest update_req;
            std::string current_password;
            std::string new_password;

            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("display_name") && json["display_name"].is_string()) {
                    std::string dn = json["display_name"].get<std::string>();
                    while (!dn.empty() && std::isspace(static_cast<unsigned char>(dn.front()))) dn.erase(dn.begin());
                    while (!dn.empty() && std::isspace(static_cast<unsigned char>(dn.back()))) dn.pop_back();
                    if (dn.empty()) {
                        send_json(res, "400 Bad Request", {{"error", "InvalidDisplayName"}, {"message", "Display name cannot be empty"}}, {}, req_origin);
                        return;
                    }
                    if (dn.size() > 128) {
                        send_json(res, "400 Bad Request", {{"error", "InvalidDisplayName"}, {"message", "Display name cannot exceed 128 characters"}}, {}, req_origin);
                        return;
                    }
                    update_req.display_name = dn;
                }
                if (json.contains("avatar_color") && json["avatar_color"].is_string()) {
                    std::string ac = json["avatar_color"].get<std::string>();
                    if (ac.size() == 7 && ac[0] == '#') {
                        update_req.avatar_color = ac;
                    }
                }
                if (json.contains("current_password") && json["current_password"].is_string()) {
                    current_password = json["current_password"].get<std::string>();
                }
                if (json.contains("new_password") && json["new_password"].is_string()) {
                    new_password = json["new_password"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "InvalidPayload"}, {"message", "Invalid JSON payload"}}, {}, req_origin);
                return;
            }

            // Password update validation
            if (!new_password.empty()) {
                if (config_.authn.provider != "challenge") {
                    send_json(res, "400 Bad Request", {
                        {"error", "PasswordChangeNotAllowed"},
                        {"message", "Password changes are disabled because authentication is delegated to an external identity provider."}
                    }, {}, req_origin);
                    return;
                }

                if (current_password.empty()) {
                    send_json(res, "400 Bad Request", {
                        {"error", "CurrentPasswordRequired"},
                        {"message", "Current password is required to set a new password."}
                    });
                    return;
                }

                if (!challenge_provider_) {
                    send_json(res, "500 Internal Server Error", {{"error", "Challenge provider unavailable"}}, {}, req_origin);
                    return;
                }

                auto verify_res = challenge_provider_->authenticate_credentials(user.username, current_password);
                if (!verify_res.has_value() || !verify_res.value().has_value()) {
                    send_json(res, "400 Bad Request", {
                        {"error", "InvalidPassword"},
                        {"message", "Current password is incorrect."}
                    }, {}, req_origin);
                    return;
                }

                if (new_password.size() < 6) {
                    send_json(res, "400 Bad Request", {
                        {"error", "PasswordTooShort"},
                        {"message", "New password must be at least 6 characters long."}
                    }, {}, req_origin);
                    return;
                }

                update_req.password = new_password;
            }

            if (!update_req.display_name.has_value() && !update_req.avatar_color.has_value() && !update_req.password.has_value()) {
                send_json(res, "400 Bad Request", {{"error", "NoUpdates"}, {"message", "No valid fields provided for update."}}, {}, req_origin);
                return;
            }

            auto upd_res = user_service_->update_user(user.user_id, update_req);
            if (!upd_res.has_value()) {
                if (upd_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "UserNotFound"}, {"message", "User not found"}}, {}, req_origin);
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "UpdateFailed"}, {"message", "Failed to update profile"}}, {}, req_origin);
                }
                return;
            }

            nlohmann::json resp;
            resp["status"] = "updated";
            resp["user"] = upd_res->to_json();
            resp["user"]["authn_provider"] = config_.authn.provider;
            resp["user"]["can_change_password"] = (config_.authn.provider == "challenge");
            resp["display_name"] = upd_res->display_name;
            send_json(res, "200 OK", resp, {}, req_origin);
        });
    };

    app.patch("/api/v1/users/me", handle_update_me);
    app.put("/api/v1/users/me", handle_update_me);

    // GET /api/v1/search
    app.get("/api/v1/search", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        std::string query = url_decode(req->getQuery("q"));
        std::string path_prefix = url_decode(req->getQuery("path"));
        std::string limit_str = std::string(req->getQuery("limit"));
        size_t limit = limit_str.empty() ? 20 : std::stoul(limit_str);

        auto search_res = document_service_->search_documents(query, path_prefix, limit, *auth_res.value());
        if (!search_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Search operation failed"}});
            return;
        }

        send_json(res, "200 OK", {{"query", query}, {"results", search_res.value()}});
    });

    // GET /api/v1/trash
    app.get("/api/v1/trash", [this](auto *res, auto *req) {
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto trash_res = document_service_->list_trash(*auth_res.value());
        if (!trash_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to list trash"}});
            return;
        }

        send_json(res, "200 OK", {{"trash", trash_res.value()}});
    });

    // POST /api/v1/trash/:id/restore
    app.post("/api/v1/trash/:id/restore", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string trash_id = url_decode(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto rest_res = document_service_->restore_trash_item(trash_id, "", *auth_res.value());
        if (!rest_res.has_value()) {
            if (rest_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Trash entry not found"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to restore trash item"}});
            }
            return;
        }

        send_json(res, "200 OK", rest_res.value().to_json());
    });

    // DELETE /api/v1/trash/:id
    app.del("/api/v1/trash/:id", [this, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        std::string trash_id = url_decode(req->getParameter(0));
        std::string auth_hdr = std::string(req->getHeader("authorization"));
        std::string cookie_hdr = std::string(req->getHeader("cookie"));
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
        std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

        auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return;
        }

        auto purge_res = document_service_->purge_trash_item(trash_id, *auth_res.value());
        if (!purge_res.has_value()) {
            if (purge_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Trash entry not found"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to purge trash item"}});
            }
            return;
        }

        send_json(res, "200 OK", {{"status", "purged"}, {"id", trash_id}});
    });

    // ==========================================================================
    // Admin REST API Endpoints (Step 2.5)
    // ==========================================================================
    auto get_auth_context = [this](auto* req) {
        struct AuthCtx {
            std::string auth_hdr;
            std::string cookie_hdr;
            std::string remote_user_hdr;
            std::string remote_email_hdr;
            std::function<std::string(std::string_view)> lookup;
        };
        std::string del_header_name = config_.authn.delegated_header;
        std::string del_email_name = config_.authn.delegated_email_header;
        for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return AuthCtx{
            .auth_hdr = std::string(req->getHeader("authorization")),
            .cookie_hdr = std::string(req->getHeader("cookie")),
            .remote_user_hdr = std::string(req->getHeader(del_header_name)),
            .remote_email_hdr = std::string(req->getHeader(del_email_name)),
            .lookup = make_header_lookup(req)
        };
    };

    auto verify_admin_access = [this](const auto& ctx, auto* res) -> std::optional<auth::UserIdentity> {
        auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return std::nullopt;
        }
        if (!auth_res.value()->is_system_admin) {
            send_json(res, "403 Forbidden", {{"error", "Forbidden: Admin privileges required"}});
            return std::nullopt;
        }
        return auth_res.value();
    };

    // GET /api/v1/admin/users
    app.get("/api/v1/admin/users", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        auto list_res = user_service_->list_users();
        if (!list_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to list users"}});
            return;
        }
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& u : *list_res) {
            arr.push_back(u.to_json());
        }
        send_json(res, "200 OK", arr);
    });

    // POST /api/v1/admin/users
    app.post("/api/v1/admin/users", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            admin::CreateUserRequest create_req;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("username") && json["username"].is_string()) {
                    create_req.username = json["username"].get<std::string>();
                }
                if (json.contains("password") && json["password"].is_string()) {
                    create_req.password = json["password"].get<std::string>();
                }
                if (json.contains("display_name") && json["display_name"].is_string()) {
                    create_req.display_name = json["display_name"].get<std::string>();
                }
                if (json.contains("avatar_color") && json["avatar_color"].is_string()) {
                    create_req.avatar_color = json["avatar_color"].get<std::string>();
                }
                if (json.contains("is_admin") && json["is_admin"].is_boolean()) {
                    create_req.is_system_admin = json["is_admin"].get<bool>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (create_req.username.empty() || create_req.password.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Missing username or password"}});
                return;
            }

            auto create_res = user_service_->create_user(create_req);
            if (!create_res.has_value()) {
                if (create_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Username already exists"}});
                } else if (create_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid user parameters"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to create user"}});
                }
                return;
            }

            send_json(res, "201 Created", create_res->to_json());
        });
    });

    // GET /api/v1/admin/users/:id
    app.get("/api/v1/admin/users/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string user_id = std::string(req->getParameter(0));
        auto get_res = user_service_->get_user_by_id(user_id);
        if (!get_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "User not found"}});
            return;
        }
        send_json(res, "200 OK", get_res->to_json());
    });

    // PUT /api/v1/admin/users/:id
    app.put("/api/v1/admin/users/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        std::string user_id = std::string(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, user_id, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            admin::UpdateUserRequest update_req;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("display_name") && json["display_name"].is_string()) {
                    update_req.display_name = json["display_name"].get<std::string>();
                }
                if (json.contains("avatar_color") && json["avatar_color"].is_string()) {
                    update_req.avatar_color = json["avatar_color"].get<std::string>();
                }
                if (json.contains("is_admin") && json["is_admin"].is_boolean()) {
                    update_req.is_system_admin = json["is_admin"].get<bool>();
                }
                if (json.contains("password") && json["password"].is_string()) {
                    update_req.password = json["password"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            auto upd_res = user_service_->update_user(user_id, update_req);
            if (!upd_res.has_value()) {
                if (upd_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "User not found"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to update user"}});
                }
                return;
            }
            send_json(res, "200 OK", upd_res->to_json());
        });
    });

    // DELETE /api/v1/admin/users/:id
    app.del("/api/v1/admin/users/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string user_id = std::string(req->getParameter(0));
        auto del_res = user_service_->delete_user(user_id);
        if (!del_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "User not found"}});
            return;
        }
        send_json(res, "200 OK", {{"status", "deleted"}});
    });

    // GET /api/v1/admin/teams/:id/members
    app.get("/api/v1/admin/teams/:id/members", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        auto mem_res = team_service_->list_members(team_id);
        if (!mem_res.has_value()) {
            if (mem_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Team not found"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list members"}});
            }
            return;
        }
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& m : *mem_res) {
            arr.push_back(m.to_json());
        }
        send_json(res, "200 OK", arr);
    });

    // POST /api/v1/admin/teams/:id/members
    app.post("/api/v1/admin/teams/:id/members", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        std::string team_id = std::string(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, team_id, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            std::string user_identifier;
            std::string role = "member";
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("user_id") && json["user_id"].is_string()) {
                    user_identifier = json["user_id"].get<std::string>();
                } else if (json.contains("username") && json["username"].is_string()) {
                    user_identifier = json["username"].get<std::string>();
                }
                if (json.contains("role") && json["role"].is_string()) {
                    role = json["role"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (user_identifier.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Missing user_id or username"}});
                return;
            }

            auto add_res = team_service_->add_member(team_id, user_identifier, role);
            if (!add_res.has_value()) {
                if (add_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Team or user not found"}});
                } else if (add_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Invalid role (must be 'member' or 'lead')"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to add member"}});
                }
                return;
            }
            send_json(res, "200 OK", {{"status", "member_added"}});
        });
    });

    // DELETE /api/v1/admin/teams/:id/members/:user_id
    app.del("/api/v1/admin/teams/:id/members/:user_id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        std::string user_id = std::string(req->getParameter(1));

        auto rem_res = team_service_->remove_member(team_id, user_id);
        if (!rem_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "Membership not found"}});
            return;
        }
        send_json(res, "200 OK", {{"status", "member_removed"}});
    });

    // GET /api/v1/admin/teams/:id/parents
    app.get("/api/v1/admin/teams/:id/parents", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        auto p_res = team_service_->list_parents(team_id);
        if (!p_res.has_value()) {
            if (p_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Team not found"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list parent teams"}});
            }
            return;
        }
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& p : *p_res) {
            arr.push_back(p.to_json());
        }
        send_json(res, "200 OK", arr);
    });

    // POST /api/v1/admin/teams/:id/parents
    app.post("/api/v1/admin/teams/:id/parents", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        std::string team_id = std::string(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, team_id, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            std::string parent_identifier;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("parent_id") && json["parent_id"].is_string()) {
                    parent_identifier = json["parent_id"].get<std::string>();
                } else if (json.contains("parent_name") && json["parent_name"].is_string()) {
                    parent_identifier = json["parent_name"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (parent_identifier.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Missing parent_id or parent_name"}});
                return;
            }

            auto link_res = team_service_->add_parent(team_id, parent_identifier);
            if (!link_res.has_value()) {
                if (link_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Team or parent team not found"}});
                } else if (link_res.error() == ErrorCode::InvalidArgument) {
                    send_json(res, "400 Bad Request", {{"error", "Circular DAG inheritance or self-parenting detected"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to link parent team"}});
                }
                return;
            }
            send_json(res, "200 OK", {{"status", "parent_linked"}});
        });
    });

    // DELETE /api/v1/admin/teams/:id/parents/:parent_id
    app.del("/api/v1/admin/teams/:id/parents/:parent_id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        std::string parent_id = std::string(req->getParameter(1));

        auto unlink_res = team_service_->remove_parent(team_id, parent_id);
        if (!unlink_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "Parent relationship not found"}});
            return;
        }
        send_json(res, "200 OK", {{"status", "parent_unlinked"}});
    });

    // GET /api/v1/admin/teams
    app.get("/api/v1/admin/teams", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        auto list_res = team_service_->list_teams();
        if (!list_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to list teams"}});
            return;
        }
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& t : *list_res) {
            arr.push_back(t.to_json());
        }
        send_json(res, "200 OK", arr);
    });

    // POST /api/v1/admin/teams
    app.post("/api/v1/admin/teams", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            admin::CreateTeamRequest create_req;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("name") && json["name"].is_string()) {
                    create_req.name = json["name"].get<std::string>();
                }
                if (json.contains("description") && json["description"].is_string()) {
                    create_req.description = json["description"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            if (create_req.name.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Missing team name"}});
                return;
            }

            auto create_res = team_service_->create_team(create_req);
            if (!create_res.has_value()) {
                if (create_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Team name already exists"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to create team"}});
                }
                return;
            }
            send_json(res, "201 Created", create_res->to_json());
        });
    });

    // GET /api/v1/admin/teams/:id
    app.get("/api/v1/admin/teams/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        auto get_res = team_service_->get_team_by_id(team_id);
        if (!get_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "Team not found"}});
            return;
        }
        send_json(res, "200 OK", get_res->to_json());
    });

    // PUT /api/v1/admin/teams/:id
    app.put("/api/v1/admin/teams/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        std::string team_id = std::string(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });

        res->onData([this, res, body, aborted, ctx, team_id, verify_admin_access](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;

            auto user_opt = verify_admin_access(ctx, res);
            if (!user_opt) return;

            admin::UpdateTeamRequest update_req;
            try {
                auto json = nlohmann::json::parse(*body);
                if (json.contains("name") && json["name"].is_string()) {
                    update_req.name = json["name"].get<std::string>();
                }
                if (json.contains("description") && json["description"].is_string()) {
                    update_req.description = json["description"].get<std::string>();
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }

            auto upd_res = team_service_->update_team(team_id, update_req);
            if (!upd_res.has_value()) {
                if (upd_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Team not found"}});
                } else if (upd_res.error() == ErrorCode::AlreadyExists) {
                    send_json(res, "409 Conflict", {{"error", "Team name already exists"}});
                } else {
                    send_json(res, "500 Internal Server Error", {{"error", "Failed to update team"}});
                }
                return;
            }
            send_json(res, "200 OK", upd_res->to_json());
        });
    });

    // DELETE /api/v1/admin/teams/:id
    app.del("/api/v1/admin/teams/:id", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        std::string team_id = std::string(req->getParameter(0));
        auto del_res = team_service_->delete_team(team_id);
        if (!del_res.has_value()) {
            send_json(res, "404 Not Found", {{"error", "Team not found"}});
            return;
        }
        send_json(res, "200 OK", {{"status", "deleted"}});
    });

    // =========================================================================
    // Admin Backup Coordination Barrier Endpoints (Step 7.2)
    // =========================================================================

    // POST /api/v1/admin/backup/prepare
    app.post("/api/v1/admin/backup/prepare", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        size_t flushed = prepare_backup();
        send_json(res, "200 OK", {
            {"status", "barrier_active"},
            {"rooms_flushed", flushed},
            {"barrier_active", true}
        });
    });

    // POST /api/v1/admin/backup/release
    app.post("/api/v1/admin/backup/release", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        release_backup();
        send_json(res, "200 OK", {
            {"status", "barrier_released"},
            {"barrier_active", false}
        });
    });

    // GET /api/v1/admin/backup/status
    app.get("/api/v1/admin/backup/status", [this, get_auth_context, verify_admin_access](auto *res, auto *req) {
        auto ctx = get_auth_context(req);
        auto user_opt = verify_admin_access(ctx, res);
        if (!user_opt) return;

        send_json(res, "200 OK", {
            {"barrier_active", is_backup_barrier_active()}
        });
    });

    // =========================================================================
    // Review Engine REST Endpoints & Opcode 0x02 Event Fanout (Step 3.4)
    // =========================================================================

    auto authenticate_user = [this, get_auth_context](auto* req, auto* res) -> std::optional<auth::UserIdentity> {
        auto ctx = get_auth_context(req);
        auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
        if (!auth_res.has_value() || !auth_res.value().has_value()) {
            send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
            return std::nullopt;
        }
        return auth_res.value();
    };

    // --- Threaded Comments ---

    // GET /api/v1/documents/:id/comments
    app.get("/api/v1/documents/:id/comments", [this, authenticate_user](auto *res, auto *req) {
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string doc_id = url_decode(req->getParameter(0));
        auto list_res = review_service_->list_comments(doc_id, *user);
        if (!list_res.has_value()) {
            if (list_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (list_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list comments"}});
            }
            return;
        }
        nlohmann::json out = nlohmann::json::array();
        for (const auto& c : list_res.value()) {
            out.push_back(c.to_json());
        }
        send_json(res, "200 OK", out);
    });

    // POST /api/v1/documents/:id/comments
    app.post("/api/v1/documents/:id/comments", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string doc_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, doc_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            review::CreateCommentRequest req_data;
            try {
                auto j = nlohmann::json::parse(*body);
                req_data.content = j.value("content", "");
                if (j.contains("anchor") && j["anchor"].is_object()) {
                    req_data.anchor = j["anchor"];
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }
            auto create_res = review_service_->create_comment(doc_id, *auth_res.value(), req_data);
            if (!create_res.has_value()) {
                if (create_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Comment access required"}});
                } else if (create_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to create comment"}});
                }
                return;
            }
            broadcast_review_event(doc_id, {
                {"event", "COMMENT_CREATED"},
                {"document_id", doc_id},
                {"comment", create_res.value().to_json()}
            });
            send_json(res, "201 Created", create_res.value().to_json());
        });
    });

    // POST /api/v1/comments/:id/replies
    app.post("/api/v1/comments/:id/replies", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string comment_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, comment_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            std::string content;
            try {
                auto j = nlohmann::json::parse(*body);
                content = j.value("content", "");
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }
            auto reply_res = review_service_->reply_comment(comment_id, *auth_res.value(), content);
            if (!reply_res.has_value()) {
                if (reply_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Comment not found"}});
                } else if (reply_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Comment access required"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to reply to comment"}});
                }
                return;
            }
            broadcast_review_event(reply_res.value().document_id, {
                {"event", "COMMENT_REPLIED"},
                {"document_id", reply_res.value().document_id},
                {"parent_id", comment_id},
                {"comment", reply_res.value().to_json()}
            });
            send_json(res, "201 Created", reply_res.value().to_json());
        });
    });

    // PATCH /api/v1/comments/:id/status
    app.patch("/api/v1/comments/:id/status", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string comment_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, comment_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            std::string status = "RESOLVED";
            try {
                auto j = nlohmann::json::parse(*body);
                status = j.value("status", "RESOLVED");
            } catch (...) {}
            auto update_res = review_service_->update_comment_status(comment_id, *auth_res.value(), status);
            if (!update_res.has_value()) {
                if (update_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Comment not found"}});
                } else if (update_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to update comment status"}});
                }
                return;
            }
            broadcast_review_event(update_res.value().document_id, {
                {"event", "COMMENT_STATUS_CHANGED"},
                {"document_id", update_res.value().document_id},
                {"comment_id", comment_id},
                {"status", status}
            });
            send_json(res, "200 OK", update_res.value().to_json());
        });
    });

    // PATCH /api/v1/comments/:id
    app.patch("/api/v1/comments/:id", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string comment_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, comment_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            std::string content;
            try {
                auto j = nlohmann::json::parse(*body);
                content = j.value("content", "");
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }
            if (content.empty()) {
                send_json(res, "400 Bad Request", {{"error", "Content cannot be empty"}});
                return;
            }
            auto update_res = review_service_->update_comment_content(comment_id, *auth_res.value(), content);
            if (!update_res.has_value()) {
                if (update_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Comment not found"}});
                } else if (update_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to update comment"}});
                }
                return;
            }
            broadcast_review_event(update_res.value().document_id, {
                {"event", "COMMENT_UPDATED"},
                {"document_id", update_res.value().document_id},
                {"comment", update_res.value().to_json()}
            });
            send_json(res, "200 OK", update_res.value().to_json());
        });
    });

    // DELETE /api/v1/comments/:id
    app.del("/api/v1/comments/:id", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string comment_id = url_decode(req->getParameter(0));
        auto comm_res = review_service_->get_comment(comment_id, *user);
        std::string doc_id;
        if (comm_res.has_value()) {
            doc_id = comm_res.value().document_id;
        }
        auto del_res = review_service_->delete_comment(comment_id, *user);
        if (!del_res.has_value()) {
            if (del_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Comment not found"}});
            } else if (del_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to delete comment"}});
            }
            return;
        }
        if (!doc_id.empty()) {
            broadcast_review_event(doc_id, {
                {"event", "COMMENT_DELETED"},
                {"document_id", doc_id},
                {"comment_id", comment_id}
            });
        }
        send_json(res, "200 OK", {{"status", "deleted"}});
    });

    // POST /api/v1/comments/:id/archive
    app.post("/api/v1/comments/:id/archive", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string comment_id = url_decode(req->getParameter(0));
        auto arch_res = review_service_->archive_comment(comment_id, *user);
        if (!arch_res.has_value()) {
            if (arch_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Comment not found"}});
            } else if (arch_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to archive comment"}});
            }
            return;
        }
        broadcast_review_event(arch_res.value().document_id, {
            {"event", "COMMENT_ARCHIVED"},
            {"document_id", arch_res.value().document_id},
            {"comment_id", comment_id},
            {"data", arch_res.value().to_json()}
        });
        send_json(res, "200 OK", arch_res.value().to_json());
    });

    // --- Inline Suggestions ---

    // GET /api/v1/documents/:id/suggestions
    app.get("/api/v1/documents/:id/suggestions", [this, authenticate_user](auto *res, auto *req) {
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string doc_id = url_decode(req->getParameter(0));
        std::string status_param = std::string(req->getQuery("status"));
        auto list_res = review_service_->list_suggestions(doc_id, *user, status_param);
        if (!list_res.has_value()) {
            if (list_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (list_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list suggestions"}});
            }
            return;
        }
        nlohmann::json out = nlohmann::json::array();
        for (const auto& s : list_res.value()) {
            out.push_back(s.to_json());
        }
        send_json(res, "200 OK", out);
    });

    // POST /api/v1/documents/:id/suggestions
    app.post("/api/v1/documents/:id/suggestions", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string doc_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, doc_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            review::CreateSuggestionRequest req_data;
            try {
                auto j = nlohmann::json::parse(*body);
                req_data.original_text = j.value("original_text", "");
                req_data.suggested_text = j.value("suggested_text", "");
                if (j.contains("anchor") && j["anchor"].is_object()) {
                    req_data.anchor = j["anchor"];
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }
            auto sug_res = review_service_->create_suggestion(doc_id, *auth_res.value(), req_data);
            if (!sug_res.has_value()) {
                if (sug_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Comment access required"}});
                } else if (sug_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to create suggestion"}});
                }
                return;
            }
            broadcast_review_event(doc_id, {
                {"event", "SUGGESTION_CREATED"},
                {"document_id", doc_id},
                {"suggestion", sug_res.value().to_json()}
            });
            send_json(res, "201 Created", sug_res.value().to_json());
        });
    });

    // POST /api/v1/suggestions/:id/accept
    app.post("/api/v1/suggestions/:id/accept", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string suggestion_id = url_decode(req->getParameter(0));
        auto accept_res = review_service_->accept_suggestion(
            suggestion_id,
            *user,
            room_manager_,
            [this](const std::string& did, std::span<const uint8_t> delta) {
                std::string update_msg;
                update_msg.reserve(2 + delta.size());
                update_msg.push_back('\x00');
                update_msg.push_back('\x03'); // SyncUpdate delta
                update_msg.append(reinterpret_cast<const char*>(delta.data()), delta.size());
                broadcast_to_room(did, update_msg, true);
            }
        );
        if (!accept_res.has_value()) {
            if (accept_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Suggestion not found"}});
            } else if (accept_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access required to accept suggestions"}});
            } else {
                send_json(res, "400 Bad Request", {{"error", "Cannot accept suggestion"}});
            }
            return;
        }
        broadcast_review_event(accept_res.value().document_id, {
            {"event", "SUGGESTION_ACCEPTED"},
            {"document_id", accept_res.value().document_id},
            {"suggestion", accept_res.value().to_json()}
        });
        send_json(res, "200 OK", accept_res.value().to_json());
    });

    // POST /api/v1/suggestions/:id/reject
    app.post("/api/v1/suggestions/:id/reject", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string suggestion_id = url_decode(req->getParameter(0));
        auto rej_res = review_service_->reject_suggestion(suggestion_id, *user);
        if (!rej_res.has_value()) {
            if (rej_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Suggestion not found"}});
            } else if (rej_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
            } else {
                send_json(res, "400 Bad Request", {{"error", "Cannot reject suggestion"}});
            }
            return;
        }
        broadcast_review_event(rej_res.value().document_id, {
            {"event", "SUGGESTION_REJECTED"},
            {"document_id", rej_res.value().document_id},
            {"suggestion_id", suggestion_id}
        });
        send_json(res, "200 OK", rej_res.value().to_json());
    });

    // POST /api/v1/suggestions/:id/archive
    app.post("/api/v1/suggestions/:id/archive", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string suggestion_id = url_decode(req->getParameter(0));
        auto arch_res = review_service_->archive_suggestion(suggestion_id, *user);
        if (!arch_res.has_value()) {
            if (arch_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Suggestion not found"}});
            } else if (arch_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access or author required"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to archive suggestion"}});
            }
            return;
        }
        broadcast_review_event(arch_res.value().document_id, {
            {"event", "SUGGESTION_ARCHIVED"},
            {"document_id", arch_res.value().document_id},
            {"suggestion_id", suggestion_id},
            {"data", arch_res.value().to_json()}
        });
        send_json(res, "200 OK", arch_res.value().to_json());
    });

    // --- Action Item Tasks ---

    // GET /api/v1/documents/:id/tasks
    app.get("/api/v1/documents/:id/tasks", [this, authenticate_user](auto *res, auto *req) {
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string doc_id = url_decode(req->getParameter(0));
        auto list_res = review_service_->list_tasks(doc_id, *user);
        if (!list_res.has_value()) {
            if (list_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Document not found"}});
            } else if (list_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to list tasks"}});
            }
            return;
        }
        nlohmann::json out = nlohmann::json::array();
        for (const auto& t : list_res.value()) {
            out.push_back(t.to_json());
        }
        send_json(res, "200 OK", out);
    });

    // POST /api/v1/documents/:id/tasks
    app.post("/api/v1/documents/:id/tasks", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string doc_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, doc_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            review::CreateTaskRequest req_data;
            try {
                auto j = nlohmann::json::parse(*body);
                req_data.description = j.value("description", "");
                if (j.contains("comment_id") && j["comment_id"].is_string()) {
                    req_data.comment_id = j["comment_id"];
                }
                if (j.contains("assignee_id") && j["assignee_id"].is_string()) {
                    req_data.assignee_id = j["assignee_id"];
                }
                if (j.contains("due_date") && j["due_date"].is_string()) {
                    req_data.due_date = j["due_date"];
                }
            } catch (...) {
                send_json(res, "400 Bad Request", {{"error", "Invalid JSON payload"}});
                return;
            }
            auto task_res = review_service_->create_task(doc_id, *auth_res.value(), req_data);
            if (!task_res.has_value()) {
                if (task_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Comment access required"}});
                } else if (task_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Document not found"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to create task"}});
                }
                return;
            }
            broadcast_review_event(doc_id, {
                {"event", "TASK_CREATED"},
                {"document_id", doc_id},
                {"task", task_res.value().to_json()}
            });
            send_json(res, "201 Created", task_res.value().to_json());
        });
    });

    // PATCH /api/v1/tasks/:id
    app.patch("/api/v1/tasks/:id", [this, get_auth_context, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto ctx = get_auth_context(req);
        std::string task_id = url_decode(req->getParameter(0));
        auto body = std::make_shared<std::string>();
        auto aborted = std::make_shared<bool>(false);
        res->onAborted([aborted]() { *aborted = true; });
        res->onData([this, res, body, aborted, task_id, ctx](std::string_view chunk, bool is_last) {
            body->append(chunk.data(), chunk.length());
            if (!is_last || *aborted) return;
            auto auth_res = authenticate_request(ctx.auth_hdr, ctx.cookie_hdr, ctx.remote_user_hdr, ctx.remote_email_hdr, ctx.lookup);
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                send_json(res, "401 Unauthorized", {{"error", "Unauthorized"}});
                return;
            }
            review::UpdateTaskRequest update_req;
            try {
                auto j = nlohmann::json::parse(*body);
                if (j.contains("is_completed") && !j["is_completed"].is_null()) {
                    update_req.is_completed = j["is_completed"].get<bool>();
                }
                if (j.contains("description") && !j["description"].is_null()) {
                    update_req.description = j["description"].get<std::string>();
                }
                if (j.contains("assignee_id")) {
                    if (j["assignee_id"].is_null()) {
                        update_req.assignee_id = "";
                    } else {
                        update_req.assignee_id = j["assignee_id"].get<std::string>();
                    }
                }
                if (j.contains("due_date")) {
                    if (j["due_date"].is_null()) {
                        update_req.due_date = "";
                    } else {
                        update_req.due_date = j["due_date"].get<std::string>();
                    }
                }
            } catch (...) {}
            auto task_res = review_service_->update_task(task_id, *auth_res.value(), update_req);
            if (!task_res.has_value()) {
                if (task_res.error() == ErrorCode::NotFound) {
                    send_json(res, "404 Not Found", {{"error", "Task not found"}});
                } else if (task_res.error() == ErrorCode::PermissionDenied) {
                    send_json(res, "403 Forbidden", {{"error", "Forbidden: Comment access required"}});
                } else {
                    send_json(res, "400 Bad Request", {{"error", "Failed to update task"}});
                }
                return;
            }
            broadcast_review_event(task_res.value().document_id, {
                {"event", "TASK_UPDATED"},
                {"document_id", task_res.value().document_id},
                {"task", task_res.value().to_json()}
            });
            send_json(res, "200 OK", task_res.value().to_json());
        });
    });

    // GET /api/v1/tasks (Centralized Task Dashboard)
    app.get("/api/v1/tasks", [this, authenticate_user](auto *res, auto *req) {
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string completed_str = std::string(req->getQuery("completed"));
        std::optional<bool> completed_filter = std::nullopt;
        if (completed_str == "true") completed_filter = true;
        else if (completed_str == "false") completed_filter = false;

        std::string assigned_str = std::string(req->getQuery("assigned_to_me"));
        bool assigned_to_me_only = (assigned_str == "true" || assigned_str == "1");

        auto list_res = review_service_->list_all_tasks(*user, completed_filter, assigned_to_me_only);
        if (!list_res.has_value()) {
            send_json(res, "500 Internal Server Error", {{"error", "Failed to list tasks"}});
            return;
        }
        nlohmann::json out = nlohmann::json::array();
        for (const auto& t : list_res.value()) {
            out.push_back(t.to_json());
        }
        send_json(res, "200 OK", out);
    });

    // DELETE /api/v1/tasks/:id
    app.del("/api/v1/tasks/:id", [this, authenticate_user, check_barrier](auto *res, auto *req) {
        if (check_barrier(res)) return;
        auto user = authenticate_user(req, res);
        if (!user) return;
        std::string task_id = url_decode(req->getParameter(0));
        auto del_res = review_service_->delete_task(task_id, *user);
        if (!del_res.has_value()) {
            if (del_res.error() == ErrorCode::NotFound) {
                send_json(res, "404 Not Found", {{"error", "Task not found"}});
            } else if (del_res.error() == ErrorCode::PermissionDenied) {
                send_json(res, "403 Forbidden", {{"error", "Forbidden: Edit access required"}});
            } else {
                send_json(res, "500 Internal Server Error", {{"error", "Failed to delete task"}});
            }
            return;
        }
        send_json(res, "200 OK", {{"status", "deleted"}});
    });

    // =========================================================================
    // Real-Time Collaborative CRDT & WebSockets Engine (Step 3.2)
    // =========================================================================
    unsigned short ws_idle_timeout = 120;
    if (config_.server.keepalive_timeout_seconds == 0) {
        ws_idle_timeout = 0;
    } else if (config_.server.keepalive_timeout_seconds < 8) {
        ws_idle_timeout = 8;
    } else if (config_.server.keepalive_timeout_seconds > 960) {
        ws_idle_timeout = 960;
    } else {
        ws_idle_timeout = static_cast<unsigned short>(config_.server.keepalive_timeout_seconds);
    }

    app.ws<collab::CollabSocketData>("/ws/collab/:document_id", {
        .compression = uWS::DISABLED,
        .maxPayloadLength = 16 * 1024 * 1024,
        .idleTimeout = ws_idle_timeout,
        .maxBackpressure = 1 * 1024 * 1024,
        .closeOnBackpressureLimit = false,
        .resetIdleTimeoutOnSend = false,
        .sendPingsAutomatically = true,
        .maxLifetime = 0,
        .upgrade = [this](auto *res, auto *req, auto *context) {
            std::string doc_id = url_decode(req->getParameter(0));
            if (doc_id.empty() || doc_id == "by-path") {
                res->writeStatus("404 Not Found");
                res->writeHeader("Content-Type", "application/json");
                res->end(nlohmann::json{
                    {"error", "NotFound"},
                    {"message", "Invalid document ID"}
                }.dump());
                return;
            }
            std::string sec_key = std::string(req->getHeader("sec-websocket-key"));
            std::string sec_proto = std::string(req->getHeader("sec-websocket-protocol"));
            std::string sec_ext = std::string(req->getHeader("sec-websocket-extensions"));

            std::string auth_hdr = std::string(req->getHeader("authorization"));
            std::string cookie_hdr = std::string(req->getHeader("cookie"));

            std::string del_header_name = config_.authn.delegated_header;
            std::string del_email_name = config_.authn.delegated_email_header;
            for (auto& c : del_header_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            for (auto& c : del_email_name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

            std::string remote_user_hdr = std::string(req->getHeader(del_header_name));
            std::string remote_email_hdr = std::string(req->getHeader(del_email_name));

            // Query parameter fallback (?token= or ?access_token=)
            if (auth_hdr.empty()) {
                std::string token_param = std::string(req->getQuery("token"));
                if (token_param.empty()) {
                    token_param = std::string(req->getQuery("access_token"));
                }
                if (!token_param.empty()) {
                    auth_hdr = "Bearer " + token_param;
                }
            }

            // Sec-WebSocket-Protocol fallback (e.g. "bearer, <token>")
            if (auth_hdr.empty() && !sec_proto.empty()) {
                auto comma_pos = sec_proto.find(',');
                if (comma_pos != std::string::npos) {
                    std::string sub1 = sec_proto.substr(0, comma_pos);
                    std::string sub2 = sec_proto.substr(comma_pos + 1);
                    auto trim = [](std::string s) {
                        while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
                        while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
                        return s;
                    };
                    sub1 = trim(sub1);
                    sub2 = trim(sub2);
                    if (sub1 == "bearer" && !sub2.empty()) {
                        auth_hdr = "Bearer " + sub2;
                    } else if (!sub1.empty()) {
                        auth_hdr = "Bearer " + sub1;
                    }
                } else if (sec_proto.rfind("bearer ", 0) == 0) {
                    auth_hdr = "Bearer " + sec_proto.substr(7);
                } else if (sec_proto != "bearer") {
                    auth_hdr = "Bearer " + sec_proto;
                }
            }

            auto auth_res = authenticate_request(auth_hdr, cookie_hdr, remote_user_hdr, remote_email_hdr, make_header_lookup(req));
            if (!auth_res.has_value() || !auth_res.value().has_value()) {
                res->writeStatus("401 Unauthorized");
                res->writeHeader("Content-Type", "application/json");
                res->end(nlohmann::json{
                    {"error", "Unauthorized"},
                    {"message", "Authentication required for collaborative session"}
                }.dump());
                return;
            }

            auto user = *auth_res.value();

            // Load document room if not loaded
            auto room = room_manager_->get_room(doc_id);
            std::string fs_path;
            if (!room) {
                auto doc_res = document_service_->get_document_by_id(doc_id, user);
                if (!doc_res.has_value()) {
                    if (doc_res.error() == ErrorCode::PermissionDenied) {
                        res->writeStatus("403 Forbidden");
                        res->writeHeader("Content-Type", "application/json");
                        res->end(nlohmann::json{
                            {"error", "Forbidden"},
                            {"message", "Insufficient permissions for collaborative document room"}
                        }.dump());
                        return;
                    }
                    res->writeStatus("404 Not Found");
                    res->writeHeader("Content-Type", "application/json");
                    res->end(nlohmann::json{
                        {"error", "NotFound"},
                        {"message", "Document does not exist"}
                    }.dump());
                    return;
                }
                fs_path = doc_res->path;
                std::vector<uint8_t> crdt_state;
                if (storage_) {
                    auto crdt_res = storage_->load_crdt_state(doc_id);
                    if (crdt_res.has_value()) {
                        crdt_state = std::move(*crdt_res);
                    }
                }
                room = room_manager_->get_or_create_room(doc_id, doc_res->content, fs_path, crdt_state);
                if (crdt_state.empty() && storage_ && !doc_res->content.empty()) {
                    auto init_bytes = room->compute_sync_step2({});
                    storage_->save_crdt_state(doc_id, init_bytes);
                }
            } else {
                fs_path = room->fs_path();
            }

            room->set_pending_connection(true);

            // Check permissions
            auto access_res = evaluate_access(user, doc_id, fs_path);
            if (!access_res.has_value() || access_res.value() == db::AccessLevel::None) {
                res->writeStatus("403 Forbidden");
                res->writeHeader("Content-Type", "application/json");
                res->end(nlohmann::json{
                    {"error", "Forbidden"},
                    {"message", "Insufficient permissions for collaborative document room"}
                }.dump());
                return;
            }

            db::AccessLevel access_lvl = access_res.value();

            collab::CollabSocketData socket_data{
                .document_id = doc_id,
                .topic = "room:" + doc_id,
                .client_id = auth::generate_random_token(16),
                .user_id = user.user_id,
                .username = user.username,
                .display_name = user.display_name.empty() ? user.username : user.display_name,
                .avatar_color = user.avatar_color.empty() ? "#3b82f6" : user.avatar_color,
                .is_authenticated = true,
                .is_admin = user.is_system_admin,
                .access_level = access_lvl,
                .fs_path = fs_path
            };

            res->template upgrade<collab::CollabSocketData>(
                std::move(socket_data),
                sec_key,
                sec_proto,
                sec_ext,
                context
            );
        },
        .open = [this](auto *ws) {
            auto *data = ws->getUserData();
            if (!data) return;

            ws->subscribe(data->topic);

            auto room = room_manager_->get_room(data->document_id);
            if (!room) {
                std::string resolved_path = data->fs_path;
                if (resolved_path.empty() && db_pool_) {
                    try {
                        auto conn_res = db_pool_->acquire();
                        if (conn_res.has_value()) {
                            pqxx::work tx(conn_res->get());
                            auto r = tx.exec_params(
                                "SELECT fs_path FROM documents WHERE id = $1::uuid;",
                                data->document_id
                            );
                            if (!r.empty() && !r[0][0].is_null()) {
                                resolved_path = std::string(r[0][0].c_str());
                            }
                        }
                    } catch (...) {}
                }

                if (resolved_path.empty()) {
                    std::cerr << "[ERROR] Cannot open collaborative room " << data->document_id
                              << ": missing fs_path. Closing socket.\n";
                    ws->close();
                    return;
                }

                std::string initial_content;
                if (storage_) {
                    bool is_bundle = storage_->is_bundle(resolved_path).value_or(false);
                    std::string content_file = is_bundle ? (resolved_path + "/index.md") : resolved_path;
                    auto read_res = storage_->read_file(content_file);
                    if (read_res.has_value()) {
                        initial_content = std::move(*read_res);
                    }
                }

                std::vector<uint8_t> crdt_state;
                if (storage_) {
                    auto crdt_res = storage_->load_crdt_state(data->document_id);
                    if (crdt_res.has_value()) {
                        crdt_state = std::move(*crdt_res);
                    }
                }
                room = room_manager_->get_or_create_room(data->document_id, initial_content, resolved_path, crdt_state);
            } else if (room->fs_path().empty() && !data->fs_path.empty()) {
                room->set_fs_path(data->fs_path);
            }

            room->add_peer(data->client_id, data->username, data->display_name, data->avatar_color);

            // Phase 1 (Sync Handshake): Server sends its current state vector (SyncStep1) to client
            auto sv = room->get_state_vector();
            std::string frame;
            frame.reserve(2 + sv.size());
            frame.push_back('\x00'); // CRDT Sync
            frame.push_back('\x01'); // SyncStep1
            frame.append(reinterpret_cast<const char*>(sv.data()), sv.size());
            ws->send(frame, uWS::OpCode::BINARY);
        },
        .message = [this](auto *ws, std::string_view msg, uWS::OpCode opCode) {
            (void)opCode;
            if (msg.empty()) return;
            auto *data = ws->getUserData();
            if (!data) return;

            uint8_t opcode = static_cast<uint8_t>(msg[0]);
            std::string_view payload = msg.substr(1);

            auto room = room_manager_->get_room(data->document_id);
            if (!room) {
                std::string resolved_path = data->fs_path;
                if (resolved_path.empty() && db_pool_) {
                    try {
                        auto conn_res = db_pool_->acquire();
                        if (conn_res.has_value()) {
                            pqxx::work tx(conn_res->get());
                            auto r = tx.exec_params(
                                "SELECT fs_path FROM documents WHERE id = $1::uuid;",
                                data->document_id
                            );
                            if (!r.empty() && !r[0][0].is_null()) {
                                resolved_path = std::string(r[0][0].c_str());
                            }
                        }
                    } catch (...) {}
                }

                if (resolved_path.empty()) {
                    std::cerr << "[ERROR] Cannot process message for room " << data->document_id
                              << ": missing fs_path. Closing socket.\n";
                    ws->close();
                    return;
                }

                std::string initial_content;
                if (storage_) {
                    bool is_bundle = storage_->is_bundle(resolved_path).value_or(false);
                    std::string content_file = is_bundle ? (resolved_path + "/index.md") : resolved_path;
                    auto read_res = storage_->read_file(content_file);
                    if (read_res.has_value()) {
                        initial_content = std::move(*read_res);
                    }
                }

                std::vector<uint8_t> crdt_state;
                if (storage_) {
                    auto crdt_res = storage_->load_crdt_state(data->document_id);
                    if (crdt_res.has_value()) {
                        crdt_state = std::move(*crdt_res);
                    }
                }
                room = room_manager_->get_or_create_room(data->document_id, initial_content, resolved_path, crdt_state);
            } else if (room->fs_path().empty() && !data->fs_path.empty()) {
                room->set_fs_path(data->fs_path);
            }

            switch (opcode) {
                case 0x00: { // 0x00: CRDT Synchronization (Yjs Wire Format)
                    if (payload.empty()) return;
                    uint8_t subtype = static_cast<uint8_t>(payload[0]);
                    std::string_view sub_payload = payload.substr(1);

                    switch (subtype) {
                        case 0x01: { // Subtype 0x01: SyncStep1 (Client transmits local state vector)
                            std::span<const uint8_t> remote_sv(
                                reinterpret_cast<const uint8_t*>(sub_payload.data()),
                                sub_payload.size()
                            );
                            auto diff = room->compute_sync_step2(remote_sv);
                            std::string reply;
                            reply.reserve(2 + diff.size());
                            reply.push_back('\x00');
                            reply.push_back('\x02'); // SyncStep2
                            reply.append(reinterpret_cast<const char*>(diff.data()), diff.size());
                            ws->send(reply, uWS::OpCode::BINARY);
                            break;
                        }
                        case 0x02: { // Subtype 0x02: SyncStep2 (Client returns missing document updates)
                            if (is_backup_barrier_active()) {
                                if (data->access_level >= db::AccessLevel::Edit || data->is_admin) {
                                    std::lock_guard lock(barrier_queue_mutex_);
                                    barrier_update_queue_.push_back({
                                        .document_id = data->document_id,
                                        .topic = data->topic,
                                        .subtype = 0x02,
                                        .update_data = std::string(sub_payload)
                                    });
                                }
                                break;
                            }
                            if (data->access_level >= db::AccessLevel::Edit || data->is_admin) {
                                std::span<const uint8_t> update_data(
                                    reinterpret_cast<const uint8_t*>(sub_payload.data()),
                                    sub_payload.size()
                                );
                                auto apply_res = room->apply_client_update(update_data);
                                if (apply_res.has_value()) {
                                    if (room->is_dirty()) {
                                        std::string broadcast_msg;
                                        broadcast_msg.reserve(2 + sub_payload.size());
                                        broadcast_msg.push_back('\x00');
                                        broadcast_msg.push_back('\x03'); // SyncUpdate
                                        broadcast_msg.append(sub_payload.data(), sub_payload.size());
                                        ws->publish(data->topic, broadcast_msg, uWS::OpCode::BINARY);
                                    } else {
                                        // Update was deduplicated; transmit authoritative room state back to client to reset client
                                        auto diff = room->compute_sync_step2({});
                                        std::string reply;
                                        reply.reserve(2 + diff.size());
                                        reply.push_back('\x00');
                                        reply.push_back('\x02'); // SyncStep2
                                        reply.append(reinterpret_cast<const char*>(diff.data()), diff.size());
                                        ws->send(reply, uWS::OpCode::BINARY);
                                    }
                                }
                            }
                            break;
                        }
                        case 0x03: { // Subtype 0x03: SyncUpdate (Incremental document edit delta)
                            if (is_backup_barrier_active()) {
                                if (data->access_level >= db::AccessLevel::Edit || data->is_admin) {
                                    std::lock_guard lock(barrier_queue_mutex_);
                                    barrier_update_queue_.push_back({
                                        .document_id = data->document_id,
                                        .topic = data->topic,
                                        .subtype = 0x03,
                                        .update_data = std::string(sub_payload)
                                    });
                                }
                                break;
                            }
                            if (data->access_level >= db::AccessLevel::Edit || data->is_admin) {
                                std::span<const uint8_t> update_data(
                                    reinterpret_cast<const uint8_t*>(sub_payload.data()),
                                    sub_payload.size()
                                );
                                auto apply_res = room->apply_client_update(update_data);
                                if (apply_res.has_value()) {
                                    if (room->is_dirty()) {
                                        ws->publish(data->topic, msg, uWS::OpCode::BINARY);
                                    } else {
                                        auto diff = room->compute_sync_step2({});
                                        std::string reply;
                                        reply.reserve(2 + diff.size());
                                        reply.push_back('\x00');
                                        reply.push_back('\x02'); // SyncStep2
                                        reply.append(reinterpret_cast<const char*>(diff.data()), diff.size());
                                        ws->send(reply, uWS::OpCode::BINARY);
                                    }
                                }
                            }
                            break;
                        }
                        default:
                            break;
                    }
                    break;
                }
                case 0x01: { // 0x01: Awareness and cursor coordinates
                    ws->publish(data->topic, msg, uWS::OpCode::BINARY);
                    break;
                }
                case 0x02: { // 0x02: Review event notifications
                    ws->publish(data->topic, msg, uWS::OpCode::BINARY);
                    break;
                }
                case 0x03: { // 0x03: Ping heartbeat
                    std::string pong;
                    pong.reserve(1 + payload.size());
                    pong.push_back('\x04'); // 0x04: Pong heartbeat
                    pong.append(payload.data(), payload.size());
                    ws->send(pong, uWS::OpCode::BINARY);
                    break;
                }
                case 0x04: { // 0x04: Pong heartbeat
                    break;
                }
                default:
                    break;
            }
        },
        .close = [&app, this](auto *ws, int code, std::string_view message) {
            (void)code;
            (void)message;
            auto *data = ws->getUserData();
            if (!data) return;

            auto room = room_manager_->get_room(data->document_id);
            if (room) {
                room->remove_peer(data->client_id);
            }

            nlohmann::json departure_payload = {
                {"type", "departure"},
                {"client_id", data->client_id},
                {"username", data->username}
            };
            std::string dep_msg;
            dep_msg.push_back('\x01');
            dep_msg.append(departure_payload.dump());
            app.publish(data->topic, dep_msg, uWS::OpCode::BINARY);
        }
    });

    // Embedded UI Static Asset & SPA Fallback Serving
    if (config_.ui.embedded && !config_.ui.dist_dir.empty()) {
        std::filesystem::path dist_root;
        std::error_code ec;
        if (std::filesystem::exists(config_.ui.dist_dir, ec)) {
            dist_root = std::filesystem::canonical(config_.ui.dist_dir, ec);
        } else {
            dist_root = std::filesystem::absolute(config_.ui.dist_dir);
        }

        app.get("/*", [this, dist_root](auto *res, auto *req) {
            std::string url(req->getUrl());

            // Never serve frontend HTML for unmatched API or WebSocket routes
            if (url.starts_with("/api/") || url.starts_with("/ws/")) {
                send_json(res, "404 Not Found", {{"error", "Not found"}, {"code", "NOT_FOUND"}});
                return;
            }

            std::string decoded = url_decode(url);
            std::filesystem::path rel_path = decoded;
            if (rel_path.is_absolute()) {
                rel_path = rel_path.relative_path();
            }

            std::filesystem::path target_file;
            std::error_code ec;

            if (decoded.empty() || decoded == "/") {
                target_file = dist_root / "index.html";
            } else {
                std::filesystem::path candidate = dist_root / rel_path;
                if (std::filesystem::exists(candidate, ec) && !std::filesystem::is_directory(candidate, ec)) {
                    target_file = candidate;
                } else if (candidate.has_extension() && candidate.extension() != ".html") {
                    // Explicit static asset requested but not found -> 404
                    res->writeStatus("404 Not Found");
                    write_cors_headers(res, req->getHeader("origin"));
                    res->end("Not Found");
                    return;
                } else {
                    // SPA route fallback (e.g. /tasks, /trash, /doc/:id) -> serve index.html
                    target_file = dist_root / "index.html";
                }
            }

            // Path traversal prevention: verify canonical target resides within dist_root
            auto canonical_target = std::filesystem::weakly_canonical(target_file, ec);
            auto root_str = dist_root.lexically_normal().string();
            auto target_str = canonical_target.lexically_normal().string();

            if (target_str.rfind(root_str, 0) != 0 || !std::filesystem::exists(canonical_target, ec)) {
                res->writeStatus("404 Not Found");
                write_cors_headers(res, req->getHeader("origin"));
                res->end("Not Found");
                return;
            }

            std::ifstream file(canonical_target, std::ios::binary);
            if (!file) {
                res->writeStatus("404 Not Found");
                write_cors_headers(res, req->getHeader("origin"));
                res->end("Not Found");
                return;
            }

            std::string body((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
            std::string_view content_type = get_mime_type(canonical_target);

            res->writeStatus("200 OK");
            write_cors_headers(res, req->getHeader("origin"));
            res->writeHeader("Content-Type", content_type);
            if (canonical_target.filename() == "index.html") {
                res->writeHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            } else {
                res->writeHeader("Cache-Control", "public, max-age=31536000, immutable");
            }
            res->end(body);
        });
    } else {
        app.get("/", [this](auto *res, auto *req) {
            (void)req;
            send_json(res, "200 OK", {
                {"name", "Collaborative Markdown Editor"},
                {"version", CME_VERSION_STRING},
                {"status", "running"}
            });
        });
    }

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

    uws_app_ = nullptr;
    return {};
}

void Server::stop() {
    if (is_running_.exchange(false)) {
        if (lease_manager_) {
            lease_manager_->stop();
        }
        if (persistence_worker_) {
            persistence_worker_->stop();
        }
        if (uws_loop_) {
            auto *loop = static_cast<uWS::Loop*>(uws_loop_);
            loop->defer([this]() {
                if (us_listen_socket_) {
                    us_listen_socket_close(0, static_cast<struct us_listen_socket_t*>(us_listen_socket_));
                    us_listen_socket_ = nullptr;
                }
                if (uws_app_) {
                    auto *app = static_cast<uWS::App*>(uws_app_);
                    app->close();
                }
            });
        }
    }
}

void Server::broadcast_review_event(const std::string& document_id, const nlohmann::json& payload) {
    std::string msg;
    msg.push_back('\x02'); // Opcode 0x02: Review event
    msg.append(payload.dump());
    broadcast_to_room(document_id, msg, true);
}

void Server::broadcast_to_room(const std::string& document_id, std::string_view message, bool binary) {
    if (!uws_app_ || !uws_loop_) return;
    auto* loop = static_cast<uWS::Loop*>(uws_loop_);
    auto* app = static_cast<uWS::App*>(uws_app_);
    std::string topic = "room:" + document_id;
    std::string msg_copy(message);
    loop->defer([app, topic = std::move(topic), msg = std::move(msg_copy), binary]() {
        app->publish(topic, msg, binary ? uWS::OpCode::BINARY : uWS::OpCode::TEXT);
    });
}

} // namespace cme::server
