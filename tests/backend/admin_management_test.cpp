#include "cme/admin/admin_service.hpp"
#include "cme/server/server.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/db/permission_engine.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <cassert>
#include <iostream>
#include <sstream>
#include <fstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <nlohmann/json.hpp>

using namespace cme;
using namespace cme::admin;

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
    std::string out_file = "/tmp/cme_admin_test_curl_out.txt";
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
        // Status parsed
    }

    return resp;
}

} // namespace

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== CME Admin Management & DAG Engine Test Suite     ===\n";
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

    // Clean previous test records
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM users WHERE username LIKE 'adm_test_%' OR username LIKE 'test_cli_%' OR username LIKE 'api_%';");
        tx.exec("DELETE FROM teams WHERE name LIKE 'adm_test_%' OR name LIKE 'test_cli_%' OR name LIKE 'api_%';");
        tx.commit();
    }

    UserService user_service(pool);
    TeamService team_service(pool);

    // =========================================================================
    // 1. Direct UserService Unit Tests
    // =========================================================================
    std::cout << "\n[TEST 1] Testing direct UserService operations...\n";

    // 1.1 Create users
    auto u1_res = user_service.create_user(CreateUserRequest{
        .username = "adm_test_alice",
        .password = "secret123",
        .display_name = "Alice Administrator",
        .avatar_color = "#10b981",
        .is_system_admin = true
    });
    assert(u1_res.has_value());
    assert(u1_res->username == "adm_test_alice");
    assert(u1_res->is_system_admin == true);
    std::string alice_id = u1_res->id;

    auto u2_res = user_service.create_user(CreateUserRequest{
        .username = "adm_test_bob",
        .password = "secret456",
        .display_name = "Bob Developer",
        .avatar_color = "#3b82f6",
        .is_system_admin = false
    });
    assert(u2_res.has_value());
    assert(u2_res->is_system_admin == false);
    std::string bob_id = u2_res->id;

    // 1.2 Duplicate username rejected
    auto dup_res = user_service.create_user(CreateUserRequest{
        .username = "adm_test_alice",
        .password = "other",
        .display_name = "Alice Duplicate"
    });
    assert(!dup_res.has_value());
    assert(dup_res.error() == ErrorCode::AlreadyExists);
    std::cout << "  [PASS] Duplicate username rejected with AlreadyExists.\n";

    // 1.3 Update user & set admin
    auto bob_upd = user_service.update_user(bob_id, UpdateUserRequest{
        .display_name = "Bob Senior Dev",
        .avatar_color = "#ef4444",
        .is_system_admin = std::nullopt,
        .password = std::nullopt
    });
    assert(bob_upd.has_value());
    assert(bob_upd->display_name == "Bob Senior Dev");
    assert(bob_upd->avatar_color == "#ef4444");

    auto set_adm_res = user_service.set_admin("adm_test_bob", true);
    assert(set_adm_res.has_value());
    auto bob_check = user_service.get_user_by_id(bob_id);
    assert(bob_check.has_value());
    assert(bob_check->is_system_admin == true);
    std::cout << "  [PASS] User elevation to admin verified.\n";

    // 1.4 Reset password & verify
    auto reset_res = user_service.reset_password("adm_test_bob", "brand_new_pass");
    assert(reset_res.has_value());

    // Verify authentication via crypto_utils against updated password
    {
        pqxx::read_transaction tx(conn_res->get());
        auto row = tx.exec_params("SELECT password_hash FROM users WHERE id = $1::uuid;", bob_id);
        assert(!row.empty());
        std::string hash = row[0][0].as<std::string>();
        assert(auth::verify_password_bcrypt("brand_new_pass", hash));
        assert(!auth::verify_password_bcrypt("secret456", hash));
    }
    std::cout << "  [PASS] Password reset and bcrypt hash verified.\n";

    // =========================================================================
    // 2. Direct TeamService & DAG Hierarchy Tests
    // =========================================================================
    std::cout << "\n[TEST 2] Testing TeamService & DAG Hierarchy operations...\n";

    // 2.1 Create Teams
    auto t_eng = team_service.create_team(CreateTeamRequest{.name = "adm_test_eng", .description = "Engineering"});
    assert(t_eng.has_value());
    auto t_platform = team_service.create_team(CreateTeamRequest{.name = "adm_test_platform", .description = "Platform Dept"});
    assert(t_platform.has_value());
    auto t_frontend = team_service.create_team(CreateTeamRequest{.name = "adm_test_frontend", .description = "Frontend Squad"});
    assert(t_frontend.has_value());

    // 2.2 Add members and roles
    assert(team_service.add_member(t_frontend->id, "adm_test_alice", "lead").has_value());
    assert(team_service.add_member(t_frontend->id, "adm_test_bob", "member").has_value());

    auto members = team_service.list_members(t_frontend->id);
    assert(members.has_value());
    assert(members->size() == 2);
    assert((*members)[0].role == "lead");
    std::cout << "  [PASS] Team membership assignments and roles verified.\n";

    // 2.3 Link DAG Hierarchy: Engineering -> Platform -> Frontend
    // Engineering is parent of Platform
    assert(team_service.add_parent(t_platform->id, t_eng->id).has_value());
    // Platform is parent of Frontend
    assert(team_service.add_parent(t_frontend->id, t_platform->id).has_value());

    // Check effective teams for Alice (member of Frontend) via PermissionEngine
    auto eff_teams = db::PermissionEngine::get_effective_teams(conn_res->get(), alice_id);
    assert(eff_teams.has_value());
    assert(eff_teams->size() == 3); // Frontend, Platform, Engineering
    std::cout << "  [PASS] Multi-level DAG inheritance verified (Frontend -> Platform -> Eng).\n";

    // 2.4 DAG Cycle Detection Test
    // Attempt to add Frontend as parent of Engineering (would create cycle: Eng -> Platform -> Frontend -> Eng)
    auto cycle_res = team_service.add_parent(t_eng->id, t_frontend->id);
    assert(!cycle_res.has_value());
    assert(cycle_res.error() == ErrorCode::InvalidArgument);
    std::cout << "  [PASS] Directed cycle detected and rejected!\n";

    // Self-parenting prohibited
    auto self_res = team_service.add_parent(t_eng->id, t_eng->id);
    assert(!self_res.has_value());
    assert(self_res.error() == ErrorCode::InvalidArgument);
    std::cout << "  [PASS] Self-parenting detected and rejected!\n";

    // 2.5 Diamond DAG Hierarchy Test
    auto t_mobile = team_service.create_team(CreateTeamRequest{.name = "adm_test_mobile", .description = "Mobile Dept"});
    assert(t_mobile.has_value());
    auto t_hybrid = team_service.create_team(CreateTeamRequest{.name = "adm_test_hybrid", .description = "Hybrid Squad"});
    assert(t_hybrid.has_value());

    // Eng -> Mobile
    assert(team_service.add_parent(t_mobile->id, t_eng->id).has_value());
    // Platform -> Hybrid, and Mobile -> Hybrid (Diamond DAG)
    assert(team_service.add_parent(t_hybrid->id, t_platform->id).has_value());
    assert(team_service.add_parent(t_hybrid->id, t_mobile->id).has_value());

    // Assign Alice to Hybrid Squad
    assert(team_service.add_member(t_hybrid->id, "adm_test_alice", "member").has_value());
    auto hybrid_eff = db::PermissionEngine::get_effective_teams(conn_res->get(), alice_id);
    assert(hybrid_eff.has_value());
    // Alice effective teams: Frontend, Platform, Eng, Hybrid, Mobile -> 5 teams
    assert(hybrid_eff->size() == 5);
    std::cout << "  [PASS] Diamond DAG multi-parent hierarchy verified.\n";

    // =========================================================================
    // 3. cme-admin CLI Subcommands Test
    // =========================================================================
    std::cout << "\n[TEST 3] Testing cme-admin CLI executable...\n";
    std::string cli_path = "./build/bin/cme-admin";

    // 3.1 CLI user create & list
    int rc1 = std::system((cli_path + " user create --username test_cli_charlie --password pass123 --display-name 'Charlie CLI' --admin").c_str());
    assert(rc1 == 0);

    int rc2 = std::system((cli_path + " user list > /tmp/cme_cli_users.txt").c_str());
    assert(rc2 == 0);
    std::ifstream user_txt("/tmp/cme_cli_users.txt");
    std::string user_list((std::istreambuf_iterator<char>(user_txt)), std::istreambuf_iterator<char>());
    assert(user_list.find("test_cli_charlie") != std::string::npos);
    std::cout << "  [PASS] cme-admin user create & list validated.\n";

    // 3.2 CLI team create, add-member & list-members
    int rc3 = std::system((cli_path + " team create --name test_cli_team --description 'CLI Team'").c_str());
    assert(rc3 == 0);

    int rc4 = std::system((cli_path + " team add-member --team test_cli_team --user test_cli_charlie --role lead").c_str());
    assert(rc4 == 0);

    int rc5 = std::system((cli_path + " team list-members --team test_cli_team > /tmp/cme_cli_members.txt").c_str());
    assert(rc5 == 0);
    std::ifstream mem_txt("/tmp/cme_cli_members.txt");
    std::string mem_list((std::istreambuf_iterator<char>(mem_txt)), std::istreambuf_iterator<char>());
    assert(mem_list.find("test_cli_charlie") != std::string::npos);
    assert(mem_list.find("lead") != std::string::npos);
    std::cout << "  [PASS] cme-admin team create & add-member validated.\n";

    // 3.3 CLI cleanup
    assert(std::system((cli_path + " user delete --username test_cli_charlie").c_str()) == 0);
    assert(std::system((cli_path + " team delete --team test_cli_team").c_str()) == 0);
    std::cout << "  [PASS] cme-admin delete user & team validated.\n";

    // =========================================================================
    // 4. Live Server Daemon Admin REST API Test
    // =========================================================================
    std::cout << "\n[TEST 4] Testing live Server Daemon Admin REST API routes...\n";
    std::filesystem::path srv_storage = std::filesystem::temp_directory_path() / "cme_admin_server_storage";
    std::filesystem::remove_all(srv_storage);

    config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18092;
    srv_cfg.storage.root_path = srv_storage.string();
    srv_cfg.database.url = db_url;

    auto server = std::make_shared<server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18092";

    // Obtain token for Alice (Admin)
    std::string admin_token;
    {
        std::string body = "{\"username\":\"adm_test_alice\",\"password\":\"secret123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        admin_token = json["token"].get<std::string>();
        assert(!admin_token.empty());
    }

    // Demote Bob temporarily to test 403 Forbidden
    assert(user_service.set_admin("adm_test_bob", false).has_value());
    std::string non_admin_token;
    {
        std::string body = "{\"username\":\"adm_test_bob\",\"password\":\"brand_new_pass\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        non_admin_token = json["token"].get<std::string>();
        assert(!non_admin_token.empty());
    }

    // 4.1 Guard checks: 401 Unauthorized and 403 Forbidden
    {
        auto unauth_resp = http_curl("GET", base_url + "/api/v1/admin/users");
        assert(unauth_resp.status_code == 401);

        auto forbid_resp = http_curl("GET", base_url + "/api/v1/admin/users", {"Authorization: Bearer " + non_admin_token});
        assert(forbid_resp.status_code == 403);
        std::cout << "  [PASS] Admin endpoints properly reject unauthenticated (401) and non-admin (403) requests.\n";
    }

    // 4.2 GET /api/v1/admin/users
    {
        auto resp = http_curl("GET", base_url + "/api/v1/admin/users", {"Authorization: Bearer " + admin_token});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.is_array());
        assert(json.size() >= 2);
        std::cout << "  [PASS] GET /api/v1/admin/users returned " << json.size() << " user records.\n";
    }

    // 4.3 POST /api/v1/admin/users
    std::string api_user_id;
    {
        std::string req_body = "{\"username\":\"api_user_dave\",\"password\":\"pass123\",\"display_name\":\"Dave API\",\"is_admin\":false}";
        auto resp = http_curl("POST", base_url + "/api/v1/admin/users",
                              {"Authorization: Bearer " + admin_token, "Content-Type: application/json"}, req_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        api_user_id = json["id"].get<std::string>();
        assert(json["username"] == "api_user_dave");
        std::cout << "  [PASS] POST /api/v1/admin/users successfully created user (201 Created).\n";
    }

    // 4.4 GET & PUT /api/v1/admin/users/:id
    {
        auto get_resp = http_curl("GET", base_url + "/api/v1/admin/users/" + api_user_id,
                                  {"Authorization: Bearer " + admin_token});
        assert(get_resp.status_code == 200);

        std::string put_body = "{\"display_name\":\"Dave Senior API\"}";
        auto put_resp = http_curl("PUT", base_url + "/api/v1/admin/users/" + api_user_id,
                                  {"Authorization: Bearer " + admin_token, "Content-Type: application/json"}, put_body);
        assert(put_resp.status_code == 200);
        auto put_json = nlohmann::json::parse(put_resp.body);
        assert(put_json["display_name"] == "Dave Senior API");
        std::cout << "  [PASS] GET & PUT /api/v1/admin/users/:id succeeded.\n";
    }

    // 4.5 POST & GET /api/v1/admin/teams
    std::string team_alpha_id;
    std::string team_beta_id;
    {
        auto r_alpha = http_curl("POST", base_url + "/api/v1/admin/teams",
                                 {"Authorization: Bearer " + admin_token, "Content-Type: application/json"},
                                 "{\"name\":\"api_team_alpha\",\"description\":\"Alpha Org\"}");
        assert(r_alpha.status_code == 201);
        team_alpha_id = nlohmann::json::parse(r_alpha.body)["id"].get<std::string>();

        auto r_beta = http_curl("POST", base_url + "/api/v1/admin/teams",
                                {"Authorization: Bearer " + admin_token, "Content-Type: application/json"},
                                "{\"name\":\"api_team_beta\",\"description\":\"Beta Squad\"}");
        assert(r_beta.status_code == 201);
        team_beta_id = nlohmann::json::parse(r_beta.body)["id"].get<std::string>();

        auto r_list = http_curl("GET", base_url + "/api/v1/admin/teams", {"Authorization: Bearer " + admin_token});
        assert(r_list.status_code == 200);
        std::cout << "  [PASS] POST & GET /api/v1/admin/teams succeeded.\n";
    }

    // 4.6 Team Members via REST: POST, GET, DELETE
    {
        // Add Dave to Alpha as lead
        auto r_mem = http_curl("POST", base_url + "/api/v1/admin/teams/" + team_alpha_id + "/members",
                               {"Authorization: Bearer " + admin_token, "Content-Type: application/json"},
                               "{\"user_id\":\"" + api_user_id + "\",\"role\":\"lead\"}");
        assert(r_mem.status_code == 200);

        // List members
        auto r_list = http_curl("GET", base_url + "/api/v1/admin/teams/" + team_alpha_id + "/members",
                                {"Authorization: Bearer " + admin_token});
        assert(r_list.status_code == 200);
        auto json = nlohmann::json::parse(r_list.body);
        assert(json.is_array() && json.size() == 1);
        assert(json[0]["username"] == "api_user_dave");
        assert(json[0]["role"] == "lead");
        std::cout << "  [PASS] REST team membership assignment and listing verified.\n";
    }

    // 4.7 Team DAG Parents via REST & Cycle Detection
    {
        // Link Alpha as parent of Beta: Beta -> Alpha
        auto r_link = http_curl("POST", base_url + "/api/v1/admin/teams/" + team_beta_id + "/parents",
                                {"Authorization: Bearer " + admin_token, "Content-Type: application/json"},
                                "{\"parent_id\":\"" + team_alpha_id + "\"}");
        assert(r_link.status_code == 200);

        // List parents of Beta
        auto r_parents = http_curl("GET", base_url + "/api/v1/admin/teams/" + team_beta_id + "/parents",
                                   {"Authorization: Bearer " + admin_token});
        assert(r_parents.status_code == 200);
        auto json = nlohmann::json::parse(r_parents.body);
        assert(json.size() == 1);
        assert(json[0]["name"] == "api_team_alpha");

        // Attempt circular link: Alpha -> Beta (Alpha is already parent of Beta!)
        auto r_cycle = http_curl("POST", base_url + "/api/v1/admin/teams/" + team_alpha_id + "/parents",
                                 {"Authorization: Bearer " + admin_token, "Content-Type: application/json"},
                                 "{\"parent_id\":\"" + team_beta_id + "\"}");
        assert(r_cycle.status_code == 400);
        auto err_json = nlohmann::json::parse(r_cycle.body);
        assert(err_json["error"].get<std::string>().find("Circular DAG inheritance") != std::string::npos);
        std::cout << "  [PASS] REST circular DAG inheritance rejected with 400 Bad Request.\n";
    }

    // 4.8 REST Deletions
    {
        // Delete membership
        auto r_del_mem = http_curl("DELETE", base_url + "/api/v1/admin/teams/" + team_alpha_id + "/members/" + api_user_id,
                                   {"Authorization: Bearer " + admin_token});
        assert(r_del_mem.status_code == 200);

        // Unlink parent
        auto r_unlink = http_curl("DELETE", base_url + "/api/v1/admin/teams/" + team_beta_id + "/parents/" + team_alpha_id,
                                  {"Authorization: Bearer " + admin_token});
        assert(r_unlink.status_code == 200);

        // Delete user
        auto r_del_usr = http_curl("DELETE", base_url + "/api/v1/admin/users/" + api_user_id,
                                   {"Authorization: Bearer " + admin_token});
        assert(r_del_usr.status_code == 200);

        // Delete teams
        auto r_del_t1 = http_curl("DELETE", base_url + "/api/v1/admin/teams/" + team_alpha_id,
                                  {"Authorization: Bearer " + admin_token});
        assert(r_del_t1.status_code == 200);
        auto r_del_t2 = http_curl("DELETE", base_url + "/api/v1/admin/teams/" + team_beta_id,
                                  {"Authorization: Bearer " + admin_token});
        assert(r_del_t2.status_code == 200);

        std::cout << "  [PASS] REST deletion of memberships, parents, users, and teams verified.\n";
    }

    // Stop server
    server->stop();
    server_thread.join();
    std::filesystem::remove_all(srv_storage);

    std::cout << "\n[SUCCESS] Step 2.5 User & Team Administration Engine Test Suite passed 100%!\n";
    return 0;
}
