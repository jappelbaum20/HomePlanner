'use strict';
const { createCompleteHandler } = require('../../../../../server/photos');
module.exports = createCompleteHandler();
module.exports.createHandler = createCompleteHandler;
