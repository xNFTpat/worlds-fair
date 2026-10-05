import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const dir=await mkdtemp(join(tmpdir(),'lp-research-'));
for(const [name,file] of [['research','src/lp-research.ts'],['reads','src/sources/research-reads.ts'],['meteora','src/sources/meteora.ts'],['paper','src/research-paper.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {researchFeeRates,researchNet,researchTransferTax,researchTrend,researchStructure,researchCatalogue,researchPool,recordResearchObservation,RESEARCH_HISTORY_LIMITS}=await import(pathToFileURL(join(dir,'research.mjs')));
const {researchReadContext,researchQuoteFresh,cachedResearchQuotes,readResearchQuotes,readMintSafety,readResearchRangeAnchor,readRugSafety,readDexScreenerBatch,readResearchCandles,RESEARCH_SOL:SOL,RESEARCH_LB_PAIR_LAYOUT,RESEARCH_READ_LIMITS}=await import(pathToFileURL(join(dir,'reads.mjs')));
const {fetchMeteora}=await import(pathToFileURL(join(dir,'meteora.mjs')));
const {runResearchReplay,starterResearchBots}=await import(pathToFileURL(join(dir,'paper.mjs')));
const HOUR=3600000,MINUTE=60000,now=Date.now(),at=t=>new Date(t).toISOString();
const pool=(extra={})=>({id:'solana:pool',address:'pool',chain:'solana',venue:'meteora-dlmm',pair:'A/SOL',base:{address:'mint',symbol:'A'},quote:{address:SOL,symbol:'SOL'},tvlUsd:100000,volume24hUsd:1000000,fees24hUsd:10000,feeTier:.003,feeApr:36.5,priceUsd:100,priceQuote:1,quotePriceUsd:100,change24h:null,ageHours:48,tags:[],url:'https://app.meteora.ag/dlmm/pool',fetchedAt:at(now),feeTvl:{h1:.001,mid:.008,midHours:4,h24:.1},txns24h:null,activity:{fees30m:50,fees1h:100,fees4h:800,fees12h:600,volume1h:10000,volume4h:40000,volume12h:120000},poolConfig:{concentrated:true,feeSchedulerActive:false,compoundingFeePct:0,launchpad:null,binStep:20,baseFee:.003,dynamicFee:.001},...extra});
class KV {
 values=new Map();gets=0;puts=0;
 async get(k,type){this.gets++;const value=this.values.get(k);return value==null?null:type==='json'?JSON.parse(value):value;}
 async put(k,value,options){assert.ok(k.length<=512,'cache keys must fit Cloudflare KV limits');assert.ok(!options||options.expirationTtl>=60,'KV expiration minimum');this.puts++;this.values.set(k,value);}
}
const env=(key=false)=>({LP_CACHE:new KV(),RANGE_ALERTS:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(JSON.stringify({allowed:true,reason:'allowed',retryAt:null}),{headers:{'content-type':'application/json'}})})},SOLANA_RPC:'https://rpc.example/read',MIN_TVL_USD:'0',ROBINHOOD_RPC:'',ROBINHOOD_CHAIN_ID:'',WALLETS:'',...(key?{JUPITER_API_KEY:'secret-fixture-key'}:{})});
const originalFetch=globalThis.fetch,originalNow=Date.now;
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

