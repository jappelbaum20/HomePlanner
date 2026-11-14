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
  const ids=['adminStatus','modelForm','budgetForm','adminSignIn','adminSignOut','verification','prepareVerification','googleButton','accessAdmin','requestList','requestDetail','entitlementList','waitingCount','reloadAccess'];
  const elements=Object.fromEntries(ids.map(id=>['#'+id,new Element()]));
  for (const name of ['adapterId','modelId','connectionId','enabled','requestsPerMinute','requestsPerDay','maxOutputTokens']) elements['#modelForm'].elements[name]=new Element('input');
  elements['#budgetForm'].elements.budget=new Element('input');
  const account={generation:1,epoch:1,userId:'owner',sessionId:'session',me:{userId:'owner'}};
  const rows=[{id:'old',name:'Decided',email:'old@example.com',note:'',status:'denied',revision:2,createdAt:'2025-01-01T10:00:00Z'},
    {id:'new',name:'Applicant',email:'applicant@example.com',note:'Please approve',status:'pending',revision:1,createdAt:'2025-01-02T10:00:00Z'}];
  const calls=[]; let listener, googleCallback;
  const cloud={subscribe(fn){listener=fn;},init(){listener(account);return true;},snapshot(){return account;},isCurrent(){return true;},async verificationStamp(){return account;},
    async signIn(){},async signOut(){},async request(url,opts={}){
      calls.push({url,opts});
      if(url==='/api/admin/challenge') return {clientId:'fixture.apps.googleusercontent.com',nonce:'fixture',expiresIn:300};
      if(url==='/api/admin/bootstrap') return {isAdmin:true,grantId:'grant',expiresIn:300};
      assert.equal(opts.headers?.['X-Admin-Grant'],'grant');
      if(url==='/api/me') return {userId:'owner',isAdmin:true};
      if(url==='/api/admin/access/requests') return structuredClone(rows);
      if(url==='/api/admin/access/entitlements') return [];
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
  assert.ok(card); assert.ok(flatten(card).some(n=>n.textContent.includes('Please approve')));
  assert.ok(flatten(card).some(n=>n.textContent.includes('2025')));
  assert.ok(list.children.indexOf(card)<list.children.findIndex(n=>n.tagName==='details'));
  const approve=flatten(card).find(n=>n.tagName==='button' && n.textContent==='Approve');
  assert.ok(approve); await approve.events.click();
  assert.equal(elements['#waitingCount'].textContent,'0 requests waiting');
  assert.equal(rows[1].status,'approved');
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
  listener({generation:1,me:{isOwner:false,displayName:'User'}}); assert.equal(elements['#ownerAdminLink'].hidden,true);
  listener({generation:1,me:{isOwner:true,displayName:'Owner'}}); assert.equal(elements['#ownerAdminLink'].hidden,false);
  listener({generation:1,me:{isOwner:true},revalidating:true}); assert.equal(elements['#ownerAdminLink'].hidden,true);
  listener({generation:2,me:null}); assert.equal(elements['#ownerAdminLink'].hidden,true);
});
