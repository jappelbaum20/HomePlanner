#!/usr/bin/env bash
# Rendering only: values below are non-secret placeholders; /dev/null prevents
# implicit loading of a working-directory environment file.
set -euo pipefail
export HOMEPLANNER_BUILD_CONTEXT=${1:?} HOMEPLANNER_PHOTO_DIR=${2:?}
export HOMEPLANNER_OPERATIONS_LOCK=/nonexistent/operations.lock
export GOOGLE_OAUTH_CLIENT_ID=fixture.apps.googleusercontent.com
for name in HOMEPLANNER_DB_BOOTSTRAP_PASSWORD_FILE HOMEPLANNER_MIGRATION_DATABASE_URL_FILE HOMEPLANNER_AUTH_DB_PASSWORD_FILE HOMEPLANNER_APP_DB_PASSWORD_FILE HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD_FILE HOMEPLANNER_AUTH_DATABASE_URL_FILE HOMEPLANNER_APP_DATABASE_URL_FILE HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL_FILE HOMEPLANNER_AUTH_SECRET_FILE HOMEPLANNER_CSRF_SECRET_FILE GOOGLE_OAUTH_CLIENT_SECRET_FILE HOMEPLANNER_RESTORE_DB_PASSWORD_FILE HOMEPLANNER_RESTORE_MIGRATION_URL_FILE HOMEPLANNER_RESTORE_AUTH_PASSWORD_FILE HOMEPLANNER_RESTORE_APP_PASSWORD_FILE HOMEPLANNER_RESTORE_PHOTO_MAINTENANCE_PASSWORD_FILE; do export "$name=/nonexistent/fixture"; done
cd "$(dirname "$0")/../deployment"
docker compose --env-file /dev/null -f compose.yaml config --quiet
docker compose --env-file /dev/null -f restore-compose.yaml config --quiet
echo 'Compose configurations rendered.'
