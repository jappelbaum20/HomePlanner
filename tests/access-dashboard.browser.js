/* Synthetic dashboard interaction for desktop and phone; no live account or backend. */
async page => {
  const checks = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  await page.addInitScript(() => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const stamp = { generation: 1, epoch: 1, userId: owner, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', me: { userId: owner, displayName: 'Owner', access: { status: 'approved', role: 'owner' } } };
    const requests = [
      { id:'11111111-1111-4111-8111-111111111111', name:'Previously decided', email:'old@example.com', note:'old', status:'denied', revision:2, createdAt:'2025-01-01T09:00:00Z' },
      { id:'22222222-2222-4222-8222-222222222222', name:'First applicant', email:'first@example.com', note:'Please let me in', status:'pending', revision:1, createdAt:'2025-01-02T09:00:00Z' },
      { id:'33333333-3333-4333-8333-333333333333', name:'<script>Not markup</script>', email:'second@example.com', note:'Another note', status:'pending', revision:1, createdAt:'2025-01-03T09:00:00Z' }
    ];
    const added = [];
    let listener;
    window.HomePlannerCloud = {
      subscribe(fn) { listener=fn; }, init() { setTimeout(() => listener(stamp), 0); return true; }, snapshot() { return stamp; }, isCurrent() { return true; },
      async verificationStamp() { return stamp; }, async signIn() {}, async signOut() { listener({ ...stamp, me:null }); },
      async request(path, options={}) {
        if (path==='/api/admin/challenge') return { clientId:'fixture.apps.googleusercontent.com', nonce:'fixture-nonce', expiresIn:300 };
        if (path==='/api/admin/bootstrap') return { isAdmin:true, grantId:'fixture-grant', expiresIn:300 };
        if (options.headers?.['X-Admin-Grant']!=='fixture-grant') throw Error('missing grant');
        if (path==='/api/me') return { userId:owner, isAdmin:true };
        if (path==='/api/admin/access/requests') return structuredClone(requests);
        if (path==='/api/admin/access/entitlements') return [{ userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status:'approved', revision:1 }];
        if (path==='/api/admin/access/people' && !options.method) return structuredClone(added);
        if (path==='/api/admin/access/people' && options.method==='POST') {
          if (options.body.email==='denied@example.com' && !options.body.override) return { result:'blocked', state:'denied' };
          added.push({ email:options.body.email, addedAt:'2025-01-04T09:00:00Z' }); return { result:'added' };
        }
        if (path==='/api/admin/access/people/remove') { const i=added.findIndex(x=>x.email===options.body.email); if (i>=0) added.splice(i,1); return { status:'removed' }; }
        const decision=/^\/api\/admin\/access\/requests\/([^/]+)\/(approve|deny)$/.exec(path);
        if (decision) { const item=requests.find(r=>r.id===decision[1]); if (options.headers['If-Match']!==`"${item.revision}"`) throw Error('revision missing'); item.status=decision[2]==='approve'?'approved':'denied'; item.revision++; return item; }
        if (path==='/api/admin/model-config') return { revision:1, config:{enabled:false,adapterId:'fixture',modelId:'fixture',connectionId:'fixture',limits:{requestsPerMinute:1,requestsPerDay:1,maxOutputTokens:100}},globalBudgetMicros:1000000,adapters:[{id:'fixture',label:'Fixture'}],models:[{id:'fixture',label:'Fixture'}],connections:[{id:'fixture',label:'Fixture'}] };
        throw Error('unexpected fixture request');
      }
    };
    window.__switchOwner = value => listener({ ...stamp, me:value===null ? null : { ...stamp.me, access: { status: 'approved', role: value ? 'owner' : 'user' } } });
    window.google={accounts:{id:{ initialize(options) { window.__verify=options.callback; }, renderButton(el) { const b=document.createElement('button'); b.textContent='Verify fixture'; b.onclick=()=>window.__verify({credential:'fixture-token'}); el.append(b); } }}};
  });
  await page.route('**/client/cloud.js', route => route.fulfill({status:200,contentType:'text/javascript',body:''}));
  await page.route('**/client/contracts-loader.js', route => route.fulfill({status:200,contentType:'text/javascript',body:''}));
  for (const width of [1280, 390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://127.0.0.1:8765/admin.html');
    await page.getByText('Prepare Google verification to access settings.').waitFor();
    check(await page.locator('#accessAdmin').isHidden(), `requests hidden before verification at ${width}px`);
    await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Verify fixture'}).click();
    await page.getByText('2 requests waiting').waitFor();
    const pending = page.locator('.access-request.pending');
    check(await pending.count()===2 && await pending.first().getByText('first@example.com',{exact:false}).count()===1, `pending rows show name and email at ${width}px`);
    check(await pending.first().getByText(/2025/).count()===1, `pending rows include requested date at ${width}px`);
    check(await page.locator('#requestList > details').count()===1 && !(await page.locator('#requestList > details').isVisible() && await page.locator('#requestList > details .decided').isVisible()), `decided history is collapsed at ${width}px`);
    check(await page.locator('.access-request script').count()===0, `request text is not interpreted as markup at ${width}px`);
    await pending.first().getByRole('button',{name:'Approve'}).click(); await page.getByText('1 request waiting').waitFor();
    await page.locator('.access-request.pending').getByRole('button',{name:'Deny'}).click(); await page.getByText('0 requests waiting').waitFor();
    check(await page.getByRole('button',{name:'Revoke'}).count()===1, `revoke remains available at ${width}px`);
    check(await page.getByRole('heading',{name:'Add a person'}).isVisible(), `Add a person form shows after verification at ${width}px`);
    const email = page.getByLabel('Email address');
    await email.fill('denied@example.com'); await page.getByRole('button',{name:'Add person'}).click();
    await page.getByText('was denied before',{exact:false}).waitFor();
    check(await page.locator('#addedList').getByText('denied@example.com').count()===0, `a denied address is not added by default at ${width}px`);
    await page.getByRole('button',{name:'Allow anyway'}).click();
    await page.locator('#addedList').getByText('denied@example.com',{exact:false}).waitFor();
    check(await page.locator('#addedList').getByText('not signed in yet',{exact:false}).count()===1, `override adds the person as not signed in yet at ${width}px`);
    await page.locator('#addedList').getByRole('button',{name:'Remove'}).click();
    await page.getByText('Nobody is waiting to sign in.').waitFor();
    await email.fill('new.person@example.com'); await page.getByRole('button',{name:'Add person'}).click();
    await page.locator('#addedList').getByText('new.person@example.com').waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `dashboard fits the viewport at ${width}px`);
  }
  await page.goto('http://127.0.0.1:8765/landing.html');
  await page.locator('#ownerAdminLink').waitFor({state:'visible'});
  await page.evaluate(()=>window.__switchOwner(false));
  check(await page.locator('#ownerAdminLink').isHidden(), 'non-owner cannot see the admin link');
  await page.evaluate(()=>window.__switchOwner(null));
  check(await page.locator('#ownerAdminLink').isHidden(), 'signed-out visitor cannot see the admin link');
  return checks;
}
