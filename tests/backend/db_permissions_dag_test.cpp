#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/db/permission_engine.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <cassert>
#include <iostream>
#include <algorithm>
#include <cstdlib>

using namespace cme::db;

int main() {
    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_db = std::getenv("CME_DATABASE_URL")) {
        db_url = env_db;
    }

    std::cout << "[TEST] Running db_permissions_dag_test against: " << db_url << "\n";

    std::filesystem::path migrations_dir = "migrations";
    if (const char* env_mig = std::getenv("CME_MIGRATIONS_DIR")) {
        migrations_dir = env_mig;
    } else if (std::filesystem::exists("../migrations")) {
        migrations_dir = "../migrations";
    }

    try {
        // 1. Ensure migrations are applied
        {
            pqxx::connection conn(db_url);
            auto mig_res = MigrationRunner::apply_migrations(conn, migrations_dir);
            assert(mig_res.has_value());
            std::cout << "[TEST] Migrations applied: " << *mig_res << "\n";
        }

        // 2. Test Connection Pool
        auto pool = ConnectionPool::create(db_url, 4);
        assert(pool->size() == 4);
        assert(pool->available() == 4);

        auto pooled_conn = pool->acquire();
        assert(pooled_conn.has_value());
        assert(pool->available() == 3);

        pqxx::connection& conn = pooled_conn->get();

        // 3. Clean test records and set up DAG scenario
        std::string charlie_id, admin_id, eng_team_id, web_team_id, frontend_team_id;
        std::string doc_arch_id, doc_style_id, doc_secret_id, doc_owned_id, doc_dir_inherit_id;

        {
            pqxx::work tx(conn);
            // Clean previous test data
            tx.exec("DELETE FROM users WHERE username IN ('test_charlie', 'test_admin');");
            tx.exec("DELETE FROM teams WHERE name IN ('test_engineering', 'test_web_platform', 'test_frontend_devs');");
            tx.exec("DELETE FROM documents WHERE fs_path LIKE 'test/%';");

            // Create Users
            std::string pw_hash = cme::auth::hash_password_bcrypt("password123", 10);
            auto r_charlie = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
                "VALUES ('test_charlie', $1, 'Charlie Developer', FALSE) RETURNING id::text;",
                pw_hash
            );
            charlie_id = r_charlie[0][0].as<std::string>();

            auto r_admin = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
                "VALUES ('test_admin', $1, 'Super Admin', TRUE) RETURNING id::text;",
                pw_hash
            );
            admin_id = r_admin[0][0].as<std::string>();

            // Create Teams
            auto r_eng = tx.exec("INSERT INTO teams (name, description) VALUES ('test_engineering', 'Engineering Org') RETURNING id::text;");
            eng_team_id = r_eng[0][0].as<std::string>();

            auto r_web = tx.exec("INSERT INTO teams (name, description) VALUES ('test_web_platform', 'Web Platform') RETURNING id::text;");
            web_team_id = r_web[0][0].as<std::string>();

            auto r_front = tx.exec("INSERT INTO teams (name, description) VALUES ('test_frontend_devs', 'Frontend Developers') RETURNING id::text;");
            frontend_team_id = r_front[0][0].as<std::string>();

            // Add Charlie directly to frontend_team
            tx.exec_params(
                "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member');",
                frontend_team_id, charlie_id
            );

            // Establish Diamond DAG:
            // frontend_devs belongs to engineering AND web_platform
            tx.exec_params(
                "INSERT INTO team_parents (parent_team_id, child_team_id) VALUES ($1::uuid, $2::uuid);",
                eng_team_id, frontend_team_id
            );
            tx.exec_params(
                "INSERT INTO team_parents (parent_team_id, child_team_id) VALUES ($1::uuid, $2::uuid);",
                web_team_id, frontend_team_id
            );

            // Create Documents
            auto r_doc1 = tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/docs/arch.md', 'Architecture') RETURNING id::text;"
            );
            doc_arch_id = r_doc1[0][0].as<std::string>();

            auto r_doc2 = tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/docs/styleguide.md', 'Style Guide') RETURNING id::text;"
            );
            doc_style_id = r_doc2[0][0].as<std::string>();

            auto r_doc3 = tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/private/secret.md', 'Secret Document') RETURNING id::text;"
            );
            doc_secret_id = r_doc3[0][0].as<std::string>();

            auto r_doc4 = tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) VALUES ('test/personal/notes.md', 'Personal Notes', $1::uuid) RETURNING id::text;",
                charlie_id
            );
            doc_owned_id = r_doc4[0][0].as<std::string>();

            auto r_doc5 = tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/shared/guides/intro.md', 'Public Intro') RETURNING id::text;"
            );
            doc_dir_inherit_id = r_doc5[0][0].as<std::string>();

            // Grant permissions:
            // 1. On arch.md: engineering has READ, web_platform has EDIT
            tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                "VALUES ('DOCUMENT', $1::uuid, 'TEAM', $2::uuid, 'READ');",
                doc_arch_id, eng_team_id
            );
            tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                "VALUES ('DOCUMENT', $1::uuid, 'TEAM', $2::uuid, 'EDIT');",
                doc_arch_id, web_team_id
            );

            // 2. On styleguide.md: frontend_devs has COMMENT
            tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                "VALUES ('DOCUMENT', $1::uuid, 'TEAM', $2::uuid, 'COMMENT');",
                doc_style_id, frontend_team_id
            );

            // 3. Directory ACL on 'test/shared': engineering has READ
            tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level) "
                "VALUES ('DIRECTORY', 'test/shared', 'TEAM', $1::uuid, 'READ');",
                eng_team_id
            );

            tx.commit();
        }

        // 4. Verify Transitive Effective Teams for Charlie (DAG Traversal)
        std::cout << "[TEST] Querying effective teams for Charlie (DAG)...\n";
        auto effective_teams_res = PermissionEngine::get_effective_teams(conn, charlie_id);
        assert(effective_teams_res.has_value());
        const auto& teams = *effective_teams_res;

        std::cout << "  Found " << teams.size() << " effective teams for Charlie:\n";
        for (const auto& t : teams) {
            std::cout << "    - " << t << "\n";
        }

        assert(teams.size() == 3);
        assert(std::find(teams.begin(), teams.end(), frontend_team_id) != teams.end());
        assert(std::find(teams.begin(), teams.end(), eng_team_id) != teams.end());
        assert(std::find(teams.begin(), teams.end(), web_team_id) != teams.end());
        std::cout << "[PASS] Transitive DAG team membership verified.\n";

        // 5. Verify Permission Resolution:
        // Test A: arch.md -> Should resolve to EDIT (max of READ from engineering and EDIT from web_platform)
        auto perm_arch = PermissionEngine::check_permission(conn, charlie_id, doc_arch_id, "test/docs/arch.md");
        assert(perm_arch.has_value());
        std::cout << "[TEST] Permission on arch.md: " << to_string(*perm_arch) << "\n";
        assert(*perm_arch == AccessLevel::Edit);

        // Test B: styleguide.md -> Should resolve to COMMENT
        auto perm_style = PermissionEngine::check_permission(conn, charlie_id, doc_style_id, "test/docs/styleguide.md");
        assert(perm_style.has_value());
        std::cout << "[TEST] Permission on styleguide.md: " << to_string(*perm_style) << "\n";
        assert(*perm_style == AccessLevel::Comment);

        // Test C: secret.md -> Should resolve to NONE (Default Deny)
        auto perm_secret = PermissionEngine::check_permission(conn, charlie_id, doc_secret_id, "test/private/secret.md");
        assert(perm_secret.has_value());
        std::cout << "[TEST] Permission on secret.md for Charlie: " << to_string(*perm_secret) << "\n";
        assert(*perm_secret == AccessLevel::None);

        // Test D: Superuser bypass -> AdminUser has ADMIN on secret.md
        auto perm_admin = PermissionEngine::check_permission(conn, admin_id, doc_secret_id, "test/private/secret.md");
        assert(perm_admin.has_value());
        std::cout << "[TEST] Permission on secret.md for Admin: " << to_string(*perm_admin) << "\n";
        assert(*perm_admin == AccessLevel::Admin);

        // Test E: Direct Document Ownership -> Charlie has EDIT on personal notes
        auto perm_owned = PermissionEngine::check_permission(conn, charlie_id, doc_owned_id, "test/personal/notes.md");
        assert(perm_owned.has_value());
        std::cout << "[TEST] Permission on owned document: " << to_string(*perm_owned) << "\n";
        assert(*perm_owned == AccessLevel::Edit);

        // Test F: Directory ACL Inheritance -> Charlie has READ on test/shared/guides/intro.md
        auto perm_dir = PermissionEngine::check_permission(conn, charlie_id, doc_dir_inherit_id, "test/shared/guides/intro.md");
        assert(perm_dir.has_value());
        std::cout << "[TEST] Permission via directory inheritance: " << to_string(*perm_dir) << "\n";
        assert(*perm_dir == AccessLevel::Read);

        // Test G: Non-inheriting directory ACL entries
        // On 'test/local_only': Charlie has direct COMMENT (is_inheritable = false)
        //                       Engineering has READ (is_inheritable = true)
        std::string doc_sub_id;
        {
            pqxx::work g_tx(conn);
            g_tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', 'test/local_only', 'USER', $1::uuid, 'COMMENT', FALSE);",
                charlie_id
            );
            g_tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', 'test/local_only', 'TEAM', $1::uuid, 'READ', TRUE);",
                eng_team_id
            );
            auto r = g_tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ('test/local_only/nested/child.md', 'Child Doc', $1::uuid) RETURNING id;",
                admin_id
            );
            doc_sub_id = r[0][0].as<std::string>();
            g_tx.commit();
        }

        // G1: Charlie directly on directory 'test/local_only' -> has COMMENT (non-inheriting grant applies to the direct directory)
        auto perm_direct_dir = PermissionEngine::check_permission(conn, charlie_id, "", "test/local_only");
        assert(perm_direct_dir.has_value());
        std::cout << "[TEST] Permission on test/local_only (direct): " << to_string(*perm_direct_dir) << "\n";
        assert(*perm_direct_dir == AccessLevel::Comment);

        // G2: Charlie on nested child doc 'test/local_only/nested/child.md' -> resolves to READ (COMMENT does NOT inherit, but READ from eng_team does)
        auto perm_child = PermissionEngine::check_permission(conn, charlie_id, doc_sub_id, "test/local_only/nested/child.md");
        assert(perm_child.has_value());
        std::cout << "[TEST] Permission on child doc: " << to_string(*perm_child) << "\n";
        assert(*perm_child == AccessLevel::Read);

        // Test H: PermissionEngine::test_permission inspector
        std::cout << "[TEST] Testing PermissionEngine::test_permission...\n";
        auto test_user_res = PermissionEngine::test_permission(
            conn, "USER", charlie_id, "DOCUMENT", doc_sub_id, "test/local_only/nested/child.md"
        );
        assert(test_user_res.has_value());
        std::cout << "  - Subject name: " << test_user_res->subject_name << "\n";
        std::cout << "  - Effective level: " << to_string(test_user_res->effective_level) << "\n";
        std::cout << "  - Matched rules: " << test_user_res->matched_rules.size() << "\n";
        assert(test_user_res->effective_level == AccessLevel::Read);
        assert(!test_user_res->matched_rules.empty());
        assert(!test_user_res->effective_teams.empty());

        auto test_team_res = PermissionEngine::test_permission(
            conn, "TEAM", eng_team_id, "DIRECTORY", "", "test/local_only"
        );
        assert(test_team_res.has_value());
        std::cout << "  - Team test effective level: " << to_string(test_team_res->effective_level) << "\n";
        assert(test_team_res->effective_level == AccessLevel::Read);
        assert(!test_team_res->matched_rules.empty());

        // Test I: Root Directory Permission Enforcement (Issue #15)
        std::cout << "\n[TEST] Testing Root Directory Permission Enforcement...\n";
        {
            // By default, Charlie has no ACL on root "" -> NONE
            auto perm_root_charlie = PermissionEngine::check_permission(conn, charlie_id, "", "");
            assert(perm_root_charlie.has_value());
            std::cout << "  - Charlie permission on root directory: " << to_string(*perm_root_charlie) << "\n";
            assert(*perm_root_charlie == AccessLevel::None);

            // Admin user bypasses ACLs -> ADMIN on root
            auto perm_root_admin = PermissionEngine::check_permission(conn, admin_id, "", "");
            assert(perm_root_admin.has_value());
            std::cout << "  - Admin permission on root directory: " << to_string(*perm_root_admin) << "\n";
            assert(*perm_root_admin == AccessLevel::Admin);
        }

        // Test J: Grant EVERYONE -> EDIT on Root Workspace (Issue #16 & #15)
        std::cout << "\n[TEST] Testing EVERYONE ACL on root directory...\n";
        int64_t root_perm_id = 0;
        {
            pqxx::work r_tx(conn);
            auto r = r_tx.exec(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', '', 'EVERYONE', NULL, 'EDIT', TRUE) RETURNING id;"
            );
            root_perm_id = r[0][0].as<int64_t>();
            r_tx.commit();
        }

        {
            // Now Charlie on root "" has EDIT via EVERYONE
            auto perm_root_charlie = PermissionEngine::check_permission(conn, charlie_id, "", "");
            assert(perm_root_charlie.has_value());
            std::cout << "  - Charlie on root after EVERYONE grant: " << to_string(*perm_root_charlie) << "\n";
            assert(*perm_root_charlie == AccessLevel::Edit);

            // Verify get_permission_details on root directory
            auto details_root = PermissionEngine::get_permission_details(conn, charlie_id, "DIRECTORY", "", "");
            assert(details_root.has_value());
            assert(details_root->effective_level == AccessLevel::Edit);
            assert(!details_root->explicit_grants.empty());
            bool found_everyone = false;
            for (const auto& g : details_root->explicit_grants) {
                if (g.grantee_type == "EVERYONE" && g.grantee_name == "Everyone") {
                    found_everyone = true;
                    assert(g.access_level == AccessLevel::Edit);
                    assert(g.grantee_id.empty());
                }
            }
            assert(found_everyone);
            std::cout << "  - get_permission_details on root reports EVERYONE grant correctly.\n";

            // Verify test_permission inspector for Charlie on root
            auto test_root = PermissionEngine::test_permission(conn, "USER", charlie_id, "DIRECTORY", "", "");
            assert(test_root.has_value());
            assert(test_root->effective_level == AccessLevel::Edit);
            bool found_rule = false;
            for (const auto& rule : test_root->matched_rules) {
                if (rule.grantee_type == "EVERYONE") {
                    found_rule = true;
                    assert(rule.level == AccessLevel::Edit);
                }
            }
            assert(found_rule);
            std::cout << "  - test_permission on root matched EVERYONE rule.\n";
        }

        // Test K: Document with explicit EVERYONE ACL
        std::cout << "\n[TEST] Testing Document with explicit EVERYONE ACL...\n";
        {
            // Remove the root grant first
            pqxx::work rm_tx(conn);
            rm_tx.exec_params("DELETE FROM permissions WHERE id = $1;", root_perm_id);

            // Create doc
            auto r_ev = rm_tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/public_doc.md', 'Public Document') RETURNING id::text;"
            );
            std::string ev_doc_id = r_ev[0][0].as<std::string>();

            // Grant EVERYONE COMMENT
            rm_tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                "VALUES ('DOCUMENT', $1::uuid, 'EVERYONE', NULL, 'COMMENT');",
                ev_doc_id
            );
            rm_tx.commit();

            // Charlie should have COMMENT
            auto perm_ev = PermissionEngine::check_permission(conn, charlie_id, ev_doc_id, "test/public_doc.md");
            assert(perm_ev.has_value());
            std::cout << "  - Charlie permission on public_doc.md: " << to_string(*perm_ev) << "\n";
            assert(*perm_ev == AccessLevel::Comment);

            // Charlie on root is still NONE
            auto perm_root = PermissionEngine::check_permission(conn, charlie_id, "", "");
            assert(perm_root.has_value());
            assert(*perm_root == AccessLevel::None);
        }

        // Test L: Document ACL Waterfall Precedence (Document COMMENT vs Inherited Root EDIT)
        std::cout << "\n[TEST] Testing Document ACL Waterfall Precedence over Inherited Directory EDIT...\n";
        {
            pqxx::work l_tx(conn);
            // 1. Grant Root directory EVERYONE -> EDIT
            l_tx.exec(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', '', 'EVERYONE', NULL, 'EDIT', TRUE);"
            );
            // 2. Create document test/comment_only.md
            auto r_doc = l_tx.exec(
                "INSERT INTO documents (fs_path, title) VALUES ('test/comment_only.md', 'Comment Only Doc') RETURNING id::text;"
            );
            std::string c_doc_id = r_doc[0][0].as<std::string>();
            // 3. Explicitly grant EVERYONE -> COMMENT on document
            l_tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                "VALUES ('DOCUMENT', $1::uuid, 'EVERYONE', NULL, 'COMMENT');",
                c_doc_id
            );
            l_tx.commit();

            // Charlie should have COMMENT, NOT EDIT, because document explicit ACL takes precedence!
            auto perm_c = PermissionEngine::check_permission(conn, charlie_id, c_doc_id, "test/comment_only.md");
            assert(perm_c.has_value());
            std::cout << "  - Charlie permission on test/comment_only.md: " << to_string(*perm_c) << "\n";
            assert(*perm_c == AccessLevel::Comment);

            // get_permission_details should report effective_level = COMMENT
            auto details_c = PermissionEngine::get_permission_details(conn, charlie_id, "DOCUMENT", c_doc_id, "");
            assert(details_c.has_value());
            assert(details_c->effective_level == AccessLevel::Comment);
            assert(!details_c->explicit_grants.empty());
            assert(!details_c->inherited_grants.empty());

            // 4. Also test User-specific restriction: Document has EVERYONE -> EDIT, but User has USER -> COMMENT
            std::string u_doc_id;
            {
                pqxx::work u_tx(conn);
                auto r_doc_u = u_tx.exec(
                    "INSERT INTO documents (fs_path, title) VALUES ('test/user_restrict.md', 'User Restrict') RETURNING id::text;"
                );
                u_doc_id = r_doc_u[0][0].as<std::string>();
                u_tx.exec_params(
                    "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                    "VALUES ('DOCUMENT', $1::uuid, 'EVERYONE', NULL, 'EDIT');",
                    u_doc_id
                );
                u_tx.exec_params(
                    "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
                    "VALUES ('DOCUMENT', $1::uuid, 'USER', $2::uuid, 'COMMENT');",
                    u_doc_id, charlie_id
                );
                u_tx.commit();
            }

            auto perm_u = PermissionEngine::check_permission(conn, charlie_id, u_doc_id, "test/user_restrict.md");
            assert(perm_u.has_value());
            std::cout << "  - Charlie user-restricted permission on test/user_restrict.md: " << to_string(*perm_u) << "\n";
            assert(*perm_u == AccessLevel::Comment);

            // Clean up root grant and test docs
            pqxx::work cl_tx(conn);
            cl_tx.exec("DELETE FROM permissions WHERE target_type = 'DIRECTORY' AND COALESCE(directory_path, '') = '';");
            cl_tx.exec_params("DELETE FROM permissions WHERE target_id IN ($1::uuid, $2::uuid);", c_doc_id, u_doc_id);
            cl_tx.exec_params("DELETE FROM documents WHERE id IN ($1::uuid, $2::uuid);", c_doc_id, u_doc_id);
            cl_tx.commit();
        }

        std::cout << "\n[PASS] All db_permissions_dag_test test cases succeeded!\n";

        // Clean up test records
        {
            pqxx::work clean_tx(conn);
            clean_tx.exec("DELETE FROM users WHERE username IN ('test_charlie', 'test_admin');");
            clean_tx.exec("DELETE FROM teams WHERE name IN ('test_engineering', 'test_web_platform', 'test_frontend_devs');");
            clean_tx.exec("DELETE FROM documents WHERE fs_path LIKE 'test/%';");
            clean_tx.commit();
        }

        return 0;
    } catch (const std::exception& e) {
        std::cerr << "[FAIL] Test failed with exception: " << e.what() << "\n";
        return 1;
    }
}
