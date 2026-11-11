'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const { createGmailTransport }=require('../server/gmail-transport.cjs');
const { trustedClientIp, accessRequestsAvailable }=require('../runtime/composition.cjs');
const { createBackend }=require('../server/db');
const { createPhotoService, digest }=require('../server/photos');
const u='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', s='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('SMTP adapter pins implicit TLS, verification, timeouts and private authentication with no debug',async()=>{
 let options, sent=0, closed=0;
 const adapter=createGmailTransport('fixture-app-password',{createTransport(o){options=o;return {sendMail:async mail=>{sent++;return {accepted:[mail.to]};},close(){closed++;}};}});
 assert.equal(sent,0); assert.equal(options.host,'smtp.gmail.com'); assert.equal(options.port,465); assert.equal(options.secure,true);
 assert.equal(options.tls.rejectUnauthorized,true); assert.equal(options.tls.servername,'smtp.gmail.com');
 assert.equal(options.auth.user,'jacob@appelbaums.com'); assert.equal(options.debug,false); assert.equal(options.logger,false);
 assert.ok(options.connectionTimeout <= 15000 && options.socketTimeout <= 30000);
 assert.deepEqual((await adapter.sendMail({to:'fixture@example.invalid'})).accepted,['fixture@example.invalid']); adapter.close(); assert.equal(closed,1);
});

for (const disconnect of [false,true]) test(`photo download releases the database before streaming and survives ${disconnect?'disconnect':'a slow consumer'}`,async()=>{
 const {Writable}=require('node:stream');
 const design='cccccccc-cccc-4ccc-8ccc-cccccccccccc', photo='dddddddd-dddd-4ddd-8ddd-dddddddddddd', bytes=Buffer.alloc(200000,42);
 let locked=false,wasLocked=false,writes=0,releaseWrite,releaseFinal;
 const row={status:'ready',object_key:`${u}/${design}/${photo}/ready`,mime:'image/png',bytes:bytes.length,checksum:digest(bytes)};
 const scoped={async withPhotoRead(d,p,work){locked=true;wasLocked=true;try{return await work(row);}finally{locked=false;}}};
 const service=createPhotoService({backend:{forSession:()=>scoped},store:{ready:()=>true,readPart:async()=>bytes},origin:'http://localhost:4321',exclusiveWriter:async()=>true,maintenanceReady:async()=>true});
 const req={method:'GET',headers:{},query:{id:design,photoId:photo},homeplannerSession:{userId:u,sessionId:s}};
 const res=new Writable({highWaterMark:1,write(b,enc,cb){assert.equal(locked,false);writes++;if(writes===1)releaseWrite=cb;else cb();},final(cb){assert.equal(locked,false);releaseFinal=cb;}});
 res.setHeader=()=>{};res.status=function(n){this.statusCode=n;return this;};res.json=()=>{throw Error('unexpected JSON');};
 const pending=service.photoHandlers.photoDownload(req,res);
 await new Promise(setImmediate);
 assert.equal(wasLocked,true);assert.equal(locked,false);assert.equal(writes,1); // Released while backpressure holds the stream.
 if(disconnect) res.destroy();
 else {
   releaseWrite();await new Promise(setImmediate);
   assert.equal(locked,false);assert.equal(res.writableFinished,false);
   releaseFinal();
 }
 await pending;assert.equal(locked,false);
 assert.equal(disconnect?res.destroyed:res.writableFinished,true);
});

