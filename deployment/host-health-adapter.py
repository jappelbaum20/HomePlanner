#!/usr/bin/python3
"""Fresh, bounded Stage 1 host health observation; no response body is logged."""
import json
import os
import subprocess
import sys
import time

DOCKER = '/usr/bin/docker'
IMAGE = 'sha256:69c64ebb7e333d5ad8248ec0c1b66e5f56cdb70c54afbc4cca16c71a0b1fc045'
DB_IMAGE = 'sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994'
NETWORKS = {'homeplanner_database', 'homeplanner_outbound', 'homeplanner_ingress'}
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/home/jacob',
       'DOCKER_CONFIG': '/srv/homeplanner/config/backup-docker-config',
       'DOCKER_HOST': 'unix:///var/run/docker.sock', 'LC_ALL': 'C'}
PROBE = ("const h=require('http');const q=h.get('http://127.0.0.1:3107/health/ready',"
         "r=>{r.resume();process.exit(r.statusCode===200?0:1)});"
         "q.setTimeout(2000,()=>q.destroy());q.on('error',()=>process.exit(1));")


def command(args, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('deadline')
    try:
        r = subprocess.run([DOCKER, *args], env=ENV, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=remaining, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError('docker unavailable or timed out') from exc
    if r.returncode != 0 or len(r.stdout) > 32768:
        raise RuntimeError('docker check failed')
    return r.stdout.decode('utf-8', errors='strict').strip()


def inspect(name, deadline):
    # Only explicitly selected fields: never inspect container environment.
    fmt = '{{json .Id}}\t{{json .Image}}\t{{json .State.Running}}\t{{json .State.Health.Status}}\t{{json .State.StartedAt}}\t{{json .RestartCount}}\t{{json .NetworkSettings.Networks}}'
    parts = command(['inspect', '--format', fmt, name], deadline).split('\t')
    if len(parts) != 7:
        raise RuntimeError('invalid inspect result')
    fields = [json.loads(value) for value in parts]
    if not isinstance(fields[6], dict):
        raise RuntimeError('invalid network result')
    ingress = fields[6].get('homeplanner_ingress') or {}
    if not isinstance(ingress, dict) or not isinstance(ingress.get('Aliases') or [], list):
        raise RuntimeError('invalid ingress aliases')
    return fields[:6] + [set(fields[6]), set(ingress.get('Aliases') or [])]


def check(deadline):
    web = inspect('homeplanner-web-1', deadline)
    db = inspect('homeplanner-db-1', deadline)
    if web[1:4] != [IMAGE, True, 'healthy'] or web[6] != NETWORKS or 'homeplanner-web' not in web[7]:
        raise RuntimeError('web identity, running state, health or networks differ')
    if db[1:4] != [DB_IMAGE, True, 'healthy']:
        raise RuntimeError('database identity, running state or health differs')
    command(['exec', 'homeplanner-web-1', 'node', '-e', PROBE], deadline)
    if inspect('homeplanner-web-1', deadline) != web or inspect('homeplanner-db-1', deadline) != db:
        raise RuntimeError('container changed during probe')


def main(argv):
    if argv or os.geteuid() != 1000:
        print('HomePlanner health: invalid arguments or UID.', file=sys.stderr)
        return 2
    try:
        check(time.monotonic() + 15)
    except (RuntimeError, ValueError, UnicodeError, KeyError, TypeError) as exc:
        print('HomePlanner health failed: ' + str(exc), file=sys.stderr)
        print(f'HOMEPLANNER_HEALTH_V1 {int(time.time())} FAIL')
        return 1
    print(f'HOMEPLANNER_HEALTH_V1 {int(time.time())} OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
