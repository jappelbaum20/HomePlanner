'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { validate, LIMITS } = require('../shared/contracts');
const { authenticate } = require('./auth');
const { ApiError, fail, id, uuid, jsonBody, wrap, method } = require('./errors');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const photoMetadata = p => ({ photoId: p.id, mime: p.mime, bytes: Number(p.bytes), checksum: p.checksum });

// Claims are bounded and owner-scoped. A failed or interrupted cleanup keeps the
// allocation and its irreversible fence; a later request can retry the claim.
async function recoverStorage(ctx, limit = 4) {
  // Only run with a backend that confirms Storage API absence after removal.
  if (ctx.backend.storageRecoveryAvailable !== true) return;
  for (let i = 0; i < limit; i++) {
    const token = randomUUID();
    let claim;
    try {
      claim = await ctx.backend.rpc('hp_claim_photo_cleanup', { p_user_id: ctx.userId, p_token: token });
      if (!claim) return;
      const prefix = `${ctx.userId}/${claim.designId}/${claim.photoId}/`;
      if (!uuid(claim.designId) || !uuid(claim.photoId) || claim.rawKey !== prefix + 'raw' || (claim.mode === 'delete' && claim.readyKey !== prefix + 'ready') || !['raw', 'delete'].includes(claim.mode)) throw new Error('invalid cleanup claim');
      for (const part of claim.mode === 'delete' ? ['raw', 'ready'] : ['raw']) {
        if (claim[part + 'Verified'] === true) continue;
        if (typeof claim[part + 'Required'] !== 'boolean' || claim[part + 'Verified'] !== false) throw new Error('invalid cleanup state');
        await ctx.backend.removeVerified(claim[part + 'Key'], claim[part + 'Required']);
        await ctx.backend.rpc('hp_record_photo_removal', { p_user_id: ctx.userId, p_photo_id: claim.photoId, p_token: token, p_part: part });
      }
      await ctx.backend.rpc('hp_finish_photo_cleanup', { p_user_id: ctx.userId, p_photo_id: claim.photoId, p_token: token });
    } catch {
      // No quota is released on an uncertain Storage or database result.
      return;
    }
  }
}

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
    if (deps?.ensurePhotoOperational) await deps.ensurePhotoOperational();
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id);
    const body = jsonBody(req, 4096);
    if (!validate('photoRequest', body).valid) fail(422, 'invalid_data', 'Invalid photo information.');
    if (deps?.photoStore) await ctx.backend.recoverStorage();
    else await recoverStorage(ctx);
    const result = await ctx.backend.rpc('hp_reserve_photo', { p_user_id: ctx.userId, p_design_id: designId, p_mime: body.mime, p_bytes: body.bytes, p_checksum: body.checksum });
    if (deps?.photoStore) {
      if (!uuid(result?.photoId)) fail(503, 'unavailable', 'Service is temporarily unavailable.');
      return { status: 201, body: { photoId: result.photoId, expiresAt: result.expiresAt, uploadUrl: `/api/designs/${designId}/photos/${result.photoId}/raw`, contentType: body.mime, maxBytes: body.bytes } };
    }
    return { status: 201, body: { photoId: result.photoId, uploadCapability: { bucket: 'design-photos', path: result.rawKey, contentType: body.mime, upsert: false }, expiresAt: result.expiresAt } };
  }, deps);
}
function createCompleteHandler(deps) {
  return wrap(async req => {
    method(req, ['POST']);
    if (deps?.ensurePhotoOperational) await deps.ensurePhotoOperational();
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id), photoId = id(req.query?.photoId);
    const body = jsonBody(req, 4096);
    if (Object.keys(body).length) fail(422, 'invalid_data', 'Invalid completion request.');
    return (deps?.withPhotoWork || (fn => fn()))(async () => {
    if (deps?.ensurePhotoOperational) await deps.ensurePhotoOperational();
    if (deps?.photoStore) {
      const reservation = await ctx.backend.photo(ctx, designId, photoId);
      if (!reservation) fail(404, 'not_found', 'Resource not found.');
      if (reservation.reservation_session_id !== ctx.sessionId) fail(409, 'session_changed', 'The session has changed.');
    }
    const token = randomUUID();
    const photo = await ctx.backend.rpc('hp_begin_photo_completion', { p_user_id: ctx.userId, p_design_id: designId, p_photo_id: photoId, p_token: token });
    if (deps?.photoStore) {
      const store = deps.photoStore;
      if (photo.status === 'ready') {
        const bytes = await store.readPart(ctx.userId, designId, photoId, 'ready');
        if (bytes.length !== Number(photo.bytes) || digest(bytes) !== photo.checksum) fail(503, 'unavailable', 'Photo is temporarily unavailable.');
        await ctx.backend.recoverStorage();
        return { body: photoMetadata(photo) };
      }
      assertKey(photo.raw_key, ctx.userId, designId, photoId, 'raw');
      const raw = await store.readPart(ctx.userId, designId, photoId, 'raw');
      if (raw.length !== Number(photo.requested_bytes) || raw.length > LIMITS.photoBytes || digest(raw) !== photo.requested_checksum) fail(422, 'invalid_photo', 'The photo does not match the upload request.');
      const cleaned = await (deps?.sanitize || sanitize)(raw, photo.requested_mime);
      if (!Buffer.isBuffer(cleaned) || !cleaned.length || cleaned.length > LIMITS.photoBytes) fail(422, 'invalid_photo', 'The photo could not be validated.');
      const checksum = digest(cleaned);
      const staged = await store.stageBytes(ctx.userId, designId, photoId, cleaned);
      let ready;
      try {
        ready = await ctx.backend.withPhotoLock(designId, photoId, 'ready', token, async locked => {
          await deps.ensurePhotoOperational();
          validateSnapshot(locked.snapshot, ctx.userId, designId, photoId);
          if (locked.snapshot.requestedMime !== photo.requested_mime || Number(locked.snapshot.requestedBytes) !== raw.length || locked.snapshot.requestedChecksum !== digest(raw)) fail(409, 'conflict', 'The photo request has changed.');
          await staged.publish('ready');
          await locked.recordPublication(cleaned.length, checksum);
          return locked.finishReady(cleaned.length, checksum);
        });
      } finally { await staged.dispose(); }
      await ctx.backend.recoverStorage();
      return { body: ready };
    }
    if (photo.status === 'ready') return { body: photoMetadata(photo) };
    const raw = await ctx.backend.download(photo.raw_key);
    if (raw.length !== Number(photo.requested_bytes) || raw.length > LIMITS.photoBytes || digest(raw) !== photo.requested_checksum) fail(422, 'invalid_photo', 'The photo does not match the upload request.');
    const cleaned = await (deps?.sanitize || sanitize)(raw, photo.requested_mime);
    const checksum = digest(cleaned);
    const cleanKey = `${ctx.userId}/${designId}/${photoId}/ready`;
    try { await ctx.backend.upload(cleanKey, cleaned, photo.requested_mime, token); }
    catch (e) {
      // An earlier attempt may have uploaded identical immutable output before its DB transaction failed.
      let existing;
      try { existing = await ctx.backend.download(cleanKey); } catch { throw e; }
      if (digest(existing) !== checksum) throw e;
    }
    const ready = await ctx.backend.rpc('hp_finish_photo_completion', { p_user_id: ctx.userId, p_design_id: designId, p_photo_id: photoId, p_token: token, p_key: cleanKey, p_bytes: cleaned.length, p_checksum: checksum });
    await recoverStorage(ctx);
    return { body: ready };
    });
  }, deps);
}
function createDownloadHandler(deps) {
  return wrap(async (req, res) => {
    method(req, ['GET']);
    if (deps?.ensurePhotoOperational) await deps.ensurePhotoOperational();
    const ctx = await authenticate(req, deps);
    const designId = id(req.query?.id), photoId = id(req.query?.photoId);
    async function read(photo) {
    if (!photo || photo.status !== 'ready' || photo.tombstoned_at) fail(404, 'not_found', 'Resource not found.');
    let bytes;
    if (deps?.photoStore) {
      assertKey(photo.object_key, ctx.userId, designId, photoId, 'ready');
      bytes = await deps.photoStore.readPart(ctx.userId, designId, photoId, 'ready');
    } else bytes = await ctx.backend.download(photo.object_key);
    if (bytes.length !== Number(photo.bytes) || digest(bytes) !== photo.checksum) fail(503, 'unavailable', 'Photo is temporarily unavailable.');
    return { bytes, mime: photo.mime };
    }
    if (typeof ctx.backend.withPhotoRead === 'function') {
      // Authorization, the metadata lookup and the (fully buffered) file read happen inside the
      // short transaction. It is committed and its pooled connection released BEFORE any byte is
      // sent, so slow clients cannot starve the pool (size 5, 5 s acquire wait).
      // Revocation semantics: a revoke committed after this point does not cut off a download
      // that is already streaming; at most that one in-flight response (bounded by the 30 s
      // limit below) may complete. Every new request re-checks approval.
      const result = await ctx.backend.withPhotoRead(designId,photoId,photo => read(photo));
      if (res.destroyed || res.writableEnded) return;
      res.setHeader('Content-Type', result.mime); res.setHeader('Content-Disposition', 'inline'); res.status(200);
      // Pipeline respects backpressure and destroys both ends on failure.
      const chunks = function* () {
        for (let offset=0; offset<result.bytes.length; offset+=65536)
          yield result.bytes.subarray(offset,offset+65536);
      };
      await pipeline(Readable.from(chunks()), res, { signal: AbortSignal.timeout(30000) });
      return;
    }
    return read(await ctx.backend.photo(ctx,designId,photoId));
  }, deps);
}

