-- Execute only in the isolated, quiescent restored HomePlanner database.
-- The liability ledger is deliberately left untouched.
BEGIN;
ALTER ROLE hp_auth_login NOLOGIN;
ALTER ROLE hp_app_login NOLOGIN;
ALTER ROLE hp_photo_maintenance_login NOLOGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) NOT IN (0,2)
 OR (EXISTS (SELECT 1 FROM hp_migration.applied WHERE name='006_access_requests.sql') AND
     (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('hp_access_public_login','hp_mail_worker_login')) <> 2)
 THEN RAISE EXCEPTION 'restored access roles do not match the ledger'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hp_access_public_login') THEN
   ALTER ROLE hp_access_public_login NOLOGIN;
   ALTER ROLE hp_mail_worker_login NOLOGIN;
 END IF;
 IF EXISTS (SELECT 1 FROM hp_migration.applied WHERE name='006_access_requests.sql') THEN
   DELETE FROM hp_private.access_challenges;
 END IF;
END $$;
DELETE FROM hp_private.admin_grants;
DELETE FROM hp_private.admin_challenges;
DELETE FROM hp_auth.session;
DELETE FROM hp_auth.verification;
UPDATE hp_private.model_config SET enabled=false, revision=revision+1, updated_at=clock_timestamp() WHERE singleton;
COMMIT;
