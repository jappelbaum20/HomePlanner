'use strict';
const { createHash } = require('node:crypto');
const { validate, LIMITS } = require('../shared/contracts');
const { authenticate } = require('./auth');
const { fail, id, jsonBody, wrap, method } = require('./errors');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const photoMetadata = p => ({ photoId: p.id, mime: p.mime, bytes: Number(p.bytes), checksum: p.checksum });

async function sanitize(bytes, mime) {
  let sharp;
  try { sharp = require('sharp'); } catch { fail(503, 'unavailable', 'Photo processing is unavailable.'); }
  try {
    const input = sharp(bytes, { failOn: 'warning', limitInputPixels: 40000000, animated: false });
    const meta = await input.metadata();
    const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
    if (meta.format !== formats[mime] || !meta.width || !meta.height || meta.width * meta.height > 40000000 || (meta.pages || 1) !== 1) throw new Error('invalid image');
    // Sharp strips metadata by default. Rotate before stripping orientation.
    const output = await input.rotate().toFormat(meta.format).toBuffer();
    if (!output.length || output.length > LIMITS.photoBytes) throw new Error('invalid output');
    return output;
  } catch { fail(422, 'invalid_photo', 'The photo could not be validated.'); }
}
function createReserveHandler(deps) {
  return wrap(async req => {
    method(req, ['POST']);
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id);
    const body = jsonBody(req, 4096);
    if (!validate('photoRequest', body).valid) fail(422, 'invalid_data', 'Invalid photo information.');
    const result = await ctx.backend.rpc('hp_reserve_photo', { p_user_id: ctx.userId, p_design_id: designId, p_mime: body.mime, p_bytes: body.bytes, p_checksum: body.checksum });
    return { status: 201, body: { photoId: result.photoId, uploadCapability: { bucket: 'design-photos', path: result.rawKey, contentType: body.mime, upsert: false }, expiresAt: result.expiresAt } };
  }, deps);
}
function createCompleteHandler(deps) {
  return wrap(async req => {
    method(req, ['POST']);
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id), photoId = id(req.query?.photoId);
    const body = jsonBody(req, 4096);
    if (Object.keys(body).length) fail(422, 'invalid_data', 'Invalid completion request.');
    const photo = await ctx.backend.photo(ctx, designId, photoId);
    if (!photo) fail(404, 'not_found', 'Resource not found.');
    if (photo.status === 'ready') return { body: photoMetadata(photo) };
    if (Date.parse(photo.expires_at) <= Date.now()) fail(409, 'conflict', 'The upload reservation expired.');
    const raw = await ctx.backend.download(photo.raw_key);
    if (raw.length !== Number(photo.requested_bytes) || raw.length > LIMITS.photoBytes || digest(raw) !== photo.requested_checksum) fail(422, 'invalid_photo', 'The photo does not match the upload request.');
    const cleaned = await (deps?.sanitize || sanitize)(raw, photo.requested_mime);
    const checksum = digest(cleaned);
    const cleanKey = `${ctx.userId}/${designId}/${photoId}/ready`;
    try { await ctx.backend.upload(cleanKey, cleaned, photo.requested_mime); }
    catch (e) {
      // An earlier attempt may have uploaded identical immutable output before its DB transaction failed.
      let existing;
      try { existing = await ctx.backend.download(cleanKey); } catch { throw e; }
      if (digest(existing) !== checksum) throw e;
    }
    const ready = await ctx.backend.rpc('hp_photo_ready', { p_user_id: ctx.userId, p_design_id: designId, p_photo_id: photoId, p_key: cleanKey, p_bytes: cleaned.length, p_checksum: checksum });
    try {
      await ctx.backend.remove(photo.raw_key);
      await ctx.backend.rpc('hp_photo_raw_removed', { p_user_id: ctx.userId, p_design_id: designId, p_photo_id: photoId });
    } catch { /* Keep its reservation until a reviewed cleanup reconciles storage. */ }
    return { body: ready };
  }, deps);
}
function createDownloadHandler(deps) {
  return wrap(async req => {
    method(req, ['GET']);
    const ctx = await authenticate(req, deps);
    const photo = await ctx.backend.photo(ctx, id(req.query?.id), id(req.query?.photoId));
    if (!photo || photo.status !== 'ready') fail(404, 'not_found', 'Resource not found.');
    const bytes = await ctx.backend.download(photo.object_key);
    if (bytes.length !== Number(photo.bytes) || digest(bytes) !== photo.checksum) fail(503, 'unavailable', 'Photo is temporarily unavailable.');
    return { bytes, mime: photo.mime };
  }, deps);
}
module.exports = { createReserveHandler, createCompleteHandler, createDownloadHandler, sanitize, digest };
