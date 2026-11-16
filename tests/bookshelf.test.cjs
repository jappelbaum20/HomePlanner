const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bookshelf.js');

test('all presets produce valid boards, exact extents and butt-joint divider lengths', () => {
  for (const kind of ['framed', 'staggered', 'stepped']) {
    const s = B.preset(kind), parts = B.boards(s);
    assert.deepEqual(B.validate(s).errors, [], kind);
    assert.equal(Math.max(...parts.map(b => b.y + b.h)), s.height);
    for (const b of parts) assert.ok(b.w > 0 && b.h > 0);
    assert.equal(parts.find(b => b.id === 'D1.1').length, B.round(s.levels[1].y - s.thickness));
    assert.equal(parts.length, 26);
  }
});
test('resizing preserves flush supports, thickness and overall height', () => {
  const s = B.resize(B.preset('framed'), 180, 190);
  assert.deepEqual(B.validate(s).errors, []);
  assert.equal(s.thickness, 2.4);
  assert.equal(s.levels[0].dividers[0], 1.2);
  assert.equal(s.levels[0].dividers.at(-1), 178.8);
  assert.equal(s.levels.at(-1).y, 187.6);
});
test('invalid shelves, detached supports and overlapping dividers cannot produce an approved cut list', () => {
  let s = B.preset(); s.levels[0].right = 30;
  assert.match(B.validate(s).errors.join(), /shared span/);
  s = B.preset(); s.levels[1].y = 1;
  assert.match(B.validate(s).errors.join(), /positive opening/);
  s = B.preset(); s.levels[0].dividers.push(s.levels[0].dividers[0]);
  assert.match(B.validate(s).errors.join(), /overlap/);
});
test('wall placement uses consistent plan offsets and faces into the room on all four walls', () => {
  const s = B.preset('staggered', 200, 190), r = { width: 485, length: 345 };
  const expected = { n: [120, 17, 0], e: [468, 120, 90], s: [120, 328, 180], w: [17, 120, 270] };
  for (const wall of Object.keys(expected)) {
    const p = B.placement(s, r, { wall, offset: 20, gap: 2, elev: 0 });
    assert.deepEqual([p.x, p.y, p.rot], expected[wall]);
  }
});
test('fit rejects windows, radiator zones, ceilings and wall overruns; allows clear wall', () => {
  const r = { width: 485, length: 345, height: 213, openings: [{ type: 'window', wall: 's', offset: 35, width: 159, height: 125, sill: 85, radiator: true }] };
  const s = B.preset('staggered', 200, 190), t = { wall: 'n', offset: 20, gap: 2, elev: 0 };
  assert.deepEqual(B.fit(s, r, t), []);
  assert.match(B.fit(s, r, { ...t, wall: 's' }).join(), /window/);
  assert.match(B.fit(s, r, { ...t, offset: 400 }).join(), /selected wall/);
  assert.match(B.fit(s, r, { ...t, elev: 30 }).join(), /ceiling/);
  const low = B.preset('framed', 120, 60);
  assert.match(B.fit(low, r, { ...t, wall: 's' }).join(), /radiator/);
});

test('shrinking and expanding every preset preserves supported stepped edges', () => {
  for (const kind of ['framed', 'staggered', 'stepped']) {
    for (const width of [80, 120, 180, 240, 300, 480]) {
      for (const thickness of [1.8, 2.4, 3.6]) {
        const s = B.resize(B.preset(kind, 240, 200, 30, thickness), width, 190);
        assert.deepEqual(B.validate(s).errors, [], `${kind}, ${width} cm, ${thickness} cm boards`);
        assert.equal(s.levels.at(-1).y + thickness, 190);
        assert.equal(B.normalize(JSON.parse(JSON.stringify(s))).levels.length, 6);
      }
    }
  }
});
test('repeated divider additions fill free spaces without collisions or exceeding the saved limit', () => {
  for (const kind of ['framed', 'staggered', 'stepped']) {
    const s = B.preset(kind, 120);
    let added = 0, x;
    while ((x = B.dividerPosition(s, 0)) !== null) {
      s.levels[0].dividers.push(x); added++;
      assert.deepEqual(B.validate(s).errors, [], kind);
      assert.ok(added <= 30);
    }
    assert.ok(added > 1);
    assert.ok(s.levels[0].dividers.length <= 30);
    assert.equal(B.normalize(s).levels[0].dividers.length, s.levels[0].dividers.length);
  }
});
test('malformed imported levels are recoverable as an invalid design instead of crashing', () => {
  const s = B.normalize({ levels: [null, false, 'bad', {}] });
  assert.equal(s.levels.length, 1);
  assert.ok(B.validate(s).errors.length);
  assert.doesNotThrow(() => B.boards(s));
});

