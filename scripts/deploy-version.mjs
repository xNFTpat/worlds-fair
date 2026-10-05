import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function deploymentVersionId(output){
 const plain=String(output).replace(/\x1b\[[0-9;]*[A-Za-z]/g,''),current=[...plain.matchAll(new RegExp('^\\s*Current Version ID:\\s*('+UUID+')\\s*$','gim'))],matches=current.length?current:[...plain.matchAll(new RegExp('^\\s*Version ID:\\s*('+UUID+')\\s*$','gim'))];
 const ids=[...new Set(matches.map(m=>m[1].toLowerCase()))];
 if(ids.length!==1)throw Error('Wrangler deploy succeeded but did not report one unambiguous Version ID; no deployment receipt was written.');
 return ids[0];
}
export function generatedVersion(source){
 const match=String(source).match(/\bexport const BUILD_VERSION\s*=\s*(\{[\s\S]*\})\s+as const\s*;/);
 if(!match)throw Error('Generated src/build-version.ts is missing BUILD_VERSION JSON. Run the build before deploying.');
 let version;try{version=JSON.parse(match[1]);}catch{throw Error('Generated BUILD_VERSION is not valid JSON.');}
 if(!/^[a-f0-9]{64}$/.test(version.sourceSha)||!(version.gitSha===null||typeof version.gitSha==='string'&&/^[a-f0-9]{40,64}$/.test(version.gitSha))||typeof version.buildAt!=='string'||!Number.isFinite(Date.parse(version.buildAt))||version.hashAlgorithm!=='sha256')throw Error('Generated BUILD_VERSION has invalid source, Git or build-time metadata.');
 return version;
}
export function runCommand(command,args,{cwd,onOutput=(stream,chunk)=>process[stream].write(chunk)}={}){
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(command,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']});let output='';
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{const text=chunk.toString();output+=text;onOutput(stream,text);});
  child.once('error',reject);child.once('close',code=>resolvePromise({code,output}));
 });
}
export async function deployWithReceipt({root=process.cwd(),runner=runCommand,now=()=>new Date(),onOutput,log=console.log}={}){
 const cwd=resolve(root),npx=process.platform==='win32'?'npx.cmd':'npx';
 // Validate the generated public identity before deploying, then require immutability.
 const stampPath=join(cwd,'src/build-version.ts'),before=await readFile(stampPath),version=generatedVersion(before);
 const deployment=await runner(npx,['wrangler','deploy'],{cwd,onOutput});
 if(deployment.code!==0)throw Error('Wrangler deploy failed (exit '+String(deployment.code)+'); no deployment receipt was written.');
 const versionId=deploymentVersionId(deployment.output),deployedAt=now().toISOString();let temporary;
 try{
  // A changed stamp cannot identify which build was uploaded. Never guess its source binding.
  if(!(await readFile(stampPath)).equals(before))throw Error('Generated BUILD_VERSION changed during deployment; source identity is ambiguous. No receipt was written.');
  const receipt={versionId,sourceSha:version.sourceSha,gitSha:version.gitSha,deployedAt},json=JSON.stringify(receipt,null,2)+'\n';
  const localDir=join(cwd,'validation/deploy');await mkdir(localDir,{recursive:true});
  // Keep the true post-deploy receipt locally even if the remote KV write fails.
  await writeFile(join(localDir,'latest.json'),json);
  temporary=await mkdtemp(join(tmpdir(),'lp-deploy-version-'));const path=join(temporary,'receipt.json');await writeFile(path,json);
  const result=await runner(npx,['wrangler','kv','key','put','deploy:version:'+versionId,'--binding','LP_CACHE','--remote','--path',path],{cwd,onOutput});
  if(result.code!==0)throw Error('Wrangler receipt KV write failed (exit '+String(result.code)+').');
  log('Deployment receipt recorded: '+versionId+' · '+deployedAt);
  return receipt;
 }catch(error){throw Error('Worker deployed as '+versionId+' but its deployment receipt could not be recorded: '+error.message+' Check validation/deploy/latest.json for a saved receipt before retrying the KV write.');}
 finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 deployWithReceipt().catch(error=>{console.error(error.message);process.exitCode=1;});
}
