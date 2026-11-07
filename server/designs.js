'use strict';
const { createHash } = require('node:crypto');
const { validate } = require('../shared/contracts');
const { authenticate } = require('./auth');
const { fail, uuid, id, revision, jsonBody, wrap, method } = require('./errors');
const { recoverStorage } = require('./photos');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function checkedWrite(req) {
  const body = jsonBody(req);
  if (!validate('writeDesign', body).valid) fail(422, 'invalid_data', 'Invalid design.');
  return body;
}
function etag(n) { return { ETag: `"${n}"` }; }
function createCollectionHandler(deps) {
  return wrap(async req => {
    method(req, ['GET', 'POST']);
    const ctx = await authenticate(req, deps);
    if (req.method === 'GET') {
      const rawLimit = req.query?.limit;
      if (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^[1-9][0-9]?$/.test(rawLimit) || Number(rawLimit) > 50)) fail(400, 'invalid_limit', 'Limit must be between 1 and 50.');
      const cursor = req.query?.cursor;
      if (cursor !== undefined && !uuid(cursor)) fail(400, 'invalid_cursor', 'Invalid cursor.');
      return { body: await ctx.backend.list(ctx, cursor || null, rawLimit ? Number(rawLimit) : 50) };
    }
    const body = checkedWrite(req);
    const key = req.headers['idempotency-key'];
    if (!uuid(key)) fail(400, 'invalid_idempotency_key', 'A UUID Idempotency-Key is required.');
    const hash = createHash('sha256').update(canonical(body)).digest('hex');
    const result = await ctx.backend.rpc('hp_create_design', { p_user_id: ctx.userId, p_key: key.toLowerCase(), p_body_hash: hash, p_body: body });
    return { status: 201, body: result, headers: etag(result.revision) };
  }, deps);
}
function createItemHandler(deps) {
  return wrap(async req => {
    method(req, ['GET', 'PUT', 'DELETE']);
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id);
    if (req.method === 'GET') {
      const design = await ctx.backend.get(ctx, designId);
      if (!design) fail(404, 'not_found', 'Resource not found.');
      return { body: { design, revision: design.revision }, headers: etag(design.revision) };
    }
    const base = revision(req.headers['if-match']);
    if (req.method === 'DELETE') {
      if (Object.keys(jsonBody(req, 4096)).length) fail(422, 'invalid_data', 'Invalid deletion request.');
      await ctx.backend.rpc('hp_delete_design', { p_user_id: ctx.userId, p_id: designId, p_revision: base });
      await recoverStorage(ctx);
      return { status: 204 };
    }
    const body = checkedWrite(req);
    const result = await ctx.backend.rpc('hp_update_design', { p_user_id: ctx.userId, p_id: designId, p_revision: base, p_body: body });
    return { body: result, headers: etag(result.revision) };
  }, deps);
}
module.exports = { createCollectionHandler, createItemHandler, canonical };
