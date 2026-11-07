import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_FILES = Object.freeze([
  'index.html', 'styles.css', 'app.js', 'models3d.js', 'bookshelf.js', 'bookshelf-builder.js',
  'starter-data.js', 'shared/contracts.js', 'shared/validators.js', 'shared/canonical.js',
  'admin.html', 'admin.js', 'client/config.js', 'client/contracts-loader.js', 'client/cloud.js', 'client/ui.js',
  'vendor/supabase.js', 'vendor/three.min.js', 'vendor/OrbitControls.js', 'vendor/RoomEnvironment.js', 'vendor/RoundedBoxGeometry.js'
]);
export async function enumerate(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await lstat(path.join(root, rel));
    if (info.isSymbolicLink()) throw new Error(`Symbolic link in artifact: ${rel}`);
    if (info.isDirectory()) result.push(...await enumerate(root, rel));
    else if (info.isFile()) result.push(rel);
    else throw new Error(`Unexpected filesystem entry: ${rel}`);
  }
  return result.sort();
}
export async function auditPublic(root) {
  const files = await enumerate(root);
  const expected = [...PUBLIC_FILES].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Public artifact does not match the explicit allowlist.');
  const index = await readFile(path.join(root, 'index.html'), 'utf8');
  if (!/<script\s+src=["']starter-data\.js["']\s*><\/script>/i.test(index) || /<script\s+src=["']house-data\.js/i.test(index)) {
    throw new Error('Public index must load only the empty starter data.');
  }
  const starter = await readFile(path.join(root, 'starter-data.js'), 'utf8');
  if (!starter.includes('window.HOUSE_ROOMS = []') || !starter.includes('window.HOUSE_PIECES = []') || !starter.includes('window.HOUSE_PLACEMENTS = []')) throw new Error('Starter arrays are missing.');
  if (/https?:\/\//i.test(index)) throw new Error('External resources in public index.');
  const scripts = [...index.matchAll(/<script\s+src=["']([^"']+)["']/gi)].map(m => m[1].split('?')[0]);
  for (const required of ['vendor/three.min.js', 'vendor/OrbitControls.js', 'vendor/RoomEnvironment.js', 'vendor/RoundedBoxGeometry.js', 'vendor/supabase.js', 'shared/canonical.js', 'client/config.js', 'client/contracts-loader.js', 'client/cloud.js', 'client/ui.js']) {
    if (scripts.filter(s => s === required).length !== 1) throw new Error(`Missing or duplicate public script: ${required}`);
  }
  if (scripts.indexOf('vendor/supabase.js') > scripts.indexOf('client/cloud.js')) throw new Error('SDK must load before cloud client.');
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const files = await auditPublic(path.resolve('dist'));
    console.log(`Public artifact allowlist passed (${files.length} files).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
