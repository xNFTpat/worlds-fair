// One shape for every pool, whatever chain or venue it came from.
// Sources normalise into this and nothing downstream knows where data came from.

export type Chain = "solana" | "robinhood";
export type Venue = "meteora-dlmm" | "meteora-damm-v2" | "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "delta" | "raydium-clmm" | "raydium-cpmm" | "raydium-amm" | "orca-whirlpool";

export interface Pool {
  id: string;            // `${chain}:${address}`
  chain: Chain;
  venue: Venue;
  address: string;
  pair: string;          // "SOL/USDC"
  base: Token;
  quote: Token;
  tvlUsd: number | null; // null when the source doesn't give it
  volume24hUsd: number;
  feeSource?: "reported" | "estimated";
  fees24hUsd: number | null;
  feeTier: number | null;   // fraction, 0.003 = 0.3%. Meteora base fee; Uni tier.
  feeApr: number | null;    // annualised fees/TVL, fraction. Derived; null if TVL unknown.
  priceUsd: number | null;
  priceQuote?: number | null; // source pool price: quote tokens per base token
  change24h: number | null; // fraction
  ageHours: number | null;
  tags: string[];        // "stock-token", "new", "thin", etc.
  url: string;           // where to go to actually LP
  fetchedAt: string;     // ISO
  // Fee-to-TVL over short windows (fraction, e.g. 0.002 = 0.2% of TVL paid in fees in that window).
  // Meteora provides these directly; Robinhood pools only get the 24h figure. This is the alpha signal.
  feeTvl: { h1: number | null; mid: number | null; midHours: number; h24: number | null } | null;
  txns24h: number | null;
  quotePriceUsd?: number | null;  // USD price of the quote token, when the source gives it
  activity?: { fees30m: number | null; fees1h: number | null; fees4h: number | null; fees12h?:number|null; volume1h: number | null; volume30m?:number|null; volume4h?:number|null; volume12h?:number|null };
  volumeSignal?: import('./volume').VolumeSignal;
  poolConfig?: { concentrated:boolean|null; feeSchedulerActive:boolean|null; compoundingFeePct:number|null; launchpad:string|null; binStep?:number|null; baseFee?:number|null; dynamicFee?:number|null };
}

export interface Token {
  address: string;
  symbol: string;
  name?: string;
}

export interface Position {
  baseAddress?: string;
  quoteAddress?: string;
  id: string;
  chain: Chain;
  venue: Venue;
  poolAddress: string;
  pair: string;
  wallet: string;             // short name, e.g. "patsol"
  walletAddress: string;
  depositedUsd: number | null;
  depositScope?: "open-positions" | "pool-history";
  depositedTokens?: {symbol: string; amount: number}[];
  currentTokens?: {symbol: string; amount: number}[];
  pnlPct?: number | null;
  valueUsd: number | null;    // current value if known
  feesEarnedUsd: number | null;   // legacy unclaimed amount; Uniswap tokensOwed may include withdrawn principal
  pnlUsd: number | null;
  pnlBreakdown?: import("./pnl").PnlBreakdown;
  inRange: boolean | null;
  rangeStatus?: { total:number; out:number|null };
  lower: number | null;       // price bounds in quote per base
  upper: number | null;
  current: number | null;
  note: string | null;        // caveats about what the numbers cover
  url: string;
  fetchedAt: string;
  openedAt?: string | null;   // ISO, when the position was created (best effort)
}

export interface Snapshot {
  pools: Pool[];
  discoveryCoverage?: string;
  sources?: Record<string, import("./health").SourceHealth>;
  errors: Record<string, string>; // source -> error message, so a dead API doesn't nuke the page
  updatedAt: string;
}

// Derived helpers. Kept here so every source computes them identically.
export function feeApr(fees24hUsd: number | null, tvlUsd: number | null): number | null {
  if (fees24hUsd == null || tvlUsd == null || tvlUsd <= 0) return null;
  return (fees24hUsd * 365) / tvlUsd;
}

export function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : null;
}

// Robinhood stock tokens all carry "• Robinhood Token" in their name.
export function isStockToken(name: string | undefined): boolean {
  return !!name && /robinhood token/i.test(name);
}
