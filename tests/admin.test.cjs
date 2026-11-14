'use strict';
// Synthetic identities, signatures and storage; no network or live accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { ApiError } = require('../server/errors');
const challengeApi = require('../api/admin/challenge');
const bootstrapApi = require('../api/admin/bootstrap');
const configApi = require('../api/admin/model-config');
const budgetApi = require('../api/admin/budget');
const meApi = require('../api/me');
const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SESSION='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLIENT='fixture.apps.googleusercontent.com', SUBJECT='fixture-subject';
function fixture() {
 const s={ session:SESSION, subjects:[SUBJECT], claims:null, challenges:new Map(), grants:new Map(), binding:null,
  config:{ revision:1,enabled:false,adapterId:null,modelId:null,connectionRef:null,globalBudgetMicros:25000000,limits:{requestsPerMinute:5,requestsPerDay:20,maxOutputTokens:4000} } };
 s.backend={ async rpc(name,a) {
  if(name==='hp_admin_challenge_issue'){s.challenges.set(a.p_nonce_hash,{session:s.session,subject:a.p_google_subject});return true;}
  if(name==='hp_admin_verify'){
   const c=s.challenges.get(a.p_nonce_hash); if(!c||c.session!==s.session||c.subject!==a.p_google_subject)return false;
   if(s.binding && s.binding!==a.p_google_subject) throw new ApiError(403,'forbidden','Forbidden');
   s.challenges.delete(a.p_nonce_hash);s.binding ||= a.p_google_subject;s.grants.set(a.p_grant_hash,{session:s.session,subject:a.p_google_subject});return true;
  }
  if(name==='hp_admin_grant'){const g=s.grants.get(a.p_grant_hash);return g?.session===s.session?g.subject:null;}
  if(name==='hp_access_is_owner')return s.binding===SUBJECT;
  if(name==='hp_model_config_get')return structuredClone(s.config);
  if(name==='hp_model_config_update'){ if(a.p_revision!==s.config.revision) throw new ApiError(409,'conflict','Conflict');s.config={revision:s.config.revision+1,...structuredClone(a.p_config)};return s.config; }
  throw Error('unexpected RPC');
 }};
 s.deps={backend:s.backend,origin:'https://home.appelbaums.com',googleClientId:CLIENT,connectionAvailable:true,googleSubjects:async()=>s.subjects,verifyGoogleToken:async token=>{if(token!=='valid')throw Error('signature');return s.claims;}};
 return s;
}
async function call(api,s,method,body,headers={},deps=s.deps){
 const req={method,body,headers:{...(body?{'content-type':'application/json'}:{}),...headers},homeplannerSession:{userId:USER,sessionId:s.session,displayName:'A'}};
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.data=x;this.writableEnded=true;return this;},end(){this.writableEnded=true;return this;}};
 await api.createHandler(deps)(req,res);return res;
}
async function proof(s){
 const c=await call(challengeApi,s,'GET');assert.equal(c.statusCode,200);const now=Math.floor(Date.now()/1000);
 s.claims={iss:'https://accounts.google.com',aud:CLIENT,sub:SUBJECT,email:'jacob@appelbaums.com',email_verified:true,nonce:c.data.nonce,iat:now,exp:now+300};
 return {'x-admin-challenge':c.data.nonce,'x-google-id-token':'valid'};
}
test('fresh proof is one-use, grants bind the session, and updates enforce CAS and the adjustable budget guard',async()=>{
 const s=fixture(),h=await proof(s);assert.equal((await call(configApi,s,'GET',undefined,h)).statusCode,403);
 const boot=await call(bootstrapApi,s,'POST',{},h);assert.equal(boot.statusCode,200);assert.equal((await call(bootstrapApi,s,'POST',{},h)).statusCode,403);
 const g={'x-admin-grant':boot.data.grantId};assert.equal((await call(meApi,s,'GET',undefined,g)).data.isAdmin,true);
 assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:10000000001},{...g,'if-match':'"1"'})).statusCode,422);
 assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:25000001},{...g,'if-match':'"1"'})).statusCode,200);
 assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:1000000},{...g,'if-match':'"2"'})).statusCode,200);
 assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:1000000},{...g,'if-match':'"2"'})).statusCode,409);
 s.session=OTHER;assert.equal((await call(meApi,s,'GET',undefined,g)).statusCode,403);
});
test('owner navigation does not confer an administrator grant',async()=>{
 const s=fixture(); let response=await call(meApi,s,'GET');
 assert.equal(response.data.isOwner,false); assert.equal(response.data.isAdmin,false);
 s.binding=SUBJECT; response=await call(meApi,s,'GET');
 assert.equal(response.data.isOwner,true); assert.equal(response.data.isAdmin,false);
 assert.equal((await call(configApi,s,'GET')).statusCode,403);
});
test('verification rejects bad signature, nonce, issuer, audience, email, timing and unlinked or changed subjects',async()=>{
 for(const mutate of [
  (s,h)=>h['x-google-id-token']='forged',s=>s.claims.email_verified=false,s=>s.claims.email='other@example.invalid',
  s=>s.claims.aud='wrong.apps.googleusercontent.com',s=>s.claims.iss='https://evil.invalid',s=>s.claims.nonce='wrong',
  s=>s.claims.iat-=331,s=>s.claims.exp-=301,s=>s.subjects=[],s=>{s.claims.sub='changed';s.subjects=['changed'];},
  (s,h)=>h['x-admin-challenge']+='x',s=>s.session=OTHER
 ]) { const s=fixture(),h=await proof(s);mutate(s,h);assert.equal((await call(bootstrapApi,s,'POST',{},h)).statusCode,403); }
});
test('real Google verifier accepts the signed synthetic token and rejects a bad signature',async()=>{
 const s=fixture(),h=await proof(s),{privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const data=`${enc({alg:'RS256',typ:'JWT',kid:'fixture'})}.${enc(s.claims)}`;
 const token=`${data}.${crypto.sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}`;
 const original=OAuth2Client.prototype.getFederatedSignonCertsAsync;OAuth2Client.prototype.getFederatedSignonCertsAsync=async()=>({certs:{fixture:publicKey.export({type:'spki',format:'pem'})}});
 try { const deps={...s.deps};delete deps.verifyGoogleToken;
  assert.equal((await call(bootstrapApi,s,'POST',{}, {...h,'x-google-id-token':token},deps)).statusCode,200);
  const s2=fixture(),h2=await proof(s2);const broken=token.slice(0,token.lastIndexOf('.')+1)+Buffer.alloc(256).toString('base64url');
  const deps2={...s2.deps};delete deps2.verifyGoogleToken;assert.equal((await call(bootstrapApi,s2,'POST',{}, {...h2,'x-google-id-token':broken},deps2)).statusCode,403);
 } finally {OAuth2Client.prototype.getFederatedSignonCertsAsync=original;}
});
test('validated model set permits switching and invalidates on connection rotation', () => {
 const {connectionValidated,safeConfig}=require('../server/model-config');
 const oldVersion=process.env.OPENAI_CONNECTION_VERSION,oldSet=process.env.OPENAI_VALIDATED_CONNECTIONS;
 try {
  process.env.OPENAI_CONNECTION_VERSION='test-v1';
  process.env.OPENAI_VALIDATED_CONNECTIONS=JSON.stringify(['gpt-6-luna','gpt-6-sol'].map(modelId=>({modelId,connectionId:'primary',version:'test-v1'})));
  assert.equal(connectionValidated('gpt-6-luna'),true); assert.equal(connectionValidated('gpt-6-sol'),true);
  assert.equal(connectionValidated('unknown'),false);
  process.env.OPENAI_CONNECTION_VERSION='test-v2'; assert.equal(connectionValidated('gpt-6-sol'),false);
  process.env.OPENAI_VALIDATED_CONNECTIONS='bad'; assert.equal(connectionValidated('gpt-6-luna'),false);
 } finally {
  if(oldVersion===undefined) delete process.env.OPENAI_CONNECTION_VERSION; else process.env.OPENAI_CONNECTION_VERSION=oldVersion;
  if(oldSet===undefined) delete process.env.OPENAI_VALIDATED_CONNECTIONS; else process.env.OPENAI_VALIDATED_CONNECTIONS=oldSet;
 }
});
