import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const os='11111111-1111-4111-8111-111111111111', us='22222222-2222-4222-8222-222222222222', xs='33333333-3333-4333-8333-333333333333';
const grant='a'.repeat(64), ip='b'.repeat(64), eh='c'.repeat(64);
async function setup(){
 const db=await PGlite.create();
 await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_access_public NOLOGIN; CREATE ROLE hp_mail_worker NOLOGIN;');
 for(const f of ['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql','005_shelf_documents.sql']) await db.exec('BEGIN;\n'+await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8')+'\nCOMMIT;');
 for(const [u,s,subject] of [[owner,os,'owner-sub'],[user,us,'user-sub'],[other,xs,'other-sub']]) {
  await db.query('INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',[u,subject,subject+'@example.invalid']);
  await db.query('INSERT INTO hp_auth.account("accountId","providerId","userId","updatedAt") VALUES ($1,\'google\',$2,now())',[subject,u]);
  await db.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[s,'cookie-'+subject,u]);
 }
 await db.query('INSERT INTO hp_private.admin_binding(user_id,google_subject) VALUES($1,$2)',[owner,'owner-sub']);
 await db.query('INSERT INTO hp_private.admin_grants VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')',[grant,owner,os,'owner-sub']);
 await db.exec('BEGIN;\n'+await readFile(new URL('../db/migrations/006_access_requests.sql',import.meta.url),'utf8')+'\nCOMMIT;');
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
const pub=(d,mail='applicant@example.invalid',h=eh)=>call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_request($1,$2,$3,$4,$5) x',['Name',mail,'note',ip,h]);
const admin=(d,sql,args=[])=>app(d,owner,os,sql,args,grant);
test('additive migration, owner seed, pending and verified invitation lifecycle',async()=>{
 const d=await setup();try{
  assert.equal((await app(d,owner,os,'SELECT hp_app.hp_access_status() x')).status,'approved');
  assert.equal((await app(d,user,us,'SELECT hp_app.hp_access_status() x')).status,'pending');
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_PENDING/);
  await assert.rejects(app(d,other,us,'SELECT hp_app.hp_access_status() x'),/HP_ACCESS_SESSION/);
  await pub(d); await pub(d);
  const rows=await admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]);
  assert.equal(rows.length,1);let r=rows[0];
  const result=await admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',r.id,1,'approved']);
  assert.equal(result.revision,2);
  await assert.rejects(admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',r.id,1,'denied']),/HP_CONFLICT/);
  await app(d,user,us,'SELECT hp_app.hp_access_issue_challenge($1) x',['d'.repeat(64)]);
  await assert.rejects(app(d,other,xs,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',['d'.repeat(64),'applicant@example.invalid','other-sub']),/HP_NOT_FOUND/);
  assert.equal((await app(d,user,us,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',['d'.repeat(64),'applicant@example.invalid','user-sub'])).status,'approved');
  assert.equal(await app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x'),true);
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',['d'.repeat(64),'applicant@example.invalid','user-sub']),/HP_NOT_FOUND/);
  await assert.rejects(admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',owner,1]),/HP_INVALID/);
  assert.equal((await admin(d,'SELECT hp_app.hp_access_revoke($1,$2,$3) x',['owner-sub',user,1])).status,'revoked');
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_status() x'),/HP_ACCESS_SESSION/);
  assert.equal((await d.query('SELECT status FROM hp_private.access_entitlements WHERE user_id=$1',[user])).rows[0].status,'revoked');
  await d.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[us,'new-cookie',user]);
  assert.equal((await app(d,user,us,'SELECT hp_app.hp_access_status() x')).status,'revoked');
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_REVOKED/);
 } finally {await d.close();}
});
test('rate limits, role boundaries, grant expiry and leased outbox',async()=>{
 const d=await setup(); try {
  for(let i=0;i<7;i++) await pub(d,`person${i}@example.invalid`,String(i).repeat(64));
  assert.equal(Number((await d.query('SELECT count(*) n FROM hp_private.access_requests')).rows[0].n),5);
  await assert.rejects(call(d,'hp_access_public',null,null,'SELECT * FROM hp_private.access_requests'),/permission denied/);
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null],grant),/HP_NOT_FOUND/);
  const [first]=await admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]);
  await assert.rejects(admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',first.id,null,'approved']),/HP_INVALID/);
  const token='44444444-4444-4444-8444-444444444444';
  const claimed=await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_claim($1,$2) x',[token,1]);assert.equal(claimed.length,1);
  assert.equal(await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_finish($1,$2,$3) x',[claimed[0].id,'55555555-5555-4555-8555-555555555555','accepted']),false);
  assert.equal(await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_finish($1,$2,$3) x',[claimed[0].id,token,'unavailable']),true);
  assert.equal((await d.query('SELECT status FROM hp_private.mail_outbox WHERE id=$1',[claimed[0].id])).rows[0].status,'unavailable');
  await d.query('UPDATE hp_auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',[xs]);
  await assert.rejects(app(d,other,xs,'SELECT hp_app.hp_access_status() x'),/HP_ACCESS_SESSION/);
  await d.query('UPDATE hp_private.admin_grants SET expires_at=now()-interval \'1 second\' WHERE grant_hash=$1',[grant]);
  await assert.rejects(admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]),/HP_NOT_FOUND/);
 } finally {await d.close();}
});
test('denial and revocation remain blocked, and expired leases recover or exhaust durably',async()=>{
 const d=await setup();try{
  await pub(d);
  const [r]=await admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]);
  await admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',r.id,1,'denied']);
  await app(d,user,us,'SELECT hp_app.hp_access_issue_challenge($1) x',['d'.repeat(64)]);
  assert.equal((await app(d,user,us,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',['d'.repeat(64),'applicant@example.invalid','user-sub'])).status,'denied');
  assert.equal(await app(d,user,us,'SELECT hp_private.access_approved() x'),false);
  await assert.rejects(app(d,user,us,'SELECT hp_app.hp_access_assert_approved() x'),/HP_ACCESS_DENIED/);
  await assert.rejects(d.query('UPDATE hp_private.access_entitlements SET google_subject=$1 WHERE user_id=$2',['forged',user]),/HP_INVALID/);
  await assert.rejects(d.query('UPDATE hp_private.access_invitations SET claimed_subject=$1 WHERE email=$2',['forged','applicant@example.invalid']),/HP_INVALID/);
  const token='44444444-4444-4444-8444-444444444444',token2='55555555-5555-4555-8555-555555555555';
  const [job]=await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_claim($1,$2) x',[token,1]);
  await d.query('UPDATE hp_private.mail_outbox SET lease_until=now()-interval \'1 second\' WHERE id=$1',[job.id]);
  const recovered=await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_claim($1,$2) x',[token2,1]);
  assert.equal(recovered[0].id,job.id);assert.equal(recovered[0].messageId,job.messageId);
  assert.equal(await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_finish($1,$2,$3) x',[job.id,token,'accepted']),false);
  await d.query('UPDATE hp_private.mail_outbox SET attempts=8,lease_until=now()-interval \'1 second\' WHERE id=$1',[job.id]);
  await call(d,'hp_mail_worker',null,null,'SELECT hp_app.hp_mail_claim($1,$2) x',[token,1]);
  const failed=(await d.query('SELECT status,revision FROM hp_private.mail_outbox WHERE id=$1',[job.id])).rows[0];
  assert.equal(failed.status,'failed');
  await assert.rejects(admin(d,'SELECT hp_app.hp_mail_retry($1,$2,$3) x',['owner-sub',job.id,Number(failed.revision)-1]),/HP_CONFLICT/);
  assert.equal(await admin(d,'SELECT hp_app.hp_mail_retry($1,$2,$3) x',['owner-sub',job.id,Number(failed.revision)]),true);
 } finally {await d.close();}
});
test('restrictive RLS hides retained designs until approval and immediately after revocation',async()=>{
 const d=await setup(); try {
  const design='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await d.query("INSERT INTO hp_app.designs(id,owner_id,kind,title,schema_version,payload) VALUES ($1,$2,'home','Fixture',3,$3)",[design,user,JSON.stringify({version:2,name:'Fixture',catalog:[],rooms:[]})]);
  const count=()=>app(d,user,us,'SELECT count(*)::integer x FROM hp_app.designs');
  assert.equal(await count(),0);
  await d.query("INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES($1,'user-sub','approved',$2,'fixture')",[user,owner]);
  assert.equal(await count(),1);
  await d.query("UPDATE hp_private.access_entitlements SET status='revoked' WHERE user_id=$1",[user]);
  assert.equal(await count(),0);
  assert.equal((await d.query('SELECT count(*)::integer n FROM hp_app.designs WHERE id=$1',[design])).rows[0].n,1);
 } finally { await d.close(); }
});


test('rejected IP attempts do not exhaust other visitors global allowance',async()=>{
 const d=await setup();try{
  for(let i=0;i<100;i++) await pub(d,`flood${i}@example.invalid`,i.toString(16).padStart(64,'0'));
  assert.equal(Number((await d.query('SELECT count(*) n FROM hp_private.access_rate_events')).rows[0].n),5);
  await call(d,'hp_access_public',null,null,'SELECT hp_app.hp_access_request($1,$2,$3,$4,$5) x',['Other','legit@example.invalid','', 'd'.repeat(64),'e'.repeat(64)]);
  assert.equal(Number((await d.query('SELECT count(*) n FROM hp_private.access_requests')).rows[0].n),6);
  assert.equal(Number((await d.query('SELECT count(*) n FROM hp_private.mail_outbox')).rows[0].n),6);
 }finally{await d.close();}
});

test('new verified address applies newer approval and denial without replaying old approval',async()=>{
 const d=await setup();try{
  async function decideBind(email,decision,n){
   await pub(d,email,n.toString(16).padStart(64,'0'));
   const rows=await admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null]);
   const r=rows.find(r=>r.email===email);
   await admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',r.id,1,decision]);
   return bind(email,n);
  }
  async function bind(email,n){
   const nonce=(n+100).toString(16).padStart(64,'0');
   await app(d,user,us,'SELECT hp_app.hp_access_issue_challenge($1) x',[nonce]);
   return app(d,user,us,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',[nonce,email,'user-sub']);
  }
  assert.equal((await decideBind('old@example.invalid','denied',1)).status,'denied');
  assert.equal((await decideBind('new@example.invalid','approved',2)).status,'approved');
  assert.equal((await decideBind('latest@example.invalid','denied',3)).status,'denied');
  await d.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())',[us,'renewed',user]);
  assert.equal((await bind('new@example.invalid',4)).status,'denied');
  const ent=(await d.query('SELECT status,revision FROM hp_private.access_entitlements WHERE user_id=$1',[user])).rows[0];
  assert.equal(ent.status,'denied');assert.equal(Number(ent.revision),3);
 }finally{await d.close();}
});

