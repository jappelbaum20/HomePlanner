'use strict';

// B supplies a real configured instance. This imports the pinned package's
// actual Node adapter, not a simulated success endpoint.
async function createBetterAuthHandler(auth) {
  if (!auth || typeof auth.handler !== 'function' || !auth.api || typeof auth.api.getSession !== 'function') throw new TypeError('A configured Better Auth instance is required.');
  const { toNodeHandler } = await import('better-auth/node');
  return toNodeHandler(auth);
}
module.exports = { createBetterAuthHandler };
