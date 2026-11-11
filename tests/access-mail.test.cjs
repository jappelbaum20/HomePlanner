'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const access=require('../server/access.cjs'), mail=require('../server/mail-outbox.cjs');
const request=require('../api/access/requests.js'), bind=require('../api/access/bind.js'), approve=require('../api/admin/access/requests/[id]/approve.js'), review=require('../api/admin/access/requests/[id].js');
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const origin='https://home.appelbaums.com',nonce='n'.repeat(43),grant='g'.repeat(43),client='fixture.apps.googleusercontent.com';
function fixture(){
 const calls=[];const now=Math.floor(Date.now()/1000);
 const s={calls,claims:{iss:'https://accounts.google.com',aud:client,sub:'verified-subject',email:'Applicant@example.invalid',email_verified:true,nonce,iat:now,exp:now+300}};
 s.deps={origin,googleClientId:client,getTrustedClientIp:()=> '127.0.0.1',verifyCsrf:async()=>true,verifyGoogleToken:async()=>s.claims,accessStore:{
  async request(...x){calls.push(['request',...x]);return true;},async bindVerified(...x){calls.push(['bind',...x]);return {status:'approved'};},
  async decide(...x){calls.push(['decide',...x]);return {status:'approved',revision:2};},async review(...x){calls.push(['review',...x]);return {id:requestId,revision:1};}
 }};return s;
}
async function call(api,fx,{method='GET',body,headers={},query={},authenticated=true}={}){
 const req={method,body,query,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(authenticated?{homeplannerSession:{userId,sessionId}}:{})};
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.data=x;this.writableEnded=true;return this;},end(){this.writableEnded=true;return this;}};
 await api.createHandler(fx.deps)(req,res);return res;
}
test('strict public requests reject unknown fields, header controls, bad origins and oversize',async()=>{
 const fx=fixture();
 const body={name:'Example',email:'EXAMPLE+one@example.invalid',note:'Hello'};
 assert.deepEqual(access.validateRequest(body),{name:'Example',email:'example+one@example.invalid',note:'Hello'});
 for(const invalid of [{...body,role:'admin'},{...body,name:'Bad\r\nBcc: x'}, {...body,email:'x@example.invalid\nBcc:y'}, {...body,note:'x'.repeat(1001)}]) assert.throws(()=>access.validateRequest(invalid));
 assert.equal((await call(request,fx,{method:'POST',body,authenticated:false})).statusCode,403);
 assert.equal((await call(request,fx,{method:'POST',body,headers:{origin},authenticated:false})).statusCode,202);
 assert.equal(fx.calls[0][0],'request');
 assert.equal((await call(request,fx,{method:'POST',body:{...body,note:'x'.repeat(5000)},headers:{origin},authenticated:false})).statusCode,413);
});
test('binding requires verified fresh Google claims, exact origin, session and CSRF',async()=>{
 const fx=fixture(), opts={method:'POST',body:{token:'signed-fixture',nonce},headers:{origin,'x-homeplanner-session':sessionId,'x-homeplanner-csrf':'value'}};
 assert.equal((await call(bind,fx,opts)).statusCode,200);
 assert.deepEqual(fx.calls[0].slice(2),[nonce,'applicant@example.invalid','verified-subject']);
 for(const change of [x=>x.email_verified=false,x=>x.aud='other',x=>x.nonce='other',x=>x.iat-=331,x=>x.exp=0,x=>x.iss='https://evil.invalid',x=>x.email='a@example.invalid\nBcc:x']) {
  const f=fixture();change(f.claims);assert.equal((await call(bind,f,opts)).statusCode,403);assert.equal(f.calls.length,0);
 }
 const noCsrf=fixture();delete noCsrf.deps.verifyCsrf;assert.equal((await call(bind,noCsrf,opts)).statusCode,403);
 assert.equal((await call(bind,fx,{...opts,headers:{...opts.headers,'x-homeplanner-session':userId}})).statusCode,403);
});
test('review GET is read only and decision POST requires grant, CSRF, session and revision',async()=>{
 const fx=fixture();const query={id:requestId};
 assert.equal((await call(review,fx,{query,headers:{'x-admin-grant':grant}})).statusCode,200);
 assert.deepEqual(fx.calls.map(x=>x[0]),['review']);
 const opts={method:'POST',body:{},query,headers:{origin,'x-homeplanner-session':sessionId,'x-homeplanner-csrf':'x','x-admin-grant':grant,'if-match':'"1"'}};
 assert.equal((await call(approve,fx,opts)).statusCode,200);
 assert.equal(fx.calls[1].at(-1),'approved');
 for(const headers of [{...opts.headers,'if-match':'1'},{...opts.headers,'x-admin-grant':'bad'},{...opts.headers,origin:'https://bad.invalid'}]) assert.notEqual((await call(approve,fx,{...opts,headers})).statusCode,200);
 assert.equal((await call(approve,fx,{...opts,body:{actor:userId}})).statusCode,422);
});
test('mail fixes recipient, escapes markup and rejects injection; lease failure states are recorded',async()=>{
 const job={id:requestId,requestId,kind:'request',name:'<script>',email:'person@example.invalid',note:'<b>&',messageId:`<request-${requestId}@home.appelbaums.com>`};
 const m=mail.message(job,{origin,from:'sender@example.invalid'});
 assert.equal(m.to,'jacob@appelbaums.com');assert.match(m.html,/&lt;script&gt;/);assert.doesNotMatch(m.html,/<script>/);
 assert.throws(()=>mail.message({...job,email:'person@example.invalid\r\nBcc:evil@example.invalid'},{origin,from:'sender@example.invalid'}));
 const calls=[];let next=[job];const pool={async connect(){return {async query(sql,args){calls.push([sql,args]);if(sql.includes('hp_mail_claim'))return {rows:[{result:next.splice(0)}]};if(sql.includes('hp_mail_finish'))return {rows:[{result:true}]};return {rows:[]};},release(){}};}};
 const unavailable=mail.createOutboxWorker({pool,origin,from:'sender@example.invalid'});assert.equal((await unavailable.runOnce()).outcome,'unavailable');
 assert.equal(calls.find(x=>x[0].includes('hp_mail_finish'))[1][2],'unavailable');
 next=[job];const sent=[];const worker=mail.createOutboxWorker({pool,origin,from:'sender@example.invalid',transport:{async sendMail(msg){sent.push(msg);return {accepted:[msg.to]};}}});
 assert.equal((await worker.runOnce()).outcome,'accepted');assert.equal(sent[0].messageId,job.messageId);
 next=[job];const failed=mail.createOutboxWorker({pool,origin,from:'sender@example.invalid',transport:{async sendMail(){throw Error('fixture failure');}}});
 assert.equal((await failed.runOnce()).outcome,'transient');
});
test('real Google verifier validates a synthetic signed token without network access',async()=>{
 const {OAuth2Client}=require('google-auth-library'),crypto=require('node:crypto');
 const fx=fixture(),{privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const signed=encode({alg:'RS256',typ:'JWT',kid:'fixture'})+'.'+encode(fx.claims);
 const token=signed+'.'+crypto.sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
 const previous=OAuth2Client.prototype.getFederatedSignonCertsAsync;
 OAuth2Client.prototype.getFederatedSignonCertsAsync=async()=>({certs:{fixture:publicKey.export({type:'spki',format:'pem'})}});
 delete fx.deps.verifyGoogleToken;
 try {
  assert.equal((await access.verifiedBinding({userId,sessionId},{token,nonce},fx.deps)).status,'approved');
  const corrupt=signed+'.'+Buffer.alloc(256).toString('base64url');
  await assert.rejects(access.verifiedBinding({userId,sessionId},{token:corrupt,nonce},fx.deps),e=>e.status===403);
 } finally {OAuth2Client.prototype.getFederatedSignonCertsAsync=previous;}
});
test('IP rate keys normalize IPv4-mapped IPv6 and IPv6 spellings',()=>{
 assert.equal(access.canonicalIp('::ffff:127.0.0.1'),access.canonicalIp('127.0.0.1'));
 assert.equal(access.canonicalIp('2001:0db8:0000:0000:0000:0000:0000:0001'),access.canonicalIp('2001:db8::1'));
 assert.throws(()=>access.canonicalIp('not-an-ip'));
});
