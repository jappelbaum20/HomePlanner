'use strict';
const { wrap, method, jsonBody, fail } = require('../../server/errors');
const { authenticate } = require('../../server/auth');
const { bootstrap } = require('../../server/admin');
function createHandler(deps) { return wrap(async req => {
  method(req, ['POST']); const ctx = await authenticate(req, deps);
  if (Object.keys(jsonBody(req, 1024)).length) fail(422, 'invalid_data', 'Invalid bootstrap request.');
  return { body: await bootstrap(req, ctx, deps) };
}, deps); }
module.exports = createHandler(); module.exports.createHandler = createHandler;
