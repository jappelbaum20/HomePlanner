'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRuntime, RAW_LIMIT, AUTH_LIMIT } = require('../runtime/router.cjs');
const { existingHandlers, routes } = require('../runtime/routes.cjs');
const { createBetterAuthHandler } = require('../runtime/node-auth.cjs');
const C = require('../shared/contracts');

const origin = 'http://localhost:4321';
const userId = '4a916412-5128-4e63-bfea-6e46e541754b';
const sessionId = '0b9aa900-1fa8-4b80-bfad-33ed290b7d19';
const otherSession = '0b9aa900-1fa8-4b80-bfad-33ed290b7d20';
const designId = '4c346412-5128-4e63-bfea-6e46e541754c';
const photoId = '4d346412-5128-4e63-bfea-6e46e541754c';
const secret = 'test-only-session-bound-secret-at-least-32-bytes';
const dist = path.resolve(__dirname, '../dist-vps');
function request(port, pathname, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, res => {
      const parts = []; res.on('data', chunk => parts.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}
async function fixture(t, integrations = {}) {
  const runtime = createRuntime({ origin, dist, integrations });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  t.after(() => runtime.stop());
  return runtime.server.address().port;
}
const session = { userId, sessionId, displayName: 'Test user' };
function integrations(extra = {}) { return { csrfSecret: secret, resolveSession: async () => session, ...extra }; }
async function headers(port) {
  const result = await request(port, '/api/session'); assert.equal(result.status, 200);
  const dto = JSON.parse(result.text); assert.equal(C.validate('session', dto).valid, true);
  return { origin, 'x-homeplanner-session': dto.sessionId, 'x-homeplanner-csrf': dto.csrfToken };
}

test('unconfigured host serves only audited files and fails closed', async t => {
  const port = await fixture(t);
  assert.equal((await request(port, '/health/live')).status, 200);
  assert.equal((await request(port, '/health/ready')).status, 503);
  const index = await request(port, '/'); assert.equal(index.status, 200); assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  for (const url of ['/house-data.js', '/package.json', '/server/auth.js', '/photos/private.jpg', '/.git/config', '/%2e%2e/house-data.js', '/vendor/supabase.js', '/api/unknown']) assert.equal((await request(port, url)).status, 404, url);
  assert.equal((await request(port, '/api/auth/sign-in/social', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, chunks: ['{}'] })).status, 503);
  assert.equal((await request(port, '/api/session')).status, 503);
  assert.equal((await request(port, '/api/auth/callback/google', { headers: { 'content-length': '1' }, chunks: ['x'] })).status, 400);
});

test('VPS public bytes contain no private starter fingerprints or personal photo files', async t => {
  const seedPath = path.resolve(__dirname, '../house-data.js'), photoDir = path.resolve(__dirname, '../photos');
  if (!fs.existsSync(seedPath) || !fs.existsSync(photoDir)) { t.skip('Private inputs unavailable for comparison'); return; }
  const { enumerate } = await import('../scripts/audit-public.mjs');
  const output = await enumerate(dist), contents = output.map(name => fs.readFileSync(path.join(dist, name)));
  const sandbox = vm.createContext({ window: {} }), seed = fs.readFileSync(seedPath);
  vm.runInContext(seed.toString('utf8'), sandbox, { timeout: 5000 });
  const fingerprints = new Set();
  function visit(value, key = '') {
    if (typeof value === 'string' && ['name', 'notes', 'link', 'src'].includes(key) && value.length >= 30) fingerprints.add(value);
    else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => visit(v, k));
  }
  visit(sandbox.window); assert.ok(fingerprints.size >= 20);
  for (const fp of fingerprints) for (const bytes of contents) assert.equal(bytes.includes(Buffer.from(fp)), false, 'private seed fingerprint in public artifact');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const photos = await enumerate(photoDir); assert.ok(photos.length > 0);
  const photoHashes = new Set(photos.map(name => hash(fs.readFileSync(path.join(photoDir, name)))));
  for (const bytes of contents) { assert.notEqual(hash(bytes), hash(seed)); assert.equal(photoHashes.has(hash(bytes)), false); }
});

