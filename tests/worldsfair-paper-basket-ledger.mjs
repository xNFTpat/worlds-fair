import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'worldsfair-basket-ledger-'));
await build({entryPoints: ['src/worldsfair-paper.ts'], outfile: join(dir, 'ledger.mjs'), bundle: true, platform: 'node', format: 'esm',
  plugins: [{name: 'controlled-quote-fixture', setup(build) {
    build.onResolve({filter: /^\.\/worldsfair-paper-baskets$/}, () => ({path: 'provider', namespace: 'fixture'}));
    build.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: `
      export class PaperBasketError extends Error {constructor(message,status=503,code='basket_quotes_unconfigured'){super(message);this.status=status;this.code=code;}}
      export const preparePaperBasketPurchase=(...args)=>globalThis.__paperBasketFixture.prepare(...args);
      export const markPaperBaskets=(...args)=>globalThis.__paperBasketFixture.mark(...args);
      export const preparePaperTokenQuotes=()=>{throw Error('Vault quote helper is outside this basket ledger test');};
      export const readPaperTokenPrices=()=>{throw Error('Vault price helper is outside this basket ledger test');};
    `, loader: 'js'}));
  }}]});
const {WorldsfairRangeInbox} = await import(join(dir, 'ledger.mjs'));
const copy = value => structuredClone(value);
class Storage {
  rows = new Map(); batches = [];
  async get(key) {return copy(this.rows.get(key));}
  async put(key, value) {const entries = typeof key === 'string' ? {[key]: value} : key; this.batches.push(Object.keys(entries)); for (const [name, data] of Object.entries(entries)) this.rows.set(name, copy(data));}
  async delete(key) {return this.rows.delete(key);}
  async list(options = {}) {let entries = [...this.rows].filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.end || key < options.end)).sort(([a], [b]) => a.localeCompare(b)); if (options.reverse) entries.reverse(); return new Map(entries.slice(0, options.limit || entries.length).map(([key, value]) => [key, copy(value)]));}
}
const storage = new Storage(), kv = new Map();
let queue = Promise.resolve(), guarded = false, now = Date.parse('2026-10-05T16:00:00Z'), providerCalls = 0, markCalls = 0, mode = 'normal', gate = null, failKv = false;
const actualNow = Date.now; Date.now = () => now;
const ctx = {storage, blockConcurrencyWhile(fn) {const next = queue.then(async () => {assert.equal(guarded, false); guarded = true; try {return await fn();} finally {guarded = false;}}); queue = next.catch(() => {}); return next;}};
const env = {LP_CACHE: {put: async (key, value) => {if (failKv) throw Error('fixture unavailable'); kv.set(key, value);}}};
const object = new WorldsfairRangeInbox(ctx, env), account = 'c'.repeat(64), other = 'd'.repeat(64);
const run = async (action, body, owner = account) => {
  const response = await object.fetch(new Request('https://paper/worldsfair-paper/' + action, {method: body ? 'POST' : 'GET', headers: {'x-worldsfair-account': owner}, ...(body ? {body: JSON.stringify(body)} : {})}));
  return {status: response.status, data: await response.json()};
};
const purchase = (slug, amountSol) => {
  const amountLamports = Math.round(Number(amountSol) * 1e9), at = new Date(now).toISOString();
  return {paper: true, kind: 'basket', slug, name: 'Fixture basket', amountLamports, costSol: amountLamports / 1e9, allocationReadAt: at, preparedAt: at, quoteAsOf: at, expiresAt: now + 60000,
    entrySolUsd: 100, entryPriceAsOf: at, note: 'Quote-only fixture', legs: [{mint: 'fixture-mint', symbol: 'FIX', weight: 100, inputLamports: amountLamports, unitsRaw: String(amountLamports * 10), decimals: 9, priceImpactFraction: .01, quoteAsOf: at, contextSlot: 1}]};
  };
