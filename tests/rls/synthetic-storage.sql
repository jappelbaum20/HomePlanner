-- ONLY for the synthetic Storage table in stage-b-local-postgres.cjs.
-- Never execute SQL INSERTs against a real storage.objects table: Storage
-- metadata and the underlying object service would become inconsistent.
begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into auth.sessions(id,user_id) values('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.hp_create_design('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',repeat('a',64),
 '{"kind":"shelf","title":"A","schemaVersion":3,"payload":{},"photoIds":[]}'::jsonb);
select public.hp_reserve_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id,'image/png',1,repeat('a',64)) from public.designs;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","app_metadata":{"provider":"google"}}',true);
insert into storage.objects(bucket_id,name) select 'design-photos',raw_key from public.design_photos;
do $$ begin
  begin
    insert into storage.objects(bucket_id,name) values('design-photos','forged/key');
    raise exception 'forged storage path unexpectedly accepted';
  exception when insufficient_privilege then null;
    when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  if has_table_privilege('authenticated','storage.objects','select,update,delete') then raise exception 'unexpected synthetic Storage grant'; end if;
end $$;
reset role;
rollback;
