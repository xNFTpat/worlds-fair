import {STILL_THIN_DEMO,withStillDemoObservation,withStillThinDemo,readStillHotPools} from './still-demo-pools';
import {readStillAccountCosts,stillAccountRangeKey,STILL_ACCOUNT_COST_TTL,STILL_ACCOUNT_LAYOUT,type StillAccountCosts} from './still-account-costs';
import {readStillNetwork,STILL_NETWORK_MAX_AGE_MS,type StillNetworkRead} from './still-costs';
import {fetchMeteoraPool} from './sources/meteora';
import {isStillKnownIssuer,stillChecks, type StillCheck} from './still-checks';
import {parseStillRangeOptions, type StillRangeOptions} from './still-preflight-config';
import type {Env} from './env';
import type {Pool, Snapshot} from './schema';
import {getSnapshot} from './refresh';
import {researchFeeRates, researchPool, type ResearchPoolDetail} from './lp-research';
import {cachedMintSafety, cachedResearchQuotes, researchReadContext, readMintSafety, readRugSafety, readResearchCandles, readResearchRangeAnchor, readStillSwapQuote, type RugSafety, type ResearchCandles, researchQuoteFresh, researchToken, type MintSafety, type ResearchQuote, type ResearchQuoteMark, type ResearchRangeAnchor} from './sources/research-reads';
import {buildResearchRange, defaultResearchFloor, inventoryAtPrice, type ResearchRangeBin} from './research-range';

export const STILL_MAX_PRICE_AGE_MS = 10 * 60_000;
export const STILL_MIN_TVL_USD = 5_000;
const MINT_MAX_AGE_MS = 10 * 60_000;
const MARKET_SOURCE = 'Meteora DLMM Data API';
const MODEL_SOURCE = 'Still paper range model + Meteora DLMM Data API';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const recent = (asOf: string | null | undefined, ttl: number, now: number) => {
  const at = Date.parse(asOf || '');
  return Number.isFinite(at) && at <= now && now - at <= ttl;
};

/** Preserve the observed fee per dollar traded; cap projected volume to the slower window. */
export function stillProjectedFeeRate(pool:Pool):number|null {
  const rate=researchFeeRates(pool).h1,one=pool.activity?.volume1h,day=pool.volume24hUsd;
  if(!nonnegative(rate)||!nonnegative(one)||!nonnegative(day)||!nonnegative(pool.ageHours)||pool.ageHours<1)return null;
  if(one===0)return rate===0?0:null;
  return rate*Math.min(one,day/24)/one;
}
function stillQuoteFresh(q:ResearchQuote,now:number){
  return q.direction ? recent(q.asOf,45000,now)&&finite(q.expiresAt)&&q.expiresAt!>now : researchQuoteFresh(q,now);
}
/** Signed execution difference: never add optional hop fees a second time. */
export function stillQuoteConversion(q:ResearchQuote|undefined,direction:'entry'|'exit',decimals:number|null|undefined,now:number):number|null {
  if(!q||q.status!=='quoted'||!stillQuoteFresh(q,now)||q.direction&&q.direction!==direction||!positive(q.priceMark?.priceSol)||!recent(q.priceMark?.asOf,q.priceMark?.source==='active-bin'?60000:45000,now))return null;
  if(Math.abs(Date.parse(q.asOf!)-Date.parse(q.priceMark!.asOf))>10000)return null;
  const d=q.tokenDecimals??decimals;
  if(!Number.isInteger(d)||d!<0||d!>18||!/^\d{1,78}$/.test(q.tokenRaw||'')||BigInt(q.tokenRaw!)<=0n)return null;
  const midValue=Number(q.tokenRaw)/10**d!*q.priceMark!.priceSol;
  const value=direction==='exit'&&positive(q.returnedSol)?midValue-q.returnedSol:direction==='entry'&&/^\d{1,78}$/.test(q.inputRaw||'')?Number(q.inputRaw)/1e9-midValue:null;
  return finite(value)?Math.round(value*1e9)/1e9:null;
}

