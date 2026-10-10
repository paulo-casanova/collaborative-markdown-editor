#include "cme/auth/auth_provider.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <iostream>
#include <algorithm>
#include <cctype>

namespace cme::auth {

namespace {

std::string trim_str(std::string_view sv) {
    while (!sv.empty() && std::isspace(static_cast<unsigned char>(sv.front()))) {
        sv.remove_prefix(1);
    }
    while (!sv.empty() && std::isspace(static_cast<unsigned char>(sv.back()))) {
        sv.remove_suffix(1);
    }
    return std::string(sv);
}

} // namespace

// =============================================================================
// DelegatedAuthProvider Implementation
// =============================================================================

DelegatedAuthProvider::DelegatedAuthProvider(
    std::shared_ptr<db::ConnectionPool> pool,
    std::shared_ptr<IAdminProvider> admin_provider,
    std::string delegated_header,
    std::string delegated_email_header
) : pool_(std::move(pool)),
    admin_provider_(std::move(admin_provider)),
    delegated_header_(std::move(delegated_header)),
    delegated_email_header_(std::move(delegated_email_header)) {}

Result<std::optional<UserIdentity>> DelegatedAuthProvider::authenticate(
    const std::string& remote_user,
    const std::string& remote_email
) {
    std::string username = trim_str(remote_user);
    if (username.empty() || !pool_) {
        return std::nullopt;
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string email = trim_str(remote_email);
    std::string display = email.empty() ? username : email;

    try {
        pqxx::work tx(conn_res->get());

        // Check if user already exists
        auto sel_rows = tx.exec_params(
            "SELECT id, username, display_name, avatar_color, is_system_admin "
            "FROM users WHERE username = $1;",
            username
        );

        UserIdentity identity;
        if (!sel_rows.empty()) {
            auto r = sel_rows[0];
            identity.user_id = r[0].as<std::string>();
            identity.username = r[1].as<std::string>();
            identity.display_name = r[2].as<std::string>();
            identity.avatar_color = r[3].as<std::string>();
            identity.is_system_admin = r[4].as<bool>();
        } else {
            // Just-In-Time (JIT) Provisioning
            auto ins_rows = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ($1, '!', $2, '#3b82f6', FALSE) "
                "ON CONFLICT (username) DO UPDATE SET updated_at = NOW() "
                "RETURNING id, username, display_name, avatar_color, is_system_admin;",
                username,
                display
            );

            if (ins_rows.empty()) {
                return std::unexpected(ErrorCode::DatabaseError);
            }

            auto r = ins_rows[0];
            identity.user_id = r[0].as<std::string>();
            identity.username = r[1].as<std::string>();
            identity.display_name = r[2].as<std::string>();
            identity.avatar_color = r[3].as<std::string>();
            identity.is_system_admin = r[4].as<bool>();
        }

        tx.commit();

        if (admin_provider_ && admin_provider_->is_admin(identity.username)) {
            identity.is_system_admin = true;
        }

        return identity;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] DelegatedAuthProvider::authenticate failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

// =============================================================================
// ChallengeAuthProvider Implementation
// =============================================================================

ChallengeAuthProvider::ChallengeAuthProvider(
    std::shared_ptr<db::ConnectionPool> pool,
    std::shared_ptr<IAdminProvider> admin_provider
) : pool_(std::move(pool)),
    admin_provider_(std::move(admin_provider)) {}

Result<std::optional<UserIdentity>> ChallengeAuthProvider::authenticate_credentials(
    const std::string& username,
    const std::string& password
) {
    std::string user = trim_str(username);
    if (user.empty() || password.empty() || !pool_) {
        return std::nullopt;
    }

    auto conn_res = pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());

        auto rows = tx.exec_params(
            "SELECT id, username, password_hash, display_name, avatar_color, is_system_admin "
            "FROM users WHERE username = $1;",
            user
        );

        if (rows.empty()) {
            return std::nullopt;
        }

        auto r = rows[0];
        std::string stored_hash = r[2].as<std::string>();

        if (!verify_password_bcrypt(password, stored_hash)) {
            return std::nullopt;
        }

        UserIdentity identity{
            .user_id = r[0].as<std::string>(),
            .username = r[1].as<std::string>(),
            .display_name = r[3].as<std::string>(),
            .avatar_color = r[4].as<std::string>(),
            .is_system_admin = r[5].as<bool>()
        };

        if (admin_provider_ && admin_provider_->is_admin(identity.username)) {
            identity.is_system_admin = true;
        }

        return identity;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ChallengeAuthProvider::authenticate_credentials failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::auth
