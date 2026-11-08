'use strict';
const { randomUUID } = require('node:crypto');
const { createPhotoMaintenanceBackend } = require('./db');

// Runs only under the external process-lifetime volume writer gate. It never
// creates a user session and never receives an unrestricted SQL interface.
function createPhotoMaintenance({ maintenancePool, store, exclusiveWriter, intervalMs=30000, ownerLimit=8, claimsPerOwner=4, scanLimit=128, graceMs=2*60*60*1000 } = {}) {
  if (!store || typeof store.scanCandidates !== 'function' || typeof exclusiveWriter !== 'function') throw TypeError('Maintenance store and writer gate required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs<100 || !Number.isSafeInteger(graceMs) || graceMs<2*60*60*1000 || !Number.isInteger(ownerLimit) || ownerLimit<1 || ownerLimit>32 || !Number.isInteger(claimsPerOwner) || claimsPerOwner<1 || claimsPerOwner>16 || !Number.isInteger(scanLimit) || scanLimit<1 || scanLimit>1000) throw TypeError('Invalid maintenance limits');
  const db=createPhotoMaintenanceBackend({ maintenancePool });
  let running=false, healthy=false, lastSuccess=0, lastFailure=null, timer=null, inFlight=null, iterator=null, cursor=null;
  const writer=async()=>{ if (await exclusiveWriter() !== true) throw Error('Exclusive writer unavailable'); };
  function key(s,o,d,p,part) { if (s !== `${o}/${d}/${p}/${part}`) throw Error('Invalid cleanup key'); }
  async function cleanup(owner) {
    for (let i=0;i<claimsPerOwner && running;i++) {
      await writer();
      const token=randomUUID(), claim=await db.claim(owner,token);
      if (!claim) return;
      const design=claim.designId, photo=claim.photoId;
      if (!['raw','delete'].includes(claim.mode)) throw Error('Invalid cleanup mode');
      key(claim.rawKey,owner,design,photo,'raw'); key(claim.readyKey,owner,design,photo,'ready');
      await db.withCleanup(owner,design,photo,token,async locked=>{
        await writer();
        const s=locked.snapshot;
        if (!s || s.ownerId!==owner || s.designId!==design || s.photoId!==photo || s.mode!==claim.mode) throw Error('Invalid cleanup snapshot');
        key(s.rawKey,owner,design,photo,'raw'); key(s.readyKey,owner,design,photo,'ready');
        for (const part of claim.mode==='delete' ? ['raw','ready'] : ['raw']) {
          await writer(); await store.remove(owner,design,photo,part); await locked.recordRemoval(part);
        }
        await locked.finishCleanup();
      });
    }
  }
  async function scan() {
    if (!iterator) iterator=store.scanCandidates()[Symbol.asyncIterator]();
    for(let i=0;i<scanLimit && running;i++) {
      const item=await iterator.next();
      if (item.done) { iterator=null; break; }
      const c=item.value; if (!c) continue;
      const before=Date.now()-graceMs;
      if (!await store.candidateEligible(c,before)) continue;
      await writer();
      await db.withClassification(c,async()=>{
        await writer(); return store.removeCandidate(c,before);
      });
    }
  }
  async function pass() {
    await writer();
    if (!store.ready()) throw Error('Photo store unavailable');
    await db.verifyRole();
    const owners=await db.owners(cursor,ownerLimit);
    if (!owners.length) cursor=null;
    else for (const owner of owners) { if (!running) break; await cleanup(owner); cursor=owner; }
    await scan();
  }
  function schedule() {
    if (!running) return;
    timer=setTimeout(()=>{timer=null; void run().catch(()=>{});},intervalMs);
    timer.unref?.();
  }
  async function run() {
    if (inFlight) return inFlight;
    inFlight=(async()=>{
      try { await pass(); if (running) { healthy=true; lastSuccess=Date.now(); lastFailure=null; } }
      catch (e) { healthy=false; lastFailure='maintenance_failed'; throw e; }
      finally { inFlight=null; schedule(); }
    })();
    return inFlight;
  }
  return Object.freeze({
    async start() {
      if (running) throw Error('Maintenance already started');
      running=true; healthy=false;
      return run();
    },
    async stop() {
      running=false; healthy=false;
      if (timer) { clearTimeout(timer); timer=null; }
      if (inFlight) { try { await inFlight; } catch {} }
      if (iterator) { await iterator.return(); iterator=null; }
    },
    ready() { return running && healthy && Date.now()-lastSuccess <= Math.max(intervalMs*3,intervalMs+15000); },
    health() {
      const ready=running && healthy && Date.now()-lastSuccess <= Math.max(intervalMs*3,intervalMs+15000);
      return Object.freeze({ running, ready, lastSuccessAt:lastSuccess ? new Date(lastSuccess).toISOString() : null,
        failure:lastFailure || (running && lastSuccess && !ready ? 'maintenance_stale' : null) });
    }
  });
}
module.exports={ createPhotoMaintenance };
