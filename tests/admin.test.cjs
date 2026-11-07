'use strict';
// All credentials and identities below are synthetic. No network is used.
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

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT = 'example.apps.googleusercontent.com', SUBJECT = '123456789';
function fixture() {
  const s = { binding: null, user: USER, subjects: [SUBJECT], claims: null,
    config: { revision: 1, enabled: false, adapterId: null, modelId: null, connectionRef: null, globalBudgetMicros: null,
      limits: { requestsPerMinute: 5, requestsPerDay: 20, maxOutputTokens: 4000 } } };
  s.backend = {
    async verify(token) { return token === 'a.b.c' ? { userId: s.user, sessionId: SESSION } : null; },
    async rpc(name, args) {
      if (name === 'hp_admin_binding') return s.binding;
      if (name === 'hp_admin_bootstrap') { if (s.binding && (s.binding.userId !== args.p_user_id || s.binding.googleSubject !== args.p_google_subject)) throw new ApiError(404, 'not_found', 'Not found'); return s.binding ||= { userId: args.p_user_id, googleSubject: args.p_google_subject }; }
      if (name === 'hp_model_config_get') return structuredClone(s.config);
      if (name === 'hp_model_config_update') {
        if (!s.binding || s.binding.userId !== args.p_actor || s.binding.googleSubject !== args.p_google_subject) throw new ApiError(404, 'not_found', 'Not found');
        if (args.p_revision !== s.config.revision) throw new ApiError(409, 'conflict', 'Conflict');
        s.config = { revision: s.config.revision + 1, ...structuredClone(args.p_config) }; return s.config;
      }
      throw Error('unexpected RPC');
    }
  };
  s.deps = { backend: s.backend, origin: 'https://home.appelbaums.com', googleClientId: CLIENT, challengeSecret: 'x'.repeat(48),
    connectionAvailable: true, googleSubjects: async () => s.subjects, verifyGoogleToken: async token => { if (token !== 'valid') throw Error('bad signature'); return s.claims; } };
  return s;
}
async function call(api, s, method, body, headers = {}, deps = s.deps) {
  const req = { method, body, headers: { authorization: 'Bearer a.b.c', ...(body ? { 'content-type': 'application/json' } : {}), ...headers } };
  const res = { headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(x) { this.data = x; this.writableEnded = true; return this; }, end() { this.writableEnded = true; return this; } };
  await api.createHandler(deps)(req,res); return res;
}
async function step(s) {
  const c = await call(challengeApi,s,'GET'); assert.equal(c.statusCode,200);
  const now = Math.floor(Date.now()/1000);
  s.claims = { iss:'https://accounts.google.com', aud:CLIENT, sub:SUBJECT, email:'jacob@appelbaums.com', email_verified:true, nonce:c.data.nonce, iat:now, auth_time:now, exp:now+300 };
  return { 'x-admin-challenge':c.data.nonce, 'x-google-id-token':'valid' };
}
test('admin bootstrap pins a verified linked Google subject and CAS protects cap and configuration', async () => {
  const s = fixture(), h = await step(s);
  assert.equal((await call(configApi,s,'GET',undefined,h)).statusCode,403);
  assert.equal((await call(bootstrapApi,s,'POST',{},h)).statusCode,200);
  assert.deepEqual(s.binding,{userId:USER,googleSubject:SUBJECT});
  const me = await call(meApi,s,'GET',undefined,h); assert.equal(me.data.isAdmin,true); assert.equal(me.data.capabilities.ai,false);
  const body = { enabled:true, adapterId:'openai', modelId:'gpt-6-luna', connectionId:'primary', limits:s.config.limits };
  assert.equal((await call(configApi,s,'PUT',body,{...h,'if-match':'"1"'})).statusCode,422);
  assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:0},{...h,'if-match':'"1"'})).statusCode,422);
  assert.equal((await call(budgetApi,s,'PUT',{globalBudgetMicros:1000000},{...h,'if-match':'"1"'})).statusCode,200);
  assert.equal((await call(configApi,s,'PUT',body,{...h,'if-match':'"1"'})).statusCode,409);
  const enabled = await call(configApi,s,'PUT',body,{...h,'if-match':'"2"'}); assert.equal(enabled.statusCode,200);
  assert.equal(enabled.data.config.enabled,true); assert.equal(enabled.data.globalBudgetMicros,1000000);
  assert.doesNotMatch(JSON.stringify(enabled.data),/connectionRef|API_KEY|secret|googleSubject/);
  assert.equal((await call(meApi,s,'GET')).data.capabilities.ai,true);
  assert.equal((await call(configApi,s,'PUT',{...body,modelId:'unknown'},{...h,'if-match':'"3"'})).statusCode,422);
});
test('admin rejects forged, unverified, wrong-account, stale, unlinked and changed-subject claims', async () => {
  for (const mutate of [
    (s,h) => h['x-google-id-token']='forged', (s) => s.claims.email_verified=false,
    (s) => s.claims.email='other@example.com', (s) => s.claims.aud='wrong.apps.googleusercontent.com',
    (s) => s.claims.iss='https://evil.invalid', (s) => s.claims.nonce='wrong',
    (s) => s.claims.auth_time-=601, (s) => s.claims.exp-=301, (s) => s.subjects=[],
    (s) => { s.claims.sub='987'; s.subjects=['987']; s.binding={userId:USER,googleSubject:SUBJECT}; },
    (s,h) => h['x-admin-challenge'] += 'x'
  ]) { const s=fixture(), h=await step(s); mutate(s,h); assert.equal((await call(bootstrapApi,s,'POST',{},h)).statusCode,403); }
  const s=fixture(), h=await step(s); s.backend.verify=async()=>null;
  assert.equal((await call(bootstrapApi,s,'POST',{},h)).statusCode,401);
  const noConfig=fixture(); delete noConfig.deps.googleClientId;
  assert.equal((await call(challengeApi,noConfig,'GET')).statusCode,503);
  const forgedMetadata=fixture(); forgedMetadata.backend.verify=async()=>({userId:USER, sessionId:SESSION, user_metadata:{email:'jacob@appelbaums.com',email_verified:true,isAdmin:true}});
  assert.equal((await call(meApi,forgedMetadata,'GET')).data.isAdmin,false);
});
test('actual Google library rejects a bad signature using offline synthetic certificates', async () => {
  const s=fixture(), h=await step(s), {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({alg:'RS256',typ:'JWT',kid:'fixture'})}.${enc(s.claims)}`;
  const token = `${data}.${crypto.sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}`;
  const original=OAuth2Client.prototype.getFederatedSignonCertsAsync;
  OAuth2Client.prototype.getFederatedSignonCertsAsync=async()=>({certs:{fixture:publicKey.export({type:'spki',format:'pem'})}});
  try {
    const deps={...s.deps}; delete deps.verifyGoogleToken;
    assert.equal((await call(bootstrapApi,s,'POST',{}, {...h,'x-google-id-token':token},deps)).statusCode,200);
    const broken=token.slice(0,token.lastIndexOf('.')+1)+Buffer.alloc(256).toString('base64url');
    assert.equal((await call(configApi,s,'GET',undefined,{...h,'x-google-id-token':broken},deps)).statusCode,403);
  } finally { OAuth2Client.prototype.getFederatedSignonCertsAsync=original; }
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
