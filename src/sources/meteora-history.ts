import { readFetch as fetch } from "./read-fetch";
import { num } from "../schema";
import { meteoraPnl, type PnlBreakdown } from "../pnl";
import type { WalletRef } from "./meteora-positions";

// Closed positions and lifetime totals from Meteora's indexer.
// GET /portfolio?user=  (pools with closed positions, most recent first)
// GET /portfolio/total?user=  (lifetime aggregates)
const BASE = "https://dlmm.datapi.meteora.ag";
const UA = { headers: { accept: "application/json", "user-agent": "lp-agg/0.5" } };

export interface ClosedPosition {
  chain: "solana" | "robinhood"; venue: string; wallet: string;
  poolAddress: string; pair: string;
  positionAddress?: string | null; openedAt?: string | null; lower?: number | null; upper?: number | null;
  groupKey?: string;            // pool this position belongs to (per-position rows)
  isGroup?: boolean;            // pool-level totals row
  positionCount?: number;
  depositedUsd: number | null; withdrawnUsd: number | null; feesUsd: number | null; pnlUsd: number | null; pnlPct: number | null;
  pnlBreakdown?: PnlBreakdown;
  closedAt: string | null; url: string;
}
export interface HistoryTotals { deposits: number | null; withdrawals: number | null; fees: number | null; pnl: number | null; positions: number | null; note?: string }

interface Row {
  poolAddress: string; tokenX: string; tokenY: string;
  totalDeposit?: string; totalWithdrawal?: string; totalFee?: string; totalFees?: string;
  pnl?: string; pnlUsd?: string; pnlPctChange?: string; lastClosedAt?: number | string; closedPositionCount?: number;
}

const ts = (v: unknown): string | null => {
  const n = typeof v === "string" && !/^\d+(\.\d+)?$/.test(v) ? null : num(v); if (n == null) { const d = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(d) ? new Date(d).toISOString() : null; }
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
};
const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null) return o[k]; return undefined; };

// GET /positions/{pool}/pnl?user=&status=closed — one row per position. Field names vary by version.
async function positionRows(c: ClosedPosition, user: string): Promise<ClosedPosition[]> {
  const qs = new URLSearchParams({ user, status: "closed", page: "1", page_size: "50" });
  const r = await fetch(`${BASE}/positions/${c.poolAddress}/pnl?${qs}`, UA);
  if (!r.ok) throw Error('Position records unavailable');
  const j = (await r.json()) as any;
  const list: any[] = j.positions ?? j.data ?? (Array.isArray(j) ? j : []);
  return list.filter(p => p.isClosed !== false).map((p): ClosedPosition => ({
    ...c,
    positionAddress: pick(p, "positionAddress", "position", "address") ?? null,
    // Only what this endpoint actually reports per position; pool-level totals live on the group row.
    depositedUsd: num(p.allTimeDeposits?.total?.usd ?? pick(p, "totalDeposit", "depositUsd", "totalDepositUsd", "deposit")) ?? null,
    withdrawnUsd: num(p.allTimeWithdrawals?.total?.usd ?? pick(p, "totalWithdrawal", "withdrawUsd", "totalWithdrawalUsd", "withdrawal")) ?? null,
    feesUsd: num(p.allTimeFees?.total?.usd ?? pick(p, "totalFee", "totalFees", "claimedFee", "feeUsd", "totalClaimedFee", "fees")) ?? null,
    pnlUsd: num(pick(p, "pnl", "pnlUsd")) ?? null,
    pnlBreakdown: meteoraPnl(p, true),
    pnlPct: num(pick(p, "pnlPctChange", "pnlPct")) ?? null,
    groupKey: c.poolAddress,
    openedAt: ts(pick(p, "createdAt", "openedAt", "created_at")),
    closedAt: ts(pick(p, "closedAt", "lastClosedAt", "closed_at")) ?? c.closedAt,
    lower: num(pick(p, "lowerPrice", "minPrice")), upper: num(pick(p, "upperPrice", "maxPrice")),
  }));
}

