import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'still-legacy-rpc-')),originalFetch=globalThis.fetch;
const RPC='https://solana.api.onfinality.io/public',GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SOL='So11111111111111111111111111111111111111112',MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',POOL='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const pool={id:'solana:'+POOL,address:POOL,chain:'solana',venue:'meteora-dlmm',pair:'USDC/SOL',base:{address:MINT,symbol:'USDC'},quote:{address:SOL,symbol:'SOL'},tags:[],fetchedAt:new Date().toISOString()};
const stored=new Map([['snapshot:v1',{pools:[pool],updatedAt:new Date().toISOString(),sources:{},errors:{}}]]),rpcCalls=[],budgets=[],quoteCalls=[];
let allowRpc=true,allowQuotes=true,rpcStatus=200,quoteStatus=200,rpcCooldowns=0,quoteCooldowns=0,metadataCalls=0;
const reply=value=>Response.json(value);
const env={SOLANA_RPC:RPC,MIN_TVL_USD:'5000',WALLETS:'',JUPITER_API_KEY:'synthetic-quote-key',LP_CACHE:{get:async(key,type)=>{const value=stored.get(key);return typeof value==='string'&&type==='json'?JSON.parse(value):value??null;},put:async(key,value)=>stored.set(key,value)},RANGE_ALERTS:{idFromName:name=>name,get:()=>({fetch:async request=>{
 const path=new URL(request.url).pathname;
 if(path==='/public-rpc/reserve'){
  const body=await request.json(),now=Date.now();assert.deepEqual(Object.keys(body),['count']);assert(body.count<=2);budgets.push(body.count);
  return reply(allowRpc?{allowed:true,reason:'allowed',retryAt:null,reservedAt:now,dispatchUntil:now+250}:{allowed:false,reason:'cooldown',retryAt:now+30000,reservedAt:null,dispatchUntil:null,observedAt:now,retryAfterMs:30000});
 }
 if(path==='/public-rpc/cooldown'){rpcCooldowns++;const now=Date.now();return reply({recorded:true,retryAt:now+30000,observedAt:now,retryAfterMs:30000});}
 if(path==='/jupiter/reserve')return reply({allowed:allowQuotes,reason:allowQuotes?'allowed':'budget',retryAt:allowQuotes?null:Date.now()+30000});
 if(path==='/jupiter/cooldown'){quoteCooldowns++;return reply({recorded:true,retryAt:Date.now()+30000});}
 throw Error('Unexpected private budget path '+path);
}})}};
try{
 await build({entryPoints:['src/worldsfair.ts'],outfile:join(dir,'worker.mjs'),bundle:true,platform:'node',format:'esm',mainFields:['main'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
 const {default:worker}=await import(join(dir,'worker.mjs'));
 globalThis.fetch=async(url,init={})=>{
  const target=new URL(url);
  if(target.href===RPC){
   assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');const body=JSON.parse(init.body),rows=Array.isArray(body)?body:[body];rpcCalls.push(rows.map(row=>row.method));
   if(rpcStatus!==200)return new Response('fixture rate limit',{status:rpcStatus,headers:{'retry-after':'30'}});
   const result=rows.map(row=>{
    let value;if(row.method==='getGenesisHash')value=GENESIS;
    else if(row.method==='getEpochInfo')value={epoch:10};
    else {
     assert.equal(row.method,'getAccountInfo');
     const info={decimals:6,extensions:[{extension:'transferFeeConfig',state:{olderTransferFee:{epoch:1,transferFeeBasisPoints:100},newerTransferFee:{epoch:11,transferFeeBasisPoints:300}}}]};
     value=row.params[1].encoding==='base64'?{value:{owner:POOL}}:{value:{owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:{parsed:{info}}}};
    }
    return {jsonrpc:'2.0',id:row.id,result:value};
   });return reply(Array.isArray(body)?result:result[0]);
  }
  if(target.hostname==='dlmm.datapi.meteora.ag'){metadataCalls++;return reply({address:POOL,token_x:{address:MINT,symbol:'USDC'},token_y:{address:SOL,symbol:'SOL'}});}
  assert.equal(target.origin,'https://api.jup.ag','Worldsfair cannot use the legacy unbudgeted quote endpoint');assert.equal(target.pathname,'/swap/v1/quote');assert.equal(init.redirect,'manual');assert.equal(init.headers['x-api-key'],env.JUPITER_API_KEY);quoteCalls.push(target.searchParams);
  if(quoteStatus!==200)return new Response('fixture rate limit',{status:quoteStatus,headers:{'retry-after':'30'}});
  const query=target.searchParams;return reply({inputMint:query.get('inputMint'),outputMint:query.get('outputMint'),inAmount:query.get('amount'),outAmount:query.get('inputMint')===SOL?'5000000':'49500000',routePlan:[{swapInfo:{label:'Fixture'}}]});
 };
 const request=path=>worker.fetch(new Request('https://still.test'+path),env);
 let result=await request('/api/pool-lookup?address='+POOL);assert.equal(result.status,200);assert.equal((await result.json()).type,'Meteora DLMM');assert.deepEqual(budgets,[2],'Lookup reserves its read and mainnet proof');assert.equal(metadataCalls,1);
 result=await request('/api/pool-lookup?address='+POOL);assert.equal(result.status,200);assert.equal(rpcCalls.length,1,'Dated lookup cache avoids a second RPC');
 result=await request('/api/check?pool='+encodeURIComponent(pool.id));let data=await result.json();assert.equal(result.status,200);assert.match(data.findings.find(f=>f.title==='Token-2022 transfer fee').detail,/1.00%/);assert.deepEqual(rpcCalls.slice(1),[['getAccountInfo'],['getEpochInfo']]);assert.equal(quoteCalls.length,2);assert.equal(quoteCalls[1].get('amount'),'5000000','Sell quote uses the exact first leg output');
 allowRpc=false;let before=rpcCalls.length;result=await request('/api/pool-lookup?address='+SOL);assert.equal(result.status,400);assert.equal(rpcCalls.length,before,'Shared cooldown stops lookup before provider dispatch');allowRpc=true;
 result=await worker.fetch(new Request('https://still.test/api/pool-lookup?address='+SOL),{...env,RANGE_ALERTS:undefined});assert.equal(result.status,400);assert.equal(rpcCalls.length,before,'Missing binding fails closed');
 allowQuotes=false;let beforeQuotes=quoteCalls.length;data=await (await request('/api/check?pool='+encodeURIComponent(pool.id))).json();assert.equal(quoteCalls.length,beforeQuotes);assert(data.findings.some(f=>f.title==='Round-trip quote unavailable'));allowQuotes=true;
 quoteStatus=429;data=await (await request('/api/check?pool='+encodeURIComponent(pool.id))).json();assert.equal(quoteCalls.length,beforeQuotes+1,'Quote429 is neither retried nor followed by a second leg');assert.equal(quoteCooldowns,1);assert(data.findings.some(f=>f.title==='Round-trip quote unavailable'));quoteStatus=200;
 rpcStatus=429;before=rpcCalls.length;result=await request('/api/pool-lookup?address='+SOL);assert.equal(result.status,400);assert.equal(rpcCalls.length,before+1,'Lookup does not use readFetch429 retry on the Still provider');assert.equal(rpcCooldowns,1);
 allowQuotes=false;data=await (await request('/api/check?pool='+encodeURIComponent(pool.id))).json();assert.equal(rpcCalls.length,before+1,'The other public Research route observes the same RPC cooldown');assert.equal(data.verdict,'info');assert(data.findings.some(f=>f.title==="Couldn't read mint"));assert.doesNotMatch(JSON.stringify(data),/synthetic-quote-key|fixture rate limit/);
 console.log('PASS Still legacy Research routes: shared RPC grants/mainnet proof, current epoch, no429 retries, cross-route cooldown, fail-closed binding, gated Jupiter legs and preserved unavailable states');
}finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
