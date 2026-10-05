import type {Env} from './env';
import {health, publicError, type SourceHealth} from './health';
import type {Pool, Position, Snapshot} from './schema';
import {withRaydiumPoolUrl} from './pool-links';
import {fetchMeteora} from './sources/meteora';
import {fetchDexPaprika,type TokenCache} from './sources/dexpaprika';
import {fetchGeckoTerminal} from './sources/geckoterminal';
import {fetchDelta} from './sources/delta';
import {fetchSolanaVenue} from './sources/solana-venues';
import {fetchMeteoraPositions,type WalletRef} from './sources/meteora-positions';
import {fetchUniswapPositions,ethBalance,type TokenMetaCache,RH,setRobinhoodRpc} from './sources/uniswap-positions';
import {solanaBalances} from './sources/solana-balance';
import {rangeInbox,volumeInbox} from './range-alerts';

export const SNAPSHOT_KEY = "snapshot:v1";
export const TOKEN_CACHE_KEY = "dexpaprika:tokens:v1";
const META_CACHE_KEY = "robinhood:tokenmeta:v1";
export const POSITIONS_KEY = "positions:v1";
export const OPENED_KEY = "robinhood:opened:v1";
const PUBLIC_RH_RPC = "https://rpc.mainnet.chain.robinhood.com";

// Guard against a configured RPC that's behind the chain (seen with a freshly-added chain on a
// hosted provider): compare block heights and use whichever is current. Cached briefly.
export async function pickRobinhoodRpc(env: Env): Promise<{ rpc: string; note: string | null }> {
  const configured = env.ROBINHOOD_RPC;
  if (!configured || configured === PUBLIC_RH_RPC) return { rpc: PUBLIC_RH_RPC, note: null };
  const cached = await env.LP_CACHE.get<{ rpc: string; note: string | null }>("rh:rpc-choice", "json");
  if (cached) return cached;
  const height = async (u: string) => {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      const j = (await r.json()) as { result?: string }; return j.result ? Number(BigInt(j.result)) : null;
    } catch { return null; }
  };
  const [a, b] = await Promise.all([height(configured), height(PUBLIC_RH_RPC)]);
  let choice: { rpc: string; note: string | null };
  if (a == null && b != null) choice = { rpc: PUBLIC_RH_RPC, note: "ROBINHOOD_RPC unreachable; using public node" };
  else if (a != null && b != null && b - a > 500) choice = { rpc: PUBLIC_RH_RPC, note: `ROBINHOOD_RPC is ${(b - a).toLocaleString()} blocks behind; using public node` };
  else if (a != null && b == null) choice = { rpc: configured, note: "Public node unavailable; using the responding configured provider" };
  else if (a == null) choice = { rpc: PUBLIC_RH_RPC, note: "Neither provider responded to the health check; data may be unavailable" };
  else choice = { rpc: configured, note: null };
  await env.LP_CACHE.put("rh:rpc-choice", JSON.stringify(choice), { expirationTtl: 300 });
  return choice;
}

export function wallets(env: Env): WalletRef[] {
  return (env.WALLETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => { const [name, address] = s.split(":"); return { name, address }; })
    .filter((w) => w.name && w.address);
}

const inFlight = new WeakMap<object, Map<string, Promise<any>>>();
export function singleFlight<T>(env: Env, key: string, work: () => Promise<T>): Promise<T> {
  let jobs = inFlight.get(env.LP_CACHE);
  if (!jobs) { jobs = new Map(); inFlight.set(env.LP_CACHE, jobs); }
  if (jobs.has(key)) return jobs.get(key)!;
  const result = work().finally(() => jobs!.delete(key));
  jobs.set(key, result);
  return result;
}
export function refresh(env: Env): Promise<Snapshot> { return singleFlight(env, "pools", () => refreshPoolsImpl(env)); }
export function refreshPositions(env: Env): Promise<PositionsPayload> { return singleFlight(env, "positions", () => refreshPositionsImpl(env)); }

