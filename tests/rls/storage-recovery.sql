-- ONLY for the synthetic Storage fixture in storage-recovery.test.cjs.
-- Its metadata inserts/deletes must never run on a real Storage database.
begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into auth.sessions(id,user_id) values('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","session_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","app_metadata":{"provider":"google"}}',true);
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; other_user uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  d uuid; foreign_d uuid; pending uuid; ready uuid; abandoned uuid; r jsonb; c jsonb; key text;
  t1 uuid:='11111111-1111-4111-8111-111111111111'; t2 uuid:='22222222-2222-4222-8222-222222222222';
  body jsonb:='{"kind":"shelf","title":"A","schemaVersion":3,"payload":{},"photoIds":[]}'::jsonb;
begin
  insert into public.designs(owner_id,kind,title,schema_version,payload) values(u,'shelf','A',3,'{}') returning id into d;
  insert into public.designs(owner_id,kind,title,schema_version,payload) values(other_user,'shelf','B',3,'{}') returning id into foreign_d;
  r:=public.hp_reserve_photo(u,d,'image/png',1,repeat('a',64)); pending:=(r->>'photoId')::uuid;
  insert into storage.objects(bucket_id,name) values('design-photos',r->>'rawKey');
  update public.design_photos set expires_at=clock_timestamp()-interval '59 minutes' where id=pending;
  if public.hp_claim_photo_cleanup(u,t1) is not null then raise exception 'pending grace ignored'; end if;
  update public.design_photos set expires_at=clock_timestamp()-interval '61 minutes' where id=pending;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if c->>'mode'<>'delete' or (c->>'photoId')::uuid<>pending then raise exception 'expired reservation not claimed'; end if;
  if public.hp_claim_photo_cleanup(other_user,t2) is not null then raise exception 'cross owner claim'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('design-photos',r->>'rawKey');
    raise exception 'retiring upload accepted';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  begin
    perform public.hp_finish_photo_cleanup(u,pending,t2);
    raise exception 'wrong cleanup token accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  begin
    perform public.hp_finish_photo_cleanup(u,pending,t1);
    raise exception 'allocated object still exists';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  if (select allocation_bytes from public.design_photos where id=pending)<>20971520 then raise exception 'premature quota release'; end if;
  update private.photo_work set lease_until=clock_timestamp()-interval '1 second' where photo_id=pending;
  c:=public.hp_claim_photo_cleanup(u,t2);
  if c->>'mode'<>'delete' then raise exception 'cleanup retry failed'; end if;
  if (c->>'rawRequired')::boolean is not true or (c->>'readyRequired')::boolean is not false then raise exception 'required object snapshot lost'; end if;
  begin
    perform public.hp_finish_photo_cleanup(u,pending,t1);
    raise exception 'stale cleanup token accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  delete from storage.objects where name=r->>'rawKey'; -- stub only; stands for verified API removal
  perform public.hp_record_photo_removal(u,pending,t2,'raw');
  update private.photo_work set lease_until=clock_timestamp()-interval '1 second' where photo_id=pending;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if (c->>'rawVerified')::boolean is not true or (c->>'rawRequired')::boolean is not true then raise exception 'partial removal proof lost on retry'; end if;
  perform public.hp_record_photo_removal(u,pending,t1,'ready');
  perform public.hp_finish_photo_cleanup(u,pending,t1);
  if exists(select 1 from public.design_photos where id=pending) then raise exception 'quota not released'; end if;

  r:=public.hp_reserve_photo(u,d,'image/png',1,repeat('a',64)); ready:=(r->>'photoId')::uuid;
  perform public.hp_begin_photo_completion(u,d,ready,t1);
  begin
    perform public.hp_begin_photo_completion(u,d,ready,t2);
    raise exception 'parallel completion accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  key:=u::text||'/'||d::text||'/'||ready::text||'/ready';
  begin
    perform public.hp_finish_photo_completion(u,d,ready,t1,key,1,repeat('a',64));
    raise exception 'missing ready object accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  perform set_config('request.headers',jsonb_build_object('x-hp-completion',t1::text)::text,true);
  insert into storage.objects(bucket_id,name) values('design-photos',key);
  update private.photo_work set lease_until=clock_timestamp()-interval '1 second' where photo_id=ready;
  perform public.hp_begin_photo_completion(u,d,ready,t2);
  begin
    insert into storage.objects(bucket_id,name) values('design-photos',key);
    raise exception 'stale completion write accepted';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  begin
    perform public.hp_finish_photo_completion(u,d,ready,t1,key,1,repeat('a',64));
    raise exception 'stale completion accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  perform public.hp_finish_photo_completion(u,d,ready,t2,key,1,repeat('a',64));
  body:=jsonb_set(body,'{photoIds}',jsonb_build_array(ready));
  perform public.hp_update_design(u,d,1,body);
  update public.design_photos set ready_at=clock_timestamp()-interval '25 hours' where id=ready;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if c->>'mode'<>'raw' then raise exception 'referenced ready photo should retain ready object'; end if;
  if (c->>'rawRequired')::boolean is not true then raise exception 'unmarked legacy removal treated as proved'; end if;
  perform public.hp_record_photo_removal(u,ready,t1,'raw');
  perform public.hp_finish_photo_cleanup(u,ready,t1);
  if (select allocation_bytes from public.design_photos where id=ready)<>1 then raise exception 'raw quota not reduced'; end if;
  if public.hp_claim_photo_cleanup(u,t2) is not null then raise exception 'referenced ready photo selected'; end if;

  r:=public.hp_reserve_photo(u,d,'image/png',1,repeat('b',64)); abandoned:=(r->>'photoId')::uuid;
  perform public.hp_begin_photo_completion(u,d,abandoned,t1);
  key:=u::text||'/'||d::text||'/'||abandoned::text||'/ready';
  perform set_config('request.headers',jsonb_build_object('x-hp-completion',t1::text)::text,true);
  insert into storage.objects(bucket_id,name) values('design-photos',key);
  perform public.hp_finish_photo_completion(u,d,abandoned,t1,key,1,repeat('b',64));
  update public.design_photos set ready_at=clock_timestamp()-interval '25 hours' where id=abandoned;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if c->>'mode'<>'delete' or (c->>'photoId')::uuid<>abandoned then raise exception 'unreferenced ready not claimed'; end if;
  body:=jsonb_set(body,'{photoIds}',jsonb_build_array(ready,abandoned));
  begin
    perform public.hp_update_design(u,d,2,body);
    raise exception 'manifest accepted retiring photo';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  delete from storage.objects where name=key; -- stub only
  perform public.hp_record_photo_removal(u,abandoned,t1,'raw');
  perform public.hp_record_photo_removal(u,abandoned,t1,'ready');
  perform public.hp_finish_photo_cleanup(u,abandoned,t1);
  perform public.hp_delete_design(u,d,2);
  perform public.hp_delete_design(u,d,2); -- lost-response replay
  begin
    perform public.hp_delete_design(u,d,1);
    raise exception 'stale delete replay accepted';
  exception when others then if sqlerrm <> 'HP_CONFLICT' then raise; end if; end;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if c->>'mode'<>'delete' or (c->>'photoId')::uuid<>ready then raise exception 'deleted design not claimed'; end if;
  delete from storage.objects where name=u::text||'/'||d::text||'/'||ready::text||'/ready'; -- stub only
  perform public.hp_record_photo_removal(u,ready,t1,'raw');
  perform public.hp_record_photo_removal(u,ready,t1,'ready');
  perform public.hp_finish_photo_cleanup(u,ready,t1);
  if exists(select 1 from public.design_photos where owner_id=u) then raise exception 'quota did not converge'; end if;
  insert into public.designs(owner_id,kind,title,schema_version,payload) values(u,'shelf','Pending',3,'{}') returning id into d;
  r:=public.hp_reserve_photo(u,d,'image/png',1,repeat('a',64)); pending:=(r->>'photoId')::uuid;
  perform public.hp_delete_design(u,d,1);
  if public.hp_claim_photo_cleanup(u,t1) is not null then raise exception 'deleted pending upload lost its grace'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('design-photos',r->>'rawKey');
    raise exception 'deleted design accepted late upload';
  exception when others then if sqlerrm <> 'HP_INVALID' then raise; end if; end;
  update public.design_photos set expires_at=clock_timestamp()-interval '61 minutes' where id=pending;
  c:=public.hp_claim_photo_cleanup(u,t1);
  if c->>'mode'<>'delete' then raise exception 'deleted pending upload did not become eligible'; end if;
  if has_function_privilege('authenticated','public.hp_claim_photo_cleanup(uuid,uuid)','execute')
     or has_function_privilege('anon','public.hp_finish_photo_cleanup(uuid,uuid,uuid)','execute')
     or has_function_privilege('service_role','public.hp_photo_ready(uuid,uuid,uuid,text,bigint,text)','execute') then raise exception 'RPC grant leak'; end if;
end $$;
rollback;
