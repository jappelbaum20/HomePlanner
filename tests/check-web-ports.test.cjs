'use strict';
// Runs the deploy check against a stub `docker` that prints a fixed answer. Skipped where no POSIX sh exists.
const test=require('node:test'), assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const script=path.resolve(__dirname,'../deployment/check-web-ports.sh');
const hasSh=spawnSync('sh',['-c','true']).status===0;
function run(output){
 const dir=fs.mkdtempSync(path.join(process.env.HOMEPLANNER_E_TEST_ROOT||os.tmpdir(),'ports-'));
 fs.writeFileSync(path.join(dir,'docker'),`#!/bin/sh\nprintf '%s' '${output}'\n`,{mode:0o755});
 const unix=p=>process.platform==='win32'?p.split('\\').join('/').replace(/^([A-Za-z]):/,'/$1'):p;
 return spawnSync('sh',[unix(script),'web'],{encoding:'utf8',env:{...process.env,PATH:unix(dir)+':'+process.env.PATH}});
}
test('script has valid shell syntax',{skip:!hasSh},()=>assert.equal(spawnSync('sh',['-n',script.split('\\').join('/')]).status,0));
test('passes when nothing is published and fails on any published host port',{skip:!hasSh},()=>{
 assert.equal(run('').status,0);
 const bad=run('3000/tcp '); assert.equal(bad.status,1); assert.match(bad.stderr,/3000\/tcp/);
});
