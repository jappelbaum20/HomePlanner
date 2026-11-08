import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('additive migration retains v3 rows and upgrades a shelf with CAS', async () => {
  const db=await PGlite.create(), root=new URL('../db/migrations/',import.meta.url);
  const u='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  try {
    await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN;');
    for(const name of ['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql']) await db.exec('BEGIN;\n'+await readFile(new URL(name,root),'utf8')+'\nCOMMIT;');
    await db.query(`INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,'Fixture','f@example.invalid',true,now())`,[u]);
    await db.query(`INSERT INTO hp_auth.account("id","accountId","providerId","userId","createdAt","updatedAt") VALUES (gen_random_uuid(),'fixture-subject','google',$1,now(),now())`,[u]);
    await db.query(`INSERT INTO hp_auth.session("id","token","userId","expiresAt","createdAt","updatedAt") VALUES ($1,'fixture',$2,now()+interval '1 day',now(),now())`,[sid,u]);
    const geometry={version:1,width:20};
    await db.exec('SET ROLE hp_app_runtime; BEGIN');
    await db.query(`SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)`,[u,sid]);
    const old={kind:'shelf',title:'Fixture',schemaVersion:3,payload:geometry,photoIds:[]};
    const created=(await db.query('SELECT hp_app.hp_create_design($1,$2,$3,$4::jsonb) AS x',[u,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','4'.repeat(64),JSON.stringify(old)])).rows[0].x;
    await db.exec('COMMIT; RESET ROLE;');
    await db.exec('BEGIN;\n'+await readFile(new URL('005_shelf_documents.sql',root),'utf8')+'\nCOMMIT;');
    await db.exec('SET ROLE hp_app_runtime; BEGIN');
    await db.query(`SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)`,[u,sid]);
    const before=(await db.query('SELECT id,revision,schema_version,payload FROM hp_app.designs WHERE id=$1',[created.design.id])).rows[0];
    assert.equal(Number(before.revision),1); assert.equal(before.schema_version,3); assert.deepEqual(before.payload,geometry);
    const payload={version:2,shelf:geometry,wall:{widthCm:500,heightCm:500,color:'#EEEDE8'},placement:{offsetCm:0,elevationCm:0,gapCm:0},activeTab:'custom'};
    const body={...old,schemaVersion:4,payload};
    const upgraded=(await db.query('SELECT hp_app.hp_update_design($1,$2,$3,$4::jsonb) AS x',[u,created.design.id,1,JSON.stringify(body)])).rows[0].x;
    assert.equal(upgraded.design.id,created.design.id); assert.equal(Number(upgraded.revision),2); assert.deepEqual(upgraded.design.payload,payload);
    for (const downgrade of [old, {...old,schemaVersion:4}]) {
      await db.exec('SAVEPOINT downgrade');
      await assert.rejects(db.query('SELECT hp_app.hp_update_design($1,$2,$3,$4::jsonb)',[u,created.design.id,2,JSON.stringify(downgrade)]),/HP_CONFLICT/);
      await db.exec('ROLLBACK TO SAVEPOINT downgrade');
      const retained=(await db.query('SELECT revision,schema_version,payload FROM hp_app.designs WHERE id=$1',[created.design.id])).rows[0];
      assert.equal(Number(retained.revision),2);
      assert.equal(retained.schema_version,4);
      assert.deepEqual(retained.payload,payload);
    }
    await db.exec('SAVEPOINT invalid_doc');
    const invalid={...body,payload:{...payload,wall:{...payload.wall,widthCm:9}}};
    await assert.rejects(db.query('SELECT hp_app.hp_update_design($1,$2,$3,$4::jsonb)',[u,created.design.id,2,JSON.stringify(invalid)]),/designs_shelf_v4_envelope_check/);
    await db.exec('ROLLBACK TO SAVEPOINT invalid_doc');
    await assert.rejects(db.query('SELECT hp_app.hp_update_design($1,$2,$3,$4::jsonb)',[u,created.design.id,1,JSON.stringify(body)]),/HP_CONFLICT/);
    await db.exec('ROLLBACK; RESET ROLE;');
  } finally { await db.close(); }
});
