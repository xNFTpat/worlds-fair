import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'lp-provider-caches-'));
await build({stdin:{contents:"export {setGeckoKey,getTokenCandleSeries} from './src/sources/geckoterminal.ts'; export {poolChart} from './src/charts.ts'; export {suggest,candlesFor} from './src/suggest.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'candles.mjs')});
for(const [name,file] of [['reads','src/sources/research-reads.ts'],['research','src/lp-research.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {setGeckoKey,getTokenCandleSeries,poolChart,suggest,candlesFor}=await import(pathToFileURL(join(dir,'candles.mjs')));
const {researchReadContext,readResearchQuotes,cachedResearchQuotes,researchQuoteFresh,researchEconomicQuoteFresh,researchEconomicQuoteUsable,researchBackoff,RESEARCH_SOL:SOL}=await import(pathToFileURL(join(dir,'reads.mjs')));
const {researchNet,researchFeeRates,researchCatalogue}=await import(pathToFileURL(join(dir,'research.mjs')));
const RealDate=Date,originalFetch=fetch,HOUR=3600000,MINUTE=60000,start=RealDate.parse('2026-09-30T18:00:00Z');let clock=start;
class ClockDate extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
globalThis.Date=ClockDate;
const at=t=>new RealDate(t).toISOString(),json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
class KV {values=new Map(); gets=0; async get(k,type){this.gets++;const r=this.values.get(k);if(!r||r.expires<=clock)return null;return type==='json'?JSON.parse(r.value):r.value;}async put(k,value,options={}){assert.ok(k.length<=512);assert.ok(!options.expirationTtl||options.expirationTtl>=60);this.values.set(k,{value,expires:clock+(options.expirationTtl||86400)*1000});}}
const sharedBudget=()=>({idFromName:name=>name,get:()=>({fetch:async request=>json(new URL(request.url).pathname.endsWith('/reserve')?{allowed:true,reason:'allowed',retryAt:null}:{recorded:true,retryAt:clock+30000})})});
const pool=(extra={})=>({id:'solana:pool',address:'pool',chain:'solana',venue:'meteora-dlmm',pair:'A/SOL',base:{address:'mint',symbol:'A'},quote:{address:SOL,symbol:'SOL'},tvlUsd:100000,volume24hUsd:1000000,fees24hUsd:10000,feeTier:.003,feeApr:36.5,priceUsd:100,priceQuote:1,quotePriceUsd:100,change24h:null,ageHours:48,tags:[],url:'https://app.meteora.ag/dlmm/pool',fetchedAt:at(clock),feeTvl:{h1:.001,mid:.008,midHours:4,h24:.1},txns24h:null,activity:{fees1h:100,fees4h:800,fees12h:600,volume1h:10000,volume4h:40000,volume12h:120000},poolConfig:{concentrated:true,feeSchedulerActive:false,compoundingFeePct:0,launchpad:null,binStep:20,baseFee:.003,dynamicFee:.001},...extra});
const nativeRows=Array.from({length:10},(_,i)=>({timestamp:(start/HOUR-10+i)*HOUR/1000,open:.0001,high:.00012,low:.00009,close:.00011,volume:100+i}));
const geckoBody=(p,rows=nativeRows)=>({meta:{base:{address:p.base.address},quote:{address:p.quote.address}},data:{attributes:{ohlcv_list:rows.map(r=>[r.timestamp,r.open,r.high,r.low,r.close,r.volume])}}});
try {
 // Exact-pool native candles survive public provider429 and retain partial coverage.
 const candleCache=new KV();setGeckoKey(undefined,candleCache);let candleCalls=[];
 globalThis.fetch=async input=>{const u=new URL(String(input));candleCalls.push(u);if(u.hostname==='api.geckoterminal.com'){assert.equal(u.searchParams.get('currency'),'token');assert.equal(u.searchParams.get('token'),'mint');return new Response('',{status:429});}assert.equal(u.hostname,'dlmm.datapi.meteora.ag');assert.equal(u.searchParams.get('timeframe'),'1h');assert.equal(Number(u.searchParams.get('start_time')),start/1000-48*3600);return json({address:'pool',data:nativeRows.map((r,i)=>i===0?{...r,timestamp:r.timestamp*1000}:r)});};
 const initial=await poolChart(pool(),2);assert.equal(initial.status,'available');assert.equal(initial.source,'Meteora DLMM Data API');assert.equal(initial.candles.length,10);assert.equal(initial.candles[0].c,.00011,'native SOL/token prices must never become USD prices');assert.equal(initial.chartUnit,'SOL per A');assert.equal(initial.asOf,at(start));assert.equal(initial.dataAsOf,at(start-HOUR));assert.match(initial.note,/partial/);assert.equal(candleCalls.length,2);
 const cached=await poolChart(pool(),2,{LP_CACHE:candleCache});assert.equal(candleCalls.length,2);assert.equal(cached.cached,true);assert.equal(cached.asOf,initial.asOf);
 const suggested=suggest(pool(),await candlesFor(pool(),2,{LP_CACHE:candleCache}),100,2);assert.equal(candleCalls.length,2);assert.equal(suggested.source,'Meteora DLMM Data API');assert.equal(suggested.dataAsOf,initial.dataAsOf);assert.equal(suggested.sourceAsOf,initial.asOf);assert.equal(suggested.dataStatus,'available');
 clock=start+5*MINUTE+1;globalThis.fetch=async input=>{candleCalls.push(new URL(String(input)));return new Response('',{status:503});};
 const stale=await poolChart(pool(),2);assert.equal(stale.status,'stale');assert.equal(stale.cached,true);assert.equal(stale.asOf,initial.asOf);assert.equal(stale.fetchedAt,initial.asOf);assert.equal(stale.dataAsOf,initial.dataAsOf);assert.equal(stale.candles.length,10);assert.match(stale.note,/Original read and candle dates/);
 // An API returning just the last hour merges actual saved history; no gap is fabricated.
 clock=start+HOUR;globalThis.fetch=async input=>new URL(String(input)).hostname==='api.geckoterminal.com'?new Response('',{status:429}):json({address:'pool',data:[{...nativeRows.at(-1),timestamp:start/1000,close:.000115}]});
 const merged=await poolChart(pool(),2);assert.equal(merged.candles.length,11);assert.equal(merged.status,'stale');assert.equal(merged.asOf,at(start));assert.equal(merged.dataAsOf,at(start));assert.equal(merged.candles.at(-1).c,.000115);assert.match(merged.note,/No missing intervals are filled/);
 // Wrong token/pool evidence cannot be admitted even when syntactically valid.
 setGeckoKey(undefined,new KV());globalThis.fetch=async input=>new URL(String(input)).hostname==='api.geckoterminal.com'?json(geckoBody(pool({base:{address:'wrong',symbol:'A'}}))):json({address:'another-pool',data:nativeRows});
 const rejected=await getTokenCandleSeries(pool(),48);assert.equal(rejected.status,'unavailable');assert.deepEqual(rejected.candles,[]);assert.equal(rejected.asOf,null);
 // SOL-X chart units remain native token/SOL. Research inversion is a separate adapter.
 clock=start;setGeckoKey(undefined,new KV());const solX=pool({id:'solana:solx',address:'solx',base:{address:SOL,symbol:'SOL'},quote:{address:'mint',symbol:'A'}});
 globalThis.fetch=async()=>json(geckoBody(solX,nativeRows.map(r=>({...r,open:10000,high:11000,low:9000,close:10500}))));
 const oriented=await poolChart(solX,2);assert.equal(oriented.chartUnit,'A per SOL');assert.equal(oriented.candles[0].c,10500);assert.equal(oriented.source,'GeckoTerminal');
 clock=start+6*MINUTE;const oldRaw=await poolChart(solX,2);assert.equal(oldRaw.status,'stale','a fifteen-minute raw provider cache cannot silently renew the five-minute chart source date');assert.equal(oldRaw.asOf,oriented.asOf);assert.equal(oldRaw.cached,true);

 // Four coherent quote pairs are cached by pool, size and route for economic reads.
 clock=start;const quoteCache=new KV(),env={LP_CACHE:quoteCache,JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget()},p=pool();let quoteCalls=0;
 const jupiter=async(input,init)=>{const u=new URL(String(input));quoteCalls++;assert.equal(u.hostname,'api.jup.ag');assert.equal(u.pathname,'/swap/v1/quote');assert.equal(init.headers['x-api-key'],'fixture-key');const buy=u.searchParams.get('inputMint')===SOL,amount=u.searchParams.get('amount'),small=buy?amount==='500000000':amount==='1000000',label=u.searchParams.has('dexes')?'Meteora DLMM':'Other venue';return json({inputMint:buy?SOL:'mint',outputMint:buy?'mint':SOL,inAmount:amount,outAmount:buy?small?'1000000':'2000000':small?'490000000':'980000000',routePlan:[{swapInfo:{ammKey:'pool',label}}]});};
 globalThis.fetch=jupiter;const freshQuotes=await readResearchQuotes(p,researchReadContext(env),6);assert.equal(quoteCalls,8);assert.ok(freshQuotes.every(q=>researchQuoteFresh(q)&&researchEconomicQuoteFresh(q)));assert.ok(freshQuotes.every(q=>q.economicEstimate.markPriceSol===1&&q.economicEstimate.tokenDecimals===6));
 clock=start+46000;globalThis.fetch=()=>{throw Error('Economic cache made a provider request');};const economic=await readResearchQuotes(pool({priceQuote:2}),researchReadContext(env),6);assert.equal(quoteCalls,8);assert.ok(economic.every(q=>q.status==='stale'&&q.roundTripCostSol===null&&q.exitCostSol===null&&researchEconomicQuoteFresh(q)&&!researchQuoteFresh(q)));assert.ok(economic.every(q=>q.economicEstimate.cached&&q.economicEstimate.asOf===at(start)&&q.economicEstimate.markAsOf===at(start)&&q.economicEstimate.markPriceSol===1));
 const fees=researchFeeRates(p),mint={status:'stale',asOf:at(start),decimals:6,transferFeeStatus:'none',transferFee:null,flags:[],concentration:null};clock=start+6*MINUTE;
 const cachedNet=researchNet(fees,economic,1,'best',4,mint,1);assert.equal(cachedNet.status,'estimated');assert.equal(cachedNet.quoteFreshness,'cached-estimate');assert.equal(cachedNet.estimateCached,true);assert.equal(cachedNet.economicPolicyAsOf,at(start));assert.equal(cachedNet.dataAsOf,at(start));assert.equal(cachedNet.expiresAt,start+10*MINUTE);assert.match(cachedNet.note,/Cached economic (scenario|cost estimate)/);
 quoteCache.values.set('research:v1:enriched-index',{value:JSON.stringify({[p.id]:{at:at(start),tokenMint:'mint',quotes:freshQuotes,safety:{status:'partial',flags:[],rpc:{...mint,status:'available'},rugcheck:{status:'unknown',asOf:null,flags:[]},dexscreener:{status:'unknown',asOf:null,flags:[]}}}}),expires:clock+86400000});
 const before=quoteCache.gets,catalogue=await researchCatalogue({updatedAt:at(start),pools:[p],errors:{}},env,new URLSearchParams({sort:'net12'}));assert.equal(quoteCache.gets-before,2);assert.equal(catalogue.rows[0].safety.rpc.status,'stale');assert.equal(catalogue.rows[0].net.feeWindowHours,12);assert.equal(catalogue.rows[0].nets.length,3);assert.equal(catalogue.coverage.cachedEstimates,1);
 clock=start+10*MINUTE;assert.ok(economic.every(q=>!researchEconomicQuoteFresh(q)&&researchEconomicQuoteUsable(q)));
 globalThis.fetch=jupiter;const renewed=await readResearchQuotes(pool(),researchReadContext(env),6);assert.equal(quoteCalls,16);assert.ok(renewed.every(q=>q.status==='quoted'&&q.economicEstimate.asOf===at(clock)));
 // Same mint at another pool may share raw provider legs, but keeps its own source mark/cache identity.
 const second=await readResearchQuotes(pool({id:'solana:second',address:'second',priceQuote:2}),researchReadContext(env),6);assert.equal(quoteCalls,16);assert.ok(second.every(q=>q.economicEstimate.markPriceSol===2));assert.equal([...quoteCache.values.keys()].filter(k=>k.startsWith('research:v1:quote-estimate:')).length,8);
 globalThis.fetch=()=>{throw Error('Missing shared gate must not request Jupiter');};const noKey=await readResearchQuotes(p,researchReadContext({LP_CACHE:new KV()}),6);assert.ok(noKey.every(q=>q.status==='unavailable'&&!q.economicEstimate));

 // A favourable mark difference cannot erase actual sell AMM fees. The active
 // bin mark replaces the older catalogue price for a newly computed estimate.
 for(const feeCase of ['sol','token','split','missing','zero']){
  clock=start;const feeEnv={LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget()},markedPool=pool({priceQuote:99,fetchedAt:at(start-5*MINUTE)});let calls=0;
  globalThis.fetch=async input=>{
   calls++;const u=new URL(String(input)),buy=u.searchParams.get('inputMint')===SOL,amount=u.searchParams.get('amount'),size=buy?Number(amount)/1e9:Number(amount)/2e6,label=u.searchParams.has('dexes')?'Meteora DLMM':'Other venue';
   const info={ammKey:'pool',label,inputMint:buy?SOL:'mint',outputMint:buy?'mint':SOL,inAmount:amount,outAmount:buy?String(size*2e6):String(Math.round(size*1.001*1e9))};
   const feeMint=feeCase==='token'&&!buy?'mint':SOL,feeAmount=feeCase==='zero'?'0':String(Math.round(size*.003*(feeMint===SOL?1e9:2e6)));
   const routePlan=feeCase==='missing'?[{percent:50,swapInfo:{...info,inAmount:String(Number(amount)/2)}},{percent:50,swapInfo:{...info,inAmount:String(Number(amount)/2)}}]:feeCase==='split'?[{percent:50,swapInfo:{...info,feeMint,feeAmount:String(Number(feeAmount)/2)}},{percent:50,swapInfo:{...info,feeMint,feeAmount:String(Number(feeAmount)/2)}}]:[{percent:100,swapInfo:{...info,feeMint,feeAmount}}];
   return json({...info,routePlan});
  };
  const configuredFallback=feeCase==='missing'||feeCase==='zero',quotes=await readResearchQuotes(markedPool,researchReadContext(feeEnv),6,{priceSol:.5,asOf:at(start),source:'active-bin'}),fraction=configuredFallback?.004:.003;
  assert.equal(calls,8);
  for(const q of quotes){assert.equal(q.status,'quoted');assert.ok(Math.abs(q.exitCostSol-q.sizeSol*fraction)<1e-12,feeCase+' preserves the sell fee floor despite returned SOL exceeding the mark');assert.equal(q.roundTripCostSol,0,feeCase+' round-trip uses the net returned SOL amount without adding a second fee floor');assert.equal(q.exitFeeSource,configuredFallback?'pool-config':'jupiter-route');assert.equal(q.economicEstimate.markPriceSol,.5);assert.equal(q.economicEstimate.markAsOf,at(start));assert.equal(q.economicEstimate.costModelVersion,3);assert.equal(q.economicEstimate.retainedUntil,start+HOUR);}
  clock=start+46000;globalThis.fetch=()=>{throw Error('A still-fresh economic estimate cannot re-quote');};const kept=await readResearchQuotes(pool({priceQuote:100}),researchReadContext(feeEnv),6,{priceSol:3,asOf:at(clock),source:'active-bin'});assert.ok(kept.every(q=>q.economicEstimate.markPriceSol===.5&&q.economicEstimate.markAsOf===at(start)),'newer anchors do not revalue saved legs');
  if(feeCase==='sol'){
   const savedBytes=[...feeEnv.LP_CACHE.values].filter(([k])=>k.includes('quote-estimate:v3:')).map(([k,v])=>[k,v.value]);
   clock=start+11*MINUTE;let failures=0;globalThis.fetch=async()=>{failures++;return new Response('',{status:429});};const retained=await readResearchQuotes(markedPool,researchReadContext(feeEnv),6,{priceSol:3,asOf:at(clock),source:'active-bin'});
   assert.ok(failures>0&&failures<=4);assert.ok(retained.every(q=>q.status==='rate-limited'&&q.economicEstimate.status==='stale'&&q.economicEstimate.retained&&researchEconomicQuoteUsable(q)&&!researchEconomicQuoteFresh(q)));
   for(const q of retained){assert.equal(q.buyAsOf,at(start));assert.equal(q.sellAsOf,at(start));assert.equal(q.economicEstimate.asOf,at(start));assert.equal(q.economicEstimate.markPriceSol,.5);assert.equal(q.economicEstimate.retainedUntil,start+HOUR);}
   for(const [k,v] of savedBytes)assert.equal(feeEnv.LP_CACHE.values.get(k).value,v,'a failed refresh cannot overwrite or redates the last good economic estimate');
   const callsAfterFailure=failures;await readResearchQuotes(markedPool,researchReadContext(feeEnv),6);assert.equal(failures,callsAfterFailure,'cooldown retains dated economics without provider work');
   const withoutCredentials=await readResearchQuotes(markedPool,researchReadContext({LP_CACHE:feeEnv.LP_CACHE}),6);assert.ok(withoutCredentials.every(q=>researchEconomicQuoteUsable(q)&&q.economicEstimate.asOf===at(start)),'removing API credentials does not discard an unexpired dated estimate');
   clock=start+12*MINUTE;globalThis.fetch=async()=>{failures++;return new Response('',{status:503});};const unavailable=await readResearchQuotes(markedPool,researchReadContext(feeEnv),6,{priceSol:3,asOf:at(clock),source:'active-bin'});assert.ok(unavailable.every(q=>q.status==='unavailable'&&researchEconomicQuoteUsable(q)&&q.economicEstimate.asOf===at(start)));
   clock=start+59*MINUTE;const still=await cachedResearchQuotes(markedPool,feeEnv,6);assert.ok(still.every(q=>researchEconomicQuoteUsable(q)));
   clock=start+61*MINUTE;const expired=await cachedResearchQuotes(markedPool,feeEnv,6);assert.ok(expired.every(q=>!q.economicEstimate&&!researchEconomicQuoteUsable(q)),'estimates older than60 minutes stop being returned');
  }
 }
 // Old zero-cost cache entries never migrate into the corrected cost model.
 clock=start;const oldEnv={LP_CACHE:new KV()};await oldEnv.LP_CACHE.put('research:v1:quote-estimate:pool:mint:1:best',JSON.stringify({pool:'pool',mint:'mint',quote:freshQuotes[2],estimate:{...freshQuotes[2].economicEstimate,costModelVersion:undefined,exitCostSol:0}}),{expirationTtl:3600});const ignored=await cachedResearchQuotes(pool(),oldEnv,6);assert.ok(ignored.every(q=>!q.economicEstimate));assert.equal(researchEconomicQuoteUsable({...freshQuotes[0],economicEstimate:{...freshQuotes[0].economicEstimate,costModelVersion:undefined}}),false);
 // Missing shared budget binding fails closed before any Jupiter HTTP request.
 clock=start;let deniedCalls=0;globalThis.fetch=async()=>{deniedCalls++;throw Error('The shared budget is unavailable');};const denied=await readResearchQuotes(pool(),researchReadContext({LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key'}),6);assert.equal(deniedCalls,0);assert.ok(denied.every(q=>q.status==='unavailable'));
 // A missing verified active-bin mark does not create a new catalogue-marked
 // estimate. Amount-based round-trip quotes can still be returned separately.
 clock=start;globalThis.fetch=jupiter;const unanchored=await readResearchQuotes(pool({priceQuote:999}),researchReadContext({LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget()}),6,null);assert.ok(unanchored.every(q=>q.status==='quoted'&&q.exitCostSol===null&&!q.economicEstimate));
 // Parallel reservations preserve the per-detail request ceiling before the
 // asynchronous shared budget answers; denied reservations spend zero HTTP.
 clock=start;let boundedCalls=0;globalThis.fetch=async()=>{boundedCalls++;return new Response('',{status:503});};const bounded=researchReadContext({LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget()});bounded.maxRequests=1;await readResearchQuotes(pool(),bounded,6);assert.equal(boundedCalls,1);assert.equal(bounded.requests,1);assert.equal(bounded.pendingRequests,0);

 // Official Pump account prefixes and PublicKey.findProgramAddressSync golden
 // addresses verify both PDA derivations without a wallet or signing runtime.
 const pumpMint='CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU',pumpAddress='4JAnKFddd5fFTk5PxDj3PpTWJuTEfSWQEjZJcgKQ9KwW',feePda='5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx',canonicalCreator='4nmtvuAqUWayCUShwCVfLtbtDmidPUw9KUqpac6HYRp2';
 const decodeAddress=address=>{let n=0n;for(const c of address)n=n*58n+BigInt('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c));const bytes=Buffer.alloc(32);for(let i=31;i>=0;i--){bytes[i]=Number(n&255n);n>>=8n;}return bytes;};
 const baseAta='4MVHTwgHG8P3VYumwNENiiWYhFAVaYCMXJPEkczWBViQ',quoteAta='AJz1iHZ8xLowuyyaoFqqna8RjjKYZG7HEA2M9q1sWKur',tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
 for(const variant of ['flat','no-creator','canonical','canonical-tier','canonical-virtual','canonical-zero-reserve','wrong-owner','wrong-mint','wrong-discriminator']){
  clock=start;const pumpEnv={LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget(),SOLANA_RPC:'https://fixture.rpc'},pumpPool=pool({base:{address:pumpMint,symbol:'A'},priceQuote:.5,poolConfig:{baseFee:.1,dynamicFee:.1}});let rpcCalls=0,jupCalls=0;
  const fullCanonical=variant.startsWith('canonical-');if(fullCanonical)await pumpEnv.LP_CACHE.put('research:v1:mint:'+pumpMint,JSON.stringify({data:[{id:1,result:{value:{owner:tokenProgram}}}],at:at(start),expiresAt:start+5*MINUTE,status:'available',note:'Fixture mint owner'}),{expirationTtl:300});
  globalThis.fetch=async(input,init)=>{
   if(String(input)==='https://fixture.rpc'){
    rpcCalls++;const request=JSON.parse(init.body);assert.equal(request.method,'getMultipleAccounts');assert.deepEqual(request.params[0],fullCanonical?[pumpAddress,feePda,baseAta,quoteAta,pumpMint]:[pumpAddress,feePda]);
    const bytes=Buffer.alloc(fullCanonical?301:243);Buffer.from([241,154,109,4,17,177,109,188]).copy(bytes);decodeAddress(pumpMint).copy(bytes,43);decodeAddress(SOL).copy(bytes,75);if(variant==='canonical'||fullCanonical)decodeAddress(canonicalCreator).copy(bytes,11);if(variant!=='no-creator')bytes[211]=1;if(variant==='wrong-mint')bytes.fill(0,43,75);if(variant==='wrong-discriminator')bytes[0]=0;
    const fees=Buffer.alloc(fullCanonical?149:65);Buffer.from([143,52,146,187,219,123,76,155]).copy(fees);fees.writeBigUInt64LE(20n,41);fees.writeBigUInt64LE(5n,49);fees.writeBigUInt64LE(5n,57);
    const value=[{owner:variant==='wrong-owner'?'wrong':'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',executable:false,data:[bytes.toString('base64'),'base64']},{owner:'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',executable:false,data:[fees.toString('base64'),'base64']}];
    if(fullCanonical){
     decodeAddress(baseAta).copy(bytes,139);decodeAddress(quoteAta).copy(bytes,171);if(variant==='canonical-virtual')bytes.writeBigUInt64LE(19000000000n,245);
     fees.writeUInt32LE(2,65);fees.writeBigUInt64LE(20n,85);fees.writeBigUInt64LE(5n,93);fees.writeBigUInt64LE(5n,101);fees.writeBigUInt64LE(10000000000n,109);fees.writeBigUInt64LE(35n,125);fees.writeBigUInt64LE(10n,133);fees.writeBigUInt64LE(5n,141);
     const base=Buffer.alloc(165),quote=Buffer.alloc(165),mint=Buffer.alloc(82);decodeAddress(pumpMint).copy(base);decodeAddress(SOL).copy(quote);decodeAddress(pumpAddress).copy(base,32);decodeAddress(pumpAddress).copy(quote,32);base[108]=quote[108]=1;base.writeBigUInt64LE(variant==='canonical-zero-reserve'?0n:1000000000n,64);quote.writeBigUInt64LE(1000000000n,64);mint.writeBigUInt64LE(1000000000n,36);mint[44]=6;mint[45]=1;
     value[0].data[0]=bytes.toString('base64');value[1].data[0]=fees.toString('base64');for(const v of [base,quote,mint])value.push({owner:tokenProgram,executable:false,data:[v.toString('base64'),'base64']});
    }
    return json({result:{value}});
   }
   jupCalls++;const u=new URL(String(input)),buy=u.searchParams.get('inputMint')===SOL,amount=u.searchParams.get('amount'),size=buy?Number(amount)/1e9:Number(amount)/2e6,dlmm=u.searchParams.has('dexes');
   const outAmount=buy?String(size*2e6):String(Math.round(size*(dlmm?.994:1.001)*1e9));return json({inputMint:buy?SOL:pumpMint,outputMint:buy?pumpMint:SOL,inAmount:amount,outAmount,routePlan:[{percent:100,swapInfo:{ammKey:dlmm?'pool':pumpAddress,label:dlmm?'Meteora DLMM':'Pump.fun Amm',inputMint:buy?SOL:pumpMint,outputMint:buy?pumpMint:SOL,inAmount:amount,outAmount}}]});
  };
  const context=researchReadContext(pumpEnv);context.maxRequests=9;const quotes=await readResearchQuotes(pumpPool,context,6,{priceSol:.5,asOf:at(clock),source:'active-bin'}),actual=['flat','no-creator','canonical-tier','canonical-virtual'].includes(variant);assert.equal(rpcCalls,1,'both sizes deduplicate the single Pump RPC batch');assert.equal(jupCalls,8);assert.equal(context.requests,9,'canonical fee evidence fits the final single HTTP budget slot');
  for(const q of quotes.filter(q=>q.mode==='best')){const feeFraction=variant==='no-creator'?.0025:variant==='canonical-virtual'?.005:actual?.003:.005;assert.equal(q.exitFeeSource,actual?'pump-config':'assumed');const expectedFloor=actual?Math.max(q.sizeSol*feeFraction,q.sizeSol*1.001*feeFraction/(1-feeFraction)+3e-9):q.sizeSol*feeFraction;assert.ok(Math.abs(q.exitFeeFloorSol-expectedFloor)<1e-12,'actual Pump fee gross-up covers favourable alternate venue pricing');assert.equal(q.roundTripCostSol,0,'actual quote-net round-trip never uses selected DLMM fee config');assert.match(q.note,actual?/verified PumpSwap/:/assumed 0\.5%/);assert.equal(q.economicEstimate.exitFeeAsOf,actual?at(start):null);}
  if(variant==='flat'){
   for(const name of [...pumpEnv.LP_CACHE.values.keys()])if(name.includes('quote-estimate:v3:'))pumpEnv.LP_CACHE.values.delete(name);
   clock+=1000;const rebuilt=await readResearchQuotes(pumpPool,researchReadContext(pumpEnv),6,{priceSol:.5,asOf:at(clock),source:'active-bin'});assert.equal(jupCalls,8);assert.equal(rpcCalls,1);assert.ok(rebuilt.filter(q=>q.mode==='best').every(q=>q.exitFeeSource==='pump-config'&&q.economicEstimate.exitFeeAsOf===at(start)),'fresh raw composite cache still uses original dated Pump config');
  }
 }

 // Repeated429 honors the provider reset and grows across cooldowns. No automatic retries.
 clock=start;const b1=researchBackoff(null,new Headers(),clock),b2=researchBackoff(b1,new Headers(),clock+MINUTE),b3=researchBackoff(b2,new Headers({'retry-after':'180','x-ratelimit-reset':String((clock+300000)/1000)}),clock);assert.equal(b1.until-clock,30000);assert.equal(b2.until-(clock+MINUTE),60000);assert.equal(b3.until-clock,300000);assert.equal(researchBackoff(b3,new Headers({'retry-after':at(clock+400000)}),clock).until-clock,400000);
 const rateEnv={LP_CACHE:new KV(),JUPITER_API_KEY:'fixture-key',RANGE_ALERTS:sharedBudget()};let rateCalls=0;globalThis.fetch=async()=>{rateCalls++;return new Response('',{status:429});};
 await readResearchQuotes(p,researchReadContext(rateEnv),6);const initialRateCalls=rateCalls;assert.ok(initialRateCalls<=4);const savedBackoff=()=>JSON.parse(rateEnv.LP_CACHE.values.get('research:v1:backoff:Jupiter').value);
 assert.equal(savedBackoff().attempts,1);await readResearchQuotes(p,researchReadContext(rateEnv),6);assert.equal(rateCalls,initialRateCalls);
 clock=start+MINUTE+1;await readResearchQuotes(p,researchReadContext(rateEnv),6);assert.equal(savedBackoff().attempts,2);assert.equal(savedBackoff().until-clock,MINUTE);
 const secondRateCalls=rateCalls;clock+=30000;await readResearchQuotes(p,researchReadContext(rateEnv),6);assert.equal(rateCalls,secondRateCalls);
 clock+=30001;await readResearchQuotes(p,researchReadContext(rateEnv),6);assert.equal(savedBackoff().attempts,3);assert.equal(savedBackoff().until-clock,2*MINUTE);
 console.log('Provider caches: native Meteora fallback, quote-time active marks, split/raw sell-fee floors, ten-minute quote refresh, sixty-minute last-good retention, old-cost invalidation, shared budget gate,45-second execution separation and exponential429 backoff passed.');
}finally{globalThis.fetch=originalFetch;globalThis.Date=RealDate;}
