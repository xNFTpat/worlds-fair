import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'still-paper-'));
await build({entryPoints: ['src/still-paper.ts', 'src/worldsfair-paper.ts'], outdir: dir, bundle: true, platform: 'node', format: 'esm', mainFields: ['main'], outExtension: {'.js': '.mjs'}});
const {StillPaperLedger, markStillPosition, STILL_SETTLEMENT_NOTE} = await import(join(dir, 'still-paper.mjs'));
const {worldsfairPaperRoute} = await import(join(dir, 'worldsfair-paper.mjs'));
class Storage {
  values = new Map(); writes = []; failNext = false;
  async get(key) {return structuredClone(this.values.get(key));}
  async put(key, value) {
    if (this.failNext) {this.failNext = false; throw Error('Synthetic atomic failure');}
    const rows = typeof key === 'string' ? {[key]: value} : key;
    this.writes.push(Object.keys(rows));
    for (const [name, item] of Object.entries(rows)) this.values.set(name, structuredClone(item));
  }
}
let now = Date.parse('2026-10-09T12:00:00Z'), counter = 0, unavailablePool = null, mismatchedPool = null, invalidFunding = false, unavailableMark = false;
const poolA = 'A'.repeat(44), poolB = 'B'.repeat(44), poolC = 'C'.repeat(44);
const accountA = 'a'.repeat(64), accountB = 'b'.repeat(64);
const storage = new Storage(); let queue = Promise.resolve();
const ctx = {storage, blockConcurrencyWhile(fn) {const result = queue.then(fn); queue = result.catch(() => {}); return result;}};
const observation = poolAddress => ({poolAddress, name: 'TEST/SOL', priceSol: 1, fetchedAt: new Date(now).toISOString(), feeRateHourly: .002, feeRateAsOf: new Date(now).toISOString(), source: 'Synthetic test pool'});
const preflight = async (_env, poolAddress, amountSol) => {
  if (unavailablePool === poolAddress) return null;
  const asOf = new Date(now).toISOString();
  const bins = [.6, .8, .95].map(priceSol => ({priceSol, sol: amountSol / 3 * (invalidFunding ? 2 : 1), token: 0}));
  return {poolAddress: mismatchedPool || poolAddress, name: 'TEST/SOL', fetchedAt: asOf, canOpen: true,
    priceSol: {value: 1, source: 'Synthetic test pool', asOf}, feeRateHourly: {value: .002, source: 'Synthetic test pool', asOf},
    range: {shape: 'BidAsk', floorPriceSol: .6, topPriceSol: .95, bins, note: 'Synthetic ideal bins'},
    ledger: {priceSol: 1, feeRateHourly: .002, entryCostsSol: null, exitCostsSol: null, transferFeeBps: null, bins}};
};
let basketLegs = [{poolAddress: poolA, weightBps: 3333}, {poolAddress: poolB, weightBps: 3333}, {poolAddress: poolC, weightBps: 3334}];
const deps = {now: () => now, id: () => 'fixture-' + String(++counter).padStart(8, '0'), preflight,
  baskets: async () => [{id: 'steady', name: 'Steady', legs: basketLegs}], mark: async (_env, poolAddress) => unavailableMark ? null : observation(poolAddress)};
let ledger = new StillPaperLedger(ctx, {}, deps);
const call = async (action, input, account = accountA) => {const response = await ledger.handle(account, action, input); return {status: response.status, body: await response.json()};};
const open = (requestId, poolAddress = poolA, amountSol = '.5') => ({poolAddress, amountSol: amountSol === '.5' ? '0.5' : amountSol, requestId, confirmed: true});
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

let result = await call('still-account');
assert.equal(result.body.account.balanceSol, 10); assert.equal(result.body.account.seededSol, 10);
assert.match(result.body.account.seedNote, /not a deposit or earnings/);
assert.equal(result.body.account.settlementNote, STILL_SETTLEMENT_NOTE);
assert.equal([...storage.values.keys()].every(key => key.startsWith('still:')), true, 'Existing wf and fleet accounts remain untouched');
assert.equal((await call('still-open', {...open('no-confirm-1'), confirmed: false})).status, 400);
assert.equal((await call('still-open', {...open('unknown-data'), estimatedFeesSol: 100})).status, 400);
for (const amountSol of ['0', '-0.5', '11', '0.00001', '1e1', '0.1234567891']) assert.equal((await call('still-open', open('bad-amount-0', poolA, amountSol))).status, 400);
assert.equal((await call('still-open', open('bad-pool-001', 'not-an-address'))).status, 400);

