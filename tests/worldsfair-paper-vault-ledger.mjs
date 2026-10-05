import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'worldsfair-vault-ledger-'));
await build({entryPoints: ['src/worldsfair-paper.ts', 'src/paper-fleet.ts'], outdir: dir, bundle: true, platform: 'node', format: 'esm', outExtension: {'.js': '.mjs'},
  plugins: [{name: 'controlled-paper-providers', setup(build) {
    build.onResolve({filter: /^\.\/worldsfair-paper-(?:baskets|vaults)$/}, args => ({path: args.path, namespace: 'fixture'}));
    build.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: args.path.endsWith('vaults') ? `
      export class PaperVaultError extends Error {constructor(message,status=503,code='vault_unavailable'){super(message);this.status=status;this.code=code;}}
      export const preparePaperVaultDeposit=(...args)=>globalThis.__vaultLedger.prepareVault(...args);
      export const accruePaperVault=(...args)=>globalThis.__vaultLedger.accrue(...args);
    ` : `
      export class PaperBasketError extends Error {constructor(message,status=503,code='basket_quotes_unconfigured'){super(message);this.status=status;this.code=code;}}
      export const preparePaperBasketPurchase=(...args)=>globalThis.__vaultLedger.prepareBasket(...args);
      export const markPaperBaskets=()=>{throw Error('Not used in this test');};
    `, loader: 'js'}));
  }}]});
