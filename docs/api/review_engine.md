# Review Engine API & Real-Time Synchronization

The **Collaborative Markdown Editor (CME)** review subsystem enables asynchronous code-review style collaboration on rich markdown documents. Reviewers can discuss sections via threaded comments, propose inline text replacements (suggestions), and assign action items (tasks).

All mutations are persisted in PostgreSQL and synchronized in real-time to active collaborators over WebSocket **Opcode `0x02`** (Review Event Notifications). Furthermore, when suggestions are accepted, they are immediately applied to the live **Yjs CRDT document** in memory, propagating text changes to all active editor sessions.

---

## 1. Access Control Matrix

Review actions enforce granular RBAC permissions determined by [`PermissionEngine`](file:///home/pasc/cme/backend/include/cme/db/permission_engine.hpp):

| Action | HTTP Method & Path | Minimum Access Level |
|---|---|---|
| List Comments | `GET /api/v1/documents/:id/comments` | `READ` |
| Create Comment | `POST /api/v1/documents/:id/comments` | `COMMENT` |
| Reply to Comment | `POST /api/v1/comments/:id/replies` | `COMMENT` |
| Resolve Comment | `PATCH /api/v1/comments/:id/status` | `EDIT` or Thread Author |
| Delete Comment | `DELETE /api/v1/comments/:id` | `EDIT` or Thread Author |
| List Suggestions | `GET /api/v1/documents/:id/suggestions` | `READ` |
| Submit Suggestion | `POST /api/v1/documents/:id/suggestions` | `COMMENT` |
| Accept Suggestion | `POST /api/v1/suggestions/:id/accept` | `EDIT` |
| Reject Suggestion | `POST /api/v1/suggestions/:id/reject` | `EDIT` or Suggestion Author |
| List Tasks | `GET /api/v1/documents/:id/tasks` | `READ` |
| Create Task | `POST /api/v1/documents/:id/tasks` | `COMMENT` |
| Toggle Task Status | `PATCH /api/v1/tasks/:id` | `COMMENT` |
| Delete Task | `DELETE /api/v1/tasks/:id` | `EDIT` |

---

## 2. Threaded Comments API

### 2.1 List Comments
```http
GET /api/v1/documents/:id/comments
Authorization: Bearer <token>
```

**Response (`200 OK`)**:
```json
[
  {
    "id": "b666d4a2-5b3a-499f-ac18-551142bb2d6c",
    "document_id": "f9c68ef4-858c-4183-8644-59d20a0a7b66",
    "parent_id": null,
    "content": "This paragraph needs further clarification on concurrency.",
    "status": "OPEN",
    "anchor": {
      "type": "text-quote",
      "exact": "original text that needs review",
      "prefix": "This is the ",
      "suffix": ".\nHere is line three"
    },
    "author": {
      "id": "fd0bce48-ed5a-4a8d-a1b2-ffd2c78c0cda",
      "username": "rev_bob",
      "display_name": "Bob Reviewer",
      "avatar_color": "#10b981"
    },
    "created_at": "2026-10-11 14:00:00+00",
    "updated_at": "2026-10-11 14:00:00+00",
    "replies": [
      {
        "id": "b7782991-1427-4c1c-8cec-0deba365bbe2",
        "document_id": "f9c68ef4-858c-4183-8644-59d20a0a7b66",
        "parent_id": "b666d4a2-5b3a-499f-ac18-551142bb2d6c",
        "content": "Acknowledged, I will rephrase this section.",
        "status": "OPEN",
        "anchor": {},
        "author": {
          "id": "3424950f-f047-4a4a-963d-854d1eb33547",
          "username": "rev_alice",
          "display_name": "Alice Admin",
          "avatar_color": "#3b82f6"
        },
        "created_at": "2026-10-11 14:02:00+00",
        "updated_at": "2026-10-11 14:02:00+00",
        "replies": []
      }
    ]
  }
]
```

### 2.2 Create Root Comment
```http
POST /api/v1/documents/:id/comments
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "This paragraph needs further clarification on concurrency.",
  "anchor": {
    "type": "text-quote",
    "exact": "original text that needs review",
    "prefix": "This is the ",
    "suffix": ".\nHere is line three"
  }
}
```

**Response (`201 Created`)**: Returns created comment entity.

### 2.3 Post Reply
```http
POST /api/v1/comments/:id/replies
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Acknowledged, I will rephrase this section."
}
```

**Response (`201 Created`)**: Returns created reply entity with `parent_id`.

### 2.4 Update Comment Status
```http
PATCH /api/v1/comments/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "RESOLVED"
}
```

**Response (`200 OK`)**: Returns updated comment entity.

### 2.5 Delete Comment
```http
DELETE /api/v1/comments/:id
Authorization: Bearer <token>
```

**Response (`200 OK`)**: `{"status": "deleted"}`

---

## 3. Inline Suggestions API & Live CRDT Injection

### 3.1 List Suggestions
```http
GET /api/v1/documents/:id/suggestions?status=PENDING
Authorization: Bearer <token>
```

**Response (`200 OK`)**: Array of suggestion entities.

### 3.2 Submit Suggestion
```http
POST /api/v1/documents/:id/suggestions
Authorization: Bearer <token>
Content-Type: application/json

{
  "original_text": "original text that needs review",
  "suggested_text": "refined and accepted text",
  "anchor": {
    "offset": 26,
    "length": 30
  }
}
```

**Response (`201 Created`)**:
```json
{
  "id": "e229e061-0775-4d74-b52b-426ad5627258",
  "document_id": "f9c68ef4-858c-4183-8644-59d20a0a7b66",
  "author": {
    "id": "fd0bce48-ed5a-4a8d-a1b2-ffd2c78c0cda",
    "username": "rev_bob",
    "display_name": "Bob Reviewer",
    "avatar_color": "#10b981"
  },
  "status": "PENDING",
  "original_text": "original text that needs review",
  "suggested_text": "refined and accepted text",
  "anchor": {
    "offset": 26,
    "length": 30
  },
  "created_at": "2026-10-11 14:05:00+00",
  "resolved_at": null
}
```

### 3.3 Accept Suggestion & Live CRDT Reconciliation
When an editor accepts a suggestion, CME performs two coordinated actions:
1. Locates the anchor / original text in the live [`DocumentRoom`](file:///home/pasc/cme/backend/include/cme/collab/document_room.hpp) and performs atomic CRDT text replacement (`delete_text` + `insert_text`).
2. Broadcasts an incremental CRDT `SyncUpdate` delta (`0x00 0x03`) to all connected peers, updating remote editors in real time.
3. Updates the suggestion record in PostgreSQL (`status = 'ACCEPTED'`, `resolved_at = NOW()`).
4. Broadcasts a `SUGGESTION_ACCEPTED` event over Opcode `0x02`.

```http
POST /api/v1/suggestions/:id/accept
Authorization: Bearer <token>
```

**Response (`200 OK`)**:
```json
{
  "id": "e229e061-0775-4d74-b52b-426ad5627258",
  "status": "ACCEPTED",
  "resolved_at": "2026-10-11 14:06:12+00"
}
```

### 3.4 Reject Suggestion
```http
POST /api/v1/suggestions/:id/reject
Authorization: Bearer <token>
```

**Response (`200 OK`)**: `{"status": "REJECTED", "resolved_at": "..."}`

---

## 4. Action Item Tasks API

### 4.1 List Tasks
```http
GET /api/v1/documents/:id/tasks
Authorization: Bearer <token>
```

### 4.2 Create Task
```http
POST /api/v1/documents/:id/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Update deployment diagram with replica nodes",
  "comment_id": "b666d4a2-5b3a-499f-ac18-551142bb2d6c",
  "assignee_id": "3424950f-f047-4a4a-963d-854d1eb33547",
  "due_date": "2026-10-20T18:00:00Z"
}
```

**Response (`201 Created`)**: Returns created task entity.

### 4.3 Toggle Task Completion
```http
PATCH /api/v1/tasks/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "is_completed": true
}
```

**Response (`200 OK`)**: Returns updated task entity with `completed_at` timestamp.

### 4.4 Delete Task
```http
DELETE /api/v1/tasks/:id
Authorization: Bearer <token>
```

**Response (`200 OK`)**: `{"status": "deleted"}`

---

## 5. Real-Time WebSocket Opcode 0x02 Event Specifications

Whenever a review mutation succeeds via REST, [`Server::broadcast_review_event`](file:///home/pasc/cme/backend/include/cme/server/server.hpp#L63) dispatches a binary frame to all collaborators connected to `/ws/collab/:document_id`:

* **Frame Opcode**: `0x02` (Review Event Notification)
* **Payload**: UTF-8 encoded JSON string

### Event Schema Reference

| Event Name | Trigger | Payload Summary |
|---|---|---|
| `COMMENT_CREATED` | New comment posted | `{"event": "COMMENT_CREATED", "document_id": "...", "comment": {...}}` |
| `COMMENT_REPLIED` | Reply added to thread | `{"event": "COMMENT_REPLIED", "document_id": "...", "parent_id": "...", "comment": {...}}` |
| `COMMENT_STATUS_CHANGED` | Thread resolved or reopened | `{"event": "COMMENT_STATUS_CHANGED", "document_id": "...", "comment_id": "...", "status": "RESOLVED"}` |
| `COMMENT_DELETED` | Comment deleted | `{"event": "COMMENT_DELETED", "document_id": "...", "comment_id": "..."}` |
| `SUGGESTION_CREATED` | Edit proposal submitted | `{"event": "SUGGESTION_CREATED", "document_id": "...", "suggestion": {...}}` |
| `SUGGESTION_ACCEPTED` | Suggestion accepted and merged | `{"event": "SUGGESTION_ACCEPTED", "document_id": "...", "suggestion": {...}}` |
| `SUGGESTION_REJECTED` | Suggestion rejected | `{"event": "SUGGESTION_REJECTED", "document_id": "...", "suggestion_id": "..."}` |
| `TASK_CREATED` | Action item added | `{"event": "TASK_CREATED", "document_id": "...", "task": {...}}` |
| `TASK_UPDATED` | Task completed or modified | `{"event": "TASK_UPDATED", "document_id": "...", "task": {...}}` |

---

## 6. Dual-Anchoring Model

Review comments and suggestions utilize a dual-anchoring model to remain visually anchored even through concurrent edits:

1. **W3C Web Annotation Quote Selector (Fallback & SSR)**:
   - `exact`: The target string highlighted by the reviewer.
   - `prefix`: Leading 20–50 characters preceding the selection for disambiguation.
   - `suffix`: Trailing 20–50 characters following the selection.
2. **Offset & Length Coordinates**:
   - `offset`: Zero-based character index within the document.
   - `length`: Character count of the annotated text span.
3. **CRDT Live Relative Position (Frontend TipTap binding)**:
   - In the frontend TipTap editor (Phase 4 & 6), relative positions are mapped to immutable Yjs character item IDs.
