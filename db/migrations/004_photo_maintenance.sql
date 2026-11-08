-- Separate, restricted maintenance boundary. No live session is created.
SET ROLE hp_app_owner;
CREATE OR REPLACE FUNCTION hp_app.hp_photo_lock(p_design_id uuid,p_photo_id uuid,p_operation text,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=nullif(current_setting('hp.user_id',true),'')::uuid; d hp_app.designs; p hp_app.design_photos; w hp_private.photo_work;
BEGIN
 PERFORM hp_private.assert_actor(uid);
 SELECT * INTO d FROM hp_app.designs WHERE id=p_design_id AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO p FROM hp_app.design_photos WHERE id=p_photo_id AND design_id=p_design_id AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
 IF p_operation='raw' THEN
  IF d.deleted_at IS NOT NULL OR p.tombstoned_at IS NOT NULL OR p.status<>'pending' OR p.expires_at<=clock_timestamp() OR w.photo_id IS NOT NULL OR p.reservation_session_id::text IS DISTINCT FROM current_setting('hp.session_id',true) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSIF p_operation='ready' THEN
  IF d.deleted_at IS NOT NULL OR p.tombstoned_at IS NOT NULL OR p.status<>'pending' OR p.expires_at<=clock_timestamp() OR w.mode IS DISTINCT FROM 'completing' OR w.token IS DISTINCT FROM p_token OR w.lease_until<=clock_timestamp() OR p.reservation_session_id::text IS DISTINCT FROM current_setting('hp.session_id',true) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSIF p_operation='cleanup' THEN
  IF w.mode IS NULL OR w.mode NOT IN ('raw','delete') OR w.token IS DISTINCT FROM p_token OR w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSE RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN jsonb_build_object('photoId',p.id,'designId',p.design_id,'ownerId',p.owner_id,'status',p.status,'rawKey',p.raw_key,
  'readyKey',p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready','requestedMime',p.requested_mime,
  'requestedBytes',p.requested_bytes,'requestedChecksum',p.requested_checksum,'expiresAt',p.expires_at,'mode',w.mode);
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_begin_photo_completion(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hp_app.design_photos; w hp_private.photo_work;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 PERFORM 1 FROM hp_app.designs WHERE id=p_design_id AND owner_id=p_user_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO p FROM hp_app.design_photos WHERE id=p_photo_id AND design_id=p_design_id AND owner_id=p_user_id AND tombstoned_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF p.reservation_session_id::text IS DISTINCT FROM current_setting('hp.session_id',true) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 IF p.status='ready' THEN RETURN jsonb_build_object('id',p.id,'status',p.status,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum); END IF;
 IF p_token IS NULL OR p.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM hp_private.photo_receipts WHERE photo_id=p.id AND part='raw' AND state='published') THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
 IF FOUND AND (w.mode<>'completing' OR w.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 INSERT INTO hp_private.photo_work(photo_id,mode,token,lease_until) VALUES(p.id,'completing',p_token,clock_timestamp()+interval '5 minutes') ON CONFLICT(photo_id) DO UPDATE SET mode='completing',token=excluded.token,lease_until=excluded.lease_until;
 RETURN jsonb_build_object('id',p.id,'status',p.status,'raw_key',p.raw_key,'requested_mime',p.requested_mime,'requested_bytes',p.requested_bytes,'requested_checksum',p.requested_checksum);
END $$;
CREATE FUNCTION hp_private.claim_photo_cleanup(p_user_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; d hp_app.designs; p hp_app.design_photos; w hp_private.photo_work; new_mode text;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
 FOR candidate IN SELECT x.id,x.design_id FROM hp_app.design_photos x JOIN hp_app.designs y ON y.id=x.design_id AND y.owner_id=x.owner_id LEFT JOIN hp_private.photo_work q ON q.photo_id=x.id
   WHERE x.owner_id=p_user_id AND x.tombstoned_at IS NULL AND (q.photo_id IS NULL OR q.lease_until<=clock_timestamp())
   AND (q.mode IN ('raw','delete') OR (x.status='pending' AND (y.deleted_at IS NOT NULL OR x.expires_at+interval '1 hour'<=clock_timestamp())) OR
     (x.status='ready' AND (y.deleted_at IS NOT NULL OR x.raw_removed_at IS NULL OR (x.ready_at+interval '24 hours'<=clock_timestamp() AND NOT x.id=ANY(y.photo_ids))))) ORDER BY x.created_at,x.id LIMIT 32
 LOOP
  SELECT * INTO d FROM hp_app.designs WHERE id=candidate.design_id AND owner_id=p_user_id FOR UPDATE;
  SELECT * INTO p FROM hp_app.design_photos WHERE id=candidate.id AND owner_id=p_user_id FOR UPDATE;
  SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
  IF w.photo_id IS NOT NULL AND w.lease_until>clock_timestamp() THEN CONTINUE; END IF;
  IF w.mode IN ('raw','delete') THEN new_mode:=w.mode;
  ELSIF p.status='pending' AND (d.deleted_at IS NOT NULL OR p.expires_at+interval '1 hour'<=clock_timestamp()) THEN new_mode:='delete';
  ELSIF p.status='ready' AND (d.deleted_at IS NOT NULL OR (p.ready_at+interval '24 hours'<=clock_timestamp() AND NOT p.id=ANY(d.photo_ids))) THEN new_mode:='delete';
  ELSIF p.status='ready' AND p.raw_removed_at IS NULL THEN new_mode:='raw';
  ELSE CONTINUE; END IF;
  INSERT INTO hp_private.photo_work(photo_id,mode,token,lease_until) VALUES(p.id,new_mode,p_token,clock_timestamp()+interval '5 minutes')
   ON CONFLICT(photo_id) DO UPDATE SET mode=excluded.mode,token=excluded.token,lease_until=excluded.lease_until
   RETURNING * INTO w;
  RETURN jsonb_build_object('photoId',p.id,'designId',p.design_id,'mode',w.mode,'rawKey',p.raw_key,
    'readyKey',p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready','rawRequired',true,'readyRequired',w.mode='delete',
    'rawVerified',w.raw_removed,'readyVerified',w.ready_removed);
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION hp_app.hp_claim_photo_cleanup(p_user_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 RETURN hp_private.claim_photo_cleanup(p_user_id,p_token);
END $$;
CREATE FUNCTION hp_app.hp_maintenance_lock(p_user_id uuid,p_design_id uuid,p_token uuid,p_photo_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=p_user_id; d hp_app.designs; p hp_app.design_photos; w hp_private.photo_work;
BEGIN
 SELECT * INTO d FROM hp_app.designs WHERE id=p_design_id AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO p FROM hp_app.design_photos WHERE id=p_photo_id AND design_id=p_design_id AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
 IF w.mode IS NULL OR w.mode NOT IN ('raw','delete') OR w.token IS DISTINCT FROM p_token OR w.lease_until<=clock_timestamp() OR p.tombstoned_at IS NOT NULL THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 RETURN jsonb_build_object('photoId',p.id,'designId',p.design_id,'ownerId',p.owner_id,'rawKey',p.raw_key,
  'readyKey',p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready','mode',w.mode);
END $$;
CREATE FUNCTION hp_app.hp_maintenance_record_removal(p_user_id uuid,p_photo_id uuid,p_token uuid,p_part text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; w hp_private.photo_work; snap jsonb;
BEGIN
 SELECT design_id INTO pid FROM hp_app.design_photos WHERE id=p_photo_id AND owner_id=p_user_id;
 IF pid IS NULL OR p_part NOT IN ('raw','ready') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 snap:=hp_app.hp_maintenance_lock(p_user_id,pid,p_token,p_photo_id);
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p_photo_id;
 IF p_part='ready' AND w.mode<>'delete' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 INSERT INTO hp_private.photo_receipts(photo_id,part,state,bytes,checksum) VALUES(p_photo_id,p_part,'removed',NULL,NULL)
 ON CONFLICT(photo_id,part) DO UPDATE SET state='removed',bytes=NULL,checksum=NULL,recorded_at=clock_timestamp();
 IF p_part='raw' THEN UPDATE hp_private.photo_work SET raw_removed=true WHERE photo_id=p_photo_id;
 ELSE UPDATE hp_private.photo_work SET ready_removed=true WHERE photo_id=p_photo_id; END IF;
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_maintenance_finish_cleanup(p_user_id uuid,p_photo_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; w hp_private.photo_work; snap jsonb; before_bytes bigint; after_bytes bigint;
BEGIN
 SELECT design_id INTO pid FROM hp_app.design_photos WHERE id=p_photo_id AND owner_id=p_user_id;
 IF pid IS NULL THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 snap:=hp_app.hp_maintenance_lock(p_user_id,pid,p_token,p_photo_id);
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p_photo_id FOR UPDATE;
 IF NOT w.raw_removed OR (w.mode='delete' AND NOT w.ready_removed) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 SELECT allocation_bytes INTO before_bytes FROM hp_app.design_photos WHERE id=p_photo_id FOR UPDATE;
 IF w.mode='raw' THEN
  UPDATE hp_app.design_photos SET raw_removed_at=clock_timestamp(), allocation_bytes=bytes WHERE id=p_photo_id RETURNING allocation_bytes INTO after_bytes;
  DELETE FROM hp_private.photo_work WHERE photo_id=p_photo_id;
 ELSE
  -- The serving namespace was fenced and both parts were verified absent.
  -- The filesystem adapter separately charges staging and quarantine bytes.
  UPDATE hp_app.design_photos SET tombstoned_at=clock_timestamp(),allocation_bytes=0 WHERE id=p_photo_id RETURNING allocation_bytes INTO after_bytes;
 END IF;
 RETURN jsonb_build_object('photoId',p_photo_id,'mode',w.mode,'logicalReleasedBytes',before_bytes-after_bytes,'logicalRemainingBytes',after_bytes);
END $$;

-- Permanent identity fences prevent a later reservation from adopting a rowless object.
CREATE TABLE hp_private.photo_orphan_fences (photo_id uuid PRIMARY KEY, owner_id uuid NOT NULL, design_id uuid NOT NULL, fenced_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION hp_private.guard_orphan_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM hp_private.photo_orphan_fences WHERE photo_id=NEW.id) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_orphan_fence BEFORE INSERT ON hp_app.design_photos FOR EACH ROW EXECUTE FUNCTION hp_private.guard_orphan_fence();

CREATE FUNCTION hp_app.hp_maintenance_owners(p_after uuid,p_limit integer) RETURNS TABLE(owner_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN QUERY SELECT DISTINCT x.owner_id FROM hp_app.design_photos x JOIN hp_app.designs d ON d.id=x.design_id AND d.owner_id=x.owner_id LEFT JOIN hp_private.photo_work w ON w.photo_id=x.id
 WHERE (p_after IS NULL OR x.owner_id>p_after) AND x.tombstoned_at IS NULL AND (w.photo_id IS NULL OR w.lease_until<=clock_timestamp())
 AND (w.mode IN ('raw','delete') OR (x.status='pending' AND (d.deleted_at IS NOT NULL OR x.expires_at+interval '1 hour'<=clock_timestamp())) OR
 (x.status='ready' AND (d.deleted_at IS NOT NULL OR x.raw_removed_at IS NULL OR (x.ready_at+interval '24 hours'<=clock_timestamp() AND NOT x.id=ANY(d.photo_ids))))) ORDER BY x.owner_id LIMIT p_limit;
END $$;
CREATE FUNCTION hp_app.hp_maintenance_claim(p_user_id uuid,p_token uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT hp_private.claim_photo_cleanup(p_user_id,p_token) $$;

-- The caller holds this transaction across its bounded filesystem recheck and
-- removal. Owner serialization matches reservation; design precedes photo.
CREATE FUNCTION hp_app.hp_maintenance_classify(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_area text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing uuid; tombstone timestamptz;
BEGIN
 IF p_user_id IS NULL OR p_design_id IS NULL OR p_photo_id IS NULL OR p_area IS NULL OR p_area NOT IN ('objects','staging') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
 PERFORM 1 FROM hp_app.designs WHERE id=p_design_id AND owner_id=p_user_id FOR UPDATE;
 SELECT id,tombstoned_at INTO existing,tombstone FROM hp_app.design_photos WHERE id=p_photo_id AND owner_id=p_user_id AND design_id=p_design_id FOR UPDATE;
 IF p_area='staging' THEN RETURN true; END IF;
 -- A restored manifest can be inconsistent; do not delete its missing row's file.
 IF EXISTS(SELECT 1 FROM hp_app.designs WHERE p_photo_id=ANY(photo_ids)) THEN RETURN false; END IF;
 -- A committed tombstone is already an irreversible publication fence. A
 -- stale file restored behind it may be removed, but a live row never may.
 IF existing IS NOT NULL THEN RETURN tombstone IS NOT NULL; END IF;
 IF EXISTS(SELECT 1 FROM hp_app.design_photos WHERE id=p_photo_id) THEN RETURN false; END IF;
 INSERT INTO hp_private.photo_orphan_fences(photo_id,owner_id,design_id) VALUES(p_photo_id,p_user_id,p_design_id) ON CONFLICT(photo_id) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON hp_private.photo_orphan_fences FROM PUBLIC,hp_app_runtime,hp_photo_maintenance;
REVOKE ALL ON FUNCTION hp_private.guard_orphan_fence(),hp_private.claim_photo_cleanup(uuid,uuid) FROM PUBLIC,hp_app_runtime,hp_photo_maintenance;
REVOKE ALL ON FUNCTION hp_app.hp_maintenance_owners(uuid,integer),hp_app.hp_maintenance_claim(uuid,uuid),hp_app.hp_maintenance_lock(uuid,uuid,uuid,uuid),hp_app.hp_maintenance_record_removal(uuid,uuid,uuid,text),hp_app.hp_maintenance_finish_cleanup(uuid,uuid,uuid),hp_app.hp_maintenance_classify(uuid,uuid,uuid,text) FROM PUBLIC,hp_app_runtime;
GRANT USAGE ON SCHEMA hp_app TO hp_photo_maintenance;
GRANT EXECUTE ON FUNCTION hp_app.hp_maintenance_owners(uuid,integer),hp_app.hp_maintenance_claim(uuid,uuid),hp_app.hp_maintenance_lock(uuid,uuid,uuid,uuid),hp_app.hp_maintenance_record_removal(uuid,uuid,uuid,text),hp_app.hp_maintenance_finish_cleanup(uuid,uuid,uuid),hp_app.hp_maintenance_classify(uuid,uuid,uuid,text) TO hp_photo_maintenance;
RESET ROLE;