export async function refreshPoolsImpl(env: Env): Promise<Snapshot> {
  const minTvl = parseFloat(env.MIN_TVL_USD || "0");
  const errors: Record<string, string> = {};
  const pools: Pool[] = [];
  const tokenCache = (await env.LP_CACHE.get<TokenCache>(TOKEN_CACHE_KEY, "json")) ?? {};

  const previous = await env.LP_CACHE.get<Snapshot>(SNAPSHOT_KEY, "json");
  const sources: Record<string, SourceHealth> = {};
  const attemptedAt = new Date().toISOString();
  const keepPrevious = (chain: string, venue?:string) => {
    const kept = (previous?.pools ?? []).filter((p) => p.chain === chain && (!venue||p.venue===venue));
    if (kept.length) { pools.push(...kept); errors[`${chain}-data`] = "Showing saved pool data; see source status for its last successful update."; }
  };

  const [met, gecko, del, damm, raydium, orca] = await Promise.allSettled([
    fetchMeteora(),
    fetchGeckoTerminal(minTvl, tokenCache),
    fetchDelta(),
    fetchMeteora("meteora-damm-v2"),
    fetchSolanaVenue("raydium",env.LP_CACHE),
    fetchSolanaVenue("orca",env.LP_CACHE),
  ]);
  if (met.status === "fulfilled") {
    pools.push(...met.value.pools);
    if (met.value.partial) {
      errors["meteora-partial"] = "Some activity lists could not refresh. Saved pools retain their original timestamps.";
      const ids = new Set(met.value.pools.map(p => p.id));
      pools.push(...(previous?.pools ?? []).filter(p => p.venue === 'meteora-dlmm' && !ids.has(p.id)));
    }
  } else { errors.meteora = String(met.reason?.message ?? met.reason); keepPrevious("solana","meteora-dlmm"); }
  if(damm.status==='fulfilled') {
    pools.push(...damm.value.pools);
    if(damm.value.partial){errors['damm-partial']='Some DAMM v2 pool lists could not refresh.';const ids=new Set(damm.value.pools.map(p=>p.id));pools.push(...(previous?.pools||[]).filter(p=>p.venue==='meteora-damm-v2'&&!ids.has(p.id)));}
  } else {errors.damm=String(damm.reason?.message??damm.reason);keepPrevious('solana','meteora-damm-v2');}
  sources.damm=health('Meteora DAMM v2 pools',attemptedAt,!errors.damm,previous?.sources?.damm,errors.damm?publicError(errors.damm):undefined);
  if(errors['damm-partial'])sources.damm={...sources.damm,status:'partial',message:errors['damm-partial']};
  for(const [name,result] of [['raydium',raydium],['orca',orca]] as const){
    if(result.status==='fulfilled')pools.push(...result.value);
    else{errors[name]=publicError(result.reason);pools.push(...(previous?.pools||[]).filter(p=>p.venue?.startsWith(name)));}
    sources[name]=health(name==='raydium'?'Raydium pools':'Orca pools',attemptedAt,result.status==='fulfilled',previous?.sources?.[name],errors[name]);
  }
  if (del.status === "fulfilled") pools.push(...del.value); else errors.delta = String(del.reason?.message ?? del.reason);
  if (gecko.status === "fulfilled") {
    pools.push(...gecko.value.pools);
    if (gecko.value.partial) {
      errors["robinhood-partial"] = "Some pool pages failed. Missing pools are retained from the last successful read.";
      const ids = new Set(gecko.value.pools.map(p => p.id));
      pools.push(...(previous?.pools ?? []).filter(p => p.chain === "robinhood" && !ids.has(p.id)));
    }
    await env.LP_CACHE.put(TOKEN_CACHE_KEY, JSON.stringify(gecko.value.feeCache));
  } else {
    // GeckoTerminal down → fall back to DexPaprika for Robinhood.
    errors.geckoterminal = String(gecko.reason?.message ?? gecko.reason);
    try {
      const dex = await fetchDexPaprika(minTvl, tokenCache);
      pools.push(...dex.pools);
      await env.LP_CACHE.put(TOKEN_CACHE_KEY, JSON.stringify(dex.tokenCache));
    } catch (e: any) { errors.dexpaprika = String(e?.message ?? e); keepPrevious("robinhood"); }
  }

  for (const [key, label, chain] of [["meteora", "Meteora pools", "solana"], ["geckoterminal", "Robinhood pools", "robinhood"]]) {
    const old = previous?.sources?.[key];
    const oldTime = (previous?.pools ?? []).find(p => p.chain === chain)?.fetchedAt;
    sources[key] = health(label, attemptedAt, !errors[key], old ?? (oldTime ? { lastSuccessAt: oldTime } as SourceHealth : undefined), errors[key] ? publicError(errors[key]) : undefined);
    if (key === "geckoterminal" && errors.geckoterminal && !errors.dexpaprika) sources[key] = { ...sources[key], status: "partial", message: "Using the alternate pool provider.", lastSuccessAt: attemptedAt };
  }
  if (errors["robinhood-partial"]) sources.geckoterminal = { ...sources.geckoterminal, status: "partial", lastSuccessAt: previous?.sources?.geckoterminal?.lastSuccessAt ?? null, message: errors["robinhood-partial"] };
  if (errors["meteora-partial"]) sources.meteora = { ...sources.meteora, status: "partial", lastSuccessAt: previous?.sources?.meteora?.lastSuccessAt ?? null, message: errors["meteora-partial"] };
  for (const key of Object.keys(errors)) errors[key] = publicError(errors[key]);
  const discoveryCoverage = `Solana DLMM: sampled by daily volume (300), hourly fees (200), small-pool hourly fees (150), 30m volume (200), small-pool 30m volume (150), and newest pools (100). DAMM v2: up to 100 each by daily volume, 30m volume, small-pool 30m volume and newest creation. Duplicates removed; blacklisted and zero-TVL pools excluded. Robinhood uses a $${minTvl.toLocaleString('en-US')} source floor. Raydium: top 150 by daily volume. Orca: top 100 by daily volume; these catalogues refresh at most every ten minutes. HawkFi and Delta manage underlying pools, so are not counted again. This is a bounded sample, not every pool or a live transaction stream. Newest pool does not mean newest token.`;
  const snap: Snapshot = { pools:[...new Map(pools.map(p=>[p.id,p])).values()], sources, errors, updatedAt: attemptedAt, discoveryCoverage };
  await env.LP_CACHE.put(SNAPSHOT_KEY, JSON.stringify(snap));
  if(env.RANGE_ALERTS)try {const r=await volumeInbox(env.RANGE_ALERTS).fetch('https://volume-inbox/volume',{method:'POST',body:JSON.stringify(snap)});if(!r.ok)throw Error('Volume observation rejected');}catch{console.warn('Volume inbox did not record this scan');}
  return snap;
}

