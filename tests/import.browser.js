/* Offline public-build backup round trip using synthetic data and a synthetic photo. */
async page => {
  const origin='http://127.0.0.1:8765', checks=[], check=(ok,label)=>checks.push({label,pass:!!ok});
  await page.goto(origin+'/'); await page.evaluate(()=>window.HomePlannerContractsReady);
  check(await page.evaluate(()=>HOUSE_SEED.rooms.length===0 && HOUSE_SEED.catalog.length===0),'public starter contains no personal rooms or catalog');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);return canvas.toDataURL('image/png');});
  const backup={format:'house-planner-backup',version:2,state:{version:2,name:'Synthetic import',catalog:[],rooms:[{id:'r1',name:'Synthetic room',photos:['url:photos/example.png'],photoLabels:{'url:photos/example.png':'Fixture'},items:[],openings:[]}]},photos:{'url:photos/example.png':png}};
  page.once('dialog',d=>d.accept());
  await page.locator('#importInput').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#roomList').getByRole('button',{name:/Synthetic room/}).waitFor();
  await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('houseplanner.v3.anonymous.') && JSON.parse(localStorage.getItem(k)).title==='Synthetic import'));
  const envelope=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('houseplanner.v3.anonymous.')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>v.title==='Synthetic import'));
  const id=envelope.payload.rooms[0].photos[0];check(/^[0-9a-f-]{36}$/i.test(id) && id!=='url:photos/example.png' && envelope.photoManifest.length===1,'import remaps photo to an owned local UUID and manifest');
  await page.getByRole('tab',{name:/Photos and notes/}).click(); const image=page.locator('img[data-photo="'+id+'"]'); await image.waitFor();
  await page.waitForFunction(id=>document.querySelector(`img[data-photo="${id}"]`)?.naturalWidth===2,id);
  check(true,'synthetic imported bytes render');
  await page.getByRole('button',{name:'Save and versions'}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export backup'}).click();const download=await event;const contents=JSON.parse(await (await download.createReadStream()).toArray().then(chunks=>Buffer.concat(chunks).toString()));
  check(contents.photos[id]===png && contents.state.rooms[0].photoLabels[id]==='Fixture','backup includes image bytes and labels');
  await page.reload();await page.getByRole('button',{name:'Save and versions'}).click();await page.locator('#localList li').filter({hasText:'Synthetic import'}).getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('tab',{name:/Photos and notes/}).click();await page.waitForFunction(id=>document.querySelector(`img[data-photo="${id}"]`)?.naturalWidth===2,id);
  check(true,'local manager reopens imported photo after reload');
  if(checks.some(x=>!x.pass))throw Error(JSON.stringify(checks));return{checks:checks.length,failures:[]};
}
