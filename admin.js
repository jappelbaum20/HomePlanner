(() => {
  'use strict';
  const cloud = window.HomePlannerCloud, status = document.querySelector('#adminStatus');
  const form = document.querySelector('#modelForm'), budgetForm = document.querySelector('#budgetForm');
  const signIn = document.querySelector('#adminSignIn'), signOut = document.querySelector('#adminSignOut');
  const verification = document.querySelector('#verification'), prepare = document.querySelector('#prepareVerification'), googleButton = document.querySelector('#googleButton');
  let generation = -1, proof = null, revision = null, timer = null, sequence = 0, googleLoading = null;
  function clearProof(message) {
    sequence++; proof = null; revision = null; clearTimeout(timer); timer = null;
    form.hidden = budgetForm.hidden = true; googleButton.replaceChildren();
    if (message) status.textContent = message;
  }
  const fail = error => { status.textContent = error?.message || 'Settings are unavailable.'; };
  function headers() {
    if (!proof || Date.now() >= proof.expires || !cloud.isCurrent(proof.stamp)) {
      clearProof('Verification expired. Prepare a new Google verification.');
      throw Error('Verification expired. Prepare a new Google verification.');
    }
    return { 'X-Google-Id-Token': proof.token, 'X-Admin-Challenge': proof.nonce };
  }
  async function adminRequest(path, options = {}) {
    try { return await cloud.request(path, { ...options, headers: { ...headers(), ...options.headers } }); }
    catch (error) {
      if (error.status === 401 || error.status === 403) clearProof('Verification failed or expired. Check the Google account and recent sign-in, then try again.');
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
  async function load(stamp) { show(await adminRequest('/api/admin/model-config'), stamp); }
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
      window.google.accounts.id.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, essential_claims: 'auth_time', auto_select: false, ux_mode: 'popup',
        callback: async response => {
          if (attempt !== sequence || !cloud.isCurrent(stamp) || Date.now() >= expires || typeof response?.credential !== 'string') return;
          proof = { token: response.credential, nonce: challenge.nonce, expires, stamp };
          clearTimeout(timer);
          timer = setTimeout(() => clearProof('Verification expired. Prepare a new Google verification.'), Math.max(0, expires - Date.now()));
          try {
            await adminRequest('/api/admin/bootstrap', { method: 'POST', body: {} });
            const me = await adminRequest('/api/me');
            if (!cloud.isCurrent(stamp) || !proof || me.userId !== stamp.userId || me.isAdmin !== true) throw Error('Admin access is unavailable for this account.');
            await load(stamp);
          } catch (error) {
            if (error.status !== 401 && error.status !== 403) { clearProof(); fail(error); }
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
    signIn.hidden = !!next.me; signOut.hidden = !next.me; verification.hidden = !next.me;
    if (!next.me) status.textContent = next.error || 'Sign in to request admin access.';
    else if (!proof) status.textContent = 'Prepare Google verification to access settings.';
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
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000000) return fail(Error('Enter a cap from $0.000001 to $10,000.'));
    try { show(await adminRequest('/api/admin/budget', { method: 'PUT', headers: { 'If-Match': `"${revision}"` }, body: { globalBudgetMicros: amount } }), stamp); }
    catch (error) { if (error.status === 409) { status.textContent = 'Settings changed elsewhere. Reloading current settings.'; await load(stamp).catch(fail); } else if (error.status !== 401 && error.status !== 403) fail(error); }
  });
})();