globalThis.__paperBasketFixture = {
  async prepare(_env, input) {
    assert.equal(guarded, false, 'Provider quote must run outside Durable Object concurrency guard');
    providerCalls++;
    if (gate) await gate;
    if (mode === 'missing-key') {const error = Error('No quote key'); error.name = 'FixtureError'; throw error;}
    const result = purchase(input.slug, input.amountSol);
    if (mode === 'expired') result.expiresAt = now - 1;
    if (mode === 'incomplete') result.legs[0].unitsRaw = '0';
    if (mode === 'wrong-size') result.amountLamports++;
    if (mode === 'huge') result.note = 'x'.repeat(110000);
    return result;
  },
  async mark(_env, holdings) {
    assert.equal(guarded, false, 'Provider mark must run outside concurrency guard'); markCalls++;
    const at = new Date(now).toISOString();
    if (gate) await gate;
    return {asOf: at, quotesConfigured: true, note: 'Fixture marks', marks: holdings.map(holding => ({holdingId: holding.id, status: mode === 'unavailable-mark' ? 'unavailable' : 'complete', asOf: mode === 'unavailable-mark' ? null : at, readAt: at,
      solUsd: 200, valueSol: mode === 'unavailable-mark' ? null : holding.costSol * .8, valueUsd: mode === 'unavailable-mark' ? null : holding.costSol * 160, costSol: holding.costSol, holdSolValueUsd: holding.costSol * 200,
      pnlSol: mode === 'unavailable-mark' ? null : -holding.costSol * .2, vsHoldSolUsd: mode === 'unavailable-mark' ? null : -holding.costSol * 40, absolutePnlUsd: mode === 'unavailable-mark' ? null : holding.costSol * 60,
      legs: [], note: 'Dated fixture'}))};
  },
};
const nextMinute = () => {now += 61000;};
try {
  assert.equal((await run('seed', {amountSol: '2', requestId: 'seed-baskets'})).status, 200);
  const firstRequest = {slug: 'fixture-basket', amountSol: '0.5', requestId: 'basket-first'};
  let result = await run('basket', firstRequest);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.account.balanceSol, 1.5); assert.equal(result.data.account.holdings.length, 1);
  assert.equal(result.data.receipt.kind, 'basket'); assert.equal(result.data.receipt.legs[0].unitsRaw, '5000000000');
  const event = storage.rows.get('wf:event:' + account + ':000000000002');
  assert.equal(event.holdingId, result.data.account.holdings[0].id); assert.equal('legs' in event, false, 'Journal references holding without duplicating quote legs');
  assert.equal(JSON.parse(kv.get('wf:account:' + account)).holdings[0].legs[0].unitsRaw, '5000000000');
  assert.equal(storage.batches.filter(keys => keys.includes('wf:account:' + account) && keys.includes('wf:event:' + account + ':000000000002')).length, 1);
  const calls = providerCalls;
  assert.equal((await run('basket', firstRequest)).status, 200); assert.equal(providerCalls, calls, 'Saved receipt replays before provider calls');
  assert.equal((await run('basket', {...firstRequest, amountSol: '1'})).status, 409); assert.equal(providerCalls, calls);
  assert.equal((await run('basket', {...firstRequest, requestId: 'forged-units', unitsRaw: '999999'})).status, 400); assert.equal(providerCalls, calls);
  assert.equal((await run('basket', {...firstRequest, requestId: 'poor-account'}, other)).status, 409); assert.equal(providerCalls, calls, 'Insufficient balance checked before provider reads');

  for (const bad of ['missing-key', 'expired', 'incomplete', 'wrong-size', 'huge']) {
    nextMinute(); mode = bad;
    result = await run('basket', {...firstRequest, requestId: 'failed-' + bad});
    assert.ok(result.status >= 400, bad + ' must fail');
    const state = (await run('account')).data.account;
    assert.equal(state.balanceSol, 1.5); assert.equal(state.holdings.length, 1, bad + ' must not debit/add holdings');
  }
  mode = 'normal'; nextMinute();
  let release;
  gate = new Promise(resolve => {release = resolve;});
  const parallelRequest = {...firstRequest, amountSol: '0.1', requestId: 'same-inflight'};
  const beforeCalls = providerCalls;
  const sameA = run('basket', parallelRequest), sameB = run('basket', parallelRequest);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(providerCalls, beforeCalls + 1, 'Concurrent identical requests share one quote preparation');
  release(); gate = null;
  const [sameResultA, sameResultB] = await Promise.all([sameA, sameB]);
  assert.equal(sameResultA.status, 200); assert.equal(sameResultB.status, 200); assert.deepEqual(sameResultA.data.receipt, sameResultB.data.receipt);
  assert.equal((await run('account')).data.account.balanceSol, 1.4);

  nextMinute(); gate = new Promise(resolve => {release = resolve;});
  const overA = run('basket', {...firstRequest, amountSol: '1', requestId: 'overspend-a'}), overB = run('basket', {...firstRequest, amountSol: '1', requestId: 'overspend-b'});
  await new Promise(resolve => setTimeout(resolve, 10));
  release(); gate = null;
  const overspend = await Promise.all([overA, overB]);
  assert.deepEqual(overspend.map(row => row.status).sort(), [200, 409]);
  assert.equal((await run('account')).data.account.balanceSol, .4, 'Serialized commit rechecks available cash');

  nextMinute();
  result = await run('refresh', {requestId: 'refresh-good'});
  assert.equal(result.status, 200); assert.equal(result.data.account.balanceSol, .4);
  assert.equal(result.data.receipt.completeCount, 3); assert.equal(result.data.account.holdings[0].valuation.valueSol, .4);
  const valuationDate = result.data.account.holdings[0].valuation.asOf, oldMarks = markCalls;
  assert.equal((await run('refresh', {requestId: 'refresh-good'})).status, 200); assert.equal(markCalls, oldMarks);
  nextMinute(); mode = 'unavailable-mark';
  result = await run('refresh', {requestId: 'refresh-missing'});
  assert.equal(result.status, 200); assert.equal(result.data.account.holdings[0].valuation.status, 'unavailable');
  assert.equal(result.data.account.holdings[0].valuation.valueSol, null);
  assert.equal(result.data.account.holdings[0].lastCompleteValuation.asOf, valuationDate, 'Unavailable refresh preserves original dated complete valuation');
  assert.equal(result.data.account.holdings[0].lastCompleteValuation.valueSol, .4); assert.equal(result.data.account.balanceSol, .4);

  mode = 'normal'; nextMinute(); failKv = true;
  const retry = {...firstRequest, amountSol: '0.1', requestId: 'buy-mirror-fail'};
  result = await run('basket', retry); assert.equal(result.status, 200); assert.equal(result.data.persistence, 'retrying'); assert.equal(result.data.account.balanceSol, .3);
  const attempts = providerCalls; result = await run('basket', retry); assert.equal(result.status, 200); assert.equal(result.data.account.balanceSol, .3); assert.equal(providerCalls, attempts);
  failKv = false; assert.equal((await run('account')).data.persistence, 'saved');

  // New holdings appearing while marks load cannot be overwritten by that older snapshot.
  nextMinute(); gate = new Promise(resolve => {release = resolve;});
  const refreshing = run('refresh', {requestId: 'refresh-race'});
  await new Promise(resolve => setTimeout(resolve, 10));
  const state = await storage.get('wf:account:' + account); const extra = {...purchase('extra-holding', '.1'), id: 'basket:extra-fixture', openedAt: new Date(now).toISOString()}; state.holdings.push(extra); await storage.put('wf:account:' + account, state);
  release(); gate = null;
  result = await refreshing; assert.equal(result.status, 200); assert.ok(result.data.account.holdings.some(holding => holding.id === extra.id), 'Merge marks by holding ID into latest state');

  nextMinute(); mode = 'missing-key';
  for (let i = 0; i < 8; i++) assert.ok((await run('basket', {...firstRequest, amountSol: '.1'.replace('.', '0.'), requestId: 'rate-failure-' + i})).status >= 400);
  const callsBeforeLimit = providerCalls;
  assert.equal((await run('basket', {...firstRequest, amountSol: '0.1', requestId: 'rate-no-read'})).status, 429); assert.equal(providerCalls, callsBeforeLimit, 'Failed provider attempts are still bounded before provider reads');
  console.log('PASS: basket ledger outside-lock quotes, pre-read and commit guards, concurrent replay/overspend, whole-basket atomic debit, failed/expired/oversize rollback, bounded provider attempts, dated refresh merge and KV recovery.');
} finally {Date.now = actualNow; delete globalThis.__paperBasketFixture;}
