#!/usr/bin/env bash
# Exercises the current backup script with synthetic Docker output and real GPG.
# No Docker daemon is contacted. The private synthetic keyring is retained.
set -Eeuo pipefail
repo=${1:?absolute checkout}
work=${2:?new native fixture directory}
keyring=${3:?existing synthetic user keyring}
owner=${4:-jacoba}
[[ $(id -u) = 0 && $repo = /* && ! -e $work && -d $keyring ]] || exit 1
case "$owner:$work" in
  jacoba:/home/jacoba/*) group=jacoba; runner=(runuser -u jacoba --) ;;
  root:/root/*) group=root; runner=() ;;
  *) exit 1 ;;
esac
install -d -m 700 -o "$owner" -g "$group" "$work" "$work/bin" "$work/included" "$work/included/homeplanner"
install -d -m 755 -o 0 -g 0 "$work/photos"
install -m 600 -o "$owner" -g "$group" /dev/null "$work/photos/.homeplanner-writer.lock"
install -m 600 -o "$owner" -g "$group" /dev/null "$work/operations.lock"
cat > "$work/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
args="$*"
printf '%s\n' "$args" >> "$FAKE_DOCKER_LOG"
case "$args" in
  *' ps -q --status running web'*) [[ -e $FAKE_STOPPED ]] || echo fixture-web ;;
  *' stop -t 20 web'*) : > "$FAKE_STOPPED" ;;
  *' start web'*) [[ ${FAKE_FAIL_START:-0} != 1 ]] ;;
  *'string_agg(name'*) echo '001_auth.sql,002_business.sql,003_photos.sql,004_photo_maintenance.sql,005_shelf_documents.sql,006_access_requests.sql' ;;
  *'pg_dump'*) printf 'synthetic-database-dump\n' ;;
  *' run --rm '*) printf 'synthetic-photo-data\n' ;;
  *' exec -T db '*) cat >/dev/null ;;
  *) echo 'unexpected synthetic Docker command' >&2; exit 97 ;;
esac
DOCKER
chown "$owner:$group" "$work/bin/docker"
chmod 755 "$work/bin/docker"
nonce=0123456789abcdef0123456789abcdef
start=$(date -u +%s)
common=(PATH="$work/bin:$PATH" GNUPGHOME="$keyring" HOMEPLANNER_BACKUP_RECIPIENT=recovery-fixture@example.invalid
  HOMEPLANNER_EXCLUSIVE_OPERATIONS=yes HOMEPLANNER_OPERATIONS_LOCK="$work/operations.lock"
  HOMEPLANNER_PHOTO_DIR="$work/photos" HOMEPLANNER_BACKUP_ROOT="$work/included/homeplanner"
  HOMEPLANNER_PUBLISH_INCLUDED_ROOT="$work/included" HOMEPLANNER_PUBLISH_ROOT="$work/included/homeplanner"
  FAKE_DOCKER_LOG="$work/docker.log" FAKE_STOPPED="$work/stopped")
"${runner[@]}" env "${common[@]}" HOMEPLANNER_BACKUP_INVOCATION_NONCE="$nonce" bash "$repo/deployment/backup.sh" > "$work/success.log" 2>&1
chown "$owner:$group" "$work/success.log"; chmod 600 "$work/success.log"
"${runner[@]}" python3 -B "$repo/deployment/validate-backup.py" --parent "$work/included/homeplanner" --nonce "$nonce" --not-before "$start" --max-age 600 --process-status 0 --receipt-log "$work/success.log" > "$work/selected.txt"
[[ $(wc -l < "$work/selected.txt") = 5 ]]
grep -q 'start web' "$work/docker.log"
# A failed start leaves a visible sealed capture but cannot yield a selection.
mv "$work/stopped" "$work/stopped-first"
nonce=abcdef0123456789abcdef0123456789
start=$(date -u +%s)
set +e
"${runner[@]}" env "${common[@]}" HOMEPLANNER_BACKUP_INVOCATION_NONCE="$nonce" FAKE_FAIL_START=1 bash "$repo/deployment/backup.sh" > "$work/failure.log" 2>&1
status=$?
set -e
chown "$owner:$group" "$work/failure.log"; chmod 600 "$work/failure.log"
[[ $status != 0 ]]
if "${runner[@]}" python3 -B "$repo/deployment/validate-backup.py" --parent "$work/included/homeplanner" --nonce "$nonce" --not-before "$start" --max-age 600 --process-status "$status" --receipt-log "$work/failure.log" > "$work/rejected.txt" 2> "$work/rejected.log"; then exit 1; fi
[[ ! -s $work/rejected.txt ]]
echo "PASS current backup capture path as $owner, real synthetic-key encryption, publication/validator and failed start rejection; Docker and database simulated"
