#!/usr/bin/env bash
# Synthetic process-only check. Leaves its task-owned fixture for retirement.
set -Eeuo pipefail
base=${1:?Pass an absolute task-owned directory}
[[ "$base" = /* && -d "$base" ]] || exit 1
root="$base/flock-$BASHPID-$(date +%s%N)"
mkdir -m 700 "$root"
lock="$root/writer.lock"
ready="$root/ready"
: >"$lock"
child=''
cleanup() { if [[ -n "$child" ]]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; }
trap cleanup EXIT
sh -c 'exec 9>>"$1"; flock -n 9; : >"$2"; exec sleep 300' _ "$lock" "$ready" &
child=$!
for _ in {1..100}; do [[ -e "$ready" ]] && break; kill -0 "$child" 2>/dev/null || exit 1; sleep 0.05; done
[[ -e "$ready" ]] || exit 1
if flock -n "$lock" true; then echo 'Concurrent lock unexpectedly succeeded.' >&2; exit 1; fi
kill "$child"
wait "$child" 2>/dev/null || true
child=''
flock -n "$lock" true
echo 'Exclusive inherited lock and release after process termination passed.'
