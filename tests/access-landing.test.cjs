'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
test('landing keeps unapproved accounts out of workspaces and shows a truthful unavailable request form',async()=>{
 const elements={};
 for(const id of ['accessStatus','accessSignIn','accessSignOut','binding','prepareBinding','bindingGoogle','requestForm','requestAvailability','workspaces']) {
  elements['#'+id]={hidden:false,disabled:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(){},querySelector(){return {disabled:false};},reset(){}};
 }
 let listener;
 const cloud={subscribe(fn){listener=fn;},init(){return true;},signIn:async()=>{},signOut:async()=>{},snapshot(){return {};},isCurrent(){return true;}};
 const context={window:{HomePlannerCloud:cloud},document:{querySelector:selector=>elements[selector],createElement:()=>({}),head:{append(){}}},
   fetch:async()=>({ok:true,json:async()=>({requestsAvailable:false})}),FormData:class{}, URLSearchParams, Date, console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../landing.js'),'utf8'),context);
 listener({me:{access:{status:'pending'}}});
 assert.equal(elements['#workspaces'].hidden,true); assert.equal(elements['#binding'].hidden,false); assert.match(elements['#accessStatus'].textContent,/awaiting approval/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements['#requestForm'].hidden,true); assert.match(elements['#requestAvailability'].textContent,/temporarily unavailable/);
 listener({me:{access:{status:'denied'}}}); assert.match(elements['#accessStatus'].textContent,/not approved/); assert.equal(elements['#workspaces'].hidden,true);
 listener({me:{access:{status:'revoked'}}}); assert.match(elements['#accessStatus'].textContent,/revoked/);
 listener({me:{}}); assert.equal(elements['#workspaces'].hidden,false); assert.equal(elements['#binding'].hidden,true);
});
