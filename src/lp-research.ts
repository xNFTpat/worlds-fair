import type {Env} from './env';
import type {Pool,Snapshot} from './schema';
import type {Candle} from './suggest';
import {researchToken,researchReadContext,researchQuoteFresh,researchEconomicQuoteFresh,researchEconomicQuoteUsable,RESEARCH_READ_LIMITS,cachedResearchQuotes,readResearchQuotes,readMintSafety,readResearchRangeAnchor,readRugSafety,cachedDexSafety,readDexScreenerBatch,readResearchCandles,type ResearchQuote,type MintSafety,type RugSafety,type DexSafety,type ResearchFlag,type ResearchCandles,type ResearchRangeAnchor} from './sources/research-reads';

const HOUR=3600000,MINUTE=60000;
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const positive=(n:unknown):n is number=>valid(n)&&n>0;
const fresh=(at:string,now=Date.now())=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+MINUTE&&now-Date.parse(at)<=10*MINUTE;
export interface ResearchFeeRates {h1:number|null;h4:number|null;h12:number|null;h24:number|null;asOf:string;note:string}
export interface ResearchTrend {volume1h:number|null;volume4h:number|null;volume24h:number|null;previous4h:number|null;ratio:number|null;tvlChange4h:number|null;asOf:string;previous4hAsOf:string|null;comparisonGapMinutes:number|null;historyStatus:'available'|'warming'|'stale';note:string}
export interface ResearchNet {sizeSol:number;mode:'best'|'dlmm';quoteMode:'best'|'dlmm';horizonHours:number;feeWindowHours:1|4|12;hourlyFeeRate:number|null;costFraction:number|null;grossFraction:number|null;grossFeeFraction:number|null;netFraction:number|null;netHourlyRate:number|null;feesCoverCostHours:number|null;feesCoverExitHours:number|null;roundTripRecoveryHours:number|null;exitRecoveryHours:number|null;totalCostSol:number|null;withdrawalTaxSol:number|null;networkSol:number;exitNetworkSol:number;rentTreatment:string;status:'estimated'|'unknown';note:string;quoteFreshness:'current'|'cached-estimate'|'unavailable';estimateCached:boolean;dataAsOf:string|null;economicPolicyAsOf:string|null;expiresAt:number|null}
export interface ResearchSafety {status:'complete'|'partial'|'unknown';flags:ResearchFlag[];rpc:MintSafety;rugcheck:RugSafety;dexscreener:DexSafety;note:string}
export interface ResearchRow {pool:Pool;feeRates:ResearchFeeRates;trend:ResearchTrend;config:{binStep:number|null;baseFee:number|null;dynamicFee:number|null};quotes:ResearchQuote[];safety:ResearchSafety;net:ResearchNet;nets?:ResearchNet[];preflightEvidence:ResearchPreflightEvidence}
export interface ResearchPreflightEvidence {
 holders:{status:'available'|'unavailable';asOf:string|null;topFraction:number|null;owner:string|null;sampleFraction:number|null;sampledAccounts:number;excludedAccounts:number;complete:boolean;note:string};
 tokenAge:{status:'available'|'unavailable';asOf:string|null;minimumHours:number|null;knownSince:string|null;basis:'pool'|'rugcheck-detected'|null;exact:false;note:string};
}
/** Derive bounded evidence from reads already used by the drawer. No new API. */
export function researchPreflightEvidence(pool:Pool,rpc:MintSafety,rug:RugSafety,now=Date.now()):ResearchPreflightEvidence{
 const mint=researchToken(pool)?.mint,sample=rpc.holderSample,exclusions=rug.holderExclusions;
 const recent=(stamp:string|null|undefined,ttl:number)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)&&t<=now&&now-t<=ttl;};
 let holders:ResearchPreflightEvidence['holders']={status:'unavailable',asOf:null,topFraction:null,owner:null,sampleFraction:null,sampledAccounts:0,excludedAccounts:0,complete:false,note:'Fresh owner balances and mint-matched pool, burn and locker exclusions are needed.'};
 if(mint&&rpc.mint===mint&&rpc.status==='available'&&recent(rpc.asOf,5*MINUTE)&&sample?.mint===mint&&sample.status==='available'&&recent(sample.asOf,5*MINUTE)&&/^\d{1,78}$/.test(sample.supplyRaw||'')&&rug.mint===mint&&rug.status==='available'&&recent(rug.asOf,10*MINUTE)&&exclusions?.mint===mint&&exclusions.status==='available'&&recent(exclusions.asOf,10*MINUTE)){
  const supply=BigInt(sample.supplyRaw!),excluded=new Set(exclusions.addresses),owners=new Map<string,bigint>(),seen=new Set<string>();let sum=0n,excludedAccounts=0,coherent=supply>0n&&sample.accounts.length>0&&sample.accounts.length<=20;
  for(const a of sample.accounts){
   if(!a.address||!a.owner||seen.has(a.address)||!/^\d{1,78}$/.test(a.amountRaw)){coherent=false;break;}
   seen.add(a.address);const amount=BigInt(a.amountRaw);sum+=amount;
   if(excluded.has(a.address)||excluded.has(a.owner)){excludedAccounts++;continue;}
   owners.set(a.owner,(owners.get(a.owner)||0n)+amount);
  }
  if(coherent&&sum<=supply){
   const ranked=[...owners].sort((a,b)=>a[1]>b[1]?-1:a[1]<b[1]?1:a[0].localeCompare(b[0])),top=ranked[0],complete=sample.complete&&sum===supply;
   const fraction=(amount:bigint)=>Number(amount*1000000000n/supply)/1e9;
   holders={status:'available',asOf:new Date(Math.min(Date.parse(sample.asOf!),Date.parse(exclusions.asOf!))).toISOString(),topFraction:top?fraction(top[1]):0,owner:top?.[0]??null,sampleFraction:fraction(sum),sampledAccounts:sample.accounts.length,excludedAccounts,complete,note:(complete?'The sampled token accounts cover the full observed mint supply. ':'Sampled largest token accounts only; owner shares are lower bounds and a low share cannot confirm dispersed ownership. ')+excludedAccounts+' accounts excluded using mint-matched pool, burn or known locker classifications. Unclassified accounts are retained; provider classifications may be incomplete.'};
  }
 }
 const ages:{knownSince:number;asOf:string;basis:'pool'|'rugcheck-detected'}[]=[],poolAt=Date.parse(pool.fetchedAt);
 if(mint&&valid(pool.ageHours)&&recent(pool.fetchedAt,10*MINUTE)){const knownSince=poolAt-pool.ageHours*HOUR;if(knownSince>0&&knownSince<=now)ages.push({knownSince,asOf:pool.fetchedAt,basis:'pool'});}
 const detected=Date.parse(rug.detectedAt||'');
 if(mint&&rug.mint===mint&&rug.status==='available'&&recent(rug.asOf,10*MINUTE)&&Number.isFinite(detected)&&detected>0&&detected<=Date.parse(rug.asOf!))ages.push({knownSince:detected,asOf:rug.asOf!,basis:'rugcheck-detected'});
 ages.sort((a,b)=>a.knownSince-b.knownSince);const oldest=ages[0];
 const tokenAge:ResearchPreflightEvidence['tokenAge']=oldest?{status:'available',asOf:oldest.asOf,minimumHours:(now-oldest.knownSince)/HOUR,knownSince:new Date(oldest.knownSince).toISOString(),basis:oldest.basis,exact:false,note:oldest.basis==='pool'?'Token existed when this pool opened: this is a minimum age, not the mint creation time. A young pool cannot prove a young token.':'Token was already detected by RugCheck at this time: this is a minimum age, not the mint creation time.'}:{status:'unavailable',asOf:null,minimumHours:null,knownSince:null,basis:null,exact:false,note:'Token creation time is unverified; fresh pool age or mint-matched detection evidence is needed to establish a minimum age.'};
 return {holders,tokenAge};
}
export interface ResearchWindow {hours:number;high:number|null;low:number|null;complete:boolean;observations:number;expectedObservations:number;from:string;to:string}
export interface ResearchStructure {windows:ResearchWindow[];hourlyHighTrend:'rising'|'falling'|'mixed'|'unknown';supportLevels:number[];candles:Candle[];asOf:string|null;unit:'SOL per token';status:string;note:string}
export interface ResearchHistoryObservation {at:string;priceSol:number|null;tvlUsd:number|null;fees1h:number|null;volume4h:number|null;volume1h:number|null;authorityAt:string|null;mintAuthority:boolean|null;freezeAuthority:boolean|null}
export interface ResearchPoolDetail extends ResearchRow {asOf:string;nets:ResearchNet[];priceSol:number|null;solUsd:number|null;tokenMint:string|null;rangeAnchor:ResearchRangeAnchor;structure:ResearchStructure;marketHistory:ResearchHistoryObservation[];historyCoverage:{from:string|null;to:string|null;observations:number;sampleMinutes:number;note:string};readHealth:{requests:number;cacheHits:number;maxRequests:number;jupiterRetryAt?:number|null}}

