#!/usr/bin/env bash
# App-only cold backup. Run only after reviewing HOSTING.md and excluding
# concurrent privileged maintenance. No Energy service is addressed.
set -Eeuo pipefail
umask 077
: "${HOMEPLANNER_BACKUP_ROOT:?}" "${HOMEPLANNER_BACKUP_RECIPIENT:?}" "${HOMEPLANNER_OPERATIONS_LOCK:?}" "${HOMEPLANNER_PHOTO_DIR:?}"
[[ "$HOMEPLANNER_BACKUP_ROOT" = /* && "$HOMEPLANNER_OPERATIONS_LOCK" = /* && "$HOMEPLANNER_PHOTO_DIR" = /* ]] || { echo 'Absolute backup, photo and lock paths required.' >&2; exit 1; }
[[ "$(realpath -e "$HOMEPLANNER_PHOTO_DIR")" = "$HOMEPLANNER_PHOTO_DIR" ]] || { echo 'Canonical photo volume path required.' >&2; exit 1; }
[[ "${HOMEPLANNER_EXCLUSIVE_OPERATIONS:-}" = yes ]] || { echo 'Exclusive maintenance window required.' >&2; exit 1; }
cd "$(dirname "$0")"
exec 9>"$HOMEPLANNER_OPERATIONS_LOCK"
flock -n 9 || { echo 'Another HomePlanner operation holds the lock.' >&2; exit 1; }
compose=(docker compose --project-name homeplanner -f compose.yaml)
command -v gpg >/dev/null
gpg --batch --list-keys "$HOMEPLANNER_BACKUP_RECIPIENT" >/dev/null
[[ -d "$HOMEPLANNER_BACKUP_ROOT" && ! -L "$HOMEPLANNER_BACKUP_ROOT" ]] || exit 1
free_bytes=$(df -B1 --output=avail "$HOMEPLANNER_BACKUP_ROOT" | tail -n 1 | tr -d ' ')
[[ "$free_bytes" =~ ^[0-9]+$ && "$free_bytes" -gt 21474836480 ]] || { echo 'Backup filesystem is below the 20 GiB floor.' >&2; exit 1; }
backup="$HOMEPLANNER_BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup"
on_error() { echo "Backup incomplete at $backup. Do not resume HomePlanner until its state and database logins have been checked." >&2; }
trap on_error ERR
echo 'Stopping HomePlanner web and draining its requests.'
was_running=0
[[ -z "$("${compose[@]}" ps -q --status running web)" ]] || was_running=1
"${compose[@]}" stop -t 20 web
if [[ -n "$("${compose[@]}" ps -q --status running web)" ]]; then echo 'HomePlanner web is still running.' >&2; exit 1; fi
lock="$HOMEPLANNER_PHOTO_DIR/.homeplanner-writer.lock"
[[ -d "$HOMEPLANNER_PHOTO_DIR" && ! -L "$HOMEPLANNER_PHOTO_DIR" && -f "$lock" && ! -L "$lock" ]] || exit 1
[[ "$(stat -c %u "$HOMEPLANNER_PHOTO_DIR")" = 0 && -z "$(find "$HOMEPLANNER_PHOTO_DIR" -maxdepth 0 -perm /022 -print -quit)" ]] || exit 1
exec 8>>"$lock"
flock -n 8 || { echo 'Photo volume is still owned by another process.' >&2; exit 1; }
dbcmd='export PGPASSWORD="$(cat /run/secrets/db_bootstrap_password)"; exec psql -X -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner'
echo 'Disabling app logins and checking for other database sessions.'
"${compose[@]}" exec -T db sh -c "$dbcmd" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login') AND rolcanlogin) <> 3
 THEN RAISE EXCEPTION 'runtime login state is not normal'; END IF;
END $$;
ALTER ROLE hp_auth_login NOLOGIN;
ALTER ROLE hp_app_login NOLOGIN;
ALTER ROLE hp_photo_maintenance_login NOLOGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND usename IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login') AND pid<>pg_backend_pid();
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'database is not quiescent'; END IF; END $$;
SQL
gpg_args=(--batch --yes --trust-model always --recipient "$HOMEPLANNER_BACKUP_RECIPIENT" --encrypt)
"${compose[@]}" exec -T db sh -c 'export PGPASSWORD="$(cat /run/secrets/db_bootstrap_password)"; exec pg_dump -U homeplanner_bootstrap -d homeplanner --format=custom' | gpg "${gpg_args[@]}" >"$backup/database.dump.gpg"
# Reject links and special entries, then take two views while all writers are stopped.
"${compose[@]}" run --rm --no-deps -T --entrypoint bash photo-read -c 'set -euo pipefail; cd /photos/data; test -z "$(find . ! -type d ! -type f -print -quit)"; tar -cf - .' | gpg "${gpg_args[@]}" >"$backup/photos.tar.gpg"
"${compose[@]}" run --rm --no-deps -T --entrypoint bash photo-read -c 'set -euo pipefail; cd /photos/data; test -z "$(find . ! -type d ! -type f -print -quit)"; find . -type f -print0 | sort -z | xargs -0 -r sha256sum -z' | gpg "${gpg_args[@]}" >"$backup/photos.sha256z.gpg"
(cd "$backup" && sha256sum database.dump.gpg photos.tar.gpg photos.sha256z.gpg > SHA256SUMS)
"${compose[@]}" exec -T db sh -c "$dbcmd" <<'SQL'
ALTER ROLE hp_auth_login LOGIN;
ALTER ROLE hp_app_login LOGIN;
ALTER ROLE hp_photo_maintenance_login LOGIN;
SQL
flock -u 8
exec 8>&-
if [[ "$was_running" = 1 ]]; then "${compose[@]}" start web; fi
trap - ERR
echo "Encrypted backup completed: $backup. Verify by an isolated restore drill."
