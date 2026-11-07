-- Recovery is local to the authenticated owner and is driven by application
-- requests. A pending reservation lives for one hour plus a one-hour grace;
-- an unreferenced ready photo lives for at least 24 hours after readiness.
-- Explicitly deleted designs may release ready photos immediately, but pending
-- reservations still receive the full expiry and grace period.
alter table public.design_photos add column ready_at timestamptz;
update public.design_photos set ready_at=clock_timestamp() where status='ready';

-- This table is never visible through the Data API. Completing tokens fence
-- writes; cleanup modes are irreversible until the relevant object is gone.
create table private.photo_work (
  photo_id uuid primary key references public.design_photos(id) on delete cascade,
  mode text not null check (mode in ('completing','raw','delete')),
  token uuid not null,
  lease_until timestamptz not null,
  raw_required boolean, ready_required boolean,
  raw_verified boolean not null default false, ready_verified boolean not null default false
);
revoke all on private.photo_work from public, anon, authenticated;

-- Storage performs permission probes before uploading. This trigger also runs
-- on the actual metadata write, including writes made by the service role. It
-- serializes that write with deletion, manifest changes and recovery claims.
-- It must be exercised against the deployed Storage version before release.
create function private.fence_photo_storage_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; d public.designs; w private.photo_work; header_token text;
begin
  if tg_op='UPDATE' and old.bucket_id='design-photos'
     and (new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name) then
    raise exception 'HP_INVALID';
  end if;
  if new.bucket_id <> 'design-photos' then return new; end if;
  if pg_catalog.split_part(new.name,'/',3) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'HP_INVALID'; end if;
  select * into p from public.design_photos where id=pg_catalog.split_part(new.name,'/',3)::uuid;
  if not found then raise exception 'HP_INVALID'; end if;
  if new.name <> p.raw_key and new.name <> p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready' then raise exception 'HP_INVALID'; end if;
  select * into d from public.designs where id=p.design_id and owner_id=p.owner_id for update;
  if not found or d.deleted_at is not null then raise exception 'HP_INVALID'; end if;
  select * into p from public.design_photos where id=p.id for update;
  if not found then raise exception 'HP_INVALID'; end if;
  select * into w from private.photo_work where photo_id=p.id;
  if new.name=p.raw_key then
    if p.status <> 'pending' or p.expires_at <= clock_timestamp()
       or (w.mode is not null and w.mode <> 'completing')
       or auth.uid() is distinct from p.owner_id or not private.session_live() then
      raise exception 'HP_INVALID';
    end if;
  else
    header_token := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-hp-completion';
    if p.status <> 'pending' or p.expires_at <= clock_timestamp()
       or w.mode is distinct from 'completing' or w.lease_until <= clock_timestamp()
       or header_token is distinct from w.token::text then raise exception 'HP_INVALID'; end if;
  end if;
  return new;
end $$;
revoke all on function private.fence_photo_storage_write() from public, anon, authenticated;
create trigger homeplanner_photo_write_fence before insert or update on storage.objects
  for each row execute function private.fence_photo_storage_write();

-- Old RPCs have no claim token and must not be used after this migration.
revoke execute on function public.hp_photo_ready(uuid,uuid,uuid,text,bigint,text),
  public.hp_photo_raw_removed(uuid,uuid,uuid) from service_role;

