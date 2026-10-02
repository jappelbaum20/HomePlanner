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
