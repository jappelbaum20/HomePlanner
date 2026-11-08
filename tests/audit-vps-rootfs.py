#!/usr/bin/env python3
"""Read-only audit of a BuildKit root-filesystem tar, not image metadata."""
from pathlib import PurePosixPath
import sys
import tarfile

try:
    paths = set()
    with tarfile.open(sys.argv[1], 'r:') as archive:
        for member in archive:
            name = member.name.removeprefix('./').lstrip('/')
            if not name.startswith('app/'): continue
            parts = PurePosixPath(name).parts
            if any(part in ('.git', '.env', 'house-data.js') or part.startswith('.env.') for part in parts): raise ValueError('Forbidden app path')
            if name.startswith(('app/photos/', 'app/private-backup', 'app/node_modules/@supabase/')): raise ValueError('Forbidden app path')
            paths.add(name)
    required = ['app/runtime/server.cjs', 'app/runtime/composition.cjs', 'app/runtime/storage-safety.cjs', 'app/server/photo-maintenance.cjs',
                'app/db/migrations/004_photo_maintenance.sql', 'app/api/designs/[id].js', 'app/dist-vps/index.html',
                'app/deployment/volume-lock.sh', 'app/node_modules/sharp/package.json']
    if any(name not in paths for name in required): raise ValueError('Required runtime path missing')
    if not any(name.startswith(('app/node_modules/@img/sharp-linux-x64/', 'app/node_modules/@img/sharp-linux-arm64/')) for name in paths):
        raise ValueError('Linux native image package missing')
    print(f'Root filesystem path audit passed ({len(paths)} app entries). Image configuration and layers were not checked.')
except Exception as error:
    print(f'Root filesystem audit failed: {error}', file=sys.stderr)
    sys.exit(1)
