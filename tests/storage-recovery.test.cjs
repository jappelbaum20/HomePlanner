'use strict';
// Synthetic Storage and RPC interleavings; the actual service is a release gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverStorage } = require('../server/photos');
const { removeVerified } = require('../server/db');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const design = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const photo = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const prefix = `${owner}/${design}/${photo}/`;
const missing = { data:false, error:{ code:'NoSuchKey', status:404 } };

test('Storage removal requires confirmed logical absence and rejects service ambiguity', async () => {
 let calls=0; const bucket={async remove(keys){calls++;assert.deepEqual(keys,[prefix+'raw']);return {data:[],error:null};},async exists(){return missing;}};
 await removeVerified(bucket,prefix+'raw',true); await removeVerified(bucket,prefix+'raw',false); assert.equal(calls,2);
 bucket.exists=async()=>({data:false,error:{status:404}}); await removeVerified(bucket,prefix+'raw',true);
 bucket.exists=async()=>({data:true,error:null}); await assert.rejects(removeVerified(bucket,prefix+'raw',true));
 bucket.exists=async()=>({data:false,error:{status:403,code:'AccessDenied'}}); await assert.rejects(removeVerified(bucket,prefix+'raw',true));
 bucket.exists=async()=>({data:false,error:null}); await removeVerified(bucket,prefix+'raw',true);
 bucket.remove=async()=>({data:null,error:{status:503}}); await assert.rejects(removeVerified(bucket,prefix+'raw',true));
});

test('unavailable proof does not claim or fence any photo', async () => {
  let calls=0;
  await recoverStorage({userId:owner,backend:{storageRecoveryAvailable:false,async rpc(){ calls++; }}});
  assert.equal(calls,0);
});

test('partial deletion retains allocation until both objects are verified and retry succeeds', async () => {
  const objects = new Set([prefix+'raw',prefix+'ready']);
  let work, finalized=0, failReady=true, rawVerified=false, readyVerified=false;
  const backend = {
    storageRecoveryAvailable:true,
    async rpc(name,args) {
      assert.equal(args.p_user_id,owner);
      if (name==='hp_claim_photo_cleanup') {
        if (work) return null;
        work=args.p_token;
        return {photoId:photo,designId:design,rawKey:prefix+'raw',readyKey:prefix+'ready',mode:'delete',rawRequired:true,readyRequired:true,rawVerified,readyVerified};
      }
      if (name==='hp_record_photo_removal') { assert.equal(args.p_token,work); if(args.p_part==='raw') rawVerified=true; else readyVerified=true; return null; }
      if (name==='hp_finish_photo_cleanup') {
        assert.equal(args.p_token,work);
        assert.equal(objects.size,0);
        finalized++; work='done'; return null;
      }
      throw new Error('unexpected RPC');
    },
    async removeVerified(key) {
      if (key.endsWith('/ready') && failReady) throw new Error('Storage unavailable');
      objects.delete(key);
    }
  };
  await recoverStorage({userId:owner,backend});
  assert.deepEqual([...objects],[prefix+'ready']); assert.equal(finalized,0);
  // The database retains the irreversible claim; an expired lease permits retry.
  work=undefined; failReady=false;
  await recoverStorage({userId:owner,backend});
  assert.equal(objects.size,0); assert.equal(finalized,1);
});

test('concurrent recovery does not finalize a different or stale claim', async () => {
  let work, resume; const gate = new Promise(resolve => { resume=resolve; });
  let entered; const started = new Promise(resolve => { entered=resolve; });
  const finalized=[];
  const backend = {
    storageRecoveryAvailable:true,
    async rpc(name,args) {
      if (name==='hp_claim_photo_cleanup') {
        if (work) return null;
        work=args.p_token;
        return {photoId:photo,designId:design,rawKey:prefix+'raw',mode:'raw',rawRequired:true,rawVerified:false};
      }
      if (name==='hp_record_photo_removal') { if(args.p_token!==work) throw new Error('stale claim'); return null; }
      if (name==='hp_finish_photo_cleanup') {
        if (args.p_token!==work) throw new Error('stale claim');
        finalized.push(args.p_token); work='done'; return null;
      }
    },
    async removeVerified() { entered(); await gate; }
  };
  const first = recoverStorage({userId:owner,backend});
  await started;
  await recoverStorage({userId:owner,backend});
  assert.equal(finalized.length,0);
  // Replace the lease as if the first process stalled and a retry claimed it.
  const stale=work; work='new-claim'; resume(); await first;
  assert.equal(finalized.length,0); assert.notEqual(work,stale);
});

test('retry after a lost deletion response confirms logical absence', async () => {
 let lost=true; const bucket={async remove(){if(lost){lost=false;throw Error('response lost');}return {data:[],error:null};},async exists(){return missing;}};
 await assert.rejects(removeVerified(bucket,prefix+'raw',true));
 await removeVerified(bucket,prefix+'raw',true);
});

test('malformed cleanup paths and backend failures never remove or release quota', async () => {
  let removals=0, finishes=0;
  const backend = {
    storageRecoveryAvailable:true,
    async rpc(name) {
      if (name==='hp_claim_photo_cleanup') return {photoId:photo,designId:design,rawKey:'another-owner/raw',mode:'delete',readyKey:prefix+'ready'};
      finishes++; return null;
    },
    async removeVerified() { removals++; }
  };
  await recoverStorage({userId:owner,backend});
  assert.equal(removals,0); assert.equal(finishes,0);
  backend.rpc=async () => { throw new Error('unavailable'); };
  await recoverStorage({userId:owner,backend});
  assert.equal(removals,0);
});
