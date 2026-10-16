/**
 * @file server.hpp
 * @brief Core server daemon managing uWebSockets networking, REST endpoints, and subsystems.
 */

#pragma once

#include "cme/config/config.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/permission_engine.hpp"
#include "cme/storage/storage_backend.hpp"
#include "cme/auth/user_identity.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/auth/auth_provider.hpp"
#include "cme/document/document_service.hpp"
#include "cme/admin/admin_service.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/collab/collab_socket_data.hpp"
#include "cme/collab/persistence_worker.hpp"
#include "cme/review/review_service.hpp"
#include <nlohmann/json.hpp>
#include <memory>
#include <atomic>
#include <chrono>
#include <string_view>
#include <optional>
#include <functional>
#include <unordered_map>
#include <cctype>

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

    /**
     * @brief Authenticates an incoming request using session tokens or delegated headers.
     * @param auth_header Authorization header value.
     * @param cookie_header Cookie header value.
     * @param remote_user_header X-Remote-User header value.
     * @param remote_email_header X-Remote-Email header value.
     * @return Resolved UserIdentity if authenticated, or nullopt otherwise.
     */
    Result<std::optional<auth::UserIdentity>> authenticate_request(
        std::string_view auth_header,
        std::string_view cookie_header,
        std::string_view remote_user_header,
        std::string_view remote_email_header,
        std::function<std::string(std::string_view)> header_lookup = nullptr
    );

    /**
     * @brief Evaluates whether an authenticated user has sufficient access level for a resource.
     * Checks superuser admin bypass first, then evaluates DAG permissions.
     */
    Result<db::AccessLevel> evaluate_access(
        const auth::UserIdentity& user,
        const std::string& document_id,
        const std::string& fs_path
    );

    /**
     * @brief Broadcasts a review event to all peers connected to a document room.
     */
    void broadcast_review_event(const std::string& document_id, const nlohmann::json& payload);

    /**
     * @brief Broadcasts an arbitrary binary or text message to all peers connected to a document room.
     */
    void broadcast_to_room(const std::string& document_id, std::string_view message, bool binary = true);

    [[nodiscard]] const config::AppConfig& config() const noexcept { return config_; }
    [[nodiscard]] std::shared_ptr<db::ConnectionPool> db_pool() const noexcept { return db_pool_; }
    [[nodiscard]] std::shared_ptr<storage::IStorageBackend> storage() const noexcept { return storage_; }
    [[nodiscard]] std::shared_ptr<auth::IAdminProvider> admin_provider() const noexcept { return admin_provider_; }
    [[nodiscard]] std::shared_ptr<auth::SessionManager> session_manager() const noexcept { return session_manager_; }
    [[nodiscard]] std::shared_ptr<auth::DelegatedAuthProvider> delegated_provider() const noexcept { return delegated_provider_; }
    [[nodiscard]] std::shared_ptr<auth::ChallengeAuthProvider> challenge_provider() const noexcept { return challenge_provider_; }
    [[nodiscard]] std::shared_ptr<document::DocumentService> document_service() const noexcept { return document_service_; }
    [[nodiscard]] std::shared_ptr<admin::UserService> user_service() const noexcept { return user_service_; }
    [[nodiscard]] std::shared_ptr<admin::TeamService> team_service() const noexcept { return team_service_; }
    [[nodiscard]] std::shared_ptr<collab::RoomManager> room_manager() const noexcept { return room_manager_; }
    [[nodiscard]] std::shared_ptr<collab::PersistenceWorker> persistence_worker() const noexcept { return persistence_worker_; }
    [[nodiscard]] std::shared_ptr<review::ReviewService> review_service() const noexcept { return review_service_; }
    void set_persistence_config(collab::PersistenceConfig config) noexcept { persistence_config_ = config; }
    [[nodiscard]] const collab::PersistenceConfig& persistence_config() const noexcept { return persistence_config_; }

    /**
     * @brief Prepares for atomic backup: flushes dirty collaborative rooms to disk and activates write barrier.
     * @return Number of rooms flushed.
     */
    size_t prepare_backup();

    /**
     * @brief Releases the backup coordination barrier and resumes normal write mutations.
     */
    void release_backup();

    [[nodiscard]] bool is_backup_barrier_active() const noexcept { return backup_barrier_active_.load(); }

    /**
     * @brief Writes CORS response headers according to config_.server.cors_allowed_origins.
     * If cors_allowed_origins is empty, CORS is disabled and no headers are written.
     * Note: X-Remote-User and X-Remote-Email are NEVER advertised in CORS headers.
     */
    template <typename ResT>
    void write_cors_headers(ResT* res, std::string_view req_origin = "") const {
        const auto& allowed = config_.server.cors_allowed_origins;
        if (allowed.empty()) {
            return;
        }

        bool has_wildcard = false;
        for (const auto& o : allowed) {
            if (o == "*") {
                has_wildcard = true;
                break;
            }
        }

        if (has_wildcard) {
            res->writeHeader("Access-Control-Allow-Origin", "*");
            res->writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Asset-Filename, X-File-Path");
            res->writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
            return;
        }

        if (!req_origin.empty()) {
            for (const auto& o : allowed) {
                if (o == req_origin) {
                    res->writeHeader("Access-Control-Allow-Origin", req_origin);
                    res->writeHeader("Access-Control-Allow-Credentials", "true");
                    res->writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Asset-Filename, X-File-Path");
                    res->writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
                    res->writeHeader("Vary", "Origin");
                    return;
                }
            }
        } else if (allowed.size() == 1) {
            res->writeHeader("Access-Control-Allow-Origin", allowed[0]);
            res->writeHeader("Access-Control-Allow-Credentials", "true");
            res->writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Asset-Filename, X-File-Path");
            res->writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
            res->writeHeader("Vary", "Origin");
        }
    }

    template <typename ResT>
    void send_json(
        ResT* res,
        std::string_view status,
        const nlohmann::json& payload,
        const std::vector<std::pair<std::string, std::string>>& extra_headers = {},
        std::string_view req_origin = ""
    ) const {
        res->writeStatus(status);
        write_cors_headers(res, req_origin);
        res->writeHeader("Content-Type", "application/json");
        for (const auto& [name, val] : extra_headers) {
            res->writeHeader(name, val);
        }
        res->end(payload.dump(2));
    }

    template <typename ResT>
    void send_html(
        ResT* res,
        std::string_view status,
        const std::string& html_body,
        std::string_view req_origin = ""
    ) const {
        res->writeStatus(status);
        write_cors_headers(res, req_origin);
        res->writeHeader("Content-Type", "text/html; charset=utf-8");
        res->end(html_body);
    }

