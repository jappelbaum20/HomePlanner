/* The room floor constrains orbit, pan and zoom on desktop and touch devices. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  const install = async p => {
    p.on('pageerror', error => errors.push(error.message));
    await p.addInitScript(() => {
      let api;
      Object.defineProperty(window, 'BookshelfScene', { configurable: true, get: () => api, set: value => {
        api = value; const create = api.create;
        api.create = options => {
          const scene = create(options), rig = scene.rig, render = rig.renderer.render;
          const probe = window.__floorProbe = { scene, camera: Infinity, target: Infinity, changes: 0 };
          const sample = () => { probe.camera = Math.min(probe.camera, rig.camera.position.y); probe.target = Math.min(probe.target, rig.controls.target.y); };
          rig.controls.addEventListener('change', () => { sample(); probe.changes++; });
          rig.renderer.render = function (...args) { sample(); return render.apply(this, args); };
          return scene;
        };
      } });
    });
  };
  const state = p => p.evaluate(() => {
    const probe = window.__floorProbe, { camera, controls } = probe.scene.rig, d = camera.position.clone().sub(controls.target);
    return { minCamera: probe.camera, minTarget: probe.target, camera: camera.position.y, target: controls.target.y, angle: Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI, changes: probe.changes };
  });
  const run = async (p, label, touch) => {
    await install(p); await p.goto('http://127.0.0.1:8765/bookshelf'); await p.locator('#bs3d canvas').waitFor();
    check(await p.locator('#bsProps').isVisible(), `${label}: picker visible on custom shelf`);
    await p.locator('#bs-tab-saetter').click(); await p.waitForFunction(() => window.__floorProbe && window.__bsDebug.frames > 0);
    check(await p.locator('#bsProps').isVisible(), `${label}: picker visible on SÆTTER`);
    const canvas = p.locator('#bs3d canvas'); await canvas.scrollIntoViewIfNeeded();
    const r = await canvas.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const before = await state(p);
    if (!touch) {
      await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y - 1500, { steps: 12 }); await p.mouse.up();
      await p.mouse.move(x, y); await p.mouse.down({ button: 'right' }); await p.mouse.move(x, y - 1500, { steps: 12 }); await p.mouse.up({ button: 'right' });
      await p.mouse.move(x, y); await p.mouse.wheel(0, -2000); await p.mouse.wheel(0, 2000);
    } else {
      const cdp = await p.context().newCDPSession(p);
      const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([tx, ty, id]) => ({ x: tx, y: ty, id })) });
      await send('touchStart', [[x, y, 1]]); await send('touchMove', [[x, Math.max(1, r.y + 2), 1]]); await send('touchEnd', []);
      await send('touchStart', [[x - 30, y, 1], [x + 30, y, 2]]);
      await send('touchMove', [[x - 55, Math.max(2, r.y + 4), 1], [x + 55, Math.max(2, r.y + 4), 2]]); await send('touchEnd', []); await cdp.detach();
    }
    await p.waitForTimeout(500);
    let s = await state(p);
    check(s.changes > before.changes && s.minCamera >= 0 && s.minTarget >= 0, `${label}: gesture orbit, pan and zoom stay above the floor (${JSON.stringify(s)})`);
    // The pan really happened: it moved the target down, and the floor rule stopped it exactly at the floor.
    check(s.target < before.target - 1 && Math.abs(s.target) < .01, `${label}: the downward pan was applied and stopped at the floor (target ${before.target.toFixed(1)} -> ${s.target.toFixed(2)})`);
    await p.evaluate(() => window.__bsDebug.orbit(0, -89)); await p.waitForTimeout(200); s = await state(p);
    check(s.camera >= 0 && s.target >= 0 && s.angle >= -0.001 && s.angle < 3, `${label}: a nearly horizontal view remains possible (camera a few cm above the floor) (${JSON.stringify(s)})`);
    await p.locator('[data-bs-view="wall"]').click(); await p.locator('[data-bs-view="close"]').click();
    await p.setViewportSize(touch ? { width: 360, height: 780 } : { width: 1100, height: 800 }); await p.waitForTimeout(300);
    s = await state(p); check(s.minCamera >= 0 && s.minTarget >= 0 && s.camera >= 0 && s.target >= 0, `${label}: presets and resize stay above the floor`);
    // Raised shelf: ask for the lowest view. Without the limit the camera would sit far below the floor; it stops a few cm above it.
    await p.locator('#bsMore summary').click(); await p.locator('[data-bs="elev"]').fill('100'); await p.locator('[data-bs="elev"]').press('Tab');
    await p.waitForTimeout(300);
    await p.evaluate(() => { const { camera, controls } = window.__floorProbe.scene.rig; camera.position.sub(controls.target).multiplyScalar(2.5).add(controls.target); controls.update(); }); await p.waitForTimeout(200);
    const geo = await p.evaluate(() => { const { camera, controls } = window.__floorProbe.scene.rig; return { ty: controls.target.y, d: camera.position.distanceTo(controls.target) }; });
    const unclamped = geo.ty - geo.d * Math.sin(89 * Math.PI / 180);
    await p.evaluate(() => window.__bsDebug.orbit(0, -89)); await p.waitForTimeout(200);
    s = await state(p);
    check(unclamped < -20, `${label}: raised shelf premise: an unlimited camera would be at y ${unclamped.toFixed(0)}`);
    check(s.minCamera >= 0 && s.minTarget >= 0 && s.camera >= 2.9 && s.camera < 6, `${label}: raised shelf: the lowest view stops a few cm above the floor (camera y ${s.camera.toFixed(1)})`);
    // Looking up at a shelf mounted high on the wall from below its centre must work.
    await p.locator('[data-bs="elev"]').fill('190'); await p.locator('[data-bs="elev"]').press('Tab'); await p.waitForTimeout(300);
    await p.evaluate(() => window.__bsDebug.orbit(0, -15)); await p.waitForTimeout(200);
    s = await state(p);
    check(s.camera >= 2.9 && s.angle < -5 && s.camera < s.target - 20, `${label}: wall shelf at 190 cm can be viewed from below its centre (camera y ${s.camera.toFixed(0)}, target y ${s.target.toFixed(0)}, angle ${s.angle.toFixed(1)})`);
    // A real gesture that tries to go as low as possible also stays above the floor, still looking up.
    const box = await canvas.boundingBox(), gx = box.x + box.width / 2, gy = box.y + box.height / 2;
    if (!touch) { await p.mouse.move(gx, gy); await p.mouse.down(); await p.mouse.move(gx, gy - 1500, { steps: 12 }); await p.mouse.up(); }
    else { const cdp = await p.context().newCDPSession(p); const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([tx, ty, id]) => ({ x: tx, y: ty, id })) }); await send('touchStart', [[gx, gy, 1]]); await send('touchMove', [[gx, Math.max(1, box.y + 2), 1]]); await send('touchEnd', []); await cdp.detach(); }
    await p.waitForTimeout(400); s = await state(p);
    check(s.minCamera >= 0 && s.camera >= 2.9 && s.angle < -5, `${label}: dragging down to the lowest view at 190 cm keeps the camera above the floor (camera y ${s.camera.toFixed(1)}, angle ${s.angle.toFixed(1)})`);
  };
  await run(page, 'desktop', false);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try { const phone = await context.newPage(); await run(phone, 'phone', true); } finally { await context.close(); }
  check(!errors.length, 'no page errors: ' + errors.join(' | '));
  return checks;
}
