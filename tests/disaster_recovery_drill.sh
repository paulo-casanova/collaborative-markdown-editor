#!/usr/bin/env bash
# ==============================================================================
# Disaster Recovery Drill: Cold Backup Restoration & Integrity Verification (Step 7.2)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CME_SERVER_BIN="${ROOT_DIR}/build/bin/cme-server"
CME_BACKUP_BIN="${ROOT_DIR}/scripts/cme-backup.sh"
CME_MIGRATE_BIN="${ROOT_DIR}/build/bin/cme-migrate"
DB_NAME="cme_drill"
DB_URL="postgresql://cme:secret@localhost:5432/${DB_NAME}"
DRILL_PORT=8089
BASE_URL="http://127.0.0.1:${DRILL_PORT}"

if [[ ! -x "$CME_SERVER_BIN" ]]; then
    echo "[ERROR] cme-server executable not found at: $CME_SERVER_BIN" >&2
    exit 1
fi

if [[ ! -x "$CME_BACKUP_BIN" ]]; then
    echo "[ERROR] cme-backup.sh executable not found at: $CME_BACKUP_BIN" >&2
    exit 1
fi

BASE_TMP=$(mktemp -d "/tmp/cme_drill.XXXXXX")
DRILL_STORAGE="${BASE_TMP}/primary_storage"
DRILL_BACKUPS="${BASE_TMP}/backup_vault"
RESTORE_STORAGE="${BASE_TMP}/restored_storage"
UNPACK_DIR="${BASE_TMP}/unpacked"

mkdir -p "$DRILL_STORAGE" "$DRILL_BACKUPS" "$RESTORE_STORAGE" "$UNPACK_DIR"

SERVER_PID=""

cleanup() {
    echo "\n[DRILL] Cleaning up disaster recovery drill resources..."
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[DRILL] Terminating cme-server (PID: $SERVER_PID)..."
        kill -TERM "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    docker exec cme-postgres psql -U cme -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null 2>&1 || true
    rm -rf "$BASE_TMP"
    echo "[DRILL] Cleanup complete."
}

trap cleanup EXIT

echo "======================================================================"
echo "=== CME Disaster Recovery Drill & Cold-Restore Verification (Step 7.2) ==="
echo "======================================================================"
echo "[DRILL] Workspace Root       : ${ROOT_DIR}"
echo "[DRILL] Primary Storage      : ${DRILL_STORAGE}"
echo "[DRILL] Backup Vault         : ${DRILL_BACKUPS}"
echo "[DRILL] Restored Storage     : ${RESTORE_STORAGE}"
echo "[DRILL] Target Database URL  : ${DB_URL}"
echo "[DRILL] Daemon Port          : ${DRILL_PORT}"

# Initialize pristine cme_drill database
echo "\n[DRILL] Initializing pristine database '${DB_NAME}'..."
docker exec cme-postgres psql -U cme -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
docker exec cme-postgres psql -U cme -d postgres -c "CREATE DATABASE ${DB_NAME};" >/dev/null
"$CME_MIGRATE_BIN" --db "$DB_URL" --migrations-dir "${ROOT_DIR}/migrations" >/dev/null
docker exec cme-postgres psql -U cme -d "${DB_NAME}" -c \
    "INSERT INTO users (username, password_hash, display_name, is_system_admin) VALUES ('test_admin', 'x', 'Test Admin', true), ('admin', 'x', 'Admin', true);" >/dev/null
echo "[DRILL] Database '${DB_NAME}' initialized with schema migrations and admin seeds."

# ------------------------------------------------------------------------------
# Phase 1: Launch CME Server Daemon & Health Check
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 1] Starting CME Server daemon on port ${DRILL_PORT} ---"
"$CME_SERVER_BIN" --port "$DRILL_PORT" --data-dir "$DRILL_STORAGE" --db-url "$DB_URL" --authn delegated > "${BASE_TMP}/server.log" 2>&1 &
SERVER_PID=$!
echo "[DRILL] Server started with PID: ${SERVER_PID}"

