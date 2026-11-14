'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.events={}; this.textContent=''; this.hidden=false; this.disabled=false; this.elements={}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  addEventListener(name, fn) { this.events[name]=fn; }
  reset() {}
}
const flatten = node => [node, ...node.children.flatMap(flatten)];
test('dashboard waits for verification, lists pending first, and decides directly with the grant and revision', async () => {
  const ids=['adminStatus','modelForm','budgetForm','adminSignIn','adminSignOut','verification','prepareVerification','googleButton','accessAdmin','requestList','requestDetail','entitlementList','waitingCount','reloadAccess','addPersonForm','addPersonEmail','addPersonStatus','addPersonActions','addPersonSubmit','addedList'];
  const elements=Object.fromEntries(ids.map(id=>['#'+id,new Element()]));
  for (const name of ['adapterId','modelId','connectionId','enabled','requestsPerMinute','requestsPerDay','maxOutputTokens']) elements['#modelForm'].elements[name]=new Element('input');
  elements['#budgetForm'].elements.budget=new Element('input');
  const account={generation:1,epoch:1,userId:'owner',sessionId:'session',me:{userId:'owner'}};
  const rows=[{id:'old',name:'Decided',email:'old@example.com',note:'',status:'denied',revision:2,createdAt:'2025-01-01T10:00:00Z'},
    {id:'new',name:'Applicant',email:'applicant@example.com',note:'Please approve',status:'pending',revision:1,createdAt:'2025-01-02T10:00:00Z'}];
  const added=[], people=[];
  const calls=[]; let listener, googleCallback;
  const cloud={subscribe(fn){listener=fn;},init(){listener(account);return true;},snapshot(){return account;},isCurrent(){return true;},async verificationStamp(){return account;},
    async signIn(){},async signOut(){},async request(url,opts={}){
      calls.push({url,opts});
      if(url==='/api/admin/challenge') return {clientId:'fixture.apps.googleusercontent.com',nonce:'fixture',expiresIn:300};
      if(url==='/api/admin/bootstrap') return {isAdmin:true,grantId:'grant',expiresIn:300};
      assert.equal(opts.headers?.['X-Admin-Grant'],'grant');
      if(url==='/api/me') return {userId:'owner',isAdmin:true};
      if(url==='/api/admin/access/requests/old') return {...rows[0],note:'n',mail:[{id:'m1',kind:'request',status:'failed',revision:3,attempts:1,errorCategory:'permanent'},{id:'m2',kind:'denied',status:'failed',revision:2,attempts:1,errorCategory:'transient'}]};
      if(url==='/api/admin/access/requests/new') return structuredClone(rows[1]);
      if(url==='/api/admin/access/requests') return structuredClone(rows);
      if(url==='/api/admin/access/entitlements') return [];
      if(url==='/api/admin/access/people' && !opts.method) return structuredClone(added);
      if(url==='/api/admin/access/people' && opts.method==='POST') {
        people.push(opts.body);
        if(opts.body.email==='denied@example.com' && !opts.body.override) return {result:'blocked',state:'denied'};
        if(opts.body.email==='closed@example.com' && !opts.body.override) return {result:'blocked',state:'revoked',restore:true};
        if(opts.body.email==='closed@example.com') return {result:'reinstated'};
        if(opts.body.email==='waiting@example.com') return {result:'pending_request',requestId:'new'};
        if(['has@example.com','slow@example.com'].includes(opts.body.email)) return {result:'has_access'};
        added.push({email:opts.body.email,addedAt:'2025-01-03T10:00:00Z'}); return {result:'added'};
      }
      if(url==='/api/admin/access/people/remove') { added.splice(0,added.length,...added.filter(x=>x.email!==opts.body.email)); return {status:'removed'}; }
      if(url==='/api/admin/access/requests/new/approve') { assert.equal(opts.headers['If-Match'],'"1"'); rows[1].status='approved'; rows[1].revision++; return {}; }
      if(url==='/api/admin/model-config') return {revision:1,config:{enabled:false,adapterId:'fixture',modelId:'fixture',connectionId:'fixture',limits:{requestsPerMinute:1,requestsPerDay:1,maxOutputTokens:1}},globalBudgetMicros:1000000,adapters:[{id:'fixture',label:'Fixture'}],models:[{id:'fixture',label:'Fixture'}],connections:[{id:'fixture',label:'Fixture'}]};
      throw Error('Unexpected request: '+url);
    }};
  const context={window:{HomePlannerCloud:cloud,google:{accounts:{id:{initialize(o){googleCallback=o.callback;},renderButton(){}}}}},
    document:{querySelector:s=>elements[s],createElement:tag=>new Element(tag),head:new Element('head')},
    location:{search:''},history:{replaceState(){}},URLSearchParams,Date,Number,Promise,Error,setTimeout:()=>1,clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin.js'),'utf8'),context);
  assert.equal(elements['#accessAdmin'].hidden,true);
  assert.equal(calls.some(c=>c.url==='/api/admin/access/requests'),false);
  elements['#prepareVerification'].events.click(); await new Promise(setImmediate);
  await googleCallback({credential:'fixture-token'});
  assert.equal(elements['#accessAdmin'].hidden,false);
  assert.equal(elements['#waitingCount'].textContent,'1 request waiting');
  const list=elements['#requestList'], card=list.children.find(n=>n.className==='access-request pending');
  assert.ok(card); assert.ok(flatten(card).some(n=>n.textContent.includes('Applicant')));
  assert.ok(flatten(card).some(n=>n.textContent.includes('2025')));
  assert.ok(list.children.indexOf(card)<list.children.findIndex(n=>n.tagName==='details'));
  const approve=flatten(card).find(n=>n.tagName==='button' && n.textContent==='Approve');
  assert.ok(approve); await approve.events.click();
  assert.equal(elements['#waitingCount'].textContent,'0 requests waiting');
  assert.equal(rows[1].status,'approved');
  const submit=async address=>{ elements['#addPersonEmail'].value=address; await elements['#addPersonForm'].events.submit({preventDefault(){}}); await new Promise(setImmediate); await new Promise(setImmediate); };
  await submit('has@example.com'); assert.match(elements['#addPersonStatus'].textContent,/already has access/);
  elements['#requestDetail'].children=[];
  await submit('waiting@example.com'); assert.match(elements['#addPersonStatus'].textContent,/request from waiting@example.com is waiting/);
  assert.ok(flatten(elements['#requestDetail']).some(n=>n.textContent==='Applicant · applicant@example.com · approved'),'the waiting request stays open after the list reloads');
  assert.equal(elements['#addPersonSubmit'].disabled,false,'submit is enabled again after the request');
  await submit('denied@example.com'); assert.match(elements['#addPersonStatus'].textContent,/was denied before/);
  assert.equal(added.length,0);
  const anyway=elements['#addPersonActions'].children.find(n=>n.textContent==='Allow anyway'); assert.ok(anyway);
  await anyway.events.click(); await new Promise(setImmediate);
  assert.equal(JSON.stringify(people.at(-1)),JSON.stringify({email:'denied@example.com',override:true}));
  assert.equal(added.length,1);
  assert.ok(flatten(elements['#addedList']).some(n=>n.textContent.includes('denied@example.com') && n.textContent.includes('not signed in yet')));
  await submit('closed@example.com'); assert.match(elements['#addPersonStatus'].textContent,/closed account/);
  assert.equal(elements['#addPersonActions'].children.some(n=>n.textContent==='Allow anyway'),false);
  const restoreBtn=elements['#addPersonActions'].children.find(n=>n.textContent==='Restore closed account'); assert.ok(restoreBtn);
  await restoreBtn.events.click(); await new Promise(setImmediate); assert.match(elements['#addPersonStatus'].textContent,/access is restored/);
  // The submit button is disabled while a request is in flight.
  let release; const slow=new Promise(r=>{release=r;}); const realRequest=cloud.request; let sawDisabled=false;
  cloud.request=async(url,opts)=>{ if(url==='/api/admin/access/people' && opts?.method==='POST'){ sawDisabled=elements['#addPersonSubmit'].disabled; await slow; } return realRequest(url,opts); };
  elements['#addPersonEmail'].value='slow@example.com'; const pendingSubmit=elements['#addPersonForm'].events.submit({preventDefault(){}});
  await new Promise(setImmediate); assert.equal(elements['#addPersonSubmit'].disabled,true);
  await elements['#addPersonForm'].events.submit({preventDefault(){}}); assert.equal(people.filter(p=>p.email==='slow@example.com').length,0,'a second submit during the request is ignored');
  release(); await pendingSubmit; await new Promise(setImmediate); await new Promise(setImmediate); cloud.request=realRequest;
  assert.equal(elements['#addPersonSubmit'].disabled,false); assert.equal(people.filter(p=>p.email==='slow@example.com').length,1); assert.equal(sawDisabled,true);
  const removeBtn=flatten(elements['#addedList']).find(n=>n.textContent==='Remove'); await removeBtn.events.click(); await new Promise(setImmediate);
  assert.equal(added.length,0);
  const history=elements['#requestList'].children.find(n=>n.tagName==='details');
  const details=flatten(history).find(n=>n.tagName==='button' && n.textContent==='Details and note'); await details.events.click();
  const texts=flatten(elements['#requestDetail']).map(n=>n.textContent);
  assert.equal(texts.some(t=>t.startsWith('request:')),false);
  assert.ok(texts.some(t=>t.startsWith('denied: failed')));
  assert.equal(flatten(elements['#requestDetail']).filter(n=>n.textContent==='Retry notification').length,1);
});

test('planner account controls hide the owner link for other sessions and during revalidation', () => {
  for(const filename of ['index.html','bookshelf.html']) {
    assert.match(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'), /id="ownerAdminLink"[^>]*\shidden/);
  }
  const ids=['cloudPanel','cloudDlg','cloudStatus','cloudSignIn','cloudSignOut','ownerAdminLink','cloudBtn','cloudClose'];
  const elements=Object.fromEntries(ids.map(id=>['#'+id,new Element()]));
  let listener; const cloud={subscribe(fn){listener=fn;},init(){return true;},snapshot(){return {generation:1};}};
  const bridge={identityChanged(){},clearWorkspace(){}};
  const context={window:{HomePlannerCloud:cloud},document:{querySelector:s=>elements[s],createElement:tag=>new Element(tag)},confirm:()=>true};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/ui.js'),'utf8'),context);
  context.window.HomePlannerCloudUI(bridge);
  listener({generation:1,me:{displayName:'User',access:{status:'approved',role:'user'}}}); assert.equal(elements['#ownerAdminLink'].hidden,true);
  listener({generation:1,me:{displayName:'Owner',access:{status:'approved',role:'owner'}}}); assert.equal(elements['#ownerAdminLink'].hidden,false);
  listener({generation:1,me:{access:{status:'approved',role:'owner'}},revalidating:true}); assert.equal(elements['#ownerAdminLink'].hidden,true);
  listener({generation:2,me:null}); assert.equal(elements['#ownerAdminLink'].hidden,true);
});
