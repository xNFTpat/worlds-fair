import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'lp-research-paper-'));
await build({entryPoints:['src/research-paper.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'paper.cjs')});
const require=createRequire(import.meta.url),{runResearchReplay,starterResearchBots}=require(join(dir,'paper.cjs'));
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)),`${msg}: ${a} vs ${b}`);
const start=Date.parse('2026-09-29T00:00:00Z');
const o=(hours,priceSol=1,patch={})=>({at:new Date(start+hours*3_600_000).toISOString(),priceSol,tvlUsd:100_000,fees1h:100,volume4h:200_000,mintAuthority:false,freezeAuthority:false,...patch});
const history=[o(0,.8),o(.25,.85),o(.5,.9),o(.75,.95),o(1,1)];
const config={...starterResearchBots[0],floorLookbackHours:1,maxHoldHours:2,maxSourceGapMinutes:30,maxRangeBins:69};
const input={config,sizeSol:1,seedSol:10,binStep:100,transferFeeBps:0,
  costAssumption:{fundingCostFraction:0,exitCostFraction:.01,networkSol:0,positionRentSol:0,label:'Explicit test scenario'}};
const replay=observations=>runResearchReplay({...input,observations});
assert.deepEqual(starterResearchBots.map(c=>c.name),['Overnight Bid-Ask Floor','Breakout Chaser','Chop Farmer']);
assert.ok(starterResearchBots.every(c=>c.rules.length>=3));

// Before entry there is no fee credit. The first interval from a SOL bid
// outside range earns nothing; only two in-range closes receive rough fees.
const warm=replay(history.slice(0,4));
assert.equal(warm.status,'waiting');
assert.equal(warm.trades.length,0);
assert.equal(warm.scoreboard.netPnlSol,null,'no trades is not demonstrated zero performance');
assert.ok(warm.decisions.every(d=>d.action==='skip'&&/contiguous/.test(d.reason)));
const entered=replay(history);
assert.equal(entered.openPosition.feesSol,0);
assert.equal(entered.openPosition.entryAt,history.at(-1).at);
assert.ok(entered.openPosition.lowerPriceSol<.8,'floor placed one bin below prior observed low');
assert.ok(entered.openPosition.upperPriceSol<1,'SOL bids start below active');
const farmed=replay([...history,o(1.25,.95),o(1.5,.94),o(1.75,.93,{volume4h:0})]);
assert.equal(farmed.trades.length,1);
assert.match(farmed.trades[0].reason,/4h volume/,'observed zero volume triggers exit');
near(farmed.trades[0].feesSol,.0005,'only two fresh in-range intervals credited');
near(farmed.trades[0].observedInRangeHours,.5,'observed in-range endpoint duration');
near(farmed.trades[0].uncreditedHours,.25,'first interval lacks in-range entry endpoint');
assert.ok(Number.isFinite(farmed.trades[0].pnlSol));
near(farmed.scoreboard.netPnlSol,farmed.trades[0].pnlSol,'closed net subtotal');
near(farmed.scoreboard.vsHoldingSol,farmed.scoreboard.netPnlSol,'SOL benchmark');
assert.equal(farmed.scoreboard.tradeCount,1);
assert.equal(farmed.scoreboard.scoredTrades,1);
assert.equal(farmed.scoreboard.winRate,farmed.trades[0].pnlSol>0?1:0);
assert.equal(farmed.openPosition,null);
assert.equal(farmed.unresolved.length,0);
assert.ok(farmed.decisions.find(d=>d.action==='entry').numbers.feeRateHourly===.001);
assert.ok(farmed.decisions.find(d=>d.action==='exit').numbers.volume4h===0);