create function public.hp_begin_photo_completion(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; w private.photo_work;
begin
  if p_token is null then raise exception 'HP_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
  perform 1 from public.designs where id=p_design_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into p from public.design_photos where id=p_photo_id and design_id=p_design_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into w from private.photo_work where photo_id=p.id for update;
  if w.mode='delete' then raise exception 'HP_NOT_FOUND'; end if;
  if p.status='ready' then
    return jsonb_build_object('id',p.id,'status',p.status,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum);
  end if;
  if p.expires_at <= clock_timestamp() then raise exception 'HP_CONFLICT'; end if;
  if w.mode is not null and (w.mode <> 'completing' or w.lease_until > clock_timestamp()) then raise exception 'HP_CONFLICT'; end if;
  insert into private.photo_work(photo_id,mode,token,lease_until) values(p.id,'completing',p_token,clock_timestamp()+interval '5 minutes')
    on conflict(photo_id) do update set mode=excluded.mode,token=excluded.token,lease_until=excluded.lease_until;
  return jsonb_build_object('id',p.id,'status',p.status,'raw_key',p.raw_key,'requested_mime',p.requested_mime,
    'requested_bytes',p.requested_bytes,'requested_checksum',p.requested_checksum);
end $$;

create function public.hp_finish_photo_completion(p_user_id uuid,p_design_id uuid,p_photo_id uuid,p_token uuid,p_key text,p_bytes bigint,p_checksum text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; w private.photo_work;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
  perform 1 from public.designs where id=p_design_id and owner_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into p from public.design_photos where id=p_photo_id and design_id=p_design_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into w from private.photo_work where photo_id=p.id for update;
  if p.status <> 'pending' or w.mode is distinct from 'completing' or w.token is distinct from p_token
     or w.lease_until <= clock_timestamp() or p.expires_at <= clock_timestamp() then raise exception 'HP_CONFLICT'; end if;
  if p_key is distinct from p_user_id::text||'/'||p_design_id::text||'/'||p_photo_id::text||'/ready'
     or p_bytes is null or p_bytes not between 1 and 10485760 or p_checksum is null or p_checksum !~ '^[a-f0-9]{64}$' then raise exception 'HP_INVALID'; end if;
  if not exists(select 1 from storage.objects where bucket_id='design-photos' and name=p_key) then raise exception 'HP_CONFLICT'; end if;
  update public.design_photos set status='ready',object_key=p_key,mime=requested_mime,bytes=p_bytes,checksum=p_checksum,ready_at=clock_timestamp()
    where id=p.id returning * into p;
  delete from private.photo_work where photo_id=p.id;
  return jsonb_build_object('photoId',p.id,'mime',p.mime,'bytes',p.bytes,'checksum',p.checksum);
end $$;

-- The design row lock in hp_update_design serializes manifest updates with a
-- delete claim; a claimed photo cannot be added to a later manifest.
create or replace function private.validate_photo_ids(p_user_id uuid,p_design_id uuid,p_body jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if jsonb_typeof(p_body->'photoIds') <> 'array' or jsonb_array_length(p_body->'photoIds') > 100 then raise exception 'HP_INVALID'; end if;
  select coalesce(array_agg(x::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_body->'photoIds') x;
  if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception 'HP_INVALID'; end if;
  if cardinality(ids) <> (select count(*) from public.design_photos p where p.owner_id=p_user_id and p.design_id=p_design_id and p.status='ready' and p.id=any(ids)
      and not exists(select 1 from private.photo_work w where w.photo_id=p.id and w.mode='delete')) then raise exception 'HP_INVALID'; end if;
  return ids;
end $$;

-- Replaying the same explicit delete completes cleanup after a lost response.
create or replace function public.hp_delete_design(p_user_id uuid,p_id uuid,p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.designs;
begin
  perform private.save_guard(p_user_id);
  select * into d from public.designs where id=p_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  if d.deleted_at is not null then
    if d.revision=p_revision+1 then return; end if;
    raise exception 'HP_CONFLICT';
  end if;
  if d.revision <> p_revision then raise exception 'HP_CONFLICT'; end if;
  update public.designs set deleted_at=now(),updated_at=now(),revision=revision+1 where id=p_id;
end $$;

create function public.hp_claim_photo_cleanup(p_user_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate record; p public.design_photos; d public.designs; w private.photo_work; new_mode text;
  raw_required boolean; ready_required boolean; raw_verified boolean; ready_verified boolean; ready_key text;
begin
  if p_user_id is null or p_token is null then raise exception 'HP_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
  for candidate in
    select x.id,x.design_id from public.design_photos x join public.designs y on y.id=x.design_id and y.owner_id=x.owner_id
      left join private.photo_work q on q.photo_id=x.id
    where x.owner_id=p_user_id and (q.mode in ('raw','delete') or
      (x.status='pending' and x.expires_at+interval '1 hour' <= clock_timestamp()) or
      (x.status='ready' and (y.deleted_at is not null or x.raw_removed_at is null or
        (x.ready_at+interval '24 hours' <= clock_timestamp() and not x.id=any(y.photo_ids)))))
      and (q.photo_id is null or q.lease_until <= clock_timestamp())
    order by case when q.mode is not null then 0 when y.deleted_at is not null then 1 else 2 end,x.created_at,x.id
    limit 32
  loop
    select * into d from public.designs where id=candidate.design_id and owner_id=p_user_id for update;
    select * into p from public.design_photos where id=candidate.id and owner_id=p_user_id for update;
    if p.id is null then continue; end if;
    select * into w from private.photo_work where photo_id=p.id for update;
    if w.photo_id is not null and w.lease_until > clock_timestamp() then continue; end if;
    if w.mode in ('raw','delete') then new_mode:=w.mode;
    elsif p.status='pending' and p.expires_at+interval '1 hour' <= clock_timestamp() then new_mode:='delete';
    elsif p.status='ready' and (d.deleted_at is not null or (p.ready_at+interval '24 hours' <= clock_timestamp() and not p.id=any(d.photo_ids))) then new_mode:='delete';
    elsif p.status='ready' and p.raw_removed_at is null then new_mode:='raw';
    else continue; end if;
    ready_key:=p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready';
    if w.mode in ('raw','delete') then
      raw_required:=w.raw_required; ready_required:=w.ready_required;
      raw_verified:=w.raw_verified; ready_verified:=w.ready_verified;
    else
      -- A ready photo necessarily had raw bytes. A legacy removal may have
      -- lost its response after metadata disappeared, so do not infer success
      -- from absence unless the old raw-removed marker was already recorded.
      raw_required:=(p.status='ready' and p.raw_removed_at is null)
        or exists(select 1 from storage.objects where bucket_id='design-photos' and name=p.raw_key);
      ready_required:=new_mode='delete' and exists(select 1 from storage.objects where bucket_id='design-photos' and name=ready_key);
      raw_verified:=false; ready_verified:=new_mode='raw';
    end if;
    insert into private.photo_work(photo_id,mode,token,lease_until,raw_required,ready_required,raw_verified,ready_verified)
      values(p.id,new_mode,p_token,clock_timestamp()+interval '5 minutes',raw_required,ready_required,raw_verified,ready_verified)
      on conflict(photo_id) do update set mode=excluded.mode,token=excluded.token,lease_until=excluded.lease_until,
        raw_required=excluded.raw_required,ready_required=excluded.ready_required,raw_verified=excluded.raw_verified,ready_verified=excluded.ready_verified;
    return jsonb_build_object('photoId',p.id,'designId',p.design_id,'rawKey',p.raw_key,
      'readyKey',ready_key,'mode',new_mode,'rawRequired',raw_required,'readyRequired',ready_required,
      'rawVerified',raw_verified,'readyVerified',ready_verified);
  end loop;
  return null;
end $$;

-- The server records each independently acknowledged removal immediately.
-- A lost/ambiguous response for an object known to exist remains held: later
-- metadata absence cannot establish whether the backend bytes were deleted.
create function public.hp_record_photo_removal(p_user_id uuid,p_photo_id uuid,p_token uuid,p_part text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; w private.photo_work; key text;
begin
  if p_part is null or p_part not in ('raw','ready') then raise exception 'HP_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
  select * into p from public.design_photos where id=p_photo_id and owner_id=p_user_id;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  perform 1 from public.designs where id=p.design_id and owner_id=p_user_id for update;
  select * into p from public.design_photos where id=p_photo_id and owner_id=p_user_id for update;
  if not found then raise exception 'HP_NOT_FOUND'; end if;
  select * into w from private.photo_work where photo_id=p.id for update;
  if w.mode not in ('raw','delete') or w.token is distinct from p_token or w.lease_until <= clock_timestamp()
     or (p_part='ready' and w.mode<>'delete') then raise exception 'HP_CONFLICT'; end if;
  key:=case when p_part='raw' then p.raw_key else p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready' end;
  if exists(select 1 from storage.objects where bucket_id='design-photos' and name=key) then raise exception 'HP_CONFLICT'; end if;
  update private.photo_work set raw_verified=case when p_part='raw' then true else raw_verified end,
    ready_verified=case when p_part='ready' then true else ready_verified end where photo_id=p.id;
end $$;

create function public.hp_finish_photo_cleanup(p_user_id uuid,p_photo_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.design_photos; w private.photo_work;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('photos:'||p_user_id::text,0));
  select * into p from public.design_photos where id=p_photo_id and owner_id=p_user_id;
  if not found then return; end if;
  perform 1 from public.designs where id=p.design_id and owner_id=p_user_id for update;
  select * into p from public.design_photos where id=p_photo_id and owner_id=p_user_id for update;
  if not found then return; end if;
  select * into w from private.photo_work where photo_id=p.id for update;
  if w.mode not in ('raw','delete') or w.token is distinct from p_token or w.lease_until <= clock_timestamp()
    or not w.raw_verified or (w.mode='delete' and not w.ready_verified) then raise exception 'HP_CONFLICT'; end if;
  if exists(select 1 from storage.objects where bucket_id='design-photos' and
      (name=p.raw_key or (w.mode='delete' and name=p.owner_id::text||'/'||p.design_id::text||'/'||p.id::text||'/ready'))) then
    raise exception 'HP_CONFLICT';
  end if;
  if w.mode='raw' then
    if p.status <> 'ready' then raise exception 'HP_CONFLICT'; end if;
    update public.design_photos set raw_removed_at=clock_timestamp(),allocation_bytes=bytes where id=p.id;
    delete from private.photo_work where photo_id=p.id;
  else
    delete from public.design_photos where id=p.id;
  end if;
end $$;

revoke all on function public.hp_begin_photo_completion(uuid,uuid,uuid,uuid),
  public.hp_finish_photo_completion(uuid,uuid,uuid,uuid,text,bigint,text),
  public.hp_claim_photo_cleanup(uuid,uuid),public.hp_record_photo_removal(uuid,uuid,uuid,text),public.hp_finish_photo_cleanup(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hp_begin_photo_completion(uuid,uuid,uuid,uuid),
  public.hp_finish_photo_completion(uuid,uuid,uuid,uuid,text,bigint,text),
  public.hp_claim_photo_cleanup(uuid,uuid),public.hp_record_photo_removal(uuid,uuid,uuid,text),public.hp_finish_photo_cleanup(uuid,uuid,uuid) to service_role;
