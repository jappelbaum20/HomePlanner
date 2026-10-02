/* Wall-aware bookshelf editing. The host supplies existing persistence and placement APIs. */
window.BookshelfBuilder = (() => {
  'use strict';
  const B = window.Bookshelf;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => String(B.round(n));
  const mm = n => fmt(n * 10);
  const walls = { n: 'North · top', e: 'East · right', s: 'South · bottom', w: 'West · left' };
  let host, api, draft, visible = false, rig, drag, row = 0, history = [], editing = null;
  const room = () => api.rooms().find(r => r.id === draft.target.roomId) || api.rooms()[0];
  const field = (name, label, value, extra = '') => `<label class="field"><span>${label}</span><input data-bs="${name}" value="${esc(value)}" ${extra}></label>`;
  const numeric = (name, label, value, min = 0, max = 1000) => field(name, label, value, `type="number" step="any" min="${min}" max="${max}" required`);
  function checkpoint() { history.push(JSON.stringify(draft)); if (history.length > 50) history.shift(); }
  function persist(immediate = false) { return api.draft(JSON.parse(JSON.stringify(draft)), immediate); }
  function fresh() {
    const r = api.rooms().find(r => r.id === api.activeRoom()) || api.rooms()[0];
    return { name: 'Custom bookshelf', color: '#A46B42', design: B.preset('staggered', Math.min(240, r.width), Math.min(200, r.height - 8)),
      target: { roomId: r.id, wall: 'n', offset: 20, gap: 2, elev: 0 }, pieceId: null, itemId: null, itemRoomId: null };
  }
  function open(piece, placement) {
    if (!api.rooms().length) return api.toast('Office and Living room are unavailable in this plan.');
    if (piece) {
      draft = { ...fresh(), name: piece.name, color: piece.color, design: B.normalize(piece.shelfDesign), pieceId: piece.id,
        itemId: placement?.item.id || null, itemRoomId: placement?.room.id || null };
      if (piece.shelfTarget) draft.target = { ...piece.shelfTarget };
      if (placement) {
        const it = placement.item, r = placement.room;
        const wall = ({ 0: 'n', 90: 'e', 180: 's', 270: 'w' })[it.rot] || 'n';
        draft.target = { roomId: r.id, wall, elev: it.elev,
          offset: B.round((['n', 's'].includes(wall) ? it.x : it.y) - it.w / 2),
          gap: B.round(wall === 'n' ? it.y - it.d / 2 : wall === 's' ? r.length - it.y - it.d / 2 : wall === 'w' ? it.x - it.d / 2 : r.width - it.x - it.d / 2) };
      }
    } else draft = api.draft() || fresh();
    draft.design = B.normalize(draft.design);
    if (!api.rooms().some(r => r.id === draft.target.roomId)) draft.target.roomId = api.rooms()[0].id;
    if (draft.pieceId && !api.pieces().some(p => p.id === draft.pieceId)) draft.pieceId = null;
    if (draft.itemId && !api.hasPlacement(draft.itemId, draft.itemRoomId)) { draft.itemId = null; draft.itemRoomId = null; }
    row = 0; history = []; editing = null; visible = true;
    api.show(true); host.hidden = false; render(); persist();
    host.querySelector('h1').focus();
  }
  function close() { persist(true); visible = false; host.hidden = true; api.show(false); }
  function problems() {
    const geometry = B.validate(draft.design);
    const invalid = [...host.querySelectorAll('input[type="number"][data-bs]')].filter(t => !t.disabled && (!t.value.trim() || !t.validity.valid));
    return { ...geometry, errors: [...geometry.errors, ...invalid.map(t => `${t.closest('label').textContent.trim()}: enter a number within the shown range.`)],
      fit: [...B.fit(draft.design, room(), draft.target), ...api.collisions(draft, room())] };
  }
  function drawing(wallContext = true) {
    const s = draft.design, r = room(), target = draft.target;
    const W = wallContext ? (['n', 's'].includes(target.wall) ? r.width : r.length) : s.width;
    const H = wallContext ? r.height : s.height;
    const flip = wallContext && ['s', 'e'].includes(target.wall);
    const dx = wallContext ? (flip ? W - target.offset - s.width : target.offset) : 0;
    const dy = wallContext ? target.elev : 0;
    const fs = Math.max(W, H) / 45, pad = fs * 3;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" role="img" aria-label="Dimensioned front elevation; all dimensions in centimetres"><rect width="${W}" height="${H}" fill="${wallContext ? esc(r.walls[target.wall]) : '#FAF8F3'}" stroke="#B5B8B0"/>`;
    if (wallContext) r.openings.filter(o => o.wall === target.wall).forEach(o => {
      const x = flip ? W - o.offset - o.width : o.offset;
      out += `<rect x="${x}" y="${H - (o.sill + o.height)}" width="${o.width}" height="${o.height}" fill="${o.type === 'door' ? '#D7C6AE' : '#D5E5EA'}" stroke="#737D7C"/><text x="${x + 3}" y="${H - o.sill - 5}" font-size="${fs}" fill="#293A3D">${o.type}</text>`;
      if (o.radiator) out += `<rect x="${x}" y="${H - o.sill + 10}" width="${o.width}" height="${Math.max(1, o.sill - 22)}" fill="#DBDDDA" stroke="#848D88"/>`;
    });
    B.boards(s).forEach(b => {
      if (b.w <= 0 || b.h <= 0) return;
      const y = H - dy - b.y - b.h;
      const bay = b.kind === 'Shelf' ? Number(b.id.slice(1)) - 1 : Number(b.id.slice(1).split('.')[0]) - 1;
      out += `<g data-bs-board="${b.id}" data-bay="${bay}"><rect x="${dx + b.x}" y="${y}" width="${b.w}" height="${b.h}" fill="${esc(draft.color)}" stroke="${bay === row ? '#B98C13' : '#513E31'}" stroke-width="${bay === row ? 1 : .35}"/><title>${b.id}: ${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)} mm</title>`;
      const ty = b.kind === 'Shelf' ? y - fs * .25 : y + b.h / 2;
      out += `<text x="${dx + b.x + b.w / 2}" y="${ty}" font-size="${fs * .85}" text-anchor="middle" fill="#302922" pointer-events="none">${b.id}</text></g>`;
    });
    out += `<text x="${W / 2}" y="${H + fs * 1.7}" text-anchor="middle" font-size="${fs}" fill="#313C37">${fmt(W)} cm${wallContext ? ' wall' : ' overall width'}</text><text transform="translate(${-fs * 1.3} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${fs}" fill="#313C37">${fmt(H)} cm</text></svg>`;
    return out;
  }
  function render() {
    const s = draft.design, r = room();
    row = Math.max(0, Math.min(row, s.levels.length - 1));
    host.innerHTML = `<div class="bs-heading"><div><p class="bs-eyebrow">DESIGN FOR YOUR HOME</p><h1 tabindex="-1">Bookshelf builder</h1><p class="note">Choose a wall. Shape each shelf. Keep a plan to build from.</p></div><button class="btn light" data-bs-action="close">Back to room</button></div>
      <div class="bs-layout"><aside class="bs-controls">
        <h2>1. Choose your wall</h2><label class="field"><span>Room</span><select data-bs="roomId">${api.rooms().map(x => `<option value="${esc(x.id)}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Wall</span><select data-bs="wall">${Object.entries(walls).map(([k, label]) => `<option value="${k}" ${k === draft.target.wall ? 'selected' : ''}>${label} · ${['n', 's'].includes(k) ? r.width : r.length} cm</option>`).join('')}</select></label>
        <p class="note" id="bsWallNote">Ceiling ${r.height} cm. Wall sides match the floor plan. Offset is from its left corner (north/south) or top corner (east/west).</p>
        <div class="row3">${numeric('offset', 'Wall offset, cm', draft.target.offset)}${numeric('gap', 'Wall gap, cm', draft.target.gap)}${numeric('elev', 'Above floor, cm', draft.target.elev)}</div>
        <h2>2. Shape the bookshelf</h2>${field('name', 'Design name', draft.name, 'maxlength="100"')}
        <div class="row3">${numeric('width', 'Width, cm', s.width, 20)}${numeric('height', 'Height, cm', s.height, 20, 800)}${numeric('depth', 'Depth, cm', s.depth, 10, 100)}</div>
        <div class="row2">${numeric('thickness', 'Board thickness, cm', s.thickness, .9, 6)}${field('color', 'Wood / finish color', draft.color, 'type="color"')}</div>
        <p class="note">Width and height changes scale the layout. Board thickness stays exact.</p>
        <div class="bs-presets"><button class="btn light small" data-preset="framed">Framed</button><button class="btn light small" data-preset="staggered">Staggered</button><button class="btn light small" data-preset="stepped">Stepped edges</button></div>
        <div class="sec-head"><h3>Individual shelves · bottom to top</h3><button class="btn light small" data-bs-action="addLevel">+ Shelf</button></div><div id="bsLevels"></div>
        <p class="note">Select a board in the drawing or 3D view. Drag a divider in the drawing, or enter exact values below. All editing values are cm.</p>
        <p class="note bs-edit-feedback" id="bsEditFeedback" role="status"></p><div id="bsRowEditor"></div>
      </aside><div class="bs-preview"><div class="bs-preview-head"><h2 id="bsPreviewTitle"></h2><div class="btnrow"><button class="btn light small" data-bs-action="undo" ${history.length ? '' : 'disabled'}>Undo</button><button class="btn light small" data-bs-action="resetCamera">Reset 3D view</button></div></div>
        <div id="bs3d" aria-label="Orbitable 3D bookshelf against the selected wall"></div><p class="note">Drag to orbit · scroll to zoom · click a board to edit its level</p>
        <div id="bsDrawing" class="bs-drawing"></div><div id="bsProblems" aria-live="polite"></div>
      </div><aside class="bs-output"><h2>3. Save & place</h2><label class="field"><span>Saved bookshelf designs</span><select data-bs="saved"><option value="">Select a design…</option>${api.pieces().filter(p => p.shelfDesign).map(p => `<option value="${esc(p.id)}" ${p.id === draft.pieceId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <p class="note" id="bsSaveNote"></p><div class="bs-save-actions"><button class="btn" data-bs-action="save">Save design</button><button class="btn mark" data-bs-action="place">Save & ${draft.itemId ? 'move placement' : 'place on wall'}</button><button class="btn light" data-bs-action="copy">Make a copy</button><button class="btn light" data-bs-action="new">New design</button></div>
        <h3>Workshop plan</h3><p class="note">Square-cut boards, full depth. Dividers fit between horizontal shelves with butt joints. The drawing and list use the same geometry as 3D.</p>
        <div id="bsCutSummary"></div><div class="bs-table-wrap"><table class="bs-cut"><thead><tr><th>Board</th><th>Length × depth × thickness, mm</th></tr></thead><tbody id="bsCutList"></tbody></table></div>
        <div class="bs-save-actions"><button class="btn light" data-bs-action="csv">Download cut list</button><button class="btn light" data-bs-action="plan">Download build plan</button><button class="btn light" data-bs-action="print">Print / save PDF</button><button class="btn light" data-bs-action="json">Export design JSON</button></div>
        <p class="note">Drafts autosave in this browser. Saved designs are in My pieces, versions, and full-plan backups. Export a backup to move to another device.</p>
        <p class="note">Measure the actual wall and timber before cutting. Cut sizes exclude saw kerf, machining allowances, fasteners and joinery. Check sag, stability and wall anchoring for your chosen wood and loads.</p>
      </aside></div>`;
    refresh();
    if (rig) host.querySelector('#bs3d').appendChild(rig.renderer.domElement);
    update3D(true);
  }
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
    const r = room();
    host.querySelector('[data-bs="wall"]').innerHTML = Object.entries(walls).map(([k, label]) => `<option value="${k}" ${k === draft.target.wall ? 'selected' : ''}>${label} · ${['n', 's'].includes(k) ? r.width : r.length} cm</option>`).join('');
    host.querySelector('#bsWallNote').textContent = `Ceiling ${r.height} cm. Wall sides match the floor plan. Offset is from its left corner (north/south) or top corner (east/west).`;
    const values = { ...draft.target, name: draft.name, color: draft.color, width: s.width, height: s.height, depth: s.depth, thickness: s.thickness };
    host.querySelector('.bs-controls').querySelectorAll('[data-bs]').forEach(t => {
      if (Object.hasOwn(values, t.dataset.bs) && t !== document.activeElement) t.value = values[t.dataset.bs];
    });
    host.querySelector('[data-bs-action="addLevel"]').disabled = s.levels.length < 2 || s.levels.length >= 25;
    host.querySelector('#bsEditFeedback').textContent = p.errors[0] || '';
    host.querySelector('#bsDrawing').innerHTML = drawing();
    host.querySelector('#bsPreviewTitle').textContent = `${room().name} · ${walls[draft.target.wall]} wall`;
    host.querySelector('#bsProblems').innerHTML = `${p.errors.length ? `<div class="bs-error"><b>Fix the board layout before saving</b><ul>${p.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${p.fit.length ? `<div class="bs-error"><b>Choose a clear placement before placing</b><ul>${p.fit.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '<p class="bs-ok">Fits the wall dimensions and clears the checked openings and furniture.</p>'}
      ${p.warnings.length ? `<div class="bs-warning"><b>Construction checks</b><ul>${p.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
    const parts = B.boards(s);
    host.querySelector('#bsCutList').innerHTML = valid ? parts.map(b => `<tr><td>${b.id}</td><td>${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)}</td></tr>`).join('') : '<tr><td colspan="2">Fix the layout to calculate a usable cut list.</td></tr>';
    host.querySelector('#bsCutSummary').textContent = valid ? `${parts.length} boards · ${fmt(parts.reduce((sum, b) => sum + b.length * b.depth, 0) / 10000)} m² of board face (before waste)` : '';
    host.querySelector('#bsSaveNote').textContent = draft.pieceId ? 'Saving updates this design and all its existing placements. Make a copy for a different version.' : 'Save as a reusable piece; place it now or later in either room.';
    if (!api.storageAvailable()) host.querySelector('#bsSaveNote').textContent = 'Browser storage is unavailable: changes only last for this session. Download a design or export a full-plan backup now.';
    for (const action of ['save', 'csv', 'plan', 'print', 'json']) host.querySelector(`[data-bs-action="${action}"]`).disabled = !valid;
    host.querySelector('[data-bs-action="place"]').disabled = !valid || !!p.fit.length;
    host.querySelector('[data-bs-action="undo"]').disabled = !history.length;
  }
  function update3D(reset = false) {
    const el = host.querySelector('#bs3d');
    if (!rig) {
      try {
        if (!window.THREE || !window.HouseModels || !THREE.OrbitControls) throw Error('3D libraries unavailable');
        HouseModels.init(THREE);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#E8E9E4');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x9D8671, .9));
        const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(100, 400, 500); scene.add(sun);
        const camera = new THREE.PerspectiveCamera(38, 1, 1, 10000);
        const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI * .85;
        rig = { renderer, scene, camera, controls, group: null, boards: [] };
        renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
        renderer.domElement.addEventListener('pointerup', e => {
          if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) return;
          const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
          const hit = ray.intersectObjects(rig.boards)[0];
          if (hit) { row = hit.object.userData.bay; refresh(); }
        });
        new ResizeObserver(() => resize3D()).observe(host);
        (function animate() { requestAnimationFrame(animate); if (!visible) return; controls.update(); renderer.render(scene, camera); })();
      } catch (e) { el.innerHTML = '<p class="empty">3D needs WebGL and the online 3D libraries. You can still edit the dimensioned drawing.</p>'; return; }
    }
    if (!el.contains(rig.renderer.domElement)) el.appendChild(rig.renderer.domElement);
    if (rig.group) {
      rig.scene.remove(rig.group);
      rig.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => {
        ['map', 'bumpMap'].forEach(k => { if (m[k] && !m[k].keep && o.geometry?.type !== 'PlaneGeometry') m[k].dispose(); }); m.dispose();
      }); });
    }
    const s = draft.design, r = room(), target = draft.target, W = ['n', 's'].includes(target.wall) ? r.width : r.length;
    const flip = ['s', 'e'].includes(target.wall), offset = flip ? W - target.offset - s.width : target.offset;
    const g = rig.group = new THREE.Group(); rig.scene.add(g);
    const addBox = (w, h, d, x, y, z, color) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color })); mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    addBox(W, r.height, 3, W / 2, r.height / 2, -1.5, r.walls[target.wall]);
    addBox(W + 50, 2, 150, W / 2, -1, 60, '#C9B497');
    r.openings.filter(o => o.wall === target.wall).forEach(o => {
      const x = flip ? W - o.offset - o.width : o.offset;
      addBox(o.width, o.height, 1, x + o.width / 2, o.sill + o.height / 2, .6, o.type === 'door' ? '#BFA98C' : '#C3DBE5');
      if (o.radiator) addBox(o.width * .9, Math.max(1, o.sill - 22), 12, x + o.width / 2, 10 + (o.sill - 22) / 2, 6, '#E8E9E5');
    });
    const obj = HouseModels.buildItem({ type: 'shelf', w: s.width, d: s.depth, h: s.height, color: draft.color, shelfDesign: s, elev: target.elev }, { evening: false });
    obj.position.set(offset + s.width / 2, target.elev, target.gap + s.depth / 2); g.add(obj);
    const parts = B.boards(s).filter(b => b.w > 0 && b.h > 0);
    rig.boards = obj.children.filter(o => o.isMesh && o.geometry?.type !== 'PlaneGeometry');
    rig.boards.forEach((o, i) => { const b = parts[i]; if (b) o.userData.bay = Number(b.id.slice(1).split('.')[0]) - 1; });
    if (reset) {
      rig.controls.target.set(offset + s.width / 2, target.elev + s.height / 2, s.depth / 2);
      const distance = Math.max(s.width, s.height) * 1.8;
      rig.camera.position.set(offset + s.width / 2 + distance * .35, target.elev + s.height / 2 + distance * .2, distance);
      rig.controls.update();
    }
    resize3D();
  }
  function resize3D() {
    if (!rig || !visible) return;
    const el = host.querySelector('#bs3d'); if (!el) return;
    rig.renderer.setSize(el.clientWidth, el.clientHeight); rig.camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1); rig.camera.updateProjectionMatrix();
  }
  function changed(full = false, reframe = false) { persist(); if (full) render(); else { refresh(); update3D(reframe); } }
  function applyField(t, baseline) {
    const key = t.dataset.bs, s = draft.design, l = s.levels[row];
    if (['roomId', 'wall', 'offset', 'gap', 'elev'].includes(key)) draft.target[key] = t.type === 'number' ? Number(t.value) : t.value;
    else if (key === 'width' || key === 'height') draft.design = B.resize(baseline.design, key === 'width' ? +t.value : s.width, key === 'height' ? +t.value : s.height);
    else if (key === 'thickness') {
      const source = baseline.design; draft.design = JSON.parse(JSON.stringify(source)); draft.design.thickness = +t.value;
      draft.design.levels.slice(0, -1).forEach((level, i) => {
        const next = draft.design.levels[i + 1], a = Math.max(level.left, next.left), b = Math.min(level.right, next.right);
        level.dividers = level.dividers.map(x => Math.abs(x - a - source.thickness / 2) < .001 ? B.round(a + +t.value / 2) : Math.abs(x - b + source.thickness / 2) < .001 ? B.round(b - +t.value / 2) : x);
      });
      if (draft.design.levels.length) draft.design.levels.at(-1).y = B.round(source.height - +t.value);
    } else if (key === 'depth') s.depth = +t.value;
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
    const s = draft.design, r = room();
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(draft.name)} · build plan</title><style>body{font:14px system-ui;color:#222;max-width:900px;margin:30px auto;padding:0 20px}svg{width:100%;max-height:480px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:6px;text-align:left}tr{break-inside:avoid}p{line-height:1.5}@media print{button{display:none}body{margin:0}thead{display:table-header-group}}</style><button onclick="window.print()">Print / save PDF</button><h1>${esc(draft.name)}</h1><p>${mm(s.width)} × ${mm(s.height)} × ${mm(s.depth)} mm overall · ${mm(s.thickness)} mm timber<br>${esc(r.name)}, ${esc(walls[draft.target.wall])} wall; offset ${mm(draft.target.offset)} mm, wall gap ${mm(draft.target.gap)} mm, base ${mm(draft.target.elev)} mm above floor.</p>${drawing(false)}<p>Front elevation. Drawing labels are board IDs; dimensions on the drawing are cm. Table dimensions are mm. X = board left edge from bookshelf left; Y = underside from bookshelf base. Shelf lengths run horizontally; divider lengths run vertically.</p><table><thead><tr><th>Board</th><th>Part</th><th>Length × depth × thickness, mm</th><th>X, mm</th><th>Y, mm</th></tr></thead><tbody>${B.boards(s).map(b => `<tr><td>${b.id}</td><td>${b.kind}</td><td>${mm(b.length)} × ${mm(b.depth)} × ${mm(b.thickness)}</td><td>${mm(b.x)}</td><td>${mm(b.y)}</td></tr>`).join('')}</tbody></table><p>Assembly assumption: square-cut full-depth boards, with dividers butt-jointed between horizontal shelves. No back panel. Joint hardware and fastening locations must be chosen separately. Sizes exclude saw kerf and machining allowances. Measure actual wall and board thickness before cutting; review sag, stability and wall anchoring for the selected wood and loads.</p>${B.validate(s).warnings.map(w => `<p>${esc(w)}</p>`).join('')}</html>`;
  }
  function init(element, bridge) {
    host = element; api = bridge;
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
      const t = e.target, key = t.dataset.bs; if (!key) return;
      if (key === 'saved') { const p = api.pieces().find(p => p.id === t.value); if (p) open(p, api.findPlacement(p.id)); return; }
      if (t.matches('input[data-bs]')) {
        if (t.type === 'number' && (!t.value.trim() || !t.validity.valid)) {
          const values = { ...draft.design, ...draft.target, levelY: draft.design.levels[row]?.y, left: draft.design.levels[row]?.left, right: draft.design.levels[row]?.right };
          t.value = key.startsWith('divider:') ? draft.design.levels[row]?.dividers[+key.split(':')[1]] : values[key];
          api.toast('Enter a number within the shown range. The last valid value has been kept.'); refresh();
        }
        return;
      }
      checkpoint(); applyField(t, JSON.parse(JSON.stringify(draft))); changed(false, true);
    });
    host.addEventListener('click', e => {
      const t = e.target.closest('button, [data-bs-board]'); if (!t) return;
      if (t.dataset.bsRow !== undefined || t.dataset.bay !== undefined) { row = +(t.dataset.bsRow ?? t.dataset.bay); refresh(); return; }
      if (t.dataset.preset) { checkpoint(); const s = draft.design; draft.design = B.preset(t.dataset.preset, s.width, s.height, s.depth, s.thickness, Math.max(2, s.levels.length - 1)); changed(); return; }
      if (t.dataset.removeDivider !== undefined) { checkpoint(); draft.design.levels[row].dividers.splice(+t.dataset.removeDivider, 1); changed(); return; }
      const act = t.dataset.bsAction, s = draft.design;
      if (act === 'close') return close();
      if (act === 'resetCamera') return update3D(true);
      if (act === 'undo') { if (history.length) { draft = JSON.parse(history.pop()); changed(true); } return; }
      if (act === 'new') { checkpoint(); draft = fresh(); row = 0; changed(true); host.querySelector('[data-bs="name"]').focus(); return; }
      if (act === 'copy') { checkpoint(); draft.pieceId = null; draft.itemId = null; draft.itemRoomId = null; draft.name += ' copy'; changed(true); host.querySelector('[data-bs="name"]').focus(); return; }
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
        draft.pieceId = api.saveDesign(draft, act === 'place', room()); persist(true); render();
        host.querySelector(`[data-bs-action="${act}"]`).focus({ preventScroll: true }); return;
      }
      if (act === 'json') download(JSON.stringify({ format: 'homeplanner-bookshelf', version: 1, units: 'cm', ...draft }, null, 2), 'json', 'application/json');
      if (act === 'csv') download('Board,Part,Length mm,Depth mm,Thickness mm,X mm,Y mm\r\n' + B.boards(s).map(b => [b.id, b.kind, mm(b.length), mm(b.depth), mm(b.thickness), mm(b.x), mm(b.y)].join(',')).join('\r\n'), 'csv', 'text/csv');
      if (act === 'plan') download(buildPlan(), 'html', 'text/html');
      if (act === 'print') { const tab = window.open('', '_blank'); if (!tab) return api.toast('Allow a new tab to print, or download the build plan.'); tab.opener = null; tab.document.write(buildPlan()); tab.document.close(); }
    });
    host.addEventListener('pointerdown', e => {
      const board = e.target.closest('[data-bs-board]'); if (!board || !board.dataset.bsBoard.startsWith('D')) return;
      const [bay, index] = board.dataset.bsBoard.slice(1).split('.').map(Number), svg = board.closest('svg');
      checkpoint(); row = bay - 1;
      const move = ev => {
        const currentSvg = host.querySelector('#bsDrawing svg'), p = currentSvg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
        const x = p.matrixTransform(currentSvg.getScreenCTM().inverse()).x, s = draft.design, r = room();
        const W = ['n', 's'].includes(draft.target.wall) ? r.width : r.length;
        const origin = ['s', 'e'].includes(draft.target.wall) ? W - draft.target.offset - s.width : draft.target.offset;
        s.levels[row].dividers[index - 1] = Math.round((x - origin) * 10) / 10;
        host.querySelector('#bsDrawing').innerHTML = drawing(); update3D();
      };
      const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); changed(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); e.preventDefault();
    });
    return { open, close, isOpen: () => visible, updateStorage: () => { if (visible) refresh(); } };
  }
  return { init };
})();
