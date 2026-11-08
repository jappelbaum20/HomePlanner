'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { validate } = require('../shared/contracts'), B = require('../bookshelf');
const doc = () => ({ version: 2, shelf: B.saetter3(), wall: { widthCm: 300, heightCm: 240, color: '#123ABC' }, placement: { offsetCm: 10, elevationCm: 20, gapCm: 3 }, activeTab: 'saetter' });
const body = (payload, schemaVersion = 4) => ({ kind: 'shelf', title: 'Fixture', schemaVersion, payload, photoIds: [] });
test('v4 shelf document and legacy geometry are compatible while v3 remains frozen', () => {
  assert.ok(validate('shelfDocument', doc()).valid);
  assert.ok(validate('writeDesign', body(doc())).valid);
  assert.ok(validate('writeDesign', body(B.saetter3(), 3)).valid);
  assert.ok(validate('writeDesign', body(B.saetter3())).valid);
  assert.equal(validate('writeDesign', body(doc(), 3)).valid, false);
});
test('strict shelf document rejects malformed dimensions, color, placement and unknown properties', () => {
  for (const mutate of [d => d.wall.widthCm = 9, d => d.wall.heightCm = 2001, d => d.wall.color = 'red', d => d.placement.gapCm = 101, d => d.placement.offsetCm = -1, d => d.activeTab = 'other', d => d.wall.roomId = 'x', d => d.shelf.levels[0].left = -1, d => d.wall.widthCm = NaN]) {
    const d = doc(); mutate(d); assert.equal(validate('shelfDocument', d).valid, false); assert.equal(validate('writeDesign', body(d)).valid, false);
  }
  const overflow = doc(); overflow.wall.widthCm = 10;
  assert.ok(validate('shelfDocument', overflow).valid, 'overflow remains saveable and must be reported by the editor');
});
