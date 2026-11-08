#!/usr/bin/env python3
"""Read-only OCI layout audit: layer digests, app paths and runtime user."""
import hashlib
import json
from pathlib import PurePosixPath
import sys
import tarfile

def blob(archive, digest):
    algorithm, value = digest.split(':', 1)
    if algorithm != 'sha256' or len(value) != 64: raise ValueError('Invalid digest')
    return archive.extractfile('blobs/sha256/' + value)

try:
    with tarfile.open(sys.argv[1], 'r:') as outer:
        index = json.load(outer.extractfile('index.json'))
        candidates = [x for x in index['manifests'] if x.get('platform', {}).get('os', 'linux') == 'linux' and x.get('annotations', {}).get('vnd.docker.reference.type') != 'attestation-manifest']
        if len(candidates) != 1: raise ValueError('Unexpected image manifest count')
        manifest = json.load(blob(outer, candidates[0]['digest']))
        config = json.load(blob(outer, manifest['config']['digest']))
        if config.get('os') != 'linux' or config['config'].get('User') != '1000:1000': raise ValueError('Unexpected runtime platform or user')
        paths = set()
        for layer in manifest['layers']:
            digest = hashlib.sha256()
            with blob(outer, layer['digest']) as source:
                while data := source.read(1024 * 1024): digest.update(data)
            if digest.hexdigest() != layer['digest'].split(':', 1)[1]: raise ValueError('Layer digest mismatch')
            with blob(outer, layer['digest']) as source, tarfile.open(fileobj=source, mode='r|*') as stream:
                for member in stream:
                    name = member.name.removeprefix('./').lstrip('/')
                    if not name.startswith('app/'): continue
                    parts = PurePosixPath(name).parts
                    if any(part in ('.git', '.env', 'house-data.js') or part.startswith('.env.') for part in parts): raise ValueError('Forbidden app path in layer')
                    if name.startswith(('app/photos/', 'app/private-backup', 'app/node_modules/@supabase/')): raise ValueError('Forbidden app path in layer')
                    paths.add(name)
        required = ['app/runtime/server.cjs', 'app/runtime/composition.cjs', 'app/runtime/storage-safety.cjs', 'app/server/photo-maintenance.cjs',
                    'app/db/migrations/004_photo_maintenance.sql', 'app/api/designs/[id].js', 'app/dist-vps/index.html',
                    'app/deployment/volume-lock.sh', 'app/node_modules/sharp/package.json']
        architecture = {'amd64': 'x64', 'arm64': 'arm64'}.get(config.get('architecture'))
        if not architecture: raise ValueError('Unreviewed Linux architecture')
        required.append(f'app/node_modules/@img/sharp-linux-{architecture}/package.json')
        if any(name not in paths for name in required): raise ValueError('Required runtime path missing')
        print(f'OCI audit passed: {len(manifest["layers"])} verified layers and required runtime paths.')
except Exception as error:
    print(f'OCI audit failed: {error}', file=sys.stderr)
    sys.exit(1)
