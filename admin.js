(() => {
  'use strict';
  const cloud = window.HomePlannerCloud, status = document.querySelector('#adminStatus');
  const form = document.querySelector('#modelForm'), budgetForm = document.querySelector('#budgetForm');
  const signIn = document.querySelector('#adminSignIn'), signOut = document.querySelector('#adminSignOut');
  const verification = document.querySelector('#verification'), prepare = document.querySelector('#prepareVerification'), googleButton = document.querySelector('#googleButton');
  const accessAdmin = document.querySelector('#accessAdmin'), requestList = document.querySelector('#requestList'), requestDetail = document.querySelector('#requestDetail'), entitlementList = document.querySelector('#entitlementList');
  const waitingCount = document.querySelector('#waitingCount'), addSubmit = document.querySelector('#addPersonSubmit');
  const addForm = document.querySelector('#addPersonForm'), addEmail = document.querySelector('#addPersonEmail'), addStatus = document.querySelector('#addPersonStatus'), addActions = document.querySelector('#addPersonActions'), addedList = document.querySelector('#addedList');
  let generation = -1, proof = null, revision = null, timer = null, sequence = 0, googleLoading = null;
  function clearProof(message) {
    sequence++; proof = null; revision = null; clearTimeout(timer); timer = null;
    form.hidden = budgetForm.hidden = accessAdmin.hidden = true; googleButton.replaceChildren(); waitingCount.textContent = ''; addStatus.textContent = ''; addEmail.value = ''; addActions.replaceChildren(); addedList.replaceChildren(); requestList.replaceChildren(); requestDetail.replaceChildren(); entitlementList.replaceChildren();
    if (message) status.textContent = message;
  }
  const fail = error => { if (error?.obsolete) return; status.textContent = error?.message || 'Settings are unavailable.'; };
  function headers() {
    if (!proof || Date.now() >= proof.expires || !cloud.isCurrent(proof.stamp)) {
      clearProof('Verification expired. Prepare a new Google verification.');
      throw Error('Verification expired. Prepare a new Google verification.');
    }
    return { 'X-Admin-Grant': proof.grantId };
  }
  async function adminRequest(path, options = {}) {
    const attempt = sequence, owner = proof;
    try {
      const result = await cloud.request(path, { ...options, expected: owner?.stamp, headers: { ...headers(), ...options.headers } });
      if (attempt !== sequence || proof !== owner) throw Object.assign(Error('Verification changed; response discarded.'), { obsolete: true });
      return result;
    } catch (error) {
      if (attempt !== sequence || proof !== owner) error.obsolete = true;
      else if (error.status === 401 || error.status === 403) clearProof('Verification failed or expired. Check the Google account, then try again.');
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
  async function load(stamp) {
    const [settings, access] = await Promise.allSettled([adminRequest('/api/admin/model-config'), loadAccess()]);
    if (access.status === 'rejected') throw access.reason;
    if (settings.status === 'fulfilled') show(settings.value, stamp); else fail(settings.reason);
  }
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
    for (const mail of (item.mail || []).filter(mail => mail.kind !== 'request')) {
      const row = line(requestDetail, `${mail.kind}: ${mail.status} · attempts ${mail.attempts}${mail.errorCategory ? ' · ' + mail.errorCategory : ''}`);
      if (mail.status === 'failed') action(row, 'Retry notification', async () => {
        await adminRequest(`/api/admin/access/mail/${encodeURIComponent(mail.id)}/retry`, { method: 'POST', headers: { 'If-Match': `"${mail.revision}"` }, body: {} }); await review(item.id);
      });
    }
  }
  function requestedAt(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  async function decide(item, decision) {
    try {
      await adminRequest(`/api/admin/access/requests/${encodeURIComponent(item.id)}/${decision}`, { method: 'POST', headers: { 'If-Match': `"${item.revision}"` }, body: {} });
    } catch (error) {
      if (error.status !== 409) throw error;
      await loadAccess();
      throw Error('This request changed. The current list has been reloaded.');
    }
    await loadAccess();
  }
  function requestRow(parent, item) {
    const row = document.createElement('article'); row.className = 'access-request' + (item.status === 'pending' ? ' pending' : ' decided');
    line(row, `${item.status === 'pending' ? 'Waiting' : item.status} · ${requestedAt(item.createdAt)}`);
    line(row, `${item.name} · ${item.email}`);
    const controls = document.createElement('div'); controls.className = 'btnrow'; row.append(controls);
    let busy = false;
    if (item.status === 'pending') for (const [decision, label] of [['approve', 'Approve'], ['deny', 'Deny']]) action(controls, label, async () => {
      if (busy) return; busy = true;
      try { await decide(item, decision); } finally { busy = false; }
    });
    action(controls, 'Details and note', () => review(item.id));
    parent.append(row);
  }
  async function loadAccess() {
    const [requests, entitlements, added] = await Promise.all([adminRequest('/api/admin/access/requests'), adminRequest('/api/admin/access/entitlements'), adminRequest('/api/admin/access/people')]);
    if (!Array.isArray(requests) || !Array.isArray(entitlements) || !Array.isArray(added) || !proof) throw Error('Access review is unavailable.');
    addedList.replaceChildren();
    if (!added.length) line(addedList, 'Nobody is waiting to sign in.');
    for (const item of added) {
      const row = line(addedList, `${item.email} · added ${requestedAt(item.addedAt)} · not signed in yet `);
      action(row, 'Remove', async () => { await adminRequest('/api/admin/access/people/remove', { method: 'POST', body: { email: item.email } }); addStatus.textContent = `${item.email} removed.`; await loadAccess(); });
    }
    requestList.replaceChildren(); requestDetail.replaceChildren(); entitlementList.replaceChildren(); accessAdmin.hidden = false;
    const pending = requests.filter(item => item.status === 'pending'), decided = requests.filter(item => item.status !== 'pending');
    waitingCount.textContent = `${pending.length} ${pending.length === 1 ? 'request' : 'requests'} waiting`;
    const heading = document.createElement('h3'); heading.textContent = 'Waiting for approval'; requestList.append(heading);
    if (!pending.length) line(requestList, 'No requests waiting.');
    for (const item of pending) requestRow(requestList, item);
    if (decided.length) {
      const history = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Decided requests'; history.append(summary);
      for (const item of decided) requestRow(history, item);
      requestList.append(history);
    }
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
  // Returns the id of a waiting request to open, if the address already has one. It never loads the list itself.
  async function addPerson(address, override) {
    let pendingId;
    addActions.replaceChildren();
    const result = await adminRequest('/api/admin/access/people', { method: 'POST', body: override ? { email: address, override: true } : { email: address } });
    const outcome = result?.result;
    if (outcome === 'added') addStatus.textContent = `${address} added. They have access once they sign in with Google using this address.`;
    else if (outcome === 'reinstated') addStatus.textContent = `${address} had an account that was closed; access is restored.`;
    else if (outcome === 'already_added') addStatus.textContent = `${address} is already added and has not signed in yet.`;
    else if (outcome === 'has_access') addStatus.textContent = `${address} already has access.`;
    else if (outcome === 'pending_request') { addStatus.textContent = `A request from ${address} is waiting. Approve it from the waiting list.`; if (typeof result.requestId === 'string') pendingId = result.requestId; }
    else if (outcome === 'blocked') {
      const restore = result.restore === true;
      addStatus.textContent = restore ? `${address} has a closed account (${result.state}), so it was not restored.` : `${address} was ${result.state} before, so it was not added.`;
      action(addActions, restore ? 'Restore closed account' : 'Allow anyway', () => submitAdd(address, true));
      return undefined;
    } else throw Error('The result was not understood.');
    if (outcome === 'added' || outcome === 'reinstated') addEmail.value = '';
    return pendingId;
  }
  // Reload the lists first (that clears the detail panel), then open the waiting request, so it stays visible.
  async function submitAdd(address, override) {
    addSubmit.disabled = true;
    try { const pendingId = await addPerson(address, override); await loadAccess(); if (pendingId) await review(pendingId); }
    finally { addSubmit.disabled = false; }
  }
  addForm.addEventListener('submit', event => {
    event.preventDefault(); const address = addEmail.value.trim();
    if (!address) return;
    addStatus.textContent = '';
    if (addSubmit.disabled) return;
    void submitAdd(address, false).catch(fail);
  });
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
    let stamp = cloud.snapshot(); if (!stamp.me) return;
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
          if (submitted || attempt !== sequence || Date.now() >= expires || typeof response?.credential !== 'string') return;
          submitted = true;
          try {
            stamp = await cloud.verificationStamp(stamp);
            if (attempt !== sequence || Date.now() >= expires) return;
            const grant = await cloud.request('/api/admin/bootstrap', { method: 'POST', body: {}, expected: stamp,
              headers: { 'X-Google-Id-Token': response.credential, 'X-Admin-Challenge': challenge.nonce } });
            if (attempt !== sequence || !cloud.isCurrent(stamp)) return;
            if (grant?.isAdmin !== true || typeof grant.grantId !== 'string' || !grant.grantId.length || grant.grantId.length > 512 || !Number.isInteger(grant.expiresIn) || grant.expiresIn < 1 || grant.expiresIn > 600) throw Error('Invalid verification grant.');
            const grantExpires = Date.now() + Math.max(0, grant.expiresIn * 1000 - 10000);
            proof = { grantId: grant.grantId, expires: grantExpires, stamp };
            clearTimeout(timer);
            timer = setTimeout(() => clearProof('Verification expired. Prepare a new Google verification.'), Math.max(0, grantExpires - Date.now()));
            const me = await adminRequest('/api/me');
            if (attempt !== sequence) return;
            if (!cloud.isCurrent(stamp) || !proof || me.userId !== stamp.userId || me.isAdmin !== true) throw Error('Admin access is unavailable for this account.');
            await load(stamp);
          } catch (error) {
            if (attempt !== sequence) return;
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
    catch (error) { if (error.obsolete) return; if (error.status === 409) { status.textContent = 'Settings changed elsewhere. Reloading current settings.'; await load(stamp).catch(fail); } else if (error.status !== 401 && error.status !== 403) fail(error); }
  });
  budgetForm.addEventListener('submit', async event => {
    event.preventDefault(); const stamp = cloud.snapshot(); if (!proof || !Number.isSafeInteger(revision)) return;
    const match = /^(\d{1,5})(?:\.(\d{1,6}))?$/.exec(budgetForm.elements.budget.value.trim());
    const amount = match && Number(match[1]) * 1000000 + Number((match[2] || '').padEnd(6, '0'));
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000000) return fail(Error('Enter a cap from $0.000001 to $10000.'));
    try { show(await adminRequest('/api/admin/budget', { method: 'PUT', headers: { 'If-Match': `"${revision}"` }, body: { globalBudgetMicros: amount } }), stamp); }
    catch (error) { if (error.obsolete) return; if (error.status === 409) { status.textContent = 'Settings changed elsewhere. Reloading current settings.'; await load(stamp).catch(fail); } else if (error.status !== 401 && error.status !== 403) fail(error); }
  });
})();