test('more concurrent slow photo downloads than pooled connections all succeed',async()=>{
 const {Writable}=require('node:stream');
 const design='cccccccc-cccc-4ccc-8ccc-cccccccccccc', photo='dddddddd-dddd-4ddd-8ddd-dddddddddddd', bytes=Buffer.alloc(200000,42);
 const POOL=5, N=9; let inUse=0, peak=0; const waiters=[];
 const acquire=async()=>{ if(inUse>=POOL){ await new Promise((ok,no)=>{const w={ok};waiters.push(w);setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0){waiters.splice(i,1);no(Object.assign(Error('pool timeout'),{status:503}));}},300);}); } else inUse++; peak=Math.max(peak,inUse); };
 const release=()=>{ const w=waiters.shift(); if(w) w.ok(); else inUse--; };
 const row={status:'ready',object_key:`${u}/${design}/${photo}/ready`,mime:'image/png',bytes:bytes.length,checksum:digest(bytes)};
 const scoped={async withPhotoRead(d,p,work){await acquire();try{return await work(row);}finally{release();}}};
 const service=createPhotoService({backend:{forSession:()=>scoped},store:{ready:()=>true,readPart:async()=>bytes},origin:'http://localhost:4321',exclusiveWriter:async()=>true,maintenanceReady:async()=>true});
 const gates=[];
 const runs=Array.from({length:N},()=>{
  const req={method:'GET',headers:{},query:{id:design,photoId:photo},homeplannerSession:{userId:u,sessionId:s}};
  const res=new Writable({highWaterMark:1,write(b,enc,cb){gates.push(cb);}});
  res.setHeader=()=>{};res.status=function(n){this.statusCode=n;return this;};res.json=()=>{throw Error('unexpected JSON');};
  return {res,done:service.photoHandlers.photoDownload(req,res)};
 });
 await new Promise(r=>setTimeout(r,500)); // Longer than the acquire timeout while every consumer is stalled.
 assert.equal(gates.length,N); assert.equal(inUse,0); assert.ok(peak<=POOL);
 while(runs.some(r=>!r.res.writableFinished)){ const g=gates.splice(0); g.forEach(cb=>cb()); await new Promise(setImmediate); }
 await Promise.all(runs.map(r=>r.done));
 for(const r of runs) assert.equal(r.res.statusCode,200);
});

test('ingress uses a single client address only from the exact configured peer',()=>{
 const req=(peer,ip)=>({socket:{remoteAddress:peer},headers:{'x-forwarded-for':ip}});
 assert.equal(trustedClientIp(req('::ffff:172.22.0.2','203.0.113.4'),'172.22.0.2'),'203.0.113.4');
 assert.throws(()=>trustedClientIp(req('172.22.0.3','203.0.113.4'),'172.22.0.2'));
 assert.throws(()=>trustedClientIp(req('172.22.0.2','203.0.113.4, 203.0.113.5'),'172.22.0.2'));
 assert.throws(()=>trustedClientIp(req('172.22.0.2','bogus'),'172.22.0.2'));
});

test('protected transaction checks entitlement before work; identity challenge is an explicit escape',async()=>{
 let allowed=false; const seen=[];
 const client={async query(sql){seen.push(sql);if(sql.includes('hp_access_assert_approved')&&!allowed) throw Error('HP_ACCESS_PENDING');return {rows:[{result:[]} ]};},release(){}};
 const backend=createBackend({appPool:{connect:async()=>client}}).forSession({userId:u,sessionId:s});
 let dispatched=false;
 await assert.rejects(backend.withApproved(async()=>{dispatched=true;}),e=>e.status===403&&e.code==='access_pending'); assert.equal(dispatched,false);
 assert.ok(seen.indexOf('SELECT hp_app.hp_access_assert_approved()')<seen.indexOf('ROLLBACK'));
 seen.length=0; await backend.googleSubjects(); assert.ok(!seen.some(x=>x.includes('hp_access_assert_approved')));
 allowed=true; seen.length=0; await backend.withApproved(async()=>{dispatched=true;seen.push('work');});
 assert.ok(seen.indexOf('SELECT hp_app.hp_access_assert_approved()')<seen.indexOf('work')); assert.equal(seen.at(-1),'COMMIT');
  seen.length=0; await backend.withPhotoRead('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd',async()=>{seen.push('bytes');});
  assert.ok(seen.indexOf('SELECT hp_app.hp_access_assert_approved()')<seen.indexOf('bytes')); assert.equal(seen.at(-1),'COMMIT');
});

test('access requests are accepted with mail disabled as long as a trusted ingress address exists',()=>{
 assert.equal(accessRequestsAvailable({proxyIp:'192.0.2.10'}),true); // No mail transport is part of the decision.
 assert.equal(accessRequestsAvailable({proxyIp:''}),false);
 assert.equal(accessRequestsAvailable({}),false);
 assert.equal(accessRequestsAvailable(),false);
});
