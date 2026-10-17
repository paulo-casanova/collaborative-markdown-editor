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
     * @brief Resolves all effective team names for a user across multi-parent DAG hierarchies.
     * 
     * @param conn Active PostgreSQL connection.
     * @param user_id UUID string of the user.
     * @return Result<std::vector<std::string>> Vector of human-readable team names, or DatabaseError.
     */
    static Result<std::vector<std::string>> get_effective_team_names(
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
struct PrincipalInfo {
    std::string id;
    std::string name;
    std::string display_name;
    bool is_team{false};
};

struct GrantInfo {
    int64_t id{0};
    std::string grantee_type; // "USER" or "TEAM"
    std::string grantee_id;
    std::string grantee_name;
    AccessLevel access_level{AccessLevel::None};
    std::string inherited_from; // empty if explicit, else parent directory path
    bool is_inheritable{true};
};

struct PermissionDetails {
    std::string target_type; // "DOCUMENT" or "DIRECTORY"
    std::string target_id;
    std::string target_path;
    PrincipalInfo owner;
    std::vector<GrantInfo> explicit_grants;
    std::vector<GrantInfo> inherited_grants;
    AccessLevel effective_level{AccessLevel::None};
    bool can_manage{false};
};

struct TestRuleMatch {
    std::string source; // "SYSTEM_ADMIN", "DIRECT_OWNER", "TEAM_OWNER", "EXPLICIT_GRANT", "INHERITED_GRANT"
    AccessLevel level{AccessLevel::None};
    std::string grantee_type;
    std::string grantee_id;
    std::string grantee_name;
    std::string inherited_from;
    bool is_inheritable{true};
    std::string description;
};

struct TestPermissionResult {
    std::string target_type; // "DOCUMENT" or "DIRECTORY"
    std::string target_id;
    std::string target_path;
    std::string subject_type; // "USER" or "TEAM"
    std::string subject_id;
    std::string subject_name;
    AccessLevel effective_level{AccessLevel::None};
    bool is_system_admin{false};
    bool is_owner{false};
    std::vector<std::string> effective_teams;
    std::vector<TestRuleMatch> matched_rules;
};

    static Result<AccessLevel> check_permission(
        pqxx::connection& conn,
        const std::string& user_id,
        const std::string& document_id,
        const std::string& fs_path
    );

    /**
     * @brief Resolves detailed explicit and inherited grants, ownership, and provenance for a node.
     */
    static Result<PermissionDetails> get_permission_details(
        pqxx::connection& conn,
        const std::string& user_id,
        const std::string& target_type,
        const std::string& target_id,
        const std::string& fs_path
    );

    /**
     * @brief Tests what ACLs and effective permissions apply to a given user or team on a node.
     */
    static Result<TestPermissionResult> test_permission(
        pqxx::connection& conn,
        const std::string& subject_type,
        const std::string& subject_id,
        const std::string& target_type,
        const std::string& target_id,
        const std::string& fs_path
    );
};

} // namespace cme::db
