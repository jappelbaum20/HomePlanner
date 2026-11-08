'use strict';
const fs=require('node:fs/promises'), path=require('node:path'), assert=require('node:assert/strict');
const { randomUUID, createHash }=require('node:crypto');
const { test }=require('node:test');
const { fork }=require('node:child_process');
const { Client,Pool }=require('pg');
const { migrate,verifyMigrations,expectedMigrations }=require('../db/migrate.cjs');
const { createBackend,createPhotoMaintenanceBackend }=require('../server/db');
const { createPhotoStore }=require('../server/photo-files.cjs');
const { createPhotoMaintenance }=require('../server/photo-maintenance.cjs');
const base=process.env.VPS_STORAGE_TEST_ROOT;
if(!base || !path.isAbsolute(base) || process.env.NODE_ENV!=='test') throw Error('Set NODE_ENV=test and VPS_STORAGE_TEST_ROOT to a task-owned absolute fixture directory');
const conn={host:'127.0.0.1',port:Number(process.env.HP_STORAGE_TEST_PORT || 65454),database:process.env.FIX_DATABASE || 'hp_stor_'+randomUUID().replaceAll('-','')};
const appOptions={...conn,user:'hp_storage_app'}, maintenanceOptions={...conn,user:'hp_storage_maint'};
const opts=process.platform==='win32'
 ? {minFreeBytes:0,testOnly:{allowUnsafeDirectorySync:true,syncDir:async()=>{},diskFree:async()=>1e12}}
 : {minFreeBytes:0,testOnly:{allowUnsafeDirectorySync:true}};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function storeAt(root,publicRoot){const store=createPhotoStore({root,publicRoot,...opts});await store.init();return store;}