const {WorldsfairRangeInbox} = await import(join(dir, 'worldsfair-paper.mjs'));
const {initialFleetState, fleetRisk} = await import(join(dir, 'paper-fleet.mjs'));
class Storage {
  rows = new Map(); batches = []; failCommit = false;
  async get(key) {return structuredClone(this.rows.get(key));}
  async put(key, value) {
    const rows = typeof key === 'string' ? {[key]: value} : key;
    if (this.failCommit && rows.fleet) {this.failCommit = false; throw Error('Atomic commit failed');}
    this.batches.push(Object.keys(rows));
    for (const [name, data] of Object.entries(rows)) this.rows.set(name, structuredClone(data));
  }
  async delete(key) {return this.rows.delete(key);}
  async list(options = {}) {let rows = [...this.rows].filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.end || key < options.end)).sort(([a], [b]) => a.localeCompare(b)); if (options.reverse) rows.reverse(); return new Map(rows.slice(0, options.limit || rows.length).map(([key, value]) => [key, structuredClone(value)]));}
}
const storage = new Storage(), kv = new Map();
let now = Date.parse('2026-10-05T18:00:00Z'), queue = Promise.resolve(), guarded = false, vaultCalls = 0, basketCalls = 0, mode = '', gate = null, failKv = false;
const actualNow = Date.now; Date.now = () => now;
const ctx = {storage, blockConcurrencyWhile(fn) {const pending = queue.then(async () => {assert.equal(guarded, false); guarded = true; try {return await fn();} finally {guarded = false;}}); queue = pending.catch(() => {}); return pending;}};
const object = new WorldsfairRangeInbox(ctx, {LP_CACHE: {put: async (key, value) => {if (failKv) throw Error('KV unavailable'); kv.set(key, value);}}});
const account = 'e'.repeat(64), other = 'f'.repeat(64), stateKey = 'wf:account:' + account;
const iso = () => new Date(now).toISOString();
const run = async (action, input, owner = account) => {
  const response = await object.fetch(new Request('https://paper/worldsfair-paper/' + action, {method: input ? 'POST' : 'GET', headers: {'x-worldsfair-account': owner}, ...(input ? {body: JSON.stringify(input)} : {})}));
  return {status: response.status, data: await response.json()};
};
const amounts = input => {const amountLamports = Math.round(Number(input.amountSol) * 1e9); return {amountLamports, costSol: amountLamports / 1e9};};
globalThis.__vaultLedger = {
  async prepareVault(_env, input) {
    assert.equal(guarded, false, 'Vault provider runs outside the Durable Object guard'); vaultCalls++;
    if (gate) await gate;
    if (mode === 'vault-fail') throw Error('No verified vault quote');
    if (mode === 'vault-null') return null;
    const amount = amounts(input);
    return {paper: true, kind: 'vault', ideaId: input.ideaId, name: 'Fixture SOL staking', asset: 'SOL', mint: 'native-sol', principalUnitsRaw: String(amount.amountLamports), decimals: 9,
      ...amount, rate: 8, rateType: 'APY', rateAsOf: null, rateReadAt: iso(), preparedAt: iso(), quoteAsOf: iso(), expiresAt: mode === 'expired' ? now - 1 : now + 60000,
      entrySolUsd: 100, assetPriceUsd: 100, assetPriceAsOf: iso(), priceImpactFraction: 0, basis: 'native-sol', risk: 'Fixture', exit: 'Fixture', note: mode === 'huge' ? 'x'.repeat(110000) : 'Underlying SOL estimate'};
  },
  async prepareBasket(_env, input) {
    assert.equal(guarded, false, 'Basket provider runs outside the Durable Object guard'); basketCalls++;
    if (gate) await gate;
    if (mode === 'basket-fail') throw Error('Missing basket quote key');
    if (mode === 'basket-null') return null;
    const amount = amounts(input);
    return {paper: true, kind: 'basket', slug: input.slug, name: 'Fixture basket', ...amount, allocationReadAt: iso(), preparedAt: iso(), quoteAsOf: iso(), expiresAt: now + 60000,
      entrySolUsd: 100, entryPriceAsOf: iso(), note: 'Fixture', legs: [{mint: 'fixture-token', symbol: 'FIX', weight: 100, inputLamports: amount.amountLamports, unitsRaw: String(amount.amountLamports), decimals: 9, priceImpactFraction: .01, quoteAsOf: iso(), contextSlot: 123}]};
  },
  accrue(holding, at) {const principalUnits = Number(holding.principalUnitsRaw) / 10 ** holding.decimals, elapsedYears = (at - Date.parse(holding.openedAt)) / (365.25 * 86400000), accruedUnits = principalUnits * holding.rate / 100 * elapsedYears; return {holdingId: holding.id, status: 'estimated', asOf: new Date(at).toISOString(), asset: holding.asset, principalUnits, accruedUnits, estimatedUnits: principalUnits + accruedUnits, elapsedYears, rate: holding.rate, rateType: holding.rateType, label: 'estimate at quoted rate', note: 'Fixture linear accrual'};},
};
const rule = {enabled: true, lpPercent: 50, vaultPercent: 25, basketPercent: 25, vaultId: 'backyard:fixture', basketSlug: 'fixture-basket'};
const saveRule = async (changes = {}, id = 'save-profit-rule') => run('rule', {...rule, ...changes, requestId: id});
const addClose = async (suffix, pnlSol = .4) => {
  const fleet = await storage.get('fleet') || initialFleetState(); fleet.lastScanAt = iso();
  if (!storage.rows.has('fleet')) {fleet.portfolios.farmer.cashSol = 110; fleet.portfolios.farmer.peakSol = 125; fleet.portfolios.farmer.realizedPnlSol = 10;}
  const trade = {id: 'fleet:farmer:fixture:' + suffix, arm: 'farmer', closedAt: iso(), openedAt: new Date(now - 3600000).toISOString(), pair: 'FIX/SOL', poolAddress: 'fixture', pnlSol, exitSol: 1 + pnlSol, budgetSol: 1, entryNetworkSol: 0, feesSol: pnlSol, reason: 'Scored fixture close'};
  fleet.closed.push(trade); await storage.put({fleet, ['fleet-trade:' + trade.closedAt + ':' + trade.id]: trade});
  return {source: 'fleet', id: trade.id, closedAt: trade.closedAt, requestId: 'roll-' + suffix};
};
const advance = () => {now += 61000;};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
try {
  let result = await run('account'); assert.deepEqual(result.data.account.profitRule, {enabled: false, lpPercent: 50, vaultPercent: 25, basketPercent: 25, vaultId: null, basketSlug: null, version: 0});
  await run('seed', {amountSol: '2', requestId: 'seed-vault-pot'});
  const deposit = {ideaId: 'backyard:fixture', amountSol: '0.25', requestId: 'deposit-first'};
  result = await run('deposit', deposit); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.account.balanceSol, 1.75); assert.equal(result.data.account.holdings[0].principalUnitsRaw, '250000000'); assert.equal(result.data.account.holdings[0].rateAsOf, null);
  assert.equal(result.data.account.holdings[0].accrual.principalUnits, .25); assert.equal(result.data.receipt.kind, 'deposit');
  assert.deepEqual(result.data.receipt.allocationSnapshot, {cashSol: 1.75, lpContributedSol: 0, vaultCostSol: .25, basketCostSol: 0});
  const calls = vaultCalls; assert.equal((await run('deposit', deposit)).status, 200); assert.equal(vaultCalls, calls);
  assert.equal((await run('deposit', {...deposit, amountSol: '.5'})).status, 400);
  assert.equal((await run('deposit', {...deposit, amountSol: '0.5'})).status, 409);
  assert.equal((await run('deposit', {...deposit, requestId: 'forged-rate', rate: 999})).status, 400);
  assert.equal((await run('deposit', {...deposit, requestId: 'other-person'}, other)).status, 409); assert.equal(vaultCalls, calls);
  for (const bad of ['vault-fail', 'expired', 'huge']) {advance(); mode = bad; assert.ok((await run('deposit', {...deposit, requestId: 'failed-' + bad})).status >= 400); assert.equal((await storage.get(stateKey)).balanceLamports, 1750000000);}
  mode = ''; advance();
  assert.equal((await saveRule({lpPercent: 51}, 'invalid-rule')).status, 400);
  assert.equal((await saveRule({vaultId: null}, 'invalid-target')).status, 400);
  result = await saveRule(); assert.equal(result.status, 200); assert.equal(result.data.account.profitRule.version, 1);
  const roll = await addClose('split-first'), before = await storage.get('fleet'), beforeRisk = fleetRisk(before, 'farmer', now).drawdown;
  result = await run('roll', roll); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.account.balanceSol, 1.75, 'Enabled rule allocates to holdings without temporary idle cash'); assert.equal(result.data.account.holdings.length, 3);
  assert.deepEqual(result.data.receipt.ruleAllocation, {lpSol: .2, vaultSol: .1, basketSol: .1}); assert.equal(result.data.receipt.amountSol, .2); assert.equal(result.data.receipt.retainedSol, .2);
  assert.deepEqual(result.data.receipt.allocationSnapshot, {cashSol: 1.75, lpContributedSol: .2, vaultCostSol: .35, basketCostSol: .1});
  const after = await storage.get('fleet'); near(after.portfolios.farmer.cashSol, 109.8); near(after.portfolios.farmer.withdrawnSol, .2); near(fleetRisk(after, 'farmer', now).drawdown, beforeRisk);
  assert.equal(after.portfolios.farmer.realizedPnlSol, 10); assert.equal(after.revision, before.revision + 1);
  assert.ok(storage.batches.some(keys => keys.includes('fleet') && keys.includes(stateKey) && keys.some(key => key.startsWith('wf:claim:')) && keys.some(key => key.startsWith('wf:receipt:')) && keys.some(key => key.startsWith('wf:event:')) && keys.includes('wf:outbox:' + account)));
  const beforeReplayCalls = vaultCalls + basketCalls;
  await saveRule({enabled: false}, 'disable-after-roll');
  result = await run('roll', roll); assert.equal(result.status, 200); assert.equal(result.data.receipt.ruleApplied, true); assert.equal(vaultCalls + basketCalls, beforeReplayCalls, 'Saved request replays its original split even after rule changes');
  assert.equal((await run('roll', {...roll, requestId: 'other-close-claim'}, other)).status, 409);

  // A failed leg leaves no close claim, account mutation or source debit; same request can recover.
  advance(); await saveRule({}, 'enable-again'); const failedRoll = await addClose('failed-leg'); mode = 'basket-fail';
  const originalState = await storage.get(stateKey), originalFleet = await storage.get('fleet');
  assert.equal((await run('roll', failedRoll)).status, 503); assert.deepEqual(await storage.get(stateKey), originalState); assert.deepEqual(await storage.get('fleet'), originalFleet);
  for (const emptyLeg of ['vault-null', 'basket-null']) {
    mode = emptyLeg; result = await run('roll', failedRoll); assert.equal(result.status, 503); assert.equal(result.data.code, 'paper_allocation_incomplete');
    assert.deepEqual(await storage.get(stateKey), originalState); assert.deepEqual(await storage.get('fleet'), originalFleet);
  }
  mode = ''; failKv = true; result = await run('roll', failedRoll); assert.equal(result.status, 200); assert.equal(result.data.persistence, 'retrying');
  const postCalls = vaultCalls + basketCalls; result = await run('roll', failedRoll); assert.equal(result.status, 200); assert.equal(vaultCalls + basketCalls, postCalls);
  failKv = false; assert.equal((await run('account')).data.persistence, 'saved'); assert.ok(kv.has(stateKey));

  // Quote preparation must not prevent editing the rule; commit rejects a changed rule version.
  advance(); const raceRoll = await addClose('changed-rule'); let release; gate = new Promise(resolve => {release = resolve;});
  const race = run('roll', raceRoll); await new Promise(resolve => setTimeout(resolve, 10));
  await saveRule({lpPercent: 100, vaultPercent: 0, basketPercent: 0, vaultId: null, basketSlug: null}, 'all-lp-rule');
  const beforeRaceState = await storage.get(stateKey), beforeRaceFleet = await storage.get('fleet'); release(); gate = null;
  result = await race; assert.equal(result.status, 409); assert.equal(result.data.code, 'paper_rule_changed'); assert.deepEqual(await storage.get(stateKey), beforeRaceState); assert.deepEqual(await storage.get('fleet'), beforeRaceFleet);
  const providerCount = vaultCalls + basketCalls; result = await run('roll', raceRoll); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.receipt.amountSol, 0); assert.deepEqual(result.data.receipt.ruleAllocation, {lpSol: .4, vaultSol: 0, basketSol: 0}); assert.deepEqual(result.data.receipt.holdingIds, []); assert.equal(vaultCalls + basketCalls, providerCount, '100% LP requires no provider');
  assert.equal((await storage.get('fleet')).portfolios.farmer.cashSol, beforeRaceFleet.portfolios.farmer.cashSol);

  // Any atomic storage failure leaves both sides untouched and remains safely retryable.
  advance(); await saveRule({}, 'restore-split'); const atomicRoll = await addClose('atomic-fail'); storage.failCommit = true;
  const atomicState = await storage.get(stateKey), atomicFleet = await storage.get('fleet'); assert.equal((await run('roll', atomicRoll)).status, 503); assert.deepEqual(await storage.get(stateKey), atomicState); assert.deepEqual(await storage.get('fleet'), atomicFleet);
  assert.equal((await run('roll', atomicRoll)).status, 200);

  // Simultaneous retries share both quote reads and commit one allocation.
  advance(); const repeatedRoll = await addClose('concurrent-retry'); gate = new Promise(resolve => {release = resolve;});
  const oldVaultCalls = vaultCalls, oldBasketCalls = basketCalls, oldHoldings = (await storage.get(stateKey)).holdings.length;
  const repeatedA = run('roll', repeatedRoll), repeatedB = run('roll', repeatedRoll);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(vaultCalls, oldVaultCalls + 1); assert.equal(basketCalls, oldBasketCalls + 1);
  release(); gate = null; const repeatedResults = await Promise.all([repeatedA, repeatedB]);
  assert.deepEqual(repeatedResults.map(row => row.status), [200, 200]); assert.deepEqual(repeatedResults[0].data.receipt, repeatedResults[1].data.receipt);
  assert.equal((await storage.get(stateKey)).holdings.length, oldHoldings + 2);

  // Source cash committed while quotes load must never fund another set of holdings.
  advance(); const cashRoll = await addClose('cash-race'); gate = new Promise(resolve => {release = resolve;}); const cashRace = run('roll', cashRoll);
  await new Promise(resolve => setTimeout(resolve, 10)); const changedFleet = await storage.get('fleet'); changedFleet.portfolios.farmer.cashSol = .01; await storage.put('fleet', changedFleet); const beforeCashState = await storage.get(stateKey);
  release(); gate = null; result = await cashRace; assert.equal(result.status, 409); assert.deepEqual(await storage.get(stateKey), beforeCashState); assert.equal((await storage.get('fleet')).portfolios.farmer.cashSol, .01);

  // Read-time accrual does not mutate saved units, quote rate, or the cash ledger.
  const saved = await storage.get(stateKey); now += 365.25 * 86400000; result = await run('account');
  assert.ok(result.data.account.holdings[0].accrual.accruedUnits > .019); assert.deepEqual(await storage.get(stateKey), saved);
  console.log('PASS: vault debit/replay, quote failures, unchanged capital during refresh, rule validation and exact split, all-leg atomicity, no idle credit, 100% LP, rule/cash races, source risk preservation, storage/KV recovery and read-time accrual.');
} finally {Date.now = actualNow; delete globalThis.__vaultLedger;}
