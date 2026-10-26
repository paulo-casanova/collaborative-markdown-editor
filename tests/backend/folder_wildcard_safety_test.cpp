#include "cme/document/document_service.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>

using namespace cme;

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME Folder Wildcard Isolation Regression Test (Issue #25)    ===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_folder_wildcard_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage / "Foo_Bar");
    std::filesystem::create_directories(test_storage / "Foo-Bar");
    std::filesystem::create_directories(test_storage / "FooXBar");
    std::filesystem::create_directories(test_storage / "100%_done");
    std::filesystem::create_directories(test_storage / "1000_done");

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed user
    std::string user_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'Foo%' OR fs_path LIKE '100%';");
        tx.exec("DELETE FROM users WHERE username = 'wildcard_tester';");
        std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('wildcard_tester', $1, 'Wildcard Tester', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();
        tx.commit();
    }

    auth::UserIdentity user{
        .user_id = user_id,
        .username = "wildcard_tester",
        .display_name = "Wildcard Tester",
        .avatar_color = "#3b82f6",
        .is_system_admin = true
    };

    auto storage = std::make_shared<storage::PosixStorageBackend>(test_storage);
    document::DocumentService doc_service(pool, storage);

    // 1. Create documents across similar folder names containing wildcards
    std::cout << "[STEP 1] Creating documents in Foo_Bar, Foo-Bar, FooXBar, 100%_done, 1000_done...\n";
    auto make_doc = [&](const std::string& path, const std::string& title) -> std::string {
        document::CreateDocumentRequest req{
            .path = path,
            .content = "# " + title,
            .title = title
        };
        auto res = doc_service.create_document(req, user);
        assert(res.has_value());
        return res->id;
    };

    std::string id_foo_underscore = make_doc("Foo_Bar/doc.md", "Foo Underscore");
    std::string id_foo_dash = make_doc("Foo-Bar/doc.md", "Foo Dash");
    std::string id_foo_x = make_doc("FooXBar/doc.md", "Foo X");
    std::string id_pct_done = make_doc("100%_done/doc.md", "100% Done");
    std::string id_thousand_done = make_doc("1000_done/doc.md", "1000 Done");

    // Add comments to Foo-Bar to verify foreign keys and metadata don't cascade away
    {
        pqxx::work tx(conn_res->get());
        tx.exec_params(
            "INSERT INTO comments (document_id, author_id, content, status) "
            "VALUES ($1::uuid, $2::uuid, 'Important note on Foo-Bar', 'OPEN');",
            id_foo_dash,
            user_id
        );
        tx.commit();
    }

    // 2. Delete Foo_Bar: must NOT affect Foo-Bar or FooXBar
    std::cout << "[STEP 2] Deleting directory 'Foo_Bar' (testing '_' literal matching)...\n";
    auto del_res = doc_service.delete_directory("Foo_Bar", user);
    assert(del_res.has_value());

    {
        pqxx::work tx(conn_res->get());
        // Foo_Bar should be deleted
        auto r_del = tx.exec_params("SELECT COUNT(*) FROM documents WHERE id = $1::uuid;", id_foo_underscore);
        assert(r_del[0][0].as<int>() == 0);

        // Foo-Bar and FooXBar must remain intact
        auto r_dash = tx.exec_params("SELECT COUNT(*) FROM documents WHERE id = $1::uuid;", id_foo_dash);
        assert(r_dash[0][0].as<int>() == 1);
        auto r_x = tx.exec_params("SELECT COUNT(*) FROM documents WHERE id = $1::uuid;", id_foo_x);
        assert(r_x[0][0].as<int>() == 1);

        // Comment on Foo-Bar must remain
        auto r_comm = tx.exec_params("SELECT COUNT(*) FROM comments WHERE document_id = $1::uuid;", id_foo_dash);
        assert(r_comm[0][0].as<int>() == 1);
    }
    std::cout << "  - Confirmed: deleting 'Foo_Bar' did not delete 'Foo-Bar' or 'FooXBar'.\n";

    // 3. Move Foo-Bar: must NOT affect FooXBar
    std::cout << "[STEP 3] Moving directory 'Foo-Bar' -> 'Foo-Bar-Renamed'...\n";
    auto move_res = doc_service.rename_directory("Foo-Bar", "Foo-Bar-Renamed", user);
    assert(move_res.has_value());

    {
        pqxx::work tx(conn_res->get());
        auto r_moved = tx.exec_params("SELECT fs_path FROM documents WHERE id = $1::uuid;", id_foo_dash);
        assert(!r_moved.empty() && r_moved[0][0].as<std::string>() == "Foo-Bar-Renamed/doc.md");

        auto r_x = tx.exec_params("SELECT fs_path FROM documents WHERE id = $1::uuid;", id_foo_x);
        assert(!r_x.empty() && r_x[0][0].as<std::string>() == "FooXBar/doc.md");
    }
    std::cout << "  - Confirmed: moving 'Foo-Bar' updated only 'Foo-Bar' and left 'FooXBar' unchanged.\n";

    // 4. Delete 100%_done: must NOT affect 1000_done (testing '%' literal matching)
    std::cout << "[STEP 4] Deleting directory '100%_done' (testing '%' literal matching)...\n";
    auto del_pct_res = doc_service.delete_directory("100%_done", user);
    assert(del_pct_res.has_value());

    {
        pqxx::work tx(conn_res->get());
        auto r_pct = tx.exec_params("SELECT COUNT(*) FROM documents WHERE id = $1::uuid;", id_pct_done);
        assert(r_pct[0][0].as<int>() == 0);

        auto r_th = tx.exec_params("SELECT COUNT(*) FROM documents WHERE id = $1::uuid;", id_thousand_done);
        assert(r_th[0][0].as<int>() == 1);
    }
    std::cout << "  - Confirmed: deleting '100%_done' did not delete '1000_done'.\n";

    // 5. Verify search with literal path_prefix
    std::cout << "[STEP 5] Testing search_documents literal prefix isolation...\n";
    auto search_docs = doc_service.search_documents("Doc", "FooX", 10, user);
    assert(search_docs.has_value());
    assert(search_docs->size() == 1);
    assert((*search_docs)[0]["path"] == "FooXBar/doc.md");

    // Clean up
    std::filesystem::remove_all(test_storage);

    std::cout << "====================================================================\n";
    std::cout << "=== ALL TESTS IN folder_wildcard_safety_test PASSED (100%)       ===\n";
    std::cout << "====================================================================\n";
    return 0;
}
