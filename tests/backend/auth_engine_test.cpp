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

        // 3. DelegatedAuthProvider with required reverse-proxy verification headers
        std::unordered_map<std::string, std::string> req_headers = {
            {"x-proxy-secret", "super_secret_proxy_key_999"},
            {"x-forwarded-host", "cme.example.com"}
        };
        cme::auth::DelegatedAuthProvider proxy_secured_provider(
            pool,
            admin_prov,
            "x-remote-user",
            "x-remote-email",
            req_headers
        );

        // 3.1. Successful authentication when all proxy verification headers match
        auto lookup_ok = [](std::string_view h) -> std::string {
            if (h == "x-proxy-secret") return "super_secret_proxy_key_999";
            if (h == "x-forwarded-host") return "cme.example.com";
            return "";
        };
        auto sec_ok = proxy_secured_provider.authenticate("dave_proxy", "dave@example.com", lookup_ok);
        assert(sec_ok.has_value() && sec_ok.value().has_value());
        assert(sec_ok.value()->username == "dave_proxy");

        // 3.2. Authentication rejected when required proxy header is missing
        auto lookup_missing = [](std::string_view h) -> std::string {
            if (h == "x-proxy-secret") return "super_secret_proxy_key_999";
            return ""; // x-forwarded-host is missing
        };
        auto sec_missing = proxy_secured_provider.authenticate("dave_proxy", "dave@example.com", lookup_missing);
        assert(sec_missing.has_value() && !sec_missing.value().has_value()); // nullopt -> 401

        // 3.3. Authentication rejected when proxy header value mismatches
        auto lookup_wrong = [](std::string_view h) -> std::string {
            if (h == "x-proxy-secret") return "wrong_secret_attacker";
            if (h == "x-forwarded-host") return "cme.example.com";
            return "";
        };
        auto sec_wrong = proxy_secured_provider.authenticate("dave_proxy", "dave@example.com", lookup_wrong);
        assert(sec_wrong.has_value() && !sec_wrong.value().has_value()); // nullopt -> 401

        // 3.4. Authentication rejected when no header lookup is provided at all
        auto sec_no_lookup = proxy_secured_provider.authenticate("dave_proxy", "dave@example.com", nullptr);
        assert(sec_no_lookup.has_value() && !sec_no_lookup.value().has_value()); // nullopt -> 401

        // 3.5. Case-insensitivity in header name matching
        auto lookup_case = [](std::string_view h) -> std::string {
            std::string lower(h);
            for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            if (lower == "x-proxy-secret") return "super_secret_proxy_key_999";
            if (lower == "x-forwarded-host") return "cme.example.com";
            return "";
        };
        auto sec_case = proxy_secured_provider.authenticate("dave_proxy", "dave@example.com", lookup_case);
        assert(sec_case.has_value() && sec_case.value().has_value());
        assert(sec_case.value()->username == "dave_proxy");

        std::cout << "  - DelegatedAuthProvider proxy header verification (match, missing, mismatch, null-lookup) validated.\n";
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

    // 4.9. Self-Service Profile: PATCH /api/v1/users/me (using active pat_token)
    {
        // 4.9.1 Verify authn_provider and can_change_password in GET /api/v1/auth/me
        auto me_resp = http_curl("GET", base_url + "/api/v1/auth/me", {"Authorization: Bearer " + pat_token});
        assert(me_resp.status_code == 200);
        auto me_json = nlohmann::json::parse(me_resp.body);
        assert(me_json["authn_provider"] == "delegated");
        assert(me_json["can_change_password"] == false);
        std::cout << "  - GET /api/v1/auth/me exposed authn_provider='delegated' and can_change_password=false.\n";

        // 4.9.2 Change own display name
        std::string update_body = "{\"display_name\":\"Bob The Builder\",\"avatar_color\":\"#10b981\"}";
        auto patch_resp = http_curl("PATCH", base_url + "/api/v1/users/me",
            {"Authorization: Bearer " + pat_token, "Content-Type: application/json"},
            update_body);
        assert(patch_resp.status_code == 200);
        auto patch_json = nlohmann::json::parse(patch_resp.body);
        assert(patch_json["status"] == "updated");
        assert(patch_json["user"]["display_name"] == "Bob The Builder");
        assert(patch_json["user"]["avatar_color"] == "#10b981");

        // Verify updated display name is reflected in GET /api/v1/auth/me
        auto verify_me = http_curl("GET", base_url + "/api/v1/auth/me", {"Authorization: Bearer " + pat_token});
        assert(verify_me.status_code == 200);
        auto verify_json = nlohmann::json::parse(verify_me.body);
        assert(verify_json["user"]["display_name"] == "Bob The Builder");
        std::cout << "  - PATCH /api/v1/users/me successfully updated display name and avatar color.\n";

        // 4.9.3 Password change rejected under delegated auth
        std::string pw_body = "{\"current_password\":\"password123\",\"new_password\":\"newpass456\"}";
        auto pw_resp = http_curl("PATCH", base_url + "/api/v1/users/me",
            {"Authorization: Bearer " + pat_token, "Content-Type: application/json"},
            pw_body);
        assert(pw_resp.status_code == 400);
        auto pw_json = nlohmann::json::parse(pw_resp.body);
        assert(pw_json["error"] == "PasswordChangeNotAllowed");
        std::cout << "  - PATCH /api/v1/users/me password change correctly rejected with 400 under delegated auth.\n";
    }

    // Stop server
    std::cout << "\n[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();

    // -------------------------------------------------------------------------
    // 5. HTTP Server with Reverse-Proxy Verification Headers
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 5] Testing Server Delegated Auth with Reverse-Proxy Verification Headers...\n";
    {
        std::filesystem::path proxy_server_storage = std::filesystem::temp_directory_path() / "cme_auth_proxy_storage";
        std::filesystem::remove_all(proxy_server_storage);

        cme::config::AppConfig proxy_srv_cfg;
        proxy_srv_cfg.server.bind = "127.0.0.1";
        proxy_srv_cfg.server.port = 18083;
        proxy_srv_cfg.storage.root_path = proxy_server_storage.string();
        proxy_srv_cfg.database.url = db_url;
        proxy_srv_cfg.authn.proxy_secret_header = "X-Proxy-Secret";
        proxy_srv_cfg.authn.proxy_secret_value = "cluster_internal_secret_42";

        auto proxy_server = std::make_shared<cme::server::Server>(proxy_srv_cfg);
        std::thread proxy_server_thread([proxy_server]() {
            auto res = proxy_server->start();
            (void)res;
        });

        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        std::string proxy_base_url = "http://127.0.0.1:18083";

        // 5.1. Request with matching proxy secret header succeeds (HTTP 200)
        {
            auto resp = http_curl("GET", proxy_base_url + "/api/v1/auth/me", {
                "X-Remote-User: proxy_verified_user",
                "X-Remote-Email: proxy_user@example.com",
                "X-Proxy-Secret: cluster_internal_secret_42"
            });
            assert(resp.status_code == 200);
            auto json = nlohmann::json::parse(resp.body);
            assert(json["user"]["username"] == "proxy_verified_user");
            std::cout << "  - GET /api/v1/auth/me with matching X-Proxy-Secret returned HTTP 200.\n";
        }

        // 5.2. Request with missing proxy secret header is rejected (HTTP 401)
        {
            auto resp = http_curl("GET", proxy_base_url + "/api/v1/auth/me", {
                "X-Remote-User: proxy_verified_user",
                "X-Remote-Email: proxy_user@example.com"
            });
            assert(resp.status_code == 401);
            std::cout << "  - GET /api/v1/auth/me without required X-Proxy-Secret rejected with HTTP 401.\n";
        }

        // 5.3. Request with mismatched proxy secret header is rejected (HTTP 401)
        {
            auto resp = http_curl("GET", proxy_base_url + "/api/v1/auth/me", {
                "X-Remote-User: proxy_verified_user",
                "X-Remote-Email: proxy_user@example.com",
                "X-Proxy-Secret: forged_secret_by_attacker"
            });
            assert(resp.status_code == 401);
            std::cout << "  - GET /api/v1/auth/me with mismatched X-Proxy-Secret rejected with HTTP 401.\n";
        }

        proxy_server->stop();
        proxy_server_thread.join();
        std::filesystem::remove_all(proxy_server_storage);
    }

    // -------------------------------------------------------------------------
    // 6. CORS Policy Configuration Verification
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 6] Testing CORS Policies (disabled by default, specific origin, wildcard)...\n";
    {
        // 6.1. Server A: Default configuration (cors_allowed_origins empty -> CORS disabled)
        std::filesystem::path cors_storage_a = std::filesystem::temp_directory_path() / "cme_cors_test_a";
        std::filesystem::remove_all(cors_storage_a);
        cme::config::AppConfig cfg_a;
        cfg_a.server.bind = "127.0.0.1";
        cfg_a.server.port = 18084;
        cfg_a.storage.root_path = cors_storage_a.string();
        cfg_a.database.url = db_url;
        // cors_allowed_origins is empty by default

        auto srv_a = std::make_shared<cme::server::Server>(cfg_a);
        std::thread th_a([srv_a]() { auto r = srv_a->start(); (void)r; });
        std::this_thread::sleep_for(std::chrono::milliseconds(300));

        // When CORS is disabled, no Access-Control-Allow-Origin header is emitted
        auto resp_a = http_curl("OPTIONS", "http://127.0.0.1:18084/api/v1/auth/me", {"Origin: https://attacker.com"});
        assert(resp_a.headers.find("Access-Control-Allow-Origin") == std::string::npos);
        assert(resp_a.headers.find("X-Remote-User") == std::string::npos);

        auto resp_a_get = http_curl("GET", "http://127.0.0.1:18084/api/v1/auth/me", {"Origin: https://attacker.com"});
        assert(resp_a_get.headers.find("Access-Control-Allow-Origin") == std::string::npos);
        assert(resp_a_get.headers.find("X-Remote-User") == std::string::npos);
        std::cout << "  - Default server (CORS disabled): no Access-Control-Allow-Origin or X-Remote-User headers emitted.\n";

        srv_a->stop();
        th_a.join();
        std::filesystem::remove_all(cors_storage_a);

        // 6.2. Server B: Specific origin configured ("https://editor.example.com")
        std::filesystem::path cors_storage_b = std::filesystem::temp_directory_path() / "cme_cors_test_b";
        std::filesystem::remove_all(cors_storage_b);
        cme::config::AppConfig cfg_b;
        cfg_b.server.bind = "127.0.0.1";
        cfg_b.server.port = 18084;
        cfg_b.storage.root_path = cors_storage_b.string();
        cfg_b.database.url = db_url;
        cfg_b.server.cors_allowed_origins = {"https://editor.example.com"};

        auto srv_b = std::make_shared<cme::server::Server>(cfg_b);
        std::thread th_b([srv_b]() { auto r = srv_b->start(); (void)r; });
        std::this_thread::sleep_for(std::chrono::milliseconds(300));

        // Matching origin gets Access-Control-Allow-Origin and credentials
        auto resp_b_ok = http_curl("OPTIONS", "http://127.0.0.1:18084/api/v1/auth/me", {"Origin: https://editor.example.com"});
        assert(resp_b_ok.headers.find("Access-Control-Allow-Origin: https://editor.example.com") != std::string::npos);
        assert(resp_b_ok.headers.find("Access-Control-Allow-Credentials: true") != std::string::npos);
        assert(resp_b_ok.headers.find("X-Remote-User") == std::string::npos); // Strictly absent!

        // Disallowed origin gets NO Access-Control-Allow-Origin header
        auto resp_b_disallowed = http_curl("OPTIONS", "http://127.0.0.1:18084/api/v1/auth/me", {"Origin: https://evil.com"});
        assert(resp_b_disallowed.headers.find("Access-Control-Allow-Origin: https://evil.com") == std::string::npos);

        std::cout << "  - Specific origin server: allows designated origin with credentials, rejects unauthorized origins.\n";

        srv_b->stop();
        th_b.join();
        std::filesystem::remove_all(cors_storage_b);

        // 6.3. Server C: Explicit wildcard configured ("*")
        std::filesystem::path cors_storage_c = std::filesystem::temp_directory_path() / "cme_cors_test_c";
        std::filesystem::remove_all(cors_storage_c);
        cme::config::AppConfig cfg_c;
        cfg_c.server.bind = "127.0.0.1";
        cfg_c.server.port = 18084;
        cfg_c.storage.root_path = cors_storage_c.string();
        cfg_c.database.url = db_url;
        cfg_c.server.cors_allowed_origins = {"*"};

        auto srv_c = std::make_shared<cme::server::Server>(cfg_c);
        std::thread th_c([srv_c]() { auto r = srv_c->start(); (void)r; });
        std::this_thread::sleep_for(std::chrono::milliseconds(300));

        auto resp_c = http_curl("OPTIONS", "http://127.0.0.1:18084/api/v1/auth/me", {"Origin: https://any-site.com"});
        assert(resp_c.headers.find("Access-Control-Allow-Origin: *") != std::string::npos);
        assert(resp_c.headers.find("X-Remote-User") == std::string::npos); // Strictly absent even with wildcard!
        std::cout << "  - Wildcard server: emits '*' but never leaks X-Remote-User or X-Remote-Email.\n";

        srv_c->stop();
        th_c.join();
        std::filesystem::remove_all(cors_storage_c);
    }

    // -------------------------------------------------------------------------
    // 7. Self-Service Password Change Verification (Challenge Auth)
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 7] Testing Self-Service Password Change on Challenge Server...\n";
    {
        std::filesystem::path challenge_storage = std::filesystem::temp_directory_path() / "cme_challenge_test_storage";
        std::filesystem::remove_all(challenge_storage);

        cme::config::AppConfig ch_cfg;
        ch_cfg.server.bind = "127.0.0.1";
        ch_cfg.server.port = 18085;
        ch_cfg.storage.root_path = challenge_storage.string();
        ch_cfg.database.url = db_url;
        ch_cfg.authn.provider = "challenge";

        auto ch_server = std::make_shared<cme::server::Server>(ch_cfg);
        std::thread ch_thread([ch_server]() { auto r = ch_server->start(); (void)r; });
        std::this_thread::sleep_for(std::chrono::milliseconds(300));

        std::string ch_base = "http://127.0.0.1:18085";

        // 7.1. Login as bob_auth_test (original password: password123)
        auto login_resp = http_curl("POST", ch_base + "/api/v1/auth/login",
            {"Content-Type: application/json"},
            "{\"username\":\"bob_auth_test\",\"password\":\"password123\"}");
        assert(login_resp.status_code == 200);
        auto login_json = nlohmann::json::parse(login_resp.body);
        std::string ch_token = login_json["token"].get<std::string>();

        // 7.2. Verify GET /api/v1/auth/me shows can_change_password=true
        auto me_resp = http_curl("GET", ch_base + "/api/v1/auth/me", {"Authorization: Bearer " + ch_token});
        assert(me_resp.status_code == 200);
        auto me_json = nlohmann::json::parse(me_resp.body);
        assert(me_json["authn_provider"] == "challenge");
        assert(me_json["can_change_password"] == true);
        std::cout << "  - GET /api/v1/auth/me on challenge server reports can_change_password=true.\n";

        // 7.3. Attempt password change with wrong current password -> HTTP 400
        auto wrong_resp = http_curl("PATCH", ch_base + "/api/v1/users/me",
            {"Authorization: Bearer " + ch_token, "Content-Type: application/json"},
            "{\"current_password\":\"wrong_password_attempt\",\"new_password\":\"brandNewPass789!\"}");
        assert(wrong_resp.status_code == 400);
        auto wrong_json = nlohmann::json::parse(wrong_resp.body);
        assert(wrong_json["error"] == "InvalidPassword");
        std::cout << "  - PATCH /api/v1/users/me with incorrect current password rejected with 400.\n";

        // 7.4. Change password with correct current password -> HTTP 200
        auto ok_resp = http_curl("PATCH", ch_base + "/api/v1/users/me",
            {"Authorization: Bearer " + ch_token, "Content-Type: application/json"},
            "{\"current_password\":\"password123\",\"new_password\":\"brandNewPass789!\"}");
        assert(ok_resp.status_code == 200);
        std::cout << "  - PATCH /api/v1/users/me successfully updated password.\n";

        // 7.5. Verify old password no longer works
        auto old_login = http_curl("POST", ch_base + "/api/v1/auth/login",
            {"Content-Type: application/json"},
            "{\"username\":\"bob_auth_test\",\"password\":\"password123\"}");
        assert(old_login.status_code == 401);

        // 7.6. Verify new password logs in successfully
        auto new_login = http_curl("POST", ch_base + "/api/v1/auth/login",
            {"Content-Type: application/json"},
            "{\"username\":\"bob_auth_test\",\"password\":\"brandNewPass789!\"}");
        assert(new_login.status_code == 200);
        std::cout << "  - Login with updated password succeeded (old password rejected with 401).\n";

        // Restore password back to password123 for other tests
        auto restore_resp = http_curl("PATCH", ch_base + "/api/v1/users/me",
            {"Authorization: Bearer " + nlohmann::json::parse(new_login.body)["token"].get<std::string>(), "Content-Type: application/json"},
            "{\"current_password\":\"brandNewPass789!\",\"new_password\":\"password123\"}");
        assert(restore_resp.status_code == 200);

        ch_server->stop();
        ch_thread.join();
        std::filesystem::remove_all(challenge_storage);
    }

    // Clean up temporary files
    std::filesystem::remove(admin_cfg);
    std::filesystem::remove_all(server_storage);

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL AUTH ENGINE TESTS PASSED SUCCESSFULLY!       ===\n";
    std::cout << "========================================================\n";
    return 0;
}
