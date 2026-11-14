// Mail worker wiring against the real database functions (in-process PostgreSQL) and the real composition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { client, rolePool } = require('./helpers/pglite-pool.cjs');
const { migrate } = require('../db/migrate.cjs');
const { createOutboxWorker } = require('../server/mail-outbox.cjs');
const { createComposition, readSetting } = require('../runtime/composition.cjs');
const { createPhotoStore } = require('../server/photo-files.cjs');
process.env.NODE_ENV = 'test';
const origin = 'https://home.appelbaums.com';

async function database() {
  const db = await PGlite.create();
  await db.exec(`CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN;
    CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;
    CREATE ROLE hp_auth_login LOGIN; GRANT hp_auth_runtime TO hp_auth_login; CREATE ROLE hp_app_login LOGIN; GRANT hp_app_runtime TO hp_app_login;
    CREATE ROLE hp_photo_maintenance_login LOGIN; GRANT hp_photo_maintenance TO hp_photo_maintenance_login;
    CREATE ROLE hp_access_public_login LOGIN; GRANT hp_access_public TO hp_access_public_login; CREATE ROLE hp_mail_worker_login LOGIN; GRANT hp_mail_worker TO hp_mail_worker_login;`);
  await migrate(client(db));
  return db;
}
// kind 'request' or 'approved'; created in the given order, so the claim (oldest first) sees them in that order.
async function job(db, kind, n) {
  const id = randomUUID(), rev = 2;
  await db.query('INSERT INTO hp_private.access_requests(id,email,name) VALUES($1,$2,$3)', [id, `person${n}@example.com`, 'Person']);
  const messageId = kind === 'request' ? `<request-${id}@home.appelbaums.com>` : `<decision-${id}-${rev}@home.appelbaums.com>`;
  await db.query('INSERT INTO hp_private.mail_outbox(event_key,request_id,kind,message_id,next_attempt) VALUES($1,$2,$3,$4,clock_timestamp()+($5||\' milliseconds\')::interval)', [`${kind}:${id}`, id, kind, messageId, String(n - 1000)]);
  return id;
}
const states = async db => (await db.query('SELECT kind,status,attempts,error_category FROM hp_private.mail_outbox ORDER BY next_attempt,id')).rows;

test('a backlog of request jobs is ended without the transport in a bounded loop, so a decision mail behind it is not delayed one tick per job', async () => {
  const db = await database();
  for (let i = 0; i < 25; i++) await job(db, 'request', i);
  await job(db, 'approved', 25);
  const sent = [];
  const worker = createOutboxWorker({ pool: rolePool(db, 'hp_mail_worker'), origin, from: 'sender@example.com', transport: { async sendMail(m) { sent.push(m); return { accepted: [m.to] }; } } });
  const first = await worker.runOnce();
  assert.equal(first.drained, 20); assert.equal(sent.length, 0, 'request jobs never reach the transport');
  const second = await worker.runOnce();
  assert.equal(second.drained, 5); assert.equal(second.outcome, 'accepted'); assert.equal(sent.length, 1, 'the decision mail is sent in the second run, not the 26th');
  assert.match(sent[0].text, /was approved/);
  await db.exec('RESET ROLE');
  const rows = await states(db);
  assert.equal(rows.filter(r => r.kind === 'request' && r.status === 'failed' && r.error_category === 'permanent').length, 25);
  assert.deepEqual(rows.filter(r => r.kind === 'approved').map(r => r.status), ['accepted']);
  assert.equal((await worker.runOnce()).processed, false);
});

test('composition with mail off starts no worker: request and decision rows are left exactly as they were', async () => {
  const db = await database();
  await job(db, 'request', 1); await job(db, 'approved', 2);
  const before = await states(db);
  const root = path.join(mkdtempSync(path.join(process.env.HOMEPLANNER_E_TEST_ROOT || tmpdir(), 'mail-off-')), 'data'); mkdirSync(root, { recursive: true });
  const url = u => `postgres://${u}:pw@db/homeplanner`;
  const env = { HOMEPLANNER_ORIGIN: origin, HOMEPLANNER_PHOTO_ROOT: root, HOMEPLANNER_MIN_FREE_BYTES: String(20 * 1024 ** 3), HOMEPLANNER_DIST: 'dist-vps',
    HOMEPLANNER_AUTH_DATABASE_URL: url('hp_auth_login'), HOMEPLANNER_APP_DATABASE_URL: url('hp_app_login'), HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL: url('hp_photo_maintenance_login'),
    HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL: url('hp_access_public_login'), HOMEPLANNER_MAIL_DATABASE_URL: url('hp_mail_worker_login'),
    HOMEPLANNER_ACCESS_RATE_KEY: 'r'.repeat(40), HOMEPLANNER_AUTH_SECRET: 'a'.repeat(40), HOMEPLANNER_CSRF_SECRET: 'c'.repeat(40),
    GOOGLE_OAUTH_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret-value', HOMEPLANNER_MAIL_ENABLED: '0' };
  class FakePool { constructor(o) { const user = new URL(o.connectionString).username; return rolePool(db, user, { searchPath: o.options ? 'hp_auth,pg_catalog' : undefined }); } }
  const safety = { start: async () => ({ maintenanceReady: async () => true, close: async () => {} }) };
  const integrations = await createComposition({ env, safety, PoolClass: FakePool, volumeLock: () => ({ exclusiveWriter: () => true, close() {} }), privateFile: (e, n) => readSetting(e, n),
    photoStoreFactory: o => createPhotoStore({ ...o, testOnly: { allowUnsafeDirectorySync: true, syncDir: async () => {}, diskFree: async () => 1e12 } }) });
  try {
    await new Promise(r => setTimeout(r, 300));
    await db.exec('RESET ROLE');
    assert.deepEqual(await states(db), before);
    assert.deepEqual((await states(db)).map(r => [r.status, r.attempts]), [['queued', 0], ['queued', 0]]);
  } finally { await integrations.close(); }
});
