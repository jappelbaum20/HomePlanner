import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const root=new URL('../db/migrations/',import.meta.url);
const db=await PGlite.create();
const u='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sid='cccccccc-cccc-4ccc-8ccc-cccccccccccc', nonce='1'.repeat(64), grant='2'.repeat(64);
try {
 await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN;');
 for(const n of ['001_auth.sql','002_business.sql']) await db.exec('BEGIN;\n'+await readFile(new URL(n,root),'utf8')+'\nCOMMIT;');
 await db.query(`INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,'A','a@example.invalid',true,now()),($2,'B','b@example.invalid',true,now())`,[u,v]);
 await db.query(`INSERT INTO hp_auth.account("id","accountId","providerId","userId","createdAt","updatedAt") VALUES (gen_random_uuid(),'subject-a','google',$1,now(),now())`,[u]);
 await db.query(`INSERT INTO hp_auth.session("id","token","userId","expiresAt","createdAt","updatedAt") VALUES ($1,'fixture-cookie',$2,now()+interval '1 day',now(),now())`,[sid,u]);
 await db.exec('SET ROLE hp_app_runtime; BEGIN');
 await db.query(`SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)`,[u,sid]);
 await db.query('SELECT hp_app.assert_actor()');
 const issued=await db.query('SELECT hp_app.hp_admin_challenge_issue($1,$2) AS x',[nonce,'subject-a']);
 const accepted=await db.query('SELECT hp_app.hp_admin_verify($1,$2,$3) AS x',[nonce,'subject-a',grant]);
 const replay=await db.query('SELECT hp_app.hp_admin_verify($1,$2,$3) AS x',[nonce,'subject-a','3'.repeat(64)]);
 const got=await db.query('SELECT hp_app.hp_admin_grant($1) AS x',[grant]);
 if(!issued.rows[0].x || !accepted.rows[0].x || replay.rows[0].x || got.rows[0].x!=='subject-a') throw Error('challenge invariant');
 const create=await db.query('SELECT hp_app.hp_create_design($1,$2,$3,$4::jsonb) AS x',[u,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','4'.repeat(64),JSON.stringify({kind:'shelf',title:'fixture',schemaVersion:3,payload:{},photoIds:[]})]);
 const id=create.rows[0].x.design.id;
 const view=await db.query('SELECT id FROM hp_app.designs WHERE id=$1',[id]); if(view.rows.length!==1)throw Error('own row absent');
 await db.exec('COMMIT; BEGIN');
 await db.query(`SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)`,[v,sid]);
 const hidden=await db.query('SELECT id FROM hp_app.designs WHERE id=$1',[id]); if(hidden.rows.length)throw Error('RLS leak');
 let denied=false; try { await db.query('SELECT hp_app.assert_actor()'); } catch { denied=true; } if(!denied)throw Error('session mismatch');
 await db.exec('ROLLBACK; RESET ROLE;');
 await db.query('DELETE FROM hp_auth.session WHERE id=$1',[sid]);
 await db.exec('SET ROLE hp_app_runtime; BEGIN');
 await db.query(`SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)`,[u,sid]);
 let revoked=false;try { await db.query('SELECT hp_app.assert_actor()'); } catch { revoked=true; } if(!revoked)throw Error('revoked session accepted');
 await db.exec('ROLLBACK; RESET ROLE');
 console.log('PASS: migrations, owner RLS, pool context isolation, mismatch/revocation, admin one-use proof');
} catch(e) { console.log('FAIL: '+e.message+' / '+(e.where||'')+' / '+(e.code||'')); throw e; }
finally { await db.close(); }

