// Single source of board geometry for the builder, room model and workshop exports.
// All coordinates are cm. Shelf y = underside; divider x = centre, viewed from the front.
(function (root) {
  'use strict';
  const round = n => Math.round(n * 1000) / 1000;
  const number = (v, fallback) => Number.isFinite(Number(v)) ? round(Number(v)) : fallback;
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const result = { version: 1, width: number(s.width, 240), height: number(s.height, 200),
      depth: number(s.depth, 30), thickness: number(s.thickness, 2.4),
      levels: (Array.isArray(s.levels) ? s.levels : []).filter(l => l && typeof l === 'object').slice(0, 25).map(l => ({
        y: number(l.y, 0), left: number(l.left, 0), right: number(l.right, 240),
        dividers: (Array.isArray(l.dividers) ? l.dividers : []).slice(0, 30).map(x => number(x, 0))
      })) };
    // Older designs remain unchanged. The optional template records the extra
    // modeled parts wherever a shelf design is saved, placed, or exported.
    if (s.template === 'saetter3') Object.assign(result, { template: 'saetter3',
      separatorHeight: number(s.separatorHeight, 3), backThickness: number(s.backThickness, .5) });
    return result;
  }
  function saetter3() {
    const width = 45.5, height = 40.6, thickness = 1.1;
    const dividers = [.55, 11.65, 22.75, 33.85, 44.95];
    return normalize({ template: 'saetter3', width, height, depth: 10.5, thickness,
      separatorHeight: 3, backThickness: .5,
      levels: Array.from({ length: 4 }, (_, i) => ({ y: round(i * (height - thickness) / 3),
        left: 0, right: width, dividers: i < 3 ? [...dividers] : [] })) });
  }
  // Real SÆTTER sizes from saetter.dk (walnut): rows x columns of 10 x 12 cm compartments. Comparison previews only.
  const SAETTER_VARIANTS = [
    { id: '3', label: 'SÆTTER 3', rows: 3, cols: 4, width: 45.5, height: 40.6, depth: 10.5 },
    { id: '5', label: 'SÆTTER 5', rows: 5, cols: 4, width: 45.5, height: 66.7, depth: 11.2 },
    { id: '7', label: 'SÆTTER 7', rows: 7, cols: 4, width: 45.5, height: 92.4, depth: 11.2 },
    { id: '15', label: 'SÆTTER 15', rows: 5, cols: 3, width: 34.4, height: 66.7, depth: 11.2 }
  ];
  function saetterVariant(id) {
    const v = SAETTER_VARIANTS.find(x => x.id === String(id)) || SAETTER_VARIANTS[0];
    if (v.id === '3') return saetter3();
    const t = 1.1, dividers = Array.from({ length: v.cols + 1 }, (_, j) => round(t / 2 + j * (10 + t)));
    return normalize({ template: 'saetter3', width: v.width, height: v.height, depth: v.depth, thickness: t, separatorHeight: 3, backThickness: round(v.depth - 10),
      levels: Array.from({ length: v.rows + 1 }, (_, i) => ({ y: round(i * (v.height - t) / v.rows), left: 0, right: v.width, dividers: i < v.rows ? [...dividers] : [] })) });
  }
  function preset(kind = 'staggered', width = 240, height = 200, depth = 30, thickness = 2.4, rows = 5) {
    const levels = [];
    for (let i = 0; i <= rows; i++) {
      const inset = Math.min(18, width * .07);
      const left = kind === 'stepped' ? (i % 3) * inset : 0;
      const right = kind === 'stepped' ? width - ((i + 1) % 3) * inset : width;
      const dividers = kind === 'framed' ? [thickness / 2, width * .3, width * .57, width - thickness / 2]
        : [inset + thickness / 2, width * (i % 2 ? .36 : .27), width * (i % 2 ? .72 : .61), width - inset - thickness / 2];
      levels.push({ y: round(i * (height - thickness) / rows), left: round(left), right: round(right), dividers: i === rows ? [] : dividers.map(round) });
    }
    // Stepped shelves share supports only in the overlap of neighbouring boards.
    levels.slice(0, -1).forEach((l, i) => {
      const a = Math.max(l.left, levels[i + 1].left) + thickness / 2;
      const b = Math.min(l.right, levels[i + 1].right) - thickness / 2;
      l.dividers = l.dividers.map(x => round(Math.max(a, Math.min(b, x))));
    });
    return normalize({ width, height, depth, thickness, levels });
  }
  function boards(s) {
    const t = s.thickness, out = [];
    const backed = s.template === 'saetter3', back = backed ? s.backThickness : 0;
    const boardDepth = round(s.depth - back);
    if (backed) out.push({ id: 'B1', kind: 'Back', x: 0, y: 0, w: s.width, h: s.height,
      length: s.height, depth: s.width, thickness: back, renderDepth: back, z: round(-s.depth / 2 + back / 2) });
    s.levels.forEach((l, i) => {
      out.push({ id: `S${i + 1}`, kind: 'Shelf', x: l.left, y: l.y, w: round(l.right - l.left), h: t,
        length: round(l.right - l.left), depth: boardDepth, thickness: t, ...(backed ? { z: back / 2 } : {}) });
      const next = s.levels[i + 1];
      if (next) l.dividers.forEach((x, j) => {
        const h = round(next.y - l.y - t);
        const a = Math.max(l.left, next.left), b = Math.min(l.right, next.right);
        const side = Math.abs(x - t / 2 - a) < .002 || Math.abs(x + t / 2 - b) < .002;
        const short = backed && !side, partHeight = short ? s.separatorHeight : h;
        const part = { id: `D${i + 1}.${j + 1}`, kind: short ? 'Separator' : 'Divider', x: round(x - t / 2), y: round(l.y + t), w: t, h: partHeight,
          length: partHeight, depth: boardDepth, thickness: t, ...(backed ? { z: back / 2 } : {}) };
        out.push(part);
        if (short) out.push({ ...part, id: part.id + 'T', y: round(next.y - partHeight) });
      });
    });
    return out;
  }
  function visualBoards(s) {
    return boards(s).filter(b => b.w > 0 && b.h > 0);
  }
  function validate(s) {
    const errors = [], warnings = [], t = s.thickness;
    if (!(s.width >= 20 && s.width <= 1000 && s.height >= 20 && s.height <= 800 && s.depth >= 10 && s.depth <= 100 && t >= .9 && t <= 6))
      errors.push('Use width 20–1000 cm, height 20–800 cm, depth 10–100 cm and board thickness 0.9–6 cm.');
    if (s.levels.length < 2) errors.push('Add at least a bottom and a top shelf.');
    if (s.template === 'saetter3') {
      if (!(s.backThickness > 0 && s.backThickness < s.depth)) errors.push('Back thickness must be positive and less than the overall depth.');
      if (!(s.separatorHeight > 0)) errors.push('Separator height must be positive.');
    }
    if (s.levels.length && (Math.abs(s.levels[0].y) > .001 || Math.abs(s.levels.at(-1).y + t - s.height) > .001))
      errors.push('Bottom shelf must start at 0; top shelf underside must be height minus board thickness.');
    s.levels.forEach((l, i) => {
      const next = s.levels[i + 1], label = `Shelf S${i + 1}`;
      if (l.left < 0 || l.right > s.width || l.right - l.left < t || l.y < 0 || l.y + t > s.height + .001)
        errors.push(`${label}: endpoints and height must stay inside the overall dimensions.`);
      if (!next) return;
      if (next.y - l.y <= t) errors.push(`${label}: leave a positive opening below the next shelf.`);
      if (s.template === 'saetter3' && s.separatorHeight * 2 > next.y - l.y - t + .001)
        errors.push(`Bay ${i + 1}: the upper and lower separators must not overlap.`);
      const a = Math.max(l.left, next.left), b = Math.min(l.right, next.right);
      const xs = [...l.dividers].sort((x, y) => x - y);
      if (xs.some(x => x - t / 2 < a - .001 || x + t / 2 > b + .001))
        errors.push(`Bay ${i + 1}: dividers must touch both shelves within their shared span.`);
      if (xs.some((x, j) => j && x - xs[j - 1] < t - .001)) errors.push(`Bay ${i + 1}: dividers overlap.`);
      if (xs.length < 2) warnings.push(`Bay ${i + 1} has fewer than two supports; review stability and joinery.`);
      const edges = [next.left, ...xs, next.right];
      if (edges.some((x, j) => j && x - edges[j - 1] > 80)) warnings.push(`Bay ${i + 1} has a span over 80 cm; check sag for your wood and book load.`);
      if (xs.length && (xs[0] - next.left > 20 || next.right - xs.at(-1) > 20)) warnings.push(`Bay ${i + 1} has a long overhang; review support.`);
    });
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }
  function resize(s, width, height) {
    const xScale = width / s.width, yScale = (height - s.thickness) / (s.height - s.thickness);
    const levels = s.levels.map(l => ({ ...l, y: round(l.y * yScale), left: round(l.left * xScale), right: round(l.right * xScale), dividers: [] }));
    // Scale each bay's usable support span, keeping full board thickness at stepped edges.
    s.levels.slice(0, -1).forEach((l, i) => {
      const a = Math.max(l.left, s.levels[i + 1].left) + s.thickness / 2;
      const b = Math.min(l.right, s.levels[i + 1].right) - s.thickness / 2;
      const A = Math.max(levels[i].left, levels[i + 1].left) + s.thickness / 2;
      const Z = Math.min(levels[i].right, levels[i + 1].right) - s.thickness / 2;
      levels[i].dividers = l.dividers.map(x => round(b > a ? A + (x - a) / (b - a) * (Z - A) : x * xScale));
    });
    return normalize({ ...s, width, height, levels });
  }
  function dividerPosition(s, row) {
    const l = s.levels[row], next = s.levels[row + 1], t = s.thickness;
    if (!l || !next || l.dividers.length >= 30) return null;
    const a = Math.max(l.left, next.left), b = Math.min(l.right, next.right);
    const occupied = [...l.dividers].sort((x, y) => x - y);
    const gaps = []; let start = a;
    occupied.forEach(x => { gaps.push([start, x - t / 2]); start = x + t / 2; });
    gaps.push([start, b]); gaps.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
    const gap = gaps.find(([left, right]) => right - left >= t + .002);
    return gap ? round((gap[0] + gap[1]) / 2) : null;
  }
  function placement(s, r, target) {
    const offset = target.offset, gap = target.gap, elev = target.elev;
    return { x: target.wall === 'w' ? gap + s.depth / 2 : target.wall === 'e' ? r.width - gap - s.depth / 2 : offset + s.width / 2,
      y: target.wall === 'n' ? gap + s.depth / 2 : target.wall === 's' ? r.length - gap - s.depth / 2 : offset + s.width / 2,
      rot: { n: 0, e: 90, s: 180, w: 270 }[target.wall], elev };
  }
  function fit(s, r, target) {
    const errors = [], len = ['n', 's'].includes(target.wall) ? r.width : r.length;
    if (target.offset < 0 || target.offset + s.width > len) errors.push('The bookshelf extends past the selected wall.');
    if (target.elev < 0 || target.elev + s.height > r.height) errors.push('The bookshelf extends past the floor or ceiling.');
    if (target.gap < 0 || target.gap + s.depth > (['n', 's'].includes(target.wall) ? r.length : r.width)) errors.push('The bookshelf is too deep for the room.');
    const overlap = (a, b, c, d) => a < d && b > c;
    r.openings.filter(o => o.wall === target.wall).forEach(o => {
      if (!overlap(target.offset, target.offset + s.width, o.offset, o.offset + o.width)) return;
      const bottom = o.type === 'door' ? 0 : o.sill;
      if (overlap(target.elev, target.elev + s.height, bottom, bottom + o.height)) errors.push(`The bookshelf covers a ${o.type} on this wall.`);
      if (o.radiator && target.elev < o.sill) errors.push('The bookshelf occupies the radiator zone below a window.');
    });
    return [...new Set(errors)];
  }
  const api = { normalize, preset, saetter3, saetterVariant, SAETTER_VARIANTS, boards, visualBoards, validate, resize, dividerPosition, placement, fit, round };
  root.Bookshelf = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