test('SÆTTER reference has a backed four-by-three layout with paired short separators', () => {
  const s = B.saetter3(), parts = B.boards(s);
  assert.deepEqual([s.width, s.height, s.depth], [45.5, 40.6, 10.5]);
  assert.deepEqual(B.validate(s).errors, []);
  assert.equal(s.levels.length, 4);
  assert.equal(parts.filter(p => p.kind === 'Back').length, 1);
  assert.equal(parts.filter(p => p.kind === 'Separator').length, 18);
  assert.deepEqual([parts[0].length, parts[0].depth, parts[0].thickness], [40.6, 45.5, .5]);
  assert.equal(parts.find(p => p.id === 'S1').depth, 10);
  assert.equal(parts.find(p => p.id === 'D1.2').h, 3);
  assert.equal(parts.find(p => p.id === 'D1.2T').x, parts.find(p => p.id === 'D1.2').x);
  const widths = s.levels[0].dividers.slice(1).map((x, i) => B.round(x - s.levels[0].dividers[i] - s.thickness));
  assert.deepEqual(widths, [10, 10, 10, 10]);
  assert.ok(Math.abs(s.levels[1].y - s.thickness - 12) < .07);
  assert.deepEqual(B.normalize(JSON.parse(JSON.stringify(s))), s);
  const resized = B.resize(s, 50, 44);
  assert.deepEqual(B.validate(resized).errors, []);
  assert.equal(resized.backThickness, .5);
  assert.equal(resized.separatorHeight, 3);
});

test('SÆTTER invalid back and overlapping separator lengths are rejected', () => {
  const s = B.saetter3();
  s.backThickness = s.depth;
  s.separatorHeight = 7;
  assert.match(B.validate(s).errors.join(' '), /Back thickness/);
  assert.match(B.validate(s).errors.join(' '), /separators must not overlap/);
  assert.equal(B.normalize(B.preset()).template, undefined);
});

test('all SÆTTER previews use the manufacturer dimensions and the same parts in 3D', () => {
  const expected = { '3': [3, 4, 45.5, 40.6, 10.5], '5': [5, 4, 45.5, 66.7, 11.2], '7': [7, 4, 45.5, 92.4, 11.2], '15': [5, 3, 34.4, 66.7, 11.2] };
  for (const variant of B.SAETTER_VARIANTS) {
    const s = B.saetterVariant(variant.id), [rows, cols, width, height, depth] = expected[variant.id];
    assert.deepEqual([variant.rows, variant.cols, s.width, s.height, s.depth], [rows, cols, width, height, depth]);
    assert.equal(s.levels.length, rows + 1);
    assert.equal(s.levels[0].dividers.length, cols + 1);
    assert.ok(s.levels[0].dividers.slice(1).every((x, index) => Math.abs(x - s.levels[0].dividers[index] - s.thickness - 10) < .001));
    assert.equal(B.round(s.depth - s.backThickness), 10);
    assert.ok(Math.abs(s.levels[1].y - s.thickness - 12) < .1);
    assert.deepEqual(B.visualBoards(s), B.boards(s));
    assert.equal(B.visualBoards(s).filter(p => p.kind === 'Separator').length, rows * (cols - 1) * 2);
  }
});