async function eventually(fn){const end=Date.now()+15000;let last;while(Date.now()<end){try{if(await fn())return;}catch(e){last=e;}await new Promise(r=>setTimeout(r,100));}throw last||Error('Timed out waiting for maintenance');}
async function absent(p){try{await fs.stat(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
const old=new Date(Date.now()-3*60*60*1000);
if(process.argv[2]==='--crash-child') {
 (async()=>{
  const pool=new Pool(maintenanceOptions),db=createPhotoMaintenanceBackend({maintenancePool:pool});
  const store=await storeAt(process.env.FIX_ROOT,process.env.FIX_PUBLIC);
  const {owner,design,photo,token}=JSON.parse(process.env.FIX_CLAIM);
  await db.withCleanup(owner,design,photo,token,async locked=>{
   await store.remove(owner,design,photo,'raw'); await locked.recordRemoval('raw');
   process.send('removed'); await new Promise(()=>{});
  });
 })().catch(e=>{process.send({error:e.message});process.exitCode=1;});
} else test('native PostgreSQL and real files: scoped maintenance, session fences, restart and reconciliation', {timeout:120000}, async()=>{
 let admin,appPool,maintenancePool,worker;
 const run=path.join(base,randomUUID()),root=path.join(run,'private'),publicRoot=path.join(run,'public');
 await fs.mkdir(root,{recursive:true,mode:0o700});await fs.mkdir(publicRoot,{recursive:true,mode:0o700});
 try {
  admin=new Client({...conn,database:'postgres',user:'hp_fixture_admin'});await admin.connect();
  for(const [name,spec] of [['hp_auth_owner','NOLOGIN'],['hp_auth_runtime','NOLOGIN'],['hp_app_owner','NOLOGIN'],['hp_app_runtime','NOLOGIN'],['hp_photo_maintenance','NOLOGIN'],['hp_access_public','NOLOGIN'],['hp_mail_worker','NOLOGIN'],['hp_storage_app','LOGIN IN ROLE hp_app_runtime'],['hp_storage_maint','LOGIN IN ROLE hp_photo_maintenance']]) {
   if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount) await admin.query(`CREATE ROLE ${name} ${spec}`);
  }
  await admin.query(`CREATE DATABASE ${conn.database}`); await admin.end();
  admin=new Client({...conn,user:'hp_fixture_admin'}); await admin.connect();
  await migrate(admin); await migrate(admin);
  appPool=new Pool({...appOptions,max:5});maintenancePool=new Pool({...maintenanceOptions,max:3});
  assert.equal(await verifyMigrations(appPool),true);
  const mdb=createPhotoMaintenanceBackend({maintenancePool}); await mdb.verifyRole();
  await assert.rejects(maintenancePool.query('SELECT * FROM hp_app.design_photos'));
  await assert.rejects(maintenancePool.query('SELECT * FROM hp_app.hp_maintenance_owners(NULL,NULL)'));
  await assert.rejects(maintenancePool.query('SELECT * FROM hp_app.hp_maintenance_owners(NULL,33)'));
  await assert.rejects(maintenancePool.query('SELECT hp_app.hp_reserve_photo($1,$2,$3,$4,$5)',[randomUUID(),randomUUID(),'image/png',1,'0'.repeat(64)]));
  await assert.rejects(appPool.query('SELECT hp_app.hp_maintenance_owners(NULL,1)'));
  const store=await storeAt(root,publicRoot),owner=randomUUID(),sid=randomUUID(),sid2=randomUUID();
  await admin.query(`INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES($1,'Fixture','fixture-storage@example.invalid',true,now())`,[owner]);
  await admin.query(`INSERT INTO hp_auth.account(id,"accountId","providerId","userId","createdAt","updatedAt") VALUES(gen_random_uuid(),'fixture-storage','google',$1,now(),now())`,[owner]);
  await admin.query(`INSERT INTO hp_auth.session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,'synthetic-a',$3,now()+interval '1 day',now(),now()),($2,'synthetic-b',$3,now()+interval '1 day',now(),now())`,[sid,sid2,owner]);
  await admin.query(`INSERT INTO hp_private.access_entitlements(user_id,google_subject,status,decided_by,provenance) VALUES($1,'fixture-storage','approved',$1,'fixture')`,[owner]);
  const backend=createBackend({appPool}),a=backend.forSession({userId:owner,sessionId:sid}),b=backend.forSession({userId:owner,sessionId:sid2});
  const body={kind:'shelf',title:'Fixture',schemaVersion:3,payload:{},photoIds:[]};
  async function design(){return (await a.rpc('hp_create_design',{p_user_id:owner,p_key:randomUUID(),p_body_hash:'1'.repeat(64),p_body:body})).design.id;}
  async function reserve(d,raw){return (await a.rpc('hp_reserve_photo',{p_user_id:owner,p_design_id:d,p_mime:'image/png',p_bytes:raw.length,p_checksum:hash(raw)})).photoId;}
  async function rawPublish(d,p,raw){const stage=await store.stageBytes(owner,d,p,raw);try{await a.withPhotoLock(d,p,'raw',null,async l=>{await stage.publish('raw');await l.recordPublication(stage.bytes,stage.checksum);});}finally{await stage.dispose();}}
  const d=await design(),raw=Buffer.from('fixture raw bytes'),p=await reserve(d,raw);await rawPublish(d,p,raw);
  // A classifier must wait behind an in-flight publisher and then see its row.
  let releasePublisher,notifyPublisher;
  const held=new Promise(resolve=>notifyPublisher=resolve), gate=new Promise(resolve=>releasePublisher=resolve);
  const publisher=a.withPhotoLock(d,p,'raw',null,async()=>{notifyPublisher();await gate;});await held;
  let classified=false;
  const classification=mdb.withClassification({owner,design:d,photo:p,area:'objects'},async()=>true).then(value=>{classified=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(classified,false);releasePublisher();await publisher;assert.equal(await classification,false);
  const token=randomUUID();
  await assert.rejects(b.rpc('hp_begin_photo_completion',{p_user_id:owner,p_design_id:d,p_photo_id:p,p_token:token}));
  await a.rpc('hp_begin_photo_completion',{p_user_id:owner,p_design_id:d,p_photo_id:p,p_token:token});
  await assert.rejects(b.withPhotoLock(d,p,'ready',token,async()=>{}));
  const clean=Buffer.from('fixture ready bytes'),stage=await store.stageBytes(owner,d,p,clean);
  try{await a.withPhotoLock(d,p,'ready',token,async l=>{await stage.publish('ready');await l.recordPublication(stage.bytes,stage.checksum);await l.finishReady(stage.bytes,stage.checksum);});}finally{await stage.dispose();}
  await a.rpc('hp_update_design',{p_user_id:owner,p_id:d,p_revision:1,p_body:{...body,photoIds:[p]}});
  const d2=await design(),p2=await reserve(d2,raw);await rawPublish(d2,p2,raw);
  await a.rpc('hp_delete_design',{p_user_id:owner,p_id:d2,p_revision:1});
  // A stale, rowless published object and stale staging file. A quarantine
  // file is deliberately retained and must remain physically charged.
  const orphan=randomUUID(),orphanStage=await store.stageBytes(owner,d,orphan,Buffer.from('rowless'));
  await orphanStage.publish('raw');await orphanStage.dispose();
  const orphanPath=path.join(root,'objects',owner,d,orphan,'raw');await fs.utimes(orphanPath,old,old);
  const ghost=randomUUID(),ghostStage=await store.stageBytes(owner,d,ghost,Buffer.from('manifest reference'));
  await ghostStage.publish('ready');await ghostStage.dispose();
  const ghostPath=path.join(root,'objects',owner,d,ghost,'ready');await fs.utimes(ghostPath,old,old);
  await admin.query('UPDATE hp_app.designs SET photo_ids=$1 WHERE id=$2',[[p,ghost],d]);
  const activeId=randomUUID(),activeStage=await store.stageBytes(owner,d,activeId,Buffer.from('active staged bytes'));
  const activeDir=path.join(root,'staging',owner,d,activeId),activePath=path.join(activeDir,(await fs.readdir(activeDir))[0]);await fs.utimes(activePath,old,old);
  assert.equal(await store.candidateEligible({area:'staging',owner,design:d,photo:activeId,name:path.basename(activePath)},Date.now()-2*60*60*1000),false);
  assert.equal(await mdb.withClassification({area:'objects',owner,design:d,photo:ghost},async()=>true),false);
  const stageDir=path.join(root,'staging',owner,d,randomUUID());await fs.mkdir(stageDir,{recursive:true});
  const staleStage=path.join(stageDir,randomUUID()+'.stage');await fs.writeFile(staleStage,'abandoned');await fs.utimes(staleStage,old,old);
  const quarantine=path.join(root,'quarantine','held');await fs.mkdir(path.dirname(quarantine),{recursive:true});await fs.writeFile(quarantine,'retain');
  const readyPath=path.join(root,'objects',owner,d,p,'ready');await fs.utimes(readyPath,old,old);
  await admin.query('DELETE FROM hp_auth.session WHERE id=ANY($1::uuid[])',[[sid,sid2]]);
  let writer=true;
  worker=createPhotoMaintenance({maintenancePool,store,exclusiveWriter:async()=>writer,intervalMs:100,scanLimit:16});
  await worker.start();assert.equal(worker.ready(),true);
  await eventually(async()=>{
   const rows=(await admin.query('SELECT id,allocation_bytes FROM hp_app.design_photos WHERE id=ANY($1::uuid[])',[[p,p2]])).rows;
   return Number(rows.find(x=>x.id===p).allocation_bytes)===clean.length && Number(rows.find(x=>x.id===p2).allocation_bytes)===0 && await absent(orphanPath) && await absent(staleStage);
  });
  // Simulate an inconsistent restore of old bytes behind a committed,
  // unreferenced tombstone. They remain charged until the next fenced scan.
  const restored=path.join(root,'objects',owner,d2,p2,'raw');await fs.writeFile(restored,'stale restored bytes');await fs.utimes(restored,old,old);
  await eventually(()=>absent(restored));
  assert.equal(Number((await admin.query('SELECT allocation_bytes FROM hp_app.design_photos WHERE id=$1',[p2])).rows[0].allocation_bytes),0);
  assert.equal(await absent(readyPath),false);assert.equal(await absent(ghostPath),false);assert.equal(await absent(activePath),false);assert.equal(await absent(quarantine),false);
  await activeStage.dispose();
  assert.ok(await store.usedBytes()>=clean.length+6);
  const fence=await admin.query('SELECT photo_id FROM hp_private.photo_orphan_fences WHERE photo_id=$1',[orphan]);assert.equal(fence.rowCount,1);
  writer=false;await eventually(()=>!worker.ready());assert.equal(worker.health().failure,'maintenance_failed');
  writer=true;await eventually(()=>worker.ready());await worker.stop();assert.equal(worker.ready(),false);worker=null;
  // Interrupted cleanup removes actual bytes but must not release quota until a
  // new lease rechecks absence and commits receipts after the child is killed.
  const sid3=randomUUID();await admin.query(`INSERT INTO hp_auth.session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,'synthetic-c',$2,now()+interval '1 day',now(),now())`,[sid3,owner]);
  const c=backend.forSession({userId:owner,sessionId:sid3});
  const d3=(await c.rpc('hp_create_design',{p_user_id:owner,p_key:randomUUID(),p_body_hash:'2'.repeat(64),p_body:body})).design.id;
  const p3=(await c.rpc('hp_reserve_photo',{p_user_id:owner,p_design_id:d3,p_mime:'image/png',p_bytes:raw.length,p_checksum:hash(raw)})).photoId;
  const crashStage=await store.stageBytes(owner,d3,p3,raw);
  try{await c.withPhotoLock(d3,p3,'raw',null,async l=>{await crashStage.publish('raw');await l.recordPublication(crashStage.bytes,crashStage.checksum);});}finally{await crashStage.dispose();}
  await c.rpc('hp_delete_design',{p_user_id:owner,p_id:d3,p_revision:1});await admin.query('DELETE FROM hp_auth.session WHERE id=$1',[sid3]);
  const crashToken=randomUUID(),claim=await mdb.claim(owner,crashToken);assert.equal(claim.photoId,p3);
  const child=fork(__filename,['--crash-child'],{env:{...process.env,FIX_DATABASE:conn.database,FIX_ROOT:root,FIX_PUBLIC:publicRoot,FIX_CLAIM:JSON.stringify({owner,design:d3,photo:p3,token:crashToken})},stdio:['ignore','ignore','ignore','ipc']});
  const msg=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Child exited before fence '+code)));});
  assert.equal(msg,'removed');child.kill();await new Promise(resolve=>child.once('exit',resolve));
  const crashPath=path.join(root,'objects',owner,d3,p3,'raw');assert.equal(await absent(crashPath),true);
  assert.equal(Number((await admin.query('SELECT allocation_bytes FROM hp_app.design_photos WHERE id=$1',[p3])).rows[0].allocation_bytes),20971520);
  await admin.query("UPDATE hp_private.photo_work SET lease_until=clock_timestamp()-interval '1 second' WHERE photo_id=$1",[p3]);
  worker=createPhotoMaintenance({maintenancePool,store,exclusiveWriter:async()=>true,intervalMs:100,scanLimit:16});await worker.start();
  await eventually(async()=>Number((await admin.query('SELECT allocation_bytes FROM hp_app.design_photos WHERE id=$1',[p3])).rows[0].allocation_bytes)===0);
  await worker.stop();worker=null;
  // Reproduce an existing exact 001-003 ledger, then upgrade and reapply 004.
  const upgradeDb='hp_upg_'+randomUUID().replaceAll('-','');
  const cluster=new Client({...conn,database:'postgres',user:'hp_fixture_admin'});await cluster.connect();await cluster.query(`CREATE DATABASE ${upgradeDb}`);await cluster.end();
  const upgrade=new Client({...conn,database:upgradeDb,user:'hp_fixture_admin'});await upgrade.connect();
  try {
   await upgrade.query('CREATE SCHEMA hp_migration; CREATE TABLE hp_migration.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT now())');
   const migrations=await expectedMigrations();
   for(const m of migrations.slice(0,3)){await upgrade.query('BEGIN');await upgrade.query(m.sql);await upgrade.query('INSERT INTO hp_migration.applied(name,sha256) VALUES($1,$2)',[m.name,m.sha256]);await upgrade.query('COMMIT');}
   await migrate(upgrade);await migrate(upgrade);assert.equal(await verifyMigrations(upgrade),true);
  } finally {await upgrade.end();}
 } finally {if(worker)await worker.stop();if(appPool)await appPool.end();if(maintenancePool)await maintenancePool.end();if(admin)await admin.end();}
});
