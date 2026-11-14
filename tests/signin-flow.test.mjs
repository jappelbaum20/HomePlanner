// Real Better Auth instance (same options as production) on an in-process PostgreSQL, with Google's
// token endpoint stubbed. Fictional identities only; no real Google credentials or tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { rolePool } = require('./helpers/pglite-pool.cjs');
const { createAuth } = require('../server/auth-config.cjs');
const handoff = require('../server/handoff.cjs');
const origin = 'https://home.appelbaums.com', clientId = 'fixture.apps.googleusercontent.com', secret = 'fixture-only-secret-of-at-least-32-bytes!!';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', existing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const os = '11111111-1111-4111-8111-111111111111', es = '22222222-2222-4222-8222-222222222222';
const ISS = 'https://accounts.google.com';
const mig = async f => await readFile(new URL('../db/migrations/' + f, import.meta.url), 'utf8');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
let db, auth, nextToken;
// The auth pool leaves the shared PGlite session in its own role; assertions read as the superuser.
const q = async (sql, args) => { await db.exec('RESET ROLE'); return db.query(sql, args); };
const realFetch = globalThis.fetch;

async function call(role, uid, sid, sql, args = [], g = '') {
  await db.exec('BEGIN; SET LOCAL ROLE ' + role);
  try {
    if (uid) await q("SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true),set_config('hp.admin_grant_hash',$3,true)", [uid, sid, g]);
    const r = await q(sql, args); await db.exec('COMMIT'); return r.rows[0]?.x;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const admin = (sql, args = []) => call('hp_app_runtime', owner, os, sql, args, 'a'.repeat(64));
const count = async t => Number((await q('SELECT count(*) n FROM hp_auth."' + t + '"')).rows[0].n);
const rows = async () => ({ user: await count('user'), account: await count('account'), session: await count('session'), verification: await count('verification') });
const hash = s => Buffer.from(s).toString('hex').padEnd(64, '0').slice(0, 64);
const request = (sub, email, ip = 'b'.repeat(64)) => call('hp_access_public', null, null, 'SELECT hp_app.hp_access_request_verified($1,$2,$3,$4,$5,$6) x', [ISS, sub, email, 'Applicant', ip, hash(sub)]);
async function decide(email, decision) {
  const list = await admin('SELECT hp_app.hp_access_review($1,$2) x', ['owner-sub', null]);
  const r = list.find(x => x.email === email && x.status === 'pending');
  return admin('SELECT hp_app.hp_access_decide($1,$2,$3,$4) x', ['owner-sub', r.id, r.revision, decision]);
}
async function signIn(claims) {
  const now = Math.floor(Date.now() / 1000);
  nextToken = b64({ alg: 'RS256', kid: 'fixture' }) + '.' + b64({ iss: ISS, aud: clientId, iat: now - 5, exp: now + 3000, email_verified: true, ...claims }) + '.sig';
  const start = await auth.handler(new Request(origin + '/api/auth/sign-in/social', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: origin + '/home' }) }));
  const { url } = await start.json();
  const state = new URL(url).searchParams.get('state');
  const jar = start.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const cb = await auth.handler(new Request(origin + '/api/auth/callback/google?code=fixture-code&state=' + state, { headers: { cookie: jar } }));
  const cookies = cb.headers.getSetCookie();
  return { status: cb.status, location: cb.headers.get('location'), cookies, session: cookies.find(c => /session_token/.test(c)), handoff: cookies.find(c => c.startsWith(handoff.COOKIE + '=')) };
}
before(async () => {
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fixture', token_type: 'Bearer', expires_in: 3600, id_token: nextToken, scope: 'openid email profile' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(input, init);
  };
  db = await PGlite.create();
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
  for (const f of ['001_auth.sql', '002_business.sql', '003_photos.sql', '004_photo_maintenance.sql', '005_shelf_documents.sql']) await db.exec('BEGIN;\n' + await mig(f) + '\nCOMMIT;');
  for (const [u, s, subject, email] of [[owner, os, 'owner-sub', 'jacob@appelbaums.com'], [existing, es, 'existing-sub', 'existing@example.invalid']]) {
    await q('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())', [u, subject, email]);
    await q('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())', [subject, u]);
    await q('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())', [s, 'cookie-' + subject, u]);
  }
  await q('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)', [owner, 'owner-sub']);
  await q('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', ['a'.repeat(64), owner, os, 'owner-sub']);
  await db.exec('BEGIN;\n' + await mig('006_access_requests.sql') + '\nCOMMIT;');
  await db.exec('BEGIN;\n' + await mig('007_verified_signin.sql') + '\nCOMMIT;');
  await db.exec('BEGIN;\n' + await mig('008_add_person.sql') + '\nCOMMIT;');
  auth = await createAuth({ origin, authPool: rolePool(db, 'hp_auth_runtime', { searchPath: 'hp_auth,pg_catalog' }), secret, googleClientId: clientId, googleClientSecret: 'fixture-secret' });
});
after(async () => { globalThis.fetch = realFetch; await db?.close(); });

