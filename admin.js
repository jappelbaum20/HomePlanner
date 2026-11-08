(() => {
  'use strict';
  const cloud = window.HomePlannerCloud, status = document.querySelector('#adminStatus');
  const form = document.querySelector('#modelForm'), budgetForm = document.querySelector('#budgetForm');
  const signIn = document.querySelector('#adminSignIn'), signOut = document.querySelector('#adminSignOut');
  const verification = document.querySelector('#verification'), prepare = document.querySelector('#prepareVerification'), googleButton = document.querySelector('#googleButton');
  const accessAdmin = document.querySelector('#accessAdmin'), requestList = document.querySelector('#requestList'), requestDetail = document.querySelector('#requestDetail'), entitlementList = document.querySelector('#entitlementList');
  let generation = -1, proof = null, revision = null, timer = null, sequence = 0, googleLoading = null;
  function clearProof(message) {
    sequence++; proof = null; revision = null; clearTimeout(timer); timer = null;
    form.hidden = budgetForm.hidden = accessAdmin.hidden = true; googleButton.replaceChildren(); requestList.replaceChildren(); requestDetail.replaceChildren(); entitlementList.replaceChildren();
    if (message) status.textContent = message;
  }
  const fail = error => { status.textContent = error?.message || 'Settings are unavailable.'; };
  function headers() {
    if (!proof || Date.now() >= proof.expires || !cloud.isCurrent(proof.stamp)) {
      clearProof('Verification expired. Prepare a new Google verification.');
      throw Error('Verification expired. Prepare a new Google verification.');
    }
    return { 'X-Admin-Grant': proof.grantId };
  }
  async function adminRequest(path, options = {}) {
    try { return await cloud.request(path, { ...options, headers: { ...headers(), ...options.headers } }); }
    catch (error) {
      if (error.status === 401 || error.status === 403) clearProof('Verification failed or expired. Check the Google account, then try again.');
      throw error;
    }
  }
  function options(name, values, selected) {
    if (!Array.isArray(values) || !values.length) throw Error('The server catalog is unavailable.');
    const el = form.elements[name]; el.replaceChildren();
    for (const entry of values) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.label !== 'string') throw Error('The server catalog is invalid.');
      const option = document.createElement('option'); option.value = entry.id;
      option.textContent = entry.label + (entry.configured === false ? ' (not configured)' : '') + (entry.validated === false ? ' (validation required)' : '');
      option.selected = entry.id === selected; el.append(option);
    }
  }
  function show(response, stamp) {
    if (!cloud.isCurrent(stamp) || !proof || proof.stamp.generation !== stamp.generation) return;
    const c = response?.config;
    if (!c || !Number.isSafeInteger(response.revision) || !c.limits) throw Error('The server returned invalid settings.');
    options('adapterId', response.adapters, c.adapterId); options('modelId', response.models, c.modelId); options('connectionId', response.connections, c.connectionId);
    form.elements.enabled.checked = c.enabled;
    for (const key of ['requestsPerMinute', 'requestsPerDay', 'maxOutputTokens']) form.elements[key].value = c.limits[key];
    const cap = response.globalBudgetMicros;
    budgetForm.elements.budget.value = Number.isSafeInteger(cap) ? (cap / 1000000).toFixed(6).replace(/\.?0+$/, '') : '25';
    revision = response.revision; form.hidden = budgetForm.hidden = false;
    status.textContent = `Verified. Settings loaded · revision ${revision}. Budget uses a conservative token allowance, which may exceed invoice spend.`;
  }
  async function load(stamp) { show(await adminRequest('/api/admin/model-config'), stamp); await loadAccess(); }
  function line(parent, text) { const p = document.createElement('p'); p.textContent = text; parent.append(p); return p; }
  function action(parent, label, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn light'; b.textContent = label;
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (error) { fail(error); } finally { b.disabled = false; } }); parent.append(b);
  }
  async function review(id) {
    const item = await adminRequest('/api/admin/access/requests/' + encodeURIComponent(id));
    requestDetail.replaceChildren();
    line(requestDetail, `${item.name} · ${item.email} · ${item.status}`); line(requestDetail, item.note || 'No note.');
    if (item.status === 'pending') for (const [decision,label] of [['approve','Approve'],['deny','Deny']]) action(requestDetail, label, async () => {
      await adminRequest(`/api/admin/access/requests/${encodeURIComponent(item.id)}/${decision}`, { method: 'POST', headers: { 'If-Match': `"${item.revision}"` }, body: {} });
      await loadAccess(); await review(item.id);
    });
    for (const mail of item.mail || []) {
      const row = line(requestDetail, `${mail.kind}: ${mail.status} · attempts ${mail.attempts}${mail.errorCategory ? ' · ' + mail.errorCategory : ''}`);
      if (mail.status === 'failed') action(row, 'Retry notification', async () => {
        await adminRequest(`/api/admin/access/mail/${encodeURIComponent(mail.id)}/retry`, { method: 'POST', headers: { 'If-Match': `"${mail.revision}"` }, body: {} }); await review(item.id);
      });
    }
  }
  async function loadAccess() {
    const [requests, entitlements] = await Promise.all([adminRequest('/api/admin/access/requests'), adminRequest('/api/admin/access/entitlements')]);
    if (!Array.isArray(requests) || !Array.isArray(entitlements) || !proof) throw Error('Access review is unavailable.');
    requestList.replaceChildren(); requestDetail.replaceChildren(); entitlementList.replaceChildren(); accessAdmin.hidden = false;
    if (!requests.length) line(requestList, 'No requests.');
    for (const item of requests) { const row = line(requestList, `${item.name} · ${item.email} · ${item.status} `); action(row, 'Review', () => review(item.id)); }
    if (!entitlements.length) line(entitlementList, 'No accounts.');
    for (const item of entitlements) {
      const row = line(entitlementList, `${item.userId} · ${item.status} `);
      if (item.status === 'approved' && item.userId !== cloud.snapshot().userId) action(row, 'Revoke', async () => {
        await adminRequest(`/api/admin/access/entitlements/${encodeURIComponent(item.userId)}/revoke`, { method: 'POST', headers: { 'If-Match': `"${item.revision}"` }, body: {} }); await loadAccess();
      });
    }
    const requested = new URLSearchParams(location.search).get('accessRequest');
    if (requested && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requested)) { history.replaceState(null, '', '/admin.html'); await review(requested); }
  }
  document.querySelector('#reloadAccess').addEventListener('click', () => { void loadAccess().catch(fail); });
  function loadGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (!googleLoading) googleLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = () => window.google?.accounts?.id ? resolve() : reject(Error('Google verification is unavailable.'));
      script.onerror = () => reject(Error('Google verification could not be loaded.')); document.head.append(script);
    }).catch(error => { googleLoading = null; throw error; });
    return googleLoading;
  }
  async function prepareStep() {
    const stamp = cloud.snapshot(); if (!stamp.me) return;
    clearProof(); const attempt = sequence; prepare.disabled = true;
    try {
      const challenge = await cloud.request('/api/admin/challenge');
      if (!cloud.isCurrent(stamp) || attempt !== sequence) return;
      if (!challenge || typeof challenge.clientId !== 'string' || !challenge.clientId.endsWith('.apps.googleusercontent.com') || typeof challenge.nonce !== 'string' || !Number.isInteger(challenge.expiresIn) || challenge.expiresIn < 1 || challenge.expiresIn > 300) throw Error('Invalid verification challenge.');
      await loadGoogle(); if (!cloud.isCurrent(stamp) || attempt !== sequence) return;
      const expires = Date.now() + Math.max(0, challenge.expiresIn * 1000 - 10000);
      let submitted = false;
      window.google.accounts.id.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false, ux_mode: 'popup',
        callback: async response => {
          if (submitted || attempt !== sequence || !cloud.isCurrent(stamp) || Date.now() >= expires || typeof response?.credential !== 'string') return;
          submitted = true;
          try {
            const grant = await cloud.request('/api/admin/bootstrap', { method: 'POST', body: {}, expected: stamp,
              headers: { 'X-Google-Id-Token': response.credential, 'X-Admin-Challenge': challenge.nonce } });
            if (attempt !== sequence || !cloud.isCurrent(stamp)) return;
            if (grant?.isAdmin !== true || typeof grant.grantId !== 'string' || !grant.grantId.length || grant.grantId.length > 512 || !Number.isInteger(grant.expiresIn) || grant.expiresIn < 1 || grant.expiresIn > 600) throw Error('Invalid verification grant.');
            const grantExpires = Date.now() + Math.max(0, grant.expiresIn * 1000 - 10000);
            proof = { grantId: grant.grantId, expires: grantExpires, stamp };
            clearTimeout(timer);
            timer = setTimeout(() => clearProof('Verification expired. Prepare a new Google verification.'), Math.max(0, grantExpires - Date.now()));
            const me = await adminRequest('/api/me');
            if (!cloud.isCurrent(stamp) || !proof || me.userId !== stamp.userId || me.isAdmin !== true) throw Error('Admin access is unavailable for this account.');
            await load(stamp);
          } catch (error) {
            if (error.status === 401 || error.status === 403) clearProof('Verification failed or expired. Check the Google account, then try again.');
            else { clearProof(); fail(error); }
          }
        }
      });
      googleButton.replaceChildren(); window.google.accounts.id.renderButton(googleButton, { type: 'standard', size: 'large' });
      timer = setTimeout(() => clearProof('Verification expired. Prepare a new Google verification.'), Math.max(0, expires - Date.now()));
      status.textContent = 'Select the Google button to verify access.';
    } catch (error) { if (attempt === sequence) fail(error); }
    finally { prepare.disabled = false; }
  }
  cloud.subscribe(next => {
    if (next.generation !== generation) { generation = next.generation; clearProof(); form.reset(); budgetForm.reset(); }
    else if (proof && !cloud.isCurrent(proof.stamp)) {
      const sameIdentity = next.userId === proof.stamp.userId && next.sessionId === proof.stamp.sessionId && next.generation === proof.stamp.generation;
      if (!sameIdentity || Date.now() >= proof.expires) clearProof();
      else if (next.revalidating) { form.hidden = budgetForm.hidden = accessAdmin.hidden = true; status.textContent = 'Checking the session…'; }
      else if (next.me && cloud.isCurrent(next)) {
        // A new epoch also needs a live server check of the existing grant.
        const candidate = proof;
        void cloud.request('/api/me', { expected: next, headers: { 'X-Admin-Grant': candidate.grantId } }).then(me => {
          if (proof !== candidate || !cloud.isCurrent(next)) return;
          if (Date.now() >= candidate.expires || me.userId !== next.userId || me.isAdmin !== true) return clearProof('Verification failed or expired.');
          candidate.stamp = next; form.hidden = budgetForm.hidden = false; void loadAccess().catch(fail);
          status.textContent = `Verified. Settings loaded · revision ${revision}. Budget uses a conservative token allowance, which may exceed invoice spend.`;
        }).catch(() => { if (proof === candidate && cloud.isCurrent(next)) clearProof('Verification failed or expired.'); });
      } else clearProof();
    }
    signIn.hidden = !!next.me; signOut.hidden = !next.me; verification.hidden = !next.me;
    if (!next.me) status.textContent = next.error || 'Sign in to request admin access.';
    else if (!proof && !next.revalidating) status.textContent = 'Prepare Google verification to access settings.';
  });
  if (!cloud.init()) { status.textContent = 'Cloud sign-in is not configured.'; signIn.disabled = true; signIn.hidden = false; }
  signIn.addEventListener('click', () => cloud.signIn().catch(fail));
  signOut.addEventListener('click', () => { clearProof(); cloud.signOut().catch(fail); });
  prepare.addEventListener('click', () => { void prepareStep(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const stamp = cloud.snapshot(); if (!proof || !Number.isSafeInteger(revision)) return;
    const body = { enabled: form.elements.enabled.checked, adapterId: form.elements.adapterId.value, modelId: form.elements.modelId.value, connectionId: form.elements.connectionId.value,
      limits: Object.fromEntries(['requestsPerMinute', 'requestsPerDay', 'maxOutputTokens'].map(k => [k, Number(form.elements[k].value)])) };
    await window.HomePlannerContractsReady;
    if (!window.HomePlannerContracts?.validate('modelConfig', body).valid) return fail(Error('Settings do not meet the contract.'));
    try { show(await adminRequest('/api/admin/model-config', { method: 'PUT', headers: { 'If-Match': `"${revision}"` }, body }), stamp); }
    catch (error) { if (error.status === 409) { status.textContent = 'Settings changed elsewhere. Reloading current settings.'; await load(stamp).catch(fail); } else if (error.status !== 401 && error.status !== 403) fail(error); }
  });
  budgetForm.addEventListener('submit', async event => {
    event.preventDefault(); const stamp = cloud.snapshot(); if (!proof || !Number.isSafeInteger(revision)) return;
    const match = /^(\d{1,5})(?:\.(\d{1,6}))?$/.exec(budgetForm.elements.budget.value.trim());
    const amount = match && Number(match[1]) * 1000000 + Number((match[2] || '').padEnd(6, '0'));
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000000) return fail(Error('Enter a cap from $0.000001 to $10000.'));
    try { show(await adminRequest('/api/admin/budget', { method: 'PUT', headers: { 'If-Match': `"${revision}"` }, body: { globalBudgetMicros: amount } }), stamp); }
    catch (error) { if (error.status === 409) { status.textContent = 'Settings changed elsewhere. Reloading current settings.'; await load(stamp).catch(fail); } else if (error.status !== 401 && error.status !== 403) fail(error); }
  });
})();
