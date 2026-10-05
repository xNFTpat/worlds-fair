import {dataInbox} from '../data-budget';
import { Pool, Venue, feeApr, num, hoursSince, isStockToken } from "../schema";
import { onchainFee, TokenCache } from "./dexpaprika";
import type {Candle,Series} from '../suggest';

// Keyless reads first. A durable counter caps all CoinGecko fallback attempts across Workers.
interface GeckoSettings {key?:string;cache?:KVNamespace;namespace?:DurableObjectNamespace}
let config:GeckoSettings={};
export function setGeckoKey(key?:string,cache?:KVNamespace,namespace?:DurableObjectNamespace){config={key,cache,namespace};}
const NETWORK='robinhood';
const pending=new Map<string,Promise<Response>>();
interface Win { m5?: string; h1?: string; h6?: string; h24?: string }
interface RawPool {
  id: string;
  attributes: {
    name: string;                  // "USDG / NVDA 0.05%"
    address: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    reserve_in_usd?: string;
    pool_created_at?: string;
    volume_usd?: Win;
    price_change_percentage?: Win;
    transactions?: Record<string, { buys: number; sells: number; buyers?: number; sellers?: number }>;
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}
interface RawToken { id: string; type: string; attributes: { address: string; symbol: string; name: string } }
interface Resp { observedAt?:string; data: RawPool[]; included?: RawToken[] }

const QUOTES = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);

function venueFor(dex: string): Venue {
  const d = dex.toLowerCase();
  if (d.includes("v4")) return "uniswap-v4";
  if (d.includes("v2")) return "uniswap-v2";
  return "uniswap-v3";
}
function feeFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) / 100 : null;
}

export async function getRaw(path:string,settingsOverride?:GeckoSettings):Promise<Response>{
  const settings={...(settingsOverride||config)},cacheKey='gecko-free-v2:'+path;
  const saved=await settings.cache?.get<{body:string;at:string}>(cacheKey,'json');
  if(saved)return new Response(saved.body,{headers:{'content-type':'application/json','x-lp-observed-at':saved.at,'x-lp-cache-hit':'1'}});
  if(pending.has(path))return (await pending.get(path)!).clone();
  const work=(async()=>{
    let r:Response;
    try{r=await globalThis.fetch('https://api.geckoterminal.com/api/v2'+path,{headers:{accept:'application/json;version=20230302'},signal:AbortSignal.timeout(12000)});}
    catch{r=new Response('Public chart provider unavailable',{status:503});}
    if(!r.ok&&[429,500,502,503,504].includes(r.status)&&settings.key&&settings.namespace){
      const reserved=await dataInbox(settings.namespace).fetch('https://data-budget/reserve',{method:'POST'});
      const permit=await reserved.json() as {allowed:boolean};
      if(reserved.ok&&permit.allowed){await r.body?.cancel();r=await globalThis.fetch('https://api.coingecko.com/api/v3/onchain'+path,{headers:{accept:'application/json','x-cg-demo-api-key':settings.key},signal:AbortSignal.timeout(12000)});}
    }
    if(!r.ok)return r;
    const body=await r.text();JSON.parse(body);const at=new Date().toISOString();
    await settings.cache?.put(cacheKey,JSON.stringify({body,at}),{expirationTtl:path.includes('/ohlcv/')?900:300});
    return new Response(body,{headers:{'content-type':'application/json','x-lp-observed-at':at}});
  })();
  pending.set(path,work);
  try{return (await work).clone();}finally{pending.delete(path);}
}
async function get(path: string): Promise<Resp> {
  const r = await getRaw(path);
  if (!r.ok) throw new Error(`geckoterminal ${r.status} ${path.split("?")[0]}`);
  return {...await r.json() as Resp,observedAt:r.headers.get('x-lp-observed-at')||new Date().toISOString()};
}

