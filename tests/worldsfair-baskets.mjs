import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'worldsfair-baskets-'));
for(const [name,file] of [['baskets','src/worldsfair-paper-baskets.ts'],['math','src/worldsfair-basket-math.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {preparePaperBasketPurchase,markPaperBaskets,PaperBasketError}=await import(join(dir,'baskets.mjs'));
const {splitBasketLamports,basketUnitValue,basketPerformance,basketMint,basketRaw,BASKET_SOL:SOL}=await import(join(dir,'math.mjs'));
const require=createRequire(import.meta.url),{web3}=require('../execution/node_modules/@meteora-ag/dlmm/node_modules/@coral-xyz/anchor');
const mint=n=>new web3.PublicKey(Uint8Array.from({length:32},(_,i)=>(n*31+i)%256)).toBase58(),A=mint(1),B=mint(2),C=mint(3),program='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const rows=[{mint:A,weight:33.333333,symbol:'A'},{mint:B,weight:33.333333,symbol:'B'},{mint:C,weight:33.333334,symbol:'C'}];
for(let lamports=3;lamports<3000;lamports+=17){
 const text='0.'+String(lamports).padStart(9,'0'),result=splitBasketLamports(text,rows);
 assert.equal(result.amountLamports,lamports);assert.equal(result.legs.reduce((n,r)=>n+r.inputLamports,0),lamports,'every lamport allocated exactly');
 for(const leg of result.legs)assert.ok(Math.abs(leg.inputLamports-lamports*leg.weight/100)<1.00000001,'largest remainder remains within one lamport of ideal');
 assert.deepEqual(result,splitBasketLamports(text,[...rows].reverse()),'mint tie-break makes source ordering irrelevant');
}
assert.equal(splitBasketLamports('1.000000001',[{mint:A,weight:25},{mint:A,weight:25},{mint:B,weight:50}]).legs.length,2,'duplicate mints merge before quoting');
for(const amount of ['0','-1','0.0000000001','1e2',NaN,Infinity])assert.throws(()=>splitBasketLamports(amount,rows));
for(const weights of [[{mint:A,weight:99}],[{mint:A,weight:0},{mint:B,weight:100}],[{mint:A,weight:100.01}],[{mint:'invalid',weight:100}],Array.from({length:13},(_,i)=>({mint:mint(i+10),weight:100/13}))])assert.throws(()=>splitBasketLamports('1',weights));
assert.throws(()=>splitBasketLamports('0.000000001',rows),/at least one lamport/);
assert.equal(basketMint(A),true);assert.equal(basketMint('A'.repeat(32)),false);
assert.equal(basketRaw('18446744073709551615'),true);assert.equal(basketRaw('18446744073709551616'),false);assert.equal(basketRaw('0'.repeat(1000)),false);
assert.equal(basketUnitValue('2000000',6,40),80);assert.equal(basketUnitValue('2000000',null,40),null);
assert.deepEqual(basketPerformance(500000000,80,200,100),{costSol:.5,valueSol:.4,valueUsd:80,holdSolValueUsd:100,pnlSol:-.09999999999999998,vsHoldSolUsd:-19.999999999999996,absolutePnlUsd:30});
assert.equal(basketPerformance(500000000,null,200,100).pnlSol,null);assert.equal(basketPerformance(500000000,80,null,100).valueUsd,null);
assert.equal(basketPerformance(500000000,80,200,null).absolutePnlUsd,null);

const originalFetch=globalThis.fetch,realNow=Date.now;
let clock=Date.UTC(2026,9,5,12),calls=[],quoteFault=null,priceFault=null,rpcFault=null,inactive=false,missingFlags=false,key=true,budget=true,activeQuotes=0,maxActiveQuotes=0,blockTimeRequests=0,cacheEnabled=false;
Date.now=()=>clock;
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
class KV{values=new Map();puts=0;async get(k,type){const value=this.values.get(k);return value==null?null:type==='json'?JSON.parse(value):value;}async put(k,v){if(k.startsWith('paper-jupiter:v1:')){if(cacheEnabled)this.values.set(k,v);return;}this.puts++;this.values.set(k,v);}}
const kv=new KV();
const env=()=>({LP_CACHE:kv,SOLANA_RPC:'https://rpc.test',...(key?{JUPITER_API_KEY:'paper-fixture-key'}:{}),RANGE_ALERTS:{idFromName:name=>name,get:()=>({fetch:async req=>{calls.push({url:String(req.url),method:req.method});return response({allowed:budget,reason:budget?'allowed':'budget',retryAt:null});}})}});
const detail=()=>({id:'basket-id',slug:'fixture-basket',name:'Fixture basket',...(missingFlags?{}:{isActive:!inactive,isPublished:true}),definition:{bucket:{mode:'parallel',nodes:[{nodeType:'swap.token',amount:{percentage:50},parameters:{toToken:A}},{nodeType:'swap.token',amount:{percentage:25},parameters:{toToken:B}},{nodeType:'swap.token',amount:{percentage:25},parameters:{toToken:SOL}}]}}});
globalThis.fetch=async(input,init={})=>{
 const url=new URL(input),method=init.method||'GET';calls.push({url:url.href,method});
 assert.ok(!/\/(?:swap|build|swap-instructions|execute|sendTransaction)$/.test(url.pathname),'provider never constructs or sends a transaction');
 if(url.hostname==='backend.cesto.co'){
  assert.equal(method,'GET');assert.ok(!url.pathname.includes('graph'),'buy never fetches performance graph');
  if(url.pathname==='/products/fixture-basket')return response(detail());
  if(url.pathname==='/products')return response([{id:'basket-id',slug:'fixture-basket',isActive:!inactive,isPublished:true}]);
  throw Error('Unexpected Cesto path '+url.pathname);
 }
 if(url.hostname==='rpc.test'){
  assert.equal(method,'POST');const body=JSON.parse(init.body);
  if(Array.isArray(body))return response(body.map(item=>{blockTimeRequests++;assert.equal(item.method,'getBlockTime');return {id:item.id,result:quoteFault==='old-slot'?Math.floor(clock/1000)-46:priceFault==='stale'?Math.floor(clock/1000)-301:priceFault==='future'?Math.floor(clock/1000)+1:Math.floor(clock/1000)-2};}));
  assert.equal(body.method,'getMultipleAccounts');assert.equal(body.params[1].encoding,'jsonParsed');
  return response({result:{value:body.params[0].map(()=>({owner:rpcFault==='owner'?mint(55):program,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:rpcFault==='decimals'?19:6}}}}))}});
 }
 if(url.hostname==='api.jup.ag'){
  assert.equal(method,'GET');assert.equal(init.headers['x-api-key'],key?'paper-fixture-key':undefined);if(!key)assert.equal(Object.hasOwn(init.headers,'x-api-key'),false,'keyless reads omit authentication header entirely');
  if(url.pathname==='/price/v3'){
   if(priceFault==='timeout'){clock+=26000;throw Error('Optional price timeout');}
   const ids=url.searchParams.get('ids').split(',');assert.ok(ids.length<=50);
   const body={};for(const id of ids){if(priceFault==='missing'&&id===B)continue;body[id]={usdPrice:id===SOL?200:40,decimals:priceFault==='decimals'&&id===A?9:id===SOL?9:6,blockId:1000000,createdAt:'2020-01-01T00:00:00Z'};}
   return response(body);
  }
  assert.equal(url.pathname,'/swap/v1/quote');activeQuotes++;maxActiveQuotes=Math.max(maxActiveQuotes,activeQuotes);await Promise.resolve();activeQuotes--;
  assert.equal(url.searchParams.get('swapMode'),'ExactIn');assert.equal(url.searchParams.get('instructionVersion'),'V2');
  if(quoteFault==='http'||quoteFault==='one-leg'&&url.searchParams.get('outputMint')===B)return new Response('unavailable',{status:503});
  const out={inputMint:SOL,outputMint:url.searchParams.get('outputMint'),inAmount:url.searchParams.get('amount'),outAmount:'2000000',otherAmountThreshold:'1990000',swapMode:'ExactIn',slippageBps:50,priceImpactPct:'0.0123',routePlan:[{swapInfo:{label:'Fixture'}}],contextSlot:1000000};
  if(quoteFault==='mint')out.outputMint=C;if(quoteFault==='amount')out.inAmount='1';if(quoteFault==='units')out.outAmount='NaN';if(quoteFault==='overflow')out.outAmount='18446744073709551616';if(quoteFault==='impact')out.priceImpactPct='1.1';if(quoteFault==='mode')out.swapMode='ExactOut';
  if(quoteFault==='expiry')clock+=46000;
  return response(out);
 }
 throw Error('Unexpected provider '+url.href);
};
try{
 key=false;const publicPurchase=await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'});assert.equal(publicPurchase.legs.length,3,'documented keyless quote path verifies every unit');assert.equal(publicPurchase.entrySolUsd,200);calls=[];key=true;
 const purchase=await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1.000000001'});
 assert.equal(purchase.amountLamports,1000000001);assert.equal(purchase.legs.reduce((n,l)=>n+l.inputLamports,0),1000000001);assert.equal(purchase.kind,'basket');
 const leg=purchase.legs.find(l=>l.mint===A);assert.equal(leg.unitsRaw,'2000000');assert.equal(leg.decimals,6);assert.equal(leg.priceImpactFraction,.0123,'1.23% impact stores as .0123 fraction');
 const solLeg=purchase.legs.find(l=>l.mint===SOL);assert.equal(solLeg.unitsRaw,String(solLeg.inputLamports));assert.equal(solLeg.priceImpactFraction,0);
 assert.equal(purchase.entrySolUsd,200);assert.ok(purchase.expiresAt>Date.now());assert.ok(maxActiveQuotes<=3);assert.equal(calls.filter(c=>c.url.includes('/swap/v1/quote')).length,2,'SOL allocation does not call a SOL-to-SOL quote');assert.equal(kv.puts,0,'provider prep never debits or persists money');
 const holding={...purchase,id:'holding-1',openedAt:purchase.preparedAt};
 let marked=await markPaperBaskets(env(),[holding]);assert.equal(marked.marks[0].status,'complete');assert.ok(marked.marks[0].asOf.endsWith('58.000Z'));assert.ok(marked.marks[0].valueUsd>0);assert.ok(marked.marks[0].absolutePnlUsd!==null);
 priceFault='missing';marked=await markPaperBaskets(env(),[holding]);assert.equal(marked.marks[0].status,'partial');assert.equal(marked.marks[0].valueSol,null);assert.equal(marked.marks[0].pnlSol,null,'missing leg cannot be zero-filled');
 for(const fault of ['stale','future']){priceFault=fault;marked=await markPaperBaskets(env(),[holding]);assert.equal(marked.marks[0].status,'unavailable');assert.equal(marked.marks[0].valueUsd,null);}
 priceFault='decimals';marked=await markPaperBaskets(env(),[holding]);assert.equal(marked.marks[0].status,'partial');assert.equal(marked.marks[0].legs.find(l=>l.mint===A).valueUsd,null,'price metadata cannot override verified mint decimals');priceFault=null;
 const manyHoldings=Array.from({length:5},(_,i)=>({...holding,id:'holding-'+i,legs:Array.from({length:12},(_,j)=>({...leg,mint:mint(60+i*12+j),unitsRaw:'1000000'}))}));
 const priorPriceCalls=calls.filter(c=>c.url.includes('/price/v3')).length,priorBlockTimes=blockTimeRequests;
 const many=await markPaperBaskets(env(),manyHoldings);assert.ok(many.marks.every(mark=>mark.status==='complete'),'more than50different tokens remain valueable');
 assert.equal(calls.filter(c=>c.url.includes('/price/v3')).length-priorPriceCalls,2,'price requests batch no more than50mints');
 assert.equal(blockTimeRequests-priorBlockTimes,1,'shared slots deduplicate across price batches before RPC');
 key=false;marked=await markPaperBaskets(env(),[holding]);assert.equal(marked.quotesConfigured,true);assert.equal(marked.marks[0].status,'complete','public keyless price reads remain block-dated');key=true;
 for(const fault of ['mint','amount','units','overflow','impact','mode','http','one-leg']){quoteFault=fault;await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e instanceof PaperBasketError&&e.code.startsWith('basket_quote'));}quoteFault=null;
 for(const fault of ['owner','decimals']){rpcFault=fault;await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e.code==='basket_mint_unavailable');}rpcFault=null;
 inactive=true;await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e.code==='basket_unavailable');inactive=false;missingFlags=true;
 const listed=await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'});assert.equal(listed.name,'Fixture basket');assert.ok(calls.some(c=>new URL(c.url).pathname==='/products'),'missing detail activity flags require positive fresh catalogue evidence');missingFlags=false;
 budget=false;await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e.code==='basket_quote_budget');budget=true;
 cacheEnabled=true;kv.values.clear();await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'});const beforeCached=calls.filter(c=>new URL(c.url).hostname==='api.jup.ag').length;const cachedPurchase=await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'});assert.equal(calls.filter(c=>new URL(c.url).hostname==='api.jup.ag').length,beforeCached,'short source cache saves quote allowance');assert.equal(cachedPurchase.quoteAsOf,new Date(clock-2000).toISOString(),'cache does not replace block time with retrieval time');quoteFault='old-slot';await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e.code==='basket_quote_expired','cached quote still needs original fresh block evidence');quoteFault=null;cacheEnabled=false;kv.values.clear();
 quoteFault='old-slot';await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>e.code==='basket_quote_expired');quoteFault=null;
 priceFault='timeout';const optionalTimeout=await preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'});assert.equal(optionalTimeout.entrySolUsd,null,'optional dollar mark can be missing');assert.ok(optionalTimeout.expiresAt>Date.now(),'valid proven quote survives optional price timeout');priceFault=null;
 quoteFault='expiry';await assert.rejects(preparePaperBasketPurchase(env(),{slug:'fixture-basket',amountSol:'1'}),e=>['basket_provider_timeout','basket_quote_expired'].includes(e.code));quoteFault=null;
 assert.equal(kv.puts,0,'all failed provider preparations leave ledger untouched');
 console.log('PASS basket math/providers: exact weighted lamports, raw units, decimals, quote identities, decimal impact, bounded quote-only calls, keyless and keyed reads, cached-source age checks, fresh prices and SOL/USD benchmarks');
}finally{globalThis.fetch=originalFetch;Date.now=realNow;}
