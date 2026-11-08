'use strict';
// Offline test seam. Never registered as a deployable connection.
function fakeProvider(result) { return { async generateShelfProposal() { return structuredClone(result); } }; }
module.exports = { fakeProvider };