// Real SDK-encoded LbPair fixtures prove the Worker prefix agrees with the
// installed IDL, rather than repeating a hand-written binary layout in tests.
const require=createRequire(import.meta.url),sdk=require('../execution/node_modules/@meteora-ag/dlmm');
const {BorshAccountsCoder,BN,web3}=require('../execution/node_modules/@meteora-ag/dlmm/node_modules/@coral-xyz/anchor');
const coder=new BorshAccountsCoder(sdk.IDL),zeroKey=new web3.PublicKey(new Uint8Array(32));
const idlSize=type=>typeof type==='string'?({u8:1,i8:1,bool:1,u16:2,i16:2,u32:4,i32:4,u64:8,i64:8,u128:16,i128:16,pubkey:32}[type]):type.array?idlSize(type.array[0])*type.array[1]:sdk.IDL.types.find(t=>t.name===type.defined.name).type.fields.reduce((sum,f)=>sum+idlSize(f.type),0);
let offset=8;const offsets={};for(const field of sdk.IDL.types.find(t=>t.name==='LbPair').type.fields){offsets[field.name]=offset;offset+=idlSize(field.type);}
let parameterOffset=offsets.parameters;const parameterOffsets={};for(const field of sdk.IDL.types.find(t=>t.name==='StaticParameters').type.fields){parameterOffsets[field.name]=parameterOffset;parameterOffset+=idlSize(field.type);}
assert.equal(RESEARCH_LB_PAIR_LAYOUT.owner,sdk.LBCLMM_PROGRAM_IDS['mainnet-beta']);assert.equal(RESEARCH_LB_PAIR_LAYOUT.bytes,coder.size('LbPair'));assert.equal(offset,coder.size('LbPair'));
assert.deepEqual(RESEARCH_LB_PAIR_LAYOUT.discriminator,sdk.IDL.accounts.find(a=>a.name==='LbPair').discriminator);
for(const [field,expected] of [['minBin',parameterOffsets.min_bin_id],['maxBin',parameterOffsets.max_bin_id],['activeId',offsets.active_id],['binStep',offsets.bin_step],['mintX',offsets.token_x_mint],['mintY',offsets.token_y_mint]])assert.equal(RESEARCH_LB_PAIR_LAYOUT[field],expected);
const zeroValue=type=>typeof type==='string'?type==='pubkey'?zeroKey:type==='bool'?false:/^(u|i)(64|128)$/.test(type)?new BN(0):0:type.array?Array.from({length:type.array[1]},()=>zeroValue(type.array[0])):Object.fromEntries(sdk.IDL.types.find(t=>t.name===type.defined.name).type.fields.map(f=>[f.name,zeroValue(f.type)]));
const nativePoolKey=new web3.PublicKey(new Uint8Array(32).fill(3)).toBase58(),pairedMint=new web3.PublicKey(new Uint8Array(32).fill(7)).toBase58();
const anchorPool=solX=>pool({address:nativePoolKey,id:'solana:'+nativePoolKey,base:{address:solX?SOL:pairedMint,symbol:solX?'SOL':'A'},quote:{address:solX?pairedMint:SOL,symbol:solX?'A':'SOL'}});
const anchorMint=()=>({...mint,mint:pairedMint,tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',asOf:at(Date.now())});
async function pairBinary(solX=false,extra={}){
 const value=zeroValue({defined:{name:'LbPair'}});value.parameters.min_bin_id=-443636;value.parameters.max_bin_id=443636;value.active_id=-695;value.bin_step=20;value.token_x_mint=new web3.PublicKey(solX?SOL:pairedMint);value.token_y_mint=new web3.PublicKey(solX?pairedMint:SOL);Object.assign(value,extra);
 return await coder.encode('LbPair',value);
}
const anchorRpc=(bytes,extra={})=>({jsonrpc:'2.0',id:5,result:{context:{slot:246810},value:{owner:RESEARCH_LB_PAIR_LAYOUT.owner,executable:false,data:[bytes.toString('base64'),'base64'],...extra}}});

const fees=researchFeeRates(pool());
assert.equal(fees.h1,.001);assert.equal(fees.h4,.002);assert.equal(fees.h12,.0005,'12h is divided by twelve, not inferred from four-hour windows');
assert.equal(researchFeeRates(pool({activity:{...pool().activity,fees12h:null}})).h12,null);
assert.equal(researchFeeRates(pool({ageHours:3})).h4,null,'partial young-pool windows are not called complete hourly rates');
assert.equal(researchFeeRates(pool({activity:{...pool().activity,fees1h:0}})).h1,0,'observed zero fees are measured zero');

const mint={status:'available',asOf:at(now),decimals:6,transferFeeStatus:'known',transferFee:{epoch:9,bps:100,maximumRaw:'2000',maximumTokens:.002,configAuthority:null,withdrawAuthority:null}};
const quote={sizeSol:1,mode:'best',status:'quoted',roundTripCostSol:.01,exitCostSol:.006,asOf:at(now),tokenRaw:'1000000'};
assert.equal(researchTransferTax('1000000',mint.transferFee,6,1),.002,'fee caps apply in raw token units before conversion to SOL');
assert.equal(researchTransferTax('1',{...mint.transferFee,bps:1,maximumRaw:'99'},6,1),.000001,'transfer fee rounding is upward in raw units');
const net=researchNet(fees,[quote],1,'best',4,mint,1);
assert.ok(Math.abs(net.totalCostSol-.0121)<1e-12);assert.ok(Math.abs(net.netFraction-(-.0041))<1e-12);
assert.ok(Math.abs(net.roundTripRecoveryHours-6.05)<1e-12);assert.ok(Math.abs(net.exitRecoveryHours-4.025)<1e-12);
assert.equal(net.hourlyFeeRate,.002,'default reference uses measured four-hour fee density');
assert.equal(net.feeWindowHours,4);
const net1=researchNet(fees,[quote],1,'best',1,mint,1,.0001,1),net12=researchNet(fees,[quote],1,'best',12,mint,1,.0001,12);
assert.ok(Math.abs(net1.netFraction-(fees.h1-.0121))<1e-12);assert.ok(Math.abs(net12.netFraction-(fees.h12*12-.0121))<1e-12);
assert.equal(net1.feeWindowHours,1);assert.equal(net12.feeWindowHours,12);assert.match(net12.note,/12h fee density/);
assert.equal(researchNet({...fees,h12:null},[quote],1,'best',12,mint,1,.0001,12).netFraction,null,'missing 12h fees are not substituted from another window');
assert.equal(researchNet(fees,[quote],1,'best',4,{...mint,transferFeeStatus:'unknown'},1).netFraction,null,'unknown tax policy invalidates complete net');
assert.equal(researchNet(fees,[quote],1,'best',4,mint,null).netFraction,null,'unknown market price is not a zero withdrawal cost');
assert.equal(researchNet(fees,[quote],1,'best',4,{...mint,asOf:at(now+2*MINUTE)},1).netFraction,null,'future mint observations cannot establish a current fee policy');
assert.ok(Math.abs(researchNet(fees,[quote],1,'best',4,{...mint,transferFeeStatus:'none'},1).totalCostSol-.0101)<1e-12);
assert.equal(researchNet(fees,[],1,'best',4,mint,1).status,'unknown');
assert.equal(researchNet(fees,[{...quote,roundTripCostSol:-.1}],1,'best',4,{...mint,transferFeeStatus:'none'},1).totalCostSol,.0001,'favourable quote differences are not fake arbitrage profits');
assert.equal(researchNet({...fees,asOf:at(now-11*MINUTE)},[quote],1,'best',4,mint,1).netFraction,null,'stale fee density cannot create current net estimates');

const end=Math.floor(now/HOUR)*3600;
const candles=Array.from({length:48},(_,i)=>({t:end-(48-i)*3600,o:2,h:3+i/100,l:1,c:2,v:100}));
const complete=researchStructure({status:'available',asOf:at(now),candles,note:'Fixture',unit:'SOL per token'},now);
assert.ok(complete.windows.every(w=>w.complete));assert.equal(complete.hourlyHighTrend,'rising');
const gap=researchStructure({status:'available',asOf:at(now),candles:candles.filter((_,i)=>i!==30),note:'Fixture',unit:'SOL per token'},now);
assert.equal(gap.windows.find(w=>w.hours===4).complete,true);assert.equal(gap.windows.find(w=>w.hours===24).complete,false);assert.equal(gap.windows.find(w=>w.hours===48).complete,false);
const staleStructure=researchStructure({status:'stale',asOf:at(now-HOUR),candles,note:'Saved',unit:'SOL per token'},now);
assert.ok(staleStructure.windows.every(w=>!w.complete));
const partial=researchStructure({status:'available',asOf:at(now),candles:[...candles,{t:end,o:2,h:99,l:.01,c:2,v:10}],note:'Fixture',unit:'SOL per token'},now);
assert.equal(partial.windows[0].high,complete.windows[0].high,'current incomplete hour is excluded');

// The RPC anchor is exact native-bin evidence; the displayed human price is an
// ideal grid price, independent of the feed mark and any execution quote.
const binaryY=await pairBinary(),anchorEnv=env();let anchorCalls=0;
globalThis.fetch=async(input,init)=>{anchorCalls++;assert.equal(String(input),anchorEnv.SOLANA_RPC);const body=JSON.parse(init.body);assert.equal(body.method,'getAccountInfo');assert.deepEqual(body.params,[nativePoolKey,{encoding:'base64',commitment:'confirmed'}]);return json(anchorRpc(binaryY));};
const anchorContext=researchReadContext(anchorEnv),nativeAnchor=await readResearchRangeAnchor(anchorPool(false),anchorContext,anchorMint());
assert.equal(nativeAnchor.status,'available');assert.equal(nativeAnchor.activeBinId,-695);assert.equal(nativeAnchor.binStep,20);assert.equal(nativeAnchor.slot,246810);assert.equal(nativeAnchor.minNativeBinId,-443636);assert.equal(nativeAnchor.maxNativeBinId,443636);assert.ok(Date.parse(nativeAnchor.asOf)<=Date.now());
const sdkNative=Number(sdk.getPriceOfBinByBinId(-695,20).toString()),expectedY=sdkNative*10**(6-9);
assert.ok(Math.abs(nativeAnchor.activeBinPriceSol/expectedY-1)<1e-12);assert.notEqual(nativeAnchor.activeBinPriceSol,anchorPool(false).priceQuote,'source mark is not substituted for the observed bin grid');
const cachedContext=researchReadContext(anchorEnv),cachedAnchor=await readResearchRangeAnchor(anchorPool(false),cachedContext,anchorMint());assert.equal(anchorCalls,1);assert.equal(anchorContext.requests,1);assert.equal(cachedContext.requests,0);assert.equal(cachedAnchor.asOf,nativeAnchor.asOf);assert.equal(cachedContext.cacheHits,1);
const binaryX=await pairBinary(true);globalThis.fetch=async()=>json(anchorRpc(binaryX));
const solXAnchor=await readResearchRangeAnchor(anchorPool(true),researchReadContext(env()),anchorMint());assert.equal(solXAnchor.activeBinId,-695,'SOL-X inversion preserves canonical native IDs');assert.ok(Math.abs(solXAnchor.activeBinPriceSol/(1/(sdkNative*10**(9-6)))-1)<1e-12);
globalThis.fetch=async()=>json(anchorRpc(await pairBinary(false,{active_id:0})));
assert.ok(Math.abs((await readResearchRangeAnchor(anchorPool(false),researchReadContext(env()),anchorMint())).activeBinPriceSol-.001)<1e-15,'zero active ID is valid and decimal scales still apply');
globalThis.fetch=async()=>json(anchorRpc(await pairBinary(false,{active_id:125})));
assert.equal((await readResearchRangeAnchor(anchorPool(false),researchReadContext(env()),anchorMint())).activeBinId,125,'positive active ID is valid');

const invalidBinary=Buffer.from(binaryY);invalidBinary[0]^=1;
const invalidResponses=[anchorRpc(binaryY,{owner:'wrong-program'}),anchorRpc(binaryY,{executable:true}),anchorRpc(invalidBinary),anchorRpc(binaryY.subarray(0,151)),anchorRpc(binaryY,{data:['not-base64','base64']}),anchorRpc(await pairBinary(true)),anchorRpc(await pairBinary(false,{bin_step:21})),anchorRpc(await pairBinary(false,{bin_step:0})),anchorRpc(await pairBinary(false,{active_id:443637})),anchorRpc(await pairBinary(false,{active_id:2147483647})),{error:{code:-32000,message:'Fixture'},result:null},{result:{context:{slot:null},value:null}}];
for(const response of invalidResponses){globalThis.fetch=async()=>json(response);const result=await readResearchRangeAnchor(anchorPool(false),researchReadContext(env()),anchorMint());assert.notEqual(result.status,'available');assert.equal(result.activeBinId,null);assert.equal(result.activeBinPriceSol,null);}
globalThis.fetch=async()=>json(anchorRpc(binaryY));
for(const extra of [{mint:'another-mint'},{status:'stale'},{asOf:at(Date.now()-5*MINUTE-1)},{asOf:at(Date.now()+MINUTE)},{decimals:null},{decimals:-1},{decimals:6.5},{tokenProgram:'unrecognised'}]){const result=await readResearchRangeAnchor(anchorPool(false),researchReadContext(env()),{...anchorMint(),...extra});assert.equal(result.status,'unknown');assert.equal(result.activeBinId,null);}
const datedEnv=env(),anchorAt=Date.parse(nativeAnchor.asOf);datedEnv.LP_CACHE.values.set('research:v1:active-bin:'+nativePoolKey,anchorEnv.LP_CACHE.values.get('research:v1:active-bin:'+nativePoolKey));
Date.now=()=>anchorAt+RESEARCH_READ_LIMITS.anchorTtlMs+1;globalThis.fetch=async()=>new Response('',{status:503});
const expiredAnchor=await readResearchRangeAnchor(anchorPool(false),researchReadContext(datedEnv),anchorMint());assert.equal(expiredAnchor.status,'unavailable');assert.equal(expiredAnchor.asOf,nativeAnchor.asOf,'failure does not attach a fresh timestamp to old binary data');assert.equal(expiredAnchor.activeBinId,null);
Date.now=()=>anchorAt;const savedFuture=JSON.parse(anchorEnv.LP_CACHE.values.get('research:v1:active-bin:'+nativePoolKey));savedFuture.at=at(anchorAt+MINUTE);datedEnv.LP_CACHE.values.set('research:v1:active-bin:'+nativePoolKey,JSON.stringify(savedFuture));
assert.equal((await readResearchRangeAnchor(anchorPool(false),researchReadContext(datedEnv),anchorMint())).status,'stale','future cached evidence cannot make a verified anchor');Date.now=originalNow;
let blockedReads=0;globalThis.fetch=async()=>{blockedReads++;return json(anchorRpc(binaryY));};const noBudget=researchReadContext(env());noBudget.maxRequests=0;
assert.equal((await readResearchRangeAnchor(anchorPool(false),noBudget,anchorMint())).status,'unknown');assert.equal((await readResearchRangeAnchor(anchorPool(false),researchReadContext({...env(),SOLANA_RPC:''}),anchorMint())).status,'unknown');assert.equal(blockedReads,0,'anchor reads never bypass the shared request budget or configured RPC');
const anchorRateEnv=env();globalThis.fetch=async()=>{blockedReads++;return new Response('',{status:429,headers:{'retry-after':'120'}});};
assert.equal((await readResearchRangeAnchor(anchorPool(false),researchReadContext(anchorRateEnv),anchorMint())).status,'rate-limited');const beforeAnchorBackoff=blockedReads;
assert.equal((await readMintSafety(pairedMint,researchReadContext(anchorRateEnv))).status,'rate-limited');assert.equal(blockedReads,beforeAnchorBackoff,'anchor429 shares RPC cooldown with mint research');

// Genuine dated source records; disappearing from one catalogue sample does not erase history.
const histEnv=env(),start=now-4*HOUR;
Date.now=()=>start;
await recordResearchObservation({updatedAt:at(start),pools:[pool({fetchedAt:at(start),activity:{...pool().activity,volume4h:10000},tvlUsd:100000,ageHours:44})],errors:{}},histEnv);
Date.now=()=>start+5*MINUTE;
await recordResearchObservation({updatedAt:at(Date.now()),pools:[pool({fetchedAt:at(Date.now())})],errors:{}},histEnv);
assert.equal(JSON.parse(histEnv.LP_CACHE.values.get('research:v1:history')).pools['solana:pool'].length,1,'samples closer than ten minutes do not inflate history');
Date.now=()=>start+HOUR;
await recordResearchObservation({updatedAt:at(Date.now()),pools:[],errors:{}},histEnv);
assert.equal(JSON.parse(histEnv.LP_CACHE.values.get('research:v1:history')).pools['solana:pool'].length,1);
Date.now=()=>now;
await recordResearchObservation({updatedAt:at(now),pools:[pool({tvlUsd:90000,activity:{...pool().activity,volume4h:30000}})],errors:{}},histEnv);
const points=JSON.parse(histEnv.LP_CACHE.values.get('research:v1:history')).pools['solana:pool'];
const trend=researchTrend(pool({tvlUsd:90000,activity:{...pool().activity,volume4h:30000}}),points,now);
assert.equal(trend.previous4h,10000);assert.equal(trend.ratio,3);assert.ok(Math.abs(trend.tvlChange4h+.1)<1e-12);assert.equal(trend.previous4hAsOf,at(start));
assert.equal(researchTrend(pool(),[[start+MINUTE,1,100000,100,10000,1000,44]],now).previous4h,null,'overlapping future window is not substituted for preceding four hours');
assert.equal(researchTrend(pool(),[],now).historyStatus,'warming');
assert.equal(researchTrend(pool(),[[start,1,100000,100,0,1000,44]],now).ratio,null,'zero baseline is not infinite acceleration');
const bounded=Array.from({length:850},(_,i)=>pool({id:'solana:p'+i,address:'p'+i,base:{address:'m'+i,symbol:'A'},tvlUsd:20000+i,activity:{...pool().activity,volume4h:i*100,fees1h:i}}));
await recordResearchObservation({updatedAt:at(now+MINUTE),pools:bounded,errors:{}},histEnv);
assert.ok(Object.keys(JSON.parse(histEnv.LP_CACHE.values.get('research:v1:history')).pools).length<=RESEARCH_HISTORY_LIMITS.maxPools);
// Authority flags are dated at their cached RPC read, never borrowed from the
// future, another mint, or a stale provider response. Writer work stays two KV reads.
globalThis.fetch=()=>{throw Error('History writer attempted a provider request');};
const authorityEnv=env(),authorityStart=now-HOUR;
const evidence=[null,{offset:MINUTE},{offset:-5*MINUTE-1},{offset:-5*MINUTE},{offset:0,mint:'other-mint'},{offset:0,status:'stale'},{offset:0}];
for(let i=0;i<evidence.length;i++){
 const pointAt=authorityStart+i*10*MINUTE,fixture=evidence[i];Date.now=()=>pointAt;
 if(fixture)authorityEnv.LP_CACHE.values.set('research:v1:enriched-index',JSON.stringify({'solana:pool':{at:at(pointAt),tokenMint:fixture.mint||'mint',safety:{rpc:{status:fixture.status||'available',asOf:at(pointAt+fixture.offset),mintAuthority:null,freezeAuthority:'active-freeze'}}}}));
 const before=authorityEnv.LP_CACHE.gets;await recordResearchObservation({updatedAt:at(pointAt),pools:[pool({fetchedAt:at(pointAt)})],errors:{}},authorityEnv);assert.equal(authorityEnv.LP_CACHE.gets-before,2);
}
const authorityPoints=JSON.parse(authorityEnv.LP_CACHE.values.get('research:v1:history')).pools['solana:pool'];
for(const i of [0,1,2,4,5])assert.deepEqual(authorityPoints[i].slice(7),[null,null,null],'legacy, future, stale and wrong-mint authority evidence stays unknown');
assert.deepEqual(authorityPoints[3].slice(7),[authorityStart+30*MINUTE-5*MINUTE,false,true]);assert.deepEqual(authorityPoints[6].slice(7),[now,false,true]);

// Real ten-minute records must retain more than 24h, otherwise the default
// Overnight strategy would warm forever. Prior rows and safety evidence remain dated.
const warmEnv=env(),warmStart=now-36*HOUR;
for(let i=0;i<=216;i++){
 const pointAt=warmStart+i*10*MINUTE;Date.now=()=>pointAt;
 warmEnv.LP_CACHE.values.set('research:v1:enriched-index',JSON.stringify({'solana:pool':{at:at(pointAt),tokenMint:'mint',safety:{rpc:{status:'available',asOf:at(pointAt),mintAuthority:null,freezeAuthority:null}}}}));
 await recordResearchObservation({updatedAt:at(pointAt),pools:[pool({fetchedAt:at(pointAt),activity:{...pool().activity,volume4h:400000}})],errors:{}},warmEnv);
}
const warmPoints=JSON.parse(warmEnv.LP_CACHE.values.get('research:v1:history')).pools['solana:pool'];assert.equal(warmPoints.length,217);assert.equal(warmPoints.at(-1)[0]-warmPoints[0][0],36*HOUR);
const warmObservations=warmPoints.map(([at,priceSol,tvlUsd,fees1h,volume4h,,,,mintAuthority,freezeAuthority])=>({at,priceSol,tvlUsd,fees1h,volume4h,mintAuthority,freezeAuthority}));
const replayInput={observations:warmObservations,config:starterResearchBots[0],binStep:20,sizeSol:.5,seedSol:2,transferFeeBps:0,costAssumption:{fundingCostFraction:0,exitCostFraction:0,networkSol:0,positionRentSol:0}};
const warmed=runResearchReplay(replayInput);assert.ok(warmed.trades.length>0);assert.equal(Date.parse(warmed.decisions.find(d=>d.action==='entry').at),warmStart+24*HOUR,'the default 24h filter enters only after its real prior history exists');
assert.equal(runResearchReplay({...replayInput,observations:warmObservations.slice(-144)}).trades.length,0,'the former 144-point bound could never warm a 24h strategy');

// Worst-sized numeric tuples exercise the hard KV byte cap as well as counts.
const bytesEnv=env(),wideNumber=1.2345678901234567e300;
const worstRows=Array.from({length:440},(_,i)=>[now-(439-i)*10*MINUTE,wideNumber,wideNumber,wideNumber,wideNumber,wideNumber,wideNumber,now-(439-i)*10*MINUTE,false,true]);
bytesEnv.LP_CACHE.values.set('research:v1:history',JSON.stringify({version:1,at:at(now-MINUTE),pools:Object.fromEntries(Array.from({length:300},(_,i)=>['pool'+i,worstRows]))}));Date.now=()=>now;
const byteResult=await recordResearchObservation({updatedAt:at(now),pools:[],errors:{}},bytesEnv),encoded=bytesEnv.LP_CACHE.values.get('research:v1:history');
assert.ok(Buffer.byteLength(encoded)<=RESEARCH_HISTORY_LIMITS.maxBytes);assert.ok(byteResult.droppedForSize>0,'older nonpriority research histories are discarded to fit the cache');assert.ok(Object.keys(JSON.parse(encoded).pools).length<=RESEARCH_HISTORY_LIMITS.maxPools);
Date.now=originalNow;

// Catalogue enrichment is constant KV work, independent of pool count, and never fetches providers.
globalThis.fetch=()=>{throw Error('Catalogue attempted an external read');};
const catalogEnv=env(),before=catalogEnv.LP_CACHE.gets;
const catalogue=await researchCatalogue({updatedAt:at(now),pools:bounded,errors:{}},catalogEnv,new URLSearchParams({limit:'1000',sort:'net'}));
assert.equal(catalogEnv.LP_CACHE.gets-before,2);assert.equal(catalogue.rows.length,100);assert.equal(catalogue.coverage.quoted,0);assert.ok(catalogue.rows.every(r=>r.net.netFraction===null));
assert.deepEqual(catalogue.pools,catalogue.rows);assert.equal(catalogue.quotesConfigured,true);assert.equal(catalogue.quotaMode,'public');
const filtered=await researchCatalogue({updatedAt:at(now),pools:[pool(),pool({id:'young',address:'young',ageHours:2,tvlUsd:1000})],errors:{}},catalogEnv,new URLSearchParams({minTvl:'5000',minVolume4h:'30000',ageGroup:'established'}));
assert.equal(filtered.rows.length,1);assert.equal(filtered.rows[0].pool.id,'solana:pool');

// Edge adapters: exact identities, epoch-specific capped tax, grouped-owner lower bounds,
// native hourly candles, route scope, raw buy->sell sizing, and caching.
let calls=[];
const providerEnv=env(true),tokenProgram='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
providerEnv.LP_CACHE.values.set('research:v1:history',authorityEnv.LP_CACHE.values.get('research:v1:history'));
const rpcMint=()=>[{id:1,result:{value:{owner:tokenProgram,data:{parsed:{type:'mint',info:{decimals:6,supply:'100000000',mintAuthority:'authority',freezeAuthority:null,extensions:[{extension:'transferFeeConfig',state:{transferFeeConfigAuthority:'fee-authority',withdrawWithheldAuthority:null,olderTransferFee:{epoch:1,transferFeeBasisPoints:200,maximumFee:'1000'},newerTransferFee:{epoch:10,transferFeeBasisPoints:500,maximumFee:'2000'}}},{extension:'permanentDelegate',state:{delegate:'delegate'}}]}}}}}},{id:2,result:{epoch:9}},{id:3,result:{value:[{address:'account1',amount:'30000000'},{address:'account2',amount:'25000000'}]}}];
const nativeRows=candles.map(c=>({timestamp:c.t,open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v}));
globalThis.fetch=async(input,init)=>{
 const url=new URL(String(input));calls.push({url:url.toString(),init});
 if(url.hostname==='rpc.example'){
  const body=JSON.parse(init.body);
  if(Array.isArray(body)){assert.deepEqual(body.map(r=>r.method),['getAccountInfo','getEpochInfo','getTokenLargestAccounts']);return json(rpcMint());}
  assert.equal(body.method,'getMultipleAccounts');assert.deepEqual(body.params[0],['account1','account2']);
  return json({result:{value:body.params[0].map((_,i)=>({data:{parsed:{type:'account',info:{mint:'mint',owner:'same-owner',tokenAmount:{amount:i?'25000000':'30000000'}}}}}))}});
 }
 if(url.hostname==='api.rugcheck.xyz')return json({mint:'mint',score:12,risks:[{name:'Mint authority enabled',level:'warn',description:'Fixture'}]});
 if(url.hostname==='api.dexscreener.com')return json([{chainId:'solana',pairAddress:'other-pool',baseToken:{address:'mint'},quoteToken:{address:SOL},liquidity:{usd:90000}},{chainId:'solana',pairAddress:'pool',baseToken:{address:'mint'},quoteToken:{address:SOL},liquidity:{usd:100000},volume:{h24:500000},priceUsd:'100',url:'https://dexscreener.com/solana/pool'}]);
 if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:nativeRows});
 if(url.hostname==='api.jup.ag'){
  assert.equal(init.headers['x-api-key'],'secret-fixture-key');assert.equal(url.pathname,'/swap/v1/quote');
  const buy=url.searchParams.get('inputMint')===SOL,amount=url.searchParams.get('amount');
  const small=buy?amount==='500000000':amount==='1000000';
  if(!buy)assert.ok(['1000000','2000000'].includes(amount),'sell uses returned raw paired tokens');
  const label=url.searchParams.has('dexes')?'Meteora DLMM':'Other venue';
  if(url.searchParams.has('dexes'))assert.equal(url.searchParams.get('dexes'),'Meteora DLMM');
  return json({inputMint:buy?SOL:'mint',outputMint:buy?'mint':SOL,inAmount:amount,outAmount:buy?small?'1000000':'2000000':small?'490000000':'980000000',priceImpactPct:'0.01',routePlan:[{swapInfo:{ammKey:'other-pool',label}}]});
 }
 throw Error('Unexpected provider '+url.hostname);
};
const detail=await researchPool(pool(),providerEnv);
assert.ok(Number.isFinite(Date.parse(detail.asOf)),'detail exposes a check timestamp separately from source dates');
assert.equal(detail.rangeAnchor.status,'unknown','invalid source pool addresses cannot claim RPC-verified bin alignment');
assert.equal(detail.marketHistory[0].authorityAt,null);assert.equal(detail.marketHistory[0].mintAuthority,null);
assert.equal(detail.marketHistory[3].authorityAt,at(authorityStart+25*MINUTE));assert.equal(detail.marketHistory[3].mintAuthority,false);assert.equal(detail.marketHistory[3].freezeAuthority,true,'detail preserves the historical RPC observation independently of the current read');
assert.equal(detail.safety.rpc.transferFee.bps,200,'older epoch policy is selected before scheduled fee activation');
assert.equal(detail.safety.rpc.transferFee.maximumRaw,'1000');assert.ok(detail.safety.flags.some(f=>f.code==='mint-authority'));assert.ok(detail.safety.flags.some(f=>f.code==='permanent-delegate'));
assert.equal(detail.safety.rpc.concentration.top1Fraction,.3);assert.equal(detail.safety.rpc.concentration.holders.top1Fraction,.55);assert.equal(detail.safety.rpc.concentration.holders.count,1);
assert.match(detail.safety.rpc.concentration.holders.label,/lower bounds/);
assert.equal(detail.safety.dexscreener.poolMatched,true);assert.equal(detail.safety.dexscreener.liquidityUsd,100000);
assert.equal(detail.quotes.length,4);assert.ok(detail.quotes.every(q=>q.status==='quoted'&&q.selectedPoolMatched===false));
assert.ok(detail.quotes.every(q=>!q.economicEstimate),'unverified RPC anchors do not substitute a catalogue price as a quote-time mark');
assert.ok(detail.quotes.some(q=>q.sizeSol===.5&&Math.abs(q.roundTripCostSol-.01)<1e-12));
assert.ok(detail.structure.windows.every(w=>w.complete));assert.equal(detail.readHealth.requests,13);assert.ok(detail.readHealth.requests<=detail.readHealth.maxRequests);
assert.ok(detail.nets.every(n=>n.netFraction!==null));assert.equal(JSON.stringify(detail).includes('secret-fixture-key'),false);
assert.equal(detail.nets.length,12);assert.deepEqual([...new Set(detail.nets.map(n=>n.feeWindowHours))],[1,4,12]);assert.equal(detail.net.feeWindowHours,4);assert.equal(detail.net.sizeSol,1);assert.equal(detail.net.mode,'best');
const callsBeforeCache=calls.length;
const cachedDetail=await researchPool(pool(),providerEnv);assert.equal(calls.length,callsBeforeCache,'second detail reuses provider caches');
assert.equal(cachedDetail.readHealth.requests,0);
const providerFetch=globalThis.fetch,anchoredDetailEnv=env();let detailAnchorRequests=0;
globalThis.fetch=async(input,init)=>{
 const url=new URL(String(input));
 if(url.hostname==='rpc.example'){
  const request=JSON.parse(init.body);
  if(Array.isArray(request))return json([{id:1,result:{value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{type:'mint',info:{decimals:6,supply:'1000',mintAuthority:null,freezeAuthority:null}}}}}},{id:2,result:{epoch:9}},{id:3,result:{value:[]}}]);
  detailAnchorRequests++;assert.equal(request.params[0],nativePoolKey);assert.equal(request.params[1].encoding,'base64');return json(anchorRpc(binaryY));
 }
 if(url.hostname==='api.rugcheck.xyz')return json({mint:pairedMint,score:0,risks:[]});
 if(url.hostname==='api.dexscreener.com')return json([]);
 if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:nativeRows});
 throw Error('Unexpected anchored-detail provider '+url.hostname);
};
const anchoredDetail=await researchPool(anchorPool(false),anchoredDetailEnv);assert.equal(anchoredDetail.rangeAnchor.status,'available');assert.equal(anchoredDetail.rangeAnchor.activeBinId,-695);assert.equal(anchoredDetail.priceSol,1,'verified bin-grid price does not replace the returned catalogue feed mark');assert.equal(anchoredDetail.readHealth.requests,9);assert.equal(detailAnchorRequests,1);assert.ok(anchoredDetail.quotes.every(q=>q.status==='unavailable'));assert.ok(anchoredDetail.nets.every(n=>n.netFraction===null),'an exact range anchor does not fabricate missing conversion costs');
const anchoredDetailCached=await researchPool(anchorPool(false),anchoredDetailEnv);assert.equal(anchoredDetailCached.readHealth.requests,1);assert.equal(detailAnchorRequests,2);assert.equal(anchoredDetailCached.rangeAnchor.status,'available','quote refresh attempts reverify the native mark');globalThis.fetch=providerFetch;
// New quotes use a separately dated verified RPC grid mark, not a catalogue
// price that was already five minutes old. Existing estimates never re-mark
// when a later RPC anchor or catalogue price changes; neither orientation can
// swap SOL/token and native Y/X units.
const markClockStart=Date.now();let markClock=markClockStart;Date.now=()=>markClock;
for(const solX of [false,true]){
 const markEnv=env(true),oldFeed={...anchorPool(solX),fetchedAt:at(markClockStart-5*MINUTE)},oldFeedPrice=solX?1/oldFeed.priceQuote:oldFeed.priceQuote;let markId=-695,markQuoteRequests=0,markAnchorRequests=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.hostname==='rpc.example'){
   const request=JSON.parse(init.body);
   if(Array.isArray(request))return json([{id:1,result:{value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{type:'mint',info:{decimals:6,supply:'1000',mintAuthority:null,freezeAuthority:null}}}}}},{id:2,result:{epoch:9}},{id:3,result:{value:[]}}]);
   markAnchorRequests++;return json(anchorRpc(await pairBinary(solX,{active_id:markId})));
  }
  if(url.hostname==='api.rugcheck.xyz')return json({mint:pairedMint,score:0,risks:[]});
  if(url.hostname==='api.dexscreener.com')return json([]);
  if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:nativeRows});
  assert.equal(url.hostname,'api.jup.ag');markQuoteRequests++;const buy=url.searchParams.get('inputMint')===SOL,amount=url.searchParams.get('amount'),small=buy?amount==='500000000':amount==='1000000';
  return json({inputMint:buy?SOL:pairedMint,outputMint:buy?pairedMint:SOL,inAmount:amount,outAmount:buy?small?'1000000':'2000000':small?'490000000':'980000000',routePlan:[{swapInfo:{ammKey:nativePoolKey,label:url.searchParams.has('dexes')?'Meteora DLMM':'Other venue'}}]});
 };
 markClock=markClockStart;const first=await researchPool(oldFeed,markEnv);
 assert.equal(first.priceSol,oldFeedPrice);assert.equal(first.pool.fetchedAt,oldFeed.fetchedAt);assert.equal(first.feeRates.asOf,oldFeed.fetchedAt,'a fresh quote mark cannot renew observed fees');
 assert.equal(first.rangeAnchor.status,'available');assert.equal(first.rangeAnchor.asOf,at(markClockStart));assert.equal(markQuoteRequests,8);assert.ok(first.readHealth.requests<=15);
 for(const q of first.quotes){assert.equal(q.status,'quoted');assert.equal(q.economicEstimate.markPriceSol,first.rangeAnchor.activeBinPriceSol,'both SOL orientations use verified human SOL/token for new quote costs');assert.equal(q.economicEstimate.markAsOf,first.rangeAnchor.asOf);assert.equal(q.economicEstimate.dataAsOf,first.rangeAnchor.asOf);assert.equal(q.economicEstimate.expiresAt,markClockStart+10*MINUTE);}
 markClock=markClockStart+61000;markId=-650;const second=await researchPool({...oldFeed,priceQuote:2,fetchedAt:at(markClock)},markEnv);
 assert.equal(second.rangeAnchor.activeBinId,markId);assert.notEqual(second.rangeAnchor.activeBinPriceSol,first.rangeAnchor.activeBinPriceSol);assert.equal(markAnchorRequests,2);assert.equal(markQuoteRequests,8,'valid economic cache does not issue another quote request');assert.ok(second.readHealth.requests>=1&&second.readHealth.requests<=15,'anchor refresh stays within the original shared provider budget');
 for(const [i,q] of second.quotes.entries()){assert.equal(q.status,'stale','executable legs still expire after45 seconds');assert.equal(q.economicEstimate.markPriceSol,first.quotes[i].economicEstimate.markPriceSol);assert.equal(q.economicEstimate.markAsOf,first.quotes[i].economicEstimate.markAsOf);assert.equal(q.economicEstimate.expiresAt,first.quotes[i].economicEstimate.expiresAt);}
}
Date.now=originalNow;globalThis.fetch=providerFetch;
const lowerFee=pool({id:'solana:unknown',address:'unknown',base:{address:'unquoted',symbol:'U'},activity:{...pool().activity,fees4h:20000}});
const catalogueQuoted=await researchCatalogue({updatedAt:at(now),pools:[lowerFee,pool()],errors:{}},providerEnv,new URLSearchParams({sort:'net',size:'.5',mode:'dlmm'}));
assert.equal(catalogueQuoted.rows[0].pool.id,'solana:pool','complete quoted reference estimates precede unknown net rows');assert.equal(catalogueQuoted.rows[0].net.sizeSol,.5);assert.equal(catalogueQuoted.rows[0].net.mode,'dlmm');
const noKeyCached=await researchCatalogue({updatedAt:at(now),pools:[pool()],errors:{}},{...providerEnv,JUPITER_API_KEY:undefined},new URLSearchParams());assert.equal(noKeyCached.rows[0].net.status,'estimated','dated cached evidence is valid regardless of optional key');assert.equal(noKeyCached.quotaMode,'public');assert.equal(catalogueQuoted.quotaMode,'keyed');
const hidden=await researchCatalogue({updatedAt:at(now),pools:[pool(),lowerFee],errors:{}},providerEnv,new URLSearchParams({hideFlagged:'true'}));assert.equal(hidden.rows.length,1);assert.equal(hidden.rows[0].pool.id,'solana:unknown','optional flags filter is not an unknown-data veto');
Date.now=()=>now+MINUTE;
const expired=await researchCatalogue({updatedAt:at(now),pools:[pool()],errors:{}},providerEnv,new URLSearchParams());assert.equal(expired.rows[0].net.status,'unknown','no verified active-bin mark means there is no good economic estimate to retain');assert.equal(expired.rows[0].net.quoteFreshness,'unavailable');assert.ok(expired.rows[0].quotes.every(q=>q.status==='stale'),'45s executable status remains expired while dated economic estimate is cached');
Date.now=originalNow;

