import { readFetch as fetch } from "./read-fetch";
import { Position } from "../schema";
import { money, meteoraPnl, matchingOpenPositions } from "../pnl";

// The portfolio endpoint groups by pool. Its listPositions is an identity list,
// not permission to combine independent ranges, cash flows or position records.
const BASE = "https://dlmm.datapi.meteora.ag";

interface Row {
  poolAddress: string;
  tokenX: string; tokenY: string; tokenXMint: string; tokenYMint: string;
  openPositionCount: number;
  listPositions: string[];
  positionsOutOfRange: string[];
  outOfRange: boolean;
  poolPrice: number;
}
interface Resp { pools: Row[]; hasNext: boolean }
export interface WalletRef { name: string; address: string }

const openedAt = (p: any): string | null => {
  const value = p?.createdAt ?? p?.created_at ?? p?.openedAt;
  if (value == null) return null;
  const numeric = money(value);
  const ms = numeric != null ? numeric > 1e12 ? numeric : numeric * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms >= 0 && ms <= 8640000000000000 ? new Date(ms).toISOString() : null;
};

async function positionDetails(poolAddress: string, user: string): Promise<any[] | undefined> {
  try {
    const qs = new URLSearchParams({ user, status: "open", page: "1", page_size: "50" });
    const response = await fetch(`${BASE}/positions/${poolAddress}/pnl?${qs}`, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const data = await response.json() as { positions?: any[]; hasNext?: boolean };
    return data.hasNext === false && Array.isArray(data.positions) ? data.positions : undefined;
  } catch { return undefined; }
}

export async function fetchMeteoraPositions(w: WalletRef): Promise<Position[]> {
  const qs = new URLSearchParams({ user: w.address, page: "1", page_size: "50" });
  const res = await fetch(`${BASE}/portfolio/open?${qs}`, { headers: { accept: "application/json", "user-agent": "lp-agg/0.4" } });
  if (!res.ok) throw new Error(`meteora positions ${res.status}`);
  const data = (await res.json()) as Resp;
  if (!Array.isArray(data.pools) || data.hasNext !== false) throw new Error("Incomplete position response; retaining the previous portfolio.");
  const now = new Date().toISOString(), out: Position[] = [], seen = new Set<string>();
  for (const row of data.pools) {
    const ids = row.listPositions, count = row.openPositionCount ?? ids?.length;
    if (!Array.isArray(ids) || !Number.isSafeInteger(count) || count < 0 || ids.length !== count
      || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== count
      || ids.some(id => seen.has(id))) throw new Error("Position identities are incomplete; retaining the previous portfolio.");
    if (!ids.length) continue;
    ids.forEach(id => seen.add(id));
    const entries = await positionDetails(row.poolAddress, w.address);
    const complete = matchingOpenPositions(entries, ids, count);
    const byAddress = new Map(complete ? entries.map(p => [p.positionAddress, p]) : []);
    const listedOut = Array.isArray(row.positionsOutOfRange)
      && new Set(row.positionsOutOfRange).size === row.positionsOutOfRange.length
      && row.positionsOutOfRange.every(id => ids.includes(id)) ? new Set(row.positionsOutOfRange) : null;
    for (const address of ids) {
      const detail = byAddress.get(address);
      // No aggregate pool value is apportioned to an individual position.
      const pnlBreakdown = detail ? meteoraPnl(detail) : {
        positionPnlUsd: null, claimedFeesUsd: null, unclaimedFeesUsd: null,
        unclaimedRewardsUsd: null, totalPnlUsd: null, status: "incomplete" as const,
        note: "Individual position accounting is unavailable. Pool totals are not assigned to this position.",
      };
      const deposits = money(detail?.allTimeDeposits?.total?.usd);
      const tokenAmounts = (read: (side: string) => unknown) => ['tokenX', 'tokenY'].flatMap((side, i) => {
        const amount = money(read(side));
        return amount == null || amount < 0 ? [] : [{symbol: i === 0 ? row.tokenX : row.tokenY, amount}];
      });
      const lower = money(detail?.minPrice), upper = money(detail?.maxPrice);
      const boundsKnown = lower != null && upper != null && lower > 0 && upper > lower;
      const outOfRange = listedOut ? listedOut.has(address) : count === 1 && typeof row.outOfRange === 'boolean' ? row.outOfRange : typeof detail?.outOfRange === 'boolean' ? detail.outOfRange : null;
      out.push({
        id: `solana:${address}`, positionAddress: address,
        poolGroupId: `solana:${row.poolAddress}:${w.address}`,
        chain: "solana", venue: "meteora-dlmm", poolAddress: row.poolAddress,
        baseAddress: row.tokenXMint, quoteAddress: row.tokenYMint,
        pair: `${row.tokenX}/${row.tokenY}`, wallet: w.name, walletAddress: w.address,
        depositedUsd: deposits, depositScope: "open-positions",
        depositedTokens: tokenAmounts(side => detail?.allTimeDeposits?.[side]?.amount),
        currentTokens: tokenAmounts(side => detail?.unrealizedPnl?.[side === 'tokenX' ? 'balanceTokenX' : 'balanceTokenY']?.amount),
        pnlPct: pnlBreakdown.totalPnlUsd != null && deposits != null && deposits > 0 ? pnlBreakdown.totalPnlUsd / deposits * 100 : null,
        valueUsd: money(detail?.unrealizedPnl?.balances), feesEarnedUsd: pnlBreakdown.unclaimedFeesUsd,
        pnlUsd: pnlBreakdown.totalPnlUsd, pnlBreakdown,
        inRange: outOfRange == null ? null : !outOfRange,
        rangeStatus: {total: 1, out: outOfRange == null ? null : outOfRange ? 1 : 0},
        lower: boundsKnown ? lower : null, upper: boundsKnown ? upper : null,
        openedAt: openedAt(detail), current: money(row.poolPrice), note: pnlBreakdown.note,
        url: `https://app.meteora.ag/dlmm/${row.poolAddress}`, fetchedAt: now,
      });
    }
  }
  return out;
}
