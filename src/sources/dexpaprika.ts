import { readFetch as fetch } from "./read-fetch";
import { Pool, Venue, num, hoursSince, isStockToken } from "../schema";

// DexPaprika free API. Keyless: 15 req/min, 50k/month.
// Docs: https://docs.dexpaprika.com/tutorials/pool-filtering
// The old /networks/{n}/pools list endpoint returns 410; /pools/search replaces it.
// Search rows often come back with `tokens: []`, so pair names need a per-pool
// details call. Those are rate-limited, so we resolve a handful per refresh and
// cache the token metadata in KV forever (it doesn't change).
const BASE = "https://api.dexpaprika.com";
const NETWORK = "robinhood";
const DETAILS_PER_REFRESH = 12;

// Token entries have shown up under a few shapes; normalise before use.
interface RawToken { id?: string; address?: string; symbol?: string; name?: string; token?: RawToken }
export interface Tok { id: string; symbol: string; name: string }
function normTokens(raw: unknown): Tok[] {
  if (!Array.isArray(raw)) return [];
  const out: Tok[] = [];
  for (const t of raw) {
    if (typeof t === "string") { out.push({ id: t, symbol: "", name: "" }); continue; }
    const x = (t?.token ?? t) as RawToken;
    const id = x?.id ?? x?.address ?? "";
    if (!id) continue;
    out.push({ id, symbol: x?.symbol ?? "", name: x?.name ?? "" });
  }
  return out;
}
interface SearchRow {
  chain: string;
  id: string;
  dex_id: string;
  dex_name: string;
  volume_usd_24h: number;
  liquidity_usd?: number | null;
  transactions_24h?: number;
  price_usd?: number;
  price_change_percentage_24h?: number;
  created_at?: string;
  tokens?: unknown;
}
interface SearchResponse { results: SearchRow[]; has_next_page: boolean; next_cursor?: string }
interface Details {
  id: string;
  fee?: number | string;
  tokens?: unknown;
  day?: { volume_usd?: number; fees_usd?: number; txns?: number; last_price_usd_change?: number };
  last_price_usd?: number;
}

export interface TokenCache { [poolId: string]: { tokens: Tok[]; fee: number | null } }
export let lastRawRow: unknown = null;  // exposed at /api/debug/dexpaprika
export let lastDetails: unknown = null;

// Fee tiers straight from the chain, which is authoritative and free.
//  V3: each pool is a contract with fee().
//  V4: pools are 32-byte ids; StateView.getSlot0(id) returns (sqrtPriceX96, tick, protocolFee, lpFee).
//      An lpFee with the 0x800000 bit set means a hook sets it dynamically — we can't read that statically.
import { RH as RHV } from "./uniswap-positions";
const RH_RPC = () => RHV.rpc;
const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const SEL_FEE = "0xddca3f43";        // fee()
const SEL_SLOT0 = "0xc815641c";      // getSlot0(bytes32)
const DYNAMIC_FEE_FLAG = 0x800000;

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(RH_RPC(), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
    const j = (await r.json()) as { result?: string };
    return j.result && j.result !== "0x" ? j.result : null;
  } catch { return null; }
}

// Returns fee in hundredths of a bip (3000 = 0.3%), -1 for dynamic-fee V4 pools, null if unknown.
export async function onchainFee(pool: string): Promise<number | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(pool)) {
    const res = await ethCall(pool, SEL_FEE);
    return res ? Number(BigInt(res)) : null;
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(pool)) {
    const res = await ethCall(STATE_VIEW, SEL_SLOT0 + pool.slice(2).toLowerCase());
    if (!res) return null;
    const lpFee = Number(BigInt("0x" + res.slice(2).slice(3 * 64, 4 * 64)));
    return lpFee & DYNAMIC_FEE_FLAG ? -1 : lpFee;
  }
  return null;
}

// Delta's pool pages are keyed by the non-quote token. Quote assets on Robinhood Chain.
const QUOTES = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);
function deltaUrl(t0?: Tok, t1?: Tok): string | null {
  if (!t0?.symbol || !t1?.symbol) return null;
  const base = QUOTES.has(t0.symbol.toUpperCase()) && !QUOTES.has(t1.symbol.toUpperCase()) ? t1 : t0;
  return `https://deltaliquidity.app/pools/${base.id}`;
}

