#!/usr/bin/env bash
# Single-use synthetic fixture. Run as root on the isolated Docker test host.
# Arguments: checkout, new evidence directory, unique lowercase suffix,
# first of six checked 198.18.x.0/24 subnets.
set -Eeuo pipefail
umask 077
repo=${1:?checkout}; evidence=${2:?new evidence directory}; suffix=${3:?unique lowercase suffix}; subnet_base=${4:?subnet base}
[[ $(id -u) = 0 && $repo = /* && $evidence = /* && ! -e $evidence ]] || exit 1
[[ $suffix =~ ^[a-z0-9]{1,8}$ ]] || exit 1
[[ $subnet_base =~ ^[0-9]{1,3}$ ]] && ((subnet_base <= 250)) || exit 1
task=hpstage2recovery20261108$suffix
restore5=homeplanner-restore-rec5$suffix
restore6=homeplanner-restore-rec6$suffix
restoreuser=homeplanner-restore-rec6user$suffix
restorefail=homeplanner-restore-recfail$suffix
work=/mnt/wsl/$task
project=$task
image=sha256:a6b9c622e03f58e45577da3939de1fb52493fdb43c0fd97f5107553db58c53c5
[[ ! -e $work ]] || { echo 'Fixture path collision'; exit 1; }
mkdir -p "$work/docker-config"
chown 1000:1000 "$work/docker-config"; chmod 700 "$work/docker-config"
export DOCKER_CONFIG="$work/docker-config"
# Refuse overlapping Docker or directly routed subnets; do not alter them.
python3 - "$subnet_base" <<'PY'
import ipaddress, json, subprocess, sys
base = int(sys.argv[1])
wanted = [ipaddress.ip_network(f'198.18.{base+i}.0/24') for i in range(6)]
ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
networks = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *ids], text=True)) if ids else []
used = []
for network in networks:
    for config in network.get('IPAM', {}).get('Config') or []:
        if config.get('Subnet'): used.append(ipaddress.ip_network(config['Subnet'], strict=False))
for line in subprocess.check_output(['ip', '-4', 'route', 'show'], text=True).splitlines():
    destination = line.split()[0]
    if destination != 'default':
        try: used.append(ipaddress.ip_network(destination, strict=False))
        except ValueError: pass
if any(a.overlaps(b) for a in wanted for b in used if b.version == 4):
    raise SystemExit('Fixture subnet overlaps an existing network or route')
PY
[[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$project") ]] || exit 1
for p in "$restore5" "$restore6" "$restoreuser" "$restorefail"; do
 [[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$p") ]] || exit 1
 if docker volume inspect "${p}_restore_db" >/dev/null 2>&1; then exit 1; fi
done
mkdir -p "$evidence" "$work" "$work/bin" "$work/private" "$work/gnupg-root" "$work/gnupg-user" "$work/compose" "$evidence/backups"
chmod 711 "$work" "$work/bin"; chmod 700 "$work/private" "$work/gnupg-root" "$work/gnupg-user"
chown 1000:1000 "$work/gnupg-user"
for n in bootstrap auth app photo public mail authsecret csrfsecret google rate; do
 printf 'fixture-%s-0123456789012345678901234567890123456789\n' "$n" > "$work/private/$n"
done
for n in bootstrap auth app photo public mail; do
 case "$n" in bootstrap) u=homeplanner_bootstrap;; auth) u=hp_auth_login;; app) u=hp_app_login;; photo) u=hp_photo_maintenance_login;; public) u=hp_access_public_login;; mail) u=hp_mail_worker_login;; esac
 printf 'postgresql://%s:fixture-%s-0123456789012345678901234567890123456789@db:5432/homeplanner\n' "$u" "$n" > "$work/private/$n-url"
done
chown -R 1000:1000 "$work/private"; chmod 700 "$work/private"; chmod 600 "$work/private"/*
runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key 'Recovery fixture <recovery-fixture@example.invalid>' rsa2048 sign 0 >/dev/null 2>&1
fingerprint=$(runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpg --batch --with-colons --list-keys recovery-fixture@example.invalid 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')
runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$fingerprint" rsa2048 encr 0 >/dev/null 2>&1
runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpg --batch --export-secret-keys recovery-fixture@example.invalid | GNUPGHOME="$work/gnupg-root" gpg --batch --import >/dev/null 2>&1
for f in backup.sh publish-backup.py restore-drill.sh post-restore.sql restore-photos.py verify-restored-photos.py compose.yaml restore-compose.yaml; do cp "$repo/deployment/$f" "$work/compose/$f"; done
chmod 755 "$work/compose"
chmod 644 "$work/compose"/*
cat > "$work/compose/fixture.yaml" <<EOF
services:
  db:
    healthcheck: {start_period: 5m}
    volumes:
      - type: bind
        source: $work/private
        target: /fixture-private
        read_only: true
  web:
    entrypoint: ["sleep", "infinity"]
    ports: !reset []
    healthcheck: {disable: true}
networks:
  database: {ipam: {config: [{subnet: '198.18.$subnet_base.0/24'}]}}
  outbound: {internal: true, ipam: {config: [{subnet: '198.18.$((subnet_base+1)).0/24'}]}}
EOF
chmod 644 "$work/compose/fixture.yaml"
index=2
for p in "$restore5" "$restore6" "$restoreuser" "$restorefail"; do
 cat > "$work/compose/$p.yaml" <<EOF
services:
  db:
    healthcheck: {start_period: 5m}
networks:
  isolated: {internal: true, ipam: {config: [{subnet: '198.18.$((subnet_base+index)).0/24'}]}}
EOF
 chmod 644 "$work/compose/$p.yaml"
 index=$((index+1))
done
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${1:-} = compose ]]; then
 shift; args=(compose --env-file /dev/null); live=0
 while (($#)); do
  if [[ $1 = --project-name ]]; then
   shift; [[ $# -gt 0 ]] || exit 1
   if [[ $1 = homeplanner ]]; then args+=(--project-name "$HP_FIXTURE_PROJECT"); live=1
   elif [[ $1 = homeplanner-restore-rec* ]]; then project_name=$1; args+=(--project-name "$1")
   else echo 'Unexpected project rejected' >&2; exit 1; fi
  elif [[ $1 = -f && ${2:-} = compose.yaml ]]; then
   args+=(-f "$2" -f "$HP_FIXTURE_WORK/compose/fixture.yaml"); shift
  elif [[ $1 = -f && ${2:-} = restore-compose.yaml ]]; then
   [[ -n ${project_name:-} ]] || exit 1
   args+=(-f "$2" -f "$HP_FIXTURE_WORK/compose/$project_name.yaml"); shift
  elif [[ $1 = --rm ]]; then : # Retain this fixture's one-shot containers for inspection.
  else args+=("$1"); fi
  shift
 done
 joined="${args[*]}"
 if [[ $live = 1 && $joined = *pg_dump* ]]; then
  if [[ ${HP_FIXTURE_FAIL_DUMP:-0} = 1 ]]; then echo 'Injected dump failure' >&2; exit 1; fi
  if [[ ${HP_FIXTURE_PAUSE_DUMP:-0} = 1 ]]; then
   barrier=${HP_FIXTURE_BARRIER:-$HP_FIXTURE_WORK}
   touch "$barrier/dump-ready"
   for _ in $(seq 1 120); do [[ -f $barrier/dump-release ]] && break; sleep 1; done
   [[ -f $barrier/dump-release ]] || exit 1
  fi
 fi
 if [[ ${HP_FIXTURE_FAIL_RESTORE:-0} = 1 && $joined = *pg_restore\ --exit-on-error* ]]; then echo 'Injected restore failure' >&2; exit 1; fi
 exec /usr/bin/docker "${args[@]}"
fi
if [[ ${1:-} = volume && ${2:-} = inspect && ${3:-} = homeplanner-restore-rec*_restore_db ]]; then exec /usr/bin/docker "$@"; fi
echo 'Unexpected Docker command rejected' >&2; exit 1
SHIM
chmod 755 "$work/bin/docker"
export HP_FIXTURE_PROJECT=$project HP_FIXTURE_WORK=$work PATH="$work/bin:$PATH" COMPOSE_DISABLE_ENV_FILE=1
export HOMEPLANNER_BUILD_CONTEXT="$repo" HOMEPLANNER_WEB_IMAGE=$image HOMEPLANNER_ENABLE_RUNTIME=0 GOOGLE_OAUTH_CLIENT_ID=fixture.invalid
export HOMEPLANNER_PHOTO_DIR="$work/live" HOMEPLANNER_OPERATIONS_LOCK="$work/operations.lock"
export HOMEPLANNER_DB_BOOTSTRAP_PASSWORD_FILE="$work/private/bootstrap" HOMEPLANNER_MIGRATION_DATABASE_URL_FILE="$work/private/bootstrap-url"
export HOMEPLANNER_AUTH_DB_PASSWORD_FILE="$work/private/auth" HOMEPLANNER_APP_DB_PASSWORD_FILE="$work/private/app" HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD_FILE="$work/private/photo"
export HOMEPLANNER_ACCESS_PUBLIC_DB_PASSWORD_FILE="$work/private/public" HOMEPLANNER_MAIL_DB_PASSWORD_FILE="$work/private/mail"
export HOMEPLANNER_AUTH_DATABASE_URL_FILE="$work/private/auth-url" HOMEPLANNER_APP_DATABASE_URL_FILE="$work/private/app-url" HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL_FILE="$work/private/photo-url"
export HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL_FILE="$work/private/public-url" HOMEPLANNER_MAIL_DATABASE_URL_FILE="$work/private/mail-url" HOMEPLANNER_ACCESS_RATE_KEY_FILE="$work/private/rate"
export HOMEPLANNER_AUTH_SECRET_FILE="$work/private/authsecret" HOMEPLANNER_CSRF_SECRET_FILE="$work/private/csrfsecret" GOOGLE_OAUTH_CLIENT_SECRET_FILE="$work/private/google"
export HOMEPLANNER_RESTORE_DB_PASSWORD_FILE="$work/private/bootstrap" HOMEPLANNER_RESTORE_MIGRATION_URL_FILE="$work/private/bootstrap-url"
export HOMEPLANNER_RESTORE_AUTH_PASSWORD_FILE="$work/private/auth" HOMEPLANNER_RESTORE_APP_PASSWORD_FILE="$work/private/app" HOMEPLANNER_RESTORE_PHOTO_MAINTENANCE_PASSWORD_FILE="$work/private/photo"
export HOMEPLANNER_RESTORE_ACCESS_PUBLIC_PASSWORD_FILE="$work/private/public" HOMEPLANNER_RESTORE_MAIL_PASSWORD_FILE="$work/private/mail"
export HOMEPLANNER_BACKUP_ROOT="$evidence/backups" HOMEPLANNER_BACKUP_RECIPIENT=recovery-fixture@example.invalid HOMEPLANNER_EXCLUSIVE_OPERATIONS=yes GNUPGHOME="$work/gnupg-root"
mkdir -m 711 "$work/live"; install -d -m 700 -o 1000 -g 1000 "$work/live/data"
printf 'synthetic photo\n' > "$work/live/data/fixture-photo"; chown 1000:1000 "$work/live/data/fixture-photo"; chmod 600 "$work/live/data/fixture-photo"
touch "$work/live/.homeplanner-writer.lock" "$work/operations.lock"; chown 1000:1000 "$work/live/.homeplanner-writer.lock" "$work/operations.lock"; chmod 600 "$work/live/.homeplanner-writer.lock" "$work/operations.lock"
cd "$work/compose"
c=(docker compose --project-name homeplanner -f compose.yaml)
real=/usr/bin/docker
db="$project-db-1"; web="$project-web-1"
stop_owned() {
 if [[ -n ${bp:-} ]] && kill -0 "$bp" 2>/dev/null; then kill "$bp" 2>/dev/null || true; wait "$bp" 2>/dev/null || true; fi
 if [[ -n ${term_pid:-} ]] && kill -0 "$term_pid" 2>/dev/null; then kill -TERM -- "-$term_pid" 2>/dev/null || true; wait "$term_pid" 2>/dev/null || true; fi
 for n in "$web" "$db" "$restore5-db-1" "$restore6-db-1" "$restoreuser-db-1" "$restorefail-db-1"; do
  if [[ $($real inspect -f '{{.State.Running}}' "$n" 2>/dev/null || true) = true ]]; then $real stop -t 10 "$n" >/dev/null; fi
 done
 GNUPGHOME="$work/gnupg-root" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
 runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
}
trap stop_owned EXIT
"${c[@]}" up -d --no-build --pull never --wait db
"${c[@]}" --profile operations run --no-deps -T --pull never maintenance provision
# Apply only the first five exact image migrations, preserving their hashes.
"${c[@]}" --profile operations run --no-deps -T --entrypoint node maintenance -e '
const {Client}=require("pg"),{readSetting}=require("./runtime/composition.cjs"),{expectedMigrations}=require("./db/migrate.cjs");
(async()=>{const c=new Client({connectionString:await readSetting(process.env,"HOMEPLANNER_MIGRATION_DATABASE_URL")});await c.connect();try{await c.query("CREATE SCHEMA hp_migration; CREATE TABLE hp_migration.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");for(const m of (await expectedMigrations()).slice(0,5)){await c.query("BEGIN");await c.query(m.sql);await c.query("INSERT INTO hp_migration.applied(name,sha256) VALUES($1,$2)",[m.name,m.sha256]);await c.query("COMMIT")}}finally{await c.end()}})().then(()=>console.log("Five-entry fixture ledger created."),()=>{console.error("Fixture migration failed.");process.exitCode=1});'
"${c[@]}" up -d --no-build --no-deps web
sql() { $real exec "$db" psql -X -Atq -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner -c "$1"; }
roles="'hp_auth_login','hp_app_login','hp_photo_maintenance_login','hp_access_public_login','hp_mail_worker_login'"
assert_logins() { [[ $(sql "SELECT count(*) FROM pg_roles WHERE rolname IN ($roles) AND rolcanlogin=$1") = "$2" ]]; }
assert_web() { [[ $($real inspect -f '{{.State.Running}}' "$web") = "$1" ]]; }
target() { local n=$1; mkdir -m 711 "$work/$n"; install -d -m 700 -o 1000 -g 1000 "$work/$n/data"; touch "$work/$n/.homeplanner-writer.lock"; chown 1000:1000 "$work/$n/.homeplanner-writer.lock"; chmod 600 "$work/$n/.homeplanner-writer.lock"; export HOMEPLANNER_RESTORE_PHOTO_DIR="$work/$n"; }
export HOMEPLANNER_RESTORE_PROJECT=$restore5
target restore5
bash backup.sh > "$evidence/backup5.log" 2>&1
backup5=$(find "$evidence/backups" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -1)
assert_logins true 3; assert_web true
bash restore-drill.sh "$backup5" > "$evidence/restore5.log" 2>&1
[[ $($real exec "$restore5-db-1" psql -X -Atq -U homeplanner_bootstrap -d homeplanner -c "SELECT count(*) FROM pg_roles WHERE rolname IN ($roles) AND NOT rolcanlogin") = 3 ]]
echo 'PASS encrypted 001–005 capture and restore with new roles absent'
"${c[@]}" --profile operations run --no-deps -T --pull never maintenance provision-access
"${c[@]}" --profile operations run --no-deps -T --pull never maintenance migrate
"${c[@]}" --profile operations run --no-deps -T --pull never maintenance verify
photo="$work/live/data/objects/22222222-2222-4222-8222-222222222222/66666666-6666-4666-8666-666666666666/77777777-7777-4777-8777-777777777777/ready"
mkdir -p "$(dirname "$photo")"
printf 'synthetic linked photo\n' > "$photo"
chown -R 1000:1000 "$work/live/data/objects"; chmod -R go-rwx "$work/live/data/objects"
photo_hash=$(sha256sum "$photo" | cut -d' ' -f1); photo_size=$(stat -c %s "$photo")
$real exec -i "$db" psql -X -q -v ON_ERROR_STOP=1 -v fixture_hash="$photo_hash" -v fixture_size="$photo_size" -U homeplanner_bootstrap -d homeplanner >/dev/null <<'SQL'
INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ('22222222-2222-4222-8222-222222222222','Fixture','person@example.invalid',true,now());
INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ('33333333-3333-4333-8333-333333333333','synthetic-session','22222222-2222-4222-8222-222222222222',now()+interval '1 day',now());
INSERT INTO hp_app.designs(id,owner_id,kind,title,schema_version,payload) VALUES ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','shelf','Fixture',3,'{}');
INSERT INTO hp_app.design_photos(id,design_id,owner_id,raw_key,object_key,requested_mime,requested_bytes,requested_checksum,status,mime,bytes,checksum,reservation_session_id) VALUES
 ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','fixture/raw','fixture/ready','image/png',:fixture_size,:'fixture_hash','ready','image/png',:fixture_size,:'fixture_hash','33333333-3333-4333-8333-333333333333');
INSERT INTO hp_auth.verification(identifier,value,"expiresAt") VALUES ('fixture','fixture',now()+interval '1 day');
INSERT INTO hp_private.admin_grants VALUES (repeat('a',64),'22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','fixture-subject',now()+interval '1 day');
INSERT INTO hp_private.admin_challenges VALUES (repeat('b',64),'22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','fixture-subject',now()+interval '1 day',NULL);
INSERT INTO hp_private.access_challenges VALUES (repeat('c',64),'22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','fixture-subject',now()+interval '1 day',NULL);
INSERT INTO hp_private.usage_reservations(owner_id,request_id,body_hash,config_revision,status,reserved_micros) VALUES
 ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',repeat('d',64),1,'reserved',750000),
 ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',repeat('e',64),1,'ambiguous',1250000);
INSERT INTO hp_private.access_requests(id,email,name) VALUES ('11111111-1111-4111-8111-111111111111','fixture@example.invalid','Fixture');
INSERT INTO hp_private.mail_outbox(event_key,request_id,kind,message_id) VALUES ('fixture-event','11111111-1111-4111-8111-111111111111','request','fixture-message');
UPDATE hp_private.model_config SET enabled=true,adapter_id='fixture',model_id='fixture',connection_ref='fixture' WHERE singleton;
SQL
# Hold one actual client session for each login when the cold fence starts.
for pair in auth:hp_auth_login app:hp_app_login photo:hp_photo_maintenance_login public:hp_access_public_login mail:hp_mail_worker_login; do
 n=${pair%%:*}; u=${pair#*:}
 $real exec -d "$db" sh -c 'export PGPASSWORD="$(cat /fixture-private/$1)"; exec psql -h 127.0.0.1 -U "$2" -d homeplanner -c "SELECT pg_sleep(180)" >/dev/null 2>&1' sh "$n" "$u"
done
for _ in $(seq 1 30); do [[ $(sql "SELECT count(*) FROM pg_stat_activity WHERE usename IN ($roles)") = 5 ]] && break; sleep 1; done
[[ $(sql "SELECT count(*) FROM pg_stat_activity WHERE usename IN ($roles)") = 5 ]]
HP_FIXTURE_PAUSE_DUMP=1 bash backup.sh > "$evidence/backup6.log" 2>&1 & bp=$!
for _ in $(seq 1 60); do [[ -f $work/dump-ready ]] && break; kill -0 "$bp"; sleep 1; done
[[ -f $work/dump-ready ]]; assert_logins false 5; assert_web false
[[ $(sql "SELECT count(*) FROM pg_stat_activity WHERE usename IN ($roles)") = 0 ]]
for pair in auth:hp_auth_login app:hp_app_login photo:hp_photo_maintenance_login public:hp_access_public_login mail:hp_mail_worker_login; do
 n=${pair%%:*}; u=${pair#*:}
 if $real exec "$db" sh -c 'export PGPASSWORD="$(cat /fixture-private/$1)"; exec psql -h 127.0.0.1 -U "$2" -d homeplanner -c "SELECT 1" >/dev/null 2>&1' sh "$n" "$u"; then echo 'Fenced login unexpectedly connected' >&2; exit 1; fi
done
touch "$work/dump-release"; wait "$bp"; bp=; assert_logins true 5; assert_web true
backup6=$(find "$evidence/backups" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -1)
[[ $backup6 != "$backup5" ]]
echo 'PASS all five live sessions drained, reconnect denied while fenced, then restored'
export HOMEPLANNER_RESTORE_PROJECT=$restore6
target restore6
bash restore-drill.sh "$backup6" > "$evidence/restore6.log" 2>&1
grep -q 'Restored ready photos verified: 1\.' "$evidence/restore6.log"
restored=$restore6-db-1
check_restored() {
 local container=$1
 [[ $($real exec "$container" psql -X -Atq -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner -c "SELECT count(*) FROM pg_roles WHERE rolname IN ($roles) AND NOT rolcanlogin") = 5 ]]
 [[ $($real exec "$container" psql -X -Atq -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner -c "SELECT (SELECT count(*) FROM hp_private.mail_outbox WHERE status='queued') || ':' || (SELECT count(*) FROM hp_auth.session) || ':' || (SELECT count(*) FROM hp_auth.verification) || ':' || (SELECT count(*) FROM hp_private.admin_grants) || ':' || (SELECT count(*) FROM hp_private.admin_challenges) || ':' || (SELECT count(*) FROM hp_private.access_challenges) || ':' || (SELECT count(*) FROM hp_private.model_config WHERE enabled) || ':' || (SELECT sum(reserved_micros) FROM hp_private.usage_reservations WHERE status IN ('reserved','ambiguous'))") = 1:0:0:0:0:0:0:2000000 ]]
}
check_restored "$restored"; assert_web true
echo 'PASS root restore keeps five logins and model disabled; queued mail retained'
export HOMEPLANNER_RESTORE_PROJECT=$restoreuser
target restore6user
runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" bash restore-drill.sh "$backup6" > "$evidence/restore6-user.log" 2>&1
grep -q 'Restored ready photos verified: 1\.' "$evidence/restore6-user.log"
check_restored "$restoreuser-db-1"
echo 'PASS UID 1000 operator restore and application photo ownership'
# A missing 006 login must fail before capture and must not resume web.
sql 'ALTER ROLE hp_mail_worker_login RENAME TO hp_fixture_mail_missing' >/dev/null
if bash backup.sh > "$evidence/missing-role.log" 2>&1; then echo 'Missing 006 role was accepted' >&2; exit 1; fi
assert_web false; assert_logins true 4
sql 'ALTER ROLE hp_fixture_mail_missing RENAME TO hp_mail_worker_login' >/dev/null
"${c[@]}" start web >/dev/null
# Failure after fencing must leave all roles disabled and web stopped.
if HP_FIXTURE_FAIL_DUMP=1 bash backup.sh > "$evidence/fail-dump.log" 2>&1; then echo 'Injected dump failure accepted' >&2; exit 1; fi
assert_logins false 5; assert_web false
sql 'ALTER ROLE hp_auth_login LOGIN; ALTER ROLE hp_app_login LOGIN; ALTER ROLE hp_photo_maintenance_login LOGIN; ALTER ROLE hp_access_public_login LOGIN; ALTER ROLE hp_mail_worker_login LOGIN' >/dev/null
"${c[@]}" start web >/dev/null
echo 'PASS missing role and post-fence failure leave web stopped; fenced roles stay disabled'
export HOMEPLANNER_RESTORE_PROJECT=$restorefail
target restorefail
if HP_FIXTURE_FAIL_RESTORE=1 bash restore-drill.sh "$backup6" > "$evidence/fail-restore.log" 2>&1; then echo 'Injected restore failure accepted' >&2; exit 1; fi
[[ $($real exec "$restorefail-db-1" psql -X -Atq -U homeplanner_bootstrap -d homeplanner -c "SELECT count(*) FROM pg_roles WHERE rolname IN ($roles) AND NOT rolcanlogin") = 5 ]]
assert_web false
echo 'PASS failed restore leaves all provisioned logins disabled and web stopped'
echo 'PASS native synthetic recovery fixture completed'

# Separate local producer/publication checks. These Linux fixture directories
# are on one filesystem; only encrypted copies are retained in D: evidence.
root_pub="/home/jacoba/$task-public-root"; user_pub="/home/jacoba/$task-public-user"
[[ ! -e $root_pub && ! -e $user_pub ]] || exit 1
mkdir -m 700 "$root_pub"; install -d -m 700 "$root_pub/staging" "$root_pub/included" "$root_pub/included/homeplanner" "$root_pub/term"
mkdir -m 711 "$user_pub"; install -d -m 700 -o 1000 -g 1000 "$user_pub/staging" "$user_pub/included" "$user_pub/included/homeplanner"
"${c[@]}" start web >/dev/null
export HOMEPLANNER_BACKUP_ROOT="$root_pub/staging" HOMEPLANNER_PUBLISH_INCLUDED_ROOT="$root_pub/included" HOMEPLANNER_PUBLISH_ROOT="$root_pub/included/homeplanner"
export HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_root_nonce_20261108
bash backup.sh > "$evidence/publication-root.log" 2>&1
check_receipt() {
 local log=$1 expected_nonce=$2 target=$3 line label actual stamp started ended manifest marker extra
 line=$(grep '^HOMEPLANNER_BACKUP_RECEIPT_V1 ' "$log")
 read -r label actual stamp started ended manifest marker extra <<<"$line"
 [[ $label = HOMEPLANNER_BACKUP_RECEIPT_V1 && $actual = "$expected_nonce" && $stamp =~ ^[0-9]{8}T[0-9]{6}Z$ && $started =~ ^[0-9]+$ && $ended =~ ^[0-9]+$ && $ended -ge $started && $manifest =~ ^[0-9a-f]{64}$ && $marker = COMPLETE && -z ${extra:-} ]]
 [[ -d "$target/$stamp" && ! -L "$target/$stamp" && $(stat -c %a "$target/$stamp") = 500 ]]
 [[ $(find "$target/$stamp" -mindepth 1 -maxdepth 1 -type f | wc -l) = 4 ]]
 [[ $(find "$target/$stamp" -mindepth 1 -maxdepth 1 ! -type f | wc -l) = 0 ]]
 [[ -z $(find "$target/$stamp" -mindepth 1 -maxdepth 1 -type f ! -perm 400 -print -quit) ]]
 [[ $(sha256sum "$target/$stamp/SHA256SUMS" | cut -d' ' -f1) = "$manifest" ]]
 (cd "$target/$stamp" && sha256sum -c SHA256SUMS >/dev/null)
}
check_receipt "$evidence/publication-root.log" "$HOMEPLANNER_BACKUP_INVOCATION_NONCE" "$HOMEPLANNER_PUBLISH_ROOT"
[[ -z $(find "$root_pub/staging" -mindepth 1 -maxdepth 1 -print -quit) ]]
mkdir "$evidence/publication-root-ciphertexts"
cp -R "$root_pub/included/homeplanner/." "$evidence/publication-root-ciphertexts/"
echo 'PASS root publication: four verified read-only files, atomic same-filesystem move and bound receipt'

# A failed encrypted dump must leave the previously published tree unchanged.
sleep 1
export HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_fail_nonce_20261108
if HP_FIXTURE_FAIL_DUMP=1 bash backup.sh > "$evidence/publication-fail.log" 2>&1; then exit 1; fi
grep -q 'Injected dump failure' "$evidence/publication-fail.log"
! grep -q '^HOMEPLANNER_BACKUP_RECEIPT_V1 ' "$evidence/publication-fail.log"
[[ $(find "$HOMEPLANNER_PUBLISH_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l) = 1 ]]
[[ -n $(find "$root_pub/staging" -mindepth 1 -maxdepth 1 -type d -print -quit) ]]
assert_logins false 5; assert_web false
sql 'ALTER ROLE hp_auth_login LOGIN; ALTER ROLE hp_app_login LOGIN; ALTER ROLE hp_photo_maintenance_login LOGIN; ALTER ROLE hp_access_public_login LOGIN; ALTER ROLE hp_mail_worker_login LOGIN' >/dev/null
"${c[@]}" start web >/dev/null

# Send TERM to the entire dedicated fixture process group while pg_dump is
# paused after fencing. This is not a production latency or SIGKILL test.
sleep 1
export HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_term_nonce_20261108
HP_FIXTURE_PAUSE_DUMP=1 HP_FIXTURE_BARRIER="$root_pub/term" setsid bash backup.sh > "$evidence/publication-term.log" 2>&1 & term_pid=$!
for _ in $(seq 1 120); do [[ -f $root_pub/term/dump-ready ]] && break; kill -0 "$term_pid"; sleep 1; done
[[ -f $root_pub/term/dump-ready ]]
kill -TERM -- "-$term_pid"
for _ in $(seq 1 100); do kill -0 "$term_pid" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$term_pid" 2>/dev/null; then kill -KILL -- "-$term_pid" || true; wait "$term_pid" || true; echo 'TERM did not finish within test grace' >&2; exit 1; fi
term_rc=0; wait "$term_pid" || term_rc=$?
term_pid=
[[ $term_rc -ne 0 ]]
grep -q 'Backup interrupted' "$evidence/publication-term.log"
! grep -q '^HOMEPLANNER_BACKUP_RECEIPT_V1 ' "$evidence/publication-term.log"
[[ $(find "$HOMEPLANNER_PUBLISH_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l) = 1 ]]
assert_logins false 5; assert_web false
sql 'ALTER ROLE hp_auth_login LOGIN; ALTER ROLE hp_app_login LOGIN; ALTER ROLE hp_photo_maintenance_login LOGIN; ALTER ROLE hp_access_public_login LOGIN; ALTER ROLE hp_mail_worker_login LOGIN' >/dev/null
"${c[@]}" start web >/dev/null
echo 'PASS publication failure and process-group TERM leave no new published directory or receipt; roles and web stay fenced'

export HOMEPLANNER_BACKUP_ROOT="$user_pub/staging" HOMEPLANNER_PUBLISH_INCLUDED_ROOT="$user_pub/included" HOMEPLANNER_PUBLISH_ROOT="$user_pub/included/homeplanner"
export HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_user_nonce_20261108
if runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" bash backup.sh > "$evidence/publication-user.log" 2>&1; then echo 'Unprivileged direct publication unexpectedly accepted' >&2; exit 1; fi
grep -q 'Direct sealed publication requires a reviewed privileged interface' "$evidence/publication-user.log"
! grep -q '^HOMEPLANNER_BACKUP_RECEIPT_V1 ' "$evidence/publication-user.log"
[[ -z $(find "$user_pub/staging" -mindepth 1 -maxdepth 1 -print -quit) ]]
[[ -z $(find "$user_pub/included/homeplanner" -mindepth 1 -print -quit) ]]
assert_logins true 5; assert_web true
echo 'PASS UID 1000 direct publication rejected before stopping web or fencing logins'
echo 'PASS native synthetic publication checks completed; owned containers will be stopped, not deleted'