const firstRequest = open('single-first');
const simultaneous = await Promise.all([call('still-open', firstRequest), call('still-open', firstRequest)]);
assert.equal(simultaneous[0].status, 200); assert.equal(simultaneous[1].status, 200);
assert.deepEqual(simultaneous[0].body.receipt, simultaneous[1].body.receipt);
result = simultaneous[0]; const firstId = result.body.account.positions[0].id;
assert.equal(result.body.account.balanceSol, 9.5); assert.equal(result.body.account.positions.length, 1);
assert.equal(result.body.account.positions[0].mark.netPnlSol, null, 'Unknown entry and exit costs never become zero');
assert.equal(result.body.account.positions[0].mark.grossPnlSol, 0);
assert.equal((await call('still-open', {...firstRequest, amountSol: '1'})).status, 409, 'Request IDs cannot change amount');
ledger = new StillPaperLedger(ctx, {}, deps);
assert.equal((await call('still-open', firstRequest)).body.account.balanceSol, 9.5, 'Receipts survive DO reconstruction');
result = await call('still-open', open('same-pool-02'));
assert.equal(result.status, 200); assert.equal(result.body.account.balanceSol, 9);
assert.equal(result.body.account.positions.length, 2); assert.equal(new Set(result.body.account.positions.map(p => p.positionAddress)).size, 2);
assert.equal(result.body.account.groups.length, 1); assert.deepEqual(result.body.account.groups[0].positionIds, result.body.account.positions.map(p => p.id));
assert.equal(result.body.account.groups[0].openCount, 2);
assert.equal((await call('still-account', undefined, accountB)).body.account.positions.length, 0, 'Session journals are isolated');
assert.equal((await call('still-open', firstRequest, accountB)).body.account.balanceSol, 9.5, 'Request IDs are session scoped');

const basket = {basketId: 'steady', poolAddresses: [poolA, poolB, poolC], amountSol: '0.500000001', requestId: 'basket-test01', confirmed: true};
unavailablePool = poolB;
assert.equal((await call('still-basket', basket)).status, 409);
assert.equal((await call('still-account')).body.account.balanceSol, 9, 'One missing basket leg cannot partially spend');
assert.equal((await call('still-account')).body.account.positions.length, 2);
unavailablePool = null;
assert.equal((await call('still-basket', {...basket, poolAddresses: [poolB, poolA, poolC]})).status, 409, 'Changed basket selection requires review');
const priorLegs = basketLegs;
basketLegs = [{poolAddress: poolA, weightBps: 5000}, {poolAddress: poolA, weightBps: 5000}];
assert.equal((await call('still-basket', {...basket, poolAddresses: [poolA, poolA]})).status, 409);
basketLegs = priorLegs;
invalidFunding = true;
assert.equal((await call('still-basket', basket)).status, 409, 'Incorrectly funded range cannot mint paper value');
invalidFunding = false; mismatchedPool = poolC;
assert.equal((await call('still-open', open('wrong-pool-0'))).status, 409, 'Source pool identity must match');
mismatchedPool = null;
storage.failNext = true;
assert.equal((await call('still-basket', basket)).status, 503);
assert.equal((await call('still-account')).body.account.balanceSol, 9, 'Atomic persistence failure leaves all funds and positions intact');
result = await call('still-basket', basket);
assert.equal(result.status, 200); assert.equal(result.body.account.positions.length, 5);
assert.equal(result.body.account.balanceLamports, 8499999999);
const basketPositions = result.body.account.positions.filter(p => p.basketId === 'steady');
assert.equal(basketPositions.reduce((sum, p) => sum + p.amountLamports, 0), 500000001, 'All split lamports conserved including remainder');
assert.equal(new Set(basketPositions.map(p => p.id)).size, 3);
assert.equal(result.body.account.latestBasket.eventId, basket.requestId);
assert.equal(result.body.account.latestBasket.basketId, 'steady');
assert.deepEqual(result.body.account.latestBasket.stampTarget, {kind: 'still-basket', eventId: basket.requestId});
const storedBasketReceipt = await storage.get('still:receipt:' + accountA + ':' + basket.requestId);
assert.equal(storedBasketReceipt.basket.amountLamports, 500000001);
assert.deepEqual(storedBasketReceipt.basket.positions.map(p => p.positionAddress), result.body.receipt.positionIds);
assert.equal(storedBasketReceipt.basket.positions.reduce((sum, p) => sum + p.amountLamports, 0), 500000001);
ledger = new StillPaperLedger(ctx, {}, deps);
assert.deepEqual((await call('still-account')).body.account.latestBasket, result.body.account.latestBasket, 'Reload restores the exact latest saved basket target');

