import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'lp-research-range-'));
await build({entryPoints:['src/research-range.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'range.cjs')});
const require=createRequire(import.meta.url);
const {buildResearchRange,inventoryAtPrice,defaultResearchFloor}=require(join(dir,'range.cjs'));
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)),`${message}: ${a} vs ${b}`);
const base={sizeSol:1,priceSol:1,floorPriceSol:.8,binStep:100,shape:'Spot',oneSided:true,
  feeRateHourly:.001,exitCostFraction:.01,transferFeeBps:0,networkSol:0,activeBinId:40,activeBinPriceSol:1};
const first=buildResearchRange(base);
assert.equal(first.priceConvention,'SOL per paired token');
assert.equal(first.logIntervalCount,23);
assert.equal(first.binCount,23,'SOL-only inclusive bin count excludes active bin');
near(first.topPriceSol,1/1.01,'top is one bin below active');
assert.ok(first.bottomPriceSol<=base.floorPriceSol,'bottom rounds outward to cover requested floor');
assert.ok(first.bottomPriceSol*1.01>base.floorPriceSol,'only one rounding bin is included');
assert.equal(first.lowerNativeBin,17);
assert.equal(first.upperNativeBin,39);
assert.equal(first.alignment,'native-active-bin');
assert.equal(first.warnings.length,0);
near(first.selected.initialSol,1,'one-sided initial SOL');
assert.equal(first.selected.initialPairedTokens,0);
assert.equal(first.selected.fundingSol,0);
assert.equal(first.selected.fundingCostSol,0);
assert.equal(first.selected.depositTaxSol,0);
assert.ok(first.selected.atFloor.pnlSol<0,'downward conversion costs principal vs SOL holding');
near(first.selected.belowFloor.grossValueSol,first.selected.atFloor.grossValueSol*.9,'extra 10% fall marks unchanged token inventory');
near(first.selected.atFloor.vsHoldingSol,first.selected.atFloor.pnlSol,'holding SOL is constant SOL benchmark');
near(first.selected.atFloor.totalCostsSol,first.selected.atFloor.saleCostSol,'zero entry/tax/network leaves only quoted exit cost');
near(first.selected.atFloor.feeRecoveryHours,first.selected.atFloor.totalCostsSol/.001,'pool-density fee recovery');

// A mathematical exact interval should not become an extra bin due to log noise.
for(const steps of [1,2,34,69,70]){
  const r=buildResearchRange({...base,floorPriceSol:1/1.01**steps});
  assert.equal(r.logIntervalCount,steps);
  assert.equal(r.binCount,steps);
  assert.equal(r.exceedsSetupBins,steps>69);
  if(steps>69)assert.match(r.warnings.join(' '),/69.*not a protocol maximum/);
}
const over=buildResearchRange({...base,floorPriceSol:(1/1.01**69)*(1-1e-6)});
assert.equal(over.binCount,70,'real floor beyond the 69th bin is not rounded away');
const mirrored=buildResearchRange({...base,oneSided:false,fundingCostFraction:0,floorPriceSol:1/1.01**34});
assert.equal(mirrored.logIntervalCount,34);
assert.equal(mirrored.binCount,69,'two-sided bins include active plus both tails');
near(mirrored.selected.initialSol,.5,'two-sided half-SOL template');
near(mirrored.selected.initialPairedTokens,.5,'two-sided half-token template');
near(mirrored.selected.bins.find(b=>b.offset===0).sol,mirrored.selected.bins.find(b=>b.offset===0).token,'active bin splits both assets equally by entry value');
near(mirrored.topPriceSol,1.01**34,'two-sided upside mirrors geometric downside');
assert.equal(mirrored.lowerNativeBin,6);
assert.equal(mirrored.upperNativeBin,74);

