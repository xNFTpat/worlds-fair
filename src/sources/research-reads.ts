import type {Env} from '../env';
import type {Pool} from '../schema';
import type {Candle} from '../suggest';
import {reserveResearchJupiter,noteResearchJupiterRateLimit} from '../research-quote-budget';
import {solanaReadFetch} from '../solana-read-rpc';

// Research reads only. No swap construction, transaction signing or broadcasting.
// Jupiter: https://dev.jup.ag/api-reference/swap/quote
// DexScreener: https://docs.dexscreener.com/api/reference
// RPC: https://solana.com/docs/rpc/http/gettokenlargestaccounts
export const RESEARCH_SOL='So11111111111111111111111111111111111111112';
export type ResearchReadStatus='available'|'unknown'|'unavailable'|'rate-limited'|'stale'|'unsupported';
export interface ResearchRead<T>{status:ResearchReadStatus;data:T|null;asOf:string|null;expiresAt?:number;cached:boolean;note:string}
interface SavedRead<T>{data:T|null;at:string;expiresAt:number;status:ResearchReadStatus;note:string}
export interface ResearchReadContext {env:Env;requests:number;pendingRequests:number;cacheHits:number;maxRequests:number;deadline:number;jupiterRetryAt?:number}
export const RESEARCH_READ_LIMITS=Object.freeze({maxRequests:15,deadlineMs:20000,requestMs:7000,quoteTtlMs:45000,economicQuoteTtlMs:600000,economicRetentionMs:3600000,mintTtlMs:300000,anchorTtlMs:60000,safetyTtlMs:600000,candleTtlMs:300000,dexBatch:30});
export function researchReadContext(env:Env):ResearchReadContext{return {env,requests:0,pendingRequests:0,cacheHits:0,maxRequests:RESEARCH_READ_LIMITS.maxRequests,deadline:Date.now()+RESEARCH_READ_LIMITS.deadlineMs};}
const pending=new Map<string,Promise<ResearchRead<unknown>>>();
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const positive=(n:unknown):n is number=>valid(n)&&n>0;
const raw=(n:unknown):n is string=>typeof n==='string'&&/^\d{1,78}$/.test(n);
const number=(n:unknown):number|null=>{if(n==null||typeof n==='boolean'||n==='')return null;const value=typeof n==='string'?Number(n):n;return valid(value)?value:null;};
const key=(name:string)=>'research:v1:'+name;
async function keyHash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes).slice(0,16),n=>n.toString(16).padStart(2,'0')).join('');}
const unknown=<T>(note:string,status:ResearchReadStatus='unknown'):ResearchRead<T>=>({status,data:null,asOf:null,cached:false,note});
interface ProviderBackoff {until:number;attempts:number;last429At:number}
export function researchBackoff(previous:ProviderBackoff|null,headers:Headers,now=Date.now()):ProviderBackoff{
 const attempts=Math.min(8,Math.max(0,previous?.attempts||0)+1),retry=Number(headers.get('retry-after')),reset=Number(headers.get('x-ratelimit-reset'))*1000,retryDate=Date.parse(headers.get('retry-after')||'');
 const exponential=Math.min(900000,30000*2**(attempts-1)),serverWait=Math.max(Number.isFinite(retry)&&retry>0?retry*1000:0,Number.isFinite(retryDate)?retryDate-now:0,Number.isFinite(reset)?reset-now:0),delay=Math.min(900000,Math.max(exponential,serverWait));
 return {until:now+delay,attempts,last429At:now};
}

async function savedRead<T>(env:Env,name:string):Promise<SavedRead<T>|null>{
 try{return await env.LP_CACHE.get<SavedRead<T>>(key(name),'json');}catch{return null;}
}
export async function cachedResearchRead<T>(env:Env,name:string):Promise<ResearchRead<T>>{
 const saved=await savedRead<T>(env,name);
 if(!saved)return unknown('Not checked yet; open the pool to request bounded research reads.');
 return {status:saved.expiresAt>Date.now()?saved.status:'stale',data:saved.data,asOf:saved.at,expiresAt:saved.expiresAt,cached:true,note:saved.expiresAt>Date.now()?saved.note:'Saved research read is stale; open the pool to update it.'};
}
async function saveRead<T>(env:Env,name:string,saved:SavedRead<T>,ttl:number){
 try{await env.LP_CACHE.put(key(name),JSON.stringify(saved),{expirationTtl:Math.max(60,Math.ceil(ttl/1000)*10)});}catch{/* Cache failure must not invent a successful read. */}
}
async function readJson<T>(context:ResearchReadContext,options:{name:string;provider:string;url:string;ttl:number;init?:RequestInit;forceFresh?:boolean}):Promise<ResearchRead<T>>{
 const saved=await savedRead<T>(context.env,options.name),now=Date.now();
 if(!options.forceFresh&&saved&&saved.expiresAt>now){context.cacheHits++;return {...saved,asOf:saved.at,cached:true};}
 let cooldown:ProviderBackoff|null=null;
 try{cooldown=await context.env.LP_CACHE.get<ProviderBackoff>(key('backoff:'+options.provider),'json');}catch{}
 if(cooldown&&cooldown.until>now){if(options.provider==='Jupiter')context.jupiterRetryAt=Math.max(context.jupiterRetryAt||0,cooldown.until);return {status:'rate-limited',data:saved?.data??null,asOf:saved?.at??null,cached:!!saved,note:options.provider+' is in a rate-limit cooldown.'};}
 const pendingKey=key(options.name);
 if(pending.has(pendingKey)){context.cacheHits++;return await pending.get(pendingKey)! as ResearchRead<T>;}
 if(context.requests+context.pendingRequests>=context.maxRequests||now>=context.deadline)return unknown('Research request budget reached; remaining sources are unknown.');
 // Reserve this context slot synchronously before awaiting the shared gate.
 // Otherwise parallel quote legs can each see the same final free slot.
 context.pendingRequests++;
 const work=(async():Promise<ResearchRead<T>>=>{
  try{
   if(options.provider==='Jupiter'){
    const reservation=await reserveResearchJupiter(context.env);
    if(!reservation.allowed){if(reservation.retryAt)context.jupiterRetryAt=Math.max(context.jupiterRetryAt||0,reservation.retryAt);return {status:reservation.reason==='unavailable'?'unavailable':'rate-limited',data:saved?.data??null,asOf:saved?.at??null,cached:!!saved,note:'Jupiter shared request budget '+reservation.reason+'.'+(reservation.retryAt?' Retry after '+new Date(reservation.retryAt).toISOString()+'.':'')};}
   }
   if(Date.now()>=context.deadline)return unknown('Research request deadline reached before provider request.');
  }finally{context.pendingRequests--;}
  const timeout=Math.max(1,Math.min(RESEARCH_READ_LIMITS.requestMs,context.deadline-Date.now()));
  try{
   const countRequest=()=>{if(context.requests>=context.maxRequests)throw Error('Research request budget reached.');context.requests++;};
   const init={...options.init,signal:AbortSignal.timeout(timeout)};
   const response=options.provider==='Solana RPC'?await solanaReadFetch(options.url,init,{deadline:Math.min(context.deadline,Date.now()+timeout),onRequest:countRequest}):await (countRequest(),globalThis.fetch(options.url,init));
   if(!response.ok){
    let ttl=60000,status:ResearchReadStatus='unavailable';
    if(response.status===429){status='rate-limited';const backoff=researchBackoff(cooldown,response.headers);ttl=backoff.until-Date.now();if(options.provider==='Jupiter'){const shared=await noteResearchJupiterRateLimit(context.env,response.headers);context.jupiterRetryAt=Math.max(context.jupiterRetryAt||0,backoff.until,shared.retryAt||0);}try{await context.env.LP_CACHE.put(key('backoff:'+options.provider),JSON.stringify(backoff),{expirationTtl:86400});}catch{}}
    await response.body?.cancel();
    const note=options.provider+' returned HTTP '+response.status+'.';
    // Preserve the date of stale data, never attach a fresh date to its value.
    await saveRead(context.env,options.name,{data:saved?.data??null,at:saved?.at??new Date().toISOString(),expiresAt:Date.now()+ttl,status,note},ttl);
    return {status,data:saved?.data??null,asOf:saved?.at??null,cached:!!saved,note};
   }
   const data=await response.json() as T,atMs=Date.now(),at=new Date(atMs).toISOString(),expiresAt=atMs+options.ttl;
   if(cooldown&&cooldown.until<=now)try{const latest=await context.env.LP_CACHE.get<ProviderBackoff>(key('backoff:'+options.provider),'json');if(latest?.last429At===cooldown.last429At)await context.env.LP_CACHE.put(key('backoff:'+options.provider),JSON.stringify({until:0,attempts:0,last429At:cooldown.last429At}),{expirationTtl:86400});}catch{}
   await saveRead(context.env,options.name,{data,at,expiresAt,status:'available',note:'Timestamped '+options.provider+' read.'},options.ttl);
   return {status:'available',data,asOf:at,expiresAt,cached:false,note:'Timestamped '+options.provider+' read.'};
   }catch{const note=options.provider+' timed out or returned an unreadable response.';await saveRead(context.env,options.name,{data:saved?.data??null,at:saved?.at??new Date().toISOString(),expiresAt:Date.now()+60000,status:'unavailable',note},60000);return {status:'unavailable',data:saved?.data??null,asOf:saved?.at??null,cached:!!saved,note};}
 })();
 pending.set(pendingKey,work as Promise<ResearchRead<unknown>>);
 try{return await work;}finally{pending.delete(pendingKey);}
}

