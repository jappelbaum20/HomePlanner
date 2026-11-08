-- Generated locally using the Supabase CLI; no remote project is targeted.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.designs (
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
create index designs_owner_id_idx on public.designs(owner_id, id) where deleted_at is null;

create table public.design_photos (
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
  foreign key (design_id, owner_id) references public.designs(id, owner_id),
  check ((status = 'pending' and object_key is null and mime is null and bytes is null and checksum is null)
    or (status = 'ready' and object_key is not null and mime = requested_mime and bytes between 1 and 10485760 and checksum ~ '^[a-f0-9]{64}$'))
);
create index photos_owner_design_idx on public.design_photos(owner_id, design_id);

create function private.guard_design_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then raise exception 'HP_INVALID'; end if;
  return new;
end $$;
create trigger design_owner_immutable before update of owner_id on public.designs
  for each row execute function private.guard_design_owner();
create function private.guard_photo_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.design_id is distinct from old.design_id
    or new.raw_key is distinct from old.raw_key or new.requested_mime is distinct from old.requested_mime
    or new.requested_bytes is distinct from old.requested_bytes or new.requested_checksum is distinct from old.requested_checksum then
    raise exception 'HP_INVALID';
  end if;
  return new;
end $$;
create trigger photo_identity_immutable before update of owner_id,design_id,raw_key,requested_mime,requested_bytes,requested_checksum
  on public.design_photos for each row execute function private.guard_photo_identity();

create table private.design_idempotency (
  owner_id uuid not null, key uuid not null, endpoint text not null, body_hash text not null,
  response jsonb not null, created_at timestamptz not null default now(),
  primary key(owner_id, endpoint, key), check (body_hash ~ '^[a-f0-9]{64}$')
);
create table private.design_save_events (owner_id uuid not null, created_at timestamptz not null default now());
create index design_save_events_user_time on private.design_save_events(owner_id, created_at);

-- Checking the session as part of every RLS decision also closes the direct
-- Data API / Storage path after sign-out. Supabase may retain timed-out rows;
-- deployment must separately verify its session timeout configuration.
create function private.session_live() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.uid()) is not null
    and (select auth.jwt())->'app_metadata'->>'provider' = 'google'
    and case when coalesce((select auth.jwt())->>'session_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists(select 1 from auth.sessions s where s.id = ((select auth.jwt())->>'session_id')::uuid and s.user_id = (select auth.uid()) and (s.not_after is null or s.not_after > now()))
      else false end, false)
$$;
revoke all on function private.session_live() from public, anon;
grant execute on function private.session_live() to authenticated;

alter table public.designs enable row level security;
alter table public.design_photos enable row level security;
revoke all on public.designs, public.design_photos from public, anon, authenticated;
grant select on public.designs, public.design_photos to authenticated;
create policy designs_owner_read on public.designs for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null and (select private.session_live()));
create policy photos_owner_read on public.design_photos for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.session_live()) and exists
    (select 1 from public.designs d where d.id = design_photos.design_id and d.owner_id = design_photos.owner_id and d.deleted_at is null));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('design-photos','design-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
-- A reservation authorizes only the exact immutable raw key, never read or replace.
create policy photo_reserved_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'design-photos' and (select private.session_live()) and exists (
    select 1 from public.design_photos p join public.designs d on d.id = p.design_id and d.owner_id = p.owner_id
    where p.owner_id = (select auth.uid()) and p.raw_key = name and p.status = 'pending'
      and p.expires_at > now() and d.deleted_at is null));

create function public.hp_session_active(p_user_id uuid, p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id and (s.not_after is null or s.not_after > now()))
$$;

