# CME Implementation Progress Log

This document tracks the incremental implementation of the Collaborative Markdown Editor (CME), including completed tasks, commits, artifacts produced, and verification test outputs.

---

## Phase 1: Project Scaffolding & Data Layer Foundations

### Step 1.1: Repository Structure, Build System & CI Setup
* **Status:** Complete (Commit: `00c8eae`)
* **Date Completed:** 2026-10-10
* **Deliverables:**
  * Root `CMakeLists.txt` enforcing C++23 standard, compiler warnings, and CTest integration.
  * Standard project structure (`backend/`, `frontend/`, `shared/`, `tests/`).
  * `cme::ErrorCode` taxonomy and `cme::Result<T>` wrapper using C++23 `std::expected` in `backend/include/cme/common.hpp`.
  * CME versioning and banner formatting using C++23 `std::format` in `backend/include/cme/version.hpp`.
  * Native server daemon skeleton in `backend/src/main.cpp`.
  * Unit test suite (`version_test.cpp`, `smoke_test.cpp`).
  * GitHub Actions CI workflow in `.github/workflows/ci.yml`.
* **Verification:**
  ```bash
  $ cmake -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON && cmake --build build --parallel
  $ ctest --test-dir build --output-on-failure
  1/2 Test #1: version_test .....................   Passed    0.00 sec
  2/2 Test #2: smoke_test .......................   Passed    0.00 sec
  100% tests passed, 0 tests failed out of 2
  ```

---

### Step 1.2: PostgreSQL Schema Migrations & DAG Hierarchy Engine
* **Status:** Complete (Commit: `a82a28e`)
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Initial migration script `migrations/001_initial_schema.sql` defining:
    * `users`, `teams`, `team_members`, `team_parents` (multi-parent DAG modeling).
    * `documents`, `permissions` (document & directory level ACLs).
    * `comments`, `suggestions`, `tasks` (review system).
    * `sessions`, `schema_migrations`.
  * Thread-safe connection pool in `cme::db::ConnectionPool` (`backend/include/cme/db/connection_pool.hpp`).
  * Transactional migration runner in `cme::db::MigrationRunner` (`backend/include/cme/db/migration_runner.hpp`).
  * Granular permission evaluator in `cme::db::PermissionEngine` (`backend/include/cme/db/permission_engine.hpp`):
    * Superuser bypass (`users.is_system_admin`).
    * Multi-parent team DAG traversal via recursive PostgreSQL CTE (`effective_teams`).
    * Direct document ownership checks.
    * Explicit document ACL resolution (direct user grants take precedence over team grants).
    * Directory tree inheritance fallback (`/a/b/c` -> `/a/b` -> `/a` -> `/`).
    * Default deny.
  * CLI tool `cme-migrate` (`backend/src/migrate_main.cpp`).
  * Automated integration test `tests/backend/db_permissions_dag_test.cpp`.
* **Verification:**
  ```bash
  $ ./build/bin/cme-migrate --db "postgresql://cme:secret@localhost:5432/cme_test" --migrations-dir ./migrations
  [MIGRATE] Applying migration 1 (001_initial_schema.sql)...
  [SUCCESS] Applied 1 new migration(s).

  $ ./build/tests/db_permissions_dag_test
  [TEST] Querying effective teams for Charlie (DAG)...
    Found 3 effective teams for Charlie:
      - test_frontend_devs
      - test_engineering
      - test_web_platform
  [PASS] Transitive DAG team membership verified.
  [TEST] Permission on arch.md: EDIT
  [TEST] Permission on styleguide.md: COMMENT
  [TEST] Permission on secret.md for Charlie: NONE
  [TEST] Permission on secret.md for Admin: ADMIN
  [TEST] Permission on owned document: EDIT
  [TEST] Permission via directory inheritance: READ
  [PASS] All db_permissions_dag_test test cases succeeded!
  ```

---

### Step 1.3: POSIX Storage Abstraction Layer (SAL)
* **Status:** Complete
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Pure virtual interface `cme::storage::IStorageBackend` and metadata struct `cme::storage::NodeInfo` (`backend/include/cme/storage/storage_backend.hpp`).
  * Standard filesystem implementation in `cme::storage::PosixStorageBackend` (`backend/include/cme/storage/posix_storage_backend.hpp`, `backend/src/storage/posix_storage_backend.cpp`):
    * Directory subsystems: `content/`, `trash/`, `snapshots/`, `backups/`.
    * Two-phase atomic write protocol via unique `.tmp` files and `std::filesystem::rename()`.
    * Document bundle detection (`.bundle` suffix, `index.md`, or `<dirname>.md`).
    * Full trash lifecycle: timestamped move to `trash/`, `.meta` sidecar files, `list_trash()`, `restore_from_trash()`, and `purge_from_trash()`.
    * Directory traversal protection (`resolve_safe_path` rejecting `..` traversal).
  * Integration test `tests/backend/posix_storage_sal_test.cpp`.
  * Storage documentation (`docs/storage/layout.md`, `docs/storage/atomic_writes.md`).
* **Verification:**
  ```bash
  $ ./build/tests/posix_storage_sal_test
  [TEST] Initializing PosixStorageBackend at: "/tmp/cme_sal_test_root"
  [TEST] 1. Basic Write & Read...
  [TEST] 2. Atomic Overwrite...
  [TEST] 3. Document Bundle Detection...
  [TEST] 4. Moving Nodes & Bundles...
  [TEST] 5. Trash Lifecycle...
    Deleted to trash ID: 2026-10-10-23-15-21_archive_guides_intro_old.md
  [TEST] 6. Directory Listing...
  [TEST] 7. Concurrent Writes Stress Test (1,000 files across 10 threads)...
    Verifying 1,000 written files on disk...
    All 1,000 files written and verified without race conditions.
  [PASS] All posix_storage_sal_test test cases succeeded!

  $ ctest --test-dir build --output-on-failure
  1/4 Test #1: version_test .....................   Passed    0.00 sec
  2/4 Test #2: smoke_test .......................   Passed    0.00 sec
  3/4 Test #3: db_permissions_dag_test ..........   Passed    0.06 sec
  4/4 Test #4: posix_storage_sal_test ...........   Passed    0.02 sec
  100% tests passed, 0 tests failed out of 4
  ```

---

## Phase 2: Core Backend Engine & REST API Foundation

### Step 2.1: Server Daemon Skeleton & Health Probe
* **Status:** Complete (Commit: `fef2c1b`)
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Multi-tier configuration loader in `cme::config::AppConfig` (`backend/include/cme/config/config.hpp`, `backend/src/config/config.cpp`) supporting YAML file parsing (`yaml-cpp`), environment variable overrides (`CME_*`), and CLI flag prioritization.
  * Server daemon class in `cme::server::Server` (`backend/include/cme/server/server.hpp`, `backend/src/server/server.cpp`) based on `uWebSockets` epoll event loop and `uSockets`.
  * Operational health check endpoint `GET /api/v1/health` reporting uptime, version, PostgreSQL connectivity & query latency, and POSIX storage capacity & writability.
  * Graceful shutdown signal handling (`SIGINT`, `SIGTERM`).
  * Automated integration test `tests/backend/server_health_test.cpp`.
  * Health probe API documentation (`docs/api/health.md`).
* **Verification:**
  ```bash
  $ ./build/bin/cme-server --port 8080 &
  [INFO] Storage backend initialized at: /var/lib/cme/storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://0.0.0.0:8080

  $ curl -i http://localhost:8080/api/v1/health
  HTTP/1.1 200 OK
  Content-Type: application/json
  Access-Control-Allow-Origin: *
  
  {
    "active_collab_rooms": 0,
    "database": {
      "latency_ms": 0.78,
      "status": "connected"
    },
    "status": "healthy",
    "storage": {
      "free_bytes": 16337457152,
      "status": "writable"
    },
    "uptime_seconds": 1,
    "version": "0.1.0"
  }

  $ ctest --test-dir build --output-on-failure
  1/5 Test #1: version_test .....................   Passed    0.00 sec
  2/5 Test #2: smoke_test .......................   Passed    0.00 sec
  3/5 Test #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/5 Test #4: posix_storage_sal_test ...........   Passed    0.02 sec
  5/5 Test #5: server_health_test ...............   Passed    0.31 sec
  100% tests passed, 0 tests failed out of 5
  ```

