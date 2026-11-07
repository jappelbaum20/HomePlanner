'use strict';
const { createHandler } = require('../server/proposals');
module.exports = createHandler(); module.exports.createHandler = createHandler;
