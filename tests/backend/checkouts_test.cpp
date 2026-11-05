#include "cme/document/document_service.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/db/migration_runner.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>
#include <vector>

int main() {
    std::cout << "=== CME Document Checkouts & Binary Revisions Test ===\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = cme::db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    std::string alice_id;
    std::string bob_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM document_checkouts WHERE fs_path LIKE 'reports/%';");
        tx.exec("DELETE FROM binary_revisions WHERE fs_path LIKE 'reports/%';");
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'reports/%';");
        tx.exec("DELETE FROM users WHERE username IN ('checkout_alice', 'checkout_bob');");

        std::string pw_hash = cme::auth::hash_password_bcrypt("pass123", 10);
        auto r_alice = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('checkout_alice', $1, 'Alice Analyst', FALSE) RETURNING id::text;",
            pw_hash
        );
        alice_id = r_alice[0][0].as<std::string>();

        auto r_bob = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('checkout_bob', $1, 'Bob Reviewer', FALSE) RETURNING id::text;",
            pw_hash
        );
        bob_id = r_bob[0][0].as<std::string>();

        // Set Alice as owner of reports directory, and give Bob inheritable Edit permission on reports
        tx.exec("DELETE FROM directory_metadata WHERE directory_path = 'reports';");
        tx.exec("DELETE FROM permissions WHERE directory_path = 'reports';");
        tx.exec_params("INSERT INTO directory_metadata (directory_path, owner_user_id) VALUES ('reports', $1::uuid);", alice_id);
        tx.exec_params(
            "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
            "VALUES ('DIRECTORY', 'reports', 'USER', $1::uuid, 'EDIT', TRUE);",
            bob_id
        );

        tx.commit();
    }

    cme::auth::UserIdentity alice{
        .user_id = alice_id,
        .username = "checkout_alice",
        .display_name = "Alice Analyst",
        .is_system_admin = false
    };

    cme::auth::UserIdentity bob{
        .user_id = bob_id,
        .username = "checkout_bob",
        .display_name = "Bob Reviewer",
        .is_system_admin = false
    };

    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_checkout_test_storage";
    std::filesystem::remove_all(test_storage);
    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage.string());

    cme::document::DocumentService doc_service(pool, storage);

    std::cout << "[STEP 1] Creating initial non-markdown file...\n";
    std::string initial_content = "PK\x03\x04Initial DOCX report content";
    auto upload_res = doc_service.upload_workspace_file("reports/Q3_Summary.docx", initial_content, alice);
    assert(upload_res.has_value());
    std::cout << "  File created successfully with doc_id: " << upload_res.value().id << "\n";

    std::cout << "[STEP 2] Alice checks out the document...\n";
    auto co_res = doc_service.checkout_document("reports/Q3_Summary.docx", alice);
    assert(co_res.has_value());
    assert(co_res.value().user_id == alice_id);
    assert(co_res.value().fs_path == "reports/Q3_Summary.docx");

    std::cout << "[STEP 3] Verifying checkout lists and status...\n";
    auto alice_checkouts = doc_service.list_user_checkouts(alice);
    assert(alice_checkouts.has_value());
    assert(alice_checkouts.value().size() == 1);
    assert(alice_checkouts.value()[0].fs_path == "reports/Q3_Summary.docx");

    auto bob_checkouts = doc_service.list_user_checkouts(bob);
    assert(bob_checkouts.has_value());
    assert(bob_checkouts.value().empty());

    auto chk_status = doc_service.get_document_checkout("reports/Q3_Summary.docx");
    assert(chk_status.has_value());
    assert(chk_status.value().has_value());
    assert(chk_status.value()->user_id == alice_id);

    std::cout << "[STEP 4] Bob attempts concurrent checkout -> should be Conflict...\n";
    auto bob_co = doc_service.checkout_document("reports/Q3_Summary.docx", bob);
    assert(!bob_co.has_value());
    assert(bob_co.error() == cme::ErrorCode::Conflict);

    std::cout << "[STEP 5] Bob attempts unauthorized upload overwrite -> should be Conflict...\n";
    auto bob_up = doc_service.upload_workspace_file("reports/Q3_Summary.docx", "Overwritten by Bob", bob);
    assert(!bob_up.has_value());
    assert(bob_up.error() == cme::ErrorCode::Conflict);

    std::cout << "[STEP 6] Bob attempts to check in Alice's document -> should be PermissionDenied...\n";
    auto bob_ci = doc_service.checkin_document("reports/Q3_Summary.docx", "Bob's content", "Unauthorized checkin", bob);
    assert(!bob_ci.has_value());
    assert(bob_ci.error() == cme::ErrorCode::PermissionDenied);

    std::cout << "[STEP 7] Alice checks in revised document...\n";
    std::string rev1_content = "PK\x03\x04Updated Revision 1 Content with Q3 financial tables";
    auto alice_ci = doc_service.checkin_document("reports/Q3_Summary.docx", rev1_content, "Added financial tables", alice);
    assert(alice_ci.has_value());
    assert(alice_ci.value().path == "reports/Q3_Summary.docx");

    std::cout << "[STEP 8] Verifying active file updated and lock released...\n";
    auto post_status = doc_service.get_document_checkout("reports/Q3_Summary.docx");
    assert(post_status.has_value());
    assert(!post_status.value().has_value()); // Lock released

    auto active_content_res = storage->read_file("reports/Q3_Summary.docx");
    assert(active_content_res.has_value());
    assert(active_content_res.value() == rev1_content);

    std::cout << "[STEP 9] Verifying historical binary revision archive...\n";
    auto revs_res = doc_service.list_binary_revisions("reports/Q3_Summary.docx", alice);
    assert(revs_res.has_value());
    assert(revs_res.value().size() == 1);
    assert(revs_res.value()[0].revision_number == 1);
    assert(revs_res.value()[0].change_summary == "Added financial tables");
    assert(revs_res.value()[0].author_id == alice_id);

    auto archived_content_res = doc_service.read_binary_revision_content("reports/Q3_Summary.docx", 1, alice);
    assert(archived_content_res.has_value());
    assert(archived_content_res.value() == initial_content); // Original version archived!

    std::cout << "[STEP 10] Testing cancel checkout...\n";
    auto co2_res = doc_service.checkout_document("reports/Q3_Summary.docx", alice);
    assert(co2_res.has_value());

    auto cancel_res = doc_service.cancel_checkout("reports/Q3_Summary.docx", alice);
    assert(cancel_res.has_value());

    auto final_status = doc_service.get_document_checkout("reports/Q3_Summary.docx");
    assert(final_status.has_value());
    assert(!final_status.value().has_value());

    // Clean up temporary storage
    std::filesystem::remove_all(test_storage);

    std::cout << "All Document Checkout & Binary Revision Tests PASSED!\n";
    return 0;
}