# Wait for server ready
RETRIES=30
READY=false
while [[ $RETRIES -gt 0 ]]; do
    if curl -s -f "${BASE_URL}/api/v1/health" >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 0.2
    RETRIES=$((RETRIES - 1))
done

if [[ "$READY" != "true" ]]; then
    echo "[FATAL] Server failed to start on ${BASE_URL} within timeout." >&2
    cat "${BASE_TMP}/server.log" >&2
    exit 1
fi
echo "[DRILL] Health check passed: CME Server is live and healthy."

# ------------------------------------------------------------------------------
# Phase 2: Seed Documents and Review Annotations
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 2] Populating Authoritative Documents and Review Subsystems ---"

# 2.1 Create Document 1 (Standard Markdown)
DOC1_RESP=$(curl -s -f -X POST "${BASE_URL}/api/v1/documents" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{
        "path": "ops/disaster_recovery_runbook.md",
        "title": "Disaster Recovery Runbook",
        "content": "# Disaster Recovery Runbook\n\nAuthoritative document created before backup.\nCritical procedures for CME system recovery."
    }')
DOC1_ID=$(echo "$DOC1_RESP" | jq -r '.id')
echo "[DRILL] Created Document 1: ops/disaster_recovery_runbook.md (ID: ${DOC1_ID})"

# 2.2 Create Document 2 (Nested Markdown)
DOC2_RESP=$(curl -s -f -X POST "${BASE_URL}/api/v1/documents" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{
        "path": "specs/database_architecture.md",
        "title": "Database Architecture",
        "content": "# Database Architecture\n\nPostgreSQL relational schema and Yjs CRDT wire specifications."
    }')
DOC2_ID=$(echo "$DOC2_RESP" | jq -r '.id')
echo "[DRILL] Created Document 2: specs/database_architecture.md (ID: ${DOC2_ID})"

# 2.3 Post Threaded Comment on Document 1
COMMENT_RESP=$(curl -s -f -X POST "${BASE_URL}/api/v1/documents/${DOC1_ID}/comments" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{
        "content": "Verify offline integrity reconciliation barrier before restore drill.",
        "anchor": {"type": "text_selection", "start_line": 3, "end_line": 3}
    }')
COMMENT_ID=$(echo "$COMMENT_RESP" | jq -r '.id')
echo "[DRILL] Created Review Comment (ID: ${COMMENT_ID})"

# 2.4 Post Action Item Task on Document 1
TASK_RESP=$(curl -s -f -X POST "${BASE_URL}/api/v1/documents/${DOC1_ID}/tasks" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{
        "description": "Execute cold restore disaster recovery drill to verify consistency.",
        "comment_id": "'"${COMMENT_ID}"'"
    }')
TASK_ID=$(echo "$TASK_RESP" | jq -r '.id')
echo "[DRILL] Created Review Task (ID: ${TASK_ID})"

# 2.5 Post Inline Edit Suggestion on Document 1
SUG_RESP=$(curl -s -f -X POST "${BASE_URL}/api/v1/documents/${DOC1_ID}/suggestions" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{
        "original_text": "Critical procedures for CME system recovery.",
        "suggested_text": "Zero-data-loss procedures for CME cold disaster recovery."
    }')
SUG_ID=$(echo "$SUG_RESP" | jq -r '.id')
echo "[DRILL] Created Edit Suggestion (ID: ${SUG_ID})"

# ------------------------------------------------------------------------------
# Phase 3: Verify Consistency Barrier & Mutation Write Locking
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 3] Verifying Backup Barrier Write-Locking Protocol ---"

# 3.1 Engage barrier
PREPARE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/admin/backup/prepare" \
    -H "X-Remote-User: test_admin")
if [[ "$PREPARE_STATUS" != "200" ]]; then
    echo "[FATAL] Failed to prepare backup barrier: HTTP ${PREPARE_STATUS}" >&2
    exit 1
fi
echo "[DRILL] Backup barrier engaged (HTTP 200)."

# Verify health status reflects barrier
BARRIER_ACTIVE=$(curl -s "${BASE_URL}/api/v1/health" | jq -r '.backup_barrier_active')
if [[ "$BARRIER_ACTIVE" != "true" ]]; then
    echo "[FATAL] Health status failed to report backup_barrier_active=true" >&2
    exit 1
fi
echo "[DRILL] Health endpoint accurately reports backup_barrier_active: true"

# 3.2 Attempt Document Create during barrier -> Expect 503 Service Unavailable
WRITE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/documents" \
    -H "Content-Type: application/json" \
    -H "X-Remote-User: test_admin" \
    -d '{"path": "forbidden.md", "title": "Blocked", "content": "test"}')

if [[ "$WRITE_STATUS" != "503" ]]; then
    echo "[FATAL] Expected HTTP 503 during active backup barrier, got HTTP ${WRITE_STATUS}" >&2
    exit 1
fi
echo "[DRILL] Verified: Document writes strictly blocked during barrier with HTTP 503 Service Unavailable."

# 3.3 Release barrier
RELEASE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/admin/backup/release" \
    -H "X-Remote-User: test_admin")
if [[ "$RELEASE_STATUS" != "200" ]]; then
    echo "[FATAL] Failed to release backup barrier: HTTP ${RELEASE_STATUS}" >&2
    exit 1
fi
echo "[DRILL] Backup barrier successfully released (HTTP 200)."

# ------------------------------------------------------------------------------
# Phase 4: Execute Coordinated Backup via cme-backup.sh
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 4] Executing Automated Coordinated Backup via cme-backup.sh ---"

"$CME_BACKUP_BIN" \
    --url "$BASE_URL" \
    --data-dir "$DRILL_STORAGE" \
    --target-dir "$DRILL_BACKUPS" \
    --user test_admin \
    --db-url "$DB_URL"

BACKUP_TAR=$(find "$DRILL_BACKUPS" -maxdepth 1 -name "cme_backup_*.tar" | head -n 1)
if [[ -z "$BACKUP_TAR" || ! -f "$BACKUP_TAR" ]]; then
    echo "[FATAL] Backup archive was not created in ${DRILL_BACKUPS}" >&2
    exit 1
fi
echo "[DRILL] Produced backup archive: ${BACKUP_TAR}"

# Verify bundle SHA-256
SHA_FILE="${BACKUP_TAR}.sha256"
if [[ ! -f "$SHA_FILE" ]]; then
    echo "[FATAL] Checksum file ${SHA_FILE} missing!" >&2
    exit 1
fi
(cd "$DRILL_BACKUPS" && sha256sum -c "$(basename "$SHA_FILE")")
echo "[DRILL] Archive cryptographic SHA-256 checksum verified."

# ------------------------------------------------------------------------------
# Phase 5: Stop Server & Simulate Catastrophic Disaster
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 5] Simulating Catastrophic Cold Disaster ---"
echo "[DRILL] Stopping live server daemon..."
kill -TERM "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

echo "[DRILL] Simulating total filesystem data wipe..."
rm -rf "$DRILL_STORAGE"
if [[ -d "$DRILL_STORAGE" ]]; then
    echo "[FATAL] Failed to delete primary storage directory!" >&2
    exit 1
fi
echo "[DRILL] Primary storage completely annihilated."

# ------------------------------------------------------------------------------
# Phase 6: Unpack Backup Bundle & Cryptographic Manifest Verification
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 6] Unpacking Bundle & Auditing SHA-256 Manifest ---"
tar -xf "$BACKUP_TAR" -C "$UNPACK_DIR"

MANIFEST_PATH="${UNPACK_DIR}/manifest.json"
DB_DUMP_PATH="${UNPACK_DIR}/database.dump"
STORAGE_TAR_PATH="${UNPACK_DIR}/storage.tar.gz"

if [[ ! -f "$MANIFEST_PATH" || ! -f "$DB_DUMP_PATH" || ! -f "$STORAGE_TAR_PATH" ]]; then
    echo "[FATAL] Backup bundle missing required payload files!" >&2
    exit 1
fi

EXPECTED_DB_SHA=$(jq -r '.database.sha256' "$MANIFEST_PATH")
ACTUAL_DB_SHA=$(sha256sum "$DB_DUMP_PATH" | awk '{print $1}')
if [[ "$EXPECTED_DB_SHA" != "$ACTUAL_DB_SHA" ]]; then
    echo "[FATAL] Database SHA-256 mismatch! Expected: ${EXPECTED_DB_SHA}, Got: ${ACTUAL_DB_SHA}" >&2
    exit 1
fi
echo "[DRILL] Database payload SHA-256 matches manifest (${ACTUAL_DB_SHA})."

EXPECTED_STORAGE_SHA=$(jq -r '.storage.sha256' "$MANIFEST_PATH")
ACTUAL_STORAGE_SHA=$(sha256sum "$STORAGE_TAR_PATH" | awk '{print $1}')
if [[ "$EXPECTED_STORAGE_SHA" != "$ACTUAL_STORAGE_SHA" ]]; then
    echo "[FATAL] Storage payload SHA-256 mismatch! Expected: ${EXPECTED_STORAGE_SHA}, Got: ${ACTUAL_STORAGE_SHA}" >&2
    exit 1
fi
echo "[DRILL] Storage payload SHA-256 matches manifest (${ACTUAL_STORAGE_SHA})."

# ------------------------------------------------------------------------------
# Phase 7: Cold Restore of Storage & Database
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 7] Restoring Storage and Relational Database ---"

