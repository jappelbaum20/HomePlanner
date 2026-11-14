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
  await db.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',[u,subject,u===owner?'owner@example.com':subject+'@example.invalid']);
  await db.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())',[subject,u]);
  await db.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[s,'cookie-'+subject,u]);
 }
 await db.query('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)',[owner,'owner-sub']);
 await db.query('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')',[grant,owner,os,'owner-sub']);
 await db.exec('BEGIN;\n'+await mig('006_access_requests.sql')+'\nCOMMIT;');
 if(extra) { await db.exec('BEGIN;\n'+await mig('007_verified_signin.sql')+'\nCOMMIT;'); await db.exec('BEGIN;\n'+await mig('008_add_person.sql')+'\nCOMMIT;'); }
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

const add=(d,email,override=false,g=grant,sub='owner-sub')=>app(d,owner,os,'SELECT hp_app.hp_access_add($1,$2,$3) x',[sub,email,override],g);
const addedList=d=>admin(d,'SELECT hp_app.hp_access_added_list($1) x',['owner-sub']);
const removeAdded=(d,email)=>admin(d,'SELECT hp_app.hp_access_added_remove($1,$2) x',['owner-sub',email]);
const audit=async(d,action)=>(await d.query('SELECT actor_id,target_email,subject_user,request_id FROM hp_private.access_audit WHERE action=$1 ORDER BY id',[action])).rows;
const ent=async(d,id)=>(await d.query('SELECT status,provenance,decided_by FROM hp_private.access_entitlements WHERE user_id=$1',[id])).rows[0];
const E='newcomer@example.com';
const count=async(d,t='hp_private.access_added')=>(await d.query('SELECT count(*)::int n FROM '+t)).rows[0].n;
const db8=()=>base(true);

