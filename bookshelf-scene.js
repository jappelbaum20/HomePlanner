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
  // Furniture-local point (cm) for a ray hit: x from the left edge, y up from the bottom, z from the front face (upward faces only).
  // A hit on a downward face (board underside) belongs to the bay below that board, so y is nudged below the surface that board carries (thickness + the .6 cm tolerance of fitProp).
  function hitToLocal(point, normalY, f) {
    return { x: point.x - f.offset, y: point.y - f.elev - (normalY < -.5 ? ((f.design && f.design.thickness) || 0) + .65 : 0), ...(normalY > .5 ? { z: f.gap + f.depth - point.z } : {}) };
  }
  const readout = d => `Furniture ${fmtCm(d.width).replace(' cm', '')} × ${fmtCm(d.height).replace(' cm', '')} × ${fmtCm(d.depth)} (W × H × D)`;
  const pure = { FOV, MARGIN, MAX_AZIMUTH, LIMITS, fmtCm, frameDistance, frameBox, clampAzimuth, cameraPosition, sizeStep, applySizeStep, dimensionLines, wallLines, lineExtents, cropViewBox, readout, hitToLocal };

  // ---------- 3D drawing (browser only) ----------
  function create(opts) {
    const { THREE, onPick } = opts; let el = opts.el; // the host re-renders its markup, so update() hands over the current element
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // Phone budget: pixel ratio and shadow map are capped; a weak GPU (small max texture) drops shadows altogether.
    const small = Math.min(window.innerWidth || 1024, window.innerHeight || 1024) < 700 || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const quality = { pixelRatio: Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5), shadowMapSize: small ? 1024 : 2048, shadows: renderer.capabilities.maxTextureSize >= 4096 };
    renderer.setPixelRatio(quality.pixelRatio); renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (quality.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; }
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#E8E9E4');
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7a68, .62));
    // Warm sun from the front left and above, like a window beside the shelf.
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.05); sun.position.set(-60, 320, 420); scene.add(sun, sun.target);
    if (quality.shadows) { sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize); sun.shadow.bias = -.0005; sun.shadow.normalBias = .35; sun.shadow.radius = 4; }
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .85;
    controls.minAzimuthAngle = -rad(MAX_AZIMUTH); controls.maxAzimuthAngle = rad(MAX_AZIMUTH);
    const rig = { renderer, scene, camera, controls, group: null, boards: [], furniture: [], propMeshes: [], frame: null, labels: [], state: null, userMoved: false };
    const shell = { wall: [], skirt: [] }, templates = new Map(), shapes = new Map(), labelTextures = new Map(), instances = new Map();
    let furniture = null, furnitureParts = new Map(), personMesh = null, labelNodes = [], keys = {}, lastSize = {};
    const debug = window.__bsDebug = { frames: 0, labels: [], view: 'close', fit: null, quality, props: 0, person: false, info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }) };
    // Test hook: place the camera at an azimuth/elevation around the current target at the current distance.
    debug.orbit = (az, el = 10) => { const t = controls.target, d = camera.position.distanceTo(t), p = cameraPosition([t.x, t.y, t.z], d, clampAzimuth(az), el); camera.position.set(...p); controls.update(); request(300); };
    // Test hook: client coordinates of a furniture-local point (cm) so a test can click a given compartment.
    debug.screenOf = (x, y, z = 0) => { const f = rig.frame, v = new THREE.Vector3(f.offset + x, f.elev + y, f.gap + f.depth - z).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; };
    debug.realism = () => { const f = rig.furniture, mats = o => [].concat(o.material), wall = shell.wall[0], floor = shell.wall[1], skirt = shell.skirt[0];
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
    renderer.domElement.addEventListener('webglcontextrestored', () => { debug.restored = (debug.restored || 0) + 1; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; request(300); });
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const wallMesh = shell.wall[0];
      const hit = ray.intersectObjects(rig.propMeshes.concat(rig.furniture, wallMesh ? [wallMesh] : []), false)[0];
      if (!onPick) return;
      if (!hit) return onPick({ none: true });
      if (hit.object.userData.propId) return onPick({ propId: hit.object.userData.propId });
      const f = rig.frame, n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      // Furniture-local point (cm): x from the left edge, y up from the bottom, z from the front face; z only for upward faces.
      const local = hitToLocal(hit.point, n ? n.y : 0, f), onWall = hit.object === wallMesh;
      if (onWall && !(local.x >= 0 && local.x <= f.design.width && local.y >= 0 && local.y <= f.design.height)) return onPick({ none: true }); // the bare wall beside the furniture
      onPick({ bay: bayAt(local.y), local, wall: onWall });
    });
    function bayAt(y) { const lv = rig.frame.design.levels; let b = 0; lv.forEach((l, i) => { if (l.y <= y + .01 && i < lv.length - 1) b = i; }); return b; }

    function sprite(text) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), key = `${dpr}:${text}`;
      let cached = labelTextures.get(key);
      if (!cached) {
        const font = '700 42px system-ui, sans-serif', m = document.createElement('canvas').getContext('2d'); m.font = font;
        const cw = Math.max(256, Math.ceil(m.measureText(text).width + 28)), c = document.createElement('canvas'); c.width = cw * dpr; c.height = 64 * dpr;
        const g = c.getContext('2d'); g.scale(dpr, dpr); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
        { const tw = m.measureText(text).width + 26, x0 = cw / 2 - tw / 2, r = 14; g.fillStyle = 'rgba(255,255,255,.94)'; g.beginPath(); g.moveTo(x0 + r, 6); g.arcTo(x0 + tw, 6, x0 + tw, 58, r); g.arcTo(x0 + tw, 58, x0, 58, r); g.arcTo(x0, 58, x0, 6, r); g.arcTo(x0, 6, x0 + tw, 6, r); g.closePath(); g.fill(); }
        g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(text, cw / 2, 33); g.fillStyle = '#1D2B26'; g.fillText(text, cw / 2, 33);
        const tex = new THREE.CanvasTexture(c); tex.keep = true; cached = { tex, cw }; labelTextures.set(key, cached);
      } else { labelTextures.delete(key); labelTextures.set(key, cached); }
      const { tex, cw } = cached;
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
      const s = new THREE.Sprite(mat); const h = .1 * Math.tan(rad(FOV) / 2); s.scale.set(h * cw / 64, h, 1); s.renderOrder = 999; s.raycast = () => {};
      return s;
    }
    function addLines(list, group) {
      const mat = new THREE.LineBasicMaterial({ color: 0x1D2B26, depthTest: false, transparent: true });
      list.forEach(l => {
        const [a, b, t] = [l.a, l.b, l.tick], v = p => new THREE.Vector3(...p), sub = (p, k) => [p[0] - t[0] * k, p[1] - t[1] * k, p[2] - t[2] * k], add = (p, k) => [p[0] + t[0] * k, p[1] + t[1] * k, p[2] + t[2] * k];
        const pts = [a, b, sub(a, 1), add(a, 1), sub(b, 1), add(b, 1)].map(v);
        if (!l.noLine) { const geo = new THREE.BufferGeometry().setFromPoints(pts); geo.setIndex([0, 1, 2, 3, 4, 5]); const line = new THREE.LineSegments(geo, mat); line.renderOrder = 998; group.add(line); }
        const s = sprite(l.text); s.position.set(...l.mid); s.userData.key = l.key; s.userData.text = l.text; group.add(s);
      });
    }
    function dispose(groups) {
      const geometries = new Set(), materials = new Set(), textures = new Set();
      [].concat(groups).forEach(group => group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) [].concat(o.material).forEach(material => {
        materials.add(material); ['map', 'bumpMap'].forEach(key => { if (material[key] && !material[key].keep && o.geometry?.type !== 'PlaneGeometry') textures.add(material[key]); }); }); }));
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
    }
    let last = null;
    function fitCamera(box, view, state, force) {
      last = { box, view, state };
      const aspect = el.clientWidth / Math.max(el.clientHeight, 1), f = frameBox(box, aspect);
      const base = f.distance, pull = state.standalone && aspect > 1.25 ? 1.1 : 1; // wide standalone views are height-limited: leave room for the labels (once, x1.1); room mode keeps the plain framing
      f.distance *= pull;
      const elev = state.target.elev > 0 ? 6 : 10, az = view === 'wall' ? 0 : 22;
      if (!force && rig.userMoved) return;
      controls.target.set(...f.center); controls.minDistance = f.distance * .6; controls.maxDistance = f.distance * 2.5;
      camera.position.set(...cameraPosition(f.center, f.distance, az, elev)); camera.near = Math.max(1, f.distance / 100); camera.far = f.distance * 40; camera.updateProjectionMatrix();
      controls.update(); rig.userMoved = false; debug.fit = { distance: f.distance, base, pull, center: f.center, aspect };
    }
    // state: {design, wall, target, color, view, showSizes, flip, visible()} ; reset re-frames the camera.
    function update(state, reset, element) {
      rig.state = state; if (element) el = element;
      if (!el.contains(renderer.domElement)) el.appendChild(renderer.domElement);
      const s = state.design, wall = state.wall, target = state.target, W = wall.width;
      const offset = wall.flip ? W - target.offset - s.width : target.offset;
      if (!rig.group) { rig.group = new THREE.Group(); scene.add(rig.group); }
      const g = rig.group, HMm = HM(); let moved = false, personLabel = null;
      const remove = nodes => { nodes.forEach(node => g.remove(node)); dispose(nodes); };
      const addBox = (nodes, w, h, d, x, y, z, color, material, cast = false) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material || new THREE.MeshStandardMaterial({ color })); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; g.add(mesh); nodes.push(mesh); };
      const wallKey = JSON.stringify(wall);
      if (keys.wall !== wallKey) {
        remove(shell.wall); shell.wall = [];
        addBox(shell.wall, W, wall.height, 3, W / 2, wall.height / 2, -1.5, null, HMm.wallMaterial(wall.color, 'paint', W, wall.height));
        addBox(shell.wall, W + 50, 2, 190, W / 2, -1, 80, null, HMm.floorMaterial('#CDB28F', 'wood', W + 50, 190));
        wall.openings.forEach(opening => {
          const x = wall.flip ? W - opening.offset - opening.width : opening.offset;
          addBox(shell.wall, opening.width, opening.height, 1, x + opening.width / 2, opening.sill + opening.height / 2, .6, opening.type === 'door' ? '#BFA98C' : '#C3DBE5');
          if (opening.radiator) addBox(shell.wall, opening.width * .9, Math.max(1, opening.sill - 22), 12, x + opening.width / 2, 10 + (opening.sill - 22) / 2, 6, '#E8E9E5');
        });
        keys.wall = wallKey; moved = true;
      }
      const skirtKey = JSON.stringify([W, wall.flip, wall.openings, target.elev < 10 && target.gap < 2 ? [offset, s.width] : null]);
      if (keys.skirt !== skirtKey) {
        remove(shell.skirt); shell.skirt = [];
        const doors = wall.openings.filter(opening => opening.type === 'door').map(opening => { const x = wall.flip ? W - opening.offset - opening.width : opening.offset; return [x, x + opening.width]; }).sort((left, right) => left[0] - right[0]);
        if (target.elev < 10 && target.gap < 2) { doors.push([offset - .2, offset + s.width + .2]); doors.sort((left, right) => left[0] - right[0]); }
        let start = 0; const material = HMm.mat('#F3F1EA', { rough: .55 });
        [...doors, [W, W]].forEach(([left, right]) => { if (left - start > 1) addBox(shell.skirt, left - start, 9, 1.5, (start + left) / 2, 4.5, .75, null, material, true); start = Math.max(start, right); });
        if (!shell.skirt.length) material.dispose();
        keys.skirt = skirtKey; moved = true;
      }
      const designKey = JSON.stringify(s), appearanceKey = JSON.stringify([state.color, s.width, s.depth, s.template, target.elev > 0]);
      if (keys.appearance !== appearanceKey) {
        if (furniture) { g.remove(furniture); dispose(furniture); }
        furniture = HMm.buildItem({ type: 'shelf', w: s.width, d: s.depth, h: s.height, color: state.color, shelfDesign: s, elev: target.elev }, { evening: false });
        g.add(furniture); furnitureParts = new Map(); keys.design = null; keys.position = null; keys.appearance = appearanceKey; moved = true;
      }
      if (keys.design !== designKey) {
        const parts = (Bookshelf.visualBoards || Bookshelf.boards)(s).filter(board => board.w > 0 && board.h > 0);
        const built = furniture.children.filter(child => child.isMesh && child.geometry?.type !== 'PlaneGeometry');
        if (!furnitureParts.size) parts.forEach((board, index) => furnitureParts.set(board.id, { board, mesh: built[index] }));
        const next = new Map();
        rig.furniture = parts.map(board => {
          let entry = furnitureParts.get(board.id), mesh = entry && entry.mesh;
          const walnut = s.template === 'saetter3', depth = board.renderDepth ?? board.depth;
          const geometry = () => walnut ? HMm.walnutGeometry(board.w, board.h, depth, board.kind === 'Back') : new THREE.BoxGeometry(Math.max(board.w, .2), Math.max(board.h, .2), Math.max(depth, .2));
          if (!mesh) { mesh = new THREE.Mesh(geometry(), walnut ? HMm.walnut(state.color) : HMm.wood(state.color, board.w, board.h)); mesh.castShadow = true; furniture.add(mesh); }
          else if (entry.board.w !== board.w || entry.board.h !== board.h || (entry.board.renderDepth ?? entry.board.depth) !== depth) {
            mesh.geometry.dispose(); mesh.geometry = geometry();
            if (!walnut && mesh.material.map) mesh.material.map.repeat.set(mesh.material.map.repeat.x * board.w / entry.board.w, mesh.material.map.repeat.y * board.h / entry.board.h);
          }
          mesh.position.set(board.x + board.w / 2 - s.width / 2, board.y + board.h / 2, board.z ?? 0);
          mesh.receiveShadow = !(board.kind === 'Back' && s.template === 'saetter3');
          if (board.kind === 'Back') delete mesh.userData.bay; else mesh.userData.bay = Number(board.id.slice(1).split('.')[0]) - 1;
          next.set(board.id, { board, mesh }); return mesh;
        });
        furnitureParts.forEach((entry, id) => { if (!next.has(id)) { furniture.remove(entry.mesh); dispose(entry.mesh); } });
        furnitureParts = next; rig.boards = rig.furniture.filter(mesh => Number.isInteger(mesh.userData.bay)); keys.design = designKey; moved = true;
      }
      const positionKey = JSON.stringify([offset, target.elev, target.gap, s.width, s.depth]);
      if (keys.position !== positionKey) { furniture.position.set(offset + s.width / 2, target.elev, target.gap + s.depth / 2); keys.position = positionKey; moved = true; }
      rig.frame = { offset, elev: target.elev, gap: target.gap, depth: s.depth, design: s };
      const box = { minX: offset, maxX: offset + s.width, minY: target.elev, maxY: target.elev + s.height, minZ: target.gap, maxZ: target.gap + s.depth };
      rig.propMeshes = []; const sizes = []; debug.propBounds = sizes;
      const P = window.BookshelfProps, placed = state.props || [];
      const front = target.gap + s.depth;
      const template = (kind, rot, color) => {
        const key = JSON.stringify([kind, rot || 0, kind === 'book' ? color : null]);
        if (!templates.has(key)) {
          const model = P.make(THREE, kind, { rot, color }), shapeKey = JSON.stringify([kind, rot || 0]), geometries = [];
          model.traverse(mesh => { if (mesh.geometry) geometries.push(mesh.geometry); });
          if (shapes.has(shapeKey)) {
            let index = 0; const shared = shapes.get(shapeKey);
            model.traverse(mesh => { if (mesh.geometry) { mesh.geometry.dispose(); mesh.geometry = shared[index++]; } });
          } else shapes.set(shapeKey, geometries);
          templates.set(key, model);
        }
        return { key, mesh: templates.get(key).clone(true) };
      };
      const ids = new Set(placed.map(prop => prop.id));
      instances.forEach((entry, id) => { if (!ids.has(id)) { g.remove(entry.mesh); instances.delete(id); moved = true; } });
      if (P) placed.forEach(prop => {
        const modelKey = JSON.stringify([prop.kind, prop.rot || 0, prop.kind === 'book' ? prop.color : null]);
        let entry = instances.get(prop.id);
        if (!entry || entry.key !== modelKey) {
          if (entry) g.remove(entry.mesh);
          entry = template(prop.kind, prop.rot, prop.color); entry.mesh.traverse(mesh => { if (mesh.isMesh) mesh.userData.propId = prop.id; });
          instances.set(prop.id, entry); g.add(entry.mesh); moved = true;
        }
        const propPosition = JSON.stringify([offset + prop.x, target.elev + prop.y, front - prop.z, target.elev]);
        if (entry.position !== propPosition) {
          entry.mesh.position.set(offset + prop.x, target.elev + prop.y, front - prop.z); entry.mesh.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(entry.mesh), size = bounds.getSize(new THREE.Vector3());
          entry.bounds = { kind: prop.kind, id: prop.id, w: Math.round(size.x * 100) / 100, h: Math.round(size.y * 100) / 100, d: Math.round(size.z * 100) / 100, baseY: Math.round((bounds.min.y - target.elev) * 100) / 100 };
          entry.position = propPosition; moved = true;
        }
        entry.mesh.traverse(mesh => { if (mesh.isMesh) rig.propMeshes.push(mesh); }); sizes.push(entry.bounds);
      });
      debug.props = placed.length; debug.person = false;
      let reach = { ...box };
      placed.forEach(p => { reach.maxY = Math.max(reach.maxY, target.elev + p.y + p.h); reach.minX = Math.min(reach.minX, offset + p.x - p.w / 2); reach.maxX = Math.max(reach.maxX, offset + p.x + p.w / 2); });
      if (P && state.person) {
        const room = W - (offset + s.width), px = room >= 50 ? offset + s.width + 30 : offset - 30, pz = target.gap + s.depth / 2 + 4;
        if (!personMesh) { personMesh = template('person').mesh; g.add(personMesh); moved = true; }
        if (personMesh.position.x !== px || personMesh.position.z !== pz) { personMesh.position.set(px, 0, pz); moved = true; }
        debug.person = true;
        reach = { ...reach, minX: Math.min(reach.minX, px - 23), maxX: Math.max(reach.maxX, px + 23), minY: 0, maxY: Math.max(reach.maxY, 176) };
        personLabel = { x: px, z: pz };
      } else if (personMesh) { g.remove(personMesh); personMesh = null; moved = true; }
      const shadowKey = JSON.stringify([reach, target.gap, s.depth]);
      if (keys.shadow !== shadowKey) { const cx = (reach.minX + reach.maxX) / 2, cy = (reach.minY + reach.maxY) / 2, half = Math.max(reach.maxX - reach.minX, reach.maxY - reach.minY) / 2 + 60;
        sun.target.position.set(cx, cy, target.gap + s.depth / 2); sun.position.set(cx - 60, cy + 320, target.gap + s.depth / 2 + 420); sun.target.updateMatrixWorld();
        const c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 50; c.far = 1200; c.updateProjectionMatrix(); keys.shadow = shadowKey; moved = true; }
      if (moved && quality.shadows) renderer.shadowMap.needsUpdate = true;
      let lines = state.showSizes ? dimensionLines(box) : [];
      if (state.showSizes && (state.view === 'wall' || personLabel)) { // the furniture is small here: one summary label instead of three crowded ones
        const mid = state.view === 'wall' ? [(box.minX + box.maxX) / 2, box.maxY + 10, box.maxZ] : [(box.minX + box.maxX) / 2, Math.max(box.minY - 7, 3), box.maxZ + 2];
        lines = (state.view === 'wall' ? wallLines({ width: W, height: wall.height }, box) : []).concat([{ key: 'furniture', text: `${fmtCm(s.width).replace(' cm', '')} × ${fmtCm(s.height).replace(' cm', '')} × ${fmtCm(s.depth)}`, a: mid, b: mid, mid, tick: [0, 0, 0], noLine: true }]);
      }
      if (state.showSizes && personLabel) { const mid = [personLabel.x, 183, personLabel.z]; lines.push({ key: 'person', text: '175 cm', a: mid, b: mid, mid, tick: [0, 0, 0], noLine: true }); }
      const labelKey = JSON.stringify(lines);
      if (keys.labels !== labelKey) {
        remove(labelNodes); const start = g.children.length; addLines(lines, g); labelNodes = g.children.slice(start);
        while (labelTextures.size > 32) { const oldest = labelTextures.keys().next().value; labelTextures.get(oldest).tex.dispose(); labelTextures.delete(oldest); }
        keys.labels = labelKey;
      }
      if (!rig.comparisonLayer) {
        rig.comparisonLayer = document.createElement('div');
        rig.comparisonLayer.className = 'bs-comparison-labels';
        controls.addEventListener('change', () => rig.layoutComparisonLabels?.());
      }
      const reparentedLabels = !el.contains(rig.comparisonLayer);
      if (reparentedLabels) el.appendChild(rig.comparisonLayer);
      const comparison = [], addLabel = (key, text, point) => comparison.push({ key, text, point });
      if (state.showSizes && P) {
        placed.forEach(p => addLabel(`item-${p.id}`, `${P.PROPS[p.kind].name} · ${fmtCm(p.h)} high`, [offset + p.x, target.elev + p.y + p.h, front - p.z]));
        if (s.template === 'saetter3') {
          const sf = P.surfaces(s).filter(x => Number.isFinite(x.ceiling)).sort((a, b) => b.level - a.level || b.x1 - a.x1)[0];
          if (sf) {
            const near = n => Math.abs(n - Math.round(n)) < .11 ? Math.round(n) : round1(n);
            addLabel('compartment', `≈ ${near(sf.x1 - sf.x0)} × ${near(sf.ceiling - sf.y)} cm inside`, [offset + (sf.x0 + sf.x1) / 2, target.elev + (sf.y + sf.ceiling) / 2, front]);
          }
        }
      }
      const comparisonKey = JSON.stringify([state.view, comparison]), comparisonChanged = keys.comparison !== comparisonKey;
      if (comparisonChanged) {
        rig.comparisonLayer.replaceChildren();
        const labels = comparison.map(({ key, text, point }) => {
          const node = document.createElement('span'); node.textContent = text; node.dataset.bsLabel = key;
          rig.comparisonLayer.appendChild(node); return { node, point };
        });
        rig.layoutComparisonLabels = () => {
          const used = [], width = el.clientWidth, height = el.clientHeight;
          labels.forEach(({ node, point }) => {
            const projected = new THREE.Vector3(...point).project(camera), x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
            const w = node.offsetWidth, h = node.offsetHeight, choices = [[x + 6, y - h - 4], [x - w - 6, y - h - 4], [x + 6, y + 5], [x - w - 6, y + 5]];
            for (let step = 1; step <= 8; step++) choices.push([x + 6, y - h - 4 - step * (h + 2)], [x - w - 6, y - h - 4 - step * (h + 2)], [x + 6, y + 5 + step * (h + 2)], [x - w - 6, y + 5 + step * (h + 2)]);
            const candidates = choices.map(([left, top]) => ({ left: clamp(left, 2, Math.max(2, width - w - 2)), top: clamp(top, 2, Math.max(2, height - h - 2)), w, h }));
            const overlap = r => used.reduce((sum, o) => sum + Math.max(0, Math.min(r.left + r.w, o.left + o.w) - Math.max(r.left, o.left)) * Math.max(0, Math.min(r.top + r.h, o.top + o.h) - Math.max(r.top, o.top)), 0);
            const best = candidates.reduce((a, b) => overlap(b) < overlap(a) ? b : a); used.push(best);
            node.style.left = `${best.left}px`; node.style.top = `${best.top}px`;
          });
        };
        keys.comparison = comparisonKey;
      }
      rig.labels = lines.map(l => ({ key: l.key, text: l.text })).concat(comparison.map(({ key, text }) => ({ key, text })));
      debug.labels = rig.labels; debug.view = state.view;
      const wallBox = { minX: 0, maxX: W, minY: 0, maxY: wall.height, minZ: 0, maxZ: 0 };
      const focus = state.view === 'wall' ? lineExtents(lines.length ? lines : [], wallBox) : lineExtents(lines, reach);
      const resized = resize();
      const focusKey = JSON.stringify([focus, state.view, state.standalone, target.elev]);
      if (reset || resized || keys.focus !== focusKey) fitCamera(focus, state.view, state, !!reset);
      else last = { box: focus, view: state.view, state };
      keys.focus = focusKey;
      if (comparisonChanged || reparentedLabels || resized) requestAnimationFrame(() => rig.layoutComparisonLabels?.());
      request(300);
    }
    function refit() { if (last && !rig.userMoved) { resize(); fitCamera(last.box, last.view, last.state, true); request(300); } }
    function resize() {
      if (!rig.state || !rig.state.visible()) return false;
      const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return false;
      if (lastSize.w !== w || lastSize.h !== h) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); lastSize = { w, h }; return true; }
      return false;
    }
    const HM = () => window.HouseModels;
    return { rig, update, resize, refit, request, debug, dispose: () => { if (raf) cancelAnimationFrame(raf); raf = 0; rig.state = null; const groups = [...templates.values()]; if (rig.group) { scene.remove(rig.group); groups.push(rig.group); } dispose(groups); labelTextures.forEach(entry => entry.tex.dispose()); controls.dispose(); renderer.dispose(); } };
  }
  const api = { ...pure, create };
  root.BookshelfScene = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
