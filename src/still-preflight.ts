import type {Env} from './env';
import type {Pool, Snapshot} from './schema';
import {getSnapshot} from './refresh';
import {researchFeeRates, researchPool, type ResearchPoolDetail} from './lp-research';
import {cachedMintSafety, cachedResearchQuotes, researchQuoteFresh, researchEconomicQuoteFresh, researchToken, type MintSafety, type ResearchQuote, type ResearchRangeAnchor} from './sources/research-reads';
import {buildResearchRange, defaultResearchFloor, inventoryAtPrice, type ResearchRangeBin} from './research-range';

export const STILL_MAX_PRICE_AGE_MS = 10 * 60_000;
export const STILL_MIN_TVL_USD = 5_000;
const MINT_MAX_AGE_MS = 5 * 60_000;
const MARKET_SOURCE = 'Meteora DLMM Data API';
const MODEL_SOURCE = 'Still paper range model + Meteora DLMM Data API';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const recent = (asOf: string | null | undefined, ttl: number, now: number) => {
  const at = Date.parse(asOf || '');
  return Number.isFinite(at) && at <= now && now - at <= ttl;
};

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
  tvlUsd: StillEvidence<number>;
  fees24hFraction: StillEvidence<number>;
  feeTrend: StillEvidence<number>;
  ageHours: StillEvidence<number>;
  priceSol: StillEvidence<number>;
  binStep: StillEvidence<number>;
  risk: {label: StillRiskLabel; reason: string; source: string; asOf: string};
}
function supportedPool(pool: Pool, now: number) {
  const token = researchToken(pool);
  return pool.chain === 'solana' && pool.venue === 'meteora-dlmm' && !!token &&
    recent(pool.fetchedAt, STILL_MAX_PRICE_AGE_MS, now) && positive(pool.tvlUsd) && pool.tvlUsd >= STILL_MIN_TVL_USD &&
    positive(token?.priceSol) && Number.isInteger(pool.poolConfig?.binStep) && positive(pool.poolConfig?.binStep) && pool.poolConfig!.binStep! <= 10_000 &&
    !pool.tags?.some(tag => ['suspect', 'blacklisted', 'near-empty'].includes(tag));
}
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
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) || a.address.localeCompare(b.address));
}
/** A bounded, diverse shortlist; opening the page triggers no quote/RPC fanout. */
export function listStillPools(snapshot: Snapshot, now = Date.now()): StillPoolCard[] {
  const candidates = rankedPools(snapshot, now), picked = new Map<string, Pool>();
  for (const band of ['Steady', 'Busy', 'Spicy'] as const) {
    const bandPools = candidates.filter(item => classify(item).label === band), selected: Pool[] = [], mints = new Set<string>();
    // Prefer different token exposures without confusing pool identity with token identity.
    for (const pool of bandPools) {
      const mint = researchToken(pool)!.mint;
      if (mints.has(mint)) continue;
      selected.push(pool); mints.add(mint);
      if (selected.length === 2) break;
    }
    for (const pool of bandPools) {
      if (selected.length === 2) break;
      if (!selected.some(item => item.address === pool.address)) selected.push(pool);
    }
    for (const pool of selected) picked.set(pool.address, pool);
  }
  for (const pool of candidates) { if (picked.size >= 8) break; picked.set(pool.address, pool); }
  return [...picked.values()].slice(0, 8).map(pool => poolCard(pool, now));
}
export interface StillBasket {
  id: string; name: StillRiskLabel; reason: string; status: 'available' | 'unavailable'; source: string; asOf: string | null;
  components: {poolId: string; pool: StillPoolCard; weightBps: number}[];
  legs: {poolAddress: string; weightBps: number}[];
}
export function buildStillBaskets(snapshot: Snapshot, now = Date.now()): StillBasket[] {
  const pools = listStillPools(snapshot, now);
  return (['Steady', 'Busy', 'Spicy'] as const).map(name => {
    const members = pools.filter(pool => pool.risk.label === name).slice(0, 2);
    const available = members.length === 2;
    let reason = !available ? 'Two current pools in this band are needed. Check again after the market data refreshes.' :
      name === 'Steady' ? 'Two deeper pools with longer histories and no observed fee burst. Equal paper amounts; no stable-price or low-risk claim.' :
      name === 'Busy' ? 'Two established pools outside the Steady screen. Equal paper amounts; compare both pre-flights before practising.' :
      'Two pools with a short history, thin liquidity or a fee burst. Equal paper amounts; speculative practice only.';
    if (available && members[0].pairedMint === members[1].pairedMint) reason += ' Both pools hold the same paired token; this does not diversify token exposure.';
    return {id: name.toLowerCase(), name, reason, status: available ? 'available' : 'unavailable',
      source: MARKET_SOURCE + ' + Still risk thresholds', asOf: members.length ? members.map(p => p.risk.asOf).sort()[0] : null,
      components: available ? members.map(pool => ({poolId: pool.id, pool, weightBps: 5000})) : [],
      legs: available ? members.map(pool => ({poolAddress: pool.address, weightBps: 5000})) : []};
  });
}

