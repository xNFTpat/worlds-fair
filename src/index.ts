import {PRIVATE_PAPER_RESEARCH} from './private-paper-research';
import {scannerInbox} from './scanner';
import {researchCatalogue,researchPool} from './lp-research';
import {poolContext} from './pool-context';
export {BackgroundScanner} from './background-scanner';
import {longGameData} from './long-game';
import {cachedHistory} from './history-cache';
import {dataInbox} from './data-budget';
import { fleetInbox } from './paper-fleet-runner';

import {lookupPool} from "./pool-lookup";
import {cestoData} from "./cesto";
import { selectPools } from "./discovery";
import { rangeInbox, volumeInbox } from './range-alerts';
import { paperInbox } from './paper-runner';
import { labInbox } from './paper-lab-runner';
export { RangeInbox } from './range-alerts';
import { payboxRoute } from "./paybox";
import { evmRoute } from './evm-execution';
import { ownerAuthRoute,ownerGuard,ownerRouteProtected } from './owner-auth';
import { versionInfo } from './version';
export { EvmExecution } from './evm-execution';
import { buildSolanaPreview, ownedSolanaPositions, verifyAndSubmit, connection as solanaConnection } from "../execution/solana";
import { poolChart, positionBounds } from "./charts";
import {readPositionBreakEven} from '../execution/position-analysis';
import { health, publicError } from "./health";
import { Pool, Snapshot } from "./schema";

import { TokenCache, lastRawRow, lastDetails } from "./sources/dexpaprika";

import { setGeckoKey } from "./sources/geckoterminal";

import { RH } from "./sources/uniswap-positions";
import { suggest, Series } from "./suggest";

import { fetchMeteoraHistory, rawPositionRecords } from "./sources/meteora-history";
import { robinhoodHistory, walletIntelligence } from "./robinhood-intelligence";
import { propose, buildBuyWithEth, buildOpenV3, previewCloseV3 } from "./executor";
import { sanityCheck } from "./sanity";
import { setRobinhoodRpc } from "./sources/uniswap-positions";

import type {Env} from './env';
export type {Env} from './env';
import { TOKEN_CACHE_KEY, POSITIONS_KEY, pickRobinhoodRpc, wallets, singleFlight, refresh, refreshPositions, getSnapshot, type PositionsPayload } from './refresh';

