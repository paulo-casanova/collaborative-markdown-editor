#include "cme/server/server.hpp"
#include "cme/db/migration_runner.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/auth/admin_provider.hpp"
#include "cme/auth/session_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/document/document_service.hpp"
#include <cassert>
#include <iostream>
#include <fstream>
#include <sstream>
#include <thread>
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <vector>

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
    std::string out_file = "/tmp/cme_tags_curl_out.txt";
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
    hss >> http_ver >> resp.status_code;

    return resp;
}

} // namespace

int main() {
    std::cout << "===============================================================\n";
    std::cout << "=== CME Document Tags Service & REST API Test Suite        ===\n";
    std::cout << "===============================================================\n";

    const std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    std::filesystem::path test_storage = std::filesystem::temp_directory_path() / "cme_tags_test_storage";
    std::filesystem::remove_all(test_storage);
    std::filesystem::create_directories(test_storage);

    auto pool = cme::db::ConnectionPool::create(db_url, 4);
    assert(pool != nullptr);

    // 1. Migrations
    std::cout << "\n[STEP 1] Validating schema migrations on test database...\n";
    {
        auto conn = pool->acquire();
        assert(conn.has_value());
        auto mig_res = cme::db::MigrationRunner::apply_migrations(conn->get(), "migrations");
        assert(mig_res.has_value());
        std::cout << "  - Migrations verified.\n";
    }

    // 2. Seed Test User & Document
    std::cout << "\n[STEP 2] Seeding test user and document...\n";
    std::string test_user_id;
    std::string doc_id;
    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());

        std::string pw_hash = cme::auth::hash_password_bcrypt("secret123");

        auto u_rows = tx.exec_params("SELECT id FROM users WHERE username = 'tag_tester';");
        if (u_rows.empty()) {
            auto ins = tx.exec_params(
                "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
                "VALUES ('tag_tester', $1, 'Tag Tester', '#10b981', TRUE) RETURNING id;",
                pw_hash
            );
            test_user_id = ins[0][0].as<std::string>();
        } else {
            test_user_id = u_rows[0][0].as<std::string>();
        }

        auto d_rows = tx.exec_params(
            "SELECT id FROM documents WHERE fs_path = 'specs/tags_test_doc.md';"
        );
        if (d_rows.empty()) {
            auto ins_doc = tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ('specs/tags_test_doc.md', 'Tags Test Document', $1::uuid) "
                "RETURNING id;",
                test_user_id
            );
            doc_id = ins_doc[0][0].as<std::string>();
        } else {
            doc_id = d_rows[0][0].as<std::string>();
        }

        tx.exec_params("DELETE FROM document_tags WHERE document_id = $1::uuid;", doc_id);
        tx.commit();
    }
    assert(!test_user_id.empty());
    assert(!doc_id.empty());

    // 3. Test Tag Reconciliation
    std::cout << "\n[STEP 3] Testing DocumentService::reconcile_document_tags...\n";
    std::string initial_content =
        "---\n"
        "title: Tags Test Document\n"
        "tags: [obsidian/meta, documentation]\n"
        "---\n"
        "# Architecture Overview\n\n"
        "This project uses #cme/core for realtime sync and #v1-release tracking.\n\n"
        "## Performance\n\n"
        "Keep latency low with #cme/core and #cme/perf.\n";

    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());
        auto rec_res = cme::document::DocumentService::reconcile_document_tags(tx, doc_id, initial_content);
        assert(rec_res.has_value());
        tx.commit();
    }

    // Verify DB rows
    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto tag_rows = tx.exec_params(
            "SELECT tag, heading_anchor, line_number FROM document_tags "
            "WHERE document_id = $1::uuid ORDER BY line_number ASC, tag ASC;",
            doc_id
        );

        // Expected tags: obsidian/meta, documentation, cme/core, v1-release, cme/core, cme/perf
        std::cout << "  - Found " << tag_rows.size() << " tag occurrences in database.\n";
        assert(tag_rows.size() >= 5);

        bool found_cme_core = false;
        bool found_meta = false;
        for (const auto& r : tag_rows) {
            std::string t = r[0].as<std::string>();
            if (t == "cme/core") found_cme_core = true;
            if (t == "obsidian/meta") found_meta = true;
        }
        assert(found_cme_core);
        assert(found_meta);
        std::cout << "  - Reconciliation inserted tags correctly.\n";
    }

    // 4. Test Update Document Content (Removing tags and adding new ones)
    std::cout << "\n[STEP 4] Testing reconciliation on content update...\n";
    std::string updated_content =
        "# New Overview\n\n"
        "Replaced all old tags with #security and #cme/core.\n";

    {
        auto conn = pool->acquire().value();
        pqxx::work tx(conn.get());
        auto rec_res = cme::document::DocumentService::reconcile_document_tags(tx, doc_id, updated_content);
        assert(rec_res.has_value());
        tx.commit();
    }

    {
        auto conn = pool->acquire().value();
        pqxx::read_transaction tx(conn.get());
        auto tag_rows = tx.exec_params(
            "SELECT tag FROM document_tags WHERE document_id = $1::uuid ORDER BY tag ASC;",
            doc_id
        );

        assert(tag_rows.size() == 2);
        assert(tag_rows[0][0].as<std::string>() == "cme/core");
        assert(tag_rows[1][0].as<std::string>() == "security");
        std::cout << "  - Stale tags successfully deleted, new tags active.\n";
    }

    // 5. Test DocumentService::list_tags & get_tag_documents
    std::cout << "\n[STEP 5] Testing DocumentService C++ query methods...\n";
    auto storage_backend = std::make_shared<cme::storage::PosixStorageBackend>(test_storage);
    cme::document::DocumentService doc_service(pool, storage_backend);

    cme::auth::UserIdentity user;
    user.user_id = test_user_id;
    user.username = "tag_tester";
    user.is_system_admin = true;

    auto list_res = doc_service.list_tags(user);
    assert(list_res.has_value());
    const auto& tags = list_res.value();
    assert(tags.size() >= 2);
    std::cout << "  - list_tags returned " << tags.size() << " distinct tags.\n";

    auto doc_match_res = doc_service.get_tag_documents(user, "cme/core");
    assert(doc_match_res.has_value());
    assert(doc_match_res.value().total_documents >= 1);
    assert(doc_match_res.value().documents[0].document_id == doc_id);
    std::cout << "  - get_tag_documents for 'cme/core' matched document " << doc_id << ".\n";

    // 6. Test REST Server Endpoints
    std::cout << "\n[STEP 6] Testing REST API endpoints (/api/v1/tags, /api/v1/tags/documents)...\n";
    std::filesystem::path admin_cfg = std::filesystem::temp_directory_path() / "cme_tags_admin.txt";
    {
        std::ofstream out(admin_cfg);
        out << "tag_tester\n";
    }
    auto admin_prov = std::make_shared<cme::auth::FileAdminProvider>(admin_cfg.string());
    cme::auth::SessionManager session_mgr(pool, admin_prov);

    auto sess_user = session_mgr.create_session(test_user_id, 24, "127.0.0.1", "TagsTest-User");
    assert(sess_user.has_value());
    std::string token = sess_user->raw_token;

    cme::config::AppConfig srv_cfg;
    srv_cfg.server.bind = "127.0.0.1";
    srv_cfg.server.port = 18099;
    srv_cfg.storage.root_path = test_storage.string();
    srv_cfg.database.url = db_url;
    srv_cfg.database.lease_enabled = false;
    srv_cfg.authz.admin_provider = "file";
    srv_cfg.authz.admin_file_path = admin_cfg.string();

    auto server = std::make_shared<cme::server::Server>(srv_cfg);
    std::thread server_thread([server]() {
        auto res = server->start();
        (void)res;
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    std::string base_url = "http://127.0.0.1:18099";

    std::vector<std::string> auth_headers = {
        "Authorization: Bearer " + token
    };

    // 6a: GET /api/v1/tags
    auto r1 = http_curl("GET", base_url + "/api/v1/tags", auth_headers);
    assert(r1.status_code == 200);
    auto j1 = nlohmann::json::parse(r1.body);
    assert(j1.is_array());
    assert(j1.size() >= 2);
    std::cout << "  - GET /api/v1/tags returned 200 OK with " << j1.size() << " tags.\n";

    // 6b: GET /api/v1/tags?q=sec
    auto r2 = http_curl("GET", base_url + "/api/v1/tags?q=sec", auth_headers);
    assert(r2.status_code == 200);
    auto j2 = nlohmann::json::parse(r2.body);
    assert(j2.size() == 1);
    assert(j2[0]["tag"] == "security");
    std::cout << "  - GET /api/v1/tags?q=sec returned 200 OK with tag 'security'.\n";

    // 6c: GET /api/v1/tags/documents?tag=cme/core
    auto r3 = http_curl("GET", base_url + "/api/v1/tags/documents?tag=cme/core", auth_headers);
    assert(r3.status_code == 200);
    auto j3 = nlohmann::json::parse(r3.body);
    assert(j3["tag"] == "cme/core");
    assert(j3["total_documents"] >= 1);
    assert(j3["documents"][0]["id"] == doc_id);
    std::cout << "  - GET /api/v1/tags/documents?tag=cme/core returned 200 OK with matching documents.\n";

    // 6d: Missing tag parameter returns 400 Bad Request
    auto r4 = http_curl("GET", base_url + "/api/v1/tags/documents", auth_headers);
    assert(r4.status_code == 400);
    std::cout << "  - GET /api/v1/tags/documents without tag returned 400 Bad Request.\n";

    server->stop();
    if (server_thread.joinable()) server_thread.join();

    std::filesystem::remove_all(test_storage);
    std::filesystem::remove(admin_cfg);

    std::cout << "\n>>> ALL TAG TESTS PASSED SUCCESSFULLY! <<<\n";
    return 0;
}
