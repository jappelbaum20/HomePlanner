import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const root=new URL('../db/migrations/',import.meta.url);
const db=await PGlite.create(), u='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='cccccccc-cccc-4ccc-8ccc-cccccccccccc',key='dddddddd-dddd-4ddd-8ddd-dddddddddddd',token='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',tomb='ffffffff-ffff-4fff-8fff-ffffffffffff', sum='4'.repeat(64);
async function sql(text,args=[]){return (await db.query(text,args)).rows[0]?.x;}
async function actor(session=sid){await db.exec('BEGIN');await db.query("SELECT set_config('hp.user_id',$1,true),set_config('hp.session_id',$2,true)",[u,session]);}
try {
 await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN;');
 for(const n of ['001_auth.sql','002_business.sql','003_photos.sql']) await db.exec('BEGIN;\n'+await readFile(new URL(n,root),'utf8')+'\nCOMMIT;');
 await db.query(`INSERT INTO hp_auth."user"(id,name,email,"emailVerified","updatedAt") VALUES ($1,'A','a@example.invalid',true,now())`,[u]);
 await db.query(`INSERT INTO hp_auth.account("id","accountId","providerId","userId","createdAt","updatedAt") VALUES (gen_random_uuid(),'subject-a','google',$1,now(),now())`,[u]);
 await db.query(`INSERT INTO hp_auth.session("id","token","userId","expiresAt","createdAt","updatedAt") VALUES ($1,'fixture-cookie',$2,now()+interval '1 day',now(),now())`,[sid,u]);
 const nextSession='99999999-9999-4999-8999-999999999999';
 await db.query(`INSERT INTO hp_auth.session("id","token","userId","expiresAt","createdAt","updatedAt") VALUES ($1,'another-fixture-cookie',$2,now()+interval '1 day',now(),now())`,[nextSession,u]);
 await db.exec('SET ROLE hp_app_runtime');await actor();
 const d=await sql('SELECT hp_app.hp_create_design($1,$2,$3,$4::jsonb) AS x',[u,key,sum,JSON.stringify({kind:'shelf',title:'fixture',schemaVersion:3,payload:{},photoIds:[]})]);
 const did=d.design.id, res=await sql('SELECT hp_app.hp_reserve_photo($1,$2,$3,$4,$5) AS x',[u,did,'image/png',30,sum]), pid=res.photoId;
 await db.exec('COMMIT'); await actor(nextSession);
 let switched=false; try { await sql("SELECT hp_app.hp_photo_lock($1,$2,'raw',NULL) AS x",[did,pid]); } catch { switched=true; }
 if(!switched) throw Error('different session accepted reservation');
 await db.exec('ROLLBACK'); await actor();
 await sql("SELECT hp_app.hp_photo_lock($1,$2,'raw',NULL) AS x",[did,pid]);
 await sql("SELECT hp_app.hp_photo_record_publication($1,$2,'raw',NULL,30,$3) AS x",[did,pid,sum]);
 await db.exec('COMMIT');await actor();
 await sql('SELECT hp_app.hp_begin_photo_completion($1,$2,$3,$4) AS x',[u,did,pid,token]);await db.exec('COMMIT');await actor();
 const snap=await sql("SELECT hp_app.hp_photo_lock($1,$2,'ready',$3) AS x",[did,pid,token]);
 await sql("SELECT hp_app.hp_photo_record_publication($1,$2,'ready',$3,20,$4) AS x",[did,pid,token,sum]);
 const ready=await sql('SELECT hp_app.hp_finish_photo_completion($1,$2,$3,$4,$5,20,$6) AS x',[u,did,pid,token,snap.readyKey,sum]);if(ready.photoId!==pid)throw Error('ready');
 await db.exec('COMMIT');await actor();
 const rawClaim=await sql('SELECT hp_app.hp_claim_photo_cleanup($1,$2) AS x',[u,tomb]);if(rawClaim?.mode!=='raw')throw Error('raw cleanup claim');await db.exec('COMMIT');
 await actor();let premature=false;try{await sql('SELECT hp_app.hp_finish_photo_cleanup($1,$2,$3) AS x',[u,pid,tomb]);}catch{premature=true;}if(!premature)throw Error('cleanup released quota without a receipt');await db.exec('ROLLBACK');
 await actor();await sql("SELECT hp_app.hp_photo_lock($1,$2,'cleanup',$3) AS x",[did,pid,tomb]);await sql("SELECT hp_app.hp_record_photo_removal($1,$2,$3,'raw') AS x",[u,pid,tomb]);
 const rawFinished=await sql('SELECT hp_app.hp_finish_photo_cleanup($1,$2,$3) AS x',[u,pid,tomb]);if(rawFinished.logicalRemainingBytes!==20||rawFinished.logicalReleasedBytes!==20971500)throw Error('raw quota release');await db.exec('COMMIT');
 await actor();await sql('SELECT hp_app.hp_delete_design($1,$2,1) AS x',[u,did]);await sql('SELECT hp_app.hp_delete_design($1,$2,1) AS x',[u,did]);await db.exec('COMMIT');
 await actor();let fenced=false;try{await sql("SELECT hp_app.hp_photo_lock($1,$2,'raw',NULL) AS x",[did,pid]);}catch{fenced=true;}if(!fenced)throw Error('delete fence');await db.exec('ROLLBACK');
 await actor();const claim=await sql('SELECT hp_app.hp_claim_photo_cleanup($1,$2) AS x',[u,tomb]);if(claim?.mode!=='delete')throw Error('delete claim');await db.exec('COMMIT');
 await actor();await sql("SELECT hp_app.hp_photo_lock($1,$2,'cleanup',$3) AS x",[did,pid,tomb]);await sql("SELECT hp_app.hp_record_photo_removal($1,$2,$3,'raw') AS x",[u,pid,tomb]);await sql("SELECT hp_app.hp_record_photo_removal($1,$2,$3,'ready') AS x",[u,pid,tomb]);const finished=await sql('SELECT hp_app.hp_finish_photo_cleanup($1,$2,$3) AS x',[u,pid,tomb]);if(finished.logicalReleasedBytes!==20||finished.logicalRemainingBytes!==0)throw Error('delete quota release');await db.exec('COMMIT; RESET ROLE');
 const retained=await sql('SELECT allocation_bytes AS x FROM hp_app.design_photos WHERE id=$1',[pid]);if(Number(retained)!==0)throw Error('quota not released');
 console.log('PASS: photo SQL reservation, fences, completion, receipts, idempotent deletion and receipt-gated logical quota release; no filesystem tested');
} catch(e){console.log('FAIL: '+e.message+' / '+(e.where||'')+' / '+(e.code||''));throw e;}
finally{await db.close();}

