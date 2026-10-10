#include "cme/server/server.hpp"
#include "cme/version.hpp"
#include <cassert>
#include <iostream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>

int main() {
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_health_test_storage";
    std::filesystem::remove_all(test_storage);

    cme::config::AppConfig cfg;
    cfg.server.bind = "127.0.0.1";
    cfg.server.port = 8089;
    cfg.storage.root_path = test_storage.string();
    cfg.database.url = "postgresql://cme:secret@localhost:5432/cme_test";

    std::cout << "[TEST] Starting Server in background thread on http://127.0.0.1:8089...\n";
    auto server = std::make_shared<cme::server::Server>(cfg);

    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    // Allow server thread to bind listener
    std::this_thread::sleep_for(std::chrono::milliseconds(300));

    // Perform HTTP GET request to /api/v1/health via curl
    std::cout << "[TEST] Querying GET /api/v1/health...\n";
    std::string resp_file = "/tmp/cme_health_test_resp.json";
    std::string cmd = "curl -s -f http://127.0.0.1:8089/api/v1/health > " + resp_file;
    int code = std::system(cmd.c_str());
    assert(code == 0);

    // Read and validate JSON payload
    std::ifstream in(resp_file);
    assert(in.is_open());
    nlohmann::json health = nlohmann::json::parse(in);
    std::cout << "[TEST] Received response:\n" << health.dump(2) << "\n";

    assert(health["status"] == "healthy");
    assert(health["version"] == CME_VERSION_STRING);
    assert(health["database"]["status"] == "connected");
    assert(health["database"]["latency_ms"].is_number());
    assert(health["storage"]["status"] == "writable");
    assert(health["storage"]["free_bytes"].is_number());

    std::cout << "[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();

    // Clean up
    std::filesystem::remove(resp_file);
    std::filesystem::remove_all(test_storage);

    std::cout << "[PASS] server_health_test succeeded!\n";
    return 0;
}
