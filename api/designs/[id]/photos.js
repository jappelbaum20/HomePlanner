'use strict';
const { createReserveHandler } = require('../../../server/photos');
module.exports = createReserveHandler();
module.exports.createHandler = createReserveHandler;
