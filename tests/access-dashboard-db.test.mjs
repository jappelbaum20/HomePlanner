import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire, Module } from 'node:module';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const { client } = require('./helpers/pglite-pool.cjs');
const current = require('../db/migrate.cjs');
const repo = path.resolve(import.meta.dirname, '..');
const previousFile = path.join(repo, 'db', 'migrate-previous-fixture.cjs');
const previous = new Module(previousFile);
previous.filename = previousFile;
previous.paths = Module._nodeModulePaths(path.dirname(previousFile));
previous._compile(execFileSync('git', ['show', '6c8d072:db/migrate.cjs'], { cwd: repo, encoding: 'utf8' }), previousFile);

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const os = '11111111-1111-4111-8111-111111111111', us = '22222222-2222-4222-8222-222222222222';
const grant = 'a'.repeat(64), issuer = 'https://accounts.google.com';
const hash = n => n.toString(16).padStart(64, '0');
async function call(db, role, uid, sid, sql, args = [], proof = '') {
  await db.exec('BEGIN; SET LOCAL ROLE ' + role);
  try {
    if (uid) await db.query("SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true),set_config('hp.admin_grant_hash',$3,true)", [uid, sid, proof]);
    const result = await db.query(sql, args); await db.exec('COMMIT'); return result.rows[0]?.x;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const admin = (db, sql, args = []) => call(db, 'hp_app_runtime', owner, os, sql, args, grant);
const list = db => admin(db, 'SELECT hp_app.hp_access_review($1,$2) x', ['owner-sub', null]);
const ask = (db, n) => call(db, 'hp_access_public', null, null, 'SELECT hp_app.hp_access_request_verified($1,$2,$3,$4,$5,$6) x', [issuer, `subject-${n}`, `person${n}@example.com`, `Person ${n}`, hash(n), hash(n + 100)]);

async function setup() {
  const db = await PGlite.create();
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
  await previous.exports.migrate(client(db));
  for (const [id, sid, subject] of [[owner, os, 'owner-sub'], [user, us, 'user-sub']]) {
    await db.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())', [id, subject, subject + '@example.com']);
    await db.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())', [subject, id]);
    await db.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())', [sid, 'fixture-' + subject, id]);
  }
  await db.query('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)', [owner, 'owner-sub']);
  await db.query("INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES($1,'owner-sub','approved',$1,'verified-owner-binding')", [owner]);
  await db.query('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', [grant, owner, os, 'owner-sub']);
  return db;
}