export function researchToken(pool:Pool):{mint:string;solX:boolean;priceSol:number|null;solUsd:number|null}|null{
 if(pool.chain!=='solana'||(pool.base.address===RESEARCH_SOL)===(pool.quote.address===RESEARCH_SOL))return null;
 const solX=pool.base.address===RESEARCH_SOL,ratio=positive(pool.priceQuote)?pool.priceQuote:null;
 const computed=ratio?solX?1/ratio:ratio:positive(pool.priceUsd)&&positive(pool.quotePriceUsd)?solX?pool.quotePriceUsd/pool.priceUsd:pool.priceUsd/pool.quotePriceUsd:null;
 const priceSol=positive(computed)?computed:null;
 return {mint:solX?pool.quote.address:pool.base.address,solX,priceSol,solUsd:solX?number(pool.priceUsd):number(pool.quotePriceUsd)};
}

interface JupiterQuote {inputMint:string;outputMint:string;inAmount:string;outAmount:string;otherAmountThreshold?:string;priceImpactPct?:string;routePlan?:{percent?:number;bps?:number;swapInfo?:{ammKey?:string;label?:string;inputMint?:string;outputMint?:string;inAmount?:string;outAmount?:string;feeAmount?:string;feeMint?:string}}[];contextSlot?:number}
interface QuotePair {buy:JupiterQuote;sell:JupiterQuote;buyAsOf:string|null;sellAsOf:string|null}
export interface ResearchQuote {
 sizeSol:number;mode:'best'|'dlmm';status:'quoted'|'unknown'|'unavailable'|'rate-limited'|'stale'|'unsupported';
 roundTripCostSol:number|null;exitCostSol:number|null;asOf:string|null;note:string;
 buyAsOf?:string|null;sellAsOf?:string|null;expiresAt?:number|null;
 selectedPoolMatched:boolean|null;buyRoutePools:string[];sellRoutePools:string[];
 buyPriceImpact:number|null;sellPriceImpact:number|null;slippageBps:number;
 inputRaw:string|null;tokenRaw:string|null;returnedSol:number|null;
 exitFeeFloorSol?:number|null;exitFeeSource?:'jupiter-route'|'pool-config'|'pump-config'|'assumed'|null;exitFeeAsOf?:string|null;
 economicEstimate?:ResearchEconomicQuote;
}
export interface ResearchEconomicQuote {costModelVersion?:3;status:'available'|'stale'|'unknown';roundTripCostSol:number|null;exitCostSol:number|null;asOf:string|null;dataAsOf:string|null;expiresAt:number|null;retainedUntil?:number|null;retained?:boolean;cached:boolean;markAsOf:string|null;markPriceSol:number|null;tokenDecimals:number|null;exitFeeFloorSol?:number|null;exitFeeSource?:'jupiter-route'|'pool-config'|'pump-config'|'assumed'|null;exitFeeAsOf?:string|null;note:string}
export interface ResearchQuoteMark {priceSol:number;asOf:string;source:'active-bin'}
interface SavedEconomicQuote {pool:string;mint:string;quote:ResearchQuote;estimate:ResearchEconomicQuote}
// v3 deliberately excludes saved estimates computed before the sell-fee floor.
const economicName=(pool:Pool,mint:string,size:number,mode:string)=>`quote-estimate:v3:${pool.address}:${mint}:${size}:${mode}`;
export function researchEconomicQuoteFresh(quote:ResearchQuote,now=Date.now()):boolean{
 const e=quote.economicEstimate,buyAt=Date.parse(quote.buyAsOf||''),sellAt=Date.parse(quote.sellAsOf||''),oldest=Math.min(buyAt,sellAt),asOf=Date.parse(e?.asOf||'');
 return !!e&&e.costModelVersion===3&&e.status==='available'&&[buyAt,sellAt,asOf].every(at=>Number.isFinite(at)&&at<=now&&now-at<=RESEARCH_READ_LIMITS.economicQuoteTtlMs)&&asOf===oldest&&typeof e.expiresAt==='number'&&e.expiresAt>now&&e.expiresAt<=oldest+RESEARCH_READ_LIMITS.economicQuoteTtlMs&&valid(e.roundTripCostSol);
}
export function researchEconomicQuoteUsable(quote:ResearchQuote,now=Date.now()):boolean{
 const e=quote.economicEstimate,buyAt=Date.parse(quote.buyAsOf||''),sellAt=Date.parse(quote.sellAsOf||''),oldest=Math.min(buyAt,sellAt),asOf=Date.parse(e?.asOf||''),markAt=Date.parse(e?.markAsOf||'');
 return !!e&&e.costModelVersion===3&&(e.status==='available'||e.status==='stale')&&[buyAt,sellAt,asOf,markAt].every(at=>Number.isFinite(at)&&at<=now&&now-at<=RESEARCH_READ_LIMITS.economicRetentionMs)&&asOf===oldest&&typeof e.retainedUntil==='number'&&e.retainedUntil>now&&e.retainedUntil===oldest+RESEARCH_READ_LIMITS.economicRetentionMs&&typeof e.expiresAt==='number'&&e.expiresAt===oldest+RESEARCH_READ_LIMITS.economicQuoteTtlMs&&valid(e.roundTripCostSol)&&valid(e.exitCostSol)&&positive(e.markPriceSol);
}
async function economicQuote(pool:Pool,env:Env,size:number,mode:'best'|'dlmm'):Promise<ResearchQuote|null>{
 const mint=researchToken(pool)?.mint;if(!mint)return null;let saved:SavedEconomicQuote|null=null;try{saved=await env.LP_CACHE.get<SavedEconomicQuote>(key(economicName(pool,mint,size,mode)),'json');}catch{}
 if(!saved||saved.pool!==pool.address||saved.mint!==mint||saved.quote.sizeSol!==size||saved.quote.mode!==mode)return null;
 const quote={...saved.quote,economicEstimate:{...saved.estimate,cached:true}};
 if(!researchEconomicQuoteUsable(quote))return null;
 const fresh=researchEconomicQuoteFresh(quote);
 const executable=researchQuoteFresh(quote);
 return {...quote,status:executable?'quoted':'stale',roundTripCostSol:executable?quote.roundTripCostSol:null,exitCostSol:executable?quote.exitCostSol:null,returnedSol:executable?quote.returnedSol:null,economicEstimate:{...quote.economicEstimate,status:fresh?'available':'stale',retained:!fresh,note:fresh?quote.economicEstimate.note:'Last good dated economic estimate; refresh is due after ten minutes and this value is retained for at most sixty minutes. '+quote.economicEstimate.note},note:executable?quote.note:'Cached economic estimate only. Both executable quote legs expire after 45 seconds; review a fresh transaction before signing.'};
}
async function rememberEconomicQuote(pool:Pool,env:Env,quote:ResearchQuote,decimals:number|null):Promise<ResearchQuote>{
 const token=researchToken(pool);if(!token||!positive(token.priceSol)||quote.status!=='quoted'||!researchQuoteFresh(quote)||!valid(quote.roundTripCostSol)||!valid(quote.exitCostSol))return quote;
 const oldest=Date.parse(quote.asOf!),markAt=Date.parse(pool.fetchedAt),feeAt=Date.parse(quote.exitFeeAsOf||''),dataAt=Math.min(oldest,Number.isFinite(markAt)&&markAt<=Date.now()?markAt:oldest,Number.isFinite(feeAt)&&feeAt<=Date.now()?feeAt:oldest);
 const estimate:ResearchEconomicQuote={costModelVersion:3,status:'available',roundTripCostSol:quote.roundTripCostSol,exitCostSol:quote.exitCostSol,asOf:quote.asOf,dataAsOf:new Date(dataAt).toISOString(),expiresAt:oldest+RESEARCH_READ_LIMITS.economicQuoteTtlMs,retainedUntil:oldest+RESEARCH_READ_LIMITS.economicRetentionMs,retained:false,cached:false,markAsOf:pool.fetchedAt,markPriceSol:token.priceSol,tokenDecimals:decimals,exitFeeFloorSol:quote.exitFeeFloorSol??null,exitFeeSource:quote.exitFeeSource??null,exitFeeAsOf:quote.exitFeeAsOf??null,note:'Economic estimate from the original dated buy/sell quotes and source mark; refresh after ten minutes, retain the last good estimate for at most sixty minutes. It is not an executable quote or a future exit guarantee. '+quote.note};
 try{await env.LP_CACHE.put(key(economicName(pool,token.mint,quote.sizeSol,quote.mode)),JSON.stringify({pool:pool.address,mint:token.mint,quote,estimate}),{expirationTtl:3600});}catch{}
 return {...quote,economicEstimate:estimate};
}
export function researchQuoteFresh(quote:Pick<ResearchQuote,'asOf'|'buyAsOf'|'sellAsOf'|'expiresAt'>,now=Date.now()):boolean{
 const buyAt=quote.buyAsOf?Date.parse(quote.buyAsOf):NaN,sellAt=quote.sellAsOf?Date.parse(quote.sellAsOf):NaN,compositeAt=quote.asOf?Date.parse(quote.asOf):NaN,oldest=Math.min(buyAt,sellAt);
 return [buyAt,sellAt,compositeAt].every(at=>Number.isFinite(at)&&at<=now&&now-at<=RESEARCH_READ_LIMITS.quoteTtlMs)&&compositeAt===oldest&&typeof quote.expiresAt==='number'&&Number.isFinite(quote.expiresAt)&&quote.expiresAt>now&&quote.expiresAt<=oldest+RESEARCH_READ_LIMITS.quoteTtlMs;
}
const quoteName=(mint:string,size:number,mode:string)=>`quote:${mint}:${size}:${mode}`;
const PUMP_AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',PUMP_FEES='pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const PUMP_CREATOR_PROGRAM=new Uint8Array([1,86,224,246,147,102,90,207,68,219,21,104,191,23,91,170,81,137,203,151,245,210,255,59,101,93,43,182,253,109,24,176]);
const fieldPrime=(1n<<255n)-19n,mod=(n:bigint)=>(n%fieldPrime+fieldPrime)%fieldPrime;
function power(base:bigint,exponent:bigint){let out=1n;for(base=mod(base);exponent;exponent>>=1n,base=mod(base*base))if(exponent&1n)out=mod(out*base);return out;}
const edwardsD=mod(-121665n*power(121666n,fieldPrime-2n));
function onEdwardsCurve(bytes:Uint8Array){let y=0n;for(let i=31;i>=0;i--)y=(y<<8n)+BigInt(i===31?bytes[i]&127:bytes[i]);if(y>=fieldPrime)return false;const yy=mod(y*y),x2=mod((yy-1n)*power(edwardsD*yy+1n,fieldPrime-2n));return x2===0n||power(x2,(fieldPrime-1n)/2n)===1n;}
async function pdaBytes(seeds:Uint8Array[],program:Uint8Array){const marker=new TextEncoder().encode('ProgramDerivedAddress');for(let bump=255;bump>=0;bump--){const all=new Uint8Array(seeds.reduce((n,s)=>n+s.length,0)+1+32+marker.length);let offset=0;for(const seed of seeds){all.set(seed,offset);offset+=seed.length;}all[offset++]=bump;all.set(program,offset);all.set(marker,offset+32);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',all));if(!onEdwardsCurve(digest))return digest;}throw Error('No valid PDA');}
function encodeAddress(bytes:Uint8Array){const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const byte of bytes)n=(n<<8n)+BigInt(byte);let out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const byte of bytes){if(byte)break;out='1'+out;}return out;}
interface PumpFee {bps:number;asOf:string}
// Prefixes and canonical-pool rule from pump-fun/pump-public-docs:
// idl/pump_amm.json, idl/pump_fees.json and docs/FEE_PROGRAM_README.md.
async function readPumpSellFees(pool:Pool,quote:JupiterQuote,context:ResearchReadContext):Promise<Map<string,PumpFee>>{
 const out=new Map<string,PumpFee>(),mint=researchToken(pool)?.mint;if(!mint||!context.env.SOLANA_RPC)return out;
 const mintRead=await cachedResearchRead<RpcResponse[]>(context.env,'mint:'+mint),mintOwner=Array.isArray(mintRead.data)?mintRead.data.find(r=>r.id===1&&!r.error)?.result?.value?.owner:null,baseProgram=mintRead.status==='available'&&(mintOwner===TOKEN_PROGRAM||mintOwner===TOKEN_2022)?mintOwner:null;
 const addresses=[...new Set((quote.routePlan||[]).filter(r=>r.swapInfo?.label==='Pump.fun Amm').flatMap(r=>r.swapInfo?.ammKey?[r.swapInfo.ammKey]:[]))].slice(0,2);
 for(const address of addresses)try{
  if(!addressBytes(address))continue;const amm=addressBytes(PUMP_AMM)!,feeAddress=encodeAddress(await pdaBytes([new TextEncoder().encode('fee_config'),amm],addressBytes(PUMP_FEES)!)),poolBytes=addressBytes(address)!,expectedBase=addressBytes(mint)!,expectedQuote=addressBytes(RESEARCH_SOL)!,ataProgram=addressBytes('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')!;
  const baseAta=baseProgram?await pdaBytes([poolBytes,addressBytes(baseProgram)!,expectedBase],ataProgram):null,quoteAta=baseProgram?await pdaBytes([poolBytes,addressBytes(TOKEN_PROGRAM)!,expectedQuote],ataProgram):null,accounts=baseAta&&quoteAta?[address,feeAddress,encodeAddress(baseAta),encodeAddress(quoteAta),mint]:[address,feeAddress];
  const read=await readJson<any>(context,{name:'pump-sell-fee:v2:'+address,provider:'Solana RPC',url:context.env.SOLANA_RPC,ttl:RESEARCH_READ_LIMITS.economicQuoteTtlMs,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:6,method:'getMultipleAccounts',params:[accounts,{encoding:'base64',commitment:'confirmed'}]})}});
  const at=Date.parse(read.asOf||'');if(read.status!=='available'||!Number.isFinite(at)||at>Date.now()||Date.now()-at>RESEARCH_READ_LIMITS.economicQuoteTtlMs)continue;
  const [account,config,baseAccount,quoteAccount,mintAccount]=read.data?.result?.value||[],decode=(a:any,owner:string,min:number,discriminator:number[])=>{if(a?.owner!==owner||a.executable||!Array.isArray(a.data)||a.data[1]!=='base64'||typeof a.data[0]!=='string')return null;const bytes=Uint8Array.from(atob(a.data[0]),c=>c.charCodeAt(0));return bytes.length>=min&&discriminator.every((v,i)=>bytes[i]===v)?bytes:null;};
  const bytes=decode(account,PUMP_AMM,243,[241,154,109,4,17,177,109,188]),fees=decode(config,PUMP_FEES,65,[143,52,146,187,219,123,76,155]);if(!bytes||!fees)continue;
  if(!expectedBase.every((v,i)=>bytes[43+i]===v)||!expectedQuote.every((v,i)=>bytes[75+i]===v))continue;
  const canonical=await pdaBytes([new TextEncoder().encode('pool-authority'),expectedBase],PUMP_CREATOR_PROGRAM),isCanonical=canonical.every((v,i)=>bytes[11+i]===v),poolView=new DataView(bytes.buffer);
  if(bytes[243]||bytes.length>=269&&poolView.getBigUint64(261,true)>0n)continue;
  const view=new DataView(fees.buffer),hasCoinCreator=bytes.slice(211,243).some(v=>v!==0);let feeOffset=41;
  if(isCanonical){
   if(!baseProgram||!baseAta||!quoteAta||!baseAta.every((v,i)=>bytes[139+i]===v)||!quoteAta.every((v,i)=>bytes[171+i]===v))continue;
   const base=decode(baseAccount,baseProgram,165,[]),quote=decode(quoteAccount,TOKEN_PROGRAM,165,[]),mintBytes=decode(mintAccount,baseProgram,82,[]);if(!base||!quote||!mintBytes||mintBytes[45]!==1||mintBytes[44]>18)continue;
   if(!expectedBase.every((v,i)=>base[i]===v)||!expectedQuote.every((v,i)=>quote[i]===v)||![base,quote].every(v=>poolBytes.every((b,i)=>v[32+i]===b)&&v[108]===1))continue;
   const baseReserve=new DataView(base.buffer).getBigUint64(64,true),quoteReserve=new DataView(quote.buffer).getBigUint64(64,true),supply=new DataView(mintBytes.buffer).getBigUint64(36,true),virtual=bytes.length>=261?(BigInt(poolView.getBigInt64(253,true))<<64n)+poolView.getBigUint64(245,true):0n;
   if(baseReserve===0n||supply===0n||virtual<0n||fees.length<69)continue;
   const marketCap=(quoteReserve+virtual)*supply/baseReserve,count=view.getUint32(65,true);if(count<1||count>128||fees.length<69+count*40)continue;
   let previous=-1n;feeOffset=85;for(let i=0;i<count;i++){const offset=69+i*40,threshold=view.getBigUint64(offset,true)+(view.getBigUint64(offset+8,true)<<64n);if(threshold<=previous)throw Error('Unordered Pump fee tiers');previous=threshold;if(i===0||marketCap>=threshold)feeOffset=offset+16;}
  }
  const bps=Number(view.getBigUint64(feeOffset,true)+view.getBigUint64(feeOffset+8,true)+(hasCoinCreator?view.getBigUint64(feeOffset+16,true):0n));if(Number.isSafeInteger(bps)&&bps>0&&bps<10000)out.set(address,{bps,asOf:read.asOf!});
 }catch{/* Missing or unsupported real fee evidence uses the explicit assumption. */}
 return out;
}
function routeFeeFloor(pool:Pool,quote:JupiterQuote,token:{mint:string;priceSol:number|null}|null,decimals:number|null,grossValueSol:number|null,pumpFees=new Map<string,PumpFee>()):{sol:number|null;source:'jupiter-route'|'pool-config'|'pump-config'|'assumed'|null;asOf?:string|null}{
 const configBase=number(pool.poolConfig?.baseFee??pool.feeTier),configDynamic=number(pool.poolConfig?.dynamicFee),configFee=configBase!=null?configBase+(configDynamic??0):null;
 const value=(mint:unknown,amount:unknown):number|null=>{if(!raw(amount))return null;const n=Number(amount),scaled=mint===RESEARCH_SOL?n/1e9:mint===token?.mint&&positive(token?.priceSol)&&decimals!=null&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18?n/10**decimals*token.priceSol:null;return valid(scaled)?scaled:null;};
 let total=0,missing=false,feeAsOf:string|null=null,source:'jupiter-route'|'pool-config'|'pump-config'|'assumed'='jupiter-route';
 for(const route of quote.routePlan||[]){
  const info=route.swapInfo,fee=value(info?.feeMint,info?.feeAmount);
  // feeAmount is already the actual raw amount for this route leg. percent/bps
  // describe route allocation and must not discount that amount a second time.
  if(fee!=null&&(fee>0||configFee===0)){total+=fee;continue;}
  missing=true;
  const pump=info?.ammKey?pumpFees.get(info.ammKey):null,matched=info?.ammKey===pool.address,feeRate=pump?pump.bps/10000:matched&&configFee!=null&&configFee>0&&configFee<1?configFee:.005;
  if(pump&&(!feeAsOf||Date.parse(pump.asOf)<Date.parse(feeAsOf)))feeAsOf=pump.asOf;
  const fallbackSource=pump?'pump-config':matched&&configFee!=null&&configFee>0&&configFee<1?'pool-config':'assumed';source=source==='assumed'||fallbackSource==='assumed'?'assumed':fallbackSource;
  const legValue=value(info?.inputMint,info?.inAmount),percent=number(route.percent),bps=number(route.bps),share=bps!=null&&bps<=10000?bps/10000:percent!=null&&percent<=100?percent/100:1;
  const fallbackValue=legValue??(valid(grossValueSol)?grossValueSol*share:null);
  if(fallbackValue==null)return {sol:valid(total)&&total>0?total:null,source:total>0?'jupiter-route':null};
  // Pump charges its configured fees in quote SOL. A better-priced alternate
  // venue can return more SOL than this selected-pool mark; gross up its actual
  // net output so that favourable pricing cannot understate the absolute fee.
  // Three lamports conservatively allow one rounding step per fee component.
  const netSol=pump&&info?.outputMint===RESEARCH_SOL&&raw(info.outAmount)?Number(info.outAmount)/1e9:null;
  total+=netSol!=null&&valid(netSol)?Math.max(fallbackValue*feeRate,netSol*feeRate/(1-feeRate)+3e-9):fallbackValue*feeRate;
 }
 return {sol:valid(total)?total:null,source:valid(total)?missing?source:'jupiter-route':null,asOf:feeAsOf};
}
function quoteResult(pool:Pool,sizeSol:number,mode:'best'|'dlmm',read:ResearchRead<QuotePair>,decimals:number|null,pumpFees=new Map<string,PumpFee>()):ResearchQuote{
 const p=researchToken(pool),data=read.data;
 const amount=String(Math.round(sizeSol*1e9));
 const coherent=!!p&&!!data&&data.buy.inputMint===RESEARCH_SOL&&data.buy.outputMint===p.mint&&data.buy.inAmount===amount&&raw(data.buy.outAmount)&&BigInt(data.buy.outAmount)>0n&&data.sell.inputMint===p.mint&&data.sell.outputMint===RESEARCH_SOL&&data.sell.inAmount===data.buy.outAmount&&raw(data.sell.outAmount);
 const routesValid=coherent&&[data!.buy,data!.sell].every(q=>Array.isArray(q.routePlan)&&q.routePlan.length>0&&q.routePlan.every(r=>r.swapInfo?.ammKey&&(mode!=='dlmm'||r.swapInfo?.label==='Meteora DLMM')));
 const fresh=researchQuoteFresh({asOf:read.asOf,buyAsOf:data?.buyAsOf,sellAsOf:data?.sellAsOf,expiresAt:read.expiresAt});
 const quoted=read.status==='available'&&coherent&&routesValid&&fresh;
 const status=quoted?'quoted':read.status==='available'?coherent&&routesValid&&!fresh?'stale':'unavailable':read.status;
 const routes=(q:JupiterQuote|undefined)=>[...new Set((q?.routePlan||[]).flatMap(r=>r.swapInfo?.ammKey?[r.swapInfo.ammKey]:[]))];
 const buyRoutePools=routes(data?.buy),sellRoutePools=routes(data?.sell);
 const returnedSol=coherent?Number(data!.sell.outAmount)/1e9:null;
 const sellValue=coherent&&p?.priceSol&&decimals!=null&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18?Number(data!.buy.outAmount)/10**decimals*p.priceSol:null;
 const sellFee=coherent?routeFeeFloor(pool,data!.sell,p,decimals,sellValue,pumpFees):{sol:null,source:null,asOf:null};
 const exitCost=quoted&&sellValue!=null&&returnedSol!=null?Math.max(sellFee.sol??0,sellValue-returnedSol):null;
 // Jupiter's returned amount already nets both swap fees. Adding a separate
 // configured-fee floor here would double count or misprice alternate venues.
 const roundTripCost=quoted&&returnedSol!=null?Math.max(0,sizeSol-returnedSol):null;
 const selectedPoolMatched=coherent?buyRoutePools.includes(pool.address)&&sellRoutePools.includes(pool.address):null;
 const scope=mode==='dlmm'?'Meteora DLMM routes; the selected pool is not guaranteed.':'Jupiter best route across supported venues.';
 return {sizeSol,mode,status,roundTripCostSol:roundTripCost,exitCostSol:exitCost,exitFeeFloorSol:sellFee.sol,exitFeeSource:sellFee.source,exitFeeAsOf:sellFee.asOf??null,asOf:read.asOf,buyAsOf:data?.buyAsOf??null,sellAsOf:data?.sellAsOf??null,expiresAt:read.expiresAt??null,note:(quoted?scope+' Buy then sell the quoted returned tokens. Round-trip cost is the actual net SOL loss from both legs; exit cost never falls below the sell-route fee floor. '+(sellFee.source==='pump-config'?'Sell-fee floor uses dated verified PumpSwap flat or market-cap-tier fee configuration at '+sellFee.asOf+'. ':sellFee.source==='assumed'?'Sell-fee floor is an explicitly assumed 0.5% where the actual route fee could not be verified. ':sellFee.source==='pool-config'?'Missing sell-route fee metadata uses the dated matched selected-pool base/dynamic fee conservatively. ':'Sell-route raw fee amounts are valued once, without reweighting split percentages. ')+'Network fees, LP rent, deposit/withdrawal transfer fees and future price movement are excluded.':status==='stale'?'Both dated quote legs must be current within 45 seconds; conversion cost is unavailable after either leg expires.':read.status==='available'?'Quote identities, amounts or requested venue routes could not be verified.':read.note),selectedPoolMatched,buyRoutePools,sellRoutePools,buyPriceImpact:number(data?.buy.priceImpactPct),sellPriceImpact:number(data?.sell.priceImpactPct),slippageBps:50,inputRaw:coherent?data!.buy.inAmount:null,tokenRaw:coherent?data!.buy.outAmount:null,returnedSol:quoted?returnedSol:null};
}
export async function cachedResearchQuotes(pool:Pool,env:Env,decimals:number|null=null):Promise<ResearchQuote[]>{
 const token=researchToken(pool);
 return await Promise.all([.5,1].flatMap(size=>(['best','dlmm'] as const).map(async mode=>await economicQuote(pool,env,size,mode)||quoteResult(pool,size,mode,token?await cachedResearchRead<QuotePair>(env,quoteName(token.mint,size,mode)):unknown('SOL-pair quotes are unsupported for this pool.','unsupported'),decimals))));
}
export async function readResearchQuotes(pool:Pool,context:ResearchReadContext,decimals:number|null=null,quoteMark?:ResearchQuoteMark|null):Promise<ResearchQuote[]>{
 if(quoteMark!==undefined){
  const token=researchToken(pool),markAt=Date.parse(quoteMark?.asOf||''),markGood=quoteMark?.source==='active-bin'&&positive(quoteMark.priceSol)&&Number.isFinite(markAt)&&markAt<=Date.now()&&Date.now()-markAt<=RESEARCH_READ_LIMITS.anchorTtlMs;
  // Production explicitly passes a verified active-bin reference or null. A
  // missing anchor may not silently fall back to the catalogue's older mark.
  pool=markGood&&token?{...pool,priceQuote:token.solX?1/quoteMark!.priceSol:quoteMark!.priceSol,fetchedAt:quoteMark!.asOf}:{...pool,priceQuote:null,priceUsd:null,quotePriceUsd:null};
 }
 const token=researchToken(pool);
 if(!token)return cachedResearchQuotes(pool,context.env,decimals);
 return await Promise.all([.5,1].flatMap(size=>(['best','dlmm'] as const).map(async mode=>{
  const economic=await economicQuote(pool,context.env,size,mode);if(economic&&researchEconomicQuoteFresh(economic)){context.cacheHits++;return economic;}
  const retain=(output:ResearchQuote):ResearchQuote=>economic?{...economic,status:output.status,roundTripCostSol:null,exitCostSol:null,returnedSol:null,note:output.note+' Last good dated economic estimate retained.',economicEstimate:{...economic.economicEstimate!,status:'stale',retained:true,cached:true,note:'Last good dated economic estimate retained while refresh is unavailable. '+economic.economicEstimate!.note}}:output;
  const name=quoteName(token.mint,size,mode),cached=await cachedResearchRead<QuotePair>(context.env,name);
  if(cached.status==='available'){const pumpFees=cached.data?.sell?await readPumpSellFees(pool,cached.data.sell,context):new Map<string,PumpFee>(),output=quoteResult(pool,size,mode,cached,decimals,pumpFees);if(output.status==='quoted')return rememberEconomicQuote(pool,context.env,output,decimals);}
  const get=async(input:string,output:string,amount:string,leg:string)=>{
   const query=new URLSearchParams({inputMint:input,outputMint:output,amount,swapMode:'ExactIn',slippageBps:'50'});
   if(mode==='dlmm')query.set('dexes','Meteora DLMM');
   return readJson<JupiterQuote>(context,{name:name+':'+leg,provider:'Jupiter',url:'https://api.jup.ag/swap/v1/quote?'+query,ttl:RESEARCH_READ_LIMITS.quoteTtlMs,init:{headers:{accept:'application/json',...(context.env.JUPITER_API_KEY?{'x-api-key':context.env.JUPITER_API_KEY}:{})}}});
  };
  const buy=await get(RESEARCH_SOL,token.mint,String(Math.round(size*1e9)),'buy');
  if(buy.status!=='available'||!buy.data||buy.data.inputMint!==RESEARCH_SOL||buy.data.outputMint!==token.mint||buy.data.inAmount!==String(Math.round(size*1e9))||!raw(buy.data.outAmount)||BigInt(buy.data.outAmount)<=0n)return retain(quoteResult(pool,size,mode,{...buy,data:null},decimals));
  // The sell input is the exact raw output of this buy, not the original SOL input.
  const sell=await get(token.mint,RESEARCH_SOL,buy.data.outAmount,'sell:'+buy.data.outAmount);
  const buyAt=buy.asOf?Date.parse(buy.asOf):NaN,sellAt=sell.asOf?Date.parse(sell.asOf):NaN,oldest=Math.min(buyAt,sellAt),expiresAt=Math.min(buy.expiresAt??NaN,sell.expiresAt??NaN);
  const result:ResearchRead<QuotePair>={...sell,asOf:Number.isFinite(oldest)?new Date(oldest).toISOString():null,expiresAt,data:sell.data?{buy:buy.data,sell:sell.data,buyAsOf:buy.asOf,sellAsOf:sell.asOf}:null};
  const pumpFees=sell.status==='available'&&sell.data?await readPumpSellFees(pool,sell.data,context):new Map<string,PumpFee>(),output=quoteResult(pool,size,mode,result,decimals,pumpFees);
  if(output.status==='quoted')await saveRead(context.env,name,{data:result.data,at:result.asOf!,expiresAt,status:'available',note:output.note},RESEARCH_READ_LIMITS.quoteTtlMs);
  if(output.status==='quoted'){const remembered=await rememberEconomicQuote(pool,context.env,output,decimals);return remembered.economicEstimate?remembered:retain(remembered);}
  return retain(output);
 })));
}