// Raw per-position record for one pool, so field names can be checked by eye.
export async function rawPositionRecords(poolAddress: string, user: string): Promise<unknown> {
  const qs = new URLSearchParams({ user, status: "closed", page: "1", page_size: "5" });
  const r = await fetch(`${BASE}/positions/${poolAddress}/pnl?${qs}`, UA);
  return { status: r.status, body: await r.json().catch(() => null) };
}

export async function fetchMeteoraHistory(w: WalletRef, daysBack = 365, kv?:KVNamespace): Promise<{ closed: ClosedPosition[]; totals: HistoryTotals | null; errors: string[] }> {
  const qs = new URLSearchParams({ user: w.address, page: "1", page_size: "100", days_back: String(daysBack) });
  const errors: string[] = [];
  const [r1, r2] = await Promise.all([
    fetch(`${BASE}/portfolio?${qs}`, UA).catch(() => null),
    fetch(`${BASE}/portfolio/total?${new URLSearchParams({ user: w.address })}`, UA).catch(() => null),
  ]);
  if (!r1?.ok) errors.push("Closed-position history unavailable");
  const j = (r1?.ok ? await r1.json() : {}) as { pools?: Row[]; hasNext?: boolean };
  if (j.hasNext) errors.push("More closed pools exist; this table shows the first 100 from the last 365 days");
  const closed = (j.pools ?? []).map((r): ClosedPosition => {
    
    return {
      chain: "solana", venue: "meteora-dlmm", wallet: w.name,
      poolAddress: r.poolAddress, pair: `${r.tokenX}/${r.tokenY}`,
      depositedUsd: num(r.totalDeposit), withdrawnUsd: num(r.totalWithdrawal),
      feesUsd: num(r.totalFee ?? r.totalFees), pnlUsd: num(r.pnl ?? r.pnlUsd), pnlPct: num(r.pnlPctChange),
      closedAt: ts(r.lastClosedAt),
      url: `https://app.meteora.ag/dlmm/${r.poolAddress}`,
    };
  });
  // Expand each pool into its individual closed positions where the per-position endpoint cooperates.
  const expanded:ClosedPosition[][]=new Array(closed.length);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,closed.length)},async()=>{
    while(cursor<closed.length){const i=cursor++,c=closed[i],key=`history-pool:v1:${w.address}:${c.poolAddress}`;
      const saved=kv?await kv.get<{at:number;closedAt:string|null;rows:ClosedPosition[]}>(key,'json'):null;
      let rows:ClosedPosition[]=[];
      try{
        if(saved&&saved.closedAt===c.closedAt&&Date.now()-saved.at<3600000)rows=saved.rows;
        else {rows=await positionRows(c,w.address);if(rows.length>=50)errors.push(`Position history limit reached for ${c.pair} (50 rows).`);if(kv&&rows.length)await kv.put(key,JSON.stringify({at:Date.now(),closedAt:c.closedAt,rows}),{expirationTtl:604800});}
      }catch{rows=saved?.rows||[];errors.push(`Individual records unavailable for ${c.pair}${saved?'; saved rows retained':''}.`);}
      if(!rows.length)errors.push(`No individual records returned for ${c.pair}.`);
      expanded[i]=[{...c,isGroup:true,groupKey:c.poolAddress,positionCount:rows.length},...rows];
    }
  }));
  closed.splice(0,closed.length,...expanded.flat());

  let totals: HistoryTotals | null = null;
  if (r2?.ok) {
    const t = (await r2.json()) as any;
    const g = (...ks: string[]) => { for (const k of ks) { const v = num(t?.[k] ?? t?.total?.[k]); if (v != null) return v; } return null; };
    totals = { deposits: g("totalDeposit", "deposits", "totalDeposits"), withdrawals: g("totalWithdrawal", "withdrawals", "totalWithdrawals"),
      fees: g("totalFee", "totalFees", "fees"), pnl: g("totalPnlUsd", "pnl", "pnlUsd", "totalPnl"), positions: g("totalClosedPositions", "totalPositions", "positions"), note: "Lifetime closed positions · Meteora indexer. Open positions are shown separately. Deposits, withdrawals and fees are unavailable from this lifetime endpoint." };
  }
  if (!r2?.ok) errors.push("Lifetime totals unavailable");
  return { closed, totals, errors };
}
