import { readFetch as fetch } from "./read-fetch";
import { Position, num } from "../schema";
import { money, meteoraPnl, combinePnl, matchingOpenPositions } from "../pnl";

// Meteora DLMM open portfolio: one row per pool the wallet has open positions in, with current
// balances, unclaimed fees and PnL computed by their indexer, plus an in/out-of-range flag.
// Docs: GET https://dlmm.datapi.meteora.ag/portfolio/open?user=
const BASE = "https://dlmm.datapi.meteora.ag";

interface Row {
  poolAddress: string;
  tokenX: string; tokenY: string; tokenXMint: string; tokenYMint: string;
  baseFee: number; binStep: number;
  totalDeposit: string;     // USD, all-time deposits into this pool
  balances: string;         // USD, current value of open positions
  unclaimedFees: string;    // USD
  pnl: string; pnlPctChange: string;
  openPositionCount: number;
  listPositions: string[];
  positionsOutOfRange: string[];
  outOfRange: boolean;
  poolPrice: number;
  feePerTvl24h?: string;
}
interface Resp { pools: Row[]; totalPositions: number; hasNext: boolean; solPrice?: string;
  total?: { balances: string; pnl: string; unclaimedFees: string } }

export interface WalletRef { name: string; address: string }

// Per-position detail: bin bounds → price bounds. Field names on this endpoint vary, so we look for
// the usual suspects and give up quietly if none are present.
export async function meteoraPositionBounds(poolAddress: string, user: string, binStep: number, decX: number, decY: number)
  : Promise<{ lower: number; upper: number; openedAt: string | null; entries?: any[] } | null> {
  try {
    const qs = new URLSearchParams({ user, status: "open", page: "1", page_size: "20" });
    const r = await fetch(`${BASE}/positions/${poolAddress}/pnl?${qs}`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { positions?: any[]; hasNext?: boolean };
    const entries = j.hasNext === false ? j.positions : undefined;
    const ids: number[] = []; let opened: number | null = null;
    for (const p of j.positions ?? []) {
      const lo = p.lowerBinId ?? p.lower_bin_id ?? p.minBinId ?? p.min_bin_id ?? p.binRange?.lower;
      const hi = p.upperBinId ?? p.upper_bin_id ?? p.maxBinId ?? p.max_bin_id ?? p.binRange?.upper;
      if (lo != null && hi != null) ids.push(Number(lo), Number(hi));
      const c = p.createdAt ?? p.created_at ?? p.openedAt;
      if (c != null) { const n = Number(c); const ms = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(String(c)); if (Number.isFinite(ms)) opened = opened == null ? ms : Math.min(opened, ms); }
    }
    const openedAt = opened != null ? new Date(opened).toISOString() : null;
    const reported = entries?.map(p=>({lower:money(p.minPrice),upper:money(p.maxPrice)}));
    if(reported?.length && reported.every(p=>p.lower!=null&&p.upper!=null&&p.lower>0&&p.upper>p.lower))
      return {lower:Math.min(...reported.map(p=>p.lower!)),upper:Math.max(...reported.map(p=>p.upper!)),openedAt,entries};
    if (!ids.length) return { lower: NaN, upper: NaN, openedAt, entries };
    // DLMM bin price (Y per X) = (1 + binStep/10000)^binId, adjusted for decimals.
    const price = (bin: number) => Math.pow(1 + binStep / 10000, bin) * 10 ** (decX - decY);
    return { lower: price(Math.min(...ids)), upper: price(Math.max(...ids) + 1), openedAt, entries };
  } catch { return null; }
}

export async function fetchMeteoraPositions(w: WalletRef): Promise<Position[]> {
  const qs = new URLSearchParams({ user: w.address, page: "1", page_size: "50" });
  const res = await fetch(`${BASE}/portfolio/open?${qs}`, { headers: { accept: "application/json", "user-agent": "lp-agg/0.4" } });
  if (!res.ok) throw new Error(`meteora positions ${res.status}`);
  const data = (await res.json()) as Resp;
  if (!Array.isArray(data.pools) || data.hasNext) throw new Error("Incomplete position response; retaining the previous portfolio.");
  const now = new Date().toISOString();

  const out: Position[] = [];
  for (const r of data.pools ?? []) {
    const n = r.openPositionCount ?? r.listPositions?.length ?? 1;
    const oor = r.positionsOutOfRange?.length ?? (r.outOfRange ? n : 0);
    const listedOut = Array.isArray(r.positionsOutOfRange) && Array.isArray(r.listPositions) && r.listPositions.length === n && r.positionsOutOfRange.every(id=>r.listPositions.includes(id)) ? new Set(r.positionsOutOfRange).size : null;
    const outCount = listedOut ?? (n===1 && typeof r.outOfRange==='boolean' ? (r.outOfRange?1:0) : null);
    // Decimals aren't in this payload; DLMM's poolPrice is already human units, and bounds derived from
    // bins need decimals. Assume 9/9 for SOL-quoted pairs (most memecoins), 6 for USDC/USDT quote.
    const decY = /USD/i.test(r.tokenY) ? 6 : 9;
    const bounds = await meteoraPositionBounds(r.poolAddress, w.address, r.binStep, 6, decY).catch(() => null);
    const entries = bounds?.entries;
    const complete = matchingOpenPositions(entries, r.listPositions, n);
    const sum = (read: (p: any) => unknown) => {
      const values = complete ? entries!.map(p => money(read(p))) : [];
      return values.length && values.every(v => v != null) ? values.reduce<number>((a,v) => a + v!, 0) : null;
    };
    const deposits = sum(p => p.allTimeDeposits?.total?.usd);
    const pnlBreakdown = complete ? combinePnl(entries!.map(p => meteoraPnl(p))) : {
      positionPnlUsd: null, claimedFeesUsd: null, unclaimedFeesUsd: money(r.unclaimedFees),
      unclaimedRewardsUsd: null, totalPnlUsd: money(r.pnl), status: "incomplete" as const,
      note: "Full open-position history is unavailable. Claimed fees and P&L before fees cannot be separated yet.",
    };
    const detailValue = sum(p => p.unrealizedPnl?.balances);
    const tokenAmounts = (read: (p: any, side: string) => unknown) => ['tokenX','tokenY'].flatMap((side,i) => {
      const amount = sum(p => read(p,side));
      return amount == null ? [] : [{symbol: i === 0 ? r.tokenX : r.tokenY, amount}];
    });
    out.push({
      id: `solana:${r.poolAddress}:${w.address}`,
      chain: "solana",
      venue: "meteora-dlmm",
      poolAddress: r.poolAddress,
      pair: `${r.tokenX}/${r.tokenY}`,
      wallet: w.name,
      walletAddress: w.address,
      depositedUsd: deposits ?? num(r.totalDeposit),
      depositScope: deposits != null ? "open-positions" : "pool-history",
      depositedTokens: tokenAmounts((p,side) => p.allTimeDeposits?.[side]?.amount),
      currentTokens: tokenAmounts((p,side) => p.unrealizedPnl?.[side === 'tokenX' ? 'balanceTokenX' : 'balanceTokenY']?.amount),
      pnlPct: complete && pnlBreakdown.totalPnlUsd != null && deposits != null && deposits > 0
        ? pnlBreakdown.totalPnlUsd / deposits * 100 : num(r.pnlPctChange),
      valueUsd: detailValue ?? num(r.balances),
      feesEarnedUsd: complete ? pnlBreakdown.unclaimedFeesUsd : num(r.unclaimedFees),
      pnlUsd: pnlBreakdown.totalPnlUsd,
      pnlBreakdown,
      inRange: outCount == null ? null : outCount === 0,
      rangeStatus: {total:n,out:outCount},
      lower: complete && Number.isFinite(bounds?.lower as number) ? bounds!.lower : null, upper: complete && Number.isFinite(bounds?.upper as number) ? bounds!.upper : null,
      openedAt: bounds?.openedAt ?? null,
      current: num(r.poolPrice),
      note: (n > 1 ? `${n} positions in this pool, ${oor} out of range. ` : "") + pnlBreakdown.note,
      url: `https://app.meteora.ag/dlmm/${r.poolAddress}`,
      fetchedAt: now,
    });
  }
  return out;
}
