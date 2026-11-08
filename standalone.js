/* Independent shelf workspace. It never constructs or loads a home or a room. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), clone = value => JSON.parse(JSON.stringify(value));
  const cloud = window.HomePlannerCloud, contracts = () => window.HomePlannerContracts;
  const prefix = 'homeplanner.standalone.v2.', draftKey = prefix + 'draft', listKey = prefix + 'designs', transferKey = prefix + 'transfer';
  let draft = null, ui, loading = false, cloudWorkspace = false, legacy = false, edit = 0, saved = 0, currentLocalId = null, currentLocalOriginal = null, persisted = null, available = true, legacyOrigin = null;
  function clearLegacyOrigin() { legacyOrigin = null; try { sessionStorage.removeItem(prefix + 'legacyOrigin'); } catch {} }
  const toast = text => { $('#toast').textContent = text; $('#standaloneStatus').textContent = text; };
  const valid = (name, value) => contracts()?.validate(name, value).valid === true;
  const documentFor = d => ({ version: 2, shelf: clone(d.design), wall: clone(d.wall), placement: { offsetCm: d.target.offset, elevationCm: d.target.elev, gapCm: d.target.gap }, activeTab: d.tab });
  function normalize(value) {
    if (valid('shelfDocument', value)) return { document: clone(value), legacy: false };
    if (valid('shelf', value)) return { document: { version: 2, shelf: clone(value), wall: { widthCm: 500, heightCm: 500, color: '#EEEDE8' }, placement: { offsetCm: 0, elevationCm: 0, gapCm: 0 }, activeTab: value.template === 'saetter3' ? 'saetter' : 'custom' }, legacy: true };
    throw Error('The shelf file does not match a supported contract.');
  }
  function readList() {
    const list = JSON.parse(localStorage.getItem(listKey) || '[]');
    if (!Array.isArray(list) || list.some(x => !x || typeof x.id !== 'string' || typeof x.title !== 'string' || !valid('shelfDocument', x.document))) throw Error('The saved design list is invalid; its data was left untouched.');
    return list;
  }
  function persistDraft() {
    const localSource = currentLocalId && currentLocalOriginal ? { id: currentLocalId, original: currentLocalOriginal } : null;
    localStorage.setItem(draftKey, JSON.stringify({ version: 1, draft, localSource }));
  }
  function saveLocal(d) {
    const document = documentFor(d); if (!valid('shelfDocument', document)) { toast('The design cannot be saved until its values are valid.'); return null; }
    try {
      if (legacyOrigin) {
        if (localStorage.getItem(legacyOrigin.key) !== legacyOrigin.original) throw Error('The original local design changed. Make a copy before saving.');
        const envelope = { ...JSON.parse(legacyOrigin.original), schemaVersion: 4, payload: document, title: (d.name || 'Bookshelf').slice(0, 100), modifiedAt: new Date().toISOString() };
        if (!valid('local', envelope)) throw Error('The original local design cannot be upgraded.');
        localStorage.setItem(legacyOrigin.key, JSON.stringify(envelope)); legacyOrigin.original = JSON.stringify(envelope); sessionStorage.setItem(prefix + 'legacyOrigin', JSON.stringify(legacyOrigin));
        legacy = false; toast('Saved in this browser.'); return null;
      }
      const list = readList(), id = currentLocalId || crypto.randomUUID(), title = (d.name || 'Bookshelf').slice(0, 100);
      const index = list.findIndex(x => x.id === id), entry = { id, title, document };
      if (currentLocalId && (index < 0 || JSON.stringify(list[index]) !== currentLocalOriginal)) throw Error('The saved local design changed. Reopen it or make a copy before saving.');
      if (index < 0) list.push(entry); else list[index] = entry;
      localStorage.setItem(listKey, JSON.stringify(list)); currentLocalId = id; currentLocalOriginal = JSON.stringify(entry); legacy = false; toast('Saved in this browser.');
    } catch (error) { available = false; toast(error.message || 'Browser storage is unavailable. Export the design JSON.'); }
    return null;
  }
  function loadDocument(value, title, isCloud = false) {
    const checked = normalize(value); legacy = checked.legacy; cloudWorkspace = isCloud;
    loading = true; draft = null; ui.reset(); ui.openDocument(checked.document, title); draft = ui.currentDraft(); loading = false;
    edit = saved = 0;
    if (!isCloud) { try { persistDraft(); } catch { available = false; } }
    if (legacy) toast('Legacy shelf opened with a 500 × 500 cm neutral wall and zero placement. Save explicitly to upgrade.');
  }
  function canLeave() { return !cloudWorkspace || edit === saved || confirm('This cloud design has unsaved changes. Continue?'); }
  function hashShelf(shelf) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(HomePlannerCanonicalize(shelf))).then(bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('')); }
  const bridge = {
    mode: 'standalone', rooms: () => [], activeRoom: () => null, pieces: () => [], hasPlacement: () => false,
    toast, storageAvailable: () => available, cloudWorkspace: () => cloudWorkspace, legacyDefault: () => legacy,
    detach() { if (!canLeave()) return false; cloud.clearCurrent(); cloudWorkspace = false; currentLocalId = null; currentLocalOriginal = null; persisted = null; legacy = false; clearLegacyOrigin(); return true; },
    document: documentFor,
    draft: function (value, immediate) {
      if (!arguments.length) return draft;
      draft = clone(value);
      if (!loading && immediate) edit++;
      if (!loading && !cloudWorkspace && valid('shelfDocument', documentFor(draft))) {
        try { persistDraft(); } catch { available = false; }
      }
      return draft;
    },
    show: () => {}, collisions: () => [], saveDesign: saveLocal,
    canPropose: () => !!(cloud.snapshot().me?.capabilities?.ai && cloud.snapshot().current && persisted),
    async propose(shelf, prompt) {
      const account = cloud.snapshot(), base = account.current, stamp = edit;
      const savedShelf = persisted?.payload?.version === 2 ? persisted.payload.shelf : persisted?.payload;
      if (!base || persisted?.id !== base.id || persisted?.revision !== base.revision || HomePlannerCanonicalize(savedShelf) !== HomePlannerCanonicalize(shelf)) throw Error('Save the current shelf to cloud before requesting a preview.');
      const baseHash = await hashShelf(shelf), requestId = crypto.randomUUID();
      if (!cloud.isCurrent(account) || edit !== stamp) throw Error('The account or design changed.');
      const body = { requestId, designId: base.id, baseRevision: base.revision, baseHash, shelf, prompt };
      if (!valid('proposalRequest', body)) throw Error('The proposal request is invalid.');
      const result = await cloud.request('/api/shelf-proposals', { method: 'POST', headers: { 'Idempotency-Key': requestId }, body, expected: account });
      if (!valid('proposal', result) || result.baseRevision !== base.revision || result.baseHash !== baseHash) throw Error('The proposal response is invalid.');
      const proposal = { account, edit: stamp, designId: base.id, revision: base.revision, result };
      if (!bridge.proposalCurrent(proposal)) throw Error('The design changed. Request a new preview.');
      return proposal;
    },
    proposalCurrent: p => cloud.isCurrent(p.account) && cloud.snapshot().current?.id === p.designId && cloud.snapshot().current?.revision === p.revision && edit === p.edit && Date.parse(p.result.expiresAt) > Date.now()
  };
  const cloudBridge = {
    onlyKind: 'shelf',
    clearWorkspace() { if (cloudWorkspace) { currentLocalId = null; currentLocalOriginal = null; persisted = null; cloudWorkspace = false; loadDocument(Bookshelf.preset('staggered', 240, 200), 'Bookshelf'); } },
    identityChanged() {}, preserveLocal() {}, hasUnsaved: () => cloudWorkspace && edit !== saved, editStamp: () => edit,
    markSaved() { saved = edit; ui.updateStorage(); },
    writeBody(kind, title, copy) {
      if (kind !== 'shelf' || !title || title.length > 120) throw Error('Enter a valid shelf title.');
      const payload = copy ? documentFor(ui.currentDraft()) : normalize(Bookshelf.preset('staggered', 240, 200)).document;
      const body = { kind, title, schemaVersion: 4, payload, photoIds: [] };
      if (!valid('writeDesign', body)) throw Error('This shelf cannot be saved until its values are valid.');
      return body;
    },
    withoutPhotos: body => clone(body),
    async preparePhotos(body, target, stamp) { if (stamp !== edit || cloud.snapshot().current?.id !== target.id || cloud.snapshot().current?.revision !== target.revision) throw Error('The design changed.'); return { body, target: target.id }; },
    acceptCloudSave(prepared, stamp) { if (stamp === edit) { const current = cloud.snapshot().current; persisted = { id: prepared.target, revision: current.revision, payload: clone(prepared.body.payload) }; legacy = false; ui.updateStorage(); } },
    openNew(kind, payload) { if (kind !== 'shelf') throw Error('Open homes in the home planner.'); clearLegacyOrigin(); currentLocalId = null; currentLocalOriginal = null; loadDocument(payload, cloud.snapshot().current?.title, true); const current = cloud.snapshot().current; persisted = current ? { id: current.id, revision: current.revision, payload: clone(payload) } : null; ui.updateStorage(); },
    async openCloud(design, account, stillCurrent) {
      if (design.kind !== 'shelf' || !Array.isArray(design.photoManifest) || design.photoManifest.length) throw Error('This is not a standalone shelf.');
      const body = { kind: design.kind, title: design.title, schemaVersion: design.schemaVersion, payload: design.payload, photoIds: [] };
      if (!valid('writeDesign', body)) throw Error('The server returned an invalid shelf.');
      if (!cloud.isCurrent(account) || !stillCurrent()) throw Error('The account or design changed.');
      clearLegacyOrigin(); currentLocalId = null; currentLocalOriginal = null; loadDocument(design.payload, design.title, true); persisted = { id: design.id, revision: design.revision, payload: clone(design.payload) }; ui.updateStorage();
    }
  };
  async function start() {
    await window.HomePlannerContractsReady;
    if (!contracts()) { toast('Validation is unavailable. The builder cannot start.'); return; }
    ui = BookshelfBuilder.init($('#bookshelfBuilder'), bridge);
    let transfer = null;
    try { transfer = JSON.parse(sessionStorage.getItem(transferKey) || 'null'); sessionStorage.removeItem(transferKey); } catch {}
    if (transfer) { try {
      if (transfer.localDesignId && /^[0-9a-f-]{36}$/i.test(transfer.localDesignId)) {
        const key = 'houseplanner.v3.anonymous.' + transfer.localDesignId, original = localStorage.getItem(key), source = JSON.parse(original || 'null');
        if (!source || source.localDesignId !== transfer.localDesignId || !valid('local', source)) throw Error('The source local design is invalid.');
        legacyOrigin = { key, original }; sessionStorage.setItem(prefix + 'legacyOrigin', JSON.stringify(legacyOrigin));
      } else clearLegacyOrigin();
      loadDocument(transfer.document, transfer.title);
    } catch { toast('The copied shelf could not be opened.'); ui.open(); } }
    else {
      try { const candidate = JSON.parse(sessionStorage.getItem(prefix + 'legacyOrigin') || 'null'); if (candidate && localStorage.getItem(candidate.key) === candidate.original && valid('local', JSON.parse(candidate.original))) { legacyOrigin = candidate; legacy = JSON.parse(candidate.original).payload.version === 1; } } catch {}
      try {
        const stored = JSON.parse(localStorage.getItem(draftKey) || 'null'), previous = stored?.version === 1 && stored.draft ? stored.draft : stored;
        if (previous && valid('shelfDocument', documentFor(previous))) {
          draft = previous;
          const source = stored?.localSource;
          if (source && typeof source.id === 'string' && typeof source.original === 'string') {
            const entry = readList().find(x => x.id === source.id);
            if (entry && JSON.stringify(entry) === source.original) { currentLocalId = entry.id; currentLocalOriginal = source.original; }
            else toast('The saved source changed; this draft is detached. Open the saved design or save a new copy.');
          }
        }
      } catch {}
      ui.open();
    }
    $('#localOpen').addEventListener('click', () => {
      if (!canLeave()) return;
      let list; try { list = readList(); } catch (error) { return toast(error.message); } if (!list.length) return toast('No saved local bookshelf designs.');
      const selection = prompt('Enter the number of a saved design:\n' + list.map((x, i) => `${i + 1}. ${x.title}`).join('\n'));
      if (selection === null) return; const index = Number(selection) - 1;
      if (!Number.isInteger(index) || !list[index]) return toast('Choose a listed design.');
      cloud.clearCurrent(); persisted = null; clearLegacyOrigin(); currentLocalId = list[index].id; currentLocalOriginal = JSON.stringify(list[index]); loadDocument(list[index].document, list[index].title); toast('Opened local design.');
    });
    $('#importShelf').addEventListener('click', () => { if (canLeave()) $('#shelfFile').click(); });
    $('#shelfFile').addEventListener('change', async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try {
        if (file.size > 1048576) throw Error('File exceeds 1 MiB.');
        const value = JSON.parse(await file.text());
        const input = value?.format === 'homeplanner-bookshelf' && value.version === 1 ? value.design : value;
        const result = normalize(input); cloud.clearCurrent(); persisted = null; currentLocalId = null; currentLocalOriginal = null; clearLegacyOrigin(); loadDocument(input, file.name.replace(/\.json$/i, '')); legacy = result.legacy;
        toast(legacy ? 'Legacy geometry imported with a default wall. Save explicitly to keep the upgrade.' : 'Shelf imported. Save it to keep it.');
      } catch (error) { toast(error.message || 'Invalid shelf file.'); }
    });
    window.addEventListener('beforeunload', event => { if (cloudWorkspace && edit !== saved) { event.preventDefault(); event.returnValue = ''; } });
    const requestedId = new URLSearchParams(location.search).get('design'); let opening = false;
    cloud.subscribe(async next => {
      if (!requestedId || opening || !next.me || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) return;
      opening = true; const account = cloud.snapshot(), before = edit;
      try {
        const design = await cloud.open(requestedId);
        await cloudBridge.openCloud(design, account, () => edit === before && !cloud.snapshot().current);
        if (!cloud.isCurrent(account)) return;
        cloud.select(design); cloudBridge.markSaved(); toast(`Opened ${design.title}.`);
        history.replaceState(null, '', '/bookshelf');
      } catch (error) { toast(error.message || 'Could not open the shelf.'); }
    });
    HomePlannerCloudUI(cloudBridge);
  }
  void start();
})();
