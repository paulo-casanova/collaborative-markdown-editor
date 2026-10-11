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

        std::cout << "\n[PASS] All db_permissions_dag_test test cases succeeded!\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "[FAIL] Test failed with exception: " << e.what() << "\n";
        return 1;
    }
}