// Native bin IDs and quoted copy prices invert when SOL is native token X.
const inverted=buildResearchRange({...base,solIsBase:true});
near(inverted.bottomPriceSol,first.bottomPriceSol,'canonical SOL/token floor is orientation independent');
assert.ok(inverted.selected.atFloor.pnlSol<first.selected.atFloor.pnlSol,'SOL-X SDK quote weights adjust SOL quantities by native price');
assert.ok(inverted.selected.bins[0].sol<inverted.selected.bins.at(-1).sol,'SOL-X Spot has more SOL in higher-priced bins');
assert.equal(inverted.lowerNativeBin,41);
assert.equal(inverted.upperNativeBin,63);
near(inverted.copyPrices.bottom,1/first.topPriceSol,'inverse copy lower price');
near(inverted.copyPrices.top,1/first.bottomPriceSol,'inverse copy upper price');
assert.match(inverted.copyPrices.convention,/paired token per SOL/);
const differingAnchor=buildResearchRange({...base,activeBinPriceSol:1.005});
near(differingAnchor.topPriceSol,1.005/1.01,'actual active bin anchors copied bounds');
const assumed=buildResearchRange({...base,activeBinId:undefined,activeBinPriceSol:undefined});
assert.equal(assumed.alignment,'assumed-active-price');
assert.equal(assumed.lowerNativeBin,null);
assert.match(assumed.warnings.join(' '),/Confirm.*active-bin/);

// Shape effects come from filled prices; fee recovery does not invent a
// concentration uplift absent per-bin liquidity.
const bid=buildResearchRange({...base,shape:'BidAsk'});
const curve=buildResearchRange({...base,shape:'Curve'});
assert.ok(bid.selected.bins[0].weight>bid.selected.bins.at(-1).weight,'one-sided linear Bid-Ask leans toward floor');
assert.ok(curve.selected.bins[0].weight<curve.selected.bins.at(-1).weight,'one-sided linear Curve leans toward active endpoint');
assert.ok(bid.selected.atFloor.grossValueSol>first.selected.atFloor.grossValueSol);
assert.ok(first.selected.atFloor.grossValueSol>curve.selected.atFloor.grossValueSol);
for(const r of [first,bid,curve]){
  near(r.selected.bins.reduce((s,b)=>s+b.weight,0),1,'weights sum to one');
  assert.equal(r.roughFeeSolPerHour,.001,'identical pool-density fee assumption across shapes');
  assert.deepEqual(r.comparison.map(c=>c.shape),['Spot','BidAsk']);
  assert.match(r.assumptions.join(' '),/no per-bin liquidity/);
  assert.equal(r.allocationModel,'sdk-strategy-floating');
}
assert.equal(mirrored.allocationModel,'research-50-50-template');
assert.match(mirrored.assumptions.join(' '),/not the SDK allocation/);

// The user's e/acc fixture is native token X=e/acc (6 decimals), Y=SOL
// (9 decimals). The supplied price is a scenario anchor, not fresh RPC evidence.
// These independently derived bounds and linear-weight losses must not be
// fitted by reusing the implementation's own intermediate calculations.
const eacc=buildResearchRange({sizeSol:1,priceSol:1.09212e-4,floorPriceSol:8.1909e-5,binStep:50,
  oneSided:true,solIsBase:false,exitCostFraction:.005,transferFeeBps:0,networkSol:0,feeRateHourly:.001});
assert.equal(eacc.binCount,58);
near(eacc.topPriceSol,.00010866865671641792,'e/acc top one bin below supplied scenario price');
near(eacc.bottomPriceSol,.00008177843186770718,'e/acc aligned floor');
near(eacc.comparison[0].atFloor.returnFraction,-.1338301117254358,'e/acc Spot includes 0.5% sale loss');
near(eacc.comparison[1].atFloor.returnFraction,-.09284670016651875,'e/acc Bid-Ask linear SDK allocation includes sale loss');
assert.equal((eacc.comparison[0].atFloor.returnFraction*100).toFixed(1),'-13.4');
assert.equal((eacc.comparison[1].atFloor.returnFraction*100).toFixed(1),'-9.3');
assert.equal(eacc.alignment,'assumed-active-price','fixture prices must not claim a verified live anchor');
near(eacc.selected.belowFloor.liquidationSol,eacc.selected.atFloor.liquidationSol*.9,'fully converted token stress includes the same sale fraction');
near(eacc.selected.atFloor.scenarioBreakEvenHours,-eacc.selected.atFloor.pnlSol/.001,'hours to offset the full scenario loss');
assert.ok(eacc.selected.atFloor.scenarioBreakEvenHours>eacc.selected.atFloor.feeRecoveryHours,'conversion loss is separate from cost-only recovery');
near(eacc.selected.atFloor.exitRecoveryHours,eacc.selected.atFloor.feeRecoveryHours,'without entry or network costs, recovery costs are exit costs');

