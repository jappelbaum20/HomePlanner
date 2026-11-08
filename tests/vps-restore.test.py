import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('restore_photos', Path(__file__).parents[1] / 'deployment' / 'restore-photos.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(os.environ['HOMEPLANNER_E_TEST_ROOT'])
root.mkdir(parents=True, exist_ok=True)

def archive(name, payload):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w') as tar:
        item = tarfile.TarInfo(name); item.size = len(payload)
        tar.addfile(item, io.BytesIO(payload))
    result.seek(0)
    return result

class RestoreTests(unittest.TestCase):
    def directory(self):
        return Path(tempfile.mkdtemp(prefix='restore-', dir=root))

    def test_verified_archive(self):
        dest = self.directory(); payload = b'fictional photo bytes'
        name = 'objects/user/design/photo/ready'
        self.assertEqual(module.restore(dest, {name: hashlib.sha256(payload).hexdigest()}, archive('./' + name, payload)), 1)
        self.assertEqual((dest / name).read_bytes(), payload)
        if os.name != 'nt':
            for entry in [dest, *dest.rglob('*')]:
                self.assertEqual((entry.stat().st_uid, entry.stat().st_gid), (1000, 1000))
                self.assertEqual(entry.stat().st_mode & 0o777, 0o700 if entry.is_dir() else 0o600)

    def test_rejects_escape_and_mismatch(self):
        with self.assertRaises(ValueError):
            module.restore(self.directory(), {'x': '0' * 64}, archive('../escape', b'x'))
        with self.assertRaises(ValueError):
            module.restore(self.directory(), {'x': '0' * 64}, archive('x', b'x'))

    def test_rejects_unlisted_and_overwrites(self):
        with self.assertRaises(ValueError):
            module.restore(self.directory(), {}, archive('x', b'x'))
        dest = self.directory(); (dest / 'existing').write_text('keep')
        with self.assertRaises(ValueError):
            module.restore(dest, {}, archive('x', b'x'))
        self.assertEqual((dest / 'existing').read_text(), 'keep')

    def test_rejects_archive_symlink(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as tar:
            item = tarfile.TarInfo('link'); item.type = tarfile.SYMTYPE; item.linkname = '/tmp'
            tar.addfile(item)
        data.seek(0)
        with self.assertRaises(ValueError):
            module.restore(self.directory(), {'link': '0' * 64}, data)

if __name__ == '__main__': unittest.main()
