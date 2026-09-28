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
    // corduroy: 48 rounded ribs over 24 cm (5 mm wales) with dark valleys and a little fibre noise
    cord: () => canvasTex('cord', 512, (g, s) => {
      seed = 53; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 48, rw = s / n;
      for (let i = 0; i < n; i++) { const x = i * rw, gr = g.createLinearGradient(x, 0, x + rw, 0); gr.addColorStop(0, 'rgb(205,205,205)'); gr.addColorStop(0.2, 'rgb(238,238,238)'); gr.addColorStop(0.5, 'rgb(255,255,255)'); gr.addColorStop(0.8, 'rgb(238,238,238)'); gr.addColorStop(1, 'rgb(205,205,205)'); g.fillStyle = gr; g.fillRect(x, 0, rw, s); }
      noise(g, s, 9000, 0.12, 170, 255);
    }, 24),
    // deep-pile corduroy for upholstered beds: stronger valleys between the wales so the ribs read from across the room
    cordDeep: () => canvasTex('cordDeep', 512, (g, s) => {
      seed = 57; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 48, rw = s / n;
      for (let i = 0; i < n; i++) { const x = i * rw, gr = g.createLinearGradient(x, 0, x + rw, 0); gr.addColorStop(0, 'rgb(150,150,150)'); gr.addColorStop(0.18, 'rgb(215,215,215)'); gr.addColorStop(0.5, 'rgb(255,255,255)'); gr.addColorStop(0.82, 'rgb(215,215,215)'); gr.addColorStop(1, 'rgb(150,150,150)'); g.fillStyle = gr; g.fillRect(x, 0, rw, s); }
      noise(g, s, 12000, 0.1, 160, 255);
    }, 24),
    grain: () => canvasTex('grain', 1024, (g, s) => {
      seed = 17; g.fillStyle = '#f6f6f6'; g.fillRect(0, 0, s, s);
      // broad tone bands along the board, then fine growth lines, cathedral arcs and pores
      for (let k = 0; k < 18; k++) { const y = rnd() * s, v = 225 + rnd() * 30; g.fillStyle = `rgba(${v},${v},${v},.35)`; g.fillRect(0, y, s, 10 + rnd() * 40); }
      for (let k = 0; k < 160; k++) { const y = rnd() * s, v = 190 + rnd() * 45; g.strokeStyle = `rgba(${v},${v},${v},.45)`; g.lineWidth = 0.4 + rnd() * 1.4; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x / 90 + k) * 4 + (rnd() - 0.5) * 1.5); g.stroke(); }
      for (let k = 0; k < 6; k++) { const cx = rnd() * s, cy = rnd() * s; for (let r = 8; r < 70; r += 6 + rnd() * 5) { const v = 185 + rnd() * 40; g.strokeStyle = `rgba(${v},${v},${v},.5)`; g.lineWidth = 0.8 + rnd(); g.beginPath(); g.ellipse(cx, cy, r * 3.5, r * 0.6, 0, Math.PI * 0.9, Math.PI * 2.1); g.stroke(); } }
      for (let k = 0; k < 9000; k++) { const v = 150 + rnd() * 60; g.fillStyle = `rgba(${v},${v},${v},.35)`; g.fillRect(rnd() * s, rnd() * s, 1.5 + rnd() * 3, 0.8); }
    }, 90),
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
    oakpanels: () => canvasTex('oakpanels', 1024, (g, s) => {
      seed = 43; g.fillStyle = '#ddd'; g.fillRect(0, 0, s, s); const n = 6, t = s / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i * t, y = j * t, tri = (pts, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.lineTo(...pts[2]); g.closePath(); g.fill(); };
        const up = (i + j) % 2 === 0;
        // facets lit from the top left: a light, a mid and a shaded face; variation per panel stays subtle
        const base = 214 + rnd() * 22;
        tri(up ? [[x, y + t], [x + t, y + t], [x + t / 2, y]] : [[x, y], [x + t, y], [x + t / 2, y + t]], base);
        tri(up ? [[x, y], [x + t / 2, y], [x, y + t]] : [[x, y + t], [x + t / 2, y + t], [x, y]], base - 26);
        tri(up ? [[x + t, y], [x + t / 2, y], [x + t, y + t]] : [[x + t, y + t], [x + t / 2, y + t], [x + t, y]], base - 12);
      }
      g.globalAlpha = 0.3; for (let k = 0; k < 1400; k++) { const v = 150 + rnd() * 60; g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.lineTo(x + 12 + rnd() * 25, y + (rnd() - 0.5) * 2); g.stroke(); } g.globalAlpha = 1;
      g.strokeStyle = 'rgba(110,110,110,.35)'; g.lineWidth = 1; for (let j = 0; j <= n; j++) { g.beginPath(); g.moveTo(0, j * t); g.lineTo(s, j * t); g.stroke(); }
    }, 90),
    // dark granite worktop: near-black with warm and pale flecks
    granite: () => canvasTex('granite', 512, (g, s) => {
      seed = 47; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) { const t = rnd(), v = t < 0.6 ? 60 + rnd() * 50 : t < 0.9 ? 150 + rnd() * 60 : 235; g.fillStyle = `rgb(${v},${Math.max(0, v - 8)},${Math.max(0, v - 16)})`; const r = 1 + rnd() * 4; g.fillRect(rnd() * s, rnd() * s, r, r * (0.5 + rnd())); }
    }, 60),
    // perforated steel: small round holes on a 1 cm grid (dark = hole)
    perforated: () => canvasTex('perforated', 256, (g, s) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgb(40,40,40)'; const n = 16, c = s / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.beginPath(); g.arc(i * c + c / 2, j * c + c / 2, c * 0.28, 0, 7); g.fill(); }
    }, 16),
    // laminated bamboo desk top: 2 cm strips with nodes
    bambootop: () => canvasTex('bambootop', 1024, (g, s) => {
      seed = 61; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 40, sh = s / n;
      for (let j = 0; j < n; j++) {
        const v = 222 + rnd() * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, j * sh, s, sh);
        g.fillStyle = 'rgba(150,150,150,.35)'; g.fillRect(0, j * sh, s, 1);
        for (let k = 0; k < 4; k++) { const y = j * sh + rnd() * sh, gv = v - 25; g.strokeStyle = `rgba(${gv},${gv},${gv},.35)`; g.lineWidth = 0.6; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (rnd() - 0.5) * 2); g.stroke(); }
        let x = rnd() * 120; while (x < s) { g.fillStyle = 'rgba(140,140,140,.45)'; g.fillRect(x, j * sh + 1, 3, sh - 1); x += 90 + rnd() * 160; } // nodes
      }
    }, 80),
    // channel stitching: 5 cm vertical channels, rounded, with a sewn seam between them
    channel: () => canvasTex('channel', 512, (g, s) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const n = 8, cw = s / n;
      for (let i = 0; i < n; i++) { const x = i * cw, gr = g.createLinearGradient(x, 0, x + cw, 0); gr.addColorStop(0, 'rgb(208,208,208)'); gr.addColorStop(0.1, 'rgb(242,242,242)'); gr.addColorStop(0.5, 'rgb(255,255,255)'); gr.addColorStop(0.9, 'rgb(242,242,242)'); gr.addColorStop(1, 'rgb(208,208,208)'); g.fillStyle = gr; g.fillRect(x, 0, cw, s); }
      seed = 67; noise(g, s, 6000, 0.1, 190, 255);
    }, 40),
    // woven bamboo: basket weave of 1.5 cm strips over and under (tinted by the material)
    bamboo: () => canvasTex('bamboo', 512, (g, s) => {
      seed = 59; g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s); const n = 16, c = s / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const horiz = (i + j) % 2 === 0, x = i * c, y = j * c, gr = horiz ? g.createLinearGradient(0, y, 0, y + c) : g.createLinearGradient(x, 0, x + c, 0);
        const v = 225 + rnd() * 30; gr.addColorStop(0, `rgb(${v - 45},${v - 45},${v - 45})`); gr.addColorStop(0.5, `rgb(${v},${v},${v})`); gr.addColorStop(1, `rgb(${v - 50},${v - 50},${v - 50})`);
        g.fillStyle = gr; g.fillRect(x + 1, y + 1, c - 2, c - 2);
        g.strokeStyle = 'rgba(120,120,120,.35)'; g.lineWidth = 0.6; for (let k = 0; k < 3; k++) { g.beginPath(); const o = 4 + rnd() * (c - 8); if (horiz) { g.moveTo(x + 2, y + o); g.lineTo(x + c - 2, y + o); } else { g.moveTo(x + o, y + 2); g.lineTo(x + o, y + c - 2); } g.stroke(); }
      }
    }, 24),
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
      if (r > 0.4 && T3.RoundedBoxGeometry) return new T3.RoundedBoxGeometry(w, h, d, r > 3 ? 6 : 3, r);
      return new T3.BoxGeometry(w, h, d);
    }
  };
  // Box with UVs scaled to real-world cm so textures keep their size
  function part(g, m, w, h, d, x, y, z, r) {
    const geo = GEO.box(Math.max(w, 0.2), Math.max(h, 0.2), Math.max(d, 0.2), r);
    const mesh = new T3.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  // Soft cushion: a rounded box whose top and bottom bulge towards the middle
  function pillow(g, m, w, h, d, x, y, z, puff) {
    const geo = GEO.box(w, h, d, Math.min(h * 0.45, 7));
    const p = geo.attributes.position, hw = w / 2, hd = d / 2;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / hw, nz = p.getZ(i) / hd, f = Math.max(0, (1 - nx * nx) * (1 - nz * nz)), yv = p.getY(i);
      p.setY(i, yv + Math.sign(yv) * (puff || h * 0.22) * f);
    }
    geo.computeVertexNormals();
    const mesh = new T3.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  // Soft darkening on the floor under a piece (stands in for ambient occlusion)
  let blobTex = null;
  HM.contactShadow = (w, d) => {
    if (!blobTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      const gr = x.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128); blobTex = new T3.CanvasTexture(c);
    }
    const m = new T3.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 });
    const mesh = new T3.Mesh(new T3.PlaneGeometry(w * 1.12 + 12, d * 1.12 + 12), m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.35; mesh.renderOrder = 1; return mesh;
  };
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
  // Corduroy: ribbed bump plus a pale sheen, which is what makes velvet and cord read as fabric
  const cord = (hex, w, h) => {
    const m = new T3.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.78, map: texFor('cord', w, h), bumpMap: texFor('cord', w, h), bumpScale: 0.35 });
    if ('sheen' in m) m.sheen = new T3.Color(hex).lerp(new T3.Color('#FFFFFF'), 0.55).convertSRGBToLinear();
    m.envMapIntensity = 0.3; return m;
  };
  const wood = (hex, w, h) => mat(hex, { rough: 0.55, map: texFor('grain', w, h) });
  const METAL_DARK = () => mat('#2A2C2E', { rough: 0.35, metal: 0.8 });
  const METAL_BRASS = () => mat('#B89559', { rough: 0.3, metal: 0.9 });
  const CERAMIC = () => mat('#F7F7F4', { rough: 0.12 });

  // ---------- Furniture ----------
  const B = {};
  // Mid-century click-clack sofa bed: splayed tapered wood legs, rolled arms, two buttoned back cushions,
  // two seat cushions with piping and a small buttoned pillow resting on each arm
  B.sofabed = (g, w, d, h, c) => {
    const f = fabric(c, w, d), fd = fabric(shade(c, 0.93), w, d), pipe = fabric(shade(c, 0.8), w, d), legM = wood('#D2A874', 10, 20), btn = fabric(shade(c, 0.7), 4, 4);
    const legH = Math.min(18, h * 0.22), arm = Math.min(16, w * 0.09), baseH = 16, seatT = 12, seatY = legH + baseH;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { // splayed, tapered legs
      const l = cyl(g, legM, 1.6, 2.4, legH + 2, sx * (w / 2 - 12), legH / 2, sz * (d / 2 - 10), 16);
      l.rotation.z = -sx * 0.14; l.rotation.x = sz * 0.1;
    }
    part(g, fd, w - 2 * arm + 2, baseH, d - 6, 0, legH + baseH / 2, 1, 3); // base frame
    const armH = Math.min(h * 0.72, seatY + seatT + 22);
    for (const sx of [-1, 1]) { // rolled arms
      part(g, fd, arm, armH - legH + 2, d - 2, sx * (w / 2 - arm / 2), legH - 2 + (armH - legH + 2) / 2, 0, arm * 0.48);
      part(g, pipe, 0.8, armH - legH - 4, d - 6, sx * (w / 2 - 0.2), legH + (armH - legH) / 2, 0, 0.3);
    }
    const inner = w - 2 * arm, cw = inner / 2, backT = 12, sd = d - backT - 6;
    part(g, fd, inner, h * 0.55, backT, 0, seatY + h * 0.27, -d / 2 + backT / 2 + 2, 3); // back frame
    for (const i of [0, 1]) {
      const x = -inner / 2 + cw * (i + 0.5);
      pillow(g, f, cw - 1.2, seatT, sd, x, seatY + seatT / 2, -d / 2 + backT + 2 + sd / 2, 1.5); // seat cushion
      part(g, pipe, cw - 3, 0.8, 0.8, x, seatY + seatT - 0.3, d / 2 - 5.2, 0.3); // front piping
      const bh = h - seatY - seatT + 2, bz = -d / 2 + backT + 6;
      const bc = pillow(g, f, cw - 2, 14, bh, x, seatY + seatT + bh / 2 - 1, bz, 2.5); bc.rotation.x = Math.PI / 2 - 0.2; // back cushion, leaning back
      const b = sphere(g, btn, 1.3, x + (i ? -cw * 0.1 : cw * 0.1), seatY + seatT + bh * 0.5, bz + 8.5, 0.6); b.rotation.x = -0.2;
    }
    for (const sx of [-1, 1]) { // arm pillows leaning in the corners
      const px = sx * (w / 2 - arm - 14), py = seatY + seatT + 17, pz = -d / 2 + backT + 22;
      const pl = pillow(g, f, 38, 12, 34, px, py, pz, 2); pl.rotation.set(Math.PI / 2 - 0.35, 0, sx * 0.35);
      sphere(g, btn, 1, px - sx * 1.8, py + 2, pz + 7, 0.6);
    }
  };
  B.sofa = (g, w, d, h, c, it) => {
    if (it && it.style === 'sofabed') return B.sofabed(g, w, d, h, c);
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
    const sh1 = HM.contactShadow(w, md); sh1.position.z = z0 + md / 2; g.add(sh1);
    const sh2 = HM.contactShadow(cw, d - md); sh2.position.set(chaiseX, sh2.position.y, z0 + md + (d - md) / 2); g.add(sh2);
    // bases
    part(g, fd, mainW, baseH, md, mainX, legH + baseH / 2, z0 + md / 2, 3);
    part(g, fd, cw, baseH, d, chaiseX, legH + baseH / 2, 0, 3);
    // back along the full width, arm on the non-chaise end, low arm on the chaise end
    part(g, fd, w, h - legH, backT, 0, legH + (h - legH) / 2, z0 + backT / 2, 6);
    part(g, fd, arm, seatH + 16 - legH, md, -sx * (w / 2 - arm / 2), legH + (seatH + 16 - legH) / 2, z0 + md / 2, 6);
    // seat cushions (soft, slightly domed) and loose back cushions that lean back at slightly different angles
    const inner = mainW - arm, n = inner > 150 ? 3 : 2, cwid = inner / n, bh = Math.min(h - seatH + 8, 50);
    for (let i = 0; i < n; i++) {
      const x = -sx * (w / 2 - arm) + sx * cwid * (i + 0.5);
      pillow(g, f, cwid - 1, 13, md - backT - 1, x, seatH - 6.5, z0 + backT + (md - backT) / 2, 2.2);
      const m = pillow(g, f, cwid - 2, bh, 20, x, seatH + bh / 2 - 3, z0 + backT + 9, 4.5); m.rotation.x = -0.16 - (i % 2) * 0.04; m.rotation.z = (i - 1) * 0.012;
    }
    pillow(g, f, cw - 1.5, 13, d - backT - 1, chaiseX, seatH - 6.5, z0 + backT + (d - backT) / 2, 2.5);
    const cb = pillow(g, f, cw - 3, bh, 20, chaiseX, seatH + bh / 2 - 3, z0 + backT + 9, 4.5); cb.rotation.x = -0.18;
    // two scatter cushions in a slightly paler cord
    for (const k of [0, 1]) { const m = pillow(g, cord(shade(c, 1.1), 45, 45), 44, 44, 13, sx * (w / 2 - cw - 34 - k * 44), seatH + 20, z0 + backT + 24, 5); m.rotation.x = -0.28; m.rotation.y = (k ? -1 : 1) * 0.18; m.rotation.z = (k ? 1 : -1) * 0.06; }
  };
  // Tub dining chair: channel-stitched shell curving from the back into the arms, padded seat, splayed beech legs with black caps
  B.tubChair = (g, w, d, h, c) => {
    const seatH = Math.min(48, h * 0.57), R = w / 2, thick = 5, A = Math.PI * 0.64, zc = -d / 2 + R, armTop = seatH + 19, bottom = seatH - 9;
    const velvet = (() => { const m = new T3.MeshPhysicalMaterial({ color: lin(c), roughness: 0.8, side: T3.DoubleSide }); const t = TEX.channel(); m.map = t; m.bumpMap = t; m.bumpScale = 1.6; if ('sheen' in m) m.sheen = new T3.Color(c).lerp(new T3.Color('#FFFFFF'), 0.6).convertSRGBToLinear(); m.envMapIntensity = 0.3; return m; })();
    // shell as one mesh: outer wall, inner wall and the rounded top edge, over the angle a (0 = middle of the back)
    const segA = 48, pos = [], uv = [], idx = [], top = (a) => armTop + (h - armTop) * Math.pow(Math.cos((a / A) * Math.PI / 2), 0.8);
    const ring = (r, y, a) => [r * Math.sin(a), y, zc - r * Math.cos(a)];
    const rows = [(a) => ring(R, bottom, a), (a) => ring(R, top(a) - 2, a), (a) => ring(R - thick / 2, top(a), a), (a) => ring(R - thick, top(a) - 2, a), (a) => ring(R - thick, bottom + 6, a)];
    for (let i = 0; i <= segA; i++) {
      const a = -A + (2 * A * i) / segA;
      rows.forEach((f, j) => { const v = f(a); pos.push(...v); uv.push((a * R) / 40, v[1] / 40 + j * 0.01); });
    }
    const nr = rows.length;
    for (let i = 0; i < segA; i++) for (let j = 0; j < nr - 1; j++) { const a0 = i * nr + j, b0 = (i + 1) * nr + j; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
    const geo = new T3.BufferGeometry(); geo.setAttribute('position', new T3.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T3.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const shell = new T3.Mesh(geo, velvet); shell.castShadow = true; shell.receiveShadow = true; g.add(shell);
    // seat pan and cushion (the cushion is plain, not channelled)
    const plain = new T3.MeshPhysicalMaterial({ color: lin(shade(c, 1.02)), roughness: 0.82 }); if ('sheen' in plain) plain.sheen = velvet.sheen; plain.envMapIntensity = 0.3;
    part(g, plain, w - 3, 8, d - 4, 0, bottom + 4, 0, 3);
    pillow(g, plain, w - 2 * thick - 2, 8, d - 12, 0, seatH - 3, 3, 1.5);
    // splayed beech legs with black caps
    const beech = wood('#D6B08A', 5, 45), cap = mat('#1E1E1E', { rough: 0.4, metal: 0.4 }), legH = bottom + 1;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lg = new T3.Group(); lg.position.set(sx * (w / 2 - 10), bottom, sz * (d / 2 - 10)); lg.rotation.z = sx * 0.14; lg.rotation.x = -sz * 0.14; g.add(lg);
      const l = cyl(g, beech, 1.9, 1.3, legH, 0, 0, 0, 16); g.remove(l); l.position.set(0, -legH / 2, 0); lg.add(l);
      const k = cyl(g, cap, 2.1, 2.1, 2.2, 0, 0, 0, 16); g.remove(k); k.position.set(0, -1.1, 0); lg.add(k);
    }
  };
  B.chair = (g, w, d, h, c, it) => {
    if (it && it.style === 'tub') return B.tubChair(g, w, d, h, c);
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
  B.desk = (g, w, d, h, c, it) => {
    if (it && it.style === 'standing') return B.standingDesk(g, w, d, h, c, it);
    const m = wood(c, w, d), top = 3;
    part(g, m, w, top, d, 0, h - top / 2, 0, 0.5);
    const lm = METAL_DARK();
    for (const sx of [-1, 1]) { part(g, lm, 4, h - top, d - 10, sx * (w / 2 - 5), (h - top) / 2, 0); }
    part(g, lm, w - 10, 4, 2, 0, h - top - 12, -d / 2 + 6);
  };
  // Electric standing desk: laminated bamboo top with rounded corners on two stepped black columns with T-feet
  B.standingDesk = (g, w, d, h, c) => {
    const top = 2.5, rad = 3, frame = mat('#1C1C1C', { rough: 0.45, metal: 0.5 });
    const shp = new T3.Shape(), hw = w / 2, hd = d / 2;
    shp.moveTo(-hw + rad, -hd); shp.lineTo(hw - rad, -hd); shp.quadraticCurveTo(hw, -hd, hw, -hd + rad); shp.lineTo(hw, hd - rad); shp.quadraticCurveTo(hw, hd, hw - rad, hd);
    shp.lineTo(-hw + rad, hd); shp.quadraticCurveTo(-hw, hd, -hw, hd - rad); shp.lineTo(-hw, -hd + rad); shp.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
    const geo = new T3.ExtrudeGeometry(shp, { depth: top - 0.8, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 2, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, h - top + 0.4, 0);
    const tex = TEX.bambootop(), map = tex.clone(); map.needsUpdate = true; map.repeat.set(1 / tex.cmSize, 1 / tex.cmSize);
    const bam = mat(c, { rough: 0.4, map }); bam.envMapIntensity = 0.7;
    const t = new T3.Mesh(geo, bam); t.castShadow = true; t.receiveShadow = true; g.add(t);
    const colH = h - top - 4, fx = w / 2 - Math.min(18, w * 0.12);
    for (const sx of [-1, 1]) {
      const x = sx * fx;
      part(g, frame, 7, 3, Math.min(d - 4, 70), x, 1.5, 0, 1); // foot
      part(g, frame, 8, colH * 0.36, 6, x, 3 + colH * 0.18, 0, 0.6); // stage 1 (widest)
      part(g, frame, 7.2, colH * 0.34, 5.2, x, 3 + colH * 0.36 + colH * 0.17, 0, 0.6);
      part(g, frame, 6.4, colH * 0.3, 4.4, x, 3 + colH * 0.7 + colH * 0.15, 0, 0.6);
      part(g, frame, 6, 3, d - 14, x, h - top - 1.5, 0, 0.5); // support arm under the top
    }
    part(g, frame, 2 * fx, 4, 5, 0, h - top - 2, -2, 0.5); // cross beam
    part(g, mat('#2A2A2A', { rough: 0.5 }), 14, 2.5, 5, w / 2 - 22, h - top - 1.2, d / 2 - 3, 0.8); // control panel
    part(g, mat('#2A2A2A', { rough: 0.7 }), Math.min(w - 40, 90), 8, 12, 0, h - top - 8, -d / 2 + 12, 0.5); // cable tray
    part(g, frame, Math.min(72, w * 0.5), 5, Math.min(32, d * 0.45), 0, h - top - 2.5, d / 2 - Math.min(16, d * 0.23) - 2, 0.5); // slim drawer
  };
  // Round table, or a round table extended with a centre leaf (w != d): semicircular ends and straight sides.
  B.roundtable = (g, w, d, h, c) => {
    const top = 2.4, bevel = 0.6, L = Math.max(w, d), S = Math.min(w, d), r = S / 2, straight = L - S, alongX = w >= d;
    const oak = mat(c, { rough: 0.42 }), tex = TEX.grain(), map = tex.clone(); map.needsUpdate = true; map.repeat.set(1 / tex.cmSize, 1 / tex.cmSize); oak.map = map;
    oak.bumpMap = map; oak.bumpScale = 0.15; oak.envMapIntensity = 0.7;
    const shp = new T3.Shape(), a = straight / 2;
    shp.moveTo(-a, -r); shp.lineTo(a, -r); shp.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false); shp.lineTo(-a, r); shp.absarc(-a, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    const geo = new T3.ExtrudeGeometry(shp, { depth: top - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 48 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, h - top + bevel, 0); if (!alongX) geo.rotateY(Math.PI / 2);
    const t = new T3.Mesh(geo, oak); t.castShadow = true; t.receiveShadow = true; g.add(t);
    // leaf joints: thin dark lines across the top where the leaf meets the halves
    if (straight > 4) { const seam = mat(shade(c, 0.62), { rough: 0.8 }); for (const sgn of [-1, 1]) { const sp = alongX ? part(g, seam, 0.25, 0.1, S * 0.98, sgn * a, h + 0.05, 0) : part(g, seam, S * 0.98, 0.1, 0.25, 0, h + 0.05, sgn * a); sp.castShadow = false; } }
    // apron following the top, set in 9 cm, and four tapered legs just inside it
    const apShape = new T3.Shape(), ar = r - 9; apShape.moveTo(-a, -ar); apShape.lineTo(a, -ar); apShape.absarc(a, 0, ar, -Math.PI / 2, Math.PI / 2, false); apShape.lineTo(-a, ar); apShape.absarc(-a, 0, ar, Math.PI / 2, Math.PI * 1.5, false);
    const hole = new T3.Path(), hr = ar - 2; hole.moveTo(-a, -hr); hole.lineTo(a, -hr); hole.absarc(a, 0, hr, -Math.PI / 2, Math.PI / 2, false); hole.lineTo(-a, hr); hole.absarc(-a, 0, hr, Math.PI / 2, Math.PI * 1.5, false); apShape.holes.push(hole);
    const apGeo = new T3.ExtrudeGeometry(apShape, { depth: 7, bevelEnabled: false, curveSegments: 40 }); apGeo.rotateX(-Math.PI / 2); apGeo.translate(0, h - top - 7, 0); if (!alongX) apGeo.rotateY(Math.PI / 2);
    const ap = new T3.Mesh(apGeo, wood(shade(c, 0.95), 60, 7)); ap.castShadow = true; g.add(ap);
    const k = Math.SQRT1_2 * (ar - 3);
    for (const [px, pz] of [[a + k, k], [a + k, -k], [-a - k, k], [-a - k, -k]]) { const x = alongX ? px : pz, z = alongX ? pz : px; const leg = cyl(g, oak, 2.9, 1.9, h - top, x, (h - top) / 2, z, 16); leg.rotation.z = (x > 0 ? -1 : 1) * 0.02; }
  };
  // Upholstered bed. h up to 80 = mattress top (headboard 45 cm above); over 80 = overall height to the top of the headboard.
  // Mattress, duvet, throw and pillows for a w-wide sleeping area, mattress top at y = top, from z0 (head) to z1 (foot)
  function bedding(g, w, z0, z1, base, mattH, c) {
    const L = z1 - z0, mz = (z0 + z1) / 2, top = base + mattH;
    part(g, mat('#F4F2EE', { rough: 0.9 }), w, mattH, L, 0, base + mattH / 2, mz, 5);
    part(g, fabric('#F1EEE8', w, L), w + 2, 7, L * 0.62, 0, top + 2, mz + L * 0.19, 4); // duvet
    part(g, fabric(shade(c, 0.85), w, 40), w + 4, 3, 40, 0, top + 5.5, z1 - 28, 1.5); // throw
    const n = w >= 140 ? 2 : 1, pw = (w - 2 - (n - 1) * 6) / n;
    for (let k = 0; k < n; k++) { const x = -w / 2 + 1 + pw / 2 + k * (pw + 6); const pl = pillow(g, fabric('#FBFAF7', pw, 40), pw - 6, 12, 36, x, top + 7, z0 + 22, 2); pl.rotation.x = -0.25; }
  }
  // VINAY: olive corduroy, low frame on hidden feet, headboard of thick padded bolsters over the full width
  B.vinay = (g, w, d, h, c) => {
    const f = cord(c, w, d), fd = cord(shade(c, 0.9), w, d), frameH = 30, headD = 20;
    part(g, fd, w, frameH - 2, d - headD, 0, 2 + (frameH - 2) / 2, headD / 2, 4); // upholstered frame
    part(g, mat('#2A2622', { rough: 0.7 }), w - 12, 2, d - headD - 12, 0, 1, headD / 2); // recessed feet
    part(g, fd, w, h, 8, 0, h / 2, -d / 2 + 4, 3); // headboard back
    const rows = 3, rh = (h - frameH - 4) / rows;
    for (let i = 0; i < rows; i++) pillow(g, f, w - 2, 14, rh, 0, frameH + 2 + rh * (i + 0.5), -d / 2 + 14, 3).rotation.x = Math.PI / 2 - 0.08;
    bedding(g, w - 16, -d / 2 + headD + 1, d / 2 - 6, frameH - 11, 22, c);
  };
  // ---------- Upholstery done properly: real-scale corduroy, piped seams, draped bedding ----------
  // UVs in cm from world position, so the ribs keep their real width on every face. Sides and fronts get vertical ribs;
  // on top faces the ribs run across the part (the fabric wraps over from the side), i.e. u along the longer axis.
  function worldUV(geo, w, d) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, alongX = w >= d;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (ay >= ax && ay >= az) uv.setXY(i, alongX ? x : z, alongX ? z : x);
      else if (ax >= az) uv.setXY(i, z, y); else uv.setXY(i, x, y);
    }
    uv.needsUpdate = true; return geo;
  }
  // Corduroy with sheen; rib = width of one wale in cm (Ti'me fine cord ~0.35, Cloe wide rib ~0.8)
  function cordFabric(hex, rib) {
    const base = TEX.cordDeep(), t = base.clone(); t.needsUpdate = true; const k = 1 / (48 * rib); t.repeat.set(k, k);
    const m = new T3.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.82, map: t, bumpMap: t, bumpScale: 0.25 + rib * 0.9 });
    if ('sheen' in m) { m.sheen = new T3.Color(hex).lerp(new T3.Color('#FFFFFF'), 0.6).convertSRGBToLinear(); if ('sheenRoughness' in m) m.sheenRoughness = 0.5; }
    m.envMapIntensity = 0.35; return m;
  }
  // Upholstered block: soft rounded edges, fabric at true scale; `puff` bulges the front/top slightly like a padded slab
  function slab(g, m, w, h, d, x, y, z, r, puff) {
    const geo = GEO.box(w, h, d, r);
    if (puff) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const px = p.getX(i) / (w / 2), py = p.getY(i) / (h / 2), pz = p.getZ(i); if (pz > 0) p.setZ(i, pz + puff * Math.max(0, (1 - px * px) * (1 - py * py))); } geo.computeVertexNormals(); }
    worldUV(geo, w, d);
    const mesh = new T3.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  // Piping (welt) along an edge: axis 'x' | 'y' | 'z'
  function welt(g, m, len, x, y, z, axis, r) {
    const c = new T3.Mesh(new T3.CylinderGeometry(r || 0.55, r || 0.55, len, 8), m); c.position.set(x, y, z);
    if (axis === 'x') c.rotation.z = Math.PI / 2; else if (axis === 'z') c.rotation.x = Math.PI / 2;
    c.castShadow = true; g.add(c); return c;
  }
  // A plump pillow: a sphere pushed out to a rounded rectangle, full in the middle and thin at the seams and corners
  function plump(g, m, w, h, d, x, y, z) {
    const geo = new T3.SphereGeometry(1, 40, 24), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i), sx = Math.sign(ux) * Math.pow(Math.abs(ux), 0.28), sz = Math.sign(uz) * Math.pow(Math.abs(uz), 0.28);
      const edge = Math.max(Math.abs(sx), Math.abs(sz));
      p.setXYZ(i, sx * w / 2, uy * h / 2 * (1 - 0.75 * Math.pow(edge, 6)) * (1 - 0.25 * sx * sx * sz * sz), sz * d / 2);
    }
    geo.computeVertexNormals();
    const mesh = new T3.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
  }
  // Bedding that looks slept-in: quilted mattress, a duvet draped over the edges with soft folds, full pillows.
  // pal: { sheet, duvet, pillow, deco } colours; drop: how far the duvet may hang over the mattress sides.
  function softBedding(g, mw, z0, z1, base, mattH, pal, drop) {
    const L = z1 - z0, top = base + mattH;
    const sheet = mat(pal.sheet, { rough: 0.95, map: texFor('fabric', mw, L), bump: texFor('fabric', mw, L), bumpScale: 0.2 });
    part(g, sheet, mw, mattH, L, 0, base + mattH / 2, (z0 + z1) / 2, 6); // mattress in a fitted sheet
    // duvet: a subdivided sheet, pushed up in folds and bent down over the sides and the foot
    const oh = drop + 2, W = mw + 2 * oh, dz0 = z0 + 42, D = z1 - dz0 + oh, sx = 64, sz = 64;
    const geo = new T3.PlaneGeometry(W, D, sx, sz); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    // a few long soft creases in random directions, plus a gentle overall billow: nothing periodic
    const creases = []; for (let k = 0; k < 9; k++) { const a = r() * Math.PI; creases.push({ cx: (r() - 0.5) * mw, cz: z0 + 60 + r() * (L - 70), dx: Math.cos(a), dz: Math.sin(a), amp: (r() < 0.5 ? -1 : 1) * (0.8 + r() * 1.6), wd: 4 + r() * 7, len: 25 + r() * 60 }); }
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) + dz0 + D / 2, zr = (z - dz0) / (z1 - dz0);
      let y = top + 5 + 1.4 * Math.sin(x * 0.028 + ph[0]) * Math.sin(z * 0.022 + ph[1]) - 1.5 * Math.pow(Math.min(1, Math.abs(x) / (mw / 2)), 6);
      for (const c of creases) { const px = x - c.cx, pz = z - c.cz, al = px * c.dx + pz * c.dz, ac = -px * c.dz + pz * c.dx; y += c.amp * Math.exp(-(ac * ac) / (c.wd * c.wd)) * Math.exp(-(al * al) / (c.len * c.len)); }
      y += 3.5 * Math.exp(-Math.pow((zr - 0.05) / 0.06, 2)) * (0.85 + 0.15 * Math.sin(x * 0.07 + ph[2])); // turned-back top edge
      let nx = x, nz = z; const ex = Math.abs(x) - mw / 2, ez = z - z1;
      if (ex > 0) { nx = Math.sign(x) * (mw / 2 + 1.2 + Math.min(ex, 3) * 0.35); y -= ex * (1 - 0.04 * Math.sin(z * 0.2 + ph[0])); }
      if (ez > 0) { nz = z1 + 1.2 + Math.min(ez, 3) * 0.35; y -= ez; }
      y = Math.max(y, top - drop);
      p.setXYZ(i, nx, y, nz);
    }
    geo.computeVertexNormals();
    const duvet = new T3.Mesh(geo, mat(pal.duvet, { rough: 0.95, map: texFor('fabric', W, D), bump: texFor('fabric', W, D), bumpScale: 0.3, side: T3.DoubleSide }));
    duvet.castShadow = true; duvet.receiveShadow = true; g.add(duvet);
    // pillows: two full sleeping pillows leaning on the headboard, two smaller cushions in front
    const pw = Math.min(80, mw / 2 - 6), pm = mat(pal.pillow, { rough: 0.95 }), dm = mat(pal.deco, { rough: 0.95 });
    for (const sx2 of [-1, 1]) {
      const p1 = plump(g, pm, pw, 15, 50, sx2 * (mw / 4 + 1), top + 20, z0 + 10); p1.rotation.set(-1.15, 0, sx2 * 0.03);
      const p2 = plump(g, dm, 48, 13, 40, sx2 * (mw / 4 - 6), top + 16, z0 + 24); p2.rotation.set(-1.0, sx2 * 0.18, sx2 * 0.05);
    }
  }
  // Storage bed with a thick upholstered rim standing on the floor (Ti'me and Livetastic Cloe):
  // side rails the full length with the foot rail between them, a lift-up slatted base over a storage box,
  // a headboard block faced with two big cushions, piped seams on every top edge.
  // o: frameH, headD, headBlock (height of the block behind the cushions), rib (cm), pal (bedding colours)
  B.boxbed = (g, w, d, h, c, o) => {
    o = o || {};
    const frameH = o.frameH || 32, headD = o.headD || 22, rib = o.rib || 0.35, z0 = -d / 2, rim = Math.max(18, (w - 184) / 2);
    const f = cordFabric(c, rib), fd = cordFabric(shade(c, 0.95), rib), pipe = mat(shade(c, 0.82), { rough: 0.8 });
    const pal = o.pal || { sheet: '#F3F1EC', duvet: '#E9E6E0', pillow: '#F6F4EF', deco: shade(c, 1.05) };
    // headboard block and its two cushions
    const blockH = o.headBlock || frameH + 4;
    slab(g, fd, w, blockH, headD, 0, blockH / 2, z0 + headD / 2, 2.5);
    const cw = (w - 1) / 2, ch = h - blockH + 12, cy = blockH - 12 + ch / 2, cd = headD - 3, cz = z0 + headD / 2 + 1.2;
    for (const sx of [-1, 1]) {
      const x = sx * (cw / 2 + 0.25);
      slab(g, f, cw - 0.6, ch, cd, x, cy, cz, o.cushion || 4, 1.2);
      welt(g, pipe, cw - 6, x, cy + ch / 2 - 0.4, cz + cd / 2 - 0.4, 'x'); // piping round the cushion face
      welt(g, pipe, ch - 6, x - sx * (cw / 2 - 0.7) , cy, cz + cd / 2 - 0.4, 'y');
      welt(g, pipe, ch - 6, x + sx * (cw / 2 - 0.7), cy, cz + cd / 2 - 0.4, 'y');
    }
    // rim: two side rails (full length) and the foot rail between them, a hairline gap at each joint
    const fl = d - headD, fz = z0 + headD + fl / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - rim / 2);
      slab(g, fd, rim, frameH, fl - 0.4, x, frameH / 2, fz + 0.2, 3);
      welt(g, pipe, fl - 4, x + sx * (rim / 2 - 0.6), frameH - 0.6, fz, 'z'); welt(g, pipe, fl - rim - 4, x - sx * (rim / 2 - 0.6), frameH - 0.6, fz - rim / 2, 'z');
      welt(g, pipe, fl - 4, x + sx * (rim / 2 - 0.6), 0.6, fz, 'z');
    }
    slab(g, fd, w - 2 * rim - 0.6, frameH, rim, 0, frameH / 2, d / 2 - rim / 2, 3);
    welt(g, pipe, w - 2 * rim - 3, 0, frameH - 0.6, d / 2 - 0.6, 'x'); welt(g, pipe, w - 2 * rim - 3, 0, 0.6, d / 2 - 0.6, 'x');
    welt(g, pipe, w - 2 * rim - 3, 0, frameH - 0.6, d / 2 - rim + 0.6, 'x');
    // inside: dark storage box under the slatted base
    const iw = w - 2 * rim, il = fl - rim, iz = z0 + headD + il / 2;
    part(g, mat('#2B2926', { rough: 0.85 }), iw, frameH - 10, il, 0, (frameH - 10) / 2, iz);
    for (let k = 0; k < 28; k++) part(g, wood('#D9BC8C', iw / 2, 6), iw / 2 - 4, 1.4, 5, (k % 2 ? 1 : -1) * iw / 4, frameH - 9.3, z0 + headD + 4 + Math.floor(k / 2) * (il - 8) / 13, 0.4);
    part(g, mat('#1E1E1E', { rough: 0.6 }), 5, 2, il - 4, 0, frameH - 10, iz); // centre rail
    const mw = iw - 3;
    softBedding(g, mw, z0 + headD + 1, d / 2 - rim - 1, frameH - 8, 22, pal, 10);
  };
  // ZEN: low ash platform on short legs, wide headboard with bouclé panels framed in wood, two flat side tables
  B.zen = (g, w, d, h, c) => {
    const ash = wood(c, w, d), dark = wood(shade(c, 0.8), w, d), boucle = mat('#EEE9E0', { rough: 1, map: texFor('fabric', 30, 30), bump: texFor('fabric', 30, 30), bumpScale: 0.9 });
    const bw = Math.min(w, 220), legH = 8, frameH = 30, headD = 8, tableW = (w - bw) / 2, tableD = 42;
    legs(g, dark, bw - 10, d - headD - 10, legH, 6, 5, false);
    part(g, ash, bw, frameH - legH, d - headD, 0, legH + (frameH - legH) / 2, headD / 2, 1); // platform frame
    part(g, ash, bw, h, headD, 0, h / 2, -d / 2 + headD / 2, 1); // headboard
    const pn = 3, pw = (bw - 8 - (pn - 1) * 3) / pn, ph = h - frameH - 14;
    for (let i = 0; i < pn; i++) pillow(g, boucle, pw, 5, ph, -bw / 2 + 4 + pw / 2 + i * (pw + 3), frameH + 6 + ph / 2, -d / 2 + headD + 1, 1.2).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) if (tableW > 10) { // flat side tables fixed to the headboard
      const x = sx * (bw / 2 + tableW / 2);
      part(g, ash, tableW, 3, tableD, x, frameH + 12, -d / 2 + tableD / 2, 0.8);
      part(g, ash, tableW, 3, tableD - 4, x, legH + 6, -d / 2 + tableD / 2, 0.8);
      part(g, dark, 3, frameH + 9 - legH, 3, x + sx * (tableW / 2 - 3), (frameH + 9 + legH) / 2, -d / 2 + tableD - 4);
      part(g, ash, tableW, h * 0.55, 3, x, h * 0.275, -d / 2 + 1.5, 0.5);
    }
    bedding(g, 180, -d / 2 + headD + 2, d / 2 - 6, frameH - 4, 22, '#B9A58A');
  };
  B.bed = (g, w, d, h, c, it) => {
    const st = it && it.style;
    if (st === 'vinay') return B.vinay(g, w, d, h, c);
    if (st === 'boxbed') return B.boxbed(g, w, d, h, c, { rib: 0.35, cushion: 5, pal: { sheet: '#F5F4F0', duvet: '#ECEAE5', pillow: '#F8F7F3', deco: '#DCD8D0' } });
    if (st === 'cloe') return B.boxbed(g, w, d, h, c, { frameH: 39, headD: 16, cushion: 2.5, rib: 0.8, pal: { sheet: '#F4F2EE', duvet: '#9E8B78', pillow: '#A89684', deco: '#EDE9E2' } }); // Livetastic Cloe: lower, squarer, wide-rib cord
    if (st === 'zen') return B.zen(g, w, d, h, c);
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
  // FJÄLLBO style: black powder-coated steel on tall feet, perforated door, drawers, stained pine top
  B.fjallbo = (g, w, d, h, c) => {
    const steel = mat(c, { rough: 0.5, metal: 0.55 }), pine = wood('#5A3E2B', w, d), legH = 14, bodyH = h - legH - 2.5;
    for (const [x, z] of [[-w / 2 + 1.5, -d / 2 + 1.5], [w / 2 - 1.5, -d / 2 + 1.5], [-w / 2 + 1.5, d / 2 - 1.5], [w / 2 - 1.5, d / 2 - 1.5]]) part(g, steel, 3, legH + bodyH, 3, x, (legH + bodyH) / 2, z, 0.3);
    part(g, steel, w - 3, 1.2, d - 3, 0, legH, 0); // bottom
    part(g, steel, w - 3, bodyH, 0.6, 0, legH + bodyH / 2, -d / 2 + 1.5); // back
    for (const sx of [-1, 1]) part(g, steel, 0.6, bodyH, d - 3, sx * (w / 2 - 1.5), legH + bodyH / 2, 0);
    part(g, pine, w + 1, 2.5, d + 1, 0, h - 1.25, 0, 0.4); // pine top
    const half = w / 2 - 2, perf = mat(c, { rough: 0.55, metal: 0.5, map: texFor('perforated', half, bodyH), transparent: false });
    part(g, perf, half, bodyH - 2, 0.8, -w / 4 - 0.5, legH + bodyH / 2, d / 2 - 1); // perforated door (left)
    part(g, steel, 1, 12, 2, -2.5 - 1.5, legH + bodyH * 0.55, d / 2 + 0.6, 0.4);
    const n = 3, dh = (bodyH - 2) / n; // three drawers (right)
    for (let i = 0; i < n; i++) { const y = legH + 1 + dh * (i + 0.5); part(g, steel, half, dh - 1, 0.8, w / 4 + 0.5, y, d / 2 - 1); part(g, pine, 14, 1.8, 2, w / 4 + 0.5, y + dh * 0.28, d / 2 + 0.6, 0.5); }
    part(g, pine, w / 2 - 6, 1.8, d - 10, -w / 4, legH + bodyH * 0.5, -3); // inner pine shelf behind the door
  };
  // Rivery bedside chest: painted pine body on a low plinth, honey pine top, two drawers with brass handles
  B.rivery = (g, w, d, h, c) => {
    const body = mat(c, { rough: 0.6 }), top = wood('#C8923E', w, d), brass = mat('#B89559', { rough: 0.3, metal: 0.9 }), plinth = 5, topT = 2.5, bh = h - plinth - topT;
    part(g, body, w - 3, plinth, d - 3, 0, plinth / 2, -0.5);
    part(g, body, w, bh, d - 1, 0, plinth + bh / 2, -0.5, 0.4);
    part(g, top, w + 1.5, topT, d + 1, 0, h - topT / 2, 0, 0.4);
    const dh = (bh - 2) / 2;
    for (let i = 0; i < 2; i++) {
      const y = plinth + 1 + dh * (i + 0.5);
      part(g, body, w - 3, dh - 1, 1.2, 0, y, d / 2 - 0.2, 0.3);
      part(g, brass, 9, 1.2, 1.2, 0, y, d / 2 + 1.4, 0.4); cyl(g, brass, 0.5, 0.5, 1.6, -4, y, d / 2 + 0.8, 8).rotation.x = Math.PI / 2; cyl(g, brass, 0.5, 0.5, 1.6, 4, y, d / 2 + 0.8, 8).rotation.x = Math.PI / 2;
    }
  };
  // Antique walnut cabinet: crown moulding, a top drawer with two brass bail pulls, two burl-veneer panel doors, bun feet
  B.antique = (g, w, d, h, c) => {
    const body = wood(c, w, h), burl = wood(shade(c, 1.2), w, h), dark = wood(shade(c, 0.75), w, h), brass = mat('#B8914A', { rough: 0.3, metal: 0.9 });
    const feet = 7, plinth = 8, crown = 7, carcH = h - feet - plinth - crown, y0 = feet + plinth, fz = d / 2 - 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const f = new T3.Mesh(new T3.SphereGeometry(4, 16, 10), dark); f.scale.y = feet / 8; f.position.set(sx * (w / 2 - 6), feet / 2, sz * (d / 2 - 6)); f.castShadow = true; g.add(f); }
    part(g, body, w, plinth, d, 0, feet + plinth / 2, 0, 0.8);
    part(g, dark, w + 1, 1.5, d + 1, 0, feet + plinth - 0.75, 0, 0.5);
    part(g, body, w - 4, carcH, d - 4, 0, y0 + carcH / 2, -1, 0.5);
    for (const sx of [-1, 1]) { // fluted corner pilasters
      part(g, body, 5, carcH, 4, sx * (w / 2 - 4.5), y0 + carcH / 2, fz, 0.4);
      for (const k of [-1, 0, 1]) part(g, dark, 0.5, carcH - 10, 0.4, sx * (w / 2 - 4.5) + k * 1.3, y0 + carcH / 2, fz + 2.1);
    }
    part(g, body, w - 2, 2, d - 2, 0, y0 + carcH - 1, 0, 0.5);
    part(g, dark, w + 2, 2.5, d + 2, 0, y0 + carcH + 1.25, 0.5, 0.6); // crown: stepped mouldings
    part(g, body, w + 5, 3, d + 3.5, 0, y0 + carcH + 4, 1, 0.8);
    part(g, dark, w + 7, 1.5, d + 4.5, 0, h - 0.75, 1.2, 0.5);
    const fw = w - 17, drH = Math.min(18, carcH * 0.17), drY = y0 + carcH - drH / 2 - 3;
    part(g, body, fw, drH, 1.5, 0, drY, fz, 0.4); // top drawer
    for (const sx of [-1, 1]) { // brass bail pulls
      part(g, brass, 6, 3, 0.4, sx * fw * 0.27, drY, fz + 0.9, 0.3);
      const bail = new T3.Mesh(new T3.TorusGeometry(2.3, 0.3, 6, 16, Math.PI), brass); bail.rotation.z = Math.PI; bail.position.set(sx * fw * 0.27, drY, fz + 1.4); g.add(bail);
    }
    const dH = carcH - drH - 9, dY = y0 + 3 + dH / 2, dw = fw / 2 - 0.5;
    for (const sx of [-1, 1]) {
      const x = sx * (dw / 2 + 0.5);
      part(g, body, dw, dH, 1.5, x, dY, fz, 0.4);
      part(g, dark, dw - 7, dH - 8, 0.4, x, dY, fz + 0.9);
      part(g, burl, dw - 9, dH - 10, 0.5, x, dY, fz + 1.1, 0.3); // burl veneer panel
    }
    part(g, brass, 1.6, 2.4, 0.4, 3, dY + dH * 0.1, fz + 1); // keyhole escutcheon
  };
  B.cabinet = (g, w, d, h, c, it) => {
    if (it && it.style === 'fjallbo') return B.fjallbo(g, w, d, h, c);
    if (it && it.style === 'rivery') return B.rivery(g, w, d, h, c);
    if (it && it.style === 'antique') return B.antique(g, w, d, h, c);
    const m = wood(c, w, h), legH = h > 60 ? 10 : 6, bodyH = h - legH;
    legs(g, METAL_DARK(), w, d, legH, 5, 2.5, true);
    part(g, m, w, bodyH, d, 0, legH + bodyH / 2, 0, 1);
    const n = Math.max(1, Math.round(w / 55)), dw = w / n, fm = wood(shade(c, 1.06), w, h);
    for (let k = 0; k < n; k++) {
      part(g, fm, dw - 1, bodyH - 3, 1.2, -w / 2 + dw * (k + 0.5), legH + bodyH / 2, d / 2 + 0.5, 0.3);
      part(g, METAL_BRASS(), 1.2, Math.min(14, bodyH * 0.3), 1.5, -w / 2 + dw * (k + 0.5) + (k % 2 ? -1 : 1) * (dw / 2 - 5), legH + bodyH * 0.6, d / 2 + 1.8, 0.5);
    }
  };
  // Bookcase (BILLY-like): sides, back, top, plinth, shelves; books on the open shelves; optional doors
  // it.doors: 'none' | 'lower' (lower half, about 97 cm) | 'full'; it.books: false for empty shelves
  B.shelf = (g, w, d, h, c, it) => {
    const white = new T3.Color(c).getHSL({}).l > 0.8, m = white ? mat(c, { rough: 0.5 }) : wood(c, w, h), t = 1.6, plinth = Math.min(8, h * 0.05);
    const doors = (it && it.doors) || 'none', withBooks = !it || it.books !== false;
    part(g, m, t, h, d, -w / 2 + t / 2, h / 2, 0); part(g, m, t, h, d, w / 2 - t / 2, h / 2, 0);
    part(g, m, w - 2 * t, 0.4, 0.4, 0, h / 2, -d / 2 + 0.6); part(g, mat(shade(c, 0.93), { rough: 0.7 }), w - 2 * t, h - plinth, 0.4, 0, plinth + (h - plinth) / 2, -d / 2 + 0.4);
    part(g, m, w - 2 * t, plinth, t, 0, plinth / 2, d / 2 - 2.5); part(g, m, w, t, d, 0, h - t / 2, 0, 0.3);
    // shelves about every 35 cm
    const inner = h - plinth - t, n = Math.max(2, Math.round(inner / 36)), gap = inner / n;
    const doorTop = doors === 'full' ? h - t : doors === 'lower' ? Math.min(h - t, plinth + 97) : plinth;
    const spines = ['#6F4E37', '#2F4858', '#B08D57', '#8C3B32', '#E4D9C4', '#3E5544', '#1F2A36', '#C9B79C', '#5B6770', '#A0522D', '#F2EFE8', '#7A6A58'];
    seed = Math.floor(w * 3 + h) || 5;
    const spineM = spines.map((x) => mat(x, { rough: 0.75 })), pick = () => spineM[Math.floor(rnd() * spineM.length)];
    for (let k = 0; k < n; k++) {
      const y = plinth + k * gap; if (k > 0) part(g, m, w - 2 * t, t, d - 1.5, 0, y, 0.75);
      if (!withBooks || y + gap <= doorTop + 1) continue; // behind doors: no need to draw books
      const maxH = gap - t - 2; let x = -w / 2 + t + 1;
      while (x < w / 2 - t - 3 && maxH > 12) {
        if (rnd() < 0.025 && x < w / 2 - t - 30) { // now and then a small stack lying flat
          let sy = y + t / 2; for (let j = 0; j < 3; j++) { const bh = 2.5 + rnd() * 2, bw = 20 + rnd() * 6; part(g, pick(), bw, bh, d * 0.7, x + bw / 2 + 1, sy + bh / 2, 0); sy += bh; }
          x += 27; continue;
        }
        if (rnd() < 0.015) { x += 4 + rnd() * 5; continue; } // small gap
        const bw = 1.8 + rnd() * 3.2, bh = Math.min(maxH, maxH * (0.62 + rnd() * 0.35)), bd = d * (0.62 + rnd() * 0.2);
        const b = part(g, pick(), bw, bh, bd, x + bw / 2, y + t / 2 + bh / 2, -d / 2 + bd / 2 + 1.5, 0.2);
        b.castShadow = false; x += bw + 0.15;
      }
    }
    // doors: white frame with a woven bamboo panel (HÖGADAL style), two across if wider than 60 cm
    if (doors !== 'none') {
      const nd = w > 60 ? 2 : 1, dw = (w - 0.6) / nd, dh = doorTop - plinth, fr = 5.5, frameM = mat('#F6F5F1', { rough: 0.5 });
      const weave = mat('#D8C39C', { rough: 0.85, map: texFor('bamboo', dw, dh), bump: texFor('bamboo', dw, dh), bumpScale: 0.8 });
      for (let i = 0; i < nd; i++) {
        const cx = -w / 2 + 0.3 + dw * (i + 0.5), cy = plinth + dh / 2, z = d / 2 + 0.9;
        part(g, frameM, dw - 0.3, fr, 1.8, cx, plinth + fr / 2, z); part(g, frameM, dw - 0.3, fr, 1.8, cx, doorTop - fr / 2, z);
        part(g, frameM, fr, dh, 1.8, cx - dw / 2 + fr / 2, cy, z); part(g, frameM, fr, dh, 1.8, cx + dw / 2 - fr / 2, cy, z);
        part(g, weave, dw - 2 * fr, dh - 2 * fr, 0.8, cx, cy, z - 0.3);
        cyl(g, mat('#E9E6DF', { rough: 0.4 }), 1.3, 1.3, 1.6, cx + (i === 0 && nd === 2 ? dw / 2 - 5 : -dw / 2 + 5), cy + dh * 0.1, z + 1.6, 16).rotation.x = Math.PI / 2;
      }
    }
  };
  // Straight staircase rising towards the back (-z): treads, risers, two stringers and a handrail on the right
  B.stairs = (g, w, d, h, c, it) => {
    const n = Math.max(3, Math.round(h / 18)), rise = h / n, run = d / n, m = wood(c, w, d), riserM = mat('#F4F3EF', { rough: 0.6 });
    for (let i = 0; i < n; i++) {
      const z = d / 2 - run * (i + 0.5), y = rise * (i + 1);
      part(g, m, w - 4, 3, run + 2, 0, y - 1.5, z, 0.4);
      part(g, riserM, w - 4, rise - 3, 1.5, 0, y - rise / 2 - 1.5, z + run / 2, 0);
    }
    const len = Math.hypot(h, d), ang = Math.atan2(h, d);
    for (const sx of [-1, 1]) { const st = part(g, riserM, 3, 25, len, sx * (w / 2 - 1.5), h / 2 - 6, 0); st.rotation.x = ang; }
    if (it && it.style === 'glass') { // glass balustrade along the open side, wooden handrail on the wall side
      const glass = mat('#E4EEF2', { rough: 0.03, transparent: true, opacity: 0.18 }); glass.envMapIntensity = 1.3;
      const gp = part(g, glass, 1, 90, len, w / 2 - 1.5, h / 2 + 45, 0); gp.rotation.x = ang;
      const wr = part(g, m, 5, 4, len, -w / 2 + 3, h / 2 + 88, 0, 1.5); wr.rotation.x = ang;
      return;
    }
    const rail = part(g, m, 5, 4, len, w / 2 - 3, h / 2 + 88, 0, 1.5); rail.rotation.x = ang;
    for (let i = 0; i <= n; i += 2) { const z = d / 2 - run * (i + 0.5), y = rise * (i + 1); part(g, mat('#E8E4DC', { rough: 0.5 }), 2, 88, 2, w / 2 - 3, y + 44, z); }
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
  // ---------- Fitted kitchen ----------
  const STEEL = () => mat('#C9CCCE', { rough: 0.28, metal: 0.9 });
  const BLACK_GLASS = () => { const m = mat('#101112', { rough: 0.08, metal: 0.2 }); m.envMapIntensity = 1.2; return m; };
  // Built-in oven front: black glass door, steel control strip and handle
  function ovenFront(g, x, y0, w, hgt, z) {
    part(g, BLACK_GLASS(), w - 1, hgt - 1, 1.5, x, y0 + hgt / 2, z, 0.3);
    part(g, STEEL(), w - 1, Math.min(9, hgt * 0.16), 1.8, x, y0 + hgt - Math.min(9, hgt * 0.16) / 2, z + 0.1, 0.2);
    part(g, STEEL(), w * 0.8, 1.6, 2.4, x, y0 + hgt - Math.min(9, hgt * 0.16) - 3, z + 1.8, 0.7);
  }
  // Worktop run as in the house: dishwasher, sink cabinet, drawer stack, oven under a hob; marble splashback,
  // white gloss wall units and an angled hood. Laid out left to right seen from the front; extra width becomes a filler.
  B.fittedKitchen = (g, w, d, h, c) => {
    const plinth = 10, top = 4, body = h - top - plinth, z = d / 2 - 1.2, gloss = mat(c, { rough: 0.12 }); gloss.envMapIntensity = 0.9;
    const granite = mat('#7A6555', { rough: 0.15, map: texFor('granite', w, d) }); granite.envMapIntensity = 1;
    part(g, mat('#2A2A2A'), w - 2, plinth, d - 8, 0, plinth / 2, -3);
    part(g, mat('#EEEEEC', { rough: 0.5 }), w, body, d - 3, 0, plinth + body / 2, -1.5);
    part(g, granite, w + 1, top, d + 2, 0, h - top / 2, 1, 0.6);
    const mods = [['dish', 60], ['door', 45], ['drawers', 40], ['oven', 60]], used = mods.reduce((a, m) => a + m[1], 0), k = Math.min(1, w / used);
    let x = -w / 2;
    if (w > used) { part(g, gloss, w - used - 0.4, body - 1, 1.6, x + (w - used) / 2, plinth + body / 2, z, 0.2); x += w - used; }
    const handle = (cx, y) => part(g, STEEL(), 16, 1.2, 2, cx, y, z + 1.6, 0.5);
    let sinkX = 0, hobX = 0;
    for (const [kind, mw0] of mods) {
      const mw = mw0 * k, cx = x + mw / 2;
      if (kind === 'dish') { // white door with a black control strip along the top
        part(g, mat('#F2F2F0', { rough: 0.3 }), mw - 0.6, body - 1, 1.6, cx, plinth + body / 2, z, 0.2);
        part(g, mat('#141414', { rough: 0.3 }), mw - 0.6, 8, 1.9, cx, h - top - 5, z + 0.1, 0.2);
        part(g, mat('#2A2A2A', { rough: 0.5 }), mw * 0.3, 4, 2.2, cx - mw * 0.05, h - top - 9, z + 0.3, 0.3); }
      if (kind === 'door') { part(g, gloss, mw - 0.6, body - 1, 1.6, cx, plinth + body / 2, z, 0.2); handle(cx, h - top - 8); sinkX = cx - 8; }
      if (kind === 'drawers') { // a shallow top drawer over two deep ones
        const hs = [0.4, 0.4, 0.2].map((f) => f * (body - 1)); let y0 = plinth;
        for (const dh of hs) { part(g, gloss, mw - 0.6, dh - 0.8, 1.6, cx, y0 + dh / 2, z, 0.2); handle(cx, y0 + dh * 0.72); y0 += dh; } }
      if (kind === 'oven') { part(g, gloss, mw - 0.6, 12, 1.6, cx, plinth + 6, z, 0.2); ovenFront(g, cx, plinth + 12, mw - 0.6, body - 13, z); hobX = cx; }
      x += mw;
    }
    // sink: stainless bowl set into the granite, with a tap behind it
    cyl(g, mat('#B4B8BB', { rough: 0.3, metal: 0.85 }), 21, 21, 0.5, sinkX, h + 0.1, 2, 40); // round undermount bowl
    cyl(g, mat('#6E7274', { rough: 0.35, metal: 0.8 }), 18.5, 18.5, 0.4, sinkX, h + 0.3, 2, 40);
    cyl(g, STEEL(), 1.4, 1.6, 26, sinkX, h + 13, -d / 2 + 8, 16); const spout = part(g, STEEL(), 2.2, 2.2, 20, sinkX, h + 25, -d / 2 + 17, 1); spout.rotation.x = -0.15;
    // hob: black glass with faint rings
    part(g, BLACK_GLASS(), 58, 0.6, 50, hobX, h + 0.2, 1, 1);
    for (const [ox, oz, r] of [[-14, -11, 9], [14, -11, 7], [-14, 12, 7], [14, 12, 9]]) { const ring = new T3.Mesh(new T3.RingGeometry(r - 0.6, r, 32), mat('#3A3A3A', { rough: 0.4 })); ring.rotation.x = -Math.PI / 2; ring.position.set(hobX + ox, h + 0.55, 1 + oz); g.add(ring); }
    // marble splashback, wall units over the sink side, angled hood over the hob; these hang on the wall, so they
    // go in their own group that the room fades out together with that wall
    const up = new T3.Group(); g.add(up); g.userData.wallMounted = up; const gFloor = g; g = up;
    part(g, mat('#F3F1EC', { rough: 0.12, map: texFor('marble', w, 55) }), w, 55, 1.5, 0, h + 27.5, -d / 2 + 0.75);
    // marble also wraps onto the side wall at the hob end
    part(g, mat('#F3F1EC', { rough: 0.12, map: texFor('marble', d, 110) }), 1.5, 110, d, w / 2 - 0.75, h + 55, 0);
    const wallW = Math.max(0, hobX - 31 - (-w / 2)), nU = wallW > 70 ? 2 : 1; // two gloss wall units over dishwasher and sink
    for (let i = 0; i < nU; i++) { const uw = wallW / nU, cx = -w / 2 + uw * (i + 0.5); part(g, gloss, uw - 0.6, 50, 34, cx, h + 55 + 25, -d / 2 + 17, 0.4); part(g, STEEL(), uw * 0.4, 1.2, 2, cx, h + 55 + 3, -d / 2 + 35, 0.5); }
    // angled wall hood: white body, pale glass face in a white frame, lights underneath
    // the panel leans back from its lower front edge (about 40 cm out over the hob) to the wall
    const white = mat('#F4F4F2', { rough: 0.2 }), hood = new T3.Group(); hood.position.set(hobX, h + 65, -d / 2 + 40); hood.rotation.x = -0.72; g.add(hood);
    part(hood, white, 60, 56, 7, 0, 28, -3.5, 0.8);
    const glass = mat('#E6EBED', { rough: 0.05, metal: 0.25 }); glass.envMapIntensity = 1.4; part(hood, glass, 44, 34, 0.6, 0, 29, 0.2, 0.2);
    part(hood, STEEL(), 44, 1.2, 0.8, 0, 12, 0.3, 0.2);
    part(g, white, 60, 26, 16, hobX, h + 112, -d / 2 + 8, 0.8); // body against the wall
    for (const ox of [-15, 15]) cyl(g, mat('#FFFFFF', { emissive: '#FFFFFF', emissiveIntensity: 0.8 }), 2.5, 2.5, 0.4, hobX + ox, h + 63, -d / 2 + 36, 16);
    g = gFloor;
  };
  // Tall units as in the house: two dark oak columns, the right one with a compact oven over a full oven
  B.tallOvens = (g, w, d, h, c) => { // c: oak colour
    const oak = wood(c, w, h), plinth = 10, body = h - plinth, z = d / 2 - 0.8, cw = w / 2;
    part(g, mat('#2A2A2A'), w - 2, plinth, d - 8, 0, plinth / 2, -3);
    part(g, mat('#3A3531', { rough: 0.6 }), w - 4, body, d - 2, 0, plinth + body / 2, -1);
    for (const sx of [-1, 1]) part(g, mat('#F4F4F2', { rough: 0.35 }), 2, h, d, sx * (w / 2 - 1), h / 2, 0); // white end panels, as in the house
    const bar = (x, y, len) => part(g, STEEL(), 1.4, len, 2.2, x, y, z + 1.6, 0.6);
    // left column: tall door over a lower door
    const lx = -cw / 2, d1 = body * 0.62;
    part(g, oak, cw - 0.6, d1 - 0.6, 1.6, lx, plinth + body - d1 / 2, z, 0.2); bar(lx + cw / 2 - 5, plinth + body - d1 + 22, 30);
    part(g, oak, cw - 0.6, body - d1 - 0.6, 1.6, lx, plinth + (body - d1) / 2, z, 0.2); bar(lx + cw / 2 - 5, plinth + body - d1 - 22, 30);
    // right column: top door, compact oven, oven, bottom door
    const rx = cw / 2, oH = 59, cH = 45, bottom = Math.max(20, body * 0.3), ovenY = plinth + bottom;
    part(g, oak, cw - 0.6, bottom - 0.6, 1.6, rx, plinth + bottom / 2, z, 0.2); bar(rx - cw / 2 + 5, plinth + bottom - 12, 20);
    ovenFront(g, rx, ovenY, cw - 1, oH, z); ovenFront(g, rx, ovenY + oH + 1, cw - 1, cH, z);
    const topY = ovenY + oH + cH + 2, topH = plinth + body - topY;
    if (topH > 5) { part(g, oak, cw - 0.6, topH - 0.6, 1.6, rx, topY + topH / 2, z, 0.2); bar(rx - cw / 2 + 5, topY + 15, 20); }
  };
  // ---------- Kitchen islands and drawer runs ----------
  const OAK_TOP = (w, d) => wood('#BE8E57', w, d);
  const knob = (g, m, x, y, z) => sphere(g, m, 1.3, x, y, z + 1, 0.8);
  // Shaker front: flat frame with a recessed centre panel
  function shaker(g, m, fw, fh, x, y, z) {
    part(g, m, fw - 0.4, fh - 0.4, 1.8, x, y, z, 0.3);
    part(g, mat(shade(m.userData.hex || '#F4F2EC', 0.94), { rough: 0.5 }), fw - 12, fh - 12, 0.6, x, y, z + 0.7);
  }
  // IKEA VADHOLMA: black beech frame, butcher-block oak top, two slatted shelves, centre partition.
  // style 'vadholmarack' adds the rack: two posts, a slatted top shelf and a hanging rail (h = rack top, worktop stays at 90)
  B.vadholma = (g, w, d, h, c, it) => {
    const rack = it && it.style === 'vadholmarack', top = rack ? 90 : h, fr = mat(c, { rough: 0.55 }), t = 4.5;
    part(g, OAK_TOP(w, d), w, 4, d, 0, top - 2, 0, 0.4);
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => part(g, fr, t, top - 4, t, sx * (w / 2 - t / 2 - 1), (top - 4) / 2, sz * (d / 2 - t / 2 - 1)));
    [1, -1].forEach((s) => part(g, fr, w - 2, 7, 2, 0, top - 7.5, s * (d / 2 - 2)));
    part(g, mat(shade(c, 1.15), { rough: 0.6 }), w - 2 * t - 2, top - 30, 1.2, 0, 17 + (top - 30) / 2 + 3, 0); // centre partition
    [12, 46].forEach((y) => {
      [1, -1].forEach((s) => part(g, fr, w - 2 * t - 2, 4, 2.5, 0, y, s * (d / 2 - 3)));
      const n = Math.floor((w - 2 * t - 6) / 5.2);
      for (let k = 0; k < n; k++) part(g, fr, 2.8, 1.6, d - 7, -w / 2 + t + 4 + k * 5.2, y + 1.5, 0);
    });
    if (!rack) return;
    const tube = mat(c, { rough: 0.4, metal: 0.6 }), px = w / 2 - 3, rh = h - top;
    [-1, 1].forEach((s) => cyl(g, tube, 1.3, 1.3, rh + 2, s * px, top + rh / 2, 0, 12));
    const topBar = cyl(g, tube, 1.3, 1.3, 2 * px, 0, h - 1.3, 0, 12); topBar.rotation.z = Math.PI / 2;
    part(g, fr, 2 * px - 3, 1.5, 22, 0, h - 26, 0, 0.3); // slatted top shelf
    const rail = cyl(g, tube, 0.8, 0.8, 2 * px, 0, h - 34, 0, 10); rail.rotation.z = Math.PI / 2;
    // a few sample pans on S-hooks, as in the IKEA photo
    const M = { copper: mat('#C27A45', { rough: 0.24, metal: 1 }), steel: mat('#D2D5D7', { rough: 0.22, metal: 1 }), iron: mat('#2A2B2E', { rough: 0.55, metal: 0.5 }) };
    [-0.22, 0, 0.22].forEach((f, k) => hangPan(g, M, f * w, h - 34.8, 0, 34, k, k % 2 ? 1 : -1));
  };
  // home24 Hestia VII: white shaker body on casters, oak-look top, 2 drawers over 2 doors with an open middle,
  // spice racks on both ends, a towel bar and a drop leaf folded down at the back. w includes the end racks.
  B.hestia = (g, w, d, h, c) => {
    const m = mat(c, { rough: 0.45 }); m.userData.hex = c;
    const bw = w - 24.5, bd = d - 5.5, topW = Math.min(w, bw + 3), tt = 3, body0 = 9.2, bodyH = h - tt - body0, fz = bd / 2 - 3;
    part(g, OAK_TOP(topW, d), topW, tt, d, 0, h - tt / 2, 0, 0.4);
    part(g, OAK_TOP(topW, 25), topW, 25, 1.8, 0, h - tt - 12.5, -d / 2 - 1); // drop leaf, down
    part(g, m, bw, bodyH, bd - 1, 0, body0 + bodyH / 2, -3, 0.4);
    part(g, m, bw + 1.5, 5, bd + 0.5, 0, body0 + 2.5, -2.8, 0.6); // shaped base rail
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => { const wh = cyl(g, mat('#1E1E1E', { rough: 0.6 }), 3.2, 3.2, 2.4, sx * (bw / 2 - 6), 3.4, sz * (bd / 2 - 8), 16); wh.rotation.z = Math.PI / 2; });
    const dh = 15.8, dy = h - tt - dh / 2 - 1.5, br = METAL_DARK();
    [-1, 1].forEach((s) => { shaker(g, m, 52.2, dh, s * 26.8, dy, fz); knob(g, br, s * 26.8, dy, fz + 0.9); });
    const lowTop = dy - dh / 2 - 1, lowH = lowTop - body0 - 5, doorW = (bw - 34) / 2 - 1;
    [-1, 1].forEach((s) => { const x = s * (17 + doorW / 2 + 0.5); shaker(g, m, doorW, lowH, x, body0 + 5 + lowH / 2, fz); knob(g, br, x - s * (doorW / 2 - 4), body0 + 5 + lowH * 0.6, fz + 0.9); });
    part(g, mat(shade(c, 0.86), { rough: 0.6 }), 32, lowH - 2, 1, 0, body0 + 5 + lowH / 2, fz - 20); // open middle: back
    part(g, m, 32, 1.6, 22, 0, body0 + 5 + lowH / 2, fz - 10); // middle shelf
    [-1, 1].forEach((s) => { // end racks: three shelves with guard rails
      const x = s * (bw / 2 + 6.1);
      part(g, m, 12, bodyH, 1.4, x, body0 + bodyH / 2, -bd / 2 + 6);
      [0.12, 0.45, 0.78].forEach((f) => { const y = body0 + bodyH * f; part(g, m, 11.5, 1.4, 44, x, y, -2); part(g, m, 1, 1, 44, x + s * 5.5, y + 5, -2); });
    });
    const bar = cyl(g, mat('#EDEDEA', { rough: 0.3, metal: 0.4 }), 0.9, 0.9, 40, w / 2 - 1, h - tt - 14, -2, 10); bar.rotation.x = Math.PI / 2;
  };
  // home24 Pattburg: two-sided island block, oak-look top. Front: open niche over a wide drawer, door on the right.
  // Back: door on the left, three drawers on the right. Bar handles.
  B.pattburg = (g, w, d, h, c) => {
    const light = new T3.Color(c).getHSL({}).l > 0.6, m = mat(c, { rough: light ? 0.15 : 0.6 }), tt = 3.8, pl = 10, bh = h - tt - pl;
    part(g, OAK_TOP(w, d), w, tt, d, 0, h - tt / 2, 0, 0.4);
    part(g, mat('#222222', { rough: 0.8 }), w - 6, pl, d - 10, 0, pl / 2, 0);
    const bar = (x, y, z, len, s) => part(g, mat(light ? '#BFC2C4' : '#8E9092', { rough: 0.3, metal: 0.9 }), len, 1.2, 1.6, x, y, z + s * 1.2, 0.5);
    const zf = d / 2 - 0.4, rw = 48, lw = w - 1 - rw, lx = -w / 2 + 0.5 + lw / 2, rx = w / 2 - 0.5 - rw / 2, gap = mat(shade(c, light ? 0.8 : 0.6), { rough: 0.7 });
    // body built around an open niche on the front (+z): back block, right column, and the left part below and above the niche
    const bd = d - 1.5, fd = 21, back = bd - fd, zc = bd / 2 - fd / 2, nh = bh * 0.38, lowH = bh - nh - 4;
    part(g, m, w - 1, bh, back, 0, pl + bh / 2, -bd / 2 + back / 2, 0.3);
    part(g, m, rw, bh, fd, rx, pl + bh / 2, zc, 0.3);
    part(g, m, lw, lowH, fd, lx, pl + lowH / 2, zc, 0.3);
    part(g, m, lw, 4, fd, lx, pl + bh - 2, zc, 0.3);
    part(g, m, 2, nh, fd, -w / 2 + 1.5, pl + lowH + nh / 2, zc);
    part(g, mat(shade(c, light ? 0.8 : 1.35), { rough: 0.8 }), lw - 3, nh, 0.5, lx + 1, pl + lowH + nh / 2, zc - fd / 2 + 0.3); // niche back, a shade off
    // front (+z)
    part(g, gap, 0.5, bh, 0.6, lx + lw / 2, pl + bh / 2, zf);
    bar(lx, pl + lowH - 8, zf, lw * 0.75, 1);
    bar(rx, pl + bh - 10, zf, rw * 0.7, 1);
    // back (-z)
    part(g, gap, 0.5, bh, 0.6, -lx - lw / 2, pl + bh / 2, -zf);
    for (let k = 1; k < 3; k++) part(g, gap, lw, 0.5, 0.6, -lx, pl + (bh * k) / 3, -zf);
    for (let k = 0; k < 3; k++) bar(-lx, pl + (bh * (k + 1)) / 3 - 6, -zf, lw * 0.75, -1);
    bar(-rx, pl + bh - 10, -zf, rw * 0.7, -1);
  };
  // A run of IKEA METOD/MAXIMERA drawer cabinets (style metod3 / metod4 = drawers per cabinet): 80 or 60 cm cabinets,
  // matching cover panels, plinth, oak worktop and brass handles. Taller than 120 cm: a high cabinet with two doors over drawers.
  B.metodRun = (g, w, d, h, c, it) => {
    const rows = it && it.style === 'metod4' ? [0.25, 0.25, 0.25, 0.25] : [0.25, 0.25, 0.5], tall = h > 120;
    const m = mat(c, { rough: 0.55 }), brass = METAL_BRASS(), pl = 8, tt = tall ? 0 : 3.8, bh = (tall ? h : Math.min(h, 91.8)) - pl - tt;
    const n = Math.max(1, Math.round(w / (w % 80 < 1 || w >= 160 ? 80 : 60))), cw = w / n, fz = d / 2 - 1.2 - (tall ? 0 : 1.9);
    if (!tall) part(g, OAK_TOP(w, d), w, tt, d, 0, h - tt / 2, 0, 0.4);
    part(g, mat(c, { rough: 0.6 }), w - 2, pl, d - 8, 0, pl / 2, -3);
    part(g, m, w, bh, d - 4.5 - (tall ? 0 : 1.9), 0, pl + bh / 2, -2.2 - (tall ? 0 : 0.95));
    const dr = tall ? 80 - pl : bh;
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + cw * (k + 0.5); let y = pl;
      rows.forEach((f) => { const fh = dr * f; part(g, m, cw - 0.4, fh - 0.4, 1.9, x, y + fh / 2, fz, 0.3); part(g, brass, Math.min(16, cw * 0.3), 1, 1.4, x, y + fh - 4, fz + 1.6, 0.4); y += fh; });
      if (tall) { const uh = h - pl - dr, dh = uh / 2; [0, 1].forEach((j) => { part(g, m, cw - 0.4, dh - 0.4, 1.9, x, pl + dr + dh * (j + 0.5), fz, 0.3); part(g, brass, 1.2, 12, 1.4, x + cw / 2 - 5, pl + dr + dh * j + (j ? 10 : dh - 10), fz + 1.6, 0.4); }); }
    }
  };
  B.counter = (g, w, d, h, c, it) => {
    const st = it && it.style;
    if (st === 'fitted') return B.fittedKitchen(g, w, d, h, c);
    if (st === 'vadholma' || st === 'vadholmarack') return B.vadholma(g, w, d, h, c, it);
    if (st === 'hestia') return B.hestia(g, w, d, h, c);
    if (st === 'pattburg') return B.pattburg(g, w, d, h, c);
    if (st === 'metod3' || st === 'metod4') return B.metodRun(g, w, d, h, c, it);
    // light fronts get a gloss finish and a dark granite top; dark fronts get a pale stone top
    const light = new T3.Color(c).getHSL({}).l > 0.6, top = 4, m = mat(c, { rough: light ? 0.18 : 0.5 });
    const topM = light ? mat('#4F443D', { rough: 0.15, map: texFor('granite', w, d) }) : mat('#E9E6E0', { rough: 0.2, map: texFor('terrazzo', w, d) });
    topM.envMapIntensity = 1;
    part(g, mat('#2A2A2A'), w - 4, 10, d - 8, 0, 5, -3);
    part(g, m, w, h - top - 10, d - 3, 0, 10 + (h - top - 10) / 2, -1.5, 0.4);
    part(g, topM, w, top, d, 0, h - top / 2, 0, 0.5);
    const n = Math.max(1, Math.round(w / 60)), dw = w / n;
    for (let k = 0; k < n; k++) { part(g, METAL_DARK(), dw * 0.4, 1.2, 1.5, -w / 2 + dw * (k + 0.5), h - top - 6, d / 2 - 1.2, 0.5); if (k) part(g, mat(shade(c, 0.8)), 0.4, h - top - 12, 0.5, -w / 2 + dw * k, 10 + (h - top - 10) / 2, d / 2 - 2.8); }
  };
  B.appliance = (g, w, d, h, c, it) => {
    if (it && it.style === 'tallovens') return B.tallOvens(g, w, d, h, c);
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
  B.bath = (g, w, d, h, c, it) => { // built-in tub with a tiled front; style 'screen' adds a glass shower screen and mixer
    if (it && it.style === 'screen') {
      const glass = mat('#E4EEF2', { rough: 0.03, transparent: true, opacity: 0.2 }); glass.envMapIntensity = 1.3;
      part(g, glass, 0.8, 140, Math.min(80, d - 4), -w / 2 + 40, h + 70, 0);
      part(g, mat('#C8CCCE', { rough: 0.2, metal: 0.9 }), 1.2, 140, 1.2, -w / 2 + 40, h + 70, -d / 2 + 2);
      part(g, mat('#C8CCCE', { rough: 0.2, metal: 0.9 }), 1.5, 90, 1.5, -w / 2 + 20, h + 75, -d / 2 + 2.5);
      part(g, mat('#C8CCCE', { rough: 0.2, metal: 0.9 }), 22, 5, 5, 0, h + 20, -d / 2 + 3, 2);
    }
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
  // Sauna cabin: spruce panelling, glass door on the front, small window strip
  B.sauna = (g, w, d, h, c) => {
    const m = mat(c, { rough: 0.7, map: texFor('panelling', w, h), bump: texFor('panelling', w, h), bumpScale: 0.5 });
    part(g, m, w, h, d, 0, h / 2, 0, 1);
    const glass = mat('#9DB3BC', { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.55 }); glass.envMapIntensity = 1.2;
    part(g, glass, 60, 185, 1, -w / 2 + 45, 95, d / 2 + 0.3, 0.5);
    part(g, mat('#C9CCCE', { rough: 0.2, metal: 0.9 }), 2, 30, 3, -w / 2 + 70, 100, d / 2 + 2, 0.8);
  };
  // Copper pot racks (Proper Copper Design style): 22 mm pipe, S-hooks, copper and cast-iron pans.
  // h runs from the lowest pan up to the top: the ceiling for ceiling racks (rail 20 cm below it), the rail for wall rails.
  const pipeX = (g, m, len, r, x, y, z) => { const p = cyl(g, m, r, r, len, x, y, z, 16); p.rotation.z = Math.PI / 2; return p; };
  const pipeZ = (g, m, len, r, x, y, z) => { const p = cyl(g, m, r, r, len, x, y, z, 16); p.rotation.x = Math.PI / 2; return p; };
  // One pan on an S-hook. face: +1 / -1 = open side towards +z / -z; 'wall' = hangs flat, bottom out, against a wall at wallZ
  function hangPan(g, M, x, yHook, z, span, k, face, wallZ) {
    const [R0, dep, kind] = [[9, 9, 'pan'], [12.5, 4.5, 'fry'], [7.5, 7.5, 'pan'], [11, 4, 'iron']][k % 4], off = [0, 3, 1.5, 4.5][k % 4], hookL = 4;
    const R = Math.min(R0, (span - hookL - 6 - off) / 2); if (R < 3) return;
    const handle = span - hookL - off - 2 * R, bodyZ = face === 'wall' ? wallZ + dep / 2 + 0.4 : z;
    const ring = new T3.Mesh(new T3.TorusGeometry(1.5, 0.22, 6, 16), M.steel); ring.position.set(x, yHook, z); ring.rotation.y = Math.PI / 2; g.add(ring);
    cyl(g, M.steel, 0.22, 0.22, hookL - 1.5, x, yHook - 1.5 - (hookL - 1.5) / 2, z, 6);
    const hy = yHook - hookL, hm = kind === 'iron' ? M.iron : M.steel;
    part(g, hm, 1.8, handle, 1, x, hy - handle / 2, (z + bodyZ) / 2);
    const cy = hy - handle - R + 0.5, body = cyl(g, kind === 'iron' ? M.iron : M.copper, R, R * 0.97, dep, x, cy, bodyZ, 40); body.rotation.x = Math.PI / 2;
    if (face !== 'wall') { const inner = cyl(g, kind === 'iron' ? M.iron : M.steel, R - 0.8, R - 0.8, 0.4, x, cy, bodyZ + face * dep / 2, 32); inner.rotation.x = Math.PI / 2; }
  }
  B.potrack = (g, w, d, h, c, it, opts) => {
    const style = (it && it.style) || 'rail', cu = mat(c, { rough: 0.28, metal: 1 }), pr = 1.1;
    const M = { copper: mat('#C27A45', { rough: 0.24, metal: 1 }), steel: mat('#D2D5D7', { rough: 0.22, metal: 1 }), iron: mat('#2A2B2E', { rough: 0.55, metal: 0.5 }) };
    const along = (x0, x1, n) => Array.from({ length: n }, (_, k) => x0 + ((x1 - x0) * (k + 0.5)) / n);
    if (style === 'wall') { // one rail on brass wall brackets, pans hanging flat against the wall
      const railY = h - 3, z0 = -d / 2 + 4.5;
      pipeX(g, cu, w, pr, 0, railY, z0);
      [-1, 1].forEach((s) => pipeX(g, cu, 1.2, pr + 0.25, s * (w / 2 - 0.6), railY, z0));
      (w > 100 ? [-w / 2 + 5, 0, w / 2 - 5] : [-w / 2 + 5, w / 2 - 5]).forEach((x) => {
        part(g, METAL_BRASS(), 1.6, 1.6, 4.5, x, railY, -d / 2 + 2.25);
        pipeZ(g, METAL_BRASS(), 0.4, 2.2, x, railY, -d / 2 + 0.2);
      });
      along(-w / 2 + 8, w / 2 - 8, Math.max(2, Math.floor((w - 16) / 24))).forEach((x, k) => hangPan(g, M, x, railY - pr, z0, railY - pr - 1, k, 'wall', -d / 2));
      g.userData.wallMounted = g;
      return;
    }
    // ceiling racks: rods up to the ceiling (roomTop), with a small ceiling cup
    const railY = h - 20, top = Math.max(h, (opts && opts.roomTop) || h), span = railY - pr - 1;
    const rod = (x, z) => { cyl(g, cu, 0.55, 0.55, top - railY, x, (top + railY) / 2, z, 8); cyl(g, cu, 2.2, 2.2, 0.8, x, top - 0.4, z, 20); };
    if (style === 'rail') {
      pipeX(g, cu, w, pr, 0, railY, 0);
      [-1, 1].forEach((s) => { pipeX(g, cu, 1.2, pr + 0.25, s * (w / 2 - 0.6), railY, 0); rod(s * (w / 2 - 6), 0); });
      along(-w / 2 + 8, w / 2 - 8, Math.max(2, Math.floor((w - 16) / 17))).forEach((x, k) => hangPan(g, M, x, railY - pr, 0, span, k, k % 2 ? 1 : -1));
      return;
    }
    const zs = (d - 8) / 2, rc = Math.min(zs - 1, 11);
    if (style === 'curved') { // one bent loop with two cross struts
      const pts = [], q = [[w / 2 - rc, zs - rc, 0], [-(w / 2 - rc), zs - rc, Math.PI / 2], [-(w / 2 - rc), -(zs - rc), Math.PI], [w / 2 - rc, -(zs - rc), Math.PI * 1.5]];
      q.forEach(([cx, cz, a0]) => { for (let s = 0; s <= 6; s++) { const a = a0 + (s / 6) * Math.PI / 2; pts.push(new T3.Vector3(cx + Math.cos(a) * rc, railY, cz + Math.sin(a) * rc)); } });
      const loop = new T3.Mesh(new T3.TubeGeometry(new T3.CatmullRomCurve3(pts, true, 'centripetal'), 160, pr, 10, true), cu); loop.castShadow = true; g.add(loop);
      [-0.22, 0.22].forEach((k) => pipeZ(g, cu, 2 * zs, pr * 0.8, w * k, railY, 0));
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => rod(sx * (w / 2 - rc), sz * zs));
    } else { // ladder: two long rails and three rungs
      [-1, 1].forEach((s) => pipeX(g, cu, w, pr, 0, railY, s * zs));
      [-w / 2 + 2, 0, w / 2 - 2].forEach((x) => pipeZ(g, cu, 2 * zs, pr, x, railY + 0.3, 0));
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => rod(sx * (w / 2 - 14), sz * zs));
    }
    const inset = style === 'curved' ? rc + 2 : 6, n = Math.max(2, Math.floor((w - 2 * inset) / 20));
    [-1, 1].forEach((s, j) => along(-w / 2 + inset, w / 2 - inset, n).forEach((x, k) => hangPan(g, M, x, railY - pr, s * zs, span, k + j * 2, s)));
  };
  B.box = (g, w, d, h, c, it) => {
    if (it && it.style === 'sauna') return B.sauna(g, w, d, h, c); part(g, mat(c, { rough: 0.7 }), w, h, d, 0, h / 2, 0, 1.5); };

  // ---------- Wall art ----------
  // Picture textures are cached by photo id and kept across rebuilds (tex.keep)
  const artCache = new Map(), readyImgs = new Map();
  // Load a picture ahead of time, so a thumbnail can be drawn with it straight away
  HM.preloadImage = (url) => readyImgs.has(url) ? Promise.resolve() : new Promise((res) => {
    const img = new Image(); img.onload = () => { readyImgs.set(url, img); res(); }; img.onerror = () => res(); img.src = url;
  });
  function pictureTexture(url, key, aspect) {
    const ck = key + '@' + aspect.toFixed(3);
    if (artCache.has(ck)) return artCache.get(ck);
    const ready = readyImgs.get(url), img = ready || new Image(), tex = new T3.Texture(img);
    tex.encoding = T3.sRGBEncoding; tex.anisotropy = 8; tex.keep = true;
    const crop = () => { // crop to fill the opening (like a print trimmed to the frame)
      const ia = img.width / img.height;
      if (ia > aspect) { tex.repeat.set(aspect / ia, 1); tex.offset.set((1 - aspect / ia) / 2, 0); } else { tex.repeat.set(1, ia / aspect); tex.offset.set(0, (1 - ia / aspect) / 2); }
      tex.needsUpdate = true;
    };
    if (ready) crop(); else { img.onload = () => { readyImgs.set(url, img); crop(); }; img.src = url; }
    artCache.set(ck, tex); return tex;
  }
  // Placeholder print: soft abstract shapes in muted colours, different for every artwork
  function placeholderArt(key, aspect) {
    const ck = 'ph:' + key + '@' + aspect.toFixed(2);
    if (artCache.has(ck)) return artCache.get(ck);
    const W = 512, H = Math.round(512 / aspect), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 2147483647; seed = h || 7;
    const pal = [['#E9E2D3', '#C8A27A', '#6E7F73', '#2F3A40', '#D8B7A4'], ['#F1ECE4', '#A7B6C2', '#3D4A5C', '#C99D4A', '#E3C6BC'], ['#EFE9DD', '#B4BFA6', '#8C6A4F', '#1F2A36', '#D6CCBC']][Math.floor(rnd() * 3)];
    g.fillStyle = pal[0]; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = pal[1 + Math.floor(rnd() * 4)]; g.globalAlpha = 0.75 + rnd() * 0.25; g.beginPath();
      if (rnd() < 0.5) g.arc(rnd() * W, rnd() * H, (0.12 + rnd() * 0.3) * Math.min(W, H), 0, 7);
      else { const x = rnd() * W, y = rnd() * H; g.ellipse(x, y, (0.1 + rnd() * 0.35) * W, (0.05 + rnd() * 0.2) * H, rnd() * 3, 0, 7); }
      g.fill();
    }
    g.globalAlpha = 0.08; for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * W, rnd() * H, 1, 1); } g.globalAlpha = 1;
    const tex = new T3.CanvasTexture(c); tex.encoding = T3.sRGBEncoding; tex.keep = true; artCache.set(ck, tex); return tex;
  }
  const FRAME_COLORS = { black: '#1D1D1D', white: '#F2F1EC', oak: '#C49A6C', limewash: '#CDBFA6', pine: '#A56E3D', walnut: '#5C3A22', brass: '#B89559' };
  const MAT_COLORS = { white: '#F7F5EF', cream: '#EDE3CC' };
  // Presentation oar on two leather wall hooks, as on the wall at home: dark green painted blade (on the left) with the
  // crew painted on in gold and the college crest, a green collar tapering onto a pale varnished shaft, rounded handle end
  let oarFace = null;
  function oarTexture() {
    if (oarFace) return oarFace;
    const W = 1024, H = 272, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1B4B2E'); gr.addColorStop(0.5, '#143D25'); gr.addColorStop(1, '#0E2E1B');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    const gold = '#D9B45A', tx = 0.66 * W; // lettering stays on the full-height part of the blade
    x.strokeStyle = gold; x.lineWidth = 3; x.beginPath(); x.moveTo(18, 34); x.lineTo(tx, 34); x.moveTo(18, H - 30); x.lineTo(tx, H - 30); x.stroke();
    x.fillStyle = gold; x.textBaseline = 'middle';
    let fs = 28; do { x.font = `bold ${fs}px Georgia, serif`; fs--; } while (x.measureText("GREEN TEMPLETON COLLEGE MEN'S 1st TORPID").width > tx - 30 && fs > 12);
    x.fillText("GREEN TEMPLETON COLLEGE MEN'S 1st TORPID", 22, 18);
    // the crew, painted in gold script (made-up names: it only has to read as lettering from across the room)
    let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const syl = ['al', 'ben', 'ca', 'dor', 'el', 'fin', 'gar', 'har', 'is', 'jon', 'ker', 'lan', 'mor', 'nel', 'or', 'per', 'ros', 'sam', 'tor', 'wen'];
    const word = (n) => { let t = ''; for (let k = 0; k < n; k++) t += syl[Math.floor(r() * syl.length)]; return t[0].toUpperCase() + t.slice(1); };
    const column = (x0, labels) => labels.forEach((lb, k) => {
      const y = 66 + k * 44; x.font = 'bold 24px Georgia, serif'; x.fillText(lb, x0, y);
      x.font = 'italic 27px "Brush Script MT", "Apple Chancery", "Snell Roundhand", "URW Chancery L", cursive, Georgia, serif';
      x.fillText(word(1 + Math.floor(r() * 2)) + ' ' + word(2), x0 + 58, y, 0.2 * W);
    });
    column(22, ['Bow', '2', '3', '4']); column(0.385 * W, ['5', '6', '7', 'Str']);
    // crest: white shield with a green chevron
    const cx = 0.335 * W, cy = H / 2 + 4; // between the two columns
    x.fillStyle = '#F4F1E8'; x.beginPath(); x.moveTo(cx - 30, cy - 38); x.lineTo(cx + 30, cy - 38); x.lineTo(cx + 30, cy + 6); x.quadraticCurveTo(cx + 30, cy + 34, cx, cy + 44); x.quadraticCurveTo(cx - 30, cy + 34, cx - 30, cy + 6); x.closePath(); x.fill();
    x.strokeStyle = gold; x.lineWidth = 3; x.stroke();
    x.strokeStyle = '#1F5634'; x.lineWidth = 9; x.beginPath(); x.moveTo(cx - 24, cy + 16); x.lineTo(cx, cy - 12); x.lineTo(cx + 24, cy + 16); x.stroke();
    x.fillStyle = '#1F5634'; x.beginPath(); x.arc(cx, cy - 24, 6, 0, 7); x.fill();
    oarFace = new T3.CanvasTexture(c); oarFace.encoding = T3.sRGBEncoding; oarFace.anisotropy = 8; oarFace.keep = true;
    return oarFace;
  }
  B.oar = (g, w, d, h, c) => {
    const R = 1.9, zc = -d / 2 + 5.2, yc = h / 2, x0 = -w / 2, bladeL = Math.min(64, w * 0.43), hh = h / 2, bt = 1.1;
    // blade outline (local x from the tip, y from the blade centre line)
    const sh = new T3.Shape(), L = bladeL;
    sh.moveTo(0, -hh + 3); sh.quadraticCurveTo(0, -hh, 3, -hh); sh.lineTo(L * 0.67, -hh);
    sh.bezierCurveTo(L * 0.8, -hh, L * 0.84, -R * 1.25, L, -R * 1.05); sh.lineTo(L, R * 1.05);
    sh.bezierCurveTo(L * 0.84, R * 1.25, L * 0.8, hh, L * 0.67, hh); sh.lineTo(3, hh); sh.quadraticCurveTo(0, hh, 0, hh - 3);
    const geo = new T3.ExtrudeGeometry(sh, { depth: bt, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 2, curveSegments: 24 });
    const tex = oarTexture().clone(); tex.needsUpdate = true; tex.repeat.set(1 / L, 1 / h); tex.offset.set(0, 0.5); tex.keep = true;
    const face = new T3.MeshPhysicalMaterial({ map: tex, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }), edge = mat('#0F2F1C', { rough: 0.3 });
    const blade = new T3.Mesh(geo, [face, edge]); blade.position.set(x0, yc, zc - bt / 2); blade.castShadow = true; g.add(blade);
    // green collar tapering onto the shaft, then the varnished pine shaft and a slightly fatter rounded handle
    const green = new T3.MeshPhysicalMaterial({ color: lin('#143D25'), roughness: 0.3, clearcoat: 0.8 });
    const col = cyl(g, green, R * 1.05, R * 1.25, 22, x0 + L + 9, yc, zc, 24); col.rotation.z = Math.PI / 2;
    const pine = new T3.MeshPhysicalMaterial({ color: lin('#C58A4C'), roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2, map: texFor('grain', 60, 6) });
    const shaftL = w - L - 20 - 14;
    const shaft = cyl(g, pine, R, R, shaftL, x0 + L + 20 + shaftL / 2, yc, zc, 24); shaft.rotation.z = Math.PI / 2;
    const hnd = cyl(g, pine, R * 1.15, R, 14, w / 2 - 7, yc, zc, 24); hnd.rotation.z = Math.PI / 2;
    sphere(g, pine, R * 1.15, w / 2 - 0.2, yc, zc, 1).scale.set(0.35, 1, 1);
    // two leather hooks: a strap screwed to the wall, looping over and round the front of the shaft
    const leather = mat('#8A4B24', { rough: 0.6 });
    for (const f of [0.47, 0.93]) {
      const hx = x0 + w * f;
      part(g, leather, 3, 7, 0.5, hx, yc + R + 3.5, -d / 2 + 0.25, 0.2);
      part(g, leather, 3, 0.5, 2 * R + 3.6, hx, yc + R + 0.25, zc - 0.4, 0.2);
      part(g, leather, 3, 2 * R + 1.5, 0.5, hx, yc + 0.2, zc + R + 0.25, 0.2);
      sphere(g, mat('#B89559', { rough: 0.3, metal: 0.9 }), 0.5, hx, yc + R + 5, -d / 2 + 0.6, 0.6);
    }
  };

  // Local space: back against the wall at -z, picture facing +z, from y = 0 (bottom edge) to h
  B.art = (g, w, d, h, c, it, opts) => {
    if (it && it.style === 'oar') return B.oar(g, w, d, h, c);
    if (it && it.frame === 'oakpanel') { // oak 3D feature panel mounted on the wall
      const m = HM.wallMaterial('#C9A06A', 'oakpanels', w, h); m.transparent = false;
      part(g, m, w, h, Math.max(d, 2), 0, h / 2, -d / 2 + Math.max(d, 2) / 2);
      return;
    }
    const frame = (it && it.frame) || 'black', canvasOnly = frame === 'none', fw = canvasOnly ? 0 : Math.max(1.5, Math.min(4, Math.min(w, h) * 0.035));
    const depth = canvasOnly ? Math.max(d, 3) : Math.max(d, 2);
    const matW = !canvasOnly && it && it.mat ? Math.min(w, h) * 0.1 : 0;
    const iw = w - 2 * fw - 2 * matW, ih = h - 2 * fw - 2 * matW, aspect = Math.max(0.05, iw / Math.max(ih, 1));
    const url = it && it.image && opts && opts.photo ? opts.photo(it.image) : null;
    const pic = url ? pictureTexture(url, it.image, aspect) : placeholderArt((it && (it.image || it.id)) || 'art', aspect);
    const picM = new T3.MeshStandardMaterial({ map: pic, roughness: canvasOnly ? 0.85 : 0.6 }); picM.envMapIntensity = 0.3;
    const z0 = -d / 2;
    if (canvasOnly) {
      // stretched canvas: picture on the front, a toned edge around it
      part(g, mat('#E8E4DC', { rough: 0.9 }), w, h, depth, 0, h / 2, z0 + depth / 2, 0.3);
      const face = new T3.Mesh(new T3.PlaneGeometry(w - 0.4, h - 0.4), picM); face.position.set(0, h / 2, z0 + depth + 0.05); g.add(face);
      return;
    }
    const fc = FRAME_COLORS[frame] || c, fm = ['oak', 'limewash', 'pine', 'walnut'].includes(frame) ? wood(fc, w, h) : mat(fc, { rough: frame === 'brass' ? 0.3 : 0.45, metal: frame === 'brass' ? 0.9 : 0 });
    part(g, fm, w, fw, depth, 0, fw / 2, z0 + depth / 2, 0.3); part(g, fm, w, fw, depth, 0, h - fw / 2, z0 + depth / 2, 0.3);
    part(g, fm, fw, h - 2 * fw, depth, -w / 2 + fw / 2, h / 2, z0 + depth / 2, 0.3); part(g, fm, fw, h - 2 * fw, depth, w / 2 - fw / 2, h / 2, z0 + depth / 2, 0.3);
    part(g, mat('#DDD8CE', { rough: 0.9 }), w - 2 * fw, h - 2 * fw, 0.4, 0, h / 2, z0 + 0.2); // backing
    if (matW) part(g, mat(MAT_COLORS[it.mat] || MAT_COLORS.white, { rough: 0.95 }), w - 2 * fw, h - 2 * fw, 0.3, 0, h / 2, z0 + depth - 0.9);
    const face = new T3.Mesh(new T3.PlaneGeometry(iw, ih), picM); face.position.set(0, h / 2, z0 + depth - (matW ? 0.7 : 0.9)); g.add(face);
    const glass = mat('#FFFFFF', { rough: 0.05, transparent: true, opacity: 0.06 }); glass.envMapIntensity = 1.2; glass.depthWrite = false;
    const gl = new T3.Mesh(new T3.PlaneGeometry(w - 2 * fw, h - 2 * fw), glass); gl.position.set(0, h / 2, z0 + depth - 0.4); g.add(gl);
  };

  // ---------- Lights ----------
  // Returns y (local) of the bulb so the caller can place a light source there
  const L = {};
  const shadeMat = (c, on, k) => mat(c, { rough: 0.85, side: T3.DoubleSide, emissive: on ? k : null, emissiveIntensity: on ? 0.9 : 0 });
  L.pendant = (g, w, d, h, c, on, k, roomTop, it) => {
    const st = it && it.style;
    if (st === 'cloud' || st === 'globe' || st === 'bamboo') return L[st](g, w, d, h, c, on, k, roomTop);
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
  L.spot = (g, w, d, h, c, on, k, top, it) => {
    if (it && it.style === 'track') return L.track(g, w, d, h, c, on, k);
    cyl(g, mat(c, { rough: 0.4, metal: 0.4 }), w / 2, w / 2, h, 0, h / 2, 0, 20);
    const lens = cyl(g, mat('#FFFFFF', { emissive: on ? k : null, emissiveIntensity: on ? 4 : 0 }), w / 2 - 1.2, w / 2 - 1.2, 0.5, 0, -0.1, 0, 20); lens.castShadow = false; return -1;
  };
  L.sconce = (g, w, d, h, c, on, k, top, it) => {
    const st = it && it.style;
    if (st === 'donut') return L.donut(g, w, d, h, c, on, k, false);
    if (st === 'uplight') return L.wallup(g, w, d, h, c, on, k);
    part(g, mat(c, { rough: 0.3, metal: 0.8 }), w * 0.5, h * 0.5, 2, 0, h * 0.5, -d / 2 + 1, 1);
    const s = cyl(g, shadeMat('#F4EFE6', on, k), w * 0.35, w * 0.5, h * 0.55, 0, h * 0.55, 0, 32); s.castShadow = false; return h * 0.55;
  };
  // HEKTAR style: heavy disc base, straight pole, oversized tilted metal bell shade (open at the bottom)
  L.hektar = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.6, metal: 0.25 }), shadeR = Math.max(w, d) / 2, baseR = shadeR * 1.08;
    cyl(g, m, baseR, baseR, 2.5, 0, 1.25, 0, 40);
    cyl(g, m, 1.3, 1.3, h - 30, 0, (h - 30) / 2, 0, 12);
    const head = new T3.Group(); head.position.set(0, h - 30, 0); head.rotation.x = 0.45; g.add(head); // tilted forward
    const bell = new T3.Mesh(new T3.CylinderGeometry(shadeR * 0.28, shadeR, 26, 40, 1, true), mat(c, { rough: 0.6, metal: 0.25, side: T3.DoubleSide })); bell.position.set(0, 16, 12); bell.castShadow = true; head.add(bell);
    const cap = new T3.Mesh(new T3.CylinderGeometry(shadeR * 0.1, shadeR * 0.28, 5, 24), m); cap.position.set(0, 31.5, 12); head.add(cap);
    const bulb = new T3.Mesh(new T3.SphereGeometry(6, 20, 14), mat('#FFF8EC', { rough: 0.2, emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 })); bulb.position.set(0, 8, 12); head.add(bulb);
    return h - 30 + 4;
  };
  L.floorlamp = (g, w, d, h, c, on, k, top, it) => {
    if (it && it.style === 'hektar') return L.hektar(g, w, d, h, c, on, k);
    if (it && ['uplighter', 'uplightread', 'arc', 'paper', 'globepole', 'lantern'].includes(it.style)) return L[it.style](g, w, d, h, c, on, k);
    if (it && it.style === 'wood') { // wooden pole and foot (LAUTERS / KINNAHULT)
      const wm = wood(c, 6, h); cyl(g, wm, w * 0.36, w * 0.4, 3, 0, 1.5, 0, 36); cyl(g, wm, 1.4, 1.6, h - 30, 0, (h - 30) / 2, 0, 12);
      const s2 = cyl(g, shadeMat('#F3EEE4', on, k), w * 0.42, w / 2, 32, 0, h - 16, 0, 40); s2.castShadow = false; return h - 18;
    }
    cyl(g, mat(c, { rough: 0.4, metal: 0.7 }), w * 0.4, w * 0.45, 2.5, 0, 1.25, 0, 32);
    cyl(g, mat(c, { rough: 0.4, metal: 0.7 }), 1, 1, h - 28, 0, (h - 28) / 2, 0, 10);
    const s = cyl(g, shadeMat('#F1EBDF', on, k), w * 0.35, w / 2, 30, 0, h - 15, 0, 36); s.castShadow = false; return h - 18;
  };
  L.tablelamp = (g, w, d, h, c, on, k, top, it) => {
    if (it && it.style === 'donut') return L.donut(g, w, d, h, c, on, k, true);
    if (it && it.style === 'mushroom') return L.mushroom(g, w, d, h, c, on, k);
    if (it && ['globe', 'pole', 'polewood', 'glassdome', 'lantern', 'cloud'].includes(it.style)) return L['t_' + it.style](g, w, d, h, c, on, k);
    const bodyH = h * 0.5; cyl(g, mat(c, { rough: 0.3 }), w * 0.2, w * 0.28, bodyH, 0, bodyH / 2, 0, 24);
    sphere(g, mat(c, { rough: 0.3 }), w * 0.28, 0, bodyH * 0.45, 0, 1.1);
    const s = cyl(g, shadeMat('#F1EBDF', on, k), w * 0.33, w / 2, h - bodyH, 0, bodyH + (h - bodyH) / 2, 0, 32); s.castShadow = false; return bodyH + 4;
  };


  // ---------- More light fixtures (IKEA-style, and uplighters for indirect light) ----------
  // Glowing glass: pale and a little glossy by day, lit from inside in the evening
  const glassGlow = (c, on, k, i) => { const m = mat(c, { rough: 0.25, emissive: on ? (k || c) : null, emissiveIntensity: on ? (i || 1.6) : 0 }); m.envMapIntensity = 0.9; return m; };
  // Soft wash of light on the wall or ceiling (indirect light), only drawn when the lights are on
  let washTex = null;
  function wash(g, w, h, x, y, z, k, up) {
    if (!washTex) { // soft oval of light, brightest at the lamp and fading out in every direction
      const c = document.createElement('canvas'); c.width = c.height = 128; const x2 = c.getContext('2d');
      const gr = x2.createRadialGradient(64, 128, 4, 64, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x2.fillStyle = gr; x2.fillRect(0, 0, 128, 128); washTex = new T3.CanvasTexture(c);
    }
    const m = new T3.MeshBasicMaterial({ map: washTex, color: new T3.Color(k || '#FFD9A0'), transparent: true, opacity: 0.22, blending: T3.AdditiveBlending, depthWrite: false });
    const pl = new T3.Mesh(new T3.PlaneGeometry(w, h), m); pl.position.set(x, y + (up === false ? -h / 2 : h / 2), z); if (up === false) pl.rotation.z = Math.PI; pl.renderOrder = 2; g.add(pl); return pl;
  }
  // Donut lamp (like IKEA VARMBLIXT): a thick ring of glass, on the wall or standing on a small base
  L.donut = (g, w, d, h, c, on, k, standing) => {
    const tube = Math.min(d / 2, w * 0.17), R = w / 2 - tube, cy = standing ? h - w / 2 : h / 2, z = standing ? 0 : -d / 2 + tube;
    const ring = new T3.Mesh(new T3.TorusGeometry(R, tube, 28, 64), glassGlow(c, on, k, 1.8)); ring.position.set(0, cy, z); ring.castShadow = true; g.add(ring);
    if (standing) { cyl(g, mat('#2A2826', { rough: 0.5 }), w * 0.22, w * 0.24, 2, 0, 1, 0, 32); cyl(g, mat('#2A2826', { rough: 0.5 }), 1.2, 1.2, cy - R - tube + 1, 0, (cy - R - tube + 3) / 2, 0, 10); }
    else cyl(g, mat('#2A2826', { rough: 0.5 }), 2.2, 2.2, 1.5, 0, cy, -d / 2 + 0.75, 20).rotation.x = Math.PI / 2; // small mount behind
    if (on && !standing) wash(g, w * 1.9, w * 1.1, 0, cy - w * 0.55, -d / 2 + 0.2, k);
    return cy;
  };
  // Mushroom table lamp: opal glass dome on a slim stem and round foot
  L.mushroom = (g, w, d, h, c, on, k) => {
    const cap = w / 2, stemH = h - cap * 0.75, m = glassGlow(c, on, k, 1.4);
    cyl(g, m, w * 0.3, w * 0.33, 2, 0, 1, 0, 40); cyl(g, m, w * 0.08, w * 0.12, stemH, 0, stemH / 2, 0, 24);
    const dome = new T3.Mesh(new T3.SphereGeometry(cap, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.scale.y = 0.75; dome.position.y = stemH; dome.castShadow = true; g.add(dome);
    const lip = new T3.Mesh(new T3.CircleGeometry(cap, 40), m); lip.rotation.x = Math.PI / 2; lip.position.y = stemH; g.add(lip);
    return stemH + 2;
  };
  // Cloud pendant (like IKEA VINDKAST): a soft cluster of white paper billows
  L.cloud = (g, w, d, h, c, on, k, roomTop) => {
    const cord = Math.max(0, roomTop - h); if (cord > 0) cyl(g, mat('#EDEBE6', { rough: 0.6 }), 0.35, 0.35, cord, 0, h + cord / 2, 0, 6);
    const m = glassGlow(c, on, k, 1.2); m.roughness = 0.9; let sd = 5; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, rr = w * (0.18 + r() * 0.16); sphere(g, m, rr, Math.cos(a) * w * (0.2 + r() * 0.12), h * (0.35 + r() * 0.3), Math.sin(a) * d * (0.2 + r() * 0.12), 0.7); }
    sphere(g, m, w * 0.3, 0, h * 0.5, 0, 0.8);
    return h * 0.4;
  };
  // Opal glass globe pendant (like IKEA SIMRISHAMN / FADO)
  L.globe = (g, w, d, h, c, on, k, roomTop) => {
    const R = Math.min(w, h) / 2, cord = Math.max(0, roomTop - h); if (cord > 0) cyl(g, METAL_DARK(), 0.35, 0.35, cord, 0, h + cord / 2, 0, 6);
    cyl(g, mat('#C9CCCE', { rough: 0.2, metal: 1 }), R * 0.18, R * 0.24, 4, 0, h - 2, 0, 24);
    sphere(g, glassGlow(c, on, k, 1.6), R, 0, h - 4 - R, 0);
    return h - 4 - R;
  };
  // Woven bamboo dome pendant (like IKEA SINNERLIG / KNIXHULT)
  L.bamboo = (g, w, d, h, c, on, k, roomTop) => {
    const R = w / 2, cord = Math.max(0, roomTop - h); if (cord > 0) cyl(g, mat('#3A2E22', { rough: 0.7 }), 0.4, 0.4, cord, 0, h + cord / 2, 0, 6);
    const weave = mat(c, { rough: 0.8, map: texFor('grain', 20, 6), side: T3.DoubleSide, emissive: on ? k : null, emissiveIntensity: on ? 0.25 : 0 });
    const dome = new T3.Mesh(new T3.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), weave); dome.scale.y = h / R * 0.95; dome.castShadow = true; g.add(dome);
    for (let i = 1; i < 6; i++) { const t = i / 6, band = new T3.Mesh(new T3.TorusGeometry(Math.max(1, R * Math.sqrt(1 - t * t)), 0.35, 6, 48), mat(shade(c, 0.8), { rough: 0.8 })); band.rotation.x = Math.PI / 2; band.position.y = t * h * 0.95; g.add(band); } // woven bands
    const bulb = sphere(g, mat('#FFF8EC', { rough: 0.2, emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 }), 5, 0, h * 0.35, 0); bulb.castShadow = false;
    return h * 0.3;
  };
  // Uplighter floor lamp: a wide bowl on a slim pole throws the light at the ceiling (indirect)
  L.uplighter = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.45, metal: 0.6 }), R = w / 2;
    cyl(g, m, R * 0.55, R * 0.6, 2.5, 0, 1.25, 0, 40); cyl(g, m, 1.1, 1.1, h - 14, 0, (h - 14) / 2, 0, 12);
    const bowl = new T3.Mesh(new T3.CylinderGeometry(R, R * 0.2, 14, 48, 1, true), mat(c, { rough: 0.45, metal: 0.6, side: T3.DoubleSide })); bowl.position.y = h - 7; bowl.castShadow = true; g.add(bowl);
    const lit = new T3.Mesh(new T3.CircleGeometry(R * 0.9, 40), mat('#FFF6E6', { emissive: on ? k : null, emissiveIntensity: on ? 2.5 : 0 })); lit.rotation.x = -Math.PI / 2; lit.position.y = h - 3; g.add(lit);
    return h + 8;
  };
  // Arc floor lamp: heavy base, a long steel arc, a dome shade hanging over the sofa or table
  L.arc = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.3, metal: 0.8 }), bx = -w / 2 + 18, sx = w / 2 - 20;
    part(g, mat('#E6E3DD', { rough: 0.3 }), 30, 6, 22, bx, 3, 0, 1.5); // marble foot
    const curve = new T3.CubicBezierCurve3(new T3.Vector3(bx, 6, 0), new T3.Vector3(bx, h * 1.05, 0), new T3.Vector3(sx, h * 1.05, 0), new T3.Vector3(sx, h - 22, 0));
    const tube = new T3.Mesh(new T3.TubeGeometry(curve, 64, 1, 10), m); tube.castShadow = true; g.add(tube);
    const shade = new T3.Mesh(new T3.SphereGeometry(20, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2.3), mat(c, { rough: 0.3, metal: 0.8, side: T3.DoubleSide })); shade.position.set(sx, h - 36, 0); shade.castShadow = true; g.add(shade);
    sphere(g, mat('#FFF8EC', { emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 }), 5, sx, h - 32, 0).castShadow = false;
    return h - 34;
  };
  // Paper column floor lamp: rice paper over thin rings, glows all over
  L.paper = (g, w, d, h, c, on, k) => {
    const R = w / 2, m = glassGlow(c, on, k, 1.1); m.roughness = 0.95; m.side = T3.DoubleSide;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, mat('#3A2E22', { rough: 0.6 }), 0.6, 0.6, 12, sx * R * 0.6, 6, sz * R * 0.6, 6);
    const body = new T3.Mesh(new T3.CylinderGeometry(R, R, h - 12, 40, 1, true), m); body.position.y = 12 + (h - 12) / 2; body.castShadow = true; g.add(body);
    for (let i = 0; i <= 10; i++) { const ring = new T3.Mesh(new T3.TorusGeometry(R + 0.1, 0.2, 4, 40), mat(shade(c, 0.85), { rough: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = 12 + i * (h - 12) / 10; g.add(ring); }
    return 12 + (h - 12) * 0.55;
  };
  // Wall uplighter: a half bowl on the wall, light washing up the wall
  L.wallup = (g, w, d, h, c, on, k) => {
    const cup = new T3.Mesh(new T3.SphereGeometry(w / 2, 40, 12, 0, Math.PI, Math.PI / 2, Math.PI / 2), mat(c, { rough: 0.5, side: T3.DoubleSide })); cup.rotation.y = 0; cup.scale.z = (d - 1) / (w / 2); cup.position.set(0, h, -d / 2 + 0.5); cup.castShadow = true; g.add(cup);
    if (on) wash(g, w * 2.2, 80, 0, h, -d / 2 + 0.2, k);
    return h - 2;
  };
  // Track rail with three adjustable spots
  L.track = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.4, metal: 0.4 }); part(g, m, w, 2.5, 3.5, 0, h - 1.25, 0, 0.5);
    for (const f of [-0.33, 0, 0.33]) {
      const x = f * w; cyl(g, m, 0.6, 0.6, 5, x, h - 5, 0, 8);
      const can = cyl(g, m, 3.4, 3.4, 10, x, h - 11, 2, 24); can.rotation.x = 0.5;
      const lens = cyl(g, mat('#FFFFFF', { emissive: on ? k : null, emissiveIntensity: on ? 4 : 0 }), 2.8, 2.8, 0.4, x, h - 15.5, 4.4, 20); lens.rotation.x = 0.5; lens.castShadow = false;
    }
    return h - 16;
  };



  // ---------- IKEA floor and table lamps ----------
  // Floor lamp with an opal glass globe on a chrome pole (SIMRISHAMN)
  L.globepole = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.15, metal: 1 }), R = w / 2;
    cyl(g, m, R * 0.8, R * 0.85, 2, 0, 1, 0, 40); cyl(g, m, 0.9, 0.9, h - 2 * R, 0, (h - 2 * R) / 2, 0, 12);
    cyl(g, m, R * 0.22, R * 0.28, 3, 0, h - 2 * R + 1, 0, 24); sphere(g, glassGlow('#F4F1EA', on, k, 1.6), R, 0, h - R, 0);
    return h - R;
  };
  // Uplighter with a separate reading lamp on a side arm (ISJAKT)
  L.uplightread = (g, w, d, h, c, on, k) => {
    const y = L.uplighter(g, Math.min(w, d), Math.min(w, d), h, c, on, k), m = mat(c, { rough: 0.45, metal: 0.6 }), ay = h * 0.68;
    const arm = cyl(g, m, 0.6, 0.6, w * 0.55, w * 0.22, ay + 8, 0, 8); arm.rotation.z = -1.1;
    const cone = new T3.Mesh(new T3.CylinderGeometry(1.5, 5, 9, 24, 1, true), mat(c, { rough: 0.45, metal: 0.6, side: T3.DoubleSide })); cone.position.set(w * 0.44, ay + 16, 0); cone.rotation.z = 0.5; g.add(cone);
    return y;
  };
  // Woven bamboo lantern (VARPTROSS), standing on the floor or a table
  L.lantern = (g, w, d, h, c, on, k) => {
    const R = w / 2, weave = mat(c, { rough: 0.8, map: texFor('grain', 20, 6), side: T3.DoubleSide, emissive: on ? k : null, emissiveIntensity: on ? 0.35 : 0 });
    const prof = []; for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new T3.Vector2(R * (0.35 + 0.65 * Math.sin(Math.PI * (0.08 + 0.84 * t))), t * h)); }
    const body = new T3.Mesh(new T3.LatheGeometry(prof, 48), weave); body.castShadow = true; g.add(body);
    for (let i = 1; i < 8; i++) { const t = i / 8, rr = R * (0.35 + 0.65 * Math.sin(Math.PI * (0.08 + 0.84 * t))); const band = new T3.Mesh(new T3.TorusGeometry(rr + 0.1, 0.3, 5, 48), mat(shade(c, 0.78), { rough: 0.8 })); band.rotation.x = Math.PI / 2; band.position.y = t * h; g.add(band); }
    sphere(g, mat('#FFF8EC', { emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 }), Math.min(5, R * 0.3), 0, h * 0.45, 0).castShadow = false;
    return h * 0.45;
  };
  L.t_lantern = L.lantern;
  // Opal glass globe on a small foot (FADO)
  L.t_globe = (g, w, d, h, c, on, k) => {
    const R = Math.min(w, h) / 2 * 0.96; cyl(g, glassGlow(c, on, k, 1.4), R * 0.35, R * 0.45, 2.5, 0, 1.25, 0, 32);
    sphere(g, glassGlow(c, on, k, 1.7), R, 0, 1.5 + R, 0); return 1.5 + R;
  };
  // Thin rod on a round foot with a drum shade (ÅRSTID table lamp; STORSEGEL in ash)
  const poleLamp = (g, w, h, m, on, k) => {
    const shadeH = h * 0.36; cyl(g, m, w * 0.3, w * 0.32, 2, 0, 1, 0, 32); cyl(g, m, 0.6, 0.6, h - shadeH * 0.6, 0, (h - shadeH * 0.6) / 2, 0, 10);
    const s2 = cyl(g, shadeMat('#F3EEE4', on, k), w * 0.42, w / 2, shadeH, 0, h - shadeH / 2, 0, 36); s2.castShadow = false; return h - shadeH * 0.6;
  };
  L.t_pole = (g, w, d, h, c, on, k) => poleLamp(g, w, h, mat(c, { rough: 0.3, metal: 0.9 }), on, k);
  L.t_polewood = (g, w, d, h, c, on, k) => poleLamp(g, w, h, wood(c, 6, h), on, k);
  // Brass foot with a smoked glass dome over the bulb (SOLKLINT)
  L.t_glassdome = (g, w, d, h, c, on, k) => {
    const m = mat(c, { rough: 0.3, metal: 0.9 }), R = w / 2;
    cyl(g, m, R * 0.55, R * 0.6, 2, 0, 1, 0, 32); cyl(g, m, 0.8, 0.8, h - R, 0, (h - R) / 2, 0, 10);
    sphere(g, mat('#FFF8EC', { emissive: on ? k : null, emissiveIntensity: on ? 3 : 0 }), R * 0.35, 0, h - R * 0.7, 0).castShadow = false;
    const glass = new T3.Mesh(new T3.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 1.7), mat('#6E6A66', { rough: 0.05, transparent: true, opacity: 0.45 })); glass.position.y = h - R; glass.material.envMapIntensity = 1.2; glass.material.depthWrite = false; g.add(glass);
    return h - R * 0.7;
  };
  // Paper cloud on a small white foot (VINDKAST table lamp)
  L.t_cloud = (g, w, d, h, c, on, k) => { cyl(g, mat('#F2F0EA', { rough: 0.5 }), w * 0.18, w * 0.2, 2, 0, 1, 0, 24); return L.cloud(g, w, d, h, c, on, k, h); };

  // ---------- Thumbnails ----------
  // One small offscreen renderer draws a 3/4 view of any piece; results are cached by the caller
  let TR = null;
  function thumbRig() {
    if (TR) return TR;
    const canvas = document.createElement('canvas'), r = new T3.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(240, 180, false); r.outputEncoding = T3.sRGBEncoding; r.toneMapping = T3.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    const scene = new T3.Scene(); // no shadow pass: pieces carry their own soft contact shadow
    if (T3.RoomEnvironment) { const pm = new T3.PMREMGenerator(r); scene.environment = pm.fromScene(new T3.RoomEnvironment(), 0.04).texture; pm.dispose(); }
    scene.add(new T3.HemisphereLight(0xffffff, 0xb9ae9e, 0.35));
    const sun = new T3.DirectionalLight(0xfff4e5, 1.3); scene.add(sun); scene.add(sun.target);
    TR = { r, scene, sun, cam: new T3.PerspectiveCamera(28, 4 / 3, 1, 20000) };
    return TR;
  }
  HM.thumbnail = (it, opts) => {
    const t = thumbRig(), wall = it.type === 'art', light = ['ceiling', 'pendant', 'spot', 'sconce', 'floorlamp', 'tablelamp'].includes(it.type);
    const g = HM.buildItem(Object.assign({}, it, { elev: 0 }), Object.assign({ evening: false, roomTop: it.type === 'pendant' ? it.h + 25 : it.h }, opts || {}));
    t.scene.add(g);
    const box = new T3.Box3().setFromObject(g), c = box.getCenter(new T3.Vector3()), size = box.getSize(new T3.Vector3()), rad = Math.max(size.length() / 2, 5);
    const dir = wall ? new T3.Vector3(0.28, 0.12, 1) : light ? new T3.Vector3(0.6, 0.35, 1) : new T3.Vector3(0.85, 0.75, 1.25);
    dir.normalize(); t.cam.position.copy(c).addScaledVector(dir, rad / Math.sin((t.cam.fov * Math.PI / 180) / 2) * 0.95); t.cam.lookAt(c);
    t.cam.near = rad * 0.1; t.cam.far = rad * 20; t.cam.updateProjectionMatrix();
    t.sun.position.set(c.x + rad * 1.5, c.y + rad * 3, c.z + rad * 2); t.sun.target.position.copy(c);
    t.r.render(t.scene, t.cam);
    const url = t.r.domElement.toDataURL('image/png');
    t.scene.remove(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { ['map', 'bumpMap'].forEach((k) => { if (m[k] && !m[k].keep && !texCache.has(m[k])) m[k].dispose(); }); m.dispose(); }); });
    return url;
  };

  // Build one item. opts: { evening, kelvinHex, roomTop (cm above item base, for pendant cords) }
  HM.buildItem = (it, opts) => {
    const g = new T3.Group(), w = it.w, d = it.d, h = Math.max(it.h, 1);
    let bulbY = null;
    if (L[it.type]) bulbY = L[it.type](g, w, d, h, it.color, opts.evening, opts.kelvinHex, opts.roomTop, it);
    else {
      (B[it.type] || B.box)(g, w, d, h, it.color, it, opts);
      if (!['rug', 'vanity', 'toilet', 'cornersofa', 'art', 'potrack'].includes(it.type) && !(it.elev > 0)) g.add(HM.contactShadow(w, d));
    }
    g.userData.bulbY = bulbY;
    return g;
  };
})();
