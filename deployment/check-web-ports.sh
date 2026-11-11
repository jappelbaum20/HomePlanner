#!/bin/sh
# Deploy check: the live web container must publish no host port. The ingress overlay resets the
# example port mapping (`ports: !reset []`); if it is missing from the live stack, the app would be
# reachable by the host directly and could be sent a forged X-Forwarded-For.
set -eu
container=${1:?Pass the web container name}
published=$(docker inspect --format '{{range $p,$b := .NetworkSettings.Ports}}{{if $b}}{{$p}} {{end}}{{end}}{{range $p,$b := .HostConfig.PortBindings}}{{if $b}}{{$p}} {{end}}{{end}}' "$container")
if [ -z "$published" ]; then echo "PASS: $container publishes no host port"
else echo "FAIL: $container publishes host ports: $published" >&2; exit 1; fi
