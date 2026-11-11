'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const B = require('../bookshelf');
const api = require('../api/shelf-proposals');
const { hash } = require('../server/proposals');
const { ApiError } = require('../server/errors');
const { inputTokenBound, generateShelfProposal } = require('../server/providers/openai');
const { maxCost } = require('../server/limits');
const { CATALOG } = require('../server/model-config');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DESIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const usage = { input_tokens:1000, output_tokens:200 };
function fixture() {
  const s = { design:{ id:DESIGN, kind:'shelf', revision:1, payload:B.saetter3() }, records:new Map(), calls:0, deny:false,
    config:{ revision:1,enabled:true,adapterId:'openai',modelId:'gpt-6-luna',connectionRef:'primary',globalBudgetMicros:1000000,
      limits:{ requestsPerMinute:5,requestsPerDay:20,maxOutputTokens:4000 } } };
  s.backend={
    async verify(token){return token==='a.b.c'?{userId:USER}:null;},
    async get(){return s.design && structuredClone(s.design);},
    async rpc(name,a) {
      const key=a.p_request_id, record=s.records.get(key);
      if(name==='hp_model_config_get') return structuredClone(s.config);
      if(name==='hp_usage_replay') { if(!record) return null; if(record.hash!==a.p_body_hash) throw new ApiError(409,'conflict','Conflict'); return { ...record,replay:true }; }
      if(name==='hp_reserve_usage') {
        if(record) { if(record.hash!==a.p_body_hash) throw new ApiError(409,'conflict','Conflict'); return {...record,replay:true}; }
        if(s.deny) throw new ApiError(429,'quota','Quota');
        const r={reservationId:randomUUID(),hash:a.p_body_hash,status:'reserved',result:null,reserved:a.p_max_cost_micros}; s.records.set(key,r); return {...r,replay:false};
      }
      if(name==='hp_finalize_usage') {
        const r=[...s.records.values()].find(x=>x.reservationId===a.p_reservation_id);
        Object.assign(r,{status:a.p_status,result:a.p_result,actual:a.p_actual_micros}); return {status:r.status,result:r.result};
      }
      throw Error('unexpected RPC');
    }
  };
  s.deps={backend:s.backend,connectionAvailable:true,provider:{async generateShelfProposal(){s.calls++;return {candidate:{shelf:structuredClone(s.design.payload),summary:'A plain description.'},usage};}}};
  s.body=()=>({requestId:randomUUID(),designId:DESIGN,baseRevision:1,baseHash:hash(s.design.payload),shelf:structuredClone(s.design.payload),prompt:'Adjust the depth'});
  return s;
}
async function call(s,body,extra={}) {
  const req={method:'POST',body,headers:{authorization:'Bearer a.b.c','content-type':'application/json','idempotency-key':body.requestId,...extra}};
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.data=v;this.writableEnded=true;return this;},end(){this.writableEnded=true;return this;}};
  await api.createHandler(s.deps)(req,res); return res;
}
test('standalone proposal matches saved v2 geometry without sending wall metadata', async () => {
  const s = fixture(), shelf = B.saetter3();
  s.design.payload = { version:2, shelf, wall:{widthCm:300,heightCm:240,color:'#EEEEEE'}, placement:{offsetCm:5,elevationCm:10,gapCm:0}, activeTab:'saetter' };
  s.deps.provider = { async generateShelfProposal(input) { assert.deepEqual(input.shelf, shelf); assert.equal(input.wall, undefined); return {candidate:{shelf:structuredClone(shelf),summary:'Fixture'},usage}; } };
  const result = await call(s, {requestId:randomUUID(),designId:DESIGN,baseRevision:1,baseHash:hash(shelf),shelf,prompt:'Adjust'});
  assert.equal(result.statusCode, 200);
});
test('proposals reserve full worst case, account usage, replay once and reject mismatched duplicates', async () => {
  const s=fixture(), body=s.body(), one=await call(s,body);
  assert.equal(one.statusCode,200); assert.equal(s.calls,1); assert.equal(one.data.baseHash,body.baseHash);
  const record=s.records.get(body.requestId);
  assert.equal(record.reserved,maxCost(CATALOG['gpt-6-luna'],4000,inputTokenBound({model:'gpt-6-luna',shelf:body.shelf,prompt:body.prompt,maxOutputTokens:4000}))); assert.ok(record.reserved < 10000); assert.equal(record.actual,446);
  s.config.enabled=false; s.design=null;
  const repeat=await call(s,body); assert.deepEqual(repeat.data,one.data); assert.equal(s.calls,1);
  assert.equal((await call(s,{...body,prompt:'different'})).statusCode,409);
  assert.ok(maxCost(CATALOG['gpt-6-sol'],4000,69632) < 500000);
});
test('concurrent retries and ambiguous provider failure never issue a second call', async () => {
  const s=fixture(), body=s.body(); let release;
  s.deps.provider={async generateShelfProposal(){ s.calls++; await new Promise(resolve=>{release=resolve;}); throw Error('timeout with private detail'); }};
  const first=call(s,body); while(!release) await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call(s,body)).statusCode,409); release();
  const result=await first; assert.equal(result.statusCode,503); assert.doesNotMatch(JSON.stringify(result.data),/private detail/);
  assert.equal(s.records.get(body.requestId).status,'ambiguous'); assert.equal((await call(s,body)).statusCode,409); assert.equal(s.calls,1);
});
test('reservation is durable first, the provider runs outside any transaction, and denial stops dispatch', async () => {
  const s=fixture(), body=s.body(); let fenced=false, fences=0, settledWhileFenced=false;
  const rpc=s.backend.rpc.bind(s.backend);
  s.backend.rpc=async (name,args)=>{ if(name==='hp_finalize_usage') settledWhileFenced=fenced; return rpc(name,args); };
  s.backend.withApproved=async work=>{ assert.equal(s.records.get(body.requestId).status,'reserved'); fenced=true; fences++; try { return await work(s.backend); } finally { fenced=false; } };
  s.deps.provider={async generateShelfProposal(){assert.equal(fenced,false);return {candidate:{shelf:body.shelf,summary:'Fixture'},usage};}};
  assert.equal((await call(s,body)).statusCode,200); assert.equal(settledWhileFenced,true); assert.equal(fences,2);
  assert.equal(s.records.get(body.requestId).status,'succeeded');
  const denied=fixture(), blocked=denied.body();
  denied.backend.withApproved=async()=>{throw new ApiError(403,'access_revoked','Access revoked');};
  assert.equal((await call(denied,blocked)).statusCode,403); assert.equal(denied.calls,0);
  assert.equal(denied.records.get(blocked.requestId).status,'reserved');
});
test('revocation during the provider call settles the reservation as ambiguous and never retries', async () => {
  const s=fixture(), body=s.body(); let fences=0;
  s.backend.withApproved=async work=>{ if(++fences===2) throw new ApiError(403,'access_revoked','Access revoked'); return work(s.backend); };
  const result=await call(s,body);
  assert.equal(result.statusCode,403); assert.equal(s.calls,1);
  assert.equal(s.records.get(body.requestId).status,'ambiguous');
  assert.equal((await call(s,body)).statusCode,409); assert.equal(s.calls,1);
});
test('stale hash, revision, missing config, unsupported model and quota deny calls', async () => {
  const s=fixture(), b=s.body();
  assert.equal((await call(s,{...b,baseHash:'0'.repeat(64)})).statusCode,409);
  assert.equal((await call(s,{...b,baseRevision:2})).statusCode,409);
  s.config.modelId='unsupported'; assert.equal((await call(s,b)).statusCode,503);
  s.config.modelId='gpt-6-luna'; s.deps.connectionAvailable=false; assert.equal((await call(s,b)).statusCode,503);
  s.deps.connectionAvailable=true; s.deny=true; assert.equal((await call(s,b)).statusCode,429); assert.equal(s.calls,0);
});
test('malicious, malformed, geometrically invalid and stale outputs are charged but never returned as proposals', async () => {
  const examples=[
    shelf=>({shelf,summary:'<script>alert(1)</script>'}),
    shelf=>({shelf,summary:'https://evil.invalid'}),
    shelf=>({shelf,summary:'ok',extra:true}),
    shelf=>({shelf:{...shelf,width:-1},summary:'ok'}),
    shelf=>({shelf:{...shelf,levels:Array(26).fill(shelf.levels[0])},summary:'ok'}),
    shelf=>({shelf:{...shelf,width:'20'},summary:'ok'}),
    shelf=>({shelf:{...shelf,width:NaN},summary:'ok'})
  ];
  for(const make of examples){ const s=fixture(), b=s.body(); s.deps.provider={async generateShelfProposal(){return {candidate:make(structuredClone(b.shelf)),usage};}};
    assert.equal((await call(s,b)).statusCode,502); assert.equal(s.records.get(b.requestId).status,'succeeded'); assert.equal(s.records.get(b.requestId).actual,446);
    assert.equal((await call(s,b)).statusCode,502);
  }
  const s=fixture(), b=s.body(); s.deps.provider={async generateShelfProposal(){s.design.revision++;return {candidate:{shelf:b.shelf,summary:'ok'},usage};}};
  assert.equal((await call(s,b)).statusCode,409); assert.equal(s.records.get(b.requestId).status,'succeeded');
  const t=fixture(), q=t.body(); t.deps.provider={async generateShelfProposal(){return {candidate:{shelf:q.shelf,summary:'ok'},usage:null};}};
  assert.equal((await call(t,q)).statusCode,503); assert.equal(t.records.get(q.requestId).status,'ambiguous');
});
test('real adapter sends bounded structured schema and does not retry HTTP failures', async () => {
  const shelf=B.saetter3(); let requests=0, sent;
  const output={status:'completed',model:'gpt-6-luna',service_tier:'default',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({shelf,summary:'ok'})}]}],usage};
  const answer=await generateShelfProposal({model:'gpt-6-luna',shelf,prompt:'Change depth',maxOutputTokens:4000,apiKey:'fixture',fetchImpl:async(url,opts)=>{requests++;sent={url,opts};return new Response(JSON.stringify(output),{status:200});}});
  assert.equal(requests,1); assert.equal(sent.url,'https://api.openai.com/v1/responses'); assert.equal(sent.opts.redirect,'error');
  const body=JSON.parse(sent.opts.body); assert.equal(body.text.format.strict,true); assert.equal(body.store,false); assert.equal(body.max_output_tokens,4000); assert.deepEqual(answer.candidate.shelf,shelf);
  assert.equal(body.text.format.schema.properties.shelf.properties.levels.maxItems,25);
  assert.equal(body.text.format.schema.properties.shelf.properties.width.maximum,500);
  const wrongTier=await generateShelfProposal({model:'gpt-6-luna',shelf,prompt:'x',maxOutputTokens:4,apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify({...output,service_tier:'priority'}),{status:200})});
  assert.equal(wrongTier.usage,null);
  await assert.rejects(generateShelfProposal({model:'gpt-6-luna',shelf,prompt:'x',maxOutputTokens:4,apiKey:'fixture',fetchImpl:async()=>{requests++;return new Response('',{status:429});}})); assert.equal(requests,2);
});

test('oversized serialized provider request is rejected before network use', async () => {
 let called=false;
 await assert.rejects(generateShelfProposal({model:'gpt-6-luna',shelf:B.saetter3(),prompt:'x'.repeat(70000),maxOutputTokens:4000,apiKey:'fixture',fetchImpl:async()=>{called=true;}}),/Oversized provider input/);
 assert.equal(called,false);
});
