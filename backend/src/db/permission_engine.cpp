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

Result<std::vector<std::string>> PermissionEngine::get_effective_team_names(
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
            SELECT et.team_id::text, t.name
            FROM effective_teams et
            JOIN teams t ON et.team_id = t.id
            ORDER BY t.name ASC;
            )",
            user_id
        );

        std::vector<std::string> names;
        names.reserve(rows.size());
        for (const auto& row : rows) {
            std::string name = row[1].is_null() || row[1].as<std::string>().empty()
                ? row[0].as<std::string>()
                : row[1].as<std::string>();
            names.push_back(name);
        }
        return names;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Failed to query effective team names: " << e.what() << "\n";
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

        AccessLevel effective_level = AccessLevel::None;
        auto merge_level = [&](AccessLevel lvl) {
            if (static_cast<uint8_t>(lvl) > static_cast<uint8_t>(effective_level)) {
                effective_level = lvl;
            }
        };

        // 3. Document Ownership & Direct Document ACLs
        if (!document_id.empty()) {
            auto doc_row = tx.exec_params(
                "SELECT owner_user_id::text, owner_team_id::text FROM documents WHERE id = $1::uuid",
                document_id
            );
            if (!doc_row.empty()) {
                if (!doc_row[0][0].is_null() && doc_row[0][0].as<std::string>() == user_id) {
                    merge_level(AccessLevel::Edit);
                }
                if (!doc_row[0][1].is_null() && effective_teams.contains(doc_row[0][1].as<std::string>())) {
                    merge_level(AccessLevel::Edit);
                }
            }

            auto doc_acls = tx.exec_params(
                R"(
                SELECT grantee_type, grantee_id::text, access_level
                FROM permissions
                WHERE target_type = 'DOCUMENT' AND target_id = $1::uuid
                )",
                document_id
            );

            for (const auto& row : doc_acls) {
                std::string grantee_type = row[0].as<std::string>();
                std::string grantee_id = row[1].as<std::string>();
                AccessLevel lvl = parse_access_level(row[2].as<std::string>());

                if (grantee_type == "USER" && grantee_id == user_id) {
                    merge_level(lvl);
                } else if (grantee_type == "TEAM" && effective_teams.contains(grantee_id)) {
                    merge_level(lvl);
                }
            }
        }

        // 4. Directory Hierarchy (Additive Inheritance from node up to root)
        if (!fs_path.empty()) {
            std::filesystem::path current_dir;
            bool is_direct_dir = false;
            if (!document_id.empty()) {
                current_dir = std::filesystem::path(fs_path).parent_path();
                is_direct_dir = false;
            } else {
                current_dir = std::filesystem::path(fs_path);
                is_direct_dir = true;
            }

            while (true) {
                std::string dir_str = current_dir.string();
                if (dir_str == ".") dir_str = "";

                // Check directory ownership in directory_metadata
                auto dir_meta = tx.exec_params(
                    "SELECT owner_user_id::text, owner_team_id::text FROM directory_metadata WHERE directory_path = $1",
                    dir_str
                );
                if (!dir_meta.empty()) {
                    if (!dir_meta[0][0].is_null() && dir_meta[0][0].as<std::string>() == user_id) {
                        merge_level(AccessLevel::Edit);
                    }
                    if (!dir_meta[0][1].is_null() && effective_teams.contains(dir_meta[0][1].as<std::string>())) {
                        merge_level(AccessLevel::Edit);
                    }
                }

                auto dir_acls = tx.exec_params(
                    R"(
                    SELECT grantee_type, grantee_id::text, access_level, is_inheritable
                    FROM permissions
                    WHERE target_type = 'DIRECTORY' AND COALESCE(directory_path, '') = $1
                    )",
                    dir_str
                );

                for (const auto& row : dir_acls) {
                    std::string grantee_type = row[0].as<std::string>();
                    std::string grantee_id = row[1].as<std::string>();
                    AccessLevel lvl = parse_access_level(row[2].as<std::string>());
                    bool is_inheritable = row[3].as<bool>();

                    if (!is_direct_dir && !is_inheritable) {
                        continue;
                    }

                    if (grantee_type == "USER" && grantee_id == user_id) {
                        merge_level(lvl);
                    } else if (grantee_type == "TEAM" && effective_teams.contains(grantee_id)) {
                        merge_level(lvl);
                    }
                }

                is_direct_dir = false;

                if (dir_str.empty() || current_dir == "/" || current_dir == ".") {
                    break;
                }
                current_dir = current_dir.parent_path();
            }
        }

        return effective_level;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Permission check failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<PermissionEngine::PermissionDetails> PermissionEngine::get_permission_details(
    pqxx::connection& conn,
    const std::string& user_id,
    const std::string& target_type,
    const std::string& target_id,
    const std::string& fs_path
) {
    try {
        pqxx::read_transaction tx(conn);
        PermissionDetails details;
        details.target_type = target_type;
        details.target_id = target_id;
        details.target_path = fs_path;

        bool is_admin = false;
        auto user_row = tx.exec_params(
            "SELECT is_system_admin FROM users WHERE id = $1::uuid",
            user_id
        );
        if (!user_row.empty() && user_row[0][0].as<bool>()) {
            is_admin = true;
        }

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

        bool is_owner = false;

        if (target_type == "DOCUMENT" && !target_id.empty()) {
            auto doc_row = tx.exec_params(
                R"(
                SELECT d.owner_user_id::text, u.username, COALESCE(u.display_name, u.username),
                       d.owner_team_id::text, t.name
                FROM documents d
                LEFT JOIN users u ON d.owner_user_id = u.id
                LEFT JOIN teams t ON d.owner_team_id = t.id
                WHERE d.id = $1::uuid
                )",
                target_id
            );
            if (!doc_row.empty()) {
                if (!doc_row[0][0].is_null()) {
                    details.owner.id = doc_row[0][0].as<std::string>();
                    details.owner.name = doc_row[0][1].as<std::string>();
                    details.owner.display_name = doc_row[0][2].as<std::string>();
                    details.owner.is_team = false;
                    if (details.owner.id == user_id) is_owner = true;
                } else if (!doc_row[0][3].is_null()) {
                    details.owner.id = doc_row[0][3].as<std::string>();
                    details.owner.name = doc_row[0][4].as<std::string>();
                    details.owner.display_name = doc_row[0][4].as<std::string>();
                    details.owner.is_team = true;
                    if (effective_teams.contains(details.owner.id)) is_owner = true;
                }
            }

            auto acls = tx.exec_params(
                R"(
                SELECT p.id, p.grantee_type, p.grantee_id::text,
                       COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                       p.access_level, p.is_inheritable
                FROM permissions p
                LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                WHERE p.target_type = 'DOCUMENT' AND p.target_id = $1::uuid
                ORDER BY p.id ASC
                )",
                target_id
            );
            for (const auto& r : acls) {
                details.explicit_grants.push_back({
                    .id = r[0].as<int64_t>(),
                    .grantee_type = r[1].as<std::string>(),
                    .grantee_id = r[2].as<std::string>(),
                    .grantee_name = r[3].as<std::string>(),
                    .access_level = parse_access_level(r[4].as<std::string>()),
                    .inherited_from = "",
                    .is_inheritable = r[5].as<bool>()
                });
            }
        } else {
            std::string clean_dir = fs_path;
            while (!clean_dir.empty() && (clean_dir.front() == '/' || clean_dir.front() == '\\')) clean_dir.erase(0, 1);
            while (!clean_dir.empty() && (clean_dir.back() == '/' || clean_dir.back() == '\\')) clean_dir.pop_back();

            auto dir_row = tx.exec_params(
                R"(
                SELECT dm.owner_user_id::text, u.username, COALESCE(u.display_name, u.username),
                       dm.owner_team_id::text, t.name
                FROM directory_metadata dm
                LEFT JOIN users u ON dm.owner_user_id = u.id
                LEFT JOIN teams t ON dm.owner_team_id = t.id
                WHERE dm.directory_path = $1
                )",
                clean_dir
            );
            if (!dir_row.empty()) {
                if (!dir_row[0][0].is_null()) {
                    details.owner.id = dir_row[0][0].as<std::string>();
                    details.owner.name = dir_row[0][1].as<std::string>();
                    details.owner.display_name = dir_row[0][2].as<std::string>();
                    details.owner.is_team = false;
                    if (details.owner.id == user_id) is_owner = true;
                } else if (!dir_row[0][3].is_null()) {
                    details.owner.id = dir_row[0][3].as<std::string>();
                    details.owner.name = dir_row[0][4].as<std::string>();
                    details.owner.display_name = dir_row[0][4].as<std::string>();
                    details.owner.is_team = true;
                    if (effective_teams.contains(details.owner.id)) is_owner = true;
                }
            }

            auto acls = tx.exec_params(
                R"(
                SELECT p.id, p.grantee_type, p.grantee_id::text,
                       COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                       p.access_level, p.is_inheritable
                FROM permissions p
                LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                WHERE p.target_type = 'DIRECTORY' AND COALESCE(p.directory_path, '') = $1
                ORDER BY p.id ASC
                )",
                clean_dir
            );
            for (const auto& r : acls) {
                details.explicit_grants.push_back({
                    .id = r[0].as<int64_t>(),
                    .grantee_type = r[1].as<std::string>(),
                    .grantee_id = r[2].as<std::string>(),
                    .grantee_name = r[3].as<std::string>(),
                    .access_level = parse_access_level(r[4].as<std::string>()),
                    .inherited_from = "",
                    .is_inheritable = r[5].as<bool>()
                });
            }
        }

        // Ancestor Directory Inheritance Walk
        if (!fs_path.empty()) {
            std::filesystem::path current_dir = std::filesystem::path(fs_path).parent_path();
            while (true) {
                std::string dir_str = current_dir.string();
                if (dir_str == ".") dir_str = "";

                auto dir_acls = tx.exec_params(
                    R"(
                    SELECT p.id, p.grantee_type, p.grantee_id::text,
                           COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                           p.access_level, p.is_inheritable
                    FROM permissions p
                    LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                    LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                    WHERE p.target_type = 'DIRECTORY' AND COALESCE(p.directory_path, '') = $1 AND p.is_inheritable = TRUE
                    ORDER BY p.id ASC
                    )",
                    dir_str
                );

                for (const auto& r : dir_acls) {
                    details.inherited_grants.push_back({
                        .id = r[0].as<int64_t>(),
                        .grantee_type = r[1].as<std::string>(),
                        .grantee_id = r[2].as<std::string>(),
                        .grantee_name = r[3].as<std::string>(),
                        .access_level = parse_access_level(r[4].as<std::string>()),
                        .inherited_from = dir_str.empty() ? "/" : dir_str,
                        .is_inheritable = true
                    });
                }

                if (dir_str.empty() || current_dir == "/" || current_dir == ".") {
                    break;
                }
                current_dir = current_dir.parent_path();
            }
        }

        details.can_manage = is_admin || is_owner;

        // Effective level for current user
        AccessLevel eff_level = AccessLevel::None;
        if (is_admin) {
            eff_level = AccessLevel::Admin;
        } else if (is_owner) {
            eff_level = AccessLevel::Edit;
        }
        for (const auto& g : details.explicit_grants) {
            if ((g.grantee_type == "USER" && g.grantee_id == user_id) ||
                (g.grantee_type == "TEAM" && effective_teams.contains(g.grantee_id))) {
                if (static_cast<uint8_t>(g.access_level) > static_cast<uint8_t>(eff_level)) {
                    eff_level = g.access_level;
                }
            }
        }
        for (const auto& g : details.inherited_grants) {
            if ((g.grantee_type == "USER" && g.grantee_id == user_id) ||
                (g.grantee_type == "TEAM" && effective_teams.contains(g.grantee_id))) {
                if (static_cast<uint8_t>(g.access_level) > static_cast<uint8_t>(eff_level)) {
                    eff_level = g.access_level;
                }
            }
        }
        details.effective_level = eff_level;

        return details;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_permission_details failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<PermissionEngine::TestPermissionResult> PermissionEngine::test_permission(
    pqxx::connection& conn,
    const std::string& subject_type,
    const std::string& subject_id,
    const std::string& target_type,
    const std::string& target_id,
    const std::string& fs_path
) {
    try {
        pqxx::read_transaction tx(conn);
        TestPermissionResult result;
        result.subject_type = subject_type;
        for (auto& c : result.subject_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        result.subject_id = subject_id;
        result.target_type = target_type;
        for (auto& c : result.target_type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        result.target_id = target_id;
        result.target_path = fs_path;

        if (result.subject_type != "USER" && result.subject_type != "TEAM") {
            return std::unexpected(ErrorCode::InvalidArgument);
        }

        std::unordered_set<std::string> effective_teams_set;
        std::unordered_map<std::string, std::string> team_names;

        auto merge_effective = [&](AccessLevel lvl) {
            if (static_cast<uint8_t>(lvl) > static_cast<uint8_t>(result.effective_level)) {
                result.effective_level = lvl;
            }
        };

        if (result.subject_type == "USER") {
            auto u_row = tx.exec_params(
                "SELECT username, COALESCE(display_name, username), is_system_admin FROM users WHERE id = $1::uuid",
                subject_id
            );
            if (u_row.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            std::string uname = u_row[0][0].as<std::string>();
            std::string dname = u_row[0][1].as<std::string>();
            result.is_system_admin = u_row[0][2].as<bool>();
            result.subject_name = dname + " (@" + uname + ")";

            if (result.is_system_admin) {
                merge_effective(AccessLevel::Admin);
                result.matched_rules.push_back({
                    .source = "SYSTEM_ADMIN",
                    .level = AccessLevel::Admin,
                    .grantee_type = "USER",
                    .grantee_id = subject_id,
                    .grantee_name = result.subject_name,
                    .inherited_from = "",
                    .is_inheritable = true,
                    .description = "User is a System Administrator with full administrative access."
                });
            }

            // Transitive effective teams
            auto et_rows = tx.exec_params(
                R"(
                WITH RECURSIVE effective_teams AS (
                    SELECT team_id FROM team_members WHERE user_id = $1::uuid
                    UNION
                    SELECT tp.parent_team_id
                    FROM team_parents tp
                    JOIN effective_teams et ON tp.child_team_id = et.team_id
                )
                SELECT et.team_id::text, t.name
                FROM effective_teams et
                JOIN teams t ON et.team_id = t.id;
                )",
                subject_id
            );
            for (const auto& r : et_rows) {
                std::string tid = r[0].as<std::string>();
                std::string tname = r[1].as<std::string>();
                effective_teams_set.insert(tid);
                team_names[tid] = tname;
                result.effective_teams.push_back(tname);
            }
        } else { // TEAM
            auto t_row = tx.exec_params(
                "SELECT name FROM teams WHERE id = $1::uuid",
                subject_id
            );
            if (t_row.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            result.subject_name = t_row[0][0].as<std::string>();
            team_names[subject_id] = result.subject_name;
            effective_teams_set.insert(subject_id);
        }

        // Ownership
        if (result.target_type == "DOCUMENT" && !target_id.empty()) {
            auto doc_row = tx.exec_params(
                R"(
                SELECT d.owner_user_id::text, u.username, COALESCE(u.display_name, u.username),
                       d.owner_team_id::text, t.name
                FROM documents d
                LEFT JOIN users u ON d.owner_user_id = u.id
                LEFT JOIN teams t ON d.owner_team_id = t.id
                WHERE d.id = $1::uuid
                )",
                target_id
            );
            if (!doc_row.empty()) {
                if (result.subject_type == "USER" && !doc_row[0][0].is_null() && doc_row[0][0].as<std::string>() == subject_id) {
                    result.is_owner = true;
                    merge_effective(AccessLevel::Edit);
                    result.matched_rules.push_back({
                        .source = "DIRECT_OWNER",
                        .level = AccessLevel::Edit,
                        .grantee_type = "USER",
                        .grantee_id = subject_id,
                        .grantee_name = result.subject_name,
                        .inherited_from = "",
                        .is_inheritable = true,
                        .description = "User is the direct owner of this document (Edit permission)."
                    });
                }
                if (!doc_row[0][3].is_null()) {
                    std::string owner_tid = doc_row[0][3].as<std::string>();
                    std::string owner_tname = doc_row[0][4].as<std::string>();
                    if (result.subject_type == "USER" && effective_teams_set.contains(owner_tid)) {
                        result.is_owner = true;
                        merge_effective(AccessLevel::Edit);
                        result.matched_rules.push_back({
                            .source = "TEAM_OWNER",
                            .level = AccessLevel::Edit,
                            .grantee_type = "TEAM",
                            .grantee_id = owner_tid,
                            .grantee_name = owner_tname,
                            .inherited_from = "",
                            .is_inheritable = true,
                            .description = "User belongs to owning team '" + owner_tname + "' (Edit permission)."
                        });
                    } else if (result.subject_type == "TEAM" && owner_tid == subject_id) {
                        result.is_owner = true;
                        merge_effective(AccessLevel::Edit);
                        result.matched_rules.push_back({
                            .source = "DIRECT_OWNER",
                            .level = AccessLevel::Edit,
                            .grantee_type = "TEAM",
                            .grantee_id = subject_id,
                            .grantee_name = result.subject_name,
                            .inherited_from = "",
                            .is_inheritable = true,
                            .description = "Team is the owner of this document (Edit permission)."
                        });
                    }
                }
            }

            // Explicit Document Grants
            auto acls = tx.exec_params(
                R"(
                SELECT p.id, p.grantee_type, p.grantee_id::text,
                       COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                       p.access_level, p.is_inheritable
                FROM permissions p
                LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                WHERE p.target_type = 'DOCUMENT' AND p.target_id = $1::uuid
                ORDER BY p.id ASC
                )",
                target_id
            );
            for (const auto& r : acls) {
                std::string g_type = r[1].as<std::string>();
                std::string g_id = r[2].as<std::string>();
                std::string g_name = r[3].as<std::string>();
                AccessLevel lvl = parse_access_level(r[4].as<std::string>());
                bool is_inh = r[5].as<bool>();

                if (result.subject_type == "USER") {
                    if (g_type == "USER" && g_id == subject_id) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "USER",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Explicit grant to user: " + std::string(to_string(lvl))
                        });
                    } else if (g_type == "TEAM" && effective_teams_set.contains(g_id)) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "TEAM",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Explicit grant to team '" + g_name + "' (via team membership): " + std::string(to_string(lvl))
                        });
                    }
                } else if (result.subject_type == "TEAM") {
                    if (g_type == "TEAM" && g_id == subject_id) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "TEAM",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Explicit grant to team: " + std::string(to_string(lvl))
                        });
                    }
                }
            }
        } else {
            // Target is DIRECTORY
            std::string clean_dir = fs_path;
            while (!clean_dir.empty() && (clean_dir.front() == '/' || clean_dir.front() == '\\')) clean_dir.erase(0, 1);
            while (!clean_dir.empty() && (clean_dir.back() == '/' || clean_dir.back() == '\\')) clean_dir.pop_back();

            auto dir_row = tx.exec_params(
                R"(
                SELECT dm.owner_user_id::text, u.username, COALESCE(u.display_name, u.username),
                       dm.owner_team_id::text, t.name
                FROM directory_metadata dm
                LEFT JOIN users u ON dm.owner_user_id = u.id
                LEFT JOIN teams t ON dm.owner_team_id = t.id
                WHERE dm.directory_path = $1
                )",
                clean_dir
            );
            if (!dir_row.empty()) {
                if (result.subject_type == "USER" && !dir_row[0][0].is_null() && dir_row[0][0].as<std::string>() == subject_id) {
                    result.is_owner = true;
                    merge_effective(AccessLevel::Edit);
                    result.matched_rules.push_back({
                        .source = "DIRECT_OWNER",
                        .level = AccessLevel::Edit,
                        .grantee_type = "USER",
                        .grantee_id = subject_id,
                        .grantee_name = result.subject_name,
                        .inherited_from = "",
                        .is_inheritable = true,
                        .description = "User is the owner of this directory (Edit permission)."
                    });
                }
                if (!dir_row[0][3].is_null()) {
                    std::string owner_tid = dir_row[0][3].as<std::string>();
                    std::string owner_tname = dir_row[0][4].as<std::string>();
                    if (result.subject_type == "USER" && effective_teams_set.contains(owner_tid)) {
                        result.is_owner = true;
                        merge_effective(AccessLevel::Edit);
                        result.matched_rules.push_back({
                            .source = "TEAM_OWNER",
                            .level = AccessLevel::Edit,
                            .grantee_type = "TEAM",
                            .grantee_id = owner_tid,
                            .grantee_name = owner_tname,
                            .inherited_from = "",
                            .is_inheritable = true,
                            .description = "User belongs to directory owning team '" + owner_tname + "' (Edit permission)."
                        });
                    } else if (result.subject_type == "TEAM" && owner_tid == subject_id) {
                        result.is_owner = true;
                        merge_effective(AccessLevel::Edit);
                        result.matched_rules.push_back({
                            .source = "DIRECT_OWNER",
                            .level = AccessLevel::Edit,
                            .grantee_type = "TEAM",
                            .grantee_id = subject_id,
                            .grantee_name = result.subject_name,
                            .inherited_from = "",
                            .is_inheritable = true,
                            .description = "Team is the owner of this directory (Edit permission)."
                        });
                    }
                }
            }

            // Direct Directory Grants
            auto acls = tx.exec_params(
                R"(
                SELECT p.id, p.grantee_type, p.grantee_id::text,
                       COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                       p.access_level, p.is_inheritable
                FROM permissions p
                LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                WHERE p.target_type = 'DIRECTORY' AND COALESCE(p.directory_path, '') = $1
                ORDER BY p.id ASC
                )",
                clean_dir
            );
            for (const auto& r : acls) {
                std::string g_type = r[1].as<std::string>();
                std::string g_id = r[2].as<std::string>();
                std::string g_name = r[3].as<std::string>();
                AccessLevel lvl = parse_access_level(r[4].as<std::string>());
                bool is_inh = r[5].as<bool>();

                std::string inh_str = is_inh ? " (inheritable to children)" : " (applies only to this directory)";

                if (result.subject_type == "USER") {
                    if (g_type == "USER" && g_id == subject_id) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "USER",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Direct grant on directory: " + std::string(to_string(lvl)) + inh_str
                        });
                    } else if (g_type == "TEAM" && effective_teams_set.contains(g_id)) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "TEAM",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Direct grant to team '" + g_name + "' (via team membership): " + std::string(to_string(lvl)) + inh_str
                        });
                    }
                } else if (result.subject_type == "TEAM") {
                    if (g_type == "TEAM" && g_id == subject_id) {
                        merge_effective(lvl);
                        result.matched_rules.push_back({
                            .source = "EXPLICIT_GRANT",
                            .level = lvl,
                            .grantee_type = "TEAM",
                            .grantee_id = g_id,
                            .grantee_name = g_name,
                            .inherited_from = "",
                            .is_inheritable = is_inh,
                            .description = "Direct grant to team: " + std::string(to_string(lvl)) + inh_str
                        });
                    }
                }
            }
        }

        // Ancestor Directory Inheritance Walk
        if (!fs_path.empty()) {
            std::filesystem::path current_dir = std::filesystem::path(fs_path).parent_path();
            while (true) {
                std::string dir_str = current_dir.string();
                if (dir_str == ".") dir_str = "";

                auto dir_acls = tx.exec_params(
                    R"(
                    SELECT p.id, p.grantee_type, p.grantee_id::text,
                           COALESCE(u.display_name, u.username, t.name, 'Unknown'),
                           p.access_level, p.is_inheritable
                    FROM permissions p
                    LEFT JOIN users u ON p.grantee_type = 'USER' AND p.grantee_id = u.id
                    LEFT JOIN teams t ON p.grantee_type = 'TEAM' AND p.grantee_id = t.id
                    WHERE p.target_type = 'DIRECTORY' AND COALESCE(p.directory_path, '') = $1 AND p.is_inheritable = TRUE
                    ORDER BY p.id ASC
                    )",
                    dir_str
                );

                for (const auto& r : dir_acls) {
                    std::string g_type = r[1].as<std::string>();
                    std::string g_id = r[2].as<std::string>();
                    std::string g_name = r[3].as<std::string>();
                    AccessLevel lvl = parse_access_level(r[4].as<std::string>());
                    std::string from_str = dir_str.empty() ? "/" : dir_str;

                    if (result.subject_type == "USER") {
                        if (g_type == "USER" && g_id == subject_id) {
                            merge_effective(lvl);
                            result.matched_rules.push_back({
                                .source = "INHERITED_GRANT",
                                .level = lvl,
                                .grantee_type = "USER",
                                .grantee_id = g_id,
                                .grantee_name = g_name,
                                .inherited_from = from_str,
                                .is_inheritable = true,
                                .description = "Inherited from '" + from_str + "': " + std::string(to_string(lvl))
                            });
                        } else if (g_type == "TEAM" && effective_teams_set.contains(g_id)) {
                            merge_effective(lvl);
                            result.matched_rules.push_back({
                                .source = "INHERITED_GRANT",
                                .level = lvl,
                                .grantee_type = "TEAM",
                                .grantee_id = g_id,
                                .grantee_name = g_name,
                                .inherited_from = from_str,
                                .is_inheritable = true,
                                .description = "Inherited from '" + from_str + "' via team '" + g_name + "': " + std::string(to_string(lvl))
                            });
                        }
                    } else if (result.subject_type == "TEAM") {
                        if (g_type == "TEAM" && g_id == subject_id) {
                            merge_effective(lvl);
                            result.matched_rules.push_back({
                                .source = "INHERITED_GRANT",
                                .level = lvl,
                                .grantee_type = "TEAM",
                                .grantee_id = g_id,
                                .grantee_name = g_name,
                                .inherited_from = from_str,
                                .is_inheritable = true,
                                .description = "Inherited from '" + from_str + "': " + std::string(to_string(lvl))
                            });
                        }
                    }
                }

                if (dir_str.empty() || current_dir == "/" || current_dir == ".") {
                    break;
                }
                current_dir = current_dir.parent_path();
            }
        }

        return result;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] test_permission failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::db
