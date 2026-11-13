async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'BookshelfScene', { configurable: true, get: () => api, set: value => {
      api = value; const create = api.create;
      api.create = options => {
        const scene = create(options), update = scene.update;
        scene.update = (...args) => { window.__sceneUpdates = (window.__sceneUpdates || 0) + 1; return update(...args); };
        window.__testScene = scene; return scene;
      };
    } });
  });
  await page.goto('http://127.0.0.1:8765/bookshelf', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#bs-tab-saetter').click();
  await page.waitForFunction(() => window.__testScene && window.__bsDebug.frames > 0);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const rig = __testScene.rig;
    window.__original = { wall: rig.group.children[0], floor: rig.group.children[1], furniture: [...rig.furniture], labels: rig.group.children.filter(child => child.isSprite) };
  });
  await page.locator('[data-bs-addtoggle]').click();
  await page.locator('[data-bs-prop="mug"]').click();
  const position = await page.evaluate(() => __bsDebug.screenOf(6, 5));
  await page.mouse.click(position.x, position.y);
  check(await page.evaluate(() => __bsDebug.props === 1), 'the item was placed');
  check(await page.evaluate(() => {
    const rig = __testScene.rig, sprites = rig.group.children.filter(child => child.isSprite);
    return rig.group.children.includes(__original.wall) && rig.group.children.includes(__original.floor) && rig.furniture.every((mesh, index) => mesh === __original.furniture[index]) && sprites.every((sprite, index) => sprite === __original.labels[index]);
  }), 'placing an item keeps the wall, floor, boards and labels');
  check(await page.evaluate(() => {
    const maps = __testScene.rig.furniture.map(mesh => mesh.material.map);
    return maps.length > 1 && maps.every(map => map === maps[0]) && !__testScene.rig.renderer.shadowMap.autoUpdate;
  }), 'boards share one walnut map and shadows update on demand');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => { __bsDebug.orbit(10); return !__testScene.rig.renderer.shadowMap.needsUpdate; }), 'orbiting alone does not invalidate the shadow map');
  const delta = await page.evaluate(() => {
    const scene = __testScene, state = scene.rig.state, design = JSON.parse(JSON.stringify(state.design));
    const original = scene.rig.furniture[3], geometry = original.geometry, position = original.position.x;
    design.levels[0].dividers[1] += 1;
    scene.update({ ...state, design }, false);
    return { same: scene.rig.furniture[3] === original, geometry: original.geometry === geometry, moved: original.position.x !== position, shadow: scene.rig.renderer.shadowMap.needsUpdate };
  });
  check(delta.same && delta.geometry && delta.moved && delta.shadow, 'moving a divider reuses its geometry and invalidates shadows');
  const bookSharing = await page.evaluate(() => {
    const scene = __testScene, state = scene.rig.state;
    const book = { id: 'book', kind: 'book', x: 20, y: 40.6, z: 0, w: 2.5, h: 18, d: 12, rot: 0, color: BookshelfProps.BOOK_COLORS[0] };
    scene.update({ ...state, props: [book] }, false);
    const meshes = scene.rig.propMeshes, geometries = meshes.map(mesh => mesh.geometry), material = meshes[0].material;
    scene.update({ ...state, props: [{ ...book, color: BookshelfProps.BOOK_COLORS[1] }] }, false);
    return scene.rig.propMeshes.every((mesh, index) => mesh.geometry === geometries[index]) && scene.rig.propMeshes[0].material !== material;
  });
  check(bookSharing, 'different book colors share geometry without sharing the cover color');
  await page.locator('details').first().evaluate(element => { element.open = true; });
  const coalesced = await page.evaluate(async () => {
    const board = document.querySelector('#bsDrawing [data-bs-board^="D"] rect'), rect = board.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    board.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 9 }));
    const before = __sceneUpdates;
    for (let index = 0; index < 5; index++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + index, clientY: y, pointerId: 9 }));
    const synchronous = __sceneUpdates - before;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const perFrame = __sceneUpdates - before;
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 4, clientY: y, pointerId: 9 }));
    return { synchronous, perFrame };
  });
  check(coalesced.synchronous === 0 && coalesced.perFrame === 1, 'multiple drag events coalesce into one scene update per frame');
  check(errors.length === 0, 'no browser errors: ' + errors.join(' | '));
  return checks;
}