private:
    config::AppConfig config_;
    std::atomic<bool> backup_barrier_active_{false};
    collab::PersistenceConfig persistence_config_{};
    std::shared_ptr<db::ConnectionPool> db_pool_;
    std::shared_ptr<storage::IStorageBackend> storage_;
    std::shared_ptr<auth::IAdminProvider> admin_provider_;
    std::shared_ptr<auth::SessionManager> session_manager_;
    std::shared_ptr<auth::DelegatedAuthProvider> delegated_provider_;
    std::shared_ptr<auth::ChallengeAuthProvider> challenge_provider_;
    std::shared_ptr<document::DocumentService> document_service_;
    std::shared_ptr<admin::UserService> user_service_;
    std::shared_ptr<admin::TeamService> team_service_;
    std::shared_ptr<collab::RoomManager> room_manager_;
    std::shared_ptr<collab::PersistenceWorker> persistence_worker_;
    std::shared_ptr<review::ReviewService> review_service_;

    std::chrono::system_clock::time_point start_time_;
    std::atomic<bool> is_running_{false};
    void* us_listen_socket_{nullptr};
    void* uws_loop_{nullptr};
    void* uws_app_{nullptr};

    template <typename ReqT>
    static std::function<std::string(std::string_view)> make_header_lookup(ReqT* req) {
        if (!req) {
            return [](std::string_view) -> std::string { return {}; };
        }
        std::unordered_map<std::string, std::string> headers;
        for (auto [key, val] : *req) {
            std::string lk(key);
            for (auto& c : lk) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            headers.try_emplace(std::move(lk), std::string(val));
        }
        return [headers = std::move(headers)](std::string_view h) -> std::string {
            std::string lh(h);
            for (auto& c : lh) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            auto it = headers.find(lh);
            if (it != headers.end()) {
                return it->second;
            }
            return {};
        };
    }
};

} // namespace cme::server