---

### Step 2.2: Pluggable Authentication & Authorization Engine
* **Status:** Complete (Commit: `2b50cf1`)
* **Deliverables:**
  * `cme::auth::UserIdentity`: Authenticated user representation and JSON serializer (`backend/include/cme/auth/user_identity.hpp`).
  * Cryptographic utilities in `cme::auth` (`backend/include/cme/auth/crypto_utils.hpp`, `backend/src/auth/crypto_utils.cpp`): OpenSSL 256-bit random token generation (`RAND_bytes`), SHA-256 digest hashing (`EVP_DigestInit_ex`), salted bcrypt hashing and verification (`libcrypt` `$2b$`), and Bearer/Cookie token parsers.
  * Pluggable administrative privilege evaluation (`backend/include/cme/auth/admin_provider.hpp`, `backend/src/auth/admin_provider.cpp`):
    * `IAdminProvider` pure virtual interface.
    * `FileAdminProvider`: Reads line-delimited or CSV files (`admins.txt` / `users.csv`) with automatic modification timestamp checking and hot-reloading.
    * `CommandAdminProvider`: Executes external CLI scripts/tools (`check_admin.sh %USER%`) with shell metacharacter sanitization and in-memory TTL caching (60s).
  * Session and Personal Access Token manager in `cme::auth::SessionManager` (`backend/include/cme/auth/session_manager.hpp`, `backend/src/auth/session_manager.cpp`) backed by PostgreSQL `sessions` and `users` tables: token creation with configurable TTL, validation, revocation, and session listing.
  * Pluggable authentication providers (`backend/include/cme/auth/auth_provider.hpp`, `backend/src/auth/auth_provider.cpp`):
    * `ChallengeAuthProvider`: Validates username and candidate password against stored bcrypt hashes in PostgreSQL.
    * `DelegatedAuthProvider`: Reads trusted reverse-proxy headers (`X-Remote-User`, `X-Remote-Email`) and performs Just-In-Time (JIT) provisioning in PostgreSQL for newly observed users.
  * Server HTTP REST endpoints and authorization middleware in `cme::server::Server` (`backend/src/server/server.cpp`):
    * `POST /api/v1/auth/login`: Challenge credential validation, session creation, and `Set-Cookie: cme_session=...`.
    * `POST /api/v1/auth/logout`: Session token revocation and cookie expiration.
    * `GET /api/v1/auth/me`: Profile retrieval and transitive effective team resolution via `PermissionEngine::get_effective_teams`.
    * `POST /api/v1/auth/tokens`: Personal Access Token issuance for authenticated sessions or credentials.
    * `GET /api/v1/auth/tokens`: Active token listing.
    * `OPTIONS /*`: Automatic CORS preflight response (`HTTP 204 No Content`).
  * Automated integration test suite in `tests/backend/auth_engine_test.cpp`.
  * Comprehensive API documentation in `docs/api/auth.md`.
* **Verification:**
  ```bash
  $ ./build/tests/auth_engine_test
  ========================================================
  === CME Auth Engine Integration & Unit Test Suite   ===
  ========================================================

  [TEST 1] Testing cryptographic utilities...
    - SHA-256 known vector validated.
    - Random tokens entropy and uniqueness validated.
    - Salted bcrypt hashing and verification validated.
    - Bearer token header extractor validated.
    - Cookie token header extractor validated.

  [TEST 2] Testing pluggable admin providers...
    - FileAdminProvider (line-delimited + CSV + reload) validated.
    - CommandAdminProvider (command template + caching + sanitization) validated.

  [TEST 3] Testing PostgreSQL session and auth provider subsystems...
    - Seeded test user bob_auth_test with id: a5466d63-8b8f-4694-b1ed-33c31a687f16
    - ChallengeAuthProvider (valid / invalid credentials) validated.
    - SessionManager (lifecycle, tokens, and revocation) validated.
    - DelegatedAuthProvider (JIT user provisioning + admin resolution) validated.

  [TEST 4] Testing Server REST Auth Endpoints over HTTP...
  [INFO] Storage backend initialized at: /tmp/cme_auth_test_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18082
    - POST /api/v1/auth/login returned HTTP 200 and issued token.
    - GET /api/v1/auth/me with Bearer token returned HTTP 200.
    - GET /api/v1/auth/me with Cookie returned HTTP 200.
    - GET /api/v1/auth/me with X-Remote-User returned HTTP 200 (admin=true).
    - GET /api/v1/auth/me without auth returned HTTP 401 Unauthorized.
    - POST /api/v1/auth/tokens returned HTTP 201 Created and issued PAT.
    - GET /api/v1/auth/tokens returned HTTP 200 with token list.
    - POST /api/v1/auth/logout revoked session; subsequent requests rejected with 401.

  [TEST] Stopping server...

  ========================================================
  === ALL AUTH ENGINE TESTS PASSED SUCCESSFULLY!       ===
  ========================================================

  $ ctest --test-dir build --output-on-failure
  1/6 Test #1: version_test .....................   Passed    0.00 sec
  2/6 Test #2: smoke_test .......................   Passed    0.00 sec
  3/6 Test #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/6 Test #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/6 Test #5: server_health_test ...............   Passed    0.32 sec
  6/6 Test #6: auth_engine_test .................   Passed    0.97 sec

  100% tests passed, 0 tests failed out of 6
  ```

---

### Step 2.3: Document & Workspace Tree REST API
* **Status:** Complete (Commit: `dff849d`)
* **Deliverables:**
  * `cme::document::DocumentRecord` & `cme::document::CreateDocumentRequest` models (`backend/include/cme/document/document_service.hpp`).
  * `cme::document::DocumentService` (`backend/include/cme/document/document_service.hpp`, `backend/src/document/document_service.cpp`):
    * Complete CRUD operations bridging PostgreSQL `documents` metadata and POSIX Storage Abstraction Layer (SAL).
    * Bundle management (`.bundle` detection, `index.md` content routing, and image directories).
    * Automatic title derivation from first `# ` Markdown heading or filename stem.
    * Path normalization, path traversal rejection (`..`), and automatic `.md` extension enforcement.
    * Disconnected file reconciliation (auto-indexing disk files on `by-path` lookup).
    * Atomic move and rename across directories.
    * Soft-deletion to `trash/` with metadata retention headers.
    * Asset upload (`upload_asset`) and binary reading (`read_asset`) for document-adjacent images.
    * Hierarchical workspace tree builder (`get_workspace_tree`) with per-node `READ` permission filtering.
  * REST API routing in `cme::server::Server` (`backend/src/server/server.cpp`):
    * `GET /api/v1/workspaces/tree`: Workspace directory tree.
    * `GET /api/v1/documents/by-path`: Path-based document lookup with URL query decoding.
    * `GET /api/v1/documents/:id`: Full document metadata and markdown content.
    * `GET /api/v1/documents/:id/raw`: Streaming raw UTF-8 `text/markdown`.
    * `POST /api/v1/documents`: Document creation (JSON body).
    * `PUT /api/v1/documents/:id`: Document update.
    * `PATCH /api/v1/documents/:id/move`: Moving/renaming document path.
    * `DELETE /api/v1/documents/:id`: Soft-deletion.
    * `POST /api/v1/documents/:id/assets`: Asset upload.
    * `GET /api/v1/documents/:id/assets/:filename`: Asset streaming.
  * Automated integration test suite in `tests/backend/document_workspace_api_test.cpp`.
  * API documentation in `docs/api/documents.md`.
