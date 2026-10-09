import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'worldsfair-boundary-'));
await build({entryPoints: ['src/worldsfair.ts'], outfile: join(dir, 'worldsfair.mjs'), bundle: true,
  platform: 'node', format: 'esm', mainFields: ['main'],
  banner: {js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const {default: worker, paperEnvironment, ...exports} = await import(join(dir, 'worldsfair.mjs'));
const origin = 'https://paper.test';
let reads = 0, writes = 0, assets = 0, providers = 0;
const store = new Map();
const env = {
  LP_CACHE: {get: async key => {reads++; return store.get(key) ?? null;}, put: async () => {writes++;}},
  ASSETS: {fetch: async request => {assets++; return new Response('asset ' + new URL(request.url).pathname);}},
  MIN_TVL_USD: '5000', WALLETS: 'Sol:fixture-wallet,Other:0x0000000000000000000000000000000000000001',
  TX_KEY: 'synthetic-owner-key', PREVIEW_ORIGIN: 'https://live.test',
  EVM_EXECUTION: {get() {throw Error('Execution must never be forwarded');}},
  PRIVATE_KEY: 'synthetic-private-key', OWNER_SECRET: 'synthetic-owner-secret',
};
const request = (path, method = 'GET', headers = {}) => new Request(origin + path, {method, headers});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {providers++; throw Error('No live provider calls permitted in boundary tests');};
try {
  const paths = [
    '/api/solana/send', '/api/solana/preview', '/api/solana/owned', '/api/solana/status',
    '/api/evm/send', '/api/evm/preview', '/api/evm/status', '/api/tx/buy', '/api/tx/open',
    '/api/tx/plan', '/api/tx/broadcast', '/api/x/key/positions', '/api/paybox/connect',
    '/api/paybox/callback?code=fixture', '/api/paybox/mcp', '/api/paybox/status',
    '/api/auth/login', '/api/auth/status', '/api/auth/logout', '/api/exit-preview',
    '/api/debug/dexpaprika', '/api/%73olana/send', '/api/%2570aybox/mcp', '/api//evm/send',
    '/API/SOLANA/SEND', '/solana.js', '/phantom.js', '/owner-access.js', '/signing-frame/index.html',
    '/nested%2f..%2fsolana.js', '/nested%2f..%2fapi%2fsolana%2fsend',
  ];
  for (const path of paths) for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
    const response = await worker.fetch(request(path, method, {origin, 'x-terminal-key': env.TX_KEY}), env);
    assert.equal(response.status, 403, method + ' ' + path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  for (const path of ['/api/future-send', '/api/scanner/control', '/api/paper-fleet/control', '/api/active-lp/control'])
    assert.equal((await worker.fetch(request(path, 'POST', {origin}), env)).status, 404, 'Unlisted routes fail closed');
  for (const path of ['/media/pat-lp-replay-v2.mp4','/MEDIA/REPLAY-POSTER.PNG','/media/%2570at-lp-replay-v2.mp4','/media/replay-poster.png?includeOther=1']) for(const method of ['GET','HEAD'])
    assert.equal((await worker.fetch(request(path,method,{origin,'x-terminal-key':env.TX_KEY}), env)).status, 404, 'Personal archive media stays private even with the reference toggle and owner header');
  for(const path of ['/brand/still-mark.svg','/product.css','/product-brand.js'])
    assert.equal((await worker.fetch(request(path,'POST',{origin}),env)).status,405,'Public brand assets remain read-only');
  for (const path of ['/api/pools', '/api/cesto', '/api/research/pool', '/api/positions', '/api/history', '/api/still/pools', '/api/still/preflight', '/api/baskets', '/api/still/basket-preflight'])
    assert.equal((await worker.fetch(request(path, 'POST', {origin}), env)).status, 405, 'Read-only routes reject mutation methods');
  for (const headers of [{}, {origin: 'https://other.test'}])
    assert.equal((await worker.fetch(request('/api/refresh', 'POST', headers), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/refresh'), env)).status, 405);
  assert.deepEqual({reads, writes, assets, providers}, {reads: 0, writes: 0, assets: 0, providers: 0}, 'Denied requests stop before any side effects');

  const safe = paperEnvironment(env);
  for (const field of ['TX_KEY', 'PREVIEW_ORIGIN', 'EVM_EXECUTION', 'PRIVATE_KEY', 'OWNER_SECRET'])
    assert.equal(field in safe, false, field + ' is never forwarded');
  assert.equal(safe.WALLETS, '');
  assert.equal(paperEnvironment(env, true).WALLETS, env.WALLETS);
  assert.equal('EvmExecution' in exports, false, 'Demo exports no financial durable object');
  assert.ok(exports.RangeInbox && exports.BackgroundScanner);

  const now = new Date().toISOString();
  const pool = (chain, id, volume, fees) => ({id: chain + ':' + id, address: id, chain, venue: chain === 'solana' ? 'meteora-dlmm' : 'uniswap-v3',
    pair: id + '/SOL', base: {address: id, symbol: id}, quote: {address: 'SOL', symbol: 'SOL'},
    tvlUsd: 50000, volume24hUsd: volume, fees24hUsd: fees, feeApr: fees / 50000 * 365,
    fetchedAt: now, tags: [], feeTvl: {h1: fees / 50000}, ageHours: 48});
  const sol = pool('solana', 'SOLPOOL', 1000, 100), other = pool('robinhood', 'OTHERPOOL', 2000, 300);
  store.set('snapshot:v1', {pools: [sol, other], updatedAt: now, errors: {}, sources: {}});
  store.set('positions:v1', {positions: [{id: 'personal'}], balances: [{wallet: 'private'}], updatedAt: now});
  let response = await worker.fetch(request('/api/pools'), env), data = await response.json();
  assert.deepEqual(data.pools.map(p => p.id), [sol.id]);
  assert.equal(data.catalogued, 1); assert.equal(data.matched, 1);
  assert.equal(data.stats.solana.volume24h, 1000); assert.equal(data.stats.robinhood.pools, 0);
  assert.equal(data.stats.topFeeApr.id, sol.id, 'Other-chain high yield cannot appear in default leader');
  data = await (await worker.fetch(request('/api/pools?includeOther=1'), env)).json();
  assert.equal(data.catalogued, 2); assert.equal(data.stats.robinhood.pools, 1);
  data = await (await worker.fetch(request('/api/pools?chain=robinhood'), env)).json();
  assert.equal(data.pools.length, 0, 'A chain filter alone cannot enable hidden chains');
  data = await (await worker.fetch(request('/api/stats'), env)).json();
  assert.equal(data.topFees.id, sol.id); assert.equal(data.robinhood.volume24h, 0);

  const beforeReads = reads;
  data = await (await worker.fetch(request('/api/positions?refresh=1'), env)).json();
  assert.deepEqual(data.positions, []); assert.deepEqual(data.balances, []);
  data = await (await worker.fetch(request('/api/history'), env)).json();
  assert.deepEqual(data.closed, []); assert.deepEqual(data.open, []);
  data = await (await worker.fetch(request('/api/range-alerts'), env)).json();
  assert.deepEqual(data.events, []); assert.deepEqual(data.state.positions, {});
  assert.equal(reads, beforeReads, 'Default hidden wallets never read cached personal data');
  data = await (await worker.fetch(request('/api/positions?includeOther=1'), env)).json();
  assert.equal(data.positions[0].id, 'personal', 'Explicit toggle can show optional read-only portfolio');
  for (const path of ['/api/pool-chart?pool=robinhood:OTHERPOOL', '/api/pool-context?pool=robinhood:OTHERPOOL', '/api/wallet-intelligence'])
    assert.equal((await worker.fetch(request(path), env)).status, 404);

  assert.equal((await worker.fetch(request('/api/version'), env)).status, 200);
  response = await worker.fetch(request('/api/version', 'HEAD'), env);
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  response = await worker.fetch(request('/'), env);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'asset /still-demo');
  for (const path of ['/index.html', '/advanced', '/advanced/']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), path === '/index.html' ? 'asset /still-demo' : 'asset /');
  }
  assert.equal(assets, 4);
  const beforeGuided = {writes, assets, providers};
  data = await (await worker.fetch(request('/api/still/pools'), env)).json();
  assert.equal(data.paper, true); assert.deepEqual(data.pools, [], 'Ineligible snapshot rows produce an explicit empty shortlist');
  data = await (await worker.fetch(request('/api/baskets'), env)).json();
  assert.equal(data.baskets.length, 3); assert.ok(data.baskets.every(b => b.status === 'unavailable'));
  for (const path of ['/api/still/preflight?poolAddress=bad', '/api/still/preflight?amountSol=1e3', '/api/still/basket-preflight?basketId=other']) {
    const priorReads = reads;
    assert.equal((await worker.fetch(request(path), env)).status, 400);
    assert.equal(reads, priorReads, 'Invalid guided requests stop before cache reads');
  }
  assert.equal((await worker.fetch(request('/api/still/preflight?poolAddress='+'A'.repeat(32)), env)).status, 404);
  response = await worker.fetch(request('/api/baskets', 'HEAD'), env);
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  const originalSnapshot = store.get('snapshot:v1');
  for (const malformed of [{updatedAt:now}, {pools:null}, {pools:[null]}]) {
    store.set('snapshot:v1',malformed);
    for (const path of ['/api/still/pools','/api/baskets','/api/still/preflight?poolAddress='+'A'.repeat(32),'/api/still/basket-preflight?basketId=steady']) {
      const broken = await worker.fetch(request(path),env);
      assert.equal(broken.status,503,'Malformed snapshot returns a retryable error for '+path);
      assert.match((await broken.json()).error,/unavailable/i);
    }
  }
  store.set('snapshot:v1',originalSnapshot);
  assert.deepEqual({writes, assets, providers}, beforeGuided, 'Guided evidence stays read-only and uses only the supplied snapshot');
  for(const path of ['/brand/still-mark.svg','/product.css','/product-brand.js']){const response=await worker.fetch(request(path),env);assert.equal(response.status,200);assert.equal(await response.text(),'asset '+path,'public product assets reach only the static binding');}
  assert.equal(assets, 7); assert.equal(writes, 0); assert.equal(providers, 0);
  console.log('PASS: Paper Worker blocks all signing/auth assets and endpoints before side effects; secrets excluded; read APIs and Solana defaults verified.');
} finally {globalThis.fetch = realFetch;}
