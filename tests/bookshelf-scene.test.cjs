const test = require('node:test'), assert = require('node:assert/strict');
const B = require('../bookshelf.js'), S = require('../bookshelf-scene.js');

test('frame distance grows with size, shrinks with aspect and respects the margin', () => {
  const t = Math.tan(32 * Math.PI / 360);
  assert.ok(Math.abs(S.frameDistance(100, 50, 2, 32, 1) - 50 / (2 * t)) < 1e-9);
  assert.ok(S.frameDistance(100, 50, 1) > S.frameDistance(100, 50, 2));
  assert.ok(S.frameDistance(200, 100, 1.5) > S.frameDistance(100, 50, 1.5));
  assert.ok(Math.abs(S.frameDistance(50, 50, 1) / S.frameDistance(50, 50, 1, 32, 1) - 1.35) < 1e-9);
});

test('frameBox centres on the box and the framed rectangle fills 60-85 % of the view', () => {
  const box = { minX: 10, maxX: 55.5, minY: 0, maxY: 40.6, minZ: 0, maxZ: 10.5 };
  const f = S.frameBox(box, 1.6);
  assert.deepEqual(f.center, [32.75, 20.3, 5.25]);
  const t = Math.tan(S.FOV * Math.PI / 360), visibleHeight = 2 * (f.distance - 5.25) * t;
  const share = Math.max(45.5 / 1.6, 40.6) / visibleHeight;
  assert.ok(share > .6 && share < .85, String(share));
});

test('camera position follows azimuth and elevation at the given distance', () => {
  const p = S.cameraPosition([0, 0, 0], 100, 0, 0); assert.deepEqual(p.map(Math.round), [0, 0, 100]);
  const q = S.cameraPosition([10, 5, 0], 100, 22, 10);
  assert.ok(Math.abs(Math.hypot(q[0] - 10, q[1] - 5, q[2]) - 100) < 1e-9); assert.ok(q[0] > 10 && q[1] > 5);
  assert.equal(S.clampAzimuth(120), 60); assert.equal(S.clampAzimuth(-90), -60); assert.equal(S.clampAzimuth(20), 20);
});

test('size steps scale all three dimensions, keep thickness exact and stack', () => {
  const d = B.preset('staggered', 240, 200, 30, 2.4);
  const up = S.applySizeStep(B, d, 10);
  assert.equal(up.width, 264); assert.equal(up.height, 220); assert.equal(up.depth, 33);
  assert.equal(up.design.width, 264); assert.equal(up.design.thickness, 2.4); assert.equal(up.design.depth, 33);
  assert.equal(B.validate(up.design).errors.length, 0);
  const again = S.applySizeStep(B, up.design, 5); assert.equal(again.width, 277.2);
  const down = S.applySizeStep(B, d, -10); assert.equal(down.width, 216);
});

test('size steps stop at the saved-design limits instead of distorting proportions', () => {
  const big = S.sizeStep({ width: 480, height: 300, depth: 30 }, 10); assert.equal(big.clamped, true);
  const small = S.sizeStep({ width: 21, height: 100, depth: 11 }, -10); assert.equal(small.clamped, true);
  const ok = S.sizeStep({ width: 100, height: 100, depth: 30 }, 5); assert.equal(ok.clamped, false); assert.equal(ok.changed, true);
  assert.equal(S.applySizeStep(B, B.preset('framed', 480, 300, 30), 10).changed && S.sizeStep({ width: 480, height: 300, depth: 30 }, 10).clamped, true);
});

test('dimension line layout labels width, height and depth at the middle of each line', () => {
  const box = { minX: 0, maxX: 45.5, minY: 0, maxY: 40.6, minZ: 0, maxZ: 10.5 };
  const lines = S.dimensionLines(box), by = k => lines.find(l => l.key === k);
  assert.deepEqual(lines.map(l => l.text), ['45.5 cm', '40.6 cm', '10.5 cm']);
  assert.deepEqual(by('width').mid, [22.75, 46.6, 10.5]);
  assert.ok(by('height').a[0] < box.minX && by('depth').a[0] > box.maxX);
  assert.equal(S.dimensionLines({ ...box, maxX: 50 })[0].text, '50 cm');
});

test('wall lines add the elevation label only for raised furniture', () => {
  const wall = { width: 500, height: 250 };
  assert.deepEqual(S.wallLines(wall, { minX: 20, minY: 0, maxZ: 10 }).map(l => l.key), ['wallWidth', 'wallHeight']);
  const raised = S.wallLines(wall, { minX: 20, minY: 100, maxZ: 10 });
  assert.equal(raised.at(-1).text, '100 cm above floor'); assert.equal(raised[0].text, '500 cm');
});

test('cropped drawing keeps the furniture dominant on a large wall', () => {
  const c = S.cropViewBox({ x: 20, y: 454.4, w: 45.5, h: 40.6 });
  assert.ok(45.5 / c.w > .5 && 40.6 / c.h > .5, JSON.stringify(c));
  assert.ok(c.x < 20 && c.y < 454.4 && c.x + c.w > 65.5 && c.y + c.h > 495);
  assert.ok(c.fontSize < 3 && c.fontSize > 1);
  assert.match(c.viewBox, /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
});

test('SAETTER comparison variants are valid designs with the published sizes', () => {
  assert.deepEqual(B.SAETTER_VARIANTS.map(v => v.id), ['3', '5', '7', '15']);
  for (const v of B.SAETTER_VARIANTS) {
    const d = B.saetterVariant(v.id); assert.equal(B.validate(d).errors.length, 0, v.id);
    assert.equal(d.width, v.width); assert.equal(d.height, v.height); assert.equal(d.depth, v.depth); assert.equal(d.levels.length, v.rows + 1);
  }
  assert.deepEqual(B.saetterVariant('3'), B.saetter3());
  assert.equal(S.readout(B.saetter3()), 'Furniture 45.5 × 40.6 × 10.5 cm (W × H × D)');
});

test('hitToLocal: a hit on a board underside belongs to the bay below, an upward face keeps its depth', () => {
  const f = { offset: 100, elev: 120, gap: 0, depth: 10.5, design: { thickness: 1.1 } };
  const up = S.hitToLocal({ x: 130, y: 121.1, z: 4 }, 1, f), down = S.hitToLocal({ x: 130, y: 132.2, z: 10 }, -1, f), face = S.hitToLocal({ x: 130, y: 125, z: 10.5 }, 0, f);
  assert.ok(Math.abs(up.x - 30) < 1e-9 && Math.abs(up.y - 1.1) < 1e-9 && Math.abs(up.z - 6.5) < 1e-9);
  assert.ok(Math.abs(down.y - (12.2 - 1.75)) < 1e-9 && !('z' in down));
  assert.ok(!('z' in face));
});
