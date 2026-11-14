-- Dashboard-only requests. Keep lock waits and each migration statement bounded;
-- operators must drain the old mail worker before applying this migration.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';
SET ROLE hp_app_owner;

-- This also intercepts the legacy request function. Decision mail is unaffected.
CREATE FUNCTION hp_private.suppress_request_mail() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.kind='request' THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hp_private.suppress_request_mail() FROM PUBLIC;
CREATE TRIGGER suppress_request_mail BEFORE INSERT ON hp_private.mail_outbox
 FOR EACH ROW EXECUTE FUNCTION hp_private.suppress_request_mail();

-- Preserve unsent historical notifications without presenting them as delivered or failed.
-- NOT VALID avoids a table scan while still enforcing the new check on writes.
ALTER TABLE hp_private.mail_outbox DROP CONSTRAINT mail_outbox_status_check,
 ADD CONSTRAINT mail_outbox_status_check CHECK(status IN ('queued','unavailable','retrying','accepted','failed','suppressed')) NOT VALID;
UPDATE hp_private.mail_outbox SET status='suppressed',revision=revision+1,error_category=NULL,lease_token=NULL,lease_until=NULL
 WHERE kind='request' AND status<>'accepted';

-- Never lease request notifications, even if a historic row becomes eligible again.
CREATE OR REPLACE FUNCTION hp_app.hp_mail_claim(p_token uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_token IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 UPDATE hp_private.mail_outbox SET status='failed',revision=revision+1,error_category='exhausted',lease_token=NULL,lease_until=NULL
  WHERE kind<>'request' AND status IN ('queued','unavailable','retrying') AND attempts>=8 AND lease_until<clock_timestamp();
 WITH chosen AS (SELECT id FROM hp_private.mail_outbox WHERE kind<>'request' AND status IN ('queued','unavailable','retrying') AND next_attempt<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY next_attempt,id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 claimed AS (UPDATE hp_private.mail_outbox m SET lease_token=p_token,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,revision=revision+1 FROM chosen c WHERE m.id=c.id AND m.attempts<8 RETURNING m.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'messageId',m.message_id,'attempts',m.attempts,'requestId',r.id,'name',r.name,'email',r.email,'note',r.note)),'[]'::jsonb) INTO result FROM claimed m JOIN hp_private.access_requests r ON r.id=m.request_id;
 RETURN result;
END $$;

-- The worker's independent guard can retire an already-leased legacy request.
CREATE OR REPLACE FUNCTION hp_app.hp_mail_finish(p_id uuid,p_token uuid,p_outcome text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m hp_private.mail_outbox; state text; category text;
BEGIN
 SELECT * INTO m FROM hp_private.mail_outbox WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF m.kind='request' THEN
  UPDATE hp_private.mail_outbox SET status='suppressed',revision=revision+1,error_category=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
  RETURN true;
 END IF;
 IF p_outcome NOT IN ('accepted','unavailable','transient','permanent') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 state := CASE WHEN p_outcome='accepted' THEN 'accepted' WHEN p_outcome='permanent' OR m.attempts>=8 THEN 'failed' WHEN p_outcome='unavailable' THEN 'unavailable' ELSE 'retrying' END;
 category := CASE WHEN state='accepted' THEN NULL WHEN m.attempts>=8 AND p_outcome<>'permanent' THEN 'exhausted' ELSE p_outcome END;
 UPDATE hp_private.mail_outbox SET status=state,revision=revision+1,error_category=category,lease_token=NULL,lease_until=NULL,
  accepted_at=CASE WHEN state='accepted' THEN clock_timestamp() ELSE NULL END,
  next_attempt=clock_timestamp()+make_interval(secs=>least(21600,30*(2^least(m.attempts-1,10))::integer)) WHERE id=p_id;
 RETURN true;
END $$;

-- Show every pending request first; limit only the less prominent decided history.
CREATE OR REPLACE FUNCTION hp_app.hp_access_review(p_subject text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM hp_private.access_admin(p_subject);
 IF p_id IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'email',r.email,'note',r.note,'status',r.status,'revision',r.revision,'createdAt',r.created_at)
    ORDER BY (r.status='pending') DESC,r.created_at DESC,r.id DESC),'[]'::jsonb) INTO result
   FROM (SELECT * FROM hp_private.access_requests WHERE status='pending'
    UNION ALL SELECT * FROM (SELECT * FROM hp_private.access_requests WHERE status<>'pending' ORDER BY created_at DESC,id DESC LIMIT 100) history) r;
 ELSE
  SELECT jsonb_build_object('id',r.id,'name',r.name,'email',r.email,'note',r.note,'status',r.status,'revision',r.revision,'createdAt',r.created_at,'mail',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'status',m.status,'revision',m.revision,'attempts',m.attempts,'errorCategory',m.error_category,'nextAttempt',m.next_attempt) ORDER BY m.created_at) FROM hp_private.mail_outbox m WHERE m.request_id=r.id AND m.kind<>'request'),'[]'::jsonb)) INTO result FROM hp_private.access_requests r WHERE r.id=p_id;
  IF result IS NULL THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 END IF;
 RETURN result;
END $$;

-- A session-bound owner indicator exposes no request data and grants no admin rights.
CREATE FUNCTION hp_app.hp_access_is_owner() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid;
BEGIN
 PERFORM hp_private.access_require_session();
 RETURN EXISTS(SELECT 1 FROM hp_private.admin_binding b JOIN hp_auth.account a ON a."userId"=b.user_id AND a."providerId"='google' AND a."accountId"=b.google_subject WHERE b.user_id=uid);
END $$;
REVOKE ALL ON FUNCTION hp_app.hp_access_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_app.hp_access_is_owner() TO hp_app_runtime;
RESET ROLE;
