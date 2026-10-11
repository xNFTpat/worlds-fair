import type {Env} from './env';
import type {Pool} from './schema';
import {money} from './pnl';
import {fetchMeteoraPool} from './sources/meteora';
import {researchReadContext, readResearchCandles, type ResearchCandles, RESEARCH_SOL} from './sources/research-reads';
import {reserveResearchJupiter, noteResearchJupiterRateLimit} from './research-quote-budget';
import {readWalletBins, walletPublicKey, type WalletBinRead, type WalletBin} from '../execution/still-wallet-reader';
import {buildStillPreflight, type StillPreflight, type StillEvidence} from './still-preflight';
import {STILL_PREFLIGHT_THRESHOLDS as T} from './still-preflight-config';
import {stillChecks, type StillCheck} from './still-checks';
import {inventoryAtPrice} from './research-range';

const API='https://dlmm.datapi.meteora.ag',SOURCE='Meteora DLMM Data API';
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nonnegative=(v:unknown):v is number=>finite(v)&&v>=0;
const positive=(v:unknown):v is number=>finite(v)&&v>0;
const raw=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,78}$/.test(v);
const fresh=(at:string|null|undefined,now=Date.now(),ttl=60000)=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=ttl;
const amount=(v:unknown)=>{const n=money(v);return nonnegative(n)?n:null;};
const evidence=<T>(value:T|null,source:string,asOf:string|null,note=''):StillEvidence<T>=>({value,source,asOf,status:value===null?'unavailable':'available',note});
const validKey=(s:unknown):s is string=>{try{if(typeof s!=='string')return false;walletPublicKey(s);return true;}catch{return false;}};
const nullableSum=(a:unknown,b:unknown)=>{const x=amount(a),y=amount(b);return x!==null&&y!==null?x+y:null;};
export {walletPublicKey};
export interface StillWalletPositionIndex {
  positionAddress:string;poolAddress:string;name:string;valueUsd:number|null;feesEarnedUsd:number|null;
  lower:number|null;upper:number|null;current:number|null;inRange:boolean|null;source:string;asOf:string;
  supported:boolean;note:string;
}
export interface StillWalletIndex {address:string;asOf:string;source:string;status:'available'|'partial'|'unavailable';positions:StillWalletPositionIndex[];note:string}
export interface StillWalletExitQuote {status:'available'|'unavailable';inputRaw:string|null;inputMint:string|null;outputSol:number|null;costSol:number|null;asOf:string|null;source:string;note:string}
export interface StillWalletDetail {
  address:string;positionAddress:string;poolAddress:string;name:string;status:'available'|'unavailable'|'unsupported';asOf:string|null;source:string;
  priceSol:number|null;floorPriceSol:number|null;topPriceSol:number|null;distanceToFloorPct:number|null;valueSol:number|null;feesSol:number|null;inRange:boolean|null;
  feeRateHourly:number|null;feeAsOf:string|null;exitQuote:StillWalletExitQuote;canPractise:boolean;note:string;
  bins:WalletBin[];binStep:number|null;rangeBinCount:number|null;pairedMint:string|null;decimals:number|null;
  feesInclude:string;checks:StillCheck[];transferFeeBps:number|null;transferFeeChangeable:boolean|null;
  /** Public pool/candle evidence, never a wallet provider, secret or signing object. */
  pool:Pool|null;candles:ResearchCandles|null;
}
interface WalletDeps {
  readBins:typeof readWalletBins;pool:typeof fetchMeteoraPool;candles:typeof readResearchCandles;now:()=>number;
  quote:(env:Env,read:WalletBinRead)=>Promise<StillWalletExitQuote>;
}
async function readJson(url:string,deadline:number){
  if(Date.now()>=deadline)throw Error('The wallet read timed out.');
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(6500,deadline-Date.now()))),redirect:'error'});
  if(!response.ok)throw Error('Meteora is temporarily unavailable.');
  return await response.json() as any;
}
/** No wallet data is written to KV, a journal, logging, or any server cache. */
export async function readStillWallet(_env:Env,address:string):Promise<StillWalletIndex> {
  walletPublicKey(address);const at=()=>new Date().toISOString(),deadline=Date.now()+15000;
  try {
    const data=await readJson(API+'/portfolio/open?'+new URLSearchParams({user:address,page:'1',page_size:'50'}),deadline);
    if(!Array.isArray(data.pools)||data.pools.length>50||typeof data.hasNext!=='boolean')throw Error('The position list is incomplete.');
    const seen=new Set<string>();let partial=data.hasNext;
    for(const row of data.pools){
      if(!validKey(row.poolAddress)||!validKey(row.tokenXMint)||!validKey(row.tokenYMint)||!Array.isArray(row.listPositions)||!Number.isSafeInteger(row.openPositionCount)||row.openPositionCount!==row.listPositions.length||row.listPositions.length>1000||row.listPositions.some((id:unknown)=>!validKey(id)||seen.has(id))||new Set(row.listPositions).size!==row.listPositions.length)throw Error('The position identities are incomplete.');
      for(const id of row.listPositions)seen.add(id);
    }
    // The index stays quick: up to eight pool detail reads, three at a time.
    // Remaining positions keep explicit unknown metrics and an on-demand RPC read.
    const details=new Map<string,any[]>();let next=0;
    await Promise.all(Array.from({length:Math.min(3,data.pools.length)},async()=>{
      while(next<Math.min(8,data.pools.length)){
        const row=data.pools[next++];if(!row.listPositions.length)continue;
        try{
          const d=await readJson(API+'/positions/'+row.poolAddress+'/pnl?'+new URLSearchParams({user:address,status:'open',page:'1',page_size:'100'}),deadline);
          const ids=new Set(row.listPositions);
          if(d.hasNext!==false||!Array.isArray(d.positions)||d.positions.length!==ids.size||new Set(d.positions.map((p:any)=>p.positionAddress)).size!==ids.size||d.positions.some((p:any)=>p.isClosed!==false||!ids.has(p.positionAddress)))throw Error();
          details.set(row.poolAddress,d.positions);
        }catch{partial=true;}
      }
    }));
    if(data.pools.length>8)partial=true;
    const asOf=at(),positions:StillWalletPositionIndex[]=data.pools.flatMap((row:any)=>{
      const solX=row.tokenXMint===RESEARCH_SOL,solY=row.tokenYMint===RESEARCH_SOL,supported=solX!==solY;
      const out=Array.isArray(row.positionsOutOfRange)&&row.positionsOutOfRange.every((id:unknown)=>row.listPositions.includes(id))?new Set(row.positionsOutOfRange):null;
      return row.listPositions.map((id:string)=>{
        const d=details.get(row.poolAddress)?.find(p=>p.positionAddress===id),lo=amount(d?.minPrice),hi=amount(d?.maxPrice),price=amount(d?.poolActivePrice??row.poolPrice);
        const bounds=supported&&positive(lo)&&positive(hi)&&hi>=lo;
        return {positionAddress:id,poolAddress:row.poolAddress,name:String(row.tokenX||'?')+'/'+String(row.tokenY||'?'),valueUsd:amount(d?.unrealizedPnl?.balances),feesEarnedUsd:nullableSum(d?.unrealizedPnl?.unclaimedFeeTokenX?.usd,d?.unrealizedPnl?.unclaimedFeeTokenY?.usd),
          lower:bounds?solX?1/hi:lo:null,upper:bounds?solX?1/lo:hi:null,current:supported&&positive(price)?solX?1/price:price:null,inRange:typeof d?.isOutOfRange==='boolean'?!d.isOutOfRange:out?!out.has(id):null,
          source:SOURCE,asOf,supported,note:supported?d?'Indexed position values. Run Pre-flight for confirmed per-bin reads and an exit quote.':'Individual accounting is unavailable. Run Pre-flight for a fresh position read.':'Live position. SOL-terms Pre-flight and paper copying currently support SOL pairs only.'};
      });
    });
    return {address,asOf,source:SOURCE,status:partial?'partial':'available',positions,note:data.hasNext?'Showing the first 50 pool groups. More groups exist; this is not a complete wallet total.':partial?'Some indexed metrics are unavailable. Each position can be checked independently.':'Each record is one position address. Pool groups do not merge positions.'};
  }catch{return {address,asOf:at(),source:SOURCE,status:'unavailable',positions:[],note:"Couldn't read this wallet right now. Try again, or paste another address. No wallet action was requested."};}
}
const blankExit=(note:string,inputRaw:string|null=null,inputMint:string|null=null):StillWalletExitQuote=>({status:'unavailable',inputRaw,inputMint,outputSol:null,costSol:null,asOf:null,source:'Jupiter exact-input quote',note});
/** Quotes this position's actual withdrawable paired principal, never a synthetic
 * SOL purchase. Principal excludes trading fees and rewards. No swap is built. */
