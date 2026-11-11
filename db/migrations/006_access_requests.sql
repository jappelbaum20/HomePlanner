-- Additive access foundation. Provision NOLOGIN roles hp_access_public and
-- hp_mail_worker before applying. WARNING: enforcement takes effect on commit (the replaced
-- assert_actor and the RESTRICTIVE policies on designs and photos); the owner seed below must exist.
SET ROLE hp_auth_owner;
CREATE FUNCTION hp_auth.access_revoke_sessions(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Never wait behind a protected operation while holding an entitlement or
  -- invitation lock. Roll back the entire decision and let the caller retry.
  PERFORM 1 FROM hp_auth.session WHERE "userId"=p_user FOR UPDATE NOWAIT;
  DELETE FROM hp_auth.session WHERE "userId"=p_user;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'HP_CONFLICT';
END
$$;
REVOKE ALL ON FUNCTION hp_auth.access_revoke_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_auth.access_revoke_sessions(uuid) TO hp_app_owner;
RESET ROLE;

SET ROLE hp_app_owner;
CREATE TABLE hp_private.access_requests (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 note text NOT NULL DEFAULT '' CHECK (length(note)<=1000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), decided_at timestamptz,
 decided_by uuid, CHECK ((status='pending' AND decided_at IS NULL AND decided_by IS NULL) OR
 (status<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE UNIQUE INDEX access_one_open_email ON hp_private.access_requests(email) WHERE status='pending';
CREATE TABLE hp_private.access_rate_events (ip_hash text NOT NULL CHECK(ip_hash ~ '^[a-f0-9]{64}$'), email_hash text NOT NULL CHECK(email_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX access_rate_time ON hp_private.access_rate_events(created_at);
CREATE TABLE hp_private.access_entitlements (
 user_id uuid PRIMARY KEY, google_subject text NOT NULL UNIQUE CHECK(length(google_subject) BETWEEN 1 AND 255),
 status text NOT NULL CHECK(status IN ('approved','denied','revoked')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
 decided_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), decision_at timestamptz NOT NULL DEFAULT clock_timestamp(), provenance text NOT NULL
);
CREATE TABLE hp_private.access_invitations (
 email text PRIMARY KEY, request_id uuid NOT NULL REFERENCES hp_private.access_requests(id),
 status text NOT NULL CHECK(status IN ('approved','denied')), claimed_user uuid,
 claimed_subject text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((claimed_user IS NULL) = (claimed_subject IS NULL))
);
CREATE TABLE hp_private.access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid, subject_user uuid,
 request_id uuid REFERENCES hp_private.access_requests(id), action text NOT NULL,
 revision bigint, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hp_private.access_challenges (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'), user_id uuid NOT NULL,
 session_id uuid NOT NULL, google_subject text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE hp_private.mail_outbox (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), event_key text NOT NULL UNIQUE,
 request_id uuid NOT NULL REFERENCES hp_private.access_requests(id), kind text NOT NULL CHECK(kind IN ('request','approved','denied')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','unavailable','retrying','accepted','failed')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20), next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token uuid, lease_until timestamptz, message_id text NOT NULL UNIQUE,
 error_category text CHECK(error_category IN ('unavailable','transient','permanent','exhausted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), accepted_at timestamptz,
 CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX mail_ready ON hp_private.mail_outbox(next_attempt) WHERE status IN ('queued','unavailable','retrying');

CREATE FUNCTION hp_private.access_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.google_subject IS DISTINCT FROM OLD.google_subject THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER access_identity_immutable BEFORE UPDATE ON hp_private.access_entitlements FOR EACH ROW EXECUTE FUNCTION hp_private.access_identity_immutable();
CREATE FUNCTION hp_private.access_claim_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.email IS DISTINCT FROM OLD.email OR (OLD.claimed_user IS NOT NULL AND
   (NEW.claimed_user IS DISTINCT FROM OLD.claimed_user OR NEW.claimed_subject IS DISTINCT FROM OLD.claimed_subject)) THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER access_claim_immutable BEFORE UPDATE ON hp_private.access_invitations FOR EACH ROW EXECUTE FUNCTION hp_private.access_claim_immutable();
-- Only the already verified administrator is seeded; no email matching/backfill.
INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance)
 SELECT b.user_id,b.google_subject,'approved',b.user_id,'verified-owner-binding'
 FROM hp_private.admin_binding b JOIN hp_auth.account a ON a."userId"=b.user_id AND a."providerId"='google' AND a."accountId"=b.google_subject;
INSERT INTO hp_private.access_audit(actor_id,subject_user,action,revision)
 SELECT user_id,user_id,'owner_seed',revision FROM hp_private.access_entitlements WHERE provenance='verified-owner-binding';

CREATE FUNCTION hp_private.access_require_session() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid;
BEGIN
 IF uid IS NULL OR sid IS NULL OR NOT hp_auth.lock_live_session(uid,sid) OR NOT hp_private.actor_live() THEN RAISE EXCEPTION 'HP_ACCESS_SESSION'; END IF;
END $$;
CREATE FUNCTION hp_app.hp_access_assert_session() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM hp_private.access_require_session();
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_access_assert_approved() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; st text;
BEGIN
 PERFORM hp_private.access_require_session();
 SELECT e.status INTO st FROM hp_private.access_entitlements e JOIN hp_auth.account a ON a."userId"=e.user_id AND a."providerId"='google' AND a."accountId"=e.google_subject
 WHERE e.user_id=uid FOR SHARE OF e;
 IF st IS NULL THEN RAISE EXCEPTION 'HP_ACCESS_PENDING'; END IF;
 IF st='denied' THEN RAISE EXCEPTION 'HP_ACCESS_DENIED'; END IF;
 IF st='revoked' THEN RAISE EXCEPTION 'HP_ACCESS_REVOKED'; END IF;
 RETURN true;
END $$;
-- RLS companion only. The protected transaction must also call the locking
-- assertion above; this boolean alone does not fence concurrent revocation.
CREATE FUNCTION hp_private.access_approved() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT hp_private.actor_live() AND EXISTS (
  SELECT 1 FROM hp_private.access_entitlements e JOIN hp_auth.account a
   ON a."userId"=e.user_id AND a."providerId"='google' AND a."accountId"=e.google_subject
  WHERE e.user_id::text=current_setting('hp.user_id',true) AND e.status='approved')
$$;
CREATE FUNCTION hp_app.hp_access_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; st text;
BEGIN
 PERFORM hp_private.access_require_session();
 SELECT e.status INTO st FROM hp_private.access_entitlements e JOIN hp_auth.account a ON a."userId"=e.user_id AND a."providerId"='google' AND a."accountId"=e.google_subject WHERE e.user_id=uid;
 RETURN jsonb_build_object('status',coalesce(st,'pending'),'role',CASE WHEN EXISTS(SELECT 1 FROM hp_private.admin_binding b JOIN hp_auth.account a ON a."userId"=b.user_id AND a."providerId"='google' AND a."accountId"=b.google_subject WHERE b.user_id=uid) THEN 'owner' ELSE 'user' END);
END $$;
CREATE FUNCTION hp_app.hp_access_seed_owner(p_subject text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid;
BEGIN
 PERFORM hp_private.access_require_session();
 IF NOT hp_private.admin_grant_live(p_subject) OR NOT EXISTS(SELECT 1 FROM hp_private.admin_binding b JOIN hp_auth.account a ON a."userId"=b.user_id AND a."providerId"='google' AND a."accountId"=b.google_subject WHERE b.user_id=uid AND b.google_subject=p_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES(uid,p_subject,'approved',uid,'verified-owner-binding') ON CONFLICT (user_id) DO NOTHING;
 IF FOUND THEN INSERT INTO hp_private.access_audit(actor_id,subject_user,action,revision) VALUES(uid,uid,'owner_seed',1); END IF;
 IF NOT EXISTS(SELECT 1 FROM hp_private.access_entitlements WHERE user_id=uid AND google_subject=p_subject AND status='approved') THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_access_issue_challenge(p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid; sub text;
BEGIN
 PERFORM hp_private.access_require_session();
 IF p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT a."accountId" INTO STRICT sub FROM hp_auth.account a WHERE a."userId"=uid AND a."providerId"='google';
 DELETE FROM hp_private.access_challenges WHERE expires_at<clock_timestamp()-interval '1 day';
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-challenge:'||sid::text,0));
 IF (SELECT count(*) FROM hp_private.access_challenges WHERE session_id=sid AND consumed_at IS NULL AND expires_at>clock_timestamp())>=5 THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 INSERT INTO hp_private.access_challenges VALUES(p_hash,uid,sid,sub,clock_timestamp()+interval '5 minutes',NULL);
 RETURN jsonb_build_object('subject',sub);
END $$;
-- p_email and p_subject are accepted only from the server token verifier, never
-- from JSON or profile metadata. The database verifies session/nonce/account.
CREATE FUNCTION hp_app.hp_access_bind_verified(p_hash text,p_email text,p_subject text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid; inv hp_private.access_invitations; ent hp_private.access_entitlements; decision hp_private.access_requests; deny_bound boolean := false;
BEGIN
 PERFORM hp_private.access_require_session();
 UPDATE hp_private.access_challenges SET consumed_at=clock_timestamp() WHERE nonce_hash=p_hash AND user_id=uid AND session_id=sid AND google_subject=p_subject AND consumed_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM hp_auth.account a WHERE a."userId"=uid AND a."providerId"='google' AND a."accountId"=p_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF p_email IS NULL OR p_email<>lower(p_email) OR length(p_email)>254 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-email:'||p_email,0));
 SELECT * INTO inv FROM hp_private.access_invitations WHERE email=p_email FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','pending'); END IF;
 IF inv.claimed_user IS NOT NULL AND (inv.claimed_user<>uid OR inv.claimed_subject<>p_subject) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 SELECT * INTO ent FROM hp_private.access_entitlements WHERE user_id=uid FOR UPDATE;
 IF FOUND THEN
   IF ent.google_subject<>p_subject THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
   -- A revoked entitlement is never revived by replaying a prior invitation.
   IF ent.status='revoked' THEN RETURN jsonb_build_object('status','revoked'); END IF;
   SELECT * INTO STRICT decision FROM hp_private.access_requests WHERE id=inv.request_id;
   -- Only a newly claimed, newer owner decision may reconcile another address.
   -- Replaying an older invitation must never reverse a later decision.
   IF inv.claimed_user IS NULL AND decision.decided_at>ent.decision_at AND
      NOT EXISTS(SELECT 1 FROM hp_private.admin_binding WHERE user_id=uid) THEN
     UPDATE hp_private.access_entitlements SET status=inv.status,revision=revision+1,
       decided_by=decision.decided_by,decision_at=decision.decided_at,updated_at=clock_timestamp()
       WHERE user_id=uid RETURNING * INTO ent;
     INSERT INTO hp_private.access_audit(actor_id,subject_user,request_id,action,revision)
       VALUES(decision.decided_by,uid,inv.request_id,'invitation_bound',ent.revision);
     deny_bound := inv.status='denied';
   END IF;
 ELSE
   INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,decision_at,provenance)
   SELECT uid,p_subject,inv.status,r.decided_by,r.decided_at,'verified-invitation' FROM hp_private.access_requests r WHERE r.id=inv.request_id;
   INSERT INTO hp_private.access_audit(actor_id,subject_user,request_id,action,revision) VALUES(uid,uid,inv.request_id,'invitation_bound',1);
 END IF;
 UPDATE hp_private.access_invitations SET claimed_user=uid,claimed_subject=p_subject WHERE email=p_email;
 IF deny_bound THEN
   PERFORM hp_auth.access_revoke_sessions(uid);
   RETURN jsonb_build_object('status','denied','role','user');
 END IF;
 RETURN hp_app.hp_access_status();
END $$;

CREATE FUNCTION hp_app.hp_access_request(p_name text,p_email text,p_note text,p_ip_hash text,p_email_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rid uuid;
BEGIN
 IF p_name IS NULL OR p_email IS NULL OR p_note IS NULL OR length(p_name) NOT BETWEEN 1 AND 120 OR length(p_email) NOT BETWEEN 3 AND 254 OR p_email<>lower(p_email) OR length(p_note)>1000 OR p_ip_hash !~ '^[a-f0-9]{64}$' OR p_email_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-request-rate',0));
 DELETE FROM hp_private.access_rate_events WHERE created_at<clock_timestamp()-interval '2 days';
 IF (SELECT count(*) FROM hp_private.access_rate_events WHERE created_at>clock_timestamp()-interval '1 hour')>=100 THEN RETURN true; END IF;
 IF (SELECT count(*) FROM hp_private.access_rate_events WHERE ip_hash=p_ip_hash AND created_at>clock_timestamp()-interval '1 hour')>=5 OR
    (SELECT count(*) FROM hp_private.access_rate_events WHERE email_hash=p_email_hash AND created_at>clock_timestamp()-interval '1 day')>=3 THEN RETURN true; END IF;
 INSERT INTO hp_private.access_rate_events(ip_hash,email_hash) VALUES(p_ip_hash,p_email_hash);
 INSERT INTO hp_private.access_requests(name,email,note) VALUES(p_name,p_email,p_note) ON CONFLICT (email) WHERE status='pending' DO NOTHING RETURNING id INTO rid;
 IF rid IS NOT NULL THEN
  INSERT INTO hp_private.mail_outbox(event_key,request_id,kind,message_id) VALUES('request:'||rid,rid,'request','<request-'||rid||'@home.appelbaums.com>');
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION hp_private.access_admin(p_subject text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid;
BEGIN
 PERFORM hp_private.access_require_session();
 IF NOT hp_private.admin_grant_live(p_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 RETURN uid;
END $$;
CREATE FUNCTION hp_app.hp_access_review(p_subject text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM hp_private.access_admin(p_subject);
 IF p_id IS NULL THEN
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'createdAt' DESC),'[]'::jsonb) INTO result FROM (SELECT jsonb_build_object('id',r.id,'name',r.name,'email',r.email,'status',r.status,'revision',r.revision,'createdAt',r.created_at) x FROM hp_private.access_requests r ORDER BY r.created_at DESC LIMIT 100) q;
 ELSE
  SELECT jsonb_build_object('id',r.id,'name',r.name,'email',r.email,'note',r.note,'status',r.status,'revision',r.revision,'createdAt',r.created_at,'mail',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'status',m.status,'revision',m.revision,'attempts',m.attempts,'errorCategory',m.error_category,'nextAttempt',m.next_attempt) ORDER BY m.created_at) FROM hp_private.mail_outbox m WHERE m.request_id=r.id),'[]'::jsonb)) INTO result FROM hp_private.access_requests r WHERE r.id=p_id;
  IF result IS NULL THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION hp_app.hp_access_entitlements(p_subject text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM hp_private.access_admin(p_subject);
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'userId'),'[]'::jsonb) INTO result FROM
  (SELECT jsonb_build_object('userId',user_id,'status',status,'revision',revision,'updatedAt',updated_at) x FROM hp_private.access_entitlements ORDER BY user_id LIMIT 100) q;
 RETURN result;
END $$;
CREATE FUNCTION hp_app.hp_access_decide(p_subject text,p_id uuid,p_revision bigint,p_decision text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; r hp_private.access_requests; inv hp_private.access_invitations; ent hp_private.access_entitlements; decision_time timestamptz;
BEGIN
 actor := hp_private.access_admin(p_subject);
 IF p_decision IS NULL OR p_decision NOT IN ('approved','denied') OR p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT * INTO r FROM hp_private.access_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF r.revision<>p_revision OR r.status<>'pending' THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 IF r.email='jacob@appelbaums.com' AND p_decision='denied' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-email:'||r.email,0));
 SELECT * INTO inv FROM hp_private.access_invitations WHERE email=r.email FOR UPDATE;
 IF FOUND AND inv.claimed_user IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM hp_private.admin_binding WHERE user_id=inv.claimed_user) AND p_decision='denied' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
  SELECT * INTO ent FROM hp_private.access_entitlements WHERE user_id=inv.claimed_user FOR UPDATE;
  IF NOT FOUND OR ent.google_subject<>inv.claimed_subject THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
  decision_time := clock_timestamp();
  UPDATE hp_private.access_entitlements SET status=p_decision,revision=revision+1,decided_by=actor,decision_at=decision_time,updated_at=clock_timestamp() WHERE user_id=inv.claimed_user;
  IF p_decision='denied' THEN PERFORM hp_auth.access_revoke_sessions(inv.claimed_user); END IF;
 END IF;
 decision_time := coalesce(decision_time,clock_timestamp());
 UPDATE hp_private.access_requests SET status=p_decision,revision=revision+1,decided_at=decision_time,decided_by=actor WHERE id=p_id RETURNING * INTO r;
 INSERT INTO hp_private.access_invitations(email,request_id,status) VALUES(r.email,r.id,p_decision)
  ON CONFLICT(email) DO UPDATE SET request_id=EXCLUDED.request_id,status=EXCLUDED.status,updated_at=clock_timestamp();
 INSERT INTO hp_private.access_audit(actor_id,subject_user,request_id,action,revision) VALUES(actor,inv.claimed_user,r.id,p_decision,r.revision);
 INSERT INTO hp_private.mail_outbox(event_key,request_id,kind,message_id) VALUES('decision:'||r.id||':'||r.revision,r.id,p_decision,'<decision-'||r.id||'-'||r.revision||'@home.appelbaums.com>');
 RETURN jsonb_build_object('id',r.id,'status',r.status,'revision',r.revision);
END $$;
CREATE FUNCTION hp_app.hp_access_revoke(p_subject text,p_user uuid,p_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; ent hp_private.access_entitlements;
BEGIN
 actor := hp_private.access_admin(p_subject);
 IF p_user IS NULL OR p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 IF p_user=actor OR EXISTS(SELECT 1 FROM hp_private.admin_binding WHERE user_id=p_user) THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT * INTO ent FROM hp_private.access_entitlements WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF ent.revision<>p_revision OR ent.status<>'approved' THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 UPDATE hp_private.access_entitlements SET status='revoked',revision=revision+1,decided_by=actor,decision_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=p_user RETURNING * INTO ent;
 PERFORM hp_auth.access_revoke_sessions(p_user);
 INSERT INTO hp_private.access_audit(actor_id,subject_user,action,revision) VALUES(actor,p_user,'revoked',ent.revision);
 RETURN jsonb_build_object('status',ent.status,'revision',ent.revision);
END $$;

CREATE FUNCTION hp_app.hp_mail_claim(p_token uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_token IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 UPDATE hp_private.mail_outbox SET status='failed',revision=revision+1,error_category='exhausted',lease_token=NULL,lease_until=NULL
  WHERE status IN ('queued','unavailable','retrying') AND attempts>=8 AND lease_until<clock_timestamp();
 WITH chosen AS (SELECT id FROM hp_private.mail_outbox WHERE status IN ('queued','unavailable','retrying') AND next_attempt<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY next_attempt,id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 claimed AS (UPDATE hp_private.mail_outbox m SET lease_token=p_token,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,revision=revision+1 FROM chosen c WHERE m.id=c.id AND m.attempts<8 RETURNING m.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'messageId',m.message_id,'attempts',m.attempts,'requestId',r.id,'name',r.name,'email',r.email,'note',r.note)),'[]'::jsonb) INTO result FROM claimed m JOIN hp_private.access_requests r ON r.id=m.request_id;
 RETURN result;
END $$;
CREATE FUNCTION hp_app.hp_mail_finish(p_id uuid,p_token uuid,p_outcome text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m hp_private.mail_outbox; state text; category text;
BEGIN
 SELECT * INTO m FROM hp_private.mail_outbox WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_outcome NOT IN ('accepted','unavailable','transient','permanent') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 state := CASE WHEN p_outcome='accepted' THEN 'accepted' WHEN p_outcome='permanent' OR m.attempts>=8 THEN 'failed' WHEN p_outcome='unavailable' THEN 'unavailable' ELSE 'retrying' END;
 category := CASE WHEN state='accepted' THEN NULL WHEN m.attempts>=8 AND p_outcome<>'permanent' THEN 'exhausted' ELSE p_outcome END;
 UPDATE hp_private.mail_outbox SET status=state,revision=revision+1,error_category=category,lease_token=NULL,lease_until=NULL,
  accepted_at=CASE WHEN state='accepted' THEN clock_timestamp() ELSE NULL END,
  next_attempt=clock_timestamp()+make_interval(secs=>least(21600,30*(2^least(m.attempts-1,10))::integer)) WHERE id=p_id;
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_mail_retry(p_subject text,p_id uuid,p_revision bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
 actor:=hp_private.access_admin(p_subject);
 UPDATE hp_private.mail_outbox SET status='queued',revision=revision+1,attempts=0,next_attempt=clock_timestamp(),error_category=NULL WHERE id=p_id AND revision=p_revision AND status='failed' AND lease_token IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 INSERT INTO hp_private.access_audit(actor_id,request_id,action) SELECT actor,request_id,'mail_retry' FROM hp_private.mail_outbox WHERE id=p_id;
 RETURN true;
END $$;
REVOKE ALL ON hp_private.access_requests,hp_private.access_rate_events,hp_private.access_entitlements,hp_private.access_invitations,hp_private.access_audit,hp_private.access_challenges,hp_private.mail_outbox FROM PUBLIC,hp_app_runtime,hp_access_public,hp_mail_worker;
REVOKE ALL ON FUNCTION hp_app.hp_access_assert_session(),hp_app.hp_access_assert_approved(),hp_app.hp_access_status(),hp_app.hp_access_seed_owner(text),hp_app.hp_access_issue_challenge(text),hp_app.hp_access_bind_verified(text,text,text),hp_app.hp_access_request(text,text,text,text,text),hp_app.hp_access_review(text,uuid),hp_app.hp_access_entitlements(text),hp_app.hp_access_decide(text,uuid,bigint,text),hp_app.hp_access_revoke(text,uuid,bigint),hp_app.hp_mail_claim(uuid,integer),hp_app.hp_mail_finish(uuid,uuid,text),hp_app.hp_mail_retry(text,uuid,bigint),hp_private.access_admin(text),hp_private.access_require_session(),hp_private.access_approved(),hp_private.access_identity_immutable(),hp_private.access_claim_immutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_assert_session(),hp_app.hp_access_assert_approved(),hp_app.hp_access_status(),hp_app.hp_access_seed_owner(text),hp_app.hp_access_issue_challenge(text),hp_app.hp_access_bind_verified(text,text,text),hp_app.hp_access_review(text,uuid),hp_app.hp_access_entitlements(text),hp_app.hp_access_decide(text,uuid,bigint,text),hp_app.hp_access_revoke(text,uuid,bigint),hp_app.hp_mail_retry(text,uuid,bigint),hp_private.access_approved() TO hp_app_runtime;
GRANT USAGE ON SCHEMA hp_app TO hp_access_public,hp_mail_worker;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_request(text,text,text,text,text) TO hp_access_public;
GRANT EXECUTE ON FUNCTION hp_app.hp_mail_claim(uuid,integer),hp_app.hp_mail_finish(uuid,uuid,text) TO hp_mail_worker;
-- Existing owner isolation remains permissive; these conditions restrict it.
CREATE POLICY access_design_read ON hp_app.designs AS RESTRICTIVE FOR SELECT TO hp_app_runtime USING (hp_private.access_approved());
CREATE POLICY access_photo_read ON hp_app.design_photos AS RESTRICTIVE FOR SELECT TO hp_app_runtime USING (hp_private.access_approved());
-- Database RPCs enforce approval too; only identity bootstrap retains session-only access.
CREATE FUNCTION hp_private.assert_session_actor(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id::text IS DISTINCT FROM current_setting('hp.user_id',true) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  IF NOT hp_auth.lock_live_session(p_user_id,nullif(current_setting('hp.session_id',true),'')::uuid) OR NOT hp_private.actor_live() THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_google_subjects() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM hp_private.assert_session_actor(nullif(current_setting('hp.user_id',true),'')::uuid);
  RETURN (SELECT coalesce(jsonb_agg(a."accountId"),'[]'::jsonb) FROM hp_auth.account a WHERE a."userId"::text=current_setting('hp.user_id',true) AND a."providerId"='google');
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_admin_challenge_issue(p_nonce_hash text,p_google_subject text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid;
BEGIN
  PERFORM hp_private.assert_session_actor(uid);
  IF p_nonce_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS (SELECT 1 FROM hp_auth.account a WHERE a."userId"=uid AND a."providerId"='google' AND a."accountId"=p_google_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  INSERT INTO hp_private.admin_challenges VALUES(p_nonce_hash,uid,sid,p_google_subject,clock_timestamp()+interval '5 minutes',NULL);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_admin_verify(p_nonce_hash text,p_google_subject text,p_grant_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid; b hp_private.admin_binding; rev bigint;
BEGIN
  PERFORM hp_private.assert_session_actor(uid);
  IF p_grant_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-bootstrap',0));
  UPDATE hp_private.admin_challenges SET consumed_at=clock_timestamp() WHERE nonce_hash=p_nonce_hash AND user_id=uid AND session_id=sid AND google_subject=p_google_subject AND consumed_at IS NULL AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM hp_auth.account a WHERE a."userId"=uid AND a."providerId"='google' AND a."accountId"=p_google_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  SELECT * INTO b FROM hp_private.admin_binding WHERE singleton FOR UPDATE;
  IF FOUND THEN
    IF b.user_id<>uid OR b.google_subject<>p_google_subject THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  ELSE
    INSERT INTO hp_private.admin_binding(singleton,user_id,google_subject) VALUES(true,uid,p_google_subject);
    SELECT revision INTO rev FROM hp_private.model_config WHERE singleton;
    INSERT INTO hp_private.admin_audit(actor_id,action,config_revision) VALUES(uid,'admin_bootstrap',rev);
  END IF;
  INSERT INTO hp_private.admin_grants VALUES(p_grant_hash,uid,sid,p_google_subject,clock_timestamp()+interval '10 minutes');
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_admin_grant(p_grant_hash text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject text; uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid;
BEGIN
  PERFORM hp_private.assert_session_actor(uid);
  SELECT g.google_subject INTO subject FROM hp_private.admin_grants g JOIN hp_private.admin_binding b ON b.singleton AND b.user_id=g.user_id AND b.google_subject=g.google_subject
  WHERE g.grant_hash=p_grant_hash AND g.user_id=uid AND g.session_id::text=current_setting('hp.session_id',true) AND g.expires_at>clock_timestamp();
  RETURN subject;
END $$;
CREATE OR REPLACE FUNCTION hp_private.assert_actor(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM hp_private.assert_session_actor(p_user_id);
 PERFORM hp_app.hp_access_assert_approved();
END $$;
REVOKE ALL ON FUNCTION hp_private.assert_session_actor(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION hp_app.hp_model_config_get() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM hp_private.assert_actor(nullif(current_setting('hp.user_id',true),'')::uuid);
 RETURN (SELECT jsonb_build_object('revision',revision,'enabled',enabled,'adapterId',adapter_id,'modelId',model_id,
   'connectionRef',connection_ref,'limits',limits,'globalBudgetMicros',global_budget_micros)
   FROM hp_private.model_config WHERE singleton);
END $$;
-- Runtime SQL is a trusted backend boundary: identity/bootstrap functions accept
-- identity claims only after the HTTP service verifies the external token.
-- Approval guards on business RPCs do not sandbox a compromised backend role.
RESET ROLE;
