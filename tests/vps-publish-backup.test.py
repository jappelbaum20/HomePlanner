#!/usr/bin/env python3
"""Native filesystem tests; fixture is retained under HOMEPLANNER_E_TEST_ROOT."""
import datetime
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'deployment'))
import backup_publication as bp
spec = importlib.util.spec_from_file_location('validator', REPO / 'deployment/validate-backup.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
root = Path(os.environ['HOMEPLANNER_E_TEST_ROOT'])
root.mkdir(mode=0o700, parents=False, exist_ok=False)


class PublicationTests(unittest.TestCase):
    def fixture(self):
        import tempfile
        parent = Path(tempfile.mkdtemp(prefix='case-', dir=root))
        nonce = os.urandom(16).hex()
        start = int(time.time())
        name = datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + nonce
        stage = parent / ('.incomplete-' + nonce)
        stage.mkdir(mode=0o700)
        records = []
        for artifact in bp.ARTIFACTS:
            data = ('synthetic:' + artifact).encode()
            (stage / artifact).write_bytes(data)
            records.append(hashlib.sha256(data).hexdigest() + '  ' + artifact + '\n')
        (stage / 'SHA256SUMS').write_text(''.join(records))
        return parent, nonce, start, name, stage

    def publish(self, data):
        parent, nonce, start, name, _ = data
        digest = bp.prepare(str(parent), nonce, name, start, start, bp.LEDGER6)
        self.assertEqual(digest, bp.publish(str(parent), nonce, name))
        log = parent.parent / ('receipt-' + nonce)
        log.write_text(f'HOMEPLANNER_BACKUP_RECEIPT_V2 {nonce} {name} {start} {start} {digest} COMPLETE\n')
        log.chmod(0o600)
        return log

    def selection(self, data, log, status=0, nonce=None, before=None, age=120):
        parent, original, start, _, _ = data
        return validator.validate(str(parent), nonce or original, start if before is None else before, age, status, str(log))

    def test_uid_modes_receipt_and_cli_output(self):
        data = self.fixture(); log = self.publish(data)
        parent, nonce, start, name, stage = data
        self.assertFalse(stage.exists())
        self.assertEqual((parent / name).stat().st_mode & 0o777, 0o500)
        self.assertEqual({p.name for p in (parent / name).iterdir()}, set(bp.FILES))
        self.assertTrue(all((p.stat().st_mode & 0o777) == 0o400 for p in (parent / name).iterdir()))
        expected = self.selection(data, log)
        result = subprocess.run([sys.executable, '-B', str(REPO / 'deployment/validate-backup.py'), '--parent', str(parent), '--nonce', nonce, '--not-before', str(start), '--max-age', '120', '--process-status', '0', '--receipt-log', str(log)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), expected)
        self.assertEqual(len(expected), 5)

    def test_no_replace_preserves_both(self):
        data = self.fixture(); parent, nonce, start, name, stage = data
        bp.prepare(str(parent), nonce, name, start, start, bp.LEDGER5)
        target = parent / name; target.mkdir(mode=0o700); (target / 'sentinel').write_text('unchanged')
        with self.assertRaises(FileExistsError): bp.publish(str(parent), nonce, name)
        self.assertEqual((target / 'sentinel').read_text(), 'unchanged')
        self.assertTrue(stage.is_dir())

    def test_bad_checksum_symlink_and_extra_rejected(self):
        for fault in ('checksum', 'symlink', 'extra'):
            data = self.fixture(); parent, nonce, start, name, stage = data
            if fault == 'checksum': (stage / bp.ARTIFACTS[0]).write_bytes(b'changed')
            if fault == 'extra': (stage / 'hidden-extra').write_bytes(b'x')
            if fault == 'symlink':
                target = parent / 'retained'; (stage / bp.ARTIFACTS[0]).rename(target)
                (stage / bp.ARTIFACTS[0]).symlink_to(target)
            with self.assertRaises((ValueError, OSError)): bp.prepare(str(parent), nonce, name, start, start, bp.LEDGER6)
            self.assertFalse((parent / name).exists())

    def test_validator_rejects_invalid_freshness_nonce_status_and_receipt(self):
        data = self.fixture(); log = self.publish(data)
        for kwargs in ({'status': 1}, {'nonce': '0' * 32}, {'before': data[2] + 1}, {'age': 0}):
            with self.assertRaises(ValueError): self.selection(data, log, **kwargs)
        with mock.patch.object(validator.time, 'time', return_value=data[2] + 121):
            with self.assertRaises(ValueError): self.selection(data, log)
        log.write_text('')
        with self.assertRaises(ValueError): self.selection(data, log)

    def test_validator_rejects_postpublication_modes_content_and_links(self):
        for fault in ('directory-mode', 'file-mode', 'checksum', 'extra', 'symlink'):
            data = self.fixture(); log = self.publish(data)
            target = data[0] / data[3]; file = target / bp.ARTIFACTS[0]
            if fault == 'directory-mode': target.chmod(0o700)
            if fault == 'file-mode': file.chmod(0o600)
            if fault == 'checksum': file.chmod(0o600); file.write_bytes(b'bad'); file.chmod(0o400)
            if fault in ('extra', 'symlink'):
                target.chmod(0o700)
                if fault == 'extra': (target / 'extra').write_bytes(b'x')
                else:
                    kept = data[0] / 'kept'; file.rename(kept); file.symlink_to(kept)
                target.chmod(0o500)
            with self.assertRaises((ValueError, OSError)): self.selection(data, log)

    def test_crash_after_rename_before_parent_fsync_is_unselected(self):
        data = self.fixture(); parent, nonce, start, name, stage = data
        bp.prepare(str(parent), nonce, name, start, start, bp.LEDGER6)
        real_fsync = os.fsync
        ps = parent.stat()
        def fail_parent(fd):
            s = os.fstat(fd)
            if (s.st_dev, s.st_ino) == (ps.st_dev, ps.st_ino): raise OSError('injected before parent fsync')
            return real_fsync(fd)
        with mock.patch.object(bp.os, 'fsync', side_effect=fail_parent):
            with self.assertRaises(OSError): bp.publish(str(parent), nonce, name)
        self.assertFalse(stage.exists()); self.assertTrue((parent / name).is_dir())
        log = parent.parent / ('crash-' + nonce); log.write_text(''); log.chmod(0o600)
        with self.assertRaises(ValueError): self.selection(data, log, status=1)
        with self.assertRaises(ValueError): self.selection(data, log, status=0)

    def test_ancestor_symlink_and_untrusted_parent(self):
        data = self.fixture(); parent = data[0]
        link = root / ('link-' + data[1]); link.symlink_to(parent, target_is_directory=True)
        with self.assertRaises((OSError, ValueError)): bp.preflight(str(link), data[1])
        parent.chmod(0o770)
        with self.assertRaises(ValueError): bp.preflight(str(parent), data[1])


if __name__ == '__main__':
    print(f'Native test uid={os.getuid()} euid={os.geteuid()} fixture={root}', flush=True)
    unittest.main(verbosity=2)
