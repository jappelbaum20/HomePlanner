#!/bin/sh
# Keep descriptor 9 open across exec. The kernel releases this advisory lock
# only after the last reference to the open file description is closed.
set -eu
: "${HOMEPLANNER_PHOTO_VOLUME_ROOT:?}"
case "$HOMEPLANNER_PHOTO_VOLUME_ROOT" in /*) ;; *) exit 1;; esac
test -d "$HOMEPLANNER_PHOTO_VOLUME_ROOT" && test ! -L "$HOMEPLANNER_PHOTO_VOLUME_ROOT"
test "$(stat -c %u "$HOMEPLANNER_PHOTO_VOLUME_ROOT")" = 0
test -z "$(find "$HOMEPLANNER_PHOTO_VOLUME_ROOT" -maxdepth 0 -perm /022 -print -quit)"
lock="$HOMEPLANNER_PHOTO_VOLUME_ROOT/.homeplanner-writer.lock"
test -f "$lock" && test ! -L "$lock"
umask 077
exec 9>>"$lock"
flock -n 9 || { echo 'Photo volume is already locked.' >&2; exit 1; }
export HOMEPLANNER_VOLUME_LOCK_FD=9
exec "$@"