// A fresh sell cannot renew an older buy. The composite inherits the oldest
// dated leg and the earliest actual cache expiry, including mixed cached legs.
const quoteClockStart=Date.now();let quoteClock=quoteClockStart,quoteRequests=0;Date.now=()=>quoteClock;
const legQuote=(size,mode,buy)=>({inputMint:buy?SOL:'mint',outputMint:buy?'mint':SOL,inAmount:buy?String(Math.round(size*1e9)):size===.5?'1000000':'2000000',outAmount:buy?size===.5?'1000000':'2000000':String(Math.round(size*.98*1e9)),routePlan:[{swapInfo:{ammKey:'pool',label:mode==='dlmm'?'Meteora DLMM':'Other venue'}}]});
const cacheBuys=(target,buyAt)=>{for(const size of [.5,1])for(const mode of ['best','dlmm'])target.LP_CACHE.values.set(`research:v1:quote:mint:${size}:${mode}:buy`,JSON.stringify({data:legQuote(size,mode,true),at:at(buyAt),expiresAt:buyAt+45000,status:'available',note:'Dated cached buy'}));};
const fakeQuoteFetch=(finishAt,expectedKey='secret-fixture-key')=>async(input,init)=>{quoteRequests++;assert.equal(init.headers['x-api-key'],expectedKey??undefined);if(expectedKey===null)assert.equal(Object.hasOwn(init.headers,'x-api-key'),false);const url=new URL(String(input)),buy=url.searchParams.get('inputMint')===SOL,amount=url.searchParams.get('amount'),size=buy?Number(amount)/1e9:amount==='1000000'?.5:1,mode=url.searchParams.has('dexes')?'dlmm':'best';if(finishAt!=null)quoteClock=finishAt;return json(legQuote(size,mode,buy));};
const mixedEnv=env(true),oldBuyAt=quoteClockStart-40000;cacheBuys(mixedEnv,oldBuyAt);globalThis.fetch=fakeQuoteFetch(quoteClockStart+3000);
const dropEconomic=(target)=>{for(const key of target.LP_CACHE.values.keys())if(key.startsWith('research:v1:quote-estimate:'))target.LP_CACHE.values.delete(key);};
const mixedContext=researchReadContext(mixedEnv),mixedQuotes=await readResearchQuotes(pool(),mixedContext,6);assert.equal(quoteRequests,4);assert.equal(mixedContext.requests,4);
for(const q of mixedQuotes){assert.equal(q.status,'quoted');assert.equal(q.buyAsOf,at(oldBuyAt));assert.equal(q.sellAsOf,at(quoteClockStart+3000));assert.equal(q.asOf,at(oldBuyAt));assert.equal(q.expiresAt,quoteClockStart+5000);const saved=JSON.parse(mixedEnv.LP_CACHE.values.get(`research:v1:quote:mint:${q.sizeSol}:${q.mode}`));assert.equal(saved.at,q.asOf);assert.equal(saved.expiresAt,q.expiresAt);assert.equal(saved.data.buyAsOf,q.buyAsOf);assert.equal(saved.data.sellAsOf,q.sellAsOf);}
dropEconomic(mixedEnv); // Exercise executable leaf/composite renewal independently of economic retention.
quoteClock=quoteClockStart+4999;assert.ok((await cachedResearchQuotes(pool(),mixedEnv,6)).every(q=>q.status==='quoted'));
quoteClock=quoteClockStart+5000;assert.ok((await cachedResearchQuotes(pool(),mixedEnv,6)).every(q=>q.status==='stale'&&q.roundTripCostSol===null&&q.exitCostSol===null));
globalThis.fetch=fakeQuoteFetch(null);const renewedContext=researchReadContext(mixedEnv),renewedQuotes=await readResearchQuotes(pool(),renewedContext,6);assert.equal(renewedContext.requests,4,'expired buys refresh while still-current sells are reused');assert.ok(renewedQuotes.every(q=>q.status==='quoted'&&q.asOf===at(quoteClockStart+3000)&&q.expiresAt===quoteClockStart+48000));
dropEconomic(mixedEnv);const callsAfterRenewal=quoteRequests,immediateContext=researchReadContext(mixedEnv);assert.ok((await readResearchQuotes(pool(),immediateContext,6)).every(q=>q.status==='quoted'));assert.equal(immediateContext.requests,0);assert.equal(quoteRequests,callsAfterRenewal,'valid composite cache does no quote network work');

