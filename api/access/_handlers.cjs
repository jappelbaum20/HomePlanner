'use strict';
const {wrap,method,revision,jsonBody,id,fail}=require('../../server/errors');
const access=require('../../server/access.cjs');
function required(deps) { if (!deps?.accessStore) fail(503,'unavailable','Service is temporarily unavailable.'); return deps.accessStore; }
function query(req,allowed=[]) { if (!req.query || Object.keys(req.query).some(k=>!allowed.includes(k))) fail(400,'invalid_query','Invalid query.'); }
function empty(req) { const b=jsonBody(req,4096); if(Object.keys(b).length) fail(422,'invalid_data','Invalid request.'); }
function create(kind,deps) { return wrap(async req=>{
  const store=required(deps);
  if(kind==='request') {
    method(req,['POST']); access.exactOrigin(req,deps.origin); query(req);
    if(typeof deps.getTrustedClientIp!=='function') fail(503,'unavailable','Service is temporarily unavailable.');
    await store.request(jsonBody(req,4096),await deps.getTrustedClientIp(req));
    return {status:202,body:{status:'recorded'}};
  }
  const ctx=access.session(req);
  if(kind==='status') { method(req,['GET']);query(req);return {body:await store.status(ctx)}; }
  if(kind==='challenge') { method(req,['GET']);query(req);if(typeof deps.googleClientId!=='string' || !deps.googleClientId.endsWith('.apps.googleusercontent.com')) fail(503,'unavailable','Verification is unavailable.');const c=await store.issueChallenge(ctx);return {body:{...c,clientId:deps.googleClientId}}; }
  if(kind==='bind') { method(req,['POST']);query(req);await access.csrf(req,ctx,deps);return {body:await access.verifiedBinding(ctx,jsonBody(req,20000),deps)}; }
  const g=access.grant(req);
  if(kind==='list') { method(req,['GET']);query(req);return {body:await store.review(ctx,g,null)}; }
  if(kind==='entitlements') { method(req,['GET']);query(req);return {body:await store.entitlements(ctx,g)}; }
  if(kind==='review') { method(req,['GET']);query(req,['id']);return {body:await store.review(ctx,g,id(req.query.id))}; }
  if(kind==='approve' || kind==='deny') {
    method(req,['POST']);query(req,['id']);await access.csrf(req,ctx,deps);empty(req);
    return {body:await store.decide(ctx,g,id(req.query.id),revision(req.headers['if-match']),kind==='approve'?'approved':'denied')};
  }
  if(kind==='revoke') { method(req,['POST']);query(req,['userId']);await access.csrf(req,ctx,deps);empty(req);return {body:await store.revoke(ctx,g,id(req.query.userId),revision(req.headers['if-match']))}; }
  if(kind==='retry') { method(req,['POST']);query(req,['id']);await access.csrf(req,ctx,deps);empty(req);await store.retryMail(ctx,g,id(req.query.id),revision(req.headers['if-match']));return {body:{status:'queued'}}; }
  fail(404,'not_found','Resource not found.');
},deps); }
module.exports={create};
