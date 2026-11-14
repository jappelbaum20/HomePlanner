// Rollback facts. (1) An older runtime (the pre-007 image, BASE) still works against a database with 007 and 008
// applied. (2) The current main runtime does NOT: its migration check requires the additive ledger to equal
// exactly 007, so once 008 is recorded, rolling back to main is not a plain image swap (see STAGE2-OPERATIONS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { client, rolePool } = require('./helpers/pglite-pool.cjs');
const migrateNew = require('../db/migrate.cjs');
const BASE = process.env.HOMEPLANNER_ROLLBACK_BASE || '3d7e99f';
const MAIN = process.env.HOMEPLANNER_ROLLBACK_MAIN || 'origin/main';
const repo = path.resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'buffer', maxBuffer: 64 << 20 });
let haveBase = true; try { git(['cat-file', '-e', BASE + '^{commit}']); } catch { haveBase = false; }
let haveMain = true; try { git(['cat-file', '-e', MAIN + '^{commit}']); } catch { haveMain = false; }
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const os_ = '11111111-1111-4111-8111-111111111111', us = '22222222-2222-4222-8222-222222222222', grant = 'a'.repeat(64);

test('migration 007 is hashed over LF text so CRLF and LF checkouts record the same checksum', async () => {
  const [entry] = await migrateNew.additiveMigrations();
  const raw = readFileSync(path.join(repo, 'db/migrations/007_verified_signin.sql'), 'utf8');
  assert.equal(entry.sql.includes('\r'), false);
  assert.equal(entry.sha256, createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex'));
  assert.deepEqual((await migrateNew.expectedMigrations()).map(m => m.name), migrateNew.FILES);
  assert.equal(migrateNew.FILES.includes('007_verified_signin.sql'), false, 'the six base files stay exactly what the previous image expects');
});

test('older (pre-007) runtime verifies the base ledger and serves requests against a database with 007 and 008 applied', { skip: !haveBase && `base commit ${BASE} not available` }, async () => {
  const dir = mkdtempSync(path.join(process.env.HOMEPLANNER_E_TEST_ROOT || tmpdir(), 'rollback-'));
  for (const f of ['server/access.cjs', 'server/errors.js', 'db/migrate.cjs']) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), git(['show', `${BASE}:${f}`]));
  }
  mkdirSync(path.join(dir, 'db/migrations'), { recursive: true });
  for (const f of migrateNew.FILES) copyFileSync(path.join(repo, 'db/migrations', f), path.join(dir, 'db/migrations', f));
  const old = { migrate: require(path.join(dir, 'db/migrate.cjs')), access: require(path.join(dir, 'server/access.cjs')) };
  assert.equal(old.migrate.ADDITIVE, undefined, 'the loaded code is the older pre-007 runtime');

  const db = await PGlite.create();
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
  const c = client(db);
  await migrateNew.migrate(c); await migrateNew.migrate(c);
  assert.deepEqual((await db.query('SELECT name FROM hp_migration.applied_additive ORDER BY name')).rows, [{ name: '007_verified_signin.sql' }, { name: '008_add_person.sql' }]);
  assert.equal((await db.query('SELECT count(*)::int n FROM hp_migration.applied')).rows[0].n, 6);
  assert.equal(await migrateNew.verifyMigrations(c), true);
  // The previous image's ledger check, byte for byte, passes with 007 and 008 applied (it reads only the base ledger).
  assert.equal(await old.migrate.verifyMigrations(c), true);
  await old.migrate.migrate(c);  // and its own maintenance job is a no-op

  for (const [u, s, sub] of [[owner, os_, 'owner-sub'], [user, us, 'user-sub']]) {
    await db.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())', [u, sub, u === owner ? 'jacob@appelbaums.com' : sub + '@example.invalid']);
    await db.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())', [sub, u]);
    await db.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())', [s, 'cookie-' + sub, u]);
  }
  await db.query('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)', [owner, 'owner-sub']);
  await db.query("INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES($1,'owner-sub','approved',$1,'verified-owner-binding')", [owner]);
  await db.query('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', [grant, owner, os_, 'owner-sub']);

  const store = old.access.createAccessStore({ appPool: rolePool(db, 'hp_app_runtime'), publicPool: rolePool(db, 'hp_access_public'), rateKey: 'r'.repeat(40) });
  assert.equal(await store.verifyPublicRole(), true);
  const ctx = { userId: user, sessionId: us };
  assert.notEqual((await store.status(ctx)).status, 'approved');
  assert.equal(await store.request({ name: 'Applicant', email: 'applicant@example.invalid', note: 'hello' }, '203.0.113.7'), true);
  await db.exec('RESET ROLE');
  const rows = (await db.query("SELECT status,google_subject,google_issuer FROM hp_private.access_requests WHERE email='applicant@example.invalid'")).rows;
  assert.deepEqual(rows, [{ status: 'pending', google_subject: null, google_issuer: null }], 'old rows leave the new nullable columns empty');
  const owners = { userId: owner, sessionId: os_ };
  const listing = await store.review(owners, grant, null);
  assert.ok(JSON.stringify(listing).includes('applicant@example.invalid'), 'old admin review lists the request');
  const pending = (listing.requests || listing).find(r => r.email === 'applicant@example.invalid');
  const done = await store.decide(owners, grant, pending.id, pending.revision, 'denied');
  assert.equal(done.status, 'denied');
});

test('main runtime rejects a ledger that contains 008: rollback to main is not a plain image swap', { skip: !haveMain && `ref ${MAIN} not available` }, async () => {
  const dir = mkdtempSync(path.join(process.env.HOMEPLANNER_E_TEST_ROOT || tmpdir(), 'rollback-main-'));
  mkdirSync(path.join(dir, 'db/migrations'), { recursive: true });
  writeFileSync(path.join(dir, 'db/migrate.cjs'), git(['show', `${MAIN}:db/migrate.cjs`]));
  // The base files are hashed as checked out (CRLF on Windows), so use this checkout's copies; they equal main's byte for byte up to line endings.
  for (const f of [...migrateNew.FILES, '007_verified_signin.sql']) {
    copyFileSync(path.join(repo, 'db/migrations', f), path.join(dir, 'db/migrations', f));
    const lf = s => s.split(String.fromCharCode(13)).join('');
    assert.equal(lf(readFileSync(path.join(dir, 'db/migrations', f), 'utf8')), lf(git(['show', `${MAIN}:db/migrations/${f}`]).toString('utf8')), f + ' is unchanged from main');
  }
  const main = require(path.join(dir, 'db/migrate.cjs'));
  assert.deepEqual([...main.ADDITIVE], ['007_verified_signin.sql'], 'the loaded code is the main runtime');
  const db = await PGlite.create();
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
  const c = client(db);
  await migrateNew.migrate(c);
  assert.equal(await migrateNew.verifyMigrations(c), true);
  assert.equal(await main.verifyMigrations(c), false, 'main reports not ready with 008 in the additive ledger');
  await assert.rejects(() => main.migrate(c), /Migration ledger mismatch/, 'and its maintenance job refuses the ledger');
  await db.query("DELETE FROM hp_migration.applied_additive WHERE name='008_add_person.sql'");
  assert.equal(await main.verifyMigrations(c), true, 'the ledger row is the only reason (after the documented hand-undo)');
});
