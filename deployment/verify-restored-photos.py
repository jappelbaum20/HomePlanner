#!/usr/bin/env python3
"""Validate ready live database photo rows from CSV stdin against restored bytes."""
import csv
import hashlib
from pathlib import Path
import re
import sys
import uuid

try:
    root = Path(sys.argv[1]).resolve(strict=True)
    count = 0
    for owner, design, photo, size, checksum in csv.reader(sys.stdin):
        for item in (owner, design, photo):
            if str(uuid.UUID(item)) != item: raise ValueError('Invalid identity')
        if not re.fullmatch(r'[0-9a-f]{64}', checksum): raise ValueError('Invalid checksum')
        target = root / 'objects' / owner / design / photo / 'ready'
        if any(p.is_symlink() for p in [target, *target.parents] if p != root.parent): raise ValueError('Unsafe path')
        if not target.is_file() or target.stat().st_size != int(size): raise ValueError('Photo size mismatch')
        with target.open('rb') as photo_file:
            digest = hashlib.file_digest(photo_file, 'sha256').hexdigest()
        if digest != checksum: raise ValueError('Photo checksum mismatch')
        count += 1
    print(f'Restored ready photos verified: {count}.')
except Exception:
    print('Restored database and photos do not match.', file=sys.stderr)
    sys.exit(1)
