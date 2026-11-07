'use strict';
const { wrap, method, revision, jsonBody } = require('../../server/errors');
const { authenticate } = require('../../server/auth');
const admin = require('../../server/admin');
function createHandler(deps) { return wrap(async req => {
  method(req, ['PUT']); const ctx = await authenticate(req, deps);
  const subject = await admin.requireAdmin(req, ctx, deps);
  return { body: await admin.updateBudget(ctx, subject, revision(req.headers['if-match']), jsonBody(req, 4096), deps) };
}, deps); }
module.exports = createHandler(); module.exports.createHandler = createHandler;
