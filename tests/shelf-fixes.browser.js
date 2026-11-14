/* Regressions from the PR review: clicks inside open bays, camera pull-back, SAETTER preview clicks, removing an item can be undone, no duplicate label, focus, texture reuse. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  const dbg = () => page.evaluate(() => ({ props: window.__bsDebug.props, items: window.__bsDebug.items, fit: window.__bsDebug.fit, info: window.__bsDebug.info() }));
  const help = () => page.locator('#bsPropHelp').innerText();
  const open = async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('http://127.0.0.1:8765/bookshelf'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.locator('#bs3d canvas').waitFor(); await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0); await page.waitForTimeout(400);
  };
  const clickAt = async (x, y, z = 0) => { await page.locator('#bs3d canvas').scrollIntoViewIfNeeded(); const p = await page.evaluate(([x, y, z]) => window.__bsDebug.screenOf(x, y, z), [x, y, z]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };

  await open();
  // 2: the pull-back is applied once (x1.1) on the standalone page
  let d = await dbg();
  check(d.fit.pull === 1.1 && Math.abs(d.fit.distance / d.fit.base - 1.1) < 1e-6, `standalone close-up pulls back once (x${(d.fit.distance / d.fit.base).toFixed(3)})`);
  // duplicate label
  check(await page.getByText('Compare sizes: add a cup, mug, glass or other item', { exact: true }).count() === 1, 'the comparison palette has one clear heading');
  // 1: a click inside an open bay of a custom shelf places the item; a click beside the furniture says what to do
  await page.locator('[data-bs-prop="mug"]').click();
  const depth = await page.locator('[data-bs="depth"]').inputValue();
  const t0 = (await dbg()).info.textures;
  await clickAt(30, 25, Number(depth));
  d = await dbg();
  check(d.props === 1 && d.items[0].level === 0, 'clicking the open bay (wall visible through it) places the mug on the shelf below');
  check(!/removed/i.test(await help()) && /placed/.test(await help()), 'the help line confirms the placement');
  const t1 = (await dbg()).info.textures; check(Math.abs(t1 - t0) <= 2, `placing an item does not re-upload board textures (${t0} -> ${t1})`);
  await clickAt(-30, 100, 0);
  check((await dbg()).props === 1 && /Click a shelf or a compartment/.test(await help()), 'a click on the bare wall places nothing and says what to click');
  // 8: removing an item can be undone
  const it = d.items[0]; await clickAt(it.x, it.y + 4, it.z);
  d = await dbg();
  check(d.props === 0 && /removed/.test(await help()) && await page.locator('[data-bs-action="restoreItem"]').isVisible(), 'removing shows "removed" with an Undo button');
  await page.locator('[data-bs-action="restoreItem"]').click(); await page.waitForTimeout(200);
  d = await dbg();
  check(d.props === 1 && Math.abs(d.items[0].x - it.x) < 0.01 && /back/.test(await help()), 'Undo brings the item back where it was');
  // 10a: focus survives Undo of a size step
  await page.locator('[data-bs-size="10"]').click(); await page.locator('[data-bs-action="undo"]').click(); await page.waitForTimeout(150);
  check(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'keyboard focus stays on the page after Undo');

  // 7: a click on a SAETTER size preview must not empty the shelf editor
  await open();
  await page.locator('#bs-tab-saetter').click(); await page.locator('[data-bs-variant="5"]').click(); await page.waitForTimeout(500);
  await page.locator('#bsMore summary').click();
  await clickAt(20, 60, 0); await clickAt(20, 5, 0);
  check((await page.locator('#bsRowEditor').innerText()).includes('Editing shelf') && await page.locator('#bsLevels .active').count() === 1, 'clicking the 3D preview of SAETTER 5 keeps the shelf editor filled and one level active');
  await page.locator('[data-bs-variant="3"]').click();

  // 2 (room mode): framing is not pulled back
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({ version: 2, name: 'Synthetic fixture', rooms: [{ id: 'office', seedId: 'office', name: 'Office', width: 600, length: 400, height: 250, items: [], openings: [], photos: [], photoLabels: {} }], catalog: [] })));
  await page.reload(); await page.getByRole('button', { name: 'Bookshelf builder', exact: true }).click(); await page.locator('#bs3d canvas').waitFor();
  await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.fit); d = await dbg();
  check(d.fit.pull === 1 && d.fit.distance === d.fit.base, 'room mode framing is not pulled back');
  check(!errors.length, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  const bad = checks.filter(c => !c.pass); if (bad.length) throw Error(JSON.stringify(bad));
  return { checks: checks.length, failures: [] };
}
