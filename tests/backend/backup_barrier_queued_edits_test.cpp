#include "cme/server/server.hpp"
#include "cme/collab/document_room.hpp"
#include "cme/collab/room_manager.hpp"
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

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== Reproducing Issue #23: Edits dropped during backup barrier   ===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = cme::db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed admin user & test document
    std::string user_id;
    std::string doc_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path = 'notes/issue23.md';");
        tx.exec("DELETE FROM users WHERE username = 'repro23_admin';");
        std::string pw_hash = cme::auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('repro23_admin', $1, 'Repro 23 Admin', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();

        auto d_res = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('notes/issue23.md', 'Issue 23 Doc', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc_id = d_res[0][0].as<std::string>();
        tx.commit();
    }

    std::filesystem::path server_storage = std::filesystem::temp_directory_path() / "cme_repro23_storage";
    std::filesystem::remove_all(server_storage);
    std::filesystem::create_directories(server_storage / "notes");
    {
        std::ofstream out(server_storage / "notes" / "issue23.md");
        out << "# Issue 23 Document\nInitial baseline text.\n";
    }

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18097;
    srv_cfg.storage.root_path = server_storage.string();
    srv_cfg.database.url = db_url;

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18097";
    std::string ws_url = "ws://127.0.0.1:18097/ws/collab/" + doc_id;

    // Generate token
    auto sess_res = server->session_manager()->create_session(user_id, 24, "127.0.0.1", "Repro23");
    assert(sess_res.has_value());
    std::string token = sess_res->raw_token;

    // Run python script
    std::ostringstream cmd;
    cmd << "python3 tests/backend/backup_barrier_queued_edits_runner.py "
        << base_url << " "
        << ws_url << " "
        << token << " "
        << doc_id;

    std::cout << "Invoking runner: " << cmd.str() << "\n\n";
    int ret = std::system(cmd.str().c_str());

    server->stop();
    if (server_thread.joinable()) server_thread.join();
    std::filesystem::remove_all(server_storage);

    return ret;
}
