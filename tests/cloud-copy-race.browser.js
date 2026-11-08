/* Offline fake cookie API regression. This does not test real Google, server authorization, or storage. */
async page => {
  const checks = [], writes = [];
  const check = (condition, label) => checks.push({ label, pass: !!condition });
  const origin = 'http://127.0.0.1:8765';
  const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', csrf='A'.repeat(43), protocolErrors=[];
  await page.context().addCookies([{name:'fixture_session',value:'a',url:origin,httpOnly:true,sameSite:'Lax'}]);
  let releasePut=null, delayPut=false;
  let stored = null, cleanedPhoto = null, cleanedMeta = null, corruptManifest = false, conflict = false, reservationCount = 0, completeCount = 0, uploadCount = 0, uploadToken = '', failComplete = true;
  const photoId = '22222222-2222-4222-8222-222222222222';
  const secondId = '33333333-3333-4333-8333-333333333333';
  const copyIds=['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'], fixtures=new Map();

  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const headers=await request.allHeaders();
    if (!headers.cookie?.includes('fixture_session=a') || headers.authorization) protocolErrors.push('cookie/authorization');
    if (!['GET','HEAD'].includes(method) && (headers.origin!==origin || headers['x-homeplanner-session']!==sessionId || headers['x-homeplanner-csrf']!==csrf)) protocolErrors.push('mutation headers');
    if (url.pathname === '/api/session') return json(200,{userId,sessionId,displayName:'Test user',csrfToken:csrf,access:{status:'approved',role:'user'}});
    if (url.pathname.endsWith('/raw') && method==='PUT') { uploadCount++; uploadToken = route.request().headers()['x-homeplanner-session']; const path=decodeURIComponent(route.request().url()), id=[secondId,...copyIds].find(x=>path.includes(x)); if(id){const bytes=route.request().postDataBuffer(),mime=route.request().headers()['content-type'];fixtures.set(id,{bytes,meta:{photoId:id,mime,bytes:bytes.length,checksum:require('crypto').createHash('sha256').update(bytes).digest('hex')}});} return route.fulfill({status:200,body:'{}'}); }

    if (url.pathname === '/api/me') return json(200, { userId, displayName:'Test user', isAdmin:false, capabilities:{cloud:true,ai:false} });
    if (url.pathname === '/api/designs' && method === 'GET') return json(200, {items:stored ? [{id:stored.id,kind:stored.kind,title:stored.title,revision:stored.revision}] : [],nextCursor:null});
    if (url.pathname === '/api/designs' && method === 'POST') { const body=request.postDataJSON();writes.push({method,body,key:request.headers()['idempotency-key']});const id=writes.filter(w=>w.method==='POST').length>2?'44444444-4444-4444-8444-444444444444':'11111111-1111-4111-8111-111111111111';stored={...body,id,revision:1};return json(201,{design:stored,revision:1}); }
    if (url.pathname.endsWith('/photos') && method === 'POST') { reservationCount++; const body=request.postDataJSON(), id=[photoId,secondId,...copyIds][reservationCount-1]; return json(201,{photoId:id,uploadUrl:`/api/designs/${stored.id}/photos/${id}/raw`,contentType:body.mime,maxBytes:10485760,expiresAt:'2099-01-01T00:00:00Z'}); }
    if (url.pathname.endsWith('/complete') && method === 'POST') { completeCount++; if(failComplete){failComplete=false;return json(503,{error:{message:'Fixture completion failure'}});} const id=[secondId,...copyIds].find(x=>url.pathname.includes(x)); return json(200,id?fixtures.get(id).meta:cleanedMeta); }
    if (url.pathname.includes('/photos/') && method === 'GET') {const id=[secondId,...copyIds].find(x=>url.pathname.includes(x)), fixture=id?fixtures.get(id):{bytes:cleanedPhoto,meta:cleanedMeta};return route.fulfill({status:200,contentType:fixture.meta.mime,body:fixture.bytes});}
    if (url.pathname.startsWith('/api/designs/') && method === 'GET') return json(200,{design:{...stored,photoManifest:stored.photoIds.map(id=>{const meta=fixtures.get(id)?.meta||cleanedMeta;return {...meta,checksum:corruptManifest?'0'.repeat(64):meta.checksum};})}});
    if (url.pathname.startsWith('/api/designs/') && method === 'DELETE') { writes.push({method,body:request.postDataJSON(),match:request.headers()['if-match']}); stored=null; return route.fulfill({status:204,body:''}); }
    if (url.pathname.startsWith('/api/designs/') && method === 'PUT') { if(delayPut) await new Promise(resolve=>{releasePut=resolve;}); writes.push({method,body:request.postDataJSON(),match:request.headers()['if-match']}); if (conflict) return json(409,{error:{code:'conflict',message:'Changed',requestId:'11111111-1111-4111-8111-111111111111'}}); stored={...stored,...request.postDataJSON(),revision:stored.revision+1}; return json(200,{design:stored,revision:stored.revision}); }
    return json(404,{});
  });
  await page.goto(origin + '/'); await page.evaluate(() => window.HomePlannerContractsReady);
  await page.getByRole('button',{name:'Private designs'}).click(); await page.getByRole('button',{name:'New home'}).waitFor();
  page.once('dialog', d => d.accept('Test home')); await page.getByRole('button',{name:'New home'}).click();
  await page.getByText('Saved to cloud · revision 1').waitFor();
  check(writes[0].body.kind==='home' && writes[0].body.payload.rooms.length===0 && !!writes[0].key,'explicit create sends empty validated home and idempotency key');
  await page.getByRole('button',{name:'Close',exact:true}).first().click();
  await page.getByRole('button',{name:'Add room'}).click(); await page.locator('#nrName').fill('Local edit'); await page.getByRole('button',{name:'Create room'}).click();
  await page.getByRole('button',{name:'Private designs'}).click(); await page.getByRole('button',{name:'Save to cloud'}).click();
  await page.getByText('Saved to cloud · revision 2').waitFor(); check(writes[1].match==='"1"','save uses strong revision precondition');
  await page.getByRole('button',{name:'Close',exact:true}).first().click(); await page.locator('#projectName').fill('Unsent change');
  conflict=true; await page.getByRole('button',{name:'Private designs'}).click(); await page.getByRole('button',{name:'Save to cloud'}).click();
  await page.getByText(/Cloud revision changed/).waitFor(); check(await page.locator('#projectName').inputValue()==='Unsent change','conflict preserves the local edit');
  page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'Delete',exact:true}).click(); await page.getByText('Cloud design deleted.').waitFor();
  check(writes.at(-1).method==='DELETE' && writes.at(-1).match==='"2"' && Object.keys(writes.at(-1).body).length===0,'delete sends JSON and the current revision');
  conflict = false;
  // Explicit import is local first; the fake storage exercises the production upload adapter.
  await page.locator('#cloudClose').click();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').fillRect(0,0,2,2);return c.toDataURL('image/png');});
  const cleanData=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=3;c.height=3;c.getContext('2d').fillRect(0,0,3,3);return c.toDataURL('image/png').split(',')[1];});
  cleanedPhoto=Buffer.from(cleanData,'base64');cleanedMeta={photoId,mime:'image/png',bytes:cleanedPhoto.length,checksum:require('crypto').createHash('sha256').update(cleanedPhoto).digest('hex')};
  const backup={format:'house-planner-backup',version:2,state:{version:2,name:'Photo import',catalog:[],rooms:[{id:'r1',name:'Photo room',photos:['old'],photoLabels:{old:'Fixture'},items:[],openings:[]}]},photos:{old:png}};
  page.once('dialog',d=>d.accept()); await page.locator('#importInput').setInputFiles({name:'fake-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#roomList').getByText('Photo room').waitFor();
  const envelopes=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('houseplanner.v3.anonymous.')).map(k=>JSON.parse(localStorage.getItem(k))));
  const imported=envelopes.find(e=>e.title==='Photo import');
  check(imported?.schemaVersion===3 && imported.photoManifest.length===1 && /^[a-f0-9]{64}$/.test(imported.photoManifest[0].checksum),'explicit import creates v3 local envelope with photo metadata');
  const legacyKey='houseplanner.local.copy.33333333-3333-4333-8333-333333333333';
  await page.evaluate(({key,payload})=>localStorage.setItem(key,JSON.stringify(payload)),{key:legacyKey,payload:imported.payload});
  await page.getByRole('button',{name:'Private designs'}).click();
  page.once('dialog',d=>d.accept('Photo cloud copy')); await page.getByRole('button',{name:'Create cloud copy of this home'}).click();
  await page.getByText(/Fixture completion failure/).waitFor();
  check(stored.photoIds.length===0 && stored.payload.rooms[0].photos.length===0 && writes.filter(w=>w.method==='PUT').length===2,'failed completion leaves only a photo-free cloud draft');
  await page.getByRole('button',{name:'Save to cloud'}).click(); await page.getByText('Saved to cloud · revision 2').waitFor();
  const finalWrite=writes.filter(w=>w.method==='PUT').at(-1);
  check(reservationCount===1 && uploadCount===1 && completeCount===2 && uploadToken===sessionId,'retry reuses immutable upload and captured session');
  check(finalWrite.match==='"1"' && finalWrite.body.photoIds[0]===photoId && finalWrite.body.payload.rooms[0].photos[0]===photoId && finalWrite.body.payload.rooms[0].photoLabels[photoId]==='Fixture','CAS commits remapped references only after ready');
  await page.reload();await page.getByRole('button',{name:'Private designs'}).click();await page.getByText('Photo cloud copy (home)').waitFor();await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('tab',{name:/Photos and notes/}).click();await page.waitForFunction(()=>[...document.querySelectorAll('img[data-photo]')].some(i=>i.naturalWidth===3));
  check(true,'reopening downloads and verifies the cleaned photo bytes and manifest');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add photos'}).click();await (await chooser).setFiles({name:'new-fixture.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});
  await page.waitForFunction(()=>document.querySelectorAll('img[data-photo]').length===2);
  await page.getByRole('button',{name:'Private designs'}).click();await page.getByRole('button',{name:'Save to cloud'}).click();await page.getByText('Saved to cloud · revision 3').waitFor();
  const added=writes.filter(w=>w.method==='PUT').at(-1);check(reservationCount===2 && added.match==='"2"' && added.body.photoIds.includes(photoId) && added.body.photoIds.includes(secondId),'saving an existing design uploads the new photo and reuses the ready photo');
  delayPut=true; page.once('dialog',d=>d.accept('Delayed photo copy')); await page.getByRole('button',{name:'Save as copy'}).click();
  const pendingDeadline=Date.now()+20000; while(!releasePut && Date.now()<pendingDeadline) await new Promise(resolve=>setTimeout(resolve,20)); if(!releasePut) throw Error('Final copy PUT did not begin');
  await page.evaluate(()=>{const input=document.querySelector('#projectName');input.value='Edit during copy';input.dispatchEvent(new Event('input',{bubbles:true}));});
  releasePut(); await page.getByText(/newer edits remain unsynced/).waitFor();
  check(stored.payload.name!=='Edit during copy' && await page.locator('#projectName').inputValue()==='Edit during copy','late copy response retains newer unsent edit');
  let warningText=''; page.once('dialog',async warning=>{warningText=warning.message();await warning.dismiss();}); await page.getByRole('button',{name:'Open',exact:true}).click(); check(warningText.includes('unsaved'),'late copy response preserves unsaved-change warning');
  check(protocolErrors.length===0,'requests use same-origin cookies and captured session/CSRF headers: '+protocolErrors.join(','));
  if(checks.some(x=>!x.pass)) throw Error(JSON.stringify(checks)); return {checks:checks.length,failures:[]};
}
