'use strict';
const { fail, uuid } = require('./errors');

async function authenticate(req, deps) {
  let context = req.homeplannerSession;
  // Explicit injected backends remain available for offline handler tests only.
  if (!context && deps?.backend && typeof deps.backend.verify === 'function') {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '');
    if (match) context = await deps.backend.verify(match[1]);
  }
  if (!context || !uuid(context.userId)) fail(401, 'unauthenticated', 'A valid session is required.');
  const factory = deps?.backend;
  if (!factory) fail(503, 'unavailable', 'Service is temporarily unavailable.');
  const backend = typeof factory.forSession === 'function' ? factory.forSession(context) : factory;
  return { ...context, backend };
}
async function googleSubjects(ctx, deps) {
  if (deps?.googleSubjects) return deps.googleSubjects(ctx);
  if (typeof ctx.backend.googleSubjects !== 'function') return [];
  return ctx.backend.googleSubjects();
}
module.exports = { authenticate, googleSubjects };