* **Verification:**
  ```bash
  $ ./build/tests/document_workspace_api_test
  ========================================================
  === CME Document & Workspace Tree REST API Test Suite ===
  ========================================================

  [TEST 1] Testing DocumentService direct operations...
    - Document creation on disk & DB verified.
    - Document retrieval by UUID verified.
    - Document lookup by relative path verified.
    - Raw markdown streaming verified.
    - Document content update verified.
    - Document move/rename in storage and DB verified.
    - Asset upload and read verified.
    - Document bundle creation and SAL detection verified.
    - Workspace tree recursive resolution verified.
    - Soft-delete to trash and database purge verified.

  [TEST 2] Testing HTTP REST API endpoints on live server daemon...
  [INFO] Storage backend initialized at: /tmp/cme_doc_server_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18083
    - POST /api/v1/documents created document ID: f59393ec-7409-4bb0-9ec9-b9421a3531fb
    - GET /api/v1/documents/{id}/raw returned exact expected markdown.
    - GET /api/v1/documents/by-path returned document JSON.
    - GET /api/v1/documents/{id} returned full document payload.
    - PUT /api/v1/documents/{id} updated document content.
    - PATCH /api/v1/documents/{id}/move renamed document successfully.
    - POST and GET /api/v1/documents/{id}/assets verified.
    - GET /api/v1/workspaces/tree returned workspace hierarchy.
    - DELETE /api/v1/documents/{id} soft-deleted document to trash (404 on subsequent get).

  [TEST] Stopping server...

  ========================================================
  === ALL DOCUMENT & WORKSPACE TESTS PASSED!           ===
  ========================================================

  $ ctest --test-dir build --output-on-failure
  1/7 Test #1: version_test .....................   Passed    0.00 sec
  2/7 Test #2: smoke_test .......................   Passed    0.00 sec
  3/7 Test #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/7 Test #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/7 Test #5: server_health_test ...............   Passed    0.32 sec
  6/7 Test #6: auth_engine_test .................   Passed    0.95 sec
  7/7 Test #7: document_workspace_api_test ......   Passed    0.61 sec

  100% tests passed, 0 tests failed out of 7
  ```

