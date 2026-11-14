-- Add a person: the verified administrator can pre-approve an email address without a request.
-- Adds one table, one nullable audit column and three admin functions. Two existing internal
-- functions are replaced (access_subject_state, hp_access_signin_bind) and behave exactly as before
-- for every case that does not involve a pre-approved address. Bounded lock and statement times so
-- the migration fails instead of waiting. Tracked in hp_migration.applied_additive (LF-hashed).
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';
-- The add function must recognise an existing account by its address: read-only access to two columns.
SET ROLE hp_auth_owner;
GRANT SELECT (id,email) ON hp_auth."user" TO hp_app_owner;
RESET ROLE;

SET ROLE hp_app_owner;

CREATE TABLE hp_private.access_added (
 email text PRIMARY KEY CHECK (length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 added_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claimed_user uuid, claimed_subject text, CHECK ((claimed_user IS NULL) = (claimed_subject IS NULL))
);
REVOKE ALL ON hp_private.access_added FROM PUBLIC,hp_app_runtime,hp_access_public,hp_mail_worker,hp_auth_runtime,hp_photo_maintenance;
CREATE TRIGGER access_added_claim_immutable BEFORE UPDATE ON hp_private.access_added FOR EACH ROW EXECUTE FUNCTION hp_private.access_claim_immutable();
ALTER TABLE hp_private.access_audit ADD COLUMN target_email text CHECK (target_email IS NULL OR length(target_email) BETWEEN 3 AND 254);

-- Same as 007, plus: a pre-approved, unclaimed address wins over a request but never over an entitlement.
CREATE OR REPLACE FUNCTION hp_private.access_subject_state(p_subject text,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ent hp_private.access_entitlements; req hp_private.access_requests; inv hp_private.access_invitations; added hp_private.access_added;
BEGIN
 SELECT * INTO ent FROM hp_private.access_entitlements WHERE google_subject=p_subject;
 IF FOUND THEN RETURN jsonb_build_object('state',ent.status,'source','entitlement','decidedAt',ent.decision_at); END IF;
 SELECT * INTO added FROM hp_private.access_added WHERE email=p_email AND claimed_user IS NULL;
 IF FOUND THEN RETURN jsonb_build_object('state','approved','source','added','decidedAt',added.created_at); END IF;
 SELECT * INTO req FROM hp_private.access_requests WHERE google_subject=p_subject ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('state',req.status,'source','request','requestId',req.id,'decidedAt',req.decided_at,'lastSubmitAt',coalesce(req.last_submit_at,req.created_at)); END IF;
 SELECT i.* INTO inv FROM hp_private.access_invitations i WHERE i.email=p_email AND i.claimed_user IS NULL
  AND NOT EXISTS(SELECT 1 FROM hp_private.access_requests q WHERE q.id=i.request_id AND q.google_subject IS NOT NULL);
 IF FOUND THEN RETURN jsonb_build_object('state',inv.status,'source','invitation','requestId',inv.request_id,'decidedAt',inv.updated_at); END IF;
 RETURN jsonb_build_object('state','none','source','none');
END $$;

-- Same as 007, plus the pre-approved address branch (claims the address once, creates a normal entitlement).
CREATE OR REPLACE FUNCTION hp_app.hp_access_signin_bind(p_user uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sub text; ent hp_private.access_entitlements; st jsonb; r hp_private.access_requests; ad hp_private.access_added;
BEGIN
 IF p_user IS NULL OR p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT a."accountId" INTO sub FROM hp_auth.account a WHERE a."userId"=p_user AND a."providerId"='google';
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-subject:'||sub,0));
 SELECT * INTO ent FROM hp_private.access_entitlements WHERE user_id=p_user FOR UPDATE;
 IF FOUND THEN
  IF ent.google_subject<>sub THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
  RETURN jsonb_build_object('state',ent.status);
 END IF;
 IF EXISTS(SELECT 1 FROM hp_private.access_entitlements WHERE google_subject=sub) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 st := hp_private.access_subject_state(sub,p_email);
 IF st->>'state' IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('state',st->>'state'); END IF;
 IF st->>'source'='added' THEN
  SELECT * INTO ad FROM hp_private.access_added WHERE email=p_email AND claimed_user IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
  INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,decision_at,provenance)
   VALUES(p_user,sub,'approved',ad.added_by,ad.created_at,'verified-added');
  UPDATE hp_private.access_added SET claimed_user=p_user,claimed_subject=sub WHERE email=p_email AND claimed_user IS NULL;
  INSERT INTO hp_private.access_audit(actor_id,subject_user,action,revision,target_email) VALUES(ad.added_by,p_user,'signin_bound',1,p_email);
  RETURN jsonb_build_object('state','approved');
 END IF;
 SELECT * INTO STRICT r FROM hp_private.access_requests WHERE id=(st->>'requestId')::uuid;
 INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,decision_at,provenance)
  VALUES(p_user,sub,'approved',r.decided_by,r.decided_at,CASE WHEN st->>'source'='request' THEN 'verified-request' ELSE 'verified-invitation' END);
 UPDATE hp_private.access_invitations SET claimed_user=p_user,claimed_subject=sub WHERE email=p_email AND claimed_user IS NULL AND request_id=r.id;
 INSERT INTO hp_private.access_audit(actor_id,subject_user,request_id,action,revision) VALUES(r.decided_by,p_user,r.id,'signin_bound',1);
 RETURN jsonb_build_object('state','approved');
END $$;

-- Result is one of: has_access, already_added, pending_request (+requestId), blocked (+state denied|revoked),
-- reinstated (override of an existing denied/revoked account), added. Never creates or changes an owner.
CREATE FUNCTION hp_app.hp_access_add(p_subject text,p_email text,p_override boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; rid uuid; blocked text; ov boolean := coalesce(p_override,false); reinstated integer;
BEGIN
 actor := hp_private.access_admin(p_subject);
 IF p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-email:'||p_email,0));
 IF EXISTS(SELECT 1 FROM hp_private.access_entitlements e JOIN hp_auth."user" u ON u.id=e.user_id WHERE lower(u.email)=p_email AND e.status='approved')
    OR EXISTS(SELECT 1 FROM hp_private.access_invitations i WHERE i.email=p_email AND i.status='approved' AND i.claimed_user IS NULL) THEN
  RETURN jsonb_build_object('result','has_access');
 END IF;
 IF EXISTS(SELECT 1 FROM hp_private.access_added WHERE email=p_email AND claimed_user IS NULL) THEN RETURN jsonb_build_object('result','already_added'); END IF;
 SELECT id INTO rid FROM hp_private.access_requests WHERE email=p_email AND status='pending' LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('result','pending_request','requestId',rid); END IF;
 SELECT e.status INTO blocked FROM hp_private.access_entitlements e JOIN hp_auth."user" u ON u.id=e.user_id WHERE lower(u.email)=p_email AND e.status<>'approved' ORDER BY e.updated_at DESC LIMIT 1;
 IF blocked IS NULL AND EXISTS(SELECT 1 FROM hp_private.access_invitations i WHERE i.email=p_email AND i.status='denied') THEN blocked := 'denied'; END IF;
 IF blocked IS NOT NULL AND NOT ov THEN RETURN jsonb_build_object('result','blocked','state',blocked); END IF;
 IF blocked IS NOT NULL THEN
  UPDATE hp_private.access_entitlements e SET status='approved',revision=e.revision+1,decided_by=actor,decision_at=clock_timestamp(),updated_at=clock_timestamp()
   FROM hp_auth."user" u WHERE u.id=e.user_id AND lower(u.email)=p_email AND e.status<>'approved';
  GET DIAGNOSTICS reinstated = ROW_COUNT;
  IF reinstated>0 THEN
   INSERT INTO hp_private.access_audit(actor_id,action,target_email) VALUES(actor,'added_override',p_email);
   RETURN jsonb_build_object('result','reinstated');
  END IF;
 END IF;
 INSERT INTO hp_private.access_added(email,added_by) VALUES(p_email,actor) ON CONFLICT DO NOTHING;
 INSERT INTO hp_private.access_audit(actor_id,action,target_email) VALUES(actor,CASE WHEN blocked IS NOT NULL THEN 'added_override' ELSE 'added' END,p_email);
 RETURN jsonb_build_object('result','added');
END $$;

CREATE FUNCTION hp_app.hp_access_added_list(p_subject text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM hp_private.access_admin(p_subject);
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'addedAt' DESC),'[]'::jsonb) INTO result FROM
  (SELECT jsonb_build_object('email',email,'addedAt',created_at) x FROM hp_private.access_added WHERE claimed_user IS NULL ORDER BY created_at DESC LIMIT 100) q;
 RETURN result;
END $$;

CREATE FUNCTION hp_app.hp_access_added_remove(p_subject text,p_email text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
 actor := hp_private.access_admin(p_subject);
 IF p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-email:'||p_email,0));
 DELETE FROM hp_private.access_added WHERE email=p_email AND claimed_user IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 INSERT INTO hp_private.access_audit(actor_id,action,target_email) VALUES(actor,'added_removed',p_email);
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION hp_app.hp_access_add(text,text,boolean),hp_app.hp_access_added_list(text),hp_app.hp_access_added_remove(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_add(text,text,boolean),hp_app.hp_access_added_list(text),hp_app.hp_access_added_remove(text,text) TO hp_app_runtime;
RESET ROLE;
