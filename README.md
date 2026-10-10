# Collaborative Markdown Editor (CME)

A web-based system providing a markdown browser and collaborative real-time editor with review threads, inline suggestions, task tracking, and fine-grained permissions.

## Architecture Highlights

- **Storage Engine:** POSIX filesystem tree (`content/`, `bundles/`, `snapshots/`, `trash/`, `backups/`) with Storage Abstraction Layer.
- **Relational Metadata:** PostgreSQL 16+ managing users, DAG team hierarchies (`team_parents`), ACLs, comments, suggestions, and tasks.
- **Backend:** Native multi-threaded C++23 daemon (`cme-server`) providing REST API, WebSocket real-time collaboration (`0x00`–`0x04` opcodes), and headless Yjs CRDT synchronization.
- **Frontend:** React 18+ and Vite single-page application with TipTap/ProseMirror editor, Table of Contents, Multi-Document TabBar & Split-View, and dedicated Documentation Reader View (`/docs/*`).

## Project Layout

```
├── backend/       # Native C++23 server daemon, REST API, WebSocket hub & storage layer
├── frontend/      # React 18+ & Vite web application
├── shared/        # Shared protocols, opcodes, error taxonomies
├── tests/         # Unit and integration test suites
└── CMakeLists.txt # Root CMake build configuration (C++23)
```

## Quick Start (Building & Testing)

### Prerequisites

- Modern C++23 compiler (`g++-14` or `g++-15`, `clang-18+`)
- CMake 3.28+
- Make or Ninja

### Building

```bash
# Configure debug build with tests enabled
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON

# Compile all targets
cmake --build build --parallel
```

### Running Tests

```bash
# Run tests via ctest
ctest --test-dir build --output-on-failure

# Or via the convenience target
cmake --build build --target check
```

### Running the Server

```bash
./build/bin/cme-server
```
