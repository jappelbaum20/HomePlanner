/* Offline delayed-response account isolation regression; no live identity proof. */
async page => {
  const origin='http://127.0.0.1:8765', checks=[]; const check=(ok,label)=>checks.push({label,pass:!!ok});
  await page.addInitScript(() => {
    window.HOMEPLANNER_CONFIG={url:'https://fixture.invalid',publishableKey:'fixture-public'};
    const revoke=URL.revokeObjectURL; window.__revoked=[]; URL.revokeObjectURL=function(url){window.__revoked.push(url);return revoke.call(URL,url);};
    window.HomePlannerSupabase={createClient(_url,_key,options={}){return {storage:{from(){return {async upload(path,blob,opts){const r=await options.global.fetch('https://fixture.invalid/storage/'+encodeURIComponent(path),{method:'POST',body:blob,headers:{'content-type':opts.contentType}});return {error:r.ok?null:Error('upload failed')};}};}},auth:{onAuthStateChange(cb){window.__emit=(id)=>cb('SIGNED_IN',id?{user:{id},access_token:'token-'+id}:null);window.addEventListener('storage',e=>{if(e.key==='fixture-logout')window.__emit(null);});setTimeout(()=>window.__emit('a'),0);},async signInWithOAuth(){return{};},async signOut(){return{};},async getSession(){if(window.__deferRestoration)return await new Promise(resolve=>{window.__releaseRestoration=()=>resolve({data:{session:{user:{id:'a'},access_token:'token-a'}}});});return{data:{session:null}};}}};}};
  });
  let release; const delayed=new Promise(resolve=>{release=resolve;}); let started;
  const requestStarted=new Promise(resolve=>{started=resolve;});
  let phase='load', fakePayload=null, photoBytes=null, releaseUpload, uploadStarted, releaseSave, saveStarted, completionCalls=0, saveToken='';
  const uploadGate=new Promise(resolve=>{releaseUpload=resolve;}), uploadSeen=new Promise(resolve=>{uploadStarted=resolve;});
  const saveGate=new Promise(resolve=>{releaseSave=resolve;}), saveSeen=new Promise(resolve=>{saveStarted=resolve;});
  await page.route('https://fixture.invalid/storage/**',async route=>{uploadStarted();await uploadGate;return route.fulfill({status:200,body:'{}'}).catch(()=>{});});
  await page.route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname, token=req.headers().authorization;
    const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    if(path==='/api/me')return json(200,{userId:token==='Bearer token-a'?'a':'b',displayName:token==='Bearer token-a'?'Account A':'Account B',isAdmin:false,capabilities:{cloud:true,ai:false}});
    if(path==='/api/designs')return json(200,{items:token==='Bearer token-a'?[{id:'11111111-1111-4111-8111-111111111111',kind:'home',title:'Private A',revision:1}]:[],nextCursor:null});
    if(path.endsWith('/photos') && req.method()==='POST') return json(201,{photoId:'22222222-2222-4222-8222-222222222222',uploadCapability:{bucket:'design-photos',path:'a/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/raw',contentType:'image/png',upsert:false},expiresAt:'2099-01-01T00:00:00Z'});
    if(path.endsWith('/complete')) {completionCalls++;return json(200,{});}
    if(path.includes('/photos/') && req.method()==='GET') return route.fulfill({status:200,contentType:'image/png',body:photoBytes});
    if(req.method()==='PUT'){saveToken=token;saveStarted();await saveGate;return json(200,{revision:2,design:{revision:2}});}
    if(path.startsWith('/api/designs/')){if(phase==='load'){started();await delayed;}return json(200,{id:'11111111-1111-4111-8111-111111111111',kind:'home',title:'Private A',revision:1,payload:phase==='photo'?fakePayload:{version:2,name:'Private A',rooms:[],catalog:[]},photoManifest:phase==='photo'?[{photoId:'22222222-2222-4222-8222-222222222222',mime:'image/png',bytes:photoBytes.length,checksum:require('crypto').createHash('sha256').update(photoBytes).digest('hex')}]:[]});}
    return json(404,{});
  });
  await page.goto(origin+'/public/');await page.evaluate(()=>window.HomePlannerContractsReady);await page.getByRole('button',{name:'Private designs'}).click();
  await page.getByText('Private A (home)').waitFor(); await page.getByRole('button',{name:'Open',exact:true}).click({noWaitAfter:true}); await requestStarted;
  await page.evaluate(()=>window.__emit('b')); await page.getByText('Signed in as Account B.').waitFor(); release(); await page.waitForTimeout(300);
  check((await page.locator('body').innerText()).includes('Private A')===false,'late A response is absent after switch');
  check(await page.locator('#projectName').inputValue()!=='Private A','editor is cleared on account switch');
  phase='upload'; await page.evaluate(()=>window.__emit('a')); await page.getByText('Signed in as Account A.').waitFor();
  const pendingUpload=page.evaluate(async()=>{try {await HomePlannerCloud.uploadPhoto('11111111-1111-4111-8111-111111111111','fixture',new Blob(['fixture'],{type:'image/png'}),()=>true);return 'accepted';} catch(e){return e.name+': '+e.message;}});
  await uploadSeen; await page.evaluate(()=>window.__emit('b')); await page.getByText('Signed in as Account B.').waitFor(); releaseUpload();
  check((await pendingUpload)!=='accepted' && completionCalls===0,'switch during upload aborts and cannot complete under the next account');
  const pendingSave=page.evaluate(async()=>{HomePlannerCloud.select({id:'11111111-1111-4111-8111-111111111111',kind:'home',title:'Fixture',revision:1});try{await HomePlannerCloud.save({kind:'home',title:'Fixture',schemaVersion:3,payload:{version:2,name:'Fixture',rooms:[],catalog:[]},photoIds:[]});return 'accepted';}catch(e){return e.name+': '+e.message;}});
  await saveSeen;
  const otherTab=await page.context().newPage(); await otherTab.goto(origin+'/nonexistent'); await otherTab.evaluate(()=>localStorage.setItem('fixture-logout',String(Date.now())));
  await page.getByText('Not signed in. Local editing remains available.').waitFor(); releaseSave();
  check((await pendingSave)!=='accepted' && saveToken==='Bearer token-b' && await page.evaluate(()=>HomePlannerCloud.snapshot().current===null),'cross-tab logout discards a late save and clears the selected design');
  await otherTab.close();
  await page.evaluate(()=>window.__emit('a')); await page.getByText('Signed in as Account A.').waitFor(); await page.locator('#cloudClose').click();
  await page.getByRole('button',{name:'Add room'}).click();await page.locator('#nrName').fill('Photo fixture');await page.getByRole('button',{name:'Create room',exact:true}).click();
  await page.waitForTimeout(450);
  fakePayload=await page.evaluate(()=>{const e=Object.keys(localStorage).filter(k=>k.startsWith('houseplanner.v3.anonymous.')).map(k=>JSON.parse(localStorage.getItem(k))).find(v=>v.payload.rooms.some(r=>r.name==='Photo fixture'));return e.payload;});
  const photoId='22222222-2222-4222-8222-222222222222';fakePayload.rooms[0].photos=[photoId];fakePayload.rooms[0].photoLabels={[photoId]:'private'};
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').fillRect(0,0,2,2);return c.toDataURL('image/png').split(',')[1];});photoBytes=Buffer.from(data,'base64');phase='photo';
  await page.getByRole('button',{name:'Private designs'}).click();await page.getByText('Private A (home)').waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('tab',{name:/Photos and notes/}).click();await page.waitForFunction(()=>document.querySelector('img[data-photo]')?.src.startsWith('blob:'));
  const privateUrl=await page.locator('img[data-photo]').first().getAttribute('src');
  await page.getByRole('button',{name:'Bookshelf builder'}).click();const width=page.getByRole('spinbutton',{name:'Width, cm',exact:true});await width.fill('200');
  check(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled(),'fixture shelf has undo history before switching');
  await page.evaluate(()=>window.__emit('b'));await page.waitForFunction(url=>window.__revoked.includes(url),privateUrl);
  const cleared=await page.evaluate(()=>({hidden:document.querySelector('#bookshelfBuilder').hidden,room:document.querySelector('#roomList').innerText,project:document.querySelector('#projectName').value, revoked:window.__revoked.includes(document.querySelector('#lbImg').getAttribute('src'))}));
  check(cleared.hidden && !cleared.room.includes('Photo fixture') && cleared.project!=='Photo fixture','account switch clears the editor and revokes private photo URLs: '+JSON.stringify(cleared));
  await page.getByRole('button',{name:'Add room'}).click();await page.locator('#nrName').fill('New account room');await page.getByRole('button',{name:'Create room',exact:true}).click();await page.getByRole('button',{name:'Bookshelf builder'}).click();
  check(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled(),'new workspace cannot undo into the previous account');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>HomePlannerCloud.snapshot().userId===null);
  check(await page.locator('#bookshelfBuilder').isHidden(),'back-forward cache restoration clears the workspace until session revalidation');
  await page.evaluate(()=>{window.__deferRestoration=true;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.waitForFunction(()=>typeof window.__releaseRestoration==='function');await page.evaluate(()=>{window.__emit('b');window.__releaseRestoration();});await page.waitForFunction(()=>HomePlannerCloud.snapshot().me?.userId==='b');
  check(await page.evaluate(()=>HomePlannerCloud.snapshot().userId==='b'),'a late back-forward cache session cannot replace a newer account');
  if(checks.some(x=>!x.pass))throw Error(JSON.stringify(checks));return{checks:checks.length,failures:[]};
}
