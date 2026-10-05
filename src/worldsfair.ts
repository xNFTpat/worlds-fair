import legacyWorker from './index';
import type {Env} from './env';
import type {Pool, Snapshot} from './schema';
import {selectPools} from './discovery';
import {getSnapshot} from './refresh';
import {BackgroundScanner as LegacyBackgroundScanner} from './background-scanner';
import {worldsfairPaperRoute} from './worldsfair-paper';

export {WorldsfairRangeInbox as RangeInbox} from './worldsfair-paper';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});
const disabled = () => json({error: 'Paper demo only. Mainnet wallet actions and live transactions are disabled. Optional receipt signing is restricted to Solana devnet.', code: 'paper_only'}, 403);
const readPaths = new Set([
  '/api/version', '/api/pools', '/api/stats', '/api/pool-context', '/api/pool-lookup',
  '/api/pool-chart', '/api/suggest', '/api/check', '/api/research/pools', '/api/research/pool',
  '/api/positions', '/api/history', '/api/position-chart', '/api/position-break-even',
  '/api/wallet-intelligence', '/api/range-alerts', '/api/volume-alerts', '/api/data-budget',
  '/api/scanner/health', '/api/long-game', '/api/cesto',
  ...['paper-fleet', 'paper-lab', 'bot', 'active-lp'].flatMap(name =>
    ['', '/trades', '/scans', '/unscorable'].map(suffix => '/api/' + name + suffix)),
]);

/** Build a new data-only environment rather than forwarding unknown secrets. */
export function paperEnvironment(env: Env, includeOther = false): Env {
  return {
    LP_CACHE: env.LP_CACHE, ASSETS: env.ASSETS, RANGE_ALERTS: env.RANGE_ALERTS,
    BACKGROUND_SCANNER: env.BACKGROUND_SCANNER, MIN_TVL_USD: env.MIN_TVL_USD,
    ROBINHOOD_RPC: env.ROBINHOOD_RPC, ROBINHOOD_CHAIN_ID: env.ROBINHOOD_CHAIN_ID,
    WALLETS: includeOther ? env.WALLETS : '', SOLANA_RPC: env.SOLANA_RPC,
    JUPITER_API_KEY: env.JUPITER_API_KEY, GECKO_KEY: env.GECKO_KEY,
    CF_VERSION_METADATA: env.CF_VERSION_METADATA,
  };
}

// This deployment never supplies an execution object. The scanner only reads
// market data and updates this Worker's isolated paper journals and caches.
export class BackgroundScanner extends LegacyBackgroundScanner {
  constructor(state: DurableObjectState, env: Env) { super(state, paperEnvironment(env)); }
}

function canonicalPath(path: string): string | null {
  try {
    for (let i = 0; i < 4 && path.includes('%'); i++) path = decodeURIComponent(path);
    if (/[ %\\\0?#]/.test(path)) return null;
    return new URL(path.replace(/\/{2,}/g, '/'), 'https://paper.invalid').pathname;
  } catch { return null; }
}

function snapshotStats(snapshot: Snapshot) {
  const sane = snapshot.pools.filter(pool => !pool.tags.includes('suspect'));
  const sum = (pools: Pool[], pick: (pool: Pool) => number | null) => pools.reduce((total, pool) => total + (pick(pool) ?? 0), 0);
  const chain = (name: string) => {
    const pools = sane.filter(pool => pool.chain === name);
    return {
      pools: pools.length, feesKnown: pools.filter(pool => pool.fees24hUsd != null).length,
      estimatedFees: pools.filter(pool => pool.feeSource === 'estimated' || pool.chain === 'robinhood').length,
      stalePools: pools.filter(pool => Date.now() - Date.parse(pool.fetchedAt) > 900000).length,
      oldestRead: pools.length ? pools.map(pool => pool.fetchedAt).sort()[0] : null,
      coverage: 'Catalogued pools only; not whole-chain totals',
      volume24h: sum(pools, pool => pool.volume24hUsd),
      fees24h: pools.some(pool => pool.fees24hUsd != null) ? sum(pools, pool => pool.fees24hUsd) : null,
      tvl: sum(pools, pool => pool.tvlUsd),
    };
  };
  const best = (key: 'feeApr' | 'fees24hUsd') => sane.filter(pool => (pool.tvlUsd ?? 0) >= 25000 && pool[key] != null)
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))[0] ?? null;
  const stock = sane.filter(pool => pool.tags.includes('stock-token'));
  return {
    solana: chain('solana'), robinhood: chain('robinhood'),
    stockTokens: {pools: stock.length, volume24h: sum(stock, pool => pool.volume24hUsd), fees24h: sum(stock, pool => pool.fees24hUsd)},
    topFeeApr: best('feeApr'), topFees: best('fees24hUsd'),
    hottest1h: sane.filter(pool => pool.feeTvl?.h1 != null && (pool.tvlUsd ?? 0) >= 10000)
      .sort((a, b) => (b.feeTvl!.h1 ?? 0) - (a.feeTvl!.h1 ?? 0))[0] ?? null,
  };
}

