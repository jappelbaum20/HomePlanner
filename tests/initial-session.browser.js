/* A delayed session check and first sign-in must not replace a local workspace. */
async page => {
  const origin='http://127.0.0.1:8765', userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', csrf='A'.repeat(43);
  let release, started, first=true, loginRequest=null; const begun=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname, h=await req.allHeaders(), signed=h.cookie?.includes('fixture_session=a');
    const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    if(path==='/api/session') { if(first){first=false;started();await new Promise(resolve=>{release=resolve;});} return signed?json(200,{userId,sessionId,displayName:'Fixture',csrfToken:csrf}):json(401,{error:{code:'unauthenticated'}}); }
    if(path==='/api/auth/sign-in/social') { loginRequest={method:req.method(),headers:h,body:req.postDataJSON()};return json(200,{redirect:false}); }
    if(path==='/api/me' && signed)return json(200,{userId,displayName:'Fixture',isAdmin:false,capabilities:{cloud:true,ai:false}});
    if(path==='/api/auth/sign-out' && signed)return route.fulfill({status:200,contentType:'application/json',headers:{'set-cookie':'fixture_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'},body:'{}'});
    return json(404,{});
  });
  await page.goto(origin+'/');await begun;
  await page.getByRole('button',{name:'Add room'}).click();await page.locator('#nrName').fill('Local during check');await page.getByRole('button',{name:'Create room',exact:true}).click();
  await page.getByRole('button',{name:'Bookshelf builder'}).click();await page.getByRole('textbox',{name:'Design name',exact:true}).fill('Local draft during check');
  release();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('Not signed in.'));
  const retained=await page.getByRole('textbox',{name:'Design name',exact:true}).inputValue();
  if(retained!=='Local draft during check')throw Error('Initial signed-out check replaced local draft');
  await page.evaluate(()=>HomePlannerCloud.signIn());
  if(loginRequest?.method!=='POST' || loginRequest.headers.origin!==origin || loginRequest.headers.authorization || loginRequest.body.provider!=='google' || loginRequest.body.callbackURL!==origin+'/')throw Error('Google initiation did not use the expected same-origin endpoint');
  await page.context().addCookies([{name:'fixture_session',value:'a',url:origin,httpOnly:true,sameSite:'Lax'}]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>HomePlannerCloud.snapshot().me?.displayName==='Fixture');
  if(await page.getByRole('textbox',{name:'Design name',exact:true}).inputValue()!=='Local draft during check' || !(await page.locator('#roomList').textContent()).includes('Local during check'))throw Error('First sign-in replaced local work');
  await page.evaluate(()=>HomePlannerCloud.signOut());
  if(await page.getByRole('textbox',{name:'Design name',exact:true}).inputValue()!=='Local draft during check')throw Error('Sign-out replaced local work');
  return {checks:4,failures:[]};
}