assert.equal((await call('still-basket', basket)).body.account.positions.length, 5, 'Basket retry does not duplicate legs');
assert.ok(storage.writes.some(keys => keys.includes('still:account:' + accountA) && keys.includes('still:receipt:' + accountA + ':basket-test01')), 'Debit and every position share atomic write with receipt');

// Price and fee evidence are independent. Missing price never settles a close.
unavailableMark = true;
const close = {positionId: firstId, requestId: 'close-first1', confirmed: true};
assert.equal((await call('still-close', {...close, confirmed: false})).status, 400);
assert.equal((await call('still-close', close)).status, 409);
result = await call('still-account');
assert.equal(result.body.account.positions.find(p => p.id === firstId).status, 'open'); assert.equal(result.body.account.balanceLamports, 8499999999);
result = await call('still-refresh', {requestId: 'refresh-none'});
assert.equal(result.status, 200); assert.equal(result.body.account.positions[0].mark.grossPnlSol, null);
assert.equal(result.body.account.positions[0].mark.feesSol, null); assert.equal(result.body.account.positions[0].mark.inRange, null);
unavailableMark = false; now += 60_000;
storage.failNext = true;
assert.equal((await call('still-close', close)).status, 503);
assert.equal((await call('still-account')).body.account.balanceLamports, 8499999999, 'A failed atomic close does not credit or close');
assert.equal((await call('still-account')).body.account.positions.find(p => p.id === firstId).status, 'open');
const concurrentCloses = await Promise.all([call('still-close', close), call('still-close', {...close, requestId: 'close-second'})]);
assert.equal(concurrentCloses.filter(r => r.status === 200).length, 1);
assert.equal(concurrentCloses.filter(r => r.status === 409).length, 1);
result = await call('still-account');
assert.equal(result.body.account.positions.filter(p => p.poolAddress === poolA && p.status === 'closed').length, 1, 'Only the selected address closes');
assert.equal(result.body.account.balanceLamports, 8999999999, 'A close credits gross model inventory once');
assert.equal(result.body.account.positions[0].mark.netPnlSol, null); assert.match(result.body.account.positions[0].settlementNote, /before fees and trading costs/);
assert.equal((await call('still-close', close)).body.account.balanceLamports, 8999999999, 'Lost response retry cannot duplicate close proceeds');

// Two independent confirmations cannot overspend the same practice cash.
const accountC = 'c'.repeat(64);
await call('still-account', undefined, accountC);
const concurrentOpens = await Promise.all([call('still-open', open('last-cash-one', poolA, '10'), accountC), call('still-open', open('last-cash-two', poolB, '10'), accountC)]);
assert.equal(concurrentOpens.filter(r => r.status === 200).length, 1);
assert.equal(concurrentOpens.filter(r => r.status === 409).length, 1);
assert.equal((await call('still-account', undefined, accountC)).body.account.balanceSol, 0);
assert.equal((await call('still-account', undefined, accountC)).body.account.positions.length, 1);

