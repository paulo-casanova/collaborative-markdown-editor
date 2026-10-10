/**
 * @file user_identity.hpp
 * @brief Authenticated user identity model and credentials.
 */

#pragma once

#include <string>
#include <nlohmann/json.hpp>

namespace cme::auth {

/**
 * @struct UserIdentity
 * @brief Represents an authenticated user profile in the CME runtime.
 */
struct UserIdentity {
    std::string user_id;         ///< Unique database UUID identifier.
    std::string username;        ///< Unique alphanumeric username handle.
    std::string display_name;    ///< Human-readable name or email.
    std::string avatar_color{"#3b82f6"}; ///< Hex color code for collaborative presence.
    bool is_system_admin{false}; ///< True if granted superuser administrative override.

    /**
     * @brief Serializes the identity to a JSON object for API responses.
     */
    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", user_id},
            {"username", username},
            {"display_name", display_name},
            {"avatar_color", avatar_color},
            {"is_admin", is_system_admin}
        };
    }
};

} // namespace cme::auth