async function fetchPaper(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(req.url), path = canonicalPath(url.pathname);
  if (path === null) return json({error: 'Invalid route.'}, 400);
  const lower = path.toLowerCase();
  if (['/media/pat-lp-replay-v2.mp4', '/media/replay-poster.png'].includes(lower))
    return json({error: 'Personal archive assets are not part of this public demo.'}, 404);
  // Deny before authentication, KV access, assets, or any legacy provider work.
  if (/^\/api\/(?:auth|paybox|solana|evm|tx|x|debug)(?:\/|$)/.test(lower)
      || lower === '/api/exit-preview'
      || /^\/(?:solana|phantom|owner-access)\.js(?:\/|$)/.test(lower)
      || /^\/(?:signing-frame|signing|paybox)(?:\/|$)/.test(lower)) return disabled();

  const includeOther = url.searchParams.get('includeOther') === '1';
  const safeEnv = paperEnvironment(env, includeOther);
  url.pathname = path;
  if (!path.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(req.method)) return json({error: 'Demo assets are read-only.'}, 405);
    if (path === '/paper-research.json') return json({paper: true, personal: {}, note: 'This separate demo contains no personal wallet research.'});
    return safeEnv.ASSETS ? safeEnv.ASSETS.fetch(new Request(url, req)) : json({error: 'Not found.'}, 404);
  }

  const paper = await worldsfairPaperRoute(new Request(url, req), safeEnv);
  if (paper) return paper;
  if (path === '/api/refresh') {
    if (req.method !== 'POST') return json({error: 'Use the demo refresh button.'}, 405);
    if (req.headers.get('origin') !== url.origin) return json({error: 'Open the demo to refresh market data.'}, 403);
    return legacyWorker.fetch(new Request(url, req), safeEnv, ctx);
  }
  if (!readPaths.has(path)) return json({error: 'This route is not available in the Paper demo.'}, 404);
  if (!['GET', 'HEAD'].includes(req.method)) return json({error: 'This demo endpoint is read-only.'}, 405);

  if (!includeOther) {
    const updatedAt = new Date().toISOString();
    if (path === '/api/positions') return json({paper: true, positions: [], balances: [], sources: {}, errors: {}, updatedAt});
    if (path === '/api/history') return json({paper: true, closed: [], open: [], totals: {}, errors: {}, robinhood: {}, historySources: {}, positionSources: {}, refreshing: false, updatedAt});
    if (path === '/api/range-alerts') return json({paper: true, state: {positions: {}, episodes: {}, lastCheckedAt: null}, events: [], sources: {}});
    if (['/api/wallet-intelligence', '/api/position-chart', '/api/position-break-even'].includes(path))
      return json({error: 'Personal wallets are hidden in the Paper demo.'}, 404);
    if ([url.searchParams.get('pool'), url.searchParams.get('id')].some(value => value?.startsWith('robinhood:')))
      return json({error: 'Other-chain research is hidden. Enable the optional research toggle to view it.'}, 404);
  }

  if (path === '/api/pools' || path === '/api/stats') {
    const saved = await getSnapshot(safeEnv);
    const snapshot = {...saved, pools: saved.pools.filter(pool => includeOther || pool.chain === 'solana')};
    if (path === '/api/stats') return json(snapshotStats(snapshot));
    try { return json({...snapshot, ...selectPools(snapshot.pools, url.searchParams), stats: snapshotStats(snapshot), paper: true}); }
    catch { return json({error: 'Check the pool filter values.'}, 400); }
  }
  // HEAD is evaluated as GET so legacy method checks remain read-only.
  const response = await legacyWorker.fetch(new Request(url, {method: 'GET', headers: req.headers}), safeEnv, ctx);
  if (path === '/api/long-game' && response.ok && !includeOther) {
    const data = await response.json() as {items?: {chain: string}[]};
    return json({...data, items: (data.items || []).filter(item => item.chain.toLowerCase() === 'solana')});
  }
  return response;
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const response = await fetchPaper(req, env, ctx);
    if (req.method !== 'HEAD') return response;
    return new Response(null, {status: response.status, headers: response.headers});
  },
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    return legacyWorker.scheduled(event, paperEnvironment(env), ctx);
  },
};
