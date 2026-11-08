#!/usr/bin/env python3
"""Restore a decrypted tar stream into an empty private directory, verifying
the separately encrypted NUL-delimited sha256sum manifest. Never overwrites."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

def relative(name):
    if name in ('.', './'):
        return ''
    if name.startswith('./'):
        name = name[2:]
    p = PurePosixPath(name)
    if not name or name.startswith('/') or any(x in ('', '.', '..') for x in p.parts) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,1024}', name):
        raise ValueError('Unsafe photo path')
    return '/'.join(p.parts)

def read_manifest(path):
    proc = subprocess.Popen(['gpg', '--batch', '--decrypt', path], stdout=subprocess.PIPE)
    data = proc.stdout.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        proc.kill(); proc.wait()
        raise ValueError('Manifest too large')
    if proc.wait() != 0:
        raise ValueError('Manifest decryption failed')
    records = data.split(b'\0')
    if records[-1] != b'':
        raise ValueError('Malformed manifest')
    expected = {}
    for record in records[:-1]:
        if len(record) < 68 or record[64:66] != b'  ' or not re.fullmatch(b'[0-9a-f]{64}', record[:64]):
            raise ValueError('Malformed manifest record')
        name = relative(record[66:].decode('utf-8', 'strict'))
        if not name or name in expected:
            raise ValueError('Duplicate photo entry')
        expected[name] = record[:64].decode('ascii')
    return expected

def restore(root, expected, stream):
    root = Path(root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir() or any(root.iterdir()):
        raise ValueError('An empty, private restore directory is required')
    if os.name != 'nt' and root.stat().st_mode & 0o077:
        raise ValueError('Restore directory must be private')
    if os.name != 'nt' and os.geteuid() not in (0, 1000):
        raise ValueError('Restore operator must be root or application UID 1000')
    def private_directory(directory):
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Unsafe directory')
        if os.name != 'nt':
            os.chown(directory, 1000, 1000)
            os.chmod(directory, 0o700)
    def directories(directory):
        private_directory(root)
        current = root
        for part in directory.relative_to(root).parts:
            current = current / part
            current.mkdir(mode=0o700, exist_ok=True)
            private_directory(current)
    directories(root)
    seen = set()
    with tarfile.open(fileobj=stream, mode='r|*') as archive:
        for member in archive:
            rel = relative(member.name)
            if not rel:
                if not member.isdir(): raise ValueError('Invalid root entry')
                continue
            target = root.joinpath(*rel.split('/'))
            if member.isdir():
                directories(target)
                if target.is_symlink() or not target.is_dir(): raise ValueError('Unsafe directory')
                continue
            if not member.isfile() or member.issym() or member.islnk() or rel not in expected or rel in seen or member.size < 0 or member.size > 10 * 1024 * 1024:
                raise ValueError('Invalid photo entry')
            directories(target.parent)
            if any(p.is_symlink() for p in [target.parent, *target.parent.parents] if p != root.parent): raise ValueError('Unsafe directory')
            source = archive.extractfile(member)
            if source is None: raise ValueError('Unreadable photo entry')
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            digest = hashlib.sha256()
            with os.fdopen(os.open(target, flags, 0o600), 'wb') as dest:
                if os.name != 'nt':
                    os.fchown(dest.fileno(), 1000, 1000)
                    os.fchmod(dest.fileno(), 0o600)
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk: break
                    digest.update(chunk); dest.write(chunk)
                dest.flush(); os.fsync(dest.fileno())
            if digest.hexdigest() != expected[rel]: raise ValueError('Photo checksum mismatch')
            seen.add(rel)
    if seen != set(expected): raise ValueError('Photo manifest mismatch')
    return len(seen)

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3: raise ValueError('Expected destination and encrypted manifest')
        count = restore(sys.argv[1], read_manifest(sys.argv[2]), sys.stdin.buffer)
        print(f'Photo archive verified: {count} files.')
    except Exception:
        print('Photo restore failed; retain and inspect the isolated destination.', file=sys.stderr)
        sys.exit(1)