dropEconomic(mixedEnv);
// Legacy and falsely dated composites rebuild from the genuine dated legs,
// without fetching when those leaves still satisfy the budget and freshness.
for(const q of renewedQuotes){const cacheKey=`research:v1:quote:mint:${q.sizeSol}:${q.mode}`,saved=JSON.parse(mixedEnv.LP_CACHE.values.get(cacheKey));delete saved.data.buyAsOf;delete saved.data.sellAsOf;saved.at=at(quoteClock);saved.expiresAt=quoteClock+45000;mixedEnv.LP_CACHE.values.set(cacheKey,JSON.stringify(saved));}
assert.ok((await cachedResearchQuotes(pool(),mixedEnv,6)).every(q=>q.status==='stale'),'missing dated legs cannot be quoted');
const rebuiltContext=researchReadContext(mixedEnv),rebuilt=await readResearchQuotes(pool(),rebuiltContext,6);assert.ok(rebuilt.every(q=>q.status==='quoted'&&q.asOf===at(quoteClockStart+3000)&&q.expiresAt===quoteClockStart+48000));assert.equal(rebuiltContext.requests,0);assert.equal(quoteRequests,callsAfterRenewal);
for(const extra of [{buyAsOf:at(quoteClock+1)},{sellAsOf:'not-a-date'},{asOf:at(quoteClock)},{expiresAt:quoteClock},{expiresAt:quoteClockStart+48001}])assert.equal(researchQuoteFresh({...rebuilt[0],...extra}),false,'future, invalid, renewed-parent and overextended expiry cannot become current');