/** Numeric values are never replaced with zero when their source is unavailable. */
export interface StillEvidence<T> {
  value: T | null;
  source: string;
  asOf: string | null;
  status: 'available' | 'unavailable';
  note: string;
}
function evidence<T>(value: T | null, source: string, asOf: string | null, note: string): StillEvidence<T> {
  return {value, source, asOf, status: value === null ? 'unavailable' : 'available', note};
}
export type StillRiskLabel = 'Steady' | 'Busy' | 'Spicy';
export interface StillPoolCard {
  id: string; address: string; pair: string; name: string; pairedMint: string;
  tvlUsd: StillEvidence<number>; volume1hUsd: StillEvidence<number>; thinExample:boolean;
  fees24hFraction: StillEvidence<number>;
  feeTrend: StillEvidence<number>;
  ageHours: StillEvidence<number>;
  priceSol: StillEvidence<number>;
  binStep: StillEvidence<number>;
  risk: {label: StillRiskLabel; reason: string; source: string; asOf: string};
}
export interface StillPoolCardSummary {
  verdict: StillPreflight['verdict'];
  reasons: Pick<StillCheck, 'id' | 'label' | 'status' | 'shortReason' | 'result' | 'source' | 'asOf'>[];
  sizeSol: 0.5;
  scope: string;
  asOf: string | null;
  note: string;
}
function readablePool(pool: Pool, now: number) {
  const token = researchToken(pool);
  return pool.chain === 'solana' && pool.venue === 'meteora-dlmm' && !!token &&
    recent(pool.fetchedAt, STILL_MAX_PRICE_AGE_MS, now) && positive(pool.tvlUsd) &&
    positive(token?.priceSol) && Number.isInteger(pool.poolConfig?.binStep) && positive(pool.poolConfig?.binStep) && pool.poolConfig!.binStep! <= 10_000 &&
    !pool.tags?.some(tag => ['suspect', 'blacklisted'].includes(tag));
}
function supportedPool(pool:Pool,now:number){return readablePool(pool,now)&&pool.tvlUsd!>=STILL_MIN_TVL_USD;}
function classify(pool: Pool): StillPoolCard['risk'] {
  const fees = researchFeeRates(pool), ratio = positive(fees.h24) && nonnegative(fees.h1) ? fees.h1 / fees.h24 : null;
  let label: StillRiskLabel = 'Busy', reason = 'An established pool with active trading; token price and liquidity can still change sharply.';
  if (!nonnegative(pool.ageHours)) {
    label = 'Spicy'; reason = 'Pool age is unavailable, so its history cannot be assessed.';
  } else if (pool.ageHours < 24) {
    label = 'Spicy'; reason = 'This pool is less than one day old and has little observed history.';
  } else if (!positive(pool.tvlUsd) || pool.tvlUsd < 25_000) {
    label = 'Spicy'; reason = 'Pool liquidity is below $25,000; exits may move the price more.';
  } else if (ratio !== null && ratio >= 2) {
    label = 'Spicy'; reason = 'The last hour’s fee pace is at least twice its daily average; the burst may fade.';
  } else if (pool.ageHours >= 168 && pool.tvlUsd >= 100_000 && ratio !== null && ratio >= 0.5 && ratio < 2) {
    label = 'Steady'; reason = 'At least a week of pool history, $100,000 of liquidity and no twofold fee burst. This does not mean low risk.';
  } else if (ratio !== null && ratio < 0.5) {
    reason = 'The last hour’s fee pace is below half its daily average; activity is slowing.';
  } else if (ratio === null) {
    reason = 'At least one day of pool history; a complete fee-trend comparison is unavailable.';
  }
  return {label, reason, source: MARKET_SOURCE + ' + published Still risk thresholds', asOf: pool.fetchedAt};
}
function poolCard(pool: Pool, now: number): StillPoolCard {
  const current = recent(pool.fetchedAt, STILL_MAX_PRICE_AGE_MS, now), fees = researchFeeRates(pool), token = researchToken(pool);
  const completeDay = nonnegative(pool.ageHours) && pool.ageHours >= 24;
  const daily = current && completeDay && nonnegative(fees.h24) ? fees.h24 * 24 : null;
  const trend = current && completeDay && positive(fees.h24) && nonnegative(fees.h1) ? fees.h1 / fees.h24 - 1 : null;
  return {
    id: pool.id, address: pool.address, name: pool.pair, pair: pool.pair, pairedMint: token?.mint || '',
    thinExample:pool.address===STILL_THIN_DEMO.address,
    volume1hUsd:evidence(current&&nonnegative(pool.activity?.volume1h)?pool.activity!.volume1h!:null,MARKET_SOURCE,pool.fetchedAt,'Reported one-hour trading volume; never extrapolated.'),
    tvlUsd: evidence(current && positive(pool.tvlUsd) ? pool.tvlUsd : null, MARKET_SOURCE, pool.fetchedAt, 'Pool liquidity at the displayed source read.'),
    fees24hFraction: evidence(daily, MARKET_SOURCE, pool.fetchedAt, 'Reported trailing 24h fees divided by current pool TVL; not a position return. A partial day is unavailable.'),
    feeTrend: evidence(trend, MARKET_SOURCE, pool.fetchedAt, 'Last-hour fees/TVL compared with the hourly average of the trailing 24h. This is not a comparison with the previous hour.'),
    ageHours: evidence(current && nonnegative(pool.ageHours) ? pool.ageHours : null, MARKET_SOURCE, pool.fetchedAt, 'Age of this pool, not the token’s age.'),
    priceSol: evidence(current && positive(token?.priceSol) ? token.priceSol : null, MARKET_SOURCE, pool.fetchedAt, 'SOL per paired token from the observed pool price; not an execution quote.'),
    binStep: evidence(current && Number.isInteger(pool.poolConfig?.binStep) && positive(pool.poolConfig?.binStep) && pool.poolConfig!.binStep! <= 10_000 ? pool.poolConfig!.binStep! : null, MARKET_SOURCE, pool.fetchedAt, 'The source-reported DLMM bin step in basis points.'),
    risk: classify(pool),
  };
}
function rankedPools(snapshot: Snapshot, now: number): Pool[] {
  return [...new Map(snapshot.pools.filter(pool => supportedPool(pool, now)).map(pool => [pool.address, pool])).values()]
    .sort((a, b) => (b.activity?.volume1h ?? -1) - (a.activity?.volume1h ?? -1) || a.address.localeCompare(b.address));
}
/** Top eligible one-hour volume observations, plus the exact thin example. No quote/RPC fanout. */
export function listStillPools(snapshot: Snapshot, now = Date.now()): StillPoolCard[] {
  const candidates=rankedPools(snapshot,now).filter(p=>nonnegative(p.activity?.volume1h)||p.address===STILL_THIN_DEMO.address);
  return withStillThinDemo(candidates.slice(0,8),candidates).map(pool=>poolCard(pool,now));
}
export interface StillBasket {
  id: string; name: string; range?: StillRangeOptions; reason: string; status: 'available' | 'unavailable'; source: string; asOf: string | null;
  components: {poolId: string; pool: StillPoolCard; weightBps: number}[];
  legs: {poolAddress: string; weightBps: number}[];
}
export function buildStillBaskets(snapshot: Snapshot, now = Date.now()): StillBasket[] {
  const pools = listStillPools(snapshot, now);
  const steady=pools.filter(p=>p.risk.label==='Steady'),busy=pools.filter(p=>p.risk.label==='Busy'),spicy=pools.filter(p=>p.risk.label==='Spicy');
  const definitions=[
    {id:'steady',name:'Calm start',reason:'Two Steady pools, wide Spot ranges.',members:steady.slice(0,2),count:2,range:{shape:'Spot' as const,floorPct:10,ceilingPct:10,holdMinutes:1440}},
    {id:'busy',name:'Learn the busy ones',reason:'One Steady and one Busy pool, short holds.',members:[steady[0],busy[0]].filter(Boolean),count:2,range:{shape:'Spot' as const,floorPct:25,ceilingPct:0,holdMinutes:30}},
    {id:'spicy',name:'See a bad day',reason:'One Spicy pool, small size, so you know what it looks like.',members:spicy.slice(0,1),count:1,range:{shape:'BidAsk' as const,floorPct:30,ceilingPct:0,holdMinutes:30}},
  ];
  return definitions.map(({members,count,...definition})=>{
    const available=members.length===count,weightBps=10000/count;
    const sameToken=members.length>1&&members.every(p=>p.pairedMint===members[0].pairedMint);
    return {...definition,reason:definition.reason+(sameToken?' Both pools hold the same paired token; this does not diversify token exposure.':''),status:available?'available':'unavailable',source:MARKET_SOURCE+' + example Still mix rules',asOf:members.length?members.map(p=>p.risk.asOf).sort()[0]:null,
      components:available?members.map(pool=>({poolId:pool.id,pool,weightBps})):[],legs:available?members.map(pool=>({poolAddress:pool.address,weightBps})):[]};
  });
}

