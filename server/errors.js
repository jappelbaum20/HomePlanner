'use strict';
const { randomUUID } = require('node:crypto');

class ApiError extends Error {
  constructor(status, code, message, headers = {}) { super(message); Object.assign(this, { status, code, headers }); }
}
const fail = (status, code, message, headers) => { throw new ApiError(status, code, message, headers); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function revision(value) {
  if (typeof value !== 'string' || !/^"[1-9][0-9]{0,14}"$/.test(value)) fail(400, 'invalid_revision', 'A strong revision If-Match is required.');
  const n = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(n)) fail(400, 'invalid_revision', 'Invalid revision.');
  return n;
}
function jsonBody(req, maxBytes = 1100000) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'content_type', 'JSON is required.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > maxBytes) fail(413, 'too_large', 'Request is too large.');
    try { body = JSON.parse(body.toString()); } catch { fail(400, 'invalid_json', 'Invalid JSON.'); }
  }
  let length;
  try { length = Buffer.byteLength(JSON.stringify(body)); } catch { fail(400, 'invalid_json', 'Invalid JSON.'); }
  if (length > maxBytes) fail(413, 'too_large', 'Request is too large.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'A JSON object is required.');
  return body;
}
function wrap(action, dependencies) {
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      const expected = (dependencies && dependencies.origin) || process.env.APP_ORIGIN || 'https://home.appelbaums.com';
      if (req.headers.origin && req.headers.origin !== expected) fail(403, 'origin_denied', 'Origin is not allowed.');
      const result = await action(req, res, dependencies);
      if (res.writableEnded) return;
      if (result && result.headers) for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      const status = (result && result.status) || 200;
      if (status === 204) return res.status(204).end();
      if (result && Buffer.isBuffer(result.bytes)) {
        res.setHeader('Content-Type', result.mime);
        res.setHeader('Content-Disposition', 'inline');
        // Explicit chunks allow the Node runtime to stream beyond the platform's
        // buffered response limit. Hosting behavior still needs a live check.
        res.status(status);
        for (let offset = 0; offset < result.bytes.length; offset += 65536) res.write(result.bytes.subarray(offset, offset + 65536));
        return res.end();
      }
      return res.status(status).json(result && result.body !== undefined ? result.body : {});
    } catch (err) {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const safe = err instanceof ApiError ? err : new ApiError(503, 'unavailable', 'Service is temporarily unavailable.');
      for (const [k, v] of Object.entries(safe.headers)) res.setHeader(k, v);
      return res.status(safe.status).json({ error: { code: safe.code, message: safe.message, requestId } });
    }
  };
}
function method(req, allowed) { if (!allowed.includes(req.method)) fail(405, 'method_not_allowed', 'Method not allowed.', { Allow: allowed.join(', ') }); }
function id(value) { if (!uuid(value)) fail(404, 'not_found', 'Resource not found.'); return value.toLowerCase(); }
module.exports = { ApiError, fail, uuid, id, revision, jsonBody, wrap, method };
