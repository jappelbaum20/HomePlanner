// Starts the configured production composition (real Better Auth, access store, router handlers) on an
// in-process PostgreSQL with a trusted proxy range, then sends access requests from different peers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { client, rolePool } = require('./helpers/pglite-pool.cjs');
const { migrate } = require('../db/migrate.cjs');
const { createComposition, readSetting } = require('../runtime/composition.cjs');
const handoff = require('../server/handoff.cjs');
const { createPhotoStore } = require('../server/photo-files.cjs');
const authSecret = 'a'.repeat(40), csrfSecret = 'c'.repeat(40), rateKey = 'r'.repeat(40);
const origin = 'https://home.appelbaums.com';
const url = u => `postgres://${u}:pw@db/homeplanner`;

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
function env(root, extra) {
  return { HOMEPLANNER_ORIGIN: origin, HOMEPLANNER_PHOTO_ROOT: root, HOMEPLANNER_MIN_FREE_BYTES: String(20 * 1024 ** 3), HOMEPLANNER_DIST: 'dist-vps',
    HOMEPLANNER_AUTH_DATABASE_URL: url('hp_auth_login'), HOMEPLANNER_APP_DATABASE_URL: url('hp_app_login'), HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL: url('hp_photo_maintenance_login'),
    HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL: url('hp_access_public_login'), HOMEPLANNER_MAIL_DATABASE_URL: url('hp_mail_worker_login'),
    HOMEPLANNER_ACCESS_RATE_KEY: rateKey, HOMEPLANNER_AUTH_SECRET: authSecret, HOMEPLANNER_CSRF_SECRET: csrfSecret,
    GOOGLE_OAUTH_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret-value', HOMEPLANNER_MAIL_ENABLED: '0', ...extra };
}
async function start(db, extra) {
  const root = path.join(mkdtempSync(path.join(process.env.HOMEPLANNER_E_TEST_ROOT || tmpdir(), 'comp-')), 'data');
  require('node:fs').mkdirSync(root, { recursive: true });
  class FakePool { constructor(o) { const user = new URL(o.connectionString).username; return rolePool(db, user, { searchPath: o.options ? 'hp_auth,pg_catalog' : undefined }); } }
  const safety = { start: async () => ({ maintenanceReady: async () => true, close: async () => {} }) };
  return createComposition({ env: env(root, extra), safety, PoolClass: FakePool, volumeLock: () => ({ exclusiveWriter: () => true, close() {} }), privateFile: (e, n) => readSetting(e, n), photoStoreFactory: o => createPhotoStore({ ...o, testOnly: { allowUnsafeDirectorySync: true, syncDir: async () => {}, diskFree: async () => 1e12 } }) });
}
async function post(integrations, peer, { forwarded = '203.0.113.7', sub = 'sub-' + Math.random().toString(36).slice(2, 12) } = {}) {
  const sealed = handoff.seal(authSecret, { issuer: handoff.ISSUER, subject: sub, email: sub + '@example.invalid' });
  const req = { method: 'POST', query: {}, body: {}, socket: { remoteAddress: peer },
    headers: { origin, 'content-type': 'application/json', cookie: `${handoff.COOKIE}=${sealed.value}`, 'x-homeplanner-handoff-csrf': sealed.csrf, 'x-forwarded-for': forwarded } };
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(x) { this.data = x; this.writableEnded = true; return this; }, end() { this.writableEnded = true; return this; } };
  await integrations.handlers.accessRequest(req, res);
  return res;
}

test('configured composition with a trusted range accepts requests only from the proxy peer', async () => {
  const db = await database();
  const integrations = await start(db, { HOMEPLANNER_TRUSTED_PROXY_CIDR: '172.20.0.0/16', HOMEPLANNER_TRUSTED_PROXY_EXCLUDE: '172.20.0.9' });
  try {
    assert.equal(integrations.requestsAvailable, true);
    const ok = await post(integrations, '172.20.0.3'); assert.equal(ok.statusCode, 202); assert.equal(ok.data.status, 'pending');
    assert.equal((await post(integrations, '::ffff:172.20.0.3')).statusCode, 202);
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT count(*)::int n FROM hp_private.access_requests WHERE status='pending'")).rows[0].n, 2);
    const before = (await db.query('SELECT count(*)::int n FROM hp_private.access_requests')).rows[0].n;
    for (const peer of ['172.20.0.1', '172.20.0.9', '172.20.0.0', '172.20.255.255', '172.21.0.3', '203.0.113.9', '127.0.0.1', undefined]) {
      const r = await post(integrations, peer); assert.ok(r.statusCode >= 400, String(peer)); assert.notEqual(r.statusCode, 202, String(peer));
    }
    assert.equal((await post(integrations, '172.20.0.3', { forwarded: '203.0.113.7, 203.0.113.8' })).statusCode >= 400, true, 'chained forwarding is refused');
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT count(*)::int n FROM hp_private.access_requests')).rows[0].n, before, 'untrusted peers record nothing');
  } finally { await integrations.close(); }
});
test('legacy single trusted address still works and no proxy setting leaves requests unavailable', async () => {
  const db = await database();
  const legacy = await start(db, { HOMEPLANNER_TRUSTED_PROXY_IP: '172.20.0.3' });
  try { assert.equal((await post(legacy, '172.20.0.3')).statusCode, 202); assert.ok((await post(legacy, '172.20.0.4')).statusCode >= 400); } finally { await legacy.close(); }
  const none = await start(await database(), {});
  try { assert.equal(none.requestsAvailable, false); } finally { await none.close(); }
});