create function private.save_guard(p_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design:' || p_user_id::text, 0));
  if (select count(*) from private.design_save_events where owner_id = p_user_id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'HP_QUOTA';
  end if;
  insert into private.design_save_events(owner_id) values (p_user_id);
end $$;

create function public.hp_reserve_photo(p_user_id uuid, p_design_id uuid, p_mime text, p_bytes bigint, p_checksum text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; pid uuid := gen_random_uuid();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:' || p_user_id::text,0));
  perform 1 from public.designs where id=p_design_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if p_mime not in ('image/jpeg','image/png','image/webp') or p_bytes not between 1 and 10485760 or p_checksum !~ '^[a-f0-9]{64}$' then raise exception 'HP_INVALID'; end if;
  if (select count(*) from public.design_photos where owner_id=p_user_id and design_id=p_design_id) >= 100
    or coalesce((select sum(allocation_bytes) from public.design_photos where owner_id=p_user_id),0) + 20971520 > 262144000 then raise exception 'HP_QUOTA'; end if;
  insert into public.design_photos(id,design_id,owner_id,raw_key,requested_mime,requested_bytes,requested_checksum)
    values(pid,p_design_id,p_user_id,p_user_id::text||'/'||p_design_id::text||'/'||pid::text||'/raw',p_mime,p_bytes,p_checksum) returning * into p;
  return jsonb_build_object('photoId',p.id,'rawKey',p.raw_key,'expiresAt',p.expires_at);
end $$;

create function public.hp_photo_ready(p_user_id uuid, p_design_id uuid, p_photo_id uuid, p_key text, p_bytes bigint, p_checksum text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:' || p_user_id::text,0));
  perform 1 from public.designs where id=p_design_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into p from public.design_photos where id=p_photo_id and design_id=p_design_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if p.status='pending' then
    if p.expires_at <= now() or p_key <> p_user_id::text||'/'||p_design_id::text||'/'||p_photo_id::text||'/ready'
      or p_bytes not between 1 and 10485760 or p_checksum !~ '^[a-f0-9]{64}$' then raise exception 'HP_INVALID'; end if;
    update public.design_photos set status='ready',object_key=p_key,mime=requested_mime,bytes=p_bytes,checksum=p_checksum
      where id=p_photo_id returning * into p;
  elsif p.object_key <> p_key or p.checksum <> p_checksum or p.bytes <> p_bytes then raise exception 'HP_CONFLICT';
  end if;
  return jsonb_build_object('photoId',p.id,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum);
end $$;

create function public.hp_photo_raw_removed(p_user_id uuid, p_design_id uuid, p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:' || p_user_id::text,0));
  update public.design_photos set raw_removed_at=coalesce(raw_removed_at,now()), allocation_bytes=bytes
    where id=p_photo_id and owner_id=p_user_id and design_id=p_design_id and status='ready';
  if not found then raise exception 'HP_NOT_FOUND'; end if;
end $$;

-- These private tables intentionally contain no provider credentials or prompts.
create table private.model_config (
  singleton boolean primary key default true check (singleton), revision bigint not null default 1,
  enabled boolean not null default false, adapter_id text, model_id text, connection_ref text,
  limits jsonb not null default '{"requestsPerMinute":5,"requestsPerDay":20,"maxOutputTokens":4000}'::jsonb,
  global_budget_micros bigint check (global_budget_micros > 0), updated_at timestamptz not null default now(),
  check (not enabled or (adapter_id is not null and model_id is not null and connection_ref is not null and global_budget_micros is not null))
);
insert into private.model_config(singleton) values(true);
create table private.admin_binding (
  singleton boolean primary key default true check (singleton), user_id uuid not null unique,
  google_subject text not null unique, created_at timestamptz not null default now()
);
create table private.admin_audit (
  id bigint generated always as identity primary key, actor_id uuid not null, action text not null,
  config_revision bigint not null, created_at timestamptz not null default now()
);
create table private.usage_reservations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, request_id uuid not null,
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'), config_revision bigint not null,
  status text not null check (status in ('reserved','succeeded','failed','ambiguous')),
  reserved_micros bigint not null check (reserved_micros > 0), actual_micros bigint check (actual_micros >= 0),
  result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,request_id), check (result is null or octet_length(result::text) <= 65536)
);
create index usage_owner_time on private.usage_reservations(owner_id,created_at);

-- The callers of the following privileged functions MUST independently verify
-- a live session, verified Google identity, subject binding, recent auth,
-- approved catalog and server-derived price estimate before using them.
create function public.hp_admin_binding() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId',user_id,'googleSubject',google_subject) from private.admin_binding where singleton
$$;
create function public.hp_model_config_get() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision',revision,'enabled',enabled,'adapterId',adapter_id,'modelId',model_id,
    'connectionRef',connection_ref,'limits',limits,'globalBudgetMicros',global_budget_micros) from private.model_config where singleton
$$;
create function public.hp_model_config_update(p_actor uuid, p_google_subject text, p_revision bigint, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.model_config;
begin
  if not exists(select 1 from private.admin_binding where singleton and user_id=p_actor and google_subject=p_google_subject) then raise exception 'HP_NOT_FOUND'; end if;
  select * into c from private.model_config where singleton for update;
  if c.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  if jsonb_typeof(p_config) <> 'object' or jsonb_typeof(p_config->'enabled') <> 'boolean' or jsonb_typeof(p_config->'limits') <> 'object' then raise exception 'HP_INVALID'; end if;
  update private.model_config set revision=revision+1,enabled=(p_config->>'enabled')::boolean,adapter_id=p_config->>'adapterId',
    model_id=p_config->>'modelId',connection_ref=p_config->>'connectionRef',limits=p_config->'limits',
    global_budget_micros=(p_config->>'globalBudgetMicros')::bigint,updated_at=now() where singleton returning * into c;
  insert into private.admin_audit(actor_id,action,config_revision) values(p_actor,'model_config_update',c.revision);
  return public.hp_model_config_get();
end $$;

create function public.hp_reserve_usage(p_user_id uuid,p_request_id uuid,p_body_hash text,p_config_revision bigint,p_max_cost_micros bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.model_config; r private.usage_reservations; spent numeric;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('global-usage',0));
  select * into r from private.usage_reservations where owner_id=p_user_id and request_id=p_request_id;
  if found then
    if r.body_hash <> p_body_hash then raise exception 'HP_CONFLICT'; end if;
    return jsonb_build_object('reservationId',r.id,'status',r.status,'result',r.result,'replay',true);
  end if;
  select * into c from private.model_config where singleton for update;
  if not found or not c.enabled or c.revision <> p_config_revision or c.global_budget_micros is null or p_max_cost_micros is null or p_max_cost_micros <= 0 then raise exception 'HP_INVALID'; end if;
  if (select count(*) from private.usage_reservations where owner_id=p_user_id and created_at > now()-interval '1 minute') >= least(coalesce((c.limits->>'requestsPerMinute')::int,0),5)
    or (select count(*) from private.usage_reservations where owner_id=p_user_id and created_at > now()-interval '1 day') >= least(coalesce((c.limits->>'requestsPerDay')::int,0),20)
    or exists(select 1 from private.usage_reservations where owner_id=p_user_id and status in ('reserved','ambiguous')) then raise exception 'HP_QUOTA'; end if;
  -- Global cap is a lifetime budget until an explicitly reviewed reset mechanism exists.
  select coalesce(sum(case when status in ('reserved','ambiguous') then reserved_micros when status='succeeded' then actual_micros else 0 end),0) into spent from private.usage_reservations;
  if spent + p_max_cost_micros > c.global_budget_micros then raise exception 'HP_QUOTA'; end if;
  insert into private.usage_reservations(owner_id,request_id,body_hash,config_revision,status,reserved_micros)
    values(p_user_id,p_request_id,p_body_hash,p_config_revision,'reserved',p_max_cost_micros) returning * into r;
  return jsonb_build_object('reservationId',r.id,'status',r.status,'result',null,'replay',false);
end $$;

create function public.hp_finalize_usage(p_user_id uuid,p_reservation_id uuid,p_status text,p_actual_micros bigint,p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.usage_reservations;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('global-usage',0));
  select * into r from private.usage_reservations where id=p_reservation_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if r.status <> 'reserved' then return jsonb_build_object('status',r.status,'result',r.result); end if;
  if p_status not in ('succeeded','failed','ambiguous') or (p_status='succeeded' and (p_actual_micros is null or p_actual_micros < 0 or p_result is null))
    or (p_status <> 'succeeded' and (p_actual_micros is not null or p_result is not null)) then raise exception 'HP_INVALID'; end if;
  update private.usage_reservations set status=p_status,actual_micros=p_actual_micros,result=p_result,updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('status',r.status,'result',r.result);
end $$;

create function private.validate_photo_ids(p_user_id uuid, p_design_id uuid, p_body jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if jsonb_typeof(p_body->'photoIds') <> 'array' or jsonb_array_length(p_body->'photoIds') > 100 then raise exception 'HP_INVALID'; end if;
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into ids from jsonb_array_elements_text(p_body->'photoIds') x;
  if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception 'HP_INVALID'; end if;
  if cardinality(ids) <> (select count(*) from public.design_photos p where p.owner_id = p_user_id and p.design_id = p_design_id and p.status = 'ready' and p.id = any(ids)) then
    raise exception 'HP_INVALID';
  end if;
  return ids;
end $$;

create function private.design_document(d public.designs) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'schemaVersion',d.schema_version,'payload',d.payload,
    'photoManifest',coalesce((select jsonb_agg(jsonb_build_object('photoId',p.id,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum) order by x.ord)
      from unnest(d.photo_ids) with ordinality x(id,ord) join public.design_photos p on p.id=x.id and p.owner_id=d.owner_id and p.design_id=d.id and p.status='ready'), '[]'::jsonb),
    'revision',d.revision,'createdAt',d.created_at,'updatedAt',d.updated_at)
$$;

create function public.hp_create_design(p_user_id uuid, p_key uuid, p_body_hash text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare prev private.design_idempotency; d public.designs; result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('design:' || p_user_id::text, 0));
  select * into prev from private.design_idempotency where owner_id=p_user_id and endpoint='create' and key=p_key;
  if found then
    if prev.body_hash <> p_body_hash then raise exception 'HP_CONFLICT'; end if;
    return prev.response;
  end if;
  perform private.save_guard(p_user_id);
  if (select count(*) from public.designs where owner_id=p_user_id and deleted_at is null) >= 100 then raise exception 'HP_QUOTA'; end if;
  if jsonb_typeof(p_body->'photoIds') <> 'array' or jsonb_array_length(p_body->'photoIds') <> 0 then raise exception 'HP_INVALID'; end if;
  insert into public.designs(owner_id,kind,title,schema_version,payload)
    values (p_user_id,p_body->>'kind',p_body->>'title',(p_body->>'schemaVersion')::integer,p_body->'payload') returning * into d;
  result := jsonb_build_object('design',private.design_document(d),'revision',d.revision);
  insert into private.design_idempotency(owner_id,key,endpoint,body_hash,response) values(p_user_id,p_key,'create',p_body_hash,result);
  return result;
end $$;

create function public.hp_update_design(p_user_id uuid, p_id uuid, p_revision bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.designs; ids uuid[];
begin
  perform private.save_guard(p_user_id);
  select * into d from public.designs where id=p_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if d.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  ids := private.validate_photo_ids(p_user_id,p_id,p_body);
  update public.designs set kind=p_body->>'kind',title=p_body->>'title',schema_version=(p_body->>'schemaVersion')::integer,
    payload=p_body->'payload',photo_ids=ids,revision=revision+1,updated_at=now() where id=p_id returning * into d;
  return jsonb_build_object('design',private.design_document(d),'revision',d.revision);
end $$;

create function public.hp_delete_design(p_user_id uuid, p_id uuid, p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.designs;
begin
  perform private.save_guard(p_user_id);
  select * into d from public.designs where id=p_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if d.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  update public.designs set deleted_at=now(),updated_at=now(),revision=revision+1 where id=p_id;
end $$;

-- No client may invoke privileged entry points, even via the direct REST API.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.session_live() to authenticated;
revoke all on function public.hp_session_active(uuid,uuid), public.hp_create_design(uuid,uuid,text,jsonb),
  public.hp_update_design(uuid,uuid,bigint,jsonb), public.hp_delete_design(uuid,uuid,bigint),
  public.hp_reserve_photo(uuid,uuid,text,bigint,text), public.hp_photo_ready(uuid,uuid,uuid,text,bigint,text),
  public.hp_photo_raw_removed(uuid,uuid,uuid), public.hp_admin_binding(), public.hp_model_config_get(),
  public.hp_model_config_update(uuid,text,bigint,jsonb), public.hp_reserve_usage(uuid,uuid,text,bigint,bigint),
  public.hp_finalize_usage(uuid,uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.hp_session_active(uuid,uuid), public.hp_create_design(uuid,uuid,text,jsonb),
  public.hp_update_design(uuid,uuid,bigint,jsonb), public.hp_delete_design(uuid,uuid,bigint),
  public.hp_reserve_photo(uuid,uuid,text,bigint,text), public.hp_photo_ready(uuid,uuid,uuid,text,bigint,text),
  public.hp_photo_raw_removed(uuid,uuid,uuid), public.hp_admin_binding(), public.hp_model_config_get(),
  public.hp_model_config_update(uuid,text,bigint,jsonb), public.hp_reserve_usage(uuid,uuid,text,bigint,bigint),
  public.hp_finalize_usage(uuid,uuid,text,bigint,jsonb) to service_role;

