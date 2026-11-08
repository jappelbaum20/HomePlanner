// Complete, reviewed build input. Never copy unlisted checkout files.
export const HOSTING_INPUTS = Object.freeze([
  '.vercelignore', 'vercel.json', 'package.json', 'package-lock.json',
  'index.html', 'admin.html', 'admin.js', 'app.js', 'styles.css', 'models3d.js', 'bookshelf.js', 'bookshelf-builder.js', 'starter-data.js',
  'client/config.js', 'client/contracts-loader.js', 'client/cloud.js', 'client/ui.js',
  'scripts/build-public.mjs', 'scripts/audit-public.mjs', 'scripts/hosting-manifest.mjs', 'scripts/vps-manifest.mjs', 'scripts/prepare-hosting.mjs',
  'shared/contracts.js', 'shared/canonical.js', 'shared/vps-public-files.json', 'shared/schema/shelf-v1.json', 'shared/schema/home-v2.json', 'shared/schema/api-v3.json', 'shared/schema/vps-v1.json',
  'server/auth.js', 'server/designs.js', 'server/photos.js', 'server/db.js', 'server/errors.js', 'server/admin.js', 'server/model-config.js', 'server/proposals.js', 'server/limits.js',
  'server/providers/index.js', 'server/providers/fake.js', 'server/providers/openai.js',
  'api/me.js', 'api/designs.js', 'api/designs/[id].js', 'api/designs/[id]/photos.js', 'api/designs/[id]/photos/[photoId].js', 'api/designs/[id]/photos/[photoId]/complete.js',
  'api/shelf-proposals.js', 'api/admin/challenge.js', 'api/admin/bootstrap.js', 'api/admin/budget.js', 'api/admin/model-config.js'
]);
