/* Offline backup round trip with a synthetic photo, never the bundled personal fixtures. */
async page => {
  const origin='http://127.0.0.1:8765', checks=[], check=(ok,label)=>checks.push({label,pass:!!ok});
  await page.goto(origin+'/public/');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);return canvas.toDataURL('image/png');});
  const backup={format:'house-planner-backup',version:2,state:{version:2,name:'Synthetic import',catalog:[],rooms:[{id:'r1',name:'Synthetic room',photos:['url:photos/example.png'],photoLabels:{'url:photos/example.png':'Fixture'},items:[],openings:[]}]},photos:{'url:photos/example.png':png}};
  page.once('dialog',d=>d.accept());
  await page.locator('#importInput').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#roomList').getByRole('button',{name:/Synthetic room/}).waitFor();
  await page.waitForFunction(()=>!!localStorage.getItem('houseplanner.project.v1'));
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('houseplanner.project.v1')));
  const id=state.rooms[0].photos[0];check(/^[0-9a-f-]{36}$/i.test(id) && id!=='url:photos/example.png','legacy photo is remapped to a UUID');
  await page.getByRole('tab',{name:/Photos and notes/}).click(); const image=page.locator('img[data-photo="'+id+'"]'); await image.waitFor();
  await page.waitForFunction(id=>document.querySelector(`img[data-photo="${id}"]`)?.src.startsWith('data:image/'),id);
  check((await image.getAttribute('src')).startsWith('data:image/png') && await image.evaluate(el=>el.naturalWidth===2), 'imported bytes render after remapping');
  await page.getByRole('button',{name:'Save and versions'}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export backup'}).click();const download=await event;const contents=JSON.parse(await (await download.createReadStream()).toArray().then(chunks=>Buffer.concat(chunks).toString()));
  check(contents.photos[id]===png && contents.state.rooms[0].photoLabels[id]==='Fixture','backup includes image bytes and labels');
  await page.reload();await page.getByRole('tab',{name:/Photos and notes/}).click();await page.waitForFunction(id=>document.querySelector(`img[data-photo="${id}"]`)?.src.startsWith('data:image/'),id);
  check(true,'imported photo survives reload');
  // Exercise the original local seed privately; record counts only, never fixture contents.
  await page.evaluate(()=>localStorage.removeItem('houseplanner.project.v1')); await page.goto(origin+'/');
  await page.getByRole('button',{name:'Save and versions'}).click();
  page.on('dialog', async d=>{if(d.type()==='alert'){console.log('BACKUP ALERT:', d.message());await d.dismiss();}});
  const originalDownload=page.waitForEvent('download', {timeout: 90000}); await page.getByRole('button',{name:'Export backup'}).click();
  const originalFile=await originalDownload, originalBytes=Buffer.concat(await (await originalFile.createReadStream()).toArray()), original=JSON.parse(originalBytes.toString());
  const originalCount=Object.keys(original.photos).length;
  check(originalCount>0 && Object.values(original.photos).every(data=>data.startsWith('data:image/')),'original bundled references are exported as image bytes');
  await page.goto(origin+'/public/'); page.once('dialog',d=>d.accept());
  await page.locator('#importInput').setInputFiles({name:'original-backup.json',mimeType:'application/json',buffer:originalBytes});
  await page.waitForFunction(expected=>{const p=JSON.parse(localStorage.getItem('houseplanner.project.v1')||'null');return !!p && p.rooms.length===expected && p.rooms.some(r=>r.photos.length) && p.rooms.flatMap(r=>r.photos).every(id=>/^[0-9a-f-]{36}$/i.test(id));},original.state.rooms.length,{timeout:90000});
  const roundtrip=await page.evaluate(()=>JSON.parse(localStorage.getItem('houseplanner.project.v1')));
  check(roundtrip.rooms.flatMap(r=>r.photos).every(id=>/^[0-9a-f-]{36}$/i.test(id)),'original room photos remap on import');
  await page.locator('#roomSwitch').selectOption(roundtrip.rooms.find(r=>r.photos.length).id);
  await page.getByRole('tab',{name:/Photos and notes/}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-photo]')].some(el=>el.naturalWidth>0));
  check(true,'an imported original photo renders from the backup');
  // Local-only fixture: creating an empty v3 home must never alter the original plan.
  await page.goto(origin+'/'); const originalLocal=await page.evaluate(()=>localStorage.getItem('houseplanner.project.v1'));
  await page.getByRole('button',{name:'Save and versions'}).click();page.once('dialog',d=>d.accept('Empty local fixture'));
  await page.getByRole('button',{name:'New local home'}).click();
  check(await page.locator('#roomList').getByRole('button').count()===0 && await page.evaluate(()=>localStorage.getItem('houseplanner.project.v1'))===originalLocal,'new local home is empty and leaves original personal data untouched');
  await page.getByRole('button',{name:'Save and versions'}).click();await page.getByRole('textbox',{name:'Version name'}).fill('Durable fixture');await page.getByRole('button',{name:'Save version'}).click();
  check(await page.locator('#versionList li').filter({hasText:'Durable fixture'}).getByRole('button',{name:'Restore'}).isEnabled() && await page.evaluate(()=>JSON.parse(localStorage.getItem('houseplanner.named-versions.v3')||'[]').some(v=>v.name==='Durable fixture')),'named version is durable and immediately restorable');
  if(checks.some(x=>!x.pass))throw Error(JSON.stringify(checks));return{checks:checks.length,failures:[]};
}
