# Building and Deploying CME (Collaborative Markdown Editor)

This document provides a comprehensive operational guide for building, configuring, deploying, and maintaining the **Collaborative Markdown Editor (CME)** in production and development environments.

---

## 1. Architecture Overview

CME is architected as an enterprise-grade, low-latency, real-time collaborative editing platform engineered in C++20 and modern React/TypeScript.

```mermaid
flowchart TD
    subgraph Clients["Client Layer"]
        B["Browser (Vite + React 18)"]
        CM["CodeMirror 6 + Live Preview"]
        YJS_C["Yjs CRDT Client Engine"]
        B --- CM
        CM --- YJS_C
    end

    subgraph Gateway["Edge / Reverse Proxy (Optional)"]
        RP["Reverse Proxy (Caddy / Nginx / Cloudflare)"]
        SSO["SSO / OAuth2 / OIDC Auth Provider"]
        RP -.->|Delegated Auth| SSO
    end

    subgraph Server["CME Server Daemon (C++20)"]
        UWS["uWebSockets HTTP / WS Engine"]
        RM["Collab Room Manager"]
        PW["Persistence Worker (Debounced Auto-Save)"]
        PE["Permissions Engine (RBAC DAG)"]
        RS["Review & Text-Anchoring Service"]
        AG["AI Agent WebSocket Gateway"]
        UWS --- RM
        UWS --- PE
        UWS --- RS
        UWS --- AG
        RM --- PW
    end

    subgraph Storage["Persistence & Databases"]
        PG[("PostgreSQL 14+\nRBAC, Revisions, Leases, Dialogs")]
        FS[("POSIX Filesystem Storage\nMarkdown Content & Binary CRDT States")]
        MOUNT["Virtual Prefix Mounts\n(/jcsat, /cme, /specs)"]
        FS --- MOUNT
    end

    subgraph Agent["AI Agent Sidecar"]
        CME_A["cme-agent (Python CLI)"]
        LLM["LLMs (Claude, Gemini, Ollama)"]
        CME_A --- LLM
    end

    Clients ==>|HTTPS / WSS| RP
    RP ==>|X-Remote-User / WSS Upgrade| UWS
    Clients -.->|Direct Port 8080| UWS
    PW ==>|Atomic Writes & Snapshots| FS
    PE ==>|ACLS & Waterfall Queries| PG
    PW ==>|Revision History Insert| PG
    CME_A <==>|Agent WS Protocol| AG
```

### Core Subsystems
1. **Real-Time Collaborative Engine**: High-performance binary Yjs CRDT synchronization implemented over WebSocket via `uWebSockets`. Collaborative rooms operate in-memory with debounced disk persistence, preventing IO bottlenecks.
2. **Dual-Store Persistence**:
   - **POSIX Storage**: Markdown documents, bundle folders (`.bundle`), and binary CRDT states reside directly on the filesystem as standard `.md` files, ensuring interoperability with Git and external tools.
   - **PostgreSQL**: Stores user identities, hashed credentials, permissions DAG, audit logs, AI dialogs, and immutable document revision histories.
3. **Pluggable Mount System**: Virtual workspace prefixes (e.g., `cme/`, `jcsat/`) map dynamically to distinct physical directories on the host, enabling multi-repository editing.
4. **Autonomous Agent Gateway**: Real-time sidecar bridge enabling LLM agents (Claude Code, Google Gemini, Ollama, OpenAI) to perform live diffs, suggestions, and threaded discussions.

---

## 2. Prerequisites & Toolchain Requirements

### Operating System
* **Supported Platforms**: Linux (Ubuntu 22.04 LTS / 24.04 LTS, Debian 12+, Fedora 39+, RHEL 9+, Arch Linux).
* **Architecture**: x86_64, aarch64 (ARM64).

### Toolchain & Compilers
* **C++ Compiler**: GCC 13+ or Clang 16+ with full C++20 support (`std::span`, `std::expected`, concepts, ranges).
* **Build System**: CMake 3.22 or newer, and Ninja build system.
* **JavaScript Runtime**: Node.js 20.x LTS or 22.x LTS, and npm 10+.
* **Database**: PostgreSQL 14, 15, or 16.

### System Packages Installation

#### Ubuntu / Debian:
```bash
sudo apt update
sudo apt install -y \
    build-essential \
    cmake \
    ninja-build \
    git \
    pkg-config \
    libpqxx-dev \
    libpq-dev \
    libssl-dev \
    libgit2-dev \
    zlib1g-dev \
    curl
```

