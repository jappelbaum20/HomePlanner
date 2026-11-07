/* Browser auth and API boundary. The SDK is injected as a pinned, self-hosted bundle. */
window.HomePlannerCloud = (() => {
  'use strict';
  const config = window.HOMEPLANNER_CONFIG || {};
  let sdk = null, session = null, generation = 0, authEventSerial = 0, me = null, current = null, busy = null, pendingCreate = null;
  const pending = new Set(), listeners = new Set(), uploads = new Map();
  const validConfig = () => !!(config.url && config.publishableKey && window.HomePlannerSupabase?.createClient);
  function sessionKey(value) {
    if (!value) return null;
    try { const part = value.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); const claims = JSON.parse(atob(part)); if (claims.session_id) return claims.session_id; } catch (_) { /* Non-JWT fixture or invalid token. */ }
    return value.access_token || null;
  }
  const snapshot = () => ({ generation, userId: session?.user?.id || null, me, current: current && { ...current } });
  function invalidate() {
    generation++; for (const controller of pending) controller.abort(); pending.clear();
    session = null; me = null; current = null; busy = null; pendingCreate = null; uploads.clear();
    listeners.forEach(fn => fn(snapshot()));
  }
  function isCurrent(stamp) { return !!session && stamp.generation === generation && stamp.userId === session.user.id; }
  async function request(path, options = {}) {
    if (!session?.access_token || !session.user?.id) throw Error('Sign in before using private designs.');
    const stamp = snapshot(), token = session.access_token, controller = new AbortController();
    pending.add(controller);
    const headers = { Authorization: `Bearer ${token}`, ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(path, { ...options, headers, cache: 'no-store', signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      if (!isCurrent(stamp)) throw Error('Account changed; the response was discarded.');
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!isCurrent(stamp)) throw Error('Account changed; the response was discarded.');
      if (!response.ok) { const error = Error(payload?.error?.message || `Request failed (${response.status}).`); error.status = response.status; throw error; }
      return payload;
    } finally { pending.delete(controller); }
  }
  async function photo(designId, photoId) {
    if (!session?.access_token) throw Error('Sign in before loading photos.');
    const stamp = snapshot(), token = session.access_token, controller = new AbortController();
    pending.add(controller);
    try {
      const response = await fetch(`/api/designs/${encodeURIComponent(designId)}/photos/${encodeURIComponent(photoId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal
      });
      if (!isCurrent(stamp) || !response.ok) throw Error('A private photo could not be loaded.');
      const blob = await response.blob();
      if (!isCurrent(stamp) || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > 10485760) throw Error('Invalid or stale photo response.');
      return blob;
    } finally { pending.delete(controller); }
  }
  // A separate SDK client pins the token captured at the start of the operation.
  // Its fetch wrapper also aborts storage traffic when the session changes.
  async function uploadPhoto(designId, sourceId, blob, guard) {
    const stamp = snapshot(), token = session?.access_token;
    const check = () => { if (!isCurrent(stamp) || !guard()) throw Error('Account, design or edits changed; upload cancelled.'); };
    check();
    if (!blob || !['image/jpeg','image/png','image/webp'].includes(blob.type) || !blob.size || blob.size > 10485760) throw Error('A photo is missing or has an unsupported size or format.');
    const bytes = await blob.arrayBuffer(); check();
    const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); check();
    const key = `${designId}:${sourceId}:${checksum}`, base = `/api/designs/${encodeURIComponent(designId)}/photos`;
    let entry = uploads.get(key);
    if (!entry) {
      const reserved = await request(base, { method: 'POST', body: { mime: blob.type, bytes: blob.size, checksum } }); check();
      const cap = reserved?.uploadCapability;
      if (!/^[0-9a-f-]{36}$/i.test(reserved?.photoId || '') || cap?.bucket !== 'design-photos' || cap.path !== `${stamp.userId}/${designId}/${reserved.photoId}/raw` || cap.contentType !== blob.type || cap.upsert !== false) throw Error('Invalid photo reservation.');
      entry = { photoId: reserved.photoId, cap, expiresAt: reserved.expiresAt, uploaded: false, ready: null }; uploads.set(key, entry);
    }
    if (entry.ready) return entry.ready;
    if (!entry.uploaded) {
      const controller = new AbortController(); pending.add(controller);
      try {
        const scoped = window.HomePlannerSupabase.createClient(config.url, config.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init = {}) => {
            check(); const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
            headers.set('Authorization', `Bearer ${token}`);
            return fetch(input, { ...init, headers, signal: controller.signal });
          } }
        });
        const result = await scoped.storage.from(entry.cap.bucket).upload(entry.cap.path, blob, { contentType: entry.cap.contentType, upsert: false });
        check();
        // A failed or lost upload response can still mean that the immutable object exists.
        // Completion verifies its bytes; it is the only authority for readiness.
        entry.uploaded = !result.error;
      } finally { pending.delete(controller); }
    }
    check();
    let ready;
    try { ready = await request(`${base}/${encodeURIComponent(entry.photoId)}/complete`, { method: 'POST', body: {} }); }
    catch (error) { if (error.status === 409 && Date.parse(entry.expiresAt) <= Date.now()) uploads.delete(key); throw error; }
    check();
    if (ready?.photoId !== entry.photoId || !['image/jpeg','image/png','image/webp'].includes(ready.mime) || !Number.isInteger(ready.bytes) || ready.bytes < 1 || ready.bytes > 10485760 || !/^[a-f0-9]{64}$/.test(ready.checksum || '')) throw Error('Invalid completed photo metadata.');
    entry.ready = ready; entry.uploaded = true; return ready;
  }
  async function setSession(next) {
    const id = next?.user?.id || null, previous = session?.user?.id || null;
    if (id !== previous || (id && sessionKey(next) !== sessionKey(session))) invalidate();
    if (!id) { listeners.forEach(fn => fn(snapshot())); return; }
    session = next; const stamp = snapshot();
    try {
      const result = await request('/api/me');
      if (!isCurrent(stamp) || result.userId !== id) throw Error('Session identity could not be verified.');
      me = result; listeners.forEach(fn => fn(snapshot()));
    } catch (error) { if (isCurrent(stamp)) { invalidate(); listeners.forEach(fn => fn({ ...snapshot(), error: error.message })); } }
  }
  function init() {
    if (!validConfig()) return false;
    sdk = window.HomePlannerSupabase.createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
    });
    sdk.auth.onAuthStateChange((_event, next) => {
      const eventSerial = ++authEventSerial;
      if (session && (next?.user?.id !== session.user.id || sessionKey(next) !== sessionKey(session))) invalidate();
      setTimeout(() => { if (eventSerial === authEventSerial) void setSession(next); }, 0);
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      invalidate(); const restoreGeneration = generation, restoreEvent = authEventSerial;
      void sdk.auth.getSession().then(({ data }) => { if (generation === restoreGeneration && authEventSerial === restoreEvent && !session) return setSession(data.session); }).catch(() => {});
    });
    return true;
  }
  async function signIn() {
    if (!sdk) throw Error('Cloud sign-in is not configured.');
    const result = await sdk.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } });
    if (result.error) throw result.error;
  }
  async function signOut() { const old = sdk; invalidate(); if (old) { const { error } = await old.auth.signOut(); if (error) throw error; } }
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
  function cancelPending() { for (const controller of pending) controller.abort(); pending.clear(); }
  function select(design) {
    if (current?.id !== design.id || current?.revision !== design.revision) cancelPending();
    current = { id: design.id, kind: design.kind, title: design.title, revision: design.revision };
  }
  function clearCurrent() { cancelPending(); current = null; }
  return { init, signIn, signOut, list, open, create, save, remove, request, photo, uploadPhoto, snapshot, isCurrent, select, clearCurrent,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
})();
