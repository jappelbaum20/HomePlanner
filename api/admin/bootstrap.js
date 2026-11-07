'use strict';
const { wrap, method, jsonBody, fail } = require('../../server/errors');
const { authenticate } = require('../../server/auth');
const { requireAdmin } = require('../../server/admin');
function createHandler(deps) { return wrap(async req => {
  method(req, ['POST']); const ctx = await authenticate(req, deps);
  if (Object.keys(jsonBody(req, 1024)).length) fail(422, 'invalid_data', 'Invalid bootstrap request.');
  await requireAdmin(req, ctx, deps, { bootstrap: true });
  return { body: { isAdmin: true } };
}, deps); }
module.exports = createHandler(); module.exports.createHandler = createHandler;
