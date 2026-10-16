#include "cme/server/server.hpp"
#include "cme/collab/persistence_worker.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include <cassert>
#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <sstream>

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Debounced Persistence & Eviction Test Suite (Step 3.3) ===\n";
    std::cout << "===============================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_persist_test_storage";
    std::filesystem::remove_all(test_storage);

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

        auto u_rows = tx.exec_params(
            "SELECT id FROM users WHERE username = 'pers_tester';"
        );
        if (u_rows.empty()) {
            std::string pw_hash = cme::auth::hash_password_bcrypt("password123");
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color) "
                "VALUES ('pers_tester', $1, 'Persistence Tester', '#10b981') "
                "RETURNING id;",
                pw_hash
            );
            user_id = ins[0][0].as<std::string>();
        } else {
            user_id = u_rows[0][0].as<std::string>();
        }

        tx.exec("DELETE FROM documents WHERE fs_path = 'notes/debounced_note.md';");

        auto doc_rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('notes/debounced_note.md', 'Debounced Persistence Test', $1::uuid) "
            "RETURNING id;",
            user_id
        );
        doc_id = doc_rows[0][0].as<std::string>();

        tx.commit();
        std::cout << "  - Seeded user_id: " << user_id << "\n";
        std::cout << "  - Seeded doc_id: " << doc_id << "\n";
    }

    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage);
    const std::string initial_content = "# Initial State\n\nOriginal clean document.\n";
    auto init_write = storage->write_file("notes/debounced_note.md", initial_content, true);
    assert(init_write.has_value());
    std::cout << "  - Initial file created at storage path.\n";

    // 3. Test PersistenceWorker unit semantics (debounced flush, snapshotting, eviction)
    std::cout << "\n[STEP 3] Testing PersistenceWorker unit lifecycle...\n";
    {
        auto room_mgr = std::make_shared<cme::collab::RoomManager>();
        cme::collab::PersistenceConfig pcfg{
            .idle_delay = std::chrono::milliseconds(300),
            .max_interval = std::chrono::milliseconds(2000),
            .check_interval = std::chrono::milliseconds(50),
            .enable_snapshots = true,
            .auto_evict_idle_rooms = true
        };

        cme::collab::PersistenceWorker worker(room_mgr, storage, pool, pcfg);
        worker.start();
        assert(worker.is_running());

        // Create room and assert clean
        auto room = room_mgr->get_or_create_room(doc_id, initial_content, "notes/debounced_note.md");
        assert(room != nullptr);
        assert(!room->is_dirty());
        assert(room_mgr->active_room_count() == 1);

        // Add a collaborator peer
        room->add_peer("peer_alpha", "pers_tester", "Persistence Tester", "#10b981");
        assert(room->peer_count() == 1);

        // Perform edit -> room becomes dirty
        room->insert_text(0, "## Edited Line 1\n");
        assert(room->is_dirty());

        // Check disk immediately: must NOT have flushed yet (debounce window active)
        auto early_read = storage->read_file("notes/debounced_note.md");
        assert(early_read.has_value());
        assert(early_read.value() == initial_content);
        std::cout << "  - Debounce active: disk unchanged immediately after edit.\n";

        // Wait 400ms for idle flush delay to trigger
        std::this_thread::sleep_for(std::chrono::milliseconds(450));

        // Assert room is marked clean and disk has been updated
        assert(!room->is_dirty());
        auto flushed_read = storage->read_file("notes/debounced_note.md");
        assert(flushed_read.has_value());
        assert(flushed_read.value().find("## Edited Line 1\n") != std::string::npos);
        assert(worker.total_flushes() == 1);
        assert(worker.total_snapshots() == 1);
        std::cout << "  - Debounced flush succeeded: disk content synchronized & snapshot created.\n";

        // Verify snapshot exists in snapshots_root
        bool found_snapshot = false;
        for (const auto& entry : std::filesystem::recursive_directory_iterator(storage->snapshots_root())) {
            if (entry.is_regular_file() && entry.path().extension() == ".md") {
                found_snapshot = true;
                std::cout << "  - Found snapshot: " << entry.path().filename().string() << "\n";
                break;
            }
        }
        assert(found_snapshot);

        // Verify room is NOT evicted while peer is connected
        assert(room_mgr->active_room_count() == 1);

        // Remove collaborator peer -> peer_count() == 0
        room->remove_peer("peer_alpha");
        assert(room->peer_count() == 0);

        // Wait for eviction evaluation loop (> check_interval)
        std::this_thread::sleep_for(std::chrono::milliseconds(150));

        // Assert room was evicted from RAM
        assert(room_mgr->active_room_count() == 0);
        assert(worker.total_evictions() == 1);
        std::cout << "  - Clean room with 0 peers successfully evicted from RAM.\n";

        // Test dirty room eviction guarantee: peer leaves with pending edit
        auto room2 = room_mgr->get_or_create_room(doc_id, flushed_read.value(), "notes/debounced_note.md");
        room2->add_peer("peer_beta", "pers_tester", "Persistence Tester", "#10b981");
        room2->insert_text(0, "<!-- Pending Edit -->\n");
        assert(room2->is_dirty());
        // Peer immediately disconnects
        room2->remove_peer("peer_beta");
        assert(room2->peer_count() == 0);

        // Wait for idle delay + eviction
        std::this_thread::sleep_for(std::chrono::milliseconds(450));

        // Verify room was flushed to disk prior to eviction
        auto post_evict_read = storage->read_file("notes/debounced_note.md");
        assert(post_evict_read.has_value());
        assert(post_evict_read.value().find("<!-- Pending Edit -->") != std::string::npos);
        assert(room_mgr->active_room_count() == 0);
        assert(worker.total_flushes() == 2);
        assert(worker.total_evictions() == 2);
        std::cout << "  - Dirty room flushed prior to eviction: zero data loss verified.\n";

        worker.stop();
        assert(!worker.is_running());
    }

    // 4. Generate Session Token for ws_edit_simulator.py
    std::cout << "\n[STEP 4] Generating session token for ws_edit_simulator...\n";
    std::filesystem::path admin_cfg = std::filesystem::temp_directory_path() / "cme_persist_admin.txt";
    {
        std::ofstream out(admin_cfg);
        out << "admin_user\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);
    auto sess_res = session_mgr.create_session(user_id, 24, "127.0.0.1", "CME-PersistTestRunner");
    assert(sess_res.has_value());
    std::string token = sess_res->raw_token;
    std::cout << "  - Generated session token: " << token.substr(0, 16) << "...\n";

    // 5. Configure & Start Full CME Server Daemon
    std::cout << "\n[STEP 5] Launching CME Server daemon with debounced persistence worker...\n";
    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18094;
    srv_cfg.storage.root_path = test_storage.string();
    srv_cfg.database.url = db_url;
    srv_cfg.authz.admin_provider = "file";
    srv_cfg.authz.admin_file_path = admin_cfg.string();

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    server->set_persistence_config({
        .idle_delay = std::chrono::milliseconds(500),
        .max_interval = std::chrono::milliseconds(5000),
        .check_interval = std::chrono::milliseconds(50),
        .enable_snapshots = true,
        .auto_evict_idle_rooms = true
    });

    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    assert(server->persistence_worker() != nullptr);
    assert(server->persistence_worker()->is_running());
    std::cout << "  - Server daemon & persistence worker active.\n";

    // 6. Invoke ws_edit_simulator.py to perform collaborative edit over WebSocket
    std::cout << "\n[STEP 6] Simulating real collaborator keystrokes via WebSocket...\n";
    std::ostringstream cmd;
    cmd << "python3 tests/ws_edit_simulator.py"
        << " --url ws://127.0.0.1:18094/ws/collab/" << doc_id
        << " --token " << token
        << " --insert \"\\n\\n### WebSocket CRDT Keystroke Injected!\\n\""
        << " --delay 0.1";

    std::cout << "Executing: " << cmd.str() << "\n\n";
    int ret = std::system(cmd.str().c_str());
    assert(ret == 0);
    std::cout << "\n  - ws_edit_simulator finished with exit code 0.\n";

    // Client has disconnected. Let's wait for the debounced flush window
    std::cout << "\n[STEP 7] Awaiting debounced flush window...\n";
    auto start_wait = std::chrono::steady_clock::now();
    bool flush_found = false;
    cme::Result<std::string> ws_persisted = std::unexpected(cme::ErrorCode::NotFound);
    while (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start_wait).count() < 6000) {
        ws_persisted = storage->read_file("notes/debounced_note.md");
        if (ws_persisted.has_value() && ws_persisted.value().find("### WebSocket CRDT Keystroke Injected!") != std::string::npos) {
            flush_found = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // 7. Verify disk persistence, snapshot, and room RAM eviction
    assert(flush_found);
    assert(ws_persisted.has_value());
    assert(ws_persisted.value().find("### WebSocket CRDT Keystroke Injected!") != std::string::npos);
    std::cout << "  - [PASS] File on POSIX disk contains injected WebSocket keystrokes!\n";

    // Await room eviction
    start_wait = std::chrono::steady_clock::now();
    while (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start_wait).count() < 2000) {
        if (server->room_manager()->active_room_count() == 0) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    assert(server->room_manager()->active_room_count() == 0);
    std::cout << "  - [PASS] Inactive collaborative room automatically evicted from memory.\n";

    // Health metrics
    auto health = server->get_health_status();
    assert(health.contains("persistence"));
    assert(health["persistence"]["status"] == "running");
    assert(health["persistence"]["total_flushes"].get<uint64_t>() >= 1);
    assert(health["persistence"]["total_snapshots"].get<uint64_t>() >= 1);
    assert(health["persistence"]["total_evictions"].get<uint64_t>() >= 1);
    std::cout << "  - [PASS] Server health probe reports persistence worker metrics:\n"
              << "    Flushes: " << health["persistence"]["total_flushes"]
              << ", Snapshots: " << health["persistence"]["total_snapshots"]
              << ", Evictions: " << health["persistence"]["total_evictions"] << "\n";

    // 8. Test Transparent Rehydration upon Reconnect
    std::cout << "\n[STEP 8] Reconnecting to evicted room to test transparent disk rehydration...\n";
    std::ostringstream cmd_reconnect;
    cmd_reconnect << "python3 tests/ws_edit_simulator.py"
                  << " --url ws://127.0.0.1:18094/ws/collab/" << doc_id
                  << " --token " << token
                  << " --insert \"\\nRehydrated second edit!\\n\""
                  << " --delay 0.1";

    ret = std::system(cmd_reconnect.str().c_str());
    assert(ret == 0);

    std::this_thread::sleep_for(std::chrono::milliseconds(700));
    auto rehydrated_read = storage->read_file("notes/debounced_note.md");
    assert(rehydrated_read.has_value());
    assert(rehydrated_read.value().find("Rehydrated second edit!") != std::string::npos);
    assert(server->room_manager()->active_room_count() == 0);
    std::cout << "  - [PASS] Room rehydrated from disk, applied second edit, flushed, and re-evicted!\n";

    // 9. Shutdown & Cleanup
    std::cout << "\n[STEP 9] Stopping server and shutting down gracefully...\n";
    server->stop();
    if (server_thread.joinable()) {
        server_thread.join();
    }
    std::cout << "  - Server shutdown complete.\n";

    std::filesystem::remove_all(test_storage);
    std::filesystem::remove(admin_cfg);

    // Clean up test database records
    try {
        pqxx::connection conn(db_url);
        pqxx::work clean_tx(conn);
        clean_tx.exec("DELETE FROM documents WHERE fs_path = 'notes/debounced_note.md';");
        clean_tx.exec("DELETE FROM users WHERE username = 'pers_tester';");
        clean_tx.commit();
    } catch (...) {}

    std::cout << "\n===============================================================\n";
    std::cout << "=== ALL PERSISTENCE & EVICTION TESTS PASSED (100% SUCCESS)  ===\n";
    std::cout << "===============================================================\n";

    return 0;
}
