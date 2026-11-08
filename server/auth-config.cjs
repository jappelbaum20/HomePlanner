'use strict';

// All configuration is supplied by the caller; no dotenv loading or request-derived hosts.
function authOptions({ origin, authPool, secret, googleClientId, googleClientSecret }) {
  const url = new URL(origin);
  if (url.origin !== origin || (origin !== 'https://home.appelbaums.com' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw TypeError('Invalid auth origin');
  if (!authPool || typeof authPool.query !== 'function' || typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || typeof googleClientId !== 'string' || !googleClientId.endsWith('.apps.googleusercontent.com') || typeof googleClientSecret !== 'string' || !googleClientSecret) throw TypeError('Incomplete auth configuration');
  // OAuth credentials are needed only during the callback, not after account linking.
  const strip = async data => ({ data: { ...data, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } });
  return {
    baseURL: origin, secret, database: authPool, trustedOrigins: [origin],
    emailAndPassword: { enabled: false },
    socialProviders: { google: { clientId: googleClientId, clientSecret: googleClientSecret, scope: ['openid', 'email', 'profile'] } },
    session: { expiresIn: 604800, disableSessionRefresh: true, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false, disableImplicitLinking: true }, storeAccountCookie: false, updateAccountOnSignIn: false },
    advanced: { database: { generateId: 'uuid' }, useSecureCookies: true, crossSubDomainCookies: { enabled: false }, defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }, ipAddress: { disableIpTracking: true } },
    databaseHooks: { account: { create: { before: strip }, update: { before: strip } } },
    logger: { disabled: true }, telemetry: { enabled: false }
  };
}
async function createAuth(config) { const { betterAuth } = await import('better-auth'); return betterAuth(authOptions(config)); }
module.exports = { authOptions, createAuth };
