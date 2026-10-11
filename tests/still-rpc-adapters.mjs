import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'still-rpc-adapters-'));
const originalFetch=globalThis.fetch;
const SOL='So11111111111111111111111111111111111111112',MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPC='https://budgeted-fixture.invalid',program='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const reply=body=>Response.json(body),calls=[];
let readAccount;const accountObserved=new Promise(resolve=>{readAccount=resolve;});
const env={SOLANA_RPC:RPC,LP_CACHE:{get:async()=>null,put:async()=>{}},RANGE_ALERTS:{idFromName:name=>name,get:()=>({fetch:async()=>reply({allowed:true,reason:'allowed',retryAt:null})})}};
try{
 // Substitute only the provider wrapper. Production adapter/SDK code must
 // propagate its exact Worker binding; the real bucket is tested separately.
 await build({stdin:{contents:`export {readWalletBins} from './execution/still-wallet-reader';export {paperRpcTransport} from './execution/paper-rpc';export {preparePaperTokenQuotes,readPaperTokenPrices} from './src/worldsfair-paper-baskets';`,resolveDir:process.cwd(),loader:'js'},outfile:join(dir,'adapters.mjs'),bundle:true,platform:'node',format:'esm',mainFields:['main'],banner:{js:"import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {dirname} from 'node:path';const require=createRequire(import.meta.url),__filename=fileURLToPath(import.meta.url),__dirname=dirname(__filename);"},plugins:[{name:'rpc-boundary',setup(b){b.onResolve({filter:/solana-read-rpc$/},()=>({path:'rpc-boundary',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const solanaReadFetch=(...args)=>globalThis.__stillAdapterRead(...args);',loader:'js'}));}}]});
 const {readWalletBins,paperRpcTransport,preparePaperTokenQuotes,readPaperTokenPrices}=await import(join(dir,'adapters.mjs'));
 globalThis.__stillAdapterRead=async(url,init,options)=>{
  assert.equal(url,RPC);assert.equal(options?.env,env,'Every production adapter propagates its exact shared budget binding');
  assert(options.deadline>Date.now());options.onRequest?.();
  const body=JSON.parse(init.body),requests=Array.isArray(body)?body:[body];calls.push(...requests);
  const rows=requests.map(row=>{
   let result;
   if(row.method==='getSlot')result=123;
   else if(row.method==='getBlockTime')result=Math.floor(Date.now()/1000)-2;
   else if(row.method==='getMultipleAccounts')result={context:{slot:1000000},value:row.params[0].map(()=>row.params[1]?.encoding==='jsonParsed'?{owner:program,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:6}}}}:null)};
   else if(row.method==='getAccountInfo'){result={context:{slot:1000000},value:null};readAccount();}
   else throw Error('Unexpected read method '+row.method);
   return {jsonrpc:'2.0',id:row.id,result};
  });return reply(Array.isArray(body)?rows:rows[0]);
 };
 globalThis.fetch=async(url)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://api.jup.ag','Every RPC read must go through the shared wrapper');
  if(parsed.pathname==='/price/v3')return reply(Object.fromEntries(parsed.searchParams.get('ids').split(',').map(mint=>[mint,{usdPrice:mint===SOL?200:1,decimals:mint===SOL?9:6,blockId:1000001}])));
  assert.equal(parsed.pathname,'/swap/v1/quote');
  return reply({inputMint:SOL,outputMint:MINT,inAmount:parsed.searchParams.get('amount'),outAmount:'2000000',otherAmountThreshold:'1990000',swapMode:'ExactIn',slippageBps:50,priceImpactPct:'0.001',routePlan:[{swapInfo:{label:'Fixture'}}],contextSlot:1000000});
 };
 const transport=paperRpcTransport({env,intervalMs:0,maxRequests:22,maxDurationMs:16000});
 for(let id=1;id<=22;id++)assert.equal((await (await transport.fetch(RPC,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id,method:'getSlot',params:[]})})).json()).result,123);
 await assert.rejects(transport.fetch(RPC,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:23,method:'getSlot',params:[]})}),/budget reached/);
 assert.equal(transport.stats.requests,22,'SDK transport still enforces its read ceiling');calls.length=0;
 await assert.rejects(readWalletBins(RPC,SOL,MINT,program,env));
 assert(calls.some(row=>row.method==='getMultipleAccounts'),'Actual SDK reaches the budgeted read transport');
 let timeout;try{await Promise.race([accountObserved,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Queued SDK account read did not reach budget wrapper')),2000);})]);}finally{clearTimeout(timeout);}
 assert(calls.some(row=>row.method==='getAccountInfo'));calls.length=0;
 const legs=await preparePaperTokenQuotes(env,[{mint:MINT,symbol:'USDC',weight:100,inputLamports:500000000}],Date.now()+25000);
 assert.equal(legs[0].unitsRaw,'2000000');assert.deepEqual(calls.map(row=>row.method),['getMultipleAccounts','getBlockTime'],'Mint and quote block reads both use Worker budget');calls.length=0;
 const marks=await readPaperTokenPrices(env,[MINT],Date.now()+25000);
 assert.equal(marks.size,2);assert.deepEqual(calls.map(row=>row.method),['getBlockTime'],'Shared basket/vault price helper also uses Worker budget');
 console.log('PASS Still RPC adapters: Worker budget binding reaches wallet SDK, bounded paper transport, basket mint/quote reads and shared price timestamps; all providers mocked');
}finally{globalThis.fetch=originalFetch;delete globalThis.__stillAdapterRead;await rm(dir,{recursive:true,force:true});}
