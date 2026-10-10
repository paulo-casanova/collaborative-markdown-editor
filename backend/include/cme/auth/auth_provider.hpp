/**
 * @file auth_provider.hpp
 * @brief Pluggable authentication providers (Challenge and Delegated).
 */

#pragma once

#include <string>
#include <string_view>
#include <optional>
#include <memory>
#include "cme/common.hpp"
#include "cme/auth/user_identity.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/db/connection_pool.hpp"

namespace cme::auth {

/**
 * @class IAuthProvider
 * @brief Base interface for pluggable authentication strategies.
 */
class IAuthProvider {
public:
    virtual ~IAuthProvider() = default;

    /**
     * @brief Identifier for this authentication provider ("challenge", "delegated", etc.).
     */
    [[nodiscard]] virtual std::string_view name() const noexcept = 0;
};

/**
 * @class DelegatedAuthProvider
 * @brief Authenticates users via trusted HTTP reverse proxy headers (e.g., X-Remote-User).
 * Automatically provisions users Just-In-Time (JIT) if they do not yet exist in PostgreSQL.
 */
class DelegatedAuthProvider : public IAuthProvider {
public:
    DelegatedAuthProvider(
        std::shared_ptr<db::ConnectionPool> pool,
        std::shared_ptr<IAdminProvider> admin_provider = nullptr,
        std::string delegated_header = "x-remote-user",
        std::string delegated_email_header = "x-remote-email"
    );

    [[nodiscard]] std::string_view name() const noexcept override { return "delegated"; }

    /**
     * @brief Authenticates a request via remote user and optional remote email header values.
     * @param remote_user Value of X-Remote-User header.
     * @param remote_email Value of X-Remote-Email header (optional).
     * @return Result<std::optional<UserIdentity>> User identity, or nullopt if header empty.
     */
    Result<std::optional<UserIdentity>> authenticate(
        const std::string& remote_user,
        const std::string& remote_email = ""
    );

    [[nodiscard]] const std::string& delegated_header() const noexcept { return delegated_header_; }
    [[nodiscard]] const std::string& delegated_email_header() const noexcept { return delegated_email_header_; }

private:
    std::shared_ptr<db::ConnectionPool> pool_;
    std::shared_ptr<IAdminProvider> admin_provider_;
    std::string delegated_header_;
    std::string delegated_email_header_;
};

/**
 * @class ChallengeAuthProvider
 * @brief Authenticates users via username and bcrypt-hashed password credentials.
 */
class ChallengeAuthProvider : public IAuthProvider {
public:
    ChallengeAuthProvider(
        std::shared_ptr<db::ConnectionPool> pool,
        std::shared_ptr<IAdminProvider> admin_provider = nullptr
    );

    [[nodiscard]] std::string_view name() const noexcept override { return "challenge"; }

    /**
     * @brief Verifies plain-text credentials against stored bcrypt password hashes.
     * @param username Candidate username.
     * @param password Candidate plain-text password.
     * @return Result<std::optional<UserIdentity>> User identity, or nullopt on mismatch.
     */
    Result<std::optional<UserIdentity>> authenticate_credentials(
        const std::string& username,
        const std::string& password
    );

private:
    std::shared_ptr<db::ConnectionPool> pool_;
    std::shared_ptr<IAdminProvider> admin_provider_;
};

} // namespace cme::auth
