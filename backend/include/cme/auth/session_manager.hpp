/**
 * @file session_manager.hpp
 * @brief User session lifecycle and Personal Access Token (PAT) management.
 */

#pragma once

#include <string>
#include <vector>
#include <optional>
#include <memory>
#include <nlohmann/json.hpp>
#include "cme/common.hpp"
#include "cme/auth/user_identity.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/db/connection_pool.hpp"

namespace cme::auth {

/**
 * @struct SessionRecord
 * @brief Contains freshly issued session credentials and metadata.
 */
struct SessionRecord {
    std::string raw_token;      ///< Plain text secret returned to client.
    std::string token_hash;     ///< SHA-256 digest persisted in the sessions table.
    std::string user_id;        ///< UUID of the authenticated user.
    std::string expires_at;     ///< ISO-8601 formatted expiration timestamp.
};

/**
 * @struct SessionInfo
 * @brief Read-only session metadata for listing active tokens.
 */
struct SessionInfo {
    std::string token_hash;
    std::string created_at;
    std::string expires_at;
    std::string ip_address;
    std::string user_agent;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"token_hash", token_hash},
            {"created_at", created_at},
            {"expires_at", expires_at},
            {"ip_address", ip_address},
            {"user_agent", user_agent}
        };
    }
};

/**
 * @class SessionManager
 * @brief Coordinates session issuance, validation, and revocation backed by PostgreSQL.
 */
class SessionManager {
public:
    SessionManager(
        std::shared_ptr<db::ConnectionPool> pool,
        std::shared_ptr<IAdminProvider> admin_provider = nullptr
    );

    /**
     * @brief Generates and persists a new session token.
     * @param user_id UUID string of the target user.
     * @param ttl_hours Session lifetime in hours (default: 72).
     * @param ip_address Remote IP address.
     * @param user_agent Client User-Agent header.
     * @return Result<SessionRecord> Fresh token record or error.
     */
    Result<SessionRecord> create_session(
        const std::string& user_id,
        int ttl_hours = 72,
        const std::string& ip_address = "",
        const std::string& user_agent = ""
    );

    /**
     * @brief Validates a raw session token and resolves the user identity.
     * @param raw_token Plain-text token string.
     * @return Result<std::optional<UserIdentity>> Resolved identity or nullopt if expired/invalid.
     */
    Result<std::optional<UserIdentity>> validate_token(const std::string& raw_token);

    /**
     * @brief Revokes a session token from the database.
     * @param raw_token Plain-text token string.
     * @return Result<bool> True if deleted, false if not found.
     */
    Result<bool> revoke_session(const std::string& raw_token);

    /**
     * @brief Lists all unexpired sessions for a user.
     * @param user_id UUID string of the user.
     * @return Result<std::vector<SessionInfo>> Active sessions list.
     */
    Result<std::vector<SessionInfo>> list_user_sessions(const std::string& user_id);

private:
    std::shared_ptr<db::ConnectionPool> pool_;
    std::shared_ptr<IAdminProvider> admin_provider_;
};

} // namespace cme::auth