### Step 2.4: Server-Side Markdown to Semantic HTML Renderer
* **Status:** Complete (Commit: `e09a00d`)
* **Deliverables:**
  * Vendored C Markdown Parser `md4c` (`backend/third_party/md4c/`) integrated via static library target in CMake with compile warning suppression.
  * `cme::renderer::MarkdownRenderer` (`backend/include/cme/renderer/markdown_renderer.hpp`, `backend/src/renderer/markdown_renderer.cpp`):
    * High-performance AST/SAX transforms with strict CommonMark & GFM dialect compliance.
    * Heading anchor slug generation (`<h1 id="...">...</h1>`) with collision disambiguation (`slug`, `slug-1`, `slug-2`).
    * Inline math `$formula$` converted to `<span class="katex-inline" data-expr="formula">$formula$</span>`.
    * Display math `$$formula$$` converted to `<div class="katex-display" data-expr="formula">$$formula$$</div>`.
    * Mermaid diagram code blocks (` ```mermaid `) converted into `<div class="mermaid">...</div>`.
    * Standard code blocks formatted with language classes (`<pre><code class="language-...">...</code></pre>`).
    * Obsidian-style Wiki link cross-references (`[[target]]` and `[[target|label]]`) converted to `<a class="wiki-link" href="..." data-target="...">`.
    * GFM aligned tables (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th align="...">`, `<td align="...">`).
    * Task list items (`- [ ]`, `- [x]`) rendered with disabled `<input type="checkbox" ... />`.
    * Standalone HTML5 document generator (`options.standalone = true`) embedding modern Obsidian/GitHub CSS typography, dark/light theme variables, KaTeX stylesheet and auto-render scripts, and Mermaid.js ESM initialization.
    * Review annotations overlay (`options.include_reviews = true`) integrating active comments, suggestions with diff rendering (`<del>`, `<ins>`), and action items.
    * Strict HTML and attribute entity-escaping for comprehensive XSS protection.
  * Review Subsystem Query Engine in `DocumentService::get_document_reviews` (`backend/src/document/document_service.cpp`):
    * Joins `comments`, `suggestions`, `tasks`, and `users` tables in PostgreSQL, enforced under document-level `READ` permissions.
  * REST API routing in `cme::server::Server` (`backend/src/server/server.cpp`):
    * `GET /api/v1/documents/:id/html`: Document rendering by database UUID, supporting `?standalone=true` and `?include_reviews=true`.
    * `GET /api/v1/documents/by-path/html`: Document rendering by relative path, supporting `?standalone=true` and `?include_reviews=true`.
    * Header-ordered `send_html` helper guaranteeing HTTP/1.1 response status code before headers.
  * Comprehensive test suite in `tests/backend/markdown_renderer_test.cpp`:
    * Unit tests for core elements, slugs, KaTeX math stubs, Mermaid diagrams, code blocks, wiki links, standalone HTML5 document structure, and review subsystem overlay.
    * Live integration tests with running `Server` daemon and PostgreSQL database verifying 200 responses, `Content-Type: text/html; charset=utf-8`, grep verification for spec criteria (`grep -E "<html|<h1"`), 401 unauthorized rejection, and 404 not found handling.
  * API documentation in `docs/api/renderer.md` and updated index in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/markdown_renderer_test
  [TEST] Starting Server-Side Markdown to Semantic HTML Renderer Test Suite (Step 2.4)...
    -> Testing core Markdown element rendering...
       [PASS] Core elements, slugs, and task lists rendered successfully.
    -> Testing KaTeX math transforms...
       [PASS] KaTeX math stubs transformed accurately.
    -> Testing Mermaid diagram transformations and syntax code blocks...
       [PASS] Mermaid diagram blocks converted into <div class="mermaid">.
    -> Testing wiki links and standalone HTML wrapper...
       [PASS] Standalone HTML5 document with embedded styles and wiki links validated.
    -> Testing review annotations overlay rendering...
       [PASS] Reviews, comments, suggestions, and tasks overlay rendered successfully.
    -> Testing Server REST endpoints (/api/v1/documents/:id/html and /by-path/html)...
  [INFO] Storage backend initialized at: /tmp/cme_renderer_test_1791678229210495684
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18089
       [PASS] GET /api/v1/documents/:id/html?standalone=true matches <html> and <h1>.
       [PASS] GET /api/v1/documents/by-path/html returns semantic HTML with review overlay.
       [PASS] Unauthorized request rejected with 401.
       [PASS] Non-existent document returns 404.
  [SUCCESS] Step 2.4 Server-Side Markdown to Semantic HTML Renderer verified 100%!

  $ ctest --test-dir build --output-on-failure
  1/8 Test #1: version_test .....................   Passed    0.00 sec
  2/8 Test #2: smoke_test .......................   Passed    0.00 sec
  3/8 Test #3: db_permissions_dag_test ..........   Passed    0.06 sec
  4/8 Test #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/8 Test #5: server_health_test ...............   Passed    0.32 sec
  6/8 Test #6: auth_engine_test .................   Passed    0.94 sec
  7/8 Test #7: document_workspace_api_test ......   Passed    0.59 sec
  8/8 Test #8: markdown_renderer_test ...........   Passed    0.29 sec

  100% tests passed, 0 tests failed out of 8

  # Verification via curl specification criteria:
  $ curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/documents/$DOC_ID/html?standalone=true" | grep -E "<html|<h1"
  <html lang="en">
  <h1 id="introduction-to-ssr">Introduction to SSR</h1>
  ```

---

### Step 2.5: User & Team Administration Engine (REST API & `cme-admin` CLI)
* **Status:** Complete (Commit: `2dd49bf`)
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Native C++23 administration service classes in `backend/include/cme/admin/admin_service.hpp` and `backend/src/admin/admin_service.cpp`:
    * `UserService`: Listing, retrieval, account creation with salted bcrypt password hashing, role updates, administrative elevation, password reset, and cascading account deletion.
    * `TeamService`: Team CRUD, membership assignment with granular roles (`member`, `lead`), DAG parent link management, and recursive CTE cycle prevention.
  * Multi-Parent Directed Acyclic Graph (DAG) cycle detection query in PostgreSQL:
    * Recursively traverses existing team descendants before creating a new edge in `team_parents`.
    * Rejects circular parent links and self-parenting with `ErrorCode::InvalidArgument`.
  * Administrative REST API endpoints in `Server` daemon under `/api/v1/admin/*`, guarded by `is_admin` checks:
    * `GET /api/v1/admin/users`: List users without sensitive password hashes.
    * `POST /api/v1/admin/users`: Register user account (201 Created / 409 Conflict).
    * `GET /api/v1/admin/users/:id`: Get user profile by UUID or username.
    * `PUT /api/v1/admin/users/:id`: Update user attributes, role, or password.
    * `DELETE /api/v1/admin/users/:id`: Permanently delete user.
    * `GET /api/v1/admin/teams`: List all teams.
    * `POST /api/v1/admin/teams`: Register a team.
    * `GET /api/v1/admin/teams/:id`: Get team details.
    * `PUT /api/v1/admin/teams/:id`: Update team attributes.
    * `DELETE /api/v1/admin/teams/:id`: Permanently delete team.
    * `GET /api/v1/admin/teams/:id/members`: List team members with roles.
    * `POST /api/v1/admin/teams/:id/members`: Assign user to team or update role.
    * `DELETE /api/v1/admin/teams/:id/members/:user_id`: Remove member from team.
    * `GET /api/v1/admin/teams/:id/parents`: List direct parent teams in DAG.
    * `POST /api/v1/admin/teams/:id/parents`: Link parent team (rejects circular DAG cycles with 400).
    * `DELETE /api/v1/admin/teams/:id/parents/:parent_id`: Unlink parent team.
  * Standalone CLI binary `cme-admin` (`backend/src/admin_main.cpp`) supporting `user` (`list`, `create`, `get`, `set-admin`, `reset-password`, `delete`) and `team` (`list`, `create`, `get`, `add-member`, `remove-member`, `list-members`, `add-parent`, `remove-parent`, `list-parents`, `delete`) subcommands.
  * Comprehensive integration test suite in `tests/backend/admin_management_test.cpp`.
  * API & CLI documentation in `docs/api/admin.md` and indexed in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/admin_management_test
  ========================================================
  === CME Admin Management & DAG Engine Test Suite     ===
  ========================================================

  [TEST 1] Testing direct UserService operations...
    [PASS] Duplicate username rejected with AlreadyExists.
    [PASS] User elevation to admin verified.
    [PASS] Password reset and bcrypt hash verified.

  [TEST 2] Testing TeamService & DAG Hierarchy operations...
    [PASS] Team membership assignments and roles verified.
    [PASS] Multi-level DAG inheritance verified (Frontend -> Platform -> Eng).
  [WARN] Cycle detected in team hierarchy: baff0723-1f16-43c0-b7bd-88442ea4d10f is already a descendant of 63341ac4-738c-4a50-8847-1df46df50f22
    [PASS] Directed cycle detected and rejected!
    [PASS] Self-parenting detected and rejected!
    [PASS] Diamond DAG multi-parent hierarchy verified.

  [TEST 3] Testing cme-admin CLI executable...
  [SUCCESS] Created user 'test_cli_charlie' (ID: 9ef1a67e-3105-415e-9273-739aef4c7775)
    [PASS] cme-admin user create & list validated.
  [SUCCESS] Created team 'test_cli_team' (ID: c04156ef-30b9-4ab1-90a1-5765349ade74)
  [SUCCESS] Added user 'test_cli_charlie' to team 'test_cli_team' as 'lead'.
    [PASS] cme-admin team create & add-member validated.
  [SUCCESS] Deleted user 'test_cli_charlie'.
  [SUCCESS] Deleted team 'test_cli_team'.
    [PASS] cme-admin delete user & team validated.

  [TEST 4] Testing live Server Daemon Admin REST API routes...
  [INFO] Storage backend initialized at: /tmp/cme_admin_server_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18092
    [PASS] Admin endpoints properly reject unauthenticated (401) and non-admin (403) requests.
    [PASS] GET /api/v1/admin/users returned 9 user records.
    [PASS] POST /api/v1/admin/users successfully created user (201 Created).
    [PASS] GET & PUT /api/v1/admin/users/:id succeeded.
    [PASS] POST & GET /api/v1/admin/teams succeeded.
    [PASS] REST team membership assignment and listing verified.
  [WARN] Cycle detected in team hierarchy: eff09126-5ee9-40ef-95ad-c1aa0e5852cd is already a descendant of c1346a58-a192-4b06-a3f9-fea3565b28c9
    [PASS] REST circular DAG inheritance rejected with 400 Bad Request.
    [PASS] REST deletion of memberships, parents, users, and teams verified.

  [SUCCESS] Step 2.5 User & Team Administration Engine Test Suite passed 100%!

  $ ctest --test-dir build --output-on-failure
  1/9 Test #1: version_test .....................   Passed    0.00 sec
  2/9 Test #2: smoke_test .......................   Passed    0.00 sec
  3/9 Test #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/9 Test #4: posix_storage_sal_test ...........   Passed    0.02 sec
  5/9 Test #5: server_health_test ...............   Passed    0.32 sec
  6/9 Test #6: auth_engine_test .................   Passed    0.95 sec
  7/9 Test #7: document_workspace_api_test ......   Passed    0.63 sec
  8/9 Test #8: markdown_renderer_test ...........   Passed    0.29 sec
  9/9 Test #9: admin_management_test ............   Passed    1.34 sec

  100% tests passed, 0 tests failed out of 9
  ```

---

## Phase 3: Real-Time Collaborative Engine (CRDT & WebSockets)

### Step 3.1: Native Yjs CRDT C-FFI Integration
* **Status:** Complete (Commit: `a99e549`)
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Vendored official `y-crdt` (`yrs` / `yffi` v0.28.0) C-FFI header and shared library in `backend/third_party/yrs/include/libyrs.h` and `backend/third_party/yrs/lib/libyrs.so`.
  * CMake build system integration discovering `libyrs` via `find_library` and linking with `cme_core`.
  * Modern C++23 RAII container `cme::collab::CrdtDoc` (`backend/include/cme/collab/crdt_doc.hpp`, `backend/src/collab/crdt_doc.cpp`):
    * Move-only ownership semantics managing `YDoc*`.
    * Text manipulation on named branches (`insert_text`, `delete_text`, `set_text`, `get_text`, `get_text_length`).
    * Lib0 v1 state vector extraction (`get_state_vector`) for `SyncStep1`.
    * Differential delta generation (`get_state_diff`) against remote state vectors for `SyncStep2` or full document state snapshots.
    * Atomic binary update ingestion (`apply_update`).
  * In-memory collaborative room model `cme::collab::DocumentRoom` (`backend/include/cme/collab/document_room.hpp`, `backend/src/collab/document_room.cpp`):
    * Mutex-guarded thread-safe CRDT mutations.
    * Connected peer presence tracking (`PeerInfo`: `client_id`, `username`, `display_name`, `avatar_color`).
    * Dirty state lifecycle tracking (`is_dirty_`, `last_edit_time_`, `last_flush_time_`) for debounced disk persistence.
  * In-memory room coordinator `cme::collab::RoomManager` (`backend/include/cme/collab/room_manager.hpp`, `backend/src/collab/room_manager.cpp`):
    * Multi-room lifecycle management (`get_or_create_room`, `get_room`, `remove_room`).
    * Dirty room enumeration for background disk flusher workers.
    * Wiring into `Server::get_health_status()` reporting active room counts.
  * Integration test suite in `tests/backend/ycrdt_cffi_integration_test.cpp`.
  * Architecture documentation in `docs/crdt/yrs_ffi.md` and indexed in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/ycrdt_cffi_integration_test
  ========================================================
  === Native Yjs CRDT C-FFI Integration Test Suite     ===
  ========================================================

  [TEST 1] Testing CrdtDoc text operations and serialization...
    [PASS] CrdtDoc text insertions, deletions, and set_text verified.

  [TEST 2] Testing two-party Yjs binary sync protocol...
    [PASS] Initial state synchronization (SyncStep1 -> SyncStep2) verified.

  [TEST 3] Testing concurrent out-of-order edits and convergence...
    Room A text: "The very quick brown fox jumps over the lazy dog."
    Room B text: "The quick brown fox jumps over the extremely lazy dog in the park."
    Converged text: "The very quick brown fox jumps over the extremely lazy dog in the park."
    [PASS] Concurrent editing arrived at identical converged content.

  [TEST 4] Testing three-peer diamond CRDT reconciliation...
    3-Peer Converged text: "Base [Edit3] [Edit1] [Edit2]"
    [PASS] Three-peer diamond reconciliation verified.

  [TEST 5] Testing DocumentRoom dirty tracking and peer presence...
    [PASS] DocumentRoom dirty tracking and peer presence validated.

  [TEST 6] Testing RoomManager coordination...
    [PASS] RoomManager room lifecycle and dirty querying validated.

  [SUCCESS] Step 3.1 Native Yjs CRDT C-FFI Integration Test Suite passed 100%!

  $ ctest --test-dir build --output-on-failure
  1/10 Test  #1: version_test .....................   Passed    0.00 sec
  2/10 Test  #2: smoke_test .......................   Passed    0.00 sec
  3/10 Test  #3: db_permissions_dag_test ..........   Passed    0.06 sec
  4/10 Test  #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/10 Test  #5: server_health_test ...............   Passed    0.32 sec
  6/10 Test  #6: auth_engine_test .................   Passed    0.96 sec
  7/10 Test  #7: document_workspace_api_test ......   Passed    0.58 sec
  8/10 Test  #8: markdown_renderer_test ...........   Passed    0.29 sec
  9/10 Test  #9: admin_management_test ............   Passed    1.30 sec
 10/10 Test #10: ycrdt_cffi_integration_test ......   Passed    0.00 sec

  100% tests passed, 0 tests failed out of 10
  ```

---

### Step 3.2: WebSocket Server & Binary Wire Protocol Multiplexer
* **Status:** Complete
* **Date Completed:** 2026-10-11
* **Git Commit:** `c1e8baf`
* **Deliverables:**
  * Contextual per-socket metadata struct `cme::collab::CollabSocketData` (`backend/include/cme/collab/collab_socket_data.hpp`).
  * WebSocket route `/ws/collab/:document_id` in `cme::server::Server` (`backend/src/server/server.cpp`):
    * Five-way handshake authentication: `Authorization: Bearer <token>`, `Cookie: cme_session=<token>`, `?token=<token>`, `Sec-WebSocket-Protocol: bearer, <token>`, and reverse-proxy delegated headers (`X-Remote-User`, `X-Remote-Email`).
    * Pre-upgrade access control: HTTP `401 Unauthorized` on missing/invalid credentials, `403 Forbidden` on insufficient access level, `404 Not Found` on non-existent document.
    * 1-byte binary wire protocol decoder & multiplexer:
      * `0x00`: CRDT Synchronization (`0x01` SyncStep1, `0x02` SyncStep2, `0x03` SyncUpdate).
      * `0x01`: Live collaborator awareness & cursor coordinates broadcasting, plus peer departure notification frames.
      * `0x02`: Real-time review event notifications (comments, suggestions, tasks).
      * `0x03` / `0x04`: Ping/Pong heartbeat round-trip ($0.040\text{ ms}$ latency, beating the $< 10\text{ ms}$ threshold).
    * `broadcast_review_event()` and `broadcast_to_room()` helper APIs for server-side asynchronous broadcasts.
  * Automated protocol compliance runner in Python (`tests/ws_protocol_runner.py`).
  * Integration test suite in `tests/backend/websocket_collab_test.cpp`.
  * Protocol documentation in `docs/api/websocket_protocol.md` and indexed in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/websocket_collab_test
  ========================================================
  === CME WebSocket Collaboration & Protocol Test Suite ===
  ========================================================

  [STEP 1] Running schema migrations on test database...
    - Migrations applied successfully.

  [STEP 2] Seeding test user and test document...
    - Seeded user_id: f33b06a5-5d5a-4224-8513-7f8f30a093f1
    - Seeded doc_id: 3bd56e72-27f6-4663-83af-79fa7c5ac00e

  [STEP 3] Generating session token for ws_tester...
    - Generated session token: 444c59f739de7061...

  [STEP 4] Launching CME Server daemon on port 18086...
  [INFO] Storage backend initialized at: /tmp/cme_ws_test_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18086
    - Server daemon initialized and listening.

  [STEP 5] Invoking Python WebSocket Protocol Runner...
  Executing: python3 tests/ws_protocol_runner.py --url ws://127.0.0.1:18086/ws/collab/3bd56e72-27f6-4663-83af-79fa7c5ac00e --token 444c59f739de7061...

  ==================================================================
  === CME WebSocket Wire Protocol Compliance Test Runner       ===
  ==================================================================
  Target URL: ws://127.0.0.1:18086/ws/collab/3bd56e72-27f6-4663-83af-79fa7c5ac00e

  [TEST 1] Connecting with Authorization: Bearer <token>...
    ✓ Handshake accepted: server SyncStep1 state vector received (10 bytes)

  [TEST 2] Testing CRDT State Vector Sync Handshake (SyncStep1 -> SyncStep2)...
    ✓ Server replied with SyncStep2 delta payload (76 bytes)

  [TEST 3] Testing Opcode 0x03 Ping -> 0x04 Pong Heartbeat Latency...
    ✓ Pong response verified in 0.040 ms (Status criteria: < 10ms)

  [TEST 4] Connecting using ?token= query parameter...
    ✓ Authentication via ?token= query parameter validated

  [TEST 5] Connecting using Cookie: cme_session=<token>...
    ✓ Authentication via Cookie header validated

  [TEST 6] Connecting using Sec-WebSocket-Protocol: bearer, <token>...
    ✓ Subprotocol authentication validated (negotiated: bearer)

  [TEST 7] Testing Multi-Peer Broadcast (Awareness & SyncUpdate)...
    ✓ Peer 2 received Peer 1's live awareness frame
    ✓ Peer 2 received Peer 1's review event notification
    ✓ Peer 2 received Peer 1's CRDT SyncUpdate delta

  [TEST 8] Testing Authentication Rejection with Invalid Token...
    ✓ Connection rejected with HTTP 401 Unauthorized as expected

  [TEST 9] Testing Non-Existent Document Rejection (HTTP 404)...
    ✓ Connection rejected with HTTP 404 Not Found as expected

  ==================================================================
  === All 9 WebSocket Protocol Tests PASSED Successfully!       ===
  ==================================================================

  [STEP 6] Python test runner completed successfully (code 0).

  [STEP 7] Testing server.broadcast_review_event()...
    - broadcast_review_event dispatched without exceptions.

  [STEP 8] Shutting down server daemon...
    - Server terminated cleanly.

  ========================================================
  === ALL WEBSOCKET TESTS PASSED (100% SUCCESS)         ===
  ========================================================

  $ ctest --test-dir build --output-on-failure
  1/11 Test  #1: version_test .....................   Passed    0.00 sec
  2/11 Test  #2: smoke_test .......................   Passed    0.00 sec
  3/11 Test  #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/11 Test  #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/11 Test  #5: server_health_test ...............   Passed    0.32 sec
  6/11 Test  #6: auth_engine_test .................   Passed    0.94 sec
  7/11 Test  #7: document_workspace_api_test ......   Passed    0.62 sec
  8/11 Test  #8: markdown_renderer_test ...........   Passed    0.30 sec
  9/11 Test  #9: admin_management_test ............   Passed    1.30 sec
 10/11 Test #10: ycrdt_cffi_integration_test ......   Passed    0.00 sec
 11/11 Test #11: websocket_collab_test ............   Passed    0.57 sec

  100% tests passed, 0 tests failed out of 11
  ```

---

### Step 3.3: In-Memory DocumentRoom & Debounced Persistence
* **Status:** Complete (Commit: `63e2bbb`)
* **Deliverables:**
  * Added `create_snapshot` virtual method to `IStorageBackend` (`backend/include/cme/storage/storage_backend.hpp`).
  * Implemented `create_snapshot(relative_path, content)` in `PosixStorageBackend` (`backend/include/cme/storage/posix_storage_backend.hpp`, `backend/src/storage/posix_storage_backend.cpp`):
    * Atomic write using temporary nonce files (`.<name>.<nonce>.tmp`) and atomic POSIX renaming.
    * Chronological date-partitioning: `snapshots/YYYY/MM/<YYYY-MM-DD-HH-MM-SS>_<sanitized_name>.md`.
  * Added `get_all_rooms()` to `cme::collab::RoomManager` (`backend/include/cme/collab/room_manager.hpp`, `backend/src/collab/room_manager.cpp`).
  * Implemented `cme::collab::PersistenceWorker` (`backend/include/cme/collab/persistence_worker.hpp`, `backend/src/collab/persistence_worker.cpp`):
    * Configurable background writer thread evaluating dirty rooms at 200ms resolution.
    * Debounced idle flush window: flushes after 5s of inactivity.
    * Maximum continuous editing flush interval: forces flush every 300s.
    * Synchronizes PostgreSQL `documents.updated_at = NOW()`.
    * Eviction policy: automatically evicts clean rooms with 0 peers from RAM; flushes dirty rooms before eviction (zero data loss).
    * Teardown safety: `flush_all_dirty()` on shutdown.
  * Server daemon integration (`backend/include/cme/server/server.hpp`, `backend/src/server/server.cpp`):
    * Spawns `persistence_worker_` on `Server::start()`, terminates cleanly on `Server::stop()`.
    * Exposes persistence metrics (`total_flushes`, `total_snapshots`, `total_evictions`, `status`) in `/api/v1/health`.
    * Supports transparent rehydration of evicted documents from disk when collaborators connect.
  * Helper tool `tests/ws_edit_simulator.py` driving real Yjs CRDT edit deltas via WebSocket and `libyrs.so` FFI.
  * Integration test suite `tests/backend/persistence_debounced_test.cpp` verifying:
    * Inactive debounce window (disk untouched during active editing).
    * Debounced flush, disk content synchronization, and snapshot creation.
    * In-memory room eviction on peer disconnect.
    * Zero data loss when disconnecting with pending unpersisted edits.
    * End-to-end WebSocket keystroke injection via Python simulator.
    * Transparent rehydration of evicted rooms upon client reconnection.
    * Health probe reporting.
  * Architectural documentation in `docs/crdt/persistence.md` and indexed in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/persistence_debounced_test
  ===============================================================
  === CME Debounced Persistence & Eviction Test Suite (Step 3.3) ===
  ===============================================================

  [STEP 1] Running schema migrations on test database...
    - Migrations applied successfully.

  [STEP 2] Seeding test user and test document...
    - Seeded user_id: d0d6a36a-1c49-4f5d-820d-fe7f1108afdf
    - Seeded doc_id: e56a8a88-7a06-43f9-8fe9-a795c4679117
    - Initial file created at storage path.

  [STEP 3] Testing PersistenceWorker unit lifecycle...
    - Debounce active: disk unchanged immediately after edit.
    - Debounced flush succeeded: disk content synchronized & snapshot created.
    - Found snapshot: 2026-10-11-13-44-55_notes_debounced_note.md
    - Clean room with 0 peers successfully evicted from RAM.
    - Dirty room flushed prior to eviction: zero data loss verified.

  [STEP 4] Generating session token for ws_edit_simulator...
    - Generated session token: 8677afd83da03aca...

  [STEP 5] Launching CME Server daemon with debounced persistence worker...
  [INFO] Storage backend initialized at: /tmp/cme_persist_test_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18094
    - Server daemon & persistence worker active.

  [STEP 6] Simulating real collaborator keystrokes via WebSocket...
  Executing: python3 tests/ws_edit_simulator.py --url ws://127.0.0.1:18094/ws/collab/e56a8a88-7a06-43f9-8fe9-a795c4679117 --token ... --insert "\n\n### WebSocket CRDT Keystroke Injected!\n" --delay 0.1

  [SIMULATOR] Connecting to ws://127.0.0.1:18094/ws/collab/e56a8a88-7a06-43f9-8fe9-a795c4679117...
  [SIMULATOR] Server initial state vector received (10 bytes)
  [SIMULATOR] Server SyncStep2 delta received (104 bytes)
  [SIMULATOR] Computed edit delta: 67 bytes. Emitting SyncUpdate...
  [SIMULATOR] Delta sent successfully.
  [SIMULATOR] Disconnecting cleanly.

    - ws_edit_simulator finished with exit code 0.

  [STEP 7] Awaiting debounced flush window (700ms)...
    - [PASS] File on POSIX disk contains injected WebSocket keystrokes!
    - [PASS] Inactive collaborative room automatically evicted from memory.
    - [PASS] Server health probe reports persistence worker metrics:
      Flushes: 1, Snapshots: 1, Evictions: 1

  [STEP 8] Reconnecting to evicted room to test transparent disk rehydration...
  [SIMULATOR] Connecting to ws://127.0.0.1:18094/ws/collab/e56a8a88-7a06-43f9-8fe9-a795c4679117...
  [SIMULATOR] Server initial state vector received (10 bytes)
  [SIMULATOR] Server SyncStep2 delta received (148 bytes)
  [SIMULATOR] Computed edit delta: 50 bytes. Emitting SyncUpdate...
  [SIMULATOR] Delta sent successfully.
  [SIMULATOR] Disconnecting cleanly.
    - [PASS] Room rehydrated from disk, applied second edit, flushed, and re-evicted!

  [STEP 9] Stopping server and shutting down gracefully...
    - Server shutdown complete.

  ===============================================================
  === ALL PERSISTENCE & EVICTION TESTS PASSED (100% SUCCESS)  ===
  ===============================================================

  $ ctest --test-dir build --output-on-failure
  1/12 Test  #1: version_test .....................   Passed    0.00 sec
  2/12 Test  #2: smoke_test .......................   Passed    0.00 sec
  3/12 Test  #3: db_permissions_dag_test ..........   Passed    0.05 sec
  4/12 Test  #4: posix_storage_sal_test ...........   Passed    0.02 sec
  5/12 Test  #5: server_health_test ...............   Passed    0.32 sec
  6/12 Test  #6: auth_engine_test .................   Passed    0.92 sec
  7/12 Test  #7: document_workspace_api_test ......   Passed    0.57 sec
  8/12 Test  #8: markdown_renderer_test ...........   Passed    0.30 sec
  9/12 Test  #9: admin_management_test ............   Passed    1.16 sec
  10/12 Test #10: ycrdt_cffi_integration_test ......   Passed    0.00 sec
  11/12 Test #11: websocket_collab_test ............   Passed    0.50 sec
  12/12 Test #12: persistence_debounced_test .......   Passed    3.20 sec

  100% tests passed, 0 tests failed out of 12
  ```

---

### Step 3.4: Review Engine Real-Time Synchronization
* **Status:** Complete (Commit: `ebdf434`)
* **Deliverables:**
  * Implemented `cme::review::ReviewService` (`backend/include/cme/review/review_service.hpp`, `backend/src/review/review_service.cpp`):
    * Threaded Comments: `list_comments` (with nested reply trees), `create_comment` (anchored via text quote or offsets), `reply_comment`, `update_comment_status` (`OPEN` / `RESOLVED`), and `delete_comment`.
    * Inline Suggestions: `list_suggestions` (with status filters), `create_suggestion`, `reject_suggestion`, and `accept_suggestion`.
    * Action Item Tasks: `list_tasks`, `create_task`, `update_task` (`is_completed`), and `delete_task`.
    * Live CRDT Reconciliation: when suggestions are accepted via `POST /api/v1/suggestions/:id/accept`, `accept_suggestion` updates the live `DocumentRoom` CRDT text in memory and broadcasts an incremental `SyncUpdate` delta (`0x00 0x03`).
    * RBAC enforcement via `PermissionEngine::check_permission` and document ownership checks.
  * Server REST Endpoints in `cme::server::Server` (`backend/src/server/server.cpp`):
    * `/api/v1/documents/:id/comments` (`GET`, `POST`)
    * `/api/v1/comments/:id/replies` (`POST`)
    * `/api/v1/comments/:id/status` (`PATCH`)
    * `/api/v1/comments/:id` (`DELETE`)
    * `/api/v1/documents/:id/suggestions` (`GET`, `POST`)
    * `/api/v1/suggestions/:id/accept` (`POST`)
    * `/api/v1/suggestions/:id/reject` (`POST`)
    * `/api/v1/documents/:id/tasks` (`GET`, `POST`)
    * `/api/v1/tasks/:id` (`PATCH`, `DELETE`)
  * Real-Time WebSocket Opcode `0x02` Event Fanout:
    * Dispatches instant notifications to all collaborators in `room:<document_id>` upon mutation: `COMMENT_CREATED`, `COMMENT_REPLIED`, `COMMENT_STATUS_CHANGED`, `COMMENT_DELETED`, `SUGGESTION_CREATED`, `SUGGESTION_ACCEPTED`, `SUGGESTION_REJECTED`, `TASK_CREATED`, `TASK_UPDATED`.
  * Python helper `tests/ws_review_listener.py` connecting over WebSocket and validating incoming Opcode `0x02` JSON payloads in real time.
  * Automated integration test suite `tests/backend/review_engine_test.cpp` validating all 11 REST endpoints, live CRDT replacement in memory, and WebSocket Opcode `0x02` frame delivery.
  * API documentation in `docs/api/review_engine.md` and indexed in `docs/index.md`.
* **Verification:**
  ```bash
  $ ./build/tests/review_engine_test
  ===============================================================
  === CME Review Engine & Real-Time Sync Test Suite (Step 3.4) ===
  ===============================================================

  [STEP 1] Running schema migrations on test database...
    - Migrations validated.

  [STEP 2] Seeding test users (Alice, Bob) and document...
    - Seeded Alice (id: 3424950f-f047-4a4a-963d-854d1eb33547) and Bob (id: fd0bce48-ed5a-4a8d-a1b2-ffd2c78c0cda)
    - Seeded Document: f9c68ef4-858c-4183-8644-59d20a0a7b66

  [STEP 3] Issuing session tokens...

  [STEP 4] Launching CME Server daemon on port 18095...
  [INFO] Storage backend initialized at: /tmp/cme_review_test_storage
  [INFO] PostgreSQL connection pool initialized (8 connections).
  [INFO] CME Server listening on http://127.0.0.1:18095

  [STEP 5] Spawning WebSocket Review Listener (Opcode 0x02)...
    - WebSocket listener connected to room and listening for 0x02 frames.

  [STEP 6] Testing Threaded Comments & Real-Time Event Fanout...
    - Created root comment (id: b666d4a2-5b3a-499f-ac18-551142bb2d6c).
    [PASS] WebSocket Opcode 0x02 received COMMENT_CREATED notification!
    - Created reply (id: b7782991-1427-4c1c-8cec-0deba365bbe2).
    [PASS] WebSocket Opcode 0x02 received COMMENT_REPLIED notification!
    [PASS] Threaded comment hierarchy verified (root with nested replies).
    [PASS] WebSocket Opcode 0x02 received COMMENT_STATUS_CHANGED notification!

  [STEP 7] Testing Inline Edit Suggestions & Live CRDT Text Injection...
    [PASS] WebSocket Opcode 0x02 received SUGGESTION_CREATED notification!
    [PASS] WebSocket Opcode 0x02 received SUGGESTION_REJECTED notification!
    [PASS] WebSocket Opcode 0x02 received SUGGESTION_ACCEPTED notification!
    [PASS] Live CRDT DocumentRoom updated with accepted suggestion text!
      New content: # Review Engine

  This is the refined and accepted text.
  Here is line t...

  [STEP 8] Testing Action Item Tasks Checklist & Events...
    [PASS] WebSocket Opcode 0x02 received TASK_CREATED notification!
    [PASS] WebSocket Opcode 0x02 received TASK_UPDATED notification!
    [PASS] WebSocket Opcode 0x02 received COMMENT_DELETED notification!

  [STEP 9] Terminating listener and server daemon...

  ===============================================================
  === ALL REVIEW ENGINE & REAL-TIME TESTS PASSED (100% OK)     ===
  ===============================================================

  $ ctest --test-dir build --output-on-failure
  1/13 Test  #1: version_test .....................   Passed    0.00 sec
  2/13 Test  #2: smoke_test .......................   Passed    0.00 sec
  3/13 Test  #3: db_permissions_dag_test ..........   Passed    0.06 sec
  4/13 Test  #4: posix_storage_sal_test ...........   Passed    0.03 sec
  5/13 Test  #5: server_health_test ...............   Passed    0.32 sec
  6/13 Test  #6: auth_engine_test .................   Passed    0.97 sec
  7/13 Test  #7: document_workspace_api_test ......   Passed    0.63 sec
  8/13 Test  #8: markdown_renderer_test ...........   Passed    0.30 sec
  9/13 Test  #9: admin_management_test ............   Passed    1.30 sec
  10/13 Test #10: ycrdt_cffi_integration_test ......   Passed    0.00 sec
  11/13 Test #11: websocket_collab_test ............   Passed    0.53 sec
  12/13 Test #12: persistence_debounced_test .......   Passed    3.21 sec
  13/13 Test #13: review_engine_test ...............   Passed    1.61 sec

  100% tests passed, 0 tests failed out of 13
  ```

---

## Phase 4: Frontend Core & Collaborative TipTap Editor

### Step 4.1: React 18 + Vite Scaffolding, Theme Architecture & Application Shell
* **Status:** Complete
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Initialized Vite React 18 TypeScript application (`frontend/package.json`, `tsconfig.json`, `vite.config.ts` with API/WebSocket reverse proxies).
  * Multi-theme design tokens configured with Tailwind CSS (`tailwind.config.js`) and CSS variables (`src/index.css`) for Light, Dark, Sepia, and System themes.
  * Zero-flash-of-unstyled-content (FOUC) prevention script in `index.html`.
  * Client UI and theme state management:
    * `useThemeStore` (`src/stores/themeStore.ts`): Light, Dark, Sepia, System modes with dynamic OS scheme listener and `localStorage` persistence.
    * `useUIStore` (`src/stores/uiStore.ts`): Collapsible sidebar, review sidebar, dynamic breadcrumbs, sync status, and modal controllers.
  * Data layer and API services with TanStack Query:
    * API client with credentials & Bearer token support (`src/api/client.ts`).
    * Auth service for user profile, login, logout, and PAT tokens (`src/api/auth.ts`).
    * Health service for server telemetry probe (`src/api/health.ts`).
    * Documents service for workspace tree and document CRUD (`src/api/documents.ts`).
  * Top navigation header bar (`src/components/layout/Header.tsx`):
    * Logged-in user profile pill (`UserProfilePill.tsx`) with avatar initials, background color, display name, admin badge, effective teams drawer, and logout.
    * Application version & health badge (`HealthPopover.tsx`) showing `v0.1.0` with popover for uptime, PostgreSQL latency, POSIX storage free space, and active rooms.
    * Document breadcrumbs with clickable hierarchy.
    * Sync status badge (`Saved`, `Syncing...`, `Collab Live`, `Offline`).
    * Mode switcher between Editor (`/documents/:id`) and Reader (`/docs/:id`).
    * Theme switcher dropdown (`ThemeToggle.tsx`).
  * Application shell and client-side routing (`src/App.tsx`, `src/components/layout/AppShell.tsx`, `Sidebar.tsx`):
    * `/`: Dashboard workspace home (`HomePage.tsx`).
    * `/documents/:id`: Document collaborative editor shell (`EditorPage.tsx`).
    * `/docs/:id` / `/docs/*`: Distraction-free reader view (`ReaderPage.tsx`).
    * `/trash`: Soft-deleted trash explorer (`TrashPage.tsx`).
    * `/settings`: Preferences and Personal Access Tokens (`SettingsPage.tsx`).
    * `/admin`: System administration console (`AdminPage.tsx`).
    * Global modals for Login (`LoginModal.tsx`) and Personal Access Tokens (`TokensModal.tsx`).
* **Verification:**
  ```bash
  $ cd frontend && npm install && npm run build
  vite v5.4.21 building for production...
  ✓ 1647 modules transformed.
  dist/index.html                   1.20 kB │ gzip:  0.61 kB
  dist/assets/index-ClpM1nA7.css   22.32 kB │ gzip:  5.14 kB
  dist/assets/index-C7K-phCt.js   279.02 kB │ gzip: 81.19 kB
  ✓ built in 1.32s

  $ npm run preview -- --port 4173
  ➜  Local:   http://localhost:4173/
  ```
  *Status criteria:* Web application compiles cleanly with zero TypeScript errors, renders the main shell with user profile pill and version badge, and toggles seamlessly between Light, Dark, Sepia, and System themes.

---

### Step 4.2: TipTap Editor Core & Custom Node Views
* **Status:** Complete
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * TipTap ProseMirror rich editor architecture (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`):
    * Headings 1–3, bold, italic, strikethrough, inline code, blockquote, horizontal rule, bullet list, ordered list.
    * GFM aligned tables (`@tiptap/extension-table`, `TableRow`, `TableCell`, `TableHeader`).
    * Interactive task lists (`@tiptap/extension-task-list`, `@tiptap/extension-task-item`).
  * Custom CodeBlock extension and React NodeView (`src/components/editor/extensions/CodeBlockCustom.tsx`):
    * Multi-language dropdown selector (TypeScript, Python, C++, Bash, SQL, etc.).
    * One-click clipboard copy button with visual feedback.
    * Line numbering and theme-aware dark/light/sepia container.
  * Custom KaTeX Display Math (`$$...$$`) NodeView (`src/components/editor/extensions/MathBlock.tsx`):
    * Formula rendering via `katex` with embedded CSS typography.
    * Interactive LaTeX editor with preview toggling and formula copy.
    * Graceful syntax error banner.
  * Custom KaTeX Inline Math (`$...$`) NodeView (`src/components/editor/extensions/InlineMath.tsx`):
    * Inline chip rendering with click-to-edit input field.
  * Custom Mermaid Diagram NodeView (`src/components/editor/extensions/MermaidBlock.tsx`):
    * SVG diagram generation using `mermaid.render()` with theme-aware palettes (`mermaidRenderer.ts`).
    * Interactive controls: Zoom In (`+`), Zoom Out (`-`), Reset Zoom (`100%`).
    * Edit Source vs. Diagram Preview toggles.
    * Diagram source copying and non-crashing syntax error banners.
  * Custom Obsidian-Style WikiLink NodeView (`src/components/editor/extensions/WikiLink.tsx`):
    * Supports `[[target]]` and `[[target|label]]` syntax.
    * Real-time input rule parsing while typing.
    * Inline document badge with interactive reference popover and navigation shortcut.
  * Editor Toolbar component (`src/components/editor/EditorToolbar.tsx`):
    * Formatting marks, headings, lists, tables, code blocks, math, Mermaid, and wiki-links.
  * Top-Level Editor Component (`src/components/editor/CollaborativeEditor.tsx`):
    * Integrated into `EditorPage.tsx` and test harness `TestEditorPage.tsx`.
  * Playwright E2E test suite (`tests/e2e/editor_nodes.spec.ts` & `playwright.config.ts`):
    * Validates math formulas, flowchart diagrams, wiki-links, and code blocks in headless Chromium.
* **Verification:**
  ```bash
  $ npm run test:e2e -- --spec editor_nodes.spec.ts
  Running 4 tests using 4 workers
    ✓ renders syntax-highlighted code block with language selection and copy button (425ms)
    ✓ renders Obsidian-style [[wiki-links]] and interactive reference popup (418ms)
    ✓ renders KaTeX display math block with SVG/DOM formula trees (616ms)
    ✓ renders Mermaid diagram and supports interactive zoom and source toggles (823ms)

    4 passed (2.3s)
  ```
  *Status criteria:* Playwright test renders a fixture containing math formulas, a flowchart diagram, and a wiki-link; verifies DOM elements render corresponding SVG/KaTeX trees.

---

### Step 4.3: Real-Time Sync & Cursor Presence Integration
* **Status:** Complete
* **Date Completed:** 2026-10-11
* **Deliverables:**
  * Full-Duplex Binary WebSocket Collab Provider (`frontend/src/api/collabProvider.ts`):
    * 1-byte opcode framing:
      * Opcode `0x00`: Yjs CRDT Synchronization (`0x01` SyncStep1, `0x02` SyncStep2, `0x03` SyncUpdate).
      * Opcode `0x01`: Awareness and colored cursor presence propagation.
      * Opcode `0x02`: Real-time review notifications (comments, suggestions, tasks).
      * Opcode `0x03` / `0x04`: Ping/Pong heartbeat latency keepalives.
    * Reconnection watchdog with exponential backoff (1s, 2s, 4s, 8s, up to 15s with jitter).
    * Status listener dispatch (`connected`, `connecting`, `disconnected`) wired to `uiStore.setSyncStatus`.
  * Collaborative TipTap Editor Extensions:
    * TipTap `Collaboration` extension with Yjs `Y.Doc` binding (`@tiptap/extension-collaboration`).
    * Custom `CollaborationCursor` extension (`src/components/editor/extensions/CollaborationCursor.ts`) leveraging `@tiptap/y-tiptap` for unified ProseMirror plugin key state.
    * Remote cursor styles in `src/index.css` (`.collaboration-cursor__caret`, `.collaboration-cursor__label`).
  * Real-Time User Presence Synchronization:
    * Automatic awareness updates when user profile loads or changes.
    * Peer departure awareness cleanup on disconnect or tab closure.
  * Side-by-Side Dual Editor Test Harness (`src/pages/TestCollabPage.tsx` at `/test-collab`):
    * Split-pane view for Alice (pink) and Bob (blue).
    * Individual network disconnect/reconnect simulation toggles for offline partition testing.
  * Playwright E2E Multi-Client Test Suite (`tests/e2e/collab_presence.spec.ts` & `playwright.config.ts`):
    * Multi-webServer orchestration launching both `cme-server` and `npm run preview`.
    * 4 comprehensive end-to-end tests:
      1. Real-time typing synchronization between Alice and Bob over WebSocket.
      2. Remote cursor presence rendering with collaborator carets and user name labels.
      3. Network partition simulation, offline contribution typing, reconnect, and conflict-free CRDT merge.
      4. Independent dual-window browser context collaboration on `/documents/:id`.
* **Verification:**
  ```bash
  $ npm run test:e2e
  Running 8 tests using 8 workers
    ✓ renders syntax-highlighted code block with language selection and copy button (454ms)
    ✓ renders Obsidian-style [[wiki-links]] and interactive reference popup (556ms)
    ✓ renders KaTeX display math block with SVG/DOM formula trees (659ms)
    ✓ renders Mermaid diagram and supports interactive zoom and source toggles (877ms)
    ✓ synchronizes real-time keystrokes between Alice and Bob (867ms)
    ✓ handles network partition, offline edits, and conflict-free CRDT reconnection merge (1.3s)
    ✓ synchronizes across two independent browser windows on /documents/:id (1.1s)
    ✓ renders remote cursor presence and collaborator labels (1.1s)

    8 passed (3.4s)
  ```
  *Status criteria:* Launch two collaborative editing sessions side-by-side on `/documents/:id` and `/test-collab`; verify typing in Window A updates Window B in real time with Window A's colored cursor; disconnect network in Window A, type offline, reconnect network, and verify conflict-free convergence.











