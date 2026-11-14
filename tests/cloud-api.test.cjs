'use strict';
// These tests use a fake database and fake identities. They do not prove RLS,
// Supabase Auth, Storage, or hosted transport behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const B = require('../bookshelf');
const me = require('../api/me');
const collection = require('../api/designs');
const item = require('../api/designs/[id]');
const reserve = require('../api/designs/[id]/photos');
const complete = require('../api/designs/[id]/photos/[photoId]/complete');
const download = require('../api/designs/[id]/photos/[photoId]');
const { ApiError } = require('../server/errors');
const { sanitize, digest } = require('../server/photos');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BUSER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const write = () => ({ kind: 'shelf', title: 'Shelf', schemaVersion: 3, payload: B.saetter3(), photoIds: [] });

function fake() {
  const designs = new Map(), keys = new Map(), photos = new Map(), objects = new Map(), work = new Map();
  const errors = (status, code) => { throw new ApiError(status, code, code); };
  const backend = {
    storageRecoveryAvailable: true,
    async verify(token) { return token === 'a.b.c' ? { userId: A, displayName: 'A' } : token === 'b.b.c' ? { userId: BUSER, displayName: 'B' } : null; },
    async list(ctx) { return { items: [...designs.values()].filter(x => x.owner === ctx.userId && !x.deleted).map(x => ({ id: x.id, revision: x.revision })), nextCursor: null }; },
    async get(ctx, id) { const d = designs.get(id); return d && d.owner === ctx.userId && !d.deleted ? d : null; },
    async photo(ctx, did, pid) { const p = photos.get(pid); return p && p.owner_id === ctx.userId && p.design_id === did && !designs.get(did)?.deleted ? p : null; },
    async rpc(name, args) {
      if (name === 'hp_create_design') {
        const k = args.p_user_id + args.p_key, prev = keys.get(k);
        if (prev) { if (prev.hash !== args.p_body_hash) errors(409, 'conflict'); return prev.result; }
        const d = { id: randomUUID(), owner: args.p_user_id, ...args.p_body, revision: 1 };
        designs.set(d.id, d); const result = { design: structuredClone(d), revision: 1 }; keys.set(k, { hash: args.p_body_hash, result }); return result;
      }
      if (name === 'hp_update_design' || name === 'hp_delete_design') {
        const d = designs.get(args.p_id);
        if (!d || d.owner !== args.p_user_id || d.deleted) errors(404, 'not_found');
        if (d.revision !== args.p_revision) errors(409, 'conflict');
        if (name === 'hp_delete_design') { d.deleted = true; d.revision++; return null; }
        for (const p of args.p_body.photoIds) { const photo = photos.get(p); if (!photo || photo.owner_id !== d.owner || photo.design_id !== d.id || photo.status !== 'ready') errors(422, 'invalid_data'); }
        Object.assign(d, args.p_body); d.revision++;
        return { design: structuredClone(d), revision: d.revision };
      }
      if (name === 'hp_reserve_photo') {
        const d = designs.get(args.p_design_id);
        if (!d || d.owner !== args.p_user_id || d.deleted) errors(404, 'not_found');
        const pid = randomUUID(), raw = `${args.p_user_id}/${d.id}/${pid}/raw`, expires = new Date(Date.now() + 60000).toISOString();
        photos.set(pid, { id: pid, design_id: d.id, owner_id: args.p_user_id, raw_key: raw, requested_mime: args.p_mime, requested_bytes: args.p_bytes, requested_checksum: args.p_checksum, status: 'pending', expires_at: expires });
        return { photoId: pid, rawKey: raw, expiresAt: expires };
      }
      if (name === 'hp_begin_photo_completion') {
        const d = designs.get(args.p_design_id), p = photos.get(args.p_photo_id);
        if (!d || d.deleted || !p || p.owner_id !== args.p_user_id || p.design_id !== d.id) errors(404, 'not_found');
        if (p.status === 'pending') {
          if (work.has(p.id)) errors(409, 'conflict');
          work.set(p.id, { mode:'completing', token:args.p_token });
        }
        return { ...p };
      }
      if (name === 'hp_finish_photo_completion') {
        const d = designs.get(args.p_design_id), p = photos.get(args.p_photo_id);
        if (!d || d.deleted || !p || p.owner_id !== args.p_user_id || p.design_id !== d.id) errors(404, 'not_found');
        if (work.get(p.id)?.token !== args.p_token) errors(409, 'conflict');
        Object.assign(p, { status: 'ready', object_key: args.p_key, mime: p.requested_mime, bytes: args.p_bytes, checksum: args.p_checksum });
        work.delete(p.id);
        return { photoId: p.id, mime: p.mime, bytes: p.bytes, checksum: p.checksum };
      }
      if (name === 'hp_claim_photo_cleanup') {
        const p = [...photos.values()].find(x => x.owner_id === args.p_user_id && x.status === 'ready' && !x.raw_removed_at && !work.has(x.id));
        if (!p) return null;
        work.set(p.id, { mode:'raw', token:args.p_token });
        return { photoId:p.id, designId:p.design_id, rawKey:p.raw_key, mode:'raw',rawRequired:objects.has(p.raw_key),rawVerified:false };
      }
      if (name === 'hp_record_photo_removal') return null;
      if (name === 'hp_finish_photo_cleanup') {
        const p = photos.get(args.p_photo_id);
        if (!p || work.get(p.id)?.token !== args.p_token) errors(409, 'conflict');
        p.raw_removed_at = new Date().toISOString(); work.delete(p.id); return null;
      }
      throw new Error('unexpected fake call');
    },
    async download(key) { if (!objects.has(key)) throw new Error('offline storage'); return objects.get(key); },
    async upload(key, data) { if (objects.has(key)) throw new Error('already exists'); objects.set(key, data); },
    async removeVerified(key) { objects.delete(key); }
  };
  return { backend, objects, photos };
}
async function call(factory, state, method, { token = 'a.b.c', body, query = {}, headers = {} } = {}) {
  const req = { method, query, body, headers: { authorization: `Bearer ${token}`, ...headers } };
  if (body !== undefined) req.headers['content-type'] ||= 'application/json';
  const res = { headers: {}, chunks: [], statusCode: 200, writableEnded: false,
    setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; },
    json(v) { this.data = v; this.writableEnded = true; return this; },
    write(v) { this.chunks.push(Buffer.from(v)); }, end() { this.writableEnded = true; return this; } };
  await factory({ backend: state.backend, origin: 'https://home.appelbaums.com' })(req, res);
  res.bytes = Buffer.concat(res.chunks); return res;
}

