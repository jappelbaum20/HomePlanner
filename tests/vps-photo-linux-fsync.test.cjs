'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createPhotoStore}=require('../server/photo-files.cjs');
const base=process.env.VPS_LINUX_TEST_ROOT;
test('Linux real directory fsync, hard-link publication and removal on task-owned filesystem',async()=>{
 assert.equal(process.platform,'linux'); assert.equal(process.env.NODE_ENV,'test'); assert.ok(base && path.isAbsolute(base));
 const run=path.join(base,randomUUID()),root=path.join(run,'private'),publicRoot=path.join(run,'public');
 await fs.mkdir(root,{recursive:true,mode:0o700});await fs.mkdir(publicRoot,{recursive:true,mode:0o700});
 // Only the minimum floor is lowered for the isolated fixture. No syncDir or
 // diskFree override: every file and directory sync is the production function.
 const store=createPhotoStore({root,publicRoot,minFreeBytes:0,testOnly:{allowUnsafeDirectorySync:true}});await store.init();
 const owner=randomUUID(),design=randomUUID(),photo=randomUUID(),data=Buffer.from('synthetic linux fsync photo');
 const staged=await store.stageBytes(owner,design,photo,data);await staged.publish('raw');await staged.dispose();
 assert.deepEqual(await store.readPart(owner,design,photo,'raw'),data);assert.equal(await store.usedBytes(),data.length);
 await store.remove(owner,design,photo,'raw');assert.equal(await store.usedBytes(),0);
});
