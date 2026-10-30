#include "cme/dialog/dialog_service.hpp"
#include "cme/dialog/agent_manager.hpp"
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
#include <nlohmann/json.hpp>

using namespace cme;
using namespace cme::dialog;
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
    std::string out_file = "/tmp/cme_dialog_test_curl_out.txt";
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
    std::cout << "=== CME Dialogs & Local Agent API Test Suite         ===\n";
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
        tx.exec("DELETE FROM users WHERE username LIKE 'dlg_test_%';");
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'dlg_test_%';");
        tx.commit();
    }

    UserService user_service(pool);
    DialogService dialog_service(pool);

    // Create test users Alice and Bob
    auto u_alice = user_service.create_user(CreateUserRequest{
        .username = "dlg_test_alice",
        .password = "password123",
        .display_name = "Alice Dialog",
        .avatar_color = "#3b82f6",
        .is_system_admin = false
    });
    assert(u_alice.has_value());
    std::string alice_id = u_alice->id;

    auto u_bob = user_service.create_user(CreateUserRequest{
        .username = "dlg_test_bob",
        .password = "password123",
        .display_name = "Bob Dialog",
        .avatar_color = "#ef4444",
        .is_system_admin = false
    });
    assert(u_bob.has_value());
    std::string bob_id = u_bob->id;

    // Create test document owned by Alice
    std::string doc_id;
    {
        pqxx::work tx(conn_res->get());
        auto r = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ('dlg_test_doc.md', 'Test Document for Dialogs', $1::uuid) "
            "RETURNING id;",
            alice_id
        );
        doc_id = r[0][0].as<std::string>();
        tx.commit();
    }

    // =========================================================================
    // 1. Direct DialogService Unit Tests
    // =========================================================================
    std::cout << "\n[TEST 1] Testing direct DialogService operations...\n";

    // 1.1 Create Dialog
    auto dlg_res = dialog_service.create_dialog(alice_id, "System Architecture Refactor");
    assert(dlg_res.has_value());
    assert(!dlg_res->id.empty());
    assert(dlg_res->title == "System Architecture Refactor");
    assert(dlg_res->user_id == alice_id);
    std::string dialog_id = dlg_res->id;
    std::cout << "  [PASS] Created dialog " << dialog_id << "\n";

    // 1.2 List Dialogs
    auto list_res = dialog_service.list_dialogs(alice_id);
    assert(list_res.has_value());
    assert(list_res->size() == 1);
    assert(list_res->front().id == dialog_id);
    assert(list_res->front().message_count == 0);

    // Bob has 0 dialogs
    auto bob_list = dialog_service.list_dialogs(bob_id);
    assert(bob_list.has_value());
    assert(bob_list->empty());
    std::cout << "  [PASS] List dialogs isolated per user.\n";

    // 1.3 Get Dialog
    auto get_res = dialog_service.get_dialog(alice_id, dialog_id);
    assert(get_res.has_value());
    assert(get_res->title == "System Architecture Refactor");

    // Bob cannot fetch Alice's dialog
    auto bob_get = dialog_service.get_dialog(bob_id, dialog_id);
    assert(!bob_get.has_value());
    assert(bob_get.error() == ErrorCode::NotFound);
    std::cout << "  [PASS] Get dialog enforces ownership.\n";

    // 1.4 Update Dialog
    auto upd_res = dialog_service.update_dialog(alice_id, dialog_id, "System Architecture v2");
    assert(upd_res.has_value());
    assert(upd_res->title == "System Architecture v2");
    std::cout << "  [PASS] Update dialog title verified.\n";

    // 1.5 Add Messages & Context Snapshots
    nlohmann::json snap1 = {
        {"active_document", {{"id", doc_id}, {"title", "Test Document"}}},
        {"selection_range", {{"from_line", 10}, {"to_line", 25}}},
        {"selection_text", "Sample markdown selection"}
    };
    auto msg1_res = dialog_service.add_message(alice_id, dialog_id, "user", "How should we refactor this?", snap1);
    assert(msg1_res.has_value());
    assert(msg1_res->role == "user");
    assert(msg1_res->content == "How should we refactor this?");
    assert(msg1_res->context_snapshot["selection_range"]["from_line"] == 10);

    auto msg2_res = dialog_service.add_message(alice_id, dialog_id, "assistant", "I suggest extracting a service layer.");
    assert(msg2_res.has_value());
    assert(msg2_res->role == "assistant");

    // List messages
    auto msgs_res = dialog_service.list_messages(alice_id, dialog_id);
    assert(msgs_res.has_value());
    assert(msgs_res->size() == 2);
    assert((*msgs_res)[0].role == "user");
    assert((*msgs_res)[1].role == "assistant");

    // Bob cannot list Alice's messages
    auto bob_msgs = dialog_service.list_messages(bob_id, dialog_id);
    assert(!bob_msgs.has_value());
    assert(bob_msgs.error() == ErrorCode::NotFound);
    std::cout << "  [PASS] Dialog messages and context snapshots verified.\n";

    // 1.6 Document Association Preferences
    auto pref_initial = dialog_service.get_document_dialog(alice_id, doc_id);
    assert(pref_initial.has_value());
    assert(!pref_initial.value().has_value()); // nullopt initially

    assert(dialog_service.set_document_dialog(alice_id, doc_id, dialog_id).has_value());
    auto pref_set = dialog_service.get_document_dialog(alice_id, doc_id);
    assert(pref_set.has_value() && pref_set.value().has_value());
    assert(pref_set.value().value() == dialog_id);

    // Bob still has no preference for this doc
    auto bob_pref = dialog_service.get_document_dialog(bob_id, doc_id);
    assert(bob_pref.has_value() && !bob_pref.value().has_value());

    // Clear association
    assert(dialog_service.set_document_dialog(alice_id, doc_id, "").has_value());
    auto pref_cleared = dialog_service.get_document_dialog(alice_id, doc_id);
    assert(pref_cleared.has_value() && !pref_cleared.value().has_value());
    std::cout << "  [PASS] Document-dialog preference get/set/clear verified.\n";

    // 1.7 Agent Token Operations
    auto tok_res = dialog_service.create_agent_token(alice_id, "Workstation Laptop");
    assert(tok_res.has_value());
    assert(!tok_res->token.empty());
    assert(tok_res->name == "Workstation Laptop");
    std::string raw_token = tok_res->token;
    std::string token_id = tok_res->id;

    // Validate with valid plaintext token
    auto val_res = dialog_service.validate_agent_token(raw_token);
    assert(val_res.has_value() && val_res.value().has_value());
    assert(val_res.value().value() == alice_id);

    // Validate with wrong token
    auto val_bad = dialog_service.validate_agent_token("invalid_token_xyz");
    assert(val_bad.has_value() && !val_bad.value().has_value());

    // List tokens
    auto tokens_list = dialog_service.list_agent_tokens(alice_id);
    assert(tokens_list.has_value());
    assert(tokens_list->size() == 1);
    assert(tokens_list->front().name == "Workstation Laptop");
    assert(tokens_list->front().last_used_at.has_value()); // was touched by validate

    // Bob cannot revoke Alice's token
    assert(!dialog_service.revoke_agent_token(bob_id, token_id).has_value());

    // Alice revokes token
    assert(dialog_service.revoke_agent_token(alice_id, token_id).has_value());
    auto tokens_after = dialog_service.list_agent_tokens(alice_id);
    assert(tokens_after.has_value() && tokens_after->empty());

    // Validating revoked token fails
    auto val_revoked = dialog_service.validate_agent_token(raw_token);
    assert(val_revoked.has_value() && !val_revoked.value().has_value());
    std::cout << "  [PASS] Agent token creation, validation, listing, and revocation verified.\n";

    // Clean up direct dialog
    assert(dialog_service.delete_dialog(alice_id, dialog_id).has_value());
    std::cout << "  [PASS] Dialog deletion cascaded successfully.\n";

    // 1.8 AgentManager Unit Test
    {
        AgentManager mgr;
        mgr.track_prompt_started("user_1", "dlg_1");
        mgr.track_prompt_started("user_1", "dlg_2");
        assert(mgr.is_prompt_pending("dlg_1") == true);
        assert(mgr.is_prompt_pending("dlg_2") == true);
        assert(mgr.is_prompt_pending("dlg_3") == false);

        mgr.track_prompt_completed("dlg_1");
        assert(mgr.is_prompt_pending("dlg_1") == false);
        assert(mgr.is_prompt_pending("dlg_2") == true);

        auto pending = mgr.get_and_clear_pending_dialogs("user_1");
        assert(pending.size() == 1);
        assert(pending[0] == "dlg_2");
        assert(mgr.is_prompt_pending("dlg_2") == false);
        assert(mgr.get_and_clear_pending_dialogs("user_1").empty());
        std::cout << "  [PASS] AgentManager prompt tracking and cleanup verified.\n";
    }

    // =========================================================================
    // 2. HTTP REST Endpoints Test
    // =========================================================================
    std::cout << "\n[TEST 2] Testing Dialog & Agent HTTP REST Endpoints...\n";

    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_dialog_test_storage";
    std::filesystem::remove_all(test_storage);

    config::AppConfig cfg;
    cfg.server.bind = "127.0.0.1";
    cfg.server.port = 18096;
    cfg.storage.root_path = test_storage.string();
    cfg.database.url = db_url;
    cfg.database.lease_enabled = false;
    cfg.authn.provider = "challenge";

    auto server = std::make_shared<server::Server>(cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18096";

    // 2.1 Obtain Auth Tokens for Alice and Bob
    std::string alice_token;
    {
        std::string body = "{\"username\":\"dlg_test_alice\",\"password\":\"password123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        alice_token = json["token"].get<std::string>();
        assert(!alice_token.empty());
    }

    std::string bob_token;
    {
        std::string body = "{\"username\":\"dlg_test_bob\",\"password\":\"password123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        bob_token = json["token"].get<std::string>();
        assert(!bob_token.empty());
    }

    // 2.2 Unauthenticated guard check
    {
        auto resp = http_curl("GET", base_url + "/api/v1/dialogs");
        assert(resp.status_code == 401);
        std::cout << "  [PASS] 401 Unauthorized enforced without authentication.\n";
    }

    // 2.3 POST /api/v1/dialogs
    std::string api_dialog_id;
    {
        std::string body = "{\"title\":\"API Design Discussion\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/dialogs",
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["title"] == "API Design Discussion");
        api_dialog_id = json["id"].get<std::string>();
        assert(!api_dialog_id.empty());
        std::cout << "  [PASS] POST /api/v1/dialogs returned 201 Created.\n";
    }

    // 2.4 GET /api/v1/dialogs and GET /api/v1/workspaces/dialogs
    {
        auto resp = http_curl("GET", base_url + "/api/v1/dialogs", {"Authorization: Bearer " + alice_token});
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.is_array());
        assert(json.size() == 1);
        assert(json[0]["id"] == api_dialog_id);

        auto resp_alias = http_curl("GET", base_url + "/api/v1/workspaces/dialogs", {"Authorization: Bearer " + alice_token});
        assert(resp_alias.status_code == 200);
        std::cout << "  [PASS] GET /api/v1/dialogs and /workspaces/dialogs returned active threads.\n";
    }

    // 2.5 GET /api/v1/dialogs/:id & isolation check
    {
        auto resp_alice = http_curl("GET", base_url + "/api/v1/dialogs/" + api_dialog_id,
                                    {"Authorization: Bearer " + alice_token});
        assert(resp_alice.status_code == 200);
        auto json = nlohmann::json::parse(resp_alice.body);
        assert(json["id"] == api_dialog_id);

        auto resp_bob = http_curl("GET", base_url + "/api/v1/dialogs/" + api_dialog_id,
                                  {"Authorization: Bearer " + bob_token});
        assert(resp_bob.status_code == 404);
        std::cout << "  [PASS] GET /api/v1/dialogs/:id isolated between users.\n";
    }

    // 2.6 PATCH /api/v1/dialogs/:id
    {
        std::string body = "{\"title\":\"API Design Discussion (Updated)\"}";
        auto resp = http_curl("PATCH", base_url + "/api/v1/dialogs/" + api_dialog_id,
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["title"] == "API Design Discussion (Updated)");
        std::cout << "  [PASS] PATCH /api/v1/dialogs/:id updated title.\n";
    }

    // 2.7 POST & GET /api/v1/dialogs/:id/messages, POST fork & truncate
    {
        nlohmann::json body = {
            {"role", "user"},
            {"content", "Should we support JSON and SSE for LLM responses?"},
            {"context_snapshot", {{"active_doc", "api.md"}}}
        };
        auto resp = http_curl("POST", base_url + "/api/v1/dialogs/" + api_dialog_id + "/messages",
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body.dump());
        assert(resp.status_code == 201);
        auto msg_json = nlohmann::json::parse(resp.body);
        assert(msg_json["role"] == "user");
        assert(msg_json["content"] == "Should we support JSON and SSE for LLM responses?");
        assert(msg_json["context_snapshot"]["active_doc"] == "api.md");
        std::string msg1_id = msg_json["id"].get<std::string>();

        // Post second message
        nlohmann::json body2 = {{"role", "assistant"}, {"content", "Yes, SSE streaming is ideal."}};
        auto resp2 = http_curl("POST", base_url + "/api/v1/dialogs/" + api_dialog_id + "/messages",
                               {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body2.dump());
        assert(resp2.status_code == 201);
        auto msg2_json = nlohmann::json::parse(resp2.body);
        std::string msg2_id = msg2_json["id"].get<std::string>();

        // Post third message
        nlohmann::json body3 = {{"role", "user"}, {"content", "What about websockets?"}};
        auto resp3 = http_curl("POST", base_url + "/api/v1/dialogs/" + api_dialog_id + "/messages",
                               {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body3.dump());
        assert(resp3.status_code == 201);

        auto list_resp = http_curl("GET", base_url + "/api/v1/dialogs/" + api_dialog_id + "/messages",
                                   {"Authorization: Bearer " + alice_token});
        assert(list_resp.status_code == 200);
        auto list_json = nlohmann::json::parse(list_resp.body);
        assert(list_json.is_array());
        assert(list_json.size() == 3);
        std::cout << "  [PASS] POST and GET /api/v1/dialogs/:id/messages verified.\n";

        // Fork dialog up to msg2
        nlohmann::json fork_body = {{"up_to_message_id", msg2_id}, {"title", "Forked Branch"}};
        auto fork_resp = http_curl("POST", base_url + "/api/v1/dialogs/" + api_dialog_id + "/fork",
                                   {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, fork_body.dump());
        assert(fork_resp.status_code == 201);
        auto fork_json = nlohmann::json::parse(fork_resp.body);
        assert(fork_json["title"] == "Forked Branch");
        std::string forked_dialog_id = fork_json["id"].get<std::string>();

        // Check forked messages count
        auto forked_msgs_resp = http_curl("GET", base_url + "/api/v1/dialogs/" + forked_dialog_id + "/messages",
                                          {"Authorization: Bearer " + alice_token});
        assert(forked_msgs_resp.status_code == 200);
        auto forked_msgs = nlohmann::json::parse(forked_msgs_resp.body);
        assert(forked_msgs.size() == 2);
        std::cout << "  [PASS] POST /api/v1/dialogs/:id/fork verified.\n";

        // Delete forked dialog
        auto del_fork = http_curl("DELETE", base_url + "/api/v1/dialogs/" + forked_dialog_id,
                                  {"Authorization: Bearer " + alice_token});
        assert(del_fork.status_code == 200);

        // Truncate original dialog after msg1 (reset conversation to msg1)
        nlohmann::json trunc_body = {{"message_id", msg1_id}, {"inclusive", false}};
        auto trunc_resp = http_curl("POST", base_url + "/api/v1/dialogs/" + api_dialog_id + "/truncate",
                                    {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, trunc_body.dump());
        assert(trunc_resp.status_code == 200);
        auto trunc_json = nlohmann::json::parse(trunc_resp.body);
        assert(trunc_json["remaining_count"] == 1);

        auto post_trunc_list = http_curl("GET", base_url + "/api/v1/dialogs/" + api_dialog_id + "/messages",
                                         {"Authorization: Bearer " + alice_token});
        assert(post_trunc_list.status_code == 200);
        auto post_trunc_json = nlohmann::json::parse(post_trunc_list.body);
        assert(post_trunc_json.size() == 1);
        assert(post_trunc_json[0]["id"] == msg1_id);
        std::cout << "  [PASS] POST /api/v1/dialogs/:id/truncate verified.\n";
    }

    // 2.8 PUT & GET /api/v1/documents/:id/dialog
    {
        nlohmann::json put_body = {{"dialog_id", api_dialog_id}};
        auto put_resp = http_curl("PUT", base_url + "/api/v1/documents/" + doc_id + "/dialog",
                                  {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, put_body.dump());
        assert(put_resp.status_code == 200);
        auto put_json = nlohmann::json::parse(put_resp.body);
        assert(put_json["last_dialog_id"] == api_dialog_id);

        auto get_resp = http_curl("GET", base_url + "/api/v1/documents/" + doc_id + "/dialog",
                                  {"Authorization: Bearer " + alice_token});
        assert(get_resp.status_code == 200);
        auto get_json = nlohmann::json::parse(get_resp.body);
        assert(get_json["last_dialog_id"] == api_dialog_id);
        std::cout << "  [PASS] Document-dialog preference endpoint verified.\n";
    }

    // 2.9 Agent Token REST Endpoints
    std::string api_token_id;
    {
        // POST /api/v1/user/agent-tokens
        nlohmann::json body = {{"name", "CLI Local Agent"}};
        auto resp = http_curl("POST", base_url + "/api/v1/user/agent-tokens",
                              {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, body.dump());
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["name"] == "CLI Local Agent");
        assert(json.contains("token") && !json["token"].get<std::string>().empty());
        api_token_id = json["id"].get<std::string>();

        // GET /api/v1/user/agent-tokens
        auto list_resp = http_curl("GET", base_url + "/api/v1/user/agent-tokens",
                                   {"Authorization: Bearer " + alice_token});
        assert(list_resp.status_code == 200);
        auto list_json = nlohmann::json::parse(list_resp.body);
        assert(list_json.is_array());
        assert(list_json.size() == 1);
        assert(list_json[0]["id"] == api_token_id);

        // GET /api/v1/user/agent/status
        auto status_resp = http_curl("GET", base_url + "/api/v1/user/agent/status",
                                     {"Authorization: Bearer " + alice_token});
        assert(status_resp.status_code == 200);
        auto status_json = nlohmann::json::parse(status_resp.body);
        assert(status_json.contains("online"));
        assert(status_json["online"] == false);

        // DELETE /api/v1/user/agent-tokens/:id
        auto del_resp = http_curl("DELETE", base_url + "/api/v1/user/agent-tokens/" + api_token_id,
                                  {"Authorization: Bearer " + alice_token});
        assert(del_resp.status_code == 200);
        std::cout << "  [PASS] Agent token REST endpoints verified.\n";
    }

    // 2.10 DELETE /api/v1/dialogs/:id
    {
        auto del_resp = http_curl("DELETE", base_url + "/api/v1/dialogs/" + api_dialog_id,
                                  {"Authorization: Bearer " + alice_token});
        assert(del_resp.status_code == 200);

        auto get_deleted = http_curl("GET", base_url + "/api/v1/dialogs/" + api_dialog_id,
                                     {"Authorization: Bearer " + alice_token});
        assert(get_deleted.status_code == 404);
        std::cout << "  [PASS] DELETE /api/v1/dialogs/:id verified.\n";
    }

    // 2.11 POST /api/v1/dialogs/:id/stop
    {
        // Create dialog
        nlohmann::json d_body = {{"title", "Stop Test Thread"}};
        auto create_resp = http_curl("POST", base_url + "/api/v1/dialogs",
                                     {"Content-Type: application/json", "Authorization: Bearer " + alice_token}, d_body.dump());
        assert(create_resp.status_code == 201);
        auto d_json = nlohmann::json::parse(create_resp.body);
        std::string stop_dlg_id = d_json["id"].get<std::string>();

        // Call stop endpoint
        auto stop_resp = http_curl("POST", base_url + "/api/v1/dialogs/" + stop_dlg_id + "/stop",
                                   {"Authorization: Bearer " + alice_token});
        assert(stop_resp.status_code == 200);
        auto stop_json = nlohmann::json::parse(stop_resp.body);
        assert(stop_json["status"] == "stopped");
        assert(stop_json["dialog_id"] == stop_dlg_id);

        // Clean up
        http_curl("DELETE", base_url + "/api/v1/dialogs/" + stop_dlg_id,
                  {"Authorization: Bearer " + alice_token});
        std::cout << "  [PASS] POST /api/v1/dialogs/:id/stop verified.\n";
    }

    std::cout << "[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();
    std::filesystem::remove_all(test_storage);

    std::cout << "\n[PASS] All Dialog & Local Agent API tests passed successfully!\n";
    return 0;
}