export interface StillRange {
  shape: 'Spot'|'BidAsk'|'Curve'|'Observed wallet allocation'; floorPriceSol: number; topPriceSol: number; binStep: number; binCount: number;
  depthFraction: number; bins: ResearchRangeBin[]; alignment: string; source: string; asOf: string; note: string;
}
export interface StillScenario {
  dropFraction: number; priceSol: StillEvidence<number>; grossValueSol: StillEvidence<number>;
  grossPnlSol: StillEvidence<number>; netValueSol: StillEvidence<number>; pnlSol: StillEvidence<number>; vsHoldingSol: StillEvidence<number>;
}
export interface StillPreflight {
  entrySwapAmountSol?:StillEvidence<number>; betterThanMid?:boolean; thinExampleOnly?:boolean; exitPoolFeeSol?:StillEvidence<number>;
  solPriceUsd: StillEvidence<number>; positionRentSol: StillEvidence<number>; setupCostSol: StillEvidence<number>; entryTransactionFeeSol: StillEvidence<number>; exitTransferFeeSol: StillEvidence<number>; exitCostComplete:boolean; netReturnPct:StillEvidence<number>; breakEvenHours:StillEvidence<number>; breakEvenStatus:'covered'|'never'|'unavailable';
  paperCostModel?:{label:string;note:string;asOf:string|null;netAfterHoldSol:StillEvidence<number>};
  checks?: StillCheck[]; options?: StillRangeOptions; transferFeeChangeable?: StillEvidence<boolean>;
  pool: StillPoolCard; poolAddress: string; name: string; sizeSol: number; fetchedAt: string;
  priceSol: StillEvidence<number>; range: StillRange | null;
  feeRateHourly: StillEvidence<number>; expectedFeesPerDaySol: StillEvidence<number>;
  transferFeeBps: StillEvidence<number>; entryCostSol: StillEvidence<number>; exitCostSol: StillEvidence<number>;
  entryConversionSol: StillEvidence<number>; exitConversionSol: StillEvidence<number>; networkCostSol: StillEvidence<number>; roundTripCostSol: StillEvidence<number>;
  scenarios: StillScenario[]; verdict: {label: 'Worth it' | 'Marginal' | 'Skip'; reason: string};
  canOpen: boolean; missingEvidence: string[]; model: {kind: 'paper-monotonic-bin-model'; note: string};
  ledger: {priceSol: number | null; feeRateHourly: number | null; entryCostsSol: number | null; exitCostsSol: number | null; transferFeeBps: number | null; bins: ResearchRangeBin[] | null};
}
export interface StillPreflightInput {
  accountCosts?:StillAccountCosts|null; network?:StillNetworkRead|null; entryQuotes?:ResearchQuote[]; pool: Pool; rug?: RugSafety; candles?: ResearchCandles; quotes?: ResearchQuote[]; safety?: {rpc: MintSafety}; rangeAnchor?: ResearchRangeAnchor;
}
/** Build only what observed inputs support. The inherited model's network default
 * is explicitly overridden for gross inventory arithmetic, and never presented as
 * a measured zero-cost transaction. Missing network evidence keeps all-in net null. */
