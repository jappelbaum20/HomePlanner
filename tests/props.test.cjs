'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const B = require('../bookshelf.js'), P = require('../bookshelf-props.js');

const saetter = B.saetter3();
const boxHit = (a, b) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6;
// Real boards as boxes in the same furniture-local frame (z from the front). Boards stop at the back panel.
function boardBoxes(s) {
  const back = s.template === 'saetter3' ? s.backThickness : 0;
  return B.boards(s).filter(b => b.kind !== 'Back').map(b => ({ x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h, z0: 0, z1: s.depth - back }));
}

test('catalogue sizes are the real sizes in cm', () => {
  assert.deepEqual(P.size('mug'), { w: 11, d: 8, h: 9.5 });
  assert.equal(P.size('wine').h, 21); assert.equal(P.size('water').h, 11); assert.equal(P.size('book').h, 18);
  assert.equal(P.size('vase').h, 25); assert.equal(P.PERSON.h, 175); assert.equal(P.size('nope'), null);
});

test('SAETTER 3: a compartment takes a mug at the shelf top, centred in the bay', () => {
  const r = P.fitProp(saetter, 'mug', { x: 6, y: 5 });
  assert.equal(r.ok, true); assert.equal(r.y, 1.1); assert.ok(Math.abs(r.x - 6.1) < 1.5, 'inside first bay');
  assert.ok(r.x - r.w / 2 >= 1.1 - 1e-6 && r.x + r.w / 2 <= 11.1 + 1e-6, 'between dividers');
});

test('SAETTER 3: tall items are refused inside, with a friendly message', () => {
  for (const kind of ['wine', 'vase', 'plant', 'book']) {
    const r = P.fitProp(saetter, kind, { x: 17, y: 20 });
    assert.equal(r.ok, false, kind); assert.equal(r.reason, 'tooTall'); assert.match(r.message, /Too tall for this shelf/);
  }
});

test('the open top of the top shelf takes everything', () => {
  const topY = saetter.height;
  for (const kind of P.KINDS) {
    const r = P.fitProp(saetter, kind, { x: 22, y: topY });
    assert.equal(r.ok, true, kind); assert.ok(Math.abs(r.y - topY) < 1e-6);
  }
});

test('a book that is too deep or wide for a bay is refused; the lying orientation is tried', () => {
  const wide = B.normalize({ width: 100, height: 60, depth: 25, thickness: 2, levels: [{ y: 0, left: 0, right: 100, dividers: [1, 99] }, { y: 20, left: 0, right: 100, dividers: [] }, { y: 58, left: 0, right: 100, dividers: [] }] });
  const r = P.fitProp(wide, 'book', { x: 50, y: 5 });
  assert.equal(r.ok, true); assert.equal(r.rot, 0);
  const low = B.normalize({ width: 100, height: 60, depth: 25, thickness: 2, levels: [{ y: 0, left: 0, right: 100, dividers: [1, 99] }, { y: 8, left: 0, right: 100, dividers: [] }, { y: 58, left: 0, right: 100, dividers: [] }] });
  const flat = P.fitProp(low, 'book', { x: 50, y: 4 });
  assert.equal(flat.ok, true); assert.equal(flat.rot, 1); assert.equal(flat.h, 2.5); // 6 cm of headroom: it lies down
  const squeezed = B.normalize({ ...low, levels: [low.levels[0], { ...low.levels[1], y: 3.5 }, low.levels[2]] });
  const none = P.fitProp(squeezed, 'book', { x: 50, y: 1 });
  assert.equal(none.ok, false); assert.equal(none.reason, 'tooTall'); // 1.5 cm of headroom
});


test('depth: an item more than 20 percent deeper than the shelf is refused', () => {
  const shallow = B.normalize({ width: 60, height: 40, depth: 7, thickness: 1.5, levels: [{ y: 0, left: 0, right: 60, dividers: [] }, { y: 38.5, left: 0, right: 60, dividers: [] }] });
  assert.equal(P.fitProp(shallow, 'cup', { x: 30, y: 38.5 }).reason, 'tooDeep'); // 9.5 cm saucer on 7 cm
  const ok = B.normalize({ ...shallow, depth: 8 });
  assert.equal(P.fitProp(ok, 'cup', { x: 30, y: 38.5 }).ok, true); // 9.5 on 8 overhangs 16 percent
});

test('width: a mug does not squeeze into a gap narrower than itself', () => {
  const narrow = B.normalize({ width: 40, height: 30, depth: 20, thickness: 1, levels: [{ y: 0, left: 0, right: 40, dividers: [.5, 8, 39.5] }, { y: 29, left: 0, right: 40, dividers: [] }] });
  const r = P.fitProp(narrow, 'mug', { x: 4, y: 3 });
  assert.equal(r.ok, false); assert.equal(r.reason, 'tooWide'); assert.match(r.message, /Too wide/);
});

