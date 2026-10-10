/**
 * @file server.hpp
 * @brief Core server daemon managing uWebSockets networking, REST endpoints, and subsystems.
 */

#pragma once

#include "cme/config/config.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include <nlohmann/json.hpp>
#include <memory>
#include <atomic>
#include <chrono>

namespace usockets {
struct us_listen_socket_t;
}

namespace cme::server {

/**
 * @class Server
 * @brief High-performance multi-threaded C++23 server daemon for CME.
 */
class Server {
public:
    explicit Server(config::AppConfig config);
    ~Server();

    /**
     * @brief Initializes subsystems and binds HTTP/WebSocket listeners.
     * Blocks on the event loop until stop() is invoked or a shutdown signal is caught.
     * 
     * @return Result<void> Success or ErrorCode (IoError, DatabaseError).
     */
    Result<void> start();

    /**
     * @brief Requests graceful termination of the event loop and active listeners.
     */
    void stop();

    /**
     * @brief Assembles operational health metrics for the /api/v1/health endpoint.
     * @return JSON object with status, database connectivity/latency, and storage metrics.
     */
    [[nodiscard]] nlohmann::json get_health_status();

    [[nodiscard]] const config::AppConfig& config() const noexcept { return config_; }

private:
    config::AppConfig config_;
    std::shared_ptr<db::ConnectionPool> db_pool_;
    std::shared_ptr<storage::PosixStorageBackend> storage_;

    std::chrono::system_clock::time_point start_time_;
    std::atomic<bool> is_running_{false};
    void* us_listen_socket_{nullptr};
    void* uws_loop_{nullptr};
};

} // namespace cme::server