// Simple exit rules run independently and at the observation price.
const below=replay([...history,o(1.25,.7)]);
assert.match(below.trades[0].reason,/below range floor/);
assert.equal(below.trades[0].principalSol,0);
assert.ok(below.trades[0].pairedTokens>0);
const above=replay([...history,o(1.25,1.1)]);
assert.match(above.trades[0].reason,/all SOL; reset eligible/);
assert.equal(above.trades[0].pairedTokens,0);
near(above.trades[0].principalSol,1,'unchanged SOL-only inventory above bids');
near(above.trades[0].pnlSol,0,'no funded token position, taxes, swap or network cost');
assert.equal(above.trades[0].quoteLossSol,0);
const collapse=replay([...history,o(1.25,.95,{tvlUsd:60_000})]);
assert.match(collapse.trades[0].reason,/40%/,'exact 40% collapse threshold exits');
const almostCollapse=replay([...history,o(1.25,.95,{tvlUsd:60_001})]);
assert.equal(almostCollapse.trades.length,0);
const stopped=runResearchReplay({...input,config:{...config,maxHoldHours:.5},observations:[...history,o(1.25,.95),o(1.5,.95)]});
assert.match(stopped.trades[0].reason,/Maximum hold/);
const zeroEntry=replay(history.map(p=>({...p,volume4h:0})));
assert.equal(zeroEntry.openPosition,null);
assert.match(zeroEntry.decisions.at(-1).reason,/volume/);
const feeZero=replay(history.map(p=>({...p,fees1h:0})));
assert.equal(feeZero.openPosition,null);
assert.match(feeZero.decisions.at(-1).reason,/fee density/);
const unknownSafety=replay(history.map(({mintAuthority,freezeAuthority,...rest})=>rest));
assert.equal(unknownSafety.openPosition,null);
assert.match(unknownSafety.decisions.at(-1).reason,/authority evidence unavailable/);

// Earlier entry decisions and bounds cannot be altered by later lows/highs.
const future=replay([...history,o(1.25,.95),o(1.5,.2),o(1.75,100)]);
assert.deepEqual(future.decisions.slice(0,history.length),entered.decisions);
near(future.trades[0].lowerPriceSol,entered.openPosition.lowerPriceSol,'future low cannot set entry floor');
near(future.trades[0].upperPriceSol,entered.openPosition.upperPriceSol,'future high cannot set entry top');
const intrabar=replay([...history,o(1.25,1,{high:10,low:.001})]);
assert.match(intrabar.trades[0].reason,/above range/,'only observation close defines exit');
near(intrabar.trades[0].pnlSol,0,'invented intrabar extremes create no fills');

// A source gap accrues no fees, and does not silently invent a stop execution
// at the unobserved crossing. Missing fee density also cannot create fees.
const gap=runResearchReplay({...input,config:{...config,maxHoldHours:4},observations:[...history,o(1.25,.95),o(2.25,.95),o(2.5,.95,{fees1h:null}),o(2.75,.95,{volume4h:0})]});
near(gap.trades[0].feesSol,.00025,'only fresh in-range interval with preceding known rate');
near(gap.trades[0].uncreditedHours,1.5,'gap, entry and unknown-rate periods uncredited');
const gapWarm=runResearchReplay({...input,observations:[o(0,.8),o(.1,.9),o(.75,.95),o(1,1)]});
assert.equal(gapWarm.openPosition,null);
assert.match(gapWarm.decisions.at(-1).reason,/contiguous/);
const irregular=runResearchReplay({...input,observations:[o(0,.8),o(.26,.85),o(.52,.9),o(.78,.95),o(1.04,1)]});
assert.ok(irregular.openPosition,'prior point just before cutoff supplies dated coverage');

// Ten-minute monitored bot is unavailable on hourly closes; no fabricated
// intrahour trades. With adequate cadence it can enter and exit at max hold.
const hourly=runResearchReplay({...input,config:starterResearchBots[1],observations:[o(0,1),o(1,1.1),o(2,1.2)]});
assert.equal(hourly.status,'unavailable');
assert.equal(hourly.scoreboard.netPnlSol,null);
assert.equal(hourly.trades.length,0);
assert.match(hourly.warnings.join(' '),/cadence.*exceeds/);
const fast=runResearchReplay({...input,config:starterResearchBots[1],observations:[o(0,1),o(1/6,1),o(1/3,1),o(.5,1.01),o(2/3,1.01)]});
assert.equal(fast.trades.length,1);
assert.match(fast.trades[0].reason,/Maximum hold/);
assert.match(fast.decisions.find(d=>d.action==='entry').reason,/9.*bins/);
assert.equal(fast.trades[0].holdHours,1/6);
const noBreakout=runResearchReplay({...input,config:starterResearchBots[1],observations:[o(0,1),o(1/6,1),o(1/3,1),o(.5,1)]});
assert.equal(noBreakout.openPosition,null);
assert.match(noBreakout.decisions.at(-1).reason,/No close above/);
const chopConfig={...starterResearchBots[2],floorLookbackHours:1};
const chop=runResearchReplay({...input,config:chopConfig,observations:[o(0,1),o(.25,1.01),o(.5,.99),o(.75,1),o(1,1)]});
assert.ok(chop.openPosition);
assert.equal(chop.openPosition.bins.length,9);
const wideChop=runResearchReplay({...input,config:chopConfig,observations:history});
assert.equal(wideChop.openPosition,null);
assert.match(wideChop.decisions.at(-1).reason,/band too wide/);