export function buildStillPreflight(detail: StillPreflightInput, sizeSol = 0.5, now = Date.now(), options?: StillRangeOptions): StillPreflight {
  if (!positive(sizeSol) || sizeSol > 1000) throw new RangeError('Choose a paper amount greater than zero and no more than 1,000 SOL.');
  const pool = detail.pool, card = poolCard(pool, now), token = researchToken(pool), rpc = detail.safety?.rpc;
  const marketCurrent = readablePool(pool, now), anchor = detail.rangeAnchor;
  const native = !!anchor && anchor.status === 'available' && recent(anchor.asOf, 60_000, now) && positive(anchor.activeBinPriceSol) &&
    Number.isSafeInteger(anchor.activeBinId) && Number.isSafeInteger(anchor.minNativeBinId) && Number.isSafeInteger(anchor.maxNativeBinId) &&
    anchor.minNativeBinId! <= anchor.activeBinId! && anchor.activeBinId! <= anchor.maxNativeBinId! &&
    Number.isInteger(anchor.binStep) && positive(anchor.binStep) && anchor.binStep <= 10_000;
  const mark = marketCurrent ? native ? anchor!.activeBinPriceSol! : card.priceSol.value : null;
  const markAt = native ? anchor!.asOf! : pool.fetchedAt;
  const priceSol = evidence(mark, native ? 'Confirmed Solana RPC DLMM active bin' : MARKET_SOURCE, markAt, native ? 'Observed native active-bin SOL/token price.' : 'Observed pool SOL/token price. Native bin alignment is unverified.');
  const binStep = native ? anchor!.binStep! : card.binStep.value;
  let range: StillRange | null = null;
  if (positive(mark) && positive(binStep) && token) {
    try {
      const nativeCapacity = native ? token.solX ? anchor!.maxNativeBinId! - anchor!.activeBinId! : anchor!.activeBinId! - anchor!.minNativeBinId! : 69;
      const maxBins = Math.min(69, nativeCapacity);
      if (maxBins >= 1) {
        const floor = defaultResearchFloor({priceSol: mark, binStep, preferredDepthFraction: 0.475, oneSided: true, maxSetupBins: maxBins});
        const built = buildResearchRange({sizeSol, priceSol: mark, floorPriceSol: floor.floorPriceSol, binStep, shape: 'BidAsk', oneSided: true,
          solIsBase: token.solX, ...(native ? {activeBinId: anchor!.activeBinId!, activeBinPriceSol: mark} : {}),
          maxSetupBins: maxBins, networkSol: 0, positionRentSol: 0, transferFeeBps: null, feeRateHourly: null, exitCostFraction: null});
        range = {shape: 'BidAsk', floorPriceSol: built.bottomPriceSol, topPriceSol: built.topPriceSol, binStep, binCount: built.binCount,
          depthFraction: built.rangeDepthFraction, bins: built.selected.bins, alignment: built.alignment, source: priceSol.source + ' + Still paper range model', asOf: markAt,
          note: `SOL-only Bid-Ask: keep SOL above the range and gradually exchange it for the paired token if price falls. More SOL is placed near the lower end. The floor is ${(built.rangeDepthFraction * 100).toFixed(1)}% below this price across ${built.binCount} bins.${floor.capped ? ' The 69-bin setup cannot reach the deeper target, so this suggestion uses the attainable depth.' : ''} ${native ? 'Native bin alignment is verified.' : 'This is an estimated grid; native bin alignment is unverified.'} The floor is not a stop-loss.`};
      }
    } catch { /* Invalid or unrepresentable source inputs produce an unavailable range. */ }
  }
  if(options && positive(mark) && positive(binStep) && token){
    const requested=parseStillRangeOptions(options)!;
    try {
      const oneSided=requested.ceilingPct<=0, depth=oneSided?requested.floorPct/100:Math.max(requested.floorPct/100,requested.ceilingPct/(100+requested.ceilingPct));
      const floor=defaultResearchFloor({priceSol:mark,binStep,preferredDepthFraction:depth,oneSided,maxSetupBins:69});
      const built=buildResearchRange({sizeSol,priceSol:mark,floorPriceSol:floor.floorPriceSol,binStep,shape:requested.shape,oneSided,solIsBase:token.solX,maxSetupBins:69,networkSol:0,positionRentSol:0,transferFeeBps:null,...(native?{activeBinId:anchor!.activeBinId!,activeBinPriceSol:mark}:{})});
      const retained=built.selected.bins.filter(b=>b.priceSol>=mark*(1-requested.floorPct/100)/(1+binStep/10000)&&b.priceSol<=mark*(1+requested.ceilingPct/100));
      if(!retained.length||retained.length>69)throw Error('Range cannot be represented');
      const principal=retained.reduce((sum,b)=>sum+b.sol+b.token*mark,0),scale=sizeSol/principal;
      const bins=retained.map(b=>({...b,sol:b.sol*scale,token:b.token*scale,initialSol:b.initialSol*scale,initialPairedTokens:b.initialPairedTokens*scale}));
      const bottom=Math.min(...bins.map(b=>b.priceSol)),top=Math.max(...bins.map(b=>b.priceSol));
      range={shape:requested.shape,floorPriceSol:bottom,topPriceSol:top,binStep,binCount:bins.length,depthFraction:1-bottom/mark,bins,alignment:built.alignment,source:priceSol.source+' + Still paper range model',asOf:markAt,note:`${requested.shape==='Spot'?'Spot spreads evenly.':requested.shape==='Curve'?'Curve bunches near price.':'Bid-Ask puts more at the edges.'} ${oneSided?'SOL-only range below price.':'Two-sided paper inventory before token funding costs.'} Prices are aligned to the available grid; this paper demo caps the setup at 69 bins. The displayed floor and ceiling are the actual modelled range. ${native?'Native anchor verified.':'Native anchor unavailable; estimated grid.'} The floor is not a stop-loss.`};
    }catch{range=null;}
  }
  const hourly = marketCurrent ? stillProjectedFeeRate(pool) : null;
  const feeRateHourly = evidence(hourly, MARKET_SOURCE, pool.fetchedAt, 'Last-hour fees/TVL scaled by min(one-hour volume, 24-hour volume / 24) / one-hour volume. Missing volume stays unavailable. Pool-average fee density, not measured position earnings.');
  const expectedFeesPerDaySol = evidence(hourly === null ? null : sizeSol * hourly * 24, MODEL_SOURCE, pool.fetchedAt,
    'At the current pool pace: paper amount × last-hour fees/TVL × min(1h volume, 24h volume / 24) / 1h volume × 24. The slower volume pace caps the projection. A comparison model, not a forecast or earned fees; a range earns nothing until price enters it and stops earning when price leaves it.');
  const policyCurrent = !!rpc && rpc.status === 'available' && rpc.mint === token?.mint && recent(rpc.asOf, MINT_MAX_AGE_MS, now);
  const bps = policyCurrent && rpc!.transferFeeStatus === 'none' ? 0 : policyCurrent && rpc!.transferFeeStatus === 'known' && Number.isInteger(rpc!.transferFee?.bps) && nonnegative(rpc!.transferFee?.bps) && rpc!.transferFee!.bps <= 10_000 ? rpc!.transferFee!.bps : null;
  const transferFeeBps = evidence(bps, 'Confirmed Solana RPC token mint policy', rpc?.asOf ?? null,
    bps === null ? 'A fresh, mint-matched policy read is unavailable.' : bps === 0 ? 'The observed mint policy charges no transfer fee.' : `Observed Token-2022 transfer fee, capped at ${rpc!.transferFee!.maximumRaw} raw token units per transfer.${rpc!.transferFee!.configAuthority ? ' The fee-setting authority can change this rate.' : ''}`);
  const exitSizeSol=Math.round(sizeSol*.5*1e9)/1e9;
  const exitCandidate = (detail.quotes || []).find(q => q.mode === 'best' && q.sizeSol === exitSizeSol && q.status==='quoted' && stillQuoteFresh(q,now));
  const quote=exitCandidate;
  const quoteData=quote;
  const exitDifference=stillQuoteConversion(quote,'exit',rpc?.decimals,now);
  const poolFee=quote&&nonnegative(quote.stillPoolFeeFloorSol)?quote.stillPoolFeeFloorSol:null;
  const exitValue=exitDifference!==null&&poolFee!==null?Math.max(exitDifference,poolFee):null;
  const betterThanMid=exitDifference!==null&&exitDifference<0&&exitValue!==null;
  const quoteDates=[quoteData?.asOf,quote?.priceMark?.asOf].filter((v):v is string=>!!v);
  const quoteAt=quoteDates.length?quoteDates.sort()[0]:null;
  const quoteMarkSource=quote?.priceMark?.source==='meteora-pool'?'Meteora DLMM Data API exact-pool price':quote?.priceMark?.source==='active-bin'?'Confirmed Solana RPC DLMM active bin':null;
  const entryConversionSol = evidence(range && range.bins.every(b=>b.token===0) ? 0 : null, 'Still paper range allocation', range?.asOf ?? null, range && range.bins.every(b=>b.token===0) ? 'A SOL-only paper allocation buys no paired token at entry. This excludes unmeasured network fees and refundable account rent.' : 'This range needs paired-token inventory. Its entry conversion has not been quoted; network and account setup costs are also unavailable.');
  const exitConversionSol = evidence(exitValue, 'Jupiter dated token-to-SOL quote'+(quoteMarkSource?' + '+quoteMarkSource:''), quoteAt,
    'Half-position token-to-SOL reference: raw token input at the pool active price fetched alongside the quote, minus SOL returned by Jupiter, floored at the current selected-pool base plus dynamic fee. Optional per-hop fields are not required. Better-than-mid proceeds do not reduce costs below this floor.');
  const netRead=detail.network,netFresh=netRead&&recent(netRead.asOf,STILL_NETWORK_MAX_AGE_MS,now)&&Number.isSafeInteger(netRead.singleLamports)&&netRead.singleLamports>=0&&Number.isSafeInteger(netRead.doubleLamports)&&netRead.doubleLamports>=0;
  const oneSided=!!range&&range.bins.every(b=>b.token===0),tokenFunding=range&&mark?Math.round(range.bins.reduce((n,b)=>n+b.token*mark,0)*1e9)/1e9:null;
  // Match the actual SOL input, not only the quote's size label. Missing or
  // wrong-direction funding quotes must never become network-only entry.
  const fundingRaw=positive(tokenFunding)?String(Math.round(tokenFunding*1e9)):null;
  const entryQuote=(detail.entryQuotes||[]).find(q=>q.direction==='entry'&&q.sizeSol===tokenFunding&&q.inputRaw===fundingRaw&&q.status==='quoted'&&stillQuoteFresh(q,now)&&q.tokenRaw&&rpc?.decimals!=null);
  const entrySwapAmountSol=evidence(tokenFunding,'Still paper range allocation',range?.asOf||null,oneSided?'SOL-only inventory: no entry swap required.':'SOL allocated to the paired-token purchase, quoted with Jupiter ExactIn. This is principal exchanged, not a fee.');
  const entryDifference=stillQuoteConversion(entryQuote,'entry',rpc?.decimals,now),entrySwap=oneSided?0:entryDifference===null?null:Math.max(0,entryDifference);
  const oldest=(...dates:(string|null|undefined)[])=>dates.every(d=>d&&Number.isFinite(Date.parse(d)))?(dates as string[]).sort()[0]:null;
  const entryAt=oneSided?oldest(netRead?.asOf,range?.asOf):oldest(netRead?.asOf,rpc?.asOf,entryQuote?.asOf,priceSol.asOf);
  const exitAt=oldest(netRead?.asOf,quoteAt,rpc?.asOf);
  const costAt=oldest(entryAt,exitAt);
  // The paper plan separates returned position rent from sunk setup costs.
  const accounts=detail.accountCosts,accountFresh=!!accounts&&accounts.poolAddress===pool.address&&accounts.positionBytes===STILL_ACCOUNT_LAYOUT.positionBytes&&recent(accounts.asOf,STILL_ACCOUNT_COST_TTL,now)&&Number.isSafeInteger(accounts.positionRentLamports)&&accounts.positionRentLamports>=0;
  const setupFresh=accountFresh&&accounts!.rangeKey===stillAccountRangeKey(range)&&accounts!.rangeKey!==null&&Number.isSafeInteger(accounts!.setupRentLamports)&&accounts!.setupRentLamports!>=0&&Number.isSafeInteger(accounts!.missingAccounts)&&accounts!.missingAccounts!>=0;
  const positionRentSol=evidence(accountFresh?accounts!.positionRentLamports/1e9:null,'Solana RPC getMinimumBalanceForRentExemption · 8,120-byte DLMM PositionV2',accounts?.asOf||null,'Planned new position account deposit, read from chain; returned when the empty position account closes. It is locked capital, excluded from costs and net. It is not an existing wallet balance. Token account deposits are separate.');
  const entryNetwork=netFresh?(netRead!.doubleLamports+(oneSided?0:netRead!.singleLamports))/1e9:null,exitNetwork=netFresh?2*netRead!.singleLamports/1e9:null;
  const setupValue=setupFresh&&netFresh?(accounts!.setupRentLamports!+accounts!.missingAccounts!*netRead!.singleLamports)/1e9:null;
  const setupCostSol=evidence(setupValue,'Confirmed RPC bin-array accounts + rent exemptions + unsigned setup fee templates',oldest(accounts?.asOf,netRead?.asOf),'Non-refundable pool bin-array/bitmap rent plus one single-signature setup transaction per missing account. Existing verified accounts cost zero to create. Unsupported or unverified account layouts stay unavailable. Extra priority fees are not chosen in this paper plan.');
  const entryTransactionFeeSol=evidence(entryNetwork,netRead?.source||'Solana RPC getFeeForMessage',netRead?.asOf||null,'Two-signature paper open; adds one single-signature funding swap for two-sided entry. Setup transaction fees, if needed, appear separately in setup cost.');
  // Transfer fees round UP in raw token units and are capped per transfer.
  // Jupiter proceeds already include the swap transfer fee: add only the
  // separate LP withdrawal fee, never apply the percentage twice to its quote.
  const rawTransferCost=(rawAmount:string|null):number|null=>{
    if(bps===0)return 0;
    if(bps===null||!positive(mark)||!Number.isInteger(rpc?.decimals)||rpc!.decimals!<0||rpc!.decimals!>18||!/^\d{1,78}$/.test(rpc?.transferFee?.maximumRaw||'')||!/^\d{1,78}$/.test(rawAmount||''))return null;
    const amount=BigInt(rawAmount!),tax=(amount*BigInt(bps)+9999n)/10000n,cap=BigInt(rpc!.transferFee!.maximumRaw),cost=Number(tax<cap?tax:cap)/10**rpc!.decimals!*mark;return nonnegative(cost)?cost:null;
  };
  const amountRaw=(sol:number|null)=>positive(mark)&&nonnegative(sol)&&Number.isInteger(rpc?.decimals)&&rpc!.decimals!>=0&&rpc!.decimals!<=18&&Number.isSafeInteger(Math.floor(sol/mark*10**rpc!.decimals!))?String(Math.floor(sol/mark*10**rpc!.decimals!)):null;
  const withdrawalFromQuote=/^\d{1,78}$/.test(quote?.tokenRaw||''),withdrawalRaw=withdrawalFromQuote?quote!.tokenRaw!:amountRaw(exitSizeSol);
  const withdrawalAt=oldest(rpc?.asOf,priceSol.asOf,...(withdrawalFromQuote?[quoteAt]:[]));
  const withdrawalTax=rawTransferCost(withdrawalRaw),depositTax=oneSided?0:rawTransferCost(entryQuote?.tokenRaw||amountRaw(tokenFunding));
  const exitTransferFeeSol=evidence(withdrawalTax,'Confirmed Token-2022 mint policy + half-position token reference at the observed pool price',withdrawalAt,(withdrawalFromQuote?'Uses the dated Jupiter reference token quantity. ':'Uses a half-position token quantity derived from the dated pool mark. ')+'One separate LP withdrawal transfer, rounded up in raw token units and capped by the observed on-chain maximum. Jupiter swap proceeds already include their own transfer fees. Without a swap quote this is a known minimum component, not a complete exit. Future inventory and fee policy can change.');
  const scope='Paper estimate: 2-signature open + one close + one exit swap; an extra entry swap for two-sided funding. Dated RPC base fees (reused for at most ten minutes), zero priority bid by choice. Non-refundable bin-array/bitmap setup is included; refundable position rent is excluded from net. Existing token accounts or separately refunded token-account deposits are assumed; wallet-specific account setup is not quoted. This is not an LP transaction simulation.';
  const networkCostSol=evidence(netFresh?(entryNetwork!+exitNetwork!):null,netRead?.source||'Solana RPC getFeeForMessage',netRead?.asOf||null,scope);
  if(entrySwap!==null&&Number.isFinite(entrySwap)){entryConversionSol.value=entrySwap;entryConversionSol.status='available';entryConversionSol.source=oneSided?'Still paper range allocation':'Jupiter exact-size funding quote + observed pool mark';entryConversionSol.asOf=oneSided?range?.asOf||null:entryQuote?.asOf||null;entryConversionSol.note=oneSided?'No token purchase for this SOL-only paper allocation.':'Exact funding quote: SOL input minus tokens actually returned valued at the dated pool mid-price. Proceeds already include swap fees and price impact; favourable execution is floored at zero conversion loss; network and transfer costs remain payable. Network fees and separate LP deposit transfer tax are separate.';}
  const entryCostSol=evidence(entryNetwork!==null&&entrySwap!==null&&depositTax!==null?entryNetwork+entrySwap+depositTax:null,'Paper cost model · RPC fee templates + exact-size Jupiter funding quote + deposit transfer fee',entryAt,scope+' Non-refundable account setup is shown separately and added to the round-trip net calculation.');
  const exitCostComplete=bps!==null&&exitNetwork!==null&&exitNetwork+ (poolFee??0)>0&&exitValue!==null&&withdrawalTax!==null;
  const exitCostSol=evidence(exitCostComplete?exitNetwork!+exitValue!+withdrawalTax!:null,'Paper cost model · Jupiter half-position mid-value minus proceeds + RPC fees + withdrawal transfer fee'+(quoteMarkSource?' + '+quoteMarkSource:''),exitCostComplete?exitAt:null,scope+(exitCostComplete?' Half-position token conversion reference, not an actual future withdrawal.':' Complete exit quote unavailable. Any verified withdrawal tax remains separately visible, but is not a complete exit total.'));
  const roundTripCostSol=evidence(entryCostSol.value!==null&&exitCostComplete&&setupValue!==null?entryCostSol.value+exitCostSol.value!+setupValue:null,'Paper entry + exit + non-refundable setup cost model',oldest(costAt,setupCostSol.asOf),scope);
  const netValue=roundTripCostSol.value!==null&&hourly!==null?sizeSol*hourly*(options?.holdMinutes||240)/60-roundTripCostSol.value:null;
  const netReturnPct=evidence(netValue===null?null:netValue/sizeSol*100,'Paper net / paper SOL amount × 100',oldest(roundTripCostSol.asOf,feeRateHourly.asOf),'Projected fee income at unchanged pool pace minus complete measured paper-plan costs. Returnable position deposit is excluded. This is a percentage of the selected SOL size, not realized profit.');
  const breakEvenStatus:StillPreflight['breakEvenStatus']=roundTripCostSol.value===null||hourly===null?'unavailable':hourly===0&&roundTripCostSol.value>0?'never':'covered';
  const breakEvenHours=evidence(breakEvenStatus==='covered'?(roundTripCostSol.value!<=0?0:roundTripCostSol.value!/(sizeSol*hourly!)):null,'Complete paper costs / current projected hourly fees',oldest(roundTripCostSol.asOf,feeRateHourly.asOf),breakEvenStatus==='never'?"Fees don't cover costs at the observed zero fee pace.":'Hours at unchanged fee pace, assuming eligible in-range liquidity throughout. Missing costs or fee observations keep this unavailable.');
  const solPriceUsd=evidence(marketCurrent&&positive(token?.solUsd)?token.solUsd:null,MARKET_SOURCE,pool.fetchedAt,'Observed USD price of the SOL-side token for this exact pool; used only for dollar display, not an invented SOL conversion.');
  const scenarios = [0.2, 0.5].map(dropFraction => {
    const stress = mark === null ? null : mark * (1 - dropFraction);
    const gross = range && positive(stress) ? inventoryAtPrice(range.bins, stress).valueSol : null;
    const note = 'Ideal monotonic downward bin-fill scenario, before fees, transfer taxes, slippage, network costs and liquidity limits. This is not a loss limit or a live quote.';
    return {dropFraction, priceSol: evidence(stress, MODEL_SOURCE, markAt, 'Observed SOL/token price multiplied by the stated stress fraction.'),
      grossValueSol: evidence(gross, MODEL_SOURCE, range?.asOf ?? null, note), grossPnlSol: evidence(gross === null ? null : gross - sizeSol, MODEL_SOURCE, range?.asOf ?? null, note),
      netValueSol: evidence<number>(null, 'LP entry and exit simulation', null, 'A current quote cannot price a future stressed withdrawal. Gross scenario value is before costs.'),
      pnlSol: evidence<number>(null, 'LP entry and exit simulation', null, 'Future stressed exit cost is unavailable; today’s reference quote is not applied to a different future inventory.'),
      vsHoldingSol: evidence<number>(null, 'LP entry and exit simulation', null, 'Future stressed exit costs are unavailable. This is a gross inventory scenario, not a net forecast.')};
  });
  const thinExampleOnly=marketCurrent&&pool.tvlUsd!<STILL_MIN_TVL_USD;
  const canOpen = marketCurrent && !thinExampleOnly && !!range && positive(mark);
  const missingEvidence = [!positive(mark) ? 'Current pool price' : null, !range ? 'Valid paper range' : null,
    hourly === null ? 'One-hour fees and both volume windows' : null, bps === null ? 'Current token transfer-fee policy' : null,
    exitValue === null ? exitCandidate?'Concurrent quote amounts, mid-price and pool-fee floor':(detail.quotes?.[0]?.note||'Fresh half-position token-to-SOL quote') : null,setupValue===null?'Non-refundable setup cost':null,positionRentSol.value===null?'Refundable position deposit':null, roundTripCostSol.value===null?'Paper cost-plan evidence':null].filter((item): item is string => !!item);
  let verdict: StillPreflight['verdict'] = {label: 'Marginal', reason: 'Complete costs are unavailable, so fees cannot yet be compared with the real cost of entering and leaving. You can still practise on paper.'};
  if (!canOpen) verdict = {label: 'Skip', reason: 'A current price and a valid range are needed before this paper position can be modelled.'};
  else if (policyCurrent && rpc?.freezeAuthority && !isStillKnownIssuer(token?.mint)) verdict = {label: 'Skip', reason: 'The token has an active freeze authority. Practice is available, but this screen does not support a real deposit.'};
  else if (policyCurrent && rpc?.transferFee?.configAuthority) verdict = {label: 'Skip', reason: 'The token transfer-fee authority can change the tax after entry.'};
  else if (hourly === 0) verdict = {label: 'Skip', reason: 'The last complete hour reports no pool fees, so there is no observed fee pace to compare with costs.'};
  else if (hourly !== null && exitValue !== null && sizeSol * hourly * 24 <= exitValue) verdict = {label: 'Skip', reason: 'Even the quoted conversion cost exceeds a full day at the current pool fee pace, before other costs.'};
  const result: StillPreflight = {entrySwapAmountSol,pool: card, poolAddress: pool.address, name: pool.pair, sizeSol, fetchedAt: markAt, priceSol, range, feeRateHourly, expectedFeesPerDaySol,
    betterThanMid,thinExampleOnly,exitPoolFeeSol:evidence(poolFee,'Concurrent Meteora selected-pool base + dynamic fee × quoted token mid-value',quote?.priceMark?.asOf||null,'Minimum conversion cost even when Jupiter beats mid; network and LP withdrawal transfer fees are added separately.'),solPriceUsd,positionRentSol,setupCostSol,entryTransactionFeeSol,exitTransferFeeSol,exitCostComplete,netReturnPct,breakEvenHours,breakEvenStatus,transferFeeBps, entryCostSol, exitCostSol, entryConversionSol, exitConversionSol, networkCostSol, roundTripCostSol, scenarios, verdict, canOpen, missingEvidence,
    model: {kind: 'paper-monotonic-bin-model', note: 'Paper practice only. Fixed-price bins model a monotonic move; real partial fills, liquidity share and transaction execution are not reproduced. Missing costs keep net results unavailable.'},
    ledger: {priceSol: mark, feeRateHourly: hourly, entryCostsSol: entryCostSol.value!==null&&setupValue!==null?entryCostSol.value+setupValue:null, exitCostsSol: exitCostComplete?exitCostSol.value:null, transferFeeBps: bps, bins: range?.bins ?? null}};
  result.paperCostModel={label:'Paper estimate, not an execution quote',note:scope,asOf:roundTripCostSol.asOf,netAfterHoldSol:evidence(netValue,'Paper pool-pace projection minus dated cost model',roundTripCostSol.asOf,'Assumes unchanged pool fee pace and eligible in-range liquidity throughout the planned hold. Not actual earnings or a prediction.')};
  result.options=options;
  result.transferFeeChangeable=evidence(policyCurrent ? !!rpc!.transferFee?.configAuthority : null,'Solana RPC mint transfer-fee authority',rpc?.asOf||null,'Whether the observed fee-setting authority remains active.');
  result.checks=stillChecks(result,detail,now);
  // Stress scenarios describe consequences, not entry signals: a 50% fall is
  // not itself a reason to reject every pool. Observed screening failures are.
  const failed=result.checks.find(c=>!['half','drop20'].includes(c.id)&&c.status==='fail');
  const nameReason=(c:StillCheck)=>`${c.label}: ${c.shortReason||c.result}`;
  if(thinExampleOnly)result.verdict={label:'Skip',reason:`Liquidity under $5k. ${exitCostSol.value!==null?`Exit costs ${(exitCostSol.value/sizeSol*100).toFixed(2)}% of this position.`:'Exit cost unavailable.'} Thin-pool example only.`};
  else if(!canOpen)result.verdict={label:'Skip',reason:'Paper range: current price or a valid range is unavailable.'};
  else if(!exitCostComplete)result.verdict={label:'Marginal',reason:'Exit cost unavailable: a complete quote and fee floor could not be verified.'};
  else if(policyCurrent&&!!rpc?.freezeAuthority&&!isStillKnownIssuer(token?.mint))result.verdict={label:'Skip',reason:'Freeze authority: active authority can freeze token accounts.'};
  else if(policyCurrent&&!!rpc?.transferFee?.configAuthority)result.verdict={label:'Skip',reason:'Transfer tax: the authority can change the fee.'};
  else if(netValue!==null&&netValue<=0)result.verdict={label:'Skip',reason:`Entry and exit cost: fees do not cover costs in ${(options?.holdMinutes||240)/60} hours.`};
  else if(failed)result.verdict={label:'Skip',reason:nameReason(failed)};
  else if(roundTripCostSol.value!==null){
    const concerns=result.checks.filter(c=>!['half','drop20'].includes(c.id)&&c.status!=='pass');
    result.verdict={label:concerns.length?'Marginal':'Worth it',reason:concerns.length?concerns.map(nameReason).join('; '):'All checks pass: projected fees cover the measured costs.'};
  }else result.verdict={label:'Marginal',reason:'Entry and setup cost: complete evidence unavailable.'};

  result.missingEvidence=[...new Set([...result.missingEvidence,...result.checks.filter(c=>c.status==='unavailable').map(c=>c.label)])];
  return result;
}