test('008 upgrades 007, suppresses old and new owner mail, preserves decision mail and grant boundaries', async () => {
  const db = await setup();
  try {
    for (const n of [1, 2, 3]) assert.equal((await ask(db, n)).status, 'pending');
    const before = await list(db);
    const approved = before.find(r => r.email === 'person3@example.com');
    await admin(db, 'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x', ['owner-sub', approved.id, approved.revision, 'approved']);
    const token = '33333333-3333-4333-8333-333333333333';
    await db.query("UPDATE hp_private.mail_outbox SET status='failed',error_category='permanent' WHERE request_id=$1 AND kind='request'", [before.find(r => r.email === 'person1@example.com').id]);
    await db.query("UPDATE hp_private.mail_outbox SET lease_token=$1,lease_until=now()+interval '2 minutes' WHERE request_id=$2 AND kind='request'", [token, before.find(r => r.email === 'person2@example.com').id]);

    const c = client(db); await current.migrate(c); await current.migrate(c);
    assert.equal(await current.verifyMigrations(c), true);
    assert.equal(await previous.exports.verifyMigrations(c), false, 'the immediate previous image rejects the longer additive ledger');
    assert.deepEqual((await db.query('SELECT name FROM hp_migration.applied_additive ORDER BY name')).rows.map(r => r.name), ['007_verified_signin.sql', '008_access_dashboard.sql']);
    const oldMail = (await db.query("SELECT status,error_category,lease_token,lease_until FROM hp_private.mail_outbox WHERE kind='request'")).rows;
    assert.equal(oldMail.length, 3);
    assert.ok(oldMail.every(m => m.status === 'suppressed' && m.error_category === null && m.lease_token === null && m.lease_until === null));

    assert.equal((await ask(db, 4)).status, 'pending');
    await call(db, 'hp_access_public', null, null, 'SELECT hp_app.hp_access_request($1,$2,$3,$4,$5) x', ['Legacy', 'legacy@example.com', 'A note', hash(8), hash(108)]);
    assert.equal((await db.query("SELECT count(*)::int n FROM hp_private.mail_outbox WHERE kind='request'")).rows[0].n, 3, 'neither request function inserted a notification');
    const rows = await list(db), legacy = rows.find(r => r.email === 'legacy@example.com');
    assert.equal(legacy.note, 'A note');
    assert.ok(rows.findIndex(r => r.status !== 'pending') > rows.findIndex(r => r.id === legacy.id));
    assert.deepEqual((await admin(db, 'SELECT hp_app.hp_access_review($1,$2) x', ['owner-sub', before[0].id])).mail.filter(m => m.kind === 'request'), []);

    const denied = rows.find(r => r.email === 'person4@example.com');
    await admin(db, 'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x', ['owner-sub', denied.id, denied.revision, 'denied']);
    assert.deepEqual((await db.query("SELECT kind FROM hp_private.mail_outbox WHERE kind<>'request' ORDER BY kind")).rows.map(r => r.kind), ['approved', 'denied']);
    const claimed = await call(db, 'hp_mail_worker', null, null, 'SELECT hp_app.hp_mail_claim($1,$2) x', [token, 20]);
    assert.deepEqual(claimed.map(m => m.kind).sort(), ['approved', 'denied']);

    // Even a legacy row made eligible by an older operator cannot be claimed.
    const suppressed = (await db.query("SELECT id FROM hp_private.mail_outbox WHERE kind='request' LIMIT 1")).rows[0].id;
    await db.query("UPDATE hp_private.mail_outbox SET status='queued',lease_token=$1,lease_until=now()+interval '2 minutes' WHERE id=$2", [token, suppressed]);
    assert.equal(await call(db, 'hp_mail_worker', null, null, 'SELECT hp_app.hp_mail_finish($1,$2,$3) x', [suppressed, token, 'suppressed']), true);
    assert.equal((await db.query('SELECT status FROM hp_private.mail_outbox WHERE id=$1', [suppressed])).rows[0].status, 'suppressed');
    await db.query("UPDATE hp_private.mail_outbox SET status='queued' WHERE id=$1", [suppressed]);
    assert.deepEqual(await call(db, 'hp_mail_worker', null, null, 'SELECT hp_app.hp_mail_claim($1,$2) x', [token, 20]), []);

    assert.equal(await call(db, 'hp_app_runtime', owner, os, 'SELECT hp_app.hp_access_is_owner() x'), true);
    assert.equal(await call(db, 'hp_app_runtime', user, us, 'SELECT hp_app.hp_access_is_owner() x'), false);
    await assert.rejects(call(db, 'hp_app_runtime', user, os, 'SELECT hp_app.hp_access_is_owner() x'), /HP_ACCESS_SESSION/);
    await assert.rejects(call(db, 'hp_access_public', null, null, 'SELECT hp_app.hp_access_is_owner() x'), /permission denied/);
    await assert.rejects(call(db, 'hp_app_runtime', owner, os, 'SELECT hp_app.hp_access_review($1,$2) x', ['owner-sub', null]), /HP_NOT_FOUND/);
    await assert.rejects(call(db, 'hp_app_runtime', user, us, 'SELECT hp_app.hp_access_review($1,$2) x', ['owner-sub', null], grant), /HP_NOT_FOUND/);
    await assert.rejects(call(db, 'hp_access_public', null, null, 'SELECT * FROM hp_private.access_requests'), /permission denied/);

    // Rehearse the compatible-image rollback in this synthetic database: retain suppressed rows,
    // restore the exact prior function bodies, remove 008's new objects and reconcile the ledger.
    const original = await readFile(new URL('../db/migrations/006_access_requests.sql', import.meta.url), 'utf8');
    const restored = ['hp_access_review','hp_mail_claim','hp_mail_finish'].map(name => {
      const definition = original.match(new RegExp(`CREATE FUNCTION hp_app\\.${name}\\([\\s\\S]*?END \\$\\$;`));
      assert.ok(definition, `missing original ${name}`);
      return definition[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    }).join('\n');
    await db.exec(`BEGIN; SET ROLE hp_app_owner;
      DROP TRIGGER suppress_request_mail ON hp_private.mail_outbox;
      DROP FUNCTION hp_private.suppress_request_mail(); DROP FUNCTION hp_app.hp_access_is_owner();
      ${restored} RESET ROLE;
      DELETE FROM hp_migration.applied_additive WHERE name='008_access_dashboard.sql'; COMMIT;`);
    assert.equal(await previous.exports.verifyMigrations(c), true);
    assert.equal((await db.query("SELECT count(*)::int n FROM hp_private.mail_outbox WHERE kind='request' AND status='suppressed'")).rows[0].n, 2);
    await ask(db, 5);
    assert.equal((await db.query("SELECT count(*)::int n FROM hp_private.mail_outbox WHERE kind='request' AND status='queued'")).rows[0].n, 2, 'reverting 008 enables new owner notifications again');
  } finally { await db.close(); }
});

test('the waiting list is not truncated by decided history or the old 100-row limit', async () => {
  const db = await setup();
  try {
    await current.migrate(client(db));
    await db.exec("INSERT INTO hp_private.access_requests(name,email,note) SELECT 'Person '||n,'p'||n||'@example.com','Note '||n FROM generate_series(1,105) n");
    const rows = await list(db);
    assert.equal(rows.filter(r => r.status === 'pending').length, 105);
    assert.equal(rows.find(r => r.email === 'p105@example.com').note, 'Note 105');
  } finally { await db.close(); }
});
