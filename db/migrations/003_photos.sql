-- Filesystem receipts are assertions by the trusted filesystem adapter AFTER
-- fsync/absence verification, never proof that a path exists by themselves.
SET ROLE hp_app_owner;
ALTER TABLE hp_app.design_photos ADD COLUMN ready_at timestamptz;
ALTER TABLE hp_app.design_photos ADD COLUMN tombstoned_at timestamptz;
ALTER TABLE hp_app.design_photos ADD COLUMN reservation_session_id uuid NOT NULL;
ALTER TABLE hp_app.design_photos DROP CONSTRAINT design_photos_allocation_bytes_check;
ALTER TABLE hp_app.design_photos ADD CONSTRAINT design_photos_allocation_bytes_check
 CHECK (allocation_bytes BETWEEN 0 AND 20971520 AND (allocation_bytes > 0 OR tombstoned_at IS NOT NULL));
CREATE FUNCTION hp_private.guard_reservation_session() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.reservation_session_id IS DISTINCT FROM OLD.reservation_session_id THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_session_immutable BEFORE UPDATE OF reservation_session_id ON hp_app.design_photos
 FOR EACH ROW EXECUTE FUNCTION hp_private.guard_reservation_session();
CREATE TABLE hp_private.photo_work (
 photo_id uuid PRIMARY KEY REFERENCES hp_app.design_photos(id), mode text NOT NULL CHECK(mode IN ('completing','raw','delete')),
 token uuid NOT NULL, lease_until timestamptz NOT NULL, raw_removed boolean NOT NULL DEFAULT false, ready_removed boolean NOT NULL DEFAULT false
);
CREATE TABLE hp_private.photo_receipts (
 photo_id uuid NOT NULL REFERENCES hp_app.design_photos(id), part text NOT NULL CHECK(part IN ('raw','ready')),
 state text NOT NULL CHECK(state IN ('published','removed')), bytes bigint, checksum text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(photo_id,part),
 CHECK ((state='published' AND bytes BETWEEN 1 AND 10485760 AND checksum ~ '^[a-f0-9]{64}$') OR (state='removed' AND bytes IS NULL AND checksum IS NULL))
);
CREATE FUNCTION hp_private.photo_visible(p_photo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM hp_private.photo_work w WHERE w.photo_id=p_photo_id AND w.mode='delete')
$$;
DROP POLICY owner_photo_read ON hp_app.design_photos;
CREATE POLICY owner_photo_read ON hp_app.design_photos FOR SELECT TO hp_app_runtime USING (
 owner_id::text=current_setting('hp.user_id',true) AND tombstoned_at IS NULL AND hp_private.actor_live() AND hp_private.photo_visible(id)
 AND EXISTS(SELECT 1 FROM hp_app.designs d WHERE d.id=design_photos.design_id AND d.owner_id=design_photos.owner_id AND d.deleted_at IS NULL)
);
CREATE FUNCTION hp_app.hp_reserve_photo(p_user_id uuid,p_design_id uuid,p_mime text,p_bytes bigint,p_checksum text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hp_app.design_photos; pid uuid:=gen_random_uuid();
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
 PERFORM 1 FROM hp_app.designs WHERE id=p_design_id AND owner_id=p_user_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF p_mime NOT IN ('image/jpeg','image/png','image/webp') OR p_bytes NOT BETWEEN 1 AND 10485760 OR p_checksum !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 IF (SELECT count(*) FROM hp_app.design_photos WHERE owner_id=p_user_id AND design_id=p_design_id AND tombstoned_at IS NULL) >= 100 OR coalesce((SELECT sum(allocation_bytes) FROM hp_app.design_photos WHERE owner_id=p_user_id),0)+20971520>262144000 THEN RAISE EXCEPTION 'HP_QUOTA'; END IF;
 INSERT INTO hp_app.design_photos(id,design_id,owner_id,raw_key,requested_mime,requested_bytes,requested_checksum,reservation_session_id)
 VALUES(pid,p_design_id,p_user_id,p_user_id::text||'/'||p_design_id::text||'/'||pid::text||'/raw',p_mime,p_bytes,p_checksum,nullif(current_setting('hp.session_id',true),'')::uuid) RETURNING * INTO p;
 RETURN jsonb_build_object('photoId',p.id,'rawKey',p.raw_key,'expiresAt',p.expires_at);
END $$;
-- Must run in the same transaction and connection as publication/removal and
-- the matching receipt. Always lock design before photo and hold both locks
-- across bounded filesystem operations (never across a network upload).
CREATE FUNCTION hp_app.hp_photo_lock(p_design_id uuid,p_photo_id uuid,p_operation text,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  IF d.deleted_at IS NOT NULL OR p.tombstoned_at IS NOT NULL OR p.status<>'pending' OR p.expires_at<=clock_timestamp() OR w.mode IS DISTINCT FROM 'completing' OR w.token IS DISTINCT FROM p_token OR w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSIF p_operation='cleanup' THEN
  IF w.mode IS NULL OR w.mode NOT IN ('raw','delete') OR w.token IS DISTINCT FROM p_token OR w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSE RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN jsonb_build_object('photoId',p.id,'designId',p.design_id,'ownerId',p.owner_id,'status',p.status,'rawKey',p.raw_key,
  'readyKey',p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready','requestedMime',p.requested_mime,
  'requestedBytes',p.requested_bytes,'requestedChecksum',p.requested_checksum,'expiresAt',p.expires_at,'mode',w.mode);
END $$;
CREATE FUNCTION hp_app.hp_photo_record_publication(p_design_id uuid,p_photo_id uuid,p_part text,p_token uuid,p_bytes bigint,p_checksum text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap jsonb; old hp_private.photo_receipts;
BEGIN
 IF p_part NOT IN ('raw','ready') OR p_bytes NOT BETWEEN 1 AND 10485760 OR p_checksum !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 snap:=hp_app.hp_photo_lock(p_design_id,p_photo_id,p_part,p_token);
 IF p_part='raw' AND (p_bytes<>(snap->>'requestedBytes')::bigint OR p_checksum<>snap->>'requestedChecksum') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT * INTO old FROM hp_private.photo_receipts WHERE photo_id=p_photo_id AND part=p_part FOR UPDATE;
 IF FOUND THEN
  IF old.state<>'published' OR old.bytes<>p_bytes OR old.checksum<>p_checksum THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 ELSE INSERT INTO hp_private.photo_receipts(photo_id,part,state,bytes,checksum) VALUES(p_photo_id,p_part,'published',p_bytes,p_checksum); END IF;
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_begin_photo_completion(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hp_app.design_photos; w hp_private.photo_work;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 PERFORM 1 FROM hp_app.designs WHERE id=p_design_id AND owner_id=p_user_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 SELECT * INTO p FROM hp_app.design_photos WHERE id=p_photo_id AND design_id=p_design_id AND owner_id=p_user_id AND tombstoned_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 IF p.status='ready' THEN RETURN jsonb_build_object('id',p.id,'status',p.status,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum); END IF;
 IF p_token IS NULL OR p.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM hp_private.photo_receipts WHERE photo_id=p.id AND part='raw' AND state='published') THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
 IF FOUND AND (w.mode<>'completing' OR w.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 INSERT INTO hp_private.photo_work(photo_id,mode,token,lease_until) VALUES(p.id,'completing',p_token,clock_timestamp()+interval '5 minutes') ON CONFLICT(photo_id) DO UPDATE SET mode='completing',token=excluded.token,lease_until=excluded.lease_until;
 RETURN jsonb_build_object('id',p.id,'status',p.status,'raw_key',p.raw_key,'requested_mime',p.requested_mime,'requested_bytes',p.requested_bytes,'requested_checksum',p.requested_checksum);
END $$;
CREATE FUNCTION hp_app.hp_finish_photo_completion(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_token uuid,p_key text,p_bytes bigint,p_checksum text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hp_app.design_photos; snap jsonb;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id); snap:=hp_app.hp_photo_lock(p_design_id,p_photo_id,'ready',p_token);
 IF p_key IS DISTINCT FROM snap->>'readyKey' OR NOT EXISTS(SELECT 1 FROM hp_private.photo_receipts WHERE photo_id=p_photo_id AND part='ready' AND state='published' AND bytes=p_bytes AND checksum=p_checksum) THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
 UPDATE hp_app.design_photos SET status='ready',object_key=p_key,mime=requested_mime,bytes=p_bytes,checksum=p_checksum,ready_at=clock_timestamp() WHERE id=p_photo_id RETURNING * INTO p;
 DELETE FROM hp_private.photo_work WHERE photo_id=p_photo_id;
 RETURN jsonb_build_object('photoId',p.id,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum);
END $$;
CREATE FUNCTION hp_app.hp_claim_photo_cleanup(p_user_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; d hp_app.designs; p hp_app.design_photos; w hp_private.photo_work; new_mode text;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 IF p_token IS NULL THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
 FOR candidate IN SELECT x.id,x.design_id FROM hp_app.design_photos x JOIN hp_app.designs y ON y.id=x.design_id AND y.owner_id=x.owner_id LEFT JOIN hp_private.photo_work q ON q.photo_id=x.id
   WHERE x.owner_id=p_user_id AND x.tombstoned_at IS NULL AND (q.photo_id IS NULL OR q.lease_until<=clock_timestamp())
   AND (q.mode IN ('raw','delete') OR (x.status='pending' AND x.expires_at+interval '1 hour'<=clock_timestamp()) OR
     (x.status='ready' AND (y.deleted_at IS NOT NULL OR x.raw_removed_at IS NULL OR (x.ready_at+interval '24 hours'<=clock_timestamp() AND NOT x.id=ANY(y.photo_ids))))) ORDER BY x.created_at,x.id LIMIT 32
 LOOP
  SELECT * INTO d FROM hp_app.designs WHERE id=candidate.design_id AND owner_id=p_user_id FOR UPDATE;
  SELECT * INTO p FROM hp_app.design_photos WHERE id=candidate.id AND owner_id=p_user_id FOR UPDATE;
  SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p.id FOR UPDATE;
  IF w.photo_id IS NOT NULL AND w.lease_until>clock_timestamp() THEN CONTINUE; END IF;
  IF w.mode IN ('raw','delete') THEN new_mode:=w.mode;
  ELSIF p.status='pending' AND p.expires_at+interval '1 hour'<=clock_timestamp() THEN new_mode:='delete';
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
-- Called only after the trusted filesystem adapter verifies absence from the
-- serving namespace while holding hp_photo_lock in this same transaction.
CREATE FUNCTION hp_app.hp_record_photo_removal(p_user_id uuid,p_photo_id uuid,p_token uuid,p_part text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; w hp_private.photo_work; snap jsonb;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 SELECT design_id INTO pid FROM hp_app.design_photos WHERE id=p_photo_id AND owner_id=p_user_id;
 IF pid IS NULL OR p_part NOT IN ('raw','ready') THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 snap:=hp_app.hp_photo_lock(pid,p_photo_id,'cleanup',p_token);
 SELECT * INTO w FROM hp_private.photo_work WHERE photo_id=p_photo_id;
 IF p_part='ready' AND w.mode<>'delete' THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 INSERT INTO hp_private.photo_receipts(photo_id,part,state,bytes,checksum) VALUES(p_photo_id,p_part,'removed',NULL,NULL)
 ON CONFLICT(photo_id,part) DO UPDATE SET state='removed',bytes=NULL,checksum=NULL,recorded_at=clock_timestamp();
 IF p_part='raw' THEN UPDATE hp_private.photo_work SET raw_removed=true WHERE photo_id=p_photo_id;
 ELSE UPDATE hp_private.photo_work SET ready_removed=true WHERE photo_id=p_photo_id; END IF;
 RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_finish_photo_cleanup(p_user_id uuid,p_photo_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; w hp_private.photo_work; snap jsonb; before_bytes bigint; after_bytes bigint;
BEGIN
 PERFORM hp_private.assert_actor(p_user_id);
 SELECT design_id INTO pid FROM hp_app.design_photos WHERE id=p_photo_id AND owner_id=p_user_id;
 IF pid IS NULL THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
 snap:=hp_app.hp_photo_lock(pid,p_photo_id,'cleanup',p_token);
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
CREATE OR REPLACE FUNCTION hp_private.validate_photo_ids(p_user_id uuid,p_design_id uuid,p_body jsonb) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];
BEGIN
 IF jsonb_typeof(p_body->'photoIds')<>'array' OR jsonb_array_length(p_body->'photoIds')>100 THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 SELECT coalesce(array_agg(x::uuid),'{}'::uuid[]) INTO ids FROM jsonb_array_elements_text(p_body->'photoIds') x;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR cardinality(ids)<>(SELECT count(*) FROM hp_app.design_photos p WHERE p.owner_id=p_user_id AND p.design_id=p_design_id AND p.status='ready' AND p.tombstoned_at IS NULL AND p.id=ANY(ids) AND NOT EXISTS(SELECT 1 FROM hp_private.photo_work w WHERE w.photo_id=p.id AND w.mode='delete')) THEN RAISE EXCEPTION 'HP_INVALID'; END IF;
 RETURN ids;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA hp_private FROM PUBLIC,hp_app_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hp_private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_private.photo_visible(uuid) TO hp_app_runtime;
REVOKE ALL ON FUNCTION hp_app.hp_reserve_photo(uuid,uuid,text,bigint,text), hp_app.hp_photo_lock(uuid,uuid,text,uuid), hp_app.hp_photo_record_publication(uuid,uuid,text,uuid,bigint,text), hp_app.hp_begin_photo_completion(uuid,uuid,uuid,uuid), hp_app.hp_finish_photo_completion(uuid,uuid,uuid,uuid,text,bigint,text), hp_app.hp_claim_photo_cleanup(uuid,uuid), hp_app.hp_record_photo_removal(uuid,uuid,uuid,text), hp_app.hp_finish_photo_cleanup(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hp_app.hp_reserve_photo(uuid,uuid,text,bigint,text), hp_app.hp_photo_lock(uuid,uuid,text,uuid), hp_app.hp_photo_record_publication(uuid,uuid,text,uuid,bigint,text), hp_app.hp_begin_photo_completion(uuid,uuid,uuid,uuid), hp_app.hp_finish_photo_completion(uuid,uuid,uuid,uuid,text,bigint,text), hp_app.hp_claim_photo_cleanup(uuid,uuid), hp_app.hp_record_photo_removal(uuid,uuid,uuid,text), hp_app.hp_finish_photo_cleanup(uuid,uuid,uuid) TO hp_app_runtime;
RESET ROLE;


