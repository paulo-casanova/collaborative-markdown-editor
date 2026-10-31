# Collaborative Markdown Editor (CME) Documentation

Welcome to the internal engineering documentation for the **Collaborative Markdown Editor (CME)** platform.

## Documentation Index

### 1. Architecture & Project Implementation
* [System Architecture](Architecture.md): Complete technical specification of runtime components (Frontend, CME Server, AI Agent), communication channels, and protocols.
* [Markdown Syntax & Authoring Guide](Markdown.md): Comprehensive authoring guide and technical specification for all supported Markdown syntax (GFM, Obsidian WikiLinks, Callouts, Status Pills, KaTeX, and Mermaid).
* [Implementation Progress Log](implementation_log.md): Granular record of implemented phases, test runs, and verification criteria.

### 2. Database & Access Control Architecture
* [Access Control (ACL) Model](Access Controls.md): Comprehensive specification of CME's authorization model, multi-parent team DAG inheritance, cumulative access scopes, and permission evaluation waterfall.
* [Authentication & Identity Guide](Authentication.md): Complete guide to CME's authentication strategies, standalone vs. reverse proxy SSO deployments, session tokens, and admin evaluation.
* [Relational Database Schema](database/schema.md): Complete table specifications, data types, constraints, and ER model.
* [Team DAG & Permission Engine](database/dag_permissions.md): Mathematical and query model for multi-parent team hierarchies and granular ACL inheritance.
* [Database Migrations Guide](database/migrations.md): How versioned SQL migrations are executed and managed via `cme-migrate`.

### 3. Storage Architecture
* [Storage Layout & Document Bundles](storage/layout.md): POSIX tree structure (`content/`, `bundles/`, `snapshots/`, `trash/`).
* [Storage Abstraction Layer & Atomic Writes](storage/atomic_writes.md): `IStorageBackend` interface and atomic rename crash safety.

### 4. API & Protocol Specifications
* [Health Probe API](api/health.md): `GET /api/v1/health` operational metrics and JSON schema.
* [Authentication & Authorization API](api/auth.md): Pluggable AuthN (Challenge / Delegated JIT), Admin providers, Sessions, and Personal Access Tokens.
* [Document & Workspace Tree REST API](api/documents.md): Document CRUD, workspace directory trees, raw markdown streaming, and bundle assets.
* [Markdown to Semantic HTML Renderer API](api/renderer.md): SSR endpoints with KaTeX math, Mermaid diagrams, wiki links, and review overlays.
* [User & Team Administration API & CLI](api/admin.md): Administrative user and team CRUD, DAG hierarchy management, and `cme-admin` CLI.
* [Review Engine API & Real-Time Sync](api/review_engine.md): Threaded comments, inline suggestions, action item tasks, live CRDT merging, and Opcode `0x02` notifications.
* [WebSocket Framing Protocol](api/websocket_protocol.md): Binary wire protocol opcodes (`0x00`–`0x04`), handshake authentication, and CRDT synchronization deltas.

### 5. Real-Time Collaborative Engine
* [Native Yjs CRDT C-FFI Architecture](crdt/yrs_ffi.md): Integration of `y-crdt` / `yrs` C-FFI (`libyrs`), `CrdtDoc` RAII model, and in-memory room coordination.
* [In-Memory Room & Debounced Persistence](crdt/persistence.md): Debounced flusher lifecycle, date-partitioned snapshots, memory eviction, and transparent rehydration.

### 6. Deployment & Operations
* [Building and Deploying CME](Building and Deploying.md): Step-by-step build instructions, deployment scenarios (Systemd standalone, Nginx/Caddy reverse proxy, Containerized, and AI companion sidecar), and maintenance runbooks.
* **Configuration Reference**: Complete YAML schema and environment variable overrides.
* **Backup & Disaster Recovery**: Coordinated two-phase snapshotting, retention rotation, and recovery runbook.
