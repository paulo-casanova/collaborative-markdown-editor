#include "cme/dialog/dialog_service.hpp"
#include "cme/admin/admin_service.hpp"
#include "cme/server/server.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <cassert>
#include <iostream>
#include <sstream>
#include <fstream>
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
    std::string out_file = "/tmp/cme_agent_gw_test_curl_out.txt";
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
            resp.body = raw;
        }
    } else {
        resp.headers = raw.substr(0, header_end);
        resp.body = raw.substr(header_end + 4);
    }

    std::istringstream hss(resp.headers);
    std::string line;
    if (std::getline(hss, line)) {
        std::istringstream lss(line);
        std::string http_ver;
        lss >> http_ver >> resp.status_code;
    }
    return resp;
}

} // namespace

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== CME Local Agent Gateway WebSocket Test Suite     ===\n";
    std::cout << "========================================================\n";

    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_db = std::getenv("CME_DATABASE_URL")) {
        db_url = env_db;
    }

    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean previous test user
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM users WHERE username = 'agent_ws_alice';");
        tx.commit();
    }

    // Seed test user agent_ws_alice
    admin::UserService user_svc(pool);
    auto alice_res = user_svc.create_user(admin::CreateUserRequest{
        .username = "agent_ws_alice",
        .password = "password123",
        .display_name = "Alice WS Agent",
        .avatar_color = "#10b981",
        .is_system_admin = false
    });
    assert(alice_res.has_value());
    std::string alice_id = alice_res.value().id;
    std::cout << "  - Seeded user: " << alice_id << " (agent_ws_alice)\n";

    // Setup temporary storage and launch server
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_agent_ws_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage);

    config::AppConfig cfg;
    cfg.server.bind = "127.0.0.1";
    cfg.server.port = 18101;
    cfg.storage.root_path = test_storage.string();
    cfg.database.url = db_url;
    cfg.authn.provider = "challenge";

    std::cout << "\n[STEP 1] Starting CME Server daemon on port 18101...\n";
    auto server = std::make_shared<server::Server>(cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18101";

    // Obtain Session Token for Alice
    std::cout << "\n[STEP 2] Obtaining session token for Alice...\n";
    std::string alice_token;
    {
        std::string body = "{\"username\":\"agent_ws_alice\",\"password\":\"password123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        alice_token = json["token"].get<std::string>();
        assert(!alice_token.empty());
        std::cout << "  - Session token obtained: " << alice_token.substr(0, 16) << "...\n";
    }

    // Create a Dialog for Alice
    std::cout << "\n[STEP 3] Creating a dialog thread for Alice...\n";
    std::string dialog_id;
    {
        std::string body = "{\"title\":\"Gateway WebSocket Test Dialog\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/dialogs",
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        dialog_id = json["id"].get<std::string>();
        assert(!dialog_id.empty());
        std::cout << "  - Dialog created: " << dialog_id << "\n";
    }

    // Generate Agent Pairing Token for Alice
    std::cout << "\n[STEP 4] Generating agent pairing token for Alice...\n";
    std::string agent_token;
    {
        std::string body = "{\"label\":\"Local MacBook Agent\",\"expires_in_days\":7}";
        auto resp = http_curl("POST", base_url + "/api/v1/user/agent-tokens",
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        agent_token = json["token"].get<std::string>();
        assert(!agent_token.empty());
        std::cout << "  - Agent token generated: " << agent_token.substr(0, 16) << "...\n";
    }

    // Run Python Asynchronous WebSocket Test Runner
    std::cout << "\n[STEP 5] Launching Python Agent Gateway runner...\n";
    std::ostringstream cmd;
    cmd << "python3 tests/backend/agent_gateway_runner.py "
        << base_url << " "
        << agent_token << " "
        << alice_token << " "
        << dialog_id;

    std::cout << "Executing: " << cmd.str() << "\n\n";
    int ret = std::system(cmd.str().c_str());
    assert(ret == 0);
    std::cout << "\n[STEP 6] Python runner finished with code 0.\n";

    // Graceful Shutdown
    std::cout << "\n[STEP 7] Shutting down server daemon...\n";
    server->stop();
    if (server_thread.joinable()) {
        server_thread.join();
    }
    std::cout << "  - Server daemon stopped.\n";

    // Cleanup DB & Storage
    {
        auto clean_conn = pool->acquire();
        if (clean_conn.has_value()) {
            pqxx::work tx(clean_conn->get());
            tx.exec("DELETE FROM users WHERE username = 'agent_ws_alice';");
            tx.commit();
        }
    }
    std::filesystem::remove_all(test_storage);

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL LOCAL AGENT GATEWAY WS TESTS COMPLETED (PASS) ===\n";
    std::cout << "========================================================\n";
    return 0;
}
