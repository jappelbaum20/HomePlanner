-- Transaction-scoped actor and standalone business data; no hosted-platform schemas.
CREATE SCHEMA hp_app AUTHORIZATION hp_app_owner;
CREATE SCHEMA hp_private AUTHORIZATION hp_app_owner;
SET ROLE hp_app_owner;
REVOKE ALL ON SCHEMA hp_app, hp_private FROM PUBLIC;
GRANT USAGE ON SCHEMA hp_app, hp_private TO hp_app_runtime;

CREATE FUNCTION hp_private.actor_live() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM hp_auth.session s JOIN hp_auth.account a ON a."userId"=s."userId" AND a."providerId"='google'
    WHERE s.id::text=current_setting('hp.session_id',true) AND s."userId"::text=current_setting('hp.user_id',true)
      AND s."expiresAt">clock_timestamp() AND s."createdAt">clock_timestamp()-interval '7 days')
$$;
CREATE FUNCTION hp_private.assert_actor(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id::text IS DISTINCT FROM current_setting('hp.user_id',true) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  IF NOT hp_auth.lock_live_session(p_user_id,nullif(current_setting('hp.session_id',true),'')::uuid) OR NOT hp_private.actor_live() THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
END $$;
CREATE FUNCTION hp_app.assert_actor() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM hp_private.assert_actor(nullif(current_setting('hp.user_id',true),'')::uuid);
  RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_google_subjects() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM hp_private.assert_actor(nullif(current_setting('hp.user_id',true),'')::uuid);
  RETURN (SELECT coalesce(jsonb_agg(a."accountId"),'[]'::jsonb) FROM hp_auth.account a WHERE a."userId"::text=current_setting('hp.user_id',true) AND a."providerId"='google');
END $$;

create table hp_app.designs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  kind text not null check (kind in ('home','shelf')),
  title text not null check (char_length(title) between 1 and 120),
  schema_version integer not null check (schema_version = 3),
  payload jsonb not null check (octet_length(payload::text) <= 1100000),
  photo_ids uuid[] not null default '{}',
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, owner_id),
  check (cardinality(photo_ids) <= 100)
);
create index designs_owner_id_idx on hp_app.designs(owner_id, id) where deleted_at is null;