// Compact source observations only; no reconstructed candles or historical quotes.
// Enough observed history for a 48h lookback followed by a 12h hold. The byte
// cap protects KV independently of pool/point counts; this is never a ledger.
export const RESEARCH_HISTORY_LIMITS=Object.freeze({maxPools:300,maxPoints:440,sampleMinutes:10,retentionHours:73,maxBytes:23*1024*1024});
type HistoryPoint=[at:number,priceSol:number|null,tvlUsd:number|null,fees1h:number|null,volume4h:number|null,volume1h:number|null,ageHours:number|null,authorityAt?:number|null,mintAuthority?:boolean|null,freezeAuthority?:boolean|null];
interface History {version:1;at:string;pools:Record<string,HistoryPoint[]>}
const HISTORY_KEY='research:v1:history';
const INDEX_KEY='research:v1:enriched-index';
interface Enriched {at:string;tokenMint:string;quotes:ResearchQuote[];safety:ResearchSafety}
type EnrichedIndex=Record<string,Enriched>;
const amount=(n:unknown)=>valid(n)?n:null;
async function loadHistory(env:Env):Promise<History>{try{return await env.LP_CACHE.get<History>(HISTORY_KEY,'json')||{version:1,at:'',pools:{}};}catch{return {version:1,at:'',pools:{}};}}
async function loadIndex(env:Env):Promise<EnrichedIndex>{try{return await env.LP_CACHE.get<EnrichedIndex>(INDEX_KEY,'json')||{};}catch{return {};}}
async function saveIndex(pool:Pool,quotes:ResearchQuote[],checks:ResearchSafety,env:Env){
 const index=await loadIndex(env);index[pool.id]={at:new Date().toISOString(),tokenMint:researchToken(pool)!.mint,quotes,safety:checks};
 const entries=Object.entries(index).sort((a,b)=>Date.parse(b[1].at)-Date.parse(a[1].at)).slice(0,100);
 try{await env.LP_CACHE.put(INDEX_KEY,JSON.stringify(Object.fromEntries(entries)),{expirationTtl:86400});}catch{/* This is a disposable research cache, not a financial journal. */}
}
function relevantPools(snapshot:Snapshot){
 const candidates=snapshot.pools.filter(p=>p.venue==='meteora-dlmm'&&researchToken(p)&&positive(p.tvlUsd)&&fresh(p.fetchedAt));
 const density=(p:Pool)=>positive(p.tvlUsd)&&valid(p.activity?.fees1h)?p.activity!.fees1h!/p.tvlUsd:0;
 // Include activity, fee density and depth; a depth-only sample would miss smaller setups.
 const sort=(value:(p:Pool)=>number)=>candidates.slice().sort((a,b)=>value(b)-value(a)||a.id.localeCompare(b.id)).slice(0,100);
 return [...new Map([...sort(p=>(p.activity?.volume4h||0)),...sort(p=>p.tvlUsd!>=5000?density(p):0),...sort(p=>p.tvlUsd||0)].map(p=>[p.id,p])).values()];
}
export async function recordResearchObservation(snapshot:Snapshot,env:Env){
 if(!fresh(snapshot.updatedAt))return {status:'unchanged',pools:0,note:'Stale snapshot was not archived.'};
 const [history,index]=await Promise.all([loadHistory(env),loadIndex(env)]),now=Date.now();
 if(history.at&&Date.parse(snapshot.updatedAt)<=Date.parse(history.at))return {status:'unchanged',pools:Object.keys(history.pools).length,note:'This source observation is already archived.'};
 const pools:History['pools']={};
 for(const [id,points] of Object.entries(history.pools||{})){const kept=points.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&p[0]<=now+MINUTE&&now-p[0]<=RESEARCH_HISTORY_LIMITS.retentionHours*HOUR).slice(-RESEARCH_HISTORY_LIMITS.maxPoints);if(kept.length)pools[id]=kept;}
 const selected=relevantPools(snapshot);
 for(const pool of selected){const at=Date.parse(pool.fetchedAt),rows=pools[pool.id]||[],last=rows.at(-1);
  const token=researchToken(pool)!,saved=index[pool.id],rpc=saved?.tokenMint===token.mint?saved.safety?.rpc:undefined,rpcAt=Date.parse(rpc?.asOf||'');
  // A later safety read cannot be attached to an earlier market observation.
  // Only already cached, fresh evidence is stored; no provider fanout/backfill.
  const dated=rpc?.status==='available'&&Number.isFinite(rpcAt)&&rpcAt<=at&&at-rpcAt<=5*MINUTE&&now-rpcAt<=5*MINUTE;
  const authority=(value:unknown):boolean|null=>value===null?false:typeof value==='string'&&value.trim()!==''?true:null;
  if(!last||at-last[0]>=RESEARCH_HISTORY_LIMITS.sampleMinutes*MINUTE)rows.push([at,token.priceSol,amount(pool.tvlUsd),amount(pool.activity?.fees1h),amount(pool.activity?.volume4h),amount(pool.activity?.volume1h),amount(pool.ageHours),dated?rpcAt:null,dated?authority(rpc!.mintAuthority):null,dated?authority(rpc!.freezeAuthority):null]);
  pools[pool.id]=rows.slice(-RESEARCH_HISTORY_LIMITS.maxPoints);
 }
 const selectedIds=new Set(selected.map(p=>p.id)),ids=Object.keys(pools).sort((a,b)=>Number(selectedIds.has(b))-Number(selectedIds.has(a))||(pools[b].at(-1)?.[0]||0)-(pools[a].at(-1)?.[0]||0)||a.localeCompare(b)).slice(0,RESEARCH_HISTORY_LIMITS.maxPools);
 const next:History={version:1,at:snapshot.updatedAt,pools:Object.fromEntries(ids.map(id=>[id,pools[id]]))};
 let encoded=JSON.stringify(next),droppedForSize=0;
 while(new TextEncoder().encode(encoded).byteLength>RESEARCH_HISTORY_LIMITS.maxBytes&&ids.length){delete next.pools[ids.pop()!];droppedForSize++;encoded=JSON.stringify(next);}
 try{await env.LP_CACHE.put(HISTORY_KEY,encoded,{expirationTtl:4*86400});return {status:'recorded',pools:ids.length,droppedForSize,note:'Bounded source observations and already cached dated authority evidence retained; no historical backfill.'};}catch{return {status:'unavailable',pools:0,note:'Research observation cache unavailable.'};}
}

