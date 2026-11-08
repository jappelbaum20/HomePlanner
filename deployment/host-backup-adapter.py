#!/usr/bin/python3
"""Fixed Stage 1 host binding for the reviewed cold-capture producer."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

BASE = Path('/srv/homeplanner/backup-adapter')
CONFIG = Path('/srv/homeplanner/config/backup-adapter.json')
PARENT = Path('/srv/backups/consistent-data/homeplanner')
FILES = {
    BASE / 'backup.sh': '6021ed5124771384914837b0d95327968f208993f5a076bc7feb45ad7c6e0f06',
    BASE / 'publish-backup.py': '41fdee2abb5cdb2dc3363dd6d047665837c11614284324be2c8998343da9c651',
    BASE / 'backup_publication.py': 'f8e5b3f637f392488a43cad52d80c3dd6f4c3d528c57f738186cb7492d936bf4',
    BASE / 'validate-backup.py': '9c7c8ef7cc3693d9985089446adc4e321a70d897ce966160b2c47dfe73217166',
    BASE / 'host-health-adapter.py': 'fb48fa31f209e63671a775636afcb7a98728aac2886dc6caf81bf3732aa334c0',
    Path('/srv/homeplanner/config/compose.yaml'): '076667e534be074ae98166cbfba98fa27cc40d7e7a8892ffcbbf1053b2f28a47',
    Path('/srv/homeplanner/config/compose.ai.yaml'): '0d2c5d95bd388e7402d35e4e8228ae4d6f3485ca27d45d90e43df9db2172dfee',
    Path('/srv/homeplanner/config/stage1-67d4295-recovery/private-compose.yaml'): 'fb324166d49316d76c86b7324fcfea093551c26b52a240f7e6e28a1ff73365b4',
}
COMPOSE = ['/usr/bin/docker', 'compose', '--env-file', '/dev/null', '--project-name', 'homeplanner',
           '-f', '/srv/homeplanner/config/compose.yaml', '-f', '/srv/homeplanner/config/compose.ai.yaml',
           '-f', '/srv/homeplanner/config/stage1-67d4295-recovery/private-compose.yaml',
           '--profile', 'operations']


def trusted(path, directory=False, private=False):
    """Check names and modes, not a defense against the trusted owner's races."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('non-canonical path')
    for part in [*reversed(path.parents), path]:
        st = part.lstat()
        if stat.S_ISLNK(st.st_mode) or st.st_uid not in (0, 1000) or st.st_mode & 0o022:
            raise ValueError('untrusted path ownership or mode')
        if part != path and not stat.S_ISDIR(st.st_mode):
            raise ValueError('non-directory ancestor')
    st = path.lstat()
    if directory:
        if not stat.S_ISDIR(st.st_mode) or (private and (st.st_uid != 1000 or stat.S_IMODE(st.st_mode) != 0o700)):
            raise ValueError('invalid private directory')
    elif not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or (private and (st.st_uid != 1000 or stat.S_IMODE(st.st_mode) != 0o600)):
        raise ValueError('invalid regular file')


def read_config():
    trusted(CONFIG, private=True)
    if CONFIG.stat().st_size > 8192:
        raise ValueError('configuration too large')
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    keys = {'google_client_id', 'provider_connection_version', 'provider_validated_connections', 'backup_recipient_fingerprint'}
    if not isinstance(cfg, dict) or set(cfg) != keys or any(not isinstance(v, str) for v in cfg.values()):
        raise ValueError('configuration keys or types differ')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,150}\.apps\.googleusercontent\.com', cfg['google_client_id']):
        raise ValueError('invalid client ID')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', cfg['provider_connection_version']):
        raise ValueError('invalid provider connection version')
    val = cfg['provider_validated_connections']
    if len(val) > 4096 or not isinstance(json.loads(val), list) or any(ord(c) < 32 for c in val):
        raise ValueError('invalid provider validation registry')
    if not re.fullmatch(r'(?:[A-F0-9]{40}|[A-F0-9]{64})', cfg['backup_recipient_fingerprint']):
        raise ValueError('recipient must be a full uppercase fingerprint')
    return cfg


