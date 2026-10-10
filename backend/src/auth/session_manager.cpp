#include "cme/auth/session_manager.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <iostream>
#include <algorithm>
#include <cctype>

namespace cme::auth {

namespace {

bool is_probably_valid_ip(std::string_view ip) {
    if (ip.empty() || ip.size() > 45) return false;
    bool has_dot_or_colon = false;
    for (char c : ip) {
        if (c == '.' || c == ':') {
            has_dot_or_colon = true;
        } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
            return false;
        }
    }
    return has_dot_or_colon;
}

} // namespace

SessionManager::SessionManager(
    std::shared_ptr<db::ConnectionPool> pool,
    std::shared_ptr<IAdminProvider> admin_provider
) : pool_(std::move(pool)),
    admin_provider_(std::move(admin_provider)) {}

Result<SessionRecord> SessionManager::create_session(
    const std::string& user_id,
    int ttl_hours,
    const std::string& ip_address,
    const std::string& user_agent
) {
    if (!pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    if (ttl_hours <= 0) {
        ttl_hours = 72;
    }

    std::string raw_token = generate_random_token(32);
    std::string token_hash = sha256_hex(raw_token);

    std::string safe_ip = is_probably_valid_ip(ip_address) ? ip_address : "";

    try {
        pqxx::work tx(conn_res->get());

        std::string query =
            "INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, expires_at) "
            "VALUES ($1, $2, (CASE WHEN $3 = '' THEN NULL ELSE $3::inet END), $4, "
            "NOW() + ($5 || ' hours')::interval) "
            "RETURNING TO_CHAR(expires_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');";

        auto row = tx.exec_params(
            query,
            token_hash,
            user_id,
            safe_ip,
            user_agent,
            std::to_string(ttl_hours)
        );

        if (row.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        std::string expires_at = row[0][0].as<std::string>();
        tx.commit();

        return SessionRecord{
            .raw_token = raw_token,
            .token_hash = token_hash,
            .user_id = user_id,
            .expires_at = expires_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] SessionManager::create_session failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::optional<UserIdentity>> SessionManager::validate_token(const std::string& raw_token) {
    if (raw_token.empty() || !pool_) {
        return std::nullopt;
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string token_hash = sha256_hex(raw_token);

    try {
        pqxx::read_transaction tx(conn_res->get());

        std::string query =
            "SELECT u.id, u.username, u.display_name, u.avatar_color, u.is_system_admin "
            "FROM sessions s "
            "JOIN users u ON s.user_id = u.id "
            "WHERE s.token_hash = $1 AND s.expires_at > NOW();";

        auto rows = tx.exec_params(query, token_hash);
        if (rows.empty()) {
            return std::nullopt;
        }

        auto r = rows[0];
        UserIdentity identity{
            .user_id = r[0].as<std::string>(),
            .username = r[1].as<std::string>(),
            .display_name = r[2].as<std::string>(),
            .avatar_color = r[3].as<std::string>(),
            .is_system_admin = r[4].as<bool>()
        };

        if (admin_provider_ && admin_provider_->is_admin(identity.username)) {
            identity.is_system_admin = true;
        }

        return identity;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] SessionManager::validate_token failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<bool> SessionManager::revoke_session(const std::string& raw_token) {
    if (raw_token.empty() || !pool_) {
        return false;
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string token_hash = sha256_hex(raw_token);

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params("DELETE FROM sessions WHERE token_hash = $1;", token_hash);
        tx.commit();
        return res.affected_rows() > 0;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] SessionManager::revoke_session failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<SessionInfo>> SessionManager::list_user_sessions(const std::string& user_id) {
    if (!pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());

        std::string query =
            "SELECT token_hash, "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, "
            "       TO_CHAR(expires_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS expires_at, "
            "       COALESCE(HOST(ip_address), '') AS ip_address, "
            "       COALESCE(user_agent, '') AS user_agent "
            "FROM sessions "
            "WHERE user_id = $1 AND expires_at > NOW() "
            "ORDER BY created_at DESC;";

        auto rows = tx.exec_params(query, user_id);
        std::vector<SessionInfo> list;
        list.reserve(static_cast<size_t>(rows.size()));

        for (const auto& r : rows) {
            list.push_back(SessionInfo{
                .token_hash = r[0].as<std::string>(),
                .created_at = r[1].as<std::string>(),
                .expires_at = r[2].as<std::string>(),
                .ip_address = r[3].as<std::string>(),
                .user_agent = r[4].as<std::string>()
            });
        }

        return list;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] SessionManager::list_user_sessions failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::auth