export function researchFeeRates(pool:Pool):ResearchFeeRates{
 const tvl=pool.tvlUsd,age=pool.ageHours;
 const rate=(fees:unknown,hours:number,fallback?:number|null)=>age!=null&&age<hours?null:positive(tvl)&&valid(fees)?fees/tvl/hours:valid(fallback)?fallback/hours:null;
 return {h1:rate(pool.activity?.fees1h,1,pool.feeTvl?.h1),h4:rate(pool.activity?.fees4h,4,pool.feeTvl?.midHours===4?pool.feeTvl.mid:null),h12:rate(pool.activity?.fees12h,12),h24:rate(pool.fees24hUsd,24,pool.feeTvl?.h24),asOf:pool.fetchedAt,note:'Fractions of current pool TVL per hour, using reported 1h / 4h / 12h / 24h fee windows. A window longer than known pool age is unavailable. Average pool fee density is not a concentrated position return.'};
}
export function researchTrend(pool:Pool,points:HistoryPoint[]=[],now=Date.now()):ResearchTrend{
 const at=Date.parse(pool.fetchedAt),target=at-4*HOUR;
 // Pick an actual source window ending at or just before the prior interval end;
 // never subtract overlapping volume windows or interpolate missing TVL.
 const previous=points.filter(p=>p[0]<=target&&target-p[0]<=10*MINUTE).at(-1);
 const full=pool.ageHours==null||pool.ageHours>=8,priorFull=previous&&(previous[6]==null||previous[6]!>=4);
 const previous4h=full&&priorFull?previous![4]:null,latest=amount(pool.activity?.volume4h);
 const previousTvl=previous?.[2],tvlChange4h=positive(previousTvl)&&valid(pool.tvlUsd)?pool.tvlUsd/previousTvl-1:null;
 const status=!fresh(pool.fetchedAt,now)?'stale':previous?'available':'warming';
 return {volume1h:amount(pool.activity?.volume1h),volume4h:latest,volume24h:amount(pool.volume24hUsd),previous4h,ratio:status==='available'&&positive(previous4h)&&latest!=null?latest/previous4h:null,tvlChange4h:status==='available'?tvlChange4h:null,asOf:pool.fetchedAt,previous4hAsOf:previous?new Date(previous[0]).toISOString():null,comparisonGapMinutes:previous?(target-previous[0])/MINUTE:null,historyStatus:status,note:previous?'Previous volume is the stored four-hour source window ending at the displayed prior timestamp; the comparison may have a gap of up to ten minutes. No overlap subtraction or TVL interpolation.':'Four-hour comparison warming: needs a real timestamped observation at least four hours earlier, within the ten-minute matching bound.'};
}
export function researchTransferTax(tokenRaw:string,policy:MintSafety['transferFee'],decimals:number,priceSol:number):number|null{
 if(!/^\d+$/.test(tokenRaw)||!policy||!/^\d+$/.test(policy.maximumRaw)||!Number.isInteger(policy.bps)||policy.bps<0||policy.bps>10000||!Number.isInteger(decimals)||decimals<0||decimals>18||!positive(priceSol))return null;
 const fee=(BigInt(tokenRaw)*BigInt(policy.bps)+9999n)/10000n,maximum=BigInt(policy.maximumRaw),capped=fee>maximum?maximum:fee;
 const value=Number(capped)/10**decimals*priceSol;
 return Number.isFinite(value)?value:null;
}
export function researchNet(fees:ResearchFeeRates,quotes:ResearchQuote[],sizeSol=1,quoteMode:'best'|'dlmm'='best',horizonHours=4,mint?:MintSafety,priceSol:number|null=null,networkSol=.0001,feeWindowHours:1|4|12=4):ResearchNet{
 const quote=quotes.find(q=>q.sizeSol===sizeSol&&q.mode===quoteMode),hourlyFeeRate=fresh(fees.asOf)?feeWindowHours===1?fees.h1:feeWindowHours===12?fees.h12:fees.h4:null;
 const executable=(!quote?.economicEstimate||quote.economicEstimate.costModelVersion===3)&&quote?.status==='quoted'&&quote.roundTripCostSol!=null&&Number.isFinite(quote.roundTripCostSol)&&quote.asOf&&Date.now()-Date.parse(quote.asOf)<=45000&&Date.parse(quote.asOf)<=Date.now();
 const economic=quote&&researchEconomicQuoteUsable(quote)?quote.economicEstimate:null,costQuote=economic||quote,usable=!!economic||!!executable;
 // Dated tax/decimals may support an explicitly labelled retained cost scenario for up to sixty minutes.
 // RPC safety status/authority flags retain their independent five-minute TTL.
 const mintAt=Date.parse(mint?.asOf||''),mintKnown=!!mint&&['available','stale','rate-limited','unavailable'].includes(mint.status)&&Number.isFinite(mintAt)&&Date.now()-mintAt<=60*MINUTE&&mintAt<=Date.now()&&mint.decimals!=null&&Number.isInteger(mint.decimals)&&mint.decimals>=0&&mint.decimals<=18&&positive(priceSol);
 const withdrawalTaxSol=usable&&mintKnown?mint!.transferFeeStatus==='none'?0:mint!.transferFeeStatus==='known'&&quote!.tokenRaw?researchTransferTax(quote!.tokenRaw,mint!.transferFee,mint!.decimals!,priceSol!):null:null;
 const declaredNetwork=valid(networkSol)?networkSol:.0001,exitNetworkSol=declaredNetwork/2;
 // Ignore favourable mark/route differences rather than manufacturing an arbitrage gain.
 const totalCostSol=usable&&withdrawalTaxSol!=null?Math.max(0,costQuote!.roundTripCostSol!)+withdrawalTaxSol+declaredNetwork:null;
 const exitCostSol=usable&&costQuote!.exitCostSol!=null&&withdrawalTaxSol!=null?Math.max(0,costQuote!.exitCostSol)+withdrawalTaxSol+exitNetworkSol:null;
 const costFraction=totalCostSol==null?null:totalCostSol/sizeSol,grossFeeFraction=hourlyFeeRate==null?null:hourlyFeeRate*horizonHours;
 const netFraction=costFraction==null||grossFeeFraction==null?null:grossFeeFraction-costFraction;
 const feesCoverCostHours=costFraction!=null&&positive(hourlyFeeRate)?costFraction/hourlyFeeRate:null,feesCoverExitHours=exitCostSol!=null&&positive(hourlyFeeRate)?exitCostSol/sizeSol/hourlyFeeRate:null;
 const quoteFreshness=!usable?'unavailable':executable?'current':'cached-estimate',estimateCached=quoteFreshness==='cached-estimate'||mintKnown&&(mint!.status==='stale'||Date.now()-mintAt>5*MINUTE),dates=[Date.parse(fees.asOf),Date.parse(economic?.dataAsOf||quote?.asOf||''),mintAt].filter(Number.isFinite),expires=usable&&mintKnown?Math.min(Date.parse(fees.asOf)+10*MINUTE,economic?.retainedUntil??economic?.expiresAt??Date.parse(quote!.asOf!)+45000,mintAt+60*MINUTE):null;
 return {sizeSol,mode:quoteMode,quoteMode,horizonHours,feeWindowHours,hourlyFeeRate,costFraction,grossFraction:grossFeeFraction,grossFeeFraction,netFraction,netHourlyRate:netFraction==null?null:netFraction/horizonHours,feesCoverCostHours,feesCoverExitHours,roundTripRecoveryHours:feesCoverCostHours,exitRecoveryHours:feesCoverExitHours,totalCostSol,withdrawalTaxSol,networkSol:declaredNetwork,exitNetworkSol,rentTreatment:'LP rent is locked and potentially refundable; it is not included as a loss.',status:netFraction==null?'unknown':'estimated',quoteFreshness,estimateCached,dataAsOf:dates.length?new Date(Math.min(...dates)).toISOString():null,economicPolicyAsOf:mintKnown?mint!.asOf:null,expiresAt:expires,note:(estimateCached?(economic&&!researchEconomicQuoteFresh(quote!)?'Last good economic cost estimate, retained for up to sixty minutes. ':'Cached economic cost estimate. ')+'Conversion costs and the observed tax policy retain their original dates; this is not a fresh executable quote. ':'')+'Conservative SOL-only reference comparator: pool-average '+feeWindowHours+'h fee density held constant over the stated horizon, minus a full-size Jupiter buy/sell round-trip (swap fees/taxes already included), one additional paired-token LP withdrawal transfer at the tax policy observed at '+(mintKnown?mint!.asOf:'an unknown date')+', and the declared network assumption. SOL-only entry has no paired-token funding/deposit transfer in this reference. The full buy/sell route is a cost comparator, not the actual SOL-only LP entry. Actual range fee share, price losses and extra transactions are unknown. Favourable quote differences count as zero cost. Missing quotes, price, decimals or dated tax policy leave complete net unknown.'};
}
function safety(rpc:MintSafety,rugcheck:RugSafety,dexscreener:DexSafety):ResearchSafety{
 const reads=[rpc,rugcheck,dexscreener],available=reads.filter(r=>r.status==='available').length,complete=available===3&&rpc.transferFeeStatus!=='unknown'&&rpc.concentration?.holders.status==='available';
 return {status:complete?'complete':available?'partial':'unknown',rpc,rugcheck,dexscreener,flags:[...rpc.flags,...rugcheck.flags,...dexscreener.flags],note:'Research flags only; no automatic safety veto. Stale or absent checks are unknown, and a clean report is not a safety guarantee.'};
}
function blankSafety():ResearchSafety{
 const note='Not checked yet; open the pool for bounded research reads.';
 const rpc:MintSafety={status:'unknown',asOf:null,note,mint:null,tokenProgram:null,mintAuthority:null,freezeAuthority:null,decimals:null,extensions:[],transferFeeStatus:'unknown',transferFee:null,concentration:null,flags:[]};
 return safety(rpc,{status:'unknown',asOf:null,score:null,risks:[],note,flags:[]},{status:'unknown',asOf:null,poolMatched:null,liquidityUsd:null,volume24h:null,priceUsd:null,url:null,note,flags:[]});
}
function blankQuotes(configured:boolean):ResearchQuote[]{return [.5,1].flatMap(sizeSol=>(['best','dlmm'] as const).map(mode=>({sizeSol,mode,status:'unknown' as const,roundTripCostSol:null,exitCostSol:null,asOf:null,note:configured?'Not quoted yet; open the pool to request conversion checks.':'Jupiter API credentials unavailable; quote-dependent metrics remain unknown.',selectedPoolMatched:null,buyRoutePools:[],sellRoutePools:[],buyPriceImpact:null,sellPriceImpact:null,slippageBps:50,inputRaw:null,tokenRaw:null,returnedSol:null})));}
function indexedRow(pool:Pool,index:EnrichedIndex,history:History,size:number,mode:'best'|'dlmm',horizon:number,network:number,configured:boolean,feeWindowHours:1|4|12=4):ResearchRow{
 const candidate=index[pool.id],saved=candidate?.tokenMint===researchToken(pool)!.mint?candidate:undefined,checks=saved?structuredClone(saved.safety):blankSafety(),now=Date.now();
 const stale=(read:{status:string;asOf:string|null},ttl:number)=>{if(read.status==='available'&&(!read.asOf||now-Date.parse(read.asOf)>ttl||Date.parse(read.asOf)>now+MINUTE))read.status='stale';};
 stale(checks.rpc,5*MINUTE);stale(checks.rugcheck,10*MINUTE);stale(checks.dexscreener,5*MINUTE);
 const quotes=configured&&saved?saved.quotes.map(q=>q.status==='quoted'&&!researchQuoteFresh(q,now)?{...q,status:'stale' as const,roundTripCostSol:null,exitCostSol:null,returnedSol:null}:q):blankQuotes(configured),feeRates=researchFeeRates(pool),token=researchToken(pool)!;
 const currentSafety=safety(checks.rpc,checks.rugcheck,checks.dexscreener);
 const price=fresh(pool.fetchedAt)?token.priceSol:null,nets=([1,4,12] as const).map(hours=>researchNet(feeRates,quotes,size,mode,hours,currentSafety.rpc,price,network,hours));
 return {pool,feeRates,preflightEvidence:researchPreflightEvidence(pool,currentSafety.rpc,currentSafety.rugcheck,now),trend:researchTrend(pool,history.pools[pool.id]||[]),config:{binStep:amount(pool.poolConfig?.binStep),baseFee:amount(pool.poolConfig?.baseFee??pool.feeTier),dynamicFee:amount(pool.poolConfig?.dynamicFee)},quotes,safety:currentSafety,net:researchNet(feeRates,quotes,size,mode,horizon,currentSafety.rpc,price,network,feeWindowHours),nets};
}
function parameter(query:URLSearchParams,name:string,fallback:number,min:number,max:number){const value=Number(query.get(name));return query.has(name)&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;}
export async function researchCatalogue(snapshot:Snapshot,env:Env,query:URLSearchParams){
 const sort=query.get('sort')||'net',windowCandidate=Number(query.get('feeWindow')||sort.replace(/^net/,'')),feeWindowHours:1|4|12=windowCandidate===1?1:windowCandidate===12?12:4;
 const [history,index]=await Promise.all([loadHistory(env),loadIndex(env)]),size=query.get('size')==='.5'||query.get('size')==='0.5'?.5:1,mode=query.get('mode')==='dlmm'?'dlmm':'best',horizon=parameter(query,'horizon',feeWindowHours,.25,48),network=parameter(query,'networkSol',.0001,0,.02);
 const minTvl=parameter(query,'minTvl',0,0,1e12),maxTvl=parameter(query,'maxTvl',1e12,0,1e12),minVolume4h=parameter(query,'minVolume4h',0,0,1e15),maxAge=parameter(query,'maxAge',1e9,0,1e9),search=(query.get('search')||'').trim().toLowerCase(),ageGroup=query.get('ageGroup'),limit=Math.floor(parameter(query,'limit',50,1,100));
 const pools=snapshot.pools.filter(p=>p.venue==='meteora-dlmm'&&researchToken(p)&&positive(p.tvlUsd)&&p.tvlUsd>=minTvl&&p.tvlUsd<=maxTvl&&(p.activity?.volume4h||0)>=minVolume4h&&(p.ageHours==null?maxAge>=1e9:p.ageHours<=maxAge)&&(ageGroup!=='fresh'||p.ageHours!=null&&p.ageHours<24)&&(ageGroup!=='established'||p.ageHours!=null&&p.ageHours>=24)&&(!search||[p.pair,p.address,p.base.address,p.quote.address].some(v=>v.toLowerCase().includes(search))));
 // Exactly two KV reads for the entire catalogue. Provider caches are indexed
 // after detail reads; no per-row KV/provider fanout or automatic quote sweep.
 const rows=pools.map(pool=>indexedRow(pool,index,history,size,mode,horizon,network,!!env.RANGE_ALERTS,feeWindowHours));
 const visible=rows.filter(row=>query.get('hideFlagged')!=='true'&&query.get('hideFlagged')!=='1'||!row.safety.flags.some(f=>f.severity==='attention'&&(f.source==='RPC'?row.safety.rpc.status:f.source==='RugCheck'?row.safety.rugcheck.status:row.safety.dexscreener.status)==='available'));
 visible.sort((a,b)=>sort==='volume'?(b.trend.volume4h??-1)-(a.trend.volume4h??-1)||a.pool.id.localeCompare(b.pool.id):sort==='fees'?(b.feeRates.h1??-1)-(a.feeRates.h1??-1)||a.pool.id.localeCompare(b.pool.id):Number(b.net.status==='estimated')-Number(a.net.status==='estimated')||(b.net.netHourlyRate??-Infinity)-(a.net.netHourlyRate??-Infinity)||(b.feeRates.h1??-1)-(a.feeRates.h1??-1)||a.pool.id.localeCompare(b.pool.id));
 const quoted=rows.filter(r=>r.net.status==='estimated').length;
 return {rows:visible.slice(0,limit),pools:visible.slice(0,limit),quotesConfigured:!!env.RANGE_ALERTS,quotaMode:env.RANGE_ALERTS?(env.JUPITER_API_KEY?'keyed':'public'):'unavailable',total:pools.length,analysed:rows.length,matched:visible.length,shown:Math.min(limit,visible.length),updatedAt:snapshot.updatedAt,asOf:new Date().toISOString(),parameters:{sizeSol:size,quoteMode:mode,horizonHours:horizon,feeWindowHours,networkSol:network},coverage:{quoted,cachedEstimates:rows.filter(r=>r.net.status==='estimated'&&r.net.estimateCached).length,unknown:rows.length-quoted,jupiterConfigured:!!env.RANGE_ALERTS,enrichedIndexLimit:100,note:`The catalogue uses one bounded index of the latest 100 opened pools plus one history read; ${quoted} have complete dated reference-cost estimates. Economic quotes refresh after ten minutes; last good costs and dated tax assumptions remain labelled for up to sixty minutes. ${env.JUPITER_API_KEY?'The top 30 displayed pools are staggered under one shared Jupiter budget.':'Public mode checks quotes only when a pool is opened; browsing does not warm costs.'} Executable quotes expire after 45 seconds. Unavailable costs sort after known net estimates. Open a pool to update its bounded checks. ${env.JUPITER_API_KEY?'Configured Jupiter key.':'Public Jupiter reads use the shared 30-per-minute allowance; missing routes or exhausted allowance remain unavailable.'}`},history:{...RESEARCH_HISTORY_LIMITS,note:'Actual bounded source observations only, with up to 73h at regular ten-minute cadence and a 23MiB cache cap; no historical quotes or backfill. Authority evidence is recorded prospectively only from a fresh, earlier exact-mint cached RPC read.'}};
}

