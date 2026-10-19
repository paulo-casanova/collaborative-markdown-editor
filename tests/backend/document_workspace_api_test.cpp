#include "cme/document/document_service.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/session_manager.hpp"
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
    std::string out_file = "/tmp/cme_doc_test_curl_out.txt";
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
    std::cout << "=== CME Document & Workspace Tree REST API Test Suite ===\n";
    std::cout << "========================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    auto conn_res = pool->acquire();
    assert(conn_res.has_value());
    auto mig_res = cme::db::MigrationRunner::apply_migrations(conn_res->get(), "migrations");
    assert(mig_res.has_value());

    // Clean & Seed test user & team
    std::string user_id;
    std::string team_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'guides/%' OR fs_path LIKE 'docs/%' OR fs_path LIKE 'ops_dir/%' OR fs_path LIKE 'production_ops/%' OR fs_path LIKE 'standard_folder/%' OR fs_path LIKE 'Highway%';");
        tx.exec("DELETE FROM directory_metadata WHERE directory_path LIKE 'ops_dir%' OR directory_path LIKE 'production_ops%' OR directory_path LIKE 'standard_folder%' OR directory_path LIKE 'Highway%';");
        tx.exec("DELETE FROM permissions WHERE directory_path LIKE 'ops_dir%' OR directory_path LIKE 'production_ops%' OR directory_path LIKE 'standard_folder%' OR directory_path LIKE 'Highway%';");
        tx.exec("DELETE FROM users WHERE username = 'doc_author';");
        tx.exec("DELETE FROM teams WHERE name = 'doc_reviewers_team';");
        std::string pw_hash = cme::auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('doc_author', $1, 'Doc Author', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();
        auto t_res = tx.exec_params(
            "INSERT INTO teams (name, description) VALUES ('doc_reviewers_team', 'Reviewers Team') RETURNING id;"
        );
        team_id = t_res[0][0].as<std::string>();
        tx.commit();
    }

    cme::auth::UserIdentity author_user{
        .user_id = user_id,
        .username = "doc_author",
        .display_name = "Doc Author",
        .is_system_admin = true
    };

    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_doc_service_test_storage";
    std::filesystem::remove_all(test_storage);
    auto storage = std::make_shared<cme::storage::PosixStorageBackend>(test_storage.string());

    // -------------------------------------------------------------------------
    // 1. DocumentService Direct Unit Tests
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 1] Testing DocumentService direct operations...\n";
    cme::document::DocumentService doc_service(pool, storage);
    std::string created_doc_id;
    {
        // 1.1 Create document
        cme::document::CreateDocumentRequest create_req{
            .path = "guides/intro.md",
            .content = "# Intro\nHello world",
            .title = "Intro",
            .is_bundle = false,
            .number_headers = true
        };
        auto create_res = doc_service.create_document(create_req, author_user);
        assert(create_res.has_value());
        auto doc = create_res.value();
        assert(!doc.id.empty());
        assert(doc.path == "guides/intro.md");
        assert(doc.title == "Intro");
        assert(doc.number_headers == true);
        created_doc_id = doc.id;

        // Verify physical file on disk
        auto read_disk = storage->read_file("guides/intro.md");
        assert(read_disk.has_value());
        assert(read_disk.value() == "# Intro\nHello world");
        std::cout << "  - Document creation on disk & DB verified.\n";

        // 1.2 Get by ID
        auto by_id_res = doc_service.get_document_by_id(created_doc_id, author_user);
        assert(by_id_res.has_value());
        assert(by_id_res.value().content == "# Intro\nHello world");
        assert(by_id_res.value().number_headers == true);
        std::cout << "  - Document retrieval by UUID verified.\n";

        // 1.3 Get by Path
        auto by_path_res = doc_service.get_document_by_path("guides/intro.md", author_user);
        assert(by_path_res.has_value());
        assert(by_path_res.value().id == created_doc_id);
        assert(by_path_res.value().number_headers == true);
        std::cout << "  - Document lookup by relative path verified.\n";

        // 1.4 Get raw
        auto raw_res = doc_service.get_document_raw(created_doc_id, author_user);
        assert(raw_res.has_value());
        assert(raw_res.value() == "# Intro\nHello world");
        std::cout << "  - Raw markdown streaming verified.\n";

        // 1.5 Update document
        auto up_res = doc_service.update_document(created_doc_id, "# Intro\nUpdated text", "New Intro", author_user, false);
        assert(up_res.has_value());
        assert(up_res.value().content == "# Intro\nUpdated text");
        assert(up_res.value().title == "New Intro");
        assert(up_res.value().number_headers == false);
        auto disk_updated = storage->read_file("guides/intro.md");
        assert(disk_updated.value() == "# Intro\nUpdated text");
        std::cout << "  - Document content update verified.\n";

        // 1.6 Move document
        auto move_res = doc_service.move_document(created_doc_id, "guides/getting-started.md", author_user);
        assert(move_res.has_value());
        assert(move_res.value().path == "guides/getting-started.md");
        assert(!storage->exists("guides/intro.md").value());
        assert(storage->exists("guides/getting-started.md").value());
        std::cout << "  - Document move/rename in storage and DB verified.\n";

        // 1.7 Asset upload & read
        auto asset_up = doc_service.upload_asset(created_doc_id, "diagram.png", "FAKE_PNG_BINARY_BYTES", author_user);
        assert(asset_up.has_value());
        assert(storage->exists("guides/images/diagram.png").value());
        auto asset_read = doc_service.read_asset(created_doc_id, "diagram.png", author_user);
        assert(asset_read.has_value());
        assert(asset_read.value() == "FAKE_PNG_BINARY_BYTES");
        std::cout << "  - Asset upload and read verified.\n";

        // 1.8 Create bundle document
        cme::document::CreateDocumentRequest bundle_req{
            .path = "docs/architecture.bundle",
            .content = "# Architecture\nBundle index",
            .title = "Architecture",
            .is_bundle = true
        };
        auto bundle_res = doc_service.create_document(bundle_req, author_user);
        assert(bundle_res.has_value());
        assert(bundle_res.value().is_bundle);
        assert(storage->exists("docs/architecture.bundle/index.md").value());
        assert(storage->is_bundle("docs/architecture.bundle").value());
        std::cout << "  - Document bundle creation and SAL detection verified.\n";

        // 1.9 Workspace tree
        auto tree_res = doc_service.get_workspace_tree(author_user);
        assert(tree_res.has_value());
        assert(tree_res.value().is_array());
        assert(tree_res.value().size() >= 2);
        std::cout << "  - Workspace tree recursive resolution verified.\n";

        // 1.10 Soft-delete document
        auto del_res = doc_service.delete_document(created_doc_id, author_user);
        assert(del_res.has_value());
        assert(!del_res.value().empty());
        assert(!storage->exists("guides/getting-started.md").value());
        auto not_found = doc_service.get_document_by_id(created_doc_id, author_user);
        assert(!not_found.has_value() && not_found.error() == cme::ErrorCode::NotFound);
        std::cout << "  - Soft-delete to trash and database purge verified.\n";
    }

    // -------------------------------------------------------------------------
    // 2. Full HTTP REST Endpoints Integration Tests (Live Curl)
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 2] Testing HTTP REST API endpoints on live server daemon...\n";
    std::filesystem::path server_storage = std::filesystem::temp_directory_path() / "cme_doc_server_storage";
    std::filesystem::remove_all(server_storage);

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18083;
    srv_cfg.storage.root_path = server_storage.string();
    srv_cfg.database.url = db_url;

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    std::string base_url = "http://127.0.0.1:18083";

    // Obtain API token for doc_author
    std::string token;
    {
        std::string token_body = "{\"username\":\"doc_author\",\"password\":\"pass123\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/auth/tokens", {"Content-Type: application/json"}, token_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        token = json["token"].get<std::string>();
        assert(!token.empty());
    }
    std::vector<std::string> auth_header = {"Authorization: Bearer " + token};

    // 2.1 POST /api/v1/documents (Exact Step 2.3 verification command from spec)
    std::string rest_doc_id;
    {
        std::string create_body = "{\"path\":\"guides/intro.md\",\"content\":\"# Intro\\nHello world\"}";
        auto resp = http_curl("POST", base_url + "/api/v1/documents", {"Authorization: Bearer " + token, "Content-Type: application/json"}, create_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("id"));
        assert(json["path"] == "guides/intro.md");
        assert(json["title"] == "Intro");
        rest_doc_id = json["id"].get<std::string>();
        std::cout << "  - POST /api/v1/documents created document ID: " << rest_doc_id << "\n";
    }

    // 2.2 GET /api/v1/documents/{id}/raw (Exact Step 2.3 verification command from spec)
    {
        auto resp = http_curl("GET", base_url + "/api/v1/documents/" + rest_doc_id + "/raw", auth_header);
        assert(resp.status_code == 200);
        assert(resp.body == "# Intro\nHello world");
        assert(resp.headers.find("text/markdown") != std::string::npos);
        std::cout << "  - GET /api/v1/documents/{id}/raw returned exact expected markdown.\n";
    }

    // 2.3 GET /api/v1/documents/by-path
    {
        auto resp = http_curl("GET", base_url + "/api/v1/documents/by-path?path=guides/intro.md", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["id"] == rest_doc_id);
        assert(json["path"] == "guides/intro.md");
        std::cout << "  - GET /api/v1/documents/by-path returned document JSON.\n";
    }

    // 2.4 GET /api/v1/documents/{id}
    {
        auto resp = http_curl("GET", base_url + "/api/v1/documents/" + rest_doc_id, auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["id"] == rest_doc_id);
        assert(json["content"] == "# Intro\nHello world");
        std::cout << "  - GET /api/v1/documents/{id} returned full document payload.\n";
    }

    // 2.5 PUT /api/v1/documents/{id}
    {
        std::string put_body = "{\"content\":\"# Intro\\nCollaborative Live Edit\",\"title\":\"Intro Guide\"}";
        auto resp = http_curl("PUT", base_url + "/api/v1/documents/" + rest_doc_id, {"Authorization: Bearer " + token, "Content-Type: application/json"}, put_body);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["content"] == "# Intro\nCollaborative Live Edit");
        assert(json["title"] == "Intro Guide");

        // Verify raw reflects update
        auto raw_resp = http_curl("GET", base_url + "/api/v1/documents/" + rest_doc_id + "/raw", auth_header);
        assert(raw_resp.body == "# Intro\nCollaborative Live Edit");
        std::cout << "  - PUT /api/v1/documents/{id} updated document content.\n";

        // 2.5b PATCH /api/v1/documents/{id} with number_headers
        std::string patch_body = "{\"number_headers\":true}";
        auto patch_resp = http_curl("PATCH", base_url + "/api/v1/documents/" + rest_doc_id, {"Authorization: Bearer " + token, "Content-Type: application/json"}, patch_body);
        assert(patch_resp.status_code == 200);
        auto patch_json = nlohmann::json::parse(patch_resp.body);
        assert(patch_json["number_headers"] == true);
        std::cout << "  - PATCH /api/v1/documents/{id} updated number_headers metadata.\n";
    }

    // 2.6 PATCH /api/v1/documents/{id}/move
    {
        std::string move_body = "{\"new_path\":\"guides/manual.md\"}";
        auto resp = http_curl("PATCH", base_url + "/api/v1/documents/" + rest_doc_id + "/move", {"Authorization: Bearer " + token, "Content-Type: application/json"}, move_body);
        assert(resp.status_code == 200);

        // Verify by-path at new path
        auto check_resp = http_curl("GET", base_url + "/api/v1/documents/by-path?path=guides/manual.md", auth_header);
        assert(check_resp.status_code == 200);
        std::cout << "  - PATCH /api/v1/documents/{id}/move renamed document successfully.\n";
    }

    // 2.7 POST & GET /api/v1/documents/{id}/assets
    {
        std::string asset_body = "PNG_MOCK_IMAGE_DATA_12345";
        auto resp = http_curl("POST", base_url + "/api/v1/documents/" + rest_doc_id + "/assets?filename=diagram.png", {"Authorization: Bearer " + token, "Content-Type: image/png"}, asset_body);
        assert(resp.status_code == 201);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["filename"] == "diagram.png");

        // Fetch asset back
        auto get_asset = http_curl("GET", base_url + "/api/v1/documents/" + rest_doc_id + "/assets/diagram.png", auth_header);
        assert(get_asset.status_code == 200);
        assert(get_asset.body == "PNG_MOCK_IMAGE_DATA_12345");
        assert(get_asset.headers.find("image/png") != std::string::npos);
        std::cout << "  - POST and GET /api/v1/documents/{id}/assets verified.\n";
    }

    // 2.8 GET /api/v1/workspaces/tree
    {
        auto resp = http_curl("GET", base_url + "/api/v1/workspaces/tree", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("tree"));
        assert(json["tree"].is_array());
        assert(!json["tree"].empty());
        std::cout << "  - GET /api/v1/workspaces/tree returned workspace hierarchy.\n";
    }

    // 2.9 DELETE /api/v1/documents/{id}
    {
        auto resp = http_curl("DELETE", base_url + "/api/v1/documents/" + rest_doc_id, auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json["status"] == "deleted");

        // Subsequent GET returns 404
        auto check_404 = http_curl("GET", base_url + "/api/v1/documents/" + rest_doc_id, auth_header);
        assert(check_404.status_code == 404);
        std::cout << "  - DELETE /api/v1/documents/{id} soft-deleted document to trash (404 on subsequent get).\n";
    }

    // 2.10 GET /api/v1/trash
    std::string trash_entry_id;
    {
        auto resp = http_curl("GET", base_url + "/api/v1/trash", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("trash"));
        assert(json["trash"].is_array());
        assert(!json["trash"].empty());
        trash_entry_id = json["trash"][0]["id"].get<std::string>();
        assert(!trash_entry_id.empty());
        std::cout << "  - GET /api/v1/trash returned soft-deleted items (" << trash_entry_id << ").\n";
    }

    // 2.11 POST /api/v1/trash/{id}/restore
    std::string restored_doc_id;
    {
        auto resp = http_curl("POST", base_url + "/api/v1/trash/" + trash_entry_id + "/restore", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("id"));
        assert(json["path"] == "guides/manual.md");
        restored_doc_id = json["id"].get<std::string>();
        std::cout << "  - POST /api/v1/trash/{id}/restore successfully restored document.\n";

        // Check document can now be fetched again
        auto check_restored = http_curl("GET", base_url + "/api/v1/documents/by-path?path=guides/manual.md", auth_header);
        assert(check_restored.status_code == 200);
    }

    // 2.12 GET /api/v1/users/me/recents
    {
        auto resp = http_curl("GET", base_url + "/api/v1/users/me/recents?limit=10", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("recents"));
        assert(json["recents"].is_array());
        assert(!json["recents"].empty());
        std::cout << "  - GET /api/v1/users/me/recents retrieved recent documents.\n";
    }

    // 2.13 GET /api/v1/search?q=
    {
        auto resp = http_curl("GET", base_url + "/api/v1/search?q=Architecture", auth_header);
        assert(resp.status_code == 200);
        auto json = nlohmann::json::parse(resp.body);
        assert(json.contains("results"));
        assert(json["results"].is_array());
        assert(!json["results"].empty());
        assert(json["results"][0].contains("snippet"));
        std::cout << "  - GET /api/v1/search returned query matches with snippets.\n";
    }

    // 2.14 DELETE /api/v1/trash/{id} (Purge)
    {
        // First delete it back to trash
        auto del_resp = http_curl("DELETE", base_url + "/api/v1/documents/" + restored_doc_id, auth_header);
        assert(del_resp.status_code == 200);
        auto del_json = nlohmann::json::parse(del_resp.body);
        std::string new_trash_id = del_json["trash_id"].get<std::string>();

        // Now purge
        auto purge_resp = http_curl("DELETE", base_url + "/api/v1/trash/" + new_trash_id, auth_header);
        assert(purge_resp.status_code == 200);
        auto purge_json = nlohmann::json::parse(purge_resp.body);
        assert(purge_json["status"] == "purged");
        std::cout << "  - DELETE /api/v1/trash/{id} permanently purged item.\n";

        // Test 10: POST /api/v1/workspaces/directories creates an empty directory without README.md
        nlohmann::json mkdir_body = {{"path", "empty_folder/sub_folder"}};
        auto mkdir_resp = http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, mkdir_body.dump());
        assert(mkdir_resp.status_code == 201);
        auto mkdir_json = nlohmann::json::parse(mkdir_resp.body);
        assert(mkdir_json["path"] == "empty_folder/sub_folder");
        assert(mkdir_json["is_directory"] == true);
        assert(std::filesystem::is_directory(server_storage / "content" / "empty_folder" / "sub_folder"));
        assert(!std::filesystem::exists(server_storage / "content" / "empty_folder" / "sub_folder" / "README.md"));
        std::cout << "  - POST /api/v1/workspaces/directories created empty directory without README.md.\n";

        // 2.15 GET /api/v1/workspaces/directory-details
        auto dash_resp = http_curl("GET", base_url + "/api/v1/workspaces/directory-details?path=empty_folder", auth_header);
        assert(dash_resp.status_code == 200);
        auto dash_json = nlohmann::json::parse(dash_resp.body);
        assert(dash_json.contains("items"));
        assert(dash_json["items"].is_array());
        assert(dash_json["items"].size() == 1);
        assert(dash_json["items"][0]["name"] == "sub_folder");
        assert(dash_json["items"][0]["is_directory"] == true);
        std::cout << "  - GET /api/v1/workspaces/directory-details returned child items.\n";

        // 2.16 GET /api/v1/workspaces/principals
        auto princ_resp = http_curl("GET", base_url + "/api/v1/workspaces/principals", auth_header);
        assert(princ_resp.status_code == 200);
        auto princ_json = nlohmann::json::parse(princ_resp.body);
        assert(princ_json.contains("users"));
        assert(princ_json.contains("teams"));
        assert(princ_json["users"].is_array());
        std::cout << "  - GET /api/v1/workspaces/principals returned assignable principals.\n";

        // 2.17 GET /api/v1/workspaces/permissions
        auto perm_resp = http_curl("GET", base_url + "/api/v1/workspaces/permissions?target_type=DIRECTORY&directory_path=empty_folder", auth_header);
        assert(perm_resp.status_code == 200);
        auto perm_json = nlohmann::json::parse(perm_resp.body);
        assert(perm_json["can_manage"] == true);
        assert(perm_json.contains("owner"));
        assert(perm_json.contains("explicit_grants"));
        assert(perm_json.contains("inherited_grants"));
        std::cout << "  - GET /api/v1/workspaces/permissions returned ACL structure and owner.\n";

        // 2.18 POST and DELETE /api/v1/workspaces/permissions
        std::string reader_user_id;
        for (const auto& u : princ_json["users"]) {
            if (u["username"] == "doc_reader") {
                reader_user_id = u["id"].get<std::string>();
                break;
            }
        }
        if (!reader_user_id.empty()) {
            nlohmann::json add_perm = {
                {"target_type", "DIRECTORY"},
                {"directory_path", "empty_folder"},
                {"grantee_type", "USER"},
                {"grantee_id", reader_user_id},
                {"access_level", "READ"}
            };
            auto add_p_resp = http_curl("POST", base_url + "/api/v1/workspaces/permissions", auth_header, add_perm.dump());
            assert(add_p_resp.status_code == 200);
            auto updated_p_json = nlohmann::json::parse(add_p_resp.body);
            assert(!updated_p_json["explicit_grants"].empty());
            int64_t grant_id = updated_p_json["explicit_grants"][0]["id"].get<int64_t>();

            auto del_p_resp = http_curl("DELETE", base_url + "/api/v1/workspaces/permissions/" + std::to_string(grant_id), auth_header);
            assert(del_p_resp.status_code == 200);
            std::cout << "  - POST & DELETE /api/v1/workspaces/permissions managed user ACL grant successfully.\n";
        }

        // Test granting COMMENT access to a TEAM with is_inheritable = false
        if (!team_id.empty()) {
            nlohmann::json add_tp = {
                {"target_type", "DIRECTORY"},
                {"directory_path", "empty_folder"},
                {"grantee_type", "TEAM"},
                {"grantee_id", team_id},
                {"access_level", "COMMENT"},
                {"is_inheritable", false}
            };
            auto add_tp_resp = http_curl("POST", base_url + "/api/v1/workspaces/permissions", auth_header, add_tp.dump());
            assert(add_tp_resp.status_code == 200);
            auto tp_json = nlohmann::json::parse(add_tp_resp.body);
            bool found_team_comment = false;
            for (const auto& g : tp_json["explicit_grants"]) {
                if (g["grantee_type"] == "TEAM" && g["access_level"] == "COMMENT") {
                    assert(g["is_inheritable"] == false);
                    found_team_comment = true;
                }
            }
            assert(found_team_comment);
            std::cout << "  - POST /api/v1/workspaces/permissions granted COMMENT to TEAM with non-inheriting ACL successfully (no prepared statement error).\n";

            // Test Permission Inspector POST
            nlohmann::json test_post_req = {
                {"target_type", "DIRECTORY"},
                {"directory_path", "empty_folder"},
                {"subject_type", "TEAM"},
                {"subject_id", team_id}
            };
            auto test_post_resp = http_curl("POST", base_url + "/api/v1/workspaces/permissions/test", auth_header, test_post_req.dump());
            assert(test_post_resp.status_code == 200);
            auto test_post_json = nlohmann::json::parse(test_post_resp.body);
            assert(test_post_json["effective_level"] == "COMMENT");
            assert(!test_post_json["matched_rules"].empty());
            std::cout << "  - POST /api/v1/workspaces/permissions/test verified effective permissions for team.\n";

            // Test Permission Inspector GET
            auto test_get_resp = http_curl("GET", base_url + "/api/v1/workspaces/permissions/test?target_type=DIRECTORY&directory_path=empty_folder&subject_type=TEAM&subject_id=" + team_id, auth_header);
            assert(test_get_resp.status_code == 200);
            auto test_get_json = nlohmann::json::parse(test_get_resp.body);
            assert(test_get_json["effective_level"] == "COMMENT");
            std::cout << "  - GET /api/v1/workspaces/permissions/test verified effective permissions via query parameters.\n";
        }

        // 2.19 Document Bundle & Asset Management
        nlohmann::json bundle_create = {
            {"path", "docs/manual.bundle"},
            {"is_bundle", true},
            {"content", "# Manual Bundle\nOverview text."}
        };
        auto bundle_resp = http_curl("POST", base_url + "/api/v1/documents", auth_header, bundle_create.dump());
        assert(bundle_resp.status_code == 201);
        auto bundle_json = nlohmann::json::parse(bundle_resp.body);
        std::string bundle_doc_id = bundle_json["id"].get<std::string>();
        assert(bundle_json["is_bundle"] == true);

        // Upload asset into bundle
        std::string asset_data = "FAKE_PNG_BINARY_BYTES";
        std::vector<std::string> upload_headers = auth_header;
        upload_headers.push_back("Content-Type: image/png");
        auto up_asset_resp = http_curl("POST", base_url + "/api/v1/documents/" + bundle_doc_id + "/assets?filename=diagram.png", upload_headers, asset_data);
        assert(up_asset_resp.status_code == 201);

        // List bundle assets
        auto list_asset_resp = http_curl("GET", base_url + "/api/v1/documents/" + bundle_doc_id + "/assets", auth_header);
        assert(list_asset_resp.status_code == 200);
        auto list_asset_json = nlohmann::json::parse(list_asset_resp.body);
        assert(list_asset_json["is_bundle"] == true);
        assert(list_asset_json["assets"].is_array());
        assert(list_asset_json["assets"].size() == 1);
        assert(list_asset_json["assets"][0]["name"] == "diagram.png");
        assert(list_asset_json["assets"][0]["is_image"] == true);

        // Delete bundle asset
        auto del_asset_resp = http_curl("DELETE", base_url + "/api/v1/documents/" + bundle_doc_id + "/assets/diagram.png", auth_header);
        assert(del_asset_resp.status_code == 200);

        // Verify assets list is now empty
        auto list_after_resp = http_curl("GET", base_url + "/api/v1/documents/" + bundle_doc_id + "/assets", auth_header);
        assert(list_after_resp.status_code == 200);
        auto list_after_json = nlohmann::json::parse(list_after_resp.body);
        assert(list_after_json["assets"].empty());
        std::cout << "  - Document bundle asset upload, listing, and deletion verified.\n";
    }

    // 2.20 Directory Rename and Delete Lifecycle + Non-Bundle Recognition
    std::cout << "\n[STEP 2.20] Testing Directory Rename, Delete, and Non-Bundle Recognition...\n";
    {
        // Create nested directory
        nlohmann::json dir_create = {{"path", "ops_dir/sub_dir"}};
        auto dir_resp = http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, dir_create.dump());
        assert(dir_resp.status_code == 201);

        // Create document inside nested directory
        nlohmann::json doc_create = {
            {"path", "ops_dir/sub_dir/runbook.md"},
            {"title", "Ops Runbook"},
            {"content", "# Operations Runbook\nDetailed steps."}
        };
        auto doc_resp = http_curl("POST", base_url + "/api/v1/documents", auth_header, doc_create.dump());
        assert(doc_resp.status_code == 201);
        std::string runbook_id = nlohmann::json::parse(doc_resp.body)["id"].get<std::string>();

        // Set permission on ops_dir
        nlohmann::json perm_grant = {
            {"target_type", "DIRECTORY"},
            {"directory_path", "ops_dir"},
            {"grantee_type", "USER"},
            {"grantee_id", user_id},
            {"access_level", "READ"},
            {"is_inheritable", true}
        };
        auto p_grant_resp = http_curl("POST", base_url + "/api/v1/workspaces/permissions", auth_header, perm_grant.dump());
        assert(p_grant_resp.status_code == 200);

        // Rename directory ops_dir -> production_ops
        nlohmann::json rename_payload = {
            {"old_path", "ops_dir"},
            {"new_path", "production_ops"}
        };
        auto rename_resp = http_curl("PATCH", base_url + "/api/v1/workspaces/directories", auth_header, rename_payload.dump());
        assert(rename_resp.status_code == 200);
        auto rename_json = nlohmann::json::parse(rename_resp.body);
        assert(rename_json["status"] == "success");
        assert(rename_json["new_path"] == "production_ops");

        // Verify document path was updated
        auto doc_get_resp = http_curl("GET", base_url + "/api/v1/documents/by-path?path=production_ops/sub_dir/runbook.md", auth_header);
        assert(doc_get_resp.status_code == 200);
        auto doc_get_json = nlohmann::json::parse(doc_get_resp.body);
        assert(doc_get_json["id"] == runbook_id);
        assert(doc_get_json["path"] == "production_ops/sub_dir/runbook.md");

        // Verify workspace tree contains new path and does not contain old path
        auto tree_check_resp = http_curl("GET", base_url + "/api/v1/workspaces/tree", auth_header);
        assert(tree_check_resp.status_code == 200);
        auto tree_check_json = nlohmann::json::parse(tree_check_resp.body);
        bool found_new_tree = false;
        bool found_old_tree = false;
        for (const auto& item : tree_check_json["tree"]) {
            if (item["path"] == "production_ops/sub_dir/runbook.md") found_new_tree = true;
            if (item["path"] == "ops_dir/sub_dir/runbook.md" || item["path"] == "ops_dir") found_old_tree = true;
        }
        assert(found_new_tree);
        assert(!found_old_tree);

        // Verify directory permissions moved to new path
        auto perm_check_resp = http_curl("GET", base_url + "/api/v1/workspaces/permissions?target_type=DIRECTORY&directory_path=production_ops", auth_header);
        assert(perm_check_resp.status_code == 200);
        auto perm_check_json = nlohmann::json::parse(perm_check_resp.body);
        assert(!perm_check_json["explicit_grants"].empty());

        // Delete directory production_ops to trash
        auto del_dir_resp = http_curl("DELETE", base_url + "/api/v1/workspaces/directories?path=production_ops", auth_header);
        assert(del_dir_resp.status_code == 200);
        auto del_dir_json = nlohmann::json::parse(del_dir_resp.body);
        assert(del_dir_json["status"] == "success");
        std::string dir_trash_id = del_dir_json["trash_id"].get<std::string>();
        assert(!dir_trash_id.empty());

        // Document should no longer be accessible
        auto doc_after_del = http_curl("GET", base_url + "/api/v1/documents/" + runbook_id, auth_header);
        assert(doc_after_del.status_code == 404);

        // Trash should list the deleted directory
        auto trash_list_resp = http_curl("GET", base_url + "/api/v1/trash", auth_header);
        assert(trash_list_resp.status_code == 200);
        auto trash_list_json = nlohmann::json::parse(trash_list_resp.body);
        bool found_in_trash = false;
        for (const auto& item : trash_list_json["trash"]) {
            if (item["id"] == dir_trash_id) {
                found_in_trash = true;
                assert(item["is_directory"] == true);
                break;
            }
        }
        assert(found_in_trash);

        // Verify directory with index.md is NOT recognized as bundle unless named .bundle
        nlohmann::json standard_dir = {{"path", "standard_folder"}};
        auto std_dir_resp = http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, standard_dir.dump());
        assert(std_dir_resp.status_code == 201);

        nlohmann::json idx_doc = {
            {"path", "standard_folder/index.md"},
            {"content", "# Standard Folder Index\nNot a bundle!"}
        };
        auto idx_resp = http_curl("POST", base_url + "/api/v1/documents", auth_header, idx_doc.dump());
        assert(idx_resp.status_code == 201);

        // Inspect in tree
        auto tree_resp = http_curl("GET", base_url + "/api/v1/workspaces/tree", auth_header);
        assert(tree_resp.status_code == 200);
        auto tree_json = nlohmann::json::parse(tree_resp.body);
        for (const auto& item : tree_json["tree"]) {
            if (item["path"] == "standard_folder") {
                assert(item["is_directory"] == true);
                assert(item["is_bundle"] == false);
            }
        }
        std::cout << "  - Directory rename, delete to trash, and .bundle naming enforcement verified.\n";
    }

    {
        std::cout << "\n[STEP 2.21] Testing stem resolution, folder notes, and stale directory purging...\n";
        // Create directory structure: Highway/Projects/Nanobump US Equities
        nlohmann::json d1 = {{"path", "Highway"}};
        http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, d1.dump());
        nlohmann::json d2 = {{"path", "Highway/Projects"}};
        http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, d2.dump());
        nlohmann::json d3 = {{"path", "Highway/Projects/Nanobump US Equities"}};
        http_curl("POST", base_url + "/api/v1/workspaces/directories", auth_header, d3.dump());

        // Create the markdown document inside: Highway/Projects/Nanobump US Equities/Nanobump US Equities.md
        nlohmann::json doc_body = {
            {"path", "Highway/Projects/Nanobump US Equities/Nanobump US Equities.md"},
            {"content", "# Nanobump US Equities\nDocument content."}
        };
        auto create_resp = http_curl("POST", base_url + "/api/v1/documents", auth_header, doc_body.dump());
        assert(create_resp.status_code == 201);
        auto doc_json = nlohmann::json::parse(create_resp.body);
        std::string expected_doc_id = doc_json["id"];

        // Artificially insert a stale pure directory record in documents table to simulate legacy DB state
        {
            pqxx::connection conn(db_url);
            pqxx::work wtx(conn);
            wtx.exec_params(
                "INSERT INTO documents (fs_path, title) VALUES ($1, $2) ON CONFLICT DO NOTHING;",
                "Highway/Projects/Nanobump US Equities",
                "Nanobump US Equities"
            );
            wtx.commit();
        }

        // 1. Query by stem "Nanobump US Equities"
        auto stem_resp = http_curl("GET", base_url + "/api/v1/documents/by-path?path=Nanobump%20US%20Equities", auth_header);
        assert(stem_resp.status_code == 200);
        auto stem_json = nlohmann::json::parse(stem_resp.body);
        assert(stem_json["id"] == expected_doc_id);
        assert(stem_json["path"] == "Highway/Projects/Nanobump US Equities/Nanobump US Equities.md");
        assert(stem_json["is_bundle"] == false);

        // 2. Query by directory path "Highway/Projects/Nanobump US Equities"
        auto dir_path_resp = http_curl("GET", base_url + "/api/v1/documents/by-path?path=Highway/Projects/Nanobump%20US%20Equities", auth_header);
        assert(dir_path_resp.status_code == 200);
        auto dir_path_json = nlohmann::json::parse(dir_path_resp.body);
        assert(dir_path_json["id"] == expected_doc_id);
        assert(dir_path_json["path"] == "Highway/Projects/Nanobump US Equities/Nanobump US Equities.md");

        // 3. Verify stale directory record was purged from documents table
        {
            pqxx::connection conn(db_url);
            pqxx::work rtx(conn);
            auto rows = rtx.exec_params(
                "SELECT id FROM documents WHERE fs_path = $1;",
                "Highway/Projects/Nanobump US Equities"
            );
            assert(rows.empty());
        }

        std::cout << "  - Stem and folder note resolution and directory purge verified.\n";
    }

    {
        std::cout << "\n[TEST 18] Bundle ZIP Download and Workspace Asset Import\n";

        {
            pqxx::connection conn(db_url);
            pqxx::work wtx(conn);
            wtx.exec("DELETE FROM documents WHERE fs_path LIKE 'reports/%' OR fs_path LIKE 'shared_assets/%';");
            wtx.commit();
        }

        // 1. Create a bundle document: reports/quarterly.bundle
        auto create_bundle_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents",
            auth_header,
            nlohmann::json{
                {"path", "reports/quarterly.bundle"},
                {"title", "Quarterly Report"},
                {"content", "# Q3 Financial Report\n\n![Chart](images/chart.png)\n"},
                {"is_bundle", true}
            }.dump()
        );
        assert(create_bundle_resp.status_code == 201);
        auto bundle_json = nlohmann::json::parse(create_bundle_resp.body);
        std::string bundle_doc_id = bundle_json["id"].get<std::string>();

        // 2. Upload asset into bundle: chart.png
        auto upload_asset_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + bundle_doc_id + "/assets?filename=chart.png",
            auth_header,
            "FAKE_PNG_BINARY_DATA_FOR_CHART"
        );
        assert(upload_asset_resp.status_code == 201);

        // 3. Create a standalone file in workspace: shared_assets/company_logo.svg
        auto upload_logo_resp = http_curl(
            "POST",
            base_url + "/api/v1/workspaces/files?path=shared_assets/company_logo.svg",
            auth_header,
            "<svg><circle r='10'/></svg>"
        );
        assert(upload_logo_resp.status_code == 200 || upload_logo_resp.status_code == 201);

        // 4. Import shared_assets/company_logo.svg into the bundle assets list via /api/v1/documents/:id/assets/import
        auto import_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + bundle_doc_id + "/assets/import",
            auth_header,
            nlohmann::json{
                {"source_path", "shared_assets/company_logo.svg"},
                {"target_filename", "imported_logo.svg"}
            }.dump()
        );
        assert(import_resp.status_code == 201);
        auto import_json = nlohmann::json::parse(import_resp.body);
        assert(import_json["filename"] == "imported_logo.svg");

        // 5. Verify bundle assets list now contains both chart.png and imported_logo.svg
        auto list_assets_resp = http_curl(
            "GET",
            base_url + "/api/v1/documents/" + bundle_doc_id + "/assets",
            auth_header
        );
        assert(list_assets_resp.status_code == 200);
        auto assets_json = nlohmann::json::parse(list_assets_resp.body);
        bool found_chart = false;
        bool found_logo = false;
        for (const auto& a : assets_json["assets"]) {
            std::string n = a["name"].get<std::string>();
            if (n == "chart.png") found_chart = true;
            if (n == "imported_logo.svg") found_logo = true;
        }
        assert(found_chart);
        assert(found_logo);

        // 6. Download bundle zip via /api/v1/workspaces/bundles/zip?path=reports/quarterly.bundle
        auto zip_resp = http_curl(
            "GET",
            base_url + "/api/v1/workspaces/bundles/zip?path=reports/quarterly.bundle",
            auth_header
        );
        assert(zip_resp.status_code == 200);
        assert(zip_resp.headers.find("Content-Type: application/zip") != std::string::npos);
        assert(zip_resp.headers.find("quarterly.bundle.zip") != std::string::npos);
        // Verify PKZIP magic bytes (PK\x03\x04)
        assert(zip_resp.body.size() > 4);
        assert(zip_resp.body[0] == 'P' && zip_resp.body[1] == 'K' && zip_resp.body[2] == 0x03 && zip_resp.body[3] == 0x04);

        // 7. Download bundle zip via /api/v1/documents/:id/bundle.zip
        auto doc_zip_resp = http_curl(
            "GET",
            base_url + "/api/v1/documents/" + bundle_doc_id + "/bundle.zip",
            auth_header
        );
        assert(doc_zip_resp.status_code == 200);
        assert(doc_zip_resp.headers.find("Content-Type: application/zip") != std::string::npos);

        // 8. Test real zip extraction using unzip command-line utility
        std::string test_zip_path = "/tmp/cme_test_quarterly.zip";
        std::ofstream zip_out(test_zip_path, std::ios::binary);
        zip_out.write(zip_resp.body.data(), zip_resp.body.size());
        zip_out.close();

        int unzip_test_ret = std::system("unzip -t /tmp/cme_test_quarterly.zip > /dev/null 2>&1");
        assert(unzip_test_ret == 0);

        std::filesystem::remove(test_zip_path);

        std::cout << "  - Bundle ZIP download and workspace asset import successfully verified.\n";
    }

    // 9. Document to Bundle and Bundle to Document Conversion
    {
        std::cout << "\n[TEST] Testing document <-> bundle conversion (/api/v1/documents/:id/convert)...\n";
        // Create regular document
        auto create_doc_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents",
            auth_header,
            nlohmann::json{
                {"path", "reports/convert_sample.md"},
                {"title", "Convert Sample"},
                {"content", "# Sample Markdown\nOriginal file text.\n"},
                {"is_bundle", false}
            }.dump()
        );
        assert(create_doc_resp.status_code == 201);
        auto doc_json = nlohmann::json::parse(create_doc_resp.body);
        std::string conv_doc_id = doc_json["id"].get<std::string>();
        assert(doc_json["is_bundle"] == false);
        assert(doc_json["path"] == "reports/convert_sample.md");

        // Convert to Bundle
        auto conv_to_bundle_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + conv_doc_id + "/convert",
            auth_header
        );
        assert(conv_to_bundle_resp.status_code == 200);
        auto conv_to_bundle_json = nlohmann::json::parse(conv_to_bundle_resp.body);
        assert(conv_to_bundle_json["is_bundle"] == true);
        assert(conv_to_bundle_json["path"] == "reports/convert_sample.bundle");

        // Verify storage on disk
        assert(!std::filesystem::exists(server_storage / "content" / "reports/convert_sample.md"));
        assert(std::filesystem::exists(server_storage / "content" / "reports/convert_sample.bundle/index.md"));

        // Upload an asset into the bundle
        auto upload_asset_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + conv_doc_id + "/assets?filename=embedded_image.png",
            auth_header,
            "TEST_ASSET_CONTENT"
        );
        assert(upload_asset_resp.status_code == 201);
        assert(std::filesystem::exists(server_storage / "content" / "reports/convert_sample.bundle/images/embedded_image.png"));

        // Convert back to regular Document
        auto conv_to_doc_resp = http_curl(
            "POST",
            base_url + "/api/v1/documents/" + conv_doc_id + "/convert",
            auth_header
        );
        assert(conv_to_doc_resp.status_code == 200);
        auto conv_to_doc_json = nlohmann::json::parse(conv_to_doc_resp.body);
        assert(conv_to_doc_json["is_bundle"] == false);
        assert(conv_to_doc_json["path"] == "reports/convert_sample.md");

        // Verify storage on disk:
        // Document should be back at reports/convert_sample.md
        // embedded_image.png should be moved to sibling images directory reports/images/embedded_image.png
        // Bundle folder reports/convert_sample.bundle should no longer exist
        assert(std::filesystem::exists(server_storage / "content" / "reports/convert_sample.md"));
        assert(std::filesystem::exists(server_storage / "content" / "reports/images/embedded_image.png"));
        assert(!std::filesystem::exists(server_storage / "content" / "reports/convert_sample.bundle"));

        std::cout << "  - Document <-> Bundle bidirectional conversion successfully verified.\n";
    }

    // Stop server
    std::cout << "\n[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();

    // Clean up temporary files
    std::filesystem::remove_all(test_storage);
    std::filesystem::remove_all(server_storage);

    // Clean up test database records
    try {
        pqxx::connection conn(db_url);
        pqxx::work clean_tx(conn);
        clean_tx.exec("DELETE FROM documents WHERE fs_path LIKE 'guides/%' OR fs_path LIKE 'docs/%' OR fs_path LIKE 'ops_dir/%' OR fs_path LIKE 'production_ops/%' OR fs_path LIKE 'standard_folder/%' OR fs_path LIKE 'Highway%' OR fs_path LIKE 'reports/%' OR fs_path LIKE 'shared_assets/%';");
        clean_tx.exec("DELETE FROM directory_metadata WHERE directory_path LIKE 'ops_dir%' OR directory_path LIKE 'production_ops%' OR directory_path LIKE 'standard_folder%' OR directory_path LIKE 'Highway%' OR directory_path LIKE 'reports%' OR directory_path LIKE 'shared_assets%';");
        clean_tx.exec("DELETE FROM permissions WHERE directory_path LIKE 'ops_dir%' OR directory_path LIKE 'production_ops%' OR directory_path LIKE 'standard_folder%' OR directory_path LIKE 'Highway%' OR directory_path LIKE 'reports%' OR directory_path LIKE 'shared_assets%';");
        clean_tx.exec("DELETE FROM users WHERE username IN ('doc_author', 'doc_reader');");
        clean_tx.exec("DELETE FROM teams WHERE name = 'doc_reviewers_team';");
        clean_tx.commit();
    } catch (...) {}

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL DOCUMENT & WORKSPACE TESTS PASSED!           ===\n";
    std::cout << "========================================================\n";
    return 0;
}
