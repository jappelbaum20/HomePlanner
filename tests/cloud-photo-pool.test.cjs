'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../client/cloud.js'), 'utf8'), sandbox);
const { mapLimit } = sandbox.window.HomePlannerCloud;
const tick = () => new Promise(r => setImmediate(r));

test('mapLimit never exceeds the limit and keeps result order', async () => {
  let active = 0, peak = 0;
  const out = await mapLimit(Array.from({ length: 12 }, (_, i) => i), 4, async n => {
    active++; peak = Math.max(peak, active); await tick(); await tick(); active--; return n * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(Array.from(out), Array.from({ length: 12 }, (_, i) => i * 2));
});

test('mapLimit handles empty input and fewer items than the limit', async () => {
  assert.deepEqual(Array.from(await mapLimit([], 4, async x => x)), []);
  assert.deepEqual(Array.from(await mapLimit([1, 2], 4, async x => x + 1)), [2, 3]);
});

test('a failed task rejects with its error, frees its slot and starts nothing new', async () => {
  const started = [];
  await assert.rejects(mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 2, async n => {
    started.push(n); await tick(); if (n === 1) throw new Error('boom'); await tick();
  }), /boom/);
  await tick(); await tick(); await tick();
  assert.ok(started.length < 8);
});
