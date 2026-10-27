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
    std::string out_file = "/tmp/cme_rename_live_rooms_curl_out.txt";
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
    std::cout << "=== CME Folder Rename / Delete Live Rooms Test (Issue #26)       ===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_rename_live_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage / "test_dir" / "subdir");
    std::filesystem::create_directories(test_storage / "other_dir");
    std::filesystem::create_directories(test_storage / "to_delete");

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed user & documents
    std::string user_id;
    std::string doc1_id, doc2_id, doc3_id, doc_del_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'test_dir%' OR fs_path LIKE 'renamed_dir%' OR fs_path LIKE 'other_dir%' OR fs_path LIKE 'to_delete%';");
        tx.exec("DELETE FROM users WHERE username = 'issue26_tester';");
        std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('issue26_tester', $1, 'Issue 26 Tester', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();

        auto d1 = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('test_dir/doc1.md', 'Doc 1', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc1_id = d1[0][0].as<std::string>();

        auto d2 = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('test_dir/subdir/doc2.md', 'Doc 2', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc2_id = d2[0][0].as<std::string>();

        auto d3 = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('other_dir/doc3.md', 'Doc 3', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc3_id = d3[0][0].as<std::string>();

        auto dd = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('to_delete/note.md', 'Note Del', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc_del_id = dd[0][0].as<std::string>();

        tx.commit();
    }

    auto storage = std::make_shared<storage::PosixStorageBackend>(test_storage);
    const std::string initial_content1 = "# Doc 1 Initial\n";
    const std::string initial_content2 = "# Doc 2 Initial\n";
    const std::string initial_content3 = "# Doc 3 Initial\n";
    const std::string initial_content_del = "# To Delete Initial\n";

    assert(storage->write_file("test_dir/doc1.md", initial_content1, true).has_value());
    assert(storage->write_file("test_dir/subdir/doc2.md", initial_content2, true).has_value());
    assert(storage->write_file("other_dir/doc3.md", initial_content3, true).has_value());
    assert(storage->write_file("to_delete/note.md", initial_content_del, true).has_value());

    // Configure and start Server
    config::AppConfig cfg;
    cfg.server.bind = "127.0.0.1";
    cfg.server.port = 18126;
    cfg.database.url = db_url;
    cfg.database.lease_enabled = false;
    cfg.storage.backend = "posix";
    cfg.storage.root_path = test_storage.string();

    auto server = std::make_shared<server::Server>(cfg);
    std::thread s_thread([server]() {
        server->start();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    std::cout << "[INFO] Server started on port 18126.\n";

    // Authenticate
    std::string token;
    {
        std::string token_body = "{\"username\":\"issue26_tester\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", "http://127.0.0.1:18126/api/v1/auth/tokens", {"Content-Type: application/json"}, token_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        token = json["token"].get<std::string>();
    }

    // Step 1: Open live rooms
    std::cout << "[STEP 1] Opening live collaborative rooms...\n";
    auto room1 = server->room_manager()->get_or_create_room(doc1_id, initial_content1, "test_dir/doc1.md");
    auto room2 = server->room_manager()->get_or_create_room(doc2_id, initial_content2, "test_dir/subdir/doc2.md");
    auto room3 = server->room_manager()->get_or_create_room(doc3_id, initial_content3, "other_dir/doc3.md");
    auto room_del = server->room_manager()->get_or_create_room(doc_del_id, initial_content_del, "to_delete/note.md");

    assert(room1->fs_path() == "test_dir/doc1.md");
    assert(room2->fs_path() == "test_dir/subdir/doc2.md");
    assert(room3->fs_path() == "other_dir/doc3.md");
    assert(room_del->fs_path() == "to_delete/note.md");

    // Step 2: Rename test_dir -> renamed_dir
    std::cout << "[STEP 2] Renaming directory test_dir -> renamed_dir...\n";
    nlohmann::json rename_body = {
        {"old_path", "test_dir"},
        {"new_path", "renamed_dir"}
    };
    auto resp = http_curl(
        "PATCH",
        "http://127.0.0.1:18126/api/v1/workspaces/directories",
        {"Authorization: Bearer " + token, "Content-Type: application/json"},
        rename_body.dump()
    );
    assert(resp.status_code == 200);

    // Verify in-memory live rooms were updated
    std::cout << "[STEP 3] Verifying in-memory room paths...\n";
    assert(room1->fs_path() == "renamed_dir/doc1.md");
    assert(room2->fs_path() == "renamed_dir/subdir/doc2.md");
    assert(room3->fs_path() == "other_dir/doc3.md"); // Unrelated directory unchanged

    // Step 4: Collaborators make edits in live rooms
    std::cout << "[STEP 4] Collaborators edit room1 and room2...\n";
    const std::string edit1 = "# Edit 1\n";
    const std::string edit2 = "# Edit 2\n";
    room1->insert_text(0, edit1);
    room2->insert_text(0, edit2);
    assert(room1->is_dirty());
    assert(room2->is_dirty());

    // Flush dirty rooms to storage
    server->persistence_worker()->flush_all_dirty();
    assert(!room1->is_dirty());
    assert(!room2->is_dirty());

    // Verify storage: new paths exist with edits; old path was NOT recreated
    assert(storage->exists("renamed_dir/doc1.md").value() == true);
    assert(storage->exists("renamed_dir/subdir/doc2.md").value() == true);
    assert(storage->exists("test_dir").value() == false);
    assert(storage->exists("test_dir/doc1.md").value() == false);
    assert(storage->exists("test_dir/subdir/doc2.md").value() == false);

    auto content1 = storage->read_file("renamed_dir/doc1.md").value();
    assert(content1.starts_with("# Edit 1\n"));
    auto content2 = storage->read_file("renamed_dir/subdir/doc2.md").value();
    assert(content2.starts_with("# Edit 2\n"));
    std::cout << "  - Disk verified: edits flushed correctly to renamed paths without recreating old folder.\n";

    // Step 5: Test directory deletion evicts open rooms
    std::cout << "[STEP 5] Testing directory deletion with open active room...\n";
    // Collaborator makes edit in room_del before deletion
    room_del->insert_text(0, "# Dirty edit before delete\n");
    assert(room_del->is_dirty());

    nlohmann::json del_body = {
        {"path", "to_delete"}
    };
    auto del_resp = http_curl(
        "DELETE",
        "http://127.0.0.1:18126/api/v1/workspaces/directories",
        {"Authorization: Bearer " + token, "Content-Type: application/json"},
        del_body.dump()
    );
    assert(del_resp.status_code == 200);

    // Verify room was marked clean and evicted from room_manager
    assert(server->room_manager()->get_room(doc_del_id) == nullptr);
    assert(!room_del->is_dirty());

    // Persistence worker flush should NOT recreate to_delete
    server->persistence_worker()->flush_all_dirty();
    assert(storage->exists("to_delete").value() == false);
    assert(storage->exists("to_delete/note.md").value() == false);
    std::cout << "  - Deletion verified: room evicted and marked clean; deleted folder not recreated.\n";

    // Cleanup
    server->stop();
    s_thread.join();
    std::filesystem::remove_all(test_storage);

    std::cout << "====================================================================\n";
    std::cout << "=== ALL CHECKS PASSED: Issue #26 Regression Test Succeeded       ===\n";
    std::cout << "====================================================================\n";

    return 0;
}
