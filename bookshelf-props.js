// Everyday objects to compare sizes against (mug, glass, book ...): true-size catalogue, a pure placement and fit
// function (cm, no DOM, tested in Node) and procedural 3D models (browser only, no downloads).
// Furniture-local coordinates: x from the left edge, y up from the bottom, z from the FRONT face towards the back.
(function (root) {
  'use strict';
  const round = n => Math.round(n * 1000) / 1000, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const MAX_ITEMS = 20, PERSON = { name: 'Person, 175 cm', w: 46, d: 3, h: 175 };
  // w = left-right, d = front-back, h = height, all in cm and the real size of the object. The mug width includes its handle.
  const PROPS = {
    mug: { name: 'Mug', w: 11, d: 8, h: 9.5, turned: { w: 8, d: 11, h: 9.5 } }, // handle sideways, or turned to the front in a narrow space
    cup: { name: 'Coffee cup', w: 9.5, d: 9.5, h: 6 }, // cup with its saucer
    espresso: { name: 'Espresso cup', w: 8.5, d: 6.5, h: 5.5, ml: 70, turned: { w: 6.5, d: 8.5, h: 5.5 } },
    cappuccino: { name: 'Cappuccino cup & saucer', w: 12, d: 12, h: 7, ml: 180 },
    standard_mug: { name: 'Standard mug', w: 12, d: 8.5, h: 10, ml: 330, turned: { w: 8.5, d: 12, h: 10 } },
    large_mug: { name: 'Large mug', w: 13.5, d: 9.5, h: 12, ml: 475, turned: { w: 9.5, d: 13.5, h: 12 } },
    latte: { name: 'Latte glass', w: 8, d: 8, h: 15, ml: 300 },
    wine: { name: 'Wine glass', w: 8, d: 8, h: 21 },
    water: { name: 'Water glass', w: 7, d: 7, h: 11 },
    book: { name: 'Book', w: 2.5, d: 12, h: 18, flat: { w: 18, d: 12, h: 2.5 } }, // paperback, standing or (if it does not fit) lying
    plant: { name: 'Small plant', w: 12, d: 12, h: 22 },
    vase: { name: 'Vase', w: 10, d: 10, h: 25 },
    jar: { name: 'Small jar', w: 7, d: 7, h: 8 },
    tealight: { name: 'Tea light', w: 4, d: 4, h: 2 }
  };
  const KINDS = Object.keys(PROPS);
  const size = kind => PROPS[kind] ? { w: PROPS[kind].w, d: PROPS[kind].d, h: PROPS[kind].h } : null;
  const MESSAGES = {
    tooTall: 'Too tall for this shelf – try the top.', tooWide: 'Too wide for this space.', tooDeep: 'Too deep for this shelf.',
    full: 'No room left here – try another spot.', noSurface: 'Click a shelf or a compartment.', unknown: 'Unknown item.', limit: `That is enough items (${MAX_ITEMS}). Remove one first.`
  };

  // Every flat surface that can carry an object: the top of each board, split by the dividers standing on it.
  // y = surface height, ceiling = underside of the lowest board above it (Infinity for an open top).
  function surfaces(s) {
    const t = s.thickness, back = s.template === 'saetter3' ? s.backThickness : 0, depth = round(s.depth - back), out = [];
    s.levels.forEach((l, i) => {
      const next = s.levels[i + 1], divs = (next ? l.dividers : []).slice().sort((a, b) => a - b), segs = [];
      let start = l.left;
      divs.forEach(x => { segs.push([start, x - t / 2]); start = x + t / 2; });
      segs.push([start, l.right]);
      segs.forEach(([x0, x1]) => {
        if (x1 - x0 < .05) return;
        let ceiling = Infinity;
        s.levels.forEach((o, j) => { if (j > i && Math.min(o.right, x1) - Math.max(o.left, x0) > .05) ceiling = Math.min(ceiling, o.y); });
        out.push({ level: i, x0: round(x0), x1: round(x1), y: round(l.y + t), ceiling: ceiling === Infinity ? Infinity : round(ceiling), depth });
      });
    });
    return out;
  }

  const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - .1 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - .1;
  const orientations = spec => [{ w: spec.w, d: spec.d, h: spec.h, rot: 0 }].concat(spec.flat || spec.turned ? [{ ...(spec.flat || spec.turned), rot: 1 }] : []);
  const fitsSurface = (sf, v) => sf.ceiling - sf.y >= v.h - .01 && sf.x1 - sf.x0 >= v.w - .05 && sf.depth >= v.d * .8 - .001;
  function fitLocation(design, kind) {
    const spec = PROPS[kind]; if (!spec) return 'none';
    const options = orientations(spec), all = surfaces(design), top = design.levels.length - 1;
    if (all.some(sf => sf.level < top && options.some(v => fitsSurface(sf, v)))) return 'compartment';
    return all.some(sf => sf.level === top && options.some(v => fitsSurface(sf, v))) ? 'top' : 'none';
  }

  // Where would `kind` stand if the user clicked at hit {x, y, z?, level?} on the furniture `design`?
  // existing = items already placed [{x, y, z, w, d}]. Returns {ok:true, x, y, z, w, d, h, rot, level} or {ok:false, reason, message}.
  function fitProp(design, kind, hit, existing = []) {
    const spec = PROPS[kind];
    if (!spec) return { ok: false, reason: 'unknown', message: MESSAGES.unknown };
    const all = surfaces(design), tol = design.thickness + .6;
    let cands = all.filter(sf => sf.y <= hit.y + tol);
    if (Number.isInteger(hit.level)) { const same = all.filter(sf => sf.level === hit.level); if (same.length) cands = same; }
    if (!cands.length) return { ok: false, reason: 'noSurface', message: MESSAGES.noSurface };
    const dx = sf => hit.x < sf.x0 ? sf.x0 - hit.x : hit.x > sf.x1 ? hit.x - sf.x1 : 0;
    const best = cands.reduce((a, b) => { const da = Math.round(dx(a) * 100), db = Math.round(dx(b) * 100); return db < da || (db === da && b.y > a.y) ? b : a; });
    const variants = orientations(spec);
    let failure = null;
    for (const v of variants) {
      const tooTall = best.ceiling - best.y < v.h - .01, tooWide = best.x1 - best.x0 < v.w - .05, tooDeep = best.depth < v.d * .8 - .001;
      const reason = tooTall ? 'tooTall' : tooWide ? 'tooWide' : tooDeep ? 'tooDeep' : null;
      if (reason) { if (!failure) failure = reason; continue; }
      const z = v.d >= best.depth ? best.depth - v.d / 2 : clamp(Number.isFinite(hit.z) ? hit.z : best.depth / 2, v.d / 2, best.depth - v.d / 2);
      const lo = best.x0 + v.w / 2, hi = best.x1 - v.w / 2, want = clamp(hit.x, lo, hi);
      const here = existing.filter(o => Math.abs(o.y - best.y) < .05);
      const free = x => !here.some(o => overlaps({ x, z, w: v.w, d: v.d }, o));
      let x = null;
      if (free(want)) x = want;
      else for (let k = .25; k <= hi - lo + .25 && x === null; k += .25) { for (const c of [want - k, want + k]) if (c >= lo - 1e-9 && c <= hi + 1e-9 && free(c)) { x = c; break; } }
      if (x === null) return { ok: false, reason: 'full', message: MESSAGES.full };
      return { ok: true, kind, x: round(x), y: best.y, z: round(z), w: v.w, d: v.d, h: v.h, rot: v.rot, level: best.level };
    }
    return { ok: false, reason: failure, message: MESSAGES[failure] };
  }

  // After the furniture changes (size step, variant): put every item back on a surface of the same level, keep its
  // true size, and drop the ones that no longer fit. prev = the design the items were placed on.
  function resnap(design, items, prev) {
    const fx = prev && prev.width ? design.width / prev.width : 1, kept = [], dropped = [];
    items.forEach(p => {
      const hit = { x: p.x * fx, y: p.y, z: p.z, level: Math.min(p.level, design.levels.length - 1) };
      const r = fitProp(design, p.kind, hit, kept);
      if (r.ok) kept.push({ ...p, ...r, id: p.id, color: p.color }); else dropped.push(p);
    });
    return { items: kept, dropped };
  }

  // Axis-aligned box of an item in furniture-local coordinates (x, y, z from the front), for collision checks.
  function itemBox(p) { return { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y, y1: p.y + p.h, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }; }

  const pure = { PROPS, KINDS, PERSON, MAX_ITEMS, MESSAGES, size, surfaces, fitProp, fitLocation, resnap, itemBox };

  // ---------- 3D models (browser only). Group origin: centre of the footprint, y = 0 on the supporting surface. ----------
  const BOOK_COLORS = ['#8C3B32', '#2F4858', '#3E5544', '#B08D57', '#5B4A7A', '#C26A3D'];
  function make(THREE, kind, opts = {}) {
    const g = new THREE.Group(), lin = hex => new THREE.Color(hex).convertSRGBToLinear();
    const std = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: o.rough ?? .5, metalness: o.metal ?? 0, side: o.side || THREE.FrontSide, transparent: !!o.alpha, opacity: o.alpha ?? 1, depthWrite: o.alpha ? false : true });
    const glass = () => std('#DDEBEF', { rough: .05, alpha: .32, side: THREE.DoubleSide });
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = mat.opacity === 1; m.receiveShadow = true; g.add(m); return m; };
    const lathe = pts => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 36);
    if (kind === 'mug') {
      const body = new THREE.Group(); g.add(body); const cream = std('#F1ECE0', { rough: .35 });
      const m1 = new THREE.Mesh(lathe([[0, 0], [3.7, 0], [4, .35], [4, 9.5], [3.6, 9.5], [3.6, .7], [0, .7]]), Object.assign(cream, { side: THREE.DoubleSide })); m1.castShadow = true; m1.receiveShadow = true; body.add(m1);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(3.55, 32), std('#3A2418', { rough: .2 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 8.2; body.add(coffee);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(2.4, .55, 10, 24, Math.PI), cream); handle.rotation.z = -Math.PI / 2; handle.position.set(3.9, 5, 0); handle.castShadow = true; body.add(handle);
      body.position.x = -1.5; if (opts.rot === 1) g.rotation.y = -Math.PI / 2;
    } else if (kind === 'cup') {
      const white = std('#F7F5F0', { rough: .3, side: THREE.DoubleSide });
      add(lathe([[0, 0], [3.4, 0], [5.3, .6], [5.5, 1.05], [5.2, 1.05], [3.6, .55], [0, .55]]), white);
      add(lathe([[0, 1], [1.8, 1], [3.1, 2.6], [3.1, 6.5], [2.8, 6.5], [2.8, 2.9], [1.6, 1.4], [0, 1.4]]), white);
      const coffee = add(new THREE.CircleGeometry(2.75, 28), std('#4A2C1C', { rough: .2 }), 0, 5.6, 0); coffee.rotation.x = -Math.PI / 2;
      const h = add(new THREE.TorusGeometry(1.5, .4, 8, 18, Math.PI), white, 3.2, 4.2, 0); h.rotation.z = -Math.PI / 2;
    } else if (kind === 'espresso' || kind === 'standard_mug' || kind === 'large_mug') {
      const spec = PROPS[kind], r = spec.d / 2, h = spec.h;
      const ceramic = std(kind === 'large_mug' ? '#789398' : '#F1ECE0', { rough: .35, side: THREE.DoubleSide });
      const body = new THREE.Group(); g.add(body);
      const cup = new THREE.Mesh(lathe([[0, 0], [r * .82, 0], [r, h * .12], [r, h], [r - .35, h], [r - .35, .6], [0, .6]]), ceramic); cup.castShadow = true; cup.receiveShadow = true; body.add(cup);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(r - .4, 32), std('#4A2C1C', { rough: .2 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = h * .86; body.add(coffee);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(h * .23, .4, 10, 24, Math.PI), ceramic); handle.rotation.z = -Math.PI / 2; handle.position.set(r, h * .52, 0); handle.castShadow = true; body.add(handle);
      if (opts.rot === 1) g.rotation.y = -Math.PI / 2;
    } else if (kind === 'cappuccino') {
      const white = std('#F7F5F0', { rough: .3, side: THREE.DoubleSide });
      add(lathe([[0, 0], [4, 0], [6, .55], [6, .9], [5.7, .9], [3.8, .45], [0, .45]]), white);
      add(lathe([[0, .8], [2.5, .8], [3.8, 2], [4.2, 6.8], [3.8, 6.8], [3.4, 2.2], [2.4, 1.2], [0, 1.2]]), white);
      const coffee = add(new THREE.CircleGeometry(3.75, 32), std('#C79D75', { rough: .3 }), 0, 6.1, 0); coffee.rotation.x = -Math.PI / 2;
      const h = add(new THREE.TorusGeometry(1.25, .38, 8, 20, Math.PI), white, 4.1, 4, 0); h.rotation.z = -Math.PI / 2;
    } else if (kind === 'latte') {
      add(lathe([[0, 0], [3, 0], [4, 15], [3.7, 15], [2.7, .6], [0, .6]]), glass());
      add(lathe([[0, .65], [2.65, .65], [3.65, 13.3], [0, 13.3]]), std('#B98255', { rough: .35 }));
      const foam = add(new THREE.CircleGeometry(3.65, 32), std('#EFE1CC', { rough: .65 }), 0, 13.35, 0); foam.rotation.x = -Math.PI / 2;
    } else if (kind === 'wine') {
      add(new THREE.CylinderGeometry(3.6, 3.7, .35, 28), glass(), 0, .17, 0);
      add(new THREE.CylinderGeometry(.35, .35, 9, 10), glass(), 0, 4.7, 0);
      add(lathe([[0, 8.8], [1.5, 9.2], [3.4, 11], [4, 14], [3.8, 17.5], [3, 20.5], [2.7, 21], [2.55, 20.9], [2.7, 17.5], [3.2, 14], [2.8, 11.2], [0, 9.2]]), glass());
      add(lathe([[0, 9.4], [2.9, 11.3], [3.3, 13.5], [0, 13.5]]), std('#6B1B2B', { rough: .15, alpha: .85 }));
    } else if (kind === 'water') {
      add(lathe([[0, 0], [2.8, 0], [3.5, 11], [3.25, 11], [2.6, .8], [0, .8]]), glass());
      add(lathe([[0, .85], [2.6, .85], [3.05, 8], [0, 8]]), std('#BFD9E6', { rough: .05, alpha: .45 }));
    } else if (kind === 'book') {
      const col = opts.color || BOOK_COLORS[0], cover = std(col, { rough: .7 }), pages = std('#F1E8D2', { rough: .9 });
      const inner = new THREE.Group(); g.add(inner);
      const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; inner.add(b); };
      box(.25, 18, 12, -1.125, 9, 0, cover); box(.25, 18, 12, 1.125, 9, 0, cover); box(2.5, 18, .3, 0, 9, 5.85, cover); box(2, 17.5, 11.5, 0, 9, -.15, pages);
      if (opts.rot === 1) { inner.rotation.z = -Math.PI / 2; inner.position.y = 1.25; }
    } else if (kind === 'plant') {
      const clay = std('#B5643C', { rough: .85 }), green = std('#4C7A43', { rough: .7 }), green2 = std('#5E8F4F', { rough: .7 });
      add(lathe([[0, 0], [3.6, 0], [5, 9], [5.3, 9], [5.3, 9.6], [4.4, 9.6], [4.5, 8.6], [0, 8.6]]), Object.assign(clay, { side: THREE.DoubleSide }));
      const soil = add(new THREE.CircleGeometry(4.5, 24), std('#3B2A20', { rough: 1 }), 0, 8.9, 0); soil.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2, lean = .2 + (i % 3) * .15, len = 8 + (i % 4) * 1.6, leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), i % 2 ? green : green2);
        leaf.scale.set(1.5, len / 2, .5); leaf.castShadow = true; leaf.receiveShadow = true;
        const holder = new THREE.Group(); holder.position.y = 8.9; holder.rotation.y = a; leaf.position.set(0, len / 2 * Math.cos(lean), len / 2 * Math.sin(lean)); leaf.rotation.set(lean, 0, 0); holder.add(leaf); g.add(holder);
      }
    } else if (kind === 'vase') {
      add(lathe([[0, 0], [3, 0], [4.7, 5], [3.4, 11], [1.8, 14], [2.2, 16], [2.5, 16], [2.5, 15.6], [1.6, 14], [3.1, 11], [4.3, 5], [2.7, .5], [0, .5]]), std('#2F6B73', { rough: .15, side: THREE.DoubleSide }));
      const stem = std('#4C7A43'), blooms = ['#E9A23B', '#D9604C', '#F1ECE0'];
      [[-1.6, 22, -.1], [0, 24.5, 0], [1.8, 21, .12]].forEach(([x, top, lean], i) => {
        const len = top - 14, c = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, len, 6), stem); c.position.set(x * .55, 14 + len / 2, 0); c.rotation.z = lean; c.castShadow = true; g.add(c);
        const b = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), std(blooms[i], { rough: .6 })); b.position.set(x, top - 1.3, 0); b.scale.y = .8; b.castShadow = true; g.add(b);
      });
    } else if (kind === 'jar') {
      add(new THREE.CylinderGeometry(3.2, 3.2, 6.7, 32), std('#B9D8CF', { rough: .2, alpha: .65 }), 0, 3.35, 0);
      add(new THREE.CylinderGeometry(3.5, 3.5, 1.3, 32), std('#A7855E', { rough: .65 }), 0, 7.35, 0);
    } else if (kind === 'tealight') {
      add(new THREE.CylinderGeometry(2, 2, 2, 32), std('#B8B9B6', { rough: .5, metal: .55 }), 0, 1, 0);
      add(new THREE.CylinderGeometry(1.8, 1.8, .15, 32), std('#F6F0E5', { rough: .8 }), 0, 1.94, 0);
    } else if (kind === 'person') {
      const mat = new THREE.MeshStandardMaterial({ color: lin('#8C918E'), roughness: .9 });
      const R = [[1.5, 0], [10, 0], [11.5, 82], [13, 93], [19, 92], [22, 100], [23, 140], [19, 148], [8, 153], [4, 160]];
      const pts = R.slice().reverse().map(([x, y]) => [-x, y]).concat([[-1.5, 0], [0, 78], [1.5, 0]]).concat(R.slice(0));
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.5, bevelEnabled: false }), mat); body.position.z = -1.25; body.castShadow = true; body.receiveShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 2.5, 24), mat); head.rotation.x = Math.PI / 2; head.position.y = 167; head.castShadow = true; g.add(head);
    }
    g.userData.kind = kind;
    const spec = PROPS[kind];
    if (!spec) return g;
    const box = new THREE.Box3().setFromObject(g), measured = box.getSize(new THREE.Vector3());
    const target = opts.rot === 1 ? (spec.flat || spec.turned || spec) : spec;
    g.position.x -= (box.min.x + box.max.x) / 2;
    g.position.y -= box.min.y;
    g.position.z -= (box.min.z + box.max.z) / 2;
    const model = new THREE.Group(); model.add(g);
    model.scale.set(target.w / measured.x, target.h / measured.y, target.d / measured.z);
    model.userData.kind = kind;
    return model;
  }
  const api = { ...pure, BOOK_COLORS, make };
  root.BookshelfProps = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
