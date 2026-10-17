/**
 * @file markdown_renderer_test.cpp
 * @brief Comprehensive automated test suite for Server-Side Markdown to Semantic HTML Renderer (Step 2.4).
 */

#include "cme/renderer/markdown_renderer.hpp"
#include "cme/server/server.hpp"
#include "cme/config/config.hpp"
#include "cme/auth/crypto_utils.hpp"
#include "cme/document/document_service.hpp"
#include <iostream>
#include <cassert>
#include <filesystem>
#include <thread>
#include <chrono>
#include <sstream>
#include <regex>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fstream>
#include <pqxx/pqxx>

namespace fs = std::filesystem;

namespace {

struct HttpResponse {
    int status_code{0};
    std::string headers;
    std::string body;
};

HttpResponse http_get(
    int port,
    const std::string& path,
    const std::vector<std::string>& extra_headers = {}
) {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    assert(sock >= 0);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

    if (connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        close(sock);
        return {0, "", ""};
    }

    std::ostringstream req;
    req << "GET " << path << " HTTP/1.1\r\n"
        << "Host: 127.0.0.1:" << port << "\r\n"
        << "Connection: close\r\n";
    for (const auto& h : extra_headers) {
        req << h << "\r\n";
    }
    req << "\r\n";

    std::string req_str = req.str();
    write(sock, req_str.data(), req_str.size());

    std::string raw_resp;
    char buf[4096];
    ssize_t bytes = 0;
    while ((bytes = read(sock, buf, sizeof(buf))) > 0) {
        raw_resp.append(buf, static_cast<size_t>(bytes));
    }
    close(sock);

    HttpResponse res;
    auto header_end = raw_resp.find("\r\n\r\n");
    if (header_end != std::string::npos) {
        res.headers = raw_resp.substr(0, header_end);
        res.body = raw_resp.substr(header_end + 4);

        std::istringstream h_stream(res.headers);
        std::string status_line;
        if (std::getline(h_stream, status_line)) {
            std::regex status_regex(R"(HTTP/1\.[01]\s+(\d{3}))");
            std::smatch match;
            if (std::regex_search(status_line, match, status_regex)) {
                res.status_code = std::stoi(match[1].str());
            }
        }
    }
    return res;
}

} // namespace

