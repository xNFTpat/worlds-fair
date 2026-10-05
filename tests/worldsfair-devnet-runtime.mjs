import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Production HTTP/session/DO code in workerd. Synthetic read-only RPC witnesses;
// no wallet, secret, signature operation, transaction send, or external network.
const dir=await mkdtemp(join(tmpdir(),'worldsfair-devnet-runtime-'));
const compiled=await build({stdin:{contents:`
 import {worldsfairPaperRoute,WorldsfairRangeInbox} from './src/worldsfair-paper';
 import {initialFleetState} from './src/paper-fleet';
 export class TestInbox extends WorldsfairRangeInbox {
  constructor(ctx,env){super(ctx,env);this.fixtureStorage=ctx.storage;}
  async fetch(req){
   const path=new URL(req.url).pathname;
   if(path==='/fixture'){
    const state=initialFleetState(),now=new Date().toISOString();state.lastScanAt=now;state.lastFullScanAt=now;
    const arm=state.portfolios.farmer;arm.cashSol+=.2;arm.peakSol=arm.cashSol;arm.realizedPnlSol=.2;arm.closedCount=1;arm.wins=1;
    const entry={id:'fleet:farmer:stamp-runtime-fixture',arm:'farmer',openedAt:new Date(Date.now()-3600000).toISOString(),budgetSol:1,pool:{address:'fixture',pair:'FIXTURE/SOL'}};
    const trade={...entry,cohort:'runtime',experiment:state.version,pair:'FIXTURE/SOL',poolAddress:'fixture',closedAt:now,pnlSol:.2,exitSol:1.2,feesSol:.2,withdrawTaxSol:0,reason:'Synthetic runtime fixture',observedInRangeMs:3600000,rentSol:.1,entryNetworkSol:0};
    state.closed.push(trade);await this.fixtureStorage.put({'fleet':state,['fleet-entry:'+entry.id]:entry,['fleet-trade:'+now+':'+trade.id]:trade});return Response.json({entry,trade});
   }
   if(path==='/fixture-money'){
    const rows=await this.fixtureStorage.list();
    return Response.json(Object.fromEntries([...rows].filter(([k])=>k==='fleet'||/^wf:(account|event|receipt|claim):/.test(k))));
   }
   return super.fetch(req);
  }
 }
 export default {fetch:async(req,env)=>(await worldsfairPaperRoute(req,env))||new Response('Not found',{status:404})};
`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'bounded-synthetic-providers',setup(b){
 for(const kind of ['basket','vault']){
  b.onResolve({filter:new RegExp('^\\./worldsfair-paper-'+kind+'s$')},()=>({path:kind,namespace:'fixture'}));
 }
 b.onLoad({filter:/.*/,namespace:'fixture'},async(args)=>({contents:await readFile('tests/fixtures/worldsfair-'+args.path+'-provider.fixture.mjs','utf8'),loader:'js'}));
}}]});
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){let n=0n,text='';for(const byte of bytes)n=(n<<8n)+BigInt(byte);while(n){text=alphabet[Number(n%58n)]+text;n/=58n;}for(const byte of bytes){if(byte)break;text='1'+text;}return text;}
const wallet=b58(new Uint8Array(32).fill(7)),otherWallet=b58(new Uint8Array(32).fill(8)),signature=b58(new Uint8Array(64).fill(9)),otherSignature=b58(new Uint8Array(64).fill(10));
const memoProgram='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',computeProgram='ComputeBudget111111111111111111111111111111',genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
let rpcMode='pending',receipt,rpcCalls=[];
function transaction(){return {slot:123456,blockTime:Math.floor(Date.now()/1000),version:'legacy',transaction:{signatures:[signature],message:{accountKeys:[wallet,computeProgram,memoProgram],header:{numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:2},instructions:[
 {programIdIndex:1,accounts:[],data:b58(new Uint8Array([2,160,134,1,0]))},
 {programIdIndex:1,accounts:[],data:b58(new Uint8Array([3,0,0,0,0,0,0,0,0]))},
 {programIdIndex:2,accounts:[0],data:b58(new TextEncoder().encode(rpcMode==='wrong-memo'?'unrelated record':receipt.memo))},
]}},meta:{err:null,fee:5000,preBalances:[100000,1,1],postBalances:[95000,1,1],innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}};}
const outboundService=async request=>{
 assert.equal(new URL(request.url).origin,'https://api.devnet.solana.com','Every network request is pinned to devnet');
 const body=await request.json();rpcCalls.push(body);
 assert.ok(['getGenesisHash','getTransaction'].includes(body.method),'Server may only read genesis and confirmed transaction');
 if(rpcMode==='offline')return new Response('unavailable',{status:503});
 const result=body.method==='getGenesisHash'?(rpcMode==='wrong-network'?'wrong-network':genesis):rpcMode==='pending'?null:transaction();
 return Response.json({jsonrpc:'2.0',id:1,result});
};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stamp-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],kvNamespaces:['LP_CACHE'],durableObjects:{RANGE_ALERTS:{className:'TestInbox',useSQLite:true}},bindings:{MIN_TVL_USD:'5000',WALLETS:'',ROBINHOOD_CHAIN_ID:'4663'},outboundService}],durableObjectsPersist:join(dir,'objects'),kvPersist:join(dir,'kv')}));
const origin='https://paper.test';
async function call(path,body,cookie,extra={}){
 const response=await mf.dispatchFetch(origin+'/api/paper/'+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json()};
}
try{
 await mf.ready;
 const namespace=await mf.getDurableObjectNamespace('RANGE_ALERTS'),stub=namespace.get(namespace.idFromName('pat-four-wallets-v1'));
 const fixture=await stub.fetch('https://internal/fixture').then(r=>r.json());
 const a=await call('account'),b=await call('account');assert(a.cookie&&b.cookie&&a.cookie!==b.cookie);
 const rollId=randomUUID(),roll=await call('roll',{source:'fleet',id:fixture.trade.id,closedAt:fixture.trade.closedAt,percent:50,requestId:rollId},a.cookie);
 assert.equal(roll.status,200,JSON.stringify(roll.data));
 const moneyBefore=await stub.fetch('https://internal/fixture-money').then(r=>r.json());
 const target={kind:'fleet-open',id:fixture.entry.id},prepare={target,wallet};
 assert.equal((await call('stamp-prepare',prepare)).status,401);
 assert.equal((await call('stamp-prepare',prepare,a.cookie,{origin:'https://foreign.test'})).status,403);
 let result=await call('stamp-prepare',prepare,a.cookie);assert.equal(result.status,200,JSON.stringify(result.data));receipt=result.data.receipt;assert.equal(receipt.status,'ready');assert.equal(rpcCalls.length,0);
 assert.equal((await call('stamp-prepare',{...prepare,wallet:otherWallet},a.cookie)).status,409,'Business conflicts preserve their status in real Durable Objects');
 assert.deepEqual((await call('stamp-prepare',prepare,a.cookie)).data.receipt,receipt);
 assert.equal((await call('stamp-prepare',{...prepare,network:'mainnet'},a.cookie)).status,400);
 const privateTarget={kind:'pot-roll',eventId:rollId};
 assert.equal((await call('stamp-prepare',{target:privateTarget,wallet},b.cookie,{'x-worldsfair-account':'a'.repeat(64)})).status,404,'An injected header cannot choose another session');
 assert.equal((await call('stamp-prepare',{target:privateTarget,wallet},a.cookie)).status,200,'A real committed roll can be stamped by its session');
 const confirm={receiptId:receipt.id,signature};
 result=await call('stamp-confirm',confirm,a.cookie);assert.equal(result.status,202,JSON.stringify(result.data));assert.equal(result.data.receipt.status,'ready');
 assert.equal((await call('stamp-confirm',confirm,b.cookie)).status,404);
 for(const mode of ['wrong-network','wrong-memo','offline']){rpcMode=mode;result=await call('stamp-confirm',confirm,a.cookie);assert(result.status>=400,mode+' rejects');}
 rpcMode='confirmed';result=await call('stamp-confirm',confirm,a.cookie);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.receipt.status,'confirmed');assert.equal(result.data.receipt.explorerUrl,'https://explorer.solana.com/tx/'+signature+'?cluster=devnet');
 const reads=rpcCalls.length;assert.equal((await call('stamp-confirm',confirm,a.cookie)).status,200);assert.equal(rpcCalls.length,reads,'Confirmed replay is served from the authoritative journal');
 assert.equal((await call('stamp-confirm',{...confirm,signature:otherSignature},a.cookie)).status,409);
 const stamps=await call('stamps',undefined,a.cookie);assert.equal(stamps.data.receipts.length,2);assert.equal(stamps.data.receipts.filter(r=>r.status==='confirmed').length,1);
 assert.deepEqual((await call('stamps',undefined,b.cookie)).data.receipts,[]);
 assert.deepEqual(await stub.fetch('https://internal/fixture-money').then(r=>r.json()),moneyBefore,'Stamp preparation, failures, confirmation and replay cannot alter money, claims or revisions');
 const kv=await mf.getKVNamespace('LP_CACHE'),keys=await kv.list({prefix:'wf:stamp:'});assert.equal(keys.keys.length,2);const mirrored=await Promise.all(keys.keys.map(k=>kv.get(k.name,'json')));assert(mirrored.some(r=>r.status==='confirmed'&&r.signature===signature));
 console.log('PASS real Worker devnet stamps: secure sessions, genuine persisted events, exact receipt replay, private roll isolation, pinned read-only mocked RPC, pending/error/confirmed states, immutable paper money and separate KV receipts. No real signing or network.');
}finally{await mf.dispose();}
