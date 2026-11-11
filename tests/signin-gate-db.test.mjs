import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', fresh='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const os='11111111-1111-4111-8111-111111111111', us='22222222-2222-4222-8222-222222222222', fs='44444444-4444-4444-8444-444444444444';
const grant='a'.repeat(64), ip='b'.repeat(64), ip2='d'.repeat(64);
const ISS='https://accounts.google.com';
const sub=n=>String(n).repeat(64).slice(0,64);
const mig=async f=>await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8');
async function base(extra=false){
 const db=await PGlite.create();
 await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
 for(const f of ['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql','005_shelf_documents.sql']) await db.exec('BEGIN;\n'+await mig(f)+'\nCOMMIT;');
 for(const [u,s,subject] of [[owner,os,'owner-sub'],[user,us,'user-sub']]) {
  await db.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',[u,subject,u===owner?'jacob@appelbaums.com':subject+'@example.invalid']);
  await db.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())',[subject,u]);
  await db.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[s,'cookie-'+subject,u]);
 }
 await db.query('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)',[owner,'owner-sub']);
 await db.query('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')',[grant,owner,os,'owner-sub']);
 await db.exec('BEGIN;\n'+await mig('006_access_requests.sql')+'\nCOMMIT;');
 if(extra) await db.exec('BEGIN;\n'+await mig('007_verified_signin.sql')+'\nCOMMIT;');
 return db;
}
async function call(db,role,uid,sid,sql,args=[],g=''){
 await db.exec('BEGIN; SET LOCAL ROLE '+role);
 try {
  if(uid) await db.query("SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true),set_config('hp.admin_grant_hash',$3,true)",[uid,sid,g]);
  const r=await db.query(sql,args); await db.exec('COMMIT');return r.rows[0]?.x;
 } catch(e) { await db.exec('ROLLBACK'); throw e; }
}
const app=(d,u,s,sql,args=[],g='')=>call(d,'hp_app_runtime',u,s,sql,args,g);
const admin=(d,sql,args=[])=>app(d,owner,os,sql,args,grant);
const gate=(d,s,email='x@example.invalid')=>call(d,'hp_auth_runtime',null,null,'SELECT hp_app.hp_access_signin_gate($1,$2,$3) x',[ISS,s,email]);
const bind=(d,u,email)=>call(d,'hp_auth_runtime',null,null,'SELECT hp_app.hp_access_signin_bind($1,$2) x',[u,email]);
const status=(d,s,email)=>call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_handoff_status($1,$2,$3) x',[ISS,s,email]);
const list=d=>admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]);
const decide=async(d,id,rev,decision)=>admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',id,rev,decision]);
const subjectHash=s=>Buffer.from(s).toString('hex').padEnd(64,'0').slice(0,64);
const askS=(d,s,email,h=ip)=>call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_request_verified($1,$2,$3,$4,$5,$6) x',[ISS,s,email,'Applicant',h,subjectHash(s)]);
const createFresh=async(d,s,email,id=fresh)=>{
 await d.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',[id,s,email]);
 await d.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())',[s,id]);
 await d.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[fs,'cookie-'+s,id]);
};
const counts=async d=>Object.fromEntries(await Promise.all(['user','account','session'].map(async t=>[t,Number((await d.query('SELECT count(*) n FROM hp_auth."'+t+'"')).rows[0].n)])));

