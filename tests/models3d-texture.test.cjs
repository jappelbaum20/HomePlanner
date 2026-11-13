const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const THREE = require('three');
const Bookshelf = require('../bookshelf.js');

function models() {
  const drawing = new Proxy({}, { get: () => () => {} });
  const document = { createElement: () => ({ getContext: () => drawing }) };
  const context = vm.createContext({ window: { Bookshelf }, Bookshelf, document });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'models3d.js'), 'utf8'), context);
  context.window.HouseModels.init(THREE);
  return context.window.HouseModels;
}

test('walnut boards share one texture and preserve the original UV transforms', () => {
  const house = models(), first = house.walnut('#76513D', 100, 2), second = house.walnut('#76513D', 2, 80);
  assert.equal(first.map, second.map);
  assert.equal(first.map, first.bumpMap);
  for (const [width, height, depth] of [[100, 2, 30], [2, 80, 10], [40.6, 45.5, .5], [25, 25, 3]]) {
    const original = new THREE.BoxGeometry(width, height, depth).attributes.uv;
    const actual = house.walnutGeometry(width, height, depth).attributes.uv;
    const tall = height > width, long = tall ? height : width, short = tall ? width : height;
    const matrix = new THREE.Matrix3().setUvTransform(0, 0, long / 80, short / 80, tall ? Math.PI / 2 : 0, tall ? .5 : 0, tall ? .5 : 0);
    for (let index = 0; index < original.count; index++) {
      const expected = new THREE.Vector2().fromBufferAttribute(original, index).applyMatrix3(matrix);
      assert.ok(Math.abs(actual.getX(index) - expected.x) < 1e-6);
      assert.ok(Math.abs(actual.getY(index) - expected.y) < 1e-6);
    }
  }
});

test('shelf construction applies the shared texture to every board', () => {
  const house = models(), design = Bookshelf.preset('staggered', 240, 200);
  const group = house.buildItem({ type: 'shelf', w: design.width, h: design.height, d: design.depth, color: '#76513D', shelfDesign: design, elev: 1 }, {});
  const boards = group.children.filter(child => child.isMesh);
  assert.equal(boards.length, Bookshelf.visualBoards(design).length);
  assert.ok(boards.every(board => board.material.map === boards[0].material.map));
  assert.ok(boards.every(board => board.geometry.attributes.uv));
});
