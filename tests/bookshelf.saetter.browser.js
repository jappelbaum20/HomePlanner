async page => {
  const checks = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const check = (condition, label) => checks.push({ label, pass: !!condition });
  const button = name => page.getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('tab', { name, exact: true });
  const field = name => page.getByRole('spinbutton', { name, exact: true });
  const name = page.getByRole('textbox', { name: 'Design name', exact: true });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('houseplanner.anonymous.v3')));
  const edit = async (label, value) => { await field(label).fill(String(value)); await field(label).press('Tab'); };
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({version:2,name:'Synthetic fixture',rooms:[{id:'office',name:'Office',width:400,length:400,height:250,items:[],openings:[],photos:[],photoLabels:{}}],catalog:[]})));
  await page.reload();
  await button('Bookshelf builder').click();
  await name.fill('Custom draft retained'); await edit('Width, cm', 181);
  await tab('Custom bookshelf').focus(); await page.keyboard.press('ArrowRight');
  check(await tab('SÆTTER 3').getAttribute('aria-selected') === 'true', 'keyboard selects the SÆTTER tab');
  check(await page.evaluate(() => document.activeElement.id === 'bs-tab-saetter'), 'keyboard focus follows the selected tab');
  check(await field('Width, cm').inputValue() === '45.5' && await field('Height, cm').inputValue() === '40.6' && await field('Depth, cm').inputValue() === '10.5', 'reference dimensions are loaded');
  check((await page.locator('.bs-reference').innerText()).includes('inferred'), 'inferred dimensions are labeled');
  await edit('Separator height, cm (inferred)', 7);
  check(await button('Save design').isDisabled(), 'overlapping short separators block saving');
  await edit('Separator height, cm (inferred)', 2.5);
  await name.fill('SÆTTER test piece');
  await tab('Custom bookshelf').click();
  check(await name.inputValue() === 'Custom draft retained' && await field('Width, cm').inputValue() === '181', 'custom draft survives tab switch');
  await page.reload(); await button('Bookshelf builder').click();
  check(await name.inputValue() === 'Custom draft retained', 'custom draft survives reload');
  await tab('SÆTTER 3').click();
  check(await name.inputValue() === 'SÆTTER test piece' && await field('Separator height, cm (inferred)').inputValue() === '2.5', 'SÆTTER draft survives switch and reload');
  await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption({ label: 'Office' });
  // Find a clear wall position through the same validation as a user.
  let clear = false;
  for (const wall of ['n', 'e', 's', 'w']) {
    await page.getByRole('combobox', { name: 'Wall', exact: true }).selectOption(wall);
    for (const offset of [20, 80, 140, 200, 260, 320]) {
      await edit('Wall offset, cm', offset);
      if (!await button('Save & place on wall').isDisabled()) { clear = true; break; }
    }
    if (clear) break;
  }
  check(clear, 'a clear placement is available');
  if (!clear) throw new Error(JSON.stringify({ checks, errors }));
  await button('Save & place on wall').click();
  let project = await state(), piece = project.catalog.find(p => p.name === 'SÆTTER test piece');
  check(piece?.shelfDesign?.template === 'saetter3' && piece.shelfDesign.separatorHeight === 2.5, 'saved piece contains edited template geometry');
  check(project.rooms.flatMap(r => r.items).filter(i => i.catalogId === piece.id && i.shelfDesign?.backThickness === .5).length === 1, 'placement contains the backed geometry');
  await page.reload(); await button('Bookshelf builder').click();
  check(await tab('SÆTTER 3').getAttribute('aria-selected') === 'true', 'active tab survives reload');
  await page.getByRole('combobox', { name: 'Saved bookshelf designs', exact: true }).selectOption(piece.id);
  check(await button('Save & move placement').isVisible(), 'saved design reopens its placement');
  await button('Save & move placement').click();
  project = await state();
  check(project.rooms.flatMap(r => r.items).filter(i => i.catalogId === piece.id).length === 1, 'moving a reopened placement does not duplicate it');
  check(project.bookshelfDraft.alternate?.name === 'Custom draft retained', 'saving and placing preserves the other tab');
  const geometry = await page.evaluate(() => {
    if (!window.THREE || !window.HouseModels) return 'unavailable';
    const d = JSON.parse(localStorage.getItem('houseplanner.anonymous.v3')).bookshelfDraft.design;
    const parts = Bookshelf.visualBoards(d), obj = HouseModels.buildItem({ type: 'shelf', w: d.width, d: d.depth, h: d.height, color: '#76513D', shelfDesign: d, elev: 1 }, { evening: false });
    obj.updateMatrixWorld(true);
    return parts.every((p, i) => { const size = new THREE.Box3().setFromObject(obj.children[i]).getSize(new THREE.Vector3()); return Math.abs(size.x - p.w) < 1e-4 && Math.abs(size.y - p.h) < 1e-4 && Math.abs(size.z - (p.renderDepth ?? p.depth)) < 1e-4; });
  });
  check(geometry === true, '3D part sizes match the modeled back and boards');
  for (const [label, ext] of [['Download cut list', 'csv'], ['Download build plan', 'html'], ['Export design JSON', 'json']]) {
    const event = page.waitForEvent('download'); await button(label).click();
    const download = await event; await download.saveAs('output/playwright/saetter.' + ext);
    check(!!download.suggestedFilename(), label + ' downloads');
    const stream = await download.createReadStream(); let content = '';
    for await (const chunk of stream) content += chunk.toString();
    if (ext === 'csv') check(content.includes('B1,Back,406,455,5') && content.includes('Separator'), 'cut list includes the back and separators');
    if (ext === 'html') check(content.includes('inferred') && content.includes('not the manufacturer'), 'build plan labels inferred construction');
    if (ext === 'json') check(!Object.hasOwn(JSON.parse(content), 'alternate'), 'single-design export does not include the other draft');
  }
  await button('Save and versions').click();
  const backupEvent = page.waitForEvent('download'); await button('Export backup').click();
  const backup = await backupEvent; const backupStream = await backup.createReadStream(); let backupText = '';
  for await (const chunk of backupStream) backupText += chunk.toString();
  check(JSON.parse(backupText).state.bookshelfDraft.alternate.name === 'Custom draft retained', 'full backup includes the other draft');
  // This dedicated test session contains only disposable fixture data.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.locator('#importInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Backup imported'));
  await button('Bookshelf builder').click();
  check(await tab('SÆTTER 3').getAttribute('aria-selected') === 'true' && await name.inputValue() === 'SÆTTER test piece', 'backup import restores the active SÆTTER draft');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone layout has no horizontal overflow');
  await page.screenshot({ path: 'output/playwright/saetter-phone.png', fullPage: true });
  await tab('Custom bookshelf').click();
  check(await name.inputValue() === 'Custom draft retained' && await field('Width, cm').inputValue() === '181', 'custom draft survives placement and a second reload');
  await page.route('**/three.min.js', route => route.abort());
  await page.route('**/three@0.128.0/**', route => route.abort());
  await page.route('**/vendor/{OrbitControls,RoomEnvironment,RoundedBoxGeometry}.js', route => route.abort());
  await page.reload(); await button('Save and versions').click(); await page.locator('#localList li').filter({hasText:'Synthetic fixture'}).getByRole('button',{name:'Open',exact:true}).click(); await button('Bookshelf builder').click(); await tab('SÆTTER 3').click();
  check((await page.locator('#bs3d').innerText()).includes('3D needs') && await page.locator('#bsDrawing svg').count() === 1, 'SÆTTER drawing remains editable without 3D libraries');
  check(!await button('Save design').isDisabled(), 'SÆTTER can still be saved without 3D libraries');
  check(!errors.length, 'no browser JavaScript errors');
  const failures = checks.filter(c => !c.pass);
  if (failures.length || errors.length) throw new Error(JSON.stringify({ failures, errors, checks }));
  return { checks: checks.length, failures, errors };
}
