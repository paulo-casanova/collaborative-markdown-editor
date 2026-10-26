#include "cme/server/server.hpp"
#include "cme/collab/document_room.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include <cassert>
#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <atomic>

using namespace cme;

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME Shutdown Lease & Save Ordering Regression Test (Issue #24) ===\n";
    std::cout << "====================================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_shutdown_test_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage);

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed user & test documents
    std::string user_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'notes/issue24_%';");
        tx.exec("DELETE FROM users WHERE username = 'shutdown_tester';");
        std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('shutdown_tester', $1, 'Shutdown Tester', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();

        for (int i = 0; i < 5; ++i) {
            std::string p = "notes/issue24_" + std::to_string(i) + ".md";
            tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ($1, 'Issue 24 Doc', $2::uuid);",
                p,
                user_id
            );
        }
        tx.commit();
    }

    auto storage = std::make_shared<storage::PosixStorageBackend>(test_storage);
    const std::string initial_content = "# Initial Baseline Content\n";
    for (int i = 0; i < 5; ++i) {
        std::string p = "notes/issue24_" + std::to_string(i) + ".md";
        auto init_write = storage->write_file(p, initial_content, true);
        assert(init_write.has_value());
    }

    const std::string lease_name = "test_shutdown_order_lease";
    // Clean lease table
    {
        auto conn_wrapper = pool->acquire();
        assert(conn_wrapper.has_value());
        pqxx::work tx(conn_wrapper->get());
        tx.exec_params("DELETE FROM instance_lease WHERE lease_name = $1;", lease_name);
        tx.commit();
    }

    // 1. Configure and start Server 1
    std::cout << "[STEP 1] Starting Server 1 with instance lease enabled...\n";
    config::AppConfig cfg1;
    cfg1.server.bind = "127.0.0.1";
    cfg1.server.port = 18134;
    cfg1.database.url = db_url;
    cfg1.database.lease_name = lease_name;
    cfg1.database.lease_enabled = true;
    cfg1.database.lease_ttl_seconds = 10;
    cfg1.database.lease_renew_interval_seconds = 2;
    cfg1.database.lease_wait = true;
    cfg1.database.lease_retry_interval_seconds = 1;
    cfg1.storage.backend = "posix";
    cfg1.storage.root_path = test_storage.string();

    auto server1 = std::make_shared<server::Server>(cfg1);
    std::thread s1_thread([server1]() {
        server1->start();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    assert(server1->lease_manager() != nullptr && server1->lease_manager()->is_held());
    std::cout << "  - Server 1 started and holds instance lease.\n";

    // 2. Create multiple dirty rooms on Server 1 with unsaved edits
    std::cout << "[STEP 2] Creating dirty rooms on Server 1 with in-memory edits...\n";
    for (int i = 0; i < 5; ++i) {
        std::string p = "notes/issue24_" + std::to_string(i) + ".md";
        auto room = server1->room_manager()->get_or_create_room("doc_" + std::to_string(i), initial_content, p);
        assert(room != nullptr);
        room->insert_text(0, "# Server 1 Update " + std::to_string(i) + "\n");
        assert(room->is_dirty());
    }

    // Verify disk has NOT flushed yet (debounce active)
    for (int i = 0; i < 5; ++i) {
        std::string p = "notes/issue24_" + std::to_string(i) + ".md";
        auto disk_val = storage->read_file(p);
        assert(disk_val.has_value() && disk_val.value() == initial_content);
    }
    std::cout << "  - Confirmed 5 dirty rooms exist in memory while disk still has baseline content.\n";

    // 3. Start standby lease waiter that immediately checks files upon acquiring lease
    std::cout << "[STEP 3] Launching Standby monitor waiting for lease...\n";
    std::atomic<bool> standby_saw_all_updated{false};
    std::atomic<bool> standby_running{true};

    std::atomic<bool> standby_acquired{false};

    std::thread standby_thread([&]() {
        db::InstanceLeaseManager standby_mgr(pool, lease_name, 10, 2);
        while (standby_running.load()) {
            auto res = standby_mgr.acquire(false);
            if (res.has_value() && res.value()) {
                standby_acquired = true;
                std::cout << "  - Standby acquired lease!\n";
                // Standby acquired lease! Verify every single file is fully flushed.
                bool all_good = true;
                for (int i = 0; i < 5; ++i) {
                    std::string p = "notes/issue24_" + std::to_string(i) + ".md";
                    auto content_res = storage->read_file(p);
                    std::string expected = "# Server 1 Update " + std::to_string(i) + "\n" + initial_content;
                    if (!content_res.has_value() || content_res.value() != expected) {
                        all_good = false;
                        std::cerr << "[ERROR] Standby saw stale or incomplete content for " << p << "!\n";
                        if (content_res.has_value()) {
                            std::cerr << "  Saw: \"" << content_res.value() << "\"\n";
                            std::cerr << "  Expected: \"" << expected << "\"\n";
                        }
                    }
                }
                standby_saw_all_updated = all_good;
                standby_mgr.release();
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
    });

    // 4. Trigger Server 1 shutdown
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    std::cout << "[STEP 4] Stopping Server 1 (must flush dirty rooms BEFORE releasing lease)...\n";
    server1->stop();
    s1_thread.join();
    std::cout << "  - Server 1 stopped.\n";

    // Wait up to 3 seconds for standby to acquire the released lease
    for (int retry = 0; retry < 60 && !standby_acquired.load(); ++retry) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    standby_running = false;
    standby_thread.join();

    assert(standby_acquired.load());
    assert(standby_saw_all_updated.load());
    std::cout << "  - Standby verified: ALL 5 files were fully flushed to storage BEFORE lease was released!\n";

    // Clean up
    std::filesystem::remove_all(test_storage);

    std::cout << "====================================================================\n";
    std::cout << "=== ALL TESTS IN shutdown_lease_save_order_test PASSED (100%)    ===\n";
    std::cout << "====================================================================\n";
    return 0;
}
