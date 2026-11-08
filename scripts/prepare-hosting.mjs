import { mkdir, lstat, realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { HOSTING_INPUTS } from './hosting-manifest.mjs';
import { VPS_INPUTS, dockerIgnore } from './vps-manifest.mjs';

const vps = process.argv[2] === '--vps', args = process.argv.slice(vps ? 3 : 2);
const source = process.cwd(), destination = path.resolve(args[0] || ''), manifest = args[1] && path.resolve(args[1]);
if (!args[0] || destination === source || destination.startsWith(source + path.sep)) throw Error('Choose a new destination outside the checkout.');
if (manifest && (manifest === destination || manifest.startsWith(destination + path.sep))) throw Error('Manifest must be outside the upload input.');
await mkdir(destination); // fails if it already exists; never delete or overwrite a prior staging tree
const inventory = [];
const realSource = await realpath(source);
for (const name of [...(vps ? VPS_INPUTS : HOSTING_INPUTS)].sort()) {
  const file = path.join(source, name), stat = await lstat(file);
  const resolved = await realpath(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !resolved.startsWith(realSource + path.sep)) throw Error(`Invalid input: ${name}`);
  let parent = source;
  for (const component of name.split('/').slice(0, -1)) {
    parent = path.join(parent, component);
    const part = await lstat(parent);
    if (!part.isDirectory() || part.isSymbolicLink()) throw Error(`Invalid input directory: ${name}`);
  }
  const bytes = await readFile(file);
  await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await writeFile(path.join(destination, name), bytes, { flag: 'wx' });
  inventory.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const entry of inventory) {
  const hash = createHash('sha256').update(await readFile(path.join(source, entry.path))).digest('hex');
  if (hash !== entry.sha256) throw Error(`Input changed while preparing artifact: ${entry.path}`);
}
if (vps) {
  // Deny everything by default, then admit only these exact paths.
  const ignore = dockerIgnore();
  await writeFile(path.join(destination, '.dockerignore'), ignore, { flag: 'wx' });
  inventory.push({ path: '.dockerignore', bytes: Buffer.byteLength(ignore), sha256: createHash('sha256').update(ignore).digest('hex') });
}
if (manifest) await writeFile(manifest, JSON.stringify({ files: inventory }, null, 2) + '\n', { flag: 'wx' });
console.log(`Prepared ${inventory.length} allowlisted inputs. No upload performed.`);
