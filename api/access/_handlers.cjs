'use strict';
const {wrap,method,revision,jsonBody,id,fail}=require('../../server/errors');
const access=require('../../server/access.cjs');
const handoff=require('../../server/handoff.cjs');
function required(deps) { if (!deps?.accessStore) fail(503,'unavailable','Service is temporarily unavailable.'); return deps.accessStore; }
function query(req,allowed=[]) { if (!req.query || Object.keys(req.query).some(k=>!allowed.includes(k))) fail(400,'invalid_query','Invalid query.'); }
function empty(req) { const b=jsonBody(req,4096); if(Object.keys(b).length) fail(422,'invalid_data','Invalid request.'); }
function create(kind,deps) { return wrap(async req=>{
  const store=required(deps);
  if(kind==='request' || kind==='handoff') {
    // Anonymous: the only credential is the signed 10-minute handoff cookie set after Google sign-in of an unapproved account.
    query(req);
    const claims=typeof deps.handoffFromRequest==='function' ? deps.handoffFromRequest(req) : null;
    if(!claims) fail(401,'handoff_required','Please sign in again.');
    if(kind==='handoff') {
      method(req,['GET']);
      const s=await store.handoffStatus(claims);
      return {body:{email:claims.email,status:s.status,retryAfter:s.retryAfter,csrf:claims.csrf,expiresAt:claims.expiresAt}};
    }
    method(req,['POST']); access.exactOrigin(req,deps.origin);
    if(!handoff.csrfMatches(claims,req.headers['x-homeplanner-handoff-csrf'])) fail(403,'csrf_denied','Request verification failed.');
    empty(req);
    if(typeof deps.getTrustedClientIp!=='function') fail(503,'unavailable','Service is temporarily unavailable.');
    const r=await store.requestVerified(claims,await deps.getTrustedClientIp(req));
    if(r.limited) fail(429,'rate_limited','Please wait before trying again.',{'Retry-After':String(Math.max(1,r.retryAfter||60))});
    return {status:202,body:{status:r.status}};
  }
  const ctx=access.session(req);
  if(kind==='status') { method(req,['GET']);query(req);return {body:await store.status(ctx)}; }
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
