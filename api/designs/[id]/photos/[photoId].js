'use strict';
const { createDownloadHandler } = require('../../../../server/photos');
module.exports = createDownloadHandler();
module.exports.createHandler = createDownloadHandler;
