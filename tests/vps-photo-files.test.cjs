'use strict';
// All filesystem data lives in an explicitly supplied, task-owned D: run folder.
// Tests never remove a workspace directory; only the application storage API
// retires its own temporary files and user-deleted fixture objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const { createPhotoStore, MAX_PHOTO } = require('../server/photo-files.cjs');
const { createPhotoService, createPhotoRecovery, digest } = require('../server/photos');
const { ApiError } = require('../server/errors');
const { createRuntime, csrfFor } = require('../runtime/router.cjs');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', design='11111111-1111-4111-8111-111111111111', photo='22222222-2222-4222-8222-222222222222', sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const session={userId:owner,sessionId,displayName:'Fixture'};
const testBase=process.env.VPS_C_TEST_ROOT;
if (!testBase || !path.isAbsolute(testBase)) throw Error('VPS_C_TEST_ROOT must name a task-owned absolute directory');
async function fixture(options={}) {
  const base=path.join(testBase,randomUUID()), root=path.join(base,'private'), pub=path.join(base,'public');
  await fs.mkdir(root,{recursive:true,mode:0o700}); await fs.mkdir(pub,{recursive:true,mode:0o700});
  let free=100000000000;
  const store=createPhotoStore({root,publicRoot:pub,minFreeBytes:options.minFreeBytes ?? 1024,maxBytes:options.maxBytes ?? 5*MAX_PHOTO,testOnly:{allowUnsafeDirectorySync:true,syncDir:async()=>{},diskFree:async()=>free,beforeWrite:options.beforeWrite}});
  await store.init();
  return {base,root,pub,store,setFree(n){free=n;}};
}
function key(o,d,p,part){return `${o}/${d}/${p}/${part}`;}
function backendFor(raw) {
  const state={live:true,deleted:false,status:'pending',work:null,rawReceipt:false,readyReceipt:false,rawRemoved:false,readyRemoved:false,allocation:2*MAX_PHOTO,failCommit:null,ready:null,reservationSession:sessionId};
  let tail=Promise.resolve();
  const live=()=>{if(!state.live)throw new ApiError(409,'session_changed','Session changed.');};
  const snapshot=()=>({ownerId:owner,designId:design,photoId:photo,status:state.status,rawKey:key(owner,design,photo,'raw'),readyKey:key(owner,design,photo,'ready'),requestedMime:'image/png',requestedBytes:raw.length,requestedChecksum:digest(raw),expiresAt:'2099-01-01T00:00:00Z',mode:state.work?.mode || null});
  const scoped={
    async rpc(name,args){
      live();
      if(name==='hp_reserve_photo') return {photoId:photo,expiresAt:snapshot().expiresAt,rawKey:snapshot().rawKey};
      if(name==='hp_begin_photo_completion') {
        if(state.deleted)throw new ApiError(409,'conflict','Deleted.');
        if(state.status==='ready')return {id:photo,status:'ready',mime:'image/png',bytes:state.ready.bytes,checksum:state.ready.checksum};
        if(!state.rawReceipt || state.work)throw new ApiError(409,'conflict','Busy.');
        state.work={mode:'completing',token:args.p_token};
        return {id:photo,status:'pending',raw_key:snapshot().rawKey,requested_mime:'image/png',requested_bytes:raw.length,requested_checksum:digest(raw)};
      }
      if(name==='hp_claim_photo_cleanup') {
        if(state.work?.mode==='completing')return null;
        const mode=state.deleted ? 'delete' : state.status==='ready' && !state.rawRemoved ? 'raw' : null;
        if(!mode)return null;
        state.work={mode,token:args.p_token};
        return {designId:design,photoId:photo,mode,rawKey:snapshot().rawKey,readyKey:snapshot().readyKey};
      }
      throw Error('unsupported rpc');
    },
    async withPhotoLock(d,p,operation,token,callback){
      let release; const prev=tail; tail=new Promise(r=>release=r); await prev;
      try {
        live();
        if(d!==design||p!==photo)throw new ApiError(404,'not_found','Missing.');
        if(operation==='raw'&&(state.deleted||state.status!=='pending'||state.work))throw new ApiError(409,'conflict','Fenced.');
        if(operation==='ready'&&(state.deleted||state.work?.mode!=='completing'||state.work.token!==token))throw new ApiError(409,'conflict','Fenced.');
        if(operation==='cleanup'&&(!['raw','delete'].includes(state.work?.mode)||state.work.token!==token))throw new ApiError(409,'conflict','Fenced.');
        const before={...state,work:state.work&&{...state.work},ready:state.ready&&{...state.ready}};
        const locked={snapshot:snapshot(),
          async recordPublication(bytes,sum){if(operation==='raw'){state.rawReceipt=true;}else{state.readyReceipt=true;state.ready={bytes,checksum:sum};}},
          async finishReady(bytes,sum){state.status='ready';state.work=null;return {photoId:photo,mime:'image/png',bytes,checksum:sum};},
          async recordRemoval(part){state[part+'Removed']=true;},
          async finishCleanup(){if(state.work.mode==='delete'){state.allocation=0;state.status='tombstone';}else{state.allocation=state.ready.bytes;state.work=null;}}
        };
        try {const result=await callback(locked); if(state.failCommit===operation && (operation!=='raw' || state.rawReceipt)){state.failCommit=null;throw Error('injected commit failure');}return result;}
        catch(e){const inject=state.failCommit;Object.assign(state,before);state.failCommit=inject;throw e;}
      } finally {release();}
    },
    async photo(_ctx,d,p){live(); if(state.deleted||state.status==='tombstone')return null;return {status:state.status,reservation_session_id:state.reservationSession,object_key:key(owner,d,p,'ready'),mime:'image/png',bytes:state.ready?.bytes,checksum:state.ready?.checksum};},
    async recoverStorage(){return recovery({session,backend:scoped});}
  };
  let recovery=async()=>{};
  return {state,scoped,factory:{forSession(s){assert.equal(s.userId,owner);assert.equal(s.sessionId,sessionId);return scoped;}},setRecovery(fn){recovery=fn;}};
}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},write(b){(this.chunks ||= []).push(b);},end(){this.writableEnded=true;}};}
function request(method,body={},headers={}){return {method,body,query:{id:design,photoId:photo},headers:{'content-type':'application/json',...headers},homeplannerSession:session};}
async function call(handler,req){const r=response();await handler(req,r);return r;}
function makeService(options){return createPhotoService({...options,exclusiveWriter:async()=>true,maintenanceReady:async()=>true});}
async function png(){return sharp({create:{width:3,height:2,channels:3,background:'#446688'}}).png().toBuffer();}
function rawCall(service,bytes,headers={}) {return service.photoHandlers.photoRaw({req:{headers:{'content-type':'image/png',...headers}},stream:Readable.from([bytes]),session,params:{id:design,photoId:photo}});}

 test('real files: reservation, raw PUT, sanitization, ready receipt, download and fenced cleanup',async()=>{
  const f=await fixture(), raw=await png(), b=backendFor(raw), service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  assert.equal(await createPhotoService({backend:b.factory,store:f.store}).photoReady(),false);
  const reserve=await call(service.photoHandlers.photoReserve,request('POST',{mime:'image/png',bytes:raw.length,checksum:digest(raw)}));
  assert.equal(reserve.statusCode,201);assert.deepEqual(reserve.body,{photoId:photo,expiresAt:'2099-01-01T00:00:00Z',uploadUrl:`/api/designs/${design}/photos/${photo}/raw`,contentType:'image/png',maxBytes:raw.length});
  assert.equal((await rawCall(service,raw)).status,200);
  assert.equal(b.state.rawReceipt,true);
  const complete=await call(service.photoHandlers.photoComplete,request('POST'));
  assert.equal(complete.statusCode,200);assert.equal(b.state.status,'ready');assert.equal(b.state.rawRemoved,true);
  const ready=await f.store.readPart(owner,design,photo,'ready'); assert.equal(digest(ready),complete.body.checksum);
  const download=await call(service.photoHandlers.photoDownload,request('GET'));assert.deepEqual(Buffer.concat(download.chunks),ready);
  b.state.deleted=true;await service.photoRecovery({session,backend:b.scoped});assert.equal(b.state.allocation,0);
  await assert.rejects(f.store.readPart(owner,design,photo,'ready'),e=>e.code==='ENOENT');
 });
 test('rejects size, checksum, MIME, traversal and immutable overwrite with real staging files',async()=>{
  const f=await fixture(), raw=await png(), b=backendFor(raw), service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,Buffer.concat([raw,Buffer.from('x')]))).status,413);
  assert.equal((await rawCall(service,Buffer.alloc(raw.length))).status,422);
  assert.equal((await rawCall(service,raw,{'content-type':'image/jpeg'})).status,415);
  await assert.rejects(f.store.stage('../escape',design,photo,Readable.from([raw]),raw.length));
  const a=await f.store.stage(owner,design,photo,Readable.from([raw]),raw.length);await a.publish('raw');await a.dispose();
  const altered=Buffer.from(raw);altered[0]^=1;const s=await f.store.stage(owner,design,photo,Readable.from([altered]),altered.length);
  await assert.rejects(s.publish('raw'));await s.dispose();assert.deepEqual(await f.store.readPart(owner,design,photo,'raw'),raw);
 });
 test('low free disk and retained orphan bytes deny admission; stale owner staging is reaped',async()=>{
  const f=await fixture({maxBytes:MAX_PHOTO,minFreeBytes:1000}), raw=await png();
  const b=backendFor(raw), service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  f.setFree(999);assert.equal(await service.photoReady(),false);await service.photoRecovery({session,backend:b.scoped});
  f.setFree(1000);await assert.rejects(f.store.stage(owner,design,photo,Readable.from([raw]),raw.length));
  f.setFree(100000000000);const dir=path.join(f.root,'staging',owner,design,photo);await fs.mkdir(dir,{recursive:true});
  const orphan=path.join(dir,randomUUID()+'.stage');const h=await fs.open(orphan,'wx');await h.truncate(MAX_PHOTO);await h.close();
  assert.ok(await f.store.usedBytes()>=MAX_PHOTO);await assert.rejects(f.store.stage(owner,design,photo,Readable.from([raw]),raw.length));
  await fs.utimes(orphan,new Date(1),new Date(1));assert.equal(await f.store.reapStale(other),0);assert.equal(await f.store.reapStale(owner),1);
  const s=await f.store.stage(owner,design,photo,Readable.from([raw]),raw.length);await s.dispose();
 });
 test('an injected disk-full write failure leaves no published file or receipt',async()=>{
  const f=await fixture({beforeWrite:async()=>{const e=Error('synthetic disk full');e.code='ENOSPC';throw e;}}),raw=await png(),b=backendFor(raw),service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,raw)).status,503);assert.equal(b.state.rawReceipt,false);
  await assert.rejects(f.store.readPart(owner,design,photo,'raw'),e=>e.code==='ENOENT');
 });
 test('symlinked volume entries fail closed without touching the target',async(t)=>{
  const f=await fixture(), target=path.join(f.base,'foreign');await fs.mkdir(target);const sentinel=path.join(target,'sentinel');await fs.writeFile(sentinel,'untouched');
  try{await fs.symlink(target,path.join(f.root,'staging',owner),process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code))return t.skip('symlink creation unavailable');throw e;}
  await assert.rejects(f.store.reapStale(owner));await assert.rejects(f.store.usedBytes());assert.equal(await fs.readFile(sentinel,'utf8'),'untouched');
 });
 test('logout and deletion while streaming fence late publication',async()=>{
  for(const change of ['logout','delete']){
    const f=await fixture(), raw=await png(), b=backendFor(raw), service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
    const stream=new PassThrough(), pending=service.photoHandlers.photoRaw({req:{headers:{'content-type':'image/png'}},stream,session,params:{id:design,photoId:photo}});
    stream.write(raw.subarray(0,3)); await new Promise(resolve=>setTimeout(resolve,20));
    if(change==='logout')b.state.live=false;else b.state.deleted=true;
    stream.end(raw.subarray(3));const result=await pending;assert.equal(result.status,409);
    await assert.rejects(f.store.readPart(owner,design,photo,'raw'),e=>e.code==='ENOENT');assert.equal(b.state.rawReceipt,false);
  }
 });
 test('parallel raw retries and commit crash adopt identical immutable bytes; cleanup rollback retries absence',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw),service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  b.state.failCommit='raw';assert.equal((await rawCall(service,raw)).status,503);assert.equal(b.state.rawReceipt,false);assert.deepEqual(await f.store.readPart(owner,design,photo,'raw'),raw);
  const results=await Promise.all([rawCall(service,raw),rawCall(service,raw)]);assert.deepEqual(results.map(x=>x.status),[200,200]);
  const complete=await call(service.photoHandlers.photoComplete,request('POST'));assert.equal(complete.statusCode,200);
  b.state.deleted=true;b.state.failCommit='cleanup';await assert.rejects(service.photoRecovery({session,backend:b.scoped}));assert.notEqual(b.state.allocation,0);
  b.state.work=null;await service.photoRecovery({session,backend:b.scoped});assert.equal(b.state.allocation,0);
 });
 test('ready publication survives a lost commit and is adopted on retry after the lease',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw),service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,raw)).status,200);b.state.failCommit='ready';
  assert.equal((await call(service.photoHandlers.photoComplete,request('POST'))).statusCode,503);
  assert.equal(b.state.status,'pending');const orphan=await f.store.readPart(owner,design,photo,'ready');
  b.state.work=null;const retried=await call(service.photoHandlers.photoComplete,request('POST'));
  assert.equal(retried.statusCode,200);assert.equal(retried.body.checksum,digest(orphan));assert.equal(b.state.status,'ready');
 });
 test('process restart retains and charges a published object and abandoned stage',async()=>{
  const f=await fixture(),raw=await png();
  const modulePath=path.resolve(__dirname,'../server/photo-files.cjs');
  const child=`const {createPhotoStore}=require(process.argv[1]); const {Readable}=require('node:stream'); (async()=>{const s=createPhotoStore({root:process.argv[2],publicRoot:process.argv[3],minFreeBytes:0,testOnly:{allowUnsafeDirectorySync:true,syncDir:async()=>{},diskFree:async()=>100000000000}});await s.init();const b=Buffer.from(process.argv[4],'base64');const x=await s.stage(process.argv[5],process.argv[6],process.argv[7],Readable.from([b]),b.length);await x.publish('raw');process.exit(0);})().catch(()=>process.exit(1));`;
  await promisify(execFile)(process.execPath,['-e',child,modulePath,f.root,f.pub,raw.toString('base64'),owner,design,photo],{env:process.env});
  const staging=path.join(f.root,'staging',owner,design,photo), names=await fs.readdir(staging);assert.equal(names.length,1);
  assert.ok(await f.store.usedBytes()>=2*raw.length);assert.deepEqual(await f.store.readPart(owner,design,photo,'raw'),raw);
  await fs.utimes(path.join(staging,names[0]),new Date(1),new Date(1));assert.equal(await f.store.reapStale(owner),1);
  const retry=await f.store.stage(owner,design,photo,Readable.from([raw]),raw.length);await retry.publish('raw');await retry.dispose();
  assert.deepEqual(await f.store.readPart(owner,design,photo,'raw'),raw);
 });
 test('only one concurrent completion publishes; logout during sanitization fences it',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw);let start,release;
  const begun=new Promise(r=>start=r), paused=new Promise(r=>release=r);
  const service=makeService({backend:b.factory,store:f.store,sanitize:async bytes=>{start();await paused;return bytes;}});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,raw)).status,200);
  const first=call(service.photoHandlers.photoComplete,request('POST'));await begun;
  const second=await call(service.photoHandlers.photoComplete,request('POST'));assert.equal(second.statusCode,409);
  b.state.live=false;release();assert.equal((await first).statusCode,409);
  await assert.rejects(f.store.readPart(owner,design,photo,'ready'),e=>e.code==='ENOENT');
 });
 test('changed reservation session and lost writer readiness block publication',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw);let writer=true;
  const service=createPhotoService({backend:b.factory,store:f.store,exclusiveWriter:async()=>writer,maintenanceReady:async()=>true});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,raw)).status,200);
  b.state.reservationSession='99999999-9999-4999-8999-999999999999';
  assert.equal((await call(service.photoHandlers.photoComplete,request('POST'))).statusCode,409);
  b.state.reservationSession=sessionId;writer=false;
  assert.equal((await call(service.photoHandlers.photoComplete,request('POST'))).statusCode,503);
  await assert.rejects(f.store.readPart(owner,design,photo,'ready'),e=>e.code==='ENOENT');
 });
 test('the runtime raw PUT seam consumes the stream and returns the handler result',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw),service=makeService({backend:b.factory,store:f.store});b.setRecovery(service.photoRecovery);
  const origin='http://127.0.0.1:54321', secret='fixture-only-csrf-secret-32-bytes-long';
  const runtime=createRuntime({origin,dist:f.pub,integrations:{csrfSecret:secret,resolveSession:async()=>session,assertApproved:async()=>true,handlers:service.photoHandlers}});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try {
    const port=runtime.server.address().port, headers={origin,'content-type':'image/png','x-homeplanner-session':sessionId,'x-homeplanner-csrf':csrfFor(secret,sessionId)};
    const url=`http://127.0.0.1:${port}/api/designs/${design}/photos/${photo}/raw`;
    const res=await fetch(url,{method:'PUT',headers,body:raw});assert.equal(res.status,200);assert.deepEqual(await res.json(),{});
    assert.deepEqual(await f.store.readPart(owner,design,photo,'raw'),raw);
  } finally {await runtime.stop();}
 });
 test('delete while Sharp runs prevents ready publication',async()=>{
  const f=await fixture(),raw=await png(),b=backendFor(raw);let start,release;
  const begun=new Promise(r=>start=r), paused=new Promise(r=>release=r);
  const service=makeService({backend:b.factory,store:f.store,sanitize:async bytes=>{start();await paused;return bytes;}});b.setRecovery(service.photoRecovery);
  assert.equal((await rawCall(service,raw)).status,200);
  const pending=call(service.photoHandlers.photoComplete,request('POST'));await begun;b.state.deleted=true;release();
  assert.equal((await pending).statusCode,409);await assert.rejects(f.store.readPart(owner,design,photo,'ready'),e=>e.code==='ENOENT');
 });