export async function getSnapshot(env: Env): Promise<Snapshot> {
  const snap=(await env.LP_CACHE.get<Snapshot>(SNAPSHOT_KEY, "json")) ?? (await refresh(env));
  // Correct saved directory links immediately without refreshing market data.
  return {...snap,pools:snap.pools.map(withRaydiumPoolUrl)};
}

// USD price lookup for Robinhood tokens, derived from the pool snapshot: stables are $1, and
// anything paired against a stable takes the pool price. Good enough for position valuation.
function robinhoodPricer(snap: Snapshot): (token: string) => number | null {
  const stables = new Set([RH.usdg.toLowerCase()]);
  const byToken = new Map<string, number>();
  for (const p of snap.pools) {
    if (p.chain !== "robinhood" || p.priceUsd == null) continue;
    // DexPaprika price_usd is the pool's base (token0) price in USD.
    if (!byToken.has(p.base.address.toLowerCase())) byToken.set(p.base.address.toLowerCase(), p.priceUsd);
  }
  return (t) => {
    const k = t.toLowerCase();
    if (stables.has(k)) return 1;
    return byToken.get(k) ?? null;
  };
}

export interface PositionsPayload {
  sources?: Record<string, SourceHealth>;
  positions: Position[];
  balances: { wallet: string; chain: string; native: number | null; symbol: string; stable?: number }[];
  errors: Record<string, string>;
  updatedAt: string;
}