// Network cost is sunk, rent is refundable, and close restores exactly the
// independent seed plus net result. A new trade only uses confirmed cash.
const withRent=runResearchReplay({...input,costAssumption:{...input.costAssumption,networkSol:.002,positionRentSol:.05},observations:[...history,o(1.25,1.1)]});
near(withRent.trades[0].pnlSol,-.002,'entry and exit network both charged');
near(withRent.trades[0].rentReturnedSol,.05,'rent refunded');
near(withRent.scoreboard.cashSol,9.998,'cash reconciles to seed plus net P&L');
near(withRent.scoreboard.worstDrawdown,.002/10,'account equity drawdown excludes refundable rent');
const tiny=runResearchReplay({...input,seedSol:1,costAssumption:{...input.costAssumption,networkSol:.002,positionRentSol:.05},observations:history});
assert.equal(tiny.openPosition,null);
assert.match(tiny.decisions.at(-1).reason,/Insufficient.*rent/);
const roundtrip=runResearchReplay({...input,observations:[...history,o(1.25,1.1),o(1.5,1.1),o(1.75,1.2)]});
assert.equal(roundtrip.trades.length,2);
near(roundtrip.scoreboard.cashSol,10,'known closed proceeds safely reused');
// Conserved, unfilled SOL bins can sum a fraction of an ULP away from capital.
// That arithmetic noise must neither win/lose nor prevent a subsequent entry.
for(const bins of [7,9,69]){
 const flatInput={...input,seedSol:1,config:{...config,floorLookbackHours:.25,minFeeRateHourly:0,fixedBinCount:bins},costAssumption:{...input.costAssumption,exitCostFraction:0}};
 const flat=runResearchReplay({...flatInput,observations:[0,.25,.5,.75,1].map(t=>o(t,1,{fees1h:0}))});
 assert.equal(flat.trades.length,2);assert.ok(flat.trades.every(t=>t.pnlSol===0));assert.equal(flat.scoreboard.winRate,0);assert.equal(flat.scoreboard.cashSol,1);
 assert.ok(!flat.decisions.some(d=>d.reason.includes('Insufficient')),'flat, confirmed proceeds can fund the next equal-size trade');
 const oneLamport=runResearchReplay({...flatInput,seedSol:2,costAssumption:{...flatInput.costAssumption,networkSol:1e-9},observations:[0,.25,.5].map(t=>o(t,1,{fees1h:0}))});
 assert.ok(oneLamport.trades[0].pnlSol<0);assert.ok(Math.abs(oneLamport.trades[0].pnlSol+1e-9)<1e-14,'one lamport is a real cost, never rounded into zero');assert.equal(oneLamport.scoreboard.winRate,0);
 const tinyKnownCost=runResearchReplay({...flatInput,seedSol:2,costAssumption:{...flatInput.costAssumption,networkSol:1e-16},observations:[0,.25,.5].map(t=>o(t,1,{fees1h:0}))});
 assert.equal(tinyKnownCost.trades[0].pnlSol,-1e-16,'a declared nonzero cost is charged after principal-noise normalization');assert.equal(tinyKnownCost.scoreboard.winRate,0);
 const short=runResearchReplay({...flatInput,seedSol:1-1e-9,observations:[0,.25,.5].map(t=>o(t,1,{fees1h:0}))});assert.equal(short.trades.length,0);assert.match(short.decisions.at(-1).reason,/Insufficient/);
}

