import type {Env} from './env';
import {allocations} from './cesto';
import {reserveResearchJupiter, noteResearchJupiterRateLimit} from './research-quote-budget';
import {solanaReadFetch} from './solana-read-rpc';
import {BASKET_SOL, MAX_BASKET_LEGS, basketMint, basketRaw, splitBasketLamports, type BasketSplit, basketUnitValue, basketPerformance} from './worldsfair-basket-math';

const FIVE_MINUTES = 300000, QUOTE_TTL = 45000, DEADLINE = 25000;
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const fresh = (at: number, ttl = FIVE_MINUTES) => Number.isFinite(at) && at <= Date.now() && Date.now() - at <= ttl;
export class PaperBasketError extends Error {
  constructor(message: string, readonly status = 503, readonly code = 'basket_provider_unavailable') {super(message);}
}
export interface PaperBasketLeg {mint: string; symbol: string; weight: number; inputLamports: number; unitsRaw: string; decimals: number; priceImpactFraction: number; quoteAsOf: string; contextSlot: number | null}
export interface PaperBasketPurchase {
  paper: true; kind: 'basket'; slug: string; name: string; amountLamports: number; costSol: number;
  allocationReadAt: string; preparedAt: string; quoteAsOf: string; expiresAt: number;
  entrySolUsd: number | null; entryPriceAsOf: string | null; legs: PaperBasketLeg[]; note: string;
}
export interface PaperBasketHolding extends PaperBasketPurchase {id: string; openedAt: string}
export interface PaperBasketLegMark {mint: string; status: 'available' | 'unavailable'; usdPrice: number | null; priceSol: number | null; valueUsd: number | null; valueSol: number | null; asOf: string | null; blockId: number | null; note: string}
export interface PaperBasketValuation {
  holdingId: string; status: 'complete' | 'partial' | 'unavailable'; asOf: string | null; readAt: string;
  solUsd: number | null; valueSol: number | null; valueUsd: number | null; costSol: number;
  holdSolValueUsd: number | null; pnlSol: number | null; vsHoldSolUsd: number | null; absolutePnlUsd: number | null;
  legs: PaperBasketLegMark[]; note: string;
}
export interface PaperBasketMarks {marks: PaperBasketValuation[]; asOf: string; quotesConfigured: boolean; note: string}
export interface PaperTokenPrice {usdPrice: number; decimals: number; blockId: number; asOf: string}
function remaining(deadline: number) {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new PaperBasketError('Paper basket sources took too long. No purchase was saved.', 503, 'basket_provider_timeout');
  return Math.max(1, Math.min(8000, ms));
}
async function requestJson(url: string, init: RequestInit, deadline: number, rpc = false): Promise<any> {
  try {
    const request = {...init, signal: AbortSignal.timeout(remaining(deadline))};
    const response = rpc ? await solanaReadFetch(url, request, {deadline}) : await fetch(url, request);
    if (!response.ok) {await response.body?.cancel(); throw new PaperBasketError('A basket data source is unavailable. Please retry.', 503, 'basket_provider_unavailable');}
    const result = await response.json(); remaining(deadline); return result;
  } catch (error) {
    if (error instanceof PaperBasketError) throw error;
    throw new PaperBasketError('A basket data source timed out or returned unreadable data.', 503, 'basket_provider_timeout');
  }
}
async function jupiter(env: Env, path: string, query: URLSearchParams, deadline: number): Promise<any> {
  remaining(deadline);
  if (!['swap/v1/quote','price/v3'].includes(path)) throw new PaperBasketError('Only quote and price reads are supported.',400,'basket_quote_invalid');
  const cacheTtl=path==='price/v3'?30000:15000;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path+'?'+query));
  const cacheKey='paper-jupiter:v1:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  try {const cached=await env.LP_CACHE.get<{readAt:number;body:unknown}>(cacheKey,'json');if(cached&&fresh(cached.readAt,cacheTtl)){remaining(deadline);return cached.body;}} catch {}
  const reservation = await reserveResearchJupiter(env); remaining(deadline);
  if (!reservation.allowed) throw new PaperBasketError('The shared quote allowance is busy. Wait briefly and retry; no Paper SOL was moved.', 429, 'basket_quote_budget');
  try {
    // Deliberately only quote/price GETs. Never build, sign or send a transaction.
    const response = await fetch('https://api.jup.ag/' + path + '?' + query, {method: 'GET', headers: {accept: 'application/json', ...(env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{})}, signal: AbortSignal.timeout(remaining(deadline))});
    if (response.status === 429) {await noteResearchJupiterRateLimit(env, response.headers); await response.body?.cancel(); throw new PaperBasketError('Jupiter is rate limited. No Paper SOL was moved.', 429, 'basket_quote_rate_limited');}
    if (!response.ok) {await response.body?.cancel(); throw new PaperBasketError('Jupiter could not price every basket token. No purchase was saved.', 503, 'basket_quote_unavailable');}
    const result = await response.json(); remaining(deadline);
    // Cache only public source reads; mint, amount, and original block-time
    // validation still runs on every use. A cache hit never renews quote age.
    try {await env.LP_CACHE.put(cacheKey,JSON.stringify({readAt:Date.now(),body:result}),{expirationTtl:60});} catch {}
    remaining(deadline);return result;
  } catch (error) {
    if (error instanceof PaperBasketError) throw error;
    throw new PaperBasketError('The basket quote timed out or was unreadable. No purchase was saved.', 503, 'basket_provider_timeout');
  }
}
async function cestoSource(env: Env, path: string, deadline: number): Promise<{data: any; readAt: number}> {
  let saved: {data: any; readAt: number} | null = null;
  try {saved = await env.LP_CACHE.get('cesto:v1:' + path, 'json');} catch {}
  if (saved && fresh(saved.readAt)) return saved;
  const data = await requestJson('https://backend.cesto.co' + path, {method: 'GET', headers: {accept: 'application/json'}}, deadline);
  if (!data || data.code && data.message) throw new PaperBasketError('Cesto could not verify this basket.', 503, 'basket_allocation_unavailable');
  return {data, readAt: Date.now()};
}
async function basketAllocation(env: Env, slug: string, deadline: number) {
  const source = await cestoSource(env, '/products/' + slug, deadline), body = source.data;
  if (body.slug !== slug || typeof body.id !== 'string' || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) throw new PaperBasketError('Cesto returned a different or incomplete basket.', 503, 'basket_identity_mismatch');
  if (body.geoStatus?.canView === false || body.isActive === false || body.isPublished === false) throw new PaperBasketError('This basket is not currently available for a Paper purchase.', 400, 'basket_unavailable');
  let listingAt = source.readAt;
  if (body.isActive !== true || body.isPublished !== true) {
    const catalogue = await cestoSource(env, '/products', deadline), match = Array.isArray(catalogue.data) ? catalogue.data.find((row: any) => row.id === body.id && row.slug === slug) : null;
    if (!match || match.isActive !== true || match.isPublished !== true || match.geoStatus?.canView === false) throw new PaperBasketError('Cesto has not confirmed that this basket is active and published.', 400, 'basket_unavailable');
    listingAt = catalogue.readAt;
  }
  let tokens: any[] = [];
  try {const saved = await env.LP_CACHE.get<{data: any; readAt: number}>('cesto:v1:/tokens', 'json'); if (saved && fresh(saved.readAt) && Array.isArray(saved.data)) tokens = saved.data;} catch {}
  const allocation = allocations(body, tokens);
  if (!allocation.complete) throw new PaperBasketError('The complete basket allocation is unavailable. Complex strategy legs cannot be paper-bought.', 400, 'basket_allocation_incomplete');
  return {name: body.name.trim(), readAt: new Date(Math.min(source.readAt, listingAt)).toISOString(), rows: allocation.rows};
}
async function mintDecimals(env: Env, mints: string[], deadline: number) {
  const out = new Map<string, number>([[BASKET_SOL, 9]]), wanted = mints.filter(mint => mint !== BASKET_SOL);
  if (!wanted.length) return out;
  if (!env.SOLANA_RPC) throw new PaperBasketError('A read-only Solana RPC is needed to verify basket token units.', 503, 'basket_mint_unavailable');
  const body = await requestJson(env.SOLANA_RPC, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [wanted, {encoding: 'jsonParsed', commitment: 'confirmed'}]})}, deadline, true);
  const values = body?.result?.value;
  if (body?.error || !Array.isArray(values) || values.length !== wanted.length) throw new PaperBasketError('Basket mint records could not be verified.', 503, 'basket_mint_unavailable');
  values.forEach((account: any, i: number) => {
    const parsed = account?.data?.parsed, info = parsed?.type === 'mint' ? parsed.info : null;
    if (!TOKEN_PROGRAMS.has(account?.owner) || account.executable !== false || info?.isInitialized !== true || !Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 18) throw new PaperBasketError('A basket token has unverified mint decimals or token program.', 503, 'basket_mint_unavailable');
    out.set(wanted[i], info.decimals);
  });
  return out;
}
async function mapBounded<T, R>(rows: readonly T[], concurrency: number, action: (row: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(rows.length); let index = 0, failed: unknown;
  await Promise.all(Array.from({length: Math.min(concurrency, rows.length)}, async () => {
    while (!failed) {const i = index++; if (i >= rows.length) break; try {results[i] = await action(rows[i]);} catch (error) {failed = error;}}
  }));
  if (failed) throw failed;
  return results;
}
/** Price v3 createdAt is token metadata, not quote time. Verify block timestamps. */
export async function readPaperTokenPrices(env: Env, mints: string[], deadline: number): Promise<Map<string, PaperTokenPrice>> {
  if (!env.SOLANA_RPC) throw new PaperBasketError('Price timestamps need the read-only Solana RPC.', 503, 'basket_price_unavailable');
  const rpcUrl = env.SOLANA_RPC;
  const ids = [...new Set([BASKET_SOL, ...mints])];
  if (ids.length > 40 * MAX_BASKET_LEGS + 1) throw new PaperBasketError('This Paper portfolio exceeds the bounded refresh size.', 400, 'basket_price_limit');
  const chunks: string[][] = []; for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const responses = await mapBounded(chunks, 3, async batch => {try {return {ids: batch, body: await jupiter(env, 'price/v3', new URLSearchParams({ids: batch.join(',')}), deadline)};} catch {return {ids: batch, body: null};}});
  const candidates = responses.flatMap(({ids: batch, body}) => batch.flatMap(mint => {const row = body?.[mint]; return positive(row?.usdPrice) && Number.isInteger(row?.decimals) && row.decimals >= 0 && row.decimals <= 18 && Number.isSafeInteger(row?.blockId) && row.blockId > 0 ? [{mint, row}] : [];}));
  const slots = [...new Set(candidates.map(({row}) => row.blockId as number))], out = new Map<string, PaperTokenPrice>();
  if (!slots.length) return out;
  const requests = slots.map((slot, i) => ({jsonrpc: '2.0', id: i + 1, method: 'getBlockTime', params: [slot]})), batches: (typeof requests)[] = [];
  for (let i = 0; i < requests.length; i += 50) batches.push(requests.slice(i, i + 50));
  const timeResponses = await mapBounded(batches, 3, async batch => {try {const body = await requestJson(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(batch)}, deadline, true); return Array.isArray(body) ? body : [];} catch {return [];}});
  const times = timeResponses.flat();
  for (const {mint, row} of candidates) {
    const matching = times.filter(value => value?.id === slots.indexOf(row.blockId) + 1), time = matching.length === 1 && !matching[0].error ? matching[0].result : null;
    if (!Number.isInteger(time) || time <= 0 || !fresh(time * 1000)) continue;
    if (mint === BASKET_SOL && row.decimals !== 9) continue;
    out.set(mint, {usdPrice: row.usdPrice, decimals: row.decimals, blockId: row.blockId, asOf: new Date(time * 1000).toISOString()});
  }
  return out;
}

