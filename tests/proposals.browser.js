/* Offline fake proposal API. Canonicalization conformance is tested separately. */
async page => {
  const origin='http://127.0.0.1:8765', checks=[], check=(ok,label)=>checks.push({label,pass:!!ok});
  const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', csrf='A'.repeat(43), protocolErrors=[];
  await page.context().addCookies([{name:'fixture_session',value:'a',url:origin,httpOnly:true,sameSite:'Lax'}]);
  let stored, proposalCalls=0, lastProposal;
  await page.route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname, method=req.method();const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const headers=await req.allHeaders();
    if (!headers.cookie?.includes('fixture_session=a') || headers.authorization) protocolErrors.push('cookie/authorization');
    if (!['GET','HEAD'].includes(method) && (headers.origin!==origin || headers['x-homeplanner-session']!==sessionId || headers['x-homeplanner-csrf']!==csrf)) protocolErrors.push('mutation headers');
    if(path==='/api/session')return json(200,{userId,sessionId,displayName:'Fixture',csrfToken:csrf});
    if(path==='/api/me')return json(200,{userId,displayName:'Fixture',isAdmin:false,capabilities:{cloud:true,ai:true}});
    if(path==='/api/designs'&&method==='GET')return json(200,{items:[],nextCursor:null});
    if(path==='/api/designs'&&method==='POST'){stored={...req.postDataJSON(),id:'11111111-1111-4111-8111-111111111111',revision:1};return json(201,{design:stored,revision:1});}
    if(path.startsWith('/api/designs/')&&method==='PUT'){stored={...stored,...req.postDataJSON(),revision:stored.revision+1};return json(200,{design:stored,revision:stored.revision});}
    if(path==='/api/shelf-proposals'){
      proposalCalls++; const b=req.postDataJSON(), shelf=JSON.parse(JSON.stringify(b.shelf)); lastProposal=b; shelf.depth=31;
      return json(200,{proposalId:'22222222-2222-4222-8222-222222222222',baseRevision:b.baseRevision,baseHash:b.baseHash,shelf,summary:'A fixture preview',expiresAt:'2099-01-01T00:00:00Z'});
    }
    return json(404,{});
  });
  await page.goto(origin+'/bookshelf');await page.evaluate(()=>window.HomePlannerContractsReady);await page.getByRole('button',{name:'Private designs'}).click();await page.getByRole('button',{name:'New shelf'}).waitFor();
  page.once('dialog',d=>d.accept('Fixture shelf'));await page.getByRole('button',{name:'New shelf'}).click();await page.getByText('Saved to cloud · revision 1').waitFor();await page.locator('#cloudClose').click();
  const depth=page.getByRole('spinbutton',{name:'Depth, cm'});const before=await depth.inputValue();
  page.once('dialog',d=>d.accept('Make the shelf a little deeper'));await page.getByRole('button',{name:'Request AI preview'}).click();await page.getByText('A fixture preview').waitFor();
  check(await depth.inputValue()===before,'request does not mutate shelf');await page.getByRole('button',{name:'Apply preview'}).click();check(await depth.inputValue()==='31','apply changes shelf');
  page.once('dialog',d=>d.accept('Do not send unsaved shelf'));await page.getByRole('button',{name:'Request AI preview'}).click();
  await page.getByText(/Save the current shelf to cloud/).waitFor();check(proposalCalls===1,'unsaved standalone shelf is rejected without a provider request');
  await page.getByRole('button',{name:'Undo',exact:true}).click();check(await depth.inputValue()===before,'undo restores prior geometry');
  page.once('dialog',d=>d.accept('Preview again'));await page.getByRole('button',{name:'Request AI preview'}).click();await page.getByText('A fixture preview').waitFor();await depth.fill('32');await page.getByRole('button',{name:'Apply preview'}).click();
  check((await page.locator('#bsProposalStatus').innerText()).includes('stale'),'an edit after preview blocks stale apply');check(proposalCalls===2,'requests reached only the fake endpoint');
  page.once('dialog',d=>d.accept()); await page.goto(origin+'/home'); await page.waitForFunction(()=>HomePlannerCloud.snapshot().me); await page.getByRole('button',{name:'Private designs'}).click();
  page.on('dialog',async function handle(d){ if(d.type()==='confirm') await d.accept(); else { await d.accept('Home fixture'); page.off('dialog',handle); } });
  await page.getByRole('button',{name:'New home'}).click();await page.getByText('Saved to cloud · revision 1').waitFor();await page.locator('#cloudClose').click();
  await page.getByRole('button',{name:'Add room'}).click();await page.locator('#nrName').fill('Shelf room');await page.getByRole('button',{name:'Create room',exact:true}).click();
  await page.getByRole('button',{name:'Bookshelf builder'}).click();await page.getByRole('button',{name:'Save design',exact:true}).click();
  await page.getByRole('button',{name:'Private designs'}).click();await page.getByRole('button',{name:'Save to cloud'}).click();await page.getByText('Saved to cloud · revision 2').waitFor();await page.locator('#cloudClose').click();
  page.once('dialog',d=>d.accept('Edit this saved catalog shelf'));await page.getByRole('button',{name:'Request AI preview'}).click();await page.getByText('A fixture preview').waitFor();
  check(lastProposal.shelfId===stored.payload.catalog[0].id && lastProposal.baseRevision===2,'home proposal names the saved catalog shelf and current revision');
  check(protocolErrors.length===0,'cookie and mutation protocol: '+protocolErrors.join(','));
  if(checks.some(x=>!x.pass))throw Error(JSON.stringify(checks));return{checks:checks.length,failures:[]};
}
