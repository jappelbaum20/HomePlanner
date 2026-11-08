#!/usr/bin/env python3
"""Validate the specific rootfs paths used for a Linux native smoke test."""
import posixpath
import sys
import tarfile

try:
    with tarfile.open(sys.argv[1], 'r:') as archive:
        found_node = False
        for member in archive:
            name = member.name
            if name != 'usr/local/bin/node' and name != 'app/node_modules' and not name.startswith('app/node_modules/'):
                continue
            if name.startswith('/') or posixpath.normpath(name) != name or '/../' in '/' + name + '/': raise ValueError('Unsafe archive path')
            if name == 'usr/local/bin/node':
                if not member.isfile(): raise ValueError('Invalid Node binary')
                found_node = True
            elif member.issym() or member.islnk():
                target = member.linkname
                if target.startswith('/') or not posixpath.normpath(posixpath.join(posixpath.dirname(name), target)).startswith('app/node_modules/'):
                    raise ValueError('Unsafe package link')
            elif not member.isfile() and not member.isdir(): raise ValueError('Unsafe package entry')
        if not found_node: raise ValueError('Node binary missing')
    print('Root filesystem smoke-test paths verified.')
except Exception as error:
    print(f'Root filesystem smoke-test paths rejected: {error}', file=sys.stderr)
    sys.exit(1)