/** Read-only, bounded token quotes shared by paper baskets and vault estimates. */
export async function preparePaperTokenQuotes(env: Env, inputLegs: readonly BasketSplit[], deadline: number): Promise<PaperBasketLeg[]> {
  if (!inputLegs.length || inputLegs.length > MAX_BASKET_LEGS || inputLegs.some(leg => !basketMint(leg.mint) || !Number.isSafeInteger(leg.inputLamports) || leg.inputLamports <= 0 || leg.inputLamports > 1000 * 1e9)) throw new PaperBasketError('Invalid bounded Paper token quote request.', 400, 'basket_invalid');
  const decimals = await mintDecimals(env, inputLegs.map(leg => leg.mint), deadline);
  const legs = await mapBounded(inputLegs, 3, async leg => {
    if (leg.mint === BASKET_SOL) return {...leg, unitsRaw: String(leg.inputLamports), decimals: 9, priceImpactFraction: 0, quoteAsOf: new Date(Date.now()).toISOString(), contextSlot: null};
    const quote = await jupiter(env, 'swap/v1/quote', new URLSearchParams({inputMint: BASKET_SOL, outputMint: leg.mint, amount: String(leg.inputLamports), swapMode: 'ExactIn', slippageBps: '50', restrictIntermediateTokens: 'true', instructionVersion: 'V2'}), deadline);
    const impact = typeof quote?.priceImpactPct === 'string' && /^(?:0|1)(?:\.\d{1,50})?$/.test(quote.priceImpactPct) ? Number(quote.priceImpactPct) : NaN;
    if (quote?.inputMint !== BASKET_SOL || quote.outputMint !== leg.mint || quote.inAmount !== String(leg.inputLamports) || !basketRaw(quote.outAmount) || BigInt(quote.outAmount) <= 0n || quote.swapMode !== 'ExactIn' || quote.slippageBps !== 50 || !basketRaw(quote.otherAmountThreshold) || BigInt(quote.otherAmountThreshold) > BigInt(quote.outAmount) || !Number.isFinite(impact) || impact < 0 || impact > 1 || !Array.isArray(quote.routePlan) || !quote.routePlan.length || !Number.isSafeInteger(quote.contextSlot) || quote.contextSlot <= 0) throw new PaperBasketError('A basket quote failed its token, amount or price-impact checks. No purchase was saved.', 503, 'basket_quote_invalid');
    return {...leg, unitsRaw: quote.outAmount as string, decimals: decimals.get(leg.mint)!, priceImpactFraction: impact, quoteAsOf: new Date(Date.now()).toISOString(), contextSlot: quote.contextSlot as number};
  });
  const quoteSlots = [...new Set(legs.flatMap(leg => leg.contextSlot === null ? [] : [leg.contextSlot]))];
  if (quoteSlots.length) {
    if (!env.SOLANA_RPC) throw new PaperBasketError('Quote timestamps need the read-only Solana RPC.', 503, 'basket_quote_unavailable');
    const times = await requestJson(env.SOLANA_RPC, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(quoteSlots.map((slot, i) => ({jsonrpc: '2.0', id: i + 1, method: 'getBlockTime', params: [slot]})))}, deadline, true);
    for (const leg of legs) {
      if (leg.contextSlot === null) continue;
      const matching = Array.isArray(times) ? times.filter(value => value?.id === quoteSlots.indexOf(leg.contextSlot!) + 1) : [], timestamp = matching.length === 1 && !matching[0].error ? matching[0].result : null;
      if (!Number.isInteger(timestamp) || timestamp <= 0 || !fresh(timestamp * 1000, QUOTE_TTL)) throw new PaperBasketError('A basket quote refers to an old or unverified Solana block. Retry; no purchase was saved.', 503, 'basket_quote_expired');
      leg.quoteAsOf = new Date(Math.min(Date.parse(leg.quoteAsOf), timestamp * 1000)).toISOString();
    }
  }
  remaining(deadline);
  return legs;
}

