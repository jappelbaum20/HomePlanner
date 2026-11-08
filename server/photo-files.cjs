'use strict';
// Private application-owned volume. One running process owns a volume; all
// directories must be inaccessible to other writers. No request supplies paths.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { uuid } = require('./errors');

const MAX_PHOTO = 10485760;
const defaultMax = 5 * 1024 ** 3, defaultFree = 20 * 1024 ** 3;
const nofollow = constants.O_NOFOLLOW || 0;
const validId = x => uuid(x) && x === x.toLowerCase();
const sha = b => createHash('sha256').update(b).digest('hex');
const missing = e => e && e.code === 'ENOENT';
function within(a, b) { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
async function noSymlinkAncestors(file) {
  const absolute = path.resolve(file), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const st = await fs.lstat(current);
    if (st.isSymbolicLink() || !st.isDirectory()) throw Error('Unsafe storage directory');
  }
}
async function realDirSync(dir) { const h = await fs.open(dir, constants.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }

function createPhotoStore({ root, publicRoot, maxBytes = defaultMax, minFreeBytes = defaultFree, testOnly = null } = {}) {
  if (!path.isAbsolute(root || '') || !path.isAbsolute(publicRoot || '') || within(path.resolve(root), path.resolve(publicRoot)) || within(path.resolve(publicRoot), path.resolve(root))) throw TypeError('Separate absolute private and public roots required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_PHOTO || !Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0) throw TypeError('Invalid storage limits');
  if (testOnly && (process.env.NODE_ENV !== 'test' || testOnly.allowUnsafeDirectorySync !== true)) throw TypeError('Test filesystem options forbidden');
  if (!testOnly && minFreeBytes < defaultFree) throw TypeError('The minimum free-space floor is 20 GiB');
  root = path.resolve(root); publicRoot = path.resolve(publicRoot);
  const syncDir = testOnly?.syncDir || realDirSync;
  const diskFree = testOnly?.diskFree || (async dir => { const s = await fs.statfs(dir); return Number(s.bavail) * Number(s.bsize); });
  const active = new Set();
  let pending = 0, gate = Promise.resolve(), initialized = false;
  async function serialized(fn) {
    const prev = gate; let release; gate = new Promise(r => { release = r; });
    await prev; try { return await fn(); } finally { release(); }
  }
  async function checkRoot() {
    await noSymlinkAncestors(root);
    const st = await fs.stat(root);
    if (process.platform !== 'win32' && (st.mode & 0o077)) throw Error('Storage root must be private');
    if (await fs.realpath(root) !== root) throw Error('Storage root must be canonical');
  }
  async function checkDir(dir) {
    if (!within(root, dir)) throw Error('Invalid directory');
    await checkRoot();
    let current = root;
    for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const s = await fs.lstat(current);
      if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsafe storage directory');
    }
  }
  async function ensureDir(dir) {
    if (!within(root, dir)) throw Error('Invalid directory');
    await checkRoot();
    let current = root;
    for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
      const parent = current; current = path.join(current, part);
      try { await fs.mkdir(current, { mode: 0o700 }); await syncDir(parent); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
      const s = await fs.lstat(current);
      if (!s.isDirectory() || s.isSymbolicLink() || (process.platform !== 'win32' && (s.mode & 0o077))) throw Error('Unsafe storage directory');
    }
  }
  async function init() {
    await checkRoot();
    await noSymlinkAncestors(publicRoot);
    const realPublic = await fs.realpath(publicRoot), realRoot = await fs.realpath(root);
    if (within(realRoot, realPublic) || within(realPublic, realRoot)) throw Error('Public and private roots overlap');
    await ensureDir(path.join(root, 'objects')); await ensureDir(path.join(root, 'staging'));
    // Refuse activation when durable directory synchronization is unsupported.
    await syncDir(root); await diskFree(root);
    initialized = true; return true;
  }
  const assertIds = (owner, design, photo) => { if (![owner,design,photo].every(validId)) throw Error('Invalid storage identity'); };
  function location(area, owner, design, photo) { assertIds(owner,design,photo); return path.join(root, area, owner, design, photo); }
  function partPath(owner,design,photo,part) {
    if (!['raw','ready'].includes(part)) throw Error('Invalid photo part');
    return path.join(location('objects',owner,design,photo),part);
  }
  async function usedBytes(dir = root) {
    await checkDir(dir); let total = 0;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir,entry.name); let s;
      // Another local operation may retire a staged file after readdir. Its
      // reservation remains charged until this serialized scan completes.
      try { s = await fs.lstat(p); } catch (e) { if (missing(e)) continue; throw e; }
      if (s.isSymbolicLink()) throw Error('Unsafe storage entry');
      if (s.isDirectory()) total += await usedBytes(p);
      else if (s.isFile()) total += s.size;
      else throw Error('Unsafe storage entry');
      if (!Number.isSafeInteger(total)) throw Error('Storage accounting overflow');
    }
    return total;
  }
  async function admit(bytes) {
    return serialized(async () => {
      if (!initialized) throw Error('Storage unavailable');
      const used = await usedBytes(), free = await diskFree(root);
      // pending includes worst-case remaining bytes; partially written files are
      // also in used, intentionally conservative under concurrent operations.
      if (!Number.isSafeInteger(free) || used + pending + bytes > maxBytes || free - pending - bytes < minFreeBytes) throw Error('Storage capacity unavailable');
      pending += bytes;
    });
  }
  async function readPart(owner,design,photo,part) {
    if (!initialized) throw Error('Storage unavailable');
    const target = partPath(owner,design,photo,part); await checkDir(path.dirname(target));
    const st = await fs.lstat(target); if (!st.isFile() || st.isSymbolicLink() || st.size < 1 || st.size > MAX_PHOTO) throw Error('Invalid stored photo');
    const h = await fs.open(target, constants.O_RDONLY | nofollow);
    try { const opened = await h.stat(); if (!opened.isFile() || opened.size !== st.size || opened.size > MAX_PHOTO) throw Error('Invalid stored photo'); return await h.readFile(); }
    finally { await h.close(); }
  }
  async function stage(owner,design,photo,stream,max) {
    assertIds(owner,design,photo);
    if (!Number.isSafeInteger(max) || max < 1 || max > MAX_PHOTO) throw Error('Invalid stage limit');
    await admit(max);
    let file, handle, tracked = false, finished = false;
    try {
      const dir = location('staging',owner,design,photo); await ensureDir(dir);
      file = path.join(dir,randomUUID() + '.stage'); active.add(file); tracked = true;
      handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
      let size = 0, tooLarge = false; const hash = createHash('sha256');
      for await (const item of stream) {
        const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
        size += chunk.length;
        if (size > max) { tooLarge = true; continue; }
        const free = await diskFree(root);
        if (!Number.isSafeInteger(free) || free - (max - size) < minFreeBytes) throw Error('Storage capacity unavailable');
        hash.update(chunk); let offset = 0;
        while (offset < chunk.length) {
          if (testOnly?.beforeWrite) await testOnly.beforeWrite();
          const r = await handle.write(chunk, offset, chunk.length - offset); if (!r.bytesWritten) throw Error('Short storage write'); offset += r.bytesWritten;
        }
      }
      if (tooLarge) { const e = Error('Upload exceeds reservation'); e.code = 'PHOTO_TOO_LARGE'; throw e; }
      if (!size) { const e = Error('Empty upload'); e.code = 'PHOTO_INVALID'; throw e; }
      await handle.sync(); await handle.close(); handle = null; await syncDir(dir);
      const checksum = hash.digest('hex'); finished = true;
      let disposed = false;
      return {
        bytes: size, checksum,
        async publish(part) {
          if (disposed) throw Error('Stage already retired');
          const target = partPath(owner,design,photo,part), dest = path.dirname(target);
          await ensureDir(dest); await checkDir(dir); await checkDir(dest);
          try { await fs.link(file,target); }
          catch (e) {
            if (e.code !== 'EEXIST') throw e;
            const existing = await readPart(owner,design,photo,part);
            if (existing.length !== size || sha(existing) !== checksum) throw Error('Immutable object conflict');
          }
          const h = await fs.open(target, constants.O_RDWR | nofollow);
          try { const s = await h.stat(); if (!s.isFile() || s.size !== size) throw Error('Invalid published object'); await h.sync(); } finally { await h.close(); }
          await syncDir(dest);
        },
        async dispose() {
          if (disposed) return; disposed = true;
          try { await checkDir(dir); await fs.unlink(file); await syncDir(dir); }
          catch (e) { if (!missing(e)) throw e; }
          finally { active.delete(file); await serialized(async () => { pending -= max; }); }
        }
      };
    } finally {
      if (!finished) {
        if (handle) await handle.close().catch(() => {});
        if (file) { try { await checkDir(path.dirname(file)); await fs.unlink(file); await syncDir(path.dirname(file)); } catch {} }
        if (tracked) active.delete(file);
        await serialized(async () => { pending -= max; });
      }
    }
  }
  async function remove(owner,design,photo,part) {
    if (!initialized) throw Error('Storage unavailable');
    const target = partPath(owner,design,photo,part), dir = path.dirname(target);
    try {
      await checkDir(dir);
      try { const s = await fs.lstat(target); if (!s.isFile() || s.isSymbolicLink()) throw Error('Unsafe stored photo'); await fs.unlink(target); }
      catch (e) { if (!missing(e)) throw e; }
      await syncDir(dir);
      try { await fs.lstat(target); throw Error('Stored photo still present'); } catch (e) { if (!missing(e)) throw e; }
    } catch (e) {
      // ENOENT while walking a checked directory proves that the leaf cannot
      // exist, but never treat symlink, permissions or I/O errors as absence.
      if (!missing(e)) throw e;
      await noSymlinkAncestors(root);
    }
  }
  async function reapStale(owner, { before = Date.now() - 2 * 60 * 60 * 1000, limit = 100 } = {}) {
    // Retained only for legacy isolated fixtures. Production staging recovery
    // must go through the maintenance database lock and writer gate.
    if (!testOnly) throw Error('Use fenced maintenance');
    if (!initialized) throw Error('Storage unavailable');
    if (!validId(owner) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error('Invalid recovery request');
    const base = path.join(root,'staging',owner); let removed = 0;
    async function walk(dir, depth) {
      try { await checkDir(dir); } catch (e) { if (missing(e)) return; throw e; }
      for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
        if (removed >= limit) return;
        const target = path.join(dir,entry.name), s = await fs.lstat(target);
        if (s.isSymbolicLink()) throw Error('Unsafe stage entry');
        if (depth < 2) { if (!validId(entry.name) || !s.isDirectory()) throw Error('Invalid stage entry'); await walk(target,depth+1); }
        else {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.stage$/.test(entry.name) || !s.isFile()) throw Error('Invalid stage entry');
          if (!active.has(target) && s.mtimeMs < before) { await fs.unlink(target); await syncDir(dir); removed++; }
        }
      }
    }
    await walk(base,0); return removed;
  }
  async function hasFreeSpace() {
    if (!initialized) return false;
    try { const free = await diskFree(root); return Number.isSafeInteger(free) && free >= minFreeBytes; }
    catch { return false; }
  }
  // Each yielded directory entry consumes scheduler budget, including ignored
  // names. Keep the iterator across passes so a large tree cannot starve its
  // later entries. Unknown namespaces are charged but never automatically removed.
  async function* scanCandidates() {
    if (!initialized) throw Error('Storage unavailable');
    async function* walk(dir, area, ids) {
      try { await checkDir(dir); } catch (e) { if (missing(e)) return; throw e; }
      let handle;
      try { handle = await fs.opendir(dir); } catch (e) { if (missing(e)) return; throw e; }
      for await (const entry of handle) {
        const target = path.join(dir, entry.name);
        let s; try { s = await fs.lstat(target); } catch (e) { if (missing(e)) { yield null; continue; } throw e; }
        if (s.isSymbolicLink()) throw Error('Unsafe storage entry');
        if (ids.length < 3) {
          yield null;
          if (validId(entry.name) && s.isDirectory()) yield* walk(target, area, [...ids,entry.name]);
        } else {
          const valid = area === 'objects' ? ['raw','ready'].includes(entry.name) : /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.stage$/.test(entry.name);
          yield valid && s.isFile() ? Object.freeze({ area, owner:ids[0], design:ids[1], photo:ids[2], name:entry.name }) : null;
        }
      }
    }
    yield* walk(path.join(root,'objects'),'objects',[]);
    yield* walk(path.join(root,'staging'),'staging',[]);
  }
  function candidatePath(c) {
    if (!c || !['objects','staging'].includes(c.area)) throw Error('Invalid candidate');
    assertIds(c.owner,c.design,c.photo);
    if (c.area === 'objects' ? !['raw','ready'].includes(c.name) : !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.stage$/.test(c.name)) throw Error('Invalid candidate');
    return path.join(location(c.area,c.owner,c.design,c.photo),c.name);
  }
  async function candidateEligible(c, before) {
    if (!Number.isFinite(before)) throw Error('Invalid grace');
    const target=candidatePath(c), dir=path.dirname(target);
    try {
      await checkDir(dir);
      const s=await fs.lstat(target);
      if (s.isSymbolicLink() || !s.isFile()) throw Error('Unsafe storage entry');
      return !active.has(target) && s.mtimeMs < before;
    } catch (e) { if (missing(e)) return false; throw e; }
  }
  // Caller must hold the DB classification transaction and writer exclusion.
  // Recheck age and the in-process active set immediately before unlink.
  async function removeCandidate(c, before) {
    if (!await candidateEligible(c,before)) return false;
    const target=candidatePath(c), dir=path.dirname(target);
    await fs.unlink(target); await syncDir(dir);
    try { await fs.lstat(target); throw Error('Storage entry still present'); } catch (e) { if (!missing(e)) throw e; }
    return true;
  }
  return Object.freeze({ init, ready: () => initialized, hasFreeSpace, stage, stageBytes: (o,d,p,b) => stage(o,d,p,Readable.from([b]),b.length), readPart, remove, reapStale, usedBytes, scanCandidates, candidateEligible, removeCandidate });
}
module.exports = { createPhotoStore, MAX_PHOTO };