#### Fedora / RHEL 9:
```bash
sudo dnf install -y \
    gcc-c++ \
    cmake \
    ninja-build \
    git \
    pkgconfig \
    libpqxx-devel \
    libpq-devel \
    openssl-devel \
    libgit2-devel \
    zlib-devel \
    curl
```

---

## 3. Step-by-Step Build Instructions

### Step 3.1: Build the Frontend (Vite + React)
The frontend must be compiled before running CME in embedded mode.

```bash
cd /home/pasc/cme/frontend

# 1. Install NPM dependencies
npm install

# 2. Run frontend unit tests (Vitest)
npm run test:unit

# 3. Compile optimized production distribution
npm run build
```
The compiled static assets are generated in `frontend/dist/`.

### Step 3.2: Build the C++ Backend Daemon
From the repository root:

```bash
cd /home/pasc/cme

# 1. Generate Ninja build files with Release optimization
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release

# 2. Compile the CME server binary
ninja -C build cme-server

# 3. (Optional) Compile all test executables
ninja -C build
```
The compiled server executable is located at `build/bin/cme-server`.

### Step 3.3: Run Verification Test Suites
```bash
# Run backend CTest suite
ctest --test-dir build --output-on-failure

# Run frontend tests
npm --prefix frontend run test:unit
```

---

## 4. Database Setup & Migrations

CME uses PostgreSQL for relational data, access controls, and revision snapshots.

### Step 4.1: Create Database & User
```bash
sudo -u postgres psql -c "CREATE USER cme WITH PASSWORD 'secret';"
sudo -u postgres psql -c "CREATE DATABASE cme_test OWNER cme;"
sudo -u postgres psql -d cme_test -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

### Step 4.2: Apply Migrations
Execute the SQL migrations in order from the `migrations/` directory:

```bash
DB_URL="postgresql://cme:secret@localhost:5432/cme_test"

