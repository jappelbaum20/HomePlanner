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
  const comparisonLabels = await page.evaluate(() => {
    const scene = __testScene, state = scene.rig.state, layer = scene.rig.comparisonLayer;
    const item = layer.querySelector('[data-bs-label^="item-"]'), compartment = layer.querySelector('[data-bs-label="compartment"]');
    scene.update({ ...state }, false);
    const retained = item && compartment && layer.contains(item) && layer.contains(compartment);
    scene.update({ ...state, props: state.props.map(prop => ({ ...prop, h: prop.h + 1 })) }, false);
    const rebuilt = !layer.contains(item) && layer.querySelector('[data-bs-label^="item-"]');
    scene.update(state, false);
    return !!(retained && rebuilt);
  });
  check(comparisonLabels, 'comparison labels are retained for unchanged updates and rebuilt for item size changes');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => { __bsDebug.orbit(10); return !__testScene.rig.renderer.shadowMap.needsUpdate; }), 'orbiting alone does not invalidate the shadow map');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const renderer = __testScene.rig.renderer, requestFrame = window.requestAnimationFrame, render = renderer.render;
    const probe = window.__renderProbe = { renderer, requestFrame, render, timestamps: [], current: null };
    window.requestAnimationFrame = callback => requestFrame.call(window, timestamp => { probe.current = timestamp; callback(timestamp); });
    renderer.render = function (...args) { if (probe.current !== null) probe.timestamps.push(probe.current); return render.apply(this, args); };
  });
  const canvas = page.locator('#bs3d canvas'); await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox(), centerX = bounds.x + bounds.width / 2, centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY); await page.mouse.down();
  await page.mouse.move(centerX + 35, centerY + 8, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1300);
  const renderCadence = await page.evaluate(() => {
    const probe = window.__renderProbe, counts = new Map();
    probe.timestamps.forEach(timestamp => counts.set(timestamp, (counts.get(timestamp) || 0) + 1));
    window.requestAnimationFrame = probe.requestFrame; probe.renderer.render = probe.render;
    return { frames: counts.size, maximum: Math.max(0, ...counts.values()) };
  });
  check(renderCadence.frames > 2 && renderCadence.maximum === 1, 'orbiting renders at most once per animation frame');
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
  await page.locator('#bs-tab-custom').click();
  await page.waitForFunction(() => window.__testScene && !window.__testScene.rig.state.design.template);
  const customWood = await page.evaluate(() => {
    const scene = __testScene, state = scene.rig.state, design = JSON.parse(JSON.stringify(state.design));
    const original = [...scene.rig.furniture], divider = Bookshelf.dividerPosition(design, 0);
    if (divider === null) return false;
    design.levels[0].dividers.push(divider); scene.update({ ...state, design }, false);
    return scene.rig.furniture.length > original.length && scene.rig.furniture.some(mesh => original.includes(mesh)) &&
      scene.rig.furniture.every(mesh => !mesh.material.userData.walnut && mesh.material.map && !mesh.material.bumpMap);
  });
  check(customWood, 'incrementally added custom boards retain the non-walnut material');
  // Resizing the window: overlay labels and the projection follow the container, also after the camera was moved by hand.
  await page.locator('#bs-tab-saetter').click(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(600);
  const view = () => page.evaluate(() => {
    const rig = window.__testScene.rig, canvas = rig.renderer.domElement, host = canvas.parentElement, node = document.querySelector('[data-bs-label="compartment"]');
    return { left: node ? parseFloat(node.style.left) : null, aspect: rig.camera.aspect, host: host.clientWidth / host.clientHeight, css: canvas.clientWidth, width: host.clientWidth };
  });
  const narrow = await view();
  await page.setViewportSize({ width: 1500, height: 900 }); await page.waitForTimeout(600);
  const wide = await view();
  check(narrow.left !== null && wide.width > narrow.width + 100 && wide.left > narrow.left + 40, `the compartment label follows a wider window without further interaction (${narrow.left} -> ${wide.left})`);
  await page.evaluate(() => window.__bsDebug.orbit(30)); await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(600);
  const after = await view();
  check(Math.abs(after.aspect - after.host) < .01 && Math.abs(after.css - after.width) <= 1, `after orbiting, a resize still updates the projection (${after.aspect.toFixed(3)} vs ${after.host.toFixed(3)})`);
  check(errors.length === 0, 'no browser errors: ' + errors.join(' | '));
  return checks;
}
