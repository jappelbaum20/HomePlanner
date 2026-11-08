(() => {
  'use strict';
  const cloud = window.HomePlannerCloud, status = document.querySelector('#accessStatus');
  const signIn = document.querySelector('#accessSignIn'), signOut = document.querySelector('#accessSignOut');
  const binding = document.querySelector('#binding'), button = document.querySelector('#prepareBinding'), googleButton = document.querySelector('#bindingGoogle');
  const form = document.querySelector('#requestForm'), availability = document.querySelector('#requestAvailability');
  const messages = { pending: 'Your account is awaiting approval. Submit a request below if you have not already done so.', denied: 'Your access request was not approved.', revoked: 'Your access has been revoked.', approved: 'Your account is approved.' };
  let sequence = 0, identity = null;
  const fail = e => { status.textContent = e?.message || 'Access is temporarily unavailable.'; };
  cloud.subscribe(state => {
    const nextIdentity = `${state.generation}:${state.userId}:${state.sessionId}`;
    if (identity !== nextIdentity) { identity = nextIdentity; sequence++; googleButton.replaceChildren(); }
    const signedIn = !!state.me, access = state.me?.access?.status || (signedIn ? 'approved' : null);
    signIn.hidden = signedIn; signOut.hidden = !signedIn;
    binding.hidden = !signedIn || access === 'approved';
    document.querySelector('#workspaces').hidden = access !== 'approved';
    status.textContent = state.revalidating ? 'Checking access…' : state.error || (signedIn ? messages[access] : 'Sign in or request access.');
  });
  if (!cloud.init()) { status.textContent = 'Sign-in is unavailable.'; signIn.disabled = true; signIn.hidden = false; }
  signIn.addEventListener('click', () => cloud.signIn().catch(fail));
  signOut.addEventListener('click', () => cloud.signOut().catch(fail));
  fetch('/api/access/availability', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => {
    const available = data?.requestsAvailable === true; form.hidden = !available;
    availability.textContent = available ? 'Requests are available.' : 'Requests are temporarily unavailable. Please try again later.';
  }).catch(() => { availability.textContent = 'Requests are temporarily unavailable. Please try again later.'; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = form.querySelector('button'); submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const response = await fetch('/api/access/requests', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw Error('Your request could not be recorded. Please try again later.');
      form.reset(); availability.textContent = 'Request recorded. The owner will review it.';
    } catch (error) { availability.textContent = error.message; } finally { submit.disabled = false; }
  });
  button.addEventListener('click', async () => {
    let stamp = cloud.snapshot(); const attempt = ++sequence; button.disabled = true;
    try {
      const challenge = await cloud.request('/api/access/challenge', { expected: stamp });
      if (!cloud.isCurrent(stamp) || attempt !== sequence || !/^[A-Za-z0-9_-]{43}$/.test(challenge?.nonce || '') || !challenge.clientId?.endsWith('.apps.googleusercontent.com')) throw Error('Verification is unavailable.');
      if (!window.google?.accounts?.id) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
        script.onload = resolve; script.onerror = () => reject(Error('Google verification is unavailable.')); document.head.append(script);
      });
      if (!cloud.isCurrent(stamp) || attempt !== sequence || !window.google?.accounts?.id) return;
      let used = false; const expires = Date.now() + Math.min(300, challenge.expiresIn || 0) * 1000;
      window.google.accounts.id.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false, ux_mode: 'popup', callback: async response => {
        if (used || Date.now() >= expires || attempt !== sequence || typeof response?.credential !== 'string') return;
        used = true;
        try { stamp = await cloud.verificationStamp(stamp); if (attempt !== sequence || Date.now() >= expires) return; await cloud.request('/api/access/bind', { method: 'POST', expected: stamp, body: { token: response.credential, nonce: challenge.nonce } }); location.reload(); }
        catch (error) { if (attempt === sequence) fail(error); }
      } });
      googleButton.replaceChildren(); window.google.accounts.id.renderButton(googleButton, { type: 'standard', size: 'large' });
      status.textContent = 'Select the Google button to verify your account.';
    } catch (error) { fail(error); } finally { button.disabled = false; }
  });
})();
