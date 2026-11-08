/* Browser UI regression with synthetic identity and API only; no live Google or backend. */
async page => {
  const checks = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => { if (ms >= 280000) window.__expireProof = fn; return nativeTimeout(fn, ms, ...args); };
    let generation = 1, userId = 'fixture-user', listener, revision = 1, deny = false, proofCalls = [], callback;
    const snapshot = () => ({ generation, userId, me: userId ? { userId, isAdmin: false } : null });
    const settings = () => ({ revision, config: { enabled: false, adapterId: 'openai', modelId: 'gpt-6-luna', connectionId: 'primary', limits: { requestsPerMinute: 5, requestsPerDay: 20, maxOutputTokens: 4000 } }, globalBudgetMicros: window.__budget ?? null, adapters: [{ id: 'openai', label: 'Provider' }], models: [{ id:'gpt-6-luna', label:'Model A' }, { id:'gpt-6-sol', label:'Model B' }], connections: [{ id:'primary', label:'Primary', configured:false }] });
    window.HomePlannerContractsReady = Promise.resolve(true);
    window.HomePlannerContracts = { validate: () => ({ valid: true }) };
    window.HomePlannerCloud = {
      init() { setTimeout(() => listener(snapshot()), 0); return true; }, subscribe(fn) { listener = fn; }, snapshot,
      isCurrent(s) { return !!userId && s.generation === generation && s.userId === userId; },
      async signIn() {}, async signOut() { generation++; userId = null; listener(snapshot()); },
      async request(path, options = {}) {
        if (path === '/api/admin/challenge') return { clientId:'fixture.apps.googleusercontent.com', nonce:'fixture-nonce', expiresIn:300 };
        const headers = options.headers || {}; proofCalls.push({ path, headers, body:options.body });
        if (deny) { const error=Error('denied'); error.status=403; throw error; }
        if (path === '/api/admin/bootstrap') { if (headers['X-Google-Id-Token'] !== 'synthetic-id-token' || headers['X-Admin-Challenge'] !== 'fixture-nonce') throw Error('invalid bootstrap proof'); return {isAdmin:true,grantId:'synthetic-grant',expiresIn:300}; }
        if (headers['X-Admin-Grant'] !== 'synthetic-grant' || headers['X-Google-Id-Token'] || headers['X-Admin-Challenge']) throw Error('invalid grant');
        if (path === '/api/me') return { userId, isAdmin:true };
        if (options.method === 'PUT') { if (headers['If-Match'] !== `"${revision}"`) { const e=Error('conflict'); e.status=409; throw e; } revision++; if (path.endsWith('/budget')) window.__budget=options.body.globalBudgetMicros; }
        return settings();
      }
    };
    window.__switch = () => { generation++; userId='other-user'; listener(snapshot()); };
    window.__deny = value => { deny=value; }; window.__proofCalls = proofCalls;
    window.google = { accounts: { id: {
      initialize(options) { window.__gisOptions = { nonce:options.nonce, essential_claims:options.essential_claims, auto_select:options.auto_select }; callback=options.callback; window.__replay=()=>callback({credential:'synthetic-id-token'}); },
      renderButton(el) { const button=document.createElement('button'); button.type='button'; button.textContent='Synthetic Google'; button.onclick=() => callback({credential:'synthetic-id-token'}); el.append(button); }
    } } };
  });
  await page.route('**/client/cloud.js', route => route.fulfill({ status:200, contentType:'text/javascript', body:'' }));
  await page.route('**/client/contracts-loader.js', route => route.fulfill({ status:200, contentType:'text/javascript', body:'' }));
  await page.goto('http://127.0.0.1:8765/admin.html');
  await page.getByText('Prepare Google verification to access settings.').waitFor();
  check(await page.locator('#modelForm').isHidden(), 'ordinary signed-in session cannot see settings');
  await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Synthetic Google'}).click();
  await page.locator('#modelForm').waitFor({state:'visible'});
  await page.evaluate(()=>window.__replay());
  check(await page.evaluate(()=>window.__proofCalls.filter(c=>c.path==='/api/admin/bootstrap').length)===1,'a repeated provider callback cannot replay the one-use challenge');
  check((await page.evaluate(() => window.__gisOptions)).essential_claims === undefined, 'verification does not request an unsupported authentication-age claim');
  check(await page.locator('[name=budget]').inputValue() === '25', 'approved lifetime cap is prefilled');
  check(await page.locator('[name=modelId] option').count() === 2, 'two models are selectable');
  await page.locator('#budgetForm button').click(); await page.getByText(/revision 2/).waitFor();
  check(await page.evaluate(() => window.__budget) === 25000000, 'cap submits exact microdollars');
  const calls = await page.evaluate(() => window.__proofCalls);
  check(calls.filter(c=>c.path==='/api/admin/bootstrap').length === 1 && calls.filter(c=>c.path!=='/api/admin/bootstrap').every(c=>c.headers['X-Admin-Grant']==='synthetic-grant' && !c.headers['X-Google-Id-Token'] && !c.headers['X-Admin-Challenge']), 'one-use proof is exchanged for a grant');
  await page.evaluate(() => window.__expireProof());
  check(await page.locator('#modelForm').isHidden(), 'proof expiration hides settings');
  await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Synthetic Google'}).click();
  await page.locator('#modelForm').waitFor({state:'visible'});
  await page.evaluate(() => window.__switch());
  check(await page.locator('#modelForm').isHidden(), 'account switch clears proof and settings');
  await page.evaluate(() => window.__deny(true)); await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Synthetic Google'}).click();
  await page.getByText(/Verification failed or expired/).waitFor();
  check(await page.locator('#modelForm').isHidden(), 'rejected proof cannot expose settings');
  await page.evaluate(() => window.__deny(false)); await page.locator('#prepareVerification').click(); await page.getByRole('button',{name:'Synthetic Google'}).click();
  await page.locator('#modelForm').waitFor({state:'visible'});
  check(true, 'fresh proof renews access after rejection');
  return checks;
}
