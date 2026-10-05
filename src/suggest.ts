import { Pool } from "./schema";
import type {Env} from './env';
import { getTokenCandleSeries } from "./sources/geckoterminal";

// A rear-view-mirror range test. Pulls the last N days of hourly candles for a pool, then
// for a few symmetric ranges around today's price asks: how often would I have been in range,
// what would IL have cost me versus holding, and what might fees have paid at this pool's
// current fee run-rate? It is an estimate built on the recent past, and says so.

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Series { chartUnit?: string; candles: Candle[]; timeframe: string; hours: number;source?:string;asOf?:string|null;dataAsOf?:string|null;cached?:boolean;status?:string;note?:string }
const MIN_CANDLES = 8;

export async function candlesFor(pool: Pool, days = 7,env?:Env): Promise<Series> {
  return getTokenCandleSeries(pool,days*24,env?{key:env.GECKO_KEY,cache:env.LP_CACHE,namespace:env.RANGE_ALERTS}:undefined);
}

export interface RangeResult {
  rangePct: number;         // ±this fraction around entry
  lower: number; upper: number;
  inRangePct: number;       // fraction of candles where price stayed inside
  ilPct: number;            // value vs holding the same tokens, at the window's end (negative = lost)
  concentration: number;    // fee-liquidity vs a typical ±20% LP with the same capital (other LPs concentrate too)
  estFees7dUsd: number | null;
  netEst7dUsd: number | null;   // estFees + il in USD
}

export interface ShapeResult { shape: "Spot" | "Curve" | "Bid-Ask"; feeScore: number; note: string }
export interface Strategy {
  shape: "Spot" | "Curve" | "Bid-Ask";
  side: "balanced" | "quote-only below" | "token-only above";
  rangePct: number;
  verdict: "go" | "small" | "skip";
  reasons: string[];
  howTo: string;
}

export interface Suggestion {
  dataAsOf?:string|null;sourceAsOf?:string|null;source?:string;cached?:boolean;dataStatus?:string;
  pool: { id: string; pair: string; chain: string; venue: string; url: string };
  series?: Candle[];         // thinned, for the drawer chart
  driftPct?: number;         // ln(end/start) over the window
  strategy?: Strategy;
  shapes?: ShapeResult[];
  amountUsd: number;
  windowDays: number;
  candles: number;
  timeframe: string;
  entryPrice: number;
  dailyVolPct: number;      // realised, from hourly log returns
  currentFeeRunRate: { fees24hUsd: number | null; feeApr: number | null; shareOfPool: number | null };
  ranges: RangeResult[];
  pick: RangeResult | null;
  flags: string[];
  caveat: string;
}

// Value of a concentrated position at price p1, given capital C deployed at p0 into [pa, pb].
function lpValue(C: number, p0: number, pa: number, pb: number, p1: number): number {
  const s0 = Math.sqrt(p0), sa = Math.sqrt(pa), sb = Math.sqrt(pb);
  const L = C / ((p0 / s0 - p0 / sb) + (s0 - sa));
  const p = Math.min(Math.max(p1, pa), pb);
  const sp = Math.sqrt(p);
  const x = L * (1 / sp - 1 / sb), y = L * (sp - sa);
  return x * p1 + y;
}
function holdValue(C: number, p0: number, pa: number, pb: number, p1: number): number {
  const s0 = Math.sqrt(p0), sa = Math.sqrt(pa), sb = Math.sqrt(pb);
  const L = C / ((p0 / s0 - p0 / sb) + (s0 - sa));
  const x0 = L * (1 / s0 - 1 / sb), y0 = L * (s0 - sa);
  return x0 * p1 + y0;
}