int main() {
    std::cout << "[TEST] Starting Server-Side Markdown to Semantic HTML Renderer Test Suite (Step 2.4)...\n";

    // =========================================================================
    // 1. UNIT TEST: Core Markdown Formatting & Elements
    // =========================================================================
    {
        std::cout << "  -> Testing core Markdown element rendering...\n";
        std::string md = 
            "# Main Title\n"
            "## Main Title\n" // tests slug deduplication: main-title-1
            "Text with **bold**, *italic*, ~~strikethrough~~, _underline_, and `code`.\n\n"
            "> A blockquote note.\n\n"
            "- [x] Completed task\n"
            "- [ ] Pending task\n\n"
            "| Header A | Header B |\n"
            "| :--- | :---: |\n"
            "| Left cell | Centered cell |\n";

        cme::renderer::RenderOptions opts{.standalone = false};
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        assert(html.find("<h1 id=\"main-title\">Main Title</h1>") != std::string::npos);
        assert(html.find("<h2 id=\"main-title-1\">Main Title</h2>") != std::string::npos);
        assert(html.find("<strong>bold</strong>") != std::string::npos);
        assert(html.find("<em>italic</em>") != std::string::npos);
        assert(html.find("<del>strikethrough</del>") != std::string::npos);
        assert(html.find("<u>underline</u>") != std::string::npos);
        assert(html.find("<code>code</code>") != std::string::npos);
        assert(html.find("<blockquote>\n<p>A blockquote note.</p>\n</blockquote>") != std::string::npos);
        assert(html.find("<li class=\"task-list-item\"><input type=\"checkbox\" disabled class=\"task-list-item-checkbox\" checked=\"\" /> Completed task</li>") != std::string::npos);
        assert(html.find("<li class=\"task-list-item\"><input type=\"checkbox\" disabled class=\"task-list-item-checkbox\" /> Pending task</li>") != std::string::npos);
        assert(html.find("<th align=\"left\">Header A</th>") != std::string::npos);
        assert(html.find("<th align=\"center\">Header B</th>") != std::string::npos);
        assert(html.find("<td align=\"left\">Left cell</td>") != std::string::npos);
        assert(html.find("<td align=\"center\">Centered cell</td>") != std::string::npos);
        std::cout << "     [PASS] Core elements, slugs, and task lists rendered successfully.\n";
    }

    // =========================================================================
    // 1b. UNIT TEST: Image Dimensions & Native Sizing
    // =========================================================================
    {
        std::cout << "  -> Testing image dimension parsing and native sizing...\n";
        std::string md =
            "Default image: ![System Architecture](diagram.png)\n\n"
            "Width-only image: ![System Architecture|400](diagram.png)\n\n"
            "WxH image: ![System Architecture|400x300](diagram.png)\n\n"
            "Percentage image: ![System Architecture|50%](diagram.png)\n\n"
            "Height-only image: ![System Architecture|x250](diagram.png)\n\n"
            "Pure dimension alt: ![600x400](diagram.png)\n";

        cme::renderer::RenderOptions opts{.standalone = false};
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        assert(html.find("<img src=\"diagram.png\" alt=\"System Architecture\" style=\"max-width: 100%; height: auto;\" />") != std::string::npos);
        assert(html.find("<img src=\"diagram.png\" alt=\"System Architecture\" style=\"max-width: 100%; width: 400px; height: auto;\" />") != std::string::npos);
        assert(html.find("<img src=\"diagram.png\" alt=\"System Architecture\" style=\"max-width: 100%; width: 400px; height: 300px; object-fit: contain;\" />") != std::string::npos);
        assert(html.find("<img src=\"diagram.png\" alt=\"System Architecture\" style=\"max-width: 100%; width: 50%; height: auto;\" />") != std::string::npos);
        assert(html.find("<img src=\"diagram.png\" alt=\"System Architecture\" style=\"max-width: 100%; height: 250px; object-fit: contain;\" />") != std::string::npos);
        assert(html.find("<img src=\"diagram.png\" alt=\"\" style=\"max-width: 100%; width: 600px; height: 400px; object-fit: contain;\" />") != std::string::npos);
        std::cout << "     [PASS] Image dimensions and native sizing rendered accurately.\n";
    }

    // =========================================================================
    // 2. UNIT TEST: KaTeX Math Transforms ($inline$ and $$display$$)
    // =========================================================================
    {
        std::cout << "  -> Testing KaTeX math transforms...\n";
        std::string md = 
            "Inline equation: $E = mc^2$ in a paragraph.\n\n"
            "Display equation:\n"
            "$$\n"
            "\\int_0^\\infty e^{-x} dx = 1\n"
            "$$\n";

        cme::renderer::RenderOptions opts{.standalone = false};
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        assert(html.find("<span class=\"katex-inline\" data-expr=\"E = mc^2\">$E = mc^2$</span>") != std::string::npos);
        assert(html.find("<div class=\"katex-display\" data-expr=") != std::string::npos);
        assert(html.find("\\int_0^\\infty e^{-x} dx = 1") != std::string::npos);
        std::cout << "     [PASS] KaTeX math stubs transformed accurately.\n";
    }

    // =========================================================================
    // 3. UNIT TEST: Mermaid Diagrams and Code Blocks
    // =========================================================================
    {
        std::cout << "  -> Testing Mermaid diagram transformations and syntax code blocks...\n";
        std::string md = 
            "```mermaid\n"
            "flowchart LR\n"
            "    Client --> Backend\n"
            "    Backend --> DB\n"
            "```\n\n"
            "```cpp\n"
            "#include <iostream>\n"
            "int main() { return 0; }\n"
            "```\n";

        cme::renderer::RenderOptions opts{.standalone = false};
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        // Mermaid block must be converted into <div class="mermaid">
        assert(html.find("<div class=\"mermaid\">\nflowchart LR\n") != std::string::npos);
        assert(html.find("Client --&gt; Backend") != std::string::npos);
        assert(html.find("</div>") != std::string::npos);

        // Standard code block must remain <pre><code class="language-cpp">
        assert(html.find("<pre><code class=\"language-cpp\">#include &lt;iostream&gt;\nint main() { return 0; }") != std::string::npos);
        std::cout << "     [PASS] Mermaid diagram blocks converted into <div class=\"mermaid\">.\n";
    }

    // =========================================================================
    // 4. UNIT TEST: Wiki Links & Standalone HTML5 Document
    // =========================================================================
    {
        std::cout << "  -> Testing wiki links and standalone HTML wrapper...\n";
        std::string md = 
            "# Specification\n"
            "Refer to [[Architecture/System Overview|System Specs]] and [[Roadmap]].\n";

        cme::renderer::RenderOptions opts{
            .standalone = true,
            .title = "CME Documentation Specification"
        };
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        assert(html.find("<!DOCTYPE html>") != std::string::npos);
        assert(html.find("<html lang=\"en\">") != std::string::npos);
        assert(html.find("<title>CME Documentation Specification</title>") != std::string::npos);
        assert(html.find("katex.min.css") != std::string::npos);
        assert(html.find("mermaid.esm.min.mjs") != std::string::npos);
        assert(html.find("<div class=\"cme-container\">") != std::string::npos);
        assert(html.find("<article class=\"cme-content\">") != std::string::npos);
        assert(html.find("<a class=\"wiki-link\" href=\"/api/v1/documents/by-path/html?path=Architecture%2FSystem%20Overview\" data-target=\"Architecture/System Overview\">System Specs</a>") != std::string::npos);
        assert(html.find("<a class=\"wiki-link\" href=\"/api/v1/documents/by-path/html?path=Roadmap\" data-target=\"Roadmap\">Roadmap</a>") != std::string::npos);
        assert(html.find("</html>") != std::string::npos);
        std::cout << "     [PASS] Standalone HTML5 document with embedded styles and wiki links validated.\n";
    }

    // =========================================================================
    // 4b. UNIT TEST: Custom Pills & Status Badges ([pill:color|label], [status:done])
    // =========================================================================
    {
        std::cout << "  -> Testing custom pills and badges rendering...\n";
        std::string md = 
            "Document status: [pill:green|Approved] and [pill:amber|In Progress].\n\n"
            "Blocker: [pill:rose|Critical Bug #42]. Default: [pill:Draft].\n\n"
            "Semantic shortcuts: [status:done] and [priority:p0].\n";

        cme::renderer::RenderOptions opts{.standalone = false};
        std::string html = cme::renderer::MarkdownRenderer::render_to_html(md, opts);

        assert(html.find("<span class=\"cme-pill cme-pill-green\" data-color=\"green\">Approved</span>") != std::string::npos);
        assert(html.find("<span class=\"cme-pill cme-pill-amber\" data-color=\"amber\">In Progress</span>") != std::string::npos);
        assert(html.find("<span class=\"cme-pill cme-pill-rose\" data-color=\"rose\">Critical Bug #42</span>") != std::string::npos);
        assert(html.find("<span class=\"cme-pill cme-pill-slate\" data-color=\"slate\">Draft</span>") != std::string::npos);
        assert(html.find("<span class=\"cme-pill cme-pill-green\" data-color=\"green\">Done</span>") != std::string::npos);
        assert(html.find("<span class=\"cme-pill cme-pill-rose\" data-color=\"rose\">P0</span>") != std::string::npos);
        std::cout << "     [PASS] Custom pills and badges rendered into semantic spans.\n";
    }

    // =========================================================================
    // 5. UNIT TEST: Review Subsystem Annotations Overlay
    // =========================================================================
    {
        std::cout << "  -> Testing review annotations overlay rendering...\n";
        cme::renderer::ReviewBundle bundle;
        bundle.comments.push_back({
            .id = "c1-uuid",
            .author_username = "alice",
            .author_display_name = "Alice Engineer",
            .content = "Should we add caching here?",
            .status = "OPEN",
            .created_at = "2026-10-11T01:00:00Z"
        });
        bundle.suggestions.push_back({
            .id = "s1-uuid",
            .author_username = "bob",
            .author_display_name = "Bob Reviewer",
            .original_text = "low performance",
            .suggested_text = "ultra-high throughput",
            .status = "PENDING",
            .created_at = "2026-10-11T01:05:00Z"
        });
        bundle.tasks.push_back({
            .id = "t1-uuid",
            .description = "Add unit tests for math rendering",
            .is_completed = true,
            .assignee_username = "alice",
            .assignee_display_name = "Alice Engineer",
            .created_at = "2026-10-11T01:10:00Z"
        });

        cme::renderer::RenderOptions opts{
            .standalone = false,
            .include_reviews = true
        };
        std::string html = cme::renderer::MarkdownRenderer::render_to_html("# Notes", opts, bundle);

        assert(html.find("<section class=\"cme-reviews-section\">") != std::string::npos);
        assert(html.find("Alice Engineer (@alice)") != std::string::npos);
        assert(html.find("Should we add caching here?") != std::string::npos);
        assert(html.find("<del class=\"cme-diff-del\">low performance</del>") != std::string::npos);
        assert(html.find("<ins class=\"cme-diff-ins\">ultra-high throughput</ins>") != std::string::npos);
        assert(html.find("<input type=\"checkbox\" disabled checked=\"\" />") != std::string::npos);
        assert(html.find("Add unit tests for math rendering") != std::string::npos);
        std::cout << "     [PASS] Reviews, comments, suggestions, and tasks overlay rendered successfully.\n";
    }

    // =========================================================================
    // 6. INTEGRATION TEST: Server REST API Endpoints with PostgreSQL
    // =========================================================================
    {
        std::cout << "  -> Testing Server REST endpoints (/api/v1/documents/:id/html and /by-path/html)...\n";
        fs::path temp_dir = fs::temp_directory_path() / ("cme_renderer_test_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()));
        fs::create_directories(temp_dir);

        cme::config::AppConfig srv_cfg;
        srv_cfg.server.bind = "127.0.0.1";
        srv_cfg.server.port = 18089;
        srv_cfg.storage.root_path = temp_dir.string();
        srv_cfg.database.url = "postgresql://cme:secret@localhost:5432/cme_test";

        auto server = std::make_shared<cme::server::Server>(srv_cfg);
        std::thread server_thread([server]() {
            server->start();
        });

        // Allow event loop to bind
        std::this_thread::sleep_for(std::chrono::milliseconds(250));

        // Connect to PostgreSQL to seed test user, doc, and review comment
        pqxx::connection conn(srv_cfg.database.url);
        pqxx::work tx(conn);

        std::string tester_user_id;
        auto u_res = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
            "VALUES ('renderer_tester', 'hash', 'Renderer Tester', '#8b5cf6', FALSE) "
            "ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name "
            "RETURNING id::text;"
        );
        tester_user_id = u_res[0][0].as<std::string>();

        // Create API session for tester
        std::string token_val = "pat_renderertesttoken1234567890abcdef";
        std::string token_hash = cme::auth::sha256_hex(token_val);
        tx.exec_params(
            "INSERT INTO sessions (token_hash, user_id, expires_at) "
            "VALUES ($1, $2::uuid, NOW() + INTERVAL '24 hours') "
            "ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = NOW() + INTERVAL '24 hours';",
            token_hash, tester_user_id
        );

        // Seed document directly in SAL storage and PostgreSQL
        std::string doc_path = "guides/intro_ssr.md";
        std::string doc_content = 
            "# Introduction to SSR\n"
            "Rendering Markdown to Semantic HTML on server side.\n\n"
            "$$ \\mathcal{L} = \\frac{1}{2} m v^2 - V(x) $$\n\n"
            "```mermaid\n"
            "graph TD\n"
            "  A[Markdown] --> B[HTML]\n"
            "```\n";

        fs::create_directories(temp_dir / "content" / "guides");
        {
            std::ofstream f(temp_dir / "content" / doc_path);
            f << doc_content;
        }

        auto doc_row = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ($1, 'Introduction to SSR', $2::uuid) "
            "ON CONFLICT (fs_path) DO UPDATE SET title = EXCLUDED.title "
            "RETURNING id::text;",
            doc_path, tester_user_id
        );
        std::string doc_id = doc_row[0][0].as<std::string>();

        // Grant READ permission
        tx.exec_params(
            "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level) "
            "VALUES ('DOCUMENT', $1::uuid, 'USER', $2::uuid, 'READ') "
            "ON CONFLICT DO NOTHING;",
            doc_id, tester_user_id
        );

        // Add review comment
        tx.exec_params(
            "INSERT INTO comments (document_id, author_id, content, status) "
            "VALUES ($1::uuid, $2::uuid, 'Great documentation on SSR!', 'OPEN');",
            doc_id, tester_user_id
        );

        tx.commit();

        std::string auth_header = "Authorization: Bearer " + token_val;

        // 6a: Test GET /api/v1/documents/:id/html?standalone=true
        {
            std::string url = "/api/v1/documents/" + doc_id + "/html?standalone=true";
            auto resp = http_get(18089, url, {auth_header});
            assert(resp.status_code == 200);
            assert(resp.headers.find("Content-Type: text/html; charset=utf-8") != std::string::npos);

            // Verify spec grep pattern: curl ... | grep -E "<html>|<h1"
            assert(resp.body.find("<html") != std::string::npos);
            assert(resp.body.find("<h1 id=\"introduction-to-ssr\">Introduction to SSR</h1>") != std::string::npos);
            assert(resp.body.find("<div class=\"katex-display\"") != std::string::npos);
            assert(resp.body.find("<div class=\"mermaid\">") != std::string::npos);
            std::cout << "     [PASS] GET /api/v1/documents/:id/html?standalone=true matches <html> and <h1>.\n";
        }

        // 6b: Test GET /api/v1/documents/by-path/html?path=...&include_reviews=true
        {
            std::string url = "/api/v1/documents/by-path/html?path=guides/intro_ssr.md&include_reviews=true";
            auto resp = http_get(18089, url, {auth_header});
            assert(resp.status_code == 200);
            assert(resp.headers.find("Content-Type: text/html; charset=utf-8") != std::string::npos);
            assert(resp.body.find("<article class=\"cme-content\">") != std::string::npos);
            assert(resp.body.find("<section class=\"cme-reviews-section\">") != std::string::npos);
            assert(resp.body.find("Great documentation on SSR!") != std::string::npos);
            assert(resp.body.find("Renderer Tester (@renderer_tester)") != std::string::npos);
            std::cout << "     [PASS] GET /api/v1/documents/by-path/html returns semantic HTML with review overlay.\n";
        }

        // 6c: Test Unauthorized request (no token) -> 401
        {
            std::string url = "/api/v1/documents/" + doc_id + "/html";
            auto resp = http_get(18089, url);
            assert(resp.status_code == 401);
            std::cout << "     [PASS] Unauthorized request rejected with 401.\n";
        }

        // 6d: Test Not Found request -> 404
        {
            std::string url = "/api/v1/documents/00000000-0000-0000-0000-000000000000/html";
            auto resp = http_get(18089, url, {auth_header});
            assert(resp.status_code == 404);
            std::cout << "     [PASS] Non-existent document returns 404.\n";
        }

        server->stop();
        if (server_thread.joinable()) {
            server_thread.join();
        }
        fs::remove_all(temp_dir);

        // Clean up test records from database
        {
            pqxx::work clean_tx(conn);
            clean_tx.exec("DELETE FROM documents WHERE fs_path = 'guides/intro_ssr.md';");
            clean_tx.exec("DELETE FROM users WHERE username = 'ssr_tester';");
            clean_tx.commit();
        }
    }

    std::cout << "[SUCCESS] Step 2.4 Server-Side Markdown to Semantic HTML Renderer verified 100%!\n";
    return 0;
}
