'use strict';
const { createAuth } = require('../server/auth-config.cjs');
const { resolveAuthSession } = require('../server/session.cjs');
const { createBackend } = require('../server/db');
const { createBetterAuthHandler } = require('./node-auth.cjs');
const { existingHandlers } = require('./routes.cjs');
const { verifyMigrations } = require('../db/migrate.cjs');
const { createAccessStore } = require('../server/access.cjs');
const { csrfFor } = require('./router.cjs');
const { timingSafeEqual } = require('node:crypto');
const handoff = require('../server/handoff.cjs');

// Composition only. Callers supply credentials/pools and independently installed
// filesystem handlers; the default runtime remains disconnected and unready.
async function createIntegrations({ origin = 'https://home.appelbaums.com', authPool, appPool, publicPool, rateKey, authSecret, csrfSecret, googleClientId, googleClientSecret, photoHandlers, photoRecovery, photoReady, close, getTrustedClientIp, requestsAvailable = false } = {}) {
  if (typeof csrfSecret !== 'string' || Buffer.byteLength(csrfSecret) < 32 || typeof photoReady !== 'function') throw TypeError('Incomplete runtime configuration');
  const auth = await createAuth({ origin, authPool, secret: authSecret, googleClientId, googleClientSecret });
  const backend = createBackend({ appPool, photoRecovery });
  const accessStore = createAccessStore({ appPool, publicPool, rateKey });
  const verifyCsrf = (req, ctx) => {
    const token = req.headers['x-homeplanner-csrf'], expected = csrfFor(csrfSecret, ctx.sessionId);
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  };
  const handoffFromRequest = req => handoff.fromRequest(authSecret, req);
  const deps = { origin, backend, googleClientId, accessStore, getTrustedClientIp, verifyCsrf, handoffFromRequest };
  const handlers = existingHandlers(deps);
  // Never enable the retained hosted-storage handlers in a self-hosted runtime.
  for (const key of ['photoReserve', 'photoRaw', 'photoComplete', 'photoDownload']) {
    if (typeof photoHandlers?.[key] === 'function') handlers[key] = photoHandlers[key];
    else delete handlers[key];
  }
  async function leastPrivilege(pool, role, schema) {
    const r = await pool.query("SELECT pg_catalog.pg_has_role(current_user,$1,'MEMBER') AS member, pg_catalog.pg_has_role(current_user,$2,'MEMBER') AS cross_role, pg_catalog.pg_has_role(current_user,'hp_auth_owner','MEMBER') AS auth_owner, pg_catalog.pg_has_role(current_user,'hp_app_owner','MEMBER') AS app_owner, pg_catalog.pg_has_role(current_user,'hp_access_public','MEMBER') AS access_public, pg_catalog.pg_has_role(current_user,'hp_mail_worker','MEMBER') AS mail_worker, pg_catalog.pg_has_role(current_user,'hp_photo_maintenance','MEMBER') AS maintenance, r.rolsuper, r.rolbypassrls, current_schema() AS schema, current_user AS name FROM pg_catalog.pg_roles r WHERE r.rolname=current_user", [role, role === 'hp_auth_runtime' ? 'hp_app_runtime' : 'hp_auth_runtime']);
    const x = r.rows[0];
    return !!x && x.member === true && [x.cross_role,x.auth_owner,x.app_owner,x.access_public,x.mail_worker,x.maintenance,x.rolsuper,x.rolbypassrls].every(v => v === false) && !['hp_auth_owner','hp_app_owner'].includes(x.name) && (!schema || x.schema === schema);
  }
  if (!await leastPrivilege(authPool,'hp_auth_runtime','hp_auth') || !await leastPrivilege(appPool,'hp_app_runtime',null) || !await accessStore.verifyPublicRole() || !await verifyMigrations(appPool)) throw Error('Runtime database roles or migrations are not ready');
  return {
    csrfSecret, authHandler: await createBetterAuthHandler(auth), handlers, requestsAvailable, handoffFromRequest,
    accessStatus: s => accessStore.status(s), assertApproved: s => accessStore.assertApproved(s),
    async resolveSession(req) {
      const session = await resolveAuthSession(auth, req);
      if (!session) return null;
      const subjects = await backend.forSession(session).googleSubjects();
      return Array.isArray(subjects) && subjects.length === 1 ? session : null;
    },
    async ready() {
      return typeof photoRecovery === 'function' && ['photoReserve','photoRaw','photoComplete','photoDownload'].every(k => typeof handlers[k] === 'function') &&
        await leastPrivilege(authPool,'hp_auth_runtime','hp_auth') && await leastPrivilege(appPool,'hp_app_runtime',null) &&
        await accessStore.verifyPublicRole() === true && await verifyMigrations(appPool) === true && await photoReady() === true;
    },
    async close() { if (close) await close(); else await Promise.all([authPool.end(), appPool.end()]); }
  };
}
module.exports = { createIntegrations };