// ---- SÆTTER scale: openings grow by a percentage, boards keep their thickness, compartment count stays ----
test('scale 0 returns exactly the real SÆTTER dimensions for every model', () => {
  const s = B.saetter3(0);
  assert.deepEqual([s.width, s.height, s.depth, s.thickness, s.backThickness], [45.5, 40.6, 10.5, 1.1, .5]);
  assert.deepEqual(s.levels[0].dividers, [.55, 11.65, 22.75, 33.85, 44.95]);
  assert.deepEqual(B.saetter3(), B.saetter3(0));
  for (const v of B.SAETTER_VARIANTS) {
    const d = B.saetterVariant(v.id, 0);
    assert.deepEqual([d.width, d.height, d.depth], [v.width, v.height, v.depth], v.label);
    assert.equal(d.levels.length, v.rows + 1);
    assert.equal(d.levels[0].dividers.length, v.cols + 1);
  }
});
test('scaling up and back to 0 leaves no rounding drift', () => {
  for (const pct of [5, 10, 17, 33.3, 50, -20, -7]) {
    B.saetter3(pct);
    assert.equal(JSON.stringify(B.saetter3(0)), JSON.stringify(B.saetter3()));
  }
  assert.deepEqual(B.saetterScale(B.saetter3(0)), { pct: 0, exact: true });
});
test('scale grows the compartment openings in all three directions and keeps boards and count fixed', () => {
  const base = B.saetter3(0), s = B.saetter3(10);
  assert.equal(s.levels.length, base.levels.length);
  assert.equal(s.levels[0].dividers.length, base.levels[0].dividers.length);
  assert.equal(s.thickness, base.thickness);
  assert.equal(s.backThickness, base.backThickness);
  assert.equal(s.separatorHeight, base.separatorHeight);
  const open = d => ({ w: B.round(d.levels[0].dividers[1] - d.levels[0].dividers[0] - d.thickness), h: B.round(d.levels[1].y - d.levels[0].y - d.thickness), d: B.round(d.depth - d.backThickness) });
  const a = open(base), b = open(s);
  assert.equal(a.w, 10); assert.equal(a.d, 10); assert.ok(Math.abs(a.h - 12.067) < .001);
  assert.ok(Math.abs(b.w - 11) < 1e-9 && Math.abs(b.d - 11) < 1e-9 && Math.abs(b.h - a.h * 1.1) < .002);
  assert.deepEqual([s.width, s.height, s.depth], [49.5, 44.22, 11.5]);
  assert.deepEqual(B.validate(s).errors, []);
  const parts = B.boards(s), baseParts = B.boards(base);
  assert.equal(parts.length, baseParts.length);
  for (const p of parts) assert.equal(p.thickness, p.kind === 'Back' ? .5 : 1.1);
});
test('the whole allowed range builds valid shelves and is clamped outside it', () => {
  for (const v of B.SAETTER_VARIANTS) for (const pct of [B.SAETTER_SCALE.min, 0, 25, B.SAETTER_SCALE.max])
    assert.deepEqual(B.validate(B.saetterVariant(v.id, pct)).errors, [], `${v.label} ${pct}`);
  assert.deepEqual(B.saetter3(500), B.saetter3(50));
  assert.deepEqual(B.saetter3(-90), B.saetter3(-20));
  assert.deepEqual(B.saetter3('abc'), B.saetter3(0));
});
test('the scale is recovered from the saved dimensions alone', () => {
  for (const pct of [-20, -5, 0, 5, 10, 12.5, 20, 50]) {
    const saved = JSON.parse(JSON.stringify(B.saetter3(pct)));
    assert.deepEqual(B.saetterScale(saved), { pct, exact: true }, String(pct));
  }
  assert.equal(B.saetterScale(B.preset('framed')), null);
  const edited = { ...B.saetter3(10), separatorHeight: 2.5 };
  assert.deepEqual(B.saetterScale(edited), { pct: 10, exact: false });
});
test('every scaled SÆTTER 3 fits the schema limits for saved shelves', () => {
  const schema = require('../shared/schema/shelf-v1.json').properties;
  for (const pct of [-20, 0, 50]) {
    const s = B.saetter3(pct);
    assert.ok(s.width >= schema.width.minimum && s.width <= schema.width.maximum);
    assert.ok(s.height >= schema.height.minimum && s.height <= schema.height.maximum);
    assert.ok(s.depth >= schema.depth.minimum && s.depth <= schema.depth.maximum);
    assert.ok(s.backThickness >= schema.backThickness.minimum);
  }
});