test('fake API: fail-closed identity, origin, methods and safe errors', async () => {
  const s = fake();
  assert.equal((await call(me.createHandler,s,'GET',{token:'bad.b.c'})).statusCode, 401);
  assert.equal((await call(me.createHandler,s,'GET',{headers:{origin:'https://elsewhere.invalid'}})).statusCode, 403);
  assert.equal((await call(me.createHandler,s,'POST')).statusCode, 405);
  const r = await call(me.createHandler,s,'GET');
  assert.deepEqual(r.data.capabilities, { cloud: true, ai: false }); assert.equal(r.data.isAdmin, false);
  assert.equal(r.headers['cache-control'], 'private, no-store');
  s.backend.verify = async () => { throw new Error('private backend diagnostic'); };
  const failed = await call(me.createHandler,s,'GET'); assert.equal(failed.statusCode,503);
  assert.doesNotMatch(JSON.stringify(failed.data), /private backend diagnostic/);
});

test('fake API: schema validation, scoped access, idempotency and simultaneous CAS', async () => {
  const s = fake(), key = randomUUID(), hdr = { 'idempotency-key': key };
  const invalid = write(); invalid.ownerId = BUSER;
  assert.equal((await call(collection.createHandler,s,'POST',{body:invalid,headers:hdr})).statusCode,422);
  const a = await call(collection.createHandler,s,'POST',{body:write(),headers:hdr});
  assert.equal(a.statusCode,201);
  const again = await call(collection.createHandler,s,'POST',{body:write(),headers:hdr});
  assert.deepEqual(again.data,a.data);
  const other = write(); other.title = 'Changed';
  assert.equal((await call(collection.createHandler,s,'POST',{body:other,headers:hdr})).statusCode,409);
  const id = a.data.design.id, query = { id };
  assert.equal((await call(item.createHandler,s,'GET',{token:'b.b.c',query})).statusCode,404);
  assert.equal((await call(item.createHandler,s,'PUT',{token:'b.b.c',query,body:write(),headers:{'if-match':'"1"'}})).statusCode,404);
  assert.equal((await call(item.createHandler,s,'PUT',{query,body:write(),headers:{'if-match':'W/"1"'}})).statusCode,400);
  const pair = await Promise.all([call(item.createHandler,s,'PUT',{query,body:write(),headers:{'if-match':'"1"'}}),call(item.createHandler,s,'PUT',{query,body:write(),headers:{'if-match':'"1"'}})]);
  assert.deepEqual(pair.map(x => x.statusCode).sort(),[200,409]);
  assert.equal((await call(item.createHandler,s,'DELETE',{query,body:{},headers:{'if-match':'"2"'}})).statusCode,204);
  assert.equal((await call(item.createHandler,s,'GET',{query})).statusCode,404);
});

