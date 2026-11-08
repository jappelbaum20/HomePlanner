#!/usr/bin/env bash
# Resume only the publication tests against a retained synthetic native fixture.
# Arguments: checkout, new evidence directory, retained fixture suffix, new run suffix.
set -Eeuo pipefail
umask 077
repo=${1:?checkout}; evidence=${2:?new evidence directory}; suffix=${3:?fixture suffix}; run_suffix=${4:?new run suffix}
[[ $(id -u) = 0 && $repo = /* && $evidence = /* && ! -e $evidence && $suffix =~ ^[a-z0-9]{1,8}$ && $run_suffix =~ ^[a-z0-9]{1,8}$ ]] || exit 1
work=/mnt/wsl/hpstage2recovery20261108$suffix
project=hpstage2recovery20261108$suffix
task=hpstage2publication20261108$run_suffix
db="$project-db-1"; web="$project-web-1"; real=/usr/bin/docker
[[ -d $work/compose && -d $work/private && -d $work/gnupg-root && -d $work/gnupg-user ]] || exit 1
[[ $($real inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$db") = "$project" && $($real inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$web") = "$project" ]] || exit 1
cmp -s "$repo/deployment/backup.sh" "$work/compose/backup.sh"
cmp -s "$repo/deployment/publish-backup.py" "$work/compose/publish-backup.py"
[[ $(grep -c '^# Separate local producer/publication checks' "$repo/tests/vps-recovery-native.sh") = 1 ]]
extracted="$work/publication-retry-$run_suffix.sh"
[[ ! -e $extracted ]] || exit 1
awk '/^# Separate local producer\/publication checks/{copy=1} copy' "$repo/tests/vps-recovery-native.sh" > "$extracted"
mkdir -p "$evidence"
export HP_FIXTURE_PROJECT=$project HP_FIXTURE_WORK=$work PATH="$work/bin:$PATH" COMPOSE_DISABLE_ENV_FILE=1 DOCKER_CONFIG="$work/docker-config"
export HOMEPLANNER_BUILD_CONTEXT="$repo" HOMEPLANNER_WEB_IMAGE=sha256:a6b9c622e03f58e45577da3939de1fb52493fdb43c0fd97f5107553db58c53c5 HOMEPLANNER_ENABLE_RUNTIME=0 GOOGLE_OAUTH_CLIENT_ID=fixture.invalid
export HOMEPLANNER_PHOTO_DIR="$work/live" HOMEPLANNER_OPERATIONS_LOCK="$work/operations.lock"
export HOMEPLANNER_DB_BOOTSTRAP_PASSWORD_FILE="$work/private/bootstrap" HOMEPLANNER_MIGRATION_DATABASE_URL_FILE="$work/private/bootstrap-url"
export HOMEPLANNER_AUTH_DB_PASSWORD_FILE="$work/private/auth" HOMEPLANNER_APP_DB_PASSWORD_FILE="$work/private/app" HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD_FILE="$work/private/photo"
export HOMEPLANNER_ACCESS_PUBLIC_DB_PASSWORD_FILE="$work/private/public" HOMEPLANNER_MAIL_DB_PASSWORD_FILE="$work/private/mail"
export HOMEPLANNER_AUTH_DATABASE_URL_FILE="$work/private/auth-url" HOMEPLANNER_APP_DATABASE_URL_FILE="$work/private/app-url" HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL_FILE="$work/private/photo-url"
export HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL_FILE="$work/private/public-url" HOMEPLANNER_MAIL_DATABASE_URL_FILE="$work/private/mail-url" HOMEPLANNER_ACCESS_RATE_KEY_FILE="$work/private/rate"
export HOMEPLANNER_AUTH_SECRET_FILE="$work/private/authsecret" HOMEPLANNER_CSRF_SECRET_FILE="$work/private/csrfsecret" GOOGLE_OAUTH_CLIENT_SECRET_FILE="$work/private/google"
export HOMEPLANNER_BACKUP_RECIPIENT=recovery-fixture@example.invalid HOMEPLANNER_EXCLUSIVE_OPERATIONS=yes GNUPGHOME="$work/gnupg-root"
cd "$work/compose"
c=(docker compose --project-name homeplanner -f compose.yaml)
sql() { $real exec "$db" psql -X -Atq -v ON_ERROR_STOP=1 -U homeplanner_bootstrap -d homeplanner -c "$1"; }
roles="'hp_auth_login','hp_app_login','hp_photo_maintenance_login','hp_access_public_login','hp_mail_worker_login'"
assert_logins() { [[ $(sql "SELECT count(*) FROM pg_roles WHERE rolname IN ($roles) AND rolcanlogin=$1") = "$2" ]]; }
assert_web() { [[ $($real inspect -f '{{.State.Running}}' "$web") = "$1" ]]; }
stop_owned() {
 if [[ -n ${term_pid:-} ]] && kill -0 "$term_pid" 2>/dev/null; then kill -TERM -- "-$term_pid" 2>/dev/null || true; wait "$term_pid" 2>/dev/null || true; fi
 for n in "$web" "$db"; do
  if [[ $($real inspect -f '{{.State.Running}}' "$n" 2>/dev/null || true) = true ]]; then $real stop -t 10 "$n" >/dev/null; fi
 done
 GNUPGHOME="$work/gnupg-root" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
 runuser -u jacoba -- env GNUPGHOME="$work/gnupg-user" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
}
trap stop_owned EXIT
$real start "$db" >/dev/null
for _ in $(seq 1 180); do if $real exec "$db" pg_isready -U homeplanner_bootstrap -d homeplanner >/dev/null 2>&1; then break; fi; sleep 2; done
$real exec "$db" pg_isready -U homeplanner_bootstrap -d homeplanner >/dev/null
[[ $(sql 'SELECT count(*) FROM hp_migration.applied') = 6 ]]
assert_logins true 5
# This exact, auditable tail contains only fixture publication tests.
source "$extracted"
