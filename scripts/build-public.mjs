import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { auditPublic, enumerate, PUBLIC_FILES } from './audit-public.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
const current = await enumerate(dist);
const unexpected = current.filter(file => !PUBLIC_FILES.includes(file));
if (unexpected.length) throw new Error('Refusing to build over unexpected output; inspect the dist directory.');
const sources = ['styles.css', 'app.js', 'models3d.js', 'bookshelf.js', 'bookshelf-builder.js', 'starter-data.js', 'shared/contracts.js'];
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
await writeFile(path.join(dist, 'index.html'), html);
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, strictNumbers: true, code: { source: true } });
for (const name of ['shelf-v1', 'home-v2', 'api-v3']) ajv.addSchema(JSON.parse(await readFile(path.join(root, `shared/schema/${name}.json`), 'utf8')));
const base = 'https://schemas.homeplanner.invalid/';
const names = { shelf: 'shelf-v1', home: 'home-v2', writeDesign: 'api-v3#/definitions/writeDesign',
  local: 'api-v3#/definitions/local', proposalRequest: 'api-v3#/definitions/proposalRequest',
  proposal: 'api-v3#/definitions/proposal', photoRequest: 'api-v3#/definitions/photoRequest',
  modelConfig: 'api-v3#/definitions/modelConfig', error: 'api-v3#/definitions/error' };
const generated = standaloneCode(ajv, Object.fromEntries(Object.entries(names).map(([name, schema]) => [name, base + schema])));
const bundled = await build({ stdin: { contents: generated, resolveDir: root, sourcefile: 'validators.generated.js' }, bundle: true,
  write: false, platform: 'browser', format: 'iife', globalName: 'HomePlannerSchemaValidators', target: 'es2020', legalComments: 'none' });
await writeFile(path.join(dist, 'shared/validators.js'), bundled.outputFiles[0].contents);
const files = await auditPublic(dist);
console.log(`Built and audited ${files.length} public files.`);
