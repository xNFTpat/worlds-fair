import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'still-preflight-'));
try {
  await build({entryPoints: ['src/still-preflight.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'preflight.mjs')});
  const {listStillPools, buildStillBaskets, buildStillPreflight, combineStillBasketPreflight, getStillPreflight, getStillPoolMark, getStillBasketPreflight, STILL_MAX_PRICE_AGE_MS} = await import(pathToFileURL(join(dir, 'preflight.mjs')));
  const now = Date.UTC(2026, 9, 9, 10), at = new Date(now).toISOString(), SOL = 'So11111111111111111111111111111111111111112';
  const iso = ms => new Date(ms).toISOString();
  function pool(id, changes = {}) {
    return {id: 'solana:' + id, address: id, chain: 'solana', venue: 'meteora-dlmm', pair: 'TEST/SOL',
      base: {address: 'TestTokenMint', symbol: 'TEST'}, quote: {address: SOL, symbol: 'SOL'},
      fetchedAt: at, tvlUsd: 200_000, ageHours: 240, priceQuote: 0.01, priceUsd: 1, quotePriceUsd: 100,
      feeSource: 'reported', fees24hUsd: 4800, volume24hUsd: 960_000, feeTvl: {h1: .001, mid: .004, midHours: 4, h24: .024},
      activity: {fees1h: 200, fees4h: 800, fees12h: 2400, volume1h: 40_000, volume4h: 160_000},
      poolConfig: {binStep: 100, concentrated: true, feeSchedulerActive: false, compoundingFeePct: 0, launchpad: null},
      tags: [], feeTier: .0025, feeApr: 8.76, change24h: null, txns24h: null, url: 'https://example.invalid/pool', ...changes};
  }
  const steady = [pool('steady-a'), pool('steady-b')], busy = [pool('busy-a', {ageHours: 48}), pool('busy-b', {ageHours: 48})],
    spicy = [pool('spicy-a', {ageHours: 2}), pool('spicy-b', {ageHours: 2})];
  const snapshot = {pools: [...steady, ...busy, ...spicy, ...Array.from({length: 12}, (_, i) => pool('more-' + i)),
    pool('tiny', {tvlUsd: 35, fees24hUsd: 5_000_000}), pool('dust', {tvlUsd: 4999}), pool('old', {fetchedAt: iso(now - STILL_MAX_PRICE_AGE_MS - 1)}),
    pool('future', {fetchedAt: iso(now + 1)}), pool('other', {chain: 'robinhood'}), pool('wrong-venue', {venue: 'meteora-damm-v2'}),
    pool('fake-sol', {quote: {address: 'fake', symbol: 'SOL'}}), pool('bad-grid', {poolConfig: {binStep: 0}}), pool('suspect', {tags: ['suspect']}),
    pool('no-price', {priceQuote: null, priceUsd: null, quotePriceUsd: null})], updatedAt: at, errors: {}};
  const cards = listStillPools(snapshot, now);
  assert.equal(cards.length, 8);
  assert.equal(new Set(cards.map(item => item.address)).size, 8);
  assert.deepEqual(new Set(cards.map(item => item.risk.label)), new Set(['Steady', 'Busy', 'Spicy']));
  for (const excluded of ['tiny', 'dust', 'old', 'future', 'other', 'wrong-venue', 'fake-sol', 'bad-grid', 'suspect', 'no-price']) assert(!cards.some(item => item.address === excluded), excluded + ' excluded');
  assert.equal(cards[0].fees24hFraction.value, .024);
  assert.equal(cards[0].feeTrend.value, 0);
  const young = cards.find(item => item.address === 'spicy-a');
  assert.equal(young.fees24hFraction.value, null, 'a two-hour pool has no complete 24h fee window');
  assert.equal(young.feeTrend.value, null, 'cannot invent a daily comparator for a young pool');
  for (const card of cards) for (const name of ['tvlUsd', 'fees24hFraction', 'feeTrend', 'ageHours', 'priceSol', 'binStep']) {
    assert.equal(card[name].source, 'Meteora DLMM Data API'); assert.equal(card[name].asOf, at);
  }

  const baskets = buildStillBaskets(snapshot, now);
  assert.equal(baskets.length, 3);
  for (const basket of baskets) {
    assert.equal(basket.status, 'available'); assert.equal(basket.legs.length, 2);
    assert.equal(basket.legs.reduce((sum, item) => sum + item.weightBps, 0), 10_000);
    assert.equal(new Set(basket.legs.map(item => item.poolAddress)).size, 2);
    assert(basket.components.every(item => item.pool.risk.label === basket.name));
  }
  const emptyBaskets = buildStillBaskets({...snapshot, pools: [steady[0]]}, now);
  assert(emptyBaskets.every(item => item.status === 'unavailable' && item.legs.length === 0));
  assert.deepEqual(listStillPools({...snapshot, pools: []}, now), []);
  assert.match(baskets[0].reason, /does not diversify token exposure/, 'same-token fallback is disclosed');
  const distinct = pool('distinct', {tvlUsd: 150_000, base: {address: 'DifferentMint', symbol: 'OTHER'}, pair: 'OTHER/SOL'});
  const diverse = buildStillBaskets({...snapshot, pools: [...steady, distinct]}, now)[0];
  assert.deepEqual(new Set(diverse.components.map(item => item.pool.pairedMint)), new Set(['TestTokenMint', 'DifferentMint']), 'prefer another mint over a second pool for the same token');
  assert(!/does not diversify/.test(diverse.reason));

  const input = {pool: steady[0]}, preflight = buildStillPreflight(input, .5, now);
  assert.equal(preflight.canOpen, true, 'missing costs do not prevent a clearly labelled paper exercise');
  assert.equal(preflight.range.shape, 'BidAsk'); assert(preflight.range.binCount <= 69);
  assert(preflight.range.topPriceSol < preflight.priceSol.value, 'all-SOL range begins below the active price');
  assert.equal(preflight.range.alignment, 'assumed-active-price');
  assert(Math.abs(preflight.range.bins.reduce((sum, bin) => sum + bin.sol, 0) - .5) < 1e-12);
  assert(preflight.range.bins.every(bin => bin.token === 0));
  assert.equal(preflight.expectedFeesPerDaySol.value, .012);
  assert.match(preflight.expectedFeesPerDaySol.note, /not a forecast or earned fees/);
  assert.match(preflight.expectedFeesPerDaySol.note, /earns nothing until price enters/);
  assert.equal(preflight.entryConversionSol.value, 0, 'SOL-only allocation has no paired-token conversion at entry');
  for (const name of ['networkCostSol', 'entryCostSol', 'exitCostSol', 'roundTripCostSol', 'transferFeeBps']) assert.equal(preflight[name].value, null, name + ' cannot be guessed');
  assert.equal(preflight.verdict.label, 'Marginal');
  for (const scenario of preflight.scenarios) {
    assert(scenario.grossValueSol.value > 0 && scenario.grossValueSol.value < .5);
    assert.equal(scenario.pnlSol.value, null); assert.equal(scenario.netValueSol.value, null); assert.equal(scenario.vsHoldingSol.value, null);
    assert.match(scenario.grossValueSol.note, /before fees, transfer taxes/);
    assert.equal(scenario.grossValueSol.asOf, at);
  }
  assert(preflight.scenarios[1].grossValueSol.value < preflight.scenarios[0].grossValueSol.value);
  const narrow = buildStillPreflight({pool: pool('narrow', {poolConfig: {binStep: 1}})}, .5, now);
  assert.equal(narrow.canOpen, true, 'a small bin step may still support an honest narrow practice range');
  assert.equal(narrow.range.binCount, 69); assert(narrow.range.depthFraction < .01); assert.match(narrow.range.note, /cannot reach the deeper target/);
  for (const bad of [NaN, Infinity, -1, 0, 1000.1]) assert.throws(() => buildStillPreflight(input, bad, now));
  for (const change of [{fetchedAt: iso(now - STILL_MAX_PRICE_AGE_MS - 1)}, {fetchedAt: iso(now + 1)}, {poolConfig: {binStep: 0}}, {poolConfig: {binStep: 10_001}}, {priceQuote: null, priceUsd: null, quotePriceUsd: null}]) {
    const result = buildStillPreflight({pool: pool('bad', change)}, .5, now);
    assert.equal(result.canOpen, false); assert.equal(result.verdict.label, 'Skip');
  }
  const anchor = {status: 'available', asOf: at, activeBinId: 100, activeBinPriceSol: .012, binStep: 100, minNativeBinId: 80, maxNativeBinId: 200, slot: 12345, note: 'fixture'};
  const native = buildStillPreflight({...input, rangeAnchor: anchor}, .5, now);
  assert.equal(native.priceSol.value, .012); assert.equal(native.range.binCount, 20); assert.equal(native.range.alignment, 'native-active-bin');
  assert(native.range.bins.every(bin => bin.nativeBinId >= 80));
  const inverted = buildStillPreflight({pool: pool('inverted', {base: {address: SOL}, quote: {address: 'TestTokenMint'}, priceQuote: 100}), rangeAnchor: {...anchor, maxNativeBinId: 115}}, .5, now);
  assert.equal(inverted.range.binCount, 15); assert(inverted.range.bins.every(bin => bin.nativeBinId <= 115 && bin.nativeBinId > 100));
  assert.equal(buildStillPreflight({...input, rangeAnchor: {...anchor, minNativeBinId: 100}}, .5, now).canOpen, false, 'native limit at current bin cannot fund a lower bid');
  const rpc = {status: 'available', asOf: at, mint: 'TestTokenMint', transferFeeStatus: 'none', transferFee: null, freezeAuthority: null};
  const known = buildStillPreflight({...input, safety: {rpc}}, .5, now); assert.equal(known.transferFeeBps.value, 0);
  for (const change of [{status: 'stale'}, {mint: 'another'}, {asOf: iso(now - 300_001)}, {asOf: iso(now + 1)}]) assert.equal(buildStillPreflight({...input, safety: {rpc: {...rpc, ...change}}}, .5, now).transferFeeBps.value, null);
  assert.equal(buildStillPreflight({...input, safety: {rpc: {...rpc, freezeAuthority: 'active'}}}, .5, now).verdict.label, 'Skip');
  const tax = buildStillPreflight({...input, safety: {rpc: {...rpc, transferFeeStatus: 'known', transferFee: {bps: 150, maximumRaw: '10000', configAuthority: 'active'}}}}, .5, now);
  assert.equal(tax.transferFeeBps.value, 150); assert.equal(tax.verdict.label, 'Skip');
  const quote = {mode: 'best', sizeSol: .5, status: 'quoted', asOf: at, buyAsOf: at, sellAsOf: at, expiresAt: now + 45_000, exitFeeSource: 'jupiter-route', exitCostSol: .001, roundTripCostSol: .002};
  const quoted = buildStillPreflight({...input, quotes: [quote]}, .5, now);
  assert.equal(quoted.exitConversionSol.value, .001); assert.equal(quoted.exitCostSol.value, null, 'a swap quote alone is not an all-in LP exit cost');
  for (const change of [{sizeSol: 1}, {exitFeeSource: 'assumed'}, {exitFeeSource: undefined}, {status: 'stale'}, {expiresAt: now - 1}]) assert.equal(buildStillPreflight({...input, quotes: [{...quote, ...change}]}, .5, now).exitConversionSol.value, null);
  assert.equal(buildStillPreflight({...input, quotes: [{...quote, exitCostSol: .02}]}, .5, now).verdict.label, 'Skip');
  assert.equal(buildStillPreflight({pool: pool('zero', {activity: {fees1h: 0}})}, .5, now).verdict.label, 'Skip');

  const basket = baskets[0], memberPools = basket.legs.map(leg => snapshot.pools.find(item => item.address === leg.poolAddress));
  const legs = memberPools.map(pool => buildStillPreflight({pool}, .25, now));
  const combined = combineStillBasketPreflight(basket, legs, .5);
  assert.equal(combined.canOpen, true); assert.equal(combined.expectedFeesPerDaySol.value, .012);
  assert.equal(combined.entryCostSol.value, null); assert.equal(combined.scenarios[0].netValueSol.value, null);
  assert(Math.abs(combined.scenarios[0].grossValueSol.value - preflight.scenarios[0].grossValueSol.value) < 1e-12);
  assert.equal(combineStillBasketPreflight(basket, [legs[0]], .5).canOpen, false);
  assert.equal(combineStillBasketPreflight(basket, [{...legs[0], expectedFeesPerDaySol: {...legs[0].expectedFeesPerDaySol, value: null, status: 'unavailable'}}, legs[1]], .5).expectedFeesPerDaySol.value, null);
  assert.equal(combineStillBasketPreflight({...basket, legs: [{...basket.legs[0], weightBps: 6000}, basket.legs[1]]}, legs, .5).canOpen, false);
  assert.equal(combineStillBasketPreflight(basket, [{...legs[0], sizeSol: .5}, legs[1]], .5).canOpen, false);

  const originalNow = Date.now, originalFetch = globalThis.fetch;
  let fetches = 0;
  Date.now = () => now;
  globalThis.fetch = async () => { fetches++; throw Error('Provider fanout is forbidden in the fast demo path'); };
  const env = {LP_CACHE: {async get(key, type) { return key === 'snapshot:v1' ? snapshot : null; }}};
  try {
    const fast = await getStillPreflight(env, 'steady-a', .5); assert(fast.canOpen);
    assert.equal(await getStillPreflight(env, 'missing'), null);
    const mark = await getStillPoolMark(env, 'steady-a'); assert.equal(mark.priceSol, .01); assert.equal(mark.feeRateAsOf, at);
    const combinedFast = await getStillBasketPreflight(env, 'steady', .5); assert.equal(combinedFast.canOpen, true);
    assert.equal(fetches, 0);
    const thinMark = await getStillPoolMark(env, 'tiny'); assert.equal(thinMark.priceSol, .01, 'already-open positions can still be marked when liquidity falls below entry shortlist threshold');
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
  console.log('Still guided pre-flight: bounded current shortlist, exact basket splits, sourced fee windows, monotonic downside, native orientation, missing costs, quote freshness and no provider fanout passed');
} finally { await rm(dir, {recursive: true, force: true}); }
