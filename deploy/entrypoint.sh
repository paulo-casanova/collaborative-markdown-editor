#!/bin/bash
set -e

echo "=== Collaborative Markdown Editor (CME) Container Entrypoint ==="

# Wait for PostgreSQL to become reachable if CME_DATABASE_URL is defined
if [ -n "$CME_DATABASE_URL" ]; then
    echo "[ENTRYPOINT] Checking database connection..."
    RETRIES=30
    until cme-migrate --db "$CME_DATABASE_URL" --migrations-dir "${CME_MIGRATIONS_DIR:-/var/lib/cme/migrations}" || [ $RETRIES -le 0 ]; do
        echo "[ENTRYPOINT] Waiting for database at $CME_DATABASE_URL... ($RETRIES attempts left)"
        RETRIES=$((RETRIES - 1))
        sleep 1
    done

    if [ $RETRIES -le 0 ]; then
        echo "[FATAL] Failed to connect to database or apply migrations after 30 attempts."
        exit 1
    fi
    echo "[ENTRYPOINT] Database migrations successfully applied."
fi

# Ensure storage directories exist
mkdir -p "${CME_STORAGE_ROOT_PATH:-/var/lib/cme/storage}"
mkdir -p "${CME_STORAGE_ROOT_PATH:-/var/lib/cme/storage}/backups"

# Launch CMD
if [ "$1" = "cme-server" ] || [ -z "$1" ]; then
    shift 2>/dev/null || true
    echo "[ENTRYPOINT] Starting cme-server daemon..."
    exec cme-server --config "${CME_CONFIG_FILE:-/etc/cme/config.yaml}" --embedded-ui "${CME_UI_DIST_DIR:-/var/lib/cme/frontend/dist}" "$@"
else
    exec "$@"
fi
