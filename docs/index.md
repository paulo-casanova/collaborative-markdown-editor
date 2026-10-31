# Collaborative Markdown Editor (CME)

[![Language C++20](https://img.shields.io/badge/C%2B%2B-20-blue.svg)](https://en.cppreference.com/w/cpp/20)
[![Frontend React 18](https://img.shields.io/badge/Frontend-React%2018%20%7C%20TypeScript-61dafb.svg)](https://react.dev/)
[![CRDT Engine Yjs / Yrs](https://img.shields.io/badge/CRDT-Yjs%20%2F%20Yrs-orange.svg)](https://github.com/y-crdt/y-crdt)
[![Database PostgreSQL 14+](https://img.shields.io/badge/Database-PostgreSQL%2014%2B-336791.svg)](https://www.postgresql.org/)
[![License MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A modern, high-performance **Collaborative Markdown Editor and Knowledge Base Platform** engineered for engineering teams, technical writers, and researchers.

CME combines **local-first POSIX filesystem storage** with **zero-latency in-memory CRDT real-time collaboration**, an intuitive **distraction-free reader mode**, an **asynchronous review engine** with inline suggestions, **enterprise-grade Multi-Parent DAG access controls**, and a built-in **autonomous AI agent companion**.

---

## Table of Contents

* [1. System Overview & Philosophy](#1-system-overview--philosophy)
* [2. High-Level Architecture](#2-high-level-architecture)
* [3. Core Platform Capabilities](#3-core-platform-capabilities)
  * [3.1. Local-First & POSIX Storage Engine](#31-local-first--posix-storage-engine)
  * [3.2. Real-Time Collaboration & Native CRDTs](#32-real-time-collaboration--native-crdts)
  * [3.3. Distraction-Free Reader Mode](#33-distraction-free-reader-mode)
  * [3.4. Live Preview & Multi-Tab Editor](#34-live-preview--multi-tab-editor)
  * [3.5. Collaborative Review Engine](#35-collaborative-review-engine)
  * [3.6. Autonomous AI Agent Companion (Dialog Sidecar)](#36-autonomous-ai-agent-companion-dialog-sidecar)
  * [3.7. Enterprise Access Control (RBAC & Multi-Parent DAGs)](#37-enterprise-access-control-rbac--multi-parent-dags)
  * [3.8. Pluggable Authentication & Identity](#38-pluggable-authentication--identity)
* [4. Master Documentation Index](#4-master-documentation-index)
* [5. Project Repository Layout](#5-project-repository-layout)
* [6. Quick Start & Build Instructions](#6-quick-start--build-instructions)
  * [6.1. Prerequisites](#61-prerequisites)
  * [6.2. Building the Frontend](#62-building-the-frontend)
  * [6.3. Building the C++ Server Daemon](#63-building-the-c-server-daemon)
  * [6.4. Running Verification Test Suites](#64-running-verification-test-suites)
  * [6.5. Launching CME Server](#65-launching-cme-server)
  * [6.6. Running with Docker Compose](#66-running-with-docker-compose)
* [7. Configuration Reference](#7-configuration-reference)

---

## 1. System Overview & Philosophy

Modern engineering documentation frequently suffers from a painful trade-off:
1. **Proprietary SaaS Silos**: Cloud wiki platforms provide real-time collaboration and commenting, but trap technical knowledge in proprietary databases, prevent offline Git workflows, and introduce external cloud dependencies.
2. **Static Git Repositories**: Markdown in plain Git repositories ensures version control and local filesystem interoperability, but lacks real-time multi-user editing, inline review threads, visual suggestion diffs, and accessible web-based reading for non-technical stakeholders.

**CME bridges this divide through five core principles:**

* **Local-First & Git-Native**: Authoritative document content resides directly on the host POSIX filesystem as standard Markdown (`.md`) files and bundle directories (`.bundle/`). External linters, Git hooks, static site generators, and scripts operate directly against document storage without proprietary blob decoding.
* **Zero-Latency In-Memory Concurrency**: Live collaborative rooms execute on an asynchronous C++20 `uWebSockets` event loop using native Conflict-free Replicated Data Types (CRDTs) powered by Rust's `y-crdt` / `yrs` engine via C-FFI. Live keystrokes stream between peers with sub-millisecond latencies without hitting the database.
* **Dual-Store Architecture**: A robust POSIX storage engine manages authoritative markdown files, bundled image assets, and crash-safe journals, while PostgreSQL (14+) manages relational metadata: user identities, team DAG hierarchies, fine-grained ACLs, review comments, suggestions, tasks, and point-in-time revision snapshots.
* **Rich Asynchronous Review Engine**: Google Docs-style collaboration tailored for technical documents: anchored inline comments, visual suggestion diffs (one-click Accept/Reject), and document-level action items.
* **Autonomous AI Agent Companion**: Integrated WebSocket dialog sidecar bridging human collaborators with local or cloud AI agents (Claude Code, Gemini, local Ollama, OpenAI) capable of inspecting document context, running workspace tools, and streaming direct edits with live diff previews.

---

## 2. High-Level Architecture

The diagram below illustrates CME's global runtime architecture, including client connections, edge reverse proxy, the native C++20 server daemon, persistence stores, and the AI agent companion:

```mermaid
flowchart TD
    subgraph Clients["Client Layer (Browser / Desktop)"]
        UI["Web UI (React 18 + Vite)"]
        CM["CodeMirror 6 + Live Preview"]
        YJS_C["Yjs CRDT Client Engine"]
        DS["Dialog Sidecar & Zustand Stores"]
        UI --- CM
        CM --- YJS_C
        UI --- DS
    end

    subgraph Edge["Edge / Reverse Proxy Tier (Optional)"]
        RP["Reverse Proxy (Caddy / Nginx / Traefik)"]
        IDP["Identity Provider (OAuth2 / OIDC / SAML)"]
        RP -.->|"Delegated Auth / Session Check"| IDP
    end

    subgraph Server["CME Server Daemon (C++20 'cme-server')"]
        UWS["uWebSockets Asynchronous Engine (Port 8080)"]
        RM["Collab Room Manager (In-Memory Yrs CRDT)"]
        PW["Persistence Worker (Debounced Auto-Save)"]
        PE["Permissions Engine (RBAC DAG)"]
        DS_BE["Document & Review Service"]
        AGW["AI Agent Gateway Manager"]

        UWS --- RM
        UWS --- PE
        UWS --- DS_BE
        UWS --- AGW
        RM --- PW
    end

    subgraph Storage["Persistence & Storage Subsystems"]
        PG[("PostgreSQL 14+\n(RBAC, Revisions, Leases, Dialogs, Audit)")]
        FS[("POSIX Filesystem Storage\n(Markdown Files, Bundles, Snapshots)")]
        MOUNTS["Virtual Prefix Mounts\n(/cme, /jcsat, /specs)"]
        FS --- MOUNTS
    end

    subgraph Agent["AI Agent Companion ('cme-agent' Python Daemon)"]
        CME_A["cme-agent CLI Service"]
        TOOLS["Local Tool Runners (Git, Grep, Shell, Patch)"]
        LLM["LLMs (Claude Code, Gemini, Ollama, OpenAI)"]
        CME_A --- TOOLS
        CME_A --- LLM
    end

    Clients ==>|"WSS: /ws/document/:id (Binary Yjs)"| RP
    Clients ==>|"WSS: /ws/dialog/:id (JSON Stream)"| RP
    Clients ==>|"HTTPS: /api/v1/... (REST)"| RP

    RP ==>|"Proxy Pass + X-Remote-User"| UWS
    Clients -.->|"Direct Port 8080 (Development)"| UWS

    CME_A <==>|"WSS: /ws/agent (Bearer PAT Handshake)"| AGW
    AGW <==>|"Multiplexed Event Streaming"| DS

    PW ==>|"Atomic File Writes (.md + .bundle)"| FS
    PW ==>|"Revision History Snapshots"| PG
    PE <==>|"Recursive CTE Permission Queries"| PG
    DS_BE <==>|"Documents, Reviews, Audit Logs"| PG
```

For complete technical specifications of each subsystem, thread pools, and data flow sequences, see [System Architecture](Architecture.md).

---

## 3. Core Platform Capabilities

### 3.1. Local-First & POSIX Storage Engine
* **Plain Markdown Files**: All documents are stored as plain UTF-8 `.md` files directly on the host filesystem.
* **Document Bundles (`.bundle/`)**: Documents with companion assets (diagrams, screenshots, data files) are stored as self-contained bundles (`My Document.bundle/index.md` + companion assets). Assets are referenced via relative paths and served securely through CME's asset pipeline.
* **Virtual Prefix Mounts**: Seamlessly mount external host directories into the CME workspace hierarchy (e.g. `cme -> /home/pasc/cme/docs`).
* **Atomic Rename & Crash Safety**: Saves are written to temporary staging files on the same filesystem and atomically swapped into place via POSIX `rename()`, preventing file truncation or corruption during system interruptions.
* **Soft-Delete Trash & Recovery**: Deleted documents are archived into date-stamped trash directories with relational recovery metadata, enabling full restoration or permanent purge.

### 3.2. Real-Time Collaboration & Native CRDTs
* **Headless Yjs / Yrs Integration**: Document state is synchronized using Conflict-free Replicated Data Types implemented in Rust (`y-crdt` / `yrs`) linked directly to the C++ server daemon via C-FFI.
* **Binary WebSocket Protocol**: High-efficiency binary wire protocol (`0x00`–`0x04`) handling authentication handshakes, state vector exchanges, incremental updates, and real-time awareness presence (cursor positions and user identity).
* **In-Memory Room Management**: Active editing sessions are held in memory on the C++ `uWebSockets` event loop. Changes are debounced and periodically flushed to disk and PostgreSQL revision history, ensuring zero disk I/O bottlenecks during rapid typing.
* **Automatic Eviction & Rehydration**: Inactive rooms are flushed and evicted from memory when idle, and transparently rehydrated from disk and CRDT state journals on subsequent access.

### 3.3. Distraction-Free Reader Mode
* **Typographic Customization**: Fine-tune reading typography with selectable font families (Sans-Serif, Serif, Monospace, and Dyslexia-Friendly), dynamic font sizing, configurable line heights, and margin widths.
* **Heading Hierarchy & Numbering**: Automatic hierarchical section numbering (`1.`, `1.1.`, `1.1.1.`) with intelligent target resolution.
* **Reading Metrics**: Automatic calculation of estimated reading time and total word count.
* **Table of Contents (TOC)**: Collapsible sidebar with active heading tracking and smooth jump scrolling.
* **Obsidian-Style WikiLinks**: First-class support for `[[target]]`, `[[target|label]]`, and `[[target#heading]]`. Built-in link validator highlights valid links and renders broken targets with a prominent red `⚠` warning badge.
* **Rich Semantic Extensions**:
  * **GitHub Callout Alerts**: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!INFO]`, `> [!SUCCESS]`, `> [!QUESTION]`.
  * **Custom Status & Priority Pills**: `[status:active]`, `[priority:high]`, `[pill:emerald|verified]`.
  * **Mathematical Equations**: LaTeX expressions rendered via KaTeX in both inline (`$E = mc^2$`) and display (`$$\int ...$$`) formats.
  * **Interactive Diagrams**: Full Mermaid diagramming engine supporting flowcharts, sequence diagrams, class models, and state charts.

### 3.4. Live Preview & Multi-Tab Editor
* **Modern CodeMirror 6 Architecture**: Extensible, high-performance editor engine featuring live preview widgets, bracket matching, active line highlighting, and word wrap controls.
* **Multi-Document Tabs & Split View**: Open multiple documents simultaneously across configurable horizontal or vertical split panes.
* **Command Palette**: Universal fuzzy-search command palette (`Ctrl+P` / `Cmd+K`) to jump across workspace files, recent documents, and editor commands.
* **Vim / Emacs Modes**: Full keyboard modal editing support alongside standard desktop keybindings.

### 3.5. Collaborative Review Engine
* **Threaded Inline Discussions**: Select text in Reader or Editor mode to start discussion threads with multi-user replies and status resolution (`open`, `resolved`, `archived`).
* **Visual Suggestion Diffs**: Suggest text modifications with automatic Git-like diff visualization (green insertions, red deletions). Document editors can review and apply suggestions with a single click ("Accept"), automatically merging CRDT text changes into the document.
* **Action Items & Task Board**: Embedded task items associated with documents to track action items and author assignments.
* **Revision History & Visual Diff Viewer**: Resizable modal with full maximize toggle, chronological commit timeline, side-by-side diff comparison, and point-in-time document rollback.

### 3.6. Autonomous AI Agent Companion (Dialog Sidecar)
* **Real-Time WebSocket Sidecar**: Integrated AI dialog sidecar communicating with the `cme-agent` Python daemon over secure WebSockets.
* **Context Awareness**: Pass active selections, full document markdown, and workspace file references directly into agent prompts.
* **Streaming Model Support**: Native streaming integration with Anthropic Claude Code, Google Gemini, OpenAI, and local Ollama models.
* **Direct Edit Proposals**: AI agents propose concrete document modifications displayed as unified diff cards.
* **Serialized Execution Queue**: Multi-action replies are queued and executed sequentially with automatic document refetching, preventing race conditions and stale overwrites.
* **One-Click Edit Jump**: Click the "Direct edit applied" card to instantly scroll to and visually highlight the exact lines modified by the agent.

### 3.7. Enterprise Access Control (RBAC & Multi-Parent DAGs)
* **Four Cumulative Permission Scopes**:
  * `read`: View document content, history, and comments.
  * `comment`: Add threaded comments, replies, and propose inline suggestions.
  * `edit`: Modify markdown content directly, accept/reject suggestions, and manage tasks.
  * `admin`: Manage document permissions, transfer ownership, and delete/restore documents.
* **Multi-Parent Team DAGs**: Teams can have multiple parent organizations, forming a Directed Acyclic Graph (`team_parents`) evaluated using recursive PostgreSQL Common Table Expressions (CTEs).
* **Directory Waterfall Inheritance**: Documents automatically inherit permissions from enclosing workspace directories unless explicit overrides are defined.
* **Cumulative Resolution**: User permissions represent the cumulative union of direct user grants and all inherited team permissions across the DAG hierarchy.
* **Superuser Administrative Override**: Configured system administrators bypass permission checks for maintenance and audit tasks.

### 3.8. Pluggable Authentication & Identity
* **Standalone Challenge-Response**: Native user authentication using secure PBKDF2/SHA-256 password hashes and HttpOnly session cookies.
* **Delegated Reverse Proxy SSO**: Turnkey integration with enterprise Identity Providers (OAuth2, OIDC, SAML, Keycloak, Cloudflare Access, Authelia, Caddy, Nginx). CME trusts authenticated identity headers (`X-Remote-User`, `X-Remote-Email`) and provides automatic Just-In-Time (JIT) user account provisioning.
* **Session Expiry Handling**: Clean session recovery guidance behind reverse proxies without broken login popups.
* **Personal Access Tokens (PATs)**: Scoped Bearer tokens for CLI scripts, CI/CD automation, and AI companion agents.

---

## 4. Master Documentation Index

All CME technical specifications, architecture blueprints, authoring manuals, and operational guides are documented in detail:

| Category | Specification / Guide | Description |
| :--- | :--- | :--- |
| **System Architecture** | [Architecture & Runtime Design](Architecture.md) | Comprehensive specification of server daemon, C++ uWebSockets event loops, CRDT rooms, dual-store persistence, and AI agent bridge. |
| **Authoring & Syntax** | [Markdown Syntax & Authoring Guide](Markdown.md) | Complete reference for CommonMark, GFM, Obsidian WikiLinks, callout alerts, status pills, KaTeX math, and Mermaid diagrams. |
| **Security & Access** | [Access Control (ACL) Model](Access Controls.md) | Deep dive into CME's authorization engine, multi-parent team DAG inheritance, cumulative access scopes, and permission evaluation waterfall. |
| **Identity & AuthN** | [Authentication & Identity Guide](Authentication.md) | Architectural and operational guide to standalone authentication, reverse proxy SSO (delegated headers), session tokens, and PATs. |
| **Deployment & Ops** | [Building and Deploying CME](Building and Deploying.md) | Step-by-step compilation, production deployment scenarios (Systemd, Nginx, Caddy, Docker), and maintenance runbooks. |
| **Database Architecture** | [Relational Database Schema](database/schema.md) | PostgreSQL table specifications, column data types, foreign keys, indexes, and entity-relationship models. |
| **Database Engine** | [Team DAG & Permission Engine](database/dag_permissions.md) | Mathematical DAG traversal algorithms, recursive CTE queries, and performance optimization for team hierarchies. |
| **Database Engine** | [Database Migrations Guide](database/migrations.md) | Migration management and execution workflows using `cme-migrate`. |
| **CRDT Collaboration** | [Native Yjs CRDT C-FFI Architecture](crdt/yrs_ffi.md) | Rust `y-crdt` / `yrs` C-FFI binding (`libyrs`), `CrdtDoc` RAII wrappers, and in-memory room management. |
| **CRDT Collaboration** | [In-Memory Rooms & Persistence](crdt/persistence.md) | Debounced flusher lifecycle, date-partitioned snapshots, memory eviction, and transparent rehydration. |
| **Storage Engine** | [Storage Layout & Document Bundles](storage/layout.md) | POSIX tree structure (`content/`, `bundles/`, `snapshots/`, `trash/`) and bundle asset resolution. |
| **Storage Engine** | [Storage Abstraction & Atomic Writes](storage/atomic_writes.md) | `IStorageBackend` interface, atomic rename crash safety, and virtual mount prefix routing. |
| **REST & WebSocket API**| [WebSocket Framing Protocol](api/websocket_protocol.md) | Binary framing specification, opcodes (`0x00`–`0x04`), handshake sequence, and CRDT sync wire protocol. |
| **REST & WebSocket API**| [Document REST API](api/documents.md) | Document CRUD, directory tree hierarchies, raw markdown streaming, and bundle assets. |
| **REST & WebSocket API**| [Review Engine API](api/review_engine.md) | REST endpoints and WebSocket notifications for threaded comments, inline suggestions, and action items. |
| **REST & WebSocket API**| [Authentication API](api/auth.md) | Authentication endpoints, challenge login, delegated headers, and Personal Access Tokens. |
| **REST & WebSocket API**| [Health Probe API](api/health.md) | Health monitoring endpoint (`GET /api/v1/health`), operational metrics, and JSON schemas. |
| **REST & WebSocket API**| [User & Team Admin API & CLI](api/admin.md) | Administrative management endpoints and command-line interface (`cme-admin`). |
| **REST & WebSocket API**| [Markdown Renderer API](api/renderer.md) | Server-side markdown rendering endpoints with KaTeX math, Mermaid diagrams, and WikiLink resolution. |
| **Project History** | [Implementation Progress Log](implementation_log.md) | Granular phase-by-phase implementation log, test runs, and verification criteria. |

---

## 5. Project Repository Layout

```
.
├── backend/                  # Native C++20 server daemon & core engine
│   ├── include/              # Public headers & interfaces
│   │   ├── auth/             # Authentication & permission engine
│   │   ├── crdt/             # Yrs C-FFI wrappers & room manager
│   │   ├── document/         # Document service & integrity verifier
│   │   ├── review/           # Comments, suggestions & task tracker
│   │   ├── server/           # uWebSockets HTTP & WebSocket routes
│   │   └── storage/          # POSIX storage backend & atomic writers
│   └── src/                  # C++ implementation files
├── frontend/                 # React 18 + TypeScript + Vite web client
│   ├── src/
│   │   ├── api/              # REST clients & WebSocket providers
│   │   ├── components/       # UI components (Reader, Editor, Review, Dialog)
│   │   ├── pages/            # Top-level route pages (ReaderPage, EditorPage, Admin)
│   │   ├── stores/           # Zustand modular application stores
│   │   └── utils/            # Markdown, WikiLink, and KaTeX rendering utilities
│   └── tests/                # Vitest unit and integration test suites
├── docs/                     # Authoritative CME documentation & specifications
├── shared/                   # Shared protocol definitions & error taxonomies
├── migrations/               # PostgreSQL schema migration scripts
├── tests/                    # C++ CTest test suites (unit, integration, CRDT)
├── CMakeLists.txt            # Root CMake configuration (C++20)
├── config.example.yaml       # Master configuration reference template
└── docker-compose.yml        # Turnkey containerized development & deployment stack
```

---

## 6. Quick Start & Build Instructions

### 6.1. Prerequisites

* **Operating System**: Linux (Ubuntu 22.04 LTS / 24.04 LTS, Debian 12+, Fedora 39+, Arch Linux)
* **C++ Compiler**: GCC 13+ or Clang 16+ supporting full C++20 (`std::span`, `std::expected`, concepts)
* **Build System**: CMake 3.22+ and Ninja
* **Node.js**: Node.js 20.x or 22.x LTS and npm 10+
* **Database**: PostgreSQL 14, 15, or 16

Install required build packages:

```bash
# Ubuntu / Debian:
sudo apt update
sudo apt install -y build-essential cmake ninja-build git pkg-config \
    libpqxx-dev libpq-dev libssl-dev libgit2-dev zlib1g-dev curl

# Fedora / RHEL 9:
sudo dnf install -y gcc-c++ cmake ninja-build git pkgconfig \
    libpqxx-devel libpq-devel openssl-devel libgit2-devel zlib-devel curl
```

### 6.2. Building the Frontend

The React web client must be compiled before running CME with embedded UI mode:

```bash
cd frontend

# Install NPM dependencies
npm install

# Run unit tests
npm run test:unit

# Compile optimized static bundle
npm run build
```
Compiled production assets are output to `frontend/dist/`.

### 6.3. Building the C++ Server Daemon

From the repository root:

```bash
# 1. Configure Release build with Ninja
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release

# 2. Compile the server executable
ninja -C build cme-server

# 3. (Optional) Compile all test targets
ninja -C build
```
The compiled binary will be located at `build/bin/cme-server`.

### 6.4. Running Verification Test Suites

```bash
# Run all backend unit and integration tests via CTest
ctest --test-dir build --output-on-failure

# Run frontend Vitest suite (280+ tests)
npm --prefix frontend run test:unit
```

### 6.5. Launching CME Server

Ensure PostgreSQL is running and initialize the database schema:

```bash
# Run database migrations
./build/bin/cme-migrate --db-url postgresql://cme:secret@localhost:5432/cme_db

# Launch cme-server
./build/bin/cme-server \
    --db-url postgresql://cme:secret@localhost:5432/cme_db \
    --data-dir /var/lib/cme/data \
    --embedded-ui frontend/dist \
    --port 8080
```
Open your browser at `http://localhost:8080` to access CME.

### 6.6. Running with Docker Compose

For rapid evaluation or deployment, use the bundled `docker-compose.yml`:

```bash
docker compose up -d
```
This automatically launches:
* **PostgreSQL 16** with pre-configured schemas and health checks.
* **CME Server** compiled with embedded UI running on port 8080.

---

## 7. Configuration Reference

CME can be configured via YAML file (`--config config.yaml`) or command-line arguments:

```yaml
# Master Configuration Reference (config.yaml)
server:
  bind: "0.0.0.0"
  port: 8080
  reactor_threads: 2
  worker_threads: 8
  max_payload_bytes: 33554432 # 32 MB

storage:
  backend: "posix"
  root_path: "/var/lib/cme/data"
  trash_retention_days: 30
  snapshot_interval_seconds: 300
  mounts:
    - prefix: "docs"
      path: "/home/user/project/docs"

database:
  url: "postgresql://cme:secret@localhost:5432/cme_db"
  pool_size: 8
  connect_timeout_seconds: 5
  lease_enabled: true
  lease_ttl_seconds: 10

authn:
  # Provider: "standalone" (Challenge-Response) or "delegated" (Reverse Proxy SSO)
  provider: "delegated"
  delegated_header: "X-Remote-User"
  delegated_email_header: "X-Remote-Email"
  session_ttl_hours: 72

authz:
  admin_provider: "file"
  admin_file_path: "/etc/cme/admins.txt"

ui:
  embedded: true
  dist_dir: "frontend/dist"
```

For complete deployment architectures (Systemd service units, Nginx / Caddy reverse proxy setups, and backup runbooks), see [Building and Deploying CME](Building and Deploying.md).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
