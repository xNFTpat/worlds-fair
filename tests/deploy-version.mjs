import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentVersionId,generatedVersion,deployWithReceipt} from '../scripts/deploy-version.mjs';

const id='13d7a5b0-a254-416b-9f42-cad5b263e247',other='13d7a5b0-a254-416b-9f42-cad5b263e248',sha='a'.repeat(64),git='b'.repeat(40),buildAt='2026-09-30T18:00:00.000Z',deployedAt='2026-09-30T18:03:14.500Z';
const stamp=(sourceSha=sha,gitSha=null)=>'// Generated public metadata.\nexport const BUILD_VERSION = '+JSON.stringify({sourceSha,gitSha,buildAt,hashAlgorithm:'sha256'})+' as const;\n';
assert.equal(deploymentVersionId('\x1b[32mCurrent Version ID: '+id+'\x1b[0m\n'),id);
assert.equal(deploymentVersionId('Version ID: '+id+'\n'),id);
assert.equal(deploymentVersionId('Version ID: '+other+'\nCurrent Version ID: '+id+'\n'),id,'The activation ID takes precedence over an upload ID');
assert.equal(deploymentVersionId('Current Version ID: '+id+'\nCurrent Version ID: '+id+'\n'),id);
assert.throws(()=>deploymentVersionId('Uploaded worker successfully'),/unambiguous Version ID/);
assert.throws(()=>deploymentVersionId('Current Version ID: '+id+'\nCurrent Version ID: '+other),/unambiguous/);
assert.equal(generatedVersion(stamp()).gitSha,null,'No Git commit is fabricated');
assert.equal(generatedVersion(stamp(sha,git)).gitSha,git);
assert.throws(()=>generatedVersion(stamp('not-a-hash')),/invalid/);
assert.throws(()=>generatedVersion(stamp(sha,'short')),/invalid/);
assert.throws(()=>generatedVersion('export const BUILD_VERSION = process.env;'),/missing/);
assert.throws(()=>generatedVersion('export const BUILD_VERSION = {sourceSha:evil()} as const;'),/valid JSON/,'Metadata is parsed, never executed');

const base=await mkdtemp(join(tmpdir(),'lp-deploy-fixtures-'));
async function fixture(name){const root=join(base,name);await mkdir(join(root,'src'),{recursive:true});await writeFile(join(root,'src/build-version.ts'),stamp());return root;}
async function absent(path){await assert.rejects(access(path),e=>e.code==='ENOENT');}
try{
 const root=await fixture('success'),calls=[],timeline=[];let printed='';
 await writeFile(join(root,'src/build-version.ts'),stamp('c'.repeat(64),git));
 const runner=async(command,args,options)=>{
  calls.push({command,args,cwd:options.cwd});assert.equal(command,process.platform==='win32'?'npx.cmd':'npx');
  if(args[1]==='deploy'){
   timeline.push('deploy-confirmed');
   return {code:0,output:'Deployed worker triggers\nCurrent Version ID: '+id+'\n'};
  }
  timeline.push('kv');assert.deepEqual(args.slice(0,9),['wrangler','kv','key','put','deploy:version:'+id,'--binding','LP_CACHE','--remote','--path']);
  const tempReceipt=JSON.parse(await readFile(args[9],'utf8')),local=JSON.parse(await readFile(join(root,'validation/deploy/latest.json'),'utf8'));
  assert.deepEqual(tempReceipt,local);assert.deepEqual(tempReceipt,{versionId:id,sourceSha:'c'.repeat(64),gitSha:git,deployedAt});assert.notEqual(tempReceipt.deployedAt,buildAt,'Build time is never reported as deployment time');
  return {code:0,output:'Successfully wrote receipt'};
 };
 const receipt=await deployWithReceipt({root,runner,now:()=>{timeline.push('timestamp');return new Date(deployedAt);},log:text=>printed=text});
 assert.deepEqual(timeline,['deploy-confirmed','timestamp','kv']);assert.equal(calls.length,2);assert(calls.every(c=>c.cwd===root));assert.equal(receipt.sourceSha,'c'.repeat(64));assert.match(printed,/Deployment receipt recorded/);await absent(calls[1].args[9]);

 const failed=await fixture('deploy-failed');let failedCalls=0;
 await assert.rejects(deployWithReceipt({root:failed,runner:async()=>{failedCalls++;return {code:1,output:'Current Version ID: '+id};},now:()=>assert.fail('Failed deployment cannot get a receipt timestamp')}),/deploy failed/);
 assert.equal(failedCalls,1);await absent(join(failed,'validation/deploy/latest.json'));

 const missing=await fixture('missing-id');let missingCalls=0;
 await assert.rejects(deployWithReceipt({root:missing,runner:async()=>{missingCalls++;return {code:0,output:'No reported ID'};},now:()=>assert.fail('No activation ID means no dated receipt')}),/unambiguous Version ID/);
 assert.equal(missingCalls,1);await absent(join(missing,'validation/deploy/latest.json'));

 const kvFailed=await fixture('kv-failed'),kvCalls=[];
 await assert.rejects(deployWithReceipt({root:kvFailed,runner:async(_command,args)=>{kvCalls.push(args);return args[1]==='deploy'?{code:0,output:'Current Version ID: '+id}:{code:1,output:'Write unavailable'};},now:()=>new Date(deployedAt),log:()=>assert.fail('KV failure must not claim receipt success')}),/Worker deployed as .*receipt could not be recorded.*KV write failed/);
 assert.equal(kvCalls.length,2);assert.deepEqual(JSON.parse(await readFile(join(kvFailed,'validation/deploy/latest.json'),'utf8')),{versionId:id,sourceSha:sha,gitSha:null,deployedAt});await absent(kvCalls[1][9]);

 const invalid=await fixture('invalid-stamp');await writeFile(join(invalid,'src/build-version.ts'),stamp('wrong'));let invalidCalls=0;
 await assert.rejects(deployWithReceipt({root:invalid,runner:async()=>{invalidCalls++;return {code:0,output:'Current Version ID: '+id};},now:()=>new Date(deployedAt)}),/invalid source, Git or build-time metadata/);
 assert.equal(invalidCalls,0);await absent(join(invalid,'validation/deploy/latest.json'));
 const changed=await fixture('changed-stamp');let changedCalls=0;
 await assert.rejects(deployWithReceipt({root:changed,runner:async()=>{changedCalls++;await writeFile(join(changed,'src/build-version.ts'),stamp('d'.repeat(64)));return {code:0,output:'Current Version ID: '+id};},now:()=>new Date(deployedAt)}),/Worker deployed as .*BUILD_VERSION changed during deployment.*No receipt was written/);
 assert.equal(changedCalls,1,'An identity race must never write a KV receipt');await absent(join(changed,'validation/deploy/latest.json'));
 console.log('PASS: confirmed version parsing, public source-bound metadata, post-deploy time, ordered mocked deployment/KV receipt, immutable build stamp, failures and recovery receipt. No deployments or network calls.');
}finally{await rm(base,{recursive:true,force:true});}