// Compare the pure floating strategy to the installed SDK's integer per-bin
// allocation in both native orientations. At most one lamport per bin is
// lost to SDK rounding; research does not pretend that dust was deposited.
const sdk=require(resolve('execution/node_modules/@meteora-ag/dlmm')),
  BN=require(resolve('execution/node_modules/bn.js')),untaxedMint={tlvData:Buffer.alloc(0)},clock={epoch:new BN(0)};
for(const solIsBase of [false,true])for(const [shape,strategy] of [['Spot',sdk.StrategyType.Spot],['BidAsk',sdk.StrategyType.BidAsk],['Curve',sdk.StrategyType.Curve]]){
  const r=buildResearchRange({...eacc,priceSol:eacc.priceSol,floorPriceSol:eacc.requestedFloorPriceSol,shape,solIsBase,activeBinId:0});
  const amounts=sdk.toAmountsBothSideByStrategy(0,50,solIsBase?1:-58,solIsBase?58:-1,
    new BN(solIsBase?1000000000:0),new BN(solIsBase?0:1000000000),new BN(0),new BN(0),strategy,untaxedMint,untaxedMint,clock);
  const byId=new Map(amounts.map(b=>[b.binId,b]));
  for(const bin of r.selected.bins){const actual=byId.get(bin.nativeBinId),actualSol=Number((solIsBase?actual.amountX:actual.amountY).toString())/1e9;
    assert.ok(Math.abs(actualSol-bin.sol)<1.00001e-9,shape+' SDK amount matches floating strategy within one lamport');
    assert.equal((solIsBase?actual.amountY:actual.amountX).toString(),'0','SOL-only SDK has no paired entry amount');
  }
}

// Default floors fit the setup. Explicit user-selected deeper floors remain
// unchanged and get the existing warning rather than being silently clipped.
for(const oneSided of [false,true])for(const binStep of [1,5,50,100,10000]){
  const d=defaultResearchFloor({priceSol:1,binStep,oneSided});
  const r=buildResearchRange({...base,binStep,oneSided,floorPriceSol:d.floorPriceSol,fundingCostFraction:0});
  assert.equal(r.binCount,d.binCount);assert.ok(r.binCount<=69);assert.equal(r.exceedsSetupBins,false);
}
const defaultTwo=defaultResearchFloor({priceSol:1,binStep:50,oneSided:false});
assert.equal(defaultTwo.capped,true);assert.equal(defaultTwo.binCount,69);assert.equal(defaultTwo.preferredFloorPriceSol,.8);
near(defaultTwo.floorPriceSol,1/1.005**34,'two-sided default permits 34 bins below active');
const defaultOne=defaultResearchFloor({priceSol:1,binStep:50});assert.equal(defaultOne.capped,false);assert.equal(defaultOne.binCount,45);
const supportDefault=defaultResearchFloor({priceSol:1,binStep:50,oneSided:false,preferredFloorPriceSol:.7});
assert.equal(supportDefault.preferredFloorPriceSol,.7);assert.equal(supportDefault.capped,true);
assert.equal(buildResearchRange({...base,binStep:50,oneSided:false,floorPriceSol:.8}).binCount,91,'entered 20% floor is not silently changed');
for(const patch of [{priceSol:0},{binStep:1.5},{maxSetupBins:0},{oneSided:false,maxSetupBins:2},{oneSided:'two'},{preferredDepthFraction:0},{preferredDepthFraction:1},{preferredFloorPriceSol:1}])assert.throws(()=>defaultResearchFloor({priceSol:1,binStep:50,...patch}),RangeError);

