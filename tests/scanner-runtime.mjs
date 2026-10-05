import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
const dir=await mkdtemp(join(tmpdir(),'lp-scanner-runtime-'));
const bundle=await build({stdin:{contents:`
 import {BackgroundScanner} from './src/background-scanner';
 export class TestScanner extends BackgroundScanner {
  constructor(ctx,env){super(ctx,env);this.testStorage=ctx.storage;}
  async fetch(req){if(new URL(req.url).pathname==='/arm-fixture'){
   await this.testStorage.put('scanner:v1',{enabled:true,failures:0,attempts:[]});
   await this.testStorage.setAlarm(Date.now()+150);return new Response('armed');
  }return super.fetch(req);}
 }
 export default {fetch:(req,env)=>env.SCANNER.get(env.SCANNER.idFromName('fixture')).fetch(req)};
`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'local-work',setup(b){
 b.onResolve({filter:/^\.\/background$/},()=>({path:'work',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export async function runBackground(env,mode,stage){await stage('Fixture paper check');return {fleet:{status:'committed',at:new Date().toISOString(),revision:1},warnings:[]}};`,loader:'js'}));
}}]});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'scanner-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',durableObjects:{SCANNER:{className:'TestScanner',useSQLite:true}}}],durableObjectsPersist:join(dir,'objects')}));
try{
 await mf.ready;await mf.dispatchFetch('https://local/arm-fixture');
 await new Promise(r=>setTimeout(r,700));
 const health=await mf.dispatchFetch('https://local/scanner/health').then(r=>r.json());
 assert.equal(health.attempts[0]?.trigger,'alarm','actual workerd alarm invokes the production coordinator without another request');
 assert.equal(health.attempts[0].status,'complete');assert.equal(health.lastFleetAt,health.lastFullSuccessAt);
 assert.ok(health.nextWakeAt>Date.now(),'actual durable storage retains the next wake');
 await mf.dispatchFetch('https://local/scanner/stop',{method:'POST'});
 const stopped=await mf.dispatchFetch('https://local/scanner/health').then(r=>r.json());assert.equal(stopped.nextWakeAt,null);
}finally{await mf.dispose();}
const ui={};vm.runInNewContext(await readFile('public/scanner-status.js','utf8'),ui);
const now=Date.now(),at=ms=>new Date(now-ms).toISOString(),fleet={lastFullScanAt:at(30000),lastScanAt:at(30000),runState:'running'};
assert.equal(ui.lpScannerStatus(fleet,{enabled:true,lastSuccessAt:at(10000),failures:0},now).tone,'ok');
assert.equal(ui.lpScannerStatus({...fleet,lastFullScanAt:at(9*60000)},{enabled:true,lastSuccessAt:at(1000)},now).tone,'warn');
assert.match(ui.lpScannerStatus(fleet,null,now).text,/unavailable/);
assert.match(ui.lpScannerStatus(fleet,{enabled:false},now).text,/stopped/);
assert.equal(ui.lpScannerStatus(fleet,{enabled:true,lastAttemptAt:at(30000)},now).tone,'warn');
assert.match(ui.lpScannerStatus(fleet,{enabled:true,lastSuccessAt:at(5000),failures:1},now).text,/delayed/);
console.log('PASS real local Worker alarm: persisted completion and next wake without manual scan; health UI reports stopped, unavailable and delayed states');
