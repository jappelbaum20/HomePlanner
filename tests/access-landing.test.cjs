'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
function load(search='',language='en-US'){
 const elements={};
 for(const id of ['accessStatus','accessSignIn','accessSignOut','workspaces','ownerAdminLink']) elements['#'+id]={hidden:false,disabled:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;}};
 let listener;
 const cloud={subscribe(fn){listener=fn;},init(){return true;},signIn:async()=>{},signOut:async()=>{}};
 const context={window:{HomePlannerCloud:cloud,location:{search},navigator:{language},localStorage:{getItem:()=>null,setItem(){}}},
   document:{documentElement:{},querySelector:s=>elements[s],querySelectorAll:()=>[]}, URLSearchParams, console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../landing.js'),'utf8'),context);
 return {elements,emit:s=>listener(s),context};
}
test('landing keeps unapproved accounts out of workspaces and has no in-page request form',()=>{
 const {elements,emit}=load();
 emit({me:{access:{status:'pending'}}});
 assert.equal(elements['#workspaces'].hidden,true); assert.match(elements['#accessStatus'].textContent,/awaiting approval/);
 emit({me:{access:{status:'denied'}}}); assert.match(elements['#accessStatus'].textContent,/not approved/); assert.equal(elements['#workspaces'].hidden,true);
 emit({me:{access:{status:'revoked'}}}); assert.match(elements['#accessStatus'].textContent,/revoked/);
 emit({me:{}}); assert.equal(elements['#workspaces'].hidden,false); assert.equal(elements['#accessSignOut'].hidden,false);
 emit({me:null}); assert.equal(elements['#accessSignIn'].hidden,false); assert.equal(elements['#workspaces'].hidden,true);
});
test('only a verified current owner session sees the admin link',()=>{
 const {elements,emit}=load();
 for(const state of [{me:null},{me:{}},{me:{isOwner:false}},{me:{isOwner:true,access:{status:'pending'}}},{me:{isOwner:true},revalidating:true}]) {
  emit(state); assert.equal(elements['#ownerAdminLink'].hidden,true);
 }
 emit({me:{isOwner:true}}); assert.equal(elements['#ownerAdminLink'].hidden,false);
 emit({me:{isOwner:false}}); assert.equal(elements['#ownerAdminLink'].hidden,true);
});
test('landing shows a fixed message for sign-in error codes and ignores unknown ones',()=>{
 let page=load('?signin_error=access_check_failed'); page.emit({me:null});
 assert.match(page.elements['#accessStatus'].textContent,/could not be verified/);
 page=load('?signin_error=%3Cscript%3E'); page.emit({me:null});
 assert.match(page.elements['#accessStatus'].textContent,/could not be completed/); assert.doesNotMatch(page.elements['#accessStatus'].textContent,/script/);
});
test('landing defaults to German for German browsers',()=>{
 const page=load('?signin_error=access_check_failed','de-DE'); page.emit({me:null});
 assert.match(page.elements['#accessStatus'].textContent,/Anmeldung/);
});
