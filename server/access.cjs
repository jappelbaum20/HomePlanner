'use strict';
const { createHash, createHmac, randomBytes } = require('node:crypto');
const net = require('node:net');
const { fail, uuid } = require('./errors');
const hash = value => createHash('sha256').update(value).digest('hex');
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/u.test(value)) fail(422,'invalid_data','Invalid request.');
  const result = value.trim();
  if ((required && !result) || [...result].length > max) fail(422,'invalid_data','Invalid request.');
  return result;
};
function email(value) {
  const result = text(value,254).toLowerCase();
  // Deliberately conservative ASCII mailbox grammar. Do not rewrite dots/plus.
  if (!/^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(result)) fail(422,'invalid_data','Invalid request.');
  return result;
}
function validateRequest(body) {
  if (!body || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).some(k => !['name','email','note'].includes(k)) || !Object.hasOwn(body,'name') || !Object.hasOwn(body,'email')) fail(422,'invalid_data','Invalid request.');
  return { name:text(body.name,120), email:email(body.email), note:body.note === undefined ? '' : text(body.note,1000,false) };
}
function exactOrigin(req, origin) {
  if (!origin || new URL(origin).origin !== origin || req.headers.origin !== origin) fail(403,'origin_denied','Origin is not allowed.');
}
function session(req) {
  const value = req.homeplannerSession;
  if (!value || !uuid(value.userId) || !uuid(value.sessionId) || value.userId !== value.userId.toLowerCase() || value.sessionId !== value.sessionId.toLowerCase() || value.userId === value.sessionId || req.headers.authorization) fail(401,'unauthenticated','A valid session is required.');
  return { userId:value.userId, sessionId:value.sessionId };
}
async function csrf(req, ctx, deps) {
  exactOrigin(req,deps.origin);
  if (req.headers['x-homeplanner-session'] !== ctx.sessionId || typeof deps.verifyCsrf !== 'function' || await deps.verifyCsrf(req,ctx) !== true) fail(403,'csrf_denied','Request verification failed.');
}
function grant(req) {
  const g=req.headers['x-admin-grant'];
  if (typeof g !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(g)) fail(403,'admin_verification_required','Google verification is required.');
  return hash(g);
}
function canonicalIp(ip) {
  const version=typeof ip==='string' ? net.isIP(ip) : 0;
  if (!version || ip.includes('%')) fail(503,'unavailable','Service is temporarily unavailable.');
  if (version===4) return ip;
  let normalized;
  try { normalized=new URL('http://['+ip+']/').hostname.slice(1,-1); }
  catch { fail(503,'unavailable','Service is temporarily unavailable.'); }
  const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);
  return [high>>8,high&255,low>>8,low&255].join('.');
}
function dbError(error) {
  if (error && error.status) throw error;
  const s=String(error?.message || '');
  if (s.includes('HP_CONFLICT') || error?.code === '23505') fail(409,'conflict','The request has changed.');
  if (s.includes('HP_INVALID')) fail(422,'invalid_data','The request cannot be accepted.');
  if (s.includes('HP_ACCESS_SESSION')) fail(401,'unauthenticated','A valid session is required.');
  if (s.includes('HP_ACCESS_PENDING')) fail(403,'access_pending','Access approval is required.');
  if (s.includes('HP_ACCESS_DENIED')) fail(403,'access_denied','Access was not approved.');
  if (s.includes('HP_ACCESS_REVOKED')) fail(403,'access_revoked','Access was revoked.');
  if (s.includes('HP_NOT_FOUND')) fail(404,'not_found','Resource not found.');
  fail(503,'unavailable','Service is temporarily unavailable.');
}
function createAccessStore({appPool,publicPool,rateKey}={}) {
  if (!appPool?.connect || !publicPool?.connect || !(typeof rateKey==='string' || Buffer.isBuffer(rateKey)) || Buffer.byteLength(rateKey)<32) throw TypeError('Incomplete access configuration');
  async function tx(pool, ctx, grantHash, work) {
    const client=await pool.connect(); let destroy=false;
    try {
      await client.query('BEGIN');
      if (ctx) await client.query("SELECT pg_catalog.set_config('hp.user_id',$1,true),pg_catalog.set_config('hp.session_id',$2,true),pg_catalog.set_config('hp.admin_grant_hash',$3,true)",[ctx.userId,ctx.sessionId,grantHash || '']);
      const result=await work(client); await client.query('COMMIT'); return result;
    } catch (err) { try { await client.query('ROLLBACK'); } catch { destroy=true; } dbError(err); }
    finally { client.release(destroy); }
  }
  const rpc=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.result;
  const digest=(kind,value)=>createHmac('sha256',rateKey).update('access-rate-v1\0').update(kind).update('\0').update(value).digest('hex');
  const actor=(ctx,work,g='')=>tx(appPool,ctx,g,async c=>{ await rpc(c,'SELECT hp_app.hp_access_assert_session() AS result',[]); return work(c); });
  const admin=(ctx,g,work,allowSeed=false)=>actor(ctx,async c=>{
    const subject=await rpc(c,'SELECT hp_app.hp_admin_grant($1) AS result',[g]);
    if (typeof subject!=='string' || !subject) fail(403,'admin_verification_required','Google verification is required.');
    if (!allowSeed) await rpc(c,'SELECT hp_app.hp_access_assert_approved() AS result',[]);
    return work(c,subject);
  },g);
  return Object.freeze({
    async verifyPublicRole() {
      return tx(publicPool,null,'',async c=>{
        const r=await c.query(`SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
          AND pg_catalog.pg_has_role(current_user,'hp_access_public','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_mail_worker','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_app_runtime','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_runtime','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_photo_maintenance','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_app_owner','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_owner','MEMBER')
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('hp_auth','hp_app','hp_private','hp_migration') AND c.relkind IN ('r','p','v','m','f')
              AND (c.relowner=r.oid OR pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) AS ok
          FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`);
        if(r.rows[0]?.ok!==true) throw Error('Invalid public database role');
        return true;
      });
    },
    async request(body,ip) {
      const value=validateRequest(body);
      const key=canonicalIp(ip);
      return tx(publicPool,null,'',c=>rpc(c,'SELECT hp_app.hp_access_request($1,$2,$3,$4,$5) AS result',[value.name,value.email,value.note,digest('ip',key),digest('email',value.email)]));
    },
    status:ctx=>actor(ctx,c=>rpc(c,'SELECT hp_app.hp_access_status() AS result',[])),
    assertApproved:ctx=>actor(ctx,c=>rpc(c,'SELECT hp_app.hp_access_assert_approved() AS result',[])),
    issueChallenge:ctx=>actor(ctx,async c=>{const nonce=randomBytes(32).toString('base64url'); await rpc(c,'SELECT hp_app.hp_access_issue_challenge($1) AS result',[hash(nonce)]); return {nonce,expiresIn:300};}),
    bindVerified:(ctx,nonce,verifiedEmail,subject)=>actor(ctx,c=>rpc(c,'SELECT hp_app.hp_access_bind_verified($1,$2,$3) AS result',[hash(nonce),verifiedEmail,subject])),
    review:(ctx,g,id)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_access_review($1,$2) AS result',[sub,id])),
    entitlements:(ctx,g)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_access_entitlements($1) AS result',[sub])),
    decide:(ctx,g,id,rev,decision)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_access_decide($1,$2,$3,$4) AS result',[sub,id,rev,decision])),
    revoke:(ctx,g,id,rev)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_access_revoke($1,$2,$3) AS result',[sub,id,rev])),
    retryMail:(ctx,g,id,rev)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_mail_retry($1,$2,$3) AS result',[sub,id,rev])),
    seedOwner:(ctx,g)=>admin(ctx,g,(c,sub)=>rpc(c,'SELECT hp_app.hp_access_seed_owner($1) AS result',[sub]),true)
  });
}
async function verifiedBinding(ctx, body, deps) {
  if (!body || Object.getPrototypeOf(body)!==Object.prototype || Object.keys(body).sort().join(',')!=='nonce,token' || typeof body.nonce!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(body.nonce) || typeof body.token!=='string' || body.token.length>16384) fail(422,'invalid_data','Invalid verification.');
  if (typeof deps.googleClientId!=='string' || !deps.googleClientId.endsWith('.apps.googleusercontent.com')) fail(503,'unavailable','Verification is unavailable.');
  let claims;
  try {
    if (deps.verifyGoogleToken) claims=await deps.verifyGoogleToken(body.token,deps.googleClientId);
    else { const {OAuth2Client}=require('google-auth-library'); claims=(await new OAuth2Client().verifyIdToken({idToken:body.token,audience:deps.googleClientId})).getPayload(); }
  } catch { fail(403,'verification_required','Google verification is required.'); }
  const now=Math.floor(Date.now()/1000);
  if (!claims || !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) || claims.aud!==deps.googleClientId || claims.nonce!==body.nonce || claims.email_verified!==true || typeof claims.sub!=='string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) || !Number.isInteger(claims.iat) || claims.iat>now+30 || claims.iat<now-330 || !Number.isInteger(claims.exp) || claims.exp<=now) fail(403,'verification_required','Google verification is required.');
  let normalized; try { normalized=email(claims.email); } catch { fail(403,'verification_required','Google verification is required.'); }
  return deps.accessStore.bindVerified(ctx,body.nonce,normalized,claims.sub);
}
module.exports={createAccessStore,validateRequest,email,canonicalIp,exactOrigin,session,csrf,grant,verifiedBinding};
