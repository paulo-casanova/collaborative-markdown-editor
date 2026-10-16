#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CME_PG_CONTAINER:-cme-postgres}"
PG_PORT="${CME_PG_PORT:-5432}"
PG_USER="${CME_PG_USER:-cme}"
PG_PASSWORD="${CME_PG_PASSWORD:-secret}"
PG_DB="${CME_PG_DB:-cme_test}"
DB_URL="${CME_DATABASE_URL:-postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--create] [--admin] <username> [new_password]

Resets a user's password in PostgreSQL for Challenge-Based Authentication.
If [new_password] is omitted, you will be prompted interactively.

Options:
  --create    Create the user if they do not already exist in the database
  --admin     Ensure the user has is_system_admin = TRUE
  -h, --help  Show this help message

Environment Variables (defaults match run.sh):
  CME_PG_CONTAINER  Docker container name (default: cme-postgres)
  CME_PG_PORT       PostgreSQL port (default: 5432)
  CME_PG_USER       PostgreSQL user (default: cme)
  CME_PG_PASSWORD   PostgreSQL password (default: secret)
  CME_PG_DB         PostgreSQL database (default: cme_test)
  CME_DATABASE_URL  Full connection URL
EOF
}

CREATE_IF_MISSING=0
SET_ADMIN=0
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create)
      CREATE_IF_MISSING=1
      shift
      ;;
    --admin)
      SET_ADMIN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        POSITIONAL+=("$1")
        shift
      done
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 1 ]] || [[ ${#POSITIONAL[@]} -gt 2 ]]; then
  usage >&2
  exit 1
fi

USERNAME="${POSITIONAL[0]}"
NEW_PASSWORD="${POSITIONAL[1]:-}"

if [[ -z "${USERNAME}" ]]; then
  echo "Error: username cannot be empty." >&2
  exit 1
fi

if [[ -z "${NEW_PASSWORD}" ]]; then
  read -r -s -p "Enter new password for '${USERNAME}': " NEW_PASSWORD
  echo ""
  read -r -s -p "Confirm new password for '${USERNAME}': " CONFIRM_PASSWORD
  echo ""
  if [[ "${NEW_PASSWORD}" != "${CONFIRM_PASSWORD}" ]]; then
    echo "Error: passwords do not match." >&2
    exit 1
  fi
fi

if [[ -z "${NEW_PASSWORD}" ]]; then
  echo "Error: password cannot be empty." >&2
  exit 1
fi

STARTED_CONTAINER=0
cleanup() {
  if [[ "${STARTED_CONTAINER}" -eq 1 ]]; then
    docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Ensure PostgreSQL is reachable
if ! pg_isready -h localhost -p "${PG_PORT}" -U "${PG_USER}" >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    echo "[reset_user_password.sh] Starting PostgreSQL container '${CONTAINER_NAME}'..."
    docker start "${CONTAINER_NAME}" >/dev/null
    STARTED_CONTAINER=1
    for i in {1..30}; do
      if pg_isready -h localhost -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  else
    echo "Error: PostgreSQL is not running on localhost:${PG_PORT} and container '${CONTAINER_NAME}' was not found." >&2
    exit 1
  fi
fi

run_psql() {
  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    docker exec -i "${CONTAINER_NAME}" psql -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 "$@"
  else
    psql "${DB_URL}" -v ON_ERROR_STOP=1 "$@"
  fi
}

EXISTS=$(run_psql -tA -v username="${USERNAME}" <<'SQL'
SELECT COUNT(*) FROM users WHERE username = :'username';
SQL
)

if [[ "${EXISTS}" -eq 0 ]] && [[ "${CREATE_IF_MISSING}" -eq 0 ]]; then
  echo "Error: User '${USERNAME}' does not exist in database '${PG_DB}'." >&2
  echo "Hint: Run with --create to create '${USERNAME}' if they don't exist yet." >&2
  exit 1
fi

run_psql -q -v username="${USERNAME}" -v password="${NEW_PASSWORD}" -v set_admin="${SET_ADMIN}" <<'SQL'
SET client_min_messages TO WARNING;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin)
VALUES (
    :'username',
    replace(crypt(:'password', gen_salt('bf', 10)), '$2a$', '$2b$'),
    :'username',
    '#3b82f6',
    (:'set_admin'::int = 1)
)
ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    is_system_admin = CASE WHEN :'set_admin'::int = 1 THEN TRUE ELSE users.is_system_admin END,
    updated_at = NOW();
SQL

echo "[reset_user_password.sh] Successfully updated password for user '${USERNAME}' in database '${PG_DB}'."
