#!/usr/bin/env bash
# Negative tests only; requires a synthetic GPG keyring from the native fixture.
set -Eeuo pipefail
root=${1:?new Linux fixture directory}; evidence=${2:?new evidence directory}; keyring=${3:?synthetic GPG keyring}
[[ $root = /* && $evidence = /* && $keyring = /* && ! -e $root && ! -e $evidence && -d $keyring ]] || exit 1
mkdir -p "$root/included/homeplanner" "$root/included/staging" "$root/outside" "$root/photos" "$root/bin" "$evidence"
touch "$root/operations.lock"
cat > "$root/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo 'Unexpected Docker call during publication preflight' >&2
exit 99
EOF
chmod 755 "$root/bin/docker"
export PATH="$root/bin:$PATH" GNUPGHOME="$keyring"
export HOMEPLANNER_BACKUP_RECIPIENT=recovery-fixture@example.invalid HOMEPLANNER_OPERATIONS_LOCK="$root/operations.lock"
export HOMEPLANNER_PHOTO_DIR="$root/photos" HOMEPLANNER_EXCLUSIVE_OPERATIONS=yes
export HOMEPLANNER_PUBLISH_INCLUDED_ROOT="$root/included" HOMEPLANNER_PUBLISH_ROOT="$root/included/homeplanner"
export HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_preflight_nonce_20261108
export HOMEPLANNER_BACKUP_ROOT="$root/included/staging"
if bash deployment/backup.sh > "$evidence/inside.log" 2>&1; then exit 1; fi
grep -q 'Staging must be outside the included tree' "$evidence/inside.log"
[[ -z $(find "$root/included/staging" -mindepth 1 -print -quit) ]]
export HOMEPLANNER_BACKUP_ROOT="$root/outside" HOMEPLANNER_BACKUP_INVOCATION_NONCE=short
if bash deployment/backup.sh > "$evidence/nonce.log" 2>&1; then exit 1; fi
grep -q 'Publication requires absolute roots and an invocation nonce' "$evidence/nonce.log"
[[ -z $(find "$root/outside" -mindepth 1 -print -quit) ]]
shm=$(mktemp -d /dev/shm/hp-publication-preflight-XXXXXXXX)
if [[ $(stat -c %d "$shm") = "$(stat -c %d "$root/included/homeplanner")" ]]; then echo 'Separate filesystem required for this test' >&2; exit 1; fi
export HOMEPLANNER_BACKUP_ROOT="$shm" HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_preflight_nonce_20261108
if bash deployment/backup.sh > "$evidence/cross-device.log" 2>&1; then exit 1; fi
grep -q 'Staging and publication must be on the same filesystem' "$evidence/cross-device.log"
[[ -z $(find "$shm" -mindepth 1 -print -quit) ]]
if grep -q 'Unexpected Docker call' "$evidence"/*.log; then exit 1; fi
user_root="/home/jacoba/$(basename "$root")-uid"
user_keyring="${keyring%/*}/gnupg-user"
[[ ! -e $user_root && -d $user_keyring ]] || exit 1
install -d -m 700 -o 1000 -g 1000 "$user_root" "$user_root/staging" "$user_root/included" "$user_root/included/homeplanner" "$user_root/photos" "$user_root/bin"
touch "$user_root/operations.lock"; chown 1000:1000 "$user_root/operations.lock"; chmod 600 "$user_root/operations.lock"
cp "$root/bin/docker" "$user_root/bin/docker"; chmod 755 "$user_root/bin/docker"
if runuser -u jacoba -- env PATH="$user_root/bin:$PATH" GNUPGHOME="$user_keyring" HOMEPLANNER_BACKUP_RECIPIENT=recovery-fixture@example.invalid HOMEPLANNER_OPERATIONS_LOCK="$user_root/operations.lock" HOMEPLANNER_PHOTO_DIR="$user_root/photos" HOMEPLANNER_EXCLUSIVE_OPERATIONS=yes HOMEPLANNER_BACKUP_ROOT="$user_root/staging" HOMEPLANNER_PUBLISH_INCLUDED_ROOT="$user_root/included" HOMEPLANNER_PUBLISH_ROOT="$user_root/included/homeplanner" HOMEPLANNER_BACKUP_INVOCATION_NONCE=fixture_preflight_nonce_20261108 bash deployment/backup.sh > "$evidence/uid.log" 2>&1; then exit 1; fi
grep -q 'Direct sealed publication requires a reviewed privileged interface' "$evidence/uid.log"
[[ -z $(find "$user_root/staging" -mindepth 1 -print -quit) && -z $(find "$user_root/included/homeplanner" -mindepth 1 -print -quit) ]]
if grep -q 'Unexpected Docker call' "$evidence/uid.log"; then exit 1; fi
echo 'PASS invalid nonce, included-tree staging, cross-filesystem staging and UID direct publication rejected before Docker'