export function researchStructure(read:ResearchCandles,now=Date.now()):ResearchStructure{
 const end=Math.floor(now/HOUR)*3600,clean=new Map<number,Candle>();
 for(const c of read.candles)if(Number.isInteger(c.t)&&c.t%3600===0&&c.t<end&&c.t>=end-72*3600&&[c.o,c.h,c.l,c.c].every(positive)&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c)&&valid(c.v))clean.set(c.t,c);
 const candles=[...clean.values()].sort((a,b)=>a.t-b.t);
 const windows=[4,24,48].map(hours=>{const selected=candles.filter(c=>c.t>=end-hours*3600),complete=selected.length===hours&&selected.every((c,i)=>c.t===end-hours*3600+i*3600)&&read.status==='available';return {hours,high:selected.length?Math.max(...selected.map(c=>c.h)):null,low:selected.length?Math.min(...selected.map(c=>c.l)):null,complete,observations:selected.length,expectedObservations:hours,from:new Date((end-hours*3600)*1000).toISOString(),to:new Date(end*1000).toISOString()};});
 const recent=candles.slice(-4),contiguous=windows[0].complete;
 const rising=contiguous&&recent.slice(1).every((c,i)=>c.h>recent[i].h),falling=contiguous&&recent.slice(1).every((c,i)=>c.h<recent[i].h);
 const lows=candles.filter((c,i)=>i>0&&i<candles.length-1&&c.t-candles[i-1].t===3600&&candles[i+1].t-c.t===3600&&c.l<=candles[i-1].l&&c.l<candles[i+1].l).map(c=>c.l);
 const supportLevels=[...new Set(lows.slice(-12).sort((a,b)=>a-b))].slice(-6);
 return {windows,hourlyHighTrend:!contiguous?'unknown':rising?'rising':falling?'falling':'mixed',supportLevels,candles,asOf:read.asOf,unit:'SOL per token',status:read.status,note:read.note+' High/low values with incomplete coverage describe only observed candles. Support levels are past hourly swing lows, not guaranteed future support.'};
}
export async function researchPool(pool:Pool,env:Env):Promise<ResearchPoolDetail>{
 const token=researchToken(pool),context=researchReadContext(env),history=await loadHistory(env);
 if(!token)throw Error('LP research currently supports exact Meteora SOL pairs.');
 const [rpc,rugcheck,dex,candles]=await Promise.all([readMintSafety(token.mint,context),readRugSafety(token.mint,context),readDexScreenerBatch([pool],context),readResearchCandles(pool,context)]);
 const priorQuotes=await cachedResearchQuotes(pool,env,rpc.decimals),needsNewQuotes=!!env.RANGE_ALERTS&&!priorQuotes.every(q=>researchEconomicQuoteFresh(q));
 const rangeAnchor=await readResearchRangeAnchor(pool,context,rpc,needsNewQuotes),anchorAt=Date.parse(rangeAnchor.asOf||''),anchorPrice=rangeAnchor.activeBinPriceSol;
 const verifiedMark=rangeAnchor.status==='available'&&positive(anchorPrice)&&Number.isFinite(anchorAt)&&anchorAt<=Date.now()&&Date.now()-anchorAt<=RESEARCH_READ_LIMITS.anchorTtlMs;
 // New quotes use a forced fresh verified active-bin mark. Retained estimates
 // preserve their original marks; catalogue prices and fee dates are unchanged.
 const quotes=await readResearchQuotes(pool,context,rpc.decimals,verifiedMark?{priceSol:anchorPrice!,asOf:rangeAnchor.asOf!,source:'active-bin'}:null),feeRates=researchFeeRates(pool),dexscreener=dex.get(pool.id)||await cachedDexSafety(pool,env);
 const points=(history.pools[pool.id]||[]).slice(-RESEARCH_HISTORY_LIMITS.maxPoints),marketHistory=points.map(([at,priceSol,tvlUsd,fees1h,volume4h,volume1h,,authorityAt,mintAuthority,freezeAuthority])=>({at:new Date(at).toISOString(),priceSol,tvlUsd,fees1h,volume4h,volume1h,authorityAt:Number.isFinite(authorityAt)?new Date(authorityAt!).toISOString():null,mintAuthority:typeof mintAuthority==='boolean'?mintAuthority:null,freezeAuthority:typeof freezeAuthority==='boolean'?freezeAuthority:null})),checks=safety(rpc,rugcheck,dexscreener);
 const nets=quotes.flatMap(q=>([1,4,12] as const).map(hours=>researchNet(feeRates,quotes,q.sizeSol,q.mode,hours,rpc,fresh(pool.fetchedAt)?token.priceSol:null,.0001,hours)));
 await saveIndex(pool,quotes,checks,env);
 return {pool,asOf:new Date().toISOString(),feeRates,preflightEvidence:researchPreflightEvidence(pool,rpc,rugcheck),trend:researchTrend(pool,points),config:{binStep:amount(pool.poolConfig?.binStep),baseFee:amount(pool.poolConfig?.baseFee??pool.feeTier),dynamicFee:amount(pool.poolConfig?.dynamicFee)},quotes,safety:checks,net:nets.find(n=>n.sizeSol===1&&n.mode==='best'&&n.feeWindowHours===4)!,nets,priceSol:token.priceSol,solUsd:token.solUsd,tokenMint:token.mint,rangeAnchor,structure:researchStructure(candles),marketHistory,historyCoverage:{from:marketHistory[0]?.at??null,to:marketHistory.at(-1)?.at??null,observations:marketHistory.length,sampleMinutes:RESEARCH_HISTORY_LIMITS.sampleMinutes,note:'Actual timestamped catalogue reads, bounded by pool selection, retention and sampling. Historical conversion quotes are unavailable. Missing observations remain gaps.'},readHealth:{requests:context.requests,cacheHits:context.cacheHits,maxRequests:context.maxRequests,jupiterRetryAt:context.jupiterRetryAt??null}};
}
