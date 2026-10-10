#include "cme/server/server.hpp"
#include "cme/version.hpp"
#include <uWebSockets/App.h>
#include <libusockets.h>
#include <iostream>
#include <filesystem>
#include <chrono>

namespace cme::server {

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

    // 3. Configure uWebSockets App
    uWS::App app;

    // Store loop pointer for shutdown signaling
    uws_loop_ = uWS::Loop::get();

    // GET /api/v1/health
    app.get("/api/v1/health", [this](auto *res, auto *req) {
        (void)req;
        res->writeHeader("Content-Type", "application/json");
        res->writeHeader("Access-Control-Allow-Origin", "*");

        nlohmann::json health = get_health_status();
        std::string payload = health.dump(2);

        // If degraded, respond with 503 Service Unavailable, otherwise 200 OK
        if (health["status"] == "healthy") {
            res->writeStatus("200 OK");
        } else {
            res->writeStatus("503 Service Unavailable");
        }

        res->end(payload);
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