// Marking conserves each bin's SOL value at its fixed conversion price in
// either direction, independent of native orientation or the previous mark.
const bins=[{priceSol:2,sol:3,token:4},{priceSol:4,sol:2,token:1}];
const down=inventoryAtPrice(bins,1);
near(down.sol,0,'below bins becomes tokens');
near(down.tokens,11/2+6/4,'fixed bin conversions');
near(down.valueSol,7,'SOL mark at lower market price');
const up=inventoryAtPrice(bins,5);
near(up.sol,17,'above bins becomes SOL');
near(up.tokens,0,'no paired inventory above all bins');
const between=inventoryAtPrice(bins,3);
near(between.sol,11,'lower bin becomes SOL');
near(between.tokens,1.5,'higher bin stays tokens');
near(between.valueSol,15.5,'mixed inventory marked at current price');
const onBin=inventoryAtPrice([bins[0]],2);
near(onBin.tokens,5.5,'exact bin boundary assumes token-side full fill');
near(onBin.valueSol,11,'fixed-value conservation at bin');
assert.deepEqual(bins,[{priceSol:2,sol:3,token:4},{priceSol:4,sol:2,token:1}],'helper does not mutate replay state');

// SPL ceiling and maximum are in paired-token raw units, not SOL. Withdrawal
// and sale are distinct transfers; an inclusive Jupiter quote does not add
// a second explicit sale tax.
const taxedBase={...base,priceSol:.001,activeBinPriceSol:.001,floorPriceSol:.0009,
  pairedDecimals:6,transferFeeBps:300,transferFeeMaximumRaw:'1000000'};
const capped=buildResearchRange(taxedBase);
assert.equal(capped.selected.depositTaxSol,0,'SOL-only deposit avoids token transfer tax');
near(capped.selected.atFloor.withdrawalTaxSol,capped.bottomPriceSol,'one token withdrawal cap at scenario price');
near(capped.selected.atFloor.saleCostSol,(capped.selected.atFloor.pairedTokens-1)*capped.bottomPriceSol*.01,'inclusive sale quote counts sale tax once');
const explicitSaleTax=buildResearchRange({...taxedBase,exitCostFraction:0,exitCostIncludesTransferFee:false});
near(explicitSaleTax.selected.atFloor.saleCostSol,explicitSaleTax.bottomPriceSol,'one additional capped token transfer into sale');
const twoTax=buildResearchRange({...taxedBase,oneSided:false,fundingCostFraction:0});
near(twoTax.selected.fundingCostSol,0,'inclusive funding quote is not taxed twice');
near(twoTax.selected.depositTaxSol,.001,'LP token deposit is a separate capped transfer');
near(twoTax.selected.initialPairedTokens,499,'500 funded tokens minus one deposit token');
const twoExplicitFundingTax=buildResearchRange({...taxedBase,oneSided:false,fundingCostFraction:0,fundingCostIncludesTransferFee:false});
near(twoExplicitFundingTax.selected.initialPairedTokens,498,'funding output and LP deposit are separate transfers');
near(twoExplicitFundingTax.selected.fundingCostSol,.001,'funding output tax cost is recorded once');
const rounded=buildResearchRange({...base,sizeSol:.001,priceSol:1,activeBinPriceSol:1,floorPriceSol:1/1.01,pairedDecimals:3,transferFeeBps:1,transferFeeMaximumRaw:'100'});
near(rounded.selected.atFloor.withdrawalTaxSol,rounded.bottomPriceSol*.001,'raw-unit ceiling can tax one tiny-token unit');
assert.equal(rounded.selected.atFloor.liquidationSol,0,'rounded full inventory tax leaves zero to sell');

