#include "cme/server/server.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/document/document_service.hpp"
#include <cassert>
#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <sstream>

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== CME WebSocket Collaboration & Protocol Test Suite ===\n";
    std::cout << "========================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_ws_test_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage / "content");

    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    // 1. Run Migrations
    std::cout << "\n[STEP 1] Running schema migrations on test database...\n";
    {
        auto conn = pool->acquire();
        assert(conn.has_value());
        auto mig_res = cme::db::MigrationRunner::apply_migrations(conn->get(), "migrations");
        assert(mig_res.has_value());
        std::cout << "  - Migrations applied successfully.\n";
    }

    // 2. Setup Test User and Test Document
    std::cout << "\n[STEP 2] Seeding test user and test document...\n";
    std::string user_id;
    std::string doc_id;
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        // Create or get user
        auto u_rows = tx.exec_params(
            "SELECT id FROM users WHERE username = 'ws_tester';"
        );
        if (u_rows.empty()) {
            std::string pw_hash = cme::auth::hash_password_bcrypt("password123");
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color) "
                "VALUES ('ws_tester', $1, 'WebSocket Tester', '#3b82f6') "
                "RETURNING id;",
                pw_hash
            );
            user_id = ins[0][0].as<std::string>();
        } else {
            user_id = u_rows[0][0].as<std::string>();
        }

        // Clean up any previous test doc
        tx.exec("DELETE FROM documents WHERE fs_path = 'guides/ws_intro.md';");

        // Insert document
        auto doc_rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('guides/ws_intro.md', 'WebSocket Introduction', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc_id = doc_rows[0][0].as<std::string>();

        tx.commit();
        std::cout << "  - Seeded user_id: " << user_id << "\n";
        std::cout << "  - Seeded doc_id: " << doc_id << "\n";
    }

    // Write initial markdown file to storage
    {
        std::filesystem::create_directories(test_storage / "content" / "guides");
        std::ofstream out(test_storage / "content" / "guides" / "ws_intro.md");
        out << "# Collaborative Intro\n\nWelcome to real-time editing!\n";
    }

    // 3. Generate Session Token
    std::cout << "\n[STEP 3] Generating session token for ws_tester...\n";
    std::filesystem::path admin_cfg = std::filesystem::temp_directory_path() / "cme_ws_admin.txt";
    {
        std::ofstream out(admin_cfg);
        out << "admin_user\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);
    auto sess_res = session_mgr.create_session(user_id, 24, "127.0.0.1", "CME-WSTestRunner");
    assert(sess_res.has_value());
    std::string token = sess_res->raw_token;
    std::cout << "  - Generated session token: " << token.substr(0, 16) << "...\n";

    // 4. Configure & Start Server Daemon
    std::cout << "\n[STEP 4] Launching CME Server daemon on port 18086...\n";
    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18086;
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
    std::cout << "  - Server daemon initialized and listening.\n";

    // 5. Execute tests/ws_protocol_runner.py
    std::cout << "\n[STEP 5] Invoking Python WebSocket Protocol Runner...\n";
    std::ostringstream cmd;
    cmd << "python3 tests/ws_protocol_runner.py"
        << " --url ws://127.0.0.1:18086/ws/collab/" << doc_id
        << " --token " << token;

    std::cout << "Executing: " << cmd.str() << "\n\n";
    int ret = std::system(cmd.str().c_str());
    assert(ret == 0);
    std::cout << "\n[STEP 6] Python test runner completed successfully (code 0).\n";

    // 6. Test Server-side Review Event Broadcast
    std::cout << "\n[STEP 7] Testing server.broadcast_review_event()...\n";
    nlohmann::json test_event = {
        {"event", "COMMENT_CREATED"},
        {"document_id", doc_id},
        {"comment", {
            {"id", "comm_xyz"},
            {"content", "Real-time comment from daemon"}
        }}
    };
    server->broadcast_review_event(doc_id, test_event);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    std::cout << "  - broadcast_review_event dispatched without exceptions.\n";

    // 7. Cleanup & Graceful Shutdown
    std::cout << "\n[STEP 8] Shutting down server daemon...\n";
    server->stop();
    if (server_thread.joinable()) {
        server_thread.join();
    }
    std::cout << "  - Server terminated cleanly.\n";

    std::filesystem::remove_all(test_storage);
    std::filesystem::remove(admin_cfg);

    // Clean up test database records
    try {
        pqxx::connection conn(db_url);
        pqxx::work clean_tx(conn);
        clean_tx.exec("DELETE FROM documents WHERE fs_path = 'guides/ws_intro.md';");
        clean_tx.exec("DELETE FROM users WHERE username = 'ws_tester';");
        clean_tx.commit();
    } catch (...) {}

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL WEBSOCKET TESTS PASSED (100% SUCCESS)         ===\n";
    std::cout << "========================================================\n";

    return 0;
}
