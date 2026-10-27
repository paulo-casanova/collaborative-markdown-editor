#include "cme/document/document_service.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>
#include <vector>
#include <cstdlib>

using namespace cme;

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== Workspace Tree Performance & Zero Write Side-Effects Test ===\n";
    std::cout << "=== (Issue #29 Regression Test)                                  ===\n";
    std::cout << "====================================================================\n";

    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_db = std::getenv("CME_DATABASE_URL")) {
        db_url = env_db;
    }

    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_tree_perf_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage / "public_folder" / "sub");
    std::filesystem::create_directories(test_storage / "private_folder");
    std::filesystem::create_directories(test_storage / "team_folder");

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    std::string user_id;
    std::string admin_id;
    std::string team_id;

    auto cleanup = [&]() {
        try {
            auto c_res = pool->acquire();
            if (c_res.has_value()) {
                pqxx::work tx(c_res->get());
                tx.exec("DELETE FROM documents WHERE fs_path LIKE 'public_folder%' OR fs_path LIKE 'private_folder%' OR fs_path LIKE 'team_folder%' OR fs_path LIKE 'unindexed%' OR fs_path LIKE 'stale%';");
                tx.exec("DELETE FROM directory_metadata WHERE directory_path LIKE 'public_folder%' OR directory_path LIKE 'private_folder%' OR directory_path LIKE 'team_folder%';");
                tx.exec("DELETE FROM permissions WHERE directory_path LIKE 'public_folder%' OR directory_path LIKE 'private_folder%' OR directory_path LIKE 'team_folder%';");
                tx.exec("DELETE FROM users WHERE username IN ('tree_perf_user', 'tree_perf_admin');");
                tx.exec("DELETE FROM teams WHERE name = 'tree_perf_team';");
                tx.commit();
            }
        } catch (...) {}
        std::error_code ec;
        std::filesystem::remove_all(test_storage, ec);
    };

    // Clean any previous artifacts
    cleanup();
    std::filesystem::create_directories(test_storage / "public_folder" / "sub");
    std::filesystem::create_directories(test_storage / "private_folder");
    std::filesystem::create_directories(test_storage / "team_folder");

    try {
        // Seed users & teams
        {
            pqxx::work tx(conn_res->get());
            std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
            auto r_user = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
                "VALUES ('tree_perf_user', $1, 'Tree Perf User', FALSE) RETURNING id::text;",
                pw_hash
            );
            user_id = r_user[0][0].as<std::string>();

            auto r_admin = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
                "VALUES ('tree_perf_admin', $1, 'Tree Perf Admin', TRUE) RETURNING id::text;",
                pw_hash
            );
            admin_id = r_admin[0][0].as<std::string>();

            auto r_team = tx.exec(
                "INSERT INTO teams (name, description) VALUES ('tree_perf_team', 'Perf Test Team') RETURNING id::text;"
            );
            team_id = r_team[0][0].as<std::string>();

            tx.exec_params(
                "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member');",
                team_id, user_id
            );

            tx.commit();
        }

        auth::UserIdentity normal_user{
            .user_id = user_id,
            .username = "tree_perf_user",
            .display_name = "Tree Perf User",
            .avatar_color = "#3b82f6",
            .is_system_admin = false
        };

        auth::UserIdentity admin_user{
            .user_id = admin_id,
            .username = "tree_perf_admin",
            .display_name = "Tree Perf Admin",
            .avatar_color = "#ef4444",
            .is_system_admin = true
        };

        // Seed permissions first:
        // - Grant user EDIT on public_folder (inheritable)
        // - Grant team EDIT on team_folder (inheritable)
        {
            pqxx::work tx(conn_res->get());
            tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', 'public_folder', 'USER', $1::uuid, 'EDIT', TRUE);",
                user_id
            );
            tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
                "VALUES ('DIRECTORY', 'team_folder', 'TEAM', $1::uuid, 'EDIT', TRUE);",
                team_id
            );

            // Stale document in DB: points to non-existent file on disk
            tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ('stale_missing_file.md', 'Stale Doc', $1::uuid);",
                user_id
            );
            tx.commit();
        }

        auto storage = std::make_shared<storage::PosixStorageBackend>(test_storage);
        document::DocumentService doc_service(pool, storage);

        // 1. Create documents in DB and disk
        // Document 1: owned by user
        auto d1 = doc_service.create_document({
            .path = "public_folder/user_doc.md",
            .content = "# User Doc\nContent",
            .title = "User Document"
        }, normal_user);
        assert(d1.has_value());

        // Document 2: in public_folder/sub (user has directory grant on public_folder)
        auto d2 = doc_service.create_document({
            .path = "public_folder/sub/sub_doc.md",
            .content = "# Sub Doc\nContent",
            .title = "Sub Document"
        }, admin_user);
        assert(d2.has_value());

        // Document 3: in team_folder (team owned)
        auto d3 = doc_service.create_document({
            .path = "team_folder/team_doc.md",
            .content = "# Team Doc\nContent",
            .title = "Team Document"
        }, admin_user);
        assert(d3.has_value());

        // Document 4: in private_folder (admin only, normal user has NO permission)
        auto d4 = doc_service.create_document({
            .path = "private_folder/secret.md",
            .content = "# Secret Doc\nClassified",
            .title = "Secret Document"
        }, admin_user);
        assert(d4.has_value());

        // 2. Create unindexed files directly on storage (simulating external git push / disk sync)
        storage->write_file("unindexed_root.md", "# Root Unindexed\nDisk only content\n", true);
        storage->write_file("public_folder/unindexed_sub.md", "# Sub Unindexed\nDisk only content\n", true);
        storage->write_file("public_folder/sample.txt", "Text file", true);

        // 3. Count documents in DB before get_workspace_tree
        int count_before = 0;
        {
            pqxx::read_transaction tx(conn_res->get());
            auto r = tx.exec("SELECT count(*) FROM documents WHERE fs_path LIKE 'public_folder%' OR fs_path LIKE 'private_folder%' OR fs_path LIKE 'team_folder%' OR fs_path LIKE 'unindexed%' OR fs_path LIKE 'stale%';");
            count_before = r[0][0].as<int>();
        }
        std::cout << "[INFO] Document count in DB before get_workspace_tree: " << count_before << "\n";
        assert(count_before == 5); // 4 created + 1 stale

        // 4. Call get_workspace_tree(normal_user)
        std::cout << "[TEST] Calling get_workspace_tree for normal user...\n";
        auto tree_res = doc_service.get_workspace_tree(normal_user);
        assert(tree_res.has_value());
        const auto& tree = tree_res.value();
        assert(tree.is_array());
        std::cout << "  - Normal user received " << tree.size() << " nodes in workspace tree.\n";

        // 5. Verify NO WRITE SIDE-EFFECTS (zero mutations to DB)
        int count_after = 0;
        {
            pqxx::read_transaction tx(conn_res->get());
            auto r = tx.exec("SELECT count(*) FROM documents WHERE fs_path LIKE 'public_folder%' OR fs_path LIKE 'private_folder%' OR fs_path LIKE 'team_folder%' OR fs_path LIKE 'unindexed%' OR fs_path LIKE 'stale%';");
            count_after = r[0][0].as<int>();
        }
        std::cout << "[INFO] Document count in DB after get_workspace_tree: " << count_after << "\n";
        assert(count_before == count_after);
        std::cout << "[PASS] Verified get_workspace_tree performed zero DB writes (no insertions/deletions).\n";

        // Verify unindexed files were NOT inserted into documents table
        {
            pqxx::read_transaction tx(conn_res->get());
            auto r = tx.exec("SELECT count(*) FROM documents WHERE fs_path LIKE 'unindexed%';");
            assert(r[0][0].as<int>() == 0);
        }
        std::cout << "[PASS] Verified unindexed disk files remain unindexed in DB on GET tree.\n";

        // Verify stale DB row was NOT deleted by get_workspace_tree
        {
            pqxx::read_transaction tx(conn_res->get());
            auto r = tx.exec("SELECT count(*) FROM documents WHERE fs_path = 'stale_missing_file.md';");
            assert(r[0][0].as<int>() == 1);
        }
        std::cout << "[PASS] Verified stale DB records are not deleted on GET tree.\n";

        // 6. Verify Permission Enforcement for normal user:
        // - public_folder and its children should be present
        // - team_folder and its children should be present
        // - private_folder MUST NOT be present
        bool found_public_doc = false;
        bool found_sub_doc = false;
        bool found_team_doc = false;
        bool found_unindexed_sub = false;
        bool found_private_folder = false;
        bool found_secret_doc = false;

        for (const auto& node : tree) {
            std::string path = node["path"].get<std::string>();
            if (path == "public_folder/user_doc.md") {
                found_public_doc = true;
                assert(node.contains("id") && !node["id"].get<std::string>().empty());
                assert(node["title"].get<std::string>() == "User Document");
            }
            if (path == "public_folder/sub/sub_doc.md") {
                found_sub_doc = true;
            }
            if (path == "team_folder/team_doc.md") {
                found_team_doc = true;
            }
            if (path == "public_folder/unindexed_sub.md") {
                found_unindexed_sub = true;
                // Unindexed doc should derive title from path without error
                assert(node.contains("title"));
            }
            if (path == "private_folder") {
                found_private_folder = true;
            }
            if (path == "private_folder/secret.md") {
                found_secret_doc = true;
            }
        }

        assert(found_public_doc);
        assert(found_sub_doc);
        assert(found_team_doc);
        assert(found_unindexed_sub);
        assert(!found_private_folder); // AccessLevel::None -> filtered out
        assert(!found_secret_doc);     // AccessLevel::None -> filtered out
        std::cout << "[PASS] In-memory permission checks properly filtered out unpermitted private nodes.\n";

        // 7. Verify Admin User sees all nodes (Superuser bypass)
        std::cout << "[TEST] Calling get_workspace_tree for admin user...\n";
        auto admin_tree_res = doc_service.get_workspace_tree(admin_user);
        assert(admin_tree_res.has_value());
        const auto& admin_tree = admin_tree_res.value();

        bool admin_found_secret = false;
        bool admin_found_private_folder = false;
        for (const auto& node : admin_tree) {
            std::string path = node["path"].get<std::string>();
            if (path == "private_folder") admin_found_private_folder = true;
            if (path == "private_folder/secret.md") admin_found_secret = true;
        }
        assert(admin_found_private_folder);
        assert(admin_found_secret);
        std::cout << "[PASS] Admin user workspace tree includes all nodes.\n";

        cleanup();
        std::cout << "\n====================================================================\n";
        std::cout << "=== ALL WORKSPACE TREE PERF TESTS PASSED SUCCESSFULLY!           ===\n";
        std::cout << "====================================================================\n";
        return 0;
    } catch (const std::exception& e) {
        cleanup();
        std::cerr << "[FAIL] Unexpected exception: " << e.what() << "\n";
        return 1;
    }
}
