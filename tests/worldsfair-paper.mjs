import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'worldsfair-paper-'));
await build({entryPoints: ['src/worldsfair-paper.ts', 'src/worldsfair-paper-math.ts', 'src/paper-fleet.ts'], outdir: dir, bundle: true,
  platform: 'node', format: 'esm', mainFields: ['main'], outExtension: {'.js': '.mjs'},
  banner: {js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const {WorldsfairRangeInbox, worldsfairPaperRoute, paperDigest} = await import(join(dir, 'worldsfair-paper.mjs'));
const {paperLamports, paperProfitSplit, paperPeakAfterWithdrawal} = await import(join(dir, 'worldsfair-paper-math.mjs'));
const {initialFleetState, fleetRisk, fleetEquity, fleetSummary} = await import(join(dir, 'paper-fleet.mjs'));
const near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-10, `${note}: ${a} vs ${b}`);

assert.equal(paperLamports('0.000000001'), 1);
assert.equal(paperLamports('12.345678901'), 12345678901);
assert.equal(paperLamports(1000), 1e12);
for (const input of ['0', '-1', '0.0000000001', '1e2', '01', ' 1', '1000.000000001', Infinity, NaN, null, {}, [], '1.'.repeat(3000)])
  assert.throws(() => paperLamports(input), RangeError, 'Reject invalid amount ' + String(input));
assert.deepEqual(paperProfitSplit(.123456789, 50), {profitLamports: 123456789, amountLamports: 61728394, retainedLamports: 61728395});
assert.equal(paperProfitSplit(2, 100).amountLamports, 2e9);
for (const [profit, percent] of [[0, 50], [-1, 50], [NaN, 50], [2, 0], [2, 101], [2, 50.5], [2, '50'], [.000000001, 50]])
  assert.throws(() => paperProfitSplit(profit, percent));
for (const [peak, equity, amount] of [[120, 100, 10], [100, 100, 20], [100, 80, 4], [100, 110, 1]]) {
  const after = paperPeakAfterWithdrawal(peak, equity, amount);
  near(1 - (equity - amount) / after, 1 - equity / peak, 'Cash flow preserves risk ratio');
}
assert.throws(() => paperPeakAfterWithdrawal(100, 10, 10));

class Storage {
  values = new Map(); puts = []; failNext = false;
  async get(key) {return structuredClone(this.values.get(key));}
  async put(key, value) {
    if (this.failNext) {this.failNext = false; throw Error('Synthetic atomic durable failure');}
    const rows = typeof key === 'string' ? {[key]: value} : key;
    this.puts.push(Object.keys(rows));
    for (const [name, entry] of Object.entries(rows)) this.values.set(name, structuredClone(entry));
  }
  async delete(key) {return this.values.delete(key);}
  async list(options = {}) {
    let rows = [...this.values].filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.end || key < options.end) && (!options.startAfter || key > options.startAfter)).sort(([a], [b]) => a.localeCompare(b));
    if (options.reverse) rows.reverse();
    return new Map(rows.slice(0, options.limit || rows.length).map(([key, value]) => [key, structuredClone(value)]));
  }
}
const storage = new Storage(), mirror = new Map();
let queue = Promise.resolve(), failKv = false, kvCalls = 0, now = Date.parse('2026-10-05T12:00:00Z');
const realNow = Date.now;
Date.now = () => now;
const state = {storage, blockConcurrencyWhile(fn) {const pending = queue.then(fn); queue = pending.catch(() => {}); return pending;}};
const env = {LP_CACHE: {put: async (key, value) => {kvCalls++; if (failKv) throw Error('Synthetic KV failure'); mirror.set(key, value);}}};
const object = new WorldsfairRangeInbox(state, env);
const accountA = 'a'.repeat(64), accountB = 'b'.repeat(64);
const internal = async (action, body, account = accountA, query = '') => object.fetch(new Request('https://paper/worldsfair-paper/' + action + query, {
  method: body ? 'POST' : 'GET', headers: {'x-worldsfair-account': account, 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {}),
}));
const asJson = async response => ({status: response.status, body: await response.json()});
const fleet = initialFleetState(); fleet.lastScanAt = new Date(now).toISOString(); fleet.revision = 7;
fleet.portfolios.farmer.cashSol = 110; fleet.portfolios.farmer.peakSol = 125; fleet.portfolios.farmer.realizedPnlSol = 8; fleet.portfolios.farmer.maxDrawdown = .2;
const trade = {id: 'fleet:farmer:fixture-pool:' + fleet.lastScanAt, arm: 'farmer', closedAt: fleet.lastScanAt, openedAt: new Date(now - 3600000).toISOString(),
  pair: 'FIXTURE/SOL', poolAddress: 'fixture-pool', pnlSol: 2, exitSol: 3.0001, budgetSol: 1, entryNetworkSol: .0001, feesSol: 2, reason: 'Verified paper test close'};
