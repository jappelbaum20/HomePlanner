import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { auditPublic, enumerate, PUBLIC_FILES, VPS_PUBLIC_FILES } from './audit-public.mjs';

const root = process.cwd();
const vps = process.argv.includes('--vps');
const override = process.env.HOMEPLANNER_BUILD_DIR;
if (override && !path.isAbsolute(override)) throw new Error('Build directory must be absolute.');
const dist = override || path.join(root, vps ? 'dist-vps' : 'dist');
const basePath = process.env.HOMEPLANNER_BASE_PATH || '/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid application base path');
if (vps && basePath !== '/') throw new Error('The VPS contract requires the root base path.');
await mkdir(dist, { recursive: true });
const current = await enumerate(dist);
const unexpected = current.filter(file => !(vps ? VPS_PUBLIC_FILES : PUBLIC_FILES).includes(file));
if (unexpected.length) throw new Error('Refusing to build over unexpected output; inspect the dist directory.');
const sources = ['styles.css', 'app.js', 'standalone.js', 'bookshelf.html', 'models3d.js', 'bookshelf.js', 'bookshelf-builder.js', 'starter-data.js', 'shared/contracts.js', 'shared/canonical.js',
  'admin.html', 'admin.js', 'client/contracts-loader.js', 'client/cloud.js', 'client/ui.js'];
if (vps) sources.push('landing.html', 'landing.js', 'request-access.html', 'request-access.js', 'login.css', 'google-g.svg');
for (const source of sources) {
  await mkdir(path.dirname(path.join(dist, source)), { recursive: true });
  await copyFile(path.join(root, source), path.join(dist, source));
}
let html = await readFile(path.join(root, 'index.html'), 'utf8');
const oldTag = /<script\s+src=["']house-data\.js["']\s*><\/script>/gi;
const matches = html.match(oldTag) || [];
const existing = html.match(/<script\s+src=["']starter-data\.js["']\s*><\/script>/gi) || [];
if (matches.length === 1 && existing.length === 0) html = html.replace(oldTag, '<script src="starter-data.js"></script>');
else if (!(matches.length === 0 && existing.length === 1)) throw new Error('Expected exactly one data script in index.html.');
const replacements = [
  ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', 'vendor/OrbitControls.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/environments/RoomEnvironment.js', 'vendor/RoomEnvironment.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/geometries/RoundedBoxGeometry.js', 'vendor/RoundedBoxGeometry.js']
];
for (const [from, to] of replacements) {
  if (html.split(from).length !== 2) throw new Error(`Expected one reviewed runtime reference: ${from}`);
  html = html.replace(from, to);
}
html = html.replace(/\s*<link\s+[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi, '');
const sdkMarker = '<script src="client/contracts-loader.js"></script>';
if (html.split(sdkMarker).length !== 2 || html.includes('vendor/supabase.js')) throw new Error('Unexpected SDK insertion point.');
html = html.replace(sdkMarker, `<script src="vendor/${vps ? 'better-auth' : 'supabase'}.js"></script>\n  ` + sdkMarker);
html = html.replace('<base href="/">', '<base href="' + basePath + '">');
await writeFile(path.join(dist, 'index.html'), html);
let bookshelfHtml = await readFile(path.join(dist, 'bookshelf.html'), 'utf8');
if (bookshelfHtml.split(sdkMarker).length !== 2) throw new Error('Unexpected bookshelf SDK insertion point.');
bookshelfHtml = bookshelfHtml.replace(sdkMarker, `<script src="vendor/${vps ? 'better-auth' : 'supabase'}.js"></script>` + sdkMarker).replace('<base href="/">', '<base href="' + basePath + '">');
await writeFile(path.join(dist, 'bookshelf.html'), bookshelfHtml);
const adminHtml = await readFile(path.join(dist, 'admin.html'), 'utf8');
await writeFile(path.join(dist, 'admin.html'), adminHtml.replace('<base href="/">', '<base href="' + basePath + '">'));
await mkdir(path.join(dist, 'vendor'), { recursive: true });
for (const [source, target] of [
  ['node_modules/three/build/three.min.js', 'three.min.js'],
  ['node_modules/three/examples/js/controls/OrbitControls.js', 'OrbitControls.js'],
  ['node_modules/three/examples/js/environments/RoomEnvironment.js', 'RoomEnvironment.js'],
  ['node_modules/three/examples/js/geometries/RoundedBoxGeometry.js', 'RoundedBoxGeometry.js']
]) await copyFile(path.join(root, source), path.join(dist, 'vendor', target));
const sdk = await build({ stdin: { contents: vps ? "export { createAuthClient } from 'better-auth/client';" : "export { createClient } from '@supabase/supabase-js';", resolveDir: root, sourcefile: 'sdk-entry.js' },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: vps ? 'HomePlannerAuth' : 'HomePlannerSupabase', target: 'es2020', legalComments: 'none' });
await writeFile(path.join(dist, vps ? 'vendor/better-auth.js' : 'vendor/supabase.js'), sdk.outputFiles[0].contents);
const url = vps ? '' : process.env.HOMEPLANNER_PUBLIC_SUPABASE_URL || '', key = vps ? '' : process.env.HOMEPLANNER_PUBLIC_SUPABASE_KEY || '';
if ((url || key) && (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))) throw new Error('Public Supabase configuration is invalid.');
await writeFile(path.join(dist, 'client/config.js'), `window.HOMEPLANNER_CONFIG = ${JSON.stringify(vps ? { selfHosted: true } : { url, publishableKey: key })};\n`);
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, strictNumbers: true, code: { source: true } });
for (const name of ['shelf-v1', 'shelf-document-v2', 'home-v2', 'api-v3', 'api-v4', 'vps-v1']) ajv.addSchema(JSON.parse(await readFile(path.join(root, `shared/schema/${name}.json`), 'utf8')));
const base = 'https://schemas.homeplanner.invalid/';
const names = { shelf: 'shelf-v1', shelfDocument: 'shelf-document-v2', home: 'home-v2', writeDesignV4: 'api-v4#/definitions/writeDesign', localV4: 'api-v4#/definitions/local', writeDesign: 'api-v3#/definitions/writeDesign',
  local: 'api-v3#/definitions/local', proposalRequest: 'api-v3#/definitions/proposalRequest',
  proposal: 'api-v3#/definitions/proposal', photoRequest: 'api-v3#/definitions/photoRequest',
  modelConfig: 'api-v3#/definitions/modelConfig', error: 'api-v3#/definitions/error', session: 'vps-v1#/definitions/session', uploadReservation: 'vps-v1#/definitions/uploadReservation' };
const generated = standaloneCode(ajv, Object.fromEntries(Object.entries(names).map(([name, schema]) => [name, base + schema])));
const bundled = await build({ stdin: { contents: generated, resolveDir: root, sourcefile: 'validators.generated.js' }, bundle: true,
  write: false, platform: 'browser', format: 'iife', globalName: 'HomePlannerSchemaValidators', target: 'es2020', legalComments: 'none' });
await writeFile(path.join(dist, 'shared/validators.js'), bundled.outputFiles[0].contents);
const files = await auditPublic(dist, vps ? 'vps' : 'legacy');
console.log(`Built and audited ${files.length} public files.`);
