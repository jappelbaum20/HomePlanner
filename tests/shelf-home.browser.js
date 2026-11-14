/* /home regression: models3d.js (walnut, shadows) also draws shelves in the house tour; room-mode builder keeps working with the new items. */
async page => {
  const checks = [], errors = [], check = (ok, label) => checks.push({ label, pass: !!ok });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|\/api\//.test(m.text())) errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8765/home'); await page.waitForTimeout(1500);
  const colours = async () => { const png = (await page.screenshot()).toString('base64'); return page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set(); for (let i = 0; i < d.length; i += 40) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return seen.size; }, png); };
  check(await colours() > 15, 'the home planner page renders (not blank)');
  const m = await page.evaluate(() => {
    HouseModels.init(THREE);
    const stat = g => { let meshes = 0, mapped = 0, casting = 0; g.traverse(o => { if (o.isMesh) { meshes++; if ([].concat(o.material).every(x => x.map)) mapped++; if (o.castShadow) casting++; } }); return { meshes, mapped, casting }; };
    const out = {};
    out.billy = stat(HouseModels.buildItem({ type: 'shelf', w: 80, d: 30, h: 200, color: '#F2EFE8', doors: 'none', books: true }, { evening: false }));
    const s = Bookshelf.saetter3();
    out.saetter = stat(HouseModels.buildItem({ type: 'shelf', w: s.width, d: s.depth, h: s.height, color: '#6B4A36', shelfDesign: s, elev: 100, books: false }, { evening: false }));
    out.expected = Bookshelf.visualBoards(s).length;
    const c = Bookshelf.preset('staggered', 240, 200, 30, 2.4, 5);
    const custom = HouseModels.buildItem({ type: 'shelf', w: 240, d: 30, h: 200, color: '#C49A6C', shelfDesign: c, elev: 0, books: false }, { evening: false });
    out.custom = stat(custom);
    out.customUsesWalnut = custom.children[0].material.map === HouseModels.walnut('#C49A6C', c.levels[0].right - c.levels[0].left, c.thickness).map;
    out.customBoards = Bookshelf.boards(c).length;
    return out;
  });
  check(m.billy.meshes > 20 && m.billy.casting > 10, 'a BILLY bookcase still builds with shadow casting');
  check(m.saetter.meshes >= m.expected, 'a SAETTER in the house tour builds one mesh per drawn board');
  check(m.saetter.mapped >= m.expected, 'house-tour SAETTER boards carry the walnut grain');
  check(m.custom.meshes >= m.customBoards && m.custom.casting >= m.customBoards, 'a custom shelf in the house tour builds and casts shadows');
  check(!m.customUsesWalnut, 'custom shelves keep their original wood material instead of SÆTTER walnut');
  check(await page.evaluate(() => JSON.stringify(Bookshelf.visualBoards(Bookshelf.saetter3())) === JSON.stringify(Bookshelf.boards(Bookshelf.saetter3())) && Bookshelf.visualBoards(Bookshelf.saetter3()).filter(b => b.kind === 'Separator').length === 18), '3D, drawing and cut list share the paired short separators');

  // room-mode builder
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({version:2,name:'Synthetic fixture',rooms:[{id:'office',seedId:'office',name:'Office',width:600,length:400,height:250,items:[],openings:[{id:'fixture-door',type:'door',wall:'n',offset:340,width:90},{id:'fixture-window',type:'window',wall:'s',offset:20,width:140,sill:90,radiator:true}],photos:[],photoLabels:{}},{id:'living',seedId:'living',name:'Living room',width:600,length:400,height:250,items:[],openings:[],photos:[],photoLabels:{}}],catalog:[]}))); await page.reload(); await page.waitForTimeout(800);
  await page.locator('#bookshelfBtn').click(); await page.locator('#bs3d canvas').waitFor();
  await page.waitForFunction(() => window.__bsDebug && window.__bsDebug.frames > 0); await page.waitForTimeout(400);
  check(await page.locator('.bs-prop').count() === 15, 'room mode shows the expanded palette');
  check(await page.locator('[data-bs-action="place"]').count() === 1, 'room mode keeps Save & place');
  await page.locator('[data-bs-prop="mug"]').click();
  await page.locator('#bs3d canvas').scrollIntoViewIfNeeded();
  const p = await page.evaluate(() => window.__bsDebug.screenOf(30, 5, 0)); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250);
  check(await page.evaluate(() => window.__bsDebug.props) === 1, 'room mode: click places a mug');
  const real = await page.evaluate(() => window.__bsDebug.realism());
  check(real.shadowsOn && real.wallTextured && real.floorTextured, 'room mode scene has shadows, plaster wall and floor');
  await page.locator('[data-bs-action="clearItems"]').click();
  check(await page.evaluate(() => window.__bsDebug.props) === 0, 'room mode: Clear items works');
  check(!errors.length, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  return checks;
}
