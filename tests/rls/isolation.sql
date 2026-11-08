-- Run only against a newly created, disposable LOCAL Supabase database after
-- applying the migration. This is an actual PostgreSQL/RLS test, not a mock.
-- It creates synthetic auth fixtures within a transaction and rolls them back.
-- It does not test Storage HTTP uploads, parallel transactions or Google OAuth.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','a@example.invalid','',now(),now(),now(),'{"provider":"google"}','{}'),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','b@example.invalid','',now(),now(),now(),'{"provider":"google"}','{}');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now()),
 ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now());

select public.hp_create_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',repeat('a',64),
 '{"kind":"shelf","title":"A","schemaVersion":3,"payload":{},"photoIds":[]}'::jsonb);
select public.hp_create_design('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',repeat('b',64),
 '{"kind":"shelf","title":"B","schemaVersion":3,"payload":{},"photoIds":[]}'::jsonb);

do $$ declare target uuid; body jsonb := '{"kind":"shelf","title":"A","schemaVersion":3,"payload":{},"photoIds":[]}'::jsonb; begin
  select id into target from public.designs where owner_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    update public.designs set owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id=target;
    raise exception 'owner mutation unexpectedly succeeded';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  perform public.hp_update_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,1,body);
  begin
    perform public.hp_update_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,1,body);
    raise exception 'stale CAS unexpectedly succeeded';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  begin
    perform public.hp_create_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',repeat('c',64),body);
    raise exception 'idempotency mismatch unexpectedly succeeded';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
end $$;

do $$ declare target uuid; photo jsonb; body jsonb; begin
  select id into target from public.designs where owner_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  photo := public.hp_reserve_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,'image/png',1,repeat('a',64));
  body := jsonb_build_object('kind','shelf','title','A','schemaVersion',3,'payload','{}'::jsonb,'photoIds',jsonb_build_array(photo->>'photoId'));
  begin
    perform public.hp_update_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,2,body);
    raise exception 'pending photo unexpectedly accepted';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  for i in 1..11 loop perform public.hp_reserve_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,'image/png',1,repeat('a',64)); end loop;
  begin
    perform public.hp_reserve_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target,'image/png',1,repeat('a',64));
    raise exception 'photo quota unexpectedly exceeded';
  exception when others then if sqlerrm <> 'HP_QUOTA' then raise; end if; end;
end $$;

do $$ declare r jsonb; replay jsonb; begin
  update private.model_config set enabled=true, adapter_id='fixture',model_id='fixture',connection_ref='fixture',global_budget_micros=1000 where singleton;
  r := public.hp_reserve_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',repeat('a',64),1,100);
  replay := public.hp_reserve_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',repeat('a',64),1,100);
  if replay->>'reservationId' <> r->>'reservationId' or (replay->>'replay')::boolean is not true then raise exception 'usage replay failed'; end if;
  begin
    perform public.hp_reserve_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',repeat('b',64),1,100);
    raise exception 'usage hash mismatch unexpectedly accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  begin
    perform public.hp_reserve_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa',repeat('a',64),1,100);
    raise exception 'second active usage unexpectedly accepted';
  exception when others then if sqlerrm <> 'HP_QUOTA' then raise; end if; end;
  perform public.hp_finalize_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(r->>'reservationId')::uuid,'succeeded',80,'{"ok":true}'::jsonb);
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","app_metadata":{"provider":"google"}}',true);
do $$ begin
  if (select count(*) from public.designs) <> 1 or exists(select 1 from public.designs where title='B') then raise exception 'owner A RLS failed'; end if;
  if has_table_privilege('authenticated','public.designs','insert,update,delete') then raise exception 'direct mutation grant'; end if;
  if has_function_privilege('authenticated','public.hp_create_design(uuid,uuid,text,jsonb)','execute') then raise exception 'privileged RPC grant'; end if;
  if has_table_privilege('authenticated','private.model_config','select') then raise exception 'private table grant'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","session_id":"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb","app_metadata":{"provider":"google"}}',true);
do $$ begin
  if (select count(*) from public.designs) <> 1 or exists(select 1 from public.designs where title='A') then raise exception 'owner B RLS failed'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","app_metadata":{"provider":"google"}}',true);
do $$ begin if exists(select 1 from public.designs) then raise exception 'foreign session accepted'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","app_metadata":{"provider":"email"},"user_metadata":{"isAdmin":true}}',true);
do $$ begin if exists(select 1 from public.designs) then raise exception 'non-Google provider accepted'; end if; end $$;
reset role;
set local role anon;
do $$ begin
  if has_table_privilege('anon','public.designs','select') or has_function_privilege('anon','public.hp_create_design(uuid,uuid,text,jsonb)','execute') then raise exception 'anonymous grant'; end if;
end $$;
reset role;
rollback;
