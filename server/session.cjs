'use strict';
const { uuid } = require('./errors');

async function resolveAuthSession(auth, req) {
  // The library verifies the signed cookie and queries durable storage on every call.
  const { fromNodeHeaders } = await import('better-auth/node');
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true, disableRefresh: true } });
  if (!result) return null;
  const user = result.user, session = result.session;
  if (!uuid(user?.id) || !uuid(session?.id) || session.userId !== user.id || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now() || !session.createdAt || Date.now() - new Date(session.createdAt).getTime() >= 604800000) return null;
  return { userId: user.id.toLowerCase(), sessionId: session.id.toLowerCase(), displayName: typeof user.name === 'string' ? user.name.slice(0, 120) : '' };
}
module.exports = { resolveAuthSession };