// The buy may expire while its sell is in flight; no successful parent cache
// is written, and a later bounded retry can refresh the expired buy.
const inFlightEnv=env(true);quoteClock=quoteClockStart;cacheBuys(inFlightEnv,oldBuyAt);globalThis.fetch=fakeQuoteFetch(quoteClockStart+7000);
const inFlight=await readResearchQuotes(pool(),researchReadContext(inFlightEnv),6);assert.ok(inFlight.every(q=>q.status==='stale'&&q.asOf===at(oldBuyAt)&&q.expiresAt===quoteClockStart+5000&&q.roundTripCostSol===null));assert.equal([...inFlightEnv.LP_CACHE.values.keys()].filter(k=>/^research:v1:quote:mint:(0\.5|1):(best|dlmm)$/.test(k)).length,0);
globalThis.fetch=fakeQuoteFetch(null);const recoveredContext=researchReadContext(inFlightEnv);assert.ok((await readResearchQuotes(pool(),recoveredContext,6)).every(q=>q.status==='quoted'));assert.equal(recoveredContext.requests,4);

// The catalogue applies the same evidence guard in its two KV reads. Legacy
// parent-only dates, a future leg and an expired oldest leg invalidate net.
const indexedEnv=env(true),indexedSafety=structuredClone(detail.safety);for(const source of ['rpc','rugcheck','dexscreener'])indexedSafety[source].asOf=at(quoteClockStart);
const putIndex=quotes=>indexedEnv.LP_CACHE.values.set('research:v1:enriched-index',JSON.stringify({'solana:pool':{at:at(quoteClockStart),tokenMint:'mint',quotes,safety:indexedSafety}}));
globalThis.fetch=()=>{throw Error('Catalogue freshness check attempted a provider read');};quoteClock=quoteClockStart+4999;putIndex(mixedQuotes);
const indexBefore=indexedEnv.LP_CACHE.gets,indexCurrent=await researchCatalogue({updatedAt:at(quoteClock),pools:[pool({fetchedAt:at(quoteClock)})],errors:{}},indexedEnv,new URLSearchParams());assert.equal(indexedEnv.LP_CACHE.gets-indexBefore,2);assert.equal(indexCurrent.rows[0].net.status,'estimated');
quoteClock=quoteClockStart+5000;const datedIndex=await researchCatalogue({updatedAt:at(quoteClock),pools:[pool({fetchedAt:at(quoteClock)})],errors:{}},indexedEnv,new URLSearchParams());assert.equal(datedIndex.rows[0].net.status,'estimated');assert.equal(datedIndex.rows[0].net.quoteFreshness,'cached-estimate');
for(const mutate of [q=>{delete q.buyAsOf;delete q.sellAsOf;delete q.expiresAt;return q;},q=>({...q,buyAsOf:at(quoteClock+1)})]){putIndex(rebuilt.map(q=>mutate({...q})));const invalidIndex=await researchCatalogue({updatedAt:at(quoteClock),pools:[pool({fetchedAt:at(quoteClock)})],errors:{}},indexedEnv,new URLSearchParams());assert.ok(invalidIndex.rows[0].quotes.every(q=>q.status==='stale'&&q.roundTripCostSol===null));assert.equal(invalidIndex.rows[0].net.status,'unknown');}

