'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const people=require('../api/admin/access/people.js'), remove=require('../api/admin/access/people/remove.js');
const {routes}=require('../runtime/routes.cjs');
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const origin='https://home.appelbaums.com',grant='g'.repeat(43);
function fixture(){
 const calls=[];
 return {calls,deps:{origin,verifyCsrf:async()=>true,accessStore:{
  async addPerson(...x){calls.push(['add',...x.slice(2)]);return {result:'added'};},
  async addedList(...x){calls.push(['list']);return [];},
  async removeAdded(...x){calls.push(['remove',x[2]]);return true;}
 }}};
}
async function call(api,fx,{method='GET',body,headers={}}={}){
 const req={method,body,query:{},headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},homeplannerSession:{userId,sessionId}};
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.data=x;this.writableEnded=true;return this;},end(){this.writableEnded=true;return this;}};
 await api.createHandler(fx.deps)(req,res);return res;
}
const good={origin,'x-homeplanner-session':sessionId,'x-homeplanner-csrf':'x','x-admin-grant':grant};
test('people routes exist and take no address in the path',()=>{
 const names=routes.map(r=>r.name); assert.ok(names.includes('accessPeople')&&names.includes('accessPeopleRemove'));
 assert.equal(routes.find(r=>r.name==='accessPeople').params,undefined);
});
test('list is read only and needs the admin grant; add and remove need CSRF, origin and the grant',async()=>{
 const fx=fixture();
 assert.equal((await call(people,fx,{headers:{'x-admin-grant':grant}})).statusCode,200);
 assert.notEqual((await call(people,fx)).statusCode,200);
 const post={method:'POST',body:{email:'Person@Example.com'},headers:good};
 assert.equal((await call(people,fx,post)).statusCode,200);
 assert.deepEqual(fx.calls.at(-1),['add','person@example.com',false],'address is lower-cased and override defaults to false');
 assert.equal((await call(people,fx,{...post,body:{email:'person@example.com',override:true}})).statusCode,200);
 assert.deepEqual(fx.calls.at(-1),['add','person@example.com',true]);
 const before=fx.calls.length;
 for(const headers of [{...good,'x-admin-grant':undefined},{...good,origin:'https://bad.invalid'},{...good,'x-homeplanner-session':'wrong'}]) assert.notEqual((await call(people,fx,{...post,headers})).statusCode,200);
 assert.equal(fx.calls.length,before,'rejected requests never reach the store');
 fx.deps.verifyCsrf=async()=>false;
 assert.notEqual((await call(people,fx,post)).statusCode,200);
 assert.equal(fx.calls.length,before);
});
test('malformed addresses and extra fields are refused before the store',async()=>{
 const fx=fixture();
 for(const body of [{email:'nope'},{email:''},{email:5},{},{email:'a@example.com',extra:1},{email:'a@example.com',override:'yes'},{email:'a b@example.com'}]) {
  const res=await call(people,fx,{method:'POST',body,headers:good}); assert.equal(res.statusCode,422);
 }
 assert.equal((await call(remove,fx,{method:'POST',body:{email:'bad'},headers:good})).statusCode,422);
 assert.equal((await call(remove,fx,{method:'POST',body:{email:'a@example.com',override:true},headers:good})).statusCode,422);
 assert.equal((await call(remove,fx,{method:'GET',headers:good})).statusCode,405);
 assert.equal(fx.calls.length,0);
 assert.equal((await call(remove,fx,{method:'POST',body:{email:'A@Example.com'},headers:good})).statusCode,200);
 assert.deepEqual(fx.calls,[['remove','a@example.com']]);
});
