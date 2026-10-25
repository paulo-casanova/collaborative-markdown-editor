#include "cme/server/server.hpp"
#include "cme/collab/document_room.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/collab/persistence_worker.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
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
#include <nlohmann/json.hpp>

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
    std::string out_file = "/tmp/cme_put_active_test_curl_out.txt";
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
    if (hss >> http_ver >> resp.status_code) {
        // Parsed
    }

    return resp;
}

} // namespace

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME REST PUT/PATCH Active Room Synchronization Test (Issue #21)===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = cme::db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed test user
    std::string user_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path = 'notes/issue21_test.md';");
        tx.exec("DELETE FROM users WHERE username = 'issue21_tester';");
        std::string pw_hash = cme::auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('issue21_tester', $1, 'Issue 21 Tester', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();
        tx.commit();
    }

    std::filesystem::path server_storage = std::filesystem::temp_directory_path() / "cme_issue21_storage";
    std::filesystem::remove_all(server_storage);

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18096;
    srv_cfg.storage.root_path = server_storage.string();
    srv_cfg.database.url = db_url;

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18096";

    // Obtain token
    std::string token;
    {
        std::string token_body = "{\"username\":\"issue21_tester\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, token_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        token = json["token"].get<std::string>();
    }
    std::vector<std::string> auth_header = {"Authorization: Bearer " + token};

    // 1. Create document via POST /api/v1/documents
    std::cout << "\n[TEST 1] Creating document and opening in live room...\n";
    std::string doc_id;
    std::string initial_content = "# Original Document\nInitial text.";
    {
        nlohmann::json create_payload = {
            {"path", "notes/issue21_test.md"},
            {"content", initial_content}
        };
        auto resp = http_curl("POST", base_url + "/api/v1/documents", {"Authorization: Bearer " + token, "Content-Type: application/json"}, create_payload.dump());
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        doc_id = json["id"].get<std::string>();
    }

    // Open collaborative room with live peer edit
    auto room = server->room_manager()->get_or_create_room(doc_id, initial_content, "notes/issue21_test.md");
    room->add_peer("peer_alice", "alice", "Alice", "#3b82f6");
    room->insert_text(static_cast<uint32_t>(room->get_content().size()), " (Alice live edit)");
    assert(room->get_content() == "# Original Document\nInitial text. (Alice live edit)");
    std::cout << "  - Live room established with in-memory edit.\n";

    // 2. Execute PUT while document room is active
    std::cout << "\n[TEST 2] Executing REST PUT /api/v1/documents/:id while room is active...\n";
    std::string put_content = "# Updated by Agent\nNew content set via REST PUT.";
    {
        nlohmann::json put_payload = {
            {"content", put_content}
        };
        auto put_resp = http_curl("PUT", base_url + "/api/v1/documents/" + doc_id, {"Authorization: Bearer " + token, "Content-Type: application/json"}, put_payload.dump());
        assert(put_resp.status_code == 200);

        auto put_json = nlohmann::json::parse(put_resp.body);
        assert(put_json["content"] == put_content);
        std::cout << "  - PUT response body contains updated content.\n";

        // Verify live room in memory was updated
        assert(room->get_content() == put_content);
        std::cout << "  - Live room in memory successfully updated.\n";
    }

    // 3. Trigger live room flush and verify disk content is NOT overwritten with stale text
    std::cout << "\n[TEST 3] Triggering room flush (PersistenceWorker save)...\n";
    auto flush_res = server->persistence_worker()->flush_room(*room);
    assert(flush_res.has_value());

    auto disk_read = server->storage()->read_file("notes/issue21_test.md");
    assert(disk_read.has_value());
    assert(disk_read.value() == put_content);
    std::cout << "  - File on disk retains PUT content after persistence flush.\n";

    auto raw_resp = http_curl("GET", base_url + "/api/v1/documents/" + doc_id + "/raw", auth_header);
    assert(raw_resp.status_code == 200);
    assert(raw_resp.body == put_content);
    std::cout << "  - GET /raw endpoint returns PUT content.\n";

    // 4. Execute PATCH with new content while room is active
    std::cout << "\n[TEST 4] Executing REST PATCH /api/v1/documents/:id with new content...\n";
    std::string patch_content = "# Patched by Agent\nNew content set via REST PATCH.";
    {
        nlohmann::json patch_payload = {
            {"content", patch_content}
        };
        auto patch_resp = http_curl("PATCH", base_url + "/api/v1/documents/" + doc_id, {"Authorization: Bearer " + token, "Content-Type: application/json"}, patch_payload.dump());
        assert(patch_resp.status_code == 200);

        auto patch_json = nlohmann::json::parse(patch_resp.body);
        assert(patch_json["content"] == patch_content);

        assert(room->get_content() == patch_content);
        std::cout << "  - PATCH updated both response and live room in memory.\n";

        // Flush and verify disk
        flush_res = server->persistence_worker()->flush_room(*room);
        assert(flush_res.has_value());

        disk_read = server->storage()->read_file("notes/issue21_test.md");
        assert(disk_read.has_value());
        assert(disk_read.value() == patch_content);
        std::cout << "  - Disk content verified matching PATCH update.\n";
    }

    // 5. Execute PATCH without content (metadata only)
    std::cout << "\n[TEST 5] Executing REST PATCH /api/v1/documents/:id for metadata only...\n";
    {
        nlohmann::json meta_payload = {
            {"title", "Brand New Title"}
        };
        auto meta_resp = http_curl("PATCH", base_url + "/api/v1/documents/" + doc_id, {"Authorization: Bearer " + token, "Content-Type: application/json"}, meta_payload.dump());
        assert(meta_resp.status_code == 200);

        auto meta_json = nlohmann::json::parse(meta_resp.body);
        assert(meta_json["title"] == "Brand New Title");
        assert(meta_json["content"] == patch_content);
        assert(room->get_content() == patch_content);
        std::cout << "  - Metadata-only PATCH preserved room content unchanged.\n";
    }

    server->stop();
    if (server_thread.joinable()) server_thread.join();

    std::filesystem::remove_all(server_storage);

    std::cout << "\n====================================================================\n";
    std::cout << "=== ALL REST PUT/PATCH ACTIVE ROOM TESTS PASSED SUCCESSFULLY!    ===\n";
    std::cout << "====================================================================\n";
    return 0;
}