for file in $(ls -1 /home/pasc/cme/migrations/*.sql | sort); do
    echo "Applying migration: $file"
    psql "$DB_URL" -f "$file"
done
```

| Migration | Purpose |
| :--- | :--- |
| `001_core_schema.sql` | Users, sessions, documents, ACL permissions, audit logs |
| `002_team_schema.sql` | Teams and team memberships |
| `003_tasks_schema.sql` | Review tasks and assignees |
| `004_instance_lease.sql` | Distributed active-passive server lease coordination |
| `005_delegated_tokens.sql`| Personal Access Tokens (PATs) and delegated credentials |
| `006_reviews_and_anchors.sql` | Comments, suggestions, W3C text-position anchors |
| `007_ai_dialogs.sql` | AI agent conversation threads and document snapshots |
| `008_agent_presence.sql` | Agent registration, capabilities, and presence heartbeat |
| `009_agent_audit.sql` | Agent action audit trails and prompt tracking |
| `010_document_revisions.sql` | Document revision history and author attribution |

---

## 5. Configuration Reference (`config.yaml`)

CME is configured via YAML (`config.yaml`) with command-line flag override support.

```yaml
# ==============================================================================
# Collaborative Markdown Editor (CME) - Master Configuration
# ==============================================================================

server:
  bind: "0.0.0.0"               # Network interface binding
  port: 8080                    # Listening port
  reactor_threads: 2            # uWebSockets network event loop threads
  worker_threads: 8             # Thread pool for disk IO & database queries
  max_payload_bytes: 33554432   # 32 MB maximum HTTP/WebSocket payload size

storage:
  backend: "posix"              # Storage backend driver
  root_path: "/home/pasc/cme/storage_data" # Root POSIX storage directory
  trash_retention_days: 30      # Retention before permanent purge from trash
  snapshot_interval_seconds: 300 # Debounced filesystem snapshot interval
  mounts:
    - prefix: "jcsat"           # Virtual prefix accessed as 'jcsat/filename.md'
      path: "/home/pasc/jcsat/docs" # Physical directory on the host
    - prefix: "cme"             # Virtual prefix accessed as 'cme/filename.md'
      path: "/home/pasc/cme/docs"

database:
  url: "postgresql://cme:secret@localhost:5432/cme_test"
  pool_size: 8                  # Concurrent PostgreSQL connection pool size
  connect_timeout_seconds: 5    # Initial connection timeout
  lease_enabled: true           # Enable multi-node instance lease coordination
  lease_name: "cme_server"      # Global lease identifier in instance_lease table
  lease_ttl_seconds: 10         # Heartbeat lease duration before failover
  lease_renew_interval_seconds: 3 # Renewal interval for active leader
  lease_wait: true              # Standby instances wait indefinitely for leadership

authn:
  provider: "delegated"         # 'delegated' (SSO/reverse proxy) or 'challenge'
  delegated_header: "X-Remote-User"   # User identification header from reverse proxy
  delegated_email_header: "X-Remote-Email" # User email header from reverse proxy
  session_ttl_hours: 72         # Session lifetime

authz:
  admin_provider: "file"        # 'file' or 'command'
  admin_file_path: "/etc/cme/admins.txt" # List of admin usernames (one per line)
  admin_command: "/usr/local/bin/check_admin.sh %USER%"

ui:
  embedded: true                # Serve built React frontend directly from cme-server
  dist_dir: "/home/pasc/cme/frontend/dist" # Path to frontend/dist

backup:
  enabled: true
  cron_schedule: "0 2 * * *"    # Daily backup at 02:00
  script_path: "/usr/local/bin/cme-backup.sh"
  target_dir: "/var/lib/cme/storage/backups"
  retention_daily: 7
  retention_weekly: 4

logging:
  level: "info"                 # 'debug', 'info', 'warn', 'error'
  format: "json"                # 'json' or 'text'
```

### Command-Line Arguments
CLI flags take precedence over YAML configuration values:

```bash
build/bin/cme-server \
    --config config.yaml \
    --port 8080 \
    --bind 0.0.0.0 \
    --data-dir /home/pasc/cme/storage_data \
    --db-url postgresql://cme:secret@localhost:5432/cme_test \
    --embedded-ui /home/pasc/cme/frontend/dist
```

---

## 6. Deployment Scenarios

### Scenario A: Standalone Single-Host Deployment (Systemd)

Best for single servers, internal development workstations, or isolated team appliances. CME serves the embedded UI and APIs from a single binary managed by `systemd`.

#### 1. Create Dedicated Service User & Directories
```bash
sudo useradd -r -s /usr/sbin/nologin -d /var/lib/cme cme
sudo mkdir -p /var/lib/cme/storage /etc/cme /opt/cme/bin /opt/cme/ui
sudo chown -R cme:cme /var/lib/cme /etc/cme /opt/cme
```

#### 2. Install Binaries and Static Assets
```bash
sudo cp build/bin/cme-server /opt/cme/bin/
sudo cp -r frontend/dist/* /opt/cme/ui/
sudo cp config.yaml /etc/cme/config.yaml
```

#### 3. Systemd Unit File (`/etc/systemd/system/cme.service`)
```ini
[Unit]
Description=Collaborative Markdown Editor (CME) Daemon
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=cme
Group=cme
WorkingDirectory=/var/lib/cme
ExecStart=/opt/cme/bin/cme-server \
    --config /etc/cme/config.yaml \
    --data-dir /var/lib/cme/storage \
    --embedded-ui /opt/cme/ui \
    --port 8080
Restart=always
RestartSec=3s
LimitNOFILE=65536

# Hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

#### 4. Enable and Start Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cme.service
sudo systemctl status cme.service
```

---

### Scenario B: Enterprise Reverse Proxy with Delegated SSO Auth

In enterprise environments, CME operates behind an authenticating reverse proxy (Caddy, Nginx, Authelia, Cloudflare Access, or Pomerium) that handles TLS termination, OIDC/SAML authentication, and forwards user identities.

```mermaid
sequenceDiagram
    participant User as Web Browser
    participant Proxy as Caddy / Nginx (SSO Proxy)
    participant CME as CME Server (Port 8080)
    participant DB as PostgreSQL

    User->>Proxy: GET / (Session Cookie)
    Proxy->>Proxy: Authenticate OIDC / SAML Session
    Proxy->>CME: GET / with X-Remote-User: alice, X-Remote-Email: alice@org.com
    CME->>DB: Query or JIT-provision user 'alice'
    CME-->>Proxy: 200 OK (Render CME UI)
    Proxy-->>User: 200 OK (Rendered Application)

    User->>Proxy: WebSocket /ws/collab/:id
    Proxy->>CME: Upgrade WebSocket (Forwarding X-Remote-User)
    CME-->>User: Binary CRDT Sync Stream
```

#### Caddy Configuration (`Caddyfile`):
```caddy
cme.yourdomain.com {
    encode gzip zstd

    # Optional: Forward auth / SSO middleware (e.g. Authelia, Pomerium)
    # forward_auth authelia:9091 {
    #     uri /api/verify?rd=https://auth.yourdomain.com
    #     copy_headers Remote-User Remote-Email
    # }

    # Reverse proxy to CME backend
    reverse_proxy 127.0.0.1:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}

        # Pass authenticated user identity headers
        header_up X-Remote-User {header.Remote-User}
        header_up X-Remote-Email {header.Remote-Email}
    }
}
```

#### Nginx Configuration:
```nginx
server {
    listen 443 ssl http2;
    server_name cme.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/cme.crt;
    ssl_certificate_key /etc/ssl/private/cme.key;

    client_max_body_size 32M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket connection upgrades
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Delegated identity headers (from OAuth2 proxy / Authelia)
        proxy_set_header X-Remote-User $remote_user;
        proxy_set_header X-Remote-Email $remote_user_email;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

### Scenario C: Containerized Deployment (Docker Compose)

Deploy CME alongside PostgreSQL using Docker Compose.

#### `docker-compose.yml`:
```yaml
version: '3.8'

services:
  cme-postgres:
    image: postgres:16-alpine
    container_name: cme-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: cme_prod
      POSTGRES_USER: cme
      POSTGRES_PASSWORD: cme_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cme -d cme_prod"]
      interval: 5s
      timeout: 5s
      retries: 5

  cme-server:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: cme-server
    restart: unless-stopped
    depends_on:
      cme-postgres:
        condition: service_healthy
    ports:
      - "8080:8080"
    volumes:
      - cme_storage:/var/lib/cme/storage
      - ./config.yaml:/etc/cme/config.yaml:ro
    environment:
      - CME_DB_URL=postgresql://cme:cme_secure_password@cme-postgres:5432/cme_prod
    command: >
      /opt/cme/bin/cme-server
      --config /etc/cme/config.yaml
      --db-url postgresql://cme:cme_secure_password@cme-postgres:5432/cme_prod
      --data-dir /var/lib/cme/storage
      --embedded-ui /opt/cme/ui
      --port 8080

volumes:
  postgres_data:
  cme_storage:
```

---

### Scenario D: High Availability (HA) Multi-Node Deployment

CME includes native distributed lease coordination through PostgreSQL (`instance_lease` table).

```mermaid
flowchart LR
    LB["Load Balancer / Reverse Proxy"]

    subgraph Node1["Server Node 1 (Active Leader)"]
        S1["cme-server #1\n(Holds 'cme_server' Lease)"]
        W1["Collab Rooms & Persistence Worker Active"]
    end

    subgraph Node2["Server Node 2 (Warm Standby)"]
        S2["cme-server #2\n(Waiting on Lease Renewal)"]
        W2["Standby Mode"]
    end

    SharedFS[("Shared Distributed Filesystem\n(NFSv4 / CephFS / AWS EFS)")]
    SharedDB[("PostgreSQL Cluster\n(Primary / Replica)")]

    LB --> S1
    LB -.-> S2
    S1 === SharedFS
    S2 === SharedFS
    S1 === SharedDB
    S2 === SharedDB
```

#### Operating Characteristics:
1. **Shared POSIX Storage**: Mount the same NFSv4, CephFS, or GlusterFS share to `--data-dir` on both nodes.
2. **Instance Lease**:
   - Both nodes start with `--config config.yaml` with `database.lease_enabled: true`.
   - Node 1 acquires the lease `cme_server` and binds to the active collaborative rooms.
   - Node 2 attempts acquisition, recognizes the active lease holder, and enters a non-blocking standby evaluation loop.
3. **Failover**: If Node 1 crashes or ceases renewing the lease within `lease_ttl_seconds` (default: 10s), Node 2 automatically assumes leadership, recovers collaborative state, and flushes persistent rooms without data loss.

---

### Scenario E: AI Agent Sidecar (`cme-agent`)

The `cme-agent` Python CLI connects as an autonomous collaborative peer over WebSocket and REST APIs, offering AI document completions, inline suggestions, and review feedback.

#### 1. Setup Virtual Environment & Install Requirements
```bash
cd /home/pasc/cme/cme-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

#### 2. Authenticating the Agent
Generate a Personal Access Token (`PAT`) from the CME UI or issue a delegated authorization header.

#### 3. Run the Agent Companion
```bash
# Example: Pairing cme-agent with local Ollama
cme-agent \
    --server http://localhost:8080 \
    --token "cme_pat_your_token_here" \
    --provider ollama \
    --model llama3:latest

# Example: Pairing cme-agent with Claude CLI (with dynamic header command)
cme-agent \
    --server http://localhost:8080 \
    --provider claude \
    --header-cmd "/usr/local/bin/get_vault_token.sh"
```

---

## 7. Operations, Backups & Maintenance

### Step 7.1: Health & Readiness Probes
The server exposes an unauthenticated health probe at `GET /api/v1/health`:

```bash
curl -s http://localhost:8080/api/v1/health | jq .
```

```json
{
  "active_collab_rooms": 2,
  "backup_barrier_active": false,
  "database": {
    "latency_ms": 0.42,
    "status": "connected"
  },
  "instance_lease": {
    "held": true,
    "holder_id": "ProArt-Kubuntu:25781:e65aaf19639a38eb",
    "lease_name": "cme_server"
  },
  "persistence": {
    "dirty_rooms_failed_flush": [],
    "status": "running",
    "total_evictions": 14,
    "total_flushes": 89,
    "total_snapshots": 12
  },
  "status": "healthy",
  "storage": {
    "backend": "posix",
    "free_bytes": 396855398400,
    "status": "writable",
    "total_bytes": 657720651776
  },
  "uptime_seconds": 3600,
  "version": "0.1.0"
}
```

### Step 7.2: Backups and Disaster Recovery
A valid CME backup requires two synchronized components:
1. **PostgreSQL Database Dump** (`pg_dump`).
2. **Storage Directory Mirror** (`storage_data/`).

#### Safe Hot Backup Procedure (`cme-backup.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/var/backups/cme"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET="${BACKUP_ROOT}/${TIMESTAMP}"
mkdir -p "$TARGET"

echo "[1/3] Activating backup barrier..."
# Flushes active rooms and queues writes during backup snapshot
curl -s -X POST http://localhost:8080/api/v1/admin/backup/barrier/start \
    -H "Authorization: Bearer $CME_ADMIN_TOKEN"

echo "[2/3] Exporting PostgreSQL database..."
pg_dump "postgresql://cme:secret@localhost:5432/cme_test" | gzip > "${TARGET}/database.sql.gz"

echo "[3/3] Archiving storage directory..."
rsync -a --delete /home/pasc/cme/storage_data/ "${TARGET}/storage/"

echo "Releasing backup barrier..."
curl -s -X POST http://localhost:8080/api/v1/admin/backup/barrier/end \
    -H "Authorization: Bearer $CME_ADMIN_TOKEN"

echo "Backup complete: ${TARGET}"
```

---

## 8. Troubleshooting FAQ

### 1. "Session expired - reconnecting..." or Red Banner on Startup
* **Cause**: Session token in browser localStorage has expired or reverse proxy is rejecting requests with `401 Unauthorized`.
* **Fix**: Click the **Sign In** button on the red banner to open the credentials dialog, or refresh your SSO identity provider session.

### 2. "Cannot acquire instance lease 'cme_server'"
* **Cause**: Another `cme-server` instance holds the leadership lease in PostgreSQL, or an unclean shutdown occurred within the last 10 seconds.
* **Fix**: Wait 10 seconds for the lease TTL to expire, or inspect and clear the stale row:
  ```sql
  SELECT * FROM instance_lease;
  DELETE FROM instance_lease WHERE lease_name = 'cme_server';
  ```

### 3. Document edits show "Comment-Only" or "Read-Only"
* **Cause**: User's effective permission on the document or parent directory is `COMMENT` or `READ`.
* **Fix**: A document owner or administrator can adjust access levels from the **Access Control (Permissions)** dialog or via `POST /api/v1/permissions`.

### 4. WebSocket Fails to Connect Behind Nginx / Caddy
* **Cause**: Missing HTTP/1.1 or Connection Upgrade headers in reverse proxy.
* **Fix**: Ensure proxy configuration forwards `Upgrade $http_upgrade` and `Connection "upgrade"`.