for(const decisions of [['denied','approved','denied'],['approved','denied','approved']]) test(`pre-issued decisions use decision order: ${decisions.join('/')}`,async()=>{
 const d=await setup();try{
  for(let i=0;i<3;i++){
   const email=`ordered${i}@example.invalid`;
   await pub(d,email,String(i).repeat(64));
   const r=(await admin(d,'SELECT hp_app.hp_access_review($1,$2) x',['owner-sub',null])).find(r=>r.email===email);
   await admin(d,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) x',['owner-sub',r.id,1,decisions[i]]);
  }
  async function bind(i,n){
   await d.query('INSERT INTO hp_auth.session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now()) ON CONFLICT(id) DO NOTHING',[us,'renew-order',user]);
   const nonce=n.toString(16).padStart(64,'0');
   await app(d,user,us,'SELECT hp_app.hp_access_issue_challenge($1) x',[nonce]);
   return app(d,user,us,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) x',[nonce,`ordered${i}@example.invalid`,'user-sub']);
  }
  for(let i=0;i<3;i++) assert.equal((await bind(i,20+i)).status,decisions[i]);
  assert.equal((await bind(0,30)).status,decisions[2]);
  const e=(await d.query('SELECT revision,decision_at FROM hp_private.access_entitlements WHERE user_id=$1',[user])).rows[0];
  assert.equal(Number(e.revision),3);
  const r=(await d.query('SELECT decided_at FROM hp_private.access_requests WHERE email=$1',['ordered2@example.invalid'])).rows[0];
  assert.equal(String(e.decision_at),String(r.decided_at));
 }finally{await d.close();}
});