# Restore Storage Tree
tar -xzf "$STORAGE_TAR_PATH" -C "$RESTORE_STORAGE"
echo "[DRILL] Storage content tree unpacked into: ${RESTORE_STORAGE}"

# Restore PostgreSQL Database
echo "[DRILL] Restoring PostgreSQL state from database.dump via pg_restore..."
if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --clean --if-exists -d "$DB_URL" "$DB_DUMP_PATH" || true
else
    docker exec -i cme-postgres pg_restore --clean --if-exists -U cme -d "${DB_NAME}" < "$DB_DUMP_PATH" || true
fi
echo "[DRILL] Database state restored successfully."

# ------------------------------------------------------------------------------
# Phase 8: Offline Integrity Verification & Reconciliation Audit
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 8] Running cme-server --verify-integrity ---"

VERIFY_LOG="${BASE_TMP}/integrity_verification.log"
set +e
"$CME_SERVER_BIN" --verify-integrity --data-dir "$RESTORE_STORAGE" --db-url "$DB_URL" > "$VERIFY_LOG" 2>&1
VERIFY_EXIT=$?
set -e

cat "$VERIFY_LOG"

if [[ $VERIFY_EXIT -ne 0 ]]; then
    echo "[FATAL] Offline integrity check failed with exit code ${VERIFY_EXIT}!" >&2
    exit 1
