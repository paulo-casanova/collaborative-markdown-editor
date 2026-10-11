# Workspaces & Document CRUD REST API Specification

The Collaborative Markdown Editor (CME) platform provides high-performance REST endpoints for document management, workspace directory traversal, raw markdown retrieval, and bundle asset attachments. These endpoints provide the primary programming interface for web clients, external automation tools, and LLM coding agents.

---

## Access Control & Security Model

All workspace and document operations enforce granular permissions through the PostgreSQL DAG [`PermissionEngine`](file:///home/pasc/cme/backend/include/cme/db/permission_engine.hpp):
* **Superuser Override:** Administrators (evaluated via `users.is_system_admin` or pluggable `IAdminProvider`) bypass all ACL checks.
* **`READ` Access:** Required for `GET /api/v1/workspaces/tree` (filtered per node), `GET /api/v1/documents/{id}`, `GET /api/v1/documents/by-path`, `GET /api/v1/documents/{id}/raw`, and `GET /api/v1/documents/{id}/assets/:filename`.
* **`EDIT` Access:** Required for `POST /api/v1/documents` (on parent directory), `PUT /api/v1/documents/{id}`, `PATCH /api/v1/documents/{id}/move`, `DELETE /api/v1/documents/{id}`, and `POST /api/v1/documents/{id}/assets`.

---

## Endpoints Overview

| Method | Endpoint | Description | Required Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspaces/tree` | Returns hierarchical directory tree of directories and documents | `READ` (per node) |
| `GET` | `/api/v1/documents/{id}` | Fetch document metadata, title, filesystem path, and markdown content | `READ` |
| `GET` | `/api/v1/documents/by-path` | Lookup a document by relative path (e.g. `?path=guides/intro.md`) | `READ` |
| `GET` | `/api/v1/documents/{id}/raw` | Stream raw UTF-8 `text/markdown` directly without JSON wrapping | `READ` |
| `POST` | `/api/v1/documents` | Create a new document or document bundle with initial markdown | `EDIT` (directory) |
| `PUT` | `/api/v1/documents/{id}` | Full content update and optional title change | `EDIT` |
| `PATCH` | `/api/v1/documents/{id}/move` | Rename or move a document across workspace directories | `EDIT` |
| `DELETE`| `/api/v1/documents/{id}` | Soft-delete a document (moves node to `trash/` in storage) | `EDIT` / Owner |
| `POST` | `/api/v1/documents/{id}/assets` | Upload an image or attachment (saved to neighboring `images/`) | `EDIT` |
| `GET` | `/api/v1/documents/{id}/assets/:filename` | Stream uploaded image or attachment asset | `READ` |

---

## Detailed Endpoint Reference

### 1. `GET /api/v1/workspaces/tree`
Recursively traverses storage content directories and joins active document UUIDs, titles, and timestamps from PostgreSQL. Nodes that the authenticated user lacks `READ` permissions for are omitted from the response tree.

#### Request Headers
`Authorization: Bearer <token>` or `Cookie: cme_session=<token>`

#### Response (`HTTP 200 OK`)
```json
{
  "tree": [
    {
      "name": "guides",
      "path": "guides",
      "is_directory": true,
      "is_bundle": false,
      "size_bytes": 0
    },
    {
      "id": "7a52eb1a-34e0-48d5-8ac8-9a28b5d1a8dc",
      "name": "intro.md",
      "path": "guides/intro.md",
      "title": "Intro",
      "is_directory": false,
      "is_bundle": false,
      "owner_user_id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
      "size_bytes": 24,
      "updated_at": "2026-10-11T00:44:00Z"
    }
  ]
}
```

---

### 2. `POST /api/v1/documents`
Creates a document or document bundle on the POSIX filesystem and indexes its metadata in PostgreSQL.

#### Request Body
```json
{
  "path": "guides/intro.md",
  "content": "# Intro\nHello world",
  "title": "Intro",
  "is_bundle": false
}
```
*Note:* If `title` is omitted, the title is automatically derived from the leading `# <Title>` heading or file basename.

#### Response (`HTTP 201 Created`)
```json
{
  "id": "7a52eb1a-34e0-48d5-8ac8-9a28b5d1a8dc",
  "path": "guides/intro.md",
  "title": "Intro",
  "content": "# Intro\nHello world",
  "is_bundle": false,
  "owner_user_id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
  "created_at": "2026-10-11T00:44:00Z",
  "updated_at": "2026-10-11T00:44:00Z"
}
```

---

### 3. `GET /api/v1/documents/{id}/raw`
Returns the raw markdown file directly without JSON serialization.

#### Request Headers
`Authorization: Bearer <token>`

#### Response (`HTTP 200 OK`)
```http
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8

# Intro
Hello world
```

---

### 4. `GET /api/v1/documents/by-path`
Fetches a document by its relative filesystem path. Automatically reconciles and indexes files created directly on disk if not yet tracked in PostgreSQL.

#### Query Parameter
`?path=guides/intro.md`

#### Response (`HTTP 200 OK`)
```json
{
  "id": "7a52eb1a-34e0-48d5-8ac8-9a28b5d1a8dc",
  "path": "guides/intro.md",
  "title": "Intro",
  "content": "# Intro\nHello world",
  "is_bundle": false,
  "owner_user_id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
  "created_at": "2026-10-11T00:44:00Z",
  "updated_at": "2026-10-11T00:44:00Z"
}
```

---

### 5. `PUT /api/v1/documents/{id}`
Atomically replaces document content on disk and updates PostgreSQL `updated_at` and `title`.

#### Request Body
```json
{
  "content": "# Intro\nCollaborative Live Edit",
  "title": "Intro Guide"
}
```

#### Response (`HTTP 200 OK`)
```json
{
  "id": "7a52eb1a-34e0-48d5-8ac8-9a28b5d1a8dc",
  "path": "guides/intro.md",
  "title": "Intro Guide",
  "content": "# Intro\nCollaborative Live Edit",
  "is_bundle": false,
  "owner_user_id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
  "created_at": "2026-10-11T00:44:00Z",
  "updated_at": "2026-10-11T00:44:05Z"
}
```

---

### 6. `PATCH /api/v1/documents/{id}/move`
Moves or renames a document or directory bundle in storage via atomic rename and updates PostgreSQL `fs_path`.

#### Request Body
```json
{
  "new_path": "guides/manual.md"
}
```

#### Response (`HTTP 200 OK`)
```json
{
  "id": "7a52eb1a-34e0-48d5-8ac8-9a28b5d1a8dc",
  "path": "guides/manual.md",
  "title": "Intro Guide",
  "is_bundle": false,
  "owner_user_id": "a5466d63-8b8f-4694-b1ed-33c31a687f16",
  "created_at": "2026-10-11T00:44:00Z",
  "updated_at": "2026-10-11T00:44:10Z"
}
```

---

### 7. `DELETE /api/v1/documents/{id}`
Soft-deletes the document to `trash/` preserving timestamp headers and purges the document entry from PostgreSQL.

#### Response (`HTTP 200 OK`)
```json
{
  "status": "deleted",
  "trash_id": "20261011_004415_manual.md"
}
```

---

### 8. `POST /api/v1/documents/{id}/assets`
Uploads an image or attachment. For bundles (`.bundle`), assets are placed into `<bundle>/images/`. For standard documents, assets are placed into the neighboring `images/` directory.

#### Query Parameter / Header
`?filename=diagram.png` or `X-Asset-Filename: diagram.png`

#### Request Body
Raw binary bytes or form data.

#### Response (`HTTP 201 Created`)
```json
{
  "filename": "diagram.png",
  "path": "guides/images/diagram.png"
}
```

---

### 9. `GET /api/v1/documents/{id}/assets/:filename`
Streams the uploaded asset with appropriate MIME type (e.g. `image/png`, `image/jpeg`, `image/svg+xml`, `application/octet-stream`).

#### Response (`HTTP 200 OK`)
Direct binary stream of the stored image or attachment.
