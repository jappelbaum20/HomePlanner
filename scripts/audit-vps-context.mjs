import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { VPS_INPUTS, dockerIgnore } from './vps-manifest.mjs';

const expected = [...VPS_INPUTS, '.dockerignore'].sort();
if (new Set(expected).size !== expected.length) throw Error('Duplicate context input');
async function walk(dir, prefix = '') {
  const found = [];
  for (const name of await readdir(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name, full = path.join(dir, name), info = await lstat(full);
    if (info.isSymbolicLink()) throw Error('Context contains a symlink');
    if (info.isDirectory()) found.push(...await walk(full, rel));
    else if (info.isFile()) found.push(rel);
    else throw Error('Unexpected context entry');
  }
  return found;
}
const actual = (await walk(process.cwd())).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Context differs from reviewed input list');
const ignore = dockerIgnore();
if (await readFile('.dockerignore', 'utf8') !== ignore) throw Error('Context ignore policy differs');
console.log(`Reviewed VPS context: ${actual.length} files.`);
