import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'still-preflight-'));
try {
  await build({entryPoints: ['src/still-preflight.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'preflight.mjs')});
  const {listStillPools, listStillPoolsWithSummaries, buildStillBaskets, buildStillPreflight, combineStillBasketPreflight, getStillPreflight, getStillPoolMark, getStillBasketPreflight, STILL_MAX_PRICE_AGE_MS} = await import(pathToFileURL(join(dir, 'preflight.mjs')));
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
    assert.equal(basket.status, 'available'); assert.equal(basket.legs.length, basket.id==='spicy'?1:2);
    assert.equal(basket.legs.reduce((sum, item) => sum + item.weightBps, 0), 10_000);
    assert.equal(new Set(basket.legs.map(item => item.poolAddress)).size, basket.legs.length);
    assert.equal(basket.name,{steady:'Calm start',busy:'Learn the busy ones',spicy:'See a bad day'}[basket.id]);
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
  assert.equal(preflight.verdict.label, 'Skip', 'Fee pace below configured example threshold fails');
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
  for (const change of [{status: 'stale'}, {mint: 'another'}, {asOf: iso(now - 600_001)}, {asOf: iso(now + 1)}]) assert.equal(buildStillPreflight({...input, safety: {rpc: {...rpc, ...change}}}, .5, now).transferFeeBps.value, null);
  assert.equal(buildStillPreflight({...input, safety: {rpc: {...rpc, freezeAuthority: 'active'}}}, .5, now).verdict.label, 'Skip');
  const tax = buildStillPreflight({...input, safety: {rpc: {...rpc, transferFeeStatus: 'known', transferFee: {bps: 150, maximumRaw: '10000', configAuthority: 'active'}}}}, .5, now);
  assert.equal(tax.transferFeeBps.value, 150); assert.equal(tax.verdict.label, 'Skip');
  const quote = {mode: 'best', sizeSol: .5, status: 'quoted', asOf: at, buyAsOf: at, sellAsOf: at, expiresAt: now + 45_000, exitFeeSource: 'jupiter-route', exitCostSol: .001, roundTripCostSol: .002};
  const quoted = buildStillPreflight({...input, quotes: [quote]}, .5, now);
  assert.equal(quoted.exitConversionSol.value, .001); assert.equal(quoted.exitCostSol.value, null, 'a swap quote alone is not an all-in LP exit cost');
  for (const change of [{sizeSol: 1}, {exitFeeSource: 'assumed'}, {exitFeeSource: undefined}, {status: 'stale'}, {expiresAt: now - 1}]) assert.equal(buildStillPreflight({...input, quotes: [{...quote, ...change}]}, .5, now).exitConversionSol.value, null);
  assert.equal(buildStillPreflight({...input, quotes: [{...quote, exitCostSol: .02}]}, .5, now).verdict.label, 'Skip');
  assert.equal(buildStillPreflight({pool: pool('zero', {activity: {fees1h: 0}})}, .5, now).verdict.label, 'Skip');

  // Costs must become usable from real, dated inputs without weakening screening.
  const network = {asOf: at, singleLamports: 5000, doubleLamports: 10000, source: 'Fixture RPC fee observations'};
  const healthyPool = pool('steady-a', {activity: {...steady[0].activity, fees1h: 1200}});
  const healthyRpc = {...rpc, decimals: 6, holderSample: {status: 'available', asOf: at, mint: rpc.mint, supplyRaw: '1000', complete: true,
    accounts: Array.from({length: 40}, (_, i) => ({address: 'account-' + i, owner: 'owner-' + i, amountRaw: '25'}))}};
  const candles = {status: 'available', asOf: at, note: 'Meteora exact-pool fixture', candles: Array.from({length: 24}, (_, i) =>
    ({t: now / 1000 - (24 - i) * 3600, o: .01, c: .01, h: .0105, l: .0095, v: 100}))};
  const setupAnchor={status:'available',asOf:at,activeBinId:0,activeBinPriceSol:.01,binStep:100,minNativeBinId:-10000,maxNativeBinId:10000};
  const accountCosts={asOf:at,poolAddress:healthyPool.address,positionBytes:8120,positionRentLamports:57406080,setupRentLamports:0,missingAccounts:0,rangeKey:'-1',source:'Fixture RPC',note:'Fixture'};
  const healthyInput = {accountCosts,rangeAnchor:setupAnchor,pool: healthyPool, safety: {rpc: healthyRpc}, network, quotes: [quote], candles,
    rug: {mint: rpc.mint, status: 'available', asOf: at, holderExclusions: {mint: rpc.mint, status: 'available', asOf: at, addresses: []}}};
  const modeled = buildStillPreflight(healthyInput, .5, now);
  const closeTo = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-12, message + ': ' + actual + ' vs ' + expected);
  assert.equal(modeled.verdict.label, 'Worth it', 'complete healthy evidence can pass; missing cost must not be the default');
  assert.equal(modeled.checks.find(c => c.id === 'cost').status, 'pass');
  assert.doesNotMatch(modeled.checks.find(c => c.id === 'cost').result, /unavailable/i);
  closeTo(modeled.entryCostSol.value, .00001, 'SOL-only entry has the observed two-signature base fee');
  closeTo(modeled.exitCostSol.value, .00101, 'reference exit plus observed close and swap base fees');
  closeTo(modeled.roundTripCostSol.value, .00102, 'costs include each declared fee once');
  closeTo(modeled.paperCostModel.netAfterHoldSol.value, .01098, 'four-hour paper fee projection subtracts modeled costs');
  assert.equal(modeled.ledger.entryCostsSol, modeled.entryCostSol.value);
  assert.equal(modeled.ledger.exitCostsSol, modeled.exitCostSol.value);
  assert.match(modeled.paperCostModel.note, /not an LP transaction simulation/);
  assert.match(modeled.paperCostModel.netAfterHoldSol.note, /eligible in-range liquidity/);
  for (const field of ['entryCostSol', 'exitCostSol', 'roundTripCostSol', 'networkCostSol']) assert.equal(modeled[field].asOf, at);
  assert.equal(modeled.scenarios[0].netValueSol.value, null, 'a current reference cannot quote future stressed inventory');
  assert.match(modeled.scenarios[0].netValueSol.note, /future stressed withdrawal/);
  // A directly observed quote drag must not inherit Research's assumed fee floor.
  const assumedFloorQuote = {...quote, exitFeeSource: 'assumed', exitCostSol: .05, quotedExitDragSol: .0002};
  const actualDrag = buildStillPreflight({...healthyInput, quotes: [assumedFloorQuote]}, .5, now);
  closeTo(actualDrag.exitConversionSol.value, .0002, 'measured net-proceeds drag is independent of the assumed route-fee floor');
  closeTo(actualDrag.exitCostSol.value, .00021, 'RPC base fees are added once to measured drag');
  assert.equal(actualDrag.checks.find(c => c.id === 'cost').status, 'pass');
  assert.match(actualDrag.exitConversionSol.note, /zero drag does not mean zero swap fees/);
  const favorableRoute = buildStillPreflight({...healthyInput, quotes: [{...assumedFloorQuote, quotedExitDragSol: 0}]}, .5, now);
  assert.equal(favorableRoute.exitConversionSol.value, 0, 'observed nonnegative drag may be zero when better route pricing offsets fees');
  closeTo(favorableRoute.exitCostSol.value, .00001, 'zero conversion drag does not erase the network fee plan');
  for (const drag of [undefined, null, -1, NaN, Infinity]) {
    const result = buildStillPreflight({...healthyInput, quotes: [{...assumedFloorQuote, quotedExitDragSol: drag}]}, .5, now);
    assert.equal(result.exitConversionSol.value, null, 'absent/invalid measured drag cannot promote an assumed fee floor');
    assert.equal(result.roundTripCostSol.value, null);
  }
  for (const change of [{sizeSol: 1}, {status: 'stale'}, {expiresAt: now - 1}, {asOf: iso(now + 1), buyAsOf: iso(now + 1), sellAsOf: iso(now + 1)}]) {
    assert.equal(buildStillPreflight({...healthyInput, quotes: [{...assumedFloorQuote, ...change}]}, .5, now).exitConversionSol.value, null, 'measured drag still requires fresh, exact-size quotes');
  }
  const longHold = {shape: 'BidAsk', floorPct: 47.5, ceilingPct: 0, holdMinutes: 2880};
  for (const [totalExit, status] of [[.005, 'pass'], [.00500001, 'caution'], [.015, 'caution'], [.01500001, 'fail']]) {
    const result = buildStillPreflight({...healthyInput, quotes: [{...quote, exitCostSol: totalExit - .00001}]}, .5, now, longHold);
    assert.equal(result.checks.find(c => c.id === 'cost').status, status, 'exit threshold includes the RPC base-fee plan at ' + totalExit);
  }
  assert.equal(buildStillPreflight(healthyInput, .5, now, {...longHold, holdMinutes: 1}).checks.find(c => c.id === 'cost').status, 'fail', 'cost exceeding planned-hold fees fails even below 1%');
  const frozen = buildStillPreflight({...healthyInput, safety: {rpc: {...healthyRpc, freezeAuthority: 'active'}}}, .5, now);
  assert.equal(frozen.verdict.label, 'Skip'); assert.match(frozen.verdict.reason, /freeze authority/);
  for (const invalidNetwork of [null, {...network, asOf: iso(now - 600001)}, {...network, asOf: iso(now + 1)}, {...network, asOf: 'invalid'},
    {...network, singleLamports: -1}, {...network, doubleLamports: 1.5}, {...network, singleLamports: Number.MAX_SAFE_INTEGER + 1}]) {
    const result = buildStillPreflight({...healthyInput, network: invalidNetwork}, .5, now);
    for (const field of ['entryCostSol', 'exitCostSol', 'roundTripCostSol', 'networkCostSol']) assert.equal(result[field].value, null, field + ' rejects invalid network evidence');
    assert.equal(result.paperCostModel.netAfterHoldSol.value, null); assert.equal(result.verdict.label, 'Marginal');
    assert.equal(result.exitConversionSol.value, .001, 'an unavailable network read does not erase valid swap evidence');
  }
  const olderNetwork = buildStillPreflight({...healthyInput, network: {...network, asOf: iso(now - 9 * 60000)}}, .5, now);
  assert.equal(olderNetwork.networkCostSol.value, modeled.networkCostSol.value);
  assert.equal(olderNetwork.networkCostSol.asOf, iso(now - 9 * 60000), 'base-fee reuse never renews its observed timestamp');
  assert.match(olderNetwork.networkCostSol.note, /at most ten minutes/);
  const apiMarkedQuote = {...assumedFloorQuote, priceMark: {source: 'meteora-pool', asOf: iso(now - 1000), priceSol: .01, poolAddress: healthyPool.address, mint: healthyRpc.mint}};
  const apiMarked = buildStillPreflight({...healthyInput, quotes: [apiMarkedQuote]}, .5, now);
  assert.equal(apiMarked.exitConversionSol.value, .0002);
  assert.match(apiMarked.exitConversionSol.source, /Meteora DLMM Data API exact-pool price/);
  assert.match(apiMarked.exitCostSol.source, /Meteora DLMM Data API/);
  assert.equal(apiMarked.exitConversionSol.asOf, iso(now - 1000));
  assert.match(apiMarked.range.note, /Native bin alignment is verified/);
  const entryWithoutExit = buildStillPreflight({...healthyInput, quotes: []}, .5, now);
  closeTo(entryWithoutExit.entryCostSol.value, .00001, 'entry estimate does not depend on exit quote availability');
  assert.equal(entryWithoutExit.entryCostSol.asOf, at); assert.equal(entryWithoutExit.exitCostSol.value, null);
  assert.equal(entryWithoutExit.paperCostModel.netAfterHoldSol.value, null);
  const dated = buildStillPreflight({...healthyInput, network: {...network, asOf: iso(now - 1000)}, safety: {rpc: {...healthyRpc, asOf: iso(now - 2000)}},
    quotes: [{...quote, asOf: iso(now - 3000), buyAsOf: iso(now - 3000), sellAsOf: iso(now - 3000), expiresAt: now + 42000}]}, .5, now);
  assert.equal(dated.entryCostSol.asOf, iso(now - 1000)); assert.equal(dated.exitCostSol.asOf, iso(now - 3000)); assert.equal(dated.paperCostModel.asOf, iso(now - 3000));
  for (const [bps, authority, expectedTax] of [[0, null, 'pass'], [0, 'active', 'fail'], [150, null, 'caution'], [201, null, 'fail']]) {
    const result = buildStillPreflight({...healthyInput, safety: {rpc: {...healthyRpc, transferFeeStatus: 'known', transferFee: {bps, maximumRaw: '10000', configAuthority: authority}}}}, .5, now);
    assert.equal(result.checks.find(c => c.id === 'tax').status, expectedTax);
    if (authority) {assert.equal(result.verdict.label, 'Skip'); assert.match(result.verdict.reason, /authority/);}
    if (bps > 0) {closeTo(result.exitTransferFeeSol.value,.0001,'Token-2022 cap applies to raw token units');closeTo(result.roundTripCostSol.value,modeled.roundTripCostSol.value+.0001,'Jupiter swap tax is embedded; only separate withdrawal tax is added');}
    else assert(result.roundTripCostSol.value > 0, 'observed zero-tax costs remain visible even when mutable policy separately fails');
  }
  const twoSidedRange = {shape: 'Spot', floorPct: 10, ceilingPct: 10, holdMinutes: 30};
  function fundedInput(size) {
    const detail = {...healthyInput, quotes: [{...quote, sizeSol: size}]}, preliminary = buildStillPreflight(detail, size, now, twoSidedRange);
    const funding = Math.round(preliminary.range.bins.reduce((sum, b) => sum + b.token * .01, 0) * 1e9) / 1e9;
    assert(funding > .001 && funding < size, 'two-sided range needs a genuine partial token purchase');
    const fundingQuote = {...quote, sizeSol: funding, inputRaw: String(Math.round(funding * 1e9)), tokenRaw: String(Math.floor((funding - .001) / .01 * 1e6))};
    return {...detail, accountCosts:{...accountCosts,rangeKey:'-1,0'}, entryQuotes: [fundingQuote]};
  }
  const fundedDetail = fundedInput(.5), funded = buildStillPreflight(fundedDetail, .5, now, twoSidedRange), fundingQuote = fundedDetail.entryQuotes[0];
  const quotedEntryLoss = Number(fundingQuote.inputRaw) / 1e9 - Number(fundingQuote.tokenRaw) / 1e6 * .01;
  closeTo(funded.entryConversionSol.value, quotedEntryLoss, 'two-sided conversion uses exact funding quote amounts');
  closeTo(funded.entryCostSol.value, quotedEntryLoss + .000015, 'two-sided entry includes one funding-swap base fee');
  closeTo(funded.networkCostSol.value, .000025, 'declared open, entry swap, close and exit swap base fees');
  assert.equal(funded.entryConversionSol.asOf, at); assert(funded.paperCostModel.netAfterHoldSol.value !== null);
  for (const change of [{sizeSol: fundingQuote.sizeSol + .001}, {status: 'stale'}, {expiresAt: now - 1}, {tokenRaw: 'NaN'}, {inputRaw: '-1'}]) {
    const result = buildStillPreflight({...fundedDetail, entryQuotes: [{...fundingQuote, ...change}]}, .5, now, twoSidedRange);
    assert.equal(result.entryCostSol.value, null, 'invalid or mismatched funding quotes never imply free entry');
    assert.equal(result.paperCostModel.netAfterHoldSol.value, null);
  }

  const basket = baskets[0], memberPools = basket.legs.map(leg => snapshot.pools.find(item => item.address === leg.poolAddress));
  const legs = memberPools.map(pool => buildStillPreflight({pool}, .25, now));
  const combined = combineStillBasketPreflight(basket, legs, .5);
  assert.equal(combined.canOpen, true); assert.equal(combined.expectedFeesPerDaySol.value, .012);
  assert.equal(combined.entryCostSol.value, null); assert.equal(combined.scenarios[0].netValueSol.value, null);
  assert(combined.scenarios[0].grossValueSol.value>0);
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
    // Pool cards reuse only exact default-size evidence, with bounded KV reads.
    const cardKeys = [], firstAddress = cards[0].address;
    const cardInput = {...healthyInput,accountCosts:{...accountCosts,poolAddress:firstAddress}, pool: {...healthyPool, id: cards[0].id, address: firstAddress}};
    const cardEnv = {LP_CACHE: {async get(key) {
      cardKeys.push(key);
      return key === 'still:preflight-input:v3:' + firstAddress + ':500000000:null' ? {at, input: cardInput} : null;
    }}};
    const summaries = await listStillPoolsWithSummaries(snapshot, cardEnv, now);
    assert.equal(summaries.length, 8); assert.equal(cardKeys.length, 8);
    assert.equal(new Set(cardKeys).size, 8);
    assert.deepEqual(cardKeys, cards.map(card => 'still:preflight-input:v3:' + card.address + ':500000000:null'));
    assert.equal(summaries[0].cardSummary.verdict.label, 'Worth it', 'fresh default evidence may produce a real passing card');
    for (const card of summaries) {
      assert.equal(card.cardSummary.sizeSol, .5); assert.equal(card.cardSummary.scope, '0.5 paper SOL · default range');
      assert.equal(card.cardSummary.reasons.length, 3);
      assert(card.cardSummary.reasons.every(reason => !['half', 'drop20'].includes(reason.id) && reason.source && typeof reason.result === 'string'));
      assert(card.cardSummary.reasons.every(reason => reason.asOf === null || reason.asOf === at));
    }
    const missingSummary = summaries[1].cardSummary;
    assert.equal(missingSummary.verdict.label, 'Skip', 'a real low-fee failure survives missing provider data');
    assert.equal(missingSummary.reasons[0].id, 'fees'); assert.equal(missingSummary.reasons[0].status, 'fail');
    assert(missingSummary.reasons.some(reason => reason.id === 'cost' && reason.status === 'unavailable'));
    assert.match(missingSummary.note, /Pool observations only/);

    const singleSnapshot = {...snapshot, pools: [healthyPool]};
    async function oneSummary(saved) {
      let reads = 0;
      const result = await listStillPoolsWithSummaries(singleSnapshot, {LP_CACHE: {async get(key) {
        reads++; assert.equal(key, 'still:preflight-input:v3:steady-a:500000000:null');
        if (saved instanceof Error) throw saved;
        return saved;
      }}}, now);
      assert.equal(reads, 1);
      return result[0].cardSummary;
    }
    const fallback = await oneSummary(null);
    assert.equal(fallback.verdict.label, 'Marginal', 'a good fee observation cannot promote missing costs to Pass');
    assert(fallback.reasons.every(reason => reason.status === 'unavailable'));
    for (const invalid of [{at: iso(now - 45001), input: healthyInput}, {at: iso(now + 1), input: healthyInput},
      {at: 'invalid', input: healthyInput}, {at, input: {...healthyInput, pool: {...healthyPool, address: 'different-pool'}}},
      {at, input: {...healthyInput, pool: {...healthyPool, base: {address: 'different-mint'}}}},
      {at, input: {...healthyInput, pool: {...healthyPool, base: healthyPool.quote, quote: healthyPool.base, priceQuote: 100}}},
      {at, input: {...healthyInput, pool: {...healthyPool, poolConfig: {...healthyPool.poolConfig, binStep: 200}}}},
      {at, input: {...healthyInput, pool: {...healthyPool, fetchedAt: iso(now - STILL_MAX_PRICE_AGE_MS - 1)}}},
      {at, input: {...healthyInput, quotes: {bad: true}}}, {at, input: null}, new Error('KV unavailable')]) {
      assert.deepEqual(await oneSummary(invalid), fallback, 'expired, future, malformed or mismatched cached evidence falls back to real pool observations');
    }
    const boundary = await oneSummary({at: iso(now - 45000), input: healthyInput});
    assert.equal(boundary.verdict.label, 'Worth it', '45-second wrapper boundary is inclusive; evidence still validates independently');
    for (const expiredInput of [
      {...healthyInput, quotes: [{...quote, expiresAt: now - 1}]},
      {...healthyInput, network: {...network, asOf: iso(now - 600001)}},
      {...healthyInput, quotes: [{...quote, sizeSol: .37}]},
      {...healthyInput, safety: {rpc: {...healthyRpc, asOf: iso(now - 600001)}}},
    ]) {
      const expired = await oneSummary({at, input: expiredInput});
      assert.equal(expired.verdict.label, 'Marginal', 'a fresh cache wrapper cannot retain a verdict after underlying evidence expires or size changes');
      assert(expired.reasons.some(reason => reason.id === 'cost' && reason.status === 'unavailable'));
    }
    const frozenSummary = await oneSummary({at, input: {...healthyInput, safety: {rpc: {...healthyRpc, freezeAuthority: 'active'}}}});
    assert.equal(frozenSummary.verdict.label, 'Skip');
    assert.equal(frozenSummary.reasons[0].id, 'freeze'); assert.equal(frozenSummary.reasons[0].status, 'fail');
    assert.match(frozenSummary.reasons[0].result, /freeze authority/);
    assert.equal(frozenSummary.reasons[0].asOf, at);
    const rangeSummary = await oneSummary({at, input: {...healthyInput, rangeAnchor: {...anchor, minNativeBinId: 100}}});
    assert.equal(rangeSummary.verdict.label, 'Skip'); assert.equal(rangeSummary.reasons[0].id, 'range');
    let emptyReads = 0;
    assert.deepEqual(await listStillPoolsWithSummaries({...snapshot, pools: []}, {LP_CACHE: {async get() {emptyReads++;}}}, now), []);
    assert.equal(emptyReads, 0);
    assert.equal(fetches, 0, 'card summaries make no provider calls, even on cache misses or corrupt evidence');
    // A live pre-flight's exact evidence survives the cached-only paper-open path.
    const cachedRange = twoSidedRange, cachedSize = .37, cachedInput = fundedInput(cachedSize);
    const cacheKey = 'still:preflight-input:v3:steady-a:370000000:' + JSON.stringify(cachedRange);
    let savedInput = {at, input: cachedInput};
    const cachedEnv = {LP_CACHE: {async get(key) {return key === 'snapshot:v1' ? snapshot : key === cacheKey ? savedInput : null;}}};
    const cached = await getStillPreflight(cachedEnv, 'steady-a', cachedSize, cachedRange);
    assert(cached.entryCostSol.value > 0 && cached.exitCostSol.value > 0, 'non-default size and two-sided funding retain their exact quoted costs');
    assert.equal(cached.sizeSol, cachedSize); assert.equal(cached.range.shape, 'Spot');
    assert.equal(cached.ledger.entryCostsSol, cached.entryCostSol.value);
    assert.equal(cached.paperCostModel.asOf, at);
    for (const [address, size, range] of [['steady-b', cachedSize, cachedRange], ['steady-a', .38, cachedRange], ['steady-a', cachedSize, {...cachedRange, ceilingPct: 11}]]) {
      assert.equal((await getStillPreflight(cachedEnv, address, size, range)).roundTripCostSol.value, null, 'saved costs are bound to exact pool, lamport size and range');
    }
    for (const invalid of [{...savedInput, at: iso(now - 45001)}, {...savedInput, at: iso(now + 1)},
      {...savedInput, input: {...cachedInput, pool: {...cachedInput.pool, address: 'different-pool'}}},
      {...savedInput, input: {...cachedInput, pool: {...cachedInput.pool, base: {address: 'different-mint', symbol: 'OTHER'}}}}]) {
      savedInput = invalid;
      assert.equal((await getStillPreflight(cachedEnv, 'steady-a', cachedSize, cachedRange)).roundTripCostSol.value, null, 'invalid saved evidence never passes as fresh matching input');
    }
    assert.equal(fetches, 0, 'matching cached costs and safe misses never trigger external provider requests');
    const thinMark = await getStillPoolMark(env, 'tiny'); assert.equal(thinMark.priceSol, .01, 'already-open positions can still be marked when liquidity falls below entry shortlist threshold');
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
  // End-to-end live orchestration: an unavailable native anchor does not erase
  // a genuine fresh API mark, while mint policy and network fees stay required.
  const liveAt = new Date().toISOString(), liveAddress = '11111111111111111111111111111111', liveMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const livePool = pool(liveAddress, {base: {address: liveMint, symbol: 'USDC'}, priceQuote: .5, fetchedAt: liveAt, ageHours: 48});
  const stored = new Map([
    ['snapshot:v1', {updatedAt: liveAt, pools: [livePool], errors: {}}],
    ['research:v1:mint:' + liveMint, {at: liveAt, expiresAt: Date.now() + 300000, status: 'available', note: 'Observed mint fixture', data: [
      {id: 1, result: {value: {owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: {parsed: {type: 'mint', info: {decimals: 6, supply: '1000000000', mintAuthority: null, freezeAuthority: null}}}}}}, {id: 2, result: {epoch: 100}}, {id: 3, result: {value: []}}
    ]}],
    ['research:v1:active-bin:' + liveAddress, {at: liveAt, expiresAt: Date.now() + 30000, status: 'rate-limited', note: 'Provider cooldown', data: null}],
    ['still:network-fees:v1', {asOf: liveAt, singleLamports: 5000, doubleLamports: 10000, source: 'Observed RPC fixture'}],
  ]);
  const liveEnv = {SOLANA_RPC: 'https://rpc.test', LP_CACHE: {async get(key) {return stored.get(key) ?? null;}, async put(key, value) {stored.set(key, JSON.parse(value));}},
    RANGE_ALERTS: {idFromName: n => n, get: () => ({fetch: async () => Response.json({allowed: true, reason: 'allowed', retryAt: null})})}};
  let rpcRequests = 0, quoteRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'rpc.test') {rpcRequests++;const body=JSON.parse(init.body);assert.equal(body.method,'getMinimumBalanceForRentExemption','No native-anchor retry');return Response.json({jsonrpc:'2.0',id:body.id,result:57406080});}
    if (url.hostname === 'dlmm.datapi.meteora.ag' && url.pathname === '/pools') return Response.json({data: [{address: liveAddress, name: 'USDC/SOL', is_blacklisted: false, tvl: 200000, current_price: .5, created_at: Date.now() - 48 * 3600000,
      token_x: {address: liveMint, symbol: 'USDC', price: 50}, token_y: {address: SOL, symbol: 'SOL', price: 100}, pool_config: {bin_step: 100, base_fee_pct: .3}, fees: {'1h': 1200, '24h': 4800}, volume: {'24h': 100000}, fee_tvl_ratio: {'1h': .6, '24h': 2.4}, tags: []}]});
    if (url.hostname === 'api.jup.ag') {quoteRequests++;const buy = url.searchParams.get('inputMint') === SOL;return Response.json({inputMint: buy ? SOL : liveMint, outputMint: buy ? liveMint : SOL, inAmount: url.searchParams.get('amount'), outAmount: buy ? '1000000' : '490000000', routePlan: [{swapInfo: {ammKey: liveAddress, label: 'Meteora DLMM'}}]});}
    return new Response('{}', {status: 503});
  };
  try {
    const live = await getStillPreflight(liveEnv, liveAddress, .5, undefined, true);
    closeTo(live.exitCostSol.value, .01001, 'fresh exact-pool API mark sustains genuine exit cost during native-anchor cooldown');
    assert.equal(live.paperCostModel.netAfterHoldSol.value,null,'Unverified bin setup keeps all-in net unavailable even with real exit quote');
    assert.match(live.exitConversionSol.source, /Meteora DLMM Data API exact-pool price/);
    assert.match(live.range.note, /native bin alignment is unverified/i);
    assert.equal(rpcRequests, 1);assert.equal(quoteRequests, 2);
    const reopened = await getStillPreflight(liveEnv, liveAddress, .5);
    assert.equal(reopened.exitCostSol.value, live.exitCostSol.value, 'paper-open rebuild preserves this exact dated API-marked quote');
    assert.equal(quoteRequests, 2);
  } finally {globalThis.fetch = originalFetch;}
  console.log('Still guided pre-flight: bounded current shortlist, exact basket splits, sourced fee windows, monotonic downside, native orientation, observed cost plans, funding quotes, hard rejections, exact cached inputs, card-summary identity/expiry and no provider fanout passed');
} finally { await rm(dir, {recursive: true, force: true}); }
