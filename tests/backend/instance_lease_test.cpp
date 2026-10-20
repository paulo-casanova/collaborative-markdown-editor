#include "cme/db/instance_lease.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/server/server.hpp"
#include "cme/config/config.hpp"
#include <iostream>
#include <cassert>
#include <thread>
#include <chrono>

using namespace cme;

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Instance Lease & Multi-Instance Protection Test (Issue #8) ===\n";
    std::cout << "===============================================================\n";

    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_url = std::getenv("CME_DATABASE_URL")) {
        db_url = env_url;
    }

    // Step 1: Run migrations to ensure instance_lease table is present
    std::cout << "[STEP 1] Applying migrations...\n";
    {
        pqxx::connection conn(db_url);
        auto mig_res = db::MigrationRunner::apply_migrations(conn, "migrations");
        assert(mig_res.has_value());
    }

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    std::string test_lease_name = "test_cme_instance_lease";

    // Clean up any stale test lease
    {
        auto conn_wrapper = pool->acquire();
        assert(conn_wrapper.has_value());
        pqxx::work tx(conn_wrapper->get());
        tx.exec_params("DELETE FROM instance_lease WHERE lease_name = $1;", test_lease_name);
        tx.commit();
    }

    // Step 2: Acquire lease on instance 1
    std::cout << "[STEP 2] Acquiring lease on instance 1...\n";
    db::InstanceLeaseManager m1(pool, test_lease_name, 5, 1);
    auto acq1 = m1.acquire();
    assert(acq1.has_value() && acq1.value() == true);
    assert(m1.is_held());
    std::cout << "  - Instance 1 acquired lease successfully.\n";

    // Step 3: Attempt acquire on instance 2 while instance 1 holds it
    std::cout << "[STEP 3] Attempting acquire on instance 2 (should fail)...\n";
    db::InstanceLeaseManager m2(pool, test_lease_name, 5, 1);
    auto acq2 = m2.acquire();
    assert(acq2.has_value() && acq2.value() == false);
    assert(!m2.is_held());
    std::cout << "  - Instance 2 correctly rejected while lease is held.\n";

    // Step 4: Renew lease on instance 1
    std::cout << "[STEP 4] Testing renewal on instance 1...\n";
    auto ren1 = m1.renew();
    assert(ren1.has_value() && ren1.value() == true);
    std::cout << "  - Instance 1 renewed lease successfully.\n";

    // Step 5: Test heartbeat keeping lease alive
    std::cout << "[STEP 5] Starting heartbeat on instance 1...\n";
    m1.start_heartbeat();
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));
    assert(m1.is_held());

    // Instance 2 should still be rejected
    auto acq2_again = m2.acquire();
    assert(acq2_again.has_value() && acq2_again.value() == false);
    std::cout << "  - Instance 2 still rejected while heartbeat keeps lease active.\n";

    // Step 6: Stop instance 1 (releases lease) and allow instance 2 to acquire
    std::cout << "[STEP 6] Stopping instance 1 and acquiring on instance 2...\n";
    m1.stop();
    assert(!m1.is_held());

    auto acq2_now = m2.acquire();
    assert(acq2_now.has_value() && acq2_now.value() == true);
    assert(m2.is_held());
    std::cout << "  - Instance 2 successfully acquired lease after instance 1 stopped.\n";

    m2.stop();
    assert(!m2.is_held());

    // Step 7: Server daemon integration test
    std::cout << "[STEP 7] Testing Server daemon multi-instance mutual exclusion...\n";
    config::AppConfig srv_cfg1;
    srv_cfg1.server.bind = "127.0.0.1";
    srv_cfg1.server.port = 18096;
    srv_cfg1.database.url = db_url;
    srv_cfg1.database.lease_name = "test_server_daemon_lease";
    srv_cfg1.database.lease_enabled = true;
    srv_cfg1.database.lease_ttl_seconds = 5;
    srv_cfg1.database.lease_renew_interval_seconds = 1;
    srv_cfg1.storage.backend = "posix";
    srv_cfg1.storage.root_path = "/tmp/cme_lease_test_storage";
    std::filesystem::create_directories(srv_cfg1.storage.root_path);

    auto server1 = std::make_shared<server::Server>(srv_cfg1);
    std::thread s1_thread([server1]() {
        server1->start();
    });

    // Wait for server1 to start
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    auto health1 = server1->get_health_status();
    assert(health1.contains("instance_lease"));
    assert(health1["instance_lease"]["held"] == true);
    std::cout << "  - Server 1 started and holds instance lease.\n";

    // Attempt to start server2 with same lease name
    config::AppConfig srv_cfg2 = srv_cfg1;
    srv_cfg2.server.port = 18097;
    auto server2 = std::make_shared<server::Server>(srv_cfg2);
    auto s2_res = server2->start();
    assert(!s2_res.has_value());
    assert(s2_res.error() == ErrorCode::PermissionDenied);
    std::cout << "  - Server 2 start rejected with PermissionDenied (lease conflict prevented split-brain).\n";

    // Gracefully stop server1
    server1->stop();
    if (s1_thread.joinable()) {
        s1_thread.join();
    }
    std::cout << "  - Server 1 stopped and released lease.\n";

    // Now server2 can start
    std::thread s2_thread([server2]() {
        server2->start();
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    auto health2 = server2->get_health_status();
    assert(health2.contains("instance_lease"));
    assert(health2["instance_lease"]["held"] == true);
    std::cout << "  - Server 2 successfully started after server 1 was stopped.\n";

    server2->stop();
    if (s2_thread.joinable()) {
        s2_thread.join();
    }

    std::filesystem::remove_all(srv_cfg1.storage.root_path);

    std::cout << "===============================================================\n";
    std::cout << "=== ALL INSTANCE LEASE & MULTI-INSTANCE TESTS PASSED (100%) ===\n";
    std::cout << "===============================================================\n";
    return 0;
}
