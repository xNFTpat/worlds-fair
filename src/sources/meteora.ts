import { readFetch as fetch } from "./read-fetch";
import { Pool, feeApr, num } from "../schema";
import {volumeSignal} from "../volume";

// Meteora DLMM Data API. No key. 30 rps.
// Docs: https://docs.meteora.ag/api-reference/dlmm/pools/pools
// The old dlmm-api.meteora.ag/pair/all is gone (404).
const BASE = "https://dlmm.datapi.meteora.ag";

interface TW { "30m": number; "1h": number; "2h": number; "4h": number; "12h": number; "24h": number }
interface RawToken { address: string; symbol: string; name: string; price: number; is_verified: boolean }
interface RawPool {
  address: string;
  name: string;
  token_x: RawToken;
  token_y: RawToken;
  tvl: number;
  current_price: number;
  created_at: number;          // unix seconds
  volume: TW;
  fees: TW;
  fee_tvl_ratio: TW;           // percent
  apr: number;                 // percent, 24h
  pool_config: { bin_step: number; base_fee_pct: number; max_fee_pct: number; concentrated_liquidity?:boolean; is_fee_scheduler_active?:boolean; compounding_fee_pct?:number };
  dynamic_fee_pct: number;
  is_blacklisted: boolean;
  tags: string[];
  launchpad?: string | null;
}
interface RawResponse { data: RawPool[]; total: number; pages: number; current_page: number; page_size: number }

const pct = (v: unknown) => { const n = num(v); return n == null ? null : n / 100; };

export async function fetchMeteora(venue:"meteora-dlmm"|"meteora-damm-v2"="meteora-dlmm"): Promise<{ pools: Pool[]; partial: boolean }> {
  const damm=venue==="meteora-damm-v2", base=damm?"https://damm-v2.datapi.meteora.ag":BASE;
  // Sample by activity as well as daily volume, so tiny pools aren't silently excluded.
  // This is a bounded catalogue, not a claim to index every pool on Solana.
  const samples = damm ? [
    ["volume_24h:desc", "is_blacklisted=false && tvl>0", 100],
    ["volume_30m:desc", "is_blacklisted=false && tvl>0", 100],
    ["volume_30m:desc", "is_blacklisted=false && tvl>0 && tvl<25000", 100],
    ["pool_created_at:desc", "is_blacklisted=false && tvl>0", 100],
  ] : [
    ["volume_24h:desc", "is_blacklisted=false && tvl>0", 300],
    ["fee_1h:desc", "is_blacklisted=false && tvl>0", 200],
    ["fee_1h:desc", "is_blacklisted=false && tvl>0 && tvl<25000", 150],
    ["volume_30m:desc", "is_blacklisted=false && tvl>0", 200],
    ["volume_30m:desc", "is_blacklisted=false && tvl>0 && tvl<25000", 150],
    ["pool_created_at:desc", "is_blacklisted=false && tvl>0", 100],
  ];
  const lists = await Promise.allSettled(samples.map(async ([sort, filter, size]) => {
    const qs = new URLSearchParams({ page: "1", page_size: String(size), sort_by: String(sort), filter_by: String(filter) });
    const res = await fetch(`${base}/pools?${qs}`, { headers: { accept: "application/json", "user-agent": "lp-agg/0.1" } });
    if (!res.ok) throw new Error(`meteora ${res.status}`);
    const body = await res.json() as RawResponse;
    if (!Array.isArray(body.data)) throw new Error("Meteora returned incomplete pool data");
    return body.data;
  }));
  const good = lists.filter((r): r is PromiseFulfilledResult<RawPool[]> => r.status === "fulfilled");
  if (!good.length) throw new Error("Meteora pool lists unavailable");
  const data = [...new Map(good.flatMap(r => r.value).filter(p => p.is_blacklisted === false && Number(p.tvl) > 0).map(p => [p.address, p])).values()];
  const now = new Date().toISOString();

  const pools = data.map((p): Pool => {
    const tvl = num(p.tvl);
    const fees = num(p.fees?.["24h"]);
    const baseFeePct = num(p.pool_config?.base_fee_pct);
    // created_at arrives in ms on the live API despite the docs saying seconds; handle both.
    const createdMs = p.created_at ? (p.created_at > 1e12 ? p.created_at : p.created_at * 1000) : null;
    const ageHours = createdMs ? (Date.now() - createdMs) / 36e5 : null;

    const tags: string[] = [];
    if (ageHours != null && ageHours < 72) tags.push("new");
    if (tvl != null && tvl < 25_000) tags.push(tvl<100?"near-empty":"thin");
    if (p.token_x?.is_verified && p.token_y?.is_verified) tags.push("verified");
    if (p.launchpad) tags.push(`launchpad:${p.launchpad}`);

    return {
      id: `solana:${p.address}`,
      chain: "solana",
      venue,
      address: p.address,
      pair: `${p.token_x?.symbol ?? "?"}/${p.token_y?.symbol ?? "?"}`,
      base: { address: p.token_x?.address ?? "", symbol: p.token_x?.symbol ?? "?", name: p.token_x?.name },
      quote: { address: p.token_y?.address ?? "", symbol: p.token_y?.symbol ?? "?", name: p.token_y?.name },
      tvlUsd: tvl,
      volume24hUsd: num(p.volume?.["24h"]) ?? 0,
      fees24hUsd: fees,
      feeTier: baseFeePct != null ? baseFeePct / 100 : null,
      feeApr: feeApr(fees, tvl),
      priceUsd: num(p.token_x?.price),
      priceQuote: num(p.current_price),
      quotePriceUsd: num(p.token_y?.price),
      change24h: null,
      ageHours,
      tags,
      url: `https://app.meteora.ag/${damm?"dammv2":"dlmm"}/${p.address}`,
      fetchedAt: now,
      feeTvl: {
        h1: pct(p.fee_tvl_ratio?.["1h"]),
        mid: pct(p.fee_tvl_ratio?.["4h"]), midHours: 4,
        h24: pct(p.fee_tvl_ratio?.["24h"]),
      },
      txns24h: null,
      poolConfig: {concentrated:typeof p.pool_config?.concentrated_liquidity==="boolean"?p.pool_config.concentrated_liquidity:null,feeSchedulerActive:typeof p.pool_config?.is_fee_scheduler_active==="boolean"?p.pool_config.is_fee_scheduler_active:null,compoundingFeePct:num(p.pool_config?.compounding_fee_pct),launchpad:p.launchpad||null,binStep:num(p.pool_config?.bin_step),baseFee:pct(p.pool_config?.base_fee_pct),dynamicFee:pct(p.dynamic_fee_pct)},
      activity: { volume30m:num(p.volume?.["30m"]), volume4h:num(p.volume?.["4h"]), volume12h:num(p.volume?.["12h"]), fees30m: num(p.fees?.["30m"]), fees1h: num(p.fees?.["1h"]), fees4h: num(p.fees?.["4h"]), fees12h:num(p.fees?.["12h"]), volume1h: num(p.volume?.["1h"]) },
    };
  });
  for(const p of pools)p.volumeSignal=volumeSignal(p);
  return { pools, partial: good.length !== lists.length };
}