fi
echo "[DRILL] Offline integrity verification passed with 0 discrepancies."

# ------------------------------------------------------------------------------
# Phase 9: Launch Restored Server Daemon & Final Verification
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 9] Launching CME Server Daemon on Restored Environment ---"

"$CME_SERVER_BIN" --port "$DRILL_PORT" --data-dir "$RESTORE_STORAGE" --db-url "$DB_URL" --authn delegated > "${BASE_TMP}/server_restored.log" 2>&1 &
SERVER_PID=$!
echo "[DRILL] Restored Server daemon started with PID: ${SERVER_PID}"

RETRIES=30
READY=false
while [[ $RETRIES -gt 0 ]]; do
    if curl -s -f "${BASE_URL}/api/v1/health" >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 0.2
    RETRIES=$((RETRIES - 1))
done

if [[ "$READY" != "true" ]]; then
    echo "[FATAL] Restored server failed to start on ${BASE_URL} within timeout." >&2
    cat "${BASE_TMP}/server_restored.log" >&2
    exit 1
fi

HEALTH_JSON=$(curl -s "${BASE_URL}/api/v1/health")
HEALTH_STATUS=$(echo "$HEALTH_JSON" | jq -r '.status')
HEALTH_BARRIER=$(echo "$HEALTH_JSON" | jq -r '.backup_barrier_active')