export interface StillRange {
  shape: 'BidAsk'; floorPriceSol: number; topPriceSol: number; binStep: number; binCount: number;
  depthFraction: number; bins: ResearchRangeBin[]; alignment: string; source: string; asOf: string; note: string;
}
export interface StillScenario {
  dropFraction: number; priceSol: StillEvidence<number>; grossValueSol: StillEvidence<number>;
  grossPnlSol: StillEvidence<number>; netValueSol: StillEvidence<number>; pnlSol: StillEvidence<number>; vsHoldingSol: StillEvidence<number>;
}
export interface StillPreflight {
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
  pool: Pool; quotes?: ResearchQuote[]; safety?: {rpc: MintSafety}; rangeAnchor?: ResearchRangeAnchor;
}
/** Build only what observed inputs support. The inherited model's network default
 * is explicitly overridden for gross inventory arithmetic, and never presented as
 * a measured zero-cost transaction. Missing network evidence keeps all-in net null. */
export function buildStillPreflight(detail: StillPreflightInput, sizeSol = 0.5, now = Date.now()): StillPreflight {
  if (!positive(sizeSol) || sizeSol > 1000) throw new RangeError('Choose a paper amount greater than zero and no more than 1,000 SOL.');
  const pool = detail.pool, card = poolCard(pool, now), token = researchToken(pool), rpc = detail.safety?.rpc;
  const marketCurrent = supportedPool(pool, now), anchor = detail.rangeAnchor;
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
  const rates = researchFeeRates(pool), hourly = marketCurrent && nonnegative(pool.ageHours) && pool.ageHours >= 1 && nonnegative(rates.h1) ? rates.h1 : null;
  const feeRateHourly = evidence(hourly, MARKET_SOURCE, pool.fetchedAt, 'Reported last-hour fees / current pool TVL. Pool-average fee density, not measured position earnings.');
  const expectedFeesPerDaySol = evidence(hourly === null ? null : sizeSol * hourly * 24, MODEL_SOURCE, pool.fetchedAt,
    'At the current pool pace: paper amount × last-hour pool fees/TVL × 24. A comparison model, not a forecast or earned fees; the suggested range starts below the active price and earns nothing until price enters it.');
  const policyCurrent = !!rpc && rpc.status === 'available' && rpc.mint === token?.mint && recent(rpc.asOf, MINT_MAX_AGE_MS, now);
  const bps = policyCurrent && rpc!.transferFeeStatus === 'none' ? 0 : policyCurrent && rpc!.transferFeeStatus === 'known' && Number.isInteger(rpc!.transferFee?.bps) && nonnegative(rpc!.transferFee?.bps) && rpc!.transferFee!.bps <= 10_000 ? rpc!.transferFee!.bps : null;
  const transferFeeBps = evidence(bps, 'Confirmed Solana RPC token mint policy', rpc?.asOf ?? null,
    bps === null ? 'A fresh, mint-matched policy read is unavailable.' : bps === 0 ? 'The observed mint policy charges no transfer fee.' : `Observed Token-2022 transfer fee, capped at ${rpc!.transferFee!.maximumRaw} raw token units per transfer.${rpc!.transferFee!.configAuthority ? ' The fee-setting authority can change this rate.' : ''}`);
  const quote = (detail.quotes || []).find(q => q.mode === 'best' && q.sizeSol === sizeSol && ['jupiter-route', 'pool-config', 'pump-config'].includes(q.exitFeeSource || '') &&
    (!q.economicEstimate || q.economicEstimate.costModelVersion === 3 && q.economicEstimate.exitFeeSource !== 'assumed') &&
    ((q.status === 'quoted' && researchQuoteFresh(q, now)) || (researchEconomicQuoteFresh(q, now) && q.economicEstimate?.retained !== true)));
  const quoteData = quote?.economicEstimate && researchEconomicQuoteFresh(quote, now) ? quote.economicEstimate : quote;
  const exitValue = nonnegative(quoteData?.exitCostSol) ? quoteData!.exitCostSol! : null;
  const quoteAt = quoteData?.asOf ?? null;
  const entryConversionSol = evidence(range ? 0 : null, 'Still SOL-only range allocation', range?.asOf ?? null, 'A SOL-only paper allocation buys no paired token at entry. This excludes unmeasured network fees and refundable account rent.');
  const exitConversionSol = evidence(exitValue, 'Jupiter dated token-to-SOL quote', quoteAt,
    'Full-size reference conversion cost only. This is not an actual LP withdrawal quote, does not include network fees or additional withdrawal tax, and is not a future exit guarantee.');
  const networkCostSol = evidence<number>(null, 'Solana transaction fee simulation', null, 'No actual unsigned LP transaction has been simulated. Network and account setup costs are unavailable.');
  const entryCostSol = evidence<number>(null, 'LP transaction simulation', null, 'All-in entry costs are unavailable because network/account setup evidence is missing. No zero-cost assumption.');
  const exitCostSol = evidence<number>(null, 'LP withdrawal + Jupiter quote + Solana fee simulation', quoteAt, 'All-in exit costs are unavailable; a reference swap quote alone does not price an LP withdrawal and network fees.');
  const roundTripCostSol = evidence<number>(null, 'LP entry and exit simulation', null, 'Complete entry and exit cost evidence is unavailable.');
  const scenarios = [0.2, 0.5].map(dropFraction => {
    const stress = mark === null ? null : mark * (1 - dropFraction);
    const gross = range && positive(stress) ? inventoryAtPrice(range.bins, stress).valueSol : null;
    const note = 'Ideal monotonic downward bin-fill scenario, before fees, transfer taxes, slippage, network costs and liquidity limits. This is not a loss limit or a live quote.';
    return {dropFraction, priceSol: evidence(stress, MODEL_SOURCE, markAt, 'Observed SOL/token price multiplied by the stated stress fraction.'),
      grossValueSol: evidence(gross, MODEL_SOURCE, range?.asOf ?? null, note), grossPnlSol: evidence(gross === null ? null : gross - sizeSol, MODEL_SOURCE, range?.asOf ?? null, note),
      netValueSol: evidence<number>(null, 'LP entry and exit simulation', null, 'Complete costs are unavailable; gross value must not be read as net proceeds.'),
      pnlSol: evidence<number>(null, 'LP entry and exit simulation', null, 'Net P&L is unavailable while costs are missing.'),
      vsHoldingSol: evidence<number>(null, 'LP entry and exit simulation', null, 'Net performance versus holding SOL is unavailable while costs are missing.')};
  });
  const canOpen = marketCurrent && !!range && positive(mark);
  const missingEvidence = [!positive(mark) ? 'Current pool price' : null, !range ? 'Valid paper range' : null,
    hourly === null ? 'Complete one-hour fee observation' : null, bps === null ? 'Current token transfer-fee policy' : null,
    exitValue === null ? 'Size-matched token-to-SOL reference quote' : null, 'LP entry and exit network/account costs'].filter((item): item is string => !!item);
  let verdict: StillPreflight['verdict'] = {label: 'Marginal', reason: 'Complete costs are unavailable, so fees cannot yet be compared with the real cost of entering and leaving. You can still practise on paper.'};
  if (!canOpen) verdict = {label: 'Skip', reason: 'A current price and a valid range are needed before this paper position can be modelled.'};
  else if (policyCurrent && rpc?.freezeAuthority) verdict = {label: 'Skip', reason: 'The token has an active freeze authority. Practice is available, but this screen does not support a real deposit.'};
  else if (policyCurrent && rpc?.transferFee?.configAuthority) verdict = {label: 'Skip', reason: 'The token transfer-fee authority can change the tax after entry.'};
  else if (hourly === 0) verdict = {label: 'Skip', reason: 'The last complete hour reports no pool fees, so there is no observed fee pace to compare with costs.'};
  else if (hourly !== null && exitValue !== null && sizeSol * hourly * 24 <= exitValue) verdict = {label: 'Skip', reason: 'Even the quoted conversion cost exceeds a full day at the current pool fee pace, before other costs.'};
  return {pool: card, poolAddress: pool.address, name: pool.pair, sizeSol, fetchedAt: markAt, priceSol, range, feeRateHourly, expectedFeesPerDaySol,
    transferFeeBps, entryCostSol, exitCostSol, entryConversionSol, exitConversionSol, networkCostSol, roundTripCostSol, scenarios, verdict, canOpen, missingEvidence,
    model: {kind: 'paper-monotonic-bin-model', note: 'Paper practice only. Fixed-price bins model a monotonic move; real partial fills, liquidity share and transaction execution are not reproduced. Missing costs keep net results unavailable.'},
    ledger: {priceSol: mark, feeRateHourly: hourly, entryCostsSol: null, exitCostsSol: null, transferFeeBps: bps, bins: range?.bins ?? null}};
}