def environment(cfg, nonce):
    # No inherited variables, shell fragments, arbitrary executable or path arguments.
    return {
        'PATH': '/usr/bin:/bin', 'HOME': '/home/jacob', 'LC_ALL': 'C',
        'DOCKER_CONFIG': '/srv/homeplanner/config/backup-docker-config',
        'DOCKER_HOST': 'unix:///var/run/docker.sock',
        'GNUPGHOME': '/srv/homeplanner/config/backup-gnupg',
        'HOMEPLANNER_HOST_ADAPTER': 'stage1-v1', 'HOMEPLANNER_EXCLUSIVE_OPERATIONS': 'yes',
        'HOMEPLANNER_ENABLE_RUNTIME': '1', 'HOMEPLANNER_PHOTO_DIR': '/srv/homeplanner/photos',
        'HOMEPLANNER_OPERATIONS_LOCK': '/srv/homeplanner/operations.lock',
        'HOMEPLANNER_BACKUP_ROOT': str(PARENT), 'HOMEPLANNER_PUBLISH_ROOT': str(PARENT),
        'HOMEPLANNER_PUBLISH_INCLUDED_ROOT': '/srv/backups/consistent-data',
        'HOMEPLANNER_BACKUP_INVOCATION_NONCE': nonce,
        'HOMEPLANNER_BACKUP_RECIPIENT': cfg['backup_recipient_fingerprint'],
        'GOOGLE_OAUTH_CLIENT_ID': cfg['google_client_id'],
        'OPENAI_CONNECTION_VERSION': cfg['provider_connection_version'],
        'OPENAI_VALIDATED_CONNECTIONS': cfg['provider_validated_connections'],
        'HOMEPLANNER_DB_BOOTSTRAP_PASSWORD_FILE': '/srv/homeplanner/secrets/db/db-bootstrap-password',
        'HOMEPLANNER_MIGRATION_DATABASE_URL_FILE': '/srv/homeplanner/secrets/operations/migration-database-url',
        'HOMEPLANNER_AUTH_DB_PASSWORD_FILE': '/srv/homeplanner/secrets/operations/auth-db-password',
        'HOMEPLANNER_APP_DB_PASSWORD_FILE': '/srv/homeplanner/secrets/operations/app-db-password',
        'HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD_FILE': '/srv/homeplanner/secrets/operations/photo-maintenance-db-password',
        'HOMEPLANNER_AUTH_DATABASE_URL_FILE': '/srv/homeplanner/secrets/runtime/auth-database-url',
        'HOMEPLANNER_APP_DATABASE_URL_FILE': '/srv/homeplanner/secrets/runtime/app-database-url',
        'HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL_FILE': '/srv/homeplanner/secrets/runtime/photo-maintenance-database-url',
        'HOMEPLANNER_AUTH_SECRET_FILE': '/srv/homeplanner/secrets/runtime/auth-secret',
        'HOMEPLANNER_CSRF_SECRET_FILE': '/srv/homeplanner/secrets/runtime/csrf-secret',
        'GOOGLE_OAUTH_CLIENT_SECRET_FILE': '/srv/homeplanner/secrets/runtime/google-client-secret',
        'HOMEPLANNER_PROVIDER_API_KEY_FILE': '/srv/homeplanner/secrets/runtime/provider-api-key',
    }


def preflight(env):
    trusted(PARENT, directory=True, private=True)
    trusted(Path(env['GNUPGHOME']), directory=True, private=True)
    trusted(Path(env['DOCKER_CONFIG']), directory=True, private=True)
    trusted(Path(env['HOMEPLANNER_OPERATIONS_LOCK']), private=True)
    trusted(Path(env['HOMEPLANNER_PHOTO_DIR']), directory=True)
    trusted(Path(env['HOMEPLANNER_PHOTO_DIR']) / '.homeplanner-writer.lock', private=True)
    for path, expected in FILES.items():
        trusted(path)
        if path.stat().st_size > 5 * 1024 * 1024:
            raise ValueError('pinned input too large: ' + str(path))
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('pinned input changed: ' + str(path))
    # config --services reveals names only. Never emit effective environment or config.
    r = subprocess.run(COMPOSE + ['config', '--no-env-resolution', '--services'], env=env, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False)
    if r.returncode or set(r.stdout.decode('ascii').splitlines()) != {'db', 'web', 'maintenance', 'photo-read'}:
        raise ValueError('Compose configuration or services unavailable')
    r = subprocess.run(['/usr/bin/python3', '-I', '-B', str(BASE / 'host-health-adapter.py')],
                       env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=20, check=False)
    if r.returncode:
        raise ValueError('pre-capture health check failed')


def run_capture(env, limit=120, grace=30):
    child = None
    received = []

    def forward(signum, _frame):
        if not received:
            received.append(signum)

    previous = {s: signal.signal(s, forward) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    deadline = time.monotonic() + limit
    terminating_at = None
    timed_out = False
    leaked = False

    def group_exists():
        try:
            os.killpg(child.pid, 0)
            return True
        except ProcessLookupError:
            return False

    def terminate_group(sig):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass

    try:
        if received:
            return 128 + received[0]
        child = subprocess.Popen(['/usr/bin/bash', '--noprofile', '--norc', str(BASE / 'backup.sh')],
                                 env=env, stdin=subprocess.DEVNULL, start_new_session=True)
        while True:
            now = time.monotonic()
            if terminating_at is None and (received or now >= deadline):
                timed_out = not received
                terminating_at = now + grace
                terminate_group(signal.SIGTERM)
            status = child.poll()
            if status is not None:
                if terminating_at is None and group_exists():
                    leaked = True
                    terminating_at = now + grace
                    terminate_group(signal.SIGTERM)
                if not group_exists():
                    if received:
                        return 128 + received[0]
                    if timed_out:
                        return 124
                    if leaked:
                        return 1
                    return status if status >= 0 else 128 - status
            if terminating_at is not None and now >= terminating_at:
                terminate_group(signal.SIGKILL)
                child.wait()
                return 128 + received[0] if received else (124 if timed_out else 1)
            time.sleep(0.1)
    except BaseException:
        if child is not None:
            terminate_group(signal.SIGTERM)
            try:
                child.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                pass
            # Also settle the group if its leader exited before descendants.
            terminate_group(signal.SIGKILL)
            child.wait()
        raise
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main(argv):
    if os.geteuid() != 1000 or len(argv) != 1 or not re.fullmatch(r'[0-9a-f]{32}', argv[0]):
        print('HomePlanner capture: UID 1000 and one 32-lowercase-hex nonce required.', file=sys.stderr)
        return 2
    phase = 'preflight'
    try:
        cfg = read_config()
        env = environment(cfg, argv[0])
        preflight(env)
        phase = 'capture supervision'
        return run_capture(env)
    except (OSError, ValueError, UnicodeError, subprocess.TimeoutExpired) as exc:
        print('HomePlanner ' + phase + ' failed: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