export async function preparePaperBasketPurchase(env: Env, input: {slug: string; amountSol: string | number}): Promise<PaperBasketPurchase> {
  if (typeof input.slug !== 'string' || !/^[a-z0-9-]{1,90}$/.test(input.slug)) throw new PaperBasketError('Choose a valid Cesto basket.', 400, 'basket_invalid');
  const deadline = Date.now() + DEADLINE, allocation = await basketAllocation(env, input.slug, deadline);
  let split: ReturnType<typeof splitBasketLamports>;
  try {split = splitBasketLamports(input.amountSol, allocation.rows);} catch (error) {throw new PaperBasketError(error instanceof Error ? error.message : 'Invalid Paper basket amount.', 400, 'basket_invalid');}
  const legs = await preparePaperTokenQuotes(env, split.legs, deadline);
  // Mandatory allocation, mint, quote and block evidence must fit this bound.
  remaining(deadline);
  // Dollar cost is optional evidence. It must never invent a 1 USD stablecoin
  // value or prevent a valid quote-only SOL purchase when the mark is absent.
  let entryPrice: PaperTokenPrice | undefined;
  try {entryPrice = (await readPaperTokenPrices(env, [BASKET_SOL], deadline)).get(BASKET_SOL);} catch {}
  const preparedAt = new Date(Date.now()).toISOString(), oldest = Math.min(...legs.map(leg => Date.parse(leg.quoteAsOf)));
  if (!fresh(oldest, QUOTE_TTL) || !fresh(Date.parse(allocation.readAt))) throw new PaperBasketError('Basket evidence expired while reading sources. Retry; no purchase was saved.', 503, 'basket_quote_expired');
  return {paper: true, kind: 'basket', slug: input.slug, name: allocation.name, amountLamports: split.amountLamports, costSol: split.costSol, allocationReadAt: allocation.readAt, preparedAt, quoteAsOf: new Date(oldest).toISOString(), expiresAt: oldest + QUOTE_TTL, entrySolUsd: entryPrice?.usdPrice ?? null, entryPriceAsOf: entryPrice?.asOf ?? null, legs, note: 'Paper token units at dated Jupiter output quotes; no basket wrapper or transaction is purchased. Quotes include reported AMM/platform fees; network costs, later slippage, rebalancing and wrapper fees are excluded. SOL weights stay as Paper SOL. Allocation weights are proportionally normalised with exact lamport conservation.'};
}