fleet.closed = [trade];
await storage.put({fleet, ['fleet-trade:' + trade.closedAt + ':' + trade.id]: trade});
try {
  let result = await asJson(await internal('account'));
  assert.equal(result.body.account.balanceSol, 0); assert.deepEqual(result.body.account.holdings, []); assert.deepEqual(result.body.history, []);
  const seed = {amountSol: '10.000000001', requestId: 'seed-00000001'};
  result = await asJson(await internal('seed', seed));
  assert.equal(result.status, 200); assert.equal(result.body.account.balanceLamports, 10000000001);
  assert.equal(result.body.receipt.kind, 'seed'); assert.equal(result.body.persistence, 'saved');
  assert.equal(JSON.parse(mirror.get('wf:account:' + accountA)).balanceLamports, 10000000001);
  assert.equal(JSON.parse(mirror.get('wf:event:' + accountA + ':000000000001')).amountSol, 10.000000001);
  const duplicate = await asJson(await internal('seed', seed));
  assert.deepEqual(duplicate.body.receipt, result.body.receipt); assert.equal(duplicate.body.history.length, 1);
  assert.equal((await internal('seed', {...seed, amountSol: '20'})).status, 409, 'Request IDs cannot change content');
  assert.equal((await internal('seed', {...seed, requestId: 'seed-unknown', pnlSol: 999})).status, 400, 'No extra monetary payload fields');
  assert.equal((await internal('roll', {source: 'active-lp', id: trade.id, closedAt: trade.closedAt, percent: 50, requestId: 'roll-sample0'})).status, 400);
  assert.equal((await internal('roll', {source: 'fleet', id: trade.id + '-missing', closedAt: trade.closedAt, percent: 50, requestId: 'roll-missing'})).status, 404);

  const roll = {source: 'fleet', id: trade.id, closedAt: trade.closedAt, percent: 50, requestId: 'roll-00000001'};
  const before = await storage.get('fleet'), beforeRisk = fleetRisk(before, 'farmer', now), beforeEquity = fleetEquity(before, 'farmer', now);
  const simultaneous = await Promise.all([internal('roll', roll), internal('roll', roll)]);
  const first = await asJson(simultaneous[0]), second = await asJson(simultaneous[1]);
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.deepEqual(first.body.receipt, second.body.receipt);
  assert.equal(first.body.account.balanceLamports, 11000000001); assert.equal(first.body.account.retainedLpSol, 1);
  assert.equal(first.body.account.rolledProfitSol, 1); assert.equal(first.body.receipt.profitSol, 2);
  const after = await storage.get('fleet');
  assert.equal(after.portfolios.farmer.cashSol, 109); assert.equal(after.portfolios.farmer.withdrawnSol, 1);
  assert.equal(after.portfolios.farmer.realizedPnlSol, 8); assert.equal(after.portfolios.farmer.maxDrawdown, .2);
  assert.equal(after.revision, 8, 'Old scanner revision must be rejected after cash moves');
  near(fleetRisk(after, 'farmer', now).drawdown, beforeRisk.drawdown, 'Transfer is not a risk loss');
  const arm = fleetSummary(after, now).arms.find(arm => arm.id === 'farmer');
  near(arm.performanceEquitySol, beforeEquity, 'Performance equity conserves transferred profit');
  near(after.portfolios.farmer.cashSol + first.body.account.balanceSol, before.portfolios.farmer.cashSol + 10.000000001, 'Source plus destination conservation');
  assert.ok(storage.puts.some(keys => keys.includes('fleet') && keys.includes('wf:account:' + accountA) && keys.some(key => key.startsWith('wf:claim:')) && keys.some(key => key.startsWith('wf:receipt:')) && keys.some(key => key.startsWith('wf:event:')) && keys.includes('wf:outbox:' + accountA)), 'Debit, credit, claim, receipt, event and mirror outbox share one atomic write');
  assert.equal((await internal('roll', {...roll, requestId: 'roll-other00'}, accountB)).status, 409, 'Another visitor cannot claim the same close');
  result = await asJson(await internal('account', undefined, accountB));
  assert.equal(result.body.account.balanceSol, 0); assert.equal(result.body.history.length, 0, 'Sessions do not share pots or histories');
  const annotated = await asJson(await object.fetch(new Request('https://fleet/fleet')));
  assert.equal(annotated.body.closed[0].profitRoll.claimed, true); assert.equal(annotated.body.closed[0].profitRoll.eligible, false);
  assert.equal(annotated.body.closed[0].profitRoll.amountSol, 1);
  assert.ok(!JSON.stringify(annotated.body).includes(accountA), 'Public close markers never expose account identity');

  // No fabricated or repeated credits on storage failures.
  failKv = true;
  const retrySeed = {amountSol: '2', requestId: 'seed-kv-fail'};
  result = await asJson(await internal('seed', retrySeed));
  assert.equal(result.status, 200); assert.equal(result.body.persistence, 'retrying'); assert.equal(result.body.account.balanceLamports, 13000000001);
  assert.ok(await storage.get('wf:outbox:' + accountA));
  result = await asJson(await internal('seed', retrySeed));
  assert.equal(result.body.account.balanceLamports, 13000000001, 'KV retry never repeats durable credit');
  failKv = false;
  result = await asJson(await internal('account'));
  assert.equal(result.body.persistence, 'saved'); assert.equal(await storage.get('wf:outbox:' + accountA), undefined);
  assert.equal(JSON.parse(mirror.get('wf:account:' + accountA)).balanceLamports, 13000000001);
  assert.equal(JSON.parse(mirror.get('wf:event:' + accountA + ':000000000003')).id, 'seed-kv-fail');
  storage.failNext = true;
  const failedSeed = {amountSol: '3', requestId: 'seed-do-fail'};
  assert.equal((await internal('seed', failedSeed)).status, 503);
  assert.equal((await storage.get('wf:account:' + accountA)).balanceLamports, 13000000001);
  result = await asJson(await internal('seed', failedSeed));
  assert.equal(result.body.account.balanceLamports, 16000000001);

  // Fresh funded cash is required even if a historical trade is profitable.
  const invalidTrade = {...trade, id: trade.id + '-later'};
  await storage.put('fleet-trade:' + invalidTrade.closedAt + ':' + invalidTrade.id, invalidTrade);
  let changed = await storage.get('fleet'); changed.lastScanAt = new Date(now - 3600000).toISOString(); await storage.put('fleet', changed);
  const invalidRoll = {...roll, id: invalidTrade.id, requestId: 'roll-stale00'};
  assert.equal((await internal('roll', invalidRoll)).status, 409);
  changed.lastScanAt = new Date(now).toISOString(); changed.portfolios.farmer.cashSol = .5; await storage.put('fleet', changed);
  assert.equal((await internal('roll', {...invalidRoll, requestId: 'roll-lowcash'})).status, 409);
  changed.portfolios.farmer.cashSol = 100; changed.portfolios.farmer.unresolvedSol = .1; await storage.put('fleet', changed);
  assert.equal((await internal('roll', {...invalidRoll, requestId: 'roll-unscore'})).status, 409);
  const losing = {...trade, id: trade.id + '-loss', pnlSol: -1};
  await storage.put('fleet-trade:' + losing.closedAt + ':' + losing.id, losing);
  assert.equal((await internal('roll', {...roll, id: losing.id, requestId: 'roll-loss000'})).status, 404);

  // Pagination and mutation rate bounds retain every move, not only recent rows.
  for (let i = 0; i < 40; i++) {now += 61000; assert.equal((await internal('seed', {amountSol: '0.1', requestId: 'history-' + String(i).padStart(8, '0')})).status, 200);}
  result = await asJson(await internal('account'));
  assert.equal(result.body.history.length, 30); assert.ok(result.body.cursor);
  const earlier = await asJson(await internal('history', undefined, accountA, '?cursor=' + result.body.cursor));
  assert.equal(earlier.body.history.length, 14); assert.equal(earlier.body.cursor, null);
  assert.equal(new Set([...result.body.history, ...earlier.body.history].map(event => event.id)).size, 44);
  for (let i = 0; i < 20; i++) assert.equal((await internal('seed', {amountSol: '1', requestId: 'rate-' + String(i).padStart(8, '0')}, accountB)).status, 200);
  assert.equal((await internal('seed', {amountSol: '1', requestId: 'rate-blocked'}, accountB)).status, 429);

  // Public cookie, CSRF, body size, field isolation and trusted internal header.
  let forwarded;
  const routeEnv = {...env, RANGE_ALERTS: {idFromName(name) {assert.equal(name, 'pat-four-wallets-v1'); return name;}, get() {return {fetch: async (url, options) => {forwarded = new Request(url, options); return object.fetch(forwarded);}};}}};
  const origin = 'https://paper.example';
  const publicRequest = (path, options = {}) => new Request(origin + '/api/paper/' + path, options);
  let response = await worldsfairPaperRoute(publicRequest('account', {headers: {'x-worldsfair-account': accountA}}), routeEnv);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie'), cookie = setCookie.split(';')[0], rawToken = cookie.split('=')[1];
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/); assert.match(setCookie, /Path=\//);
  assert.equal(forwarded.headers.get('x-worldsfair-account'), await paperDigest(rawToken));
  assert.notEqual(forwarded.headers.get('x-worldsfair-account'), accountA, 'Client cannot choose another session with a header');
  const visible = await response.text(); assert.ok(!visible.includes(rawToken)); assert.ok(!visible.includes(await paperDigest(rawToken)));
  const options = {method: 'POST', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify({amountSol: '5', requestId: 'cookie-seed0'})};
  assert.equal((await worldsfairPaperRoute(publicRequest('seed', {...options, headers: {...options.headers, origin: 'https://evil.example'}}), routeEnv)).status, 403);
  assert.equal((await worldsfairPaperRoute(publicRequest('seed', {...options, headers: {origin, 'content-type': 'application/json'}}), routeEnv)).status, 401);
  assert.equal((await worldsfairPaperRoute(publicRequest('seed', {...options, headers: {cookie, origin, 'content-type': 'text/plain'}}), routeEnv)).status, 415);
  assert.equal((await worldsfairPaperRoute(publicRequest('seed', {...options, body: ' '.repeat(4097)}), routeEnv)).status, 413);
  response = await worldsfairPaperRoute(publicRequest('seed', options), routeEnv);
  assert.equal(response.status, 200); assert.equal((await response.json()).account.balanceSol, 5);
  assert.equal(await worldsfairPaperRoute(new Request(origin + '/api/pools'), routeEnv), null);
  assert.ok(kvCalls > 0);
  console.log('PASS: exact Paper amounts; drawdown-neutral funded transfer; atomic cash conservation; trusted closes; concurrent replay; global claim; session privacy; durable/KV recovery; full history; seed rate limits.');
} finally {Date.now = realNow;}
