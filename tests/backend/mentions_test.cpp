#include "cme/server/server.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/document/document_service.hpp"
#include <cassert>
#include <iostream>
#include <fstream>
#include <sstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <vector>

namespace {

struct HttpResponse {
    int status_code{0};
    std::string headers;
    std::string body;
};

HttpResponse http_curl(
    const std::string& method,
    const std::string& url,
    const std::vector<std::string>& headers = {},
    const std::string& body = ""
) {
    std::string out_file = "/tmp/cme_mentions_curl_out.txt";
    std::filesystem::remove(out_file);

    std::ostringstream cmd;
    cmd << "curl -s -i -X " << method << " \"" << url << "\"";
    for (const auto& h : headers) {
        cmd << " -H \"" << h << "\"";
    }
    if (!body.empty()) {
        cmd << " -d '" << body << "'";
    }
    cmd << " > " << out_file;

    int ret = std::system(cmd.str().c_str());
    assert(ret == 0);

    std::ifstream in(out_file);
    assert(in.is_open());
    std::string raw((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::filesystem::remove(out_file);

    HttpResponse resp;
    size_t header_end = raw.find("\r\n\r\n");
    if (header_end == std::string::npos) {
        header_end = raw.find("\n\n");
        if (header_end != std::string::npos) {
            resp.headers = raw.substr(0, header_end);
            resp.body = raw.substr(header_end + 2);
        } else {
            resp.headers = raw;
        }
    } else {
        resp.headers = raw.substr(0, header_end);
        resp.body = raw.substr(header_end + 4);
    }

    std::istringstream hss(resp.headers);
    std::string http_ver;
    hss >> http_ver >> resp.status_code;

    return resp;
}

} // namespace

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Document Mentions Service & REST API Test Suite     ===\n";
    std::cout << "===============================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_mentions_test_storage";
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

    // 2. Seed Users & Document
    std::cout << "\n[STEP 2] Seeding test users (mention_alice, mention_bob)...\n";
    std::string alice_id;
    std::string bob_id;
    std::string doc_id;
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string pw_hash = cme::auth::hash_password_bcrypt("secret123");

        // Alice (Author)
        auto a_rows = tx.exec_params("SELECT id FROM users WHERE username = 'mention_alice';");
        if (a_rows.empty()) {
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ('mention_alice', $1, 'Alice Author', '#3b82f6', TRUE) RETURNING id;",
                pw_hash
            );
            alice_id = ins[0][0].as<std::string>();
        } else {
            alice_id = a_rows[0][0].as<std::string>();
        }

