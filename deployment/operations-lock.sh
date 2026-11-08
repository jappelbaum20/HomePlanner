#!/bin/sh
set -eu
lock=/run/homeplanner-operations.lock
test -f "$lock" && test ! -L "$lock"
exec 9<"$lock"
flock -n 9 || { echo 'Another HomePlanner operation holds the lock.' >&2; exit 1; }
exec node /app/runtime/maintenance.cjs "$@"
