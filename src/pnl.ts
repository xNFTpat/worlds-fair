// Keep principal performance separate from fee income. Never subtract a guessed fee
// total from reported P&L: that can silently turn missing history into price profit.
export interface PnlBreakdown {
  positionPnlUsd: number | null;
  claimedFeesUsd: number | null;
  unclaimedFeesUsd: number | null;
  unclaimedRewardsUsd: number | null;
  totalPnlUsd: number | null;
  status: "reconciled" | "incomplete" | "mismatch";
  note: string;
}

export function money(v: unknown): number | null {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const amount = (v: unknown) => { const n = money(v); return n != null && n >= 0 ? n : null; };
export function sumMoney(values: (number | null)[]): number | null {
  if (!values.length || values.some(v => v == null)) return null;
  return money(values.reduce<number>((a, v) => a + v!, 0));
}

export function meteoraPnl(p: any, closed = false): PnlBreakdown {
  const u = p.unrealizedPnl;
  // A confirmed closed record without an unrealized section has no remaining
  // liquidity/claim. If the section exists, require its actual values.
  const ended = closed && p.isClosed !== false && u == null;
  const value = ended ? 0 : amount(u?.balances);
  const deposited = amount(p.allTimeDeposits?.total?.usd);
  const withdrawn = amount(p.allTimeWithdrawals?.total?.usd);
  const claimedFeesUsd = amount(p.allTimeFees?.total?.usd);
  const unclaimedFeesUsd = ended ? 0 : sumMoney([amount(u?.unclaimedFeeTokenX?.usd), amount(u?.unclaimedFeeTokenY?.usd)]);
  const unclaimedRewardsUsd = ended ? 0 : sumMoney([amount(u?.unclaimedRewardTokenX?.usd), amount(u?.unclaimedRewardTokenY?.usd)]);
  const positionPnlUsd = value != null && deposited != null && withdrawn != null ? money(value + withdrawn - deposited) : null;
  const totalPnlUsd = money(p.pnlUsd ?? p.pnl);
  const calculated = sumMoney([positionPnlUsd, claimedFeesUsd, unclaimedFeesUsd, unclaimedRewardsUsd]);
  const status = calculated == null || totalPnlUsd == null ? "incomplete"
    : Math.abs(calculated - totalPnlUsd) <= 0.01 + Math.abs(totalPnlUsd) * 1e-9 ? "reconciled" : "mismatch";
  const note = status === "reconciled" ? "Before network costs. Claimed fees use historical USD values; unclaimed fees use current prices."
    : status === "mismatch" ? "Breakdown differs from Meteora's reported total; some income or adjustments may be missing."
    : "Some position accounting is unavailable. Total P&L is shown only when reported by Meteora.";
  return {positionPnlUsd, claimedFeesUsd, unclaimedFeesUsd, unclaimedRewardsUsd, totalPnlUsd, status, note};
}

export function combinePnl(rows: PnlBreakdown[]): PnlBreakdown {
  const status = rows.some(x => x.status === "mismatch") ? "mismatch"
    : rows.length && rows.every(x => x.status === "reconciled") ? "reconciled" : "incomplete";
  const sum = (key: keyof PnlBreakdown) => sumMoney(rows.map(x => x[key] as number | null));
  return {
    positionPnlUsd: sum("positionPnlUsd"), claimedFeesUsd: sum("claimedFeesUsd"),
    unclaimedFeesUsd: sum("unclaimedFeesUsd"), unclaimedRewardsUsd: sum("unclaimedRewardsUsd"),
    totalPnlUsd: sum("totalPnlUsd"), status,
    note: rows.find(x => x.status === status)?.note ?? "Position accounting is unavailable.",
  };
}

export function matchingOpenPositions(entries: any[] | undefined, ids: string[] | undefined, count: number): entries is any[] {
  return Array.isArray(entries) && Array.isArray(ids) && count > 0 && entries.length === count && ids.length === count
    && new Set(ids).size === count && new Set(entries.map(p => p.positionAddress)).size === count
    && entries.every(p => p.isClosed === false && typeof p.positionAddress === "string" && ids.includes(p.positionAddress));
}
