/* Same-origin cookie session and private API boundary. */
window.HomePlannerCloud = (() => {
  'use strict';
  let auth = null, session = null, generation = 0, epoch = 0, serial = 0, verification = null, me = null, current = null, busy = null, pendingCreate = null;
  const pending = new Set(), listeners = new Set(), uploads = new Map();
  const signalKey = 'homeplanner.session.changed';
  const snapshot = () => ({ generation, epoch, userId: session?.userId || null, sessionId: session?.sessionId || null, me, current: current && { ...current } });
  function cancelPending() { for (const controller of pending) controller.abort(); pending.clear(); }
  function notify(error, revalidating = false) { listeners.forEach(fn => fn({ ...snapshot(), ...(error ? { error } : {}), revalidating })); }
  function broadcast() { try { localStorage.setItem(signalKey, crypto.randomUUID()); } catch (_) { /* Focus/pageshow still revalidate if storage is unavailable. */ } }
  function invalidate() {
    generation++; epoch++; cancelPending();
    session = null; me = null; current = null; busy = null; pendingCreate = null; uploads.clear(); notify();
  }
  function isCurrent(stamp) { return !!session && !!stamp && stamp.generation === generation && stamp.epoch === epoch && stamp.userId === session.userId && stamp.sessionId === session.sessionId; }
  function checkedPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//') || new URL(path, location.origin).origin !== location.origin) throw Error('Invalid private API path.');
    return path;
  }
  function mutationHeaders(stamp, headers) {
    if (!isCurrent(stamp)) throw Error('Account changed; the operation was cancelled.');
    const result = new Headers(headers || {});
    if (result.has('Authorization')) throw Error('Cookie authentication is required.');
    result.set('X-HomePlanner-Session', stamp.sessionId);
    result.set('X-HomePlanner-CSRF', session.csrfToken);
    return result;
  }
  async function responseError(response) {
    const payload = await response.json().catch(() => null);
    const error = Error(payload?.error?.message || `Request failed (${response.status}).`);
    error.status = response.status; error.code = payload?.error?.code; return error;
  }
  async function ensureVerified(stamp) {
    if (verification) await verification;
    if (!isCurrent(stamp)) throw Error('Account changed; the operation was cancelled.');
  }
  async function verificationStamp(original) {
    // Only identity verification callbacks may adopt a freshly checked epoch.
    // Ordinary writes retain strict epoch cancellation.
    while (verification) await verification;
    const next = snapshot();
    if (!original || !next.me || !isCurrent(next) || original.generation !== next.generation ||
        original.userId !== next.userId || original.sessionId !== next.sessionId)
      throw Error('Account changed; verification was cancelled.');
    return next;
  }
  async function request(path, options = {}) {
    checkedPath(path);
    const stamp = options.expected || snapshot(); await ensureVerified(stamp);
    const controller = new AbortController(); pending.add(controller);
    const method = (options.method || 'GET').toUpperCase(), unsafe = !['GET', 'HEAD'].includes(method);
    const headers = unsafe ? mutationHeaders(stamp, options.headers) : new Headers(options.headers || {});
    if (headers.has('Authorization')) throw Error('Cookie authentication is required.');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    try {
      const response = await fetch(path, { method, headers, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      if (!isCurrent(stamp)) throw Error('Account changed; the response was discarded.');
      if (!response.ok) {
        const error = await responseError(response);
        if (!isCurrent(stamp)) throw Error('Account changed; the response was discarded.');
        if (error.status === 401 || error.code === 'session_changed') { serial++; invalidate(); broadcast(); void refreshSession(); }
        throw error;
      }
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!isCurrent(stamp)) throw Error('Account changed; the response was discarded.');
      return payload;
    } finally { pending.delete(controller); }
  }
  async function photo(designId, photoId) {
    const stamp = snapshot(); await ensureVerified(stamp);
    const controller = new AbortController(); pending.add(controller);
    try {
      const response = await fetch(`/api/designs/${encodeURIComponent(designId)}/photos/${encodeURIComponent(photoId)}`, {
        credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal: controller.signal
      });
      if (!isCurrent(stamp) || !response.ok) throw Error('A private photo could not be loaded.');
      const blob = await response.blob();
      if (!isCurrent(stamp) || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > 10485760) throw Error('Invalid or stale photo response.');
      return blob;
    } finally { pending.delete(controller); }
  }
  /* Promise.all semantics with at most `limit` tasks in flight; results keep input order, the first failure rejects and stops new starts. */
  function mapLimit(items, limit, fn) {
    const list = Array.from(items), results = new Array(list.length), width = Math.max(1, Math.min(limit | 0 || 1, list.length));
    let next = 0, failed = false;
    const worker = async () => {
      while (!failed && next < list.length) {
        const i = next++;
        try { results[i] = await fn(list[i], i); } catch (error) { failed = true; throw error; }
      }
    };
    return Promise.all(Array.from({ length: width }, worker)).then(() => results);
  }
  const photos = (designId, ids) => mapLimit(ids, 4, id => photo(designId, id));
  async function uploadPhoto(designId, sourceId, blob, guard) {
    const stamp = snapshot();
    const check = () => { if (!isCurrent(stamp) || !guard()) throw Error('Account, design or edits changed; upload cancelled.'); };
    await ensureVerified(stamp); check();
    if (!blob || !['image/jpeg','image/png','image/webp'].includes(blob.type) || !blob.size || blob.size > 10485760) throw Error('A photo is missing or has an unsupported size or format.');
    const bytes = await blob.arrayBuffer(); check();
    const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); check();
    const key = `${designId}:${sourceId}:${checksum}`, base = `/api/designs/${encodeURIComponent(designId)}/photos`;
    let entry = uploads.get(key);
    if (entry && !entry.ready && Date.parse(entry.expiresAt) <= Date.now()) { uploads.delete(key); entry = null; }
    if (!entry) {
      const reserved = await request(base, { method: 'POST', body: { mime: blob.type, bytes: blob.size, checksum }, expected: stamp }); check();
      await window.HomePlannerContractsReady; check();
      const expiresAt = Date.parse(reserved?.expiresAt);
      if (!window.HomePlannerContracts?.validate('uploadReservation', reserved).valid || reserved.uploadUrl !== `${base}/${reserved.photoId}/raw` || reserved.contentType !== blob.type || blob.size > reserved.maxBytes || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw Error('Invalid photo reservation.');
      entry = { ...reserved, uploaded: false, ready: null }; uploads.set(key, entry);
    }
    if (entry.ready) return entry.ready;
    if (!entry.uploaded) {
      const controller = new AbortController(); pending.add(controller);
      try {
        const response = await fetch(entry.uploadUrl, { method: 'PUT', headers: mutationHeaders(stamp, { 'Content-Type': entry.contentType }),
          credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal: controller.signal, body: blob });
        check();
        if (response.status === 401 || response.status === 409) {
          const error = await responseError(response); check();
          if (error.status === 401 || error.code === 'session_changed') { serial++; invalidate(); broadcast(); void refreshSession(); throw error; }
        }
        // Even a lost/error response can mean immutable bytes reached the server.
        // Completion verifies the bytes and is the sole readiness authority.
        entry.uploaded = response.ok;
      } catch (error) { check(); if (error.name === 'AbortError') throw error; }
      finally { pending.delete(controller); }
    }
    check();
    let ready;
    try { ready = await request(`${base}/${encodeURIComponent(entry.photoId)}/complete`, { method: 'POST', body: {}, expected: stamp }); }
    catch (error) { if (error.status === 409 && Date.parse(entry.expiresAt) <= Date.now()) uploads.delete(key); throw error; }
    check();
    if (ready?.photoId !== entry.photoId || !['image/jpeg','image/png','image/webp'].includes(ready.mime) || !Number.isInteger(ready.bytes) || ready.bytes < 1 || ready.bytes > 10485760 || !/^[a-f0-9]{64}$/.test(ready.checksum || '')) throw Error('Invalid completed photo metadata.');
    entry.ready = ready; entry.uploaded = true; return ready;
  }
  function refreshSession(announce = true) {
    const ticket = ++serial; epoch++; cancelPending();
    const task = (async () => {
      // Publish the verification barrier before notifying subscribers.
      await Promise.resolve();
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store' });
        if (ticket !== serial) return;
        if (response.status === 401) { const hadSession = !!session; if (hadSession) invalidate(); else notify(); if (hadSession) broadcast(); return; }
        if (!response.ok) throw await responseError(response);
        const next = await response.json();
        await window.HomePlannerContractsReady;
        if (ticket !== serial) return;
        if (!window.HomePlannerContracts?.validate('session', next).valid || next.userId === next.sessionId) throw Error('Session identity could not be verified.');
        const changed = !session || next.userId !== session.userId || next.sessionId !== session.sessionId;
        if (changed) invalidate();
        session = next;
        if (next.access.status !== 'approved') {
          me = { userId: next.userId, displayName: next.displayName, isAdmin: false, capabilities: { cloud: false, ai: false }, access: next.access };
          notify(); if (changed && announce) broadcast(); return;
        }
        const identityResponse = await fetch('/api/me', { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store' });
        if (!identityResponse.ok) throw await responseError(identityResponse);
        const result = await identityResponse.json();
        if (ticket !== serial || session !== next) return;
        if (result.userId !== next.userId) throw Error('Session identity could not be verified.');
        me = result; notify(); if (changed && announce) broadcast();
      } catch (error) {
        if (ticket !== serial) return;
        invalidate(); notify(error.message || 'Session verification is unavailable.');
      }
    })();
    verification = task;
    notify(undefined, true);
    task.finally(() => { if (verification === task) verification = null; });
    return task;
  }
  function init() {
    if (!window.HomePlannerAuth?.createAuthClient) return false;
    auth = window.HomePlannerAuth.createAuthClient({ baseURL: location.origin });
    window.addEventListener('storage', event => {
      if (event.key !== signalKey) return;
      serial++; invalidate(); void refreshSession(false);
    });
    window.addEventListener('focus', () => { void refreshSession(); });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      serial++; invalidate(); void refreshSession();
    });
    void refreshSession(); return true;
  }
  async function signIn() {
    if (!auth) throw Error('Cloud sign-in is not configured.');
    const page = ['/home', '/bookshelf', '/admin.html', '/access'].includes(location.pathname) ? location.pathname : '/';
    const query = page === '/bookshelf' && /^\?design=[0-9a-f-]{36}$/i.test(location.search) ? location.search :
      page === '/admin.html' && /^\?accessRequest=[0-9a-f-]{36}$/.test(location.search) ? location.search : '';
    const result = await auth.signIn.social({ provider: 'google', callbackURL: `${location.origin}${page}${query}` });
    if (result?.error) throw Error(result.error.message || 'Sign-in is unavailable.');
  }
  async function signOut() {
    const stamp = snapshot(); await ensureVerified(stamp);
    const headers = mutationHeaders(stamp, { 'Content-Type': 'application/json' });
    const result = fetch('/api/auth/sign-out', { method: 'POST', headers, body: '{}', credentials: 'same-origin', mode: 'same-origin', cache: 'no-store' });
    serial++; invalidate(); broadcast();
    try {
      const response = await result;
      if (!response.ok) throw await responseError(response);
      // A peer may have revalidated before the server completed the logout.
      broadcast();
    } catch (error) {
      void refreshSession(); broadcast(); throw error;
    }
  }
  async function list(cursor) { const query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', cursor); return request('/api/designs?' + query); }
  async function open(id) {
    const result = await request(`/api/designs/${encodeURIComponent(id)}`), design = result.design || result;
    if (!design || design.id !== id || !Number.isSafeInteger(design.revision) || !['home','shelf'].includes(design.kind)) throw Error('Invalid design response.');
    return design;
  }
  function validateWrite(body) {
    if (!window.HomePlannerContracts) throw Error('Design validation is unavailable. Cloud writes are disabled.');
    const result = window.HomePlannerContracts.validate('writeDesign', body);
    if (!result.valid) throw Error('This design cannot be saved: ' + result.errors.slice(0, 3).join('; '));
  }
  async function create(body) {
    validateWrite(body); const stamp = snapshot();
    const fingerprint = JSON.stringify(body);
    if (!pendingCreate || pendingCreate.fingerprint !== fingerprint) pendingCreate = { fingerprint, key: crypto.randomUUID() };
    const attempt = pendingCreate;
    const result = await request('/api/designs', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body });
    const design = result.design; const revision = result.revision ?? design?.revision;
    if (!isCurrent(stamp) || !design?.id || !Number.isSafeInteger(revision)) throw Error('Invalid create response.');
    if (pendingCreate === attempt) pendingCreate = null;
    return { id: design.id, kind: body.kind, title: body.title, revision };
  }
  async function save(body) {
    validateWrite(body); if (!current) throw Error('Open a cloud design first.');
    if (busy) throw Error('A save is already in progress.');
    const base = { ...current }, stamp = snapshot(), operation = {}; busy = operation;
    try {
      const result = await request(`/api/designs/${encodeURIComponent(base.id)}`, { method: 'PUT', headers: { 'If-Match': `"${base.revision}"` }, body });
      const revision = result.revision ?? result.design?.revision;
      if (!isCurrent(stamp) || current?.id !== base.id || current.revision !== base.revision || !Number.isSafeInteger(revision) || revision <= base.revision) throw Error('Save response is stale or invalid.');
      current = { ...base, title: body.title, revision }; return current;
    } finally { if (busy === operation) busy = null; }
  }
  async function remove() {
    if (!current) throw Error('Open a cloud design first.');
    const base = { ...current }, stamp = snapshot();
    await request(`/api/designs/${encodeURIComponent(base.id)}`, { method: 'DELETE', headers: { 'If-Match': `"${base.revision}"` }, body: {} });
    if (!isCurrent(stamp) || current?.id !== base.id) throw Error('Account or design changed.');
    current = null;
  }
  function select(design) {
    if (current?.id !== design.id || current?.revision !== design.revision) cancelPending();
    current = { id: design.id, kind: design.kind, title: design.title, revision: design.revision };
  }
  function clearCurrent() { cancelPending(); current = null; }
  return { init, signIn, signOut, list, open, create, save, remove, request, photo, photos, mapLimit, uploadPhoto, snapshot, isCurrent, verificationStamp, select, clearCurrent,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
})();
