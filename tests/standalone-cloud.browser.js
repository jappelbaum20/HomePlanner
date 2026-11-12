/* Fictional same-origin cloud storage, including revision checks and legacy upgrade. */
async page => {
  const openMore = async () => { if (!(await page.locator('#bsMore').evaluate(d => d.open))) await page.locator('#bsMore summary').click(); }, openMenu = async () => { if (await page.locator('#myDesignsMenu').isHidden()) await page.locator('#myDesigns').click(); };
  const origin='http://127.0.0.1:8765', user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', sid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let record = null, ifMatch = null, proposalBody = null;
  await page.route('**/api/**', async route => {
    const req=route.request(), url=new URL(req.url()), send=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    if(url.pathname==='/api/session') return send(200,{userId:user,sessionId:sid,displayName:'Fixture',csrfToken:'A'.repeat(43),access:{status:'approved',role:'user'}});
    if(url.pathname==='/api/me') return send(200,{userId:user,displayName:'Fixture',isAdmin:false,capabilities:{cloud:true,ai:true}});
    if(url.pathname==='/api/shelf-proposals') { proposalBody=req.postDataJSON(); return send(200,{proposalId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',baseRevision:proposalBody.baseRevision,baseHash:proposalBody.baseHash,shelf:{...proposalBody.shelf,depth:proposalBody.shelf.depth+1},summary:'Fictional depth change',expiresAt:'2099-01-01T00:00:00.000Z'}); }
    if(url.pathname==='/api/designs' && req.method()==='GET') return send(200,{items:record?[{id,kind:'shelf',title:record.title}]:[],nextCursor:null});
    if(url.pathname==='/api/designs' && req.method()==='POST') { const body=req.postDataJSON(); record={...body,id,revision:1,photoManifest:[]}; return send(201,{design:record,revision:1}); }
    if(url.pathname==='/api/designs/'+id && req.method()==='GET') return send(200,{design:record});
    if(url.pathname==='/api/designs/'+id && req.method()==='PUT') { ifMatch=(await req.allHeaders())['if-match']; if(ifMatch!==`"${record.revision}"`) return send(409,{error:{code:'conflict'}}); const body=req.postDataJSON(); record={...record,...body,revision:record.revision+1}; return send(200,{design:record,revision:record.revision}); }
    return send(404,{});
  });
  await page.goto(origin+'/bookshelf'); await page.waitForFunction(()=>HomePlannerCloud.snapshot().me);
  await page.locator('[data-bs="wallWidth"]').fill('345'); await openMore(); await page.locator('[data-bs="wallColor"]').fill('#778899');
  await openMenu(); await page.locator('#cloudBtn').click(); page.once('dialog',d=>d.accept('Fixture shelf')); await page.getByRole('button',{name:'Create cloud copy of this shelf'}).click();
  await page.getByText(/Saved to cloud · revision 1/).waitFor();
  if(record.payload.wall.widthCm!==345 || record.schemaVersion!==4) throw Error('cloud create lost wall');
  await page.locator('#cloudClose').click(); await page.locator('[data-bs="wallHeight"]').fill('245'); await openMenu(); await page.locator('#cloudBtn').click();
  await page.getByRole('button',{name:'Save to cloud',exact:true}).click(); await page.getByText(/Saved to cloud · revision 2/).waitFor();
  if(ifMatch!=='"1"' || record.id!==id || record.payload.wall.heightCm!==245) throw Error('cloud CAS save lost document or ID');
  await page.reload(); await page.waitForFunction(()=>HomePlannerCloud.snapshot().me); await openMenu(); await page.locator('#cloudBtn').click();
  await page.getByRole('button',{name:'Open',exact:true}).click(); await page.locator('#cloudDlg').waitFor({state:'hidden'});
  if(await page.locator('[data-bs="wallHeight"]').inputValue()!=='245') throw Error('cloud reopen lost wall');
  const geometry=record.payload.shelf; record={...record,schemaVersion:3,payload:geometry,revision:3};
  await openMenu(); await page.locator('#cloudBtn').click(); await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByText(/Legacy shelf: default/).waitFor();
  if(await page.locator('[data-bs="wallWidth"]').inputValue()!=='500' || await page.locator('[data-bs="wallHeight"]').inputValue()!=='500' || await page.locator('[data-bs="offset"]').inputValue()!=='0') throw Error('legacy wall defaults are incorrect');
  if(record.schemaVersion!==3 || record.revision!==3) throw Error('legacy record was changed on read');
  await openMenu(); await page.locator('#cloudBtn').click(); await page.getByRole('button',{name:'Save to cloud',exact:true}).click(); await page.getByText(/Saved to cloud · revision 4/).waitFor();
  if(record.schemaVersion!==4 || record.id!==id || ifMatch!=='"3"' || JSON.stringify(record.payload.shelf)!==JSON.stringify(geometry)) throw Error('explicit legacy upgrade changed identity or geometry');
  await page.locator('#cloudClose').click(); const wall=await page.locator('[data-bs="wallWidth"]').inputValue(), depth=await page.locator('[data-bs="depth"]').inputValue();
  await openMore(); page.once('dialog',d=>d.accept('Make this slightly deeper')); await page.getByRole('button',{name:'Request AI preview'}).click();
  await page.getByRole('button',{name:'Apply preview'}).click();
  if(!proposalBody || proposalBody.wall || proposalBody.shelf.version!==1 || await page.locator('[data-bs="wallWidth"]').inputValue()!==wall || Number(await page.locator('[data-bs="depth"]').inputValue())!==Number(depth)+1) throw Error('preview sent wall or lost wall on apply');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  if(await page.locator('[data-bs="depth"]').inputValue()!==depth || await page.locator('[data-bs="wallWidth"]').inputValue()!==wall) throw Error('preview undo lost geometry or wall');
  return ['cloud wall create and reopen', 'revision-bound cloud save', 'legacy default shown without write', 'explicit legacy upgrade preserves ID and geometry', 'fake proposal sends geometry only and apply/undo retain wall'];
}
