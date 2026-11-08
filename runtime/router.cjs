'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');
const { routes } = require('./routes.cjs');
const publicFiles = new Set(require('../shared/vps-public-files.json'));

const JSON_LIMIT = 1100000, AUTH_LIMIT = 65536, RAW_LIMIT = 10485760, BODY_TIMEOUT = 30000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE = new Set(['GET', 'HEAD']);
const CSP = "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https://*.googleusercontent.com; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}
function json(res, status, body, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function error(res, status, code, message) { json(res, status, { error: { code, message, requestId: randomUUID() } }); }
function abortBody(req, res, status, code, message) {
  if (!res.headersSent) { res.setHeader('Connection', 'close'); error(res, status, code, message); }
  req.unpipe(); req.resume();
}
function declaredTooLarge(req, max) {
  const length = req.headers['content-length'];
  return length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > max);
}
function csrfFor(secret, sessionId) { return createHmac('sha256', secret).update('homeplanner-csrf-v1\0').update(sessionId).digest('base64url'); }
function equalToken(a, b) {
  if (typeof a !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function validSession(value) {
  return value && typeof value.userId === 'string' && UUID.test(value.userId) && typeof value.sessionId === 'string' && UUID.test(value.sessionId) && value.userId !== value.sessionId &&
    typeof value.displayName === 'string' && value.displayName.length <= 120 && value.sessionId !== value.token;
}
function readJson(req, res, max) {
  return new Promise((resolve, reject) => {
    if (declaredTooLarge(req, max)) { abortBody(req, res, 413, 'too_large', 'Request is too large.'); return reject(new Error('body rejected')); }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { abortBody(req, res, 415, 'content_type', 'JSON is required.'); return reject(new Error('body rejected')); }
    let size = 0, done = false; const chunks = [];
    const finish = (err, body) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(body); };
    const timer = setTimeout(() => { abortBody(req, res, 408, 'timeout', 'Request timed out.'); finish(new Error('timeout')); }, BODY_TIMEOUT);
    req.on('data', chunk => { size += chunk.length; if (size > max) { abortBody(req, res, 413, 'too_large', 'Request is too large.'); finish(new Error('too large')); } else if (!done) chunks.push(chunk); });
    req.on('aborted', () => finish(new Error('aborted'))); req.on('error', finish);
    req.on('end', () => {
      if (done) return;
      try { const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('object required'); finish(null, body); }
      catch { error(res, 400, 'invalid_json', 'A valid JSON object is required.'); finish(new Error('invalid json')); }
    });
  });
}
// The library's Node adapter receives a fresh unread stream with original bytes.
// The proxy bounds chunked as well as declared bodies and sanitizes proxy headers.
function boundedStream(req, res, max, origin) {
  let size = 0; let failed = false;
  const stream = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > max) { failed = true; abortBody(req, res, 413, 'too_large', 'Request is too large.'); callback(new Error('body too large')); }
    else callback(null, chunk);
  } });
  const timer = setTimeout(() => { failed = true; abortBody(req, res, 408, 'timeout', 'Request timed out.'); stream.destroy(new Error('body timeout')); }, BODY_TIMEOUT);
  const clear = () => clearTimeout(timer);
  stream.once('end', clear); stream.once('close', clear); req.once('aborted', () => stream.destroy(new Error('request aborted'))); req.once('error', e => stream.destroy(e));
  stream.on('error', () => {}); // Consumer also receives the error; avoid an unhandled emitter error.
  stream.method = req.method; stream.url = req.url; stream.httpVersionMajor = req.httpVersionMajor; stream.socket = req.socket;
  stream.headers = { ...req.headers, host: new URL(origin).host, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1) };
  delete stream.headers[':authority']; delete stream.headers['x-forwarded-host']; delete stream.headers['x-forwarded-for']; delete stream.headers.forwarded;
  req.pipe(stream);
  return { stream, failed: () => failed };
}
async function staticFile(req, res, pathname, dist) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!publicFiles.has(name)) return error(res, 404, 'not_found', 'Resource not found.');
  const components = name.split('/'); let current = dist;
  try {
    const root = await fs.lstat(dist); if (!root.isDirectory() || root.isSymbolicLink()) throw Error('invalid root');
    for (const part of components) { current = path.join(current, part); const info = await fs.lstat(current); if (info.isSymbolicLink()) throw Error('symlink'); }
    const bytes = await fs.readFile(current); res.setHeader('Content-Type', MIME[path.extname(name)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-cache');
    res.statusCode = 200; if (req.method === 'HEAD') return res.end(); res.end(bytes);
  } catch { error(res, 404, 'not_found', 'Resource not found.'); }
}
function createRuntime({ origin = 'https://home.appelbaums.com', dist = path.resolve('dist-vps'), integrations = {} } = {}) {
  const base = new URL(origin);
  if (base.origin !== origin || !['https:', 'http:'].includes(base.protocol) || (base.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw TypeError('Invalid fixed origin.');
  const secret = integrations.csrfSecret;
  const configured = () => typeof integrations.resolveSession === 'function' && (typeof secret === 'string' || Buffer.isBuffer(secret)) && Buffer.byteLength(secret) >= 32;
  let stopping = false;
  async function session(req, res) {
    if (!configured()) { error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); return null; }
    let value; try { value = await integrations.resolveSession(req); } catch { error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); return null; }
    if (!value) { error(res, 401, 'unauthenticated', 'A valid session is required.'); return null; }
    if (!validSession(value)) { error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); return null; }
    return value;
  }
  async function guard(req, res) {
    const value = await session(req, res); if (!value) return null;
    if (!SAFE.has(req.method)) {
      if (req.headers['x-homeplanner-session'] !== value.sessionId) { error(res, 409, 'session_changed', 'The session has changed.'); return null; }
      if (!equalToken(req.headers['x-homeplanner-csrf'], csrfFor(secret, value.sessionId))) { error(res, 403, 'csrf_denied', 'Request verification failed.'); return null; }
    }
    return value;
  }
  async function dispatch(req, res) {
    securityHeaders(res);
    if (stopping) return error(res, 503, 'unavailable', 'Service is temporarily unavailable.');
    if (SAFE.has(req.method) && (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))) return abortBody(req, res, 400, 'invalid_body', 'Request body is not allowed.');
    const rawPath = (req.url || '').split('?')[0];
    if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /[%\\\x00-\x20]/.test(rawPath)) return error(res, 404, 'not_found', 'Resource not found.');
    const parsed = new URL(req.url, origin), pathname = parsed.pathname;
    if (pathname === '/health/live' || pathname === '/health/ready') {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') return json(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', requestId: randomUUID() } }, { Allow: 'GET' });
      if (pathname.endsWith('/live')) return json(res, 200, { status: 'ok' });
      let ready = false; try { ready = configured() && typeof integrations.ready === 'function' && await integrations.ready() === true && typeof integrations.authHandler === 'function' && routes.every(route => typeof integrations.handlers?.[route.name] === 'function'); } catch {}
      return json(res, ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Origin');
      if (req.headers.authorization) return error(res, 400, 'invalid_auth', 'Cookie authentication is required.');
      if ((req.headers.origin && req.headers.origin !== origin) || (!SAFE.has(req.method) && req.headers.origin !== origin)) return error(res, 403, 'origin_denied', 'Origin is not allowed.');
      if (pathname === '/api/session') {
        if (req.method !== 'GET') return json(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', requestId: randomUUID() } }, { Allow: 'GET' });
        const s = await session(req, res); if (!s) return;
        return json(res, 200, { userId: s.userId, sessionId: s.sessionId, displayName: s.displayName, csrfToken: csrfFor(secret, s.sessionId) });
      }
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        const allowed = { '/api/auth/sign-in/social': 'POST', '/api/auth/callback/google': 'GET', '/api/auth/sign-out': 'POST' };
        if (!allowed[pathname]) return error(res, 404, 'not_found', 'Resource not found.');
        if (req.method !== allowed[pathname]) return json(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', requestId: randomUUID() } }, { Allow: allowed[pathname] });
        if (!configured() || typeof integrations.authHandler !== 'function') return error(res, 503, 'unavailable', 'Service is temporarily unavailable.');
        if (pathname === '/api/auth/sign-out' && !(await guard(req, res))) return;
        if (declaredTooLarge(req, AUTH_LIMIT)) return abortBody(req, res, 413, 'too_large', 'Request is too large.');
        const body = boundedStream(req, res, AUTH_LIMIT, origin);
        try {
          const pending = integrations.authHandler(body.stream, res);
          if (req.method === 'GET') body.stream.resume();
          await pending;
        } catch { if (!body.failed()) error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); }
        finally {
          // A handler may reject before consuming its body. Do not leave a
          // backpressured socket or its deadline alive after that response.
          if (!body.stream.readableEnded) {
            req.unpipe(body.stream); body.stream.destroy(); req.resume();
            // If the library rejected early, close after its response instead
            // of accepting an unbounded remainder on a keep-alive connection.
            if (res.writableFinished) req.socket.end(); else res.once('finish', () => req.socket.end());
          }
        }
        return;
      }
      const route = routes.find(item => item.path.test(pathname));
      if (!route) return error(res, 404, 'not_found', 'Resource not found.');
      if (!route.methods.includes(req.method)) return json(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', requestId: randomUUID() } }, { Allow: route.methods.join(', ') });
      const match = route.path.exec(pathname), query = Object.create(null);
      for (const [key, value] of parsed.searchParams) { if (Object.hasOwn(query, key) || ['id', 'photoId', '__proto__', 'constructor', 'prototype'].includes(key)) return error(res, 400, 'invalid_query', 'Invalid query.'); query[key] = value; }
      for (let i = 0; i < (route.params || []).length; i++) { if (!UUID.test(match[i + 1])) return error(res, 404, 'not_found', 'Resource not found.'); query[route.params[i]] = match[i + 1]; }
      const s = await guard(req, res); if (!s) return;
      const handler = integrations.handlers && integrations.handlers[route.name];
      if (typeof handler !== 'function') return error(res, 503, 'unavailable', 'Service is temporarily unavailable.');
      req.query = query; req.homeplannerSession = s;
      if (route.raw) {
        if (declaredTooLarge(req, RAW_LIMIT)) return abortBody(req, res, 413, 'too_large', 'Request is too large.');
        const input = boundedStream(req, res, RAW_LIMIT, origin);
        try {
          const result = await handler({ req, stream: input.stream, session: s, params: query });
          if (input.failed() || res.writableEnded) return;
          if (!input.stream.readableEnded) { input.stream.destroy(); return abortBody(req, res, 503, 'unavailable', 'Service is temporarily unavailable.'); }
          return json(res, result?.status || 200, result?.body || {}, result?.headers);
        } catch { req.unpipe(input.stream); input.stream.destroy(); if (!input.failed()) abortBody(req, res, 503, 'unavailable', 'Service is temporarily unavailable.'); return; }
      }
      if (!SAFE.has(req.method)) {
        const max = route.name === 'proposals' ? 65536 : ['photoReserve', 'photoComplete', 'adminBootstrap', 'adminModelConfig', 'adminBudget'].includes(route.name) ? 4096 : JSON_LIMIT;
        try { req.body = await readJson(req, res, max); } catch { return; }
      }
      res.status = status => { res.statusCode = status; return res; };
      res.json = body => json(res, res.statusCode || 200, body);
      try { await handler(req, res); if (!res.writableEnded) error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); }
      catch { error(res, 503, 'unavailable', 'Service is temporarily unavailable.'); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'method_not_allowed', 'Method not allowed.');
    return staticFile(req, res, pathname, dist);
  }
  const active = new Set();
  const server = http.createServer((req, res) => {
    const task = dispatch(req, res).catch(() => error(res, 503, 'unavailable', 'Service is temporarily unavailable.'));
    active.add(task); task.then(() => active.delete(task), () => active.delete(task));
  });
  server.headersTimeout = 10000; server.requestTimeout = BODY_TIMEOUT; server.keepAliveTimeout = 5000; server.maxHeadersCount = 64;
  async function stop(timeoutMs = 10000) {
    stopping = true;
    if (server.listening) await new Promise(resolve => { const timer = setTimeout(() => { server.closeAllConnections(); resolve(); }, timeoutMs); timer.unref(); server.close(() => { clearTimeout(timer); resolve(); }); server.closeIdleConnections(); });
    // Disconnected clients can still have active filesystem/database handlers.
    while (active.size) await Promise.allSettled([...active]);
    if (integrations.close) await integrations.close();
  }
  return { server, stop };
}
module.exports = { createRuntime, csrfFor, JSON_LIMIT, AUTH_LIMIT, RAW_LIMIT };
