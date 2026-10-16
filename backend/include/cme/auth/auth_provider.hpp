/**
 * @file auth_provider.hpp
 * @brief Pluggable authentication providers (Challenge and Delegated).
 */

#pragma once

#include <string>
#include <string_view>
#include <optional>
#include <memory>
#include <unordered_map>
#include <functional>
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
        std::string delegated_email_header = "x-remote-email",
        std::unordered_map<std::string, std::string> required_headers = {}
    );

    [[nodiscard]] std::string_view name() const noexcept override { return "delegated"; }

    /**
     * @brief Authenticates a request via remote user and optional remote email header values,
     * verifying any configured proxy validation headers.
     * @param remote_user Value of X-Remote-User header.
     * @param remote_email Value of X-Remote-Email header (optional).
     * @param header_lookup Callback to query request header values by lowercase name.
     * @return Result<std::optional<UserIdentity>> User identity, or nullopt if unauthenticated.
     */
    Result<std::optional<UserIdentity>> authenticate(
        const std::string& remote_user,
        const std::string& remote_email = "",
        std::function<std::string(std::string_view)> header_lookup = nullptr
    );

    [[nodiscard]] const std::string& delegated_header() const noexcept { return delegated_header_; }
    [[nodiscard]] const std::string& delegated_email_header() const noexcept { return delegated_email_header_; }
    [[nodiscard]] const std::unordered_map<std::string, std::string>& required_headers() const noexcept { return required_headers_; }
    void set_required_headers(std::unordered_map<std::string, std::string> headers);

private:
    std::shared_ptr<db::ConnectionPool> pool_;
    std::shared_ptr<IAdminProvider> admin_provider_;
    std::string delegated_header_;
    std::string delegated_email_header_;
    std::unordered_map<std::string, std::string> required_headers_;
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
