#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('./run-browser.cjs').loadPlaywright();
const { serve, PORT } = require('./run-browser.cjs');

const output = process.env.SHELF_BENCH_OUT;
if (!output || !path.isAbsolute(output)) throw Error('Set SHELF_BENCH_OUT to an absolute output directory.');
const label = process.argv[2] || 'measurement';
const summary = values => {
  const sorted = values.slice().sort((left, right) => left - right);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] };
};

async function measure(page, name, tab) {
  await page.goto(`http://127.0.0.1:${PORT}/bookshelf`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#bs3d canvas').waitFor();
  if (tab === 'saetter') await page.locator('#bs-tab-saetter').click();
  await page.waitForFunction(() => window.__bench && window.__bsDebug && window.__bsDebug.frames > 0);
  await page.waitForTimeout(1200);
  await page.locator('[data-bs-addtoggle]').click();
  await page.locator('[data-bs-prop="mug"]').click();
  await page.locator('#bs3d canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  const dimensions = await page.evaluate(() => ({ width: __bench.scene.rig.state.design.width, height: __bench.scene.rig.state.design.height, rows: __bench.scene.rig.state.design.levels.length - 1 }));
  const updates = await page.evaluate(() => {
    const scene = __bench.scene, timings = [];
    for (let index = 0; index < 10; index++) {
      const start = performance.now(); scene.update(scene.rig.state, false); timings.push(performance.now() - start);
    }
    const start = performance.now();
    for (let index = 0; index < 100; index++) scene.update(scene.rig.state, false);
    return { timings, batchMean: (performance.now() - start) / 100 };
  });
  await page.waitForTimeout(1000);
  const point = async (x, y) => page.evaluate(([localX, localY]) => __bsDebug.screenOf(localX, localY), [x, y]);
  const click = async (x, y) => { const position = await point(x, y); await page.mouse.click(position.x, position.y); };
  const x = tab === 'saetter' ? 6 : 30, y = 5;
  await page.evaluate(() => { __bench.eventTimes = []; __bench.captureEvents = true; });
  await click(x, y);
  if (await page.evaluate(() => __bsDebug.props) !== 1) throw Error(`${name}: initial item was not placed`);
  await page.waitForTimeout(800);
  await page.locator('#bs3d').screenshot({ path: path.join(output, `${label}-${name}.png`) });
  const initial = await page.evaluate(() => ({ ...__bench.scene.rig.renderer.info.memory }));
  await click(x, 9);
  if (await page.evaluate(() => __bsDebug.props) !== 0) throw Error(`${name}: initial item was not removed`);
  await page.waitForTimeout(500);
  const beforeCycles = await page.evaluate(() => ({ ...__bench.scene.rig.renderer.info.memory }));
  const placed = [], removed = [];
  for (let index = 0; index < 50; index++) {
    await click(x, y);
    if (await page.evaluate(() => __bsDebug.props) !== 1) throw Error(`${name}: item placement failed in cycle ${index}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await click(x, 9);
    if (await page.evaluate(() => __bsDebug.props) !== 0) throw Error(`${name}: item removal failed in cycle ${index}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  await page.waitForTimeout(1000);
  const afterCycles = await page.evaluate(() => ({ ...__bench.scene.rig.renderer.info.memory }));
  const events = await page.evaluate(() => { __bench.captureEvents = false; return __bench.eventTimes; });
  if (events.length !== 102) throw Error(`${name}: expected 102 pointer events, received ${events.length}`);
  for (let index = 2; index < events.length; index += 2) { placed.push(events[index]); removed.push(events[index + 1]); }

  const frames = await page.evaluate(async () => {
    __bench.frameTimes = []; __bench.frameStamps = []; __bench.captureFrames = true;
    for (let index = 0; index < 20; index++) { __bsDebug.orbit(-20 + index * 2); await new Promise(resolve => requestAnimationFrame(resolve)); }
    __bench.captureFrames = false;
    return { render: __bench.frameTimes, intervals: __bench.frameStamps.slice(1).map((stamp, index) => stamp - __bench.frameStamps[index]) };
  });

  await page.locator('details').first().evaluate(element => { element.open = true; });
  const drag = await page.evaluate(async () => {
    const board = document.querySelector('#bsDrawing [data-bs-board^="D"] rect');
    if (!board) throw Error('No divider to drag');
    const rect = board.getBoundingClientRect(), startX = rect.left + rect.width / 2, startY = rect.top + rect.height / 2;
    board.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 9 }));
    const timings = [], totals = []; __bench.updateTimes = []; __bench.captureUpdates = true;
    for (let index = 0; index < 10; index++) {
      const before = __bench.updateTimes.length, start = performance.now();
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + (index % 2 ? 2 : 3), clientY: startY, pointerId: 9 }));
      const elapsed = performance.now() - start, synchronous = __bench.updateTimes.length > before;
      timings.push(elapsed);
      await new Promise(resolve => requestAnimationFrame(resolve));
      totals.push(elapsed + (synchronous ? 0 : __bench.updateTimes.slice(before).reduce((sum, value) => sum + value, 0)));
    }
    __bench.captureUpdates = false;
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX, clientY: startY, pointerId: 9 }));
    return { dispatch: timings, updates: __bench.updateTimes, total: totals };
  });
  if (drag.updates.length !== drag.dispatch.length) throw Error(`${name}: expected one scene update per measured drag step`);
  return { dimensions, updateMs: { ...summary(updates.timings), batchMean: updates.batchMean }, placeMs: summary(placed), removeMs: summary(removed), dragStepMs: summary(drag.total), dragDispatchMs: summary(drag.dispatch), dragUpdateMs: summary(drag.updates), orbitRenderMs: summary(frames.render), orbitFrameIntervalMs: summary(frames.intervals), memoryWithItem: initial, memoryBeforeCycles: beforeCycles, memoryAfterCycles: afterCycles };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve(); let browser;
  try {
    const channel = process.env.BROWSER_CHANNEL || 'chrome';
    const options = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
    if (channel !== 'bundled') options.channel = channel;
    browser = await chromium.launch(options);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      let api;
      Object.defineProperty(window, 'BookshelfScene', { configurable: true, get: () => api, set: value => {
        api = value; const create = api.create;
        api.create = options => {
          const scene = create(options), render = scene.rig.renderer.render.bind(scene.rig.renderer), update = scene.update;
          window.__bench = { scene, eventTimes: [], frameTimes: [], frameStamps: [] };
          scene.update = (...args) => {
            const start = performance.now();
            try { return update(...args); } finally { if (__bench.captureUpdates) __bench.updateTimes.push(performance.now() - start); }
          };
          scene.rig.renderer.render = (...args) => {
            const start = performance.now();
            try { return render(...args); } finally { if (__bench.captureFrames) { __bench.frameTimes.push(performance.now() - start); __bench.frameStamps.push(start); } }
          };
          return scene;
        };
      } });
      let started;
      window.addEventListener('pointerup', event => { if (window.__bench?.captureEvents && event.target.matches?.('#bs3d canvas')) started = performance.now(); }, true);
      window.addEventListener('pointerup', event => { if (window.__bench?.captureEvents && event.target.matches?.('#bs3d canvas') && started !== undefined) { __bench.eventTimes.push(performance.now() - started); started = undefined; } });
    });
    const result = { label, browser: await browser.version(), platform: process.platform, timestamp: new Date().toISOString(), scenarios: {} };
    result.scenarios.saetter = await measure(page, 'saetter', 'saetter');
    result.scenarios.large = await measure(page, 'large', 'custom');
    fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