// Missing assumptions or transfer policies never count as zero. Once a
// liquidation is unresolved its hypothetical proceeds cannot fund a new trade.
const missingExit=runResearchReplay({...input,costAssumption:{...input.costAssumption,exitCostFraction:null},observations:[...history,o(1.25,.7),o(1.5,1)]});
assert.equal(missingExit.status,'unresolved');
assert.equal(missingExit.scoreboard.netPnlSol,null);
assert.equal(missingExit.trades[0].pnlSol,null);
assert.ok(missingExit.trades[0].grossLiquidationSol>0);
assert.equal(missingExit.scoreboard.cashSol,null);
assert.equal(missingExit.unresolved.length,1);
assert.match(missingExit.decisions.at(-1).reason,/Unresolved capital/);
const noCost=runResearchReplay({...input,costAssumption:undefined,observations:[...history,o(1.25,1.1)]});
assert.equal(noCost.trades[0].pnlSol,null);
assert.match(noCost.trades[0].unavailableReasons.join(' '),/Network.*rent/);
const taxUnknown=runResearchReplay({...input,transferFeeBps:undefined,observations:[...history,o(1.25,.7)]});
assert.equal(taxUnknown.trades[0].pnlSol,null);
assert.match(taxUnknown.trades[0].unavailableReasons.join(' '),/transfer tax/);
const fundingUnknown=runResearchReplay({...input,config:{...config,oneSided:false,shape:'Spot',fixedBinCount:9},costAssumption:{...input.costAssumption,fundingCostFraction:null},observations:[...history,o(1.25,1.1)]});
assert.equal(fundingUnknown.trades[0].pnlSol,null);
assert.match(fundingUnknown.trades[0].unavailableReasons.join(' '),/Entry funding/);

// Token-2022 caps are valued at the exit SOL/token price, and quote-inclusive
// sale transfer fees are not charged twice. Funding/deposit costs are distinct.
const tokenHistory=history.map(p=>({...p,priceSol:p.priceSol*.001}));
const taxed=runResearchReplay({...input,transferFeeBps:300,transferFeeMaximumRaw:'1000000',pairedDecimals:6,observations:[...tokenHistory,o(1.25,.0007)]});
near(taxed.trades[0].withdrawalTaxSol,.0007,'one-token raw withdrawal cap');
assert.equal(taxed.trades[0].depositTaxSol,0,'SOL-only entry has no token deposit tax');
assert.equal(taxed.trades[0].saleTaxSol,0,'quoted sale taxes counted inside cost fraction');
const explicitTax=runResearchReplay({...input,transferFeeBps:300,transferFeeMaximumRaw:'1000000',pairedDecimals:6,costAssumption:{...input.costAssumption,exitCostIncludesTransferFee:false,exitCostFraction:0},observations:[...tokenHistory,o(1.25,.0007)]});
near(explicitTax.trades[0].saleTaxSol,.0007,'second capped transfer when quote excludes tax');
const twoTax=runResearchReplay({...input,config:{...config,oneSided:false,shape:'Spot',fixedBinCount:9},transferFeeBps:300,transferFeeMaximumRaw:'1000000',pairedDecimals:6,observations:[...tokenHistory,o(1.25,.0011)]});
near(twoTax.trades[0].depositTaxSol,.001,'funded LP token deposit cap');
near(twoTax.trades[0].fundingCostSol,0,'inclusive funding quote already covers its swap tax');

const scenario=runResearchReplay({...input,feeMode:'constant-current-conditions',observations:history});
assert.match(scenario.label,/Constant current conditions scenario/);
assert.match(scenario.assumptions.join(' '),/must not be described as measured/);
for(const patch of [{seedSol:0},{sizeSol:0},{binStep:0},{feeMode:'unknown'},{transferFeeBps:-1},{pairedDecimals:19},{transferFeeMaximumRaw:'100'},
  {observations:[o(0),o(0)]},{observations:[o(1),o(0)]},{observations:[o(0,0)]},{observations:[o(0,1,{tvlUsd:-1})]},
  {costAssumption:{exitCostFraction:1.1}},{config:{...config,oneSided:'yes'}},{config:{...config,fixedBinCount:2,oneSided:false}},
  {config:{...config,maxRangeBins:0}},{config:{...config,maxHoldHours:0}}])assert.throws(()=>runResearchReplay({...input,observations:history,...patch}),RangeError,JSON.stringify(patch));
assert.doesNotMatch(await readFile('src/research-paper.ts','utf8'),/sendRawTransaction|sendTransaction|Keypair|PAPER_FLEET/);
console.log('PASS research replay: starter rules, dated/no-lookahead entry, fixed-bin close fills, fee eligibility/gaps, zero volume and TVL collapse exits, unsupported fast cadence, known capital reuse, taxes and rent, unknown net outcomes and scenario labels');
