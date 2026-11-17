#include "cme/document/document_service.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/db/migration_runner.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>
#include <vector>

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Document Links Index & Fast Rename Test Suite       ===\n";
    std::cout << "===============================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_links_test_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage);

    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    // 1. Migrations
    std::cout << "\n[STEP 1] Validating schema migrations on test database...\n";
    {
        auto conn = pool->acquire();
        assert(conn.has_value());
        auto mig_res = cme::db::MigrationRunner::apply_migrations(conn->get(), "migrations");
        assert(mig_res.has_value());
        std::cout << "  - Migrations verified.\n";
    }

    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage);
    auto doc_service = std::make_shared<cme::document::DocumentService>(pool, storage);

    cme::auth::UserIdentity user{
        .user_id = "00000000-0000-0000-0000-000000000001",
        .username = "link_tester",
        .display_name = "Link Tester",
        .is_system_admin = true
    };

    // Ensure user exists and clean up any leftover test documents
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());
        tx.exec_params(
            "INSERT INTO users (id, username, password_hash, display_name, is_system_admin) "
            "VALUES ($1::uuid, 'link_tester', 'secret', 'Link Tester', TRUE) "
            "ON CONFLICT (id) DO NOTHING;",
            user.user_id
        );
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'guides/%' OR fs_path LIKE 'manuals/%' OR fs_path LIKE 'notes/%' OR fs_path LIKE 'reports/%';");
        tx.commit();
    }

    // 2. Test create_document with links & verify document_links population
    std::cout << "\n[STEP 2] Creating documents and verifying document_links table population...\n";
    std::string target_doc_path = "guides/intro.md";
    std::string ref_doc_path = "notes/overview.md";
    std::string untouched_doc_path = "reports/status.md";

    auto target_res = doc_service->create_document({
        .path = target_doc_path,
        .content = "# Intro\nThis is the intro doc.\n",
        .title = "Introduction Guide"
    }, user);
    assert(target_res.has_value());
    std::string target_doc_id = target_res->id;

    std::string ref_content =
        "# Overview\n"
        "Read the [[guides/intro.md]] for basics, and [[guides/intro#prerequisites|Prerequisites]].\n"
        "Also see [Intro Markdown Link](guides/intro.md).\n"
        "Embed: ![[assets/logo.png]].\n";

    auto ref_res = doc_service->create_document({
        .path = ref_doc_path,
        .content = ref_content,
        .title = "Overview Notes"
    }, user);
    assert(ref_res.has_value());
    std::string ref_doc_id = ref_res->id;

    auto untouched_res = doc_service->create_document({
        .path = untouched_doc_path,
        .content = "# Status\nAll systems green. No links here.\n",
        .title = "Status Report"
    }, user);
    assert(untouched_res.has_value());
    std::string untouched_doc_id = untouched_res->id;

    // Verify document_links in DB
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto rows = tx.exec_params(
            "SELECT target_norm, target_stem, link_type, is_embed FROM document_links WHERE source_doc_id = $1::uuid ORDER BY target_norm;",
            ref_doc_id
        );
        // Expect: assets/logo.png (embed), guides/intro, guides/intro.md (2 entries: wikilink and markdown)
        assert(!rows.empty());
        bool found_intro = false;
        bool found_stem = false;
        bool found_embed = false;
        for (const auto& r : rows) {
            std::string norm = r[0].as<std::string>();
            std::string stem = r[1].as<std::string>();
            bool is_emb = r[3].as<bool>();
            if (norm == "guides/intro.md" || norm == "guides/intro") {
                found_intro = true;
            }
            if (stem == "intro") {
                found_stem = true;
            }
            if (is_emb && norm == "assets/logo.png") {
                found_embed = true;
            }
        }
        assert(found_intro);
        assert(found_stem);
        assert(found_embed);

        // Untouched doc must have 0 links
        auto unt_rows = tx.exec_params(
            "SELECT COUNT(*) FROM document_links WHERE source_doc_id = $1::uuid;",
            untouched_doc_id
        );
        assert(unt_rows[0][0].as<int64_t>() == 0);
        std::cout << "  - Document links successfully populated and validated in DB.\n";
    }

    // 3. Test document move with fast index lookup
    std::cout << "\n[STEP 3] Testing fast move_document with document_links index...\n";
    std::string new_target_path = "guides/getting-started.md";
    auto move_res = doc_service->move_document(target_doc_id, new_target_path, user, "Getting Started");
    assert(move_res.has_value());

    // Check updated referencing docs
    assert(move_res->updated_referencing_docs.size() == 1);
    assert(move_res->updated_referencing_docs[0] == ref_doc_id);

    // Read ref_doc from storage and check wikilinks were updated
    auto ref_read = storage->read_file(ref_doc_path);
    assert(ref_read.has_value());
    assert(ref_read->find("[[guides/getting-started.md]]") != std::string::npos);
    assert(ref_read->find("[[guides/getting-started#prerequisites|Prerequisites]]") != std::string::npos);
    assert(ref_read->find("[[guides/intro.md]]") == std::string::npos);

    // Verify document_links was updated to reflect getting-started
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto rows = tx.exec_params(
            "SELECT target_norm, target_stem FROM document_links WHERE source_doc_id = $1::uuid;",
            ref_doc_id
        );
        bool found_getting_started = false;
        for (const auto& r : rows) {
            std::string norm = r[0].as<std::string>();
            if (norm.find("getting-started") != std::string::npos) {
                found_getting_started = true;
            }
        }
        assert(found_getting_started);
        std::cout << "  - Referencing document wikilinks and document_links cache updated on move.\n";
    }

    // 4. Test directory rename with fast index lookup
    std::cout << "\n[STEP 4] Testing rename_directory with document_links index...\n";
    auto ren_dir_res = doc_service->rename_directory("guides", "manuals", user);
    assert(ren_dir_res.has_value());

    // Verify ref_doc content updated guides -> manuals
    auto ref_dir_read = storage->read_file(ref_doc_path);
    assert(ref_dir_read.has_value());
    assert(ref_dir_read->find("[[manuals/getting-started.md]]") != std::string::npos);
    assert(ref_dir_read->find("[[manuals/getting-started#prerequisites|Prerequisites]]") != std::string::npos);

    // 5. Test repopulate_links_index
    std::cout << "\n[STEP 5] Testing repopulate_links_index cache rebuild...\n";
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());
        tx.exec("DELETE FROM document_links;");
        tx.commit();
    }

    // Verify count is 0
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto cnt = tx.exec("SELECT COUNT(*) FROM document_links;");
        assert(cnt[0][0].as<int64_t>() == 0);
    }

    // Call repopulate_links_index
    auto repop_res = doc_service->repopulate_links_index();
    assert(repop_res.has_value());
    assert(repop_res.value() >= 2); // At least target_doc and ref_doc

    // Verify document_links has entries again
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto cnt = tx.exec("SELECT COUNT(*) FROM document_links;");
        assert(cnt[0][0].as<int64_t>() > 0);
        std::cout << "  - Cache repopulated successfully: " << cnt[0][0].as<int64_t>() << " link entries created.\n";
    }

    // 6. Test cascade delete on document deletion
    std::cout << "\n[STEP 6] Testing cascade delete on document deletion...\n";
    auto del_res = doc_service->delete_document(ref_doc_id, user);
    assert(del_res.has_value());

    // Verify ref_doc links deleted from document_links
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto cnt = tx.exec_params(
            "SELECT COUNT(*) FROM document_links WHERE source_doc_id = $1::uuid;",
            ref_doc_id
        );
        assert(cnt[0][0].as<int64_t>() == 0);
        std::cout << "  - Cascade delete verified: 0 orphan link entries.\n";
    }

    // Clean up test storage and DB documents
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'guides/%' OR fs_path LIKE 'manuals/%' OR fs_path LIKE 'notes/%' OR fs_path LIKE 'reports/%';");
        tx.commit();
    }
    std::filesystem::remove_all(test_storage);

    std::cout << "\n===============================================================\n";
    std::cout << "=== ALL TESTS PASSED SUCCESSFULLY!                          ===\n";
    std::cout << "===============================================================\n";
    return 0;
}