export async function fetchGeckoTerminal(
  minTvl: number,
  feeCache: TokenCache,
  pages = 2,
): Promise<{ pools: Pool[]; feeCache: TokenCache; partial: boolean }> {
  const inc = "include=base_token,quote_token,dex";
  const reqs: Promise<Resp>[] = [];
  for (let p = 1; p <= pages; p++) reqs.push(get(`/networks/${NETWORK}/pools?page=${p}&sort=h24_volume_usd_desc&${inc}`));
  reqs.push(get(`/networks/${NETWORK}/new_pools?page=1&${inc}`));
  reqs.push(get(`/networks/${NETWORK}/trending_pools?page=1&${inc}`));
  const results = await Promise.allSettled(reqs);

  const tokens = new Map<string, RawToken["attributes"]>();
  const seen = new Set<string>();
  const raws: { observedAt:string; pool: RawPool; trending: boolean; fresh: boolean }[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const t of r.value.included ?? []) if (t.type === "token") tokens.set(t.id, t.attributes);
    const fresh = i === pages, trending = i === pages + 1;
    for (const p of r.value.data ?? []) {
      if (seen.has(p.attributes.address)) { const e = raws.find((x) => x.pool.attributes.address === p.attributes.address); if (e) { e.trending ||= trending; e.fresh ||= fresh; } continue; }
      seen.add(p.attributes.address); raws.push({ pool: p, trending, fresh, observedAt:r.value.observedAt||new Date().toISOString() });
    }
  });
  if (!raws.length) {
    const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    const why = first ? String(first.reason?.message ?? first.reason) : "empty response";
    throw new Error(/429/.test(why) ? "geckoterminal rate-limited (30/min) — wait a minute before refreshing" : `geckoterminal: ${why}`);
  }

  const now = new Date().toISOString();
  const out: Pool[] = [];
  let budget = 8; // on-chain fee lookups per refresh for pools whose name lacks a tier
  for (const { pool: p, trending, fresh, observedAt } of raws) {
    const a = p.attributes;
    const t0 = tokens.get(p.relationships.base_token.data.id);
    const t1 = tokens.get(p.relationships.quote_token.data.id);
    const tvl = num(a.reserve_in_usd);
    if (tvl != null && tvl < minTvl) continue;
    // A 32-byte address is a V4 pool id whatever the DEX label says.
    const venue: Venue = /^0x[0-9a-fA-F]{64}$/.test(a.address) ? "uniswap-v4" : venueFor(p.relationships.dex.data.id);

    // Fee tier: from the name, else cached on-chain read, else read now (budgeted).
    let tier = feeFromName(a.name);
    const cached = feeCache[a.address]?.fee;
    if (tier == null && cached != null) tier = cached === -1 ? null : cached > 100 ? cached / 1e6 : cached / 100;
    if (tier == null && cached == null && budget > 0) {
      budget--;
      const f = await onchainFee(a.address);
      if (f != null) { feeCache[a.address] = { tokens: [], fee: f }; tier = f === -1 ? null : f / 1e6; }
    }
    const dynamic = cached === -1 || feeCache[a.address]?.fee === -1;

    const v1 = num(a.volume_usd?.h1) ?? 0, v6 = num(a.volume_usd?.h6) ?? 0, v24 = num(a.volume_usd?.h24) ?? 0;
    const fees24 = tier != null ? v24 * tier : null;
    const age = hoursSince(a.pool_created_at);
    const tx = a.transactions?.h24;
    const change = num(a.price_change_percentage?.h24);

    const tags: string[] = [];
    if (isStockToken(t0?.name) || isStockToken(t1?.name)) tags.push("stock-token");
    if (age != null && age < 72) tags.push("new");
    if (tvl != null && tvl < 25_000) tags.push("thin");
    if (trending) tags.push("trending");
    if (dynamic) tags.push("dynamic-fee");
    if (!t0 || !t1) tags.push("unresolved");
    // Fresh pools sometimes report nonsense prices → billions of TVL. Keep them visible but marked.
    if ((tvl != null && tvl > 200_000_000) || v24 > 1_000_000_000 || (tvl != null && tvl > 0 && v24 / tvl > 2000)) tags.push("suspect");

    const base = t0 && t1 && QUOTES.has(t0.symbol.toUpperCase()) && !QUOTES.has(t1.symbol.toUpperCase()) ? t1 : t0;
    out.push({
      id: `robinhood:${a.address}`,
      chain: "robinhood",
      venue,
      address: a.address,
      pair: t0 && t1 ? `${t0.symbol}/${t1.symbol}` : a.name.replace(/\s*\d+(\.\d+)?%$/, "").replace(/\s\/\s/, "/"),
      base: { address: t0?.address ?? "", symbol: t0?.symbol ?? "?" },
      quote: { address: t1?.address ?? "", symbol: t1?.symbol ?? "?" },
      tvlUsd: tvl,
      volume24hUsd: v24,
      fees24hUsd: fees24,
      feeTier: tier,
      feeApr: feeApr(fees24, tvl),
      priceUsd: num(a.base_token_price_usd),
      change24h: change != null ? change / 100 : null,
      ageHours: age,
      tags,
      url: base?.address ? `https://deltaliquidity.app/pools/${base.address}` : `https://www.geckoterminal.com/robinhood/pools/${a.address}`,
      fetchedAt: observedAt,
      feeSource: "estimated",
      feeTvl: tier != null && tvl
        ? { h1: (v1 * tier) / tvl, mid: (v6 * tier) / tvl, midHours: 6, h24: (v24 * tier) / tvl }
        : { h1: null, mid: null, midHours: 6, h24: null },
      txns24h: tx ? tx.buys + tx.sells : null,
      quotePriceUsd: num(a.quote_token_price_usd),
    });
  }
  return { pools: out, feeCache, partial: results.some(r => r.status === "rejected") };
}