function venueFor(dex: string): Venue {
  const d = dex.toLowerCase();
  if (d.includes("v4")) return "uniswap-v4";
  if (d.includes("v2")) return "uniswap-v2";
  return "uniswap-v3";
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json", "user-agent": "lp-agg/0.1" } });
  if (!res.ok) throw new Error(`dexpaprika ${res.status} ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

export async function fetchDexPaprika(
  minTvl: number,
  tokenCache: TokenCache,
  limit = 60,
): Promise<{ pools: Pool[]; tokenCache: TokenCache }> {
  const qs = new URLSearchParams({
    order_by: "volume_usd_24h",
    sort: "desc",
    limit: String(Math.min(limit, 100)),
    volume_usd_24h_min: "1000",
  });
  if (minTvl > 0) qs.set("liquidity_usd_min", String(Math.floor(minTvl)));
  const { results } = await get<SearchResponse>(`/networks/${NETWORK}/pools/search?${qs}`);
  lastRawRow = results[0] ?? null;

  // Resolve missing token metadata, a few per run, cached forever.
  let budget = DETAILS_PER_REFRESH;
  const details: Record<string, Details> = {};
  const resolved = (ts: Tok[]) => ts.length >= 2 && ts.every((t) => t.symbol);
  // One details call per pool, ever: it gives us the fee tier (immutable) and token names.
  // Budgeted per refresh so a cold cache warms up over a few runs without tripping 15/min.
  for (const r of results) {
    if (tokenCache[r.id]?.fee != null || budget <= 0) continue;
    let d: Details | null = null;
    try { d = await get<Details>(`/networks/${NETWORK}/pools/${r.id}`); details[r.id] = d; lastDetails = d; }
    catch { /* details unavailable; still try on-chain */ }
    const ts = normTokens(d?.tokens);
    const own = normTokens(r.tokens);
    let fee = num(d?.fee);
    if (fee == null) fee = await onchainFee(r.id);
    // Cache whatever we learned; a null fee gets retried next refresh.
    tokenCache[r.id] = { tokens: resolved(ts) ? ts : own, fee };
    budget--;
  }

  const now = new Date().toISOString();
  const pools: Pool[] = [];
  for (const r of results) {
    const own = normTokens(r.tokens);
    const toks = resolved(own) ? own : tokenCache[r.id]?.tokens ?? own;
    const [t0, t1] = toks;
    const tvl = num(r.liquidity_usd);
    if (tvl != null && tvl < minTvl) continue;

    const d = details[r.id];
    const feeRaw = tokenCache[r.id]?.fee ?? num(d?.fee);
    const dynamicFee = feeRaw === -1;
    const tier = feeRaw == null || dynamicFee ? null : feeRaw > 100 ? feeRaw / 1e6 : feeRaw / 100;
    const vol = num(r.volume_usd_24h) ?? 0;
    // Uniswap LP fees are exactly volume × tier; prefer that over a reported figure.
    const fees = tier != null ? vol * tier : num(d?.day?.fees_usd);
    const age = hoursSince(r.created_at);
    const change = num(r.price_change_percentage_24h);

    const tags: string[] = [];
    if (isStockToken(t0?.name) || isStockToken(t1?.name)) tags.push("stock-token");
    if (age != null && age < 72) tags.push("new");
    if (tvl != null && tvl < 25_000) tags.push("thin");
    if (!t0?.symbol || !t1?.symbol) tags.push("unresolved");
    if (dynamicFee) tags.push("dynamic-fee");

    const short = `${r.id.slice(0, 6)}…${r.id.slice(-4)}`;
    pools.push({
      id: `robinhood:${r.id}`,
      chain: "robinhood",
      venue: venueFor(r.dex_name ?? r.dex_id ?? ""),
      address: r.id,
      pair: t0?.symbol && t1?.symbol ? `${t0.symbol}/${t1.symbol}` : short,
      base: { address: t0?.id ?? "", symbol: t0?.symbol ?? "?" },
      quote: { address: t1?.id ?? "", symbol: t1?.symbol ?? "?" },
      tvlUsd: tvl,
      volume24hUsd: vol,
      fees24hUsd: fees,
      // Uniswap tiers are hundredths of a bip on-chain (3000 = 0.3%); DexPaprika may report
      // that or a percent. Both normalised to a fraction above.
      feeTier: tier,
      feeApr: fees != null && tvl ? (fees * 365) / tvl : null,
      priceUsd: num(r.price_usd),
      change24h: change != null ? change / 100 : null,
      ageHours: age,
      tags,
      url: deltaUrl(t0, t1) ?? `https://app.uniswap.org/explore/pools/robinhood/${r.id}`,
      fetchedAt: now,
      feeTvl: { h1: null, mid: null, midHours: 6, h24: fees != null && tvl ? fees / tvl : null },
      txns24h: num(r.transactions_24h),
    });
  }
  return { pools, tokenCache };
}
