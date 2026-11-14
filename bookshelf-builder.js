/* Wall-aware bookshelf editing. The host supplies existing persistence and placement APIs. */
window.BookshelfBuilder = (() => {
  'use strict';
  const B = window.Bookshelf;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => String(B.round(n));
  const mm = n => fmt(n * 10);
  const walls = { n: 'North · top', e: 'East · right', s: 'South · bottom', w: 'West · left' };
  let host, api, draft, visible = false, scene3d, row = 0, view = 'close', variant = null, showSizes = true, history = [], editing = null, interactionGeneration = 0, proposal = null, sheet = null, moreOpen = false, lastRemoved = null;
  // Items to compare against are a session-only aid: never saved, cleared whenever another design is opened.
  let items = [], selected = null, person = false, itemsOn = null, itemSeq = 0;
  const Scene = window.BookshelfScene, Props = window.BookshelfProps;
  // Comparison preview of another real SÆTTER size. Never saved, never used for fit checks.
  const displayDesign = () => draft.tab === 'saetter' && variant && variant !== '3' ? B.saetterVariant(variant) : draft.design;
  const room = () => api.rooms().find(r => r.id === draft.target.roomId) || api.rooms()[0];
  const standalone = () => api.mode === 'standalone';
  // A wall is a rendering/fit context, independent of room membership.
  const wallContext = () => {
    if (standalone()) return { width: draft.wall.widthCm, height: draft.wall.heightCm, color: draft.wall.color, openings: [], flip: false, name: 'Standalone wall' };
    const r = room(), wall = draft.target.wall;
    return { width: ['n', 's'].includes(wall) ? r.width : r.length, height: r.height, color: r.walls[wall], openings: r.openings.filter(o => o.wall === wall), flip: ['s', 'e'].includes(wall), name: `${r.name} · ${walls[wall]} wall` };
  };
  const field = (name, label, value, extra = '') => `<label class="field"><span>${label}</span><input data-bs="${name}" value="${esc(value)}" ${extra}></label>`;
  const numeric = (name, label, value, min = 0, max = 1000) => field(name, label, value, `type="number" step="any" min="${min}" max="${max}" required`);
  const PROP_ICONS = { mug: `<path d="M6 9h15v13a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/><path d="M21 12h3a3 3 0 0 1 0 8h-3"/>`, cup: `<path d="M5 14h18v3a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7z"/><path d="M23 15h2a3 3 0 0 1 0 6h-2.5"/><path d="M3 27h24"/>`, wine: `<path d="M9 4h12c0 7-2 11-6 11S9 11 9 4z"/><path d="M15 15v11M10 27h10"/>`, water: `<path d="M8 6h16l-2 20H10z"/><path d="M9 13h14"/>`, book: `<path d="M9 4h14v24H9z"/><path d="M9 9h14M12 4v24"/>`, plant: `<path d="M10 20h12l-2 8h-8z"/><path d="M16 20c0-6-1-9-5-12 4 0 6 2 5 8 0-5 2-8 6-9-1 5-2 9-6 13"/>`, vase: `<path d="M13 4h6l-1 5c5 3 6 10 4 16H10c-2-6-1-13 4-16z"/>`, person: `<path d="M10 28V15c0-3 2-5 6-5s6 2 6 5v13"/><circle cx="16" cy="7" r="3.5"/>` };
  const propSvg = k => `<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PROP_ICONS[k]}</svg>`;
  Object.assign(PROP_ICONS, { jar: `<rect x="9" y="9" width="14" height="19" rx="3"/><path d="M8 6h16v4H8z"/>`, tealight: `<path d="M7 17h18l-2 9H9z"/><path d="M8 17c0-2 16-2 16 0M16 12v3"/>` });
  Object.assign(PROP_ICONS, { espresso: PROP_ICONS.cup, cappuccino: PROP_ICONS.cup, standard_mug: PROP_ICONS.mug, large_mug: PROP_ICONS.mug, latte: PROP_ICONS.water });
  function clearScene() { items = []; selected = null; person = false; itemsOn = null; lastRemoved = null; }
  function checkpoint() { history.push(JSON.stringify(draft)); if (history.length > 50) history.shift(); }
  function persist(immediate = false) { return api.draft(JSON.parse(JSON.stringify(draft)), immediate); }
  const withoutAlternate = d => { const copy = JSON.parse(JSON.stringify(d)); delete copy.alternate; return copy; };
  const defaultWall = tab => ({ widthCm: tab === 'saetter' ? 300 : 500, heightCm: tab === 'saetter' ? 250 : 500, color: '#EEEDE8' });
  function fresh(tab = 'custom') {
    const r = standalone() ? null : (api.rooms().find(r => r.id === api.activeRoom()) || api.rooms()[0]);
    const saetter = tab === 'saetter';
    return { tab, name: saetter ? 'SÆTTER 3 · walnut' : 'Custom bookshelf', color: saetter ? '#76513D' : '#A46B42',
      design: saetter ? B.saetter3() : B.preset('staggered', Math.min(240, r?.width ?? 500), Math.min(200, (r?.height ?? 500) - 8)),
      ...(standalone() ? { wall: defaultWall(tab) } : {}),
      target: { roomId: r?.id || null, wall: 'n', offset: standalone() ? 0 : 20, gap: standalone() ? 0 : saetter ? 0 : 2, elev: standalone() ? 0 : saetter ? 120 : 0 }, pieceId: null, itemId: null, itemRoomId: null };
  }
  function prepare() {
    draft.tab = draft.tab === 'saetter' ? 'saetter' : 'custom';
    draft.design = B.normalize(draft.design);
    if (!standalone() && !api.rooms().some(r => r.id === draft.target.roomId)) draft.target.roomId = api.rooms()[0].id;
    if (draft.pieceId && !api.pieces().some(p => p.id === draft.pieceId)) draft.pieceId = null;
    if (draft.itemId && !api.hasPlacement(draft.itemId, draft.itemRoomId)) { draft.itemId = null; draft.itemRoomId = null; }
  }
  function open(piece, placement) {
    interactionGeneration++; proposal = null; variant = null;
    if (!standalone() && !api.rooms().length) return api.toast('Office and Living room are unavailable in this plan.');
    const previous = api.draft();
    if (piece) {
      const tab = piece.shelfDesign?.template === 'saetter3' ? 'saetter' : 'custom';
      draft = { ...fresh(tab), name: piece.name, color: piece.color, design: B.normalize(piece.shelfDesign), pieceId: piece.id,
        itemId: placement?.item.id || null, itemRoomId: placement?.room.id || null };
      const other = previous && ((previous.tab || 'custom') === tab ? previous.alternate : previous);
      if (other) draft.alternate = withoutAlternate(other);
      if (piece.shelfTarget) draft.target = { ...piece.shelfTarget };
      if (placement) {
        const it = placement.item, r = placement.room;
        const wall = ({ 0: 'n', 90: 'e', 180: 's', 270: 'w' })[it.rot] || 'n';
        draft.target = { roomId: r.id, wall, elev: it.elev,
          offset: B.round((['n', 's'].includes(wall) ? it.x : it.y) - it.w / 2),
          gap: B.round(wall === 'n' ? it.y - it.d / 2 : wall === 's' ? r.length - it.y - it.d / 2 : wall === 'w' ? it.x - it.d / 2 : r.width - it.x - it.d / 2) };
      }
    } else draft = previous || fresh();
    prepare();
    row = 0; history = []; editing = null; visible = true; clearScene();
    api.show(true); host.hidden = false; render(); persist();
    host.querySelector('h1').focus();
  }
  function switchTab(tab) {
    if (draft.tab === tab) return;
    const previous = withoutAlternate(draft);
    const next = draft.alternate?.tab === tab ? withoutAlternate(draft.alternate) : fresh(tab);
    if (standalone()) { const d = defaultWall(draft.tab); next.wall = ['widthCm', 'heightCm', 'color'].every(k => draft.wall[k] === d[k]) ? defaultWall(tab) : JSON.parse(JSON.stringify(draft.wall)); }
    variant = null; draft = next; draft.alternate = previous; prepare();
    row = 0; history = []; editing = null; clearScene(); persist(true); render();
    host.querySelector(`#bs-tab-${tab}`).focus();
  }
  function close() { interactionGeneration++; proposal = null; persist(true); visible = false; host.hidden = true; api.show(false); }
  function problems() {
    const geometry = B.validate(draft.design);
    const invalid = [...host.querySelectorAll('input[type="number"][data-bs]')].filter(t => !t.disabled && (!t.value.trim() || !t.validity.valid));
    return { ...geometry, errors: [...geometry.errors, ...invalid.map(t => `${t.closest('label').textContent.trim()}: enter a number within the shown range.`)],
      fit: standalone() ? [ ...(draft.target.offset + draft.design.width > draft.wall.widthCm ? ['Bookshelf extends beyond the wall width.'] : []), ...(draft.target.elev + draft.design.height > draft.wall.heightCm ? ['Bookshelf extends beyond the wall height.'] : []) ] : [...B.fit(draft.design, room(), draft.target), ...api.collisions(draft, room())] };
  }
  function drawing(wallContext = true, cropped = false) {
    const s = draft.design, wall = getWall(), target = draft.target;
    const W = wallContext ? wall.width : s.width;
    const H = wallContext ? wall.height : s.height;
    const flip = wallContext && wall.flip;
    const dx = wallContext ? (flip ? W - target.offset - s.width : target.offset) : 0;
    const dy = wallContext ? target.elev : 0;
    const crop = wallContext && cropped && Scene ? Scene.cropViewBox({ x: dx, y: H - dy - s.height, w: s.width, h: s.height }) : null;
    const fs = crop ? crop.fontSize : Math.max(W, H) / 45, pad = fs * 3;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${crop ? crop.viewBox : `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`}" role="img" aria-label="Dimensioned front elevation; all dimensions in centimetres"><rect width="${W}" height="${H}" fill="${wallContext ? esc(wall.color) : '#FAF8F3'}" stroke="#B5B8B0"/>`;
    if (wallContext) wall.openings.forEach(o => {
      const x = flip ? W - o.offset - o.width : o.offset;
      out += `<rect x="${x}" y="${H - (o.sill + o.height)}" width="${o.width}" height="${o.height}" fill="${o.type === 'door' ? '#D7C6AE' : '#D5E5EA'}" stroke="#737D7C"/><text x="${x + 3}" y="${H - o.sill - 5}" font-size="${fs}" fill="#293A3D">${o.type}</text>`;
      if (o.radiator) out += `<rect x="${x}" y="${H - o.sill + 10}" width="${o.width}" height="${Math.max(1, o.sill - 22)}" fill="#DBDDDA" stroke="#848D88"/>`;
    });
    B.boards(s).forEach(b => {
      if (b.w <= 0 || b.h <= 0) return;
      const y = H - dy - b.y - b.h;
      if (b.kind === 'Back') { out += `<rect x="${dx + b.x}" y="${y}" width="${b.w}" height="${b.h}" fill="${esc(draft.color)}" opacity=".45"/>`; return; }
      const bay = b.kind === 'Shelf' ? Number(b.id.slice(1)) - 1 : Number(b.id.slice(1).split('.')[0]) - 1;
      out += `<g data-bs-board="${b.id}" data-bay="${bay}"><rect x="${dx + b.x}" y="${y}" width="${b.w}" height="${b.h}" fill="${esc(draft.color)}" stroke="${bay === row ? '#B98C13' : '#513E31'}" stroke-width="${bay === row ? 1 : .35}"/><title>${b.id}: ${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)} mm</title>`;
      const ty = b.kind === 'Shelf' ? y - fs * .25 : y + b.h / 2;
      out += `<text x="${dx + b.x + b.w / 2}" y="${ty}" font-size="${fs * .85}" text-anchor="middle" fill="#302922" pointer-events="none">${b.id}</text></g>`;
    });
    if (crop) out += `<text x="${dx + s.width / 2}" y="${H - dy + fs * 1.7}" text-anchor="middle" font-size="${fs}" fill="#313C37" data-bs-dim="width">${fmt(s.width)} cm</text><text transform="translate(${dx - fs * .9} ${H - dy - s.height / 2}) rotate(-90)" text-anchor="middle" font-size="${fs}" fill="#313C37" data-bs-dim="height">${fmt(s.height)} cm</text></svg>`;
    else out += `<text x="${W / 2}" y="${H + fs * 1.7}" text-anchor="middle" font-size="${fs}" fill="#313C37">${fmt(W)} cm${wallContext ? ' wall' : ' overall width'}</text><text transform="translate(${-fs * 1.3} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${fs}" fill="#313C37">${fmt(H)} cm</text></svg>`;
    return out;
  }
  const getWall = wallContext;
  // ---- shared pieces of the template (standalone page and room mode) ----
  const CARD_ART = {
    custom: `<svg viewBox="0 0 120 84" aria-hidden="true"><rect x="12" y="6" width="96" height="72" rx="2" fill="#F1E2C8" stroke="#8A5A36" stroke-width="4"/><path d="M12 30h58M50 54h58" stroke="#8A5A36" stroke-width="4"/><path d="M38 30v24M82 54v24M70 6v24" stroke="#8A5A36" stroke-width="3"/><rect x="18" y="14" width="8" height="16" fill="#B5543F"/><rect x="28" y="18" width="7" height="12" fill="#3F6F8A"/><rect x="56" y="38" width="9" height="16" fill="#6E8A3F"/></svg>`,
    saetter: `<svg viewBox="0 0 120 84" aria-hidden="true"><rect x="10" y="10" width="100" height="64" rx="2" fill="#9A7358" stroke="#5E3F2E" stroke-width="4"/><path d="M12 31h96M12 52h96" stroke="#5E3F2E" stroke-width="3"/>${[35, 60, 85].map(x => [12, 33, 54].map(y => `<path d="M${x} ${y}v5m0 11v5" stroke="#5E3F2E" stroke-width="3"/>`).join('')).join('')}</svg>`
  };
  const typeTab = (id, title, sub) => `<button type="button" id="bs-tab-${id}" role="tab" class="bs-card" aria-label="${title}" aria-selected="${draft.tab === id}" aria-controls="bs-tabpanel" tabindex="${draft.tab === id ? 0 : -1}" data-bs-tab="${id}">${CARD_ART[id]}<b>${title}</b><span>${sub}</span></button>`;
  const propSize = spec => `${spec.w} × ${spec.h} × ${spec.d} cm${spec.ml ? ` · ${spec.ml} ml` : ''}`;
  const propsHtml = () => {
    const featured = ['espresso', 'cappuccino', 'standard_mug', 'large_mug', 'latte'];
    const kinds = Props ? featured.concat(Props.KINDS.filter(k => !featured.includes(k))) : [];
    return `<div class="bs-props" id="bsProps" role="group" aria-label="Compare sizes: cups, mugs and more"><div class="bs-props-head"><span class="bs-size-label">Compare sizes: add a cup, mug, glass or other item</span><small class="bs-props-note">Width × height × depth. <span class="bs-swipe">Swipe sideways for more.</span></small></div><div class="bs-palette" data-group>${kinds.map(k => { const spec = Props.PROPS[k]; return `<button type="button" class="bs-prop" data-bs-prop="${k}" aria-pressed="${selected === k}" aria-label="${spec.name}, ${propSize(spec)}">${propSvg(k)}<span>${spec.name}</span><small>${propSize(spec)}</small><small class="bs-prop-fit" data-bs-fit></small></button>`; }).join('')}<button type="button" class="bs-prop" data-bs-person aria-pressed="${person}" aria-label="Person, 175 cm">${propSvg('person')}<span>Person</span><small>175 cm tall</small></button></div></div>`;
  };
  const propsFoot = () => `<div class="bs-props-foot"><p class="bs-prop-help" id="bsPropHelp" role="status"></p><button type="button" class="btn light small" data-bs-action="clearItems">Clear items</button></div>`;
  const sizeHtml = undo => `<div class="bs-size" id="bsSize" role="group" aria-label="${draft.tab === 'saetter' ? 'Compare models' : 'Size'}" data-group>${draft.tab === 'saetter' ? `<span class="bs-size-label">Compare models <em class="bs-badge">Preview only · not saved</em></span><span class="bs-chips">${B.SAETTER_VARIANTS.map(v => `<button type="button" class="btn light small" data-bs-variant="${v.id}" aria-pressed="false">${v.label}</button>`).join('')}</span>` : `<span class="bs-size-label">Size</span><span class="bs-chips">${[-10, -5, 5, 10].map(p => `<button type="button" class="btn light small" data-bs-size="${p}" aria-label="Make the bookshelf ${Math.abs(p)} percent ${p < 0 ? 'smaller' : 'bigger'}">${p < 0 ? '−' : '+'}${Math.abs(p)}%</button>`).join('')}</span>`}${undo ? `<button class="btn light small" data-bs-action="undo" ${history.length ? '' : 'disabled'}>Undo</button>` : ''}</div>`;
  const levelsHtml = () => `${draft.tab === 'custom' ? '<div class="bs-presets"><button class="btn light small" data-preset="framed">Framed</button><button class="btn light small" data-preset="staggered">Staggered</button><button class="btn light small" data-preset="stepped">Stepped edges</button></div>' : ''}
        <div class="sec-head"><h3>Individual shelves · bottom to top</h3><button class="btn light small" data-bs-action="addLevel">+ Shelf</button></div><div id="bsLevels"></div>
        <p class="note">Select a board in the drawing or 3D view. Drag a divider in the drawing, or enter exact values below. All editing values are cm.</p>
        <p class="note bs-edit-feedback" id="bsEditFeedback" role="status"></p><div id="bsRowEditor"></div>`;
  const aiHtml = () => `<h3>AI shelf edit</h3><p class="note">Only the current shelf geometry and your prompt are sent for a proposal. Nothing changes until you apply it.</p><button class="btn light" data-bs-action="propose" ${api.canPropose?.() ? '' : 'disabled'}>Request AI preview</button><p class="note" id="bsProposalStatus" role="status">${api.canPropose?.() ? '' : 'AI edits are unavailable until sign-in, model configuration and shared validation are ready.'}</p><div id="bsProposal"></div>`;
  const planHtml = () => { const s = draft.design; return `<h3>Workshop plan</h3><p class="note">${s.template === 'saetter3' ? 'Inferred square-cut shelves, back and paired short separators, as shown in the 3D view, drawing and list. Construction and material thicknesses are estimates, not manufacturer plans.' : 'Square-cut boards, full depth. Dividers fit between horizontal shelves with butt joints. The drawing and list use the same geometry as 3D.'}</p>
        <div id="bsCutSummary"></div><div class="bs-table-wrap"><table class="bs-cut"><thead><tr><th>Board</th><th>Length × depth × thickness, mm</th></tr></thead><tbody id="bsCutList"></tbody></table></div>
        <div class="bs-save-actions"><button class="btn light" data-bs-action="csv">Download cut list</button><button class="btn light" data-bs-action="plan">Download build plan</button><button class="btn light" data-bs-action="print">Print / save PDF</button><button class="btn light" data-bs-action="json">Export design JSON</button></div>`; };
  const storageNote = () => `<p class="note">${api.cloudWorkspace?.() ? 'Cloud edits stay in this tab until saved through Private designs. Export a backup before leaving.' : standalone() ? 'Drafts autosave in this browser. Use My designs to reopen saved shelves, or export JSON as a backup.' : 'Drafts autosave in this browser. Saved designs are in My pieces, versions, and full-plan backups.'}</p>
        <p class="note">Measure the actual wall and timber before cutting. Cut sizes exclude saw kerf, machining allowances, fasteners and joinery. Check sag, stability and wall anchoring for your chosen wood and loads.</p>`;

  // Standalone page: a calm first screen, everything else under "More details".
  function simpleTemplate() {
    const s = draft.design, saet = draft.tab === 'saetter';
    const sizeFields = `<div class="row3">${numeric('width', 'Width, cm', s.width, 20)}${numeric('height', 'Height, cm', s.height, 20, 800)}${numeric('depth', 'Depth, cm', s.depth, 10, 100)}</div>`;
    return `<div class="bs-heading"><div><h1 tabindex="-1">Bookshelf builder</h1><p class="note">Pick a shelf, enter your wall, and see how it looks at real size.</p></div></div>
      <div class="bs-layout bs-simple" id="bs-tabpanel" role="tabpanel" aria-labelledby="bs-tab-${draft.tab}" data-sheet="${sheet || ''}">
      <aside class="bs-controls">
        <h2>1. Choose a type</h2>
        <div class="bs-cards" role="tablist" aria-label="Bookshelf type" data-group>${typeTab('custom', 'Custom bookshelf', 'Shelves you design yourself')}${typeTab('saetter', 'SÆTTER 3', 'Ready-made walnut shelf')}</div>
        <h2>2. Your wall</h2>
        <div class="row2">${numeric('wallWidth', 'Wall width, cm', draft.wall.widthCm, 10, 2000)}${numeric('wallHeight', 'Wall height, cm', draft.wall.heightCm, 10, 2000)}</div>
        <h2>3. ${saet ? 'SÆTTER 3 size' : 'Bookshelf size'}</h2>
        ${saet ? `<p class="bs-fixed" id="bsFixedSize">Your SÆTTER 3 design: ${fmt(s.width)} × ${fmt(s.height)} × ${fmt(s.depth)} cm. Compare other models under the 3D view; the comparison is not saved.</p>` : `${sizeFields}<p class="note">Or make it bigger or smaller with the Size buttons under the 3D view.</p>`}
        <h2>4. Color</h2>${field('color', 'Wood color', draft.color, 'type="color"')}
        <h2>5. Save</h2>
        <div class="bs-save-actions"><button class="btn bs-save" data-bs-action="save">Save design</button></div><p class="note" id="bsSaveNote"></p>
        <details class="bs-more" id="bsMore" ${moreOpen ? 'open' : ''}><summary>More details</summary><div class="bs-more-body">
          <section><h3>Your design</h3>${field('name', 'Design name', draft.name, 'maxlength="100"')}${field('wallColor', 'Wall color', draft.wall.color, 'type="color"')}
            <div class="bs-save-actions two"><button class="btn light" data-bs-action="copy">Make a copy</button><button class="btn light" data-bs-action="new">New design</button></div></section>
          <section><h3>Where it stands</h3><p class="note">Leave these at 0 to stand the shelf on the floor in the left corner of the wall.</p>
            <div class="row3">${numeric('offset', 'Distance from left corner, cm', draft.target.offset, 0, 2000)}${numeric('gap', 'Distance from wall, cm', draft.target.gap, 0, 100)}${numeric('elev', 'Height from floor, cm', draft.target.elev, 0, 2000)}</div></section>
          <section><h3>Exact size and boards</h3>${saet ? `${sizeFields}<p class="note bs-reference"><a href="https://saetter.dk/en/products/saetter-3-valnod" target="_blank" rel="noopener noreferrer">SÆTTER 3 · walnut reference</a>. This editable approximation uses estimated board, back and divider sizes. Joinery and hardware are not specified.</p>` : ''}
            <div class="row2">${numeric('thickness', 'Board thickness, cm (advanced)', s.thickness, .9, 6)}</div>
            ${s.template === 'saetter3' ? `<div class="row2">${numeric('separatorHeight', 'Divider height, cm (estimated)', s.separatorHeight, .1, 100)}${numeric('backThickness', 'Back thickness, cm (estimated)', s.backThickness, .1, 10)}</div>` : ''}
            <p class="note">Width and height changes scale the layout. Board thickness stays exact.</p></section>
          <section><h3>Shelves and boards</h3><div id="bsDrawing" class="bs-drawing"></div>${levelsHtml()}</section>
          <section><h3>3D view</h3><div class="bs-save-actions two"><label class="bs-switch"><input type="checkbox" data-bs-sizes ${showSizes ? 'checked' : ''}> Show sizes</label><button class="btn light" data-bs-action="resetCamera">Reset view</button></div></section>
          <section>${planHtml()}</section>
          <section><div id="bsWarnings"></div>${storageNote()}</section>
          <section>${aiHtml()}</section>
        </div></details>
      </aside>
      <div class="bs-preview">
        <p class="bs-wallname" id="bsPreviewTitle"></p>
        ${propsHtml()}${propsFoot()}<div id="bs3d" role="img" aria-label="Orbitable 3D bookshelf against the selected wall"></div>
        <div class="bs-viewbar"><div class="bs-seg" role="group" aria-label="3D view" data-group><button type="button" class="btn light small" data-bs-view="close" aria-pressed="true">Close-up</button><button type="button" class="btn light small" data-bs-view="wall" aria-pressed="false">Whole wall</button></div><p class="bs-readout" id="bsReadout" role="status"></p></div>
        <p class="bs-note-grey" id="bsPreviewNote"></p>
        <div class="bs-tools">${sizeHtml(true)}</div>
        <div id="bsProblems" aria-live="polite"></div>
        <p class="note bs-hint">Drag to turn the view · scroll to zoom · pick an item, then click a shelf to place it.</p>
      </div>
      </div>
      <nav class="bs-bar" aria-label="Quick actions"><button type="button" class="btn light" data-bs-sheet="size" aria-controls="bsSize" aria-expanded="${sheet === 'size'}">${saet ? 'Compare models' : 'Size'}</button><button type="button" class="btn" data-bs-barsave>Save</button></nav>`;
  }
  function roomTemplate() {
    const s = draft.design, r = room();
    return `<div class="bs-heading"><div><p class="bs-eyebrow">DESIGN FOR YOUR HOME</p><h1 tabindex="-1">Bookshelf builder</h1><p class="note">Choose a wall. Shape each shelf. Keep a plan to build from.</p></div><button class="btn light" data-bs-action="close">Back to room</button></div>
      <div class="bs-tabs" role="tablist" aria-label="Bookshelf designs">${[['custom', 'Custom bookshelf'], ['saetter', 'SÆTTER 3']].map(([id, label]) => `<button type="button" id="bs-tab-${id}" role="tab" aria-selected="${draft.tab === id}" aria-controls="bs-tabpanel" tabindex="${draft.tab === id ? 0 : -1}" data-bs-tab="${id}">${label}</button>`).join('')}</div>
      <div class="bs-layout" id="bs-tabpanel" role="tabpanel" aria-labelledby="bs-tab-${draft.tab}"><aside class="bs-controls">
        ${draft.tab === 'saetter' ? `<p class="note bs-reference"><a href="https://saetter.dk/en/products/saetter-3-valnod" target="_blank" rel="noopener noreferrer">SÆTTER 3 · walnut reference</a><br>Reference: 45.5 × 40.6 × 10.5 cm overall; compartments 10 × 12 × 10 cm. This editable approximation uses an inferred 1.1 cm board, 0.5 cm back and 3 cm separators; initial clear height is about 12.07 cm. Joinery and hardware are not specified.</p>` : ''}
        <h2>1. Choose your wall</h2><label class="field"><span>Room</span><select data-bs="roomId">${api.rooms().map(x => `<option value="${esc(x.id)}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Wall</span><select data-bs="wall">${Object.entries(walls).map(([k, label]) => `<option value="${k}" ${k === draft.target.wall ? 'selected' : ''}>${label} · ${['n', 's'].includes(k) ? r.width : r.length} cm</option>`).join('')}</select></label>
        <p class="note" id="bsWallNote">Ceiling ${r.height} cm. Wall sides match the floor plan. Offset is from its left corner (north/south) or top corner (east/west).</p>
        <div class="row3">${numeric('offset', 'Wall offset, cm', draft.target.offset, 0, 1000)}${numeric('gap', 'Wall gap, cm', draft.target.gap, 0, 1000)}${numeric('elev', 'Above floor, cm', draft.target.elev, 0, 1000)}</div>
        <h2>2. Shape the bookshelf</h2>${field('name', 'Design name', draft.name, 'maxlength="100"')}
        <div class="row3">${numeric('width', 'Width, cm', s.width, 20)}${numeric('height', 'Height, cm', s.height, 20, 800)}${numeric('depth', 'Depth, cm', s.depth, 10, 100)}</div>
        <div class="row2">${numeric('thickness', 'Board thickness, cm', s.thickness, .9, 6)}${field('color', 'Wood / finish color', draft.color, 'type="color"')}</div>
        ${s.template === 'saetter3' ? `<div class="row2">${numeric('separatorHeight', 'Separator height, cm (inferred)', s.separatorHeight, .1, 100)}${numeric('backThickness', 'Back thickness, cm (inferred)', s.backThickness, .1, 10)}</div>` : ''}
        <p class="note">Width and height changes scale the layout. Board thickness stays exact.</p>
        ${levelsHtml()}
      </aside><div class="bs-preview"><div class="bs-preview-head"><h2 id="bsPreviewTitle"></h2><div class="btnrow"><button class="btn light small" data-bs-action="undo" ${history.length ? '' : 'disabled'}>Undo</button><button class="btn light small" data-bs-action="resetCamera">Reset 3D view</button></div></div>
        <div class="bs-viewbar"><div class="bs-seg" role="group" aria-label="3D view"><button type="button" class="btn light small" data-bs-view="close" aria-pressed="true">Close-up</button><button type="button" class="btn light small" data-bs-view="wall" aria-pressed="false">Whole wall</button></div><label class="bs-switch"><input type="checkbox" data-bs-sizes ${showSizes ? 'checked' : ''}> Show sizes</label></div>
        ${propsHtml()}${propsFoot()}<div id="bs3d" role="img" aria-label="Orbitable 3D bookshelf against the selected wall"></div>${sizeHtml(false)}
        <p class="bs-readout" id="bsReadout" role="status"></p><p class="bs-note-grey" id="bsPreviewNote"></p>
        <p class="note">Drag to orbit · scroll to zoom · click a board to edit its level, or pick an item above and click to place it</p>
        <div id="bsDrawing" class="bs-drawing"></div><div id="bsProblems" aria-live="polite"></div>
      </div><aside class="bs-output"><h2>3. Save & place</h2><label class="field"><span>Saved bookshelf designs</span><select data-bs="saved"><option value="">Select a design…</option>${api.pieces().filter(p => p.shelfDesign).map(p => `<option value="${esc(p.id)}" ${p.id === draft.pieceId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <p class="note" id="bsSaveNote"></p><div class="bs-save-actions"><button class="btn" data-bs-action="save">Save design</button><button class="btn mark" data-bs-action="place">Save & ${draft.itemId ? 'move placement' : 'place on wall'}</button><button class="btn light" data-bs-action="standaloneCopy">Copy to standalone bookshelf</button><button class="btn light" data-bs-action="copy">Make a copy</button><button class="btn light" data-bs-action="new">New design</button></div>
        ${aiHtml()}${planHtml()}${storageNote()}
      </aside></div>`;
  }
  function render() {
    const s = draft.design;
    row = Math.max(0, Math.min(row, s.levels.length - 1));
    host.innerHTML = standalone() ? simpleTemplate() : roomTemplate();
    refresh();
    if (scene3d) host.querySelector('#bs3d').appendChild(scene3d.rig.renderer.domElement);
    update3D(true);
  }
  const warningsHtml = p => `<div class="bs-warning"><b>Construction checks</b><ul>${p.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  function refresh() {
    const s = draft.design, p = problems(), valid = !p.errors.length;
    const l = s.levels[row], next = s.levels[row + 1];
    const levels = host.querySelector('#bsLevels');
    if (levels.children.length !== s.levels.length) levels.innerHTML = s.levels.map((l, i) => `<button class="bs-level" data-bs-row="${i}"><b>S${i + 1}</b><span></span><span></span></button>`).join('');
    [...levels.children].forEach((button, i) => {
      button.classList.toggle('active', i === row); button.setAttribute('aria-pressed', String(i === row));
      button.children[1].textContent = `${fmt(s.levels[i].y)} cm high`; button.children[2].textContent = `${fmt(s.levels[i].right - s.levels[i].left)} cm long`;
    });
    const editor = host.querySelector('#bsRowEditor'), key = `${row}:${s.levels.length}:${l?.dividers.length}`;
    if (editor.dataset.key !== key) {
      editor.dataset.key = key;
      editor.innerHTML = l ? `<h3>Editing shelf S${row + 1}</h3><div class="row3">${numeric('levelY', 'Underside, cm', l.y, 0, s.height)}${numeric('left', 'Left edge, cm', l.left)}${numeric('right', 'Right edge, cm', l.right)}</div>
        ${next ? `<h3 id="bsBayHeading"></h3>${l.dividers.map((x, j) => `<div class="bs-divider">${numeric('divider:' + j, `D${row + 1}.${j + 1} centre from left, cm`, x)}<button class="btn danger small" data-remove-divider="${j}" aria-label="Remove divider D${row + 1}.${j + 1}">Remove</button></div>`).join('')}<button class="btn light small" data-bs-action="addDivider">+ Divider</button>` : '<p class="note">Top shelf: no bay above it.</p>'}
        ${row > 0 && row < s.levels.length - 1 ? '<button class="btn danger small" data-bs-action="removeLevel">Remove this shelf</button>' : '<p class="note">Bottom and top heights follow the overall height setting.</p>'}` : '';
    }
    if (l) {
      editor.querySelector('[data-bs="levelY"]').disabled = row === 0 || !next;
      const values = { levelY: l.y, left: l.left, right: l.right, ...Object.fromEntries(l.dividers.map((x, j) => ['divider:' + j, x])) };
      editor.querySelectorAll('[data-bs]').forEach(t => { if (t !== document.activeElement) t.value = values[t.dataset.bs]; });
      if (next) editor.querySelector('#bsBayHeading').textContent = `Dividers in bay ${row + 1} · ${fmt(next.y - l.y - s.thickness)} cm clear height`;
      if (next) editor.querySelector('[data-bs-action="addDivider"]').disabled = B.dividerPosition(s, row) === null;
    }
    if (!standalone()) {
      const r = room();
      host.querySelector('[data-bs="wall"]').innerHTML = Object.entries(walls).map(([k, label]) => `<option value="${k}" ${k === draft.target.wall ? 'selected' : ''}>${label} · ${['n', 's'].includes(k) ? r.width : r.length} cm</option>`).join('');
      host.querySelector('#bsWallNote').textContent = `Ceiling ${r.height} cm. Wall sides match the floor plan. Offset is from its left corner (north/south) or top corner (east/west).`;
    }
    const values = { ...draft.target, wallWidth: draft.wall?.widthCm, wallHeight: draft.wall?.heightCm, wallColor: draft.wall?.color, name: draft.name, color: draft.color, width: s.width, height: s.height, depth: s.depth, thickness: s.thickness, separatorHeight: s.separatorHeight, backThickness: s.backThickness };
    host.querySelectorAll('[data-bs]').forEach(t => {
      if (Object.hasOwn(values, t.dataset.bs) && t !== document.activeElement) t.value = values[t.dataset.bs];
    });
    host.querySelector('[data-bs-action="addLevel"]').disabled = s.levels.length < 2 || s.levels.length >= 25;
    host.querySelector('#bsEditFeedback').textContent = p.errors[0] || '';
    host.querySelector('#bsDrawing').innerHTML = drawing(true, view === 'close');
    host.querySelectorAll('[data-bs-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bsView === view)));
    host.querySelectorAll('[data-bs-variant]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bsVariant === (variant || '3'))));
    const shown = displayDesign(), previewing = shown !== s, dims = d => `${fmt(d.width)} × ${fmt(d.height)} × ${fmt(d.depth)} cm`;
    const fixed = host.querySelector('#bsFixedSize'); if (fixed) fixed.textContent = `Your SÆTTER 3 design: ${dims(s)}. Compare other models under the 3D view; the comparison is not saved.`;
    host.querySelector('#bsReadout').textContent = previewing ? `Comparison preview ${B.SAETTER_VARIANTS.find(v => v.id === variant).label}: ${dims(shown)}. Your design and fit checks stay at ${dims(s)}.` : `Bookshelf ${dims(s)} (width × height × depth)`;
    const over = previewing ? (standalone() ? [...(draft.target.offset + shown.width > draft.wall.widthCm ? ['wider than the wall'] : []), ...(draft.target.elev + shown.height > draft.wall.heightCm ? ['taller than the wall'] : [])] : B.fit(shown, room(), draft.target).length ? ['too big for this spot'] : []) : [];
    host.querySelector('#bsPreviewNote').textContent = over.length ? `At this comparison size it would be ${over.join(' and ')}. Preview only.` : '';
    host.querySelector('#bsPreviewTitle').textContent = standalone() ? `Your wall: ${fmt(draft.wall.widthCm)} × ${fmt(draft.wall.heightCm)} cm` : getWall().name;
    host.querySelector('#bsProblems').innerHTML = `${p.errors.length ? `<div class="bs-error"><b>Fix the board layout before saving</b><ul>${p.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${p.fit.length ? `<div class="bs-error"><b>${standalone() ? 'Wall overflow' : 'Choose a clear placement before placing'}</b><ul>${p.fit.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : `<p class="bs-ok">${standalone() ? 'Fits the wall dimensions.' : 'Fits the wall dimensions and clears the checked openings and furniture.'}</p>`}
      ${p.warnings.length && !standalone() ? warningsHtml(p) : p.warnings.length ? `<p class="note">${p.warnings.length} building note${p.warnings.length > 1 ? 's' : ''} under More details.</p>` : ''}`;
    const warnBox = host.querySelector('#bsWarnings'); if (warnBox) warnBox.innerHTML = p.warnings.length ? warningsHtml(p) : '';
    const parts = B.boards(s);
    host.querySelector('#bsCutList').innerHTML = valid ? parts.map(b => `<tr><td>${b.id}</td><td>${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)}</td></tr>`).join('') : '<tr><td colspan="2">Fix the layout to calculate a usable cut list.</td></tr>';
    host.querySelector('#bsCutSummary').textContent = valid ? `${parts.length} boards · ${fmt(parts.reduce((sum, b) => sum + b.length * b.depth, 0) / 10000)} m² of board face (before waste)` : '';
    host.querySelector('#bsSaveNote').textContent = draft.pieceId ? 'Saving updates this design and all its existing placements. Make a copy for a different version.' : 'Save as a reusable piece; place it now or later in either room.';
    if (standalone()) host.querySelector('#bsSaveNote').textContent = api.legacyDefault?.() ? 'Legacy shelf: default 500 × 500 cm neutral wall and zero placement. Save explicitly to retain wall settings.' : 'Saved in this browser. To keep it in your account, use My designs > Private designs.';
    if (!standalone() && api.cloudWorkspace?.()) host.querySelector('#bsSaveNote').textContent = 'Use Private designs to save changes to cloud.';
    if (!api.storageAvailable()) host.querySelector('#bsSaveNote').textContent = 'Browser storage is unavailable: changes only last for this session. Download a design or export a full-plan backup now.';
    for (const action of ['save', 'csv', 'plan', 'print', 'json']) host.querySelector(`[data-bs-action="${action}"]`).disabled = !valid;
    if (!standalone()) host.querySelector('[data-bs-action="place"]').disabled = !valid || !!p.fit.length;
    host.querySelector('[data-bs-action="undo"]').disabled = !history.length;
    host.querySelector('[data-bs-action="propose"]').disabled = !api.canPropose?.();
    if (api.canPropose?.() && host.querySelector('#bsProposalStatus').textContent.startsWith('AI edits are unavailable')) host.querySelector('#bsProposalStatus').textContent = '';
  }
  function update3D(reset = false) {
    const el = host.querySelector('#bs3d');
    if (!scene3d) {
      try {
        if (!window.THREE || !window.HouseModels || !THREE.OrbitControls || !Scene) throw Error('3D libraries unavailable');
        HouseModels.init(THREE);
        scene3d = Scene.create({ THREE, el, onPick: onScenePick });
        new ResizeObserver(() => resize3D()).observe(host);
      } catch (e) { el.innerHTML = '<p class="empty">3D needs WebGL and the online 3D libraries. You can still edit the dimensioned drawing.</p>'; return; }
    }
    syncItems(); paletteState();
    scene3d.update({ design: displayDesign(), wall: getWall(), target: draft.target, color: draft.color, view, showSizes, props: items, person, standalone: standalone(), visible: () => visible }, reset, el);
  }

  // ---- items to compare against ----
  const itemName = k => Props.PROPS[k].name;
  function help(text, warn, undo) {
    const el = host && host.querySelector('#bsPropHelp'); if (!el) return; el.textContent = text; el.classList.toggle('warn', !!warn);
    if (undo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn light small'; b.dataset.bsAction = 'restoreItem'; b.textContent = 'Undo'; el.append(' ', b); }
  }
  function paletteState() {
    if (!Props || !host) return;
    host.querySelectorAll('[data-bs-prop]').forEach(b => {
      const spec = Props.PROPS[b.dataset.bsProp], fd = draft.tab === 'saetter' ? Props.fitDetail(displayDesign(), b.dataset.bsProp) : null;
      const out = fd && fd.overhang ? Props.stickOut(b.dataset.bsProp, fd.overhang) : '';
      const label = !fd ? '' : fd.where === 'compartment' ? (out ? `Fits, ${out}` : 'Fits inside') : fd.where === 'top' ? (out ? `Top only, ${out}` : 'Top only') : 'Does not fit';
      b.setAttribute('aria-pressed', String(b.dataset.bsProp === selected));
      b.setAttribute('aria-label', `${spec.name}, ${propSize(spec)}, width by height by depth${label ? ', ' + label : ''}`);
      b.querySelector('[data-bs-fit]').textContent = label;
    });
    const pb = host.querySelector('[data-bs-person]'); if (pb) pb.setAttribute('aria-pressed', String(person));
    const clear = host.querySelector('[data-bs-action="clearItems"]'); if (clear) clear.disabled = !items.length && !person;
    const el = host.querySelector('#bs3d'); if (el) el.classList.toggle('placing', !!selected);
    const msg = host.querySelector('#bsPropHelp');
    if (msg && !msg.textContent) help('Pick an item, then click a shelf or compartment. Click a placed item to remove it.');
  }
  // Items keep their real size when the furniture changes: they move with it, or are removed if nothing carries them.
  function syncItems() {
    if (!Props) return;
    const d = displayDesign(), key = JSON.stringify(d);
    if (items.length && itemsOn && itemsOn.key !== key) {
      lastRemoved = null;
      const r = Props.resnap(d, items, itemsOn.design); items = r.items;
      if (r.dropped.length) { const t = `${r.dropped.length} item${r.dropped.length > 1 ? 's' : ''} no longer fit and ${r.dropped.length > 1 ? 'were' : 'was'} removed.`; help(t, true); api.toast(t); }
    }
    itemsOn = { key, design: d };
    if (window.__bsDebug) window.__bsDebug.items = items.map(i => ({ kind: i.kind, x: i.x, y: i.y, z: i.z, w: i.w, d: i.d, h: i.h, level: i.level }));
  }
  function onScenePick(info) {
    if (info.propId) {
      const at = items.findIndex(i => i.id === info.propId); if (at < 0) return;
      const it = items[at]; lastRemoved = { item: it, index: at };
      items = items.filter(i => i.id !== it.id); update3D(false); help(`${itemName(it.kind)} removed ·`, false, true); return;
    }
    if (info.none) { if (selected && Props) help(Props.MESSAGES.noSurface, true); return; }
    if (!selected || !Props) { row = Math.min(info.bay, draft.design.levels.length - 1); refresh(); return; } // a SÆTTER size preview can have more levels than the design
    if (items.length >= Props.MAX_ITEMS) { help(Props.MESSAGES.limit, true); return api.toast(Props.MESSAGES.limit); }
    const design = displayDesign(), topOnly = draft.tab === 'saetter' && Props.fitLocation(design, selected) === 'top';
    const placing = selected;
    const redirected = topOnly && info.local.y < design.height - .01;
    const hit = topOnly ? { x: info.local.x, y: design.height, level: design.levels.length - 1 } : info.local;
    const r = Props.fitProp(design, selected, hit, items);
    if (!r.ok) { help(r.message, true); return api.toast(r.message); }
    const id = `i${++itemSeq}`;
    items = items.concat([{ ...r, id, color: Props.BOOK_COLORS[itemSeq % Props.BOOK_COLORS.length] }]);
    update3D(false); const message = redirected ? `${itemName(selected)} placed on top; it does not fit inside${r.overhang ? ` and ${Props.stickOut(placing, r.overhang)}` : ''}.` : `${itemName(selected)} placed (${Props.PROPS[selected].h} cm tall${r.overhang ? `; fits, ${Props.stickOut(placing, r.overhang)}` : ''}). Click it to remove it.`;
    help(message, !!r.overhang); if (redirected) api.toast(message);
  }
  // render() rebuilds the page: put keyboard focus back on the control that was used.
  function refocus(selector) { const b = host.querySelector(selector); if (b && !b.disabled) b.focus({ preventScroll: true }); else host.querySelector('h1')?.focus({ preventScroll: true }); }
  function resize3D() { if (scene3d && visible) scene3d.refit(); }
  function changed(full = false, reframe = false) { persist(true); if (full) render(); else { refresh(); update3D(reframe); } }
  function applyField(t, baseline) {
    const key = t.dataset.bs, s = draft.design, l = s.levels[row];
    if (standalone() && ['wallWidth', 'wallHeight', 'wallColor'].includes(key)) draft.wall[{ wallWidth: 'widthCm', wallHeight: 'heightCm', wallColor: 'color' }[key]] = t.type === 'number' ? Number(t.value) : t.value;
    else if (['roomId', 'wall', 'offset', 'gap', 'elev'].includes(key)) draft.target[key] = t.type === 'number' ? Number(t.value) : t.value;
    else if (key === 'width' || key === 'height') draft.design = B.resize(baseline.design, key === 'width' ? +t.value : s.width, key === 'height' ? +t.value : s.height);
    else if (key === 'thickness') {
      const source = baseline.design; draft.design = JSON.parse(JSON.stringify(source)); draft.design.thickness = +t.value;
      draft.design.levels.slice(0, -1).forEach((level, i) => {
        const next = draft.design.levels[i + 1], a = Math.max(level.left, next.left), b = Math.min(level.right, next.right);
        level.dividers = level.dividers.map(x => Math.abs(x - a - source.thickness / 2) < .001 ? B.round(a + +t.value / 2) : Math.abs(x - b + source.thickness / 2) < .001 ? B.round(b - +t.value / 2) : x);
      });
      if (draft.design.levels.length) draft.design.levels.at(-1).y = B.round(source.height - +t.value);
    } else if (['depth', 'separatorHeight', 'backThickness'].includes(key)) s[key] = +t.value;
    else if (key === 'name' || key === 'color') draft[key] = t.value;
    else if (key === 'levelY' && row > 0 && row < s.levels.length - 1) l.y = +t.value;
    else if (key === 'left' || key === 'right') l[key] = +t.value;
    else if (key.startsWith('divider:')) l.dividers[+key.split(':')[1]] = +t.value;
  }
  function download(text, ext, mime) {
    const blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = (draft.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'bookshelf') + '.' + ext; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function buildPlan() {
    const s = draft.design, wall = getWall();
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(draft.name)} · build plan</title><style>body{font:14px system-ui;color:#222;max-width:900px;margin:30px auto;padding:0 20px}svg{width:100%;max-height:480px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:6px;text-align:left}tr{break-inside:avoid}p{line-height:1.5}@media print{button{display:none}body{margin:0}thead{display:table-header-group}}</style><button onclick="window.print()">Print / save PDF</button><h1>${esc(draft.name)}</h1><p>${mm(s.width)} × ${mm(s.height)} × ${mm(s.depth)} mm overall · ${mm(s.thickness)} mm timber<br>${esc(wall.name)}; wall ${mm(wall.width)} × ${mm(wall.height)} mm, color ${esc(wall.color)}; offset ${mm(draft.target.offset)} mm, wall gap ${mm(draft.target.gap)} mm, base ${mm(draft.target.elev)} mm above floor.</p>${drawing(false)}<p>Front elevation. Drawing labels are board IDs; dimensions on the drawing are cm. Table dimensions are mm. X = board left edge from bookshelf left; Y = underside from bookshelf base. Shelf lengths run horizontally; divider lengths run vertically.</p><table><thead><tr><th>Board</th><th>Part</th><th>Length × depth × thickness, mm</th><th>X, mm</th><th>Y, mm</th></tr></thead><tbody>${B.boards(s).map(b => `<tr><td>${b.id}</td><td>${b.kind}</td><td>${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)}</td><td>${mm(b.x)}</td><td>${mm(b.y)}</td></tr>`).join('')}</tbody></table><p>${s.template === 'saetter3' ? `SÆTTER 3-inspired approximation: board thickness, ${mm(s.backThickness)} mm back and ${mm(s.separatorHeight)} mm short separators are inferred; this is not the manufacturer's construction plan. Board depth excludes the back. Back dimensions are height × width × thickness. The initial reference dimensions are 455 × 406 × 105 mm with nominal 100 × 120 × 100 mm compartments.` : 'Assembly assumption: square-cut full-depth boards, with dividers butt-jointed between horizontal shelves. No back panel.'} Joint hardware and fastening locations must be chosen separately. Sizes exclude saw kerf and machining allowances. Measure actual wall and board thickness before cutting; review sag, stability and wall anchoring for the selected wood and loads.</p>${B.validate(s).warnings.map(w => `<p>${esc(w)}</p>`).join('')}</html>`;
  }
  function init(element, bridge) {
    host = element; api = bridge;
    host.addEventListener('keydown', e => {
      const tab = e.target.closest('[role="tab"][data-bs-tab]');
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 'custom' : e.key === 'End' ? 'saetter' : tab.dataset.bsTab === 'custom' ? 'saetter' : 'custom';
      switchTab(next);
    });
    host.addEventListener('toggle', e => { if (e.target.id === 'bsMore') moreOpen = e.target.open; }, true);
    host.addEventListener('focusin', e => {
      if (e.target.matches('input[data-bs]')) editing = { key: e.target.dataset.bs, before: JSON.parse(JSON.stringify(draft)), changed: false };
    });
    host.addEventListener('input', e => {
      const t = e.target; if (!t.matches('input[data-bs]')) return;
      if (t.type === 'number' && (!t.value.trim() || !t.validity.valid)) { refresh(); return; }
      if (!editing || editing.key !== t.dataset.bs) editing = { key: t.dataset.bs, before: JSON.parse(JSON.stringify(draft)), changed: false };
      if (!editing.changed) { checkpoint(); editing.changed = true; }
      applyField(t, editing.before); changed(false, ['offset', 'gap', 'elev', 'width', 'height'].includes(t.dataset.bs));
    });
    host.addEventListener('change', e => {
      const t = e.target, key = t.dataset.bs;
      if (t.matches('[data-bs-sizes]')) { showSizes = t.checked; update3D(false); return; }
      if (!key) return;
      if (key === 'saved') { const p = api.pieces().find(p => p.id === t.value); if (p) open(p, api.findPlacement(p.id)); return; }
      if (t.matches('input[data-bs]')) {
        if (t.type === 'number' && (!t.value.trim() || !t.validity.valid)) {
          const values = { ...draft.design, ...draft.target, wallWidth: draft.wall?.widthCm, wallHeight: draft.wall?.heightCm, levelY: draft.design.levels[row]?.y, left: draft.design.levels[row]?.left, right: draft.design.levels[row]?.right };
          t.value = key.startsWith('divider:') ? draft.design.levels[row]?.dividers[+key.split(':')[1]] : values[key];
          api.toast('Enter a number within the shown range. The last valid value has been kept.'); refresh();
        }
        return;
      }
      checkpoint(); applyField(t, JSON.parse(JSON.stringify(draft))); changed(false, true);
    });
    host.addEventListener('click', async e => {
      const t = e.target.closest('button, [data-bs-board]'); if (!t) return;
      if (t.dataset.bsTab) return switchTab(t.dataset.bsTab);
      if (t.dataset.bsSheet) {
        sheet = sheet === t.dataset.bsSheet ? null : t.dataset.bsSheet; host.querySelector('.bs-simple').dataset.sheet = sheet || '';
        host.querySelectorAll('[data-bs-sheet]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.bsSheet === sheet)));
        if (sheet) host.querySelector('#bsSize button')?.focus({ preventScroll: true });
        return;
      }
      if (t.dataset.bsBarsave !== undefined) { const save = host.querySelector('[data-bs-action="save"]'); if (!save.disabled) save.click(); else api.toast('Resolve the highlighted issues first.'); return; }
      if (t.dataset.bsProp) { selected = selected === t.dataset.bsProp ? null : t.dataset.bsProp; help(selected ? `${itemName(selected)} selected: click a shelf or compartment to place it.` : 'Pick an item, then click a shelf or compartment. Click a placed item to remove it.'); return paletteState(); }
      if (t.dataset.bsPerson !== undefined) { person = !person; if (person) selected = null; help(person ? 'A 175 cm person stands next to the furniture.' : 'Person hidden.'); update3D(true); return; }
      if (t.dataset.bsView) { view = t.dataset.bsView; refresh(); return update3D(true); }
      if (t.dataset.bsVariant) { variant = t.dataset.bsVariant === '3' ? null : t.dataset.bsVariant; refresh(); return update3D(true); }
      if (t.dataset.bsSize) {
        const step = Scene.applySizeStep(B, draft.design, +t.dataset.bsSize);
        if (step.clamped || !step.changed) return api.toast(`Size limit reached: width and height stay between ${Scene.LIMITS.width[0]} and ${Scene.LIMITS.width[1]} cm, depth between ${Scene.LIMITS.depth[0]} and ${Scene.LIMITS.depth[1]} cm.`);
        checkpoint(); draft.design = step.design; changed(false, true); api.toast(`Size ${+t.dataset.bsSize > 0 ? '+' : ''}${t.dataset.bsSize}%: ${fmt(step.width)} × ${fmt(step.height)} × ${fmt(step.depth)} cm. Undo reverts.`); return;
      }
      if (t.dataset.bsRow !== undefined || t.dataset.bay !== undefined) { row = +(t.dataset.bsRow ?? t.dataset.bay); refresh(); return; }
      if (t.dataset.preset) { checkpoint(); const s = draft.design; draft.design = B.preset(t.dataset.preset, s.width, s.height, s.depth, s.thickness, Math.max(2, s.levels.length - 1)); changed(); return; }
      if (t.dataset.removeDivider !== undefined) { checkpoint(); draft.design.levels[row].dividers.splice(+t.dataset.removeDivider, 1); changed(); return; }
      const act = t.dataset.bsAction, s = draft.design;
      if (act === 'propose') {
        const promptText = prompt('Describe the shelf edit. Only this request and shelf geometry are sent.');
        if (!promptText) return;
        const status = host.querySelector('#bsProposalStatus'), expected = JSON.stringify(draft.design), generation = interactionGeneration;
        status.textContent = 'Requesting preview…';
        try {
          const received = await api.propose(JSON.parse(expected), promptText, draft.pieceId || null);
          if (!visible || generation !== interactionGeneration || JSON.stringify(draft.design) !== expected) throw Error('The shelf changed. Request a new preview.');
          proposal = { ...received, expected, generation };
          const box = host.querySelector('#bsProposal'); box.replaceChildren();
          const summary = document.createElement('p'); summary.textContent = received.result.summary; box.append(summary);
          const comparison = document.createElement('div'); comparison.className = 'proposal-comparison';
          for (const [label, shelf] of [['Current', draft.design], ['Proposed', received.result.shelf]]) {
            const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = `${label}: ${shelf.width} × ${shelf.height} × ${shelf.depth} cm`; figure.append(caption);
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${shelf.width} ${shelf.height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label + ' shelf front');
            for (const level of shelf.levels) { const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('x1', level.left); line.setAttribute('x2', level.right); line.setAttribute('y1', shelf.height - level.y); line.setAttribute('y2', shelf.height - level.y); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', String(shelf.thickness)); svg.append(line); }
            figure.append(svg); comparison.append(figure);
          }
          box.append(comparison);
          for (const [label, action] of [['Apply preview', 'applyProposal'], ['Discard preview', 'discardProposal']]) { const b = document.createElement('button'); b.className = 'btn light small'; b.textContent = label; b.dataset.bsAction = action; box.append(b); }
          status.textContent = 'Preview only; review before applying.';
        } catch (error) { if (visible && generation === interactionGeneration) status.textContent = error.message || 'Preview unavailable.'; }
        return;
      }
      if (act === 'discardProposal') { proposal = null; host.querySelector('#bsProposal').replaceChildren(); host.querySelector('#bsProposalStatus').textContent = 'Preview discarded.'; return; }
      if (act === 'applyProposal') {
        if (!proposal || proposal.generation !== interactionGeneration || JSON.stringify(draft.design) !== proposal.expected || !api.proposalCurrent(proposal)) { proposal = null; host.querySelector('#bsProposal').replaceChildren(); host.querySelector('#bsProposalStatus').textContent = 'Preview is stale. Request a new one.'; return; }
        checkpoint(); draft.design = JSON.parse(JSON.stringify(proposal.result.shelf)); proposal = null; changed(true); return;
      }
      if (act === 'close') return close();
      if (act === 'standaloneCopy') return api.copyStandalone(JSON.parse(JSON.stringify(draft)), getWall());
      if (act === 'restoreItem') { if (lastRemoved && items.length < Props.MAX_ITEMS) { items.splice(Math.min(lastRemoved.index, items.length), 0, lastRemoved.item); const k = lastRemoved.item.kind; lastRemoved = null; update3D(false); help(`${itemName(k)} is back.`); } return; }
      if (act === 'clearItems') { items = []; person = false; selected = null; help('All items cleared.'); update3D(true); return; }
      if (act === 'resetCamera') return update3D(true);
      if (act === 'undo') { if (history.length) { draft = JSON.parse(history.pop()); changed(true); } refocus('[data-bs-action="undo"]'); return; }
      if (act === 'new') { if (standalone() && api.detach && !api.detach()) return; variant = null; checkpoint(); const other = draft.alternate, wall = draft.wall; draft = fresh(draft.tab); if (standalone()) draft.wall = wall; if (other) draft.alternate = other; row = 0; changed(true); const nm = host.querySelector('[data-bs="name"]'); nm.focus(); if (document.activeElement !== nm) refocus(`[data-bs-action="${act}"]`); return; }
      if (act === 'copy') { if (standalone() && api.detach && !api.detach()) return; checkpoint(); draft.pieceId = null; draft.itemId = null; draft.itemRoomId = null; draft.name += ' copy'; changed(true); const nm = host.querySelector('[data-bs="name"]'); nm.focus(); if (document.activeElement !== nm) refocus(`[data-bs-action="${act}"]`); return; }
      if (act === 'addLevel') {
        if (s.levels.length >= 25) return api.toast('Maximum 25 shelves per design.');
        checkpoint(); const index = Math.min(row, s.levels.length - 2), l = s.levels[index], next = s.levels[index + 1];
        s.levels.splice(index + 1, 0, { y: B.round((l.y + next.y) / 2), left: l.left, right: l.right, dividers: [...l.dividers] }); row = index + 1; return changed();
      }
      if (act === 'removeLevel') { checkpoint(); s.levels.splice(row, 1); row--; return changed(); }
      if (act === 'addDivider') { const x = B.dividerPosition(s, row); if (x === null) return api.toast('No room for another divider in this bay.'); checkpoint(); s.levels[row].dividers.push(x); return changed(); }
      if (['save', 'place', 'csv', 'plan', 'print', 'json'].includes(act)) {
        const p = problems(); if (p.errors.length || (act === 'place' && p.fit.length)) return api.toast('Resolve the highlighted issues first.');
      }
      if (act === 'save' || act === 'place') {
        draft.design = B.normalize(draft.design);
        draft.pieceId = api.saveDesign(draft, act === 'place', standalone() ? null : room()); persist(true); render();
        host.querySelector(`[data-bs-action="${act}"]`).focus({ preventScroll: true }); return;
      }
      if (act === 'json') download(JSON.stringify(standalone() ? api.document(draft) : { format: 'homeplanner-bookshelf', version: 1, units: 'cm', ...withoutAlternate(draft) }, null, 2), 'json', 'application/json');
      if (act === 'csv') download('Board,Part,Length mm,Depth mm,Thickness mm,X mm,Y mm\r\n' + B.boards(s).map(b => [b.id, b.kind, mm(b.length), mm(b.depth), mm(b.thickness), mm(b.x), mm(b.y)].join(',')).join('\r\n'), 'csv', 'text/csv');
      if (act === 'plan') download(buildPlan(), 'html', 'text/html');
      if (act === 'print') { const tab = window.open('', '_blank'); if (!tab) return api.toast('Allow a new tab to print, or download the build plan.'); tab.opener = null; tab.document.write(buildPlan()); tab.document.close(); }
    });
    host.addEventListener('pointerdown', e => {
      const board = e.target.closest('[data-bs-board]'); if (!board || !board.dataset.bsBoard.startsWith('D')) return;
      const [bay, index] = board.dataset.bsBoard.slice(1).split('.').map(n => parseInt(n, 10));
      checkpoint(); row = bay - 1; const interaction = interactionGeneration; let pending3D = 0;
      const move = ev => {
        if (interaction !== interactionGeneration) return;
        const currentSvg = host.querySelector('#bsDrawing svg'), p = currentSvg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
        const x = p.matrixTransform(currentSvg.getScreenCTM().inverse()).x, s = draft.design, wall = getWall();
        const W = wall.width;
        const origin = wall.flip ? W - draft.target.offset - s.width : draft.target.offset;
        s.levels[row].dividers[index - 1] = Math.round((x - origin) * 10) / 10;
        host.querySelector('#bsDrawing').innerHTML = drawing(true, view === 'close');
        if (!pending3D) pending3D = requestAnimationFrame(() => { pending3D = 0; if (interaction === interactionGeneration) update3D(); });
      };
      const end = () => { if (pending3D) cancelAnimationFrame(pending3D); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); if (interaction === interactionGeneration) changed(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); e.preventDefault();
    });
    return { open, close, isOpen: () => visible, updateStorage: () => { if (visible) refresh(); },
      reset: () => { variant = null; clearScene(); interactionGeneration++; proposal = null; history = []; editing = null; draft = null; visible = false; host.hidden = true; host.replaceChildren(); },
      openShelf: (design, name) => { open(); if (!visible) return; variant = null; draft.design = JSON.parse(JSON.stringify(design)); draft.name = name || 'Bookshelf'; draft.tab = design.template === 'saetter3' ? 'saetter' : 'custom'; history = []; persist(true); render(); },
      shelf: () => draft ? JSON.parse(JSON.stringify(draft.design)) : null,
      currentDraft: () => draft ? JSON.parse(JSON.stringify(draft)) : null,
      openDocument: (doc, name) => { open(); if (!visible) return; variant = null; const tab = doc.activeTab; draft = { ...fresh(tab), name: name || 'Bookshelf', design: JSON.parse(JSON.stringify(doc.shelf)), wall: JSON.parse(JSON.stringify(doc.wall)), target: { roomId: null, wall: 'n', offset: doc.placement.offsetCm, elev: doc.placement.elevationCm, gap: doc.placement.gapCm }, tab }; history = []; render(); }
    };
  }
  return { init };
})();