// Keyless reads perform the same four bounded buy/sell checks. Adding a key
// preserves dated caches instead of renewing evidence or requiring new reads.
const configuredLater=env();let keyRequests=quoteRequests;globalThis.fetch=fakeQuoteFetch(null,null);const withoutKey=await readResearchQuotes(pool(),researchReadContext(configuredLater),6);assert.ok(withoutKey.every(q=>q.status==='quoted'));assert.equal(quoteRequests-keyRequests,8);
configuredLater.JUPITER_API_KEY='secret-fixture-key';const newlyConfiguredContext=researchReadContext(configuredLater),newlyConfigured=await readResearchQuotes(pool(),newlyConfiguredContext,6);assert.ok(newlyConfigured.every(q=>q.status==='quoted'));assert.equal(newlyConfiguredContext.requests,0);assert.equal(quoteRequests-keyRequests,8);keyRequests=quoteRequests;
const newlyCachedContext=researchReadContext(configuredLater);assert.ok((await readResearchQuotes(pool(),newlyCachedContext,6)).every(q=>q.status==='quoted'));assert.equal(newlyCachedContext.requests,0);assert.equal(quoteRequests,keyRequests);Date.now=originalNow;

// SOL-first orientation inverts high and low, and incomplete native reads fall back
// only to independently identity-verified hourly candles.
const reverse=pool({id:'solana:reverse',address:'reverse',base:{address:SOL,symbol:'SOL'},quote:{address:'reverse-mint',symbol:'R'},priceQuote:4,priceUsd:100,quotePriceUsd:25});
globalThis.fetch=async input=>{const url=new URL(String(input));if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:nativeRows});throw Error('Native complete coverage should not fetch Gecko');};
const reverseCandles=await readResearchCandles(reverse,researchReadContext(env()));assert.equal(reverseCandles.candles[0].h,1);assert.equal(reverseCandles.candles[0].l,1/candles[0].h);assert.equal(reverseCandles.candles[0].o,.5);
globalThis.fetch=async input=>{const url=new URL(String(input));if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:[]});return json({meta:{base:{address:'mint'},quote:{address:SOL}},data:{attributes:{ohlcv_list:candles.map(c=>[c.t,c.o,c.h,c.l,c.c,c.v])}}});};
const fallback=await readResearchCandles(pool(),researchReadContext(env()));assert.equal(fallback.candles.length,48);assert.match(fallback.note,/GeckoTerminal/);
globalThis.fetch=async input=>{const url=new URL(String(input));if(url.hostname==='dlmm.datapi.meteora.ag')return json({data:[]});return json({meta:{base:{address:'impostor'},quote:{address:SOL}},data:{attributes:{ohlcv_list:candles.map(c=>[c.t,c.o,c.h,c.l,c.c,c.v])}}});};
const badIdentity=await readResearchCandles(pool(),researchReadContext(env()));assert.equal(badIdentity.status,'unavailable');assert.equal(badIdentity.candles.length,0);

