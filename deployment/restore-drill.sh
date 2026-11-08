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
# The custom archive TOC is metadata only. It selects which roles must exist
# before restore; the exact ledger and marker are checked again afterwards.
toc=$(gpg --batch --decrypt "$backup/database.dump.gpg" | "${compose[@]}" exec -T db pg_restore --list)
marker_count=$(printf '%s\n' "$toc" | grep -c ' TABLE hp_private mail_outbox ' || true)
case "$marker_count" in 0) stage=5;; 1) stage=6;; *) echo 'Ambiguous restore archive.' >&2; exit 1;; esac
unset toc
dbcmd='export PGPASSWORD="$(cat /run/secrets/db_password)"; exec psql -X -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner'
# Provision all required roles in one transaction, already NOLOGIN. This avoids
# an interrupted drill leaving a newly provisioned login enabled. Passwords
# stay in the isolated maintenance process and are never printed.
"${compose[@]}" run --rm --no-deps -T --entrypoint node maintenance -e '
const {Client}=require("pg");
const {readSetting,requireDatabaseUrl}=require("./runtime/composition.cjs");
(async()=>{
 const url=await readSetting(process.env,"HOMEPLANNER_MIGRATION_DATABASE_URL");
 requireDatabaseUrl(url,"homeplanner_bootstrap");
 const definitions=[
  ["hp_auth_login","hp_auth_runtime","HOMEPLANNER_AUTH_DB_PASSWORD"],
  ["hp_app_login","hp_app_runtime","HOMEPLANNER_APP_DB_PASSWORD"],
  ["hp_photo_maintenance_login","hp_photo_maintenance","HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD"]];
 const groups=["hp_auth_owner","hp_app_owner","hp_auth_runtime","hp_app_runtime","hp_photo_maintenance"];
 if(process.argv[1]==="6") {
  groups.push("hp_access_public","hp_mail_worker");
  definitions.push(["hp_access_public_login","hp_access_public","HOMEPLANNER_ACCESS_PUBLIC_DB_PASSWORD"],["hp_mail_worker_login","hp_mail_worker","HOMEPLANNER_MAIL_DB_PASSWORD"]);
 }
 const passwords=await Promise.all(definitions.map(d=>readSetting(process.env,d[2])));
 if(passwords.some(p=>Buffer.byteLength(p)<32)||new Set(passwords).size!==passwords.length) throw Error("Invalid credentials");
 const c=new Client({connectionString:url,connectionTimeoutMillis:5000}); await c.connect();
 try {
  await c.query("BEGIN");
  const names=[...groups,...definitions.map(d=>d[0])];
  if((await c.query("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])",[names])).rowCount) throw Error("Role collision");
  for(const n of groups) await c.query(`CREATE ROLE ${c.escapeIdentifier(n)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  for(let i=0;i<definitions.length;i++) {
   const [login,group]=definitions[i];
   await c.query(`CREATE ROLE ${c.escapeIdentifier(login)} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${c.escapeLiteral(passwords[i])}`);
   await c.query(`GRANT ${c.escapeIdentifier(group)} TO ${c.escapeIdentifier(login)}`);
  }
  await c.query("COMMIT");
 } catch(e) { await c.query("ROLLBACK"); throw e; } finally { await c.end(); }
})().then(()=>console.log("Isolated roles provisioned with logins disabled."),()=>{console.error("Isolated role provisioning failed.");process.exitCode=1});
' "$stage"
gpg --batch --decrypt "$backup/database.dump.gpg" | "${compose[@]}" exec -T db sh -c 'export PGPASSWORD="$(cat /run/secrets/db_password)"; exec pg_restore --exit-on-error -U homeplanner_bootstrap -d homeplanner'
"${compose[@]}" exec -T db sh -c "$dbcmd" < post-restore.sql
# Compare every recorded hash to the selected image's exact migration bytes.
# The standard verify job accepts only the latest ledger, so a pre-upgrade
# backup needs the same comparison restricted to the first five entries.
"${compose[@]}" run --rm --no-deps -T --entrypoint node maintenance -e '
const {Client}=require("pg");
const {readSetting,requireDatabaseUrl}=require("./runtime/composition.cjs");
const {expectedMigrations}=require("./db/migrate.cjs");
(async()=>{
 const stage=Number(process.argv[1]); if(![5,6].includes(stage)) throw Error("Invalid stage");
 const url=await readSetting(process.env,"HOMEPLANNER_MIGRATION_DATABASE_URL"); requireDatabaseUrl(url,"homeplanner_bootstrap");
 const expected=(await expectedMigrations()).slice(0,stage);
 const c=new Client({connectionString:url,connectionTimeoutMillis:5000}); await c.connect();
 try {
  const actual=(await c.query("SELECT name,sha256 FROM hp_migration.applied ORDER BY name")).rows;
  if(actual.length!==stage || actual.some((r,i)=>r.name!==expected[i].name || r.sha256!==expected[i].sha256)) throw Error("Ledger mismatch");
  const roles=(await c.query("SELECT rolname,rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])",[["hp_auth_login","hp_app_login","hp_photo_maintenance_login","hp_access_public_login","hp_mail_worker_login"]])).rows;
  if(roles.length!==(stage===6?5:3) || roles.some(r=>r.rolcanlogin)) throw Error("Login state mismatch");
  const marker=await c.query("SELECT to_regclass($1) IS NOT NULL AS present",["hp_private.mail_outbox"]);
  if(marker.rows[0].present!==(stage===6)) throw Error("Archive marker mismatch");
  if(stage===6 && (await c.query("SELECT 1 FROM hp_private.access_challenges LIMIT 1")).rowCount) throw Error("Access challenge remains");
 } finally { await c.end(); }
})().then(()=>console.log("Migration ledger and disabled logins verified."),()=>{console.error("Restore ledger or login verification failed.");process.exitCode=1});
' "$stage"
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
echo 'Isolated restore checks passed. Logins and model use remain disabled; reconcile liabilities and the mail outbox before separate explicit activation.'
