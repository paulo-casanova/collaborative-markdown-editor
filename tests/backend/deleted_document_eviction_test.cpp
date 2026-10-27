#include "cme/server/server.hpp"
#include "cme/collab/document_room.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/collab/persistence_worker.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
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

using namespace cme;

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
    std::string out_file = "/tmp/cme_deleted_doc_test_curl_out.txt";
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
    std::cout << "=== CME Deleted Document Room Eviction Test (Issue #27)          ===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_deleted_doc_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage / "folder_del");

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed user & documents
    std::string user_id;
    std::string single_doc_id;
    std::string folder_doc_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'single_del%' OR fs_path LIKE 'folder_del%';");
        tx.exec("DELETE FROM users WHERE username = 'del_doc_tester';");
        std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('del_doc_tester', $1, 'Deleted Doc Tester', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();

        auto d1 = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('single_del.md', 'Single Del', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        single_doc_id = d1[0][0].as<std::string>();

        auto d2 = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('folder_del/nested.md', 'Folder Nested', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        folder_doc_id = d2[0][0].as<std::string>();

        tx.commit();
    }

    auto storage = std::make_shared<storage::PosixStorageBackend>(test_storage);
    const std::string initial_single = "# Single Document Content\n";
    const std::string initial_nested = "# Nested Document Content\n";
    assert(storage->write_file("single_del.md", initial_single, true).has_value());
    assert(storage->write_file("folder_del/nested.md", initial_nested, true).has_value());

    // Configure and start Server
    config::AppConfig cfg;
    cfg.server.bind = "127.0.0.1";
    cfg.server.port = 18128;
    cfg.database.url = db_url;
    cfg.database.lease_enabled = false;
    cfg.storage.backend = "posix";
    cfg.storage.root_path = test_storage.string();

    auto server = std::make_shared<server::Server>(cfg);
    std::thread s_thread([server]() {
        server->start();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    std::cout << "[INFO] Server started on port 18128.\n";

    // Authenticate
    std::string token;
    {
        std::string token_body = "{\"username\":\"del_doc_tester\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", "http://127.0.0.1:18128/api/v1/auth/tokens", {"Content-Type: application/json"}, token_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        token = json["token"].get<std::string>();
    }

    // Step 1: Open live rooms
    std::cout << "[STEP 1] Opening live collaborative rooms...\n";
    auto room_single = server->room_manager()->get_or_create_room(single_doc_id, initial_single, "single_del.md");
    auto room_nested = server->room_manager()->get_or_create_room(folder_doc_id, initial_nested, "folder_del/nested.md");
    assert(room_single != nullptr);
    assert(room_nested != nullptr);

    // Step 2: Delete single document via DELETE /api/v1/documents/:id
    std::cout << "[STEP 2] Calling DELETE /api/v1/documents/" << single_doc_id << "...\n";
    auto del1_resp = http_curl(
        "DELETE",
        "http://127.0.0.1:18128/api/v1/documents/" + single_doc_id,
        {"Authorization: Bearer " + token}
    );
    assert(del1_resp.status_code == 200);

    // Verify room was evicted from RoomManager and marked clean
    assert(server->room_manager()->get_room(single_doc_id) == nullptr);
    assert(!room_single->is_dirty());
    std::cout << "  - Room cleanly evicted from RoomManager.\n";

    // Step 3: Verify PersistenceWorker refuses to resurrect deleted single doc even if edited
    std::cout << "[STEP 3] Collaborator edits in-memory room and triggers flush...\n";
    room_single->insert_text(0, "# Zombie edit\n");
    assert(room_single->is_dirty());

    server->persistence_worker()->flush_room(*room_single);
    assert(!room_single->is_dirty());
    assert(storage->exists("single_del.md").value() == false);
    std::cout << "  - Verified: PersistenceWorker refused flush; file not resurrected on disk.\n";

    // Step 4: Delete folder via DELETE /api/v1/workspaces/directories
    std::cout << "[STEP 4] Calling DELETE /api/v1/workspaces/directories (folder_del)...\n";
    nlohmann::json del_folder_body = {{"path", "folder_del"}};
    auto del2_resp = http_curl(
        "DELETE",
        "http://127.0.0.1:18128/api/v1/workspaces/directories",
        {"Authorization: Bearer " + token, "Content-Type: application/json"},
        del_folder_body.dump()
    );
    assert(del2_resp.status_code == 200);

    // Verify nested room was evicted from RoomManager and marked clean
    assert(server->room_manager()->get_room(folder_doc_id) == nullptr);
    assert(!room_nested->is_dirty());

    // Flush all dirty rooms
    room_nested->insert_text(0, "# Zombie nested edit\n");
    server->persistence_worker()->flush_all_dirty();
    assert(storage->exists("folder_del").value() == false);
    assert(storage->exists("folder_del/nested.md").value() == false);
    std::cout << "  - Verified: folder and nested documents not resurrected on disk.\n";

    // Step 5: Direct PersistenceWorker test with synthetic deleted UUID
    std::cout << "[STEP 5] Testing PersistenceWorker with synthetic non-existent UUID...\n";
    std::string fake_uuid = "00000000-0000-0000-0000-000000000099";
    auto fake_room = std::make_shared<collab::DocumentRoom>(fake_uuid, "fake content", "fake_doc.md");
    fake_room->insert_text(0, "edit\n");
    assert(fake_room->is_dirty());

    auto flush_res = server->persistence_worker()->flush_room(*fake_room);
    assert(flush_res.has_value());
    assert(!fake_room->is_dirty());
    assert(storage->exists("fake_doc.md").value() == false);
    std::cout << "  - Verified: Synthetic non-existent UUID room marked clean and refused to save.\n";

    // Cleanup
    server->stop();
    s_thread.join();
    std::filesystem::remove_all(test_storage);

    std::cout << "====================================================================\n";
    std::cout << "=== ALL CHECKS PASSED: Issue #27 Regression Test Succeeded       ===\n";
    std::cout << "====================================================================\n";

    return 0;
}
