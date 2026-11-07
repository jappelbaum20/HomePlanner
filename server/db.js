'use strict';
const { fail, uuid } = require('./errors');

const storageBucket = 'design-photos';
function mapDatabaseError(error) {
  const code = String(error && error.message || '');
  if (code.includes('HP_NOT_FOUND')) fail(404, 'not_found', 'Resource not found.');
  if (code.includes('HP_CONFLICT')) fail(409, 'conflict', 'The design or request has changed.');
  if (code.includes('HP_QUOTA')) fail(429, 'quota', 'The account limit has been reached.', { 'Retry-After': '60' });
  if (code.includes('HP_INVALID')) fail(422, 'invalid_data', 'The request cannot be accepted.');
  fail(503, 'unavailable', 'Service is temporarily unavailable.');
}
function checked(result) { if (result.error) mapDatabaseError(result.error); return result.data; }
async function removeVerified(bucket, key, expectedExisting) {
  // Application quota tracks objects accessible through Storage, not physical
  // provider media. Claimed paths are fenced against all later uploads.
  // Provider-internal asynchronous byte cleanup remains its responsibility.
  void expectedExisting;
  const missing = error => Number(error?.statusCode ?? error?.status) === 404 && (error?.code === undefined || ['NoSuchKey', 'not_found', 'ObjectNotFound'].includes(error?.code));
  const removed = await bucket.remove([key]);
  if (removed.error && !missing(removed.error)) throw new Error('Storage removal failed');
  const present = await bucket.exists(key);
  if (present.error ? !missing(present.error) : present.data !== false) throw new Error('Storage absence not confirmed');
}

function createBackend() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serverKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !serverKey) fail(503, 'unavailable', 'Cloud configuration is unavailable.');
  const { createClient } = require('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const privileged = createClient(url, serverKey, options);
  return {
    storageRecoveryAvailable: true,
    async verify(token) {
      const client = createClient(url, key, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        if (error.status === 401 || error.status === 403 || error.status === 400) return null;
        fail(503, 'unavailable', 'Authentication is temporarily unavailable.');
      }
      const user = data && data.user;
      if (!user || user.is_anonymous || !user.app_metadata || user.app_metadata.provider !== 'google') return null;
      let claims;
      try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
      if (!uuid(claims.session_id) || claims.sub !== user.id) return null;
      const active = checked(await privileged.rpc('hp_session_active', { p_user_id: user.id, p_session_id: claims.session_id }));
      if (active !== true) return null;
      return { userId: user.id, displayName: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.slice(0, 120) : '', client };
    },
    async list(ctx, cursor, limit) {
      let q = ctx.client.from('designs').select('id,kind,title,revision,updated_at').is('deleted_at', null).order('id').limit(limit + 1);
      if (cursor) q = q.gt('id', cursor);
      const rows = checked(await q);
      return { items: rows.slice(0, limit).map(row => ({ id: row.id, kind: row.kind, title: row.title, revision: Number(row.revision), updatedAt: row.updated_at })), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    },
    async get(ctx, designId) {
      const design = checked(await ctx.client.from('designs').select('id,kind,title,schema_version,payload,photo_ids,revision,created_at,updated_at').eq('id', designId).is('deleted_at', null).maybeSingle());
      if (!design) return null;
      let photos = [];
      if (design.photo_ids.length) photos = checked(await ctx.client.from('design_photos').select('id,mime,bytes,checksum').eq('design_id', designId).eq('status', 'ready').in('id', design.photo_ids));
      if (photos.length !== design.photo_ids.length) fail(503, 'unavailable', 'Design photos are temporarily unavailable.');
      const byId = new Map(photos.map(p => [p.id, { photoId: p.id, mime: p.mime, bytes: Number(p.bytes), checksum: p.checksum }]));
      return { id: design.id, kind: design.kind, title: design.title, schemaVersion: design.schema_version, payload: design.payload, photoManifest: design.photo_ids.map(id => byId.get(id)), revision: Number(design.revision), createdAt: design.created_at, updatedAt: design.updated_at };
    },
    async photo(ctx, designId, photoId) {
      return checked(await ctx.client.from('design_photos').select('id,design_id,owner_id,raw_key,object_key,requested_mime,requested_bytes,requested_checksum,status,mime,bytes,checksum,expires_at,raw_removed_at').eq('design_id', designId).eq('id', photoId).maybeSingle());
    },
    async rpc(name, args) { return checked(await privileged.rpc(name, args)); },
    async download(key) {
      const blob = checked(await privileged.storage.from(storageBucket).download(key));
      return Buffer.from(await blob.arrayBuffer());
    },
    async upload(key, bytes, mime, token) {
      checked(await privileged.storage.from(storageBucket).upload(key, bytes, { contentType: mime, upsert: false, headers: { 'x-hp-completion': token } }));
    },
    async removeVerified(key, expectedExisting) {
      await removeVerified(privileged.storage.from(storageBucket), key, expectedExisting);
    }
  };
}
module.exports = { createBackend, storageBucket, mapDatabaseError, removeVerified };
