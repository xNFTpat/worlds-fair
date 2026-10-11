import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'still-cost-verdict-')),originalFetch=globalThis.fetch;
try {
 await build({stdin:{contents:"export * from './src/sources/research-reads';export * from './src/still-preflight';export * from './src/still-demo-pools';export * from './src/still-checks';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'test.mjs')});
 const {readStillSwapQuote,stillQuoteConversion,stillProjectedFeeRate,researchReadContext,buildStillPreflight,readStillHotPools,listStillPools,STILL_THIN_DEMO,STILL_KNOWN_ISSUERS}=await import(pathToFileURL(join(dir,'test.mjs')));
 const SOL='So11111111111111111111111111111111111111112',mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',now=Date.now(),at=new Date(now).toISOString();
 const pool={id:'solana:pool',address:'pool',pair:'USDC/SOL',chain:'solana',venue:'meteora-dlmm',base:{address:mint},quote:{address:SOL},priceQuote:.01,priceUsd:1,quotePriceUsd:100,fetchedAt:at,tvlUsd:100000,ageHours:200,volume24hUsd:240000,activity:{fees1h:1000,volume1h:10000},poolConfig:{binStep:100},tags:[]};
 const store=new Map(),env={LP_CACHE:{get:async k=>store.get(k)??null,put:async(k,v,options)=>{store.set(k,JSON.parse(v));if(k==='still:hot-sol-pools:v1')assert.equal(options.expirationTtl,300);}},RANGE_ALERTS:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({allowed:true,reason:'allowed',retryAt:null})})}};
 let kind='normal',requests=[];
 globalThis.fetch=async u=>{
  const url=new URL(u);assert.equal(url.hostname,'api.jup.ag','Quote cost needs no supplemental RPC');requests.push(url);
  if(kind==='failure')return new Response('{}',{status:503});
  const buy=url.searchParams.get('inputMint')===SOL;
  return Response.json({inputMint:buy?SOL:mint,outputMint:buy?mint:SOL,inAmount:url.searchParams.get('amount'),outAmount:buy?'25000000':'251000000',priceImpactPct:kind==='missing-impact'?undefined:'0.002',routePlan:kind==='missing-route-plan'?undefined:[{swapInfo:{ammKey:'alternate-real-route',inputMint:buy?SOL:mint,outputMint:buy?mint:SOL,inAmount:url.searchParams.get('amount'),outAmount:buy?'25000000':'251000000',feeMint:SOL,feeAmount:kind==='missing-fee'?undefined:'100000'}}]});
 };
 const read=async(direction='exit')=>readStillSwapQuote(pool,researchReadContext(env),6,{source:'meteora-pool',priceSol:.01,asOf:at,poolAddress:'pool',mint},direction,.25);
 const quote=await read();
 assert.equal(requests.length,1,'Direct exit needs one quote, no funding swap');
 assert.equal(requests[0].searchParams.get('amount'),'25000000','0.25 SOL worth of tokens at mid');
 assert.equal(stillQuoteConversion(quote,'exit',6,Date.now()),-.001,'Signed mid-value minus returned SOL');
 const entry=await read('entry');assert.equal(requests[1].searchParams.get('amount'),'250000000');
 assert.equal(stillQuoteConversion(entry,'entry',6,Date.now()),0,'Entry is SOL input minus returned token mid-value');
 assert.equal(stillProjectedFeeRate(pool),.01);
 assert.equal(stillProjectedFeeRate({...pool,volume24hUsd:24000}),.001,'Hot hour capped at daily volume / 24');
 assert.equal(stillProjectedFeeRate({...pool,volume24hUsd:2400000}),.01,'Slower current hour wins');
 assert.equal(stillProjectedFeeRate({...pool,volume24hUsd:null}),null,'Missing daily volume is not invented');
 assert.equal(stillProjectedFeeRate({...pool,activity:{fees1h:0,volume1h:0}}),0,'Observed zero activity');
 const rpc={mint,status:'available',asOf:at,decimals:6,freezeAuthority:null,transferFeeStatus:'none'},network={asOf:at,singleLamports:5000,doubleLamports:10000};
 const detail={pool,safety:{rpc},network,quotes:[quote]};
 const p=buildStillPreflight(detail,.5,Date.now());assert(Math.abs(p.exitCostSol.value+.00099)<1e-12);assert.equal(p.entryCostSol.value,.00001);
 for(const mint of STILL_KNOWN_ISSUERS){
  const d={...detail,pool:{...pool,base:{address:mint}},safety:{rpc:{...rpc,mint,freezeAuthority:'active'}}};
  const check=buildStillPreflight(d,.5,now).checks.find(c=>c.id==='freeze');assert.equal(check.status,'caution');assert.equal(check.result,'Known issuer');
 }
 const impostor=buildStillPreflight({...detail,pool:{...pool,base:{address:'not-a-known-mint'}},safety:{rpc:{...rpc,mint:'not-a-known-mint',freezeAuthority:'active'}}},.5,now);
 assert.equal(impostor.checks.find(c=>c.id==='freeze').status,'fail','Ticker/name do not grant an issuer exception');
 for(kind of ['missing-fee','missing-impact','missing-route-plan','failure']){
  store.clear();const q=await read();
  const result=buildStillPreflight({...detail,quotes:[q]},.5,Date.now());
  if(kind==='failure'){assert.equal(result.exitCostSol.value,null);assert.equal(result.netReturnPct.value,null);assert.equal(result.verdict.label,'Marginal');assert.match(q.note,/HTTP 503/);}
  else assert(Math.abs(result.exitCostSol.value+.00099)<1e-12,'Missing optional fee/impact does not block valid proceeds');
 }
 store.clear();requests=[];
 const raw=(address,volume,solX=false)=>({address,name:'TEST/SOL',is_blacklisted:false,tvl:10000,current_price:solX?100:.01,created_at:Date.now()-360000000,token_x:{address:solX?SOL:mint,symbol:solX?'SOL':'TEST',price:solX?100:1},token_y:{address:solX?mint:SOL,symbol:solX?'TEST':'SOL',price:solX?1:100},pool_config:{bin_step:100},fees:{'1h':100,'24h':1000},volume:{'1h':volume},tags:[]});
 globalThis.fetch=async u=>{
  const url=new URL(u);requests.push(url);assert.equal(url.hostname,'dlmm.datapi.meteora.ag');
  if(url.searchParams.get('filter_by').startsWith('pool_address='))return Response.json({data:[]});
  assert.equal(url.searchParams.get('sort_by'),'volume_1h:desc');
  return Response.json({data:url.searchParams.get('filter_by').includes('token_x=')?[raw('x',1000,true)]:[raw('y',5000),raw('zero',0)]});
 };
 const hot=await readStillHotPools(env);assert.deepEqual(listStillPools(hot).map(p=>p.address),['y','x','zero']);
 const before=requests.length;const cached=await readStillHotPools(env);assert.equal(requests.length,before);assert.equal(cached.updatedAt,hot.updatedAt,'Original source timestamp survives cache hits');
 store.set('still:hot-sol-pools:v1',{...hot,updatedAt:new Date(Date.now()-300001).toISOString()});
 globalThis.fetch=async()=>{throw Error('provider down');};assert.equal((await readStillHotPools(env)).pools.length,0,'Expired hot catalogue is not presented as current');
 const example={...pool,address:STILL_THIN_DEMO.address,base:{address:STILL_THIN_DEMO.mintX},quote:{address:STILL_THIN_DEMO.mintY},activity:{volume1h:1},pair:'SKR/SOL'};
 const many=Array.from({length:10},(_,i)=>({...pool,address:'pool-'+i,activity:{volume1h:100-i}}));const cards=listStillPools({pools:[...many,example],errors:{},updatedAt:at});assert.equal(cards.length,8);assert.deepEqual(cards.slice(0,7).map(p=>p.address),many.slice(0,7).map(p=>p.address));assert.equal(cards[7].thinExample,true);
 console.log('PASS direct amount-based quotes, optional hop fields, signed execution differences, slower-volume fee projections, half-size exit, missing-quote Caution, exact issuer allowlist and five-minute live volume catalogue');
} finally {globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
