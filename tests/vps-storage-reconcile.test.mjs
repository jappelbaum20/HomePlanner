import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
test('maintenance classification preserves live and referenced files but permits unreferenced tombstones',async()=>{
 const db=await PGlite.create();
 try {
  await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN');
  for(const n of ['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql']) await db.exec('BEGIN;\n'+await readFile(new URL('../db/migrations/'+n,import.meta.url),'utf8')+'\nCOMMIT;');
  const owner=randomUUID(),design=randomUUID(),photo=randomUUID(),session=randomUUID(),missing=randomUUID();
  await db.query("INSERT INTO hp_app.designs(id,owner_id,kind,title,schema_version,payload) VALUES($1,$2,'shelf','fixture',3,'{}')",[design,owner]);
  await db.query("INSERT INTO hp_app.design_photos(id,design_id,owner_id,raw_key,requested_mime,requested_bytes,requested_checksum,reservation_session_id,tombstoned_at,allocation_bytes) VALUES($1,$2,$3,$4,'image/png',1,$5,$6,now(),0)",[photo,design,owner,`${owner}/${design}/${photo}/raw`,'1'.repeat(64),session]);
  await db.exec('SET ROLE hp_photo_maintenance');
  const classify=async id=>(await db.query("SELECT hp_app.hp_maintenance_classify($1,$2,$3,'objects') AS ok",[owner,design,id])).rows[0].ok;
  assert.equal(await classify(photo),true);
  await db.exec('RESET ROLE');await db.query('UPDATE hp_app.designs SET photo_ids=$1 WHERE id=$2',[[photo],design]);await db.exec('SET ROLE hp_photo_maintenance');
  assert.equal(await classify(photo),false);assert.equal(await classify(missing),true);
  await db.exec('RESET ROLE');
  await assert.rejects(db.query("INSERT INTO hp_app.design_photos(id,design_id,owner_id,raw_key,requested_mime,requested_bytes,requested_checksum,reservation_session_id) VALUES($1,$2,$3,$4,'image/png',1,$5,$6)",[missing,design,owner,`${owner}/${design}/${missing}/raw`,'1'.repeat(64),session]));
 } finally {await db.close();}
});
