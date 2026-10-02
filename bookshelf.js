// Single source of board geometry for the builder, room model and workshop exports.
// All coordinates are cm. Shelf y = underside; divider x = centre, viewed from the front.
(function (root) {
  'use strict';
  const round = n => Math.round(n * 1000) / 1000;
  const number = (v, fallback) => Number.isFinite(Number(v)) ? round(Number(v)) : fallback;
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return { version: 1, width: number(s.width, 240), height: number(s.height, 200),
      depth: number(s.depth, 30), thickness: number(s.thickness, 2.4),
      levels: (Array.isArray(s.levels) ? s.levels : []).filter(l => l && typeof l === 'object').slice(0, 25).map(l => ({
        y: number(l.y, 0), left: number(l.left, 0), right: number(l.right, 240),
        dividers: (Array.isArray(l.dividers) ? l.dividers : []).slice(0, 30).map(x => number(x, 0))
      })) };
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
    s.levels.forEach((l, i) => {
      out.push({ id: `S${i + 1}`, kind: 'Shelf', x: l.left, y: l.y, w: round(l.right - l.left), h: t,
        length: round(l.right - l.left), depth: s.depth, thickness: t });
      const next = s.levels[i + 1];
      if (next) l.dividers.forEach((x, j) => {
        const h = round(next.y - l.y - t);
        out.push({ id: `D${i + 1}.${j + 1}`, kind: 'Divider', x: round(x - t / 2), y: round(l.y + t), w: t, h,
          length: h, depth: s.depth, thickness: t });
      });
    });
    return out;
  }
  function validate(s) {
    const errors = [], warnings = [], t = s.thickness;
    if (!(s.width >= 20 && s.width <= 1000 && s.height >= 20 && s.height <= 800 && s.depth >= 10 && s.depth <= 100 && t >= .9 && t <= 6))
      errors.push('Use width 20–1000 cm, height 20–800 cm, depth 10–100 cm and board thickness 0.9–6 cm.');
    if (s.levels.length < 2) errors.push('Add at least a bottom and a top shelf.');
    if (s.levels.length && (Math.abs(s.levels[0].y) > .001 || Math.abs(s.levels.at(-1).y + t - s.height) > .001))
      errors.push('Bottom shelf must start at 0; top shelf underside must be height minus board thickness.');
    s.levels.forEach((l, i) => {
      const next = s.levels[i + 1], label = `Shelf S${i + 1}`;
      if (l.left < 0 || l.right > s.width || l.right - l.left < t || l.y < 0 || l.y + t > s.height + .001)
        errors.push(`${label}: endpoints and height must stay inside the overall dimensions.`);
      if (!next) return;
      if (next.y - l.y <= t) errors.push(`${label}: leave a positive opening below the next shelf.`);
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
  const api = { normalize, preset, boards, validate, resize, dividerPosition, placement, fit, round };
  root.Bookshelf = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
