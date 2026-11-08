'use strict';

// Names are the stable adapter keys; parameters are supplied only by the router.
const routes = [
  { path: /^\/api\/me$/, methods: ['GET'], name: 'me' },
  { path: /^\/api\/designs$/, methods: ['GET', 'POST'], name: 'designs' },
  { path: /^\/api\/designs\/([^/]+)$/, methods: ['GET', 'PUT', 'DELETE'], name: 'design', params: ['id'] },
  { path: /^\/api\/designs\/([^/]+)\/photos$/, methods: ['POST'], name: 'photoReserve', params: ['id'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)$/, methods: ['GET'], name: 'photoDownload', params: ['id', 'photoId'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)\/complete$/, methods: ['POST'], name: 'photoComplete', params: ['id', 'photoId'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)\/raw$/, methods: ['PUT'], name: 'photoRaw', params: ['id', 'photoId'], raw: true },
  { path: /^\/api\/shelf-proposals$/, methods: ['POST'], name: 'proposals' },
  { path: /^\/api\/admin\/challenge$/, methods: ['GET'], name: 'adminChallenge' },
  { path: /^\/api\/admin\/bootstrap$/, methods: ['POST'], name: 'adminBootstrap' },
  { path: /^\/api\/admin\/model-config$/, methods: ['GET', 'PUT'], name: 'adminModelConfig' },
  { path: /^\/api\/admin\/budget$/, methods: ['PUT'], name: 'adminBudget' }
];
// Legacy handlers are deliberately NOT loaded by the default host. B/D must
// replace their bearer/database/admin assumptions before explicitly wiring them.
function existingHandlers(deps) {
  const files = {
    me: '../api/me', designs: '../api/designs', design: '../api/designs/[id]',
    photoReserve: '../api/designs/[id]/photos', photoDownload: '../api/designs/[id]/photos/[photoId]',
    photoComplete: '../api/designs/[id]/photos/[photoId]/complete', proposals: '../api/shelf-proposals',
    adminChallenge: '../api/admin/challenge', adminBootstrap: '../api/admin/bootstrap',
    adminModelConfig: '../api/admin/model-config', adminBudget: '../api/admin/budget'
  };
  return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, require(file).createHandler(deps)]));
}
module.exports = { routes, existingHandlers };