test('008 applies on top of 007 and is a new additive entry; Add a person tables and functions exist',async()=>{
 const d=await db8();try{
  assert.equal(await count(d),0);
  assert.equal((await d.query("SELECT 1 FROM pg_proc WHERE proname IN ('hp_access_add','hp_access_added_list','hp_access_added_remove')")).rows.length,3);
  const m=(await import('../db/migrate.cjs')).default; assert.deepEqual([...m.ADDITIVE],['007_verified_signin.sql','008_add_person.sql']);
  assert.equal(m.FILES.length,6);
 } finally { await d.close(); }
});
test('only the verified administrator can add, list or remove; bad grant and bad addresses are refused',async()=>{
 const d=await db8();try{
  await assert.rejects(()=>app(d,user,us,'SELECT hp_app.hp_access_add($1,$2,$3) x',['user-sub',E,false],''),/HP_NOT_FOUND/);
  await assert.rejects(()=>add(d,E,false,'b'.repeat(64)),/HP_NOT_FOUND/);
  await assert.rejects(()=>app(d,user,us,'SELECT hp_app.hp_access_added_list($1) x',['user-sub'],''),/HP_NOT_FOUND/);
  await assert.rejects(()=>app(d,user,us,'SELECT hp_app.hp_access_added_remove($1,$2) x',['user-sub',E],''),/HP_NOT_FOUND/);
  for(const bad of ['','a','Mixed@Example.com',null,'x'.repeat(260)+'@example.com']) await assert.rejects(()=>add(d,bad),/HP_INVALID/);
  await assert.rejects(()=>call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_add($1,$2,$3) x',['owner-sub',E,false]),/permission denied/);
  assert.equal(await count(d),0);
 } finally { await d.close(); }
});
test('rules d and e: a new address is added once, idempotently; the person signs in as a normal approved user',async()=>{
 const d=await db8();try{
  assert.equal((await add(d,E)).result,'added');
  assert.equal((await add(d,E)).result,'already_added');
  assert.equal((await add(d,E,true)).result,'already_added');
  assert.deepEqual((await addedList(d)).map(x=>x.email),[E]);
  assert.equal(await count(d),1);
  assert.equal((await gate(d,sub(7),E)).state,'approved');
  await createFresh(d,sub(7),E);
  assert.equal((await bind(d,fresh,E)).state,'approved');
  const e=await ent(d,fresh); assert.equal(e.status,'approved'); assert.equal(e.provenance,'verified-added'); assert.equal(e.decided_by,owner);
  assert.equal((await d.query('SELECT 1 FROM hp_private.admin_binding WHERE user_id=$1',[fresh])).rows.length,0,'never an owner');
  assert.deepEqual(await addedList(d),[]);
  assert.equal((await status(d,sub(7),E)).status,'approved');
  assert.equal((await add(d,E)).result,'has_access');
  const a=await audit(d,'added'); assert.equal(a.length,1); assert.equal(a[0].actor_id,owner); assert.equal(a[0].target_email,E);
  const bound=await audit(d,'signin_bound'); assert.equal(bound.at(-1).target_email,E); assert.equal(bound.at(-1).subject_user,fresh);
  await assert.rejects(()=>removeAdded(d,E),/HP_NOT_FOUND/);
 } finally { await d.close(); }
});
test('an address that was not added still has to request',async()=>{
 const d=await db8();try{
  await add(d,E);
  assert.equal((await gate(d,sub(8),'other@example.com')).state,'none');
  assert.equal((await askS(d,sub(8),'other@example.com')).status,'pending');
  await createFresh(d,sub(8),'other@example.com');
  assert.equal((await bind(d,fresh,'other@example.com')).state,'pending');
  assert.equal(await ent(d,fresh),undefined);
 } finally { await d.close(); }
});
test('rule a: an existing approved account or approved invitation needs no change',async()=>{
 const d=await db8();try{
  const ownerEmail=(await d.query('SELECT email FROM hp_auth."user" WHERE id=$1',[owner])).rows[0].email;
  assert.equal((await add(d,ownerEmail)).result,'has_access');
  assert.equal(await count(d),0);
  assert.equal((await askS(d,sub(3),'req@example.com')).status,'pending');
  const r=(await list(d)).find(x=>x.email==='req@example.com');
  assert.equal((await add(d,'req@example.com')).result,'pending_request');
  await decide(d,r.id,r.revision,'approved');
  assert.equal((await add(d,'req@example.com')).result,'has_access');
  assert.equal(await count(d),0);
 } finally { await d.close(); }
});
test('rule b: a waiting request is never approved silently and nothing new is created',async()=>{
 const d=await db8();try{
  assert.equal((await askS(d,sub(4),E)).status,'pending');
  const r=await add(d,E); assert.equal(r.result,'pending_request'); assert.match(r.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(await count(d),0);
  assert.equal((await d.query("SELECT status FROM hp_private.access_requests WHERE email=$1",[E])).rows[0].status,'pending');
  assert.equal((await audit(d,'added')).length,0);
 } finally { await d.close(); }
});
test('rule c: a denied address is refused by default; an explicit override grants access and is audited',async()=>{
 const d=await db8();try{
  assert.equal((await askS(d,sub(5),E)).status,'pending');
  const r=(await list(d)).find(x=>x.email===E); await decide(d,r.id,r.revision,'denied');
  assert.deepEqual(await add(d,E),{result:'blocked',state:'denied',restore:false});
  assert.equal(await count(d),0); assert.equal((await audit(d,'added_override')).length,0);
  assert.equal((await gate(d,sub(5),E)).state,'denied');
  assert.equal((await add(d,E,true)).result,'added');
  const ov=await audit(d,'added_override'); assert.equal(ov.length,1); assert.equal(ov[0].actor_id,owner); assert.equal(ov[0].target_email,E);
  assert.equal((await gate(d,sub(5),E)).state,'approved');
  await createFresh(d,sub(5),E);
  assert.equal((await bind(d,fresh,E)).state,'approved'); assert.equal((await ent(d,fresh)).status,'approved');
 } finally { await d.close(); }
});
test('rule c: a revoked account is refused by default and restored only by an explicit override',async()=>{
 const d=await db8();try{
  assert.equal((await add(d,E)).result,'added');
  await createFresh(d,sub(6),E); await bind(d,fresh,E);
  const revision=Number((await d.query('SELECT revision FROM hp_private.access_entitlements WHERE user_id=$1',[fresh])).rows[0].revision);
  await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,revision]);
  assert.equal((await ent(d,fresh)).status,'revoked');
  assert.deepEqual(await add(d,E),{result:'blocked',state:'revoked',restore:true});
  assert.equal((await ent(d,fresh)).status,'revoked');
  assert.equal((await add(d,E,true)).result,'reinstated');
  assert.equal((await ent(d,fresh)).status,'approved');
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NULL'),0);
  assert.equal((await audit(d,'added_override')).length,1);
 } finally { await d.close(); }
});
test('removal before sign-in works, is audited, and the address must request again',async()=>{
 const d=await db8();try{
  await add(d,E); assert.equal(await removeAdded(d,E),true);
  assert.deepEqual(await addedList(d),[]);
  assert.equal((await gate(d,sub(9),E)).state,'none');
  const r=await audit(d,'added_removed'); assert.equal(r.length,1); assert.equal(r[0].actor_id,owner); assert.equal(r[0].target_email,E);
  await assert.rejects(()=>removeAdded(d,E),/HP_NOT_FOUND/);
  assert.equal((await add(d,E)).result,'added');
 } finally { await d.close(); }
});
test('the new table is not readable by any runtime role',async()=>{
 const d=await db8();try{
  for(const role of ['hp_app_runtime','hp_access_public','hp_auth_runtime','hp_mail_worker']) await assert.rejects(()=>call(d,role,null,null,'SELECT count(*) x FROM hp_private.access_added'),/permission denied/);
 } finally { await d.close(); }
});

