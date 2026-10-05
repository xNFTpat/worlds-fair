import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'lp-scanner-'));
await build({entryPoints:['src/scanner.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'scanner.mjs')});
const {ScannerCoordinator,ScannerError}=await import(pathToFileURL(join(dir,'scanner.mjs')));
const base=Date.parse('2026-09-15T12:00:00Z');let now=base;
function fixture(work){
  const data=new Map();let alarm=null,gate=Promise.resolve();
  const ctx={storage:{get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),getAlarm:async()=>alarm,setAlarm:async n=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}},blockConcurrencyWhile:fn=>{const p=gate.then(fn);gate=p.catch(()=>{});return p;}};
  return {data,ctx,scanner:new ScannerCoordinator(ctx,work,()=>now)};
}
let calls=[];
const f=fixture(async(mode,stage)=>{calls.push(mode);assert.ok(await f.ctx.storage.getAlarm()>now,'timer armed before network work');await stage('Checking paper positions');return {fleet:{status:'committed',at:new Date(now).toISOString(),revision:calls.length},warnings:[]};});
assert.equal((await f.scanner.health()).status,'stopped');assert.equal(f.data.size,0,'health read has no side effects');
await f.scanner.tick('cron');assert.deepEqual(calls,['full']);assert.equal((await f.scanner.health()).status,'running');
await Promise.all([f.scanner.tick('cron'),f.scanner.tick('alarm'),f.scanner.tick('refresh')]);assert.equal(calls.length,1,'duplicate triggers do not duplicate work');
now=base+59000;await f.scanner.tick('cron');assert.equal(await f.ctx.storage.getAlarm(),base+60000,'early cron must never postpone the existing alarm');
for(let i=1;i<=5;i++){now=base+i*60000;await f.scanner.tick(i%2?'alarm':'cron');}
assert.deepEqual(calls,['full','heart','heart','heart','heart','full']);
now+=8*60000;assert.equal((await f.scanner.health()).status,'delayed','stale completed scans cannot look healthy');
await f.scanner.stop();assert.equal(await f.ctx.storage.getAlarm(),null);await f.scanner.tick('cron');assert.equal(calls.length,6,'stop survives cron');
const stopped=fixture(async()=>{throw Error('must not run');});await stopped.scanner.stop();await stopped.scanner.tick('cron');assert.equal((await stopped.scanner.health()).enabled,false);

now=base;let release,entered;const started=new Promise(r=>{entered=r;});let running=0;
const slow=fixture(async()=>{running++;entered();await new Promise(r=>{release=r;});return {fleet:{status:'committed',at:new Date(now).toISOString(),revision:1},warnings:[]};});
const pending=slow.scanner.tick('start');await started;now+=60000;await slow.scanner.tick('cron');assert.equal(running,1,'in-flight work retains exclusive ownership');
await slow.scanner.stop();release();await pending;assert.equal(await slow.ctx.storage.getAlarm(),null,'completion cannot restart a stopped scanner');

now=base;let failures=0;
const bad=fixture(async()=>{failures++;throw Error('https://private.invalid/key?secret=never-store');});
await bad.scanner.tick('start');let health=await bad.scanner.health();assert.equal(health.failures,1);assert.equal(health.nextWakeAt,now+60000);assert.doesNotMatch(JSON.stringify(health),/private|secret|never-store/);
now+=60000;await bad.scanner.tick('alarm');health=await bad.scanner.health();assert.equal(health.failures,2);assert.equal(health.nextWakeAt,now+120000);
now+=60000;await bad.scanner.tick('cron');assert.equal(failures,2,'backoff limits provider usage');
await bad.scanner.stop();await bad.scanner.tick('start');assert.equal((await bad.scanner.health()).enabled,true,'resume persists even during backoff');

now=base;const recovered=fixture(async()=>({fleet:{status:'committed',at:new Date(now).toISOString(),revision:20},warnings:[]}));
recovered.data.set('scanner:v1',{enabled:true,failures:0,attempts:[],nextAttemptAt:base-1,active:{id:'interrupted',at:new Date(base-600000).toISOString(),trigger:'cron',mode:'full',stage:'Checking paper positions',status:'running'}});
await recovered.scanner.tick('alarm');health=await recovered.scanner.health();assert.equal(health.attempts[1].status,'interrupted');assert.equal(health.attempts[0].revision,20);
assert.ok(health.nextWakeAt>now);

// Exercise actual background ordering with isolated dependencies, never RPC.
const plugins=[{name:'background-fixtures',setup(b){
  for(const file of ['refresh','sources/uniswap-positions','sources/geckoterminal','paper-fleet-runner','paper-runner','paper-lab-runner','lp-research'])b.onResolve({filter:new RegExp('^\\./'+file+'$')},()=>({path:file,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:{
    'refresh':`export const SNAPSHOT_KEY='snapshot:v1';export const pickRobinhoodRpc=async()=>{throw Error('RPC unavailable')};export const refreshPoolsImpl=async()=>{globalThis.calls.push('pools');throw Error('source failed')};export const refreshPositionsImpl=async()=>{globalThis.calls.push('wallets');throw Error('wallet failed')};`,
    'sources/uniswap-positions':`export const setRobinhoodRpc=()=>{};`,
    'sources/geckoterminal':`export const setGeckoKey=()=>{};`,
    'paper-fleet-runner':`export const runPaperFleet=async(ns,s,r,m)=>{globalThis.calls.push('fleet');globalThis.scanned=s;if(globalThis.rejectFleet)throw Error('not committed');return {status:'committed',at:s.updatedAt,revision:1}};`,
    'paper-runner':`export const runPaperTrials=async()=>{globalThis.calls.push('old-trials')};`,
    'paper-lab-runner':`export const runPaperLab=async()=>{globalThis.calls.push('old-lab')};`,
    'lp-research':`export const recordResearchObservation=async()=>{globalThis.calls.push('research-history')};`
  }[a.path],loader:'js'}));
}}];
await build({entryPoints:['src/background.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'background.mjs'),plugins});
const {runBackground}=await import(pathToFileURL(join(dir,'background.mjs')));
globalThis.calls=[];const sourceAt='2026-09-15T11:00:00Z';
const env={RANGE_ALERTS:{},LP_CACHE:{get:async()=>({updatedAt:sourceAt,pools:[{id:'saved',fetchedAt:sourceAt}]})}};
const result=await runBackground(env,'full',async()=>{});
assert.deepEqual(globalThis.calls,['pools','fleet','research-history','wallets','old-trials','old-lab']);assert.equal(globalThis.scanned.pools[0].fetchedAt,sourceAt,'saved source is not disguised as fresh');assert.equal(result.warnings.length,3);
globalThis.calls=[];await runBackground(env,'heart',async()=>{});assert.deepEqual(globalThis.calls,['fleet'],'heart checks avoid catalogue and wallet work');
globalThis.rejectFleet=true;globalThis.calls=[];await assert.rejects(()=>runBackground(env,'full',async()=>{}),/could not be saved/);assert.ok(!globalThis.calls.includes('wallets'),'failed fleet commit must be visible before unrelated work');
console.log('PASS scanner: durable wake, full/heart cadence, duplicate suppression, restart, stop/resume, bounded retry, secret-safe errors, freshness and independent paper checks');

// The public health route is read-only; start/stop requires the existing key.
await build({entryPoints:['src/index.ts'],bundle:true,platform:'node',mainFields:['main'],format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},outfile:join(dir,'worker.mjs')});
const {default:worker}=await import(pathToFileURL(join(dir,'worker.mjs')));
let forwarded=[];const webEnv={LP_CACHE:{},TX_KEY:'fixture-key',BACKGROUND_SCANNER:{idFromName:n=>n,get:()=>({fetch:async(url,init)=>{forwarded.push({url,method:init?.method||'GET'});return Response.json({ok:true});}})}};
const endpoint='https://terminal.test/api/scanner/control';
assert.equal((await worker.fetch(new Request(endpoint,{method:'POST',headers:{origin:'https://terminal.test'},body:JSON.stringify({action:'start'})}),webEnv)).status,401);
assert.equal((await worker.fetch(new Request(endpoint,{method:'POST',headers:{origin:'https://elsewhere.test','x-terminal-key':'fixture-key'},body:JSON.stringify({action:'start'})}),webEnv)).status,403);
assert.equal(forwarded.length,0);
assert.equal((await worker.fetch(new Request('https://terminal.test/api/scanner/health'),webEnv)).status,200);assert.equal(forwarded[0].method,'GET');
await worker.fetch(new Request(endpoint,{method:'POST',headers:{origin:'https://terminal.test','x-terminal-key':'fixture-key'},body:JSON.stringify({action:'stop'})}),webEnv);
assert.equal(forwarded.at(-1).url,'https://scanner/scanner/stop');
console.log('PASS scanner routes: health read, authenticated controls, origin check');