test('session DTO, exact origin, CSRF and expected session bind every unsafe API request', async t => {
  let calls = 0;
  const port = await fixture(t, integrations({ handlers: { designs: async (req, res) => { calls++; res.status(201).json({ value: req.body.value }); } } }));
  const h = await headers(port), input = { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, chunks: ['{"value":', '42}'] };
  assert.equal((await request(port, '/api/designs', input)).status, 201); assert.equal(calls, 1);
  for (const change of [{ origin: 'https://foreign.example' }, { origin: undefined }, { 'x-homeplanner-csrf': 'A'.repeat(43) }, { 'x-homeplanner-session': otherSession }]) {
    const hdr = { ...input.headers, ...change }; for (const k of Object.keys(hdr)) if (hdr[k] === undefined) delete hdr[k];
    const response = await request(port, '/api/designs', { ...input, headers: hdr }); assert.ok([403, 409].includes(response.status));
  }
  assert.equal(calls, 1);
  assert.equal((await request(port, '/api/designs', { headers: { authorization: 'Bearer example' } })).status, 400);
  assert.equal((await request(port, '/api/designs', { headers: { origin: 'https://foreign.example' } })).status, 403);
});

test('chunked JSON is bounded before dispatch, with invalid JSON and query ambiguity rejected', async t => {
  let calls = 0;
  const port = await fixture(t, integrations({ handlers: { proposals: async (_req, res) => { calls++; res.status(200).json({}); }, design: async (_req, res) => res.status(200).json({}) } }));
  const h = await headers(port), headersJson = { ...h, 'content-type': 'application/json' };
  assert.equal((await request(port, '/api/shelf-proposals', { method: 'POST', headers: headersJson, chunks: ['{"x":"', 'a'.repeat(65536), '"}'] })).status, 413);
  assert.equal((await request(port, '/api/shelf-proposals', { method: 'POST', headers: headersJson, chunks: ['{broken'] })).status, 400);
  assert.equal((await request(port, `/api/designs/${designId}?id=${photoId}`)).status, 400);
  assert.equal((await request(port, '/api/designs?limit=1&limit=2')).status, 400);
  assert.equal(calls, 0);
});

test('explicit route adapter preserves path ids, query, status and response headers', async t => {
  const captured = [];
  const port = await fixture(t, integrations({ handlers: {
    design: async (req, res) => { captured.push(req.query); res.setHeader('ETag', '"4"'); res.status(200).json({ id: req.query.id }); },
    photoComplete: async (req, res) => { captured.push(req.query); res.status(200).json({ ok: true }); }
  } }));
  const h = await headers(port);
  const response = await request(port, `/api/designs/${designId}?cursor=${photoId}`); assert.equal(response.status, 200); assert.equal(response.headers.etag, '"4"');
  assert.equal(captured[0].id, designId); assert.equal(captured[0].cursor, photoId);
  assert.equal((await request(port, `/api/designs/${designId}/photos/${photoId}/complete`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, chunks: ['{}'] })).status, 200);
  assert.equal(captured[1].photoId, photoId);
  assert.equal((await request(port, `/api/designs/${designId}/photos/${photoId}/complete`, { method: 'GET' })).status, 405);
  assert.equal((await request(port, '/api/designs/not-a-uuid')).status, 404);
  for (const name of Object.keys(existingHandlers({}))) assert.ok(routes.some(route => route.name === name));
});

test('raw upload is streamed and bounded even with chunked transfer', async t => {
  let received = 0;
  const port = await fixture(t, integrations({ handlers: { photoRaw: async ({ stream, params }) => {
    assert.equal(params.photoId, photoId); for await (const chunk of stream) received += chunk.length;
    return { status: 201, body: { bytes: received } };
  } } }));
  const h = await headers(port), url = `/api/designs/${designId}/photos/${photoId}/raw`;
  assert.equal((await request(port, url, { method: 'PUT', headers: { ...h, 'content-type': 'image/png' }, chunks: [Buffer.from('abc'), Buffer.from('def')] })).status, 201); assert.equal(received, 6);
  received = 0;
  const result = await request(port, url, { method: 'PUT', headers: { ...h, 'content-type': 'image/png' }, chunks: [Buffer.alloc(RAW_LIMIT / 2), Buffer.alloc(RAW_LIMIT / 2), Buffer.from('x')] });
  assert.equal(result.status, 413); assert.ok(received <= RAW_LIMIT);
});

