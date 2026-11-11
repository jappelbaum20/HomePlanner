'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const { createBackend }=require('../server/db');
const { authOptions }=require('../server/auth-config.cjs');
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',design='cccccccc-cccc-4ccc-8ccc-cccccccccccc',photo='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function mockPool({fail=false,rollbackFails=false}={}){
 const seen=[];let destroyed;
 const client={async query(sql,args){seen.push({sql,args});if(fail&&sql.includes('hp_access_assert_'))throw Error('database failed');if(rollbackFails&&sql==='ROLLBACK')throw Error('broken connection');if(sql.includes('hp_photo_lock'))return {rows:[{result:{readyKey:'derived'}}]};if(sql.includes('hp_photo_record_publication'))return {rows:[{result:true}]};return {rows:[{result:true}]};},release(x){destroyed=x;}};
 return {seen,get destroyed(){return destroyed},async connect(){return client;}};
}
test('auth configuration is Google-only, uncached and removes provider token material',async()=>{
 const options=authOptions({origin:'https://home.appelbaums.com',authPool:{query(){}},secret:'fixture-only-secret-of-at-least-32-bytes',googleClientId:'fixture.apps.googleusercontent.com',googleClientSecret:'fixture'});
 assert.deepEqual(Object.keys(options.socialProviders),['google']);assert.equal(options.emailAndPassword.enabled,false);assert.equal(options.session.disableSessionRefresh,true);assert.equal(options.session.cookieCache.enabled,false);assert.equal(options.account.accountLinking.enabled,false);assert.equal(options.advanced.crossSubDomainCookies.enabled,false);
 const value=await options.databaseHooks.account.create.before({providerId:'google',accessToken:'x',refreshToken:'y',idToken:'z'});assert.equal(value.data.accessToken,null);assert.equal(value.data.refreshToken,null);assert.equal(value.data.idToken,null);
 assert.throws(()=>authOptions({origin:'https://attacker.invalid',authPool:{query(){}},secret:'x'.repeat(40),googleClientId:'fixture.apps.googleusercontent.com',googleClientSecret:'fixture'}));
});
test('database adapter rejects unregistered SQL and cross-actor arguments before touching a connection',async()=>{
 const pool=mockPool(),backend=createBackend({appPool:pool}).forSession({userId,sessionId});
 await assert.rejects(backend.rpc('hp_create_design; DROP TABLE x',{}),TypeError);
 await assert.rejects(backend.rpc('hp_create_design',{p_user_id:sessionId,p_key:userId,p_body_hash:'1'.repeat(64),p_body:{}}));
 assert.equal(pool.seen.length,0);
});
test('photo callback is bounded by its transaction and rollback failures discard pooled connections',async()=>{
 const pool=mockPool(),backend=createBackend({appPool:pool}).forSession({userId,sessionId});let leaked;
 await backend.withPhotoLock(design,photo,'raw',null,async locked=>{leaked=locked;assert.equal(await locked.recordPublication(1,'1'.repeat(64)),true);});
 assert.equal(pool.seen[0].sql,'BEGIN');assert.equal(pool.seen.at(-1).sql,'COMMIT');
 await assert.rejects(leaked.recordPublication(1,'1'.repeat(64)));
 const broken=mockPool({fail:true,rollbackFails:true}),b=createBackend({appPool:broken}).forSession({userId,sessionId});
 await assert.rejects(b.rpc('hp_model_config_get',{}));assert.equal(broken.destroyed,true);
});
test('owner recovery is required and receives only the captured session and scoped backend',async()=>{
 const pool=mockPool();
 const absent=createBackend({appPool:pool}).forSession({userId,sessionId});
 assert.throws(()=>absent.recoverStorage(),/unavailable/i);
 let call;
 const scoped=createBackend({appPool:pool,photoRecovery:async value=>{call=value;return 'recovered';}}).forSession({userId,sessionId});
 assert.equal(await scoped.recoverStorage(),'recovered');assert.deepEqual(call.session,{userId,sessionId});assert.equal(call.backend,scoped);
});
