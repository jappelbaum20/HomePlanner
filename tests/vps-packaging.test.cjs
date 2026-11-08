'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createComposition, readSetting, databasePair, requireDatabaseUrl } = require('../runtime/composition.cjs');
const { createStorageSafety } = require('../runtime/storage-safety.cjs');
const { createRuntime } = require('../runtime/router.cjs');

const repo = path.resolve(__dirname, '..');
const root = process.env.HOMEPLANNER_E_TEST_ROOT;
function run(args, cwd = repo) { return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' }); }

test('production composition requires a real safety provider before reading config', async () => {
  await assert.rejects(createComposition({ env: new Proxy({}, { get() { throw Error('unexpected access'); } }) }), /safety integration/);
});
test('default runtime is live but unavailable for private operations', async () => {
  const runtime = createRuntime({ dist: path.join(repo, 'dist-vps') });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    assert.equal((await fetch(base + '/health/live')).status, 200);
    assert.equal((await fetch(base + '/health/ready')).status, 503);
    assert.equal((await fetch(base + '/api/session')).status, 503);
  } finally { await runtime.stop(); }
});
test('configuration sources and database identities fail closed', async () => {
  await assert.rejects(readSetting({ X: 'fixture', X_FILE: '/nonexistent' }, 'X'), /Conflicting/);
  await assert.rejects(readSetting({ X_FILE: 'relative' }, 'X'), /absolute/);
  assert.throws(() => databasePair('postgres://a:x@db/homeplanner', 'postgres://a:y@db/homeplanner'));
  assert.throws(() => databasePair('postgres://a:x@db/homeplanner', 'postgres://b:y@other/homeplanner'));
  assert.doesNotThrow(() => databasePair('postgres://a:x@db/homeplanner', 'postgres://b:y@db/homeplanner'));
  assert.doesNotThrow(() => requireDatabaseUrl('postgres://hp_auth_login:fixture@db/homeplanner', 'hp_auth_login'));
  assert.throws(() => requireDatabaseUrl('postgres://hp_auth_login:fixture@other/homeplanner', 'hp_auth_login'));
  assert.throws(() => requireDatabaseUrl('postgres://hp_auth_login:fixture@db/homeplanner?host=other', 'hp_auth_login'));
});
test('maintenance safety requires first pass and drains on stop or startup error', async () => {
  const events = [];
  const ok = createStorageSafety(() => ({ start: async () => events.push('start'), ready: () => true, stop: async () => events.push('stop') }));
  const guard = await ok.start({});
  assert.equal(guard.maintenanceReady(), true);
  await guard.close(); assert.deepEqual(events, ['start', 'stop']);
  const bad = createStorageSafety(() => ({ start: async () => { throw Error('failed'); }, stop: async () => events.push('failed-stop') }));
  await assert.rejects(bad.start({})); assert.equal(events.at(-1), 'failed-stop');
});
test('prepared context has exactly reviewed files and rejects extra files', () => {
  assert.ok(root && path.isAbsolute(root), 'Set HOMEPLANNER_E_TEST_ROOT to a task-owned directory');
  fs.mkdirSync(root, { recursive: true });
  const parent = fs.mkdtempSync(path.join(root, 'context-'));
  const target = path.join(parent, 'input'), manifest = path.join(parent, 'manifest.json');
  const prepared = run(['scripts/prepare-hosting.mjs', '--vps', target, manifest]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const audited = run(['scripts/audit-vps-context.mjs'], target);
  assert.equal(audited.status, 0, audited.stderr);
  const inventory = JSON.parse(fs.readFileSync(manifest, 'utf8')).files.map(x => x.path);
  assert.ok(fs.readFileSync(path.join(target, '.dockerignore'), 'utf8').includes('!api/designs/\\[id\\].js'));
  const ignore = require('ignore')().add(fs.readFileSync(path.join(target, '.dockerignore'), 'utf8'));
  assert.deepEqual(inventory.filter(item => item !== '.dockerignore' && ignore.ignores(item)), []);
  for (const item of ['runtime/composition.cjs','runtime/integrations.cjs','runtime/storage-safety.cjs','server/photo-files.cjs','server/photo-maintenance.cjs','server/auth-config.cjs','server/session.cjs','db/migrations/003_photos.sql','db/migrations/004_photo_maintenance.sql','.dockerignore']) assert.ok(inventory.includes(item));
  for (const item of ['house-data.js', '.env', '.git/config']) assert.ok(!inventory.includes(item));
  fs.writeFileSync(path.join(target, 'unexpected.txt'), 'fixture');
  assert.notEqual(run(['scripts/audit-vps-context.mjs'], target).status, 0);
});
