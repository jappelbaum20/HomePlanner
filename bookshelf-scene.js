// Camera framing, dimension labels and size stepping for the bookshelf builder.
// The first half is pure (cm, no DOM, tested in Node). The second half draws the 3D scene.
(function (root) {
  'use strict';
  const round1 = n => Math.round(n * 10) / 10, rad = d => d * Math.PI / 180;
  const FOV = 32, MARGIN = 1.35, MAX_AZIMUTH = 60;
  const LIMITS = { width: [20, 500], height: [20, 500], depth: [10, 100] };
  const fmtCm = n => `${round1(n).toFixed(1).replace(/\.0$/, '')} cm`;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Distance at which a width x height rectangle fills the view with the margin factor.
  function frameDistance(width, height, aspect, fovDeg = FOV, margin = MARGIN) {
    const t = Math.tan(rad(fovDeg) / 2);
    return Math.max(width / Math.max(aspect, .1), height) / (2 * t) * margin;
  }
  // box = {minX,maxX,minY,maxY,minZ,maxZ}. The camera looks at the centre; depth moves the front face closer.
  function frameBox(box, aspect, fovDeg = FOV, margin = MARGIN) {
    const w = box.maxX - box.minX, h = box.maxY - box.minY, d = box.maxZ - box.minZ;
    return { center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2], distance: frameDistance(w, h, aspect, fovDeg, margin) + d / 2 };
  }
  const clampAzimuth = deg => clamp(deg, -MAX_AZIMUTH, MAX_AZIMUTH);
  function cameraPosition(center, distance, azimuthDeg, elevationDeg) {
    const a = rad(azimuthDeg), e = rad(elevationDeg);
    return [center[0] + distance * Math.sin(a) * Math.cos(e), center[1] + distance * Math.sin(e), center[2] + distance * Math.cos(a) * Math.cos(e)];
  }

  // Direct size step for custom shelves: percent of the current size, one decimal, kept inside the
  // limits that the saved-design schema accepts. Thickness is never touched.
  function sizeStep(size, percent) {
    const f = 1 + percent / 100, out = {}; let clamped = false;
    for (const k of ['width', 'height', 'depth']) {
      const raw = round1(size[k] * f), v = clamp(raw, LIMITS[k][0], LIMITS[k][1]);
      if (v !== raw) clamped = true; out[k] = v;
    }
    out.clamped = clamped; out.changed = ['width', 'height', 'depth'].some(k => out[k] !== size[k]);
    return out;
  }
  function applySizeStep(B, design, percent) {
    const next = sizeStep(design, percent);
    if (!next.changed) return { design, ...next };
    const resized = B.resize(design, next.width, next.height); resized.depth = next.depth;
    return { design: resized, ...next };
  }

  // Dimension lines in world cm (x right, y up, z toward the viewer). Labels sit at the middle.
  function dimensionLines(box) {
    const w = box.maxX - box.minX, h = box.maxY - box.minY, d = box.maxZ - box.minZ, out = 6, tick = 2;
    return [
      { key: 'width', text: fmtCm(w), a: [box.minX, box.maxY + out, box.maxZ], b: [box.maxX, box.maxY + out, box.maxZ], tick: [0, tick, 0] },
      { key: 'height', text: fmtCm(h), a: [box.minX - out, box.minY, box.maxZ], b: [box.minX - out, box.maxY, box.maxZ], tick: [tick, 0, 0] },
      { key: 'depth', text: fmtCm(d), a: [box.maxX + out, box.minY, box.minZ], b: [box.maxX + out, box.minY, box.maxZ], tick: [0, tick, 0] }
    ].map(l => ({ ...l, mid: l.a.map((v, i) => (v + l.b[i]) / 2) }));
  }
  // Wall size lines for the Whole-wall view, plus the height above the floor when the furniture is raised.
  function wallLines(wall, furniture) {
    const out = 10, lines = [
      { key: 'wallWidth', text: fmtCm(wall.width), a: [0, wall.height + out, 0], b: [wall.width, wall.height + out, 0], tick: [0, 3, 0] },
      { key: 'wallHeight', text: fmtCm(wall.height), a: [-out, 0, 0], b: [-out, wall.height, 0], tick: [3, 0, 0] }
    ];
    if (furniture && furniture.minY > 0) lines.push({ key: 'elevation', text: `${fmtCm(furniture.minY)} above floor`, a: [furniture.minX - 4, 0, furniture.maxZ], b: [furniture.minX - 4, furniture.minY, furniture.maxZ], tick: [2, 0, 0] });
    return lines.map(l => ({ ...l, mid: l.a.map((v, i) => (v + l.b[i]) / 2) }));
  }
  function lineExtents(lines, box) {
    const e = { ...box };
    lines.forEach(l => [l.a, l.b, l.mid].forEach(p => { e.minX = Math.min(e.minX, p[0]); e.maxX = Math.max(e.maxX, p[0]); e.minY = Math.min(e.minY, p[1]); e.maxY = Math.max(e.maxY, p[1]); e.minZ = Math.min(e.minZ, p[2]); e.maxZ = Math.max(e.maxZ, p[2]); }));
    return e;
  }
  // 2D drawing crop: furniture rectangle plus padding; text size comes from the crop, not the wall.
  function cropViewBox(rect, pad = .12) {
    const p = Math.max(rect.w, rect.h) * pad, fs = Math.max(rect.w, rect.h) / 26, room = fs * 2.6;
    const x = rect.x - Math.max(p, room), y = rect.y - Math.max(p, fs * 1.6), w = rect.w + Math.max(p, room) * 2, h = rect.h + Math.max(p, fs * 1.6) + Math.max(p, room);
    return { x, y, w, h, fontSize: fs, viewBox: `${round1(x * 100) / 100} ${round1(y * 100) / 100} ${round1(w * 100) / 100} ${round1(h * 100) / 100}` };
  }
  const readout = d => `Furniture ${fmtCm(d.width).replace(' cm', '')} × ${fmtCm(d.height).replace(' cm', '')} × ${fmtCm(d.depth)} (W × H × D)`;
  const pure = { FOV, MARGIN, MAX_AZIMUTH, LIMITS, fmtCm, frameDistance, frameBox, clampAzimuth, cameraPosition, sizeStep, applySizeStep, dimensionLines, wallLines, lineExtents, cropViewBox, readout };

  // ---------- 3D drawing (browser only) ----------
  function create(opts) {
    const { THREE, onPick } = opts; let el = opts.el; // the host re-renders its markup, so update() hands over the current element
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // Phone budget: pixel ratio and shadow map are capped; a weak GPU (small max texture) drops shadows altogether.
    const small = Math.min(window.innerWidth || 1024, window.innerHeight || 1024) < 700 || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const quality = { pixelRatio: Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5), shadowMapSize: small ? 1024 : 2048, shadows: renderer.capabilities.maxTextureSize >= 4096 };
    renderer.setPixelRatio(quality.pixelRatio); renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (quality.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#E8E9E4');
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7a68, .62));
    // Warm sun from the front left and above, like a window beside the shelf.
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.05); sun.position.set(-160, 300, 380); scene.add(sun, sun.target);
    if (quality.shadows) { sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize); sun.shadow.bias = -.0005; sun.shadow.normalBias = .35; sun.shadow.radius = 4; }
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .85;
    controls.minAzimuthAngle = -rad(MAX_AZIMUTH); controls.maxAzimuthAngle = rad(MAX_AZIMUTH);
    const rig = { renderer, scene, camera, controls, group: null, boards: [], furniture: [], propMeshes: [], frame: null, labels: [], state: null, userMoved: false };
    const debug = window.__bsDebug = { frames: 0, labels: [], view: 'close', fit: null, quality, props: 0, person: false, info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) };
    // Test hook: place the camera at an azimuth/elevation around the current target at the current distance.
    debug.orbit = (az, el = 10) => { const t = controls.target, d = camera.position.distanceTo(t), p = cameraPosition([t.x, t.y, t.z], d, clampAzimuth(az), el); camera.position.set(...p); controls.update(); request(300); };
    // Test hook: client coordinates of a furniture-local point (cm) so a test can click a given compartment.
    debug.screenOf = (x, y, z = 0) => { const f = rig.frame, v = new THREE.Vector3(f.offset + x, f.elev + y, f.gap + f.depth - z).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; };
    debug.realism = () => { const f = rig.furniture, mats = o => [].concat(o.material), g = rig.group, wall = g && g.children[0], floor = g && g.children[1], skirt = g && g.children[2];
      return { shadowsOn: renderer.shadowMap.enabled, sunCasts: sun.castShadow, shadowMap: sun.shadow.mapSize.x, pixelRatio: renderer.getPixelRatio(), wallTextured: !!(wall && wall.material.map), wallReceives: !!(wall && wall.receiveShadow), floorTextured: !!(floor && floor.material.map), skirting: !!(skirt && skirt.geometry.parameters.height === 9), furnitureCasts: f.length > 0 && f.every(o => o.castShadow), furnitureTextured: f.length > 0 && f.every(o => mats(o).every(m => !!m.map)), sunColor: sun.color.getHexString() }; };
    debug.propsInfo = () => rig.propMeshes.length;
    debug.projectLabels = () => rig.group ? rig.group.children.filter(o => o.isSprite).map(o => { const v = o.position.clone().project(camera), r = renderer.domElement.getBoundingClientRect(); return { key: o.userData.key, x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, w: r.width, h: r.height }; }) : [];
    let raf = 0, keepUntil = 0;
    function frame() {
      raf = 0; if (!rig.state || !rig.state.visible()) return;
      const moved = controls.update(); renderer.render(scene, camera); debug.frames++;
      if (moved || performance.now() < keepUntil) raf = requestAnimationFrame(frame);
    }
    function request(ms = 0) { keepUntil = Math.max(keepUntil, performance.now() + ms); if (!raf) raf = requestAnimationFrame(frame); }
    controls.addEventListener('change', () => { rig.userMoved = true; request(700); });

    // Rendering is on demand, so a lost and restored context must trigger a redraw itself.
    renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault());
    renderer.domElement.addEventListener('webglcontextrestored', () => { debug.restored = (debug.restored || 0) + 1; request(300); });
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(rig.propMeshes.concat(rig.furniture), false)[0];
      if (!hit || !onPick) return;
      if (hit.object.userData.propId) return onPick({ propId: hit.object.userData.propId });
      const f = rig.frame, n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      // Furniture-local point (cm): x from the left edge, y up from the bottom, z from the front face; z only for upward faces.
      const local = { x: hit.point.x - f.offset, y: hit.point.y - f.elev, ...(n && n.y > .5 ? { z: f.gap + f.depth - hit.point.z } : {}) };
      onPick({ bay: bayAt(local.y), local });
    });
    function bayAt(y) { const lv = rig.frame.design.levels; let b = 0; lv.forEach((l, i) => { if (l.y <= y + .01 && i < lv.length - 1) b = i; }); return b; }

    function sprite(text) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), font = '700 42px system-ui, sans-serif', m = document.createElement('canvas').getContext('2d'); m.font = font;
      const cw = Math.max(256, Math.ceil(m.measureText(text).width + 28)), c = document.createElement('canvas'); c.width = cw * dpr; c.height = 64 * dpr; // long texts get a wider sprite, same letter size
      const g = c.getContext('2d'); g.scale(dpr, dpr); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(text, cw / 2, 33); g.fillStyle = '#1D2B26'; g.fillText(text, cw / 2, 33);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
      const s = new THREE.Sprite(mat); const h = .1 * Math.tan(rad(FOV) / 2); s.scale.set(h * cw / 64, h, 1); s.renderOrder = 999; s.raycast = () => {};
      return s;
    }
    function addLines(list, group) {
      const mat = new THREE.LineBasicMaterial({ color: 0x1D2B26, depthTest: false, transparent: true });
      list.forEach(l => {
        const [a, b, t] = [l.a, l.b, l.tick], v = p => new THREE.Vector3(...p), sub = (p, k) => [p[0] - t[0] * k, p[1] - t[1] * k, p[2] - t[2] * k], add = (p, k) => [p[0] + t[0] * k, p[1] + t[1] * k, p[2] + t[2] * k];
        const pts = [a, b, sub(a, 1), add(a, 1), sub(b, 1), add(b, 1)].map(v);
        const geo = new THREE.BufferGeometry().setFromPoints(pts); geo.setIndex([0, 1, 2, 3, 4, 5]);
        if (!l.noLine) { const line = new THREE.LineSegments(geo, mat); line.renderOrder = 998; group.add(line); }
        const s = sprite(l.text); s.position.set(...l.mid); s.userData.key = l.key; s.userData.text = l.text; group.add(s);
      });
    }
    function dispose(group) {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => {
        ['map', 'bumpMap'].forEach(k => { if (m[k] && !m[k].keep && o.geometry?.type !== 'PlaneGeometry') m[k].dispose(); }); m.dispose(); }); });
    }
    let last = null;
    function fitCamera(box, view, state, force) {
      last = { box, view, state };
      const aspect = el.clientWidth / Math.max(el.clientHeight, 1), f = frameBox(box, aspect);
      const elev = state.target.elev > 0 ? 6 : 10, az = view === 'wall' ? 0 : 22;
      if (!force && rig.userMoved) return;
      controls.target.set(...f.center); controls.minDistance = f.distance * .6; controls.maxDistance = f.distance * 2.5;
      camera.position.set(...cameraPosition(f.center, f.distance, az, elev)); camera.near = Math.max(1, f.distance / 100); camera.far = f.distance * 40; camera.updateProjectionMatrix();
      controls.update(); rig.userMoved = false; debug.fit = { distance: f.distance, center: f.center, aspect };
    }
    // state: {design, wall, target, color, view, showSizes, flip, visible()} ; reset re-frames the camera.
    function update(state, reset, element) {
      rig.state = state; if (element) el = element;
      if (!el.contains(renderer.domElement)) el.appendChild(renderer.domElement);
      if (rig.group) { scene.remove(rig.group); dispose(rig.group); }
      const s = state.design, wall = state.wall, target = state.target, W = wall.width;
      const offset = wall.flip ? W - target.offset - s.width : target.offset;
      const g = rig.group = new THREE.Group(); scene.add(g);
      let personLabel = null;
      const HMm = HM(), flat = (m, cast, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
      const addBox = (w, h, d, x, y, z, color, material, cast = false) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material || new THREE.MeshStandardMaterial({ color })); m.position.set(x, y, z); flat(m, cast); g.add(m); return m; };
      // Painted plaster wall (subtle texture), wooden floor and a skirting board along the wall base.
      addBox(W, wall.height, 3, W / 2, wall.height / 2, -1.5, null, HMm.wallMaterial(wall.color, 'paint', W, wall.height));
      addBox(W + 50, 2, 190, W / 2, -1, 80, null, HMm.floorMaterial('#CDB28F', 'wood', W + 50, 190));
      const doors = wall.openings.filter(o => o.type === 'door').map(o => { const x = wall.flip ? W - o.offset - o.width : o.offset; return [x, x + o.width]; }).sort((a, b) => a[0] - b[0]);
      if (target.elev < 10 && target.gap < 2) { doors.push([offset - .2, offset + s.width + .2]); doors.sort((a, b) => a[0] - b[0]); } // the furniture stands where the skirting would be
      let sx = 0; const skirtMat = HMm.mat('#F3F1EA', { rough: .55 });
      [...doors, [W, W]].forEach(([a, b]) => { if (a - sx > 1) addBox(a - sx, 9, 1.5, (sx + a) / 2, 4.5, .75, null, skirtMat, true); sx = Math.max(sx, b); });
      wall.openings.forEach(o => {
        const x = wall.flip ? W - o.offset - o.width : o.offset;
        addBox(o.width, o.height, 1, x + o.width / 2, o.sill + o.height / 2, .6, o.type === 'door' ? '#BFA98C' : '#C3DBE5');
        if (o.radiator) addBox(o.width * .9, Math.max(1, o.sill - 22), 12, x + o.width / 2, 10 + (o.sill - 22) / 2, 6, '#E8E9E5');
      });
      const obj = HMm.buildItem({ type: 'shelf', w: s.width, d: s.depth, h: s.height, color: state.color, shelfDesign: s, elev: target.elev }, { evening: false });
      obj.position.set(offset + s.width / 2, target.elev, target.gap + s.depth / 2); g.add(obj);
      const parts = (Bookshelf.visualBoards || Bookshelf.boards)(s).filter(b => b.w > 0 && b.h > 0);
      rig.furniture = obj.children.filter(o => o.isMesh && o.geometry?.type !== 'PlaneGeometry');
      rig.furniture.forEach((o, i) => { const b = parts[i]; if (b && b.kind !== 'Back') o.userData.bay = Number(b.id.slice(1).split('.')[0]) - 1; });
      rig.boards = rig.furniture.filter(o => Number.isInteger(o.userData.bay));
      rig.frame = { offset, elev: target.elev, gap: target.gap, depth: s.depth, design: s };
      const box = { minX: offset, maxX: offset + s.width, minY: target.elev, maxY: target.elev + s.height, minZ: target.gap, maxZ: target.gap + s.depth };
      // Items to compare against, at true size, in furniture-local cm (x from the left, y up, z from the front).
      rig.propMeshes = []; const sizes = []; debug.propBounds = sizes;
      const P = window.BookshelfProps, placed = state.props || [];
      const front = target.gap + s.depth;
      if (P) placed.forEach(p => {
        const m = P.make(THREE, p.kind, { rot: p.rot, color: p.color });
        m.position.set(offset + p.x, target.elev + p.y, front - p.z);
        m.traverse(o => { if (o.isMesh) { o.userData.propId = p.id; rig.propMeshes.push(o); } }); g.add(m); m.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3()); sizes.push({ kind: p.kind, id: p.id, w: Math.round(sz.x * 100) / 100, h: Math.round(sz.y * 100) / 100, d: Math.round(sz.z * 100) / 100, baseY: Math.round((bb.min.y - target.elev) * 100) / 100 });
      });
      debug.props = placed.length; debug.person = false;
      let reach = { ...box };
      placed.forEach(p => { reach.maxY = Math.max(reach.maxY, target.elev + p.y + p.h); reach.minX = Math.min(reach.minX, offset + p.x - p.w / 2); reach.maxX = Math.max(reach.maxX, offset + p.x + p.w / 2); });
      if (P && state.person) {
        const room = W - (offset + s.width), px = room >= 50 ? offset + s.width + 30 : offset - 30, pz = target.gap + s.depth / 2 + 4;
        const m = P.make(THREE, 'person'); m.position.set(px, 0, pz); g.add(m); debug.person = true;
        reach = { ...reach, minX: Math.min(reach.minX, px - 23), maxX: Math.max(reach.maxX, px + 23), minY: 0, maxY: Math.max(reach.maxY, 176) };
        personLabel = { x: px, z: pz };
      }
      // Sun and its shadow frustum follow the furniture (and the person) so the shadow map stays sharp.
      { const cx = (reach.minX + reach.maxX) / 2, cy = (reach.minY + reach.maxY) / 2, half = Math.max(reach.maxX - reach.minX, reach.maxY - reach.minY) / 2 + 60;
        sun.target.position.set(cx, cy, target.gap + s.depth / 2); sun.position.set(cx - 160, cy + 260, target.gap + s.depth / 2 + 360); sun.target.updateMatrixWorld();
        const c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 50; c.far = 1200; c.updateProjectionMatrix(); }
      let lines = state.showSizes ? dimensionLines(box) : [];
      if (state.showSizes && (state.view === 'wall' || personLabel)) { // the furniture is small here: one summary label instead of three crowded ones
        const mid = state.view === 'wall' ? [(box.minX + box.maxX) / 2, box.maxY + 10, box.maxZ] : [(box.minX + box.maxX) / 2, Math.max(box.minY - 7, 3), box.maxZ + 2];
        lines = (state.view === 'wall' ? wallLines({ width: W, height: wall.height }, box) : []).concat([{ key: 'furniture', text: `${fmtCm(s.width).replace(' cm', '')} × ${fmtCm(s.height).replace(' cm', '')} × ${fmtCm(s.depth)}`, a: mid, b: mid, mid, tick: [0, 0, 0], noLine: true }]);
      }
      if (state.showSizes && personLabel) { const mid = [personLabel.x, 183, personLabel.z]; lines.push({ key: 'person', text: '175 cm', a: mid, b: mid, mid, tick: [0, 0, 0], noLine: true }); }
      addLines(lines, g);
      rig.labels = lines.map(l => ({ key: l.key, text: l.text }));
      debug.labels = rig.labels; debug.view = state.view;
      const wallBox = { minX: 0, maxX: W, minY: 0, maxY: wall.height, minZ: 0, maxZ: 0 };
      const focus = state.view === 'wall' ? lineExtents(lines.length ? lines : [], wallBox) : lineExtents(lines, reach);
      resize();
      fitCamera(focus, state.view, state, !!reset);
      request(300);
    }
    function refit() { if (last && !rig.userMoved) { resize(); fitCamera(last.box, last.view, last.state, true); request(300); } }
    function resize() {
      if (!rig.state || !rig.state.visible()) return;
      const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const HM = () => window.HouseModels;
    return { rig, update, resize, refit, request, debug, dispose: () => { if (rig.group) dispose(rig.group); renderer.dispose(); } };
  }
  const api = { ...pure, create };
  root.BookshelfScene = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