// Batched DexScreener reads never substitute another pool, are capped at thirty
// distinct tokens, and keep hashed KV keys shorter than the platform limit.
let batchCalls=0;
globalThis.fetch=async input=>{const url=new URL(String(input));batchCalls++;assert.equal(url.pathname.split('/').at(-1).split(',').length,30);return json([]);};
const batchPools=Array.from({length:31},(_,i)=>pool({id:'s:'+i,address:'batch'+i,base:{address:'batch-mint-'+i,symbol:'B'}}));
const batches=await readDexScreenerBatch(batchPools,researchReadContext(env()));assert.equal(batchCalls,1);assert.equal(batches.get('s:0').status,'unavailable');assert.equal(batches.get('s:30').status,'unknown');
globalThis.fetch=async()=>json({mint:'some-other-mint',score:0,risks:[]});assert.equal((await readRugSafety('mint',researchReadContext(env()))).status,'unavailable');

// Retained costs survive a failed/late refresh without renewing their source date.
quoteClock=quoteClockStart+20*MINUTE;Date.now=()=>quoteClock;putIndex(rebuilt);
const retainedIndex=await researchCatalogue({updatedAt:at(quoteClock),pools:[pool({fetchedAt:at(quoteClock)})],errors:{}},indexedEnv,new URLSearchParams());
assert.equal(retainedIndex.rows[0].net.status,'estimated');assert.equal(retainedIndex.rows[0].net.quoteFreshness,'cached-estimate');assert.equal(retainedIndex.rows[0].quotes[0].economicEstimate.asOf,rebuilt[0].economicEstimate.asOf,'retained economics keep their original quote time');assert.equal(retainedIndex.rows[0].safety.rpc.status,'stale','retained costs do not renew safety');
quoteClock=quoteClockStart+61*MINUTE;const tooOldIndex=await researchCatalogue({updatedAt:at(quoteClock),pools:[pool({fetchedAt:at(quoteClock)})],errors:{}},indexedEnv,new URLSearchParams());assert.equal(tooOldIndex.rows[0].net.status,'unknown');Date.now=originalNow;

