# Collaborative Markdown Editor (CME) Documentation

Welcome to the internal engineering documentation for the **Collaborative Markdown Editor (CME)** platform.

## Documentation Index

### 1. Project Implementation
* [Implementation Progress Log](implementation_log.md): Granular record of implemented phases, test runs, and verification criteria.

### 2. Database & Data Architecture
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
* **WebSocket Framing Protocol**: Binary wire protocol opcodes (`0x00`–`0x04`) and CRDT synchronization deltas.

### 5. Real-Time Collaborative Engine
* [Native Yjs CRDT C-FFI Architecture](crdt/yrs_ffi.md): Integration of `y-crdt` / `yrs` C-FFI (`libyrs`), `CrdtDoc` RAII model, and in-memory room coordination.

### 6. Deployment & Operations *(Coming in Phase 7)*
* **Configuration Reference**: Complete YAML schema and environment variable overrides.
* **Deployment Topologies**: Embedded single-binary execution vs. Nginx reverse-proxy setup.
* **Backup & Disaster Recovery**: Coordinated two-phase snapshotting, retention rotation, and recovery runbook.