/** Fast path: pool snapshot and existing provider caches only. No user click waits
 * for a fanout of RPC/quote requests. An explicit detail refresh may enrich it. */
export async function getStillPreflight(env: Env, poolAddress: string, sizeSol = 0.5): Promise<StillPreflight | null> {
  const snapshot = await getSnapshot(env), pool = snapshot.pools.find(item => item.address === poolAddress || item.id === poolAddress);
  if (!pool || pool.venue !== 'meteora-dlmm' || !researchToken(pool)) return null;
  const mint = researchToken(pool)!.mint;
  const rpc = await cachedMintSafety(mint, env);
  const quotes = await cachedResearchQuotes(pool, env, rpc.decimals);
  return buildStillPreflight({pool, quotes, safety: {rpc}}, sizeSol);
}
export async function loadStillPreflight(pool: Pool, env: Env, sizeSol = 0.5, now = Date.now()): Promise<StillPreflight> {
  const detail: ResearchPoolDetail = await researchPool(pool, env);
  return buildStillPreflight(detail, sizeSol, Math.max(now, Date.now()));
}
export async function getStillBaskets(env: Env): Promise<StillBasket[]> {
  return buildStillBaskets(await getSnapshot(env));
}
export async function getStillPoolMark(env: Env, poolAddress: string) {
  const snapshot = await getSnapshot(env), pool = snapshot.pools.find(item => item.address === poolAddress || item.id === poolAddress);
  if (!pool || pool.venue !== 'meteora-dlmm' || !researchToken(pool)) return null;
  const now = Date.now(), current = recent(pool.fetchedAt, STILL_MAX_PRICE_AGE_MS, now), token = researchToken(pool), rates = researchFeeRates(pool);
  return {poolAddress: pool.address, name: pool.pair, priceSol: current && positive(token?.priceSol) ? token.priceSol : null,
    fetchedAt: pool.fetchedAt, source: MARKET_SOURCE, feeRateAsOf: pool.fetchedAt,
    feeRateHourly: current && nonnegative(pool.ageHours) && pool.ageHours >= 1 && nonnegative(rates.h1) ? rates.h1 : null};
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
  const coherent = basket.status === 'available' && basket.legs.length >= 2 && basket.legs.length <= 3 &&
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
      'Both component figures must be available. Each retains its own source and timestamp in the component pre-flight. This total is a paper model.');
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
    entryCostSol: sum(item => item.entryCostSol), exitCostSol: sum(item => item.exitCostSol), roundTripCostSol: sum(item => item.roundTripCostSol), verdict,
    missingEvidence: !complete ? ['A current, complete basket allocation'] : [...new Set(components.flatMap(item => item.preflight.missingEvidence))]};
}
export async function getStillBasketPreflight(env: Env, basketId: string, sizeSol = 0.5): Promise<StillBasketPreflight | null> {
  const basket = (await getStillBaskets(env)).find(item => item.id === basketId);
  if (!basket) return null;
  const preflights: StillPreflight[] = [];
  // Presets currently have two components. Hard cap protects against a bad cache or future unbounded definitions.
  if (basket.status === 'available' && basket.legs.length >= 2 && basket.legs.length <= 3) {
    for (const leg of basket.legs) {
      const preflight = await getStillPreflight(env, leg.poolAddress, sizeSol * leg.weightBps / 10_000);
      if (preflight) preflights.push(preflight);
    }
  }
  return combineStillBasketPreflight(basket, preflights, sizeSol);
}
