#!/usr/bin/env bash
# Restores only to a new isolated project and a new empty private photo directory.
set -Eeuo pipefail
umask 077
: "${HOMEPLANNER_RESTORE_PROJECT:?}" "${HOMEPLANNER_RESTORE_PHOTO_DIR:?}" "${HOMEPLANNER_PHOTO_DIR:?}" "${HOMEPLANNER_OPERATIONS_LOCK:?}"
backup=${1:?Pass encrypted backup directory}
[[ "$HOMEPLANNER_RESTORE_PROJECT" =~ ^homeplanner-restore-[a-z0-9][a-z0-9-]{2,40}$ ]] || { echo 'Invalid isolated project name.' >&2; exit 1; }
[[ "$backup" = /* && "$HOMEPLANNER_RESTORE_PHOTO_DIR" = /* && "$HOMEPLANNER_PHOTO_DIR" = /* && "$HOMEPLANNER_OPERATIONS_LOCK" = /* ]] || exit 1
[[ "$(realpath -e "$HOMEPLANNER_RESTORE_PHOTO_DIR")" = "$HOMEPLANNER_RESTORE_PHOTO_DIR" && "$(realpath -e "$HOMEPLANNER_PHOTO_DIR")" = "$HOMEPLANNER_PHOTO_DIR" ]] || exit 1
case "$HOMEPLANNER_RESTORE_PHOTO_DIR/" in "$HOMEPLANNER_PHOTO_DIR/"*) echo 'Restore destination overlaps the live photo directory.' >&2; exit 1;; esac
case "$HOMEPLANNER_PHOTO_DIR/" in "$HOMEPLANNER_RESTORE_PHOTO_DIR/"*) echo 'Restore destination overlaps the live photo directory.' >&2; exit 1;; esac
[[ -d "$backup" && ! -L "$backup" && -d "$HOMEPLANNER_RESTORE_PHOTO_DIR/data" && ! -L "$HOMEPLANNER_RESTORE_PHOTO_DIR/data" && -z "$(find "$HOMEPLANNER_RESTORE_PHOTO_DIR/data" -mindepth 1 -print -quit)" ]] || exit 1
cd "$(dirname "$0")"
exec 9>"$HOMEPLANNER_OPERATIONS_LOCK"
flock -n 9 || { echo 'Another HomePlanner operation holds the lock.' >&2; exit 1; }
compose=(docker compose --project-name "$HOMEPLANNER_RESTORE_PROJECT" -f restore-compose.yaml)
[[ -z "$("${compose[@]}" ps -aq)" ]] || { echo 'Restore project already exists.' >&2; exit 1; }
if docker volume inspect "${HOMEPLANNER_RESTORE_PROJECT}_restore_db" >/dev/null 2>&1; then echo 'Restore volume already exists.' >&2; exit 1; fi
# Only accept the three expected ciphertext filenames in the checksum file.
[[ $(wc -l <"$backup/SHA256SUMS") -eq 3 ]] || exit 1
for name in database.dump.gpg photos.tar.gpg photos.sha256z.gpg; do
  [[ $(grep -Ec "^[0-9a-f]{64}  ${name//./\\.}$" "$backup/SHA256SUMS") -eq 1 && -f "$backup/$name" && ! -L "$backup/$name" ]] || exit 1
done
(cd "$backup" && sha256sum -c SHA256SUMS)
trap 'echo "Restore drill incomplete. Leave the isolated project and destination for inspection; do not connect them to production." >&2' ERR
live=(docker compose --project-name homeplanner -f compose.yaml)
was_running=0
[[ -z "$("${live[@]}" ps -q --status running web)" ]] || was_running=1
"${live[@]}" stop -t 20 web
[[ -z "$("${live[@]}" ps -q --status running web)" ]] || exit 1
source_lock="$HOMEPLANNER_PHOTO_DIR/.homeplanner-writer.lock"
target_lock="$HOMEPLANNER_RESTORE_PHOTO_DIR/.homeplanner-writer.lock"
[[ -f "$source_lock" && ! -L "$source_lock" && -f "$target_lock" && ! -L "$target_lock" ]] || exit 1
for volume in "$HOMEPLANNER_PHOTO_DIR" "$HOMEPLANNER_RESTORE_PHOTO_DIR"; do
  [[ "$(stat -c %u "$volume")" = 0 && -z "$(find "$volume" -maxdepth 0 -perm /022 -print -quit)" ]] || exit 1
done
exec 8>>"$source_lock"
flock -n 8 || { echo 'Live photo volume is still owned.' >&2; exit 1; }
exec 7>>"$target_lock"
flock -n 7 || { echo 'Restore photo volume is still owned.' >&2; exit 1; }
# Parent operations FD9 stays locked; internal jobs bypass the wrapper only
# to avoid recursively acquiring this same lock from another container.
"${compose[@]}" up -d --wait db
"${compose[@]}" run --rm --no-deps -T --entrypoint node maintenance runtime/maintenance.cjs provision
gpg --batch --decrypt "$backup/database.dump.gpg" | "${compose[@]}" exec -T db sh -c 'export PGPASSWORD="$(cat /run/secrets/db_password)"; exec pg_restore --exit-on-error -U homeplanner_bootstrap -d homeplanner'
dbcmd='export PGPASSWORD="$(cat /run/secrets/db_password)"; exec psql -X -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner'
"${compose[@]}" exec -T db sh -c "$dbcmd" < post-restore.sql
"${compose[@]}" run --rm --no-deps -T --entrypoint node maintenance runtime/maintenance.cjs verify
gpg --batch --decrypt "$backup/photos.tar.gpg" | python3 restore-photos.py "$HOMEPLANNER_RESTORE_PHOTO_DIR/data" "$backup/photos.sha256z.gpg"
printf '%s\n' "COPY (SELECT p.owner_id,p.design_id,p.id,p.bytes,p.checksum FROM hp_app.design_photos p JOIN hp_app.designs d ON d.id=p.design_id AND d.owner_id=p.owner_id WHERE p.status='ready' AND p.tombstoned_at IS NULL AND d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM hp_private.photo_work w WHERE w.photo_id=p.id AND w.mode='delete') ORDER BY p.id) TO STDOUT WITH CSV" | "${compose[@]}" exec -T db sh -c "$dbcmd" | python3 verify-restored-photos.py "$HOMEPLANNER_RESTORE_PHOTO_DIR/data"
"${compose[@]}" exec -T db sh -c "$dbcmd" <<'SQL'
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM hp_auth.session) OR EXISTS (SELECT 1 FROM hp_private.admin_challenges) OR EXISTS (SELECT 1 FROM hp_private.admin_grants)
 OR EXISTS (SELECT 1 FROM hp_auth.verification) OR EXISTS (SELECT 1 FROM hp_private.model_config WHERE enabled)
 OR EXISTS (SELECT 1 FROM hp_app.designs d LEFT JOIN hp_auth."user" u ON u.id=d.owner_id WHERE u.id IS NULL)
 THEN RAISE EXCEPTION 'restore safety check failed'; END IF;
END $$;
SQL
"${compose[@]}" run --rm --no-deps -T photo-verify
flock -u 7
exec 7>&-
flock -u 8
exec 8>&-
if [[ "$was_running" = 1 ]]; then "${live[@]}" start web; fi
trap - ERR
echo 'Isolated restore checks passed. Logins and model use remain disabled; reconcile all post-backup liabilities before any future activation.'