const preflightInputKey = (poolAddress: string, sizeSol: number, options?: StillRangeOptions) =>
  'still:preflight-input:v7:' + poolAddress + ':' + Math.round(sizeSol * 1e9) + ':' + JSON.stringify(options || null);

/** One exact default-size KV read per card, at most eight. Never refreshes the
 * snapshot or calls providers: list views must not fan out into RPC or quotes. */
export async function listStillPoolsWithSummaries(snapshot: Snapshot, env: Env, now = Date.now()): Promise<(StillPoolCard & {cardSummary: StillPoolCardSummary})[]> {
  const cards = listStillPools(snapshot, now), pools = new Map(snapshot.pools.map(pool => [pool.address, pool]));
  return Promise.all(cards.map(async card => {
    const pool = pools.get(card.address)!;
    let input: StillPreflightInput = {pool}, preflight = buildStillPreflight(input, 0.5, now), cached = false;
    try {
      const saved = await env.LP_CACHE.get<{at: string; input: StillPreflightInput}>(preflightInputKey(pool.address, 0.5), 'json');
      const observed = saved?.input?.pool;
      // Address alone is insufficient: bind the token sides and bin grid too.
      // Rebuilding the input rechecks each evidence TTL instead of replaying a
      // previously computed passing verdict after its quote has expired.
      if (saved && recent(saved.at, 45_000, now) && observed && supportedPool(observed, now) &&
        observed.address === pool.address && observed.base.address === pool.base.address &&
        observed.quote.address === pool.quote.address && observed.poolConfig?.binStep === pool.poolConfig?.binStep) {
        const rebuilt = buildStillPreflight(saved.input, 0.5, now);
        input = saved.input; preflight = rebuilt; cached = true;
      }
    } catch { /* Missing, malformed or unavailable cached evidence stays unknown. */ }
    const reasons: StillPoolCardSummary['reasons'] = (preflight.checks || []).filter(check => !['half', 'drop20'].includes(check.id))
      .map(({id, label, status, shortReason, result, source, asOf}) => ({id, label, status, shortReason, result, source, asOf}));
    if (!preflight.canOpen) reasons.unshift({id: 'range', label: 'Paper range', status: 'fail', result: preflight.verdict.reason,
      source: preflight.priceSol.source + ' + Still paper range model', asOf: preflight.priceSol.asOf});
    const priority = {fail: 0, caution: 1, unavailable: 2, pass: 3};
    reasons.sort((a, b) => priority[a.status] - priority[b.status]);
    const selected = reasons.slice(0, 3), dates = selected.map(check => check.asOf).filter((at): at is string => !!at && Number.isFinite(Date.parse(at)));
    return {...card, cardSummary: {verdict: preflight.verdict, reasons: selected, sizeSol: 0.5,
      scope: '0.5 paper SOL · default range', asOf: dates.length ? dates.sort()[0] : null,
      note: cached ? 'Saved default Pre-flight, checked for expiry. Open Pre-flight to refresh prices and costs.'
        : 'Pool observations only; live entry and exit costs are unavailable. Open Pre-flight to check 0.5 paper SOL.'}};
  }));
}

