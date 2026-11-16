/* SÆTTER scale control: quick buttons and a percentage field resize the shelf (same number of compartments), and the
 * size readout, cup and mug fit labels, summary line, comparison models and build plan all follow. Desktop 1280 and phone 390. */
async page => {
  const fs = require('fs'), shots = process.env.SCALE_SHOTS || '';
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  const shot = async (target, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await target.screenshot({ path: shots + '/' + name }); } };
  const open = async vp => {
    await page.setViewportSize(vp); await page.goto('http://127.0.0.1:8765/bookshelf'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.locator('#bs3d canvas').waitFor(); await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0);
    await page.locator('#bs-tab-saetter').click();
    await page.locator('#bsScale').waitFor(); await page.waitForTimeout(300);
  };
  const text = sel => page.locator(sel).innerText();
  const fitLabel = kind => page.locator(`[data-bs-prop="${kind}"] [data-bs-fit]`).innerText();
  const press = async pct => { const b = page.locator(`[data-bs-scale="${pct}"]`); await b.evaluate(e => e.scrollIntoView({ block: 'center' })); await b.click(); await page.waitForTimeout(150); };
  const readout = () => text('#bsReadout');

  async function run(vp, label) {
    await open(vp);
    check(await page.locator('#bsScale').isVisible(), `${label}: the Scale control is visible without scrolling into a menu`);
    check(await readout().then(t => t.includes('45.5 × 40.6 × 10.5')), `${label}: starts at the real 45.5 × 40.6 × 10.5 cm`);
    check(await text('#bsScaleFit').then(t => t.startsWith('At the original size: 4 of 7 cups and mugs fit inside a compartment')), `${label}: original summary is 4 of 7`);
    check(await fitLabel('large_mug') === 'Top only', `${label}: large mug does not fit at the original size`);
    check(await page.locator('[data-bs-scale="0"]').getAttribute('aria-pressed') === 'true', `${label}: Original is marked as selected`);

    await press(10);
    check(await readout().then(t => t.includes('49.5 × 44.22 × 11.5') && t.includes('+10 %')), `${label}: +10 % readout shows 49.5 × 44.22 × 11.5 cm`);
    check(await text('#bsScaleInfo').then(t => t.includes('49.5 × 44.22 × 11.5') && t.includes('Custom size, not a SÆTTER catalogue size')), `${label}: size line and the custom-size note`);
    check(await text('#bsScaleFit').then(t => t.startsWith('At +10 %: 5 of 7 cups and mugs fit inside a compartment')), `${label}: at +10 % the summary says 5 of 7`);
    check((await fitLabel('large_mug')).startsWith('Fits'), `${label}: large mug now fits (${await fitLabel('large_mug')})`);
    check(await page.locator('[data-bs-scale="10"]').getAttribute('aria-pressed') === 'true' && await page.locator('[data-bs-scale-input]').inputValue() === '10', `${label}: +10 % button and the number field agree`);
    const draft = await page.evaluate(() => (() => { const o = JSON.parse(localStorage.getItem('homeplanner.standalone.v2.draft')); return (o.draft || o).design; })());
    check(draft.levels.length === 4 && draft.levels[0].dividers.length === 5 && draft.thickness === 1.1 && draft.width === 49.5, `${label}: saved draft keeps 4 levels x 4 compartments, 1.1 cm boards, width 49.5 (no extra field)`);
    check(!('scale' in draft), `${label}: no new saved field`);
    if (label === 'desktop') { await page.locator('#bsScale').scrollIntoViewIfNeeded(); await shot(page, 'scale-desktop.png'); await shot(page.locator('#bsScale'), 'scale-fit-summary-plus10.png'); }
    else { await page.locator('#bsScale').scrollIntoViewIfNeeded(); await shot(page, 'scale-phone.png'); }

    // keyboard: any percentage through the number field
    const input = page.locator('[data-bs-scale-input]');
    await input.fill('20'); await input.press('Enter'); await page.waitForTimeout(100);
    check(await readout().then(t => t.includes('53.5 × 47.84 × 12.5')), `${label}: typing 20 and pressing Enter gives 53.5 × 47.84 × 12.5 cm`);
    check(await text('#bsScaleFit').then(t => t.startsWith('At +20 %: 5 of 7')), `${label}: +20 % summary`);
    await input.fill('-20'); await input.press('Tab'); await page.waitForTimeout(100);
    check(await readout().then(t => t.includes('37.5 × 33.36 × 8.5')), `${label}: -20 % is allowed`);
    check(await page.locator('#bsProblems .bs-error').count() === 0, `${label}: -20 % has no layout errors`);
    await input.fill('80'); await input.press('Tab'); await page.waitForTimeout(100);
    check(await readout().then(t => t.includes('37.5 × 33.36 × 8.5')), `${label}: 80 % is refused and the last size is kept`);

    await input.fill('12.345'); await input.press('Enter'); await page.waitForTimeout(100);
    check(await text('#bsScaleInfo').then(t => t.startsWith('Scale +12.35 %:') && !t.includes('edited')) && await input.inputValue() === '12.35', `${label}: 12.345 is stored as 12.35 and not reported as edited`);
    await input.fill('80'); await input.press('Enter'); await page.waitForTimeout(100);
    check(await input.inputValue() === '12.35', `${label}: a rejected entry confirmed with Enter returns to the current percentage`);
    // comparison model follows the scale; the main design is not touched
    await press(10);
    const variant5 = page.locator('[data-bs-variant="5"]');
    if (await variant5.isVisible()) {
      await variant5.click();
      check(await text('#bsScaleFit').then(t => t.startsWith('SÆTTER 5 at +10 %:')), `${label}: comparison model summary names the model and the scale`);
      check(await readout().then(t => t.includes('SÆTTER 5') && t.includes('49.5 × 72.71')), `${label}: SÆTTER 5 preview is scaled too`);
      await page.locator('[data-bs-variant="3"]').click();
    }
    // build plan numbers follow
    if (!await page.locator('#bsMore').evaluate(e => e.open)) await page.locator('#bsMore summary').click();
    const event = page.waitForEvent('download'); await page.locator('[data-bs-action="plan"]').click(); const dl = await event;
    let html = ''; for await (const chunk of await dl.createReadStream()) html += chunk.toString();
    check(html.includes('495 × 442.2 × 115 mm overall') && html.includes('custom size, not a SÆTTER catalogue size'), `${label}: build plan has the scaled size and the custom-size note`);

    // reload keeps the scale
    await page.reload(); await page.locator('#bs3d canvas').waitFor(); await page.locator('#bsScale').waitFor();
    check(await page.locator('[data-bs-scale-input]').inputValue() === '10' && await readout().then(t => t.includes('49.5 × 44.22 × 11.5')), `${label}: scale survives a reload`);
    // back to the exact original, no drift
    await press(0);
    check(await readout().then(t => t.includes('45.5 × 40.6 × 10.5') && !t.includes('custom')), `${label}: Original returns exactly 45.5 × 40.6 × 10.5`);
    const back = await page.evaluate(() => JSON.stringify((() => { const o = JSON.parse(localStorage.getItem('homeplanner.standalone.v2.draft')); return (o.draft || o).design; })()) === JSON.stringify(Bookshelf.saetter3()));
    check(back, `${label}: the saved design is identical to the catalogue SÆTTER 3`);
    check(await page.evaluate(() => document.documentElement.scrollWidth) <= vp.width, `${label}: no horizontal scroll`);
  }

  await run({ width: 1280, height: 900 }, 'desktop');
  await run({ width: 390, height: 844 }, 'phone');
  check(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  const bad = checks.filter(x => !x.pass); if (bad.length) throw Error(JSON.stringify(bad));
  return { checks: checks.length, failures: [] };
}
