# Hosting

The hosted application starts with an empty home. Local editing and backup export work without cloud configuration. Sign-in enables explicit private cloud copies and revision-checked saves. Importing an old backup does not automatically upload it. Local drafts and cloud data are separate; conflicts retain local edits.

## Build and delivery

Use Node 22 and the committed lockfile. Run npm ci, npm run build, and npm run audit:public. Serve dist for the public client. Set HOMEPLANNER_BASE_PATH only for static subpath hosting; the production domain uses /.

Prepare deployment input with scripts/prepare-hosting.mjs, supplying a new directory outside the checkout and a manifest path outside that directory. Install and build from that sanitized input. Never deploy the repository root: it contains personal seed files and photos. Git deployments are disabled. Pages uploads audited dist only and has no server API.

## Runtime configuration

Public build configuration: HOMEPLANNER_PUBLIC_SUPABASE_URL and HOMEPLANNER_PUBLIC_SUPABASE_KEY. Only a publishable key belongs in browser configuration.

Server configuration: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, APP_ORIGIN, GOOGLE_OAUTH_CLIENT_ID, ADMIN_STEP_UP_SECRET, OPENAI_API_KEY, OPENAI_CONNECTION_VERSION and OPENAI_VALIDATED_CONNECTIONS. Enter secrets through hosting secret storage, never in source or public configuration. The validation registry is an array of connectionId/version/modelId records for independently verified connections. Changing the connection version invalidates previous records.

Apply migrations in order to a dedicated project. Configure Google-only login and exact callback URLs. The app callback is /auth/callback; the provider callback comes from the new database project's Auth configuration. Admin verification additionally requires Google's verified application/session-age claim setup. The administrator is the verified Google identity configured in server/admin.js; a display email or browser flag grants no access.

Admin settings support selecting a validated model and setting a lifetime spending allowance. New configuration is disabled. The initial form allowance is USD25; saving it requires verified admin access. Usage accounting is conservative and may exceed the provider invoice. Unknown or ambiguous provider results retain their reservation; they must be reconciled before that user can issue another request. Model pricing has an expiry and requires maintenance.

## Release checks

Local tests do not establish hosted behavior. Before enabling accounts and editing, verify actual two-user Auth/RLS/Storage isolation, parallel revision/quota operations, upload/complete/delete races, Google step-up, native image processing in the Linux function package, large-photo streaming, CSP and exact model response/usage behavior. Configure the custom domain and verify TLS and OAuth on the real origin.

Photo cleanup is owner-scoped and opportunistic on reserve, completion and deletion requests. It preserves active references and uses durable claims to prevent late writes. Quota is released only after Storage API absence and database metadata checks; this is not a physical media-erasure guarantee. Failed cleanup stays charged for retry. Local photo bytes shared by snapshots are retained.

The code is implemented locally; these live release checks remain outstanding. Keep API editing disabled until they pass.
