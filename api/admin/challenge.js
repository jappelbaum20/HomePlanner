'use strict';
const { wrap, method } = require('../../server/errors');
const { authenticate } = require('../../server/auth');
const { challenge } = require('../../server/admin');
function createHandler(deps) { return wrap(async req => { method(req, ['GET']); return { body: challenge(await authenticate(req, deps), deps) }; }, deps); }
module.exports = createHandler(); module.exports.createHandler = createHandler;