/** Fast path: pool snapshot and existing provider caches only. No user click waits
 * for a fanout of RPC/quote requests. An explicit detail refresh may enrich it. */
export async function getStillPreflight(env: Env, poolAddress: string, sizeSol = 0.5, options?: StillRangeOptions, live = false): Promise<StillPreflight | null> {
  const stored = await getSnapshot(env), hot=await readStillHotPools(env,false), combined={...stored,pools:[...stored.pools,...hot.pools.filter(p=>!stored.pools.some(s=>s.address===p.address))]}, snapshot = poolAddress===STILL_THIN_DEMO.address ? await withStillDemoObservation(combined,env,live) : combined, pool = snapshot.pools.find(item => item.address === poolAddress || item.id === poolAddress) || (live&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress)?await fetchMeteoraPool(poolAddress).catch(()=>null):null);
  if (!pool || pool.venue !== 'meteora-dlmm' || !researchToken(pool)) return null;
  const savedKey=preflightInputKey(pool.address,sizeSol,options);
  if(!live){try{const saved=await env.LP_CACHE.get<{at:string;input:StillPreflightInput}>(savedKey,'json');if(saved&&recent(saved.at,45000,Date.now())&&saved.input.pool.address===pool.address&&researchToken(saved.input.pool)?.mint===researchToken(pool)?.mint)return buildStillPreflight(saved.input,sizeSol,Date.now(),options);}catch{}}
  if(live){
    const context=researchReadContext(env),token=researchToken(pool)!;
    const [freshPool,rpc,rug,candles,network]=await Promise.all([fetchMeteoraPool(pool.address).catch(()=>null),readMintSafety(token.mint,context),readRugSafety(token.mint,context),readResearchCandles(pool,context),readStillNetwork(env,true)]);
    const current=freshPool&&researchToken(freshPool)?.mint===token.mint?freshPool:pool;
    const anchor=await readResearchRangeAnchor(current,context,rpc);
    const apiToken=freshPool&&freshPool.address===pool.address?researchToken(freshPool):null;
    const mark:ResearchQuoteMark|null=anchor.status==='available'&&positive(anchor.activeBinPriceSol)&&anchor.asOf?{priceSol:anchor.activeBinPriceSol,asOf:anchor.asOf,source:'active-bin'}:freshPool&&apiToken?.mint===token.mint&&positive(apiToken.priceSol)&&recent(freshPool.fetchedAt,45_000,Date.now())?{priceSol:apiToken.priceSol,asOf:freshPool.fetchedAt,source:'meteora-pool',poolAddress:pool.address,mint:token.mint}:null;
    const quotes=[await readStillSwapQuote(current,context,rpc.decimals,mark,'exit',Math.round(sizeSol*.5*1e9)/1e9)];
    const initial=buildStillPreflight({pool:current,quotes,safety:{rpc},rug,candles,rangeAnchor:anchor,network},sizeSol,Date.now(),options);
    const funding=initial.range&&initial.priceSol.value?Math.round(initial.range.bins.reduce((n,b)=>n+b.token*initial.priceSol.value!,0)*1e9)/1e9:0;
    const entryQuotes=funding>0?[await readStillSwapQuote(current,context,rpc.decimals,mark,'entry',funding)]:[];
    const accountCosts=await readStillAccountCosts(env,pool.address,initial.range,true);
    const input={pool:current,quotes,entryQuotes,safety:{rpc},rug,candles,rangeAnchor:anchor,network,accountCosts};
    try{await env.LP_CACHE.put(savedKey,JSON.stringify({at:new Date().toISOString(),input}),{expirationTtl:60});}catch{}
    const result=buildStillPreflight(input,sizeSol,Date.now(),options);
    if(!result.exitCostComplete||result.entryCostSol.value===null||result.netReturnPct.value===null)console.warn(JSON.stringify({event:'still_preflight_unavailable',poolAddress:pool.address,reasons:result.missingEvidence}));
    return result;
  }
  const mint = researchToken(pool)!.mint;
  const rpc = await cachedMintSafety(mint, env);
  const quotes = await cachedResearchQuotes(pool, env, rpc.decimals);
  return buildStillPreflight({pool, quotes, safety: {rpc},network:await readStillNetwork(env)}, sizeSol,Date.now(),options);
}
export async function loadStillPreflight(pool: Pool, env: Env, sizeSol = 0.5, now = Date.now()): Promise<StillPreflight> {
  const detail: ResearchPoolDetail = await researchPool(pool, env);
  return buildStillPreflight(detail, sizeSol, Math.max(now, Date.now()));
}
export async function getStillBaskets(env: Env): Promise<StillBasket[]> {
  const hot=await readStillHotPools(env,false);return buildStillBaskets(hot.updatedAt?hot:await getSnapshot(env));
}
export async function getStillPoolMark(env: Env, poolAddress: string) {
  const snapshot = await getSnapshot(env);
  const pool = snapshot.pools.find(item => item.address === poolAddress || item.id === poolAddress) || (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress)?await fetchMeteoraPool(poolAddress).catch(()=>null):null);
  if (!pool || pool.venue !== 'meteora-dlmm' || !researchToken(pool)) return null;
  const now = Date.now(), current = recent(pool.fetchedAt, STILL_MAX_PRICE_AGE_MS, now), token = researchToken(pool);
  return {poolAddress: pool.address, name: pool.pair, priceSol: current && positive(token?.priceSol) ? token.priceSol : null,
    fetchedAt: pool.fetchedAt, source: MARKET_SOURCE, feeRateAsOf: pool.fetchedAt,
    feeRateHourly: current ? stillProjectedFeeRate(pool) : null};
}

