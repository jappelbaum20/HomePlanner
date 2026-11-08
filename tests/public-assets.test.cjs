const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const ignore = require('ignore');
const B = require('../bookshelf.js');
const C = require('../shared/contracts.js');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const clone = value => structuredClone(value);
const valid = (name, data) => assert.deepEqual(C.validate(name, data), {valid:true, errors:[]});
const invalid = (name, data) => assert.equal(C.validate(name, data).valid, false);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const uid = '4a916412-5128-4e63-bfea-6e46e541754b';
const emptyHome = {version:2, name:'New house', catalog:[], rooms:[]};
const write = payload => ({kind:'shelf',title:'Shelf',schemaVersion:3,payload,photoIds:[]});
function uploadFiles() {
  const matcher=ignore().add(fs.readFileSync(path.join(root,'.vercelignore'),'utf8'));
  function walk(relative='') {
    return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(entry=>{
      const rel=relative ? `${relative}/${entry.name}` : entry.name;
      if (matcher.ignores(rel+(entry.isDirectory()?'/':''))) return [];
      if (entry.isSymbolicLink()) throw new Error(`Unexpected upload symlink: ${rel}`);
      return entry.isDirectory()?walk(rel):[rel];
    });
  }
  return walk().sort();
}

test('strict schema and geometry accept existing designs and reject malformed proposals', () => {
  for (const shelf of [B.saetter3(), B.preset('framed'), B.preset('staggered'), B.preset('stepped')]) {
    valid('shelf', shelf); valid('writeDesign', write(shelf));
  }
  const small = {version:1,width:10,height:10,depth:5,thickness:.5,levels:[{y:0,left:0,right:10,dividers:[.25,9.75]},{y:9.5,left:0,right:10,dividers:[]}]};
  valid('shelf',small);
  for (const mutate of [
    s => {s.width='45.5';}, s => {s.width=NaN;}, s => {s.version=2;}, s => {s.extra=true;},
    s => {s.template='unknown';}, s => {delete s.backThickness;}, s => {s.levels[1].y=s.levels[0].y;},
    s => {s.levels[0].dividers[1]=s.levels[0].dividers[0];}, s => {s.levels[0].dividers[0]=0;},
    s => {s.levels.at(-1).dividers=[1];}, s => {s.separatorHeight=100;}, s => {s.backThickness=s.depth;}, s => {s.backThickness=0.49;},
    s => {s.levels[0].right=-1;}, s => {s.levels[0].dividers=Array(31).fill(1);},
    s => {s.levels=Array(26).fill(s.levels[0]);}
  ]) { const bad=clone(B.saetter3()); mutate(bad); invalid('shelf',bad); }
  const many = {version:1,width:500,height:500,depth:20,thickness:.5,template:'saetter3',separatorHeight:1,backThickness:.5,
    levels:Array.from({length:25},(_,i)=>({y:i===24?499.5:i*20,left:0,right:500,dividers:i===24?[]:Array.from({length:30},(_,j)=>1+j*10)}))};
  assert.ok(B.boards(many).length>800); invalid('shelf',many);
  const dto = {schemaVersion:3,localDesignId:uid,kind:'home',title:'Home',payload:emptyHome,photoManifest:[],modifiedAt:'2026-11-07T12:00:00.000Z'};
  valid('local',dto); invalid('local',{...dto,kind:'shelf'}); invalid('local',{...dto,extra:1});
  valid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:emptyHome,photoIds:[]});
  invalid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:{...emptyHome, rooms:'bad'},photoIds:[]});
  const art = {id:'art',type:'art',name:'Art',w:50,d:2,h:50,color:'#abcdef',status:'own',link:'',notes:'',photos:[],image:uid};
  const homeWithArt = {...emptyHome,catalog:[art]};
  invalid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:homeWithArt,photoIds:[]});
  valid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:homeWithArt,photoIds:[uid]});
  invalid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:homeWithArt,photoIds:[uid,uid.toUpperCase()]});
  invalid('writeDesign',{kind:'home',title:'Home',schemaVersion:3,payload:{...emptyHome,catalog:[{...art,image:'https://example.invalid/image.jpg'}]},photoIds:[uid]});
  valid('proposalRequest',{requestId:uid,designId:uid,baseRevision:1,baseHash:'a'.repeat(64),shelf:B.saetter3(),prompt:'Move a divider'});
  invalid('proposalRequest',{requestId:uid,designId:uid,baseRevision:1,baseHash:'a'.repeat(64),shelf:B.saetter3(),prompt:'x'.repeat(2001)});
});