        // Bob (Recipient)
        auto b_rows = tx.exec_params("SELECT id FROM users WHERE username = 'mention_bob';");
        if (b_rows.empty()) {
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ('mention_bob', $1, 'Bob Recipient', '#10b981', FALSE) RETURNING id;",
                pw_hash
            );
            bob_id = ins[0][0].as<std::string>();
        } else {
            bob_id = b_rows[0][0].as<std::string>();
        }

        // Seed Document
        tx.exec("DELETE FROM documents WHERE fs_path = 'specs/mentions_doc.md';");
        auto d_rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('specs/mentions_doc.md', 'Mentions Test Document', $1::uuid) "
            "RETURNING id;",
            alice_id
        );
        doc_id = d_rows[0][0].as<std::string>();

        // Clean any existing mentions for this document
        tx.exec_params("DELETE FROM document_mentions WHERE document_id = $1::uuid;", doc_id);

        tx.commit();
        std::cout << "  - Seeded Alice (id: " << alice_id << ") and Bob (id: " << bob_id << ")\n";
        std::cout << "  - Seeded Document: " << doc_id << "\n";
    }

    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage);
    auto doc_service = std::make_shared<cme::document::DocumentService>(pool, storage);

    // 3. Test Service-Level Mention Reconciliation
    std::cout << "\n[STEP 3] Testing mention reconciliation with initial content...\n";
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string markdown =
            "# Project Overview\n\n"
            "Hey @mention_bob please review the release plan below.\n\n"
            "```\n"
            "Code block with @mention_bob should be skipped\n"
            "```\n";

        auto rec_res = cme::document::DocumentService::reconcile_document_mentions(
            tx, doc_id, alice_id, markdown
        );
        assert(rec_res.has_value());
        tx.commit();
    }

    // Verify unread count and list_mentions
    {
        auto unread_cnt = doc_service->get_unread_mentions_count(bob_id);
        assert(unread_cnt.has_value());
        assert(unread_cnt.value() == 1);

        auto list_res = doc_service->list_mentions(bob_id, "UNREAD");
        assert(list_res.has_value());
        assert(list_res.value().mentions.size() == 1);
        const auto& m = list_res.value().mentions[0];
        assert(m.recipient_id == bob_id);
        assert(m.author_username == "mention_alice");
        assert(m.document_title == "Mentions Test Document");
        assert(m.status == "UNREAD");
        assert(m.heading_anchor == "project-overview");
        assert(m.context_snippet.find("@mention_bob") != std::string::npos);
        std::cout << "  - Initial mention verified: ID " << m.id << " snippet: '" << m.context_snippet << "'\n";

        // 4. Test Acknowledge Mention
        std::cout << "\n[STEP 4] Acknowledging mention for Bob...\n";
        auto ack_res = doc_service->acknowledge_mention(m.id, bob_id);
        assert(ack_res.has_value());

        // Unread count should now be 0
        auto unread_after = doc_service->get_unread_mentions_count(bob_id);
        assert(unread_after.has_value() && unread_after.value() == 0);

        // Filter ACKNOWLEDGED should return it
        auto ack_list = doc_service->list_mentions(bob_id, "ACKNOWLEDGED");
        assert(ack_list.has_value() && ack_list.value().mentions.size() == 1);
        assert(ack_list.value().mentions[0].status == "ACKNOWLEDGED");
        assert(!ack_list.value().mentions[0].acknowledged_at.empty());
        std::cout << "  - Mention marked ACKNOWLEDGED. Acknowledged at: " << ack_list.value().mentions[0].acknowledged_at << "\n";
    }

    // 5. Test Status Preservation on Edit
    std::cout << "\n[STEP 5] Testing ACK status preservation when document is edited...\n";
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        // Document edited with extra text around the mention
        std::string updated_markdown =
            "# Project Overview\n\n"
            "Hey @mention_bob please review the release plan below.\n"
            "Added some new notes right here.\n";

        auto rec_res = cme::document::DocumentService::reconcile_document_mentions(
            tx, doc_id, alice_id, updated_markdown
        );
        assert(rec_res.has_value());
        tx.commit();

        // Mention should still be ACKNOWLEDGED
        auto ack_list = doc_service->list_mentions(bob_id, "ACKNOWLEDGED");
        assert(ack_list.has_value() && ack_list.value().mentions.size() == 1);
        assert(ack_list.value().mentions[0].status == "ACKNOWLEDGED");

        auto unread_cnt = doc_service->get_unread_mentions_count(bob_id);
        assert(unread_cnt.has_value() && unread_cnt.value() == 0);
        std::cout << "  - ACK status successfully preserved across document revision.\n";
    }

    // 6. Test Mention Deletion (is_active = FALSE)
    std::cout << "\n[STEP 6] Testing mention deactivation when deleted from document text...\n";
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string cleared_markdown =
            "# Project Overview\n\n"
            "Mention was removed from this text completely.\n";

        auto rec_res = cme::document::DocumentService::reconcile_document_mentions(
            tx, doc_id, alice_id, cleared_markdown
        );
        assert(rec_res.has_value());
        tx.commit();

        auto all_list = doc_service->list_mentions(bob_id, "ALL");
        assert(all_list.has_value() && all_list.value().mentions.empty());
        std::cout << "  - Mention successfully marked inactive when removed.\n";
    }

    // 7. Test acknowledge_all_mentions
    std::cout << "\n[STEP 7] Testing acknowledge_all_mentions with multiple active mentions...\n";
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string multi_markdown =
            "# Section A\n\n"
            "First mention: @mention_bob take a look.\n\n"
            "# Section B\n\n"
            "Second mention: @mention_bob here is another item.\n";

        auto rec_res = cme::document::DocumentService::reconcile_document_mentions(
            tx, doc_id, alice_id, multi_markdown
        );
        assert(rec_res.has_value());
        tx.commit();

        auto unread_cnt = doc_service->get_unread_mentions_count(bob_id);
        assert(unread_cnt.has_value() && unread_cnt.value() == 2);

        auto ack_all_res = doc_service->acknowledge_all_mentions(bob_id);
        assert(ack_all_res.has_value() && ack_all_res.value() == 2);

        auto unread_after = doc_service->get_unread_mentions_count(bob_id);
        assert(unread_after.has_value() && unread_after.value() == 0);
        std::cout << "  - Successfully batch-acknowledged 2 mentions.\n";
    }

    // 8. Test Mention Candidates Autocomplete
    std::cout << "\n[STEP 8] Testing get_mention_candidates query...\n";
    {
        auto cand_res = doc_service->get_mention_candidates("mention_");
        assert(cand_res.has_value());
        assert(cand_res.value().is_array());
        assert(cand_res.value().size() >= 2);
        std::cout << "  - Autocomplete candidate count: " << cand_res.value().size() << "\n";
    }

    // 9. Test REST Endpoints via HTTP
    std::cout << "\n[STEP 9] Launching CME Server daemon on port 18096 for REST API verification...\n";
    std::filesystem::path admin_cfg = std::filesystem::temp_directory_path() / "cme_mentions_admin.txt";
    {
        std::ofstream out(admin_cfg);
        out << "mention_alice\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);

    auto sess_bob = session_mgr.create_session(bob_id, 24, "127.0.0.1", "MentionsTest-Bob");
    assert(sess_bob.has_value());
    std::string bob_token = sess_bob->raw_token;

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18096;
    srv_cfg.storage.root_path = test_storage.string();
    srv_cfg.database.url = db_url;
    srv_cfg.database.lease_enabled = false;
    srv_cfg.authz.admin_provider = "file";
    srv_cfg.authz.admin_file_path = admin_cfg.string();

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    std::string base_url = "http://127.0.0.1:18096";

    // Inject 1 unread mention for Bob
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string single_markdown =
            "# Final Review\n\n"
            "@mention_bob please approve this change before release.\n";

        auto rec_res = cme::document::DocumentService::reconcile_document_mentions(
            tx, doc_id, alice_id, single_markdown
        );
        assert(rec_res.has_value());
        tx.commit();
    }

    std::vector<std::string> auth_headers = {
        "Authorization: Bearer " + bob_token,
        "Content-Type: application/json"
    };

    // A. GET /api/v1/mentions/count
    std::cout << "  -> Testing GET /api/v1/mentions/count...\n";
    auto cnt_resp = http_curl("GET", base_url + "/api/v1/mentions/count", auth_headers);
    assert(cnt_resp.status_code == 200);
    auto cnt_json = nlohmann::json::parse(cnt_resp.body);
    assert(cnt_json["unread_count"] == 1);
    std::cout << "     [PASS] Unread count: " << cnt_json["unread_count"] << "\n";

    // B. GET /api/v1/mentions
    std::cout << "  -> Testing GET /api/v1/mentions?status=UNREAD...\n";
    auto list_resp = http_curl("GET", base_url + "/api/v1/mentions?status=UNREAD", auth_headers);
    assert(list_resp.status_code == 200);
    auto list_json = nlohmann::json::parse(list_resp.body);
    assert(list_json["mentions"].size() == 1);
    std::string mention_id = list_json["mentions"][0]["id"];
    std::cout << "     [PASS] Found mention ID: " << mention_id << "\n";

    // C. PATCH /api/v1/mentions/:id/ack
    std::cout << "  -> Testing PATCH /api/v1/mentions/" << mention_id << "/ack...\n";
    auto ack_resp = http_curl("PATCH", base_url + "/api/v1/mentions/" + mention_id + "/ack", auth_headers);
    assert(ack_resp.status_code == 200);
    auto ack_json = nlohmann::json::parse(ack_resp.body);
    assert(ack_json["status"] == "acknowledged");
    std::cout << "     [PASS] Mention acknowledged via REST API.\n";

    // D. Check count is 0
    auto cnt_resp2 = http_curl("GET", base_url + "/api/v1/mentions/count", auth_headers);
    assert(cnt_resp2.status_code == 200);
    auto cnt_json2 = nlohmann::json::parse(cnt_resp2.body);
    assert(cnt_json2["unread_count"] == 0);

    // E. GET /api/v1/users/mention-candidates?q=mention_
    std::cout << "  -> Testing GET /api/v1/users/mention-candidates?q=mention_...\n";
    auto cand_resp = http_curl("GET", base_url + "/api/v1/users/mention-candidates?q=mention_", auth_headers);
    assert(cand_resp.status_code == 200);
    auto cand_json = nlohmann::json::parse(cand_resp.body);
    assert(cand_json.is_array());
    assert(cand_json.size() >= 2);
    std::cout << "     [PASS] Candidates returned: " << cand_json.dump() << "\n";

    // Clean up
    server->stop();
    if (server_thread.joinable()) {
        server_thread.join();
    }
    std::filesystem::remove_all(test_storage);
    std::filesystem::remove(admin_cfg);

    std::cout << "\n[ALL TESTS PASSED] Mentions service and REST API verified successfully!\n";
    return 0;
}
