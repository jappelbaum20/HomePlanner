-- Only the server may call this after validating the active Supabase session,
-- Google signature/audience/nonce/recent-auth and linked provider subject.
create function public.hp_admin_bootstrap(p_user_id uuid, p_google_subject text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b private.admin_binding; rev bigint;
begin
  if p_user_id is null or p_google_subject is null or p_google_subject !~ '^[!-~]{1,255}$' then raise exception 'HP_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('homeplanner-admin-bootstrap',0));
  select * into b from private.admin_binding where singleton;
  if found then
    if b.user_id <> p_user_id or b.google_subject <> p_google_subject then raise exception 'HP_NOT_FOUND'; end if;
  else
    insert into private.admin_binding(singleton,user_id,google_subject) values(true,p_user_id,p_google_subject) returning * into b;
    select revision into rev from private.model_config where singleton;
    insert into private.admin_audit(actor_id,action,config_revision) values(p_user_id,'admin_bootstrap',rev);
  end if;
  return jsonb_build_object('userId',b.user_id,'googleSubject',b.google_subject);
end $$;

-- Read-only replay lookup preserves prior terminal responses even after a model
-- is disabled or changed. It cannot create a reservation or grant access.
create function public.hp_usage_replay(p_user_id uuid, p_request_id uuid, p_body_hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r private.usage_reservations;
begin
  select * into r from private.usage_reservations where owner_id=p_user_id and request_id=p_request_id;
  if not found then return null; end if;
  if r.body_hash <> p_body_hash then raise exception 'HP_CONFLICT'; end if;
  return jsonb_build_object('reservationId',r.id,'status',r.status,'result',r.result,'replay',true);
end $$;
revoke all on function public.hp_admin_bootstrap(uuid,text), public.hp_usage_replay(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.hp_admin_bootstrap(uuid,text), public.hp_usage_replay(uuid,uuid,text) to service_role;