export interface ResearchFlag {code:string;label:string;source:'RPC'|'RugCheck'|'DexScreener';severity:'info'|'attention';asOf:string|null}
export interface ResearchHolderSample {status:ResearchReadStatus;asOf:string|null;mint:string;supplyRaw:string|null;accounts:{address:string;owner:string;amountRaw:string}[];complete:boolean}
export interface MintSafety {
 status:ResearchReadStatus;asOf:string|null;note:string;mint:string|null;tokenProgram:string|null;mintAuthority:string|null;freezeAuthority:string|null;decimals:number|null;extensions:string[];
 transferFeeStatus:'known'|'none'|'unknown';transferFee:{epoch:number;bps:number;maximumRaw:string;maximumTokens:number|null;configAuthority:string|null;withdrawAuthority:string|null}|null;
 concentration:{accountCount:number;top1Fraction:number|null;top10Fraction:number|null;top20Fraction:number|null;label:string;holders:{status:ResearchReadStatus;asOf:string|null;count:number;top1Fraction:number|null;top10Fraction:number|null;sampleFraction:number|null;label:string}}|null;
 holderSample?:ResearchHolderSample;
 flags:ResearchFlag[];
}
interface RpcResponse {id:number;result?:any;error?:unknown}
const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
interface OwnerRead {addresses:string[];response:{result?:{value?:any[]};error?:unknown}}
function mintSafety(read:ResearchRead<RpcResponse[]>,mint:string,owners:ResearchRead<OwnerRead>=unknown('Largest-account owner aggregation not checked.')):MintSafety{
 const rows=Array.isArray(read.data)?read.data:[],result=(id:number)=>rows.find(r=>r.id===id&&!r.error)?.result;
 const account=result(1)?.value,parsed=account?.data?.parsed,info=parsed?.type==='mint'?parsed.info:null,epoch=number(result(2)?.epoch),largest=result(3)?.value;
 const tokenProgram=typeof account?.owner==='string'?account.owner:null;
 const status=read.status==='available'&&!info?'unavailable':read.status;
 const flags:ResearchFlag[]=[],add=(code:string,label:string,severity:'info'|'attention'='attention')=>flags.push({code,label,source:'RPC',severity,asOf:read.asOf});
 const extensions:any[]=Array.isArray(info?.extensions)?info.extensions:[],names=extensions.map(e=>String(e.extension||e.extensionType||'unknown'));
 const decimals=number(info?.decimals),authority=(v:unknown)=>typeof v==='string'&&v.length?v:null;
 const mintAuthority=authority(info?.mintAuthority),freezeAuthority=authority(info?.freezeAuthority);
 if(info&&mintAuthority)add('mint-authority','Mint authority is active.');
 if(info&&freezeAuthority)add('freeze-authority','Freeze authority is active.');
 if(info&&tokenProgram!==TOKEN_PROGRAM&&tokenProgram!==TOKEN_2022)add('token-program','Mint belongs to an unrecognised token program.');
 for(const e of extensions){const name=String(e.extension||e.extensionType||'unknown'),state=e.state||{};
  if(/permanentDelegate/i.test(name)&&state.delegate)add('permanent-delegate','Permanent delegate can transfer or burn tokens.');
  if(/transferHook/i.test(name))add('transfer-hook','Transfer hook can impose additional transfer behaviour.');
  if(/nonTransferable/i.test(name))add('non-transferable','Non-transferable token extension is present.');
  if(/defaultAccountState/i.test(name)&&/frozen/i.test(String(state.state)))add('default-frozen','New token accounts default to frozen.');
  if(/confidential/i.test(name))add('confidential-extension','Confidential transfer extension requires separate accounting.');
 }
 const feeConfig=extensions.find(e=>/transferFeeConfig/i.test(String(e.extension||e.extensionType)))?.state;
 let transferFee:MintSafety['transferFee']=null,transferFeeStatus:MintSafety['transferFeeStatus']=info&&(tokenProgram===TOKEN_PROGRAM||tokenProgram===TOKEN_2022&&Array.isArray(info.extensions))?'none':'unknown';
 if(feeConfig){transferFeeStatus='unknown';const older=feeConfig.olderTransferFee,newer=feeConfig.newerTransferFee,newEpoch=number(newer?.epoch),chosen=epoch!=null&&newEpoch!=null?(epoch>=newEpoch?newer:older):null;
  const bps=number(chosen?.transferFeeBasisPoints),maximumRaw=raw(chosen?.maximumFee)?chosen.maximumFee:Number.isSafeInteger(chosen?.maximumFee)&&chosen.maximumFee>=0?String(chosen.maximumFee):null;
  if(epoch!=null&&bps!=null&&Number.isInteger(bps)&&bps<=10000&&maximumRaw){transferFeeStatus='known';transferFee={epoch,bps,maximumRaw,maximumTokens:decimals!=null?Number(maximumRaw)/10**decimals:null,configAuthority:authority(feeConfig.transferFeeConfigAuthority),withdrawAuthority:authority(feeConfig.withdrawWithheldAuthority)};add('transfer-fee',`Current epoch transfer fee ${bps/100}% with a maximum raw fee cap of ${maximumRaw}.`,'info');}
  else add('transfer-fee-unknown','Transfer fee extension present; current epoch policy could not be verified.');
  if(feeConfig.transferFeeConfigAuthority)add('transfer-fee-authority','Transfer fee configuration authority is active.');
 }
 let concentration:MintSafety['concentration']=null;
 const supply=raw(info?.supply)?BigInt(info.supply):null;
 if(supply!=null&&supply>0n&&Array.isArray(largest)&&largest.length>0&&largest.every(a=>raw(a.amount))){const accounts=largest.slice(0,20).sort((a,b)=>BigInt(a.amount)>BigInt(b.amount)?-1:BigInt(a.amount)<BigInt(b.amount)?1:0);const fraction=(n:number)=>Number(accounts.slice(0,n).reduce((sum,a)=>sum+BigInt(a.amount),0n)*1000000000n/supply)/1e9;
  const grouped=new Map<string,bigint>();
  for(const [i,account] of (owners.data?.response?.result?.value||[]).entries()){
   const parsed=account?.data?.parsed,details=parsed?.type==='account'?parsed.info:null,address=owners.data?.addresses[i];
   const amount=details?.tokenAmount?.amount;
   if(address&&accounts.some(a=>a.address===address)&&details?.mint===mint&&typeof details.owner==='string'&&raw(amount))grouped.set(details.owner,(grouped.get(details.owner)||0n)+BigInt(amount));
  }
  const holderAmounts=[...grouped.values()].sort((a,b)=>a>b?-1:a<b?1:0),holderFraction=(n:number)=>Number(holderAmounts.slice(0,n).reduce((sum,a)=>sum+a,0n)*1000000000n/supply)/1e9;
  const holderStatus=owners.status==='available'&&!holderAmounts.length?'unavailable':owners.status;
  concentration={accountCount:accounts.length,top1Fraction:fraction(1),top10Fraction:fraction(10),top20Fraction:fraction(20),label:'Largest token accounts / mint supply. Accounts are not distinct holders; pool vaults and custodians are included.',holders:{status:holderStatus,asOf:owners.asOf,count:holderAmounts.length,top1Fraction:holderAmounts.length?holderFraction(1):null,top10Fraction:holderAmounts.length?holderFraction(10):null,sampleFraction:holderAmounts.length?holderFraction(holderAmounts.length):null,label:'Owner-grouped balances within the sampled largest twenty token accounts only; lower bounds on holder concentration, not a full holder census. Vaults and custodians are included.'}};
  if(concentration.top10Fraction!>=.5)add('account-concentration','Largest ten token accounts hold at least 50% of supply; this is not an owner-level holder count.');
  if(holderStatus==='available'&&concentration.holders.top1Fraction!>=.5)add('holder-concentration','A sampled owner controls at least 50% of mint supply; owner grouping is limited to the largest twenty token accounts.');
 }
 // Keep the small RPC account sample so downstream checks can exclude known
 // vaults before grouping by owner. Never infer a complete owner census from
 // a low top-20 concentration: only exact coverage of mint supply proves it.
 const sampleAccounts:ResearchHolderSample['accounts']=[],seen=new Set<string>();
 let sampleValid=read.status==='available'&&owners.status==='available'&&!owners.data?.response?.error&&supply!==null&&supply>0n&&Array.isArray(largest)&&largest.length>0&&largest.length<=20&&Array.isArray(owners.data?.response?.result?.value)&&owners.data!.response.result!.value!.length===owners.data!.addresses.length;
 if(sampleValid)for(const a of largest){
  const index=owners.data!.addresses.indexOf(a.address),account=index>=0?owners.data!.response.result!.value![index]:null,details=account?.data?.parsed?.type==='account'?account.data.parsed.info:null;
  if(!addressBytes(a.address)||seen.has(a.address)||account?.owner!==tokenProgram||details?.mint!==mint||!addressBytes(details?.owner)||!raw(details?.tokenAmount?.amount)||!raw(a.amount)||details.tokenAmount.amount!==a.amount){sampleValid=false;break;}
  seen.add(a.address);sampleAccounts.push({address:a.address,owner:details.owner,amountRaw:details.tokenAmount.amount});
 }
 const sampled=sampleAccounts.reduce((sum,a)=>sum+BigInt(a.amountRaw),0n),sampleDates=[Date.parse(read.asOf||''),Date.parse(owners.asOf||'')];
 if(supply===null||sampled>supply||sampleDates.some(t=>!Number.isFinite(t)||t>Date.now()||Date.now()-t>RESEARCH_READ_LIMITS.mintTtlMs))sampleValid=false;
 const holderSample:ResearchHolderSample={status:sampleValid?'available':'unavailable',asOf:sampleDates.every(Number.isFinite)?new Date(Math.min(...sampleDates)).toISOString():null,mint,supplyRaw:supply===null?null:String(supply),accounts:sampleValid?sampleAccounts:[],complete:sampleValid&&sampled===supply};
 return {status,asOf:read.asOf,note:info?read.note:'Parsed mint data unavailable for '+mint+'.',mint:info?mint:null,tokenProgram,mintAuthority,freezeAuthority,decimals,extensions:names,transferFeeStatus,transferFee,concentration,holderSample,flags};
}
export async function cachedMintSafety(mint:string,env:Env):Promise<MintSafety>{const [mintRead,owners]=await Promise.all([cachedResearchRead<RpcResponse[]>(env,'mint:'+mint),cachedResearchRead<OwnerRead>(env,'mint-owners:'+mint)]);return mintSafety(mintRead,mint,owners);}
export async function readMintSafety(mint:string,context:ResearchReadContext):Promise<MintSafety>{
 const body=[{jsonrpc:'2.0',id:1,method:'getAccountInfo',params:[mint,{encoding:'jsonParsed',commitment:'confirmed'}]},{jsonrpc:'2.0',id:2,method:'getEpochInfo',params:[{commitment:'confirmed'}]},{jsonrpc:'2.0',id:3,method:'getTokenLargestAccounts',params:[mint,{commitment:'confirmed'}]}];
 const read=await readJson<RpcResponse[]>(context,{name:'mint:'+mint,provider:'Solana RPC',url:context.env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',ttl:RESEARCH_READ_LIMITS.mintTtlMs,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}});
 let owners=await cachedResearchRead<OwnerRead>(context.env,'mint-owners:'+mint);
 const largest=Array.isArray(read.data)?read.data.find(r=>r.id===3&&!r.error)?.result?.value:null;
 const addresses=Array.isArray(largest)?largest.slice(0,20).flatMap((r:any)=>typeof r.address==='string'?[r.address]:[]):[];
 if(read.status==='available'&&addresses.length&&owners.status!=='available'){
  const request=await readJson<OwnerRead['response']>(context,{name:'mint-owner-request:'+mint,provider:'Solana RPC',url:context.env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',ttl:RESEARCH_READ_LIMITS.mintTtlMs,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:4,method:'getMultipleAccounts',params:[addresses,{encoding:'jsonParsed',commitment:'confirmed'}]})}});
  owners={...request,data:request.data?{addresses,response:request.data}:null};
  if(request.status==='available'&&request.asOf)await saveRead(context.env,'mint-owners:'+mint,{data:owners.data,at:request.asOf,expiresAt:Date.now()+RESEARCH_READ_LIMITS.mintTtlMs,status:'available',note:request.note},RESEARCH_READ_LIMITS.mintTtlMs);
 }
 return mintSafety(read,mint,owners);
}

export interface ResearchRangeAnchor {
 status:ResearchReadStatus;asOf:string|null;activeBinId:number|null;activeBinPriceSol:number|null;binStep:number|null;slot:number|null;minNativeBinId:number|null;maxNativeBinId:number|null;note:string;
}
// Fixed prefix from the installed @meteora-ag/dlmm 1.9.14 LbPair IDL. The
// regression fixture is encoded with its BorshAccountsCoder and checks every
// offset/discriminator below. Decode only these fixed fields to avoid bringing
// the SDK's wallet/network runtime into the research Worker.
export const RESEARCH_LB_PAIR_LAYOUT=Object.freeze({owner:'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',bytes:904,discriminator:[33,11,49,98,181,101,177,13],minBin:24,maxBin:28,activeId:76,binStep:80,mintX:88,mintY:120});
function addressBytes(address:string):Uint8Array|null{
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 if(typeof address!=='string'||address.length<32||address.length>44)return null;
 let value=0n;
 for(const c of address){const digit=alphabet.indexOf(c);if(digit<0)return null;value=value*58n+BigInt(digit);}
 const bytes=new Uint8Array(32);
 for(let i=31;i>=0;i--){bytes[i]=Number(value&255n);value>>=8n;}
 if(value!==0n)return null;
 const leading=address.length-address.replace(/^1+/,'').length;
 const encodedBytes=bytes.findIndex(n=>n!==0);
 if(leading!==(encodedBytes<0?32:encodedBytes))return null;
 return bytes;
}
interface ActiveBinRpc {error?:unknown;result?:{context?:{slot?:number};value?:{owner?:string;executable?:boolean;data?:unknown}}}
function rangeAnchor(pool:Pool,mint:MintSafety,read:ResearchRead<ActiveBinRpc>):ResearchRangeAnchor{
 const empty=(note:string,status:ResearchReadStatus='unknown'):ResearchRangeAnchor=>({status,asOf:read.asOf,activeBinId:null,activeBinPriceSol:null,binStep:null,slot:null,minNativeBinId:null,maxNativeBinId:null,note});
 if(read.status!=='available')return empty(read.note,read.status);
 const asOf=read.asOf?Date.parse(read.asOf):NaN,now=Date.now();
 if(!Number.isFinite(asOf)||asOf>now||now-asOf>RESEARCH_READ_LIMITS.anchorTtlMs)return empty('Active-bin RPC observation is stale or has an invalid date.','stale');
 const token=researchToken(pool),mintAt=mint.asOf?Date.parse(mint.asOf):NaN;
 if(!token||mint.mint!==token.mint||mint.status!=='available'||!Number.isFinite(mintAt)||mintAt>now||now-mintAt>RESEARCH_READ_LIMITS.mintTtlMs||!Number.isInteger(mint.decimals)||mint.decimals!<0||mint.decimals!>18||![TOKEN_PROGRAM,TOKEN_2022].includes(mint.tokenProgram||''))return empty('Verified fresh paired-token mint decimals are unavailable.');
 const account=read.data?.result?.value,slot=read.data?.result?.context?.slot,data=account?.data;
 if(read.data?.error||!account||account.owner!==RESEARCH_LB_PAIR_LAYOUT.owner||account.executable!==false||!Number.isSafeInteger(slot)||slot!<0||!Array.isArray(data)||data[1]!=='base64'||typeof data[0]!=='string')return empty('RPC pool account owner, context or binary encoding could not be verified.','unavailable');
 try{
  if(data[0].length>Math.ceil(RESEARCH_LB_PAIR_LAYOUT.bytes/3)*4)return empty('RPC pool account has an unsupported LbPair layout.','unavailable');
  const binary=atob(data[0]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length!==RESEARCH_LB_PAIR_LAYOUT.bytes||!RESEARCH_LB_PAIR_LAYOUT.discriminator.every((v,i)=>bytes[i]===v))return empty('RPC pool account has an unsupported LbPair discriminator or length.','unavailable');
  const expectedX=addressBytes(pool.base.address),expectedY=addressBytes(pool.quote.address);
  if(!expectedX||!expectedY||!expectedX.every((v,i)=>bytes[RESEARCH_LB_PAIR_LAYOUT.mintX+i]===v)||!expectedY.every((v,i)=>bytes[RESEARCH_LB_PAIR_LAYOUT.mintY+i]===v))return empty('RPC pool token X/Y identities do not match this exact pool.','unavailable');
  const view=new DataView(bytes.buffer),activeBinId=view.getInt32(RESEARCH_LB_PAIR_LAYOUT.activeId,true),binStep=view.getUint16(RESEARCH_LB_PAIR_LAYOUT.binStep,true),minNativeBinId=view.getInt32(RESEARCH_LB_PAIR_LAYOUT.minBin,true),maxNativeBinId=view.getInt32(RESEARCH_LB_PAIR_LAYOUT.maxBin,true),reportedStep=pool.poolConfig?.binStep;
  if(binStep<=0||binStep>10000||reportedStep!=null&&(!Number.isInteger(reportedStep)||reportedStep!==binStep)||minNativeBinId>=maxNativeBinId||activeBinId<minNativeBinId||activeBinId>maxNativeBinId)return empty('RPC bin step or active ID is inconsistent with pool configuration and protocol bounds.','unavailable');
  // IDL/SDK bin grid is raw token-Y units per raw token-X unit. Convert the
  // decimal scale, then invert only for SOL on X. IDs retain native orientation.
  const decimalDelta=token.solX?9-mint.decimals!:mint.decimals!-9,logHuman=activeBinId*Math.log1p(binStep/10000)+decimalDelta*Math.LN10;
  const activeBinPriceSol=Math.exp(token.solX?-logHuman:logHuman);
  if(!positive(activeBinPriceSol)||!positive(1/activeBinPriceSol))return empty('Active-bin price is outside the supported finite numeric range.','unavailable');
  return {status:'available',asOf:read.asOf,activeBinId,activeBinPriceSol,binStep,slot:slot!,minNativeBinId,maxNativeBinId,note:'Confirmed read-only RPC LbPair account; exact native bin ID and token identities. Human SOL/token price follows the bin grid with verified decimals; display precision is floating point. The active bin may move after this timestamp.'};
 }catch{return empty('RPC LbPair binary data could not be decoded.','unavailable');}
}
export async function readResearchRangeAnchor(pool:Pool,context:ResearchReadContext,mint:MintSafety,forceFresh=false):Promise<ResearchRangeAnchor>{
 if(pool.venue!=='meteora-dlmm'||!researchToken(pool)||!addressBytes(pool.address)||!context.env.SOLANA_RPC)return {status:'unknown',asOf:null,activeBinId:null,activeBinPriceSol:null,binStep:null,slot:null,minNativeBinId:null,maxNativeBinId:null,note:'An exact Meteora SOL-pair address and configured read-only Solana RPC are required.'};
 const body={jsonrpc:'2.0',id:5,method:'getAccountInfo',params:[pool.address,{encoding:'base64',commitment:'confirmed'}]};
 const read=await readJson<ActiveBinRpc>(context,{name:'active-bin:'+pool.address,provider:'Solana RPC',url:context.env.SOLANA_RPC,ttl:RESEARCH_READ_LIMITS.anchorTtlMs,forceFresh,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}});
 return rangeAnchor(pool,mint,read);
}

export interface ResearchHolderExclusions {status:'available'|'unavailable';mint:string;asOf:string|null;addresses:string[];note:string}
export interface RugSafety {status:ResearchReadStatus;asOf:string|null;score:number|null;risks:{name:string;level:string;description:string}[];note:string;flags:ResearchFlag[];mint?:string|null;detectedAt?:string|null;holderExclusions?:ResearchHolderExclusions}
// Provider classifications are exact reported addresses, not guessed program
// IDs. CREATOR/custodian labels never exclude a holder. See RugCheck's public
// /v1/tokens/{mint}/report: knownAccounts and mint-side market vault records.
function rugHolderExclusions(body:any,mint:string,verified:boolean,read:ResearchRead<any>):ResearchHolderExclusions{
 const known=body?.knownAccounts,markets=body?.markets,classified=verified&&read.status==='available'&&((known&&typeof known==='object'&&!Array.isArray(known))||Array.isArray(markets)),addresses=new Set<string>();
 const add=(v:unknown)=>{if(typeof v==='string'&&addressBytes(v))addresses.add(v);};
 if(classified){
  for(const [address,value] of Object.entries(known||{}).slice(0,2048))if(['AMM','POOL','LOCKER','BURN'].includes(String((value as any)?.type||'').toUpperCase()))add(address);
  for(const market of (Array.isArray(markets)?markets:[]).slice(0,256))for(const side of ['A','B']){
   const account=market?.['liquidity'+side+'Account'];
   if(market?.['mint'+side]===mint&&account?.mint===mint&&addressBytes(market?.pubkey)&&addressBytes(market?.['liquidity'+side])&&addressBytes(account?.owner)){
    // A market record proves only this vault address. Its authority may
    // also control personal accounts, so owner-wide exclusion needs an
    // independent knownAccounts classification.
    add(market['liquidity'+side]);
   }
  }
 }
 return {status:classified?'available':'unavailable',mint,asOf:read.asOf,addresses:[...addresses],note:classified?'Exact AMM, pool, burn and locker addresses classified by the mint-matched RugCheck report; unrecognised accounts are retained.':'Mint-matched pool, burn and locker classifications are unavailable.'};
}
function rugSafety(read:ResearchRead<any>,mint:string):RugSafety{
 const body=read.data,reported=body?.mint||body?.token?.mint,verified=reported===mint,risks:RugSafety['risks']=verified&&Array.isArray(body.risks)?body.risks.slice(0,30).map((r:any)=>({name:String(r.name||'Reported risk'),level:String(r.level||'unknown'),description:String(r.description||'')})):[];
 const status=read.status==='available'&&!verified?'unavailable':read.status;
 return {status,asOf:read.asOf,mint:verified?mint:null,detectedAt:verified&&typeof body.detectedAt==='string'&&Number.isFinite(Date.parse(body.detectedAt))&&Date.parse(body.detectedAt)<=Date.parse(read.asOf||'')?body.detectedAt:null,holderExclusions:rugHolderExclusions(body,mint,verified,read),score:verified?number(body.score_normalised??body.score):null,risks,note:verified?'RugCheck second opinion; this is not a safety guarantee. '+read.note:read.status==='available'?'RugCheck token identity could not be verified.':read.note,flags:risks.map(r=>({code:'rugcheck-risk',label:r.name,source:'RugCheck',severity:/danger|warn/i.test(r.level)?'attention':'info',asOf:read.asOf}))};
}
export async function cachedRugSafety(mint:string,env:Env):Promise<RugSafety>{return rugSafety(await cachedResearchRead(env,'rug:'+mint),mint);}
export async function readRugSafety(mint:string,context:ResearchReadContext):Promise<RugSafety>{return rugSafety(await readJson(context,{name:'rug:'+mint,provider:'RugCheck',url:`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,ttl:RESEARCH_READ_LIMITS.safetyTtlMs}),mint);}

export interface DexSafety {status:ResearchReadStatus;asOf:string|null;poolMatched:boolean|null;liquidityUsd:number|null;volume24h:number|null;priceUsd:number|null;url:string|null;note:string;flags:ResearchFlag[]}
function dexSafety(pool:Pool,read:ResearchRead<any[]>):DexSafety{
 const rows=Array.isArray(read.data)?read.data:[],match=rows.find(p=>p.chainId==='solana'&&p.pairAddress===pool.address&&[p.baseToken?.address,p.quoteToken?.address].includes(pool.base.address)&&[p.baseToken?.address,p.quoteToken?.address].includes(pool.quote.address));
 return {status:read.status==='available'&&!match?'unavailable':read.status,asOf:read.asOf,poolMatched:read.data?!!match:null,liquidityUsd:match?number(match.liquidity?.usd):null,volume24h:match?number(match.volume?.h24):null,priceUsd:match?number(match.priceUsd):null,url:match&&typeof match.url==='string'&&match.url.startsWith('https://dexscreener.com/')?match.url:null,note:match?'Exact chain, pool and token identities matched; independent DexScreener observations. '+read.note:read.status==='available'?'DexScreener returned no exact matching pool; other pools for this token were not substituted.':read.note,flags:[]};
}
export async function cachedDexSafety(pool:Pool,env:Env):Promise<DexSafety>{const token=researchToken(pool);return dexSafety(pool,token?await cachedResearchRead(env,'dex-token:'+token.mint):unknown('SOL-pair identity unavailable.','unsupported'));}
export async function readDexScreenerBatch(pools:Pool[],context:ResearchReadContext):Promise<Map<string,DexSafety>>{
 const mints=[...new Set(pools.flatMap(p=>researchToken(p)?.mint?[researchToken(p)!.mint]:[]))].slice(0,RESEARCH_READ_LIMITS.dexBatch);
 const missing:string[]=[];
 for(const mint of mints)if((await cachedResearchRead(context.env,'dex-token:'+mint)).status!=='available')missing.push(mint);
 let response:ResearchRead<any[]>|null=null;
 if(missing.length){response=await readJson<any[]>(context,{name:'dex-batch:'+await keyHash(missing.slice().sort().join(',')),provider:'DexScreener',url:'https://api.dexscreener.com/tokens/v1/solana/'+missing.map(encodeURIComponent).join(','),ttl:RESEARCH_READ_LIMITS.mintTtlMs});
  if(response.status==='available'&&Array.isArray(response.data))for(const mint of missing){const rows=response.data.filter(p=>p.chainId==='solana'&&[p.baseToken?.address,p.quoteToken?.address].includes(mint));await saveRead(context.env,'dex-token:'+mint,{data:rows,at:response.asOf!,expiresAt:Date.now()+RESEARCH_READ_LIMITS.mintTtlMs,status:'available',note:response.note},RESEARCH_READ_LIMITS.mintTtlMs);}
 }
 const result=new Map<string,DexSafety>();
 for(const pool of pools){const token=researchToken(pool);result.set(pool.id,response&&token&&missing.includes(token.mint)&&response.status!=='available'?dexSafety(pool,response):await cachedDexSafety(pool,context.env));}
 return result;
}

export interface ResearchCandles {status:ResearchReadStatus;asOf:string|null;candles:Candle[];note:string;unit:string}
export async function readResearchCandles(pool:Pool,context:ResearchReadContext):Promise<ResearchCandles>{
 const token=researchToken(pool);
 if(!token)return {status:'unsupported',asOf:null,candles:[],note:'SOL price structure needs exactly one SOL mint in the pool.',unit:'SOL per token'};
 const now=Math.floor(Date.now()/1000),end=Math.floor(now/3600)*3600;
 const primary=await readJson<any>(context,{name:'candles-native:'+pool.address,provider:'Meteora',url:`https://dlmm.datapi.meteora.ag/pools/${encodeURIComponent(pool.address)}/ohlcv?`+new URLSearchParams({timeframe:'1h',start_time:String(end-72*3600),end_time:String(now)}),ttl:RESEARCH_READ_LIMITS.candleTtlMs,init:{headers:{accept:'application/json'}}});
 const normalise=(rows:number[][])=>rows.filter(r=>Array.isArray(r)&&r.length>=6&&r.slice(0,6).every(n=>typeof n==='number'&&Number.isFinite(n))&&r[0]>0&&r[1]>0&&r[2]>=Math.max(r[1],r[4])&&r[3]<=Math.min(r[1],r[4])&&r[3]>0&&r[5]>=0).map(([t,o,h,l,c,v])=>token.solX?{t,o:1/o,h:1/l,l:1/h,c:1/c,v}:{t,o,h,l,c,v}).sort((a,b)=>a.t-b.t);
 const nativeIdentity=!primary.data?.address||primary.data.address===pool.address;
 const nativeRows=nativeIdentity&&Array.isArray(primary.data?.data)?primary.data.data.map((r:any)=>{const t=number(r.timestamp);return [t==null?NaN:t>1e12?Math.floor(t/1000):t,number(r.open),number(r.high),number(r.low),number(r.close),number(r.volume)].map(n=>n==null?NaN:n);}):[];
 const nativeCandles=normalise(nativeRows),nativeComplete=nativeCandles.filter(c=>c.t<end&&c.t>=end-48*3600);
 const coverage=(candles:Candle[])=>{const timestamps=new Set(candles.map(c=>c.t));let hours=0;while(hours<48&&timestamps.has(end-(hours+1)*3600))hours++;return hours;};
 if(primary.status==='available'&&coverage(nativeComplete)===48)return {status:'available',asOf:primary.asOf,candles:nativeCandles,note:'Exact-pool Meteora hourly native quote/base candles, converted to SOL per paired token. Volume is source-reported USD; contiguous coverage is checked separately.',unit:'SOL per token'};
 const query=new URLSearchParams({aggregate:'1',limit:'72',currency:'token',token:pool.base.address,include_empty_intervals:'true'});
 const read=await readJson<any>(context,{name:'candles:'+pool.address,provider:'GeckoTerminal',url:`https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pool.address)}/ohlcv/hour?${query}`,ttl:RESEARCH_READ_LIMITS.candleTtlMs,init:{headers:{accept:'application/json;version=20230302'}}});
 const addresses=[read.data?.meta?.base?.address,read.data?.meta?.quote?.address],verified=addresses.includes(pool.base.address)&&addresses.includes(pool.quote.address);
 const rows=verified&&Array.isArray(read.data?.data?.attributes?.ohlcv_list)?read.data.data.attributes.ohlcv_list:[];
 const candles=normalise(rows);
 if(primary.status==='available'&&nativeCandles.length&&(read.status!=='available'||coverage(nativeCandles)>=coverage(candles)))return {status:'available',asOf:primary.asOf,candles:nativeCandles,note:'Exact-pool Meteora hourly candles; available coverage is incomplete. Public GeckoTerminal fallback did not improve contiguous recent coverage.',unit:'SOL per token'};
 return {status:read.status==='available'&&!verified?'unavailable':read.status,asOf:read.asOf,candles,note:verified?'Hourly completed candles are checked for contiguous coverage; volume is provider-reported USD. '+read.note:read.status==='available'?'Chart token identities could not be verified.':read.note,unit:'SOL per token'};
}