// Keyless/API-key rate limits and request bounds leave costs unavailable.
let attempts=0;globalThis.fetch=async()=>{attempts++;return new Response('',{status:429,headers:{'retry-after':'120'}});};
const noKey=await readResearchQuotes(pool(),researchReadContext(env()));assert.equal(attempts,4);assert.ok(noKey.every(q=>q.status==='rate-limited'&&q.roundTripCostSol===null));
const rateEnv=env(true);const rate=await readResearchQuotes(pool(),researchReadContext(rateEnv));assert.ok(rate.every(q=>q.status==='rate-limited'));const firstAttempts=attempts;
await readResearchQuotes(pool(),researchReadContext(rateEnv));assert.equal(attempts,firstAttempts,'429 provider backoff suppresses subsequent requests');
attempts=0;globalThis.fetch=async()=>{attempts++;throw Error('network failure');};const boundedContext=researchReadContext(env(true));boundedContext.maxRequests=1;
const budgeted=await readResearchQuotes(pool(),boundedContext);assert.equal(attempts,1);assert.ok(budgeted.every(q=>q.roundTripCostSol===null));

// Meteora normalisation preserves the reported twelve-hour windows and configuration.
globalThis.fetch=async()=>json({data:[{address:'native-pool',token_x:{address:'mint',symbol:'A',price:1},token_y:{address:SOL,symbol:'SOL',price:100},tvl:100000,current_price:.01,created_at:now-48*HOUR,volume:{'1h':100,'4h':400,'12h':1200,'24h':2400},fees:{'1h':1,'4h':4,'12h':12,'24h':24},fee_tvl_ratio:{'1h':.001,'4h':.004,'24h':.024},pool_config:{bin_step:20,base_fee_pct:.3},dynamic_fee_pct:.1,is_blacklisted:false}]});
const normalised=(await fetchMeteora()).pools[0];assert.equal(normalised.activity.fees12h,12);assert.equal(normalised.activity.volume12h,1200);assert.equal(normalised.poolConfig.binStep,20);assert.equal(normalised.poolConfig.baseFee,.003);assert.equal(normalised.poolConfig.dynamicFee,.001);

Date.now=originalNow;globalThis.fetch=originalFetch;
console.log('PASS LP research: time-normalised fee density, capped epoch transfer-cost reference, unknown/stale net, contiguous SOL-oriented structure, real bounded history, constant-work catalogue, cached/batched read-only providers, SDK-encoded RPC bin anchors with orientation/bounds/identity/freshness guards, and request/backoff limits');
