#include "cme/audit/audit_service.hpp"
#include "cme/document/document_service.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/server/server.hpp"
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
    std::string out_file = "/tmp/cme_audit_test_curl_out.txt";
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
        // Parsed
    }

    return resp;
}

} // namespace

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== CME Persistent Audit Logging & Event Logs Test   ===\n";
    std::cout << "========================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean up test audit logs and users
    std::string admin_id;
    std::string user_id;
    std::string stranger_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM audit_logs WHERE username LIKE 'audit_%';");
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'audit_docs/%';");
        tx.exec("DELETE FROM users WHERE username IN ('audit_admin', 'audit_bob', 'audit_stranger');");

        std::string pw_hash = auth::hash_password_bcrypt("pass123", 10);
        auto a_res = tx.exec(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('audit_admin', '" + tx.esc(pw_hash) + "', 'Audit Admin', TRUE) RETURNING id;"
        );
        admin_id = a_res[0][0].as<std::string>();

        auto u_res = tx.exec(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('audit_bob', '" + tx.esc(pw_hash) + "', 'Audit Bob', FALSE) RETURNING id;"
        );
        user_id = u_res[0][0].as<std::string>();

        auto s_res = tx.exec(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('audit_stranger', '" + tx.esc(pw_hash) + "', 'Audit Stranger', FALSE) RETURNING id;"
        );
        stranger_id = s_res[0][0].as<std::string>();

        tx.exec("DELETE FROM permissions WHERE directory_path LIKE 'audit_docs%' OR COALESCE(directory_path, '') = '';");
        tx.exec(
            "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) "
            "VALUES ('DIRECTORY', '', 'USER', '" + user_id + "'::uuid, 'EDIT', TRUE);"
        );
        tx.commit();
    }

    // =========================================================================
    // 1. AuditService Direct Unit Tests
    // =========================================================================
    std::cout << "\n[TEST 1] Testing AuditService direct record & query methods...\n";
    audit::AuditService audit_service(pool);

    {
        audit::AuditEvent e1{
            .user_id = user_id,
            .username = "audit_direct_user",
            .user_agent = "CME-DirectAgent/1.0",
            .action = "CREATE_DOCUMENT",
            .document_id = std::nullopt,
            .path = "audit_docs/direct_test.md",
            .result = "SUCCESS",
            .details = {{"file_size", 42}}
        };
        auto rec1 = audit_service.record(e1);
        assert(rec1.has_value());

        audit::AuditEvent e2{
            .user_id = admin_id,
            .username = "audit_direct_admin",
            .user_agent = "CME-DirectAgent/1.0",
            .action = "TRANSFER_OWNERSHIP",
            .document_id = std::nullopt,
            .path = "audit_docs/direct_test.md",
            .result = "FAILED",
            .details = {{"error", "User not found"}}
        };
        auto rec2 = audit_service.record(e2);
        assert(rec2.has_value());

        // Query all logs
        audit::AuditQuery f_all;
        auto logs_all = audit_service.query(f_all);
        assert(logs_all.has_value());
        assert(logs_all->size() >= 2);

        // Filter by action
        audit::AuditQuery f_act;
        f_act.action = "CREATE_DOCUMENT";
        auto logs_act = audit_service.query(f_act);
        assert(logs_act.has_value());
        assert(!logs_act->empty());
        assert((*logs_act)[0].action == "CREATE_DOCUMENT");
        assert((*logs_act)[0].username == "audit_direct_user");
        assert((*logs_act)[0].user_agent == "CME-DirectAgent/1.0");
        assert((*logs_act)[0].path == "audit_docs/direct_test.md");
        assert((*logs_act)[0].details["file_size"] == 42);

        // Filter by user_id
        audit::AuditQuery f_user;
        f_user.user_id = admin_id;
        auto logs_user = audit_service.query(f_user);
        assert(logs_user.has_value());
        assert(!logs_user->empty());
        assert((*logs_user)[0].action == "TRANSFER_OWNERSHIP");
        assert((*logs_user)[0].result == "FAILED");

        // Filter with limit
        audit::AuditQuery f_lim;
        f_lim.limit = 1;
        auto logs_lim = audit_service.query(f_lim);
        assert(logs_lim.has_value());
        assert(logs_lim->size() == 1);

        std::cout << "  [PASS] Direct AuditService record & query validated.\n";
    }

    // =========================================================================
    // 2. Server Event Logs (Room creation/eviction, Saves, Rejected edits)
    // =========================================================================
    std::cout << "\n[TEST 2] Testing Server Event Logging outputs...\n";
    {
        // 2.1 Room Manager logging
        auto room_mgr = std::make_shared<collab::RoomManager>();
        
        std::ostringstream captured;
        auto* old_buf = std::cout.rdbuf(captured.rdbuf());

        auto room = room_mgr->get_or_create_room("doc-event-101", "# Hello Event", "audit_docs/event.md");
        assert(room != nullptr);
        room_mgr->remove_room("doc-event-101");

        std::cout.rdbuf(old_buf);
        std::string room_logs = captured.str();

        assert(room_logs.find("[INFO] [ROOM] Created collaborative room for document doc-event-101") != std::string::npos);
        assert(room_logs.find("[INFO] [ROOM] Evicted collaborative room for document doc-event-101") != std::string::npos);
        std::cout << "  [PASS] Room creation and eviction event logs verified.\n";
    }

    {
        // 2.2 DocumentService Save & Edit Rejection logging
        std::filesystem::path srv_storage = std::filesystem::temp_directory_path() / "cme_audit_storage_events";
        std::filesystem::remove_all(srv_storage);
        auto storage = std::make_shared<storage::PosixStorageBackend>(srv_storage.string());
        document::DocumentService doc_svc(pool, storage);

        auth::UserIdentity author_user{
            .user_id = user_id,
            .username = "audit_bob",
            .display_name = "Audit Bob",
            .is_system_admin = false
        };

        auth::UserIdentity stranger_user{
            .user_id = stranger_id,
            .username = "audit_stranger",
            .display_name = "Audit Stranger",
            .is_system_admin = false
        };

        std::ostringstream captured;
        auto* old_buf = std::cout.rdbuf(captured.rdbuf());

        document::CreateDocumentRequest create_req{
            .path = "audit_docs/sample.md",
            .content = "# Initial",
            .title = "Sample Doc",
            .is_bundle = false
        };
        auto doc = doc_svc.create_document(create_req, author_user);
        assert(doc.has_value());

        // Successful update -> [SAVE] log
        auto upd = doc_svc.update_document(
            doc->id,
            "# Updated Content",
            std::nullopt,
            author_user
        );
        assert(upd.has_value());

        // Rejected edit (stranger with no edit permission) -> [EDIT_REJECTED] log
        auto bad_upd = doc_svc.update_document(
            doc->id,
            "# Unauthorized Edit",
            std::nullopt,
            stranger_user
        );
        assert(!bad_upd.has_value());
        assert(bad_upd.error() == ErrorCode::PermissionDenied);

        std::cout.rdbuf(old_buf);
        std::string doc_logs = captured.str();

        assert(doc_logs.find("[INFO] [SAVE] Successfully saved document " + doc->id) != std::string::npos);
        assert(doc_logs.find("[WARN] [EDIT_REJECTED] Rejected update on document " + doc->id) != std::string::npos);
        std::cout << "  [PASS] Document save and edit rejection event logs verified.\n";

        std::filesystem::remove_all(srv_storage);
    }

    // =========================================================================
    // 3. Live Server REST API Auditing Integration
    // =========================================================================
    std::cout << "\n[TEST 3] Testing live Server Daemon REST Auditing and Admin Logs...\n";
    std::filesystem::path live_storage = std::filesystem::temp_directory_path() / "cme_audit_live_storage";
    std::filesystem::remove_all(live_storage);

    config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18098;
    srv_cfg.storage.root_path = live_storage.string();
    srv_cfg.database.url = db_url;

    auto server = std::make_shared<server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18098";

    // 3.1 Authenticate admin & bob
    std::string admin_token;
    {
        std::string body = "{\"username\":\"audit_admin\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        admin_token = json["token"].get<std::string>();
    }

    std::string bob_token;
    {
        std::string body = "{\"username\":\"audit_bob\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        bob_token = json["token"].get<std::string>();
    }

    const std::string custom_agent = "CME-CustomAgent/2.0";

    // 3.2 Non-admin cannot access GET /api/v1/admin/audit-logs
    {
        auto resp = http_curl(
            "GET",
            base_url + "/api/v1/admin/audit-logs",
            {"Authorization: Bearer " + bob_token, "User-Agent: " + custom_agent}
        );
        assert(resp.status_code == 403);
        std::cout << "  [PASS] Non-admin access to audit logs rejected with 403 Forbidden.\n";
    }

    // 3.3 Perform REST Document operations with custom User-Agent
    std::string test_doc_id;
    {
        // Create document
        nlohmann::json c_req = {
            {"path", "audit_docs/doc1.md"},
            {"content", "# Audit First Document"},
            {"is_bundle", false}
        };
        auto r_create = http_curl(
            "POST",
            base_url + "/api/v1/documents",
            {"Authorization: Bearer " + bob_token, "Content-Type: application/json", "User-Agent: " + custom_agent},
            c_req.dump()
        );
        assert(r_create.status_code == 201);
        auto c_json = nlohmann::json::parse(r_create.body);
        test_doc_id = c_json["id"].get<std::string>();

        // Update document (PUT)
        nlohmann::json u_req = {
            {"content", "# Audit Document Updated"}
        };
        auto r_put = http_curl(
            "PUT",
            base_url + "/api/v1/documents/" + test_doc_id,
            {"Authorization: Bearer " + bob_token, "Content-Type: application/json", "User-Agent: " + custom_agent},
            u_req.dump()
        );
        assert(r_put.status_code == 200);

        // Move document
        nlohmann::json m_req = {
            {"new_path", "audit_docs/moved_doc1.md"}
        };
        auto r_move = http_curl(
            "PATCH",
            base_url + "/api/v1/documents/" + test_doc_id + "/move",
            {"Authorization: Bearer " + bob_token, "Content-Type: application/json", "User-Agent: " + custom_agent},
            m_req.dump()
        );
        assert(r_move.status_code == 200);

        // Delete document (soft-delete to trash)
        auto r_del = http_curl(
            "DELETE",
            base_url + "/api/v1/documents/" + test_doc_id,
            {"Authorization: Bearer " + bob_token, "User-Agent: " + custom_agent}
        );
        assert(r_del.status_code == 200);
        auto del_json = nlohmann::json::parse(r_del.body);
        std::string trash_id = del_json["trash_id"].get<std::string>();

        // Restore document from trash
        auto r_restore = http_curl(
            "POST",
            base_url + "/api/v1/trash/" + trash_id + "/restore",
            {"Authorization: Bearer " + bob_token, "User-Agent: " + custom_agent}
        );
        assert(r_restore.status_code == 200);

        std::cout << "  [PASS] REST Document operations executed with custom User-Agent.\n";
    }

    // 3.4 Verify Audit logs via Admin endpoint GET /api/v1/admin/audit-logs
    {
        auto r_logs = http_curl(
            "GET",
            base_url + "/api/v1/admin/audit-logs",
            {"Authorization: Bearer " + admin_token}
        );
        assert(r_logs.status_code == 200);
        auto logs = nlohmann::json::parse(r_logs.body);
        assert(logs.is_array());
        assert(!logs.empty());

        bool found_create = false;
        bool found_update = false;
        bool found_move = false;
        bool found_delete = false;
        bool found_restore = false;

        for (const auto& l : logs) {
            std::string act = l["action"].get<std::string>();
            std::string u_agent = l["user_agent"].get<std::string>();
            std::string uname = l["username"].get<std::string>();
            std::string res = l["result"].get<std::string>();

            if (uname == "audit_bob") {
                assert(u_agent == custom_agent);
                assert(res == "SUCCESS");
                assert(!l["timestamp"].get<std::string>().empty());

                if (act == "CREATE_DOCUMENT") found_create = true;
                if (act == "UPDATE_DOCUMENT") found_update = true;
                if (act == "MOVE_DOCUMENT") found_move = true;
                if (act == "DELETE_DOCUMENT") found_delete = true;
                if (act == "RESTORE_DOCUMENT") found_restore = true;
            }
        }

        assert(found_create);
        assert(found_update);
        assert(found_move);
        assert(found_delete);
        assert(found_restore);
        std::cout << "  [PASS] All Document REST operations properly audited in DB table.\n";
    }

    // 3.5 Query filters testing on GET /api/v1/admin/audit-logs
    {
        // Filter by action=MOVE_DOCUMENT
        auto r_filter_act = http_curl(
            "GET",
            base_url + "/api/v1/admin/audit-logs?action=MOVE_DOCUMENT",
            {"Authorization: Bearer " + admin_token}
        );
        assert(r_filter_act.status_code == 200);
        auto act_logs = nlohmann::json::parse(r_filter_act.body);
        assert(act_logs.is_array());
        for (const auto& l : act_logs) {
            assert(l["action"] == "MOVE_DOCUMENT");
        }

        // Filter by user_id
        auto r_filter_user = http_curl(
            "GET",
            base_url + "/api/v1/admin/audit-logs?user_id=" + user_id,
            {"Authorization: Bearer " + admin_token}
        );
        assert(r_filter_user.status_code == 200);
        auto user_logs = nlohmann::json::parse(r_filter_user.body);
        assert(user_logs.is_array());
        for (const auto& l : user_logs) {
            assert(l["user_id"] == user_id);
        }

        // Limit & offset
        auto r_limit = http_curl(
            "GET",
            base_url + "/api/v1/admin/audit-logs?limit=2",
            {"Authorization: Bearer " + admin_token}
        );
        assert(r_limit.status_code == 200);
        auto lim_logs = nlohmann::json::parse(r_limit.body);
        assert(lim_logs.is_array());
        assert(lim_logs.size() <= 2);

        std::cout << "  [PASS] Admin audit logs query filters and pagination validated.\n";
    }

    // Stop server
    server->stop();
    server_thread.join();
    std::filesystem::remove_all(live_storage);

    // Teardown test records
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM audit_logs WHERE username LIKE 'audit_%';");
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'audit_docs/%';");
        tx.exec("DELETE FROM permissions WHERE directory_path LIKE 'audit_docs%' OR COALESCE(directory_path, '') = '';");
        tx.exec("DELETE FROM users WHERE username IN ('audit_admin', 'audit_bob', 'audit_stranger');");
        tx.commit();
    }

    std::cout << "\n[SUCCESS] Issue #30 Persistent Audit & Event Logging Test Suite passed 100%!\n";
    return 0;
}