test('007 is additive: existing functions, policies, privileges and columns are unchanged',async()=>{
 const snap=async d=>({
  fns:(await d.query("SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k,md5(pg_get_functiondef(p.oid)) h FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('hp_app','hp_private','hp_auth') ORDER BY 1")).rows,
  privs:(await d.query("SELECT routine_schema||'.'||routine_name k,grantee,privilege_type FROM information_schema.routine_privileges WHERE routine_schema IN ('hp_app','hp_private','hp_auth') ORDER BY 1,2,3")).rows,
  pol:(await d.query("SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies ORDER BY 1,2,3")).rows,
  cols:(await d.query("SELECT table_schema||'.'||table_name t,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN ('hp_app','hp_private','hp_auth') ORDER BY 1,2")).rows,
  tabs:(await d.query("SELECT schemaname||'.'||tablename t FROM pg_tables WHERE schemaname IN ('hp_app','hp_private','hp_auth') ORDER BY 1")).rows
 });
 const d=await base(false);try{
  const before=await snap(d); await d.exec('BEGIN;\n'+await mig('007_verified_signin.sql')+'\nCOMMIT;'); const after=await snap(d);
  const names=new Set(after.fns.map(f=>f.k)); for(const f of before.fns) assert.ok(names.has(f.k),'dropped '+f.k);
  const now=new Map(after.fns.map(f=>[f.k,f.h])); for(const f of before.fns) assert.equal(now.get(f.k),f.h,'changed '+f.k);
  const added=after.fns.filter(f=>!before.fns.some(b=>b.k===f.k)).map(f=>f.k).sort();
  assert.deepEqual(added,['hp_app.hp_access_handoff_status(p_issuer text, p_subject text, p_email text)','hp_app.hp_access_request_verified(p_issuer text, p_subject text, p_email text, p_name text, p_ip_hash text, p_subject_hash text)','hp_app.hp_access_signin_bind(p_user uuid, p_email text)','hp_app.hp_access_signin_gate(p_issuer text, p_subject text, p_email text)','hp_private.access_subject_state(p_subject text, p_email text)','hp_private.access_wait(p_state jsonb)']);
  const kept=new Set(before.privs.map(p=>JSON.stringify(p))); const added2=after.privs.filter(p=>!kept.has(JSON.stringify(p)));
  assert.ok(before.privs.every(p=>after.privs.some(a=>JSON.stringify(a)===JSON.stringify(p))),'a privilege was removed');
  assert.ok(added2.every(p=>/signin|handoff|request_verified|subject_state|access_wait/.test(p.k)),'a privilege changed on an existing function');
  assert.deepEqual(after.pol,before.pol); assert.deepEqual(after.tabs,before.tabs);
  const oldCols=new Set(before.cols.map(c=>JSON.stringify(c)));
  const newCols=after.cols.filter(c=>!oldCols.has(JSON.stringify(c)));
  assert.deepEqual(newCols.map(c=>c.t+'.'+c.column_name).sort(),['hp_private.access_requests.google_issuer','hp_private.access_requests.google_subject','hp_private.access_requests.last_submit_at']);
  assert.ok(newCols.every(c=>c.is_nullable==='YES'&&c.column_default===null));
  assert.equal(before.cols.length,after.cols.length-3);
  assert.doesNotMatch(await mig('007_verified_signin.sql'),/(DROP|TRUNCATE|ALTERs+TABLE[^;]*(DROP|RENAME|ALTERs+COLUMN)|CREATEs+ORs+REPLACE|DISABLEs+ROW|CREATEs+POLICY)/i);
 }finally{await d.close();}
});
test('the auth role can reach only the two gate functions; the public role only the two request functions',async()=>{
 const d=await base(true);try{
  const execs=async role=>(await d.query("SELECT n.nspname||'.'||p.proname k FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('hp_app','hp_private') AND has_function_privilege($1,p.oid,'EXECUTE') AND has_schema_privilege($1,n.oid,'USAGE') ORDER BY 1",[role])).rows.map(r=>r.k);
  assert.deepEqual(await execs('hp_auth_runtime'),['hp_app.hp_access_signin_bind','hp_app.hp_access_signin_gate']);
  const pub=await execs('hp_access_public'); assert.deepEqual(pub,['hp_app.hp_access_handoff_status','hp_app.hp_access_request','hp_app.hp_access_request_verified']);
  await assert.rejects(call(d,'hp_auth_runtime',null,null,'SELECT * FROM hp_private.access_entitlements'),/permission denied|does not exist/);
  await assert.rejects(call(d,'hp_access_public',null,null,'SELECT * FROM hp_private.access_requests'),/permission denied/);
 }finally{await d.close();}
});
test('owner keeps access throughout; unknown, pending, denied and revoked subjects are gated before any row exists',async()=>{
 const d=await base(true);try{
  assert.equal((await gate(d,'owner-sub','jacob@appelbaums.com')).state,'approved');
  assert.equal((await app(d,owner,os,'SELECT hp_app.hp_access_status() x')).status,'approved');
  const before=await counts(d);
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'none');
  assert.equal((await gate(d,'user-sub','user-sub@example.invalid')).state,'none');
  assert.deepEqual(await counts(d),before,'the gate is read-only');
  assert.equal((await askS(d,'g-new','new@example.invalid')).status,'pending');
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'pending');
  const [r]=await list(d); assert.equal(r.email,'new@example.invalid');
  await decide(d,r.id,r.revision,'denied');
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'denied');
  assert.deepEqual(await counts(d),before,'a denied sign-in creates no user, account or session');
  assert.equal((await app(d,owner,os,'SELECT hp_app.hp_access_status() x')).status,'approved');
  assert.deepEqual(await app(d,owner,os,'SELECT hp_app.hp_google_subjects() x'),['owner-sub']);
 }finally{await d.close();}
});
test('approved request: bind on first sign-in creates a subject-bound entitlement and data access; replays are idempotent',async()=>{
 const d=await base(true);try{
  await askS(d,'g-new','new@example.invalid');
  const [r]=await list(d); await decide(d,r.id,r.revision,'approved');
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'approved');
  await createFresh(d,'g-new','new@example.invalid');
  assert.equal((await bind(d,fresh,'new@example.invalid')).state,'approved');
  assert.equal((await bind(d,fresh,'new@example.invalid')).state,'approved');
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_entitlements WHERE user_id=$1 AND google_subject='g-new' AND status='approved' AND provenance='verified-request'",[fresh])).rows[0].n),1);
  assert.equal((await app(d,fresh,fs,'SELECT hp_app.hp_access_status() x')).status,'approved');
  const body={kind:'shelf',title:'mine',schemaVersion:3,payload:{version:1},photoIds:[]};
  const c=await app(d,fresh,fs,'SELECT hp_app.hp_create_design($1,$2,$3,$4::jsonb) x',[fresh,'77777777-7777-4777-8777-777777777777','a'.repeat(64),JSON.stringify(body)]);
  assert.equal(c.design?.title??c.title,'mine');
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_audit WHERE action='signin_bound' AND subject_user=$1",[fresh])).rows[0].n),1);
 }finally{await d.close();}
});
test('a revoked user is never revived by an old approved request; revoked and denied gates hold',async()=>{
 const d=await base(true);try{
  await askS(d,'g-new','new@example.invalid');
  const [r]=await list(d); await decide(d,r.id,r.revision,'approved');
  await createFresh(d,'g-new','new@example.invalid'); await bind(d,fresh,'new@example.invalid');
  const ents=await admin(d,'SELECT hp_app.hp_access_entitlements($1) x',['owner-sub']); const e=ents.find(x=>x.userId===fresh);
  await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,e.revision]);
  assert.equal(Number((await d.query('SELECT count(*) n FROM hp_auth.session WHERE "userId"=$1',[fresh])).rows[0].n),0);
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'revoked');
  assert.equal((await bind(d,fresh,'new@example.invalid')).state,'revoked');
  assert.equal((await askS(d,'g-new','new@example.invalid')).status,'revoked');
  await assert.rejects(app(d,fresh,fs,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_SESSION|HP_ACCESS_REVOKED/);
  assert.equal((await d.query("SELECT status FROM hp_private.access_entitlements WHERE user_id=$1",[fresh])).rows[0].status,'revoked');
 }finally{await d.close();}
});
test('a denied user cannot sign in or reach data, and the denied entitlement is never revived by bind',async()=>{
 const d=await base(true);try{
  await createFresh(d,'g-new','new@example.invalid');
  await d.query("INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES($1,'g-new','denied',$2,'fixture')",[fresh,owner]);
  assert.equal((await gate(d,'g-new','new@example.invalid')).state,'denied');
  assert.equal((await bind(d,fresh,'new@example.invalid')).state,'denied');
  await assert.rejects(app(d,fresh,fs,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_DENIED/);
 }finally{await d.close();}
});
test('existing user without an entitlement stays gated until approved',async()=>{
 const d=await base(true);try{
  assert.equal((await gate(d,'user-sub','user-sub@example.invalid')).state,'none');
  assert.equal((await bind(d,user,'user-sub@example.invalid')).state,'none');
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_PENDING/);
  await askS(d,'user-sub','user-sub@example.invalid');
  const [r]=await list(d); await decide(d,r.id,r.revision,'approved');
  assert.equal((await bind(d,user,'user-sub@example.invalid')).state,'approved');
  assert.equal((await app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x')),true);
 }finally{await d.close();}
});
test('request limits: one open request per subject, 60 s retry, 24 h after denial, 3 per day, 5 per hour per address',async()=>{
 const d=await base(true);try{
  assert.equal((await askS(d,'g-a','a@example.invalid')).status,'pending');
  const second=await askS(d,'g-a','a@example.invalid'); assert.equal(second.limited,true); assert.ok(second.retryAfter>0&&second.retryAfter<=60);
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_requests WHERE google_subject='g-a'")).rows[0].n),1);
  assert.ok((await status(d,'g-a','a@example.invalid')).retryAfter>0);
  await d.query("UPDATE hp_private.access_requests SET last_submit_at=now()-interval '61 seconds' WHERE google_subject='g-a'");
  const third=await askS(d,'g-a','a@example.invalid'); assert.equal(third.status,'pending'); assert.ok(!third.limited);
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_requests WHERE google_subject='g-a'")).rows[0].n),1,'still one open request');
  const [r]=(await list(d)); await decide(d,r.id,r.revision,'denied');
  const denied=await askS(d,'g-a','a@example.invalid'); assert.equal(denied.status,'denied'); assert.equal(denied.limited,true); assert.ok(denied.retryAfter>86000&&denied.retryAfter<=86400);
  const st=await status(d,'g-a','a@example.invalid'); assert.equal(st.status,'denied'); assert.ok(st.retryAfter>86000);
  await d.query("UPDATE hp_private.access_requests SET decided_at=now()-interval '25 hours' WHERE google_subject='g-a'");
  assert.equal((await askS(d,'g-a','a@example.invalid')).status,'pending');
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_requests WHERE google_subject='g-a'")).rows[0].n),2);
  // Same address: sixth request in an hour is refused (rate events: g-a x2 so far).
  for(const n of ['b','c','d']) assert.equal((await askS(d,'g-'+n,n+'@example.invalid')).status,'pending');
  const sixth=await askS(d,'g-e','e@example.invalid'); assert.equal(sixth.limited,true);
  assert.equal(Number((await d.query("SELECT count(*) n FROM hp_private.access_requests WHERE google_subject='g-e'")).rows[0].n),0);
  assert.equal((await askS(d,'g-e','e@example.invalid',ip2)).status,'pending');
 }finally{await d.close();}
});
test('per-subject daily cap and manual-review conflicts',async()=>{
 const d=await base(true);try{
  for(let i=0;i<3;i++){
   assert.equal((await askS(d,'g-a','a@example.invalid',String(i).repeat(64))).status,'pending');
   const [r]=(await list(d)).filter(x=>x.status==='pending'); await decide(d,r.id,r.revision,'denied');
   await d.query("UPDATE hp_private.access_requests SET decided_at=now()-interval '25 hours'");
  }
  assert.equal((await askS(d,'g-a','a@example.invalid','9'.repeat(64))).limited,true);
  await assert.rejects(askS(d,'g-o','jacob@appelbaums.com'),/HP_CONFLICT/);
  await askS(d,'g-x','same@example.invalid','7'.repeat(64));
  await assert.rejects(askS(d,'g-y','same@example.invalid','8'.repeat(64)),/HP_CONFLICT/);
  await assert.rejects(call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_request_verified($1,$2,$3,$4,$5,$6) x',['https://evil.example','g-z','z@example.invalid','Z',ip,subjectHash('g-z')]),/HP_INVALID/);
  await assert.rejects(call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_request_verified($1,$2,$3,$4,$5,$6) x',[ISS,'g-z','Z@example.invalid','Z',ip,subjectHash('g-z')]),/HP_INVALID/);
 }finally{await d.close();}
});
test('the owner cannot be denied or revoked through the new flow',async()=>{
 const d=await base(true);try{
  await assert.rejects(askS(d,'owner-sub','jacob@appelbaums.com'),/HP_CONFLICT/);
  assert.equal((await askS(d,'owner-sub','jacob+alt@appelbaums.com')).status,'approved');
  assert.equal((await gate(d,'owner-sub','anything@example.invalid')).state,'approved');
 }finally{await d.close();}
});
