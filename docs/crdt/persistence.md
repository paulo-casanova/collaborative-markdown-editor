# In-Memory DocumentRoom & Debounced Persistence

The **Collaborative Markdown Editor (CME)** persistence engine reconciles real-time, low-latency CRDT keystroke synchronization with atomic, crash-safe POSIX storage.

Rather than hitting disk I/O on every single keystroke or binary delta, CME holds active documents in memory as [`DocumentRoom`](file:///home/pasc/cme/backend/include/cme/collab/document_room.hpp) instances and coordinates disk synchronization via a dedicated background [`PersistenceWorker`](file:///home/pasc/cme/backend/include/cme/collab/persistence_worker.hpp).

---

## 1. Architectural Overview

```
 [ WebSocket Clients ]
         │ (Binary Yjs SyncUpdate / 0x00 0x03)
         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                      CME Server Daemon                       │
 │                                                              │
 │   ┌──────────────────────────────────────────────────────┐   │
 │   │                   RoomManager                        │   │
 │   │  ┌───────────────────────┐ ┌──────────────────────┐  │   │
 │   │  │ DocumentRoom (doc_A)  │ │ DocumentRoom (doc_B) │  │   │
 │   │  │  - YDoc (libyrs)      │ │  - YDoc (libyrs)     │  │   │
 │   │  │  - Peers: 3           │ │  - Peers: 0          │  │   │
 │   │  │  - Dirty: true        │ │  - Dirty: false      │  │   │
 │   │  └───────────────────────┘ └──────────────────────┘  │   │
 │   └──────────────────────────────▲───────────────────────┘   │
 │                                  │ Periodic Evaluation       │
 │   ┌──────────────────────────────┴───────────────────────┐   │
 │   │                  PersistenceWorker                   │   │
 │   │  - Evaluates idle_delay (5s) & max_interval (300s)   │   │
 │   │  - Flushes dirty rooms atomically to disk            │   │
 │   │  - Emits date-partitioned snapshots                  │   │
 │   │  - Evicts clean 0-peer rooms from RAM                │   │
 │   └──────────────────────┬───────────────────────────────┘   │
 └──────────────────────────┼───────────────────────────────────┘
                            │ Atomic write / snapshot
                            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                    POSIX Storage Layout                      │
 │                                                              │
 │   content/                   snapshots/                      │
 │    ├── guides/                └── 2026/                      │
 │    │    └── doc_A.md               └── 10/                   │
 │    └── notes/                           └── <ts>_doc_A.md    │
 └──────────────────────────────────────────────────────────────┘
```

---

## 2. Flush Triggers & Debounce Lifecycle

The background `PersistenceWorker` thread evaluates all active rooms at a configurable resolution (`check_interval`, default **200ms**). A room is flushed when any of the following triggers are met:

| Flush Trigger | Threshold | Description |
|---|---|---|
| **Inactivity Window (`idle_delay`)** | **5 seconds** | Flushes dirty rooms after typing activity has paused for 5 seconds. |
| **Max Interval Window (`max_interval`)** | **300 seconds** (5 min) | Forces a disk synchronization during non-stop, continuous collaborative typing sessions. |
| **Peer Departure** | Immediate / Idle | If a collaborator disconnects leaving dirty edits, the room is flushed prior to memory eviction. |
| **Graceful Server Teardown** | Immediate (`stop()`) | `flush_all_dirty()` executes synchronously on daemon shutdown to guarantee zero data loss. |

---

## 3. Storage Synchronization & Snapshot Generation

When a room is flushed:

1. **Active Content Storage (`content/`)**:
   - The converged markdown text string is extracted from the CRDT document (`room.get_content()`).
   - If the target document is a bundle directory (`.bundle`), it targets `<bundle>/index.md`; otherwise, it targets the relative `.md` file path.
   - The file is written atomically: written to a hidden temporary file (`.<filename>.<nonce>.tmp`), flushed to disk, and replaced via POSIX `rename(2)` to eliminate partial write hazards during power loss or crashes.

2. **Date-Partitioned Immutable Snapshots (`snapshots/`)**:
   - If `enable_snapshots` is enabled (default `true`), a copy of the converged content is archived under:
     ```
     snapshots/YYYY/MM/<YYYY-MM-DD-HH-MM-SS>_<sanitized_doc_path>.md
     ```
   - For example: `snapshots/2026/10/2026-10-11-14-30-00_notes_project_plan.md`
   - Snapshots serve as append-only recovery checkpoints and point-in-time diff sources.

3. **PostgreSQL Document Metadata (`updated_at`)**:
   - The document's record in PostgreSQL is synchronized with the flush timestamp:
     ```sql
     UPDATE documents SET updated_at = NOW() WHERE id = $1::uuid;
     ```

4. **Dirty State Reset**:
   - The room is marked clean (`room.mark_clean()`), resetting `last_flush_time` to `std::chrono::system_clock::now()`.

---

## 4. In-Memory Eviction & Transparent Rehydration

To conserve daemon memory and scale to tens of thousands of idle documents:

### Memory Eviction Policy
When all collaborator peers disconnect from a room (`room.peer_count() == 0`), the room enters the eviction candidate pool:
- If the room is already clean, it is evicted immediately from the in-memory [`RoomManager`](file:///home/pasc/cme/backend/include/cme/collab/room_manager.hpp) registry (`rooms_.erase(document_id)`).
- If the room has unpersisted edits, it is flushed to disk first before being evicted, guaranteeing **zero data loss**.

### Transparent Rehydration
When a collaborator connects to an evicted document over WebSocket (`/ws/collab/:document_id`):
1. The WebSocket connection handshake verifies permissions.
2. If `room_manager->get_room(id)` returns `nullptr`, the server transparently loads the document's content and path from `DocumentService` / POSIX storage.
3. The server constructs a new `DocumentRoom(doc_id, disk_content, fs_path)` in RAM and registers it with `RoomManager`.
4. The client receives the initial state vector (`SyncStep1`) and resumes collaborative editing with zero interruption.

---

## 5. Configuration Parameters

Persistence settings can be customized in [`PersistenceConfig`](file:///home/pasc/cme/backend/include/cme/collab/persistence_worker.hpp#L21-L30):

```cpp
struct PersistenceConfig {
    std::chrono::milliseconds idle_delay{5000};      // Inactivity window before flush (5s)
    std::chrono::milliseconds max_interval{300000};  // Maximum continuous edit interval (300s)
    std::chrono::milliseconds check_interval{200};   // Loop evaluation resolution (200ms)
    bool enable_snapshots{true};                     // Generate date-partitioned snapshots
    bool auto_evict_idle_rooms{true};                // Evict 0-peer rooms from RAM
};
```

---

## 6. Operational Health Probe Metrics

The persistence subsystem exposes live operational metrics through `GET /api/v1/health`:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 3600,
  "active_collab_rooms": 4,
  "persistence": {
    "status": "running",
    "total_flushes": 128,
    "total_snapshots": 128,
    "total_evictions": 42
  }
}
```

---

## 7. Verification & Automated Testing

The persistence subsystem is validated by [`tests/backend/persistence_debounced_test.cpp`](file:///home/pasc/cme/tests/backend/persistence_debounced_test.cpp) and [`tests/ws_edit_simulator.py`](file:///home/pasc/cme/tests/ws_edit_simulator.py):

* **Debounce Delay Verification**: Verifies disk contents remain untouched during active typing and persist only after `idle_delay`.
* **Snapshot Archival**: Confirms files are created in `snapshots/YYYY/MM/` matching disk contents.
* **RAM Eviction**: Confirms active room count in memory drops to 0 after peer disconnects.
* **Dirty Eviction Safeguard**: Verifies rooms with unpersisted edits flush to disk before RAM eviction.
* **WebSocket Simulation**: Uses `libyrs.so` FFI to transmit real binary CRDT deltas over WebSocket, verifying end-to-end keystroke persistence.
* **Transparent Rehydration**: Reconnects to an evicted room, injects additional keystrokes, and validates converged persistence.
