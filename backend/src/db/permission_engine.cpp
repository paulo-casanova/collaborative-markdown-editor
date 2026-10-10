#include "cme/db/permission_engine.hpp"
#include <filesystem>
#include <algorithm>
#include <unordered_set>
#include <iostream>

namespace cme::db {

Result<std::vector<std::string>> PermissionEngine::get_effective_teams(
    pqxx::connection& conn,
    const std::string& user_id
) {
    try {
        pqxx::read_transaction tx(conn);
        auto rows = tx.exec_params(
            R"(
            WITH RECURSIVE effective_teams AS (
                -- Direct team memberships
                SELECT team_id FROM team_members WHERE user_id = $1::uuid
                UNION
                -- Transitive parent team memberships (multi-parent DAG traversal)
                SELECT tp.parent_team_id
                FROM team_parents tp
                JOIN effective_teams et ON tp.child_team_id = et.team_id
            )
            SELECT team_id::text FROM effective_teams;
            )",
            user_id
        );

        std::vector<std::string> teams;
        teams.reserve(rows.size());
        for (const auto& row : rows) {
            teams.push_back(row[0].as<std::string>());
        }
        return teams;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Failed to query effective teams: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<AccessLevel> PermissionEngine::check_permission(
    pqxx::connection& conn,
    const std::string& user_id,
    const std::string& document_id,
    const std::string& fs_path
) {
    try {
        pqxx::read_transaction tx(conn);

        // 1. Superuser Check: system admins bypass all ACLs
        auto user_row = tx.exec_params(
            "SELECT is_system_admin FROM users WHERE id = $1::uuid",
            user_id
        );
        if (!user_row.empty() && user_row[0][0].as<bool>()) {
            return AccessLevel::Admin;
        }

        // 2. Transitive Team Resolution: compute effective team set
        auto effective_teams_rows = tx.exec_params(
            R"(
            WITH RECURSIVE effective_teams AS (
                SELECT team_id FROM team_members WHERE user_id = $1::uuid
                UNION
                SELECT tp.parent_team_id
                FROM team_parents tp
                JOIN effective_teams et ON tp.child_team_id = et.team_id
            )
            SELECT team_id::text FROM effective_teams;
            )",
            user_id
        );

        std::unordered_set<std::string> effective_teams;
        for (const auto& row : effective_teams_rows) {
            effective_teams.insert(row[0].as<std::string>());
        }

        // 3. Direct Ownership: document owner has implicit EDIT rights
        if (!document_id.empty()) {
            auto doc_row = tx.exec_params(
                "SELECT owner_user_id::text, owner_team_id::text FROM documents WHERE id = $1::uuid",
                document_id
            );
            if (!doc_row.empty()) {
                if (!doc_row[0][0].is_null() && doc_row[0][0].as<std::string>() == user_id) {
                    return AccessLevel::Edit;
                }
                if (!doc_row[0][1].is_null() && effective_teams.contains(doc_row[0][1].as<std::string>())) {
                    return AccessLevel::Edit;
                }
            }

            // 4. Explicit Document ACL
            auto doc_acls = tx.exec_params(
                R"(
                SELECT grantee_type, grantee_id::text, access_level
                FROM permissions
                WHERE target_type = 'DOCUMENT' AND target_id = $1::uuid
                )",
                document_id
            );

            // User grant takes precedence if defined
            std::optional<AccessLevel> direct_user_grant;
            AccessLevel max_team_grant = AccessLevel::None;

            for (const auto& row : doc_acls) {
                std::string grantee_type = row[0].as<std::string>();
                std::string grantee_id = row[1].as<std::string>();
                AccessLevel level = parse_access_level(row[2].as<std::string>());

                if (grantee_type == "USER" && grantee_id == user_id) {
                    direct_user_grant = level;
                } else if (grantee_type == "TEAM" && effective_teams.contains(grantee_id)) {
                    if (static_cast<uint8_t>(level) > static_cast<uint8_t>(max_team_grant)) {
                        max_team_grant = level;
                    }
                }
            }

            if (direct_user_grant.has_value()) {
                return *direct_user_grant;
            }
            if (max_team_grant != AccessLevel::None) {
                return max_team_grant;
            }
        }

        // 5. Directory Inheritance (Fallback)
        if (!fs_path.empty()) {
            std::filesystem::path current_dir = std::filesystem::path(fs_path).parent_path();
            while (true) {
                std::string dir_str = current_dir.string();
                if (dir_str == ".") dir_str = "";

                auto dir_acls = tx.exec_params(
                    R"(
                    SELECT grantee_type, grantee_id::text, access_level
                    FROM permissions
                    WHERE target_type = 'DIRECTORY' AND COALESCE(directory_path, '') = $1
                    )",
                    dir_str
                );

                std::optional<AccessLevel> direct_user_grant;
                AccessLevel max_team_grant = AccessLevel::None;

                for (const auto& row : dir_acls) {
                    std::string grantee_type = row[0].as<std::string>();
                    std::string grantee_id = row[1].as<std::string>();
                    AccessLevel level = parse_access_level(row[2].as<std::string>());

                    if (grantee_type == "USER" && grantee_id == user_id) {
                        direct_user_grant = level;
                    } else if (grantee_type == "TEAM" && effective_teams.contains(grantee_id)) {
                        if (static_cast<uint8_t>(level) > static_cast<uint8_t>(max_team_grant)) {
                            max_team_grant = level;
                        }
                    }
                }

                if (direct_user_grant.has_value()) {
                    return *direct_user_grant;
                }
                if (max_team_grant != AccessLevel::None) {
                    return max_team_grant;
                }

                if (current_dir.empty() || current_dir == "/" || current_dir == ".") {
                    break;
                }
                current_dir = current_dir.parent_path();
            }
        }

        // 6. Default Deny
        return AccessLevel::None;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Permission check failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::db