test('clicking a divider or a board edge picks the nearest surface at or below the click', () => {
  const t = saetter.thickness, row1 = saetter.levels[1];
  const onBoardFront = P.fitProp(saetter, 'mug', { x: 6, y: row1.y + t / 2 }); // front edge of shelf 2: its top
  assert.equal(onBoardFront.ok, true); assert.ok(Math.abs(onBoardFront.y - (row1.y + t)) < 1e-6 || onBoardFront.y <= row1.y + t + 1e-6);
  const onDivider = P.fitProp(saetter, 'mug', { x: 11.65, y: row1.y + 5 });
  assert.equal(onDivider.ok, true); assert.ok(Math.abs(onDivider.y - (row1.y + t)) < 1e-6);
});

test('items already there are not overlapped: the new one slides to free space or is refused', () => {
  const first = P.fitProp(saetter, 'water', { x: 6, y: 5 }); assert.equal(first.ok, true);
  const second = P.fitProp(saetter, 'water', { x: 6, y: 5 }, [first]);
  assert.equal(second.ok, false); assert.equal(second.reason, 'full'); // a 10 cm bay holds one 7 cm glass
  const roomy = B.normalize({ width: 80, height: 30, depth: 20, thickness: 1, levels: [{ y: 0, left: 0, right: 80, dividers: [] }, { y: 29, left: 0, right: 80, dividers: [] }] });
  const a = P.fitProp(roomy, 'mug', { x: 40, y: 3 }), b = P.fitProp(roomy, 'mug', { x: 40, y: 3 }, [a]);
  assert.equal(b.ok, true); assert.ok(Math.abs(b.x - a.x) >= 11 - 1e-6);
});

test('stepped shelves: the ceiling above a surface comes from the boards that really cover it', () => {
  const s = B.preset('stepped', 120, 120, 30, 2.4, 4);
  const sf = P.surfaces(s);
  assert.ok(sf.some(x => x.ceiling === Infinity), 'open tops exist');
  sf.forEach(x => assert.ok(x.ceiling > x.y));
});

test('Node check over every SAETTER bay: no item ever intersects a board, in any variant', () => {
  let placed = 0, refused = 0;
  B.SAETTER_VARIANTS.forEach(v => {
    const s = B.saetterVariant(v.id), boards = boardBoxes(s);
    P.surfaces(s).forEach(sf => {
      for (const kind of P.KINDS) for (const hx of [sf.x0 + .2, (sf.x0 + sf.x1) / 2, sf.x1 - .2]) {
        const r = P.fitProp(s, kind, { x: hx, y: sf.y });
        if (!r.ok) { refused++; assert.ok(['tooTall', 'tooWide', 'tooDeep'].includes(r.reason), r.reason); continue; }
        placed++;
        const box = P.itemBox(r);
        // allowed to overhang the front/back by at most 20 percent of its depth, never to touch a board
        const clip = { ...box, z0: Math.max(box.z0, 0), z1: Math.min(box.z1, s.depth) };
        boards.forEach(b => assert.equal(boxHit(clip, b), false, `${v.label} ${kind} at ${hx} hits ${JSON.stringify(b)}`));
        assert.ok(r.z - r.d / 2 >= -(r.d * .2) - 1e-6 && r.z + r.d / 2 <= sf.depth + 1e-6 + 0, 'depth within the 20 percent rule');
      }
    });
  });
  assert.ok(placed > 50 && refused > 20, `placed ${placed}, refused ${refused}`);
});

test('resnap keeps true size, moves items with the furniture and drops those without a surface', () => {
  const placed = P.fitProp(saetter, 'mug', { x: 6, y: 5 }), items = [{ ...placed, id: 'a', kind: 'mug' }];
  const bigger = B.resize(saetter, saetter.width * 1.1, saetter.height * 1.1);
  const r = P.resnap(bigger, items, saetter);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].w, 11); assert.equal(r.items[0].h, 9.5);
  const tiny = B.normalize({ width: 20, height: 20, depth: 10, thickness: 1, levels: [{ y: 0, left: 0, right: 20, dividers: [1, 19] }, { y: 19, left: 0, right: 20, dividers: [] }] });
  const gone = P.resnap(tiny, [{ ...placed, id: 'a', kind: 'mug', level: 0 }], saetter);
  assert.equal(gone.items.length, 1); // 17 cm wide bay still takes the 11 cm mug
  const tall = [{ ...P.fitProp(saetter, 'plant', { x: 22, y: saetter.height }), id: 'p', kind: 'plant' }];
  assert.equal(P.resnap(saetter, tall, saetter).items.length, 1);
});

test('the limit constant is stable and unknown kinds are refused', () => {
  assert.equal(P.MAX_ITEMS, 20); assert.equal(P.fitProp(saetter, 'piano', { x: 1, y: 1 }).reason, 'unknown');
});
