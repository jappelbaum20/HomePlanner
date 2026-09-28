// 3D look for the planner: procedural textures, materials and furniture models.
// Everything is built from the item's box (w x d x h, cm) so any size still fits the plan footprint.
// Local space: origin at the center of the footprint on the floor, +y up, back of the piece at -z.
(() => {
  'use strict';
  const HM = {};
  window.HouseModels = HM;
  let T3; // THREE, set in init
  const texCache = new Map();

  HM.init = (THREE) => { T3 = THREE; };

  // ---------- Colors and materials ----------
  const lin = (hex) => new T3.Color(hex).convertSRGBToLinear();
  const shade = (hex, f) => {
    const c = new T3.Color(hex); const hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f))); return '#' + c.getHexString();
  };
  function mat(hex, o = {}) {
    const m = new T3.MeshStandardMaterial({ color: lin(hex), roughness: o.rough != null ? o.rough : 0.8, metalness: o.metal || 0 });
    m.envMapIntensity = o.metal ? 0.9 : 0.55;
    if (o.map) { m.map = o.map; }
    if (o.bump) { m.bumpMap = o.bump; m.bumpScale = o.bumpScale || 0.4; }
    if (o.transparent) { m.transparent = true; m.opacity = o.opacity; }
    if (o.emissive) { m.emissive = lin(o.emissive); m.emissiveIntensity = o.emissiveIntensity || 1; }
    if (o.side) m.side = o.side;
    return m;
  }
  HM.mat = mat;

  // ---------- Procedural textures (grayscale, tinted by material color) ----------
  function canvasTex(key, size, draw, repeatCm) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new T3.CanvasTexture(c);
    t.wrapS = t.wrapT = T3.RepeatWrapping; t.encoding = T3.sRGBEncoding; t.anisotropy = 8;
    t.cmSize = repeatCm; texCache.set(key, t); return t;
  }
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function noise(g, s, n, a, lo, hi) {
    for (let i = 0; i < n; i++) { const v = Math.floor(lo + rnd() * (hi - lo)); g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2); }
  }
  const TEX = {
    // 240 cm square: 12 rows of 20 cm planks, staggered lengths
    wood: () => canvasTex('wood', 1024, (g, s) => {
      seed = 7; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      const rows = 12, rh = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * s * 0.5;
        while (x < s) {
          const len = s * (0.35 + rnd() * 0.3), v = 215 + Math.floor(rnd() * 40);
          g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, r * rh, len, rh);
          for (let k = 0; k < 14; k++) { // grain
            const yy = r * rh + rnd() * rh, gv = v - 12 - rnd() * 22; g.strokeStyle = `rgba(${gv},${gv},${gv},.45)`; g.lineWidth = 0.6 + rnd() * 1.4;
            g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + (rnd() - 0.5) * 6, x + len * 0.7, yy + (rnd() - 0.5) * 6, x + len, yy + (rnd() - 0.5) * 4); g.stroke();
          }
          g.fillStyle = 'rgba(90,90,90,.55)'; g.fillRect(x, r * rh, 2, rh); // butt joint
          x += len;
        }
        g.fillStyle = 'rgba(80,80,80,.6)'; g.fillRect(0, r * rh, s, 2); // long joint
      }
    }, 240),
    // 120 cm square: 2 x 2 tiles of 60 cm
    tile: () => canvasTex('tile', 512, (g, s) => {
      seed = 11; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 2, ts = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 238 + Math.floor(rnd() * 17); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * ts, j * ts, ts, ts); }
      noise(g, s, 4000, 0.25, 200, 255);
      g.fillStyle = 'rgb(150,150,150)'; for (let i = 0; i < n; i++) { g.fillRect(i * ts, 0, 3, s); g.fillRect(0, i * ts, s, 3); }
    }, 120),
    concrete: () => canvasTex('concrete', 512, (g, s) => {
      seed = 5; g.fillStyle = '#eee'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) { const v = 215 + rnd() * 40, r = 20 + rnd() * 90; const gr = g.createRadialGradient(rnd() * s, rnd() * s, 0, rnd() * s, rnd() * s, r); gr.addColorStop(0, `rgba(${v},${v},${v},.35)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }
      noise(g, s, 9000, 0.35, 170, 255);
    }, 200),
    terrazzo: () => canvasTex('terrazzo', 512, (g, s) => {
      seed = 9; g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 700; i++) { const v = 120 + rnd() * 130, r = 1 + rnd() * 5; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(rnd() * s, rnd() * s, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill(); }
    }, 120),
    carpet: () => canvasTex('carpet', 256, (g, s) => { seed = 3; g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s); noise(g, s, 14000, 0.5, 170, 255); }, 40),
    fabric: () => canvasTex('fabric', 256, (g, s) => {
      seed = 13; g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 2) { const v = 225 + rnd() * 30; g.fillStyle = `rgba(${v},${v},${v},.8)`; g.fillRect(0, y, s, 1); }
      for (let x = 0; x < s; x += 2) { const v = 215 + rnd() * 30; g.fillStyle = `rgba(${v},${v},${v},.45)`; g.fillRect(x, 0, 1, s); }
      noise(g, s, 3000, 0.3, 180, 255);
    }, 25),
    // corduroy: soft ribs about 4 mm apart
    cord: () => canvasTex('cord', 256, (g, s) => {
      seed = 53; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 4) { const gr = g.createLinearGradient(x, 0, x + 4, 0); gr.addColorStop(0, 'rgb(200,200,200)'); gr.addColorStop(0.5, 'rgb(255,255,255)'); gr.addColorStop(1, 'rgb(205,205,205)'); g.fillStyle = gr; g.fillRect(x, 0, 4, s); }
      noise(g, s, 2500, 0.2, 190, 255);
    }, 12),
    grain: () => canvasTex('grain', 512, (g, s) => {
      seed = 17; g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 90; k++) { const y = rnd() * s, v = 215 + rnd() * 30; g.strokeStyle = `rgba(${v},${v},${v},.5)`; g.lineWidth = 0.5 + rnd() * 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x / 60 + k) * 3 + (rnd() - 0.5) * 2); g.stroke(); }
    }, 80),
    // 140 cm square: narrow oak strips (7 cm) in staggered lengths, like Swiss strip parquet
    parquet: () => canvasTex('parquet', 1024, (g, s) => {
      seed = 23; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      const rows = 20, rh = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * s * 0.4;
        while (x < s) {
          const len = s * (0.2 + rnd() * 0.3), v = 205 + Math.floor(rnd() * 50);
          g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, r * rh, len, rh);
          for (let k = 0; k < 5; k++) { const yy = r * rh + rnd() * rh, gv = v - 10 - rnd() * 18; g.strokeStyle = `rgba(${gv},${gv},${gv},.4)`; g.lineWidth = 0.6 + rnd(); g.beginPath(); g.moveTo(x, yy); g.lineTo(x + len, yy + (rnd() - 0.5) * 3); g.stroke(); }
          g.fillStyle = 'rgba(110,110,110,.45)'; g.fillRect(x, r * rh, 1.5, rh);
          x += len;
        }
        g.fillStyle = 'rgba(110,110,110,.45)'; g.fillRect(0, r * rh, s, 1.5);
      }
    }, 140),
    // 120 cm square: two 60 x 120 slabs with soft grey veins
    marble: () => canvasTex('marble', 1024, (g, s) => {
      seed = 29; g.fillStyle = '#fbfbfa'; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 16; k++) {
        let x = rnd() * s, y = rnd() * s; const a = rnd() * Math.PI, v = 120 + rnd() * 80;
        g.strokeStyle = `rgba(${v},${v - 5},${v - 12},${0.25 + rnd() * 0.35})`; g.lineWidth = 0.6 + rnd() * 2.2; g.beginPath(); g.moveTo(x, y);
        for (let i = 0; i < 26; i++) { x += Math.cos(a) * 22 + (rnd() - 0.5) * 26; y += Math.sin(a) * 22 + (rnd() - 0.5) * 26; g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = 'rgba(170,170,170,.8)'; g.fillRect(s / 2, 0, 2, s); g.fillRect(0, 0, s, 2);
    }, 120),
    // 120 cm square: 60 x 60 grey stone look with mottling
    stone: () => canvasTex('stone', 512, (g, s) => {
      seed = 31; g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) { const v = 215 + rnd() * 40, r = 40 + rnd() * 120; const x = rnd() * s, y = rnd() * s, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${v},${v},${v},.18)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }
      noise(g, s, 16000, 0.18, 185, 255);
      g.fillStyle = 'rgb(160,160,160)'; g.fillRect(s / 2, 0, 2, s); g.fillRect(0, s / 2, s, 2); g.fillRect(0, 0, 2, s); g.fillRect(0, 0, s, 2);
    }, 120),
    // wall tiles: 30 x 60 cm, landscape
    walltile: () => canvasTex('walltile', 512, (g, s) => {
      seed = 37; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const v = 246 + Math.floor(rnd() * 9); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * s / 2, j * s / 4, s / 2, s / 4); }
      g.fillStyle = 'rgb(205,205,205)'; for (let i = 0; i <= 2; i++) g.fillRect(i * s / 2 - 1, 0, 2, s); for (let j = 0; j <= 4; j++) g.fillRect(0, j * s / 4 - 1, s, 2);
    }, 120),
    // vertical board panelling (Täfer): 10 cm boards with a shadow groove
    panelling: () => canvasTex('panelling', 512, (g, s) => {
      seed = 41; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 10, bw = s / n;
      for (let i = 0; i < n; i++) { const v = 245 + Math.floor(rnd() * 10); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * bw, 0, bw, s); g.fillStyle = 'rgba(150,150,150,.8)'; g.fillRect(i * bw, 0, 2.5, s); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(i * bw + 2.5, 0, 1.5, s); }
    }, 100),
    // oak 3D triangle panels: 20 cm triangles with alternating light and shade
    oakpanels: () => canvasTex('oakpanels', 512, (g, s) => {
      seed = 43; g.fillStyle = '#ddd'; g.fillRect(0, 0, s, s); const n = 6, t = s / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i * t, y = j * t, tri = (pts, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.lineTo(...pts[2]); g.closePath(); g.fill(); };
        const up = (i + j) % 2 === 0;
        tri(up ? [[x, y + t], [x + t, y + t], [x + t / 2, y]] : [[x, y], [x + t, y], [x + t / 2, y + t]], 200 + rnd() * 55);
        tri(up ? [[x, y], [x + t / 2, y], [x, y + t]] : [[x, y + t], [x + t / 2, y + t], [x, y]], 170 + rnd() * 50);
        tri(up ? [[x + t, y], [x + t / 2, y], [x + t, y + t]] : [[x + t, y + t], [x + t / 2, y + t], [x + t, y]], 185 + rnd() * 50);
      }
      g.globalAlpha = 0.25; for (let k = 0; k < 400; k++) { const v = 120 + rnd() * 80; g.strokeStyle = `rgb(${v},${v},${v})`; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.lineTo(x + 20, y + (rnd() - 0.5) * 3); g.stroke(); } g.globalAlpha = 1;
    }, 120),
    // dark granite worktop: near-black with warm and pale flecks
    granite: () => canvasTex('granite', 512, (g, s) => {
      seed = 47; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) { const t = rnd(), v = t < 0.6 ? 60 + rnd() * 50 : t < 0.9 ? 150 + rnd() * 60 : 235; g.fillStyle = `rgb(${v},${Math.max(0, v - 8)},${Math.max(0, v - 16)})`; const r = 1 + rnd() * 4; g.fillRect(rnd() * s, rnd() * s, r, r * (0.5 + rnd())); }
    }, 60),
    plaster: () => canvasTex('plaster', 256, (g, s) => { seed = 21; g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, s, s); noise(g, s, 5000, 0.18, 225, 255); }, 100)
  };
  // Clone a cached texture with a repeat that keeps its real-world scale on a w x h (cm) face
  function texFor(kind, w, h) { const b = TEX[kind](), t = b.clone(); t.needsUpdate = true; t.repeat.set(w / b.cmSize, h / b.cmSize); return t; }

  // ---------- Floors and walls ----------
  HM.floorMaterial = (hex, finish, W, L) => {
    const rough = { parquet: 0.45, wood: 0.55, marble: 0.08, stone: 0.4, tile: 0.3, concrete: 0.75, terrazzo: 0.35, carpet: 1, plain: 0.7 }[finish] || 0.6;
    const o = { rough };
    if (TEX[finish]) { o.map = texFor(finish, W, L); if (finish !== 'marble') { o.bump = o.map; o.bumpScale = finish === 'carpet' ? 0.6 : 0.25; } }
    const m = mat(hex, o); if (finish === 'marble') m.envMapIntensity = 1; return m;
  };
  // Wall finishes: paint, panelling (Täfer), oak 3D panels, marble, tiles. The paint color tints all of them except oak.
  HM.wallMaterial = (hex, finish, len, h) => {
    const f = { paint: ['plaster', 0.92], panelling: ['panelling', 0.6], oakpanels: ['oakpanels', 0.55], marble: ['marble', 0.1], tiles: ['walltile', 0.12] }[finish] || ['plaster', 0.92];
    const o = { rough: f[1], map: texFor(f[0], len, h), transparent: true, opacity: 1 };
    if (finish === 'panelling' || finish === 'oakpanels') { o.bump = o.map; o.bumpScale = finish === 'oakpanels' ? 1.2 : 0.5; }
    const m = mat(finish === 'oakpanels' ? '#C9A06A' : hex, o); if (finish === 'marble' || finish === 'tiles') m.envMapIntensity = 1; return m;
  };
  // Panel radiator (white, horizontal ribs), local: centered, on the floor, depth along z
  HM.radiator = (w, h, y0) => {
    const g = new T3.Group(), m = mat('#F4F4F1', { rough: 0.35 });
    const n = Math.max(3, Math.round(h / 7));
    for (let i = 0; i < n; i++) part(g, m, w, h / n - 1.2, 7, 0, y0 + (i + 0.5) * h / n, 0, 0.8);
    part(g, m, 3, h + 4, 3, w / 2 - 6, y0 + h / 2, 3, 1); // valve
    for (const x of [-w / 2 + 10, w / 2 - 10]) part(g, m, 2, y0 + 4, 2, x, (y0 + 4) / 2, -1);
    return g;
  };

  // ---------- Geometry helpers ----------
  const GEO = {
    box(w, h, d, r) {
      r = Math.min(r || 0, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
      if (r > 0.4 && T3.RoundedBoxGeometry) return new T3.RoundedBoxGeometry(w, h, d, 3, r);
      return new T3.BoxGeometry(w, h, d);
    }
  };
  // Box with UVs scaled to real-world cm so textures keep their size
  function part(g, m, w, h, d, x, y, z, r) {
    const geo = GEO.box(Math.max(w, 0.2), Math.max(h, 0.2), Math.max(d, 0.2), r);
    const mesh = new T3.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  function cyl(g, m, rt, rb, h, x, y, z, seg) {
    const mesh = new T3.Mesh(new T3.CylinderGeometry(rt, rb, h, seg || 32), m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  function sphere(g, m, r, x, y, z, sy) {
    const mesh = new T3.Mesh(new T3.SphereGeometry(r, 24, 16), m); mesh.position.set(x, y, z); if (sy) mesh.scale.y = sy; mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  // four legs inset from the corners
  function legs(g, m, w, d, h, inset, t, round) {
    const xs = w / 2 - inset, zs = d / 2 - inset;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (round) cyl(g, m, t / 2, t / 2.6, h, sx * xs, h / 2, sz * zs, 12); else part(g, m, t, h, t, sx * xs, h / 2, sz * zs);
    }
  }
  const fabric = (hex, w, h) => mat(hex, { rough: 0.95, map: texFor('fabric', w, h), bump: texFor('fabric', w, h), bumpScale: 0.35 });
  const cord = (hex, w, h) => { const m = mat(hex, { rough: 0.85, map: texFor('cord', w, h), bump: texFor('cord', w, h), bumpScale: 0.6 }); m.envMapIntensity = 0.35; return m; };
  const wood = (hex, w, h) => mat(hex, { rough: 0.55, map: texFor('grain', w, h) });
  const METAL_DARK = () => mat('#2A2C2E', { rough: 0.35, metal: 0.8 });
  const METAL_BRASS = () => mat('#B89559', { rough: 0.3, metal: 0.9 });
  const CERAMIC = () => mat('#F7F7F4', { rough: 0.12 });

  // ---------- Furniture ----------
  const B = {};
  B.sofa = (g, w, d, h, c) => {
    const f = fabric(c, w, d), fd = fabric(shade(c, 0.88), w, d), legM = wood('#3B2F26', 10, 10);
    const legH = Math.min(12, h * 0.14), arm = Math.min(22, w * 0.14), backT = Math.min(22, d * 0.24);
    const seatH = Math.max(h * 0.5, legH + 20), baseH = seatH - legH - 12, armH = Math.min(h * 0.75, seatH + 20);
    legs(g, legM, w, d, legH, 8, 5, true);
    part(g, fd, w, baseH, d, 0, legH + baseH / 2, 0, 3);
    part(g, fd, arm, armH - legH, d, -w / 2 + arm / 2, legH + (armH - legH) / 2, 0, 5);
    part(g, fd, arm, armH - legH, d, w / 2 - arm / 2, legH + (armH - legH) / 2, 0, 5);
    part(g, fd, w - 2 * arm, h - legH - baseH, backT, 0, legH + baseH + (h - legH - baseH) / 2, -d / 2 + backT / 2, 5);
    const inner = w - 2 * arm, n = inner > 150 ? 3 : inner > 90 ? 2 : 1, cw = inner / n, sd = d - backT;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      part(g, f, cw - 1.5, 12, sd - 2, x, legH + baseH + 6, -d / 2 + backT + sd / 2, 5); // seat cushion
      const bh = Math.min(h - seatH - 2, 45);
      if (bh > 8) { const m = part(g, f, cw - 3, bh, 16, x, seatH + bh / 2, -d / 2 + backT + 7, 7); m.rotation.x = -0.12; }
    }
  };
  B.armchair = (g, w, d, h, c) => B.sofa(g, w, d, h, c);
  // L-shaped sofa, low on small feet: main seat along the back, chaise forward on one side (+x = right seen from the front)
  B.cornersofa = (g, w, d, h, c, it) => {
    const f = cord(c, w, d), fd = cord(shade(c, 0.9), w, d), legM = mat('#1E1E1E', { rough: 0.6 });
    const right = !it || it.side !== 'left', sx = right ? 1 : -1;
    const legH = 3, backT = Math.min(22, d * 0.14), md = Math.min(d, Math.max(backT + 60, d * 0.55)), cw = Math.min(w * 0.4, 105), arm = Math.min(22, w * 0.08);
    const seatH = Math.max(40, h * 0.47), baseH = seatH - legH - 14;
    const z0 = -d / 2, chaiseX = sx * (w / 2 - cw / 2), mainW = w - cw; // main section excludes the chaise column
    const mainX = -sx * (cw / 2); // centre of the non-chaise part
    for (const [x, z] of [[-w / 2 + 6, z0 + 6], [w / 2 - 6, z0 + 6], [-sx * (w / 2 - 6), z0 + md - 6], [sx * (w / 2 - 6), d / 2 - 6], [sx * (w / 2 - cw + 6), d / 2 - 6]]) part(g, legM, 4, legH, 4, x, legH / 2, z, 1);
    // bases
    part(g, fd, mainW, baseH, md, mainX, legH + baseH / 2, z0 + md / 2, 3);
    part(g, fd, cw, baseH, d, chaiseX, legH + baseH / 2, 0, 3);
    // back along the full width, arm on the non-chaise end, low arm on the chaise end
    part(g, fd, w, h - legH, backT, 0, legH + (h - legH) / 2, z0 + backT / 2, 6);
    part(g, fd, arm, seatH + 16 - legH, md, -sx * (w / 2 - arm / 2), legH + (seatH + 16 - legH) / 2, z0 + md / 2, 6);
    // seat cushions: main (split in two or three) and the chaise
    const inner = mainW - arm, n = inner > 150 ? 3 : 2, cwid = inner / n;
    for (let i = 0; i < n; i++) {
      const x = -sx * (w / 2 - arm) + sx * cwid * (i + 0.5);
      part(g, f, cwid - 1.5, 14, md - backT - 2, x, seatH - 7, z0 + backT + (md - backT) / 2, 6);
      const bh = Math.min(h - seatH + 6, 48); const m = part(g, f, cwid - 3, bh, 18, x, seatH + bh / 2 - 2, z0 + backT + 8, 8); m.rotation.x = -0.14;
    }
    part(g, f, cw - 2, 14, d - backT - 2, chaiseX, seatH - 7, z0 + backT + (d - backT) / 2, 6);
    const bh = Math.min(h - seatH + 6, 48); const cb = part(g, f, cw - 4, bh, 18, chaiseX, seatH + bh / 2 - 2, z0 + backT + 8, 8); cb.rotation.x = -0.14;
    // two scatter cushions
    for (const k of [0, 1]) { const m = part(g, fabric(shade(c, 1.08), 45, 45), 42, 42, 12, sx * (w / 2 - cw - 30 - k * 46), seatH + 20, z0 + backT + 20, 9); m.rotation.x = -0.3; m.rotation.z = (k ? -1 : 1) * 0.08; }
  };
  B.chair = (g, w, d, h, c) => {
    const seatH = Math.min(46, h * 0.5), t = 3, woodM = wood(c, w, d);
    const m = h > 100 ? METAL_DARK() : woodM;
    if (h > 100) { // office chair
      cyl(g, m, 3, 3, seatH - 10, 0, (seatH - 10) / 2 + 4, 0, 12);
      for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5, s = part(g, m, 3, 3, w / 2, Math.sin(a) * w / 4, 4, Math.cos(a) * w / 4); s.rotation.y = a; }
      part(g, fabric(c, w, d), w * 0.9, 8, d * 0.85, 0, seatH, 0, 3);
      part(g, fabric(c, w, h), w * 0.85, h - seatH - 12, 7, 0, seatH + (h - seatH) / 2 + 2, -d / 2 + 6, 3);
      return;
    }
    legs(g, m, w, d, seatH - t, 3, t, false);
    part(g, woodM, w, t, d, 0, seatH - t / 2, 0, 1);
    part(g, woodM, t, h - seatH, t, -w / 2 + 3, seatH + (h - seatH) / 2, -d / 2 + 3);
    part(g, woodM, t, h - seatH, t, w / 2 - 3, seatH + (h - seatH) / 2, -d / 2 + 3);
    part(g, woodM, w - 4, Math.min(22, (h - seatH) * 0.5), t, 0, h - Math.min(11, (h - seatH) * 0.25), -d / 2 + 3, 1);
  };
  B.table = (g, w, d, h, c) => {
    const top = Math.min(4, h * 0.1), m = wood(c, w, d), t = Math.min(7, Math.min(w, d) * 0.1);
    part(g, m, w, top, d, 0, h - top / 2, 0, 0.8);
    legs(g, m, w, d, h - top, Math.max(t, 6), t, h < 50);
    if (h >= 50) { part(g, m, w - 2 * t, 8, 2, 0, h - top - 4, d / 2 - t, 0); part(g, m, w - 2 * t, 8, 2, 0, h - top - 4, -d / 2 + t, 0); }
  };
  B.desk = (g, w, d, h, c) => {
    const m = wood(c, w, d), top = 3;
    part(g, m, w, top, d, 0, h - top / 2, 0, 0.5);
    const lm = METAL_DARK();
    for (const sx of [-1, 1]) { part(g, lm, 4, h - top, d - 10, sx * (w / 2 - 5), (h - top) / 2, 0); }
    part(g, lm, w - 10, 4, 2, 0, h - top - 12, -d / 2 + 6);
  };
  B.roundtable = (g, w, d, h, c) => { // round or oval top on four tapered legs with an apron
    const m = wood(c, w, d), top = 2.5;
    const t = cyl(g, m, w / 2, w / 2, top, 0, h - top / 2, 0, 64); t.scale.z = d / w;
    const ap = cyl(g, m, w * 0.36, w * 0.36, 7, 0, h - top - 3.5, 0, 48); ap.scale.z = d / w;
    const r = w * 0.3, rz = d * 0.3;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(g, m, 2.8, 2, h - top, sx * r * 0.72, (h - top) / 2, sz * rz * 0.72, 12);
  };
  // Upholstered bed. h up to 80 = mattress top (headboard 45 cm above); over 80 = overall height to the top of the headboard.
  B.bed = (g, w, d, h, c) => {
    const top = h > 80 ? Math.min(55, h * 0.48) : h, headH = h > 80 ? h : h + 45;
    const frame = fabric(shade(c, 0.92), w, d), feetM = wood('#6B4A2E', 5, 15), feetH = Math.min(15, top * 0.3);
    const frameH = Math.min(top - 18, feetH + 28), mattH = top - frameH + 8;
    legs(g, feetM, w, d, feetH, 8, 5, true);
    part(g, frame, w, frameH - feetH, d - 8, 0, feetH + (frameH - feetH) / 2, 4, 3);
    part(g, frame, w, headH - feetH, 9, 0, feetH + (headH - feetH) / 2, -d / 2 + 4.5, 5); // padded headboard
    const mw = w - 10, md2 = d - 16, mz = 4;
    part(g, mat('#F4F2EE', { rough: 0.9 }), mw, mattH, md2, 0, frameH - 8 + mattH / 2, mz, 5); // mattress
    part(g, fabric('#F1EEE8', w, d), mw + 2, 7, md2 * 0.62, 0, frameH - 8 + mattH + 2, mz + md2 * 0.19, 4); // duvet
    part(g, fabric(shade(c, 0.85), w, 40), mw + 4, 3, 40, 0, frameH - 8 + mattH + 5.5, mz + md2 / 2 - 28, 1.5); // throw
    const n = w >= 140 ? 2 : 1, pw = (w - 12 - (n - 1) * 6) / n;
    for (let k = 0; k < n; k++) { const x = -w / 2 + 6 + pw / 2 + k * (pw + 6); const p = part(g, fabric('#FBFAF7', pw, 40), pw - 6, 12, 36, x, frameH - 8 + mattH + 6, -d / 2 + 30, 6); p.rotation.x = -0.25; }
  };
  B.cabinet = (g, w, d, h, c) => {
    const m = wood(c, w, h), legH = h > 60 ? 10 : 6, bodyH = h - legH;
    legs(g, METAL_DARK(), w, d, legH, 5, 2.5, true);
    part(g, m, w, bodyH, d, 0, legH + bodyH / 2, 0, 1);
    const n = Math.max(1, Math.round(w / 55)), dw = w / n, fm = wood(shade(c, 1.06), w, h);
    for (let k = 0; k < n; k++) {
      part(g, fm, dw - 1, bodyH - 3, 1.2, -w / 2 + dw * (k + 0.5), legH + bodyH / 2, d / 2 + 0.5, 0.3);
      part(g, METAL_BRASS(), 1.2, Math.min(14, bodyH * 0.3), 1.5, -w / 2 + dw * (k + 0.5) + (k % 2 ? -1 : 1) * (dw / 2 - 5), legH + bodyH * 0.6, d / 2 + 1.8, 0.5);
    }
  };
  B.shelf = (g, w, d, h, c) => {
    const m = wood(c, w, h), t = 2.2, n = Math.max(2, Math.round(h / 36));
    part(g, m, t, h, d, -w / 2 + t / 2, h / 2, 0); part(g, m, t, h, d, w / 2 - t / 2, h / 2, 0);
    part(g, m, w, h, 0.8, 0, h / 2, -d / 2 + 0.4);
    const books = ['#6F4E37', '#2F4858', '#B08D57', '#8C3B32', '#D9CBB0', '#3E5544', '#1F2A36'];
    for (let k = 0; k <= n; k++) {
      const y = Math.min(h - t / 2, k * (h - t) / n + t / 2); part(g, m, w - 2 * t, t, d, 0, y, 0);
      if (k < n && k % 2 === 0) { // a row of books on every other shelf
        let x = -w / 2 + t + 2; const maxH = (h - t) / n - t - 3; let i = k;
        while (x < w / 2 - t - 6 && maxH > 12) { const bw = 2 + ((i * 7) % 5), bh = maxH * (0.7 + ((i * 13) % 5) * 0.06); part(g, mat(books[i % books.length], { rough: 0.8 }), bw, bh, d * 0.75, x + bw / 2, y + t / 2 + bh / 2, 0); x += bw + 0.3; i++; if (x > w * 0.1 && i % 9 === 0) x += 12; }
      }
    }
  };
  B.wardrobe = (g, w, d, h, c) => {
    const m = wood(c, w, h), n = Math.max(2, Math.round(w / 50)), dw = w / n;
    part(g, m, w, h - 6, d, 0, 6 + (h - 6) / 2, 0, 0.5);
    part(g, mat(shade(c, 0.6)), w - 4, 6, d - 4, 0, 3, 0);
    for (let k = 0; k < n; k++) {
      part(g, m, dw - 0.8, h - 9, 1.5, -w / 2 + dw * (k + 0.5), 6 + (h - 6) / 2, d / 2 + 0.6, 0.3);
      part(g, METAL_DARK(), 1.2, 30, 2, -w / 2 + dw * (k + 0.5) + (k % 2 ? -1 : 1) * (dw / 2 - 4), h * 0.5, d / 2 + 2, 0.5);
    }
  };
  B.counter = (g, w, d, h, c) => {
    // light fronts get a gloss finish and a dark granite top; dark fronts get a pale stone top
    const light = new T3.Color(c).getHSL({}).l > 0.6, top = 4, m = mat(c, { rough: light ? 0.18 : 0.5 });
    const topM = light ? mat('#9A8F86', { rough: 0.15, map: texFor('granite', w, d) }) : mat('#E9E6E0', { rough: 0.2, map: texFor('terrazzo', w, d) });
    topM.envMapIntensity = 1;
    part(g, mat('#2A2A2A'), w - 4, 10, d - 8, 0, 5, -3);
    part(g, m, w, h - top - 10, d - 3, 0, 10 + (h - top - 10) / 2, -1.5, 0.4);
    part(g, topM, w, top, d, 0, h - top / 2, 0, 0.5);
    const n = Math.max(1, Math.round(w / 60)), dw = w / n;
    for (let k = 0; k < n; k++) { part(g, METAL_DARK(), dw * 0.4, 1.2, 1.5, -w / 2 + dw * (k + 0.5), h - top - 6, d / 2 - 1.2, 0.5); if (k) part(g, mat(shade(c, 0.8)), 0.4, h - top - 12, 0.5, -w / 2 + dw * k, 10 + (h - top - 10) / 2, d / 2 - 2.8); }
  };
  B.appliance = (g, w, d, h, c) => {
    const m = mat(c, { rough: 0.25, metal: 0.3 });
    part(g, m, w, h, d, 0, h / 2, 0, 2);
    part(g, mat(shade(c, 0.8), { rough: 0.3 }), w - 1, 0.6, 0.5, 0, h * 0.62, d / 2 + 0.1);
    part(g, METAL_DARK(), 2, h * 0.25, 2.5, w / 2 - 6, h * 0.8, d / 2 + 1.5, 0.8);
    if (h > 100) part(g, METAL_DARK(), 2, h * 0.2, 2.5, w / 2 - 6, h * 0.42, d / 2 + 1.5, 0.8);
  };
  B.rug = (g, w, d, h, c) => {
    const m = mat(c, { rough: 1, map: texFor('carpet', w, d), bump: texFor('carpet', w, d), bumpScale: 0.8 });
    const r = part(g, m, w, Math.max(h, 1), d, 0, Math.max(h, 1) / 2, 0, 0.4); r.castShadow = false;
    const border = mat(shade(c, 0.75), { rough: 1 });
    for (const [bw, bd, x, z] of [[w, 4, 0, d / 2 - 2], [w, 4, 0, -d / 2 + 2], [4, d, w / 2 - 2, 0], [4, d, -w / 2 + 2, 0]]) { const b = part(g, border, bw, Math.max(h, 1) + 0.1, bd, x, Math.max(h, 1) / 2, z); b.castShadow = false; }
  };
  B.plant = (g, w, d, h, c) => {
    const potH = Math.min(h * 0.3, 40), pr = Math.min(w, d) * 0.3;
    cyl(g, mat('#C9B8A3', { rough: 0.85 }), pr, pr * 0.78, potH, 0, potH / 2, 0, 24);
    cyl(g, mat('#3A2C22', { rough: 1 }), pr * 0.92, pr * 0.92, 1, 0, potH - 1, 0, 24);
    const leaf = mat(c, { rough: 0.7 }), leaf2 = mat(shade(c, 1.25), { rough: 0.7 });
    seed = Math.floor(w * 13 + h * 7) || 1;
    const fh = h - potH, n = 9;
    cyl(g, mat('#4B3A2A'), 1.2, 1.5, fh * 0.6, 0, potH + fh * 0.3, 0, 8);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * w * 0.3, y = potH + fh * (0.35 + rnd() * 0.5), s = Math.min(w, d) * (0.18 + rnd() * 0.14);
      sphere(g, k % 2 ? leaf : leaf2, s, Math.cos(a) * rr, y, Math.sin(a) * rr * d / w, 0.8);
    }
  };
  B.bath = (g, w, d, h, c) => { // built-in tub with a tiled front
    const m = CERAMIC(); m.color = lin(c);
    part(g, mat('#FAFAF8', { rough: 0.12, map: texFor('walltile', w, h) }), w, h - 3, d, 0, (h - 3) / 2, 0, 0.3);
    part(g, m, w, 3, d, 0, h - 1.5, 0, 1.5);
    part(g, mat('#DDE7EA', { rough: 0.05, transparent: true, opacity: 0.85 }), w - 14, 1, d - 14, 0, h - 8, 0, 0.3);
    part(g, mat(shade(c, 0.9), { rough: 0.2 }), w - 12, 2, d - 12, 0, h - 0.5, 0, 6);
    cyl(g, mat('#C0C4C6', { rough: 0.2, metal: 1 }), 1.5, 1.5, 12, -w / 2 + 6, h + 6, 0, 12);
  };
  B.shower = (g, w, d, h, c) => {
    part(g, mat(c, { rough: 0.25 }), w, 4, d, 0, 2, 0, 1);
    const glass = mat('#D6E4EA', { rough: 0.02, transparent: true, opacity: 0.22 });
    part(g, glass, w, h - 4, 0.8, 0, 4 + (h - 4) / 2, d / 2 - 0.4); part(g, glass, 0.8, h - 4, d, w / 2 - 0.4, 4 + (h - 4) / 2, 0);
    const chrome = mat('#C0C4C6', { rough: 0.15, metal: 1 });
    part(g, chrome, 1.5, h * 0.35, 1.5, -w / 2 + 6, h * 0.8, -d / 2 + 2);
    cyl(g, chrome, 10, 10, 1.2, -w / 2 + 16, h * 0.95, -d / 2 + 14, 24);
    part(g, chrome, 1.2, 1.2, 14, -w / 2 + 16, h * 0.96, -d / 2 + 7);
  };
  B.vanity = (g, w, d, h, c) => {
    const m = wood(c, w, h), bh = Math.min(50, h * 0.55); // wall-hung cabinet under the basin
    part(g, m, w, bh, d, 0, h - bh / 2, 0, 1);
    part(g, mat(shade(c, 0.7)), w - 4, 0.6, 0.6, 0, h - bh / 2, d / 2 + 0.2);
    const top = part(g, CERAMIC(), w, 3, d, 0, h + 1.5, 0, 1);
    top.castShadow = true;
    part(g, mat('#E9ECEC', { rough: 0.1 }), w * 0.55, 1, d * 0.55, 0, h + 3.1, 2, 4);
    part(g, mat('#C0C4C6', { rough: 0.15, metal: 1 }), 2, 14, 2, 0, h + 10, -d / 2 + 6, 0.8);
    part(g, mat('#DDE6EA', { rough: 0.02, metal: 0.9 }), Math.min(w, 80), 70, 1, 0, h + 70, -d / 2 - 1, 1); // mirror
  };
  B.toilet = (g, w, d, h, c) => { // wall-hung bowl with a concealed cistern and flush plate
    const m = CERAMIC(); m.color = lin(c);
    part(g, mat('#C8CCCE', { rough: 0.2, metal: 0.8 }), 22, 15, 1, 0, h + 45, -d / 2 + 0.5, 1);
    const bd = d - 4, bowl = cyl(g, m, w / 2, w * 0.4, 28, 0, h - 14, -d / 2 + 4 + bd / 2, 32); bowl.scale.z = bd / w;
    part(g, m, w * 0.7, 28, 8, 0, h - 14, -d / 2 + 4, 3);
    const seat = cyl(g, mat('#FFFFFF', { rough: 0.15 }), w / 2 + 0.5, w / 2 + 0.5, 2.5, 0, h - 0.5, -d / 2 + 4 + bd / 2, 32); seat.scale.z = bd / w;
  };
  B.box = (g, w, d, h, c) => { part(g, mat(c, { rough: 0.7 }), w, h, d, 0, h / 2, 0, 1.5); };

  // ---------- Lights ----------
  // Returns y (local) of the bulb so the caller can place a light source there
  const L = {};
  const shadeMat = (c, on, k) => mat(c, { rough: 0.85, side: T3.DoubleSide, emissive: on ? k : null, emissiveIntensity: on ? 0.9 : 0 });
  L.pendant = (g, w, d, h, c, on, k, roomTop) => {
    const cord = Math.max(0, roomTop - h);
    if (cord > 0) cyl(g, METAL_DARK(), 0.4, 0.4, cord, 0, h + cord / 2, 0, 6);
    const s = new T3.Mesh(new T3.CylinderGeometry(w * 0.12, w / 2, h, 40, 1, true), shadeMat(c, false)); s.position.set(0, h / 2, 0); s.castShadow = true; g.add(s);
    const bulb = sphere(g, mat('#FFF8EC', { rough: 0.2, emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 }), Math.min(6, w * 0.12), 0, h * 0.25, 0);
    bulb.castShadow = false; return h * 0.2;
  };
  L.ceiling = (g, w, d, h, c, on, k) => {
    cyl(g, mat(c, { rough: 0.6 }), w / 2, w / 2, h * 0.3, 0, h * 0.85, 0, 40);
    const dif = cyl(g, mat('#FFFFFF', { rough: 0.4, emissive: on ? k : null, emissiveIntensity: on ? 2.5 : 0 }), w / 2 - 1, w / 2 - 3, h * 0.7, 0, h * 0.35, 0, 40);
    dif.castShadow = false; return 0;
  };
  L.spot = (g, w, d, h, c, on, k) => {
    cyl(g, mat(c, { rough: 0.4, metal: 0.4 }), w / 2, w / 2, h, 0, h / 2, 0, 20);
    const lens = cyl(g, mat('#FFFFFF', { emissive: on ? k : null, emissiveIntensity: on ? 4 : 0 }), w / 2 - 1.2, w / 2 - 1.2, 0.5, 0, -0.1, 0, 20); lens.castShadow = false; return -1;
  };
  L.sconce = (g, w, d, h, c, on, k) => {
    part(g, mat(c, { rough: 0.3, metal: 0.8 }), w * 0.5, h * 0.5, 2, 0, h * 0.5, -d / 2 + 1, 1);
    const s = cyl(g, shadeMat('#F4EFE6', on, k), w * 0.35, w * 0.5, h * 0.55, 0, h * 0.55, 0, 32); s.castShadow = false; return h * 0.55;
  };
  L.floorlamp = (g, w, d, h, c, on, k) => {
    cyl(g, mat(c, { rough: 0.4, metal: 0.7 }), w * 0.4, w * 0.45, 2.5, 0, 1.25, 0, 32);
    cyl(g, mat(c, { rough: 0.4, metal: 0.7 }), 1, 1, h - 28, 0, (h - 28) / 2, 0, 10);
    const s = cyl(g, shadeMat('#F1EBDF', on, k), w * 0.35, w / 2, 30, 0, h - 15, 0, 36); s.castShadow = false; return h - 18;
  };
  L.tablelamp = (g, w, d, h, c, on, k) => {
    const bodyH = h * 0.5; cyl(g, mat(c, { rough: 0.3 }), w * 0.2, w * 0.28, bodyH, 0, bodyH / 2, 0, 24);
    sphere(g, mat(c, { rough: 0.3 }), w * 0.28, 0, bodyH * 0.45, 0, 1.1);
    const s = cyl(g, shadeMat('#F1EBDF', on, k), w * 0.33, w / 2, h - bodyH, 0, bodyH + (h - bodyH) / 2, 0, 32); s.castShadow = false; return bodyH + 4;
  };

  // Build one item. opts: { evening, kelvinHex, roomTop (cm above item base, for pendant cords) }
  HM.buildItem = (it, opts) => {
    const g = new T3.Group(), w = it.w, d = it.d, h = Math.max(it.h, 1);
    let bulbY = null;
    if (L[it.type]) bulbY = L[it.type](g, w, d, h, it.color, opts.evening, opts.kelvinHex, opts.roomTop);
    else (B[it.type] || B.box)(g, w, d, h, it.color, it);
    g.userData.bulbY = bulbY;
    return g;
  };
})();