// Fee estimates only cover bounded observed intervals, never elapsed wall time.
const state = await storage.get('still:account:' + accountA);
const position = state.positions.find(p => p.status === 'open');
const feeBase = structuredClone(position);
feeBase.mark.inRange = true; feeBase.mark.rangeStatus = 'inside'; feeBase.mark.feesCoverageComplete = true; feeBase.mark.observedFeesSol = 0;
feeBase.lastObservationAt = new Date(now).toISOString(); feeBase.lastFeeRateAsOf = feeBase.lastObservationAt; feeBase.lastFeeRateHourly = .002;
const observed = {...observation(poolA), priceSol: .9, fetchedAt: new Date(now + 60_000).toISOString(), feeRateAsOf: new Date(now + 60_000).toISOString()};
const marked = markStillPosition(feeBase, observed, now + 60_000);
near(marked.mark.feesSol, feeBase.amountSol * .002 / 60); assert.equal(marked.mark.netPnlSol, null);
const missingRate = markStillPosition(feeBase, {...observed, feeRateHourly: null}, now + 60_000);
assert.equal(missingRate.mark.feesSol, null); assert.equal(missingRate.mark.netPnlSol, null);
assert.equal(markStillPosition(feeBase, {...observed, feeRateAsOf: null}, now + 60_000).mark.feesSol, null, 'A missing fee timestamp cannot borrow the price timestamp');
const regressed = markStillPosition(marked, {...observed, priceSol: .3, fetchedAt: new Date(now + 30_000).toISOString()}, now + 60_000);
assert.equal(regressed.mark.priceSol, .9); assert.equal(regressed.mark.asOf, marked.mark.asOf); assert.equal(regressed.mark.feesSol, null, 'Older provider marks do not replace newer observations');
const stale = markStillPosition(feeBase, observed, now + 11 * 60_000 + 1);
assert.equal(stale.mark.grossValueSol, null); assert.equal(stale.mark.feesSol, null);
const overnight = markStillPosition(feeBase, {...observed, fetchedAt: new Date(now + 86_400_000).toISOString(), feeRateAsOf: new Date(now + 86_400_000).toISOString()}, now + 86_400_000);
assert.equal(overnight.mark.feesSol, null); assert.equal(overnight.mark.observedFeesSol, 0, 'No model earnings over unobserved overnight period');
assert.equal(markStillPosition(feeBase, {...observed, fetchedAt: new Date(now + 120_000).toISOString()}, now + 60_000).mark.grossValueSol, null, 'Future prices rejected');
const otherPool = markStillPosition(feeBase, {...observed, poolAddress: poolB}, now + 60_000);
assert.equal(otherPool.mark.grossValueSol, null, 'Cannot mark with a different pool');
const missingThenFresh = markStillPosition(markStillPosition(feeBase, null, now + 10_000), observed, now + 60_000);
assert.equal(missingThenFresh.mark.feesSol, null, 'A later fresh observation cannot fill a missing fee interval');

// Reading an old journal must not present expired marks as current figures.
const originalNow = now; now += 11 * 60_000;
const oldView = await call('still-account');
assert.equal(oldView.body.account.positions.find(p => p.status === 'open').mark.grossPnlSol, null);
assert.notEqual(oldView.body.account.positions.find(p => p.status === 'closed').mark.grossPnlSol, null, 'Closed observations remain historical records');
now = originalNow;

// Public route keeps existing HttpOnly session and strict same-origin mutation checks.
let forwarded;
const env = {RANGE_ALERTS: {idFromName: name => name, get: () => ({fetch: async (url, options) => {forwarded = {url, options}; return new Response('{}', {headers: {'content-type': 'application/json'}});}})}};
const url = 'https://still.example/api/paper/';
let response = await worldsfairPaperRoute(new Request(url + 'still-account'), env);
assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
const cookie = response.headers.get('set-cookie').split(';')[0];
response = await worldsfairPaperRoute(new Request(url + 'still-open', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://attacker.example', cookie}, body: JSON.stringify(firstRequest)}), env);
assert.equal(response.status, 403);
response = await worldsfairPaperRoute(new Request(url + 'still-open', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://still.example', cookie}, body: JSON.stringify(firstRequest)}), env);
assert.equal(response.status, 200); assert.match(forwarded.url, /worldsfair-paper\/still-open$/);
assert.equal(forwarded.options.headers['x-worldsfair-account'].length, 64); assert.ok(!forwarded.url.includes(cookie));
console.log('Still paper ledger: identity, atomic baskets, confirmations, persistent idempotency, evidence gaps, gross settlement, and session isolation passed.');
