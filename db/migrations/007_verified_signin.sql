-- Additive, rollback-compatible. Adds nullable columns, an index and new functions only: no drops,
-- no rewrites, and no change to any existing function, policy or grant. The previous image keeps
-- working against this schema. This file is tracked in hp_migration.applied_additive (the previous
-- image reads only hp_migration.applied) and is hashed with LF line endings (see db/migrate.cjs).
SET ROLE hp_app_owner;
ALTER TABLE hp_private.access_requests
 ADD COLUMN google_issuer text CHECK (google_issuer IS NULL OR google_issuer='https://accounts.google.com'),
 ADD COLUMN google_subject text CHECK (google_subject IS NULL OR length(google_subject) BETWEEN 1 AND 255),
 ADD COLUMN last_submit_at timestamptz,
 ADD CONSTRAINT access_subject_pair CHECK ((google_issuer IS NULL)=(google_subject IS NULL));
CREATE UNIQUE INDEX access_one_open_subject ON hp_private.access_requests(google_subject) WHERE status='pending' AND google_subject IS NOT NULL;
CREATE INDEX access_subject_latest ON hp_private.access_requests(google_subject,created_at DESC) WHERE google_subject IS NOT NULL;

-- Internal: the state of a verified Google subject. Entitlement first, then the newest subject-bound
-- request, then an unclaimed email invitation approved by the owner before this flow existed.
CREATE FUNCTION hp_private.access_subject_state(p_subject text,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ent hp_private.access_entitlements; req hp_private.access_requests; inv hp_private.access_invitations;
BEGIN
 SELECT * INTO ent FROM hp_private.access_entitlements WHERE google_subject=p_subject;
 IF FOUND THEN RETURN jsonb_build_object('state',ent.status,'source','entitlement','decidedAt',ent.decision_at); END IF;
 SELECT * INTO req FROM hp_private.access_requests WHERE google_subject=p_subject ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('state',req.status,'source','request','requestId',req.id,'decidedAt',req.decided_at,'lastSubmitAt',coalesce(req.last_submit_at,req.created_at)); END IF;
 SELECT * INTO inv FROM hp_private.access_invitations WHERE email=p_email AND claimed_user IS NULL;
 IF FOUND THEN RETURN jsonb_build_object('state',inv.status,'source','invitation','requestId',inv.request_id,'decidedAt',inv.updated_at); END IF;
 RETURN jsonb_build_object('state','none','source','none');
END $$;

-- Read-only decision used by the sign-in gate before any user, account or session row exists.
CREATE FUNCTION hp_app.hp_access_signin_gate(p_issuer text,p_subject text,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_issuer IS DISTINCT FROM 'https://accounts.google.com' OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255 OR p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN jsonb_build_object('state',hp_private.access_subject_state(p_subject,p_email)->>'state');
END $$;

-- Called just before a session is created for an already admitted identity. Creates or confirms the
-- entitlement bound to the Google subject; idempotent; never revives a revoked or denied entitlement.
CREATE FUNCTION hp_app.hp_access_signin_bind(p_user uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sub text; ent hp_private.access_entitlements; st jsonb; r hp_private.access_requests;
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
 SELECT * INTO STRICT r FROM hp_private.access_requests WHERE id=(st->>'requestId')::uuid;
 INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,decision_at,provenance)
  VALUES(p_user,sub,'approved',r.decided_by,r.decided_at,CASE WHEN st->>'source'='request' THEN 'verified-request' ELSE 'verified-invitation' END);
 IF st->>'source'='invitation' THEN UPDATE hp_private.access_invitations SET claimed_user=p_user,claimed_subject=sub WHERE email=p_email AND claimed_user IS NULL; END IF;
 INSERT INTO hp_private.access_audit(actor_id,subject_user,request_id,action,revision) VALUES(r.decided_by,p_user,r.id,'signin_bound',1);
 RETURN jsonb_build_object('state','approved');
END $$;

-- Seconds a verified subject must still wait, or 0.
CREATE FUNCTION hp_private.access_wait(p_state jsonb) RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE
  WHEN p_state->>'state'='pending' AND p_state->>'source'='request' THEN greatest(0,ceil(extract(epoch FROM ((p_state->>'lastSubmitAt')::timestamptz+interval '60 seconds'-clock_timestamp()))))::integer
  WHEN p_state->>'state'='denied' AND p_state->>'source' IN ('request','entitlement') THEN greatest(0,ceil(extract(epoch FROM ((p_state->>'decidedAt')::timestamptz+interval '24 hours'-clock_timestamp()))))::integer
  ELSE 0 END
$$;

-- Status shown on the request page, always read from the database by subject.
CREATE FUNCTION hp_app.hp_access_handoff_status(p_issuer text,p_subject text,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE st jsonb;
BEGIN
 IF p_issuer IS DISTINCT FROM 'https://accounts.google.com' OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255 OR p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 st := hp_private.access_subject_state(p_subject,p_email);
 RETURN jsonb_build_object('status',st->>'state','retryAfter',hp_private.access_wait(st));
END $$;

-- One open request per Google subject; 60 s between submissions; 24 h after a denial; owner address
-- needs manual review; plus the existing global and per-address caps. The email is the Google-verified
-- address and the note stays empty. p_subject_hash is an HMAC computed by the service.
CREATE FUNCTION hp_app.hp_access_request_verified(p_issuer text,p_subject text,p_email text,p_name text,p_ip_hash text,p_subject_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE st jsonb; wait integer; rid uuid; src text;
BEGIN
 IF p_issuer IS DISTINCT FROM 'https://accounts.google.com' OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255 OR p_email IS NULL OR p_email<>lower(p_email) OR length(p_email) NOT BETWEEN 3 AND 254
    OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 120 OR p_ip_hash !~ '^[a-f0-9]{64}$' OR p_subject_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 IF p_email='jacob@appelbaums.com' THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-subject:'||p_subject,0));
 st := hp_private.access_subject_state(p_subject,p_email);
 src := st->>'source';
 IF st->>'state'='approved' THEN RETURN jsonb_build_object('status','approved'); END IF;
 IF st->>'state'='revoked' THEN RETURN jsonb_build_object('status','revoked'); END IF;
 wait := hp_private.access_wait(st);
 IF st->>'state'='pending' AND src='request' THEN
  IF wait>0 THEN RETURN jsonb_build_object('status','pending','limited',true,'retryAfter',wait); END IF;
  UPDATE hp_private.access_requests SET last_submit_at=clock_timestamp() WHERE id=(st->>'requestId')::uuid;
  RETURN jsonb_build_object('status','pending');
 END IF;
 IF st->>'state'='denied' AND src IN ('request','entitlement') AND wait>0 THEN RETURN jsonb_build_object('status','denied','limited',true,'retryAfter',wait); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-request-rate',0));
 DELETE FROM hp_private.access_rate_events WHERE created_at<clock_timestamp()-interval '2 days';
 IF (SELECT count(*) FROM hp_private.access_rate_events WHERE created_at>clock_timestamp()-interval '1 hour')>=100 OR
    (SELECT count(*) FROM hp_private.access_rate_events WHERE ip_hash=p_ip_hash AND created_at>clock_timestamp()-interval '1 hour')>=5 OR
    (SELECT count(*) FROM hp_private.access_rate_events WHERE email_hash=p_subject_hash AND created_at>clock_timestamp()-interval '1 day')>=3 THEN
  RETURN jsonb_build_object('status',coalesce(nullif(st->>'state','none'),'none'),'limited',true,'retryAfter',3600);
 END IF;
 INSERT INTO hp_private.access_rate_events(ip_hash,email_hash) VALUES(p_ip_hash,p_subject_hash);
 INSERT INTO hp_private.access_requests(name,email,note,google_issuer,google_subject,last_submit_at) VALUES(p_name,p_email,'',p_issuer,p_subject,clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id INTO rid;
 IF rid IS NULL THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 INSERT INTO hp_private.mail_outbox(event_key,request_id,kind,message_id) VALUES('request:'||rid,rid,'request','<request-'||rid||'@home.appelbaums.com>');
 RETURN jsonb_build_object('status','pending');
END $$;

REVOKE ALL ON FUNCTION hp_private.access_subject_state(text,text),hp_private.access_wait(jsonb),hp_app.hp_access_signin_gate(text,text,text),hp_app.hp_access_signin_bind(uuid,text),hp_app.hp_access_handoff_status(text,text,text),hp_app.hp_access_request_verified(text,text,text,text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA hp_app TO hp_auth_runtime;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_signin_gate(text,text,text),hp_app.hp_access_signin_bind(uuid,text) TO hp_auth_runtime;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_handoff_status(text,text,text),hp_app.hp_access_request_verified(text,text,text,text,text,text) TO hp_access_public;
RESET ROLE;