export interface StillBasketPreflight {
  paper: true; basket: StillBasket; sizeSol: number;
  components: {poolAddress: string; weightBps: number; sizeSol: number; preflight: StillPreflight}[];
  canOpen: boolean; expectedFeesPerDaySol: StillEvidence<number>; scenarios: StillScenario[];
  entryCostSol: StillEvidence<number>; exitCostSol: StillEvidence<number>; roundTripCostSol: StillEvidence<number>;
  verdict: {label: 'Worth it' | 'Marginal' | 'Skip'; reason: string}; missingEvidence: string[];
}
/** Aggregation never replaces an unavailable leg with zero. */
export function combineStillBasketPreflight(basket: StillBasket, preflights: StillPreflight[], sizeSol: number): StillBasketPreflight {
  if (!positive(sizeSol) || sizeSol > 1000) throw new RangeError('Choose a paper amount greater than zero and no more than 1,000 SOL.');
  const coherent = basket.status === 'available' && basket.legs.length >= 1 && basket.legs.length <= 3 &&
    new Set(basket.legs.map(leg => leg.poolAddress)).size === basket.legs.length &&
    basket.legs.every(leg => Number.isInteger(leg.weightBps) && leg.weightBps > 0) &&
    basket.legs.reduce((sum, leg) => sum + leg.weightBps, 0) === 10_000;
  const components = coherent ? basket.legs.flatMap(leg => {
    const preflight = preflights.find(item => item.poolAddress === leg.poolAddress);
    const allocation = sizeSol * leg.weightBps / 10_000;
    return preflight && Math.abs(preflight.sizeSol - allocation) < 1e-9 ? [{...leg, sizeSol: allocation, preflight}] : [];
  }) : [];
  const complete = coherent && components.length === basket.legs.length;
  const sum = (pick: (item: StillPreflight) => StillEvidence<number>): StillEvidence<number> => {
    const values = components.map(component => pick(component.preflight));
    const available = complete && values.every(value => value.status === 'available' && finite(value.value));
    return evidence(available ? values.reduce((total, value) => total + value.value!, 0) : null,
      'Sum of the displayed component evidence', values.length && values.every(value => value.asOf) ? values.map(value => value.asOf!).sort()[0] : null,
      'All component figures must be available. Each retains its own source and timestamp in the component pre-flight. This total is a paper model.');
  };
  const unknown = () => evidence<number>(null, 'Complete basket component evidence', null, 'A required component figure is unavailable.');
  const scenarios = [0.2, 0.5].map(dropFraction => {
    const field = (name: keyof Pick<StillScenario, 'grossValueSol' | 'grossPnlSol' | 'netValueSol' | 'pnlSol' | 'vsHoldingSol'>) =>
      sum(preflight => preflight.scenarios.find(scenario => scenario.dropFraction === dropFraction)?.[name] || unknown());
    return {dropFraction, priceSol: evidence<number>(null, 'Separate component token prices', null, 'A basket has no single token price; the same percentage stress is applied independently to each component.'),
      grossValueSol: field('grossValueSol'), grossPnlSol: field('grossPnlSol'), netValueSol: field('netValueSol'), pnlSol: field('pnlSol'), vsHoldingSol: field('vsHoldingSol')};
  });
  const canOpen = complete && components.every(item => item.preflight.canOpen);
  const skip = components.find(item => item.preflight.verdict.label === 'Skip');
  const verdict: StillBasketPreflight['verdict'] = !canOpen ? {label: 'Skip', reason: 'All basket pools need a current price and a valid range before the combined paper deposit.'} : skip ?
    {label: 'Skip', reason: `${skip.preflight.name}: ${skip.preflight.verdict.reason}`} :
    {label: 'Marginal', reason: 'Complete costs are unavailable for at least one component. Review both pre-flights; a basket does not remove token or liquidity risk.'};
  return {paper: true, basket, sizeSol, components, canOpen, expectedFeesPerDaySol: sum(item => item.expectedFeesPerDaySol), scenarios,
    entryCostSol: sum(item => item.entryCostSol), exitCostSol: sum(item => item.exitCostComplete ? item.exitCostSol : unknown()), roundTripCostSol: sum(item => item.roundTripCostSol), verdict,
    missingEvidence: !complete ? ['A current, complete basket allocation'] : [...new Set(components.flatMap(item => item.preflight.missingEvidence))]};
}
export async function getStillBasketPreflight(env: Env, basketId: string, sizeSol = 0.5, live=false): Promise<StillBasketPreflight | null> {
  const basket = (await getStillBaskets(env)).find(item => item.id === basketId);
  if (!basket) return null;
  const preflights: StillPreflight[] = [];
  // Presets currently have two components. Hard cap protects against a bad cache or future unbounded definitions.
  if (basket.status === 'available' && basket.legs.length >= 1 && basket.legs.length <= 3) {
    const reads=await Promise.all(basket.legs.map(leg=>getStillPreflight(env,leg.poolAddress,sizeSol*leg.weightBps/10_000,basket.range,live)));
    for(const preflight of reads)if(preflight)preflights.push(preflight);
  }
  return combineStillBasketPreflight(basket, preflights, sizeSol);
}