test('fake API plus real image decoder: upload, validate, sanitize and authorize', async () => {
  const sharp = require('sharp'), s = fake();
  const create = await call(collection.createHandler,s,'POST',{body:write(),headers:{'idempotency-key':randomUUID()}});
  const id = create.data.design.id;
  const raw = await sharp({ create:{ width:3,height:2,channels:3,background:'#ff0000' } }).jpeg().withMetadata().toBuffer();
  const r = await call(reserve.createHandler,s,'POST',{query:{id},body:{mime:'image/jpeg',bytes:raw.length,checksum:digest(raw)}});
  assert.equal(r.statusCode,201); const photoId = r.data.photoId, path = r.data.uploadCapability.path;
  assert.equal((await call(download.createHandler,s,'GET',{query:{id,photoId}})).statusCode,404);
  s.objects.set(path,raw);
  assert.equal((await call(complete.createHandler,s,'POST',{token:'b.b.c',query:{id,photoId},body:{}})).statusCode,404);
  const done = await call(complete.createHandler,s,'POST',{query:{id,photoId},body:{}});
  assert.equal(done.statusCode,200); assert.notEqual(done.data.checksum,digest(raw));
  const image = await call(download.createHandler,s,'GET',{query:{id,photoId}});
  assert.equal(image.statusCode,200); assert.equal(digest(image.bytes),done.data.checksum);
  const meta = await sharp(image.bytes).metadata(); assert.equal(meta.exif,undefined); assert.equal(meta.format,'jpeg');
  assert.equal((await call(download.createHandler,s,'GET',{token:'b.b.c',query:{id,photoId}})).statusCode,404);
  assert.equal(s.objects.has(path),false);
});

test('real image decoder rejects malformed, mismatched and truncated bytes', async () => {
  const sharp = require('sharp');
  const png = await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(sanitize(Buffer.from('<html>'), 'image/png'), e => e.status === 422);
  await assert.rejects(sanitize(png, 'image/jpeg'), e => e.status === 422);
  await assert.rejects(sanitize(png.subarray(0,12), 'image/png'), e => e.status === 422);
});

test('fake API: mismatched bytes and deleted-design upload race do not make photos ready', async () => {
  const sharp = require('sharp'), s = fake();
  const created = await call(collection.createHandler,s,'POST',{body:write(),headers:{'idempotency-key':randomUUID()}});
  const id = created.data.design.id;
  const raw = await sharp({create:{width:2,height:2,channels:3,background:'#000'}}).png().toBuffer();
  const allocated = await call(reserve.createHandler,s,'POST',{query:{id},body:{mime:'image/png',bytes:raw.length,checksum:digest(raw)}});
  const photoId = allocated.data.photoId, query = {id,photoId};
  s.objects.set(allocated.data.uploadCapability.path, Buffer.alloc(raw.length));
  assert.equal((await call(complete.createHandler,s,'POST',{query,body:{}})).statusCode,422);
  assert.equal(s.photos.get(photoId).status,'pending');
  s.objects.set(allocated.data.uploadCapability.path, raw);
  const pending = write(); pending.photoIds = [photoId];
  assert.equal((await call(item.createHandler,s,'PUT',{query:{id},body:pending,headers:{'if-match':'"1"'}})).statusCode,422);
  assert.equal((await call(item.createHandler,s,'DELETE',{query:{id},body:{},headers:{'if-match':'"1"'}})).statusCode,204);
  assert.equal((await call(complete.createHandler,s,'POST',{query,body:{}})).statusCode,404);
});

test('cloud writes reject unreferenced photo IDs before storing an unreadable manifest', () => {
 const {validate}=require('../shared/contracts');
 const body=write(); assert.equal(validate('writeDesign',body).valid,true);
 body.photoIds=[A]; const result=validate('writeDesign',body);
 assert.equal(result.valid,false); assert.ok(result.errors.includes('Unreferenced photo IDs are not allowed.'));
});
