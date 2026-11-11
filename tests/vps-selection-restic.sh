#!/usr/bin/env bash
# Uses one fresh synthetic native directory. Leaves every fixture in place.
set -Eeuo pipefail
repo=${1:?absolute checkout}
binary=${2:?verified restic binary}
work=${3:?new native fixture directory}
[[ $(id -u) = 0 && $repo = /* && $binary = /* && $work = /home/jacoba/* && ! -e $work ]] || exit 1
install -d -m 700 -o 1000 -g 1000 "$work" "$work/data"
unshare --mount --fork bash -c '
  set -Eeuo pipefail
  mount --make-rprivate /
  mount -t tmpfs -o size=8M,nosuid,nodev tmpfs /srv
  chmod 755 /srv
  mkdir -p /srv/backups/consistent-data
  mount --bind "$3/data" /srv/backups/consistent-data
  exec runuser -u jacoba -- python3 -B "$1/tests/vps-selection-restic.py" "$1" "$2" "$3"
' _ "$repo" "$binary" "$work"
