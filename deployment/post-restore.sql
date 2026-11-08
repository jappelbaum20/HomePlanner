-- Execute only in the isolated, quiescent restored HomePlanner database.
-- The liability ledger is deliberately left untouched.
BEGIN;
ALTER ROLE hp_auth_login NOLOGIN;
ALTER ROLE hp_app_login NOLOGIN;
ALTER ROLE hp_photo_maintenance_login NOLOGIN;
DELETE FROM hp_private.admin_grants;
DELETE FROM hp_private.admin_challenges;
DELETE FROM hp_auth.session;
DELETE FROM hp_auth.verification;
UPDATE hp_private.model_config SET enabled=false, revision=revision+1, updated_at=clock_timestamp() WHERE singleton;
COMMIT;
