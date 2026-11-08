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
publish_root=${HOMEPLANNER_PUBLISH_ROOT:-}
included_root=${HOMEPLANNER_PUBLISH_INCLUDED_ROOT:-}
nonce=${HOMEPLANNER_BACKUP_INVOCATION_NONCE:-}
if [[ -n "$publish_root$included_root$nonce" ]]; then
  [[ "$publish_root" = /* && "$included_root" = /* && "$nonce" =~ ^[0-9a-f]{32}$ ]] || { echo 'Publication requires absolute roots and a 32-hex invocation nonce.' >&2; exit 1; }
  [[ -d "$included_root" && ! -L "$included_root" && -d "$publish_root" && ! -L "$publish_root" && "$(realpath -e "$included_root")" = "$included_root" && "$(realpath -e "$publish_root")" = "$publish_root" && "$(realpath -e "$HOMEPLANNER_BACKUP_ROOT")" = "$HOMEPLANNER_BACKUP_ROOT" ]] || { echo 'Canonical existing publication and staging roots required.' >&2; exit 1; }
  [[ "$publish_root" = "$included_root/homeplanner" ]] || { echo 'Publication root must be the HomePlanner child of the included tree.' >&2; exit 1; }
  [[ "$HOMEPLANNER_BACKUP_ROOT" = "$publish_root" ]] || { echo 'Publication staging and final must use the same parent.' >&2; exit 1; }
  command -v python3 >/dev/null
  python3 -B publish-backup.py preflight "$publish_root" "$nonce"
fi
free_bytes=$(df -B1 --output=avail "$HOMEPLANNER_BACKUP_ROOT" | tail -n 1 | tr -d ' ')
[[ "$free_bytes" =~ ^[0-9]+$ && "$free_bytes" -gt 21474836480 ]] || { echo 'Backup filesystem is below the 20 GiB floor.' >&2; exit 1; }
capture_started=$(date -u +%s)
if [[ -n "$publish_root" ]]; then
  capture_name="$(date -u -d "@$capture_started" +%Y%m%dT%H%M%SZ)-$nonce"
  backup="$publish_root/.incomplete-$nonce"
else
  backup="$HOMEPLANNER_BACKUP_ROOT/$(date -u -d "@$capture_started" +%Y%m%dT%H%M%SZ)"
fi
mkdir -m 700 "$backup"
on_error() { echo "Backup incomplete at $backup. Inspect staging and any publication target; do not resume HomePlanner until its state and database logins have been checked." >&2; }
on_signal() { trap - TERM INT; echo "Backup interrupted at $backup. Inspect staging and any publication target; do not blindly resume HomePlanner." >&2; exit 143; }
trap on_error ERR
trap on_signal TERM INT
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
 IF (SELECT array_agg(name ORDER BY name) FROM hp_migration.applied) NOT IN (
   ARRAY['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql','005_shelf_documents.sql'],
   ARRAY['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql','005_shelf_documents.sql','006_access_requests.sql'])
   OR NOT EXISTS (SELECT 1 FROM hp_migration.applied) THEN
   RAISE EXCEPTION 'unsupported migration ledger';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login') AND rolcanlogin) <> 3
   OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) NOT IN (0,2)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login') AND NOT rolcanlogin)
   OR (EXISTS (SELECT 1 FROM hp_migration.applied WHERE name='006_access_requests.sql') AND
       (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) <> 2)
 THEN RAISE EXCEPTION 'runtime login state is not normal for the ledger'; END IF;
 ALTER ROLE hp_auth_login NOLOGIN;
 ALTER ROLE hp_app_login NOLOGIN;
 ALTER ROLE hp_photo_maintenance_login NOLOGIN;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hp_access_public_login') THEN
   ALTER ROLE hp_access_public_login NOLOGIN;
   ALTER ROLE hp_mail_worker_login NOLOGIN;
 END IF;
END $$;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login','hp_access_public_login','hp_mail_worker_login') AND pid<>pg_backend_pid();
DO $$ BEGIN
 FOR attempt IN 1..100 LOOP
  PERFORM pg_stat_clear_snapshot();
  IF NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend' AND (datname=current_database() OR usename IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login','hp_access_public_login','hp_mail_worker_login'))) THEN RETURN; END IF;
  PERFORM pg_sleep(0.1);
 END LOOP;
 RAISE EXCEPTION 'database is not quiescent';
END $$;
SQL
if [[ -n "$publish_root" ]]; then
  ledger=$("${compose[@]}" exec -T db sh -c "$dbcmd -At -c \"SELECT string_agg(name, ',' ORDER BY name) FROM hp_migration.applied\"")
fi
gpg_args=(--batch --yes --trust-model always --recipient "$HOMEPLANNER_BACKUP_RECIPIENT" --encrypt)
"${compose[@]}" exec -T db sh -c 'export PGPASSWORD="$(cat /run/secrets/db_bootstrap_password)"; exec pg_dump -U homeplanner_bootstrap -d homeplanner --format=custom' | gpg "${gpg_args[@]}" >"$backup/database.dump.gpg"
# Reject links and special entries, then take two views while all writers are stopped.
"${compose[@]}" run --rm --no-deps -T --entrypoint bash photo-read -c 'set -euo pipefail; cd /photos/data; test -z "$(find . ! -type d ! -type f -print -quit)"; tar -cf - .' | gpg "${gpg_args[@]}" >"$backup/photos.tar.gpg"
"${compose[@]}" run --rm --no-deps -T --entrypoint bash photo-read -c 'set -euo pipefail; cd /photos/data; test -z "$(find . ! -type d ! -type f -print -quit)"; find . -type f -print0 | sort -z | xargs -0 -r sha256sum -z' | gpg "${gpg_args[@]}" >"$backup/photos.sha256z.gpg"
(cd "$backup" && sha256sum database.dump.gpg photos.tar.gpg photos.sha256z.gpg > SHA256SUMS)
capture_ended=$(date -u +%s)
if [[ -n "$publish_root" ]]; then
  [[ "$capture_started" =~ ^[0-9]+$ && "$capture_ended" =~ ^[0-9]+$ && "$capture_ended" -ge "$capture_started" ]] || { echo 'Capture clock is invalid; not publishing.' >&2; exit 1; }
  manifest_hash=$(python3 -B publish-backup.py prepare "$publish_root" "$nonce" "$capture_name" "$capture_started" "$capture_ended" "$ledger")
  published_hash=$(python3 -B publish-backup.py publish "$publish_root" "$nonce" "$capture_name")
  [[ "$published_hash" = "$manifest_hash" ]] || { echo 'Published manifest changed.' >&2; exit 1; }
  backup="$publish_root/$capture_name"
fi
"${compose[@]}" exec -T db sh -c "$dbcmd" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_auth_login','hp_app_login','hp_photo_maintenance_login') AND NOT rolcanlogin) <> 3
   OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) NOT IN (0,2)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login') AND rolcanlogin)
   OR (EXISTS (SELECT 1 FROM hp_migration.applied WHERE name='006_access_requests.sql') AND
       (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) <> 2)
 THEN RAISE EXCEPTION 'fenced login state changed during backup'; END IF;
 ALTER ROLE hp_auth_login LOGIN;
 ALTER ROLE hp_app_login LOGIN;
 ALTER ROLE hp_photo_maintenance_login LOGIN;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hp_access_public_login') THEN
   ALTER ROLE hp_access_public_login LOGIN;
   ALTER ROLE hp_mail_worker_login LOGIN;
 END IF;
END $$;
SQL
flock -u 8
exec 8>&-
if [[ "$was_running" = 1 ]]; then "${compose[@]}" start web; fi
trap - ERR TERM INT
echo "Encrypted capture completed: $backup. Service readiness is not verified; check it separately and verify the capture by an isolated restore drill."
if [[ -n "$publish_root" ]]; then
  printf 'HOMEPLANNER_BACKUP_RECEIPT_V2 %s %s %s %s %s COMPLETE\n' "$nonce" "$capture_name" "$capture_started" "$capture_ended" "$manifest_hash"
fi
