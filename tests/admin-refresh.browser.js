/* Uses the real client session code with fictional same-origin responses. */
async page => {
  const origin = 'http://127.0.0.1:8765', user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  let sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revoked = false, sessionRevoked = false, holdSession = false, releaseSession, sessionSeen, holdWrite = false, releaseWrite, writeSeen;
  let grantChecks = 0, aborted = false;
  page.on('requestfailed', req => { if (req.method() === 'PUT' && req.url().endsWith('/api/admin/model-config')) aborted = true; });
  await page.addInitScript(() => { window.google = { accounts: { id: { initialize(o) { window.__googleCallback = o.callback; }, renderButton(el) { const b = document.createElement('button'); b.textContent = 'Verify fixture'; b.onclick = () => window.__googleCallback({ credential:'fixture-token' }); el.append(b); } } } }; });
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), h = await req.allHeaders();
    const send = (status, body) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }).catch(() => {});
    if (url.pathname === '/api/session') { if (holdSession) { sessionSeen?.(); await new Promise(r => { releaseSession = r; }); holdSession = false; } if (sessionRevoked) return send(401,{error:{code:'unauthenticated'}}); return send(200, {userId:user,sessionId:sid,displayName:'Fixture',csrfToken:'A'.repeat(43),access:{status:'approved',role:'user'}}); }
    if (url.pathname === '/api/me') { if (h['x-admin-grant']) { grantChecks++; if (revoked) return send(403,{error:{code:'forbidden'}}); } return send(200,{userId:user,displayName:'Fixture',isAdmin:!!h['x-admin-grant'],capabilities:{cloud:true,ai:false}}); }
    if (url.pathname === '/api/admin/challenge') return send(200,{clientId:'fixture.apps.googleusercontent.com',nonce:'fixture-nonce',expiresIn:300});
    if (url.pathname === '/api/admin/bootstrap') return send(200,{isAdmin:true,grantId:'fixture-grant',expiresIn:300});
    if (url.pathname === '/api/admin/access/requests' || url.pathname === '/api/admin/access/entitlements') return send(200,[]);
    if (url.pathname === '/api/admin/model-config') {
      if (holdWrite && req.method() === 'PUT') { writeSeen?.(); await new Promise(r => { releaseWrite = r; }); holdWrite = false; }
      return send(200,{revision:1,config:{enabled:false,adapterId:'fake',modelId:'fixture',connectionId:'primary',limits:{requestsPerMinute:5,requestsPerDay:20,maxOutputTokens:4000}},globalBudgetMicros:25000000,adapters:[{id:'fake',label:'Fake'}],models:[{id:'fixture',label:'Fixture'}],connections:[{id:'primary',label:'Primary'}]});
    }
    return send(404,{});
  });
  await page.goto(origin + '/admin.html'); await page.getByText('Prepare Google verification to access settings.').waitFor();
  async function grant() { await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Verify fixture'}).click(); await page.locator('#modelForm').waitFor({state:'visible'}); }
  await grant();
  let seen = new Promise(r => { writeSeen = r; }); holdWrite = true;
  await page.locator('#modelForm button[type="submit"]').click(); await seen;
  seen = new Promise(r => { sessionSeen = r; }); holdSession = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await seen;
  if (!(await page.locator('#modelForm').isHidden())) throw Error('settings remain visible during revalidation');
  releaseWrite(); releaseSession(); await page.locator('#modelForm').waitFor({state:'visible'});
  if (!aborted) throw Error('in-flight settings write was not aborted');
  if (grantChecks < 2) throw Error('same session did not revalidate the grant on the server');
  sid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Prepare Google verification to access settings.').waitFor();
  if (!(await page.locator('#modelForm').isHidden())) throw Error('changed session kept proof');
  await grant(); revoked = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Verification failed or expired.').waitFor();
  if (!(await page.locator('#modelForm').isHidden())) throw Error('revoked grant kept proof');
  revoked = false; await grant(); sessionRevoked = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Sign in to request admin access.').waitFor();
  if (!(await page.locator('#modelForm').isHidden())) throw Error('revoked session kept proof');
  return ['same-session focus revalidates grant', 'in-flight write aborted and settings hidden during check', 'changed session clears proof', 'revoked grant and session clear proof'];
}