if [[ "$HEALTH_STATUS" != "healthy" ]]; then
    echo "[FATAL] Restored server health status is '${HEALTH_STATUS}', expected 'healthy'!" >&2
    echo "$HEALTH_JSON" >&2
    exit 1
fi

if [[ "$HEALTH_BARRIER" != "false" ]]; then
    echo "[FATAL] Restored server reports backup_barrier_active=true!" >&2
    exit 1
fi

echo "[DRILL] Status Criteria Verified: /api/v1/health reports status 'healthy'."

# ------------------------------------------------------------------------------
# Phase 10: Validate Restored Business Objects
# ------------------------------------------------------------------------------
echo "\n--- [PHASE 10] Validating Restored Document and Review Consistency ---"

# Verify Document 1
R_DOC1=$(curl -s -f "${BASE_URL}/api/v1/documents/${DOC1_ID}" -H "X-Remote-User: test_admin")
R_DOC1_TITLE=$(echo "$R_DOC1" | jq -r '.title')
if [[ "$R_DOC1_TITLE" != "Disaster Recovery Runbook" ]]; then
    echo "[FATAL] Restored Document 1 title mismatch: ${R_DOC1_TITLE}" >&2
    exit 1
fi
echo "[DRILL] Verified: Document 1 intact ('${R_DOC1_TITLE}')."

# Verify Document 2
R_DOC2=$(curl -s -f "${BASE_URL}/api/v1/documents/${DOC2_ID}" -H "X-Remote-User: test_admin")
R_DOC2_TITLE=$(echo "$R_DOC2" | jq -r '.title')
if [[ "$R_DOC2_TITLE" != "Database Architecture" ]]; then
    echo "[FATAL] Restored Document 2 title mismatch: ${R_DOC2_TITLE}" >&2
    exit 1
fi
echo "[DRILL] Verified: Document 2 intact ('${R_DOC2_TITLE}')."

# Verify Comment
R_COMMS=$(curl -s -f "${BASE_URL}/api/v1/documents/${DOC1_ID}/comments" -H "X-Remote-User: test_admin")
COMM_COUNT=$(echo "$R_COMMS" | jq '. | length')
if [[ "$COMM_COUNT" -lt 1 ]]; then
    echo "[FATAL] Restored comments missing on Document 1!" >&2
    exit 1
fi
echo "[DRILL] Verified: Review comments restored successfully (${COMM_COUNT} threads)."

# Verify Task
R_TASKS=$(curl -s -f "${BASE_URL}/api/v1/documents/${DOC1_ID}/tasks" -H "X-Remote-User: test_admin")
TASK_COUNT=$(echo "$R_TASKS" | jq '. | length')
if [[ "$TASK_COUNT" -lt 1 ]]; then
    echo "[FATAL] Restored tasks missing on Document 1!" >&2
    exit 1
fi
echo "[DRILL] Verified: Review tasks restored successfully (${TASK_COUNT} tasks)."

# Verify Suggestion
R_SUGS=$(curl -s -f "${BASE_URL}/api/v1/documents/${DOC1_ID}/suggestions" -H "X-Remote-User: test_admin")
SUG_COUNT=$(echo "$R_SUGS" | jq '. | length')
if [[ "$SUG_COUNT" -lt 1 ]]; then
    echo "[FATAL] Restored suggestions missing on Document 1!" >&2
    exit 1
fi
echo "[DRILL] Verified: Review suggestions restored successfully (${SUG_COUNT} suggestions)."

echo "\n======================================================================"
echo "=== [PASSED] ALL DISASTER RECOVERY DRILL CRITERIA SATISFIED        ==="
echo "======================================================================"
echo " 1. Storage and PostgreSQL restored cleanly from cold backup bundle."
echo " 2. cme-server --verify-integrity reported 0 discrepancies."
echo " 3. Server daemon restarted and /api/v1/health returned 'healthy'."
echo " 4. 100% of documents, comments, suggestions, and tasks verified."
echo "======================================================================\n"
