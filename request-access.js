(() => {
  'use strict';
  // The page itself is only served with a valid 10-minute handoff cookie. No name, email or note is
  // entered here: the request is made for the Google-verified account the server already knows.
  const $ = selector => document.querySelector(selector);
  const text = {
    en: { title: 'Request access', account: 'Verified Google account:', send: 'Request access', again: 'Sign in with another account',
      none: 'This account has not been approved yet.', pending: 'Your request is awaiting review.', denied: 'Your request was denied. After 24 hours, sign in again to submit a new request.',
      revoked: 'Your access was revoked. Please contact the owner.', approved: 'Your account is approved. Sign in again to continue.', sent: 'Your request is waiting for approval.',
      rate: 'Please wait before trying again.', conflict: 'A new request is not available now. Please contact the owner.', unavailable: 'The request could not be processed. Please try again later.',
      expired: 'This page has expired. Please sign in again.' },
    de: { title: 'Zugang anfragen', account: 'Verifiziertes Google-Konto:', send: 'Zugang anfragen', again: 'Anderes Konto anmelden',
      none: 'Dieses Konto ist noch nicht freigegeben.', pending: 'Ihre Anfrage wartet auf Prüfung.', denied: 'Ihre Anfrage wurde abgelehnt. Nach 24 Stunden können Sie sich erneut anmelden und eine neue Anfrage stellen.',
      revoked: 'Ihr Zugang wurde entzogen. Bitte wenden Sie sich an den Eigentümer.', approved: 'Ihr Konto ist freigegeben. Bitte melden Sie sich erneut an.', sent: 'Ihre Anfrage wartet auf Freigabe.',
      rate: 'Bitte warten Sie vor dem erneuten Versuch.', conflict: 'Eine neue Anfrage ist derzeit nicht möglich. Bitte wenden Sie sich an den Eigentümer.', unavailable: 'Die Anfrage konnte derzeit nicht verarbeitet werden. Bitte versuchen Sie es später erneut.',
      expired: 'Diese Seite ist abgelaufen. Bitte melden Sie sich erneut an.' }
  };
  const readLang = () => { try { const v = window.localStorage.getItem('hp-lang'); if (v === 'de' || v === 'en') return v; } catch {} return /^de\b/i.test(window.navigator?.language || '') ? 'de' : 'en'; };
  let lang = readLang(), key = 'unavailable', csrf = '', email = '', busy = false, canSend = false;
  const t = k => text[lang][k] || text.en[k] || '';
  function render() {
    document.documentElement.lang = lang;
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll('[data-lang]')) node.setAttribute('aria-pressed', String(node.dataset.lang === lang));
    $('#state').textContent = t(key); $('#send').hidden = !canSend; $('#send').disabled = busy; $('#account').textContent = email;
  }
  for (const node of document.querySelectorAll('[data-lang]')) node.addEventListener('click', () => { lang = node.dataset.lang; try { window.localStorage.setItem('hp-lang', lang); } catch {} render(); });
  function apply(data, notice) {
    email = data.email; csrf = data.csrf;
    const wait = Number.isInteger(data.retryAfter) ? data.retryAfter : 0;
    key = notice || (data.status === 'none' ? 'none' : data.status);
    canSend = data.status === 'none' || (data.status === 'denied' && wait === 0);
    if (!['none', 'pending', 'denied', 'revoked', 'approved'].includes(data.status)) { key = 'unavailable'; canSend = false; }
  }
  async function load(notice) {
    try {
      const response = await fetch('/api/access/handoff', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { key = 'expired'; canSend = false; return render(); }
      if (!response.ok) throw Error('unavailable');
      apply(await response.json(), notice);
    } catch { key = 'unavailable'; canSend = false; }
    render();
  }
  $('#send').addEventListener('click', async () => {
    if (busy) return; busy = true; render();
    let notice = 'sent';
    try {
      const response = await fetch('/api/access/requests', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-HomePlanner-Handoff-CSRF': csrf }, body: '{}' });
      if (response.status === 429) notice = 'rate'; else if (response.status === 409) notice = 'conflict'; else if (!response.ok) notice = 'unavailable';
    } catch { notice = 'unavailable'; }
    busy = false; await load(notice === 'sent' ? undefined : notice);
    if (notice === 'sent') { key = key === 'pending' ? 'sent' : key; render(); }
  });
  render(); load();
})();
