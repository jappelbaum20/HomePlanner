import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
const {createBackend}=require('../server/db');
const {createPhotoStore}=require('../server/photo-files.cjs');
const {createPhotoService,digest}=require('../server/photos');
const base=process.env.VPS_C_TEST_ROOT;
if(!base||!path.isAbsolute(base))throw Error('VPS_C_TEST_ROOT must name a task-owned directory');
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const session={userId:owner,sessionId,displayName:'Fixture'};
function response(){return {setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},write(b){(this.chunks ||= []).push(b);},end(){this.writableEnded=true;}};}
async function invoke(handler,method,designId,photoId,body={}) {const res=response();await handler({method,headers:{'content-type':'application/json'},homeplannerSession:session,query:{id:designId,photoId},body},res);return res;}
test('PGlite migrations, scoped backend and real filesystem complete the receipt and cleanup lifecycle',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN;');
  for(const n of ['001_auth.sql','002_business.sql','003_photos.sql'])await db.exec('BEGIN;\n'+await fs.readFile(new URL('../db/migrations/'+n,import.meta.url),'utf8')+'\nCOMMIT;');
  await db.query(`INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,'Fixture','fixture@example.invalid',true,now())`,[owner]);
  await db.query(`INSERT INTO hp_auth.account("id","accountId","providerId","userId","createdAt","updatedAt") VALUES (gen_random_uuid(),'fixture','google',$1,now(),now())`,[owner]);
  await db.query(`INSERT INTO hp_auth.session("id","token","userId","expiresAt","createdAt","updatedAt") VALUES ($1,'fixture-only',$2,now()+interval '1 day',now(),now())`,[sessionId,owner]);
  await db.exec('SET ROLE hp_app_runtime');
  const pool={async connect(){return {query:(sql,args)=>db.query(sql,args),release(){}};}};
  let service;const backend=createBackend({appPool:pool,photoRecovery:args=>service.photoRecovery(args)});
  const folder=path.join(base,randomUUID()),root=path.join(folder,'private'),publicRoot=path.join(folder,'public');
  await fs.mkdir(root,{recursive:true});await fs.mkdir(publicRoot,{recursive:true});
  const store=createPhotoStore({root,publicRoot,minFreeBytes:0,testOnly:{allowUnsafeDirectorySync:true,syncDir:async()=>{},diskFree:async()=>100000000000}});await store.init();
  service=createPhotoService({backend,store,exclusiveWriter:async()=>true,maintenanceReady:async()=>true});
  const scoped=backend.forSession(session), create=await scoped.rpc('hp_create_design',{p_user_id:owner,p_key:randomUUID(),p_body_hash:'4'.repeat(64),p_body:{kind:'shelf',title:'fixture',schemaVersion:3,payload:{},photoIds:[]}});
  const designId=create.design.id, raw=await sharp({create:{width:4,height:3,channels:3,background:'#6688aa'}}).png().toBuffer();
  const reserve=await invoke(service.photoHandlers.photoReserve,'POST',designId,undefined,{mime:'image/png',bytes:raw.length,checksum:digest(raw)});
  assert.equal(reserve.statusCode,201);const photoId=reserve.body.photoId;
  const write={kind:'shelf',title:'fixture',schemaVersion:3,payload:{},photoIds:[photoId]};
  await assert.rejects(scoped.rpc('hp_update_design',{p_user_id:owner,p_id:designId,p_revision:1,p_body:write}));
  const unchanged=await scoped.get(session,designId);assert.equal(unchanged.revision,1);assert.deepEqual(unchanged.photoManifest,[]);
  const uploaded=await service.photoHandlers.photoRaw({req:{headers:{'content-type':'image/png'}},stream:Readable.from([raw]),session,params:{id:designId,photoId}});assert.equal(uploaded.status,200);
  const completed=await invoke(service.photoHandlers.photoComplete,'POST',designId,photoId);assert.equal(completed.statusCode,200);
  const saved=await scoped.rpc('hp_update_design',{p_user_id:owner,p_id:designId,p_revision:1,p_body:write});assert.equal(saved.revision,2);
  const cleaned=await store.readPart(owner,designId,photoId,'ready');assert.equal(digest(cleaned),completed.body.checksum);
  await assert.rejects(store.readPart(owner,designId,photoId,'raw'),e=>e.code==='ENOENT');
  await scoped.rpc('hp_delete_design',{p_user_id:owner,p_id:designId,p_revision:2});await scoped.recoverStorage();
  await assert.rejects(store.readPart(owner,designId,photoId,'ready'),e=>e.code==='ENOENT');
  await db.exec('RESET ROLE');const state=(await db.query('SELECT allocation_bytes,tombstoned_at FROM hp_app.design_photos WHERE id=$1',[photoId])).rows[0];
  assert.equal(Number(state.allocation_bytes),0);assert.ok(state.tombstoned_at);
 }finally{await db.close();}
});