test('a rejected sign-in leaves no user, account or session row and sets no session cookie', async () => {
  const before = await rows();
  const unknown = await signIn({ sub: 'g-unknown', email: 'unknown@example.invalid', name: 'Unknown' });
  assert.equal(unknown.status, 302);
  assert.equal(unknown.location, origin + '/auth/error?error=access_not_approved&error_description=access_not_approved');
  assert.equal(unknown.session, undefined, 'no session cookie');
  assert.ok(unknown.handoff, 'handoff cookie is set');
  assert.match(unknown.handoff, /Max-Age=600/); assert.match(unknown.handoff, /Secure/i); assert.match(unknown.handoff, /HttpOnly/i); assert.match(unknown.handoff, /SameSite=Lax/i); assert.match(unknown.handoff, /Path=\//);
  assert.ok(!/Domain=/i.test(unknown.handoff));
  const claims = handoff.open(secret, decodeURIComponent(unknown.handoff.split(';')[0].split('=')[1]));
  assert.equal(claims.subject, 'g-unknown'); assert.equal(claims.email, 'unknown@example.invalid'); assert.equal(claims.name, 'Unknown');
  assert.deepEqual({ ...(await rows()), verification: 0 }, { ...before, verification: 0 });
  // A pending request does not admit either.
  await request('g-unknown', 'unknown@example.invalid');
  const pending = await signIn({ sub: 'g-unknown', email: 'unknown@example.invalid', name: 'Unknown' });
  assert.equal(pending.session, undefined); assert.ok(pending.handoff);
  assert.equal(await count('user'), before.user); assert.equal(await count('account'), before.account); assert.equal(await count('session'), before.session);
});
test('an existing user without an approved entitlement gets no new session', async () => {
  const before = await count('session');
  const r = await signIn({ sub: 'existing-sub', email: 'existing@example.invalid', name: 'Existing' });
  assert.equal(r.session, undefined); assert.ok(r.handoff); assert.match(r.location, /access_not_approved/);
  assert.equal(await count('session'), before);
});
test('unverified, wrong-audience or mismatched identities are refused without a handoff', async () => {
  const before = await rows();
  for (const claims of [{ sub: 'g-x', email: 'x@example.invalid', email_verified: false }, { sub: 'g-x', email: 'x@example.invalid', aud: 'other.apps.googleusercontent.com' }, { sub: 'g-x', email: 'x@example.invalid', iss: 'https://evil.example' }, { sub: 'g-x', email: 'x@example.invalid', exp: 1 }]) {
    const r = await signIn(claims);
    assert.equal(r.session, undefined); assert.equal(r.handoff, undefined); assert.match(r.location, /error=/);
  }
  assert.deepEqual({ ...(await rows()), verification: 0 }, { ...before, verification: 0 });
});
test('the owner keeps access: sign-in creates a session and the entitlement is untouched', async () => {
  const before = await count('session');
  const r = await signIn({ sub: 'owner-sub', email: 'jacob@appelbaums.com', name: 'Jacob' });
  assert.equal(r.status, 302); assert.equal(r.location, origin + '/home'); assert.ok(r.session); assert.equal(r.handoff, undefined);
  assert.match(r.session, /HttpOnly/i); assert.match(r.session, /Secure/i); assert.match(r.session, /SameSite=Lax/i);
  assert.equal(await count('session'), before + 1);
  assert.equal((await q("SELECT status FROM hp_private.access_entitlements WHERE user_id=$1", [owner])).rows[0].status, 'approved');
});
test('an approved user signs in afterwards, reaches their data, and the owner is unaffected', async () => {
  await request('g-new', 'new@example.invalid', 'c'.repeat(64));
  await decide('new@example.invalid', 'approved');
  const before = await rows();
  const r = await signIn({ sub: 'g-new', email: 'new@example.invalid', name: 'New Person' });
  assert.equal(r.location, origin + '/home'); assert.ok(r.session); assert.equal(r.handoff, undefined);
  const after = await rows(); assert.equal(after.user, before.user + 1); assert.equal(after.account, before.account + 1); assert.equal(after.session, before.session + 1);
  const user = (await q('SELECT id FROM hp_auth."user" WHERE email=$1', ['new@example.invalid'])).rows[0].id;
  const sess = (await q('SELECT id FROM hp_auth.session WHERE "userId"=$1', [user])).rows[0].id;
  assert.equal((await call('hp_app_runtime', user, sess, 'SELECT hp_app.hp_access_status() x')).status, 'approved');
  const body = { kind: 'shelf', title: 'mine', schemaVersion: 3, payload: { version: 1 }, photoIds: [] };
  const created = await call('hp_app_runtime', user, sess, 'SELECT hp_app.hp_create_design($1,$2,$3,$4::jsonb) x', [user, '77777777-7777-4777-8777-777777777777', 'a'.repeat(64), JSON.stringify(body)]);
  assert.ok(created);
  const again = await signIn({ sub: 'g-new', email: 'new@example.invalid', name: 'New Person' });
  assert.ok(again.session, 'repeat sign-in keeps working');
  const o = await signIn({ sub: 'owner-sub', email: 'jacob@appelbaums.com', name: 'Jacob' }); assert.ok(o.session);
});
test('a denied user cannot sign in, and a revoked user cannot regain access', async () => {
  await request('g-no', 'no@example.invalid', 'd'.repeat(64));
  await decide('no@example.invalid', 'denied');
  const before = await rows();
  const denied = await signIn({ sub: 'g-no', email: 'no@example.invalid', name: 'No' });
  assert.equal(denied.session, undefined); assert.ok(denied.handoff);
  assert.deepEqual({ ...(await rows()), verification: 0 }, { ...before, verification: 0 });
  // Revoke the approved user created above; their old approved request must not revive them.
  const user = (await q('SELECT id FROM hp_auth."user" WHERE email=$1', ['new@example.invalid'])).rows[0].id;
  const ents = await admin('SELECT hp_app.hp_access_entitlements($1) x', ['owner-sub']);
  await admin('SELECT hp_app.hp_access_revoke($1,$2,$3) x', ['owner-sub', user, ents.find(e => e.userId === user).revision]);
  const sessionsBefore = await count('session');
  const revoked = await signIn({ sub: 'g-new', email: 'new@example.invalid', name: 'New Person' });
  assert.equal(revoked.session, undefined); assert.ok(revoked.handoff);
  assert.equal(await count('session'), sessionsBefore);
  assert.equal((await q("SELECT status FROM hp_private.access_entitlements WHERE user_id=$1", [user])).rows[0].status, 'revoked');
});
