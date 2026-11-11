'use strict';
// Better Auth hooks that decide, from the database and before any user, account or session row is
// written, whether a verified Google identity may sign in. Rejected identities receive only the
// short-lived request handoff cookie. Everything fails closed.
const handoff = require('./handoff.cjs');
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const EMAIL = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// The ID token arrives on the server-to-server code exchange with Google (PKCE and state are checked by
// the library). We still require issuer, audience, verified email and freshness. No nonce is requested
// by this flow, so none is claimed.
function claimsFrom(profile, user, clientId, now = Date.now()) {
  const t = Math.floor(now / 1000);
  if (!profile || typeof profile !== 'object' || !ISSUERS.has(profile.iss) || profile.aud !== clientId || profile.email_verified !== true ||
      typeof profile.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(profile.sub) || typeof profile.email !== 'string' || !Number.isInteger(profile.exp) || profile.exp <= t || !Number.isInteger(profile.iat) || profile.iat > t + 60) return null;
  const email = profile.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email) || (user && typeof user.email === 'string' && user.email.trim().toLowerCase() !== email)) return null;
  const raw = typeof profile.name === 'string' ? profile.name.replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ').trim() : '';
  return { issuer: handoff.ISSUER, subject: profile.sub, email, name: [...(raw || email)].slice(0, 120).join('') };
}
function createSigninGate({ authPool, secret, googleClientId, now = () => Date.now() } = {}) {
  if (!authPool || typeof authPool.query !== 'function' || typeof secret !== 'string' || !googleClientId) throw TypeError('Incomplete sign-in gate configuration');
  const rpc = async (sql, args) => (await authPool.query(sql, args)).rows[0]?.result;
  return Object.freeze({
    async validateUserInfo(data, ctx) {
      try {
        const source = data?.source;
        if (source?.method !== 'oauth' || source.oauth?.providerId !== 'google') return { error: 'access_not_approved' };
        const claims = claimsFrom(source.oauth.profile, data.user, googleClientId, now());
        if (!claims) return { error: 'access_check_failed' };
        const state = (await rpc('SELECT hp_app.hp_access_signin_gate($1,$2,$3) AS result', [claims.issuer, claims.subject, claims.email]))?.state;
        if (state === 'approved') return undefined;
        const sealed = handoff.seal(secret, claims, now());
        ctx.setCookie(handoff.COOKIE, sealed.value, handoff.cookieOptions);
        return { error: 'access_not_approved' };
      } catch { return { error: 'access_check_failed' }; }
    },
    // Last step before the session row exists: create or confirm the subject-bound entitlement.
    async sessionBefore(session) {
      const userId = session?.userId;
      if (typeof userId !== 'string') return false;
      const found = await authPool.query('SELECT lower(email) AS email FROM hp_auth."user" WHERE id=$1', [userId]);
      const email = found.rows[0]?.email;
      if (!email) return false;
      const state = (await rpc('SELECT hp_app.hp_access_signin_bind($1,$2) AS result', [userId, email]))?.state;
      return state === 'approved' ? undefined : false;
    }
  });
}
module.exports = { createSigninGate, claimsFrom };
