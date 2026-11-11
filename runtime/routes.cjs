'use strict';

// Names are the stable adapter keys; parameters are supplied only by the router.
const routes = [
  { path: /^\/api\/access\/requests$/, methods: ['POST'], name: 'accessRequest', public: true },
  { path: /^\/api\/access\/status$/, methods: ['GET'], name: 'accessStatus', escape: true },
  { path: /^\/api\/access\/challenge$/, methods: ['GET'], name: 'accessChallenge', escape: true },
  { path: /^\/api\/access\/bind$/, methods: ['POST'], name: 'accessBind', escape: true },
  { path: /^\/api\/admin\/access\/requests$/, methods: ['GET'], name: 'accessReviews' },
  { path: /^\/api\/admin\/access\/requests\/([^/]+)$/, methods: ['GET'], name: 'accessReview', params: ['id'] },
  { path: /^\/api\/admin\/access\/requests\/([^/]+)\/approve$/, methods: ['POST'], name: 'accessApprove', params: ['id'] },
  { path: /^\/api\/admin\/access\/requests\/([^/]+)\/deny$/, methods: ['POST'], name: 'accessDeny', params: ['id'] },
  { path: /^\/api\/admin\/access\/entitlements$/, methods: ['GET'], name: 'accessEntitlements' },
  { path: /^\/api\/admin\/access\/entitlements\/([^/]+)\/revoke$/, methods: ['POST'], name: 'accessRevoke', params: ['userId'] },
  { path: /^\/api\/admin\/access\/mail\/([^/]+)\/retry$/, methods: ['POST'], name: 'accessRetry', params: ['id'] },
  { path: /^\/api\/me$/, methods: ['GET'], name: 'me' },
  { path: /^\/api\/designs$/, methods: ['GET', 'POST'], name: 'designs' },
  { path: /^\/api\/designs\/([^/]+)$/, methods: ['GET', 'PUT', 'DELETE'], name: 'design', params: ['id'] },
  { path: /^\/api\/designs\/([^/]+)\/photos$/, methods: ['POST'], name: 'photoReserve', params: ['id'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)$/, methods: ['GET'], name: 'photoDownload', params: ['id', 'photoId'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)\/complete$/, methods: ['POST'], name: 'photoComplete', params: ['id', 'photoId'] },
  { path: /^\/api\/designs\/([^/]+)\/photos\/([^/]+)\/raw$/, methods: ['PUT'], name: 'photoRaw', params: ['id', 'photoId'], raw: true },
  { path: /^\/api\/shelf-proposals$/, methods: ['POST'], name: 'proposals' },
  { path: /^\/api\/admin\/challenge$/, methods: ['GET'], name: 'adminChallenge', escape: true },
  { path: /^\/api\/admin\/bootstrap$/, methods: ['POST'], name: 'adminBootstrap', escape: true },
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
    accessRequest: '../api/access/requests', accessStatus: '../api/access/status', accessChallenge: '../api/access/challenge', accessBind: '../api/access/bind',
    accessReviews: '../api/admin/access/requests', accessReview: '../api/admin/access/requests/[id]', accessApprove: '../api/admin/access/requests/[id]/approve', accessDeny: '../api/admin/access/requests/[id]/deny',
    accessEntitlements: '../api/admin/access/entitlements', accessRevoke: '../api/admin/access/entitlements/[userId]/revoke', accessRetry: '../api/admin/access/mail/[id]/retry',
    adminModelConfig: '../api/admin/model-config', adminBudget: '../api/admin/budget'
  };
  return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, require(file).createHandler(deps)]));
}
module.exports = { routes, existingHandlers };
