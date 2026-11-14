(() => {
  'use strict';
  const cloud = window.HomePlannerCloud, status = document.querySelector('#accessStatus');
  const signIn = document.querySelector('#accessSignIn'), signOut = document.querySelector('#accessSignOut');
  const text = {
    en: { heading: 'Sign in to HomePlanner', intro: 'Sign in with your approved Google account.', google: 'Sign in with Google', signout: 'Sign out', home: 'Open room planner', shelf: 'Open bookshelf builder', request: 'To request access, sign in with Google.', admin: 'Admin settings',
      checking: 'Checking access…', unavailable: 'Sign-in is unavailable.', pending: 'Your request is awaiting approval.', denied: 'Your access request was not approved.', revoked: 'Your access has been revoked.', approved: 'You are signed in.',
      access_check_failed: 'Sign-in could not be verified. Please try again.', unknown: 'Sign-in could not be completed. Please try again.' },
    de: { heading: 'Bei HomePlanner anmelden', intro: 'Melden Sie sich mit Ihrem freigegebenen Google-Konto an.', google: 'Mit Google anmelden', signout: 'Abmelden', home: 'Raumplaner öffnen', shelf: 'Regalplaner öffnen', request: 'Um Zugang anzufragen, melden Sie sich mit Google an.', admin: 'Administration',
      checking: 'Zugang wird geprüft…', unavailable: 'Anmeldung nicht verfügbar.', pending: 'Ihre Anfrage wartet auf Freigabe.', denied: 'Ihre Zugangsanfrage wurde nicht freigegeben.', revoked: 'Ihr Zugang wurde entzogen.', approved: 'Sie sind angemeldet.',
      access_check_failed: 'Die Anmeldung konnte nicht geprüft werden. Bitte erneut versuchen.', unknown: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' }
  };
  const readLang = () => { try { const v = window.localStorage.getItem('hp-lang'); if (v === 'de' || v === 'en') return v; } catch {} return /^de\b/i.test(window.navigator?.language || '') ? 'de' : 'en'; };
  let lang = readLang(), last = { key: null, extra: '' };
  const t = key => text[lang][key] || text.en[key] || '';
  const say = (key, extra) => { last = { key, extra: extra || '' }; status.textContent = (key && t(key)) || extra || ''; };
  function render() {
    document.documentElement.lang = lang;
    for (const node of document.querySelectorAll?.('[data-i18n]') || []) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll?.('[data-lang]') || []) node.setAttribute('aria-pressed', String(node.dataset.lang === lang));
    status.textContent = (last.key && t(last.key)) || last.extra;
  }
  for (const node of document.querySelectorAll?.('[data-lang]') || []) node.addEventListener('click', () => { lang = node.dataset.lang; try { window.localStorage.setItem('hp-lang', lang); } catch {} render(); });
  const fail = e => say(null, e?.message || t('unavailable'));
  const urlError = (() => { try { return new URLSearchParams(window.location?.search || '').get('signin_error'); } catch { return null; } })();
  cloud.subscribe(state => {
    const signedIn = !!state.me, access = state.me?.access?.status || (signedIn ? 'approved' : null);
    signIn.hidden = signedIn; signOut.hidden = !signedIn;
    document.querySelector('#ownerAdminLink').hidden = state.revalidating || state.me?.access?.role !== 'owner';
    document.querySelector('#workspaces').hidden = access !== 'approved';
    if (state.revalidating) say('checking');
    else if (state.error) say(null, state.error);
    else if (signedIn) say(access);
    else if (urlError) say(text.en[urlError] ? urlError : 'unknown');
    else say(null, '');
  });
  if (!cloud.init()) { say('unavailable'); signIn.disabled = true; signIn.hidden = false; }
  render();
  signIn.addEventListener('click', () => cloud.signIn().catch(fail));
  signOut.addEventListener('click', () => cloud.signOut().catch(fail));
})();
