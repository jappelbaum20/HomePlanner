'use strict';
const { createCollectionHandler } = require('../server/designs');
module.exports = createCollectionHandler();
module.exports.createHandler = createCollectionHandler;