export function suggest(pool: Pool, series: Series, amountUsd: number, windowDays: number): Suggestion {
  const { candles, timeframe, hours } = series;
  const closes = candles.map((c) => c.c);
  // Window the estimate actually covers, from the candles we got rather than what was asked for.
  const coveredDays = candles.length >= 2 ? Math.max(1, Math.round((candles[candles.length - 1].t - candles[0].t) / 86400)) : windowDays;
  windowDays = coveredDays;
  const flags: string[] = [];
  if(series.status==='stale')flags.push('saved price history — provider refresh failed; original candle dates retained');
  if (pool.ageHours != null && pool.ageHours < 72) flags.push("under 72h old — thin history, launch volatility");
  if (pool.tvlUsd != null && pool.tvlUsd < 50_000) flags.push("TVL under $50k — your position moves the price");
  if (pool.tags.some((t) => t.startsWith("launchpad"))) flags.push("launchpad token — check LP lock and top holders");
  if (pool.chain === "solana" && !pool.tags.includes("verified")) flags.push("token not verified on Meteora");
  if (pool.tags.includes("stock-token")) flags.push("stock token — gaps at US market open; range for the gap, not the drift");
  if (pool.feeTvl?.h1 != null && pool.feeTvl?.h24 != null && pool.feeTvl.h24 > 0 && pool.feeTvl.h1 * 24 > pool.feeTvl.h24 * 3)
    flags.push("fees spiking in the last hour vs the day — momentum, may not last");

  if (pool.ageHours != null && pool.ageHours < 6) flags.push("pool is under 6 hours old — nothing to test yet, this is a launch, not a range");
  if (closes.length < MIN_CANDLES) {
    return {
      pool: { id: pool.id, pair: pool.pair, chain: pool.chain, venue: pool.venue, url: pool.url },
      dataAsOf:series.dataAsOf,sourceAsOf:series.asOf,source:series.source,cached:series.cached,dataStatus:series.status,
      amountUsd, windowDays, candles: closes.length, timeframe, entryPrice: pool.priceUsd ?? 0, dailyVolPct: 0,
      currentFeeRunRate: { fees24hUsd: pool.fees24hUsd, feeApr: pool.feeApr, shareOfPool: null },
      ranges: [], pick: null, flags: [...flags, "not enough price history to test ranges"],
      caveat: `Only ${closes.length} usable ${timeframe} candles came back from the indexer for this pool.`,
    };
  }

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const dailyVol = sd * Math.sqrt(24 / hours);

  const p0 = closes[0];
  const pEnd = closes[closes.length - 1];
  const share = pool.tvlUsd ? amountUsd / (pool.tvlUsd + amountUsd) : null;
  const dailyFees = pool.fees24hUsd;

  const ranges = [0.05, 0.1, 0.2, 0.35].map((r): RangeResult => {
    const pa = p0 * (1 - r), pb = p0 * (1 + r);
    const inside = candles.filter((c) => c.l >= pa && c.h <= pb).length;
    const inRangePct = inside / candles.length;
    const il = lpValue(amountUsd, p0, pa, pb, pEnd) / holdValue(amountUsd, p0, pa, pb, pEnd) - 1;
    // Same capital, narrower range → more liquidity in the active bin → bigger share of each swap's fee.
    // Measured against a typical ±20% LP rather than a full-range one, because on DLMM and V3 the
    // rest of the pool is concentrated too; the full-range comparison flatters narrow ranges badly.
    const concAbs = (x: number) => 1 / (1 - Math.sqrt(1 / (1 + x)));
    const concentration = concAbs(r) / concAbs(0.2);
    const estFees = dailyFees != null && share != null
      ? dailyFees * windowDays * share * concentration * inRangePct
      : null;
    return {
      rangePct: r, lower: pa, upper: pb, inRangePct, ilPct: il, concentration,
      estFees7dUsd: estFees,
      netEst7dUsd: estFees != null ? estFees + il * amountUsd : null,
    };
  });

  const scored = ranges.filter((x) => x.netEst7dUsd != null);
  const pick = scored.length ? scored.reduce((a, b) => (b.netEst7dUsd! > a.netEst7dUsd! ? b : a)) : null;

  // ── Shape backtest: same capital, same range, different liquidity distribution. Fee capture is
  // proportional to how much of your liquidity sat in the bin price was in, summed over the window.
  const rr = pick?.rangePct ?? 0.2;
  const lo = p0 * (1 - rr), hi = p0 * (1 + rr), nb = 21;
  const weights = (shape: ShapeResult["shape"]) => {
    const w: number[] = [];
    for (let i = 0; i < nb; i++) {
      const x = (i - (nb - 1) / 2) / ((nb - 1) / 2);          // -1 … 1, 0 = entry price
      w.push(shape === "Spot" ? 1 : shape === "Curve" ? Math.exp(-4 * x * x) : 0.15 + Math.abs(x));
    }
    const sum = w.reduce((a, b) => a + b, 0); return w.map((v) => v / sum);
  };
  const binOf = (price: number) => (price < lo || price > hi) ? -1 : Math.min(nb - 1, Math.floor(((price - lo) / (hi - lo)) * nb));
  const spotW = weights("Spot"), spotScore = candles.reduce((a, c) => { const b = binOf(c.c); return a + (b < 0 ? 0 : spotW[b]); }, 0) || 1e-9;
  const shapes: ShapeResult[] = (["Spot", "Curve", "Bid-Ask"] as const).map((shape) => {
    const w = weights(shape);
    const score = candles.reduce((a, c) => { const b = binOf(c.c); return a + (b < 0 ? 0 : w[b]); }, 0) / spotScore;
    const note = shape === "Spot" ? "Even across the range. Steady, forgiving."
      : shape === "Curve" ? "Concentrated near the centre. Less liquidity participates as price moves away."
      : "Weighted toward the edges. Can ladder buying/selling when swaps reach those bins; no guaranteed fee advantage.";
    return { shape, feeScore: score, note };
  });

  // ── Strategy: shape from volatility and behaviour, side from trend, verdict from age and fee decay.
  const drift = Math.log(pEnd / p0);
  const vol = dailyVol, days = windowDays;
  const trending = Math.abs(drift) > vol * Math.sqrt(Math.max(1, days)) * 0.8;
  const cooling = pool.feeTvl?.h1 != null && pool.feeTvl?.h24 != null && pool.feeTvl.h24 > 0 && pool.feeTvl.h1 * 24 < pool.feeTvl.h24 * 0.3;
  const young = pool.ageHours != null && pool.ageHours < 72;
  const reasons: string[] = [];
  let shape: Strategy["shape"];
  if (vol < 0.05) { shape = "Curve"; reasons.push(`realised vol ${(vol * 100).toFixed(1)}%/day is low — a centre-weighted scenario is worth comparing, provided trading continues there`); }
  else if (vol < 0.25 && !trending) { shape = "Spot"; reasons.push(`vol ${(vol * 100).toFixed(0)}%/day and no strong trend — ranging market, even liquidity holds up`); }
  else { shape = "Bid-Ask"; reasons.push(`vol ${(vol * 100).toFixed(0)}%/day${trending ? " with a trend" : ""} — compare an edge-weighted scenario only if gradual buying/selling fits your intent`); }
  let side: Strategy["side"] = "balanced";
  if (drift < -0.15 && shape === "Bid-Ask") { side = "quote-only below"; reasons.push(`down ${(Math.abs(drift) * 100).toFixed(0)}% over the window — a below-price scenario accumulates the base token if trades reach it; it can leave you holding a falling token`); }
  else if (drift > 0.15 && shape === "Bid-Ask") { side = "token-only above"; reasons.push(`up ${(drift * 100).toFixed(0)}% over the window — selling into strength above price takes profit as it rises`); }
  let verdict: Strategy["verdict"] = "go";
  if (young && cooling) { verdict = "skip"; reasons.push("under 72h old and fees in the last hour are a fraction of the day's — this is a launch cooling off, the pattern that bit on SOLCAT and CTO"); }
  else if (young) { verdict = "small"; reasons.push("under 72h old — size small, expect to babysit it"); }
  else if (pick && pick.inRangePct < 0.5) { verdict = "small"; reasons.push(`even the best range was only in range ${Math.round(pick.inRangePct * 100)}% of the window`); }
  const bestShape = shapes.reduce((a, b) => (b.feeScore > a.feeScore ? b : a));
  if (bestShape.shape !== shape && bestShape.feeScore > 1.15) reasons.push(`note: ${bestShape.shape} has ${((bestShape.feeScore - 1) * 100).toFixed(0)}% greater sampled price overlap than Spot; this does not measure fee returns`);
  const isSol = pool.chain === "solana";
  const howTo = isSol
    ? `On Meteora: ${shape} strategy, ${side === "balanced" ? "both tokens" : side === "quote-only below" ? `${pool.quote.symbol} only, range set below current price` : "token only, range set above current price"}, ±${Math.round((pick?.rangePct ?? rr) * 100)}%.`
    : `On Robinhood: the terminal opens Spot today. ${shape === "Spot" ? "Use Open position." : shape + " here means stacking two or three narrower positions at different distances — coming to the executor next; check venue support before attempting that setup."}`;
  const strategy: Strategy = { shape, side, rangePct: pick?.rangePct ?? rr, verdict, reasons, howTo };

  // Thin candles for the drawer chart (max ~120 points).
  const step = Math.max(1, Math.ceil(candles.length / 120));
  const thin = candles.filter((_, i) => i % step === 0 || i === candles.length - 1);

  return {
    pool: { id: pool.id, pair: pool.pair, chain: pool.chain, venue: pool.venue, url: pool.url },
    dataAsOf:series.dataAsOf,sourceAsOf:series.asOf,source:series.source,cached:series.cached,dataStatus:series.status,
    amountUsd, windowDays, candles: closes.length, timeframe, entryPrice: p0, dailyVolPct: dailyVol,
    currentFeeRunRate: { fees24hUsd: dailyFees, feeApr: pool.feeApr, shareOfPool: share },
    ranges, pick, flags,
    series: thin, driftPct: drift, strategy, shapes,
    caveat:
      "Backward-looking. In-range % and IL use the actual last-" + windowDays + "-day price path; fee estimates use today's fee run-rate, " +
      "your share of TVL, and your concentration relative to a typical ±20% LP, and assume recent volume repeats. Treat as a comparison between ranges, not a forecast.",
  };
}
