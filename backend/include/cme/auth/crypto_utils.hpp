/**
 * @file crypto_utils.hpp
 * @brief Cryptographic utilities for password hashing, token generation, and digest hashing.
 */

#pragma once

#include <string>
#include <string_view>
#include <optional>
#include <cstddef>

namespace cme::auth {

/**
 * @brief Generates cryptographically secure random bytes formatted as a lowercase hex string.
 * @param bytes Number of random bytes (default 32 bytes -> 64 hex characters / 256 bits).
 * @return Hexadecimal representation of random token.
 */
[[nodiscard]] std::string generate_random_token(size_t bytes = 32);

/**
 * @brief Computes SHA-256 digest of input and returns lowercase hex string (64 characters).
 * @param input Data buffer to digest.
 * @return Lowercase 64-character hex string.
 */
[[nodiscard]] std::string sha256_hex(std::string_view input);

/**
 * @brief Hashes a plain-text password using salted bcrypt ($2b$).
 * @param password Plain-text password string.
 * @param cost Bcrypt cost parameter between 4 and 31 (default: 10).
 * @return Bcrypt hash string starting with "$2b$...".
 */
[[nodiscard]] std::string hash_password_bcrypt(const std::string& password, int cost = 10);

/**
 * @brief Verifies a plain-text password against a stored password hash (bcrypt or crypt-compatible).
 * @param password Plain-text candidate password.
 * @param hash Stored cryptographic hash string.
 * @return True if password matches hash, false otherwise.
 */
[[nodiscard]] bool verify_password_bcrypt(const std::string& password, const std::string& hash);

/**
 * @brief Extracts Bearer token value from an HTTP "Authorization" header.
 * @param auth_header String view of the Authorization header (e.g. "Bearer abc123xyz").
 * @return Extracted token or nullopt if invalid.
 */
[[nodiscard]] std::optional<std::string> extract_bearer_token(std::string_view auth_header);

/**
 * @brief Extracts named cookie value from an HTTP "Cookie" header.
 * @param cookie_header String view of the Cookie header (e.g. "foo=1; cme_session=xyz; bar=2").
 * @param cookie_name Name of cookie parameter to extract (default: "cme_session").
 * @return Extracted cookie value or nullopt if not present.
 */
[[nodiscard]] std::optional<std::string> extract_cookie_token(
    std::string_view cookie_header,
    std::string_view cookie_name = "cme_session"
);

/**
 * @brief Constant-time string comparison to prevent timing side-channel attacks on secret tokens.
 * @param a First string view to compare.
 * @param b Second string view to compare.
 * @return True if strings are equal in length and content, false otherwise.
 */
[[nodiscard]] bool constant_time_equals(std::string_view a, std::string_view b) noexcept;

} // namespace cme::auth