test('build emits only audited assets, empty starter and equivalent browser contracts', async () => {
  const run=spawnSync(process.execPath,['scripts/build-public.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr || run.stdout);
  const {auditPublic}=await import('../scripts/audit-public.mjs');
  const files=await auditPublic(dist);
  assert.equal(files.length,23);
  const context=vm.createContext({TextEncoder, console}); context.window=context;
  for (const file of ['bookshelf.js','shared/validators.js','shared/contracts.js','starter-data.js']) vm.runInContext(fs.readFileSync(path.join(dist,file),'utf8'),context,{filename:file,timeout:5000});
  assert.equal(context.HOUSE_SEED.rooms.length,0);
  assert.equal(context.HOUSE_ROOMS.length+context.HOUSE_PIECES.length+context.HOUSE_PLACEMENTS.length,0);
  assert.equal(context.HomePlannerContracts.validate('shelf',clone(B.saetter3())).valid,true);
  assert.equal(context.HomePlannerContracts.validate('shelf',{...B.saetter3(),width:'45.5'}).valid,false);
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  assert.match(html,/<script src="starter-data\.js"><\/script>/);
  assert.doesNotMatch(html,/<script src="house-data\.js"/);
  assert.doesNotMatch(html,/https?:\/\//);
  assert.ok(html.indexOf('vendor/supabase.js') < html.indexOf('client/cloud.js'));
});

test('upload rules admit only explicit reviewed sources', async () => {
  const matcher=ignore().add(fs.readFileSync(path.join(root,'.vercelignore'),'utf8'));
  const included=['index.html','app.js','package.json','package-lock.json','shared/contracts.js','shared/schema/shelf-v1.json','scripts/build-public.mjs',
    'api/me.js','api/designs.js','api/designs/[id].js','api/designs/[id]/photos.js','api/designs/[id]/photos/[photoId].js',
    'api/designs/[id]/photos/[photoId]/complete.js','api/shelf-proposals.js','api/admin/model-config.js','server/auth.js','server/providers/fake.js'];
  const excluded=['house-data.js','photos/tour/01_hall0_view1.jpg','.git/config','.github/workflows/pages.yml','output/playwright/acceptance-backup.json',
    '.env','shared/schema/private.json','server/providers/private.js','api/unapproved.js','api/designs/[id]/private.js','api/designs/[id]/photos/[photoId]/private.js',
    'dist/index.html','node_modules/ajv/package.json','shared/schema/.env'];
  for(const file of included) assert.equal(matcher.ignores(file),false,`must include ${file}`);
  for(const file of excluded) assert.equal(matcher.ignores(file),true,`must exclude ${file}`);
  const { HOSTING_INPUTS } = await import('../scripts/hosting-manifest.mjs');
  assert.deepEqual(uploadFiles(),[...HOSTING_INPUTS].sort());
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.equal(config.git.deploymentEnabled,false); assert.equal(config.outputDirectory,'dist');
  assert.deepEqual(config.rewrites,[{source:'/auth/callback',destination:'/index.html'},{source:'/home',destination:'/index.html'},{source:'/bookshelf',destination:'/bookshelf.html'}]);
});

test('actual public bytes exclude personal source fingerprints and photos', async t => {
  const {enumerate}=await import('../scripts/audit-public.mjs');
  const output=await enumerate(dist);
  const contents=[...output.map(name=>fs.readFileSync(path.join(dist,name))),
    ...uploadFiles().map(name=>fs.readFileSync(path.join(root,name)))];
  const dataFile=path.join(root,'house-data.js');
  const photoDir=path.join(root,'photos');
  if(!fs.existsSync(dataFile)||!fs.existsSync(photoDir)) { t.skip('Private inputs unavailable for comparison in this checkout'); return; }
  const seed=fs.readFileSync(dataFile); const sandbox=vm.createContext({window:{}});
  vm.runInContext(seed.toString('utf8'),sandbox,{timeout:5000});
  const fingerprints=new Set();
  function visit(value,key='') {
    if(typeof value==='string' && ['name','notes','link','src'].includes(key) && value.length>=30) fingerprints.add(value);
    else if(Array.isArray(value)) value.forEach(v=>visit(v,key));
    else if(value && typeof value==='object') Object.entries(value).forEach(([k,v])=>visit(v,k));
  }
  visit(sandbox.window);
  assert.ok(fingerprints.size>=20,'enough private seed fingerprints were extracted');
  for(const fp of fingerprints) for(const bytes of contents) assert.equal(bytes.includes(Buffer.from(fp)),false,'private seed fingerprint in public artifact');
  for(const bytes of contents) assert.notEqual(sha(bytes),sha(seed),'private seed copied into output');
  const photos=await enumerate(photoDir); assert.ok(photos.length>=1);
  const hashes=new Set(photos.map(name=>sha(fs.readFileSync(path.join(photoDir,name)))));
  for(const bytes of contents) assert.equal(hashes.has(sha(bytes)),false,'private photo copied into output');
  assert.ok(!output.some(name=>name==='house-data.js'||name.startsWith('photos/')));
});

test('direct requests for private assets return 404 from the public artifact', async () => {
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
    if (!name || name.includes('..')) {res.writeHead(404).end();return;}
    const file=path.join(dist,name);
    if (!fs.existsSync(file)||!fs.statSync(file).isFile()) {res.writeHead(404).end();return;}
    res.writeHead(200).end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/index.html')).status,200);
    assert.equal((await fetch(base+'/house-data.js')).status,404);
    assert.equal((await fetch(base+'/photos/tour/01_hall0_view1.jpg')).status,404);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
