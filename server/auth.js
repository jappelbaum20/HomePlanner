'use strict';
const { fail, uuid } = require('./errors');

// Auth verifies the signature and expiry remotely before any JWT claim is used.
// The session row is also checked so a signed-out session fails closed.
async function authenticate(req, deps) {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  if (!match) fail(401, 'unauthenticated', 'A valid session is required.');
  const backend = deps && deps.backend ? deps.backend : require('./db').createBackend();
  const context = await backend.verify(match[1]);
  if (!context || !uuid(context.userId)) fail(401, 'unauthenticated', 'A valid session is required.');
  // The claims are read only after backend.verify has verified this exact token
  // and checked that its session is live.
  let claims;
  try { claims = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString('utf8')); } catch { claims = {}; }
  return { ...context, sessionId: context.sessionId || claims.session_id, backend };
}
async function googleSubjects(ctx, deps) {
  if (deps && deps.googleSubjects) return deps.googleSubjects(ctx);
  if (!ctx.client) return [];
  const { data, error } = await ctx.client.auth.getUser();
  if (error || !data?.user || data.user.id !== ctx.userId || !Array.isArray(data.user.identities)) return [];
  return data.user.identities.filter(i => i.provider === 'google' && i.user_id === ctx.userId && typeof i.provider_id === 'string').map(i => i.provider_id);
}
module.exports = { authenticate, googleSubjects };
