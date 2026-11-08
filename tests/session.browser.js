/* Same-origin fake service exercises logout races and hostile upload reservations. */
async page => {
  const origin='http://127.0.0.1:8765', userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', csrf='A'.repeat(43), errors=[];
  const checks=[], check=(v,label)=>checks.push({label,pass:!!v});
  await page.context().addCookies([{name:'fixture_session',value:'a',url:origin,httpOnly:true,sameSite:'Lax'}]);
  let active=true, releaseLogout, sawLogout, rawCalls=0, invalidExpiry=false;
  const logoutSeen=new Promise(resolve=>{sawLogout=resolve;});
  await page.context().route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname, h=await req.allHeaders();
    const json=(status,body,extra={})=>route.fulfill({status,contentType:'application/json',headers:extra,body:JSON.stringify(body)}).catch(()=>{});
    if(h.authorization) errors.push('unexpected Authorization');
    if(!active || !h.cookie?.includes('fixture_session=a')) return json(401,{error:{code:'unauthenticated'}});
    if(!['GET','HEAD'].includes(req.method()) && (h.origin!==origin || h['x-homeplanner-session']!==sessionId || h['x-homeplanner-csrf']!==csrf)) { errors.push('incorrect mutation headers');return json(403,{error:{code:'csrf_denied'}}); }
    if(path==='/api/session') return json(200,{userId,sessionId,displayName:'Fixture',csrfToken:csrf,access:{status:'approved',role:'user'}});
    if(path==='/api/me') return json(200,{userId,displayName:'Fixture',isAdmin:false,capabilities:{cloud:true,ai:false}});
    if(path==='/api/designs' && req.method()==='GET')return json(200,{items:[],nextCursor:null});
    if(path.endsWith('/photos')) return json(201,{photoId:'22222222-2222-4222-8222-222222222222',uploadUrl:invalidExpiry?path+'/22222222-2222-4222-8222-222222222222/raw':'https://attacker.invalid/raw',contentType:'image/png',maxBytes:1000,expiresAt:invalidExpiry?'2099-99-99T00:00:00Z':'2099-01-01T00:00:00Z'});
    if(path.endsWith('/raw')){rawCalls++;return json(200,{});}
    if(path==='/api/auth/sign-out') { sawLogout(); await new Promise(resolve=>{releaseLogout=resolve;}); active=false;return json(200,{}, {'set-cookie':'fixture_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'}); }
    return json(404,{});
  });
  await page.goto(origin+'/'); await page.waitForFunction(()=>HomePlannerCloud.snapshot().me);
  const rejected=await page.evaluate(async()=>{try{await HomePlannerCloud.uploadPhoto('11111111-1111-4111-8111-111111111111','source',new Blob(['x'],{type:'image/png'}),()=>true);return false;}catch(e){return /Invalid photo reservation/.test(e.message);}});
  check(rejected && rawCalls===0,'foreign upload URL is rejected before any raw upload');
  invalidExpiry=true;
  const rejectedExpiry=await page.evaluate(async()=>{try{await HomePlannerCloud.uploadPhoto('11111111-1111-4111-8111-111111111111','other',new Blob(['x'],{type:'image/png'}),()=>true);return false;}catch(e){return /Invalid photo reservation/.test(e.message);}});
  check(rejectedExpiry && rawCalls===0,'invalid reservation expiry is rejected before any raw upload');
  const peer=await page.context().newPage();await peer.goto(origin+'/');await peer.waitForFunction(()=>HomePlannerCloud.snapshot().me);
  const peerGeneration=await peer.evaluate(()=>HomePlannerCloud.snapshot().generation);
  const logout=page.evaluate(()=>HomePlannerCloud.signOut());await logoutSeen;
  await peer.waitForFunction(g=>HomePlannerCloud.snapshot().generation>g && HomePlannerCloud.snapshot().me,peerGeneration);
  releaseLogout();await logout;await peer.waitForFunction(()=>HomePlannerCloud.snapshot().userId===null);
  check(await page.evaluate(()=>HomePlannerCloud.snapshot().userId===null),'sign-out clears initiating UI immediately');
  check(await peer.evaluate(()=>HomePlannerCloud.snapshot().userId===null),'peer revalidates again after the server completes sign-out');
  check(errors.length===0,'mutations use cookies and correct Origin, session and CSRF headers: '+errors.join(','));
  await peer.close();if(checks.some(x=>!x.pass))throw Error(JSON.stringify(checks));return{checks:checks.length,failures:[]};
}