test('a second Google subject with the same address cannot reuse a claimed pre-approval',async()=>{
 const d=await db8();try{
  await add(d,E); await createFresh(d,sub(7),E); assert.equal((await bind(d,fresh,E)).state,'approved');
  assert.equal((await gate(d,sub(1),E)).state,'none','the address was claimed once; another subject must request');
  assert.equal((await askS(d,sub(1),E)).status,'pending');
  const other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; await d.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',[other,sub(1),E+'.other']);
  await d.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())',[sub(1),other]);
  assert.equal((await bind(d,other,E)).state,'pending'); assert.equal(await ent(d,other),undefined);
 } finally { await d.close(); }
});
test('gate and bind called with different addresses never approve through the pre-approval of one of them',async()=>{
 const d=await db8();try{
  await add(d,E);
  assert.equal((await gate(d,sub(2),'someone-else@example.com')).state,'none');
  await createFresh(d,sub(2),'someone-else@example.com');
  assert.equal((await bind(d,fresh,'someone-else@example.com')).state,'none');
  assert.equal(await ent(d,fresh),undefined);
  assert.equal((await bind(d,fresh,E)).state,'approved','bind trusts the address it is given, exactly like the gate');
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NULL'),0);
 } finally { await d.close(); }
});
test('revoke wins after a reinstatement and after an override-added claim; the reinstated audit row has subject and revision',async()=>{
 const d=await db8();try{
  await add(d,E); await createFresh(d,sub(6),E); await bind(d,fresh,E);
  const rev=async()=>Number((await d.query('SELECT revision FROM hp_private.access_entitlements WHERE user_id=$1',[fresh])).rows[0].revision);
  await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,await rev()]);
  assert.equal((await add(d,E,true)).result,'reinstated'); assert.equal((await ent(d,fresh)).status,'approved');
  const au=(await audit(d,'added_override')).at(-1); assert.equal(au.subject_user,fresh); assert.equal(au.target_email,E);
  assert.equal(Number((await d.query("SELECT revision FROM hp_private.access_audit WHERE action='added_override' ORDER BY id DESC LIMIT 1")).rows[0].revision),await rev(),'the audit row records the new revision');
  await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,await rev()]);
  assert.equal((await ent(d,fresh)).status,'revoked','revoke after reinstated wins');
  assert.equal((await gate(d,sub(6),E)).state,'revoked');
 } finally { await d.close(); }
 const d2=await db8();try{
  assert.equal((await askS(d2,sub(5),E)).status,'pending');
  const r=(await list(d2)).find(x=>x.email===E); await decide(d2,r.id,r.revision,'denied');
  assert.equal((await add(d2,E,true)).result,'added');
  await createFresh(d2,sub(5),E); assert.equal((await bind(d2,fresh,E)).state,'approved');
  const revision=Number((await d2.query('SELECT revision FROM hp_private.access_entitlements WHERE user_id=$1',[fresh])).rows[0].revision);
  await admin(d2,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,revision]);
  assert.equal((await ent(d2,fresh)).status,'revoked');
  assert.equal((await gate(d2,sub(5),E)).state,'revoked');
  assert.equal((await bind(d2,fresh,E)).state,'revoked');
 } finally { await d2.close(); }
});
test('the owner account is never touched: not reinstated, not blocked, no added row, even with override',async()=>{
 const d=await db8();try{
  const ownerEmail=(await d.query('SELECT email FROM hp_auth."user" WHERE id=$1',[owner])).rows[0].email;
  assert.equal((await ent(d,owner)).status,'approved');
  assert.equal((await add(d,ownerEmail,true)).result,'has_access');
  // Force the entitlement into a closed state (superuser fixture) and try the override path.
  await d.query("UPDATE hp_private.access_entitlements SET status='revoked' WHERE user_id=$1",[owner]);
  const before=(await d.query('SELECT status,revision FROM hp_private.access_entitlements WHERE user_id=$1',[owner])).rows[0];
  const auditBefore=await count(d,'hp_private.access_audit');
  for(const ov of [false,true]) await assert.rejects(()=>add(d,ownerEmail,ov),/HP_INVALID/);
  assert.deepEqual((await d.query('SELECT status,revision FROM hp_private.access_entitlements WHERE user_id=$1',[owner])).rows[0],before);
  assert.equal(await count(d),0); assert.equal(await count(d,'hp_private.access_audit'),auditBefore);
 } finally { await d.close(); }
});
test('add never reports added unless a usable invitation exists, even if a claimed row for the address is kept',async()=>{
 const d=await db8();try{
  await add(d,E); await createFresh(d,sub(7),E); await bind(d,fresh,E);
  // The account's stored address changes; the claimed row stays as history.
  await d.query('UPDATE hp_auth."user" SET email=$2 WHERE id=$1',[fresh,'renamed@example.com']);
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NOT NULL'),1);
  assert.equal((await add(d,E)).result,'added');
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NULL'),1,'a usable unclaimed row exists');
  assert.equal(await count(d),2,'the claimed row is kept');
  assert.equal((await gate(d,sub(1),E)).state,'approved');
  assert.equal((await add(d,E)).result,'already_added');
  await assert.rejects(()=>d.query('INSERT INTO hp_private.access_added(email,added_by) VALUES($1,$2)',[E,owner]),/duplicate key|unique/);
  assert.equal((await audit(d,'added')).length,2);
 } finally { await d.close(); }
});
test('a later Deny of a racing request beats the earlier add, at the gate and at bind',async()=>{
 const d=await db8();try{
  assert.equal((await add(d,E)).result,'added');
  // A request for the same address lands next to the add (they lock different keys). The public request path would answer
  // 'approved' once the row exists, so the interleaved request is inserted directly.
  await d.query("INSERT INTO hp_private.access_requests(name,email,note,google_issuer,google_subject,last_submit_at) VALUES('Applicant',$1,'',$2,$3,clock_timestamp())",[E,ISS,sub(4)]);
  const r=(await list(d)).find(x=>x.email===E); await decide(d,r.id,r.revision,'denied');
  assert.equal((await gate(d,sub(4),E)).state,'denied');
  await createFresh(d,sub(4),E);
  assert.equal((await bind(d,fresh,E)).state,'denied'); assert.equal(await ent(d,fresh),undefined);
  assert.equal((await gate(d,sub(1),E)).state,'none','the old unclaimed row no longer applies to another subject either');
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NOT NULL'),0);
  // An explicit override after the denial creates a row newer than the denial; it applies again.
  assert.deepEqual(await addedList(d),[],'a voided row is not listed as waiting');
  assert.deepEqual(await add(d,E),{result:'blocked',state:'denied',restore:false});
  assert.equal((await add(d,E,true)).result,'added');
  assert.equal(await count(d,'hp_private.access_added WHERE claimed_user IS NULL'),1);
  assert.equal((await gate(d,sub(4),E)).state,'approved');
  assert.equal((await bind(d,fresh,E)).state,'approved');
 } finally { await d.close(); }
});
test('the three new functions are not executable by the mail worker, the sign-in runtime or the public role',async()=>{
 const d=await db8();try{
  for(const role of ['hp_mail_worker','hp_auth_runtime','hp_access_public']) for(const [sql,args] of [
   ['SELECT hp_app.hp_access_add($1,$2,$3) x',['owner-sub',E,false]],['SELECT hp_app.hp_access_added_list($1) x',['owner-sub']],['SELECT hp_app.hp_access_added_remove($1,$2) x',['owner-sub',E]]])
    await assert.rejects(()=>call(d,role,null,null,sql,args),/permission denied/,role);
 } finally { await d.close(); }
});
test('the closed-account flag: blocked by an existing closed account says restore, a denied request does not',async()=>{
 const d=await db8();try{
  await add(d,E); await createFresh(d,sub(6),E); await bind(d,fresh,E);
  const revision=Number((await d.query('SELECT revision FROM hp_private.access_entitlements WHERE user_id=$1',[fresh])).rows[0].revision);
  await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',fresh,revision]);
  assert.deepEqual(await add(d,E),{result:'blocked',state:'revoked',restore:true});
  assert.equal((await askS(d,sub(5),'other@example.com')).status,'pending');
  const r=(await list(d)).find(x=>x.email==='other@example.com'); await decide(d,r.id,r.revision,'denied');
  assert.deepEqual(await add(d,'other@example.com'),{result:'blocked',state:'denied',restore:false});
 } finally { await d.close(); }
});
test('removal and bind in either order: a claimed row cannot be removed, a removed row cannot be claimed (single session: no true overlap)',async()=>{
 // Limit: the embedded database has one session, so the two calls cannot overlap; this proves both serial orders.
 // The overlapping case relies on bind taking FOR UPDATE on the row and removal deleting under the email lock.
 const d=await db8();try{
  await add(d,E); await removeAdded(d,E);
  await createFresh(d,sub(7),E); assert.equal((await bind(d,fresh,E)).state,'none'); assert.equal(await ent(d,fresh),undefined);
 } finally { await d.close(); }
 const d2=await db8();try{
  await add(d2,E); await createFresh(d2,sub(7),E); await bind(d2,fresh,E);
  await assert.rejects(()=>removeAdded(d2,E),/HP_NOT_FOUND/);
  assert.equal((await ent(d2,fresh)).status,'approved');
 } finally { await d2.close(); }
});
