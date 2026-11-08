'use strict';
const { createItemHandler } = require('../../server/designs');
module.exports = createItemHandler();
module.exports.createHandler = createItemHandler;