function assertKey(key, owner, design, photo, part) {
  if (key !== `${owner}/${design}/${photo}/${part}`) throw Error('Invalid storage key');
}
function validateSnapshot(s, owner, design, photo) {
  if (!s || s.ownerId !== owner || s.designId !== design || s.photoId !== photo || s.status !== 'pending' ||
      !['image/png','image/jpeg','image/webp'].includes(s.requestedMime) ||
      !Number.isSafeInteger(Number(s.requestedBytes)) || Number(s.requestedBytes) < 1 || Number(s.requestedBytes) > LIMITS.photoBytes ||
      !/^[a-f0-9]{64}$/.test(s.requestedChecksum || '') || !Number.isFinite(Date.parse(s.expiresAt)) || Date.parse(s.expiresAt) <= Date.now()) throw Error('Invalid photo snapshot');
  assertKey(s.rawKey, owner, design, photo, 'raw'); assertKey(s.readyKey, owner, design, photo, 'ready');
}
function rawError(error) {
  const safe = error instanceof ApiError ? error : error?.code === 'PHOTO_TOO_LARGE' ? new ApiError(413, 'too_large', 'Request is too large.') : error?.code === 'PHOTO_INVALID' ? new ApiError(422, 'invalid_photo', 'The photo could not be validated.') : new ApiError(503, 'unavailable', 'Service is temporarily unavailable.');
  return { status: safe.status, body: { error: { code: safe.code, message: safe.message, requestId: randomUUID() } }, headers: safe.headers };
}
function createRawHandler({ backend, photoStore, ensurePhotoOperational }) {
  return async ({ req, stream, session, params }) => {
    let staged;
    try {
      if (ensurePhotoOperational) await ensurePhotoOperational();
      const owner = id(session?.userId), design = id(params?.id), photo = id(params?.photoId);
      if (!uuid(session?.sessionId) || !backend || typeof backend.forSession !== 'function') fail(401, 'unauthenticated', 'A valid session is required.');
      const scoped = backend.forSession({ ...session });
      const snapshot = await scoped.withPhotoLock(design, photo, 'raw', null, async locked => {
        validateSnapshot(locked.snapshot, owner, design, photo); return locked.snapshot;
      });
      if (req.headers['content-type'] !== snapshot.requestedMime) fail(415, 'content_type', 'The reserved photo content type is required.');
      staged = await photoStore.stage(owner, design, photo, stream, Number(snapshot.requestedBytes));
      if (staged.bytes !== Number(snapshot.requestedBytes) || staged.checksum !== snapshot.requestedChecksum) fail(422, 'invalid_photo', 'The photo does not match the upload request.');
      await scoped.withPhotoLock(design, photo, 'raw', null, async locked => {
        if (ensurePhotoOperational) await ensurePhotoOperational();
        validateSnapshot(locked.snapshot, owner, design, photo);
        if (locked.snapshot.requestedMime !== snapshot.requestedMime || Number(locked.snapshot.requestedBytes) !== staged.bytes || locked.snapshot.requestedChecksum !== staged.checksum) fail(409, 'conflict', 'The photo request has changed.');
        await staged.publish('raw'); await locked.recordPublication(staged.bytes, staged.checksum);
      });
      return { status: 200, body: {} };
    } catch (e) {
      // The host requires consumption before it can return a structured error.
      // Its outer stream is itself bounded and timed; never publish on failure.
      if (!stream.readableEnded && !stream.destroyed) { try { for await (const _ of stream) {} } catch {} }
      return rawError(e);
    } finally { if (staged) { try { await staged.dispose(); } catch {} } }
  };
}
function createPhotoRecovery(store, limit = 4, ensurePhotoOperational = null) {
  return async ({ session, backend }) => {
    // Let callers retry an interrupted deletion or completion. No false
    // receipt or quota release is committed on filesystem or database failure.
      if (ensurePhotoOperational) await ensurePhotoOperational();
      for (let i = 0; i < limit; i++) {
        const token = randomUUID();
        const claim = await backend.rpc('hp_claim_photo_cleanup', { p_user_id: session.userId, p_token: token });
        if (!claim) break;
        const design = id(claim.designId), photo = id(claim.photoId), owner = id(session.userId);
        if (!['raw','delete'].includes(claim.mode)) throw Error('Invalid cleanup claim');
        assertKey(claim.rawKey,owner,design,photo,'raw'); assertKey(claim.readyKey,owner,design,photo,'ready');
        await backend.withPhotoLock(design,photo,'cleanup',token,async locked => {
          if (ensurePhotoOperational) await ensurePhotoOperational();
          const s = locked.snapshot;
          if (!s || s.ownerId !== owner || s.designId !== design || s.photoId !== photo || s.mode !== claim.mode) throw Error('Invalid cleanup snapshot');
          assertKey(s.rawKey,owner,design,photo,'raw'); assertKey(s.readyKey,owner,design,photo,'ready');
          for (const part of claim.mode === 'delete' ? ['raw','ready'] : ['raw']) {
            await store.remove(owner,design,photo,part); await locked.recordRemoval(part);
          }
          await locked.finishCleanup();
        });
      }
  };
}
function createPhotoService({ backend, store, origin, sanitize: sanitizer, exclusiveWriter, maintenanceReady } = {}) {
  if (!backend || typeof backend.forSession !== 'function' || !store) throw TypeError('Photo backend and store required');
  const operational = async () => store.ready() && typeof exclusiveWriter === 'function' && await exclusiveWriter() === true && typeof maintenanceReady === 'function' && await maintenanceReady() === true;
  const photoReady = async () => await operational() && await store.hasFreeSpace();
  // Cleanup must remain possible when low disk space makes readiness fail.
  const ensurePhotoOperational = async () => { if (!await operational()) fail(503, 'unavailable', 'Photo storage is temporarily unavailable.'); };
  // Hold a slot before reading raw bytes through ready publication. This bounds
  // concurrent decoder/buffer work; queued requests hold no image bytes.
  let active = 0; const waiting = [];
  const withPhotoWork = async fn => {
    if (active >= 2) {
      if (waiting.length >= 16) fail(503, 'unavailable', 'Photo processing is busy.');
      await new Promise(resolve => waiting.push(resolve));
    } else active++;
    try { return await fn(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
  const deps = { backend, photoStore: store, origin, sanitize: sanitizer, ensurePhotoOperational, withPhotoWork };
  return {
    photoHandlers: { photoReserve: createReserveHandler(deps), photoRaw: createRawHandler(deps), photoComplete: createCompleteHandler(deps), photoDownload: createDownloadHandler(deps) },
    photoRecovery: createPhotoRecovery(store, 4, ensurePhotoOperational),
    // Capacity admission is process-local. Do not report readiness without an
    // independently held exclusive volume lease and unattended recovery.
    photoReady
  };
}
module.exports = { createReserveHandler, createCompleteHandler, createDownloadHandler, createRawHandler, createPhotoRecovery, createPhotoService, recoverStorage, sanitize, digest };