function stats(snap: Snapshot) {
  const sane = snap.pools.filter((p) => !p.tags.includes("suspect"));
  const by = (c: string) => sane.filter((p) => p.chain === c);
  const sum = (ps: Pool[], f: (p: Pool) => number | null) => ps.reduce((a, p) => a + (f(p) ?? 0), 0);
  const chain = (c: string) => {
    const ps = by(c);
    return {
      pools: ps.length,
      feesKnown:ps.filter(p=>p.fees24hUsd!=null).length,
      estimatedFees:ps.filter(p=>p.feeSource==='estimated'||p.chain==='robinhood').length,
      stalePools:ps.filter(p=>Date.now()-Date.parse(p.fetchedAt)>900000).length,
      oldestRead:ps.length?ps.map(p=>p.fetchedAt).sort()[0]:null,
      coverage:'Catalogued pools only; not whole-chain totals',
      volume24h: sum(ps, (p) => p.volume24hUsd),
      fees24h: ps.some(p=>p.fees24hUsd!=null)?sum(ps, (p) => p.fees24hUsd):null,
      tvl: sum(ps, (p) => p.tvlUsd),
    };
  };
  const stock = sane.filter((p) => p.tags.includes("stock-token"));
  const best = (ps: Pool[], k: keyof Pool, minTvl = 25_000) =>
    ps.filter((p) => (p.tvlUsd ?? 0) >= minTvl && p[k] != null).sort((a, b) => ((b[k] as number) ?? 0) - ((a[k] as number) ?? 0))[0] ?? null;
  return {
    solana: chain("solana"),
    robinhood: chain("robinhood"),
    stockTokens: { pools: stock.length, volume24h: sum(stock, (p) => p.volume24hUsd), fees24h: sum(stock, (p) => p.fees24hUsd) },
    topFeeApr: best(sane, "feeApr"),
    topFees: best(sane, "fees24hUsd"),
    hottest1h: [...sane].filter((p) => p.feeTvl?.h1 != null && (p.tvlUsd ?? 0) >= 10_000).sort((a, b) => (b.feeTvl!.h1 ?? 0) - (a.feeTvl!.h1 ?? 0))[0] ?? null,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if(!env.BACKGROUND_SCANNER)return;
    ctx.waitUntil(scannerInbox(env.BACKGROUND_SCANNER!).fetch('https://scanner/scanner/tick',{method:'POST'}).then(r=>{if(!r.ok)throw Error('Background scan incomplete');}));
  },

  async fetch(req: Request, env: Env, ctx?:ExecutionContext): Promise<Response> {
    const auth=await ownerAuthRoute(req,env);if(auth)return auth;
    const denied=await ownerGuard(req,env);if(denied)return denied;
    if(new URL(req.url).pathname==='/paper-research.json'){
      if(!['GET','HEAD'].includes(req.method))return json({error:'Portfolio research is read-only.'},405);
      return new Response(req.method==='HEAD'?null:JSON.stringify(PRIVATE_PAPER_RESEARCH),{headers:{'content-type':'application/json','cache-control':'no-store'}});
    }
    if(!new URL(req.url).pathname.startsWith('/api/')&&new URL(req.url).pathname!=='/paper-research.json'){
      if(!env.ASSETS)return json({error:'not found'},404);
      const asset=await env.ASSETS.fetch(req);
      if(!ownerRouteProtected(new URL(req.url).pathname,req.method))return asset;
      const headers=new Headers(asset.headers);headers.set('cache-control','private, no-store');headers.set('vary','Cookie, Authorization');return new Response(asset.body,{status:asset.status,headers});
    }
    if(new URL(req.url).pathname==='/api/version')return req.method==='GET'?json(await versionInfo(env)):json({error:'Version information is read-only.'},405);
    try{const paybox=await payboxRoute(req,env);if(paybox)return paybox;}catch{return json({error:"PayBox is unavailable. Check the existing request before trying again."},502);}
    const url = new URL(req.url);
    const evm=await evmRoute(req,env,()=>getSnapshot(env),async()=>(await pickRobinhoodRpc(env)).rpc);if(evm)return evm;
    setGeckoKey(env.GECKO_KEY,env.LP_CACHE,env.RANGE_ALERTS);
    if (/^\/api\/(tx\/|x\/|check|history|wallet-intelligence|refresh)/.test(url.pathname)) setRobinhoodRpc((await pickRobinhoodRpc(env)).rpc);
    const q = url.searchParams;

    if(url.pathname.startsWith('/api/research/')){
      if(req.method!=='GET')return json({error:'LP research is read-only.'},405);
      const snapshot=await getSnapshot(env);
      if(url.pathname==='/api/research/pools')return json(await researchCatalogue(snapshot,env,q));
      if(url.pathname==='/api/research/pool'){
        const pool=snapshot.pools.find(p=>p.id===q.get('id'));
        const sol='So11111111111111111111111111111111111111112';
        if(!pool||pool.venue!=='meteora-dlmm'||![pool.base.address,pool.quote.address].includes(sol))return json({error:'Choose a catalogued Meteora DLMM pool paired with native SOL.'},404);
        return json(await researchPool(pool,env));
      }
      return json({error:'Unknown research endpoint.'},404);
    }

    if(url.pathname==='/api/scanner/health'&&req.method==='GET'){
      if(!env.BACKGROUND_SCANNER)return json({error:'Background scanner unavailable'},503);
      return scannerInbox(env.BACKGROUND_SCANNER!).fetch('https://scanner/scanner/health');
    }
    if(url.pathname==='/api/scanner/control'){
      if(req.method!=='POST')return json({error:'Use a scanner control.'},405);
      if(req.headers.get('origin')!==url.origin)return json({error:'Use the terminal to control its scanner.'},403);
      if(!env.BACKGROUND_SCANNER)return json({error:'Background scanner unavailable'},503);
      let input:any;try{input=await req.json();}catch{return json({error:'Invalid control.'},400);}
      if(!['start','stop'].includes(input?.action))return json({error:'Unknown control.'},400);
      return scannerInbox(env.BACKGROUND_SCANNER!).fetch('https://scanner/scanner/'+input.action,{method:'POST'});
    }
    if(url.pathname==='/api/data-budget'&&req.method==='GET')return env.RANGE_ALERTS?dataInbox(env.RANGE_ALERTS).fetch('https://data-budget/budget'):json({error:'Budget tracker unavailable'},503);
    if(url.pathname==='/api/paper-fleet/control'){
      if(req.method!=='POST')return json({error:'Use a paper control.'},405);
      if(req.headers.get('origin')!==url.origin)return json({error:'Use the terminal to control the lab.'},403);
      if(!env.RANGE_ALERTS)return json({error:'Paper wallet journal unavailable.'},503);
      let input:any;try{input=await req.json();}catch{return json({error:'Invalid control.'},400);}
      if(!['pause','resume','stop'].includes(input?.action))return json({error:'Unknown control.'},400);
      return fleetInbox(env.RANGE_ALERTS).fetch('https://paper-fleet/fleet/control',{method:'POST',body:JSON.stringify({action:input.action})});
    }
    if(['/api/paper-fleet','/api/paper-fleet/trades','/api/paper-fleet/scans','/api/paper-fleet/unscorable'].includes(url.pathname)){
      if(req.method!=='GET')return json({error:'Paper wallet results are read-only.'},405);
      if(!env.RANGE_ALERTS)return json({error:'Paper wallet journal unavailable.'},503);
      const suffix=url.pathname.endsWith('/trades')?'/trades':url.pathname.endsWith('/scans')?'/scans':url.pathname.endsWith('/unscorable')?'/unscorable':'';
      try{return await fleetInbox(env.RANGE_ALERTS).fetch('https://paper-fleet/fleet'+suffix+'?'+new URLSearchParams({cursor:q.get('cursor')||''}));}catch{return json({error:'Paper wallet results unavailable. Existing records have not been reset.'},503);}
    }

    if(url.pathname==='/api/paper-lab/control'){
      if(req.method!=='POST')return json({error:'Use a lab control.'},405);
      if(req.headers.get('origin')!==url.origin)return json({error:'Use the terminal to control the lab.'},403);
      if(!env.RANGE_ALERTS)return json({error:'Lab journal unavailable.'},503);
      let input:any;try{input=await req.json();}catch{return json({error:'Invalid control.'},400);}
      if(!['pause','resume','stop'].includes(input?.action))return json({error:'Unknown control.'},400);
      return labInbox(env.RANGE_ALERTS).fetch('https://paper-lab/lab/control',{method:'POST',body:JSON.stringify({action:input.action})});
    }
    if(['/api/paper-lab','/api/paper-lab/trades','/api/paper-lab/scans','/api/paper-lab/unscorable'].includes(url.pathname)){
      if(req.method!=='GET')return json({error:'Lab results are read-only.'},405);
      if(!env.RANGE_ALERTS)return json({error:'Lab journal unavailable.'},503);
      const suffix=url.pathname.endsWith('/trades')?'/trades':url.pathname.endsWith('/scans')?'/scans':url.pathname.endsWith('/unscorable')?'/unscorable':'';
      try{return await labInbox(env.RANGE_ALERTS).fetch('https://paper-lab/lab'+suffix+'?'+new URLSearchParams({cursor:q.get('cursor')||''}));}catch{return json({error:'Lab results unavailable. Existing records have not been reset.'},503);}
    }

    if(url.pathname==='/api/bot/control'||url.pathname==='/api/active-lp/control'){
      const samples=url.pathname.startsWith('/api/active-lp');
      if(req.method!=='POST')return json({error:'Use a paper control.'},405);
      if(req.headers.get('origin')!==url.origin)return json({error:'Use the terminal to control Pat Bot.'},403);
      if(!env.RANGE_ALERTS)return json({error:'Paper journal unavailable.'},503);
      let input:any;try{input=await req.json();}catch{return json({error:'Invalid control.'},400);}
      if(!['pause','resume','stop'].includes(input?.action))return json({error:'Unknown control.'},400);
      return paperInbox(env.RANGE_ALERTS,samples).fetch('https://paper-bot'+(samples?'/samples':'/bot')+'/control',{method:'POST',body:JSON.stringify({action:input.action})});
    }

    if(['/api/bot','/api/bot/trades','/api/bot/scans','/api/active-lp','/api/active-lp/trades','/api/active-lp/scans','/api/active-lp/unscorable'].includes(url.pathname)){
      const samples=url.pathname.startsWith('/api/active-lp');
      if(req.method!=='GET')return json({error:'Paper results are read-only.'},405);
      if(!env.RANGE_ALERTS)return json({error:'The paper journal is not configured.'},503);
      try{const archive=url.pathname.endsWith('/trades')?'trades':url.pathname.endsWith('/scans')?'scans':url.pathname.endsWith('/unscorable')?'unscorable':null;return await paperInbox(env.RANGE_ALERTS,samples).fetch('https://paper-bot'+(samples?'/samples':'/bot')+(archive?'/'+archive+'?'+new URLSearchParams({cursor:q.get('cursor')||''}):''));}
      catch{return json({error:'Pat Bot results are temporarily unavailable. No paper balances have been reset.'},503);}
    }

    if(url.pathname==='/api/pool-lookup') {
      if(req.method!=='GET')return json({error:'Read-only endpoint.'},405);
      const address=q.get('address')||'';
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json({error:'Paste a valid Solana pool address.'},400);
      try {
        const key='pool-lookup:v1:'+address;
        const cached=await env.LP_CACHE.get(key,'json');if(cached)return json(cached);
        const result=await singleFlight(env,key,()=>lookupPool(address,env.SOLANA_RPC||'https://api.mainnet-beta.solana.com'));
        await env.LP_CACHE.put(key,JSON.stringify(result),{expirationTtl:60});return json(result);
      }catch(e){return json({error:publicError(e)},400);}
    }
    if(url.pathname==='/api/volume-alerts') {
      if(req.method!=='GET')return json({error:'Read-only endpoint.'},405);
      if(!env.RANGE_ALERTS)return json({error:'The volume inbox is not configured.'},503);
      try{return await volumeInbox(env.RANGE_ALERTS).fetch('https://volume-inbox/volume');}
      catch{return json({error:'The volume inbox is temporarily unavailable.'},503);}
    }
    if(url.pathname==='/api/range-alerts') {
      if(req.method!=='GET')return json({error:'Read-only endpoint.'},405);
      if(!env.RANGE_ALERTS)return json({error:'The alert inbox is not configured.'},503);
      try {return await rangeInbox(env.RANGE_ALERTS).fetch('https://range-inbox/state');}
      catch {return json({error:'The alert inbox is temporarily unavailable.'},503);}
    }

    if(url.pathname==='/api/long-game'&&req.method==='GET')return json(await longGameData(env.LP_CACHE,q.get('refresh')==='1'));
    if(url.pathname==='/api/cesto'&&req.method==='GET'){
      try{return json(await cestoData(env.LP_CACHE,q.get('basket'),q.get('refresh')==='1'));}
      catch{return json({error:'Cesto data is unavailable. Try again later; no holdings or performance have been set to zero.'},502);}
    }

    if (url.pathname === "/api/solana/preview" && req.method === "POST") {
      if (req.headers.get("origin") !== (env.PREVIEW_ORIGIN || url.origin)) return json({error:"Open the terminal to request a preview."},403);
      if (Number(req.headers.get("content-length") || 0)>8192) return json({error:"Request too large."},413);
      try {
        const raw=await req.text();
        if(raw.length>8192)return json({error:"Request too large."},413);
        const body=JSON.parse(raw);
        let preview,publicRpc=!env.SOLANA_RPC;
        try{preview=await buildSolanaPreview(body,env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',env.JUPITER_API_KEY);}
        catch(e){if(!/429|rate.?limit/i.test(String(e)))throw e;publicRpc=true;preview=await buildSolanaPreview(body,'https://api.mainnet-beta.solana.com',env.JUPITER_API_KEY);}
        const previewId=crypto.randomUUID();
        await env.LP_CACHE.put('solana:preview:'+previewId,JSON.stringify({owner:preview.owner,messageHex:preview.messageHex,expiresAt:preview.expiresAt,publicRpc}),{expirationTtl:120});
        return json({...preview,previewId});
      } catch(e) {return json({error:publicError(e)},400);}
    }
    if (url.pathname === "/api/solana/send" && req.method === "POST") {
      if(req.headers.get('origin')!==(env.PREVIEW_ORIGIN||url.origin))return json({error:'Use the terminal to submit.'},403);
      try {
        const raw=await req.text();if(raw.length>12000)return json({error:'Request too large.'},413);
        const body=JSON.parse(raw);
        const preview=await env.LP_CACHE.get<{messageHex:string;expiresAt:number;publicRpc?:boolean}>('solana:preview:'+String(body.previewId),'json');
        if(!preview)return json({error:'Review this transaction again.'},400);
        const signature=await verifyAndSubmit(preview.publicRpc?'https://api.mainnet-beta.solana.com':env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',body.signedTransactionBase64,preview);
        return json({signature});
      }catch(e){return json({error:publicError(e)},400);}
    }
    if (url.pathname === "/api/solana/owned") {
      try{let positions;try{positions=await ownedSolanaPositions(env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',q.get('owner')||'',q.get('pool')||'');}catch(e){if(!/429|rate.?limit/i.test(String(e)))throw e;positions=await ownedSolanaPositions('https://api.mainnet-beta.solana.com',q.get('owner')||'',q.get('pool')||'');}return json({positions});}catch(e){return json({error:publicError(e)},400);}
    }
    if (url.pathname === "/api/solana/status") {
      const signature=q.get("signature") || "";
      if(!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))return json({error:"Invalid signature."},400);
      try {
        const status=async(rpc:string)=>{const c=solanaConnection(rpc);const [result,blockHeight]=await Promise.all([c.getSignatureStatuses([signature],{searchTransactionHistory:true}),c.getBlockHeight()]);return {status:result.value[0],blockHeight};};
        try{return json(await status(env.SOLANA_RPC||'https://api.mainnet-beta.solana.com'));}catch(e){if(!/429|rate.?limit/i.test(String(e)))throw e;return json(await status('https://api.mainnet-beta.solana.com'));}
      }catch(e){return json({error:publicError(e)},502);}
    }

    if (url.pathname === "/api/exit-preview") {
      const saved = await env.LP_CACHE.get<PositionsPayload>("positions:v1", "json");
      const position = saved?.positions.find(p => p.id === q.get("id"));
      const wallet = wallets(env).find(w => w.name === position?.wallet);
      if (!position || !wallet || position.chain !== "robinhood" || position.venue !== "uniswap-v3") return json({error: "Exit preview supports tracked Robinhood V3 positions for now."}, 400);
      try {
        setRobinhoodRpc((await pickRobinhoodRpc(env)).rpc);
        const result = await previewCloseV3(BigInt(position.id.split(":").at(-1)!), wallet.address);
        return new Response(JSON.stringify(result), {headers: {"content-type":"application/json", "cache-control":"no-store"}});
      } catch (e) { return json({error: publicError(e)}, 502); }
    }

    if (url.pathname === '/api/pool-context') {
      if(req.method!=='GET')return json({error:'Pool context is read-only.'},405);
      const result=poolContext(await getSnapshot(env),q.get('pool')||'',q.get('token')||undefined);
      return result?json(result):json({error:'This pool or token is outside the saved catalogue.'},404);
    }
    if (url.pathname === "/api/pools") {
      const snap = await getSnapshot(env);
      try { return json({ ...snap, ...selectPools(snap.pools, q), stats: stats(snap) }); }
      catch(e) { return json({ error: publicError(e) },400); }
    }

    if (url.pathname === "/api/stats") return json(stats(await getSnapshot(env)));

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      const snap = await refresh(env);
      if(ctx&&env.BACKGROUND_SCANNER)ctx.waitUntil(scannerInbox(env.BACKGROUND_SCANNER!).fetch('https://scanner/scanner/tick',{method:'POST',headers:{'x-trigger':'refresh'}}));
      return json({ ok: true, count: snap.pools.length, errors: snap.errors, updatedAt: snap.updatedAt });
    }

    if (url.pathname === "/api/positions") {
      const force = q.get("refresh") === "1";
      const cached = force ? null : await env.LP_CACHE.get<PositionsPayload>(POSITIONS_KEY, "json");
      return json(cached ?? (await refreshPositions(env)));
    }

    if (url.pathname === "/api/pool-chart") {
      const snap = await getSnapshot(env);
      const pool = snap.pools.find(p=>p.id===q.get("pool"));
      if(!pool) return json({error:"Unknown pool"},404);
      const days = Math.min(30,Math.max(1,Number(q.get("days"))||7));
      try {
        return json(await poolChart(pool,days,env));
      } catch(e){return json({error:publicError(e)},502);}
    }
    // Range backtest + suggestion. Read-only.
    if (url.pathname === "/api/suggest") {
      const id = q.get("pool");
      const amount = parseFloat(q.get("amountUsd") ?? "40");
      const days = Math.min(30, Math.max(1, parseInt(q.get("days") ?? "7")));
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.id === id);
      if (!pool) return json({ error: "unknown pool" }, 404);
      if(pool.chain==='solana'&&pool.venue!=='meteora-dlmm')return json({error:'DLMM strategy comparisons apply only to Meteora DLMM. This venue has a different liquidity model.'},400);
      try {
        const series = {...await poolChart(pool, days,env), hours:1};
        return json({...suggest(pool, series, amount, days), chartUnit:series.chartUnit});
      } catch (e: any) {
        return json({ error: String(e?.message ?? e), pool: pool.id }, 502);
      }
    }

    // Swap sanity check: bytecode scan, simulated transfer, round-trip quote. Read-only.
    if (url.pathname === "/api/check") {
      const id = q.get("pool");
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.id === id);
      if (!pool) return json({ error: "unknown pool" }, 404);
      const evm = wallets(env).find((w) => w.address.startsWith("0x"))?.address ?? "0x0000000000000000000000000000000000000001";
      const solRpc = env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
      try { return json(await sanityCheck(pool, evm, solRpc)); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }, 502); }
    }

    if (url.pathname.startsWith("/api/x/")) {
      return json({error:'URL-key aliases are disabled. Unlock the terminal with the owner login.'},410);
    }

    // ── Execution ──────────────────────────────────────────────────────────────
    // Build an unsigned swap. Returns the exact transaction for Paybox to sign; never signs.
    if (url.pathname === "/api/tx/buy") {
      const id = q.get("pool");
      const amountEth = parseFloat(q.get("amountEth") ?? "0.004");
      const slippageBps = parseInt(q.get("slippageBps") ?? "100");
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.id === id);
      if (!pool) return json({ error: "unknown pool" }, 404);
      const evm = wallets(env).find((w) => w.address.startsWith("0x"));
      if (!evm) return json({ error: "no EVM wallet configured in WALLETS" }, 400);
      if (!(amountEth > 0) || amountEth > 0.05) return json({ error: "amountEth must be between 0 and 0.05 while we're testing" }, 400);
      try {
        const plan = await buildBuyWithEth(pool, evm.address, amountEth, slippageBps);
        const planId = crypto.randomUUID().slice(0, 8);
        await env.LP_CACHE.put(`plan:${planId}`, JSON.stringify(plan), { expirationTtl: 900 });
        return json({ planId, ...plan });
      } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
    }
    // Build an unsigned position open (approve + mint) for a V3 WETH pair.
    if (url.pathname === "/api/tx/open") {
      const id = q.get("pool");
      const tokenAmount = q.get("tokenAmount") ? parseFloat(q.get("tokenAmount")!) : null;
      const rangePct = parseFloat(q.get("rangePct") ?? "0.10");
      const maxEth = parseFloat(q.get("maxEth") ?? "0.01");
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.id === id);
      if (!pool) return json({ error: "unknown pool" }, 404);
      const evm = wallets(env).find((w) => w.address.startsWith("0x"));
      if (!evm) return json({ error: "no EVM wallet configured" }, 400);
      if (!(rangePct > 0.005 && rangePct <= 1)) return json({ error: "rangePct must be between 0.005 and 1" }, 400);
      if (!(maxEth > 0 && maxEth <= 0.05)) return json({ error: "maxEth must be between 0 and 0.05 while testing" }, 400);
      try {
        const plan = await buildOpenV3(pool, evm.address, tokenAmount, rangePct, maxEth);
        const planId = crypto.randomUUID().slice(0, 8);
        await env.LP_CACHE.put(`plan:${planId}`, JSON.stringify(plan), { expirationTtl: 900 });
        return json({ planId, ...plan });
      } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
    }
    // Look up a pool by pair text (e.g. "AI/WETH") so a chat request doesn't need the pool id.
    if (url.pathname === "/api/tx/find") {
      const pair = (q.get("pair") ?? "").toUpperCase().replace(/\s/g, "");
      const snap = await getSnapshot(env);
      const hits = snap.pools.filter((p) => p.chain === "robinhood" && p.venue === "uniswap-v3" &&
        (p.pair.toUpperCase() === pair || p.pair.toUpperCase().split("/").reverse().join("/") === pair));
      return json({ pools: hits.map((p) => ({ id: p.id, pair: p.pair, venue: p.venue, tvlUsd: p.tvlUsd, feeTier: p.feeTier, volume24hUsd: p.volume24hUsd })) });
    }
    if (url.pathname === "/api/tx/plan") {
      const plan = await env.LP_CACHE.get(`plan:${q.get("id")}`, "json");
      return plan ? json(plan) : json({ error: "plan expired or unknown" }, 404);
    }
    if (url.pathname === "/api/tx/broadcast") {
      return json({error:'Legacy unbound broadcast is disabled. Use the current PayBox preview, sign and send flow.'},410);
    }

    if(url.pathname==='/api/wallet-intelligence'){
      const saved=wallets(env).find(w=>w.address.startsWith('0x'));
      const address=q.get('address')||saved?.address;
      if(!address||!/^0x[0-9a-fA-F]{40}$/.test(address))return json({error:'Enter a valid Robinhood wallet address.'},400);
      const w={address,name:saved?.address.toLowerCase()===address.toLowerCase()?saved.name:'Research wallet'};
      try{return json(await singleFlight(env,'intel:'+address.toLowerCase(),()=>walletIntelligence(env.LP_CACHE,w,RH.rpc,q.get('refresh')==='1')));}
      catch{return json({error:'Robinhood wallet activity is unavailable. Try refreshing shortly.'},503);}
    }
    // Historical USD P&L is kept separate from verified token-unit LP events.
    if (url.pathname === "/api/history") {
      const out: any = { closed: [], open: [], totals: {}, errors: {} as Record<string, string>, updatedAt: new Date().toISOString() };
      const currentH = await env.LP_CACHE.get<PositionsPayload>(POSITIONS_KEY, "json");
      out.open = currentH?.positions ?? [];
      out.positionsUpdatedAt = currentH?.updatedAt ?? null;
      out.positionSources = currentH?.sources ?? {};
      out.robinhood={};out.historySources={};out.refreshing=false;
      for (const w of wallets(env)) out.totals[w.name] = { deposits: null, withdrawals: null, fees: null, pnl: null, positions: null, note: w.address.startsWith("0x") ? "Robinhood token history is available below. Historical USD P&L is not yet available." : "Lifetime totals unavailable from Meteora. Try refreshing history." };
      await Promise.all(wallets(env).map(async w => {
        if (w.address.startsWith("0x")) {
          try {
            const h=await cachedHistory(env.LP_CACHE,'rh:'+w.address,()=>robinhoodHistory(env.LP_CACHE,w,RH.rpc,q.get('refresh')==='1'),ctx,q.get('refresh')==='1');
            out.historySources[w.name]={readAt:h.readAt,stale:h.stale,refreshing:h.refreshing};out.refreshing ||= h.refreshing;
            out.closed.push(...h.closed);out.robinhood[w.name]=h;
            out.totals[w.name].positions=h.complete?h.closed.length:null;
            out.totals[w.name].note=`Uniswap V3 · ${h.status==='stale'?'saved':h.complete?'wallet transactions indexed':'partial coverage'}. Token amounts below; historical USD P&L unavailable.`;
            if(h.errors.length)out.errors[`robinhood:${w.name}`]=h.errors.join(' ');
          }
          catch (e: any) { out.errors[`robinhood:${w.name}`] = String(e?.message ?? e); }
          return;
        }
        try { const h = await cachedHistory(env.LP_CACHE,'sol:'+w.address,()=>fetchMeteoraHistory(w,365,env.LP_CACHE),ctx,q.get('refresh')==='1'); out.historySources[w.name]={readAt:h.readAt,stale:h.stale,refreshing:h.refreshing};out.refreshing ||= h.refreshing; out.closed.push(...h.closed); if (h.totals) out.totals[w.name] = h.totals; if (h.errors.length) out.errors[`meteora:${w.name}`] = h.errors.join(" · "); }
        catch (e: any) { out.errors[`meteora:${w.name}`] = String(e?.message ?? e); }
      }));
      // Sort groups by their latest close, keep each group's positions directly under it.
      const groups = new Map<string, any[]>();
      for (const r of out.closed) { const k = `${r.wallet}:${r.groupKey ?? r.positionAddress ?? r.pair}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
      const ordered = [...groups.values()].sort((a, b) => {
        const la = Math.max(...a.map((x: any) => Date.parse(x.closedAt ?? 0) || 0)), lb = Math.max(...b.map((x: any) => Date.parse(x.closedAt ?? 0) || 0));
        return lb - la;
      }).flatMap((g) => g.sort((a: any, b: any) => (a.isGroup ? -1 : b.isGroup ? 1 : (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))));
      out.closed = ordered;
      return json(out);
    }
    // Raw Meteora per-position record, to check field names: /api/debug/meteora-pnl/<pool>
    if (url.pathname.startsWith("/api/debug/meteora-pnl/")) {
      const pool = url.pathname.split("/").pop()!;
      const sol = wallets(env).find((w) => !w.address.startsWith("0x"));
      return json(sol ? await rawPositionRecords(pool, sol.address) : { error: "no solana wallet" });
    }

    // Separate read-only estimate so a slow RPC never hides the candles.
    if(url.pathname === '/api/position-break-even') {
      if(req.method!=='GET')return json({error:'Read-only endpoint'},405);
      const id=q.get('id');
      const cached=await env.LP_CACHE.get<PositionsPayload>(POSITIONS_KEY,'json');
      const pos=cached?.positions.find(p=>p.id===id);
      if(!pos)return json({error:'Unknown position'},404);
      if(pos.chain!=='solana'||pos.venue!=='meteora-dlmm')return json({status:'unavailable',price:null,note:'Historical USD pricing and position modelling are not available for this chain yet.'});
      const key=`break-even:v1:${pos.id}:${pos.fetchedAt}`;
      return json(await singleFlight(env,key,async()=>{
        const saved=q.get('refresh')==='1'?null:await env.LP_CACHE.get(key,'json');if(saved)return saved;
        try{
          const result=await readPositionBreakEven(pos,env.SOLANA_RPC||'https://api.mainnet-beta.solana.com');
          await env.LP_CACHE.put(key,JSON.stringify(result),{expirationTtl:60});return result;
        }catch(e){return {status:'unavailable',price:null,note:publicError(e)};}
      }));
    }

    // Candles + range for one open position, for the unified chart.
    if (url.pathname === "/api/position-chart") {
      const id = q.get("id");
      const days = Math.min(30, Math.max(1, parseInt(q.get("days") ?? "7")));
      const cached = await env.LP_CACHE.get<PositionsPayload>(POSITIONS_KEY, "json");
      const pos = (cached ?? (await refreshPositions(env))).positions.find((x) => x.id === id);
      if (!pos) return json({ error: "unknown position" }, 404);
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.chain===pos.chain && (p.chain==='solana'?p.address===pos.poolAddress:p.address.toLowerCase() === pos.poolAddress.toLowerCase()))
        ?? ({ id: `${pos.chain}:${pos.poolAddress}`, chain: pos.chain, venue: pos.venue, address: pos.poolAddress, pair: pos.pair,
              base: { address: "", symbol: pos.pair.split("/")[0] }, quote: { address: "", symbol: pos.pair.split("/")[1] },
              tvlUsd: null, volume24hUsd: 0, fees24hUsd: null, feeTier: null, feeApr: null, priceUsd: null, change24h: null,
              ageHours: null, tags: [], url: pos.url, fetchedAt: "", feeTvl: null, txns24h: null } as Pool);
      try {
        const chart = await poolChart(pool,days,env);
        return json({...chart, bounds:positionBounds(pos,pool)});
      } catch (e: any) { return json({ position: pos, error: String(e?.message ?? e), candles: [] }, 200); }
    }

    if (url.pathname === "/api/propose") {
      const id = q.get("pool");
      const amount = parseFloat(q.get("amountUsd") ?? "25");
      const snap = await getSnapshot(env);
      const pool = snap.pools.find((p) => p.id === id);
      if (!pool) return json({ error: "unknown pool" }, 404);
      return json(propose(pool, amount));
    }

    if (url.pathname === "/api/debug/dexpaprika") {
      const cache = (await env.LP_CACHE.get<TokenCache>(TOKEN_CACHE_KEY, "json")) ?? {};
      const withFee = Object.values(cache).filter((c) => c.fee != null).length;
      return json({ lastRawRow, lastDetails, cached: Object.keys(cache).length, cachedWithFee: withFee });
    }

    return json({ error: "not found" }, 404);
  },
};
