#!/usr/bin/env python3
"""Offline tests; never contact a Docker daemon or a host service."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load('host_backup', ROOT / 'deployment/host-backup-adapter.py')
health = load('host_health', ROOT / 'deployment/host-health-adapter.py')


class HostAdapters(unittest.TestCase):
    def setUp(self):
        self.cfg = {'google_client_id': '123-fixture.apps.googleusercontent.com',
                    'provider_connection_version': 'version-1',
                    'provider_validated_connections': '[]',
                    'backup_recipient_fingerprint': 'A' * 40}

    def test_exact_clean_environment(self):
        with mock.patch.dict(os.environ, {'BASH_ENV': '/tmp/evil', 'DOCKER_HOST': 'bad',
                                          'COMPOSE_FILE': 'bad', 'HOMEPLANNER_PHOTO_DIR': '/bad'}):
            env = backup.environment(self.cfg, 'a' * 32)
        for key in ('BASH_ENV', 'COMPOSE_FILE'):
            self.assertNotIn(key, env)
        self.assertEqual(env['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        self.assertEqual(env['HOMEPLANNER_PHOTO_DIR'], '/srv/homeplanner/photos')
        self.assertEqual(env['HOMEPLANNER_BACKUP_ROOT'], env['HOMEPLANNER_PUBLISH_ROOT'])
        self.assertEqual(backup.COMPOSE[2:6], ['--env-file', '/dev/null', '--project-name', 'homeplanner'])
        self.assertEqual(backup.COMPOSE.count('-f'), 3)

    def test_invalid_invocations_never_preflight(self):
        with mock.patch.object(backup.os, 'geteuid', return_value=1000), mock.patch.object(backup, 'preflight') as pre:
            for args in ([], ['ABC'], ['a' * 32, 'extra'], ['a' * 31 + ';']):
                self.assertEqual(backup.main(args), 2)
            pre.assert_not_called()
        with mock.patch.object(backup.os, 'geteuid', return_value=0):
            self.assertEqual(backup.main(['a' * 32]), 2)

    def test_nonsecret_config_validation(self):
        # read_text/stat are stubbed: no private host configuration is used.
        class FakePath:
            def stat(self):
                return type('Stat', (), {'st_size': 100})()
            def read_text(self, **_):
                return json.dumps(value)
        with mock.patch.object(backup, 'CONFIG', FakePath()), mock.patch.object(backup, 'trusted'):
            value = dict(self.cfg)
            self.assertEqual(backup.read_config(), value)
            for field, bad in [('google_client_id', '$(id).apps.googleusercontent.com'),
                               ('provider_connection_version', 'x;id'),
                               ('provider_validated_connections', '{}'),
                               ('backup_recipient_fingerprint', 'not-a-fingerprint')]:
                value = dict(self.cfg, **{field: bad})
                with self.assertRaises(ValueError):
                    backup.read_config()
            value = dict(self.cfg, extra='no')
            with self.assertRaises(ValueError):
                backup.read_config()

    def test_preflight_fails_closed(self):
        with mock.patch.object(backup, 'trusted', side_effect=ValueError('missing parent')), \
             mock.patch.object(backup.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                backup.preflight(backup.environment(self.cfg, 'b' * 32))
            run.assert_not_called()

        env = backup.environment(self.cfg, 'b' * 32)
        result = subprocess.CompletedProcess([], 0, b'db\nweb\n', b'')
        with mock.patch.object(backup, 'trusted'), mock.patch.object(backup, 'FILES', {}), \
             mock.patch.object(backup.subprocess, 'run', return_value=result) as run:
            with self.assertRaises(ValueError):
                backup.preflight(env)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][-3:], ['config', '--no-env-resolution', '--services'])
        results = [subprocess.CompletedProcess([], 0, b'db\nweb\nmaintenance\nphoto-read\n', b''),
                   subprocess.CompletedProcess([], 1, b'', b'')]
        with mock.patch.object(backup, 'trusted'), mock.patch.object(backup, 'FILES', {}), \
             mock.patch.object(backup.subprocess, 'run', side_effect=results):
            with self.assertRaises(ValueError):
                backup.preflight(env)

    def test_health_requires_expected_image_networks_db_and_fresh_probe(self):
        web = ['webid', health.IMAGE, True, 'healthy', 'started', 0, set(health.NETWORKS), {'homeplanner-web'}]
        db = ['dbid', health.DB_IMAGE, True, 'healthy', 'started', 0, {'homeplanner_database'}, set()]
        with mock.patch.object(health, 'inspect', side_effect=[web, db, web, db]), \
             mock.patch.object(health, 'command', return_value='') as cmd:
            health.check(time.monotonic() + 10)
            self.assertEqual(cmd.call_args.args[0][:3], ['exec', 'homeplanner-web-1', 'node'])
            self.assertIn('/health/ready', cmd.call_args.args[0][-1])
        for change in (['webid', 'sha256:wrong', True, 'healthy', 'started', 0, set(health.NETWORKS), {'homeplanner-web'}],
                       ['webid', health.IMAGE, True, 'healthy', 'started', 0, {'homeplanner_database'}, {'homeplanner-web'}],
                       ['webid', health.IMAGE, False, 'healthy', 'started', 0, set(health.NETWORKS), {'homeplanner-web'}],
                       ['webid', health.IMAGE, True, 'healthy', 'started', 0, set(health.NETWORKS), set()]):
            with mock.patch.object(health, 'inspect', side_effect=[change, db]), \
                 mock.patch.object(health, 'command') as cmd:
                with self.assertRaises(RuntimeError):
                    health.check(time.monotonic() + 10)
                cmd.assert_not_called()
        with mock.patch.object(health, 'inspect', side_effect=[web, db]), \
             mock.patch.object(health, 'command', side_effect=RuntimeError('503')):
            with self.assertRaises(RuntimeError):
                health.check(time.monotonic() + 10)
        with mock.patch.object(health, 'inspect', side_effect=[web, db, web, db[:5] + [1] + db[6:]]), \
             mock.patch.object(health, 'command', return_value=''):
            with self.assertRaises(RuntimeError):
                health.check(time.monotonic() + 10)

    def test_health_timeout_and_no_response_body(self):
        with mock.patch.object(health.subprocess, 'run', side_effect=subprocess.TimeoutExpired('docker', 1)):
            with self.assertRaises(RuntimeError):
                health.command(['exec', 'web'], time.monotonic() + 1)
        self.assertNotIn('console.log', health.PROBE)
        self.assertIn('r.resume()', health.PROBE)
        with mock.patch.object(health.os, 'geteuid', return_value=1000), \
             mock.patch.object(health, 'check', side_effect=RuntimeError('failed')):
            self.assertEqual(health.main([]), 1)

    def test_real_process_timeout_and_descendant_group(self):
        # Fixture directory is supplied and retained by the caller; no cleanup is done.
        fixture = Path(os.environ['HOMEPLANNER_ADAPTER_TEST_DIR'])
        fixture.mkdir(parents=True, exist_ok=True)
        script = fixture / 'backup.sh'
        pidfile = fixture / 'child.pid'
        script.write_text("trap '' TERM\nsleep 300 &\necho $! > \"$PIDFILE\"\nwait\n", encoding='utf-8')
        with mock.patch.object(backup, 'BASE', fixture):
            start = time.monotonic()
            result = backup.run_capture({'PATH': '/usr/bin:/bin', 'PIDFILE': str(pidfile)}, limit=0.4, grace=0.4)
        self.assertEqual(result, 124)
        self.assertLess(time.monotonic() - start, 4)
        pid = int(pidfile.read_text())
        # A killed orphan may temporarily be a zombie until init reaps it.
        stat_path = Path('/proc') / str(pid) / 'stat'
        if stat_path.exists():
            self.assertEqual(stat_path.read_text().split()[2], 'Z')

    def test_producer_uses_all_fixed_compose_files_with_fake_commands(self):
        fixture = Path(os.environ['HOMEPLANNER_ADAPTER_TEST_DIR']) / ('capture-' + str(time.time_ns()))
        for sub in ('bin', 'photo', 'captures'):
            (fixture / sub).mkdir(parents=True)
        (fixture / 'photo/.homeplanner-writer.lock').touch()
        (fixture / 'operations.lock').touch()
        fake = {
            'docker': '''#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
case " $* " in
  *' ps -q --status running web '*) if [[ ! -e "$FAKE_STOPPED" ]]; then echo web-id; fi;;
  *' stop -t 20 web '*) touch "$FAKE_STOPPED";;
  *' pg_dump '*) printf 'synthetic-dump';;
  *' exec -T db '*) cat >/dev/null;;
  *' run --rm '*) printf 'synthetic-photo';;
esac
''',
            'gpg': '#!/bin/bash\ncase " $* " in *" --list-keys "*) exit 0;; esac\ncat\n',
            'df': '#!/bin/bash\nprintf "Avail\\n32212254720\\n"\n',
            'stat': '#!/bin/bash\necho 0\n',
            'find': '#!/bin/bash\nexit 0\n',
        }
        for name, content in fake.items():
            path = fixture / 'bin' / name
            path.write_text(content, encoding='utf-8')
            path.chmod(0o755)
        env = {'PATH': str(fixture / 'bin') + ':/usr/bin:/bin',
               'HOMEPLANNER_HOST_ADAPTER': 'stage1-v1', 'HOMEPLANNER_EXCLUSIVE_OPERATIONS': 'yes',
               'HOMEPLANNER_BACKUP_ROOT': str(fixture / 'captures'), 'HOMEPLANNER_BACKUP_RECIPIENT': 'fixture',
               'HOMEPLANNER_PHOTO_DIR': str(fixture / 'photo'), 'HOMEPLANNER_OPERATIONS_LOCK': str(fixture / 'operations.lock'),
               'FAKE_LOG': str(fixture / 'docker.log'), 'FAKE_STOPPED': str(fixture / 'stopped')}
        result = subprocess.run(['/usr/bin/bash', str(ROOT / 'deployment/backup.sh')], env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        phases = result.stderr.decode()
        for phase in ('stop_web','fence_roles','database_dump','photo_capture','photo_hash','restore_logins','restart_web'):
            self.assertIn('HOMEPLANNER_PHASE ' + phase, phases)
        calls = (fixture / 'docker.log').read_text().splitlines()
        self.assertGreaterEqual(len(calls), 7)
        for line in calls:
            self.assertTrue(line.startswith('compose --env-file /dev/null --project-name homeplanner '))
            for path in ('/srv/homeplanner/config/compose.yaml', '/srv/homeplanner/config/compose.ai.yaml',
                         '/srv/homeplanner/config/stage1-67d4295-recovery/private-compose.yaml'):
                self.assertIn('-f ' + path, line)
            self.assertNotIn(' up ', ' ' + line + ' ')
        self.assertIn('start web', calls[-1])

    def test_pinned_producer_matches_reviewed_bytes(self):
        import hashlib
        self.assertEqual(backup.FILES[backup.BASE / 'backup.sh'], hashlib.sha256((ROOT / 'deployment/backup.sh').read_bytes()).hexdigest())

    def test_signal_at_spawn_boundary_is_captured(self):
        fixture = Path(os.environ['HOMEPLANNER_ADAPTER_TEST_DIR']) / ('spawn-' + str(time.time_ns()))
        fixture.mkdir(parents=True)
        (fixture / 'backup.sh').write_text('sleep 30', encoding='utf-8')
        real_popen = subprocess.Popen
        children = []
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            os.kill(os.getpid(), signal.SIGTERM)
            return child
        with mock.patch.object(backup, 'BASE', fixture), mock.patch.object(backup.subprocess, 'Popen', side_effect=spawn):
            result = backup.run_capture({'PATH':'/usr/bin:/bin'}, limit=3, grace=.2)
        self.assertEqual(result,143)
        self.assertIsNotNone(children[0].poll())

    def test_signal_propagation_overrides_child_status(self):
        fixture = Path(os.environ['HOMEPLANNER_ADAPTER_TEST_DIR']) / ('signal-' + str(time.time_ns()))
        fixture.mkdir(parents=True, exist_ok=True)
        (fixture / 'backup.sh').write_text('echo ready > "$READYFILE"\ntrap "exit 0" TERM\nsleep 300 &\nwait\n', encoding='utf-8')
        ready = fixture / 'ready'
        code = ("import importlib.util,sys;from pathlib import Path;"
                "s=importlib.util.spec_from_file_location('b',sys.argv[1]);"
                "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
                "m.BASE=Path(sys.argv[2]);"
                "sys.exit(m.run_capture({'PATH':'/usr/bin:/bin','READYFILE':sys.argv[3]},30,.4))")
        parent = subprocess.Popen([sys.executable, '-B', '-c', code, str(ROOT / 'deployment/host-backup-adapter.py'),
                                   str(fixture), str(ready)])
        deadline = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(ready.exists())
        parent.send_signal(signal.SIGTERM)
        self.assertEqual(parent.wait(timeout=4), 143)


if __name__ == '__main__':
    unittest.main()
