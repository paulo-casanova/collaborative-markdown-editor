#!/usr/bin/env bash
# ==============================================================================
# CME Automated Backup & Consistency Barrier Tool (Step 7.2)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_ID="cme_backup_${TIMESTAMP}"

# Default parameters
CONFIG_FILE="${CME_CONFIG_FILE:-/etc/cme/config.yaml}"
if [[ ! -f "$CONFIG_FILE" && -f "$SCRIPT_DIR/../config.yaml" ]]; then
    CONFIG_FILE="$SCRIPT_DIR/../config.yaml"
fi

API_URL="${CME_API_URL:-http://localhost:8080}"
ADMIN_USER="${CME_ADMIN_USER:-test_admin}"
ADMIN_TOKEN="${CME_ADMIN_TOKEN:-}"
STORAGE_DIR="${CME_STORAGE_ROOT_PATH:-/var/lib/cme/storage}"
BACKUP_DIR="${CME_BACKUP_DIR:-}"
DB_URL="${CME_DATABASE_URL:-postgresql://cme:secret@localhost:5432/cme_test}"
RETENTION_DAILY=7
RETENTION_WEEKLY=4

# Parse YAML config if available
if [[ -f "$CONFIG_FILE" ]]; then
    if grep -q "root_path:" "$CONFIG_FILE" 2>/dev/null; then
        VAL=$(grep "root_path:" "$CONFIG_FILE" | head -n 1 | awk '{print $2}' | tr -d '"'\''')
        [[ -n "$VAL" && -z "${CME_STORAGE_ROOT_PATH:-}" ]] && STORAGE_DIR="$VAL"
    fi
    if grep -q "target_dir:" "$CONFIG_FILE" 2>/dev/null; then
        VAL=$(grep "target_dir:" "$CONFIG_FILE" | head -n 1 | awk '{print $2}' | tr -d '"'\''')
        [[ -n "$VAL" && -z "${CME_BACKUP_DIR:-}" ]] && BACKUP_DIR="$VAL"
    fi
    if grep -q "retention_daily:" "$CONFIG_FILE" 2>/dev/null; then
        VAL=$(grep "retention_daily:" "$CONFIG_FILE" | head -n 1 | awk '{print $2}')
        [[ -n "$VAL" ]] && RETENTION_DAILY="$VAL"
    fi
    if grep -q "retention_weekly:" "$CONFIG_FILE" 2>/dev/null; then
        VAL=$(grep "retention_weekly:" "$CONFIG_FILE" | head -n 1 | awk '{print $2}')
        [[ -n "$VAL" ]] && RETENTION_WEEKLY="$VAL"
    fi
fi

if [[ -z "$BACKUP_DIR" ]]; then
    BACKUP_DIR="${STORAGE_DIR}/backups"
fi

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -u|--url)
            API_URL="$2"
            shift 2
            ;;
        -d|--data-dir)
            STORAGE_DIR="$2"
            shift 2
            ;;
        -t|--target-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        --user)
            ADMIN_USER="$2"
            shift 2
            ;;
        --token)
            ADMIN_TOKEN="$2"
            shift 2
            ;;
        --db-url)
            DB_URL="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  -c, --config FILE       Path to config.yaml"
            echo "  -u, --url URL           CME Server API URL (default: http://localhost:8080)"
            echo "  -d, --data-dir DIR      Storage content root path"
            echo "  -t, --target-dir DIR    Backup target destination directory"
            echo "  --user USERNAME         Admin username for barrier coordination (default: test_admin)"
            echo "  --token TOKEN           Admin Bearer token"
            echo "  --db-url URL            PostgreSQL connection URL"
            echo "  -h, --help              Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

echo "======================================================================"
echo "=== CME Automated Coordinated Backup Routine                       ==="
echo "======================================================================"
echo "[INFO] Timestamp          : ${TIMESTAMP}"
echo "[INFO] Backup Identifier  : ${BACKUP_ID}"
echo "[INFO] Storage Source     : ${STORAGE_DIR}"
echo "[INFO] Target Directory   : ${BACKUP_DIR}"
echo "[INFO] CME API Endpoint   : ${API_URL}"

mkdir -p "$BACKUP_DIR"
STAGE_DIR=$(mktemp -d "/tmp/${BACKUP_ID}.XXXXXX")
BARRIER_ACTIVE=false

build_auth_header() {
    if [[ -n "$ADMIN_TOKEN" ]]; then
        echo "Authorization: Bearer ${ADMIN_TOKEN}"
    else
        echo "X-Remote-User: ${ADMIN_USER}"
    fi
}

release_barrier() {
    if [[ "$BARRIER_ACTIVE" == "true" ]]; then
        echo "[INFO] Releasing backup coordination barrier..."
        local hdr
        hdr=$(build_auth_header)
        curl -s -f -X POST "${API_URL}/api/v1/admin/backup/release" \
            -H "$hdr" >/dev/null 2>&1 || true
        BARRIER_ACTIVE=false
        echo "[INFO] Coordination barrier released."
    fi
    rm -rf "$STAGE_DIR"
}

trap release_barrier EXIT

# Step 1: Request Coordination Barrier & Room Flush
echo "[STEP 1/6] Engaging backup coordination barrier on server..."
AUTH_HDR=$(build_auth_header)

PREPARE_RESP=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/admin/backup/prepare" \
    -H "$AUTH_HDR" || true)

HTTP_CODE=$(echo "$PREPARE_RESP" | tail -n 1)
BODY=$(echo "$PREPARE_RESP" | head -n -1)

if [[ "$HTTP_CODE" == "200" ]]; then
    BARRIER_ACTIVE=true
    FLUSHED=$(echo "$BODY" | grep -o '"rooms_flushed":[0-9]*' | cut -d':' -f2 || echo "0")
    echo "[INFO] Barrier engaged successfully. Flushed ${FLUSHED} dirty rooms to storage."
else
    echo "[WARN] Server returned HTTP ${HTTP_CODE} or was unreachable. Continuing with storage snapshot..."
fi

# Step 2: Dump PostgreSQL Database
echo "[STEP 2/6] Exporting PostgreSQL relational schema and metadata..."
DB_DUMP_FILE="$STAGE_DIR/database.dump"

run_pg_dump() {
    local db_user db_name
    db_user=$(echo "$DB_URL" | sed -E 's/.*:\/\/([^:]+).*/\1/')
    [[ -z "$db_user" || "$db_user" == "$DB_URL" ]] && db_user="cme"
    db_name=$(echo "$DB_URL" | sed -E 's/.*\///; s/\?.*//')
    [[ -z "$db_name" ]] && db_name="cme_test"

    if command -v pg_dump >/dev/null 2>&1; then
        pg_dump "$DB_URL" -Fc -f "$DB_DUMP_FILE"
    elif docker ps --format '{{.Names}}' | grep -q "^cme-postgres$"; then
        docker exec -i cme-postgres pg_dump -U "$db_user" -d "$db_name" -Fc > "$DB_DUMP_FILE"
    else
        echo "[ERROR] Unable to run pg_dump: neither host pg_dump nor docker cme-postgres found!" >&2
        return 1
    fi
}

run_pg_dump

if [[ ! -s "$DB_DUMP_FILE" ]]; then
    echo "[ERROR] PostgreSQL dump file is empty or missing!" >&2
    exit 1
fi
echo "[INFO] Database dump completed ($(du -h "$DB_DUMP_FILE" | cut -f1))."

# Step 3: Archive Storage Tree
echo "[STEP 3/6] Archiving POSIX document content tree..."
STORAGE_TAR="$STAGE_DIR/storage.tar.gz"

if [[ -d "$STORAGE_DIR/content" ]]; then
    tar -czf "$STORAGE_TAR" -C "$STORAGE_DIR" content
elif [[ -d "$STORAGE_DIR" ]]; then
    tar -czf "$STORAGE_TAR" -C "$STORAGE_DIR" .
else
    mkdir -p "$STAGE_DIR/empty_content"
    tar -czf "$STORAGE_TAR" -C "$STAGE_DIR/empty_content" .
fi
echo "[INFO] Storage archive completed ($(du -h "$STORAGE_TAR" | cut -f1))."

# Step 4: Release Coordination Barrier
echo "[STEP 4/6] Releasing coordination barrier..."
if [[ "$BARRIER_ACTIVE" == "true" ]]; then
    curl -s -f -X POST "${API_URL}/api/v1/admin/backup/release" \
        -H "$AUTH_HDR" >/dev/null 2>&1 || true
    BARRIER_ACTIVE=false
    echo "[INFO] Barrier released. Normal server writes resumed."
fi

# Step 5: Compute Cryptographic Checksums & Generate Manifest
echo "[STEP 5/6] Generating SHA-256 cryptographic manifest..."
DB_SHA256=$(sha256sum "$DB_DUMP_FILE" | awk '{print $1}')
DB_SIZE=$(stat -c%s "$DB_DUMP_FILE")

STORAGE_SHA256=$(sha256sum "$STORAGE_TAR" | awk '{print $1}')
STORAGE_SIZE=$(stat -c%s "$STORAGE_TAR")

MANIFEST_FILE="$STAGE_DIR/manifest.json"
cat > "$MANIFEST_FILE" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "${TIMESTAMP}",
  "cme_version": "0.1.0",
  "database": {
    "file": "database.dump",
    "format": "pg_dump_custom_v16",
    "sha256": "${DB_SHA256}",
    "size_bytes": ${DB_SIZE}
  },
  "storage": {
    "file": "storage.tar.gz",
    "format": "tar_gzip",
    "sha256": "${STORAGE_SHA256}",
    "size_bytes": ${STORAGE_SIZE}
  }
}
EOF

# Package into final monolithic bundle
FINAL_BUNDLE="${BACKUP_DIR}/${BACKUP_ID}.tar"
tar -cf "$FINAL_BUNDLE" -C "$STAGE_DIR" manifest.json database.dump storage.tar.gz
BUNDLE_SHA256=$(sha256sum "$FINAL_BUNDLE" | awk '{print $1}')
echo "$BUNDLE_SHA256  ${BACKUP_ID}.tar" > "${FINAL_BUNDLE}.sha256"

echo "[INFO] Archive generated: ${FINAL_BUNDLE} ($(du -h "$FINAL_BUNDLE" | cut -f1))"
echo "[INFO] Bundle SHA-256  : ${BUNDLE_SHA256}"

# Step 6: Retention Policy Rotation
echo "[STEP 6/6] Enforcing retention rotation policy (Daily: ${RETENTION_DAILY}, Weekly: ${RETENTION_WEEKLY})..."

# Keep latest RETENTION_DAILY files, delete older ones
mapfile -t ALL_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -name "cme_backup_*.tar" | sort -r)
TOTAL_COUNT=${#ALL_BACKUPS[@]}

if [[ $TOTAL_COUNT -gt $RETENTION_DAILY ]]; then
    for ((i=RETENTION_DAILY; i<TOTAL_COUNT; i++)); do
        OLD_FILE="${ALL_BACKUPS[$i]}"
        echo "  [PURGE] Rotating expired backup: ${OLD_FILE}"
        rm -f "$OLD_FILE" "${OLD_FILE}.sha256"
    done
fi

echo "======================================================================"
echo "=== Backup Completed Successfully                                  ==="
echo "======================================================================"
echo "Target Archive : ${FINAL_BUNDLE}"
echo "Manifest File  : manifest.json included inside bundle"
echo "Checksum File  : ${FINAL_BUNDLE}.sha256"
echo ""
