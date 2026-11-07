'use strict';
const { wrap, method } = require('../server/errors');
const { authenticate } = require('../server/auth');
const { requireAdmin } = require('../server/admin');
const { selected } = require('../server/model-config');
function createHandler(deps) {
  return wrap(async req => {
    method(req, ['GET']);
    const ctx = await authenticate(req, deps);
    let isAdmin = false, ai = false;
    if (req.headers['x-google-id-token'] || req.headers['x-admin-challenge']) {
      await requireAdmin(req, ctx, deps); isAdmin = true;
    }
    try { ai = Boolean(selected(await ctx.backend.rpc('hp_model_config_get', {}), deps)); } catch { ai = false; }
    return { body: { userId: ctx.userId, displayName: ctx.displayName || '', isAdmin, capabilities: { cloud: true, ai } } };
  }, deps);
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
