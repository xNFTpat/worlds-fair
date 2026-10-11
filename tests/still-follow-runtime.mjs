import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'still-follow-runtime-'));
const compiled=await build({stdin:{contents:`
import {worldsfairPaperRoute} from './src/worldsfair-paper';
import {StillPaperLedger} from './src/still-paper';
const address='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',SOL='So11111111111111111111111111111111111111112';
const iso=()=>new Date().toISOString();
export class TestInbox {
 constructor(ctx,env){this.ledger=new StillPaperLedger(ctx,env,{
 snapshot:async()=>({updatedAt:iso(),errors:{},pools:[{id:'solana:'+address,address,chain:'solana',venue:'meteora-dlmm',pair:'TEST/SOL',base:{address:'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',symbol:'TEST'},quote:{address:SOL,symbol:'SOL'},fetchedAt:iso(),tvlUsd:200000,ageHours:240,priceQuote:1,feeSource:'reported',fees24hUsd:4800,volume24hUsd:960000,activity:{fees1h:200,fees30m:50,volume1h:40000,volume30m:10000},poolConfig:{binStep:100},tags:[]}]}),
 mark:async()=>({poolAddress:address,priceSol:1,fetchedAt:iso(),feeRateHourly:.001,source:'Synthetic test'}),
 preflight:async(_env,poolAddress,size)=>({poolAddress,name:'TEST/SOL',fetchedAt:iso(),canOpen:true,priceSol:{source:'Synthetic test'},feeRateHourly:{asOf:iso()},range:{shape:'Spot',note:'Synthetic test'},ledger:{priceSol:1,feeRateHourly:.001,entryCostsSol:null,exitCostsSol:null,transferFeeBps:null,bins:[{priceSol:1,sol:size,token:0}]}})
 });}
 async fetch(req){const action=new URL(req.url).pathname.split('/').pop();return this.ledger.handle(req.headers.get('x-worldsfair-account'),action,req.method==='POST'?await req.json():{});}
 async alarm(){await this.ledger.alarm();}
}
export default {fetch:async(req,env)=>(await worldsfairPaperRoute(req,env))||new Response('Not found',{status:404})};
`,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'esm',platform:'browser',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'still-follow-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],kvNamespaces:['LP_CACHE'],durableObjects:{RANGE_ALERTS:{className:'TestInbox',useSQLite:true}}}],durableObjectsPersist:join(dir,'do')}));
const origin='https://still.test';
async function call(action,body,cookie,customOrigin=origin){const r=await mf.dispatchFetch(origin+'/api/paper/'+action,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{origin:customOrigin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
try{
 await mf.ready;const a=await call('still-account'),b=await call('still-account');
 const request={confirmed:true,requestId:'runtime-bot-001',bot:{name:'Runtime',shape:'Spot',width:10,holdMinutes:1,trigger:'any',sizeSol:.5}};
 assert.equal((await call('still-bot',request,a.cookie,'https://foreign.test')).status,403);
 assert.equal((await call('still-bot',request,a.cookie)).status,200);
 let result;const end=Date.now()+12000;
 do{await new Promise(resolve=>setTimeout(resolve,250));result=await call('still-account',null,a.cookie);}while(!result.data.account.positions.length&&Date.now()<end);
 assert.equal(result.data.account.positions.length,1,'A real Durable Object alarm opens from the saved run without a browser tick');assert.equal(result.data.account.balanceSol,9.5);
 assert.equal((await call('still-bot',request,a.cookie)).data.account.runs.length,1);
 assert.equal((await call('still-account',null,b.cookie)).data.account.positions.length,0);
 const runId=result.data.account.runs[0].id;
 assert.equal((await call('still-unfollow',{requestId:'runtime-stop-001',confirmed:true,runId},a.cookie)).status,200);
 console.log('PASS real Still Follow Worker: isolated secure session, durable scheduled entry without a browser, replay and unfollow. Synthetic markets only.');
}finally{await mf.dispose();}