export async function readWalletExitQuote(env:Env,read:WalletBinRead):Promise<StillWalletExitQuote> {
  const input=read.pairedWithdrawableRaw,mint=read.pairedMint;
  if(!read.modelSupported||!fresh(read.asOf)||!raw(input)||!raw(read.pairedRaw)||!positive(read.priceSol)||!Number.isInteger(read.decimals)||read.decimals<0||read.decimals>18)return blankExit('A current, supported position inventory is required.',input,mint);
  if(BigInt(input)===0n){
    const cost=Number(read.pairedRaw)/10**read.decimals*read.priceSol;
    return {status:'available',inputRaw:input,inputMint:mint,outputSol:0,costSol:cost,asOf:read.asOf,source:read.source,note:BigInt(read.pairedRaw)===0n?'Verified zero paired-token principal: no token sale is needed. LP network costs, fees and rewards are separate.':'The observed transfer-fee policy leaves no withdrawable paired-token principal. LP network costs, fees and rewards are separate.'};
  }
  const permission=await reserveResearchJupiter(env);
  if(!permission.allowed)return blankExit('The shared quote service is busy. Try Run Pre-flight again shortly.',input,mint);
  try{
    const query=new URLSearchParams({inputMint:mint,outputMint:RESEARCH_SOL,amount:input,swapMode:'ExactIn',slippageBps:'50'});
    const r=await fetch('https://api.jup.ag/swap/v1/quote?'+query,{headers:{accept:'application/json',...(env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{})},signal:AbortSignal.timeout(6500),redirect:'error'});
    if(r.status===429)await noteResearchJupiterRateLimit(env,r.headers);
    if(!r.ok)throw Error();
    const q=await r.json() as any;
    if(q.inputMint!==mint||q.outputMint!==RESEARCH_SOL||q.inAmount!==input||!raw(q.outAmount)||!Array.isArray(q.routePlan)||!q.routePlan.length||q.routePlan.some((r:any)=>!validKey(r.swapInfo?.ammKey))||!fresh(read.asOf))throw Error();
    const outputSol=Number(q.outAmount)/1e9,marked=Number(read.pairedRaw)/10**read.decimals*read.priceSol;
    if(!nonnegative(outputSol)||!nonnegative(marked))throw Error();
    return {status:'available',inputRaw:input,inputMint:mint,outputSol,costSol:Math.max(0,marked-outputSol),asOf:new Date().toISOString(),source:'Jupiter exact-input quote + confirmed position principal',note:'Actual paired-token principal after the observed withdrawal transfer fee, quoted to SOL at 0.5% slippage tolerance. Cost is quoted output versus the dated bin mark, floored at zero. Excludes unclaimed fees, rewards, network charges and the withdrawal’s effect on pool liquidity. Not a complete LP exit simulation.'};
  }catch{return blankExit('The exact-in exit quote is unavailable. Position balances are still read-only.',input,mint);}
}
function unavailableDetail(address:string,poolAddress:string,positionAddress:string,note:string,status:StillWalletDetail['status']='unavailable'):StillWalletDetail {
  return {address,poolAddress,positionAddress,name:'Meteora DLMM position',status,asOf:null,source:'Confirmed Solana RPC · Meteora DLMM position bins',priceSol:null,floorPriceSol:null,topPriceSol:null,distanceToFloorPct:null,valueSol:null,feesSol:null,inRange:null,feeRateHourly:null,feeAsOf:null,exitQuote:blankExit('A verified position inventory is unavailable.'),canPractise:false,note,bins:[],binStep:null,rangeBinCount:null,pairedMint:null,decimals:null,feesInclude:'Unclaimed trading fees only, before transfer fees',checks:[],transferFeeBps:null,transferFeeChangeable:null,pool:null,candles:null};
}
export function walletChecks(d:StillWalletDetail,now=Date.now()):StillCheck[] {
  const checks:StillCheck[]=[],add=(id:string,label:string,status:StillCheck['status'],result:string,source:string,asOf:string|null,tooltip:string,lesson:number)=>checks.push({id,label,status,result,source,asOf,tooltip,lesson});
  const show=(n:number)=>n.toLocaleString('en-GB',{maximumFractionDigits:6}),fee=d.feeRateHourly;
  if(nonnegative(fee)&&fresh(d.feeAsOf,now,600000))add('fees','Fee pace',fee>=T.feePace.pass?'pass':fee>=T.feePace.caution?'caution':'fail',`${show(fee*100)}% of pool TVL in the last hour.`,SOURCE,d.feeAsOf,'Observed pool fee pace; it is not this position’s realised return.',7);
  else add('fees','Fee pace','unavailable','Unavailable. Pool fee pace could not be read.',SOURCE,null,'Missing pool activity is not zero.',7);
  const cost=d.exitQuote.costSol;
  if(d.exitQuote.status==='available'&&nonnegative(cost)&&positive(d.valueSol)&&fresh(d.exitQuote.asOf,now)){
    const fraction=cost/d.valueSol,expected=nonnegative(fee)?fee*d.valueSol*T.defaultHoldMinutes/60:null;
    add('cost','Exit swap cost',fraction>T.exitCost.caution||expected!==null&&cost>expected?'fail':fraction<=T.exitCost.pass?'pass':'caution',`${show(cost)} SOL (${show(fraction*100)}% of this position’s principal).`,d.exitQuote.source,d.exitQuote.asOf,d.exitQuote.note,3);
  }else add('cost','Exit swap cost','unavailable','Unavailable. The position-sized exit quote could not be verified.','Jupiter exact-input quote',null,d.exitQuote.note,3);
  const candles=d.candles,end=Math.floor(now/3600000)*3600,byTime=new Map((candles?.candles||[]).map(c=>[c.t,c])),day=Array.from({length:24},(_,i)=>byTime.get(end-(24-i)*3600));
  if(fresh(d.asOf,now)&&positive(d.priceSol)&&finite(d.distanceToFloorPct)&&candles?.status==='available'&&fresh(candles.asOf,now,300000)&&day.every(c=>c&&positive(c.h)&&positive(c.l)&&c.h>=c.l)){
    const swing=(Math.max(...day.map(c=>c!.h))-Math.min(...day.map(c=>c!.l)))/d.priceSol,depth=d.distanceToFloorPct/100;
    add('floor','Floor distance',depth<swing?'fail':depth<swing*T.floor.passAtSwing?'caution':'pass',`${show(d.distanceToFloorPct)}% to this position’s actual floor; observed 24-hour swing ${show(swing*100)}%.`,'Confirmed position range + exact-pool hourly candles',candles.asOf,'Actual SOL-per-token floor. A floor is not a stop-loss; all 24 completed hourly candles are required.',1);
  }else add('floor','Floor distance','unavailable',finite(d.distanceToFloorPct)?`${show(d.distanceToFloorPct)}% to the actual floor. The complete 24-hour swing is unavailable.`:'Unavailable. The actual floor could not be verified.','Confirmed position range + exact-pool hourly candles',d.asOf,'Missing candle coverage cannot produce a passing risk check.',1);
  return checks;
}
export async function readStillWalletPosition(env:Env,address:string,poolAddress:string,positionAddress:string,overrides:Partial<WalletDeps>={}):Promise<StillWalletDetail> {
  [address,poolAddress,positionAddress].forEach(walletPublicKey);
  const deps:WalletDeps={readBins:readWalletBins,pool:fetchMeteoraPool,candles:readResearchCandles,now:Date.now,quote:readWalletExitQuote,...overrides};
  const context=researchReadContext(env),poolPromise=deps.pool(poolAddress).catch(()=>null),candlesPromise=poolPromise.then(pool=>pool?deps.candles(pool,context).catch(()=>null):null);
  try{
    const [read,pool]=await Promise.all([deps.readBins(env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',address,poolAddress,positionAddress),poolPromise]);
    if(read.address!==address||read.poolAddress!==poolAddress||read.positionAddress!==positionAddress||!fresh(read.asOf,deps.now()))throw Error('Position identities or read time could not be verified.');
    if(pool&&(pool.address!==poolAddress||pool.base.address!==read.mintX||pool.quote.address!==read.mintY||pool.poolConfig?.binStep!==read.binStep))throw Error('Pool mint identities or bin step do not match the position.');
    const [exitQuote,candles]=await Promise.all([deps.quote(env,read).catch(()=>blankExit('The exit quote is unavailable.')),candlesPromise]);
    if(!fresh(read.asOf,deps.now()))throw Error('The position read has expired. Run Pre-flight again.');
    const hourly=pool&&fresh(pool.fetchedAt,deps.now(),600000)&&nonnegative(pool.activity?.fees1h)&&positive(pool.tvlUsd)?pool.activity!.fees1h!/pool.tvlUsd:null;
    const rangeUsable=read.rangeBinCount>=1&&read.rangeBinCount<=69&&read.bins.length===read.rangeBinCount&&positive(read.valueSol),poolUsable=!!pool&&fresh(pool.fetchedAt,deps.now(),600000);
    const canPractise=read.modelSupported&&rangeUsable&&poolUsable;
    const detail:StillWalletDetail={address,poolAddress,positionAddress,name:pool?.pair||'Meteora DLMM position',status:'available',asOf:read.asOf,source:read.source,priceSol:read.priceSol,floorPriceSol:read.floorPriceSol,topPriceSol:read.topPriceSol,distanceToFloorPct:(read.priceSol-read.floorPriceSol)/read.priceSol*100,valueSol:read.valueSol,feesSol:read.feesSol,inRange:read.priceSol>=read.floorPriceSol&&read.priceSol<=read.topPriceSol,feeRateHourly:hourly,feeAsOf:hourly!==null?pool!.fetchedAt:null,exitQuote,canPractise,
      note:!read.modelSupported?read.policyNote:!rangeUsable?'The complete observed range cannot be copied into the 69-bin paper model. No range is shortened or replaced.':!poolUsable?'Pool data is unavailable; the confirmed wallet inventory is shown, but paper copying needs fresh pool data.':'Live, read-only. Paper copying preserves the observed range and scales its current bin allocation. It starts a new paper record; historical returns are not copied.',bins:read.bins,binStep:read.binStep,rangeBinCount:read.rangeBinCount,pairedMint:read.pairedMint,decimals:read.decimals,feesInclude:'Unclaimed trading fees only, before transfer fees',checks:[],transferFeeBps:read.transferFeeBps,transferFeeChangeable:read.transferFeeChangeable,pool,candles};
    detail.checks=walletChecks(detail,deps.now());return detail;
  }catch(error){
    const message=error instanceof Error?error.message:'',unsupported=/supports SOL-paired|wider than/.test(message);
    return unavailableDetail(address,poolAddress,positionAddress,unsupported?message:"Couldn't verify this position right now. Run Pre-flight again. Its wallet and funds have not changed.",unsupported?'unsupported':'unavailable');
  }
}
export function buildWalletPaperPreflight(d:StillWalletDetail,sizeSol:number,now=Date.now()):StillPreflight {
  if(!positive(sizeSol)||sizeSol<.001||sizeSol>10)throw Error('Choose between 0.001 and 10 practice SOL.');
  if(d.status!=='available'||!d.canPractise||!fresh(d.asOf,now)||!d.pool||!fresh(d.pool.fetchedAt,now,600000)||!positive(d.priceSol)||!positive(d.valueSol)||!positive(d.floorPriceSol)||!positive(d.topPriceSol)||d.topPriceSol<d.floorPriceSol||!Number.isInteger(d.rangeBinCount)||d.rangeBinCount!<1||d.rangeBinCount!>69||d.bins.length!==d.rangeBinCount)throw Error('A fresh, complete observed range is required. Run Pre-flight again.');
  if(d.pool.address!==d.poolAddress||d.bins.some(b=>!positive(b.priceSol)||!nonnegative(b.sol)||!nonnegative(b.token)||!Number.isSafeInteger(b.nativeBinId))||new Set(d.bins.map(b=>b.nativeBinId)).size!==d.bins.length)throw Error('The observed bin identities are unavailable.');
  const ids=d.bins.map(b=>b.nativeBinId).sort((a,b)=>a-b);
  if(ids.some((id,i)=>i>0&&id!==ids[i-1]+1)||Math.min(...d.bins.map(b=>b.priceSol))!==d.floorPriceSol||Math.max(...d.bins.map(b=>b.priceSol))!==d.topPriceSol)throw Error('The observed range is incomplete.');
  const total=d.bins.reduce((sum,b)=>sum+b.sol+b.token*d.priceSol!,0);
  if(!positive(total)||Math.abs(total-d.valueSol)>Math.max(1e-9,total*1e-10))throw Error('The observed balances do not reconcile.');
  const factor=sizeSol/total,bins=d.bins.map(b=>({nativeBinId:b.nativeBinId,offset:0,priceSol:b.priceSol,sol:b.sol*factor,token:b.token*factor,initialSol:b.sol*factor,initialPairedTokens:b.token*factor,weight:(b.sol+b.token*d.priceSol!)/total}));
  const immediate=inventoryAtPrice(bins,d.priceSol).valueSol;
  if(Math.abs(immediate-sizeSol)>Math.max(1e-8,sizeSol*1e-8))throw Error('This inventory cannot be represented by the paper bin model without changing its value.');
  const result=buildStillPreflight({pool:d.pool},sizeSol,now),at=d.asOf!,source=d.source+' + scaled paper inventory';
  const note='Exact observed native range and current per-bin SOL/token proportions, scaled to the confirmed practice allocation. No original strategy shape is inferred. Historical fees and returns are not copied. This is the fixed-bin paper model, not a real deposit.';
  result.name=d.name;result.fetchedAt=at;result.priceSol=evidence(d.priceSol,d.source,at);result.pool.priceSol=result.priceSol;
  result.range={shape:'Observed wallet allocation',floorPriceSol:d.floorPriceSol,topPriceSol:d.topPriceSol,binStep:d.binStep!,binCount:bins.length,depthFraction:1-d.floorPriceSol/d.priceSol,bins,alignment:'native-observed-position',source,asOf:at,note};
  result.feeRateHourly=evidence(d.feeRateHourly,SOURCE,d.feeAsOf,'Observed pool fee pace, not this wallet’s realised earnings.');
  result.expectedFeesPerDaySol=evidence(nonnegative(d.feeRateHourly)?sizeSol*d.feeRateHourly*24:null,'Still paper pool-pace model + Meteora',d.feeAsOf,'Paper amount × observed hourly fee/TVL × 24. Not forecast earnings.');
  result.transferFeeBps=evidence(d.transferFeeBps,d.source,at);result.transferFeeChangeable=evidence(d.transferFeeChangeable,d.source,at);
  const missing=evidence<number>(null,'Exact scaled-copy costs not quoted',null,'The real wallet’s exit quote is for its actual principal, not this scaled copy. Entry, account, withdrawal and network costs have not been quoted for this paper setup.');
  result.entryConversionSol=missing;result.exitConversionSol=missing;result.entryCostSol=missing;result.exitCostSol=missing;result.networkCostSol=missing;result.roundTripCostSol=missing;
  result.paperCostModel={label:'Paper copy costs unavailable',asOf:null,note:missing.note!,netAfterHoldSol:missing};
  result.scenarios=[.2,.5].map(dropFraction=>{const price=d.priceSol!*(1-dropFraction),gross=inventoryAtPrice(bins,price).valueSol,note='Paper monotonic downward bin-fill scenario using the observed allocation. Before fees, costs and tax; not a forecast or loss limit.';return {dropFraction,priceSol:evidence(price,source,at,note),grossValueSol:evidence(gross,source,at,note),grossPnlSol:evidence(gross-sizeSol,source,at,note),netValueSol:missing,pnlSol:missing,vsHoldingSol:missing};});
  result.canOpen=true;result.ledger={priceSol:d.priceSol,feeRateHourly:d.feeRateHourly,entryCostsSol:null,exitCostsSol:null,transferFeeBps:d.transferFeeBps,bins};
  result.checks=stillChecks(result,{pool:d.pool,...(d.candles?{candles:d.candles}:{})},now);
  const failed=result.checks.find(c=>!['half','drop20'].includes(c.id)&&c.status==='fail');
  result.verdict=failed?{label:'Skip',reason:failed.result}:{label:'Marginal',reason:'The observed allocation is available for paper practice. Exact copy costs and net results are unavailable.'};
  result.missingEvidence=[...new Set(['Exact scaled-copy entry and exit costs',...result.checks.filter(c=>c.status==='unavailable').map(c=>c.label)])];
  result.model={kind:'paper-monotonic-bin-model',note};return result;
}
export async function getStillWalletPaperPreflight(env:Env,address:string,poolAddress:string,positionAddress:string,sizeSol:number):Promise<StillPreflight> {
  // Reverify the observed position for every confirmed copy. Its real exit quote
  // cannot price a differently sized paper copy, so do not spend quote quota here.
  return buildWalletPaperPreflight(await readStillWalletPosition(env,address,poolAddress,positionAddress,{quote:async()=>blankExit('The scaled paper copy needs its own cost quote.')}),sizeSol);
}
