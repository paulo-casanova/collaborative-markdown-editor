#include "cme/document/document_service.hpp"
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

    // Clean & Seed test user
    std::string user_id;
    {
        pqxx::work tx(conn_res->get());
        tx.exec("DELETE FROM documents WHERE fs_path LIKE 'guides/%' OR fs_path LIKE 'docs/%';");
        tx.exec("DELETE FROM users WHERE username = 'doc_author';");
        std::string pw_hash = cme::auth::hash_password_bcrypt("pass123", 10);
        auto res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, is_system_admin) "
            "VALUES ('doc_author', $1, 'Doc Author', TRUE) "
            "RETURNING id;",
            pw_hash
        );
        user_id = res[0][0].as<std::string>();
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
            .title = "Intro"
        };
        auto create_res = doc_service.create_document(create_req, author_user);
        assert(create_res.has_value());
        auto doc = create_res.value();
        assert(!doc.id.empty());
        assert(doc.path == "guides/intro.md");
        assert(doc.title == "Intro");
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
        std::cout << "  - Document retrieval by UUID verified.\n";

        // 1.3 Get by Path
        auto by_path_res = doc_service.get_document_by_path("guides/intro.md", author_user);
        assert(by_path_res.has_value());
        assert(by_path_res.value().id == created_doc_id);
        std::cout << "  - Document lookup by relative path verified.\n";

        // 1.4 Get raw
        auto raw_res = doc_service.get_document_raw(created_doc_id, author_user);
        assert(raw_res.has_value());
        assert(raw_res.value() == "# Intro\nHello world");
        std::cout << "  - Raw markdown streaming verified.\n";

        // 1.5 Update document
        auto up_res = doc_service.update_document(created_doc_id, "# Intro\nUpdated text", "New Intro", author_user);
        assert(up_res.has_value());
        assert(up_res.value().content == "# Intro\nUpdated text");
        assert(up_res.value().title == "New Intro");
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
    }

    // Stop server
    std::cout << "\n[TEST] Stopping server...\n";
    server->stop();
    server_thread.join();

    // Clean up temporary files
    std::filesystem::remove_all(test_storage);
    std::filesystem::remove_all(server_storage);

    std::cout << "\n========================================================\n";
    std::cout << "=== ALL DOCUMENT & WORKSPACE TESTS PASSED!           ===\n";
    std::cout << "========================================================\n";
    return 0;
}