create table hp_app.design_photos (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null,
  owner_id uuid not null,
  raw_key text not null unique,
  object_key text unique,
  requested_mime text not null check (requested_mime in ('image/jpeg','image/png','image/webp')),
  requested_bytes bigint not null check (requested_bytes between 1 and 10485760),
  requested_checksum text not null check (requested_checksum ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','ready')),
  mime text, bytes bigint, checksum text,
  allocation_bytes bigint not null default 20971520 check (allocation_bytes between 1 and 20971520),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  raw_removed_at timestamptz,
  foreign key (design_id, owner_id) references hp_app.designs(id, owner_id),
  check ((status = 'pending' and object_key is null and mime is null and bytes is null and checksum is null)
    or (status = 'ready' and object_key is not null and mime = requested_mime and bytes between 1 and 10485760 and checksum ~ '^[a-f0-9]{64}$'))
);
create index photos_owner_design_idx on hp_app.design_photos(owner_id, design_id);

create function hp_private.guard_design_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then raise exception 'HP_INVALID'; end if;
  return new;
end $$;
create trigger design_owner_immutable before update of owner_id on hp_app.designs
  for each row execute function hp_private.guard_design_owner();
create function hp_private.guard_photo_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.design_id is distinct from old.design_id
    or new.raw_key is distinct from old.raw_key or new.requested_mime is distinct from old.requested_mime
    or new.requested_bytes is distinct from old.requested_bytes or new.requested_checksum is distinct from old.requested_checksum then
    raise exception 'HP_INVALID';
  end if;
  return new;
end $$;
create trigger photo_identity_immutable before update of owner_id,design_id,raw_key,requested_mime,requested_bytes,requested_checksum
  on hp_app.design_photos for each row execute function hp_private.guard_photo_identity();

create table hp_private.design_idempotency (
  owner_id uuid not null, key uuid not null, endpoint text not null, body_hash text not null,
  response jsonb not null, created_at timestamptz not null default now(),
  primary key(owner_id, endpoint, key), check (body_hash ~ '^[a-f0-9]{64}$')
);
create table hp_private.design_save_events (owner_id uuid not null, created_at timestamptz not null default now());
create index design_save_events_user_time on hp_private.design_save_events(owner_id, created_at);


create function hp_private.save_guard(p_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design:' || p_user_id::text, 0));
  if (select count(*) from hp_private.design_save_events where owner_id = p_user_id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'HP_QUOTA';
  end if;
  insert into hp_private.design_save_events(owner_id) values (p_user_id);
end $$;


-- These private tables intentionally contain no provider credentials or prompts.
create table hp_private.model_config (
  singleton boolean primary key default true check (singleton), revision bigint not null default 1,
  enabled boolean not null default false, adapter_id text, model_id text, connection_ref text,
  limits jsonb not null default '{"requestsPerMinute":5,"requestsPerDay":20,"maxOutputTokens":4000}'::jsonb,
  global_budget_micros bigint check (global_budget_micros between 1 and 10000000000), updated_at timestamptz not null default now(),
  check (not enabled or (adapter_id is not null and model_id is not null and connection_ref is not null and global_budget_micros is not null))
);
insert into hp_private.model_config(singleton,global_budget_micros) values(true,25000000);
create table hp_private.admin_binding (
  singleton boolean primary key default true check (singleton), user_id uuid not null unique,
  google_subject text not null unique, created_at timestamptz not null default now()
);
create table hp_private.admin_audit (
  id bigint generated always as identity primary key, actor_id uuid not null, action text not null,
  config_revision bigint not null, created_at timestamptz not null default now()
);
create table hp_private.usage_reservations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, request_id uuid not null,
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'), config_revision bigint not null,
  status text not null check (status in ('reserved','succeeded','failed','ambiguous')),
  reserved_micros bigint not null check (reserved_micros > 0), actual_micros bigint check (actual_micros >= 0),
  result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,request_id), check (result is null or octet_length(result::text) <= 65536)
);
create index usage_owner_time on hp_private.usage_reservations(owner_id,created_at);


CREATE TABLE hp_private.admin_challenges (
  nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'), user_id uuid NOT NULL, session_id uuid NOT NULL,
  google_subject text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE hp_private.admin_grants (
  grant_hash text PRIMARY KEY CHECK(grant_hash ~ '^[a-f0-9]{64}$'), user_id uuid NOT NULL, session_id uuid NOT NULL,
  google_subject text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE FUNCTION hp_private.admin_grant_live(p_subject text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT hp_private.actor_live() AND EXISTS (SELECT 1 FROM hp_private.admin_grants g
    JOIN hp_private.admin_binding b ON b.singleton AND b.user_id=g.user_id AND b.google_subject=g.google_subject
    WHERE g.grant_hash=current_setting('hp.admin_grant_hash',true) AND g.user_id::text=current_setting('hp.user_id',true)
      AND g.session_id::text=current_setting('hp.session_id',true) AND g.google_subject=p_subject AND g.expires_at>clock_timestamp())
$$;
CREATE FUNCTION hp_app.hp_admin_challenge_issue(p_nonce_hash text,p_google_subject text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid;
BEGIN
  PERFORM hp_private.assert_actor(uid);
  IF p_nonce_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS (SELECT 1 FROM hp_auth.account a WHERE a."userId"=uid AND a."providerId"='google' AND a."accountId"=p_google_subject) THEN RAISE EXCEPTION 'HP_NOT_FOUND'; END IF;
  INSERT INTO hp_private.admin_challenges VALUES(p_nonce_hash,uid,sid,p_google_subject,clock_timestamp()+interval '5 minutes',NULL);
  RETURN true;
END $$;
CREATE FUNCTION hp_app.hp_admin_verify(p_nonce_hash text,p_google_subject text,p_grant_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid; sid uuid := nullif(current_setting('hp.session_id',true),'')::uuid; b hp_private.admin_binding; rev bigint;
BEGIN
  PERFORM hp_private.assert_actor(uid);
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
CREATE FUNCTION hp_app.hp_admin_grant(p_grant_hash text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject text; uid uuid := nullif(current_setting('hp.user_id',true),'')::uuid;
BEGIN
  PERFORM hp_private.assert_actor(uid);
  SELECT g.google_subject INTO subject FROM hp_private.admin_grants g JOIN hp_private.admin_binding b ON b.singleton AND b.user_id=g.user_id AND b.google_subject=g.google_subject
  WHERE g.grant_hash=p_grant_hash AND g.user_id=uid AND g.session_id::text=current_setting('hp.session_id',true) AND g.expires_at>clock_timestamp();
  RETURN subject;
END $$;

create function hp_app.hp_model_config_get() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision',revision,'enabled',enabled,'adapterId',adapter_id,'modelId',model_id,
    'connectionRef',connection_ref,'limits',limits,'globalBudgetMicros',global_budget_micros) from hp_private.model_config where singleton and hp_private.actor_live()
$$;
create function hp_app.hp_model_config_update(p_actor uuid, p_google_subject text, p_revision bigint, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c hp_private.model_config;
begin
  perform hp_private.assert_actor(p_actor);
  if not hp_private.admin_grant_live(p_google_subject) or not exists(select 1 from hp_private.admin_binding where singleton and user_id=p_actor and google_subject=p_google_subject) then raise exception 'HP_NOT_FOUND'; end if;
  select * into c from hp_private.model_config where singleton for update;
  if c.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  if jsonb_typeof(p_config) <> 'object' or jsonb_typeof(p_config->'enabled') <> 'boolean' or jsonb_typeof(p_config->'limits') <> 'object' then raise exception 'HP_INVALID'; end if;
  update hp_private.model_config set revision=revision+1,enabled=(p_config->>'enabled')::boolean,adapter_id=p_config->>'adapterId',
    model_id=p_config->>'modelId',connection_ref=p_config->>'connectionRef',limits=p_config->'limits',
    global_budget_micros=(p_config->>'globalBudgetMicros')::bigint,updated_at=now() where singleton returning * into c;
  insert into hp_private.admin_audit(actor_id,action,config_revision) values(p_actor,'model_config_update',c.revision);
  return hp_app.hp_model_config_get();
end $$;

create function hp_app.hp_reserve_usage(p_user_id uuid,p_request_id uuid,p_body_hash text,p_config_revision bigint,p_max_cost_micros bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c hp_private.model_config; r hp_private.usage_reservations; spent numeric;
begin
  perform hp_private.assert_actor(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('global-usage',0));
  select * into r from hp_private.usage_reservations where owner_id=p_user_id and request_id=p_request_id;
  if found then
    if r.body_hash <> p_body_hash then raise exception 'HP_CONFLICT'; end if;
    return jsonb_build_object('reservationId',r.id,'status',r.status,'result',r.result,'replay',true);
  end if;
  select * into c from hp_private.model_config where singleton for update;
  if not found or not c.enabled or c.revision <> p_config_revision or c.global_budget_micros is null or p_max_cost_micros is null or p_max_cost_micros <= 0 then raise exception 'HP_INVALID'; end if;
  if (select count(*) from hp_private.usage_reservations where owner_id=p_user_id and created_at > now()-interval '1 minute') >= least(coalesce((c.limits->>'requestsPerMinute')::int,0),5)
    or (select count(*) from hp_private.usage_reservations where owner_id=p_user_id and created_at > now()-interval '1 day') >= least(coalesce((c.limits->>'requestsPerDay')::int,0),20)
    or exists(select 1 from hp_private.usage_reservations where owner_id=p_user_id and status in ('reserved','ambiguous')) then raise exception 'HP_QUOTA'; end if;
  -- Global cap is a lifetime budget until an explicitly reviewed reset mechanism exists.
  select coalesce(sum(case when status in ('reserved','ambiguous') then reserved_micros when status='succeeded' then actual_micros else 0 end),0) into spent from hp_private.usage_reservations;
  if spent + p_max_cost_micros > c.global_budget_micros then raise exception 'HP_QUOTA'; end if;
  insert into hp_private.usage_reservations(owner_id,request_id,body_hash,config_revision,status,reserved_micros)
    values(p_user_id,p_request_id,p_body_hash,p_config_revision,'reserved',p_max_cost_micros) returning * into r;
  return jsonb_build_object('reservationId',r.id,'status',r.status,'result',null,'replay',false);
end $$;

create function hp_app.hp_finalize_usage(p_user_id uuid,p_reservation_id uuid,p_status text,p_actual_micros bigint,p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r hp_private.usage_reservations;
begin
  perform hp_private.assert_actor(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('global-usage',0));
  select * into r from hp_private.usage_reservations where id=p_reservation_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if r.status <> 'reserved' then return jsonb_build_object('status',r.status,'result',r.result); end if;
  if p_status not in ('succeeded','failed','ambiguous') or (p_status='succeeded' and (p_actual_micros is null or p_actual_micros < 0 or p_actual_micros > r.reserved_micros or p_result is null))
    or (p_status <> 'succeeded' and (p_actual_micros is not null or p_result is not null)) then raise exception 'HP_INVALID'; end if;
  update hp_private.usage_reservations set status=p_status,actual_micros=p_actual_micros,result=p_result,updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('status',r.status,'result',r.result);
end $$;


create function hp_private.validate_photo_ids(p_user_id uuid, p_design_id uuid, p_body jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if jsonb_typeof(p_body->'photoIds') <> 'array' or jsonb_array_length(p_body->'photoIds') > 100 then raise exception 'HP_INVALID'; end if;
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into ids from jsonb_array_elements_text(p_body->'photoIds') x;
  if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception 'HP_INVALID'; end if;
  if cardinality(ids) <> (select count(*) from hp_app.design_photos p where p.owner_id = p_user_id and p.design_id = p_design_id and p.status = 'ready' and p.id = any(ids)) then
    raise exception 'HP_INVALID';
  end if;
  return ids;
end $$;

create function hp_private.design_document(d hp_app.designs) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'schemaVersion',d.schema_version,'payload',d.payload,
    'photoManifest',coalesce((select jsonb_agg(jsonb_build_object('photoId',p.id,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum) order by x.ord)
      from unnest(d.photo_ids) with ordinality x(id,ord) join hp_app.design_photos p on p.id=x.id and p.owner_id=d.owner_id and p.design_id=d.id and p.status='ready'), '[]'::jsonb),
    'revision',d.revision,'createdAt',d.created_at,'updatedAt',d.updated_at)
$$;

create function hp_app.hp_create_design(p_user_id uuid, p_key uuid, p_body_hash text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare prev hp_private.design_idempotency; d hp_app.designs; result jsonb;
begin
  perform hp_private.assert_actor(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design:' || p_user_id::text, 0));
  select * into prev from hp_private.design_idempotency where owner_id=p_user_id and endpoint='create' and key=p_key;
  if found then
    if prev.body_hash <> p_body_hash then raise exception 'HP_CONFLICT'; end if;
    return prev.response;
  end if;
  perform hp_private.save_guard(p_user_id);
  if (select count(*) from hp_app.designs where owner_id=p_user_id and deleted_at is null) >= 100 then raise exception 'HP_QUOTA'; end if;
  if jsonb_typeof(p_body->'photoIds') <> 'array' or jsonb_array_length(p_body->'photoIds') <> 0 then raise exception 'HP_INVALID'; end if;
  insert into hp_app.designs(owner_id,kind,title,schema_version,payload)
    values (p_user_id,p_body->>'kind',p_body->>'title',(p_body->>'schemaVersion')::integer,p_body->'payload') returning * into d;
  result := jsonb_build_object('design',hp_private.design_document(d),'revision',d.revision);
  insert into hp_private.design_idempotency(owner_id,key,endpoint,body_hash,response) values(p_user_id,p_key,'create',p_body_hash,result);
  return result;
end $$;

create function hp_app.hp_update_design(p_user_id uuid, p_id uuid, p_revision bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d hp_app.designs; ids uuid[];
begin
  perform hp_private.assert_actor(p_user_id);
  perform hp_private.save_guard(p_user_id);
  select * into d from hp_app.designs where id=p_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if d.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  ids := hp_private.validate_photo_ids(p_user_id,p_id,p_body);
  update hp_app.designs set kind=p_body->>'kind',title=p_body->>'title',schema_version=(p_body->>'schemaVersion')::integer,
    payload=p_body->'payload',photo_ids=ids,revision=revision+1,updated_at=now() where id=p_id returning * into d;
  return jsonb_build_object('design',hp_private.design_document(d),'revision',d.revision);
end $$;

create function hp_app.hp_delete_design(p_user_id uuid, p_id uuid, p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare d hp_app.designs;
begin
  perform hp_private.assert_actor(p_user_id);
  perform hp_private.save_guard(p_user_id);
  select * into d from hp_app.designs where id=p_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if d.deleted_at is not null then
    if d.revision=p_revision+1 then return; end if;
    raise exception 'HP_CONFLICT';
  end if;
  if d.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  update hp_app.designs set deleted_at=now(),updated_at=now(),revision=revision+1 where id=p_id;
end $$;


CREATE FUNCTION hp_app.hp_usage_replay(p_user_id uuid,p_request_id uuid,p_body_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r hp_private.usage_reservations;
BEGIN
  PERFORM hp_private.assert_actor(p_user_id);
  SELECT * INTO r FROM hp_private.usage_reservations WHERE owner_id=p_user_id AND request_id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.body_hash<>p_body_hash THEN RAISE EXCEPTION 'HP_CONFLICT'; END IF;
  RETURN jsonb_build_object('reservationId',r.id,'status',r.status,'result',r.result,'replay',true);
END $$;
ALTER TABLE hp_app.designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hp_app.design_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_design_read ON hp_app.designs FOR SELECT TO hp_app_runtime USING (owner_id::text=current_setting('hp.user_id',true) AND deleted_at IS NULL AND hp_private.actor_live());
CREATE POLICY owner_photo_read ON hp_app.design_photos FOR SELECT TO hp_app_runtime USING (owner_id::text=current_setting('hp.user_id',true) AND hp_private.actor_live() AND EXISTS(SELECT 1 FROM hp_app.designs d WHERE d.id=design_photos.design_id AND d.owner_id=design_photos.owner_id AND d.deleted_at IS NULL));
REVOKE ALL ON ALL TABLES IN SCHEMA hp_app, hp_private FROM PUBLIC, hp_app_runtime;
GRANT SELECT ON hp_app.designs, hp_app.design_photos TO hp_app_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hp_app, hp_private FROM PUBLIC, hp_app_runtime;
GRANT EXECUTE ON FUNCTION hp_private.actor_live() TO hp_app_runtime;
GRANT EXECUTE ON FUNCTION hp_app.assert_actor(), hp_app.hp_google_subjects(), hp_app.hp_admin_challenge_issue(text,text), hp_app.hp_admin_verify(text,text,text), hp_app.hp_admin_grant(text), hp_app.hp_model_config_get(), hp_app.hp_model_config_update(uuid,text,bigint,jsonb), hp_app.hp_usage_replay(uuid,uuid,text), hp_app.hp_reserve_usage(uuid,uuid,text,bigint,bigint), hp_app.hp_finalize_usage(uuid,uuid,text,bigint,jsonb), hp_app.hp_create_design(uuid,uuid,text,jsonb), hp_app.hp_update_design(uuid,uuid,bigint,jsonb), hp_app.hp_delete_design(uuid,uuid,bigint) TO hp_app_runtime;
RESET ROLE;