export async function refreshPositionsImpl(env: Env): Promise<PositionsPayload> {
  const ws = wallets(env);
  const snap = await getSnapshot(env);
  const metaCache = (await env.LP_CACHE.get<TokenMetaCache>(META_CACHE_KEY, "json")) ?? {};
  const openedCache = (await env.LP_CACHE.get<Record<string, string>>(OPENED_KEY, "json")) ?? {};
  const choice = await pickRobinhoodRpc(env);
  const rpc = choice.rpc;
  setRobinhoodRpc(rpc);
  const errors: Record<string, string> = {};
  if (choice.note) errors["robinhood-rpc"] = choice.note;
  const price = robinhoodPricer(snap);
  const positions: Position[] = [];
  const balances: PositionsPayload["balances"] = [];

  const previous = await env.LP_CACHE.get<PositionsPayload>(POSITIONS_KEY, "json");
  const sources: Record<string, SourceHealth> = {};
  const attemptedAt = new Date().toISOString();
  await Promise.all(ws.map(async w => {
    const isEvm = w.address.startsWith("0x");
    const chain = isEvm ? "robinhood" : "solana";
    const pk = `positions:${w.name}`, bk = `balance:${w.name}`;
    const oldPositions = (previous?.positions ?? []).filter(p => p.wallet === w.name);
    const oldBalance = previous?.balances.find(b => b.wallet === w.name);
    const oldPositionHealth = previous?.sources?.[pk] ?? (oldPositions[0]?.fetchedAt ? { lastSuccessAt: oldPositions[0].fetchedAt } as SourceHealth : undefined);
    await Promise.all([
      (async () => {
        try {
          const rows = isEvm ? await fetchUniswapPositions(w, metaCache, price, rpc, openedCache) : await fetchMeteoraPositions(w);
          positions.push(...rows);
          sources[pk] = health(`${w.name} positions`, attemptedAt, true);
        } catch (e) {
          errors[pk] = publicError(e);
          positions.push(...oldPositions);
          sources[pk] = health(`${w.name} positions`, attemptedAt, false, oldPositionHealth, errors[pk]);
        }
      })(),
      (async () => {
        try {
          const b = isEvm ? { native: await ethBalance(w.address, rpc), symbol: "ETH" } : await solanaBalances(w.address, env.SOLANA_RPC).then(b => ({ native: b.sol, stable: b.usdc, symbol: "SOL" }));
          balances.push({ wallet: w.name, chain, ...b });
          sources[bk] = health(`${w.name} wallet`, attemptedAt, true);
        } catch (e) {
          errors[bk] = publicError(e);
          // Legacy ETH balances may be false zeros. Only retain balances with verified provenance.
          const trusted = previous?.sources?.[bk]?.lastSuccessAt;
          balances.push(trusted && oldBalance ? oldBalance : { wallet: w.name, chain, native: null, symbol: isEvm ? "ETH" : "SOL" });
          sources[bk] = health(`${w.name} wallet`, attemptedAt, false, previous?.sources?.[bk], errors[bk]);
        }
      })(),
    ]);
  }));
  balances.sort((a, b) => ws.findIndex(w => w.name === a.wallet) - ws.findIndex(w => w.name === b.wallet));
  await env.LP_CACHE.put(META_CACHE_KEY, JSON.stringify(metaCache));
  await env.LP_CACHE.put(OPENED_KEY, JSON.stringify(openedCache));
  const payload = { positions, balances, sources, errors, updatedAt: attemptedAt };
  await env.LP_CACHE.put(POSITIONS_KEY, JSON.stringify(payload));
  if(env.RANGE_ALERTS) {
    try { const recorded=await rangeInbox(env.RANGE_ALERTS).fetch('https://range-inbox/observe',{method:'POST',body:JSON.stringify({payload,wallets:ws.map(w=>w.name)})}); if(!recorded.ok)throw new Error('Range observation rejected'); }
    catch { console.warn('Range inbox did not record this observation'); }
  }
  return payload;
}