// Unknown cost/tax evidence stays unknown. Explicit zero is evidence of zero.
const unknownExit=buildResearchRange({...base,exitCostFraction:null});
assert.equal(unknownExit.selected.atFloor.liquidationSol,null);
assert.equal(unknownExit.selected.atFloor.pnlSol,null);
assert.equal(unknownExit.selected.atFloor.feeRecoveryHours,null);
assert.equal(unknownExit.selected.atFloor.scenarioBreakEvenHours,null);
assert.equal(unknownExit.selected.atFloor.exitRecoveryHours,null);
assert.match(unknownExit.selected.atFloor.unavailableReasons.join(' '),/exit quote/);
const unknownTax=buildResearchRange({...base,transferFeeBps:undefined});
assert.equal(unknownTax.selected.depositTaxSol,0,'unknown token policy does not invent SOL deposit tax');
assert.equal(unknownTax.selected.atFloor.liquidationSol,null);
assert.match(unknownTax.selected.atFloor.unavailableReasons.join(' '),/transfer fee/);
const unknownFunding=buildResearchRange({...base,oneSided:false});
assert.equal(unknownFunding.selected.atFloor.liquidationSol,null);
assert.match(unknownFunding.selected.atFloor.unavailableReasons.join(' '),/funding quote/);
const zeroFees=buildResearchRange({...base,feeRateHourly:0});
assert.equal(zeroFees.selected.atFloor.feeRecoveryHours,null);
assert.equal(zeroFees.selected.atFloor.scenarioBreakEvenHours,null);
assert.equal(zeroFees.selected.atFloor.exitRecoveryHours,null);
assert.equal(zeroFees.feeRecoveryStatus,'no-fees-at-current-rate');
assert.equal(zeroFees.roughFeeSolPerHour,0);
const unknownFees=buildResearchRange({...base,feeRateHourly:null});
assert.equal(unknownFees.selected.atFloor.feeRecoveryHours,null);
assert.equal(unknownFees.selected.atFloor.scenarioBreakEvenHours,null);
assert.equal(unknownFees.feeRecoveryStatus,'unknown-rate');
const free=buildResearchRange({...base,exitCostFraction:0});
assert.equal(free.selected.atFloor.totalCostsSol,0);
assert.equal(free.selected.atFloor.feeRecoveryHours,0);
assert.equal(free.selected.atFloor.exitRecoveryHours,0);
assert.ok(free.selected.atFloor.scenarioBreakEvenHours>0,'zero transaction costs still leave conversion loss');
const costs=buildResearchRange({...base,networkSol:.002,positionRentSol:.05});
near(costs.selected.atFloor.pnlSol,first.selected.atFloor.pnlSol-.002,'network estimate is sunk');
near(costs.totalCashRequiredSol,1.052,'rent is additional locked capital');
assert.equal(costs.positionRentSol,.05);
const rentOnly=buildResearchRange({...base,positionRentSol:.05});
near(rentOnly.selected.atFloor.pnlSol,first.selected.atFloor.pnlSol,'refundable rent is not a loss');

for(const patch of [
  {priceSol:0},{priceSol:NaN},{floorPriceSol:1},{floorPriceSol:0},{binStep:0},{binStep:Infinity},{binStep:1.5},
  {shape:'Unknown'},{sizeSol:-1},{sizeSol:Infinity},{sizeSol:1_000_001},{activeBinId:1.5},
  {oneSided:'yes'},{solIsBase:1},{maxSetupBins:0},{maxSetupBins:1401},{feeRateHourly:-.1},
  {exitCostFraction:1.1},{fundingCostFraction:NaN},{networkSol:-1},{positionRentSol:-1},
  {transferFeeBps:10001},{transferFeeBps:1.5},{pairedDecimals:19},
  {transferFeeMaximumRaw:'-1',pairedDecimals:6},{transferFeeMaximumRaw:'100'},
  {floorPriceSol:1/1.01**1401},
])assert.throws(()=>buildResearchRange({...base,...patch}),RangeError,JSON.stringify(patch));
assert.throws(()=>inventoryAtPrice([{priceSol:1,sol:-1,token:0}],1),RangeError);
assert.throws(()=>inventoryAtPrice(bins,0),RangeError);
console.log('PASS research ranges: e/acc58-bin fixture, SDK linear shapes in both orientations, usable69-bin defaults, fixed-bin inventory, capped/rounded taxes, unknown quotes, scenario vs cost recovery and refundable rent');
