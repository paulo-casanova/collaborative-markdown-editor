#include "cme/server/server.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
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
    std::string out_file = "/tmp/cme_review_curl_out.txt";
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

std::vector<nlohmann::json> read_events_file(const std::string& path) {
    std::vector<nlohmann::json> events;
    std::ifstream in(path);
    if (!in.is_open()) return events;
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty()) {
            try {
                events.push_back(nlohmann::json::parse(line));
            } catch (...) {}
        }
    }
    return events;
}

} // namespace

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Review Engine & Real-Time Sync Test Suite (Step 3.4) ===\n";
    std::cout << "===============================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_review_test_storage";
    std::filesystem::remove_all(test_storage);
    std::string events_file = "/tmp/cme_review_events.jsonl";
    std::string ready_file = "/tmp/cme_review_events.ready";
    std::filesystem::remove(events_file);
    std::filesystem::remove(ready_file);

    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    // 1. Migrations
    std::cout << "\n[STEP 1] Running schema migrations on test database...\n";
    {
        auto conn = pool->acquire();
        assert(conn.has_value());
        auto mig_res = cme::db::MigrationRunner::apply_migrations(conn->get(), "migrations");
        assert(mig_res.has_value());
        std::cout << "  - Migrations validated.\n";
    }

    // 2. Seed Users & Document
    std::cout << "\n[STEP 2] Seeding test users (Alice, Bob) and document...\n";
    std::string alice_id;
    std::string bob_id;
    std::string doc_id;
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string pw_hash = cme::auth::hash_password_bcrypt("secret123");

        // Alice (Admin)
        auto a_rows = tx.exec_params("SELECT id FROM users WHERE username = 'rev_alice';");
        if (a_rows.empty()) {
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ('rev_alice', $1, 'Alice Admin', '#3b82f6', TRUE) RETURNING id;",
                pw_hash
            );
            alice_id = ins[0][0].as<std::string>();
        } else {
            alice_id = a_rows[0][0].as<std::string>();
        }

        // Bob (Reviewer)
        auto b_rows = tx.exec_params("SELECT id FROM users WHERE username = 'rev_bob';");
        if (b_rows.empty()) {
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ('rev_bob', $1, 'Bob Reviewer', '#10b981', FALSE) RETURNING id;",
                pw_hash
            );
            bob_id = ins[0][0].as<std::string>();
        } else {
            bob_id = b_rows[0][0].as<std::string>();
        }

        // Document
        tx.exec("DELETE FROM documents WHERE fs_path = 'specs/review_flow.md';");
        auto d_rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('specs/review_flow.md', 'Review Engine Specifications', $1::uuid) "
            "RETURNING id;",
            alice_id
        );
        doc_id = d_rows[0][0].as<std::string>();

        // Grant Bob COMMENT access to the document
        tx.exec_params(
            "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
            "VALUES ('DOCUMENT', $1::uuid, 'USER', $2::uuid, 'COMMENT') "
            "ON CONFLICT DO NOTHING;",
            doc_id, bob_id
        );

        tx.commit();
        std::cout << "  - Seeded Alice (id: " << alice_id << ") and Bob (id: " << bob_id << ")\n";
        std::cout << "  - Seeded Document: " << doc_id << "\n";
    }

    // Write initial document to disk
    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage);
    const std::string initial_content = "# Review Engine\n\nThis is the original text that needs review.\nHere is line three.\n";
    assert(storage->write_file("specs/review_flow.md", initial_content, true).has_value());

    // 3. Issue Session Tokens
    std::cout << "\n[STEP 3] Issuing session tokens...\n";
    std::filesystem::path admin_cfg = std::filesystem::temp_directory_path() / "cme_review_admin.txt";
    {
        std::ofstream out(admin_cfg);
        out << "rev_alice\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);

    auto sess_alice = session_mgr.create_session(alice_id, 24, "127.0.0.1", "ReviewTest-Alice");
    assert(sess_alice.has_value());
    std::string alice_token = sess_alice->raw_token;

    auto sess_bob = session_mgr.create_session(bob_id, 24, "127.0.0.1", "ReviewTest-Bob");
    assert(sess_bob.has_value());
    std::string bob_token = sess_bob->raw_token;

    // 4. Start Server Daemon
    std::cout << "\n[STEP 4] Launching CME Server daemon on port 18095...\n";
    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18095;
    srv_cfg.storage.root_path = test_storage.string();
    srv_cfg.database.url = db_url;
    srv_cfg.authz.admin_provider = "file";
    srv_cfg.authz.admin_file_path = admin_cfg.string();

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    assert(server->review_service() != nullptr);
    std::string base_url = "http://127.0.0.1:18095";

    // 5. Connect WebSocket Review Event Listener
    std::cout << "\n[STEP 5] Spawning WebSocket Review Listener (Opcode 0x02)...\n";
    std::string listener_cmd = "python3 tests/ws_review_listener.py"
                               " --url ws://127.0.0.1:18095/ws/collab/" + doc_id +
                               " --token " + alice_token +
                               " --events-file " + events_file + " > /dev/null 2>&1 &";
    int ret = std::system(listener_cmd.c_str());
    assert(ret == 0);

    // Wait for listener to connect and write .ready file
    for (int i = 0; i < 40; ++i) {
        if (std::filesystem::exists(ready_file)) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    assert(std::filesystem::exists(ready_file));
    std::cout << "  - WebSocket listener connected to room and listening for 0x02 frames.\n";

    // =========================================================================
    // 6. Threaded Comments Testing & Real-Time Broadcasting
    // =========================================================================
    std::cout << "\n[STEP 6] Testing Threaded Comments & Real-Time Event Fanout...\n";

    // 6.1 Bob creates anchored root comment
    std::string comment_id;
    {
        nlohmann::json body = {
            {"content", "This paragraph needs further clarification on concurrency."},
            {"anchor", {
                {"type", "text-quote"},
                {"exact", "original text that needs review"},
                {"prefix", "This is the "},
                {"suffix", ".\nHere is line three"}
            }}
        };
        auto resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + doc_id + "/comments",
            {"Content-Type: application/json", "Authorization: Bearer " + bob_token},
            body.dump()
        );
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("id"));
        comment_id = json["id"].get<std::string>();
        assert(json["content"] == "This paragraph needs further clarification on concurrency.");
        assert(json["status"] == "OPEN");
        assert(json["author"]["username"] == "rev_bob");
        std::cout << "  - Created root comment (id: " << comment_id << ").\n";
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    auto events = read_events_file(events_file);
    assert(!events.empty());
    assert(events.back()["event"] == "COMMENT_CREATED");
    assert(events.back()["comment"]["id"] == comment_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received COMMENT_CREATED notification!\n";

    // 6.2 Alice posts a reply to Bob's comment
    std::string reply_id;
    {
        nlohmann::json body = {
            {"content", "Acknowledged, I will rephrase this section."}
        };
        auto resp = http_curl(
            "POST",
            base_url + "/api/v1/comments/" + comment_id + "/replies",
            {"Content-Type: application/json", "Authorization: Bearer " + alice_token},
            body.dump()
        );
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("id"));
        reply_id = json["id"].get<std::string>();
        assert(json["parent_id"] == comment_id);
        assert(json["author"]["username"] == "rev_alice");
        std::cout << "  - Created reply (id: " << reply_id << ").\n";
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "COMMENT_REPLIED");
    assert(events.back()["parent_id"] == comment_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received COMMENT_REPLIED notification!\n";

    // 6.3 List comments (verifying reply nesting)
    {
        auto resp = http_curl(
            "GET",
            base_url + "/api/v1/documents/" + doc_id + "/comments",
            {"Authorization: Bearer " + bob_token}
        );
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.is_array());
        assert(json.size() == 1);
        assert(json[0]["id"] == comment_id);
        assert(json[0]["replies"].is_array());
        assert(json[0]["replies"].size() == 1);
        assert(json[0]["replies"][0]["id"] == reply_id);
        std::cout << "  [PASS] Threaded comment hierarchy verified (root with nested replies).\n";
    }

    // 6.4 Alice resolves comment thread
    {
        nlohmann::json body = {{"status", "RESOLVED"}};
        auto resp = http_curl(
            "PATCH",
            base_url + "/api/v1/comments/" + comment_id + "/status",
            {"Content-Type: application/json", "Authorization: Bearer " + alice_token},
            body.dump()
        );
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["status"] == "RESOLVED");
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "COMMENT_STATUS_CHANGED");
    assert(events.back()["status"] == "RESOLVED");
    std::cout << "  [PASS] WebSocket Opcode 0x02 received COMMENT_STATUS_CHANGED notification!\n";

    // =========================================================================
    // 7. Inline Suggestions Testing & Live CRDT Injection
    // =========================================================================
    std::cout << "\n[STEP 7] Testing Inline Edit Suggestions & Live CRDT Text Injection...\n";

    // 7.1 Bob submits edit suggestion
    std::string sug_id;
    {
        nlohmann::json body = {
            {"original_text", "original text that needs review"},
            {"suggested_text", "refined and accepted text"},
            {"anchor", {{"offset", 26}, {"length", 30}}}
        };
        auto resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + doc_id + "/suggestions",
            {"Content-Type: application/json", "Authorization: Bearer " + bob_token},
            body.dump()
        );
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        sug_id = json["id"].get<std::string>();
        assert(json["status"] == "PENDING");
        assert(json["author"]["username"] == "rev_bob");
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "SUGGESTION_CREATED");
    assert(events.back()["suggestion"]["id"] == sug_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received SUGGESTION_CREATED notification!\n";

    // 7.2 Submit a dummy suggestion and reject it
    std::string dummy_sug_id;
    {
        nlohmann::json body = {
            {"original_text", "line three"},
            {"suggested_text", "line four"}
        };
        auto resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + doc_id + "/suggestions",
            {"Content-Type: application/json", "Authorization: Bearer " + bob_token},
            body.dump()
        );
        assert(resp.status_code == 201);
        dummy_sug_id = nlohmann::json::parse(resp.body)["id"].get<std::string>();

        // Alice rejects it
        auto rej_resp = http_curl(
            "POST",
            base_url + "/api/v1/suggestions/" + dummy_sug_id + "/reject",
            {"Authorization: Bearer " + alice_token}
        );
        assert(rej_resp.status_code == 200);
        assert(nlohmann::json::parse(rej_resp.body)["status"] == "REJECTED");
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "SUGGESTION_REJECTED");
    assert(events.back()["suggestion_id"] == dummy_sug_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received SUGGESTION_REJECTED notification!\n";

    // 7.3 Alice accepts Bob's first suggestion -> CRDT text must be injected into room
    {
        auto acc_resp = http_curl(
            "POST",
            base_url + "/api/v1/suggestions/" + sug_id + "/accept",
            {"Authorization: Bearer " + alice_token}
        );
        assert(acc_resp.status_code == 200);
        auto json = nlohmann::json::parse(acc_resp.body);
        assert(json["status"] == "ACCEPTED");
        assert(!json["resolved_at"].is_null());
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "SUGGESTION_ACCEPTED");
    assert(events.back()["suggestion"]["id"] == sug_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received SUGGESTION_ACCEPTED notification!\n";

    // Verify live CRDT document content updated in DocumentRoom
    {
        auto room = server->room_manager()->get_room(doc_id);
        assert(room != nullptr);
        std::string converged_text = room->get_content();
        assert(converged_text.find("refined and accepted text") != std::string::npos);
        assert(converged_text.find("original text that needs review") == std::string::npos);
        assert(room->is_dirty());
        std::cout << "  [PASS] Live CRDT DocumentRoom updated with accepted suggestion text!\n"
                  << "    New content: " << converged_text.substr(0, 70) << "...\n";
    }

    // =========================================================================
    // 8. Action Item Tasks Testing
    // =========================================================================
    std::cout << "\n[STEP 8] Testing Action Item Tasks Checklist & Events...\n";

    std::string task_id;
    {
        nlohmann::json body = {
            {"description", "Update deployment diagram with replica nodes"},
            {"comment_id", comment_id},
            {"due_date", "2026-10-20T18:00:00Z"}
        };
        auto resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + doc_id + "/tasks",
            {"Content-Type: application/json", "Authorization: Bearer " + bob_token},
            body.dump()
        );
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        task_id = json["id"].get<std::string>();
        assert(json["description"] == "Update deployment diagram with replica nodes");
        assert(json["is_completed"] == false);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "TASK_CREATED");
    assert(events.back()["task"]["id"] == task_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received TASK_CREATED notification!\n";

    // Alice completes the task
    {
        nlohmann::json body = {{"is_completed", true}};
        auto resp = http_curl(
            "PATCH",
            base_url + "/api/v1/tasks/" + task_id,
            {"Content-Type: application/json", "Authorization: Bearer " + alice_token},
            body.dump()
        );
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["is_completed"] == true);
        assert(!json["completed_at"].is_null());
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "TASK_TOGGLED" || events.back()["event"] == "TASK_UPDATED");
    assert(events.back()["task"]["is_completed"] == true);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received TASK_TOGGLED notification!\n";

    // Delete comment
    {
        auto resp = http_curl(
            "DELETE",
            base_url + "/api/v1/comments/" + comment_id,
            {"Authorization: Bearer " + alice_token}
        );
        assert(resp.status_code == 200);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    events = read_events_file(events_file);
    assert(events.back()["event"] == "COMMENT_DELETED");
    assert(events.back()["comment_id"] == comment_id);
    std::cout << "  [PASS] WebSocket Opcode 0x02 received COMMENT_DELETED notification!\n";

    // =========================================================================
    // 9. Teardown & Cleanup
    // =========================================================================
    std::cout << "\n[STEP 9] Terminating listener and server daemon...\n";
    std::system("pkill -f ws_review_listener.py || true");
    server->stop();
    if (server_thread.joinable()) {
        server_thread.join();
    }

    std::filesystem::remove(events_file);
    std::filesystem::remove(ready_file);
    std::filesystem::remove(admin_cfg);
    std::filesystem::remove_all(test_storage);

    std::cout << "\n===============================================================\n";
    std::cout << "=== ALL REVIEW ENGINE & REAL-TIME TESTS PASSED (100% OK)     ===\n";
    std::cout << "===============================================================\n";

    return 0;
}