// Hourly candles for the range test. GeckoTerminal returns [ts, o, h, l, c, v] rows, newest first.
export async function geckoCandles(poolAddress: string, hours = 168) {
  const r = await getRaw(`/networks/${NETWORK}/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=${Math.min(hours, 1000)}`);
  if (!r.ok) throw new Error(`geckoterminal ohlcv ${r.status}${r.status === 429 ? " (rate-limited, try again in a minute)" : ""}`);
  const j = (await r.json()) as { data: { attributes: { ohlcv_list: number[][] } } };
  return (j.data?.attributes?.ohlcv_list ?? [])
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

// Explicit token denomination avoids mixing USD candles with on-chain token-ratio ranges.
export async function getTokenCandles(pool: Pool, hours: number) {
  const network = pool.chain === 'solana' ? 'solana' : NETWORK;
  const r = await getRaw(`/networks/${network}/pools/${pool.address}/ohlcv/hour?aggregate=1&limit=${Math.min(hours,1000)}&currency=token&token=${encodeURIComponent(pool.base.address)}&include_empty_intervals=true`);
  if(!r.ok) throw new Error(`Chart provider returned HTTP ${r.status}`);
  const j = await r.json() as any;
  const addresses = [j.meta?.base?.address, j.meta?.quote?.address];
  const equal = (a: string, b: string) => network === 'solana' ? a === b : a?.toLowerCase() === b?.toLowerCase();
  if(!addresses.some(a=>equal(a,pool.base.address)) || !addresses.some(a=>equal(a,pool.quote.address))) throw new Error('Chart token identities could not be verified');
  const after=Date.now()/1000-hours*3600;
  return (j.data?.attributes?.ohlcv_list ?? []).map(([t,o,h,l,c,v]:number[])=>({t,o,h,l,c,v}))
    .filter((c:any)=>[c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)&&c.t>=after&&c.o>0&&c.l>0&&c.h>=c.l&&c.c>0)
    .sort((a:any,b:any)=>a.t-b.t);
}

export interface TokenCandleSeries extends Series {source:string;asOf:string|null;dataAsOf:string|null;cached:boolean;status:'available'|'stale'|'unavailable';note:string;requestedHours:number}
const candlePending=new Map<string,Promise<TokenCandleSeries>>();
function cleanCandles(rows:Candle[],hours:number):Candle[]{
 const now=Date.now()/1000,after=now-hours*3600,out=new Map<number,Candle>();
 for(const c of rows)if([c.t,c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.t>=after&&c.t<=now+60&&c.t>0&&c.o>0&&c.c>0&&c.l>0&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c)&&c.v>=0)out.set(c.t,c);
 return [...out.values()].sort((a,b)=>a.t-b.t);
}
function candleSeries(pool:Pool,candles:Candle[],hours:number,source:string,asOf:string|null,cached=false,status:TokenCandleSeries['status']='available',note=''):TokenCandleSeries{
 return {candles,chartUnit:`${pool.quote.symbol} per ${pool.base.symbol}`,timeframe:'1h',hours:1,requestedHours:hours,source,asOf,dataAsOf:candles.length?new Date(candles.at(-1)!.t*1000).toISOString():null,cached,status,note};
}
// Exact quote/base hourly reads only. No USD candles or another pool's history
// may be substituted into native price ranges.
export async function getTokenCandleSeries(pool:Pool,requestedHours:number,settingsOverride?:GeckoSettings):Promise<TokenCandleSeries>{
 const hours=Math.max(1,Math.min(1000,Math.ceil(requestedHours))),settings={...(settingsOverride||config)};
 const identity=`${pool.chain}:${pool.address}:${pool.base.address}:${pool.quote.address}`,name='token-candles:v1:'+identity;
 const saved=await settings.cache?.get<{at:string;series:TokenCandleSeries}>(name,'json').catch(()=>null);
 if(saved&&Date.now()-Date.parse(saved.at)<300000&&Date.parse(saved.at)<=Date.now()&&saved.series.requestedHours>=hours)return {...saved.series,candles:cleanCandles(saved.series.candles,hours),cached:true,requestedHours:hours};
 const pendingKey=identity+':'+hours;if(candlePending.has(pendingKey))return candlePending.get(pendingKey)!;
 const work=(async()=>{
  const errors:string[]=[];let series:TokenCandleSeries|null=null;
  try{
   const network=pool.chain==='solana'?'solana':NETWORK,path=`/networks/${network}/pools/${encodeURIComponent(pool.address)}/ohlcv/hour?aggregate=1&limit=${hours}&currency=token&token=${encodeURIComponent(pool.base.address)}&include_empty_intervals=true`,read=await getRaw(path,settings);
   if(!read.ok)throw Error('GeckoTerminal HTTP '+read.status);
   const body:any=await read.json(),addresses=[body.meta?.base?.address,body.meta?.quote?.address],equal=(a:unknown,b:string)=>typeof a==='string'&&(network==='solana'?a===b:a.toLowerCase()===b.toLowerCase());
   if(!addresses.some(a=>equal(a,pool.base.address))||!addresses.some(a=>equal(a,pool.quote.address)))throw Error('GeckoTerminal token identities could not be verified');
   const candles=cleanCandles((body.data?.attributes?.ohlcv_list||[]).filter((r:any)=>Array.isArray(r)&&r.length>=6).map(([t,o,h,l,c,v]:number[])=>({t,o,h,l,c,v})),hours);
   if(!candles.length)throw Error('GeckoTerminal returned no usable hourly candles');
   const asOf=read.headers.get('x-lp-observed-at')||new Date().toISOString(),age=Date.now()-Date.parse(asOf),stale=!Number.isFinite(age)||age<0||age>=300000;
   series=candleSeries(pool,candles,hours,'GeckoTerminal',asOf,!!read.headers.get('x-lp-cache-hit'),stale?'stale':'available',stale?'Saved provider candles; the original source read is older than five minutes.':'' );
  }catch(e){errors.push(e instanceof Error?e.message:'GeckoTerminal unavailable');}
  if(!series&&pool.chain==='solana'&&pool.venue==='meteora-dlmm'){
   try{
    const now=Math.floor(Date.now()/1000),query=new URLSearchParams({timeframe:'1h',start_time:String(now-hours*3600),end_time:String(now)}),read=await fetch(`https://dlmm.datapi.meteora.ag/pools/${encodeURIComponent(pool.address)}/ohlcv?${query}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!read.ok)throw Error('Meteora HTTP '+read.status);
    const body:any=await read.json();if(body.address&&body.address!==pool.address)throw Error('Meteora pool identity differs');
    const candles=cleanCandles((Array.isArray(body.data)?body.data:[]).map((r:any)=>({t:Number(r.timestamp)>1e12?Math.floor(Number(r.timestamp)/1000):Number(r.timestamp),o:Number(r.open),h:Number(r.high),l:Number(r.low),c:Number(r.close),v:Number(r.volume)})),hours);
    if(!candles.length)throw Error('Meteora returned no usable hourly candles');
    series=candleSeries(pool,candles,hours,'Meteora DLMM Data API',new Date().toISOString(),false,'available','GeckoTerminal unavailable; using exact-pool native quote/base hourly candles. Coverage may be partial. '+errors.join('; '));
   }catch(e){errors.push(e instanceof Error?e.message:'Meteora unavailable');}
  }
  if(series){
   const prior=saved?cleanCandles(saved.series.candles,hours):[];
   if(prior.some(c=>!series!.candles.some(latest=>latest.t===c.t))){series={...series,candles:cleanCandles([...prior,...series.candles],hours),cached:true,status:'stale',asOf:saved!.series.asOf,note:'Mixed observed history: saved hourly candles read '+saved!.series.asOf+' plus '+series.source+' refresh '+series.asOf+'. No missing intervals are filled. '+series.note};series.dataAsOf=series.candles.length?new Date(series.candles.at(-1)!.t*1000).toISOString():null;}
   try{await settings.cache?.put(name,JSON.stringify({at:series.asOf,series}),{expirationTtl:3*86400});}catch{}return series;
  }
  if(saved?.series.candles.length){const candles=cleanCandles(saved.series.candles,hours);if(candles.length)return {...saved.series,candles,requestedHours:hours,cached:true,status:'stale' as const,note:'Saved candles; providers could not refresh this history. Original read and candle dates are retained. '+errors.join('; ')};}
  return candleSeries(pool,[],hours,'Unavailable',null,false,'unavailable',errors.join('; '));
 })();candlePending.set(pendingKey,work);try{return await work;}finally{candlePending.delete(pendingKey);}
}
