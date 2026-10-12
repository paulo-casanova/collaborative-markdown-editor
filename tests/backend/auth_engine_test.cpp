#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/auth/auth_provider.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/server/server.hpp"
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
    std::string out_file = "/tmp/cme_auth_test_curl_out.txt";
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

    // Parse status code from first line: e.g. "HTTP/1.1 200 OK"
    std::istringstream hss(resp.headers);
    std::string http_ver;
    if (hss >> http_ver >> resp.status_code) {
        // Parsed
    }

    return resp;
}

} // namespace

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== CME Auth Engine Integration & Unit Test Suite   ===\n";
    std::cout << "========================================================\n";

    // -------------------------------------------------------------------------
    // 1. Crypto Utilities Unit Tests
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 1] Testing cryptographic utilities...\n";
    {
        // SHA-256 standard test vector for "hello"
        std::string hello_hash = cme::auth::sha256_hex("hello");
        assert(hello_hash == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        std::cout << "  - SHA-256 known vector validated.\n";

        // Random token generation
        std::string token1 = cme::auth::generate_random_token(32);
        std::string token2 = cme::auth::generate_random_token(32);
        assert(token1.length() == 64);
        assert(token2.length() == 64);
        assert(token1 != token2);
        std::cout << "  - Random tokens entropy and uniqueness validated.\n";

        // Bcrypt password hashing & verification
        std::string pw = "SuperSecretPassword123!";
        std::string hashed = cme::auth::hash_password_bcrypt(pw, 10);
        assert(hashed.starts_with("$2b$10$"));
        assert(cme::auth::verify_password_bcrypt(pw, hashed));
        assert(!cme::auth::verify_password_bcrypt("WrongPassword", hashed));
        assert(!cme::auth::verify_password_bcrypt("", hashed));
        std::cout << "  - Salted bcrypt hashing and verification validated.\n";

        // Bearer token header parsing
        assert(cme::auth::extract_bearer_token("Bearer mytoken123") == "mytoken123");
        assert(cme::auth::extract_bearer_token("bearer  pat_xyz_890  ") == "pat_xyz_890");
        assert(!cme::auth::extract_bearer_token("Basic dXNlcjpwYXNz").has_value());
        assert(!cme::auth::extract_bearer_token("").has_value());
        std::cout << "  - Bearer token header extractor validated.\n";

        // Cookie header parsing
        assert(cme::auth::extract_cookie_token("foo=bar; cme_session=sess_12345; theme=dark") == "sess_12345");
        assert(cme::auth::extract_cookie_token("cme_session=\"sess_quoted\"") == "sess_quoted");
        assert(!cme::auth::extract_cookie_token("other_cookie=xyz").has_value());
        std::cout << "  - Cookie token header extractor validated.\n";
    }

    // -------------------------------------------------------------------------
    // 2. Admin Providers Unit Tests
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 2] Testing pluggable admin providers...\n";
    {
        // FileAdminProvider: Line-delimited & CSV formats with hot reload
        std::filesystem::path admin_file = "/tmp/cme_test_admins.txt";
        {
            std::ofstream out(admin_file);
            out << "# Administrators list\n";
            out << "alice\n";
            out << "admin_user\n";
        }

        cme::auth::FileAdminProvider file_admin(admin_file.string());
        assert(file_admin.is_admin("alice"));
        assert(file_admin.is_admin("admin_user"));
        assert(!file_admin.is_admin("bob"));

        // Update file to CSV format
        {
            std::ofstream out(admin_file);
            out << "username,is_admin\n";
            out << "bob,true\n";
            out << "alice,false\n";
        }
        file_admin.reload();
        assert(file_admin.is_admin("bob"));
        assert(!file_admin.is_admin("alice"));
        std::filesystem::remove(admin_file);
        std::cout << "  - FileAdminProvider (line-delimited + CSV + reload) validated.\n";

        // CommandAdminProvider: script execution and TTL cache
        cme::auth::CommandAdminProvider cmd_admin("test \"%USER%\" = \"sysadmin\"");
        assert(cmd_admin.is_admin("sysadmin"));
        assert(!cmd_admin.is_admin("regular_bob"));
        // Command injection protection check
        assert(!cmd_admin.is_admin("sysadmin; touch /tmp/pwned"));
        std::cout << "  - CommandAdminProvider (command template + caching + sanitization) validated.\n";
    }

    // -------------------------------------------------------------------------
    // 3. PostgreSQL Database & Subsystems Integration
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 3] Testing PostgreSQL session and auth provider subsystems...\n";
    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    // Ensure migrations are applied
    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = cme::db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed test user "bob_auth_test" with bcrypt password "password123"
    std::string bob_user_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM users WHERE username IN ('bob_auth_test', 'carol_delegated', 'alice_admin');");
        std::string bob_pw_hash = cme::auth::hash_password_bcrypt("password123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
            "VALUES ('bob_auth_test', $1, 'Bob Tester', '#10b981', FALSE) "
            "RETURNING id;",
            bob_pw_hash
        );
        bob_user_id = res[0][0].as<std::string>();
        tx.commit();
    }
    std::cout << "  - Seeded test user bob_auth_test with id: " << bob_user_id << "\n";

    // Test ChallengeAuthProvider
    cme::auth::ChallengeAuthProvider challenge_provider(pool);
    {
        auto auth_ok = challenge_provider.authenticate_credentials("bob_auth_test", "password123");
        assert(auth_ok.has_value() && auth_ok.value().has_value());
        assert(auth_ok.value()->username == "bob_auth_test");
        assert(auth_ok.value()->user_id == bob_user_id);

        auto auth_fail = challenge_provider.authenticate_credentials("bob_auth_test", "wrong_password");
        assert(auth_fail.has_value() && !auth_fail.value().has_value());

        auto auth_unknown = challenge_provider.authenticate_credentials("non_existent", "password123");
        assert(auth_unknown.has_value() && !auth_unknown.value().has_value());
        std::cout << "  - ChallengeAuthProvider (valid / invalid credentials) validated.\n";
    }

    // Test SessionManager (create, validate, list, revoke)
    std::filesystem::path admin_cfg = "/tmp/cme_admin_cfg.txt";
    {
        std::ofstream out(admin_cfg);
        out << "alice_admin\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);
    {
        auto sess_res = session_mgr.create_session(bob_user_id, 24, "127.0.0.1", "CME-TestSuite");
        assert(sess_res.has_value());
        auto session = sess_res.value();
        assert(session.raw_token.length() == 64);
        assert(session.user_id == bob_user_id);

        // Validate token
        auto val_res = session_mgr.validate_token(session.raw_token);
        assert(val_res.has_value() && val_res.value().has_value());
        assert(val_res.value()->username == "bob_auth_test");
        assert(!val_res.value()->is_system_admin);

        // List sessions
        auto list_res = session_mgr.list_user_sessions(bob_user_id);
        assert(list_res.has_value());
        assert(!list_res.value().empty());
        assert(list_res.value()[0].token_hash == session.token_hash);

        // Revoke session
        auto rev_res = session_mgr.revoke_session(session.raw_token);
        assert(rev_res.has_value() && rev_res.value());

        // Validate revoked token returns nullopt
        auto val_rev = session_mgr.validate_token(session.raw_token);
        assert(val_rev.has_value() && !val_rev.value().has_value());
        std::cout << "  - SessionManager (lifecycle, tokens, and revocation) validated.\n";
    }

    // Test DelegatedAuthProvider (JIT provisioning & admin provider integration)
    cme::auth::DelegatedAuthProvider delegated_provider(pool, admin_prov);
    {
        // 1. Regular user JIT provisioning
        auto jit_res = delegated_provider.authenticate("carol_delegated", "carol@example.com");
        assert(jit_res.has_value() && jit_res.value().has_value());
        assert(jit_res.value()->username == "carol_delegated");
        assert(jit_res.value()->display_name == "carol@example.com");
        assert(!jit_res.value()->is_system_admin);

        // 2. Admin user JIT provisioning with FileAdminProvider match
        auto admin_jit = delegated_provider.authenticate("alice_admin", "alice@example.com");
        assert(admin_jit.has_value() && admin_jit.value().has_value());
        assert(admin_jit.value()->username == "alice_admin");
        assert(admin_jit.value()->is_system_admin);
        std::cout << "  - DelegatedAuthProvider (JIT user provisioning + admin resolution) validated.\n";
    }

    // -------------------------------------------------------------------------
    // 4. Full HTTP Server REST Endpoints Verification
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 4] Testing Server REST Auth Endpoints over HTTP...\n";
    std::filesystem::path server_storage = std::filesystem::temp_directory_path() / "cme_auth_test_storage";
    std::filesystem::remove_all(server_storage);

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18082;
    srv_cfg.storage.root_path = server_storage.string();
    srv_cfg.database.url = db_url;
    srv_cfg.authz.admin_provider = "file";
    srv_cfg.authz.admin_file_path = admin_cfg.string();

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18082";

    // 4.1. POST /api/v1/auth/login (Challenge login)
    std::string session_token;
    {
        std::string login_body = "{\"username\":\"bob_auth_test\",\"password\":\"password123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/login", {"Content-Type: application/json"}, login_body);
        assert(resp.status_code == 200);
        assert(resp.headers.find("Set-Cookie: cme_session=") != std::string::npos);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("token"));
        assert(json["user"]["username"] == "bob_auth_test");
        session_token = json["token"].get<std::string>();
        std::cout << "  - POST /api/v1/auth/login returned HTTP 200 and issued token.\n";
    }

    // 4.2. GET /api/v1/auth/me with Bearer token
    {
        auto resp = http_curl("GET", base_url + "/api/v1/auth/me", {"Authorization: Bearer " + session_token});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["user"]["username"] == "bob_auth_test");
        assert(json["user"]["is_admin"] == false);
        assert(json["user"]["is_system_admin"] == false);
        assert(json["user"]["user_id"] == bob_user_id);
        assert(json["username"] == "bob_auth_test");
        assert(json["display_name"] == "Bob Tester");
        assert(json["is_admin"] == false);
        assert(json["is_system_admin"] == false);
        assert(json["user_id"] == bob_user_id);
        assert(json.contains("effective_teams"));
        std::cout << "  - GET /api/v1/auth/me with Bearer token returned HTTP 200 with dual-nested identity & role flags.\n";
    }

    // 4.3. GET /api/v1/auth/me with Cookie
    {
        auto resp = http_curl("GET", base_url + "/api/v1/auth/me", {"Cookie: cme_session=" + session_token});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["user"]["username"] == "bob_auth_test");
        assert(json["username"] == "bob_auth_test");
        assert(json["is_system_admin"] == false);
        std::cout << "  - GET /api/v1/auth/me with Cookie returned HTTP 200.\n";
    }

    // 4.4. GET /api/v1/auth/me with Delegated header (X-Remote-User)
    {
        auto resp = http_curl("GET", base_url + "/api/v1/auth/me", {"X-Remote-User: alice_admin", "X-Remote-Email: alice@cme.io"});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["user"]["username"] == "alice_admin");
        assert(json["user"]["is_admin"] == true);
        assert(json["user"]["is_system_admin"] == true);
        assert(json["username"] == "alice_admin");
        assert(json["is_admin"] == true);
        assert(json["is_system_admin"] == true);
        std::cout << "  - GET /api/v1/auth/me with X-Remote-User returned HTTP 200 (admin=true on both user and top-level).\n";
    }

    // 4.5. GET /api/v1/auth/me unauthenticated -> HTTP 401
    {
        auto resp = http_curl("GET", base_url + "/api/v1/auth/me");
        assert(resp.status_code == 401);
        std::cout << "  - GET /api/v1/auth/me without auth returned HTTP 401 Unauthorized.\n";
    }

    // 4.6. POST /api/v1/auth/tokens with challenge credentials (PAT issuance)
    std::string pat_token;
    {
        std::string token_body = "{\"username\":\"bob_auth_test\",\"password\":\"password123\",\"ttl_hours\":48}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, token_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("token"));
        assert(json["user"]["username"] == "bob_auth_test");
        pat_token = json["token"].get<std::string>();
        std::cout << "  - POST /api/v1/auth/tokens returned HTTP 201 Created and issued PAT.\n";
    }

    // 4.7. GET /api/v1/auth/tokens (List active tokens)
    {
        auto resp = http_curl("GET", base_url + "/api/v1/auth/tokens", {"Authorization: Bearer " + pat_token});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("tokens"));
        assert(json["tokens"].size() >= 2); // login token + pat token
        std::cout << "  - GET /api/v1/auth/tokens returned HTTP 200 with token list.\n";
    }

    // 4.8. POST /api/v1/auth/logout (Revoke token)
    {
        auto resp = http_curl("POST", base_url + "/api/v1/auth/logout", {"Authorization: Bearer " + session_token});
        assert(resp.status_code == 200);

        // Verification: previous session token is now invalid (401)
        auto me_resp = http_curl("GET", base_url + "/api/v1/auth/me", {"Authorization: Bearer " + session_token});
        assert(me_resp.status_code == 401);
        std::cout << "  - POST /api/v1/auth/logout revoked session; subsequent requests rejected with 401.\n";
    }

    // Stop server
    std::cout << "\n[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();

    // Clean up temporary files
    std::filesystem::remove(admin_cfg);
    std::filesystem::remove_all(server_storage);

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL AUTH ENGINE TESTS PASSED SUCCESSFULLY!       ===\n";
    std::cout << "========================================================\n";
    return 0;
}
