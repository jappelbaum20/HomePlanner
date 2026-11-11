'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const handoff=require('../server/handoff.cjs'), {parseTrustedProxies}=require('../server/trusted-proxy.cjs');
const secret='fixture-only-secret-of-at-least-32-bytes!!', other='another-fixture-secret-of-at-least-32-bytes!';
const claims={issuer:'https://accounts.google.com',subject:'sub-1',email:'person@example.invalid',name:'P'};
const now=1_800_000_000_000;
const req=value=>({headers:{cookie:`a=b; ${handoff.COOKIE}=${value}; c=d`}});

test('handoff is bound to the Google subject and verified email, and expires after 10 minutes',()=>{
 const sealed=handoff.seal(secret,claims,now);
 assert.equal(handoff.TTL,600); assert.equal(sealed.maxAge,600);
 const ok=handoff.open(secret,sealed.value,now+1000);
 assert.equal(ok.subject,'sub-1'); assert.equal(ok.email,'person@example.invalid'); assert.equal(ok.issuer,claims.issuer);
 assert.ok(handoff.open(secret,sealed.value,now+599_000));
 assert.equal(handoff.open(secret,sealed.value,now+600_000),null);
 assert.equal(handoff.open(secret,sealed.value,now+3_600_000),null);
 assert.equal(handoff.open(secret,sealed.value,now-60_000),null,'issued in the future');
 assert.ok(handoff.fromRequest(secret,req(sealed.value),now));
 assert.equal(handoff.fromRequest(secret,{headers:{}},now),null);
});
test('handoff rejects tampering, another signing key and a swapped subject',()=>{
 const a=handoff.seal(secret,claims,now), b=handoff.seal(secret,{...claims,subject:'sub-2'},now);
 assert.equal(handoff.open(other,a.value,now),null);
 const [body]=a.value.split('.'), [,mac]=b.value.split('.');
 assert.equal(handoff.open(secret,body+'.'+mac,now),null,'subject swapped under another signature');
 const payload=JSON.parse(Buffer.from(body,'base64url'));
 const forged=Buffer.from(JSON.stringify({...payload,sub:'sub-2'})).toString('base64url');
 assert.equal(handoff.open(secret,forged+'.'+a.value.split('.')[1],now),null);
 const longer=Buffer.from(JSON.stringify({...payload,exp:payload.exp+3600})).toString('base64url');
 assert.equal(handoff.open(secret,longer+'.'+a.value.split('.')[1],now),null);
 for(const bad of ['', 'x', 'a.b.c', a.value+'x', undefined, null, 5]) assert.equal(handoff.open(secret,bad,now),null);
});
test('handoff CSRF token is separate from the cookie signature and must match exactly',()=>{
 const sealed=handoff.seal(secret,claims,now), opened=handoff.open(secret,sealed.value,now);
 assert.equal(handoff.csrfMatches(opened,sealed.csrf),true);
 assert.notEqual(sealed.csrf,sealed.value.split('.')[1]);
 for(const bad of [undefined,'',sealed.csrf.slice(1),'x'.repeat(43),sealed.value]) assert.equal(handoff.csrfMatches(opened,bad),false);
 assert.notEqual(handoff.seal(secret,claims,now).csrf,sealed.csrf);
});
test('handoff cookie options are host-only, secure, http-only and lax',()=>{
 assert.equal(handoff.COOKIE.startsWith('__Host-'),true);
 assert.deepEqual(handoff.cookieOptions,{maxAge:600,path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
 assert.doesNotMatch(handoff.setCookieHeader('v'),/Domain/i);
});

test('trusted proxy range excludes gateway, own addresses, network, broadcast and outsiders',()=>{
 const p=parseTrustedProxies({cidr:'172.20.0.0/16',local:['172.20.0.2','127.0.0.1']});
 assert.equal(p.configured,true);
 assert.equal(p.trusts('172.20.0.3'),true); assert.equal(p.trusts('::ffff:172.20.0.3'),true); assert.equal(p.trusts('172.20.200.9'),true);
 for(const a of ['172.20.0.1','172.20.0.2','172.20.0.0','172.20.255.255','172.21.0.3','10.0.0.3','203.0.113.5','127.0.0.1','::1','2001:db8::1','not-an-ip','','172.20.0.3%eth0']) assert.equal(p.trusts(a),false,a);
 assert.equal(p.trusts(undefined),false);
});
test('trusted proxy extra exclusions and the legacy single address',()=>{
 const p=parseTrustedProxies({cidr:'172.20.0.0/16',exclude:'172.20.0.9, 172.20.0.10',local:[]});
 assert.equal(p.trusts('172.20.0.9'),false); assert.equal(p.trusts('172.20.0.10'),false); assert.equal(p.trusts('172.20.0.11'),true);
 const legacy=parseTrustedProxies({ip:'172.20.0.5',local:[]}); assert.equal(legacy.trusts('172.20.0.5'),true); assert.equal(legacy.trusts('172.20.0.6'),false);
 assert.equal(parseTrustedProxies({ip:'172.20.0.5',local:['172.20.0.5']}).trusts('172.20.0.5'),false);
 assert.equal(parseTrustedProxies({local:[]}).configured,false); assert.equal(parseTrustedProxies({local:[]}).trusts('172.20.0.3'),false);
});
test('trusted proxy configuration rejects public, too wide, too narrow and malformed ranges',()=>{
 for(const cidr of ['8.8.8.0/24','172.20.0.0/8','172.20.0.0/15','172.20.0.0/31','172.20.0.0/32','172.20.0.5/16','172.20.0.0','172.20.0.0/abc','0.0.0.0/0','999.1.1.1/16','::/0','172.32.0.0/16']) assert.throws(()=>parseTrustedProxies({cidr,local:[]}),Error,cidr);
 assert.throws(()=>parseTrustedProxies({cidr:'172.20.0.0/16',exclude:'nope',local:[]}));
 assert.throws(()=>parseTrustedProxies({ip:'nope',local:[]}));
});
