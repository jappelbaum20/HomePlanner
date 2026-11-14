/* Compare with real things: palette, click to place, click to remove, fit messages, true size, clear, session-only; plus realism and phone budget checks. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  const dbg = () => page.evaluate(() => ({ props: window.__bsDebug.props, person: window.__bsDebug.person, items: window.__bsDebug.items, bounds: window.__bsDebug.propBounds, info: window.__bsDebug.info(), q: window.__bsDebug.quality, real: window.__bsDebug.realism(), frames: window.__bsDebug.frames }));
  const help = () => page.locator('#bsPropHelp').innerText();
  const open = async (tab, vp) => {
    await page.setViewportSize(vp || { width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:8765/bookshelf'); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.locator('#bs3d canvas').waitFor();
    if (tab === 'saetter') await page.locator('#bs-tab-saetter').click();
    await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0); await page.waitForTimeout(300);
    check(await page.locator('#bsProps').isVisible(), `${tab}: comparison picker is visible without opening a menu`);
  };
  const at = (x, y, z = 0) => page.evaluate(([x, y, z]) => window.__bsDebug.screenOf(x, y, z), [x, y, z]);
  const click = async (x, y, z) => { await page.locator('#bs3d canvas').scrollIntoViewIfNeeded(); const p = await at(x, y, z); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); };
  const pick = kind => page.locator(`[data-bs-prop="${kind}"]`).click();

  // ---------- palette ----------
  await open('saetter');
  const names = await page.locator('.bs-prop span').allInnerTexts();
  check(['Mug', 'Coffee cup', 'Wine glass', 'Water glass', 'Book', 'Small plant', 'Vase', 'Small jar', 'Tea light', 'Person'].every(n => names.includes(n)), 'palette shows the items with plain names plus a person');
  for (const [kind, ml, fit] of [['espresso', 70, 'Fits inside'], ['cappuccino', 180, 'Does not fit'], ['standard_mug', 330, 'Fits, handle sticks out 2 cm'], ['large_mug', 475, 'Top only'], ['latte', 300, 'Top only']]) {
    const text = await page.locator(`[data-bs-prop="${kind}"]`).innerText();
    check(text.includes(`${ml} ml`) && text.includes('×') && text.includes(fit), `${kind} shows dimensions, capacity and fit`);
  }
  check((await page.locator('[data-bs-prop="mug"]').innerText()).includes('11 × 9.5 × 8 cm') && (await page.locator('[data-bs-prop="mug"]').innerText()).includes('Fits, handle sticks out 1 cm'), 'the mug button shows its size and that it sticks out 1 cm');
  check((await page.locator('[data-bs-prop="wine"]').innerText()).includes('8 × 21 × 8 cm') && (await page.locator('[data-bs-prop="wine"]').innerText()).includes('Top only'), 'the wine button shows its size and top-only fit');
  check((await page.locator('[data-bs-prop="jar"]').innerText()).includes('Fits inside') && (await page.locator('[data-bs-prop="tealight"]').innerText()).includes('Fits inside'), 'small everyday items fit inside');
  check(await page.locator('[data-bs-label="compartment"]').innerText() === '≈ 10 × 12 cm inside', 'the 3D view labels a compartment');
  const box = await page.locator('[data-bs-prop="mug"]').boundingBox();
  check(box.width >= 64 && box.height >= 56, 'palette buttons are big (>= 64 x 56 px)');
  check(await page.locator('[data-bs-action="clearItems"]').isDisabled(), 'Clear items is disabled while nothing is placed');

  // ---------- place and remove ----------
  await pick('mug');
  check(await page.locator('[data-bs-prop="mug"]').getAttribute('aria-pressed') === 'true', 'the chosen item is shown as selected');
  await click(6, 5);
  let d = await dbg();
  check(d.props === 1 && d.items.length === 1, 'clicking a compartment places the mug');
  check(Math.abs(d.items[0].y - 1.1) < 0.01, 'the mug stands on the shelf top (y = board thickness)');
  check(d.items[0].x - d.items[0].w / 2 >= 1.1 - 0.01 && d.items[0].x + d.items[0].w / 2 <= 11.1 + 0.01, 'the mug stays between the dividers');
  check(/Mug placed/.test(await help()) && /handle sticks out 1 cm/.test(await help()), 'a status line confirms the placement and the 1 cm overhang');
  const b = d.bounds[0];
  check(Math.abs(b.h - 9.5) < 0.3 && Math.max(b.w, b.d) >= 10 && Math.max(b.w, b.d) <= 11.3, `the mug model is real size (got ${b.w} x ${b.h} x ${b.d} cm)`);
  check(Math.abs(b.baseY - 1.1) < 0.05, 'the mug model sits on the surface');
  check((await page.locator('[data-bs-label^="item-"]').innerText()).includes('Mug · 9.5 cm high'), 'the placed mug has a size label next to it');
  check(await page.evaluate(() => { const boxes = [...document.querySelectorAll('.bs-comparison-labels span')].map(n => n.getBoundingClientRect()); return boxes.every((a, i) => boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)); }), 'comparison labels do not overlap');
  await click(6, 5 + 4); // click the mug itself
  d = await dbg();
  check(d.props === 0, 'clicking a placed item removes it');
  check(/Mug removed/.test(await help()), 'removal is confirmed');

  // ---------- fit messages ----------
  await pick('wine'); await click(17, 20);
  d = await dbg();
  check(d.props === 1 && /placed on top/.test(await help()), 'clicking a compartment puts a top-only wine glass on top with an explanation');
  check(Math.abs(d.items[0].y - 40.6) < 0.01 && Math.abs(d.bounds[0].h - 21) < 0.01, 'the redirected glass stands on top at its true size');
  await pick('plant'); await click(8, 40.6); await pick('vase'); await click(36, 40.6);
  d = await dbg();
  check(d.props === 3 && Math.abs(d.bounds.find(x => x.kind === 'vase').h - 25) < 0.6 && Math.abs(d.bounds.find(x => x.kind === 'plant').h - 22) < 0.8, 'plant and vase are placed at 22 and 25 cm');
  await pick('cup'); await click(28, 18);
  d = await dbg();
  check(d.items.some(i => i.kind === 'cup' && i.level === 1), 'a coffee cup goes into a middle-row compartment');
  await pick('book'); await click(17, 5);
  check(/placed on top/.test(await help()) && (await dbg()).items.some(i => i.kind === 'book' && i.y === 40.6), 'a book clicked inside is placed on top');

  await pick('standard_mug'); await click(17, 5);
  check(/Standard mug placed/.test(await help()) && /fits, handle sticks out 2 cm/.test(await help()), 'the standard mug message says it sticks out 2 cm');
  await pick('cappuccino'); await click(17, 18);
  check(/Too (wide|deep)/.test(await help()) && (await dbg()).items.every(i => i.kind !== 'cappuccino'), 'the 14 cm saucer is refused (too wide or deep for a compartment)');
  await page.locator('[data-bs-action="clearItems"]').click();

  // ---------- person, clear ----------
  await page.locator('[data-bs-person]').click();
  d = await dbg();
  check(d.person === true && d.bounds.length === d.props, 'the 175 cm person can be shown');
  await page.locator('[data-bs-action="clearItems"]').click();
  d = await dbg();
  check(d.props === 0 && d.person === false && await page.locator('[data-bs-action="clearItems"]').isDisabled(), 'Clear items removes everything');

  for (const kind of ['mug', 'cup', 'wine', 'water', 'book', 'plant', 'vase', 'jar', 'tealight']) {
    await pick(kind); await click(17, 5); d = await dbg();
    const item = d.items[0], bound = d.bounds[0];
    check(d.props === 1 && item && bound && ['w', 'h', 'd'].every(axis => Math.abs(item[axis] - bound[axis]) < .02) && Math.abs(item.y - bound.baseY) < .02, `${kind} 3D bounds match its placement dimensions`);
    if (d.props) await page.locator('[data-bs-action="clearItems"]').click();
  }
  await page.locator('#bsMore summary').click(); await page.locator('[data-bs-sizes]').uncheck();
  check(await page.locator('[data-bs-label]').count() === 0, 'turning sizes off also hides comparison labels');
  await page.locator('[data-bs-sizes]').check(); await page.locator('#bsMore summary').click();

  // ---------- size change keeps item size (custom shelf, direct size step) ----------
  await open('custom');
  await pick('mug'); await click(60, 5);
  d = await dbg(); const before = d.items[0];
  check(d.props === 1 && Math.abs(d.bounds[0].h - 9.5) < 0.3, 'custom shelf: mug placed on the bottom shelf');
  await page.locator('[data-bs-size="10"]').click(); await page.waitForTimeout(250);
  d = await dbg();
  check(d.props === 1 && d.items[0].h === before.h && d.items[0].w === before.w && Math.abs(d.bounds[0].h - 9.5) < 0.3, 'after +10 % the mug keeps its real size');
  check(Math.abs(d.items[0].y - before.y) < 0.01, 'and still stands on the shelf');
  await page.locator('[data-bs-action="undo"]').click(); await page.waitForTimeout(200);
  d = await dbg();
  check(d.props === 1, 'Undo of the size step keeps the item');

  // ---------- items are not saved ----------
  const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  check(!/"kind":"mug"|propId|"items"/.test(stored), 'nothing about items is written to local storage');
  await page.reload(); await page.locator('#bs3d canvas').waitFor(); await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0);
  d = await dbg();
  check(d.props === 0 && d.person === false, 'after reload there are no items (session only)');

  // ---------- room mode still edits boards by click when nothing is selected ----------
  await open('custom');
  await click(120, 100);
  check((await dbg()).props === 0, 'with no item selected a click on the furniture places nothing');

  // ---------- realism and budgets ----------
  await open('saetter');
  d = await dbg();
  check(d.real.shadowsOn && d.real.sunCasts, 'soft shadows are on');
  check(d.real.wallTextured && d.real.wallReceives, 'the wall has a plaster texture and receives shadows');
  check(d.real.floorTextured && d.real.skirting, 'the floor has a wood texture and a 9 cm skirting board is drawn');
  check(d.real.furnitureCasts && d.real.furnitureTextured, 'every board casts a shadow and carries the walnut grain');
  check(d.real.sunColor === 'fff1dc', 'the light is warm');
  check(d.real.shadowMap <= 2048 && d.real.pixelRatio <= 1.5, `shadow map (${d.real.shadowMap}) and pixel ratio (${d.real.pixelRatio}) are capped`);
  for (const [kind, x, y] of [['mug', 6, 5], ['water', 17, 5], ['cup', 28, 18], ['mug', 39, 31], ['plant', 8, 40.6], ['vase', 36, 40.6], ['wine', 22, 40.6]]) { await pick(kind); await click(x, y); }
  await page.waitForTimeout(1300);
  d = await dbg();
  check(d.props === 7, 'seven items are placed for the budget check');
  check(d.info.calls < 150 && d.info.triangles < 150000, `draw calls ${d.info.calls} < 150 and triangles ${d.info.triangles} < 150000`);
  const f1 = (await dbg()).frames; await page.waitForTimeout(1200); const f2 = (await dbg()).frames;
  check(f2 === f1, 'idle: no frames are drawn while nothing changes');
  const png = (await page.locator('#bs3d').screenshot()).toString('base64');
  const spread = await page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const dt = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < dt.length; i += 16) seen.add((dt[i] >> 3) + ',' + (dt[i + 1] >> 3) + ',' + (dt[i + 2] >> 3)); return seen.size; }, png);
  check(spread > 60, `the picture is rich, not flat (${spread} colour buckets)`);
  await open('custom');
  await pick('water');
  for (let i = 0; i < 22; i++) await click(8 + i * 10, 199.3);
  { const n = (await dbg()).props, h = await help(); check(n === 20 && /enough items/.test(h), `at most 20 items can be placed (got ${n}: ${h})`); }

  // ---------- phone ----------
  await open('saetter', { width: 390, height: 844 });
  { // a placement message must be visible at once, without scrolling, above the bottom bar
    await pick('cappuccino'); await page.evaluate(() => window.scrollTo(0, 0));
    const at0 = await at(6, 5); await page.mouse.click(at0.x, at0.y); await page.waitForTimeout(150);
    const hb = await page.locator('#bsPropHelp').boundingBox(), bar = await page.locator('.bs-bar').boundingBox(), cl = await page.locator('[data-bs-action="clearItems"]').boundingBox();
    check(/Too (wide|deep)/.test(await help()) && hb && hb.y >= 0 && hb.y + hb.height <= bar.y, `phone: the "does not fit" message is visible without scrolling (y ${Math.round(hb ? hb.y : -1)}..${Math.round(hb ? hb.y + hb.height : -1)}, bar at ${Math.round(bar.y)})`);
    check(cl && cl.y >= 0 && cl.y + cl.height <= bar.y, 'phone: Clear items is visible above the bottom bar');
    await pick('standard_mug'); const at1 = await at(6, 5); await page.mouse.click(at1.x, at1.y); await page.waitForTimeout(150);
    const hb2 = await page.locator('#bsPropHelp').boundingBox();
    check(/handle sticks out 2 cm/.test(await help()) && hb2.y + hb2.height <= bar.y, 'phone: the placement message with the overhang is visible');
    await page.locator('[data-bs-action="clearItems"]').click();
  }
  d = await dbg();
  check(d.q.pixelRatio <= 1.25 && d.q.shadowMapSize <= 1024, `phone budget: pixel ratio ${d.q.pixelRatio}, shadow map ${d.q.shadowMapSize}`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(over <= 0, 'no horizontal scroll on a phone with the palette');
  const pb = await page.locator('[data-bs-prop="mug"]').boundingBox();
  check(pb.height >= 56 && pb.width >= 64, 'phone palette targets are big enough');
  await pick('mug'); await click(6, 5);
  check((await dbg()).props === 1, 'tap placement works on the phone layout');

  check(!errors.length, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  return checks;
}
