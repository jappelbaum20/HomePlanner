/* Simple page: a calm first screen, "More details" for everything else, a phone bottom bar, My designs menu. Plus a room-mode regression. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  const open = async vp => {
    await page.setViewportSize(vp); await page.goto('http://127.0.0.1:8765/bookshelf'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.locator('#bs3d canvas').waitFor(); await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0); await page.waitForTimeout(300);
  };
  // Visible controls on the page (More details closed). A segmented group (cards, view, size steps) is one choice.
  const controls = () => page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && e.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }); };
    const all = [...document.querySelectorAll('button, input, select, summary, a[href]')].filter(e => vis(e) && !e.closest('#toast') && !(e.type === 'file')), top = all.filter(e => e.closest('.topbar')).length, own = all.filter(e => !e.closest('.topbar') && !e.closest('.bs-bar'));
    const groups = new Set(own.map(e => e.closest('[data-group]') || e));
    return { raw: own.length, outsidePalette: own.filter(e => !e.closest('#bsProps')).length, top, grouped: groups.size, rects: all.map(e => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute('aria-label') || e.textContent || e.dataset.bs || e.id).trim().slice(0, 30), h: r.height, w: r.width }; }) };
  });

  // ---------- desktop ----------
  await open({ width: 1440, height: 900 });
  let c = await controls();
  check(c.grouped <= 13 && c.top <= 2, `desktop first screen shows ${c.grouped} choices (${c.raw} elements), including the visible comparison picker and Clear items, plus ${c.top} top bar items: at most 13`);
  check(c.outsidePalette <= 20, `desktop has ${c.outsidePalette} controls outside the comparison picker`);
  const numbers = await page.locator('input[type="number"]:visible').count();
  check(numbers === 5, `only ${numbers} number fields are visible (wall width/height, width/height/depth)`);
  const text = await page.locator('#bookshelfBuilder').innerText();
  check(!/inferred|separator|standalone|offset|json/i.test(text), 'no jargon on the first screen');
  check(await page.locator('#bs-tab-custom').getAttribute('aria-selected') === 'true' && await page.locator('.bs-card').count() === 2, 'two big type cards, Custom bookshelf selected');
  const card = await page.locator('#bs-tab-saetter').boundingBox(); check(card.height >= 100 && card.width >= 140, 'type cards are large');
  const adv = ['offset', 'gap', 'elev', 'thickness', 'name', 'wallColor'].map(k => `[data-bs="${k}"]`).concat(['#bsDrawing', '#bsLevels', '[data-bs-action="json"]', '[data-bs-action="csv"]', '[data-bs-action="plan"]', '[data-bs-action="propose"]', '[data-bs-action="copy"]', '[data-bs-action="new"]', '[data-bs-action="resetCamera"]', '[data-bs-sizes]', '#bsCutList']);
  let hidden = 0; for (const sel of adv) if (!(await page.locator(sel).first().isVisible())) hidden++;
  check(hidden === adv.length, `all ${adv.length} advanced controls are hidden until More details is opened`);
  check(await page.locator('#bsMore').evaluate(d => !d.open), 'More details starts collapsed');
  await page.locator('#bsMore summary').click();
  let shown = 0; for (const sel of adv) if (await page.locator(sel).first().isVisible()) shown++;
  check(shown === adv.length, `More details expands and shows all ${adv.length} advanced controls (${shown} visible)`);
  check(await page.locator('#bsMore [data-bs="offset"]').count() === 1 && await page.locator('#bsMore [data-bs-action="propose"]').count() === 1 && await page.locator('#bsMore [data-bs="thickness"]').count() === 1, 'wall offset, AI edit and board thickness live inside More details');
  await page.locator('[data-bs="offset"]').fill('15'); check(await page.locator('[data-bs="offset"]').inputValue() === '15', 'an advanced field can be edited');
  await page.locator('[data-bs="offset"]').fill('0');
  await page.locator('#bsMore summary').click();
  check(await page.locator('[data-bs="offset"]').isHidden() && await page.locator('#bsMore').evaluate(d => !d.open), 'More details collapses again');

  // My designs: one menu for Open, Import and Private designs
  check(await page.locator('#localOpen').isHidden() && await page.locator('#importShelf').isHidden() && await page.locator('#cloudBtn').isHidden(), 'Open, Import and Private designs are not separate top bar buttons');
  await page.locator('#myDesigns').click();
  check(await page.locator('#localOpen').isVisible() && await page.locator('#importShelf').isVisible() && await page.locator('#cloudBtn').isVisible() && await page.locator('#myDesigns').getAttribute('aria-expanded') === 'true', 'My designs menu offers all three');
  await page.keyboard.press('Escape'); check(await page.locator('#localOpen').isHidden(), 'Escape closes the My designs menu');
  await page.locator('#myDesigns').click(); await page.locator('#cloudBtn').click();
  check(await page.locator('#cloudDlg').evaluate(d => d.open), 'Private designs opens from the menu'); await page.locator('#cloudClose').click();

  // First-time flow without opening More details: size, add a mug, save
  await page.locator('[data-bs-size="10"]').click();
  check(await page.locator('[data-bs="width"]').inputValue() === '264', 'Size +10% works from the first screen');
  await page.locator('[data-bs-prop="mug"]').click(); await page.locator('#bs3d canvas').scrollIntoViewIfNeeded();
  const p = await page.evaluate(() => window.__bsDebug.screenOf(60, 5, 0)); await page.mouse.click(p.x, p.y);
  check(await page.evaluate(() => window.__bsDebug.props) === 1, 'an item can be added from the first screen');
  await page.locator('[data-bs-action="save"]').click();
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('homeplanner.standalone.v2.designs') || '[]').length) === 1, 'Save works from the first screen');

  // SAETTER defaults
  await open({ width: 1440, height: 900 });
  await page.locator('#bs-tab-saetter').click();
  check(await page.locator('[data-bs="wallWidth"]').inputValue() === '300' && await page.locator('[data-bs="wallHeight"]').inputValue() === '250', 'a fresh SAETTER design starts on a 300 x 250 cm wall');
  await page.locator('#bsMore summary').click();
  check(await page.locator('[data-bs="elev"]').inputValue() === '0', 'and stands on the floor');
  await page.locator('#bsMore summary').click();
  c = await controls(); check(c.grouped <= 13, `SAETTER first screen shows ${c.grouped} choices (at most 13)`);
  await page.locator('#bs-tab-custom').click();
  check(await page.locator('[data-bs="wallWidth"]').inputValue() === '500', 'switching back to an untouched custom design restores the 500 cm wall');

  // ---------- phone ----------
  await open({ width: 390, height: 844 });
  c = await controls();
  const small = c.rects.filter(r => r.h < 43.5);
  check(small.length === 0, `every visible control on a phone is at least 44 px high (${c.raw} controls)` + (small.length ? ': ' + JSON.stringify(small.slice(0, 5)) : ''));
  check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no horizontal scroll at 390 px');
  check(await page.locator('#bsProps').isVisible(), 'phone: comparison picker is available without opening a sheet');
  const cb = await page.locator('#bs3d').boundingBox(); check(cb.y >= 0 && cb.y < 500, `3D view follows the comparison picker (y ${Math.round(cb.y)})`);
  const bar = await page.locator('.bs-bar').boundingBox(); check(bar && Math.abs(bar.y + bar.height - 844) < 1 && bar.height >= 56, 'sticky bottom bar is at the bottom of the screen');
  const names = await page.locator('.bs-bar button').allInnerTexts(); check(names.join('|') === 'Size|Compare sizes|Save', 'bottom bar offers Size, Compare sizes and Save');
  await page.evaluate(() => { document.querySelector('#bookshelfBuilder').scrollTop = 99999; window.scrollTo(0, 99999); }); await page.waitForTimeout(200);
  const bar2 = await page.locator('.bs-bar').boundingBox(); check(Math.abs(bar2.y + bar2.height - 844) < 1, 'the bar stays put while the page scrolls');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-bs-sheet="size"]').click(); await page.locator('[data-bs-size="10"]').click();
  check(await page.locator('[data-bs="width"]').inputValue() === '264', 'phone: Size opens the size buttons');
  await page.locator('[data-bs-sheet="size"]').click(); check(await page.locator('[data-bs-size="10"]').isHidden(), 'phone: Size sheet closes again');
  await page.locator('[data-bs-compare]').click(); await page.locator('[data-bs-prop="mug"]').click(); await page.locator('#bs3d canvas').scrollIntoViewIfNeeded();
  const q = await page.evaluate(() => window.__bsDebug.screenOf(60, 5, 0)); await page.mouse.click(q.x, q.y);
  check(await page.evaluate(() => window.__bsDebug.props) === 1, 'phone: Add item places a mug');
  await page.locator('.bs-bar [data-bs-barsave]').click();
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('homeplanner.standalone.v2.designs') || '[]').length) === 1, 'phone: Save in the bottom bar saves');
  await page.locator('#bsMore summary').scrollIntoViewIfNeeded(); await page.locator('#bsMore summary').click();
  check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no horizontal scroll at 390 px with More details open');
  check(await page.locator('[data-bs="offset"]').isVisible(), 'phone: More details shows the advanced fields');

  // ---------- room mode keeps its own layout ----------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({ version: 2, name: 'Synthetic fixture', rooms: [{ id: 'office', seedId: 'office', name: 'Office', width: 600, length: 400, height: 250, items: [], openings: [], photos: [], photoLabels: {} }], catalog: [] })));
  await page.reload(); await page.getByRole('button', { name: 'Bookshelf builder', exact: true }).click(); await page.locator('#bs3d canvas').waitFor();
  check(await page.locator('#bsMore').count() === 0 && await page.locator('[data-bs="roomId"]').isVisible() && await page.locator('[data-bs="offset"]').isVisible() && await page.locator('[data-bs-action="place"]').isVisible(), 'room mode keeps room, wall and offset fields and Save & place');
  check(await page.locator('[data-bs-prop="mug"]').isVisible(), 'room mode keeps the palette open');
  check(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  const bad = checks.filter(x => !x.pass); if (bad.length) throw Error(JSON.stringify(bad));
  return { checks: checks.length, failures: [], detail: checks.map(x => x.label).slice(0, 3) };
}