test('actual pinned Node adapter receives untouched auth bytes; auth limits and sign-out guard apply', async t => {
  let observed = '', observedUrl, forwardedHost;
  const auth = { api: { getSession: async () => null }, handler: async req => { observed = await req.text(); observedUrl = req.url; forwardedHost = req.headers.get('x-forwarded-host'); return Response.json({ received: observed }); } };
  const authHandler = await createBetterAuthHandler(auth);
  const port = await fixture(t, integrations({ authHandler }));
  const input = { method: 'POST', headers: { origin, 'content-type': 'application/json', host: 'evil.example', 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example' }, chunks: ['{"provider":', '"google"}'] };
  const response = await request(port, '/api/auth/sign-in/social', input); assert.equal(response.status, 200); assert.equal(observed, '{"provider":"google"}');
  assert.equal(observedUrl, origin + '/api/auth/sign-in/social'); assert.equal(forwardedHost, null);
  assert.equal((await request(port, '/api/auth/sign-in/social', { ...input, chunks: ['x'.repeat(AUTH_LIMIT), 'x'] })).status, 413);
  assert.equal((await request(port, '/api/auth/sign-out', { ...input, chunks: ['{}'] })).status, 409);
  const h = await headers(port);
  assert.equal((await request(port, '/api/auth/sign-out', { ...input, headers: { ...input.headers, ...h }, chunks: ['{}'] })).status, 200);
  assert.equal((await request(port, '/api/auth/callback/google')).status, 200);
  assert.equal((await request(port, '/api/auth/get-session')).status, 404);
});

test('invalid identity and unavailable session store fail closed', async t => {
  const invalidPort = await fixture(t, integrations({ resolveSession: async () => ({ ...session, sessionId: 'secret-token' }) }));
  assert.equal((await request(invalidPort, '/api/session')).status, 503);
  const brokenPort = await fixture(t, integrations({ resolveSession: async () => { throw Error('database down'); } }));
  assert.equal((await request(brokenPort, '/api/session')).status, 503);
  const missingPort = await fixture(t, integrations({ resolveSession: async () => null }));
  assert.equal((await request(missingPort, '/api/session')).status, 401);
});

test('real Better Auth instance rejects an unconfigured provider rather than simulating login', async t => {
  const { betterAuth } = await import('better-auth');
  const auth = betterAuth({ baseURL: origin, secret: 'test-only-secret-1234567890-1234567890-123456', socialProviders: {}, telemetry: { enabled: false } });
  const port = await fixture(t, integrations({ authHandler: await createBetterAuthHandler(auth) }));
  const response = await request(port, '/api/auth/sign-in/social', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, chunks: ['{"provider":"google"}'] });
  assert.notEqual(response.status, 200); assert.equal(response.headers['cache-control'], 'private, no-store');
});

test('reservation contract rejects foreign, mismatched, or oversized raw destinations', () => {
  const value = { photoId, expiresAt: '2026-11-08T00:00:00Z', uploadUrl: `/api/designs/${designId}/photos/${photoId}/raw`, contentType: 'image/png', maxBytes: RAW_LIMIT };
  assert.equal(C.validate('uploadReservation', value).valid, true);
  for (const bad of [{ uploadUrl: `https://evil.example${value.uploadUrl}` }, { uploadUrl: `/api/designs/${designId}/photos/${designId}/raw` }, { maxBytes: RAW_LIMIT + 1 }, { bucket: 'private' }]) assert.equal(C.validate('uploadReservation', { ...value, ...bad }).valid, false);
});

test('shutdown keeps integrations alive until disconnected handlers settle', async () => {
 let release, entered, closed=false; const gate=new Promise(r=>{release=r;}); const started=new Promise(r=>{entered=r;});
 const rt=createRuntime({origin,dist,integrations:integrations({handlers:{designs:async(req,res)=>{entered();await gate;res.json({items:[]});}},close:async()=>{closed=true;}})});
 await new Promise(r=>rt.server.listen(0,'127.0.0.1',r));
 const pending=request(rt.server.address().port,'/api/designs').catch(()=>null);
 await started; const stopping=rt.stop(10);
 await new Promise(r=>setTimeout(r,40)); assert.equal(closed,false);
 release(); await stopping; await pending; assert.equal(closed,true);
});

test('admin identity widget receives origin-only cross-origin referrers', async t => {
 const port=await fixture(t);
 assert.equal((await request(port,'/admin.html')).headers['referrer-policy'],'strict-origin-when-cross-origin');
 assert.equal((await request(port,'/')).headers['referrer-policy'],'no-referrer');
 assert.equal((await request(port,'/api/session')).headers['referrer-policy'],'no-referrer');
});
