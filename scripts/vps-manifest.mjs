// Reviewed explicit source inputs; the safety and live-acceptance gates still apply.
export const VPS_INPUTS = Object.freeze([
  'package.json', 'package-lock.json',
  'index.html', 'landing.html', 'landing.js', 'bookshelf.html', 'standalone.js', 'admin.html', 'admin.js', 'app.js', 'styles.css', 'models3d.js', 'bookshelf.js', 'bookshelf-builder.js', 'starter-data.js',
  'client/config.js', 'client/contracts-loader.js', 'client/cloud.js', 'client/ui.js',
  'scripts/build-public.mjs', 'scripts/audit-public.mjs', 'scripts/hosting-manifest.mjs', 'scripts/vps-manifest.mjs', 'scripts/prepare-hosting.mjs', 'scripts/audit-vps-context.mjs',
  'shared/vps-public-files.json', 'shared/contracts.js', 'shared/canonical.js', 'shared/schema/shelf-v1.json', 'shared/schema/shelf-document-v2.json', 'shared/schema/home-v2.json', 'shared/schema/api-v3.json', 'shared/schema/api-v4.json', 'shared/schema/vps-v1.json',
  'runtime/router.cjs', 'runtime/routes.cjs', 'runtime/node-auth.cjs', 'runtime/server.cjs', 'runtime/integrations.cjs', 'runtime/composition.cjs', 'runtime/maintenance.cjs', 'runtime/storage-safety.cjs',
  'db/migrate.cjs', 'db/migrations/001_auth.sql', 'db/migrations/002_business.sql', 'db/migrations/003_photos.sql', 'db/migrations/004_photo_maintenance.sql', 'db/migrations/005_shelf_documents.sql', 'db/migrations/006_access_requests.sql',
  'server/auth.js', 'server/auth-config.cjs', 'server/session.cjs', 'server/photo-files.cjs', 'server/photo-maintenance.cjs', 'server/designs.js', 'server/photos.js', 'server/db.js', 'server/errors.js', 'server/admin.js', 'server/model-config.js', 'server/proposals.js', 'server/limits.js',
  'server/access.cjs', 'server/mail-outbox.cjs', 'server/gmail-transport.cjs',
  'server/providers/index.js', 'server/providers/fake.js', 'server/providers/openai.js',
  'api/me.js', 'api/designs.js', 'api/designs/[id].js', 'api/designs/[id]/photos.js', 'api/designs/[id]/photos/[photoId].js', 'api/designs/[id]/photos/[photoId]/complete.js',
  'api/shelf-proposals.js', 'api/admin/challenge.js', 'api/admin/bootstrap.js', 'api/admin/budget.js', 'api/admin/model-config.js',
  'api/access/_handlers.cjs', 'api/access/requests.js', 'api/access/status.js', 'api/access/challenge.js', 'api/access/bind.js',
  'api/admin/access/requests.js', 'api/admin/access/requests/[id].js', 'api/admin/access/requests/[id]/approve.js', 'api/admin/access/requests/[id]/deny.js',
  'api/admin/access/entitlements.js', 'api/admin/access/entitlements/[userId]/revoke.js', 'api/admin/access/mail/[id]/retry.js',
  'deployment/Dockerfile', 'deployment/volume-lock.sh', 'deployment/operations-lock.sh', 'deployment/verify-restored-access.cjs'
]);
export function dockerIgnore() {
  const dirs = new Set();
  for (const name of VPS_INPUTS) {
    const parts = name.split('/'); parts.pop(); let prefix = '';
    for (const part of parts) { prefix += part + '/'; dirs.add(prefix); }
  }
  // Docker's matcher treats brackets in the route filenames as glob syntax.
  const literal = name => name.replace(/[\\*?\[\]]/g, '\\$&');
  return ['**', ...[...dirs].sort().map(d => '!' + literal(d)), ...[...VPS_INPUTS].sort().map(f => '!' + literal(f)), '!.dockerignore', ''].join('\n');
}
