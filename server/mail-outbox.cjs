'use strict';
const {randomUUID}=require('node:crypto');
const {email}=require('./access.cjs');
const ADMIN='jacob@appelbaums.com';
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(job,{origin,from}) {
  const url=new URL(origin);
  if (url.origin!==origin || (origin!=='https://home.appelbaums.com' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw TypeError('Invalid mail origin');
  const sender=email(from), recipient=job.kind==='request'?ADMIN:email(job.email);
  if (!/^[0-9a-f-]{36}$/.test(job.requestId) || !/^<(?:request|decision)-[0-9a-f-]+(?:-[0-9]+)?@home\.appelbaums\.com>$/.test(job.messageId) || !['request','approved','denied'].includes(job.kind)) throw TypeError('Invalid mail job');
  const link=origin+'/admin.html?accessRequest='+job.requestId;
  let subject, lines;
  if (job.kind==='request') {
    subject='HomePlanner access request';
    lines=['A new access request was recorded.','Name: '+job.name,'Email: '+job.email,'Note: '+job.note,'Review after signing in: '+link];
  } else {
    subject='HomePlanner access request update';
    lines=[job.kind==='approved'?'Your access request was approved.':'Your access request was not approved.', 'Visit '+origin+'/ to sign in or see the current access status.'];
  }
  // Validate all stored fields again before constructing headers/body.
  if ([job.name,job.note,job.email].some(x=>typeof x!=='string' || /[\x00-\x1f\x7f-\x9f]/u.test(x))) throw TypeError('Invalid mail content');
  email(job.email);
  return {from:sender,to:recipient,subject,messageId:job.messageId,text:lines.join('\n'),html:lines.map(line=>'<p>'+escapeHtml(line)+'</p>').join('')};
}
function createOutboxWorker({pool,transport,origin,from,sendTimeoutMs=60000}={}) {
  if (!pool?.connect || !Number.isInteger(sendTimeoutMs) || sendTimeoutMs<1 || sendTimeoutMs>90000) throw TypeError('Incomplete outbox configuration');
  async function transaction(work) {
    const c=await pool.connect(); let destroy=false;
    try { await c.query('BEGIN'); const value=await work(c); await c.query('COMMIT'); return value; }
    catch(e) { try { await c.query('ROLLBACK'); } catch { destroy=true; } throw e; }
    finally { c.release(destroy); }
  }
  const result=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.result;
  async function verifyRole() {
    return transaction(async c=>{
      const r=await c.query(`SELECT NOT rol.rolsuper AND NOT rol.rolbypassrls AND NOT rol.rolcreatedb AND NOT rol.rolcreaterole AND NOT rol.rolreplication
        AND pg_catalog.pg_has_role(current_user,'hp_mail_worker','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_access_public','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_app_runtime','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_runtime','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_photo_maintenance','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_app_owner','MEMBER')
        AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_owner','MEMBER')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('hp_auth','hp_app','hp_private','hp_migration') AND c.relkind IN ('r','p','v','m','f')
            AND (c.relowner=rol.oid OR pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) AS ok
        FROM pg_catalog.pg_roles rol WHERE rol.rolname=current_user`);
      if(r.rows[0]?.ok!==true) throw Error('Invalid outbox database role');
      return true;
    });
  }
  async function runOnce() {
    const token=randomUUID();
    const jobs=await transaction(c=>result(c,'SELECT hp_app.hp_mail_claim($1,$2) AS result',[token,1]));
    if (!Array.isArray(jobs) || jobs.length===0) return {processed:false};
    const job=jobs[0]; let outcome='unavailable';
    if (transport && typeof transport.sendMail==='function') {
      let timer;
      try {
        const mail=message(job,{origin,from});
        const sent=await Promise.race([transport.sendMail(mail),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),sendTimeoutMs);})]);
        outcome=Array.isArray(sent?.accepted) && sent.accepted.includes(mail.to) ? 'accepted' : 'transient';
      } catch(e) { outcome=e instanceof TypeError ? 'permanent' : e?.permanent===true ? 'permanent' : 'transient'; }
      finally { if(timer) clearTimeout(timer); }
    }
    const finished=await transaction(c=>result(c,'SELECT hp_app.hp_mail_finish($1,$2,$3) AS result',[job.id,token,outcome]));
    return {processed:true,recorded:finished===true,outcome};
  }
  return Object.freeze({verifyRole,runOnce});
}
module.exports={createOutboxWorker,message,escapeHtml};
