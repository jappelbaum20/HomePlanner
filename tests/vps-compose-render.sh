#!/usr/bin/env bash
# Render only. All paths and values are synthetic; no implicit .env is read.
set -euo pipefail
export HOMEPLANNER_BUILD_CONTEXT=${1:?Pass a synthetic build context path}
export HOMEPLANNER_PHOTO_DIR=${2:?Pass a synthetic photo directory path}
out=${3:?Pass a new task-owned output directory}
mkdir "$out"
export HOMEPLANNER_OPERATIONS_LOCK=/nonexistent/operations.lock
export HOMEPLANNER_RESTORE_PHOTO_DIR=/nonexistent/restore-photos
export GOOGLE_OAUTH_CLIENT_ID=fixture.apps.googleusercontent.com
export HOMEPLANNER_WEB_IMAGE=sha256:a6b9c622e03f58e45577da3939de1fb52493fdb43c0fd97f5107553db58c53c5
for name in HOMEPLANNER_DB_BOOTSTRAP_PASSWORD_FILE HOMEPLANNER_MIGRATION_DATABASE_URL_FILE HOMEPLANNER_AUTH_DB_PASSWORD_FILE HOMEPLANNER_APP_DB_PASSWORD_FILE HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD_FILE HOMEPLANNER_ACCESS_PUBLIC_DB_PASSWORD_FILE HOMEPLANNER_MAIL_DB_PASSWORD_FILE HOMEPLANNER_AUTH_DATABASE_URL_FILE HOMEPLANNER_APP_DATABASE_URL_FILE HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL_FILE HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL_FILE HOMEPLANNER_MAIL_DATABASE_URL_FILE HOMEPLANNER_ACCESS_RATE_KEY_FILE HOMEPLANNER_AUTH_SECRET_FILE HOMEPLANNER_CSRF_SECRET_FILE GOOGLE_OAUTH_CLIENT_SECRET_FILE HOMEPLANNER_RESTORE_DB_PASSWORD_FILE HOMEPLANNER_RESTORE_MIGRATION_URL_FILE HOMEPLANNER_RESTORE_AUTH_PASSWORD_FILE HOMEPLANNER_RESTORE_APP_PASSWORD_FILE HOMEPLANNER_RESTORE_PHOTO_MAINTENANCE_PASSWORD_FILE HOMEPLANNER_RESTORE_ACCESS_PUBLIC_PASSWORD_FILE HOMEPLANNER_RESTORE_MAIL_PASSWORD_FILE HOMEPLANNER_PROVIDER_API_KEY_FILE HOMEPLANNER_GMAIL_APP_PASSWORD_FILE; do export "$name=/nonexistent/$name"; done
export OPENAI_CONNECTION_VERSION=fixture-version
unset HOMEPLANNER_TRUSTED_PROXY_IP || true
cd "$(dirname "$0")/../deployment"
base=(docker compose --env-file /dev/null --profile operations -f compose.yaml)
"${base[@]}" config --format json > "$out/base.json"
if "${base[@]}" -f compose.mail.yaml config --quiet 2>/dev/null; then echo 'Mail overlay accepted a missing proxy peer' >&2; exit 1; fi
export HOMEPLANNER_TRUSTED_PROXY_IP=192.0.2.10
if env -u HOMEPLANNER_GMAIL_APP_PASSWORD_FILE "${base[@]}" -f compose.mail.yaml config --quiet 2>/dev/null; then echo 'Mail overlay accepted a missing private password path' >&2; exit 1; fi
"${base[@]}" -f compose.ingress.yaml -f compose.ai.yaml -f compose.mail.yaml config --format json > "$out/merged.json"
docker compose --env-file /dev/null -f restore-compose.yaml config --format json > "$out/restore.json"
if command -v node >/dev/null; then
  node ../tests/vps-compose-assert.cjs "$out" "$HOMEPLANNER_WEB_IMAGE"
elif command -v node.exe >/dev/null && command -v wslpath >/dev/null; then
  node.exe "$(wslpath -w ../tests/vps-compose-assert.cjs)" "$(wslpath -w "$out")" "$HOMEPLANNER_WEB_IMAGE"
else
  echo 'Node is required for Compose assertions' >&2; exit 1
fi
