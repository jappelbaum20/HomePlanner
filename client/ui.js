/* The cloud panel only invokes authenticated, explicit actions. */
window.HomePlannerCloudUI = bridge => {
  'use strict';
  const cloud = window.HomePlannerCloud, panel = document.querySelector('#cloudPanel'), dialog = document.querySelector('#cloudDlg');
  const status = document.querySelector('#cloudStatus'), signIn = document.querySelector('#cloudSignIn'), signOut = document.querySelector('#cloudSignOut');
  let identity = null, lastGeneration = -1, ready = false, openSequence = 0, writing = false;
  const text = (tag, content) => { const node = document.createElement(tag); node.textContent = content; return node; };
  const button = (label, action) => { const node = text('button', label); node.type = 'button'; node.className = 'btn small'; node.addEventListener('click', () => run(action)); return node; };
  function message(value) { status.textContent = value; }
  async function run(action) { const generation = cloud.snapshot().generation; try { await action(); } catch (e) { if (generation !== cloud.snapshot().generation) return; if (e.status === 409) message('Cloud revision changed. Your edits remain here. Reload the server version or use Save as copy.'); else message((e.message || 'The request could not be completed.') + ' Your edits remain available for retry.'); } }
  function canLeave() { return !bridge.hasUnsaved() || confirm('This workspace has unsaved changes. Export a backup first if needed. Continue?'); }
  async function refresh() {
    panel.replaceChildren();
    if (!identity?.me?.capabilities?.cloud) { panel.append(text('p', 'Cloud designs are unavailable. Local editing and backup remain available.')); return; }
    const controls = document.createElement('div'); controls.className = 'btnrow';
    if (!bridge.onlyKind || bridge.onlyKind === 'home') controls.append(button('New home', () => create('home')));
    if (!bridge.onlyKind || bridge.onlyKind === 'shelf') controls.append(button('New shelf', () => create('shelf')));
    controls.append(button('Refresh list', refresh)); panel.append(controls);
    const current = cloud.snapshot().current;
    if (!current) { const kind = bridge.onlyKind || 'home'; controls.append(button(`Create cloud copy of this ${kind}`, () => create(kind, true))); }
    if (current) {
      const label = text('p', `Open: ${current.title} · revision ${current.revision}`); panel.append(label);
      const actions = document.createElement('div'); actions.className = 'btnrow';
      actions.append(button('Save to cloud', save), button('Save as copy', () => create(current.kind, true)), button('Rename', rename), button('Delete', remove)); panel.append(actions);
    }
    const ul = document.createElement('ul'), items = [], seen = new Set(); let cursor = null; ul.className = 'cloud-list';
    do { const list = await cloud.list(cursor); if (!Array.isArray(list.items)) throw Error('Invalid design list.'); items.push(...list.items); cursor = list.nextCursor; if (cursor && (seen.has(cursor) || items.length >= 100)) throw Error('Design list pagination is invalid.'); if (cursor) seen.add(cursor); } while (cursor);
    for (const item of items.filter(item => !bridge.onlyKind || item.kind === bridge.onlyKind)) {
      const li = document.createElement('li'); li.append(text('span', `${item.title} (${item.kind})`), button('Open', () => open(item.id))); ul.append(li);
    }
    if (!items.length) panel.append(text('p', 'No cloud designs yet.'));
    panel.append(ul);
  }
  async function create(kind, copy = false) {
    if (!copy && !canLeave()) return;
    const title = prompt('Design name', copy ? (cloud.snapshot().current?.title || 'Design') + ' copy' : kind === 'home' ? 'New house' : 'New bookshelf');
    if (title === null) return;
    if (writing) throw Error('A cloud operation is already in progress.');
    writing = true;
    try {
      bridge.preserveLocal();
      const body = bridge.writeBody(kind, title.trim(), copy), stamp = bridge.editStamp(), account = cloud.snapshot();
      const result = await cloud.create(bridge.withoutPhotos(body));
      if (!cloud.isCurrent(account)) return;
      const now = cloud.snapshot();
      if (stamp !== bridge.editStamp() || now.current?.id !== account.current?.id || now.current?.revision !== account.current?.revision) { message('A cloud copy was created; newer local edits remain open and unsynced.'); await refresh(); return; }
      cloud.select(result);
      if (body.photoIds.length) {
        // Keep the source workspace open on failure. Save to cloud retries this new target.
        message('Uploading photos…');
        const prepared = await bridge.preparePhotos(body, result, stamp);
        const saved = await cloud.save(prepared.body);
        const unchanged = stamp === bridge.editStamp();
        if (unchanged) { bridge.acceptCloudSave(prepared, stamp); bridge.markSaved(); }
        message(unchanged ? `Saved to cloud · revision ${saved.revision}` : `Saved revision ${saved.revision}; newer edits remain unsynced.`);
      } else {
        bridge.openNew(kind, body.payload); bridge.markSaved(); message(`Saved to cloud · revision ${result.revision}`);
      }
      await refresh();
    } catch (e) { if (cloud.snapshot().current) await refresh().catch(() => {}); throw e; }
    finally { writing = false; }
  }
  async function open(id) {
    if (!canLeave()) return;
    bridge.preserveLocal();
    const sequence = ++openSequence, before = cloud.snapshot(), editStamp = bridge.editStamp(), design = await cloud.open(id);
    const stillCurrent = () => { const now = cloud.snapshot(); return sequence === openSequence && cloud.isCurrent(before) && now.current?.id === before.current?.id && now.current?.revision === before.current?.revision && bridge.editStamp() === editStamp; };
    await bridge.openCloud(design, before, stillCurrent);
    if (sequence !== openSequence || !cloud.isCurrent(before)) return;
    cloud.select(design); bridge.markSaved(); message(`Opened ${design.title}.`); dialog.close();
  }
  async function save() {
    if (writing) throw Error('A cloud operation is already in progress.'); writing = true;
    try {
      const current = cloud.snapshot().current, stamp = bridge.editStamp();
      const prepared = await bridge.preparePhotos(bridge.writeBody(current.kind, current.title, true), current, stamp);
      const result = await cloud.save(prepared.body);
      const unchanged = stamp === bridge.editStamp();
      if (unchanged) { bridge.acceptCloudSave(prepared, stamp); bridge.markSaved(); }
      message(unchanged ? `Saved to cloud · revision ${result.revision}` : `Saved revision ${result.revision}; newer edits remain unsynced.`); await refresh();
    } finally { writing = false; }
  }
  async function rename() {
    const current = cloud.snapshot().current, name = prompt('New name', current.title);
    if (name === null) return;
    if (writing) throw Error('A cloud operation is already in progress.'); writing = true;
    try {
      const stamp = bridge.editStamp(), prepared = await bridge.preparePhotos(bridge.writeBody(current.kind, name.trim(), true), current, stamp);
      const result = await cloud.save(prepared.body);
      if (stamp === bridge.editStamp()) { bridge.acceptCloudSave(prepared, stamp); bridge.markSaved(); } message(`Renamed · revision ${result.revision}`); await refresh();
    } finally { writing = false; }
  }
  async function remove() {
    const current = cloud.snapshot().current;
    if (!confirm(`Delete cloud design "${current.title}"? Export unsaved changes first.`)) return;
    await cloud.remove(); bridge.clearWorkspace(); message('Cloud design deleted.'); await refresh();
  }
  cloud.subscribe(next => {
    if (next.generation !== lastGeneration) {
      openSequence++; lastGeneration = next.generation;
      // An initial session check or first sign-in must not replace a local plan.
      // A previously signed-in workspace is cleared on every identity change.
      if (identity) bridge.clearWorkspace();
      identity = null; panel.replaceChildren();
    }
    identity = next.me ? next : null; bridge.identityChanged(!!identity);
    signIn.hidden = !!identity; signOut.hidden = !identity;
    message(next.error || (identity ? `Signed in as ${identity.me.displayName || 'Google user'}.` : ready ? 'Not signed in. Local editing remains available.' : 'Cloud sign-in is not configured.'));
    if (identity && dialog.open) void run(refresh);
  });
  ready = cloud.init();
  signIn.disabled = !ready; signOut.hidden = true;
  message(ready ? 'Checking sign-in…' : 'Cloud sign-in is not configured. Local editing remains available.');
  signIn.addEventListener('click', () => run(async () => { if (canLeave()) await cloud.signIn(); }));
  signOut.addEventListener('click', () => run(async () => { if (canLeave()) await cloud.signOut(); }));
  document.querySelector('#cloudBtn').addEventListener('click', () => { if (!dialog.open) dialog.showModal(); void run(refresh); });
  document.querySelector('#cloudClose').addEventListener('click', () => dialog.close());
};
