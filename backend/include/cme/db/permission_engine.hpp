/**
 * @file permission_engine.hpp
 * @brief Access control engine evaluating multi-parent team DAGs and ACL inheritance.
 */

#pragma once

#include <string>
#include <vector>
#include <string_view>
#include <optional>
#include <pqxx/pqxx>
#include "cme/common.hpp"

namespace cme::db {

/**
 * @enum AccessLevel
 * @brief Cumulative access scopes for documents and directories.
 */
enum class AccessLevel : uint8_t {
    None = 0,    ///< No access permitted (HTTP 403 Forbidden).
    Read = 1,    ///< Read-only viewing of document markdown and associated assets.
    Comment = 2, ///< Permission to view, leave comments, and propose edit suggestions.
    Edit = 3,    ///< Full editing permissions, attachment uploads, and suggestion merges.
    Admin = 4    ///< Superuser/administrative override with full management rights.
};

/**
 * @brief Converts AccessLevel enum to string ("NONE", "READ", "COMMENT", "EDIT", "ADMIN").
 */
[[nodiscard]] constexpr std::string_view to_string(AccessLevel level) noexcept {
    switch (level) {
        case AccessLevel::None: return "NONE";
        case AccessLevel::Read: return "READ";
        case AccessLevel::Comment: return "COMMENT";
        case AccessLevel::Edit: return "EDIT";
        case AccessLevel::Admin: return "ADMIN";
    }
    return "NONE";
}

/**
 * @brief Parses an uppercase access level string to AccessLevel enum.
 */
[[nodiscard]] constexpr AccessLevel parse_access_level(std::string_view str) noexcept {
    if (str == "READ") return AccessLevel::Read;
    if (str == "COMMENT") return AccessLevel::Comment;
    if (str == "EDIT") return AccessLevel::Edit;
    if (str == "ADMIN") return AccessLevel::Admin;
    return AccessLevel::None;
}

/**
 * @class PermissionEngine
 * @brief Evaluates authorization queries using PostgreSQL recursive CTEs and ACL trees.
 */
class PermissionEngine {
public:
    /**
     * @brief Resolves all effective team memberships for a user across multi-parent DAG hierarchies.
     * 
     * Uses a recursive CTE (`WITH RECURSIVE effective_teams AS (...)`) to traverse
     * ancestor relationships in `team_parents` transitively.
     * 
     * @param conn Active PostgreSQL connection.
     * @param user_id UUID string of the user.
     * @return Result<std::vector<std::string>> Vector of team UUID strings, or DatabaseError.
     */
    static Result<std::vector<std::string>> get_effective_teams(
        pqxx::connection& conn,
        const std::string& user_id
    );

    /**
     * @brief Evaluates whether a user has permission to perform an operation on a document.
     * 
     * Follows the 6-stage priority waterfall:
     * 1. Superuser Check (`users.is_system_admin = TRUE` -> ADMIN).
     * 2. Transitive DAG Team Resolution (`get_effective_teams`).
     * 3. Direct Ownership (`owner_user_id` or `owner_team_id` in effective teams -> EDIT).
     * 4. Explicit Document ACL (`permissions.target_id = document_id`, user grants take precedence).
     * 5. Directory Inheritance (Walks up path ancestors `/a/b` -> `/a` -> `/`).
     * 6. Default Deny (NONE).
     * 
     * @param conn Active PostgreSQL connection.
     * @param user_id UUID string of the authenticated user.
     * @param document_id UUID string of the target document (optional if evaluating path).
     * @param fs_path Relative storage path of the document (used for directory inheritance).
     * @return Result<AccessLevel> Highest resolved AccessLevel, or DatabaseError.
     */
    static Result<AccessLevel> check_permission(
        pqxx::connection& conn,
        const std::string& user_id,
        const std::string& document_id,
        const std::string& fs_path
    );
};

} // namespace cme::db
