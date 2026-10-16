#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONTAINER_NAME="${CME_PG_CONTAINER:-cme-postgres}"
PG_PORT="${CME_PG_PORT:-5432}"
PG_USER="${CME_PG_USER:-cme}"
PG_PASSWORD="${CME_PG_PASSWORD:-secret}"
PG_DB="${CME_PG_DB:-cme_test}"

DB_URL="${CME_DATABASE_URL:-postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}}"
DATA_DIR="${CME_STORAGE_ROOT_PATH:-${SCRIPT_DIR}/storage_data}"
UI_DIR="${CME_UI_DIST_DIR:-${SCRIPT_DIR}/frontend/dist}"
PORT="${CME_SERVER_PORT:-8080}"

SERVER_PID=""
CLEANED_UP=0

cleanup() {
  if [[ "${CLEANED_UP}" -eq 1 ]]; then
    return
  fi
  CLEANED_UP=1

  echo ""
  echo "[run.sh] Shutting down..."

  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[run.sh] Stopping cme-server (PID ${SERVER_PID})..."
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi

  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    echo "[run.sh] Stopping Docker container '${CONTAINER_NAME}'..."
    docker stop "${CONTAINER_NAME}" >/dev/null || true
  fi

  echo "[run.sh] Shutdown complete."
}

trap cleanup EXIT INT TERM

echo "[run.sh] Checking PostgreSQL status on localhost:${PG_PORT}..."
if ! pg_isready -h localhost -p "${PG_PORT}" -U "${PG_USER}" >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    echo "[run.sh] Starting existing Docker container '${CONTAINER_NAME}'..."
    docker start "${CONTAINER_NAME}" >/dev/null
  else
    echo "[run.sh] Creating and starting Docker container '${CONTAINER_NAME}'..."
    docker run -d \
      --name "${CONTAINER_NAME}" \
      -e POSTGRES_USER="${PG_USER}" \
      -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
      -e POSTGRES_DB="${PG_DB}" \
      -p "${PG_PORT}:5432" \
      postgres:16-alpine >/dev/null
  fi

  echo "[run.sh] Waiting for PostgreSQL to become ready..."
  for i in {1..30}; do
    if pg_isready -h localhost -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1; then
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      echo "[run.sh] ERROR: PostgreSQL did not become ready within 30 seconds." >&2
      exit 1
    fi
    sleep 1
  done
fi
echo "[run.sh] PostgreSQL is ready."

if [[ -x "${SCRIPT_DIR}/build/bin/cme-migrate" ]]; then
  echo "[run.sh] Ensuring database migrations are applied..."
  "${SCRIPT_DIR}/build/bin/cme-migrate" \
    --db "${DB_URL}" \
    --migrations-dir "${SCRIPT_DIR}/migrations"
fi

mkdir -p "${DATA_DIR}"

echo "[run.sh] Starting cme-server on port ${PORT} (data-dir: ${DATA_DIR})..."
"${SCRIPT_DIR}/build/bin/cme-server" \
  --db-url "${DB_URL}" \
  --data-dir "${DATA_DIR}" \
  --embedded-ui "${UI_DIR}" \
  --port "${PORT}" \
  "$@" &
SERVER_PID=$!

wait "${SERVER_PID}" || true
