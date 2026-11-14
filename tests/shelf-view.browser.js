/* Shelf builder "see it properly": framing, view toggle, cropped drawing, dimension labels, size control. Standalone plus a room-mode regression. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  const dbg = () => page.evaluate(() => ({ labels: window.__bsDebug.labels, view: window.__bsDebug.view, fit: window.__bsDebug.fit, frames: window.__bsDebug.frames, info: window.__bsDebug.info() }));
  const painted = async () => { // share of canvas pixels that differ from the pale background wall/floor colours: canvas is neither blank nor a single colour
    const cb = await page.locator('#bs3d canvas').boundingBox(), png = (await page.screenshot({ clip: cb })).toString('base64');
    return page.evaluate(async b64 => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set(); for (let i = 0; i < d.length; i += 16) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      return seen.size;
    }, png);
  };

  // ---- standalone, desktop ----
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8765/bookshelf');
  await page.locator('#bs3d canvas').waitFor();
  await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0);
  let d = await dbg();
  check(d.view === 'close' && await page.locator('[data-bs-view="close"]').getAttribute('aria-pressed') === 'true', 'Close-up is the default view');
  check(['width', 'height', 'depth'].every(k => d.labels.some(l => l.key === k)) && !d.labels.some(l => l.key === 'wallWidth'), 'close-up shows furniture width, height and depth labels but no wall labels');
  check(d.labels.find(l => l.key === 'width').text === '240 cm' && d.labels.find(l => l.key === 'height').text === '200 cm' && d.labels.find(l => l.key === 'depth').text === '30 cm', 'labels carry the real cm values');
  check((await page.locator('#bsReadout').innerText()).includes('240 × 200 × 30 cm'), 'live readout shows the furniture size');
  check(await painted() > 12, '3D canvas is painted, not blank');
  const box = await page.locator('#bs3d').boundingBox();
  // The always-visible picker takes space above the view; at 1440 x 900 the view, its buttons and Clear items must still fit on the first screen.
  check(box.height >= 300 && box.height <= 720, '3D canvas is tall: ' + box.height);
  const vb = async () => (await page.locator('#bsDrawing svg').getAttribute('viewBox')).split(' ').map(Number);
  let v = await vb();
  check(v[2] < 400 && v[2] > 240, 'close-up 2D drawing is cropped around the furniture, not the 500 cm wall: ' + v[2]);
  check(await page.locator('#bsDrawing svg [data-bs-dim="width"]').textContent() === '240 cm', 'cropped drawing has its own width label');

  // Whole wall
  await page.locator('[data-bs-view="wall"]').click();
  await page.waitForTimeout(300); d = await dbg();
  check(d.view === 'wall' && d.labels.some(l => l.key === 'wallWidth' && l.text === '500 cm') && d.labels.some(l => l.key === 'wallHeight') && d.labels.some(l => l.key === 'furniture' && l.text === '240 × 200 × 30 cm'), 'Whole wall shows the wall size labels and one furniture summary');
  check((await vb())[2] > 500, 'Whole wall also shows the whole wall in 2D');
  const wallDistance = d.fit.distance;
  await page.locator('[data-bs-view="close"]').click(); await page.waitForTimeout(300); d = await dbg();
  check(d.fit.distance < wallDistance && !d.labels.some(l => l.key === 'wallWidth'), 'back to Close-up frames closer and hides wall labels');
  await page.locator('#bsMore summary').click(); await page.locator('[data-bs-sizes]').uncheck(); await page.waitForTimeout(200);
  check((await dbg()).labels.length === 0, 'Show sizes off hides the labels'); await page.locator('[data-bs-sizes]').check();

  // four azimuths: labels stay on screen and no errors
  for (const az of [-60, -20, 20, 60]) {
    await page.evaluate(a => window.__bsDebug.orbit(a), az); await page.waitForTimeout(150);
    const pos = await page.evaluate(() => window.__bsDebug.projectLabels());
    check(pos.length === 3 && pos.every(p => p.x > 0 && p.x < p.w && p.y > 0 && p.y < p.h), `labels visible at azimuth ${az}`);
  }
  await page.locator('[data-bs-action="resetCamera"]').click();

  // idle: render on demand stops
  await page.waitForTimeout(1600); const f1 = (await dbg()).frames; await page.waitForTimeout(700);
  const after = await dbg(); check(after.frames === f1, 'no frames are rendered while idle'); check(after.info.calls < 150 && after.info.triangles < 150000, `draw calls ${after.info.calls}, triangles ${after.info.triangles} within budget`);

  // custom size steps
  const input = n => page.locator(`[data-bs="${n}"]`);
  await page.locator('[data-bs-size="10"]').click();
  check(await input('width').inputValue() === '264' && await input('height').inputValue() === '220' && await input('depth').inputValue() === '33', '+10% edits width, height and depth');
  check((await page.locator('#bsReadout').innerText()).includes('264 × 220 × 33 cm'), 'readout updates');
  check((await dbg()).labels.find(l => l.key === 'width').text === '264 cm', '3D labels update');
  await page.locator('[data-bs-size="5"]').click(); check(await input('width').inputValue() === '277.2', 'steps stack');
  await page.locator('[data-bs-action="undo"]').click(); await page.locator('[data-bs-action="undo"]').click();
  check(await input('width').inputValue() === '240' && await input('thickness').inputValue() === '2.4', 'Undo returns to the original size, thickness untouched');
  await page.locator('[data-bs-size="-10"]').click(); check(await input('width').inputValue() === '216', '-10% shrinks');
  await page.locator('[data-bs-action="undo"]').click();
  await input('wallWidth').fill('250'); await page.locator('[data-bs-size="10"]').click();
  check(await page.getByText('Wall overflow').isVisible(), 'a size that no longer fits the wall reports the overflow');
  await page.locator('[data-bs-action="undo"]').click(); await input('wallWidth').fill('500');
  await input('width').fill('495'); await input('width').press('Tab');
  await page.locator('[data-bs-size="10"]').click();
  check((await page.locator('#toast').innerText()).includes('Size limit reached') && await input('width').inputValue() === '495', 'size steps refuse to pass the 500 cm limit');

  // SAETTER: comparison preview only
  await page.locator('#bs-tab-saetter').click();
  check(await input('elev').inputValue() === '0', 'SAETTER stands on the floor by default in the standalone builder');
  check(await page.locator('[data-bs-size]').count() === 0 && await page.locator('.bs-badge').innerText() === 'Preview only · not saved', 'SAETTER offers labelled comparison models, not percent steps');
  check((await page.locator('#bsReadout').innerText()).includes('45.5 × 40.6 × 10.5 cm'), 'SAETTER readout shows the real size');
  await page.locator('[data-bs-variant="5"]').click(); await page.waitForTimeout(200); d = await dbg();
  const readout5 = await page.locator('#bsReadout').innerText();
  check(d.labels.find(l => l.key === 'height').text === '66.7 cm' && readout5.startsWith('Comparison preview SÆTTER 5: 45.5 × 66.7 × 11.2 cm'), 'SAETTER 5 preview resizes the 3D model and labels: ' + readout5 + ' ' + JSON.stringify(d.labels));
  check(await input('height').inputValue() === '40.6' && await input('depth').inputValue() === '10.5', 'the design itself stays at the real size');
  const dl = page.waitForEvent('download'); await page.locator('[data-bs-action="json"]').click();
  const saved = JSON.parse(require('fs').readFileSync(await (await dl).path(), 'utf8'));
  check(saved.shelf.height === 40.6 && saved.shelf.depth === 10.5 && !('view' in saved) && !('scene' in saved), 'export keeps the real design and no preview data');
  await page.locator('[data-bs-variant="3"]').click(); check((await page.locator('#bsReadout').innerText()).startsWith('Bookshelf 45.5'), 'SAETTER 3 resets the preview');
  await page.locator('[data-bs-variant="7"]').click(); await input('wallHeight').fill('80');
  check((await page.locator('#bsPreviewNote').innerText()).includes('taller than the wall') && !(await page.locator('#bsProblems').innerText()).includes('Wall overflow'), 'oversize comparison gives a grey note, while the real fit check stays clean');
  await input('wallHeight').fill('500'); await page.locator('[data-bs-variant="3"]').click();

  // ---- phone ----
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  const pb = await page.locator('#bs3d').boundingBox();
  check(pb.y >= 0 && pb.y + pb.height <= 844 && pb.width <= 390, `phone: 3D canvas visible without scrolling (${Math.round(pb.y)}..${Math.round(pb.y + pb.height)})`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); check(sw <= 390, 'phone: no horizontal scroll ' + sw + (sw > 390 ? ' ' + await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => !(e instanceof SVGElement) && e.getBoundingClientRect().right > 391).slice(0, 6).map(e => e.tagName + '.' + e.className + '#' + e.id + ':' + Math.round(e.getBoundingClientRect().right)).join(' ')) : ''));
  check(await painted() > 12, 'phone: canvas painted');

  // ---- room mode (/ home planner) regression ----
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({ version: 2, name: 'Synthetic fixture', rooms: [{ id: 'office', seedId: 'office', name: 'Office', width: 600, length: 400, height: 250, items: [], openings: [], photos: [], photoLabels: {} }], catalog: [] })));
  await page.reload();
  await page.getByRole('button', { name: 'Bookshelf builder', exact: true }).click();
  await page.locator('#bs3d canvas').waitFor(); await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0);
  check(await page.locator('[data-bs="roomId"]').count() === 1 && await page.locator('[data-bs-action="place"]').count() === 1, 'room mode keeps room selector and Save & place');
  check((await dbg()).labels.length === 3 && await painted() > 12, 'room mode: labels and painted canvas');
  const widthBefore = await input('width').inputValue(); await page.locator('[data-bs-size="-5"]').click();
  check(Number(await input('width').inputValue()) < Number(widthBefore) && await page.locator('[data-bs-action="place"]').isEnabled(), 'room mode: size steps work and Save & place stays enabled while the shelf fits');
  await page.locator('[data-bs-view="wall"]').click(); await page.waitForTimeout(200);
  check((await dbg()).labels.some(l => l.key === 'wallWidth' && l.text === '600 cm'), 'room mode: Whole wall shows the 600 cm wall');
  check(errors.length === 0, 'no page or console errors: ' + errors.join(' | '));
  const bad = checks.filter(c => !c.pass); if (bad.length) throw Error(JSON.stringify(bad));
  return { checks: checks.length, failures: [] };
}