export async function markPaperBaskets(env: Env, holdings: readonly PaperBasketHolding[]): Promise<PaperBasketMarks> {
  const readAt = new Date(Date.now()).toISOString(), deadline = Date.now() + DEADLINE;
  let marks = new Map<string, PaperTokenPrice>(), note = 'Dated Jupiter market marks; these are estimated holdings values, not exit quotes.';
  try {
    const mints = [...new Set(holdings.flatMap(holding => holding.legs.map(leg => leg.mint)))].filter(mint => mint !== BASKET_SOL);
    if (holdings.length > 40 || mints.length > 40 * MAX_BASKET_LEGS) throw new PaperBasketError('This Paper portfolio exceeds the bounded refresh size.', 400, 'basket_price_limit');
    if (holdings.length) marks = await readPaperTokenPrices(env, mints, deadline);
  } catch (error) {note = error instanceof Error ? error.message : 'Current basket prices could not be read.';}
  const sol = marks.get(BASKET_SOL), results: PaperBasketValuation[] = holdings.map(holding => {
    const legs: PaperBasketLegMark[] = holding.legs.map(leg => {
      const mark = marks.get(leg.mint), usable = !!mark && mark.decimals === leg.decimals && fresh(Date.parse(mark.asOf));
      const valueUsd = usable ? basketUnitValue(leg.unitsRaw, leg.decimals, mark.usdPrice) : null;
      const solUsable = !!sol && fresh(Date.parse(sol.asOf)), valueSol = valueUsd !== null && solUsable ? valueUsd / sol.usdPrice : null;
      return {mint: leg.mint, status: valueUsd === null ? 'unavailable' : 'available', usdPrice: valueUsd === null ? null : mark!.usdPrice, priceSol: valueUsd !== null && solUsable ? mark!.usdPrice / sol.usdPrice : null, valueUsd, valueSol, asOf: valueUsd === null ? null : mark!.asOf, blockId: mark?.blockId ?? null, note: valueUsd === null ? 'A matching recent token price and block timestamp are unavailable.' : 'Jupiter market mark verified against its Solana block timestamp.'};
    });
    const solUsable = !!sol && fresh(Date.parse(sol.asOf)), complete = legs.length > 0 && legs.length <= MAX_BASKET_LEGS && solUsable && legs.every(leg => leg.status === 'available' && leg.valueSol !== null && Number.isFinite(leg.valueSol));
    const totalUsd = complete ? legs.reduce((sum, leg) => sum + leg.valueUsd!, 0) : null;
    const performance = basketPerformance(holding.amountLamports, totalUsd, solUsable ? sol!.usdPrice : null, holding.entrySolUsd);
    const status = complete && performance.valueSol !== null ? 'complete' : legs.some(leg => leg.status === 'available') ? 'partial' : 'unavailable';
    const dates = [...legs.flatMap(leg => leg.asOf ? [Date.parse(leg.asOf)] : []), ...(solUsable ? [Date.parse(sol!.asOf)] : [])];
    return {holdingId: holding.id, status, asOf: dates.length ? new Date(Math.min(...dates)).toISOString() : null, readAt, solUsd: solUsable ? sol!.usdPrice : null, ...performance, legs, note: status === 'complete' ? 'SOL P&L and the USD difference versus holding SOL use the same current SOL price. Absolute USD P&L uses the dated entry SOL price when available. Market marks exclude exit costs.' : 'Some current prices or timestamps are unavailable. Total value and P&L remain unavailable; missing holdings are not valued at zero. ' + note};
  });
  return {marks: results, asOf: new Date(Date.now()).toISOString(), quotesConfigured: !!env.RANGE_ALERTS, note};
}
