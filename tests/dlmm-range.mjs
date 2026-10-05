import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dir=await mkdtemp(join(tmpdir(),'lp-dlmm-range-'));
await build({entryPoints:['execution/dlmm-range.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'range.cjs')});
const {parseDlmmRangeRequest:parse,resolveDlmmRange:range,dlmmBinPrices:prices,expectedDlmmAllocation:expected,simulatedDlmmAllocation:simulated,formatDlmmAllocation:format,allocationFromSimulationEvidence:fromEvidence,IncompleteDlmmAllocationEvidence:IncompleteEvidence}=require(join(dir,'range.cjs'));
const sdk=require(resolve('execution/node_modules/@meteora-ag/dlmm')),spl=require(resolve('execution/node_modules/@solana/spl-token')),BN=require(resolve('execution/node_modules/bn.js'));
const {PublicKey}=require(resolve('execution/node_modules/@solana/web3.js'));
const context=(solIsX=false,activeBin=0)=>({activeBin,binStep:100,minNativeBin:-5000,maxNativeBin:5000,decimalsX:solIsX?9:6,decimalsY:solIsX?6:9,solIsX});
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<=Math.max(Math.abs(a),Math.abs(b))*1e-12,`${message}: ${a} versus ${b}`);
const bounds=(ctx,low,high,mode='two-sided')=>parse({depositMode:mode,lowerPriceSol:prices(low,ctx).priceSol.toPrecision(17),upperPriceSol:prices(high,ctx).priceSol.toPrecision(17)});

assert.equal(parse({}).depositMode,'two-sided');assert.equal(parse({}).width,10);
assert.equal(parse({lowerPriceSol:'1e-8',upperPriceSol:'0.00000002',widthPct:0}).lowerPriceSol,'1e-8','explicit bounds bypass legacy percentage limits');
for(const body of [{depositMode:'unknown'},{lowerPriceSol:'1'},{lowerPriceSol:'',upperPriceSol:'2'},{lowerPriceSol:1,upperPriceSol:'2'},{lowerPriceSol:'NaN',upperPriceSol:'2'},{lowerPriceSol:'-1',upperPriceSol:'2'},{lowerPriceSol:'0',upperPriceSol:'2'},{lowerPriceSol:'1e999',upperPriceSol:'1e999'},{lowerPriceSol:'2',upperPriceSol:'1'},{widthPct:0},{widthPct:51}])assert.throws(()=>parse(body));

// The same canonical bounds produce opposite native directions, with unequal
// decimals and signed IDs. Full precision price copies must not add a bin.
const nativeY=context(false,-695),nativeX=context(true,695);
const y=range(bounds(nativeY,-700,-690),nativeY),x=range(bounds(nativeX,700,690),nativeX);
assert.deepEqual([y.lowerBin,y.upperBin,y.binCount],[-700,-690,11]);
assert.deepEqual([x.lowerBin,x.upperBin,x.binCount],[690,700,11]);
close(y.lowerPriceSol,x.lowerPriceSol,'reversed canonical lower');close(y.upperPriceSol,x.upperPriceSol,'reversed canonical upper');
close(x.lowerPriceSol,1/x.priceUpperYX,'SOL-X lower reverses native upper');close(x.upperPriceSol,1/x.priceLowerYX,'SOL-X upper reverses native lower');
close(y.lowerPriceSol,y.priceLowerYX,'SOL-Y price is native Y/X');
assert.equal(y.minDeltaId,-5);assert.equal(x.maxDeltaId,5);
for(const solX of [false,true]){
 const ctx=context(solX),floorId=solX?69:-69,topId=solX?1:-1;
 const full=range(bounds(ctx,floorId,topId,'sol-only'),ctx);
 assert.equal(full.binCount,69);assert.ok(full.upperPriceSol<full.activePriceSol);
 assert.deepEqual([full.lowerBin,full.upperBin],solX?[1,69]:[-69,-1]);
 assert.throws(()=>range(bounds(ctx,solX?70:-70,topId,'sol-only'),ctx),/70 bins/);
 const single=range(bounds(ctx,topId,topId,'sol-only'),ctx);assert.equal(single.binCount,1,'single-bin SOL-only range is valid');
 assert.throws(()=>range(bounds(ctx,floorId,0,'sol-only'),ctx),/below the active/);
 assert.throws(()=>range(bounds(ctx,solX?5:-5,0),ctx),/below and above/);
 assert.throws(()=>range(bounds(ctx,solX?12:-12,solX?-12:12),{...ctx,minNativeBin:-10,maxNativeBin:10}),/native bin limits/);
 const closeTop=range(parse({depositMode:'sol-only',lowerPriceSol:'0.0009',upperPriceSol:'0.0009999'}),ctx);
 assert.equal(solX?closeTop.lowerBin:closeTop.upperBin,solX?1:-1,'a near-active top aligns inward, excluding active');
 assert.match(closeTop.alignmentNote,/Active bin is excluded/);
 const legacy=range(parse({widthPct:5}),ctx);
 assert.deepEqual([legacy.lowerBin,legacy.upperBin],[-6,5],'legacy percentage keeps native Y/X behavior');
 const legacySol=range(parse({widthPct:10,depositMode:'sol-only'}),ctx);
 assert.deepEqual([legacySol.lowerBin,legacySol.upperBin],solX?[1,11]:[-11,-1]);
}
// Precision tolerance is limited to floating-point-sized grid residuals.
const c=context(),exact=prices(-69,c).priceSol;
for(const factor of [1-Number.EPSILON,1,1+Number.EPSILON])assert.equal(range(parse({depositMode:'sol-only',lowerPriceSol:String(exact*factor),upperPriceSol:String(prices(-1,c).priceSol)}),c).lowerBin,-69);
assert.throws(()=>range(parse({depositMode:'sol-only',lowerPriceSol:String(exact*(1-1e-9)),upperPriceSol:String(prices(-1,c).priceSol)}),c),/70 bins/,'a materially off-grid floor must not silently narrow');
for(const change of [{activeBin:1.1},{binStep:0},{binStep:1.1},{minNativeBin:1},{maxNativeBin:-1},{decimalsX:19},{decimalsY:8}])assert.throws(()=>range(parse({}),{...c,...change}));

const mint=(address,decimals,tlvData=Buffer.alloc(0))=>({address,mintAuthority:null,freezeAuthority:null,decimals,supply:1000000000000n,isInitialized:true,tlvData});
const pairedKey=new PublicKey('AGi2s9zPRPHs3zEDPhPTroumTEXK5ufymYSfEFndCSSW');
const normal=mint(pairedKey,6),native=mint(spl.NATIVE_MINT,9),clock={epoch:new BN(5)};
const feeConfig={transferFeeConfigAuthority:PublicKey.default,withdrawWithheldAuthority:PublicKey.default,withheldAmount:0n,olderTransferFee:{epoch:0n,maximumFee:20n,transferFeeBasisPoints:100},newerTransferFee:{epoch:6n,maximumFee:100000000n,transferFeeBasisPoints:1000}};
const tlv=Buffer.alloc(4+spl.TransferFeeConfigLayout.span);tlv.writeUInt16LE(spl.ExtensionType.TransferFeeConfig,0);tlv.writeUInt16LE(spl.TransferFeeConfigLayout.span,2);spl.TransferFeeConfigLayout.encode(feeConfig,tlv.subarray(4));
const taxed=mint(pairedKey,6,tlv);
for(const solX of [false,true]){
 const ctx=context(solX),r=range(bounds(ctx,solX?10:-10,solX?1:-1,'sol-only'),ctx);
 const allocation=strategy=>expected({range:r,strategy,amountXRaw:solX?'1000000000':'0',amountYRaw:solX?'0':'1000000000',activeXRaw:'0',activeYRaw:'0',mintX:solX?native:taxed,mintY:solX?taxed:native,clock});
 const bid=allocation(sdk.StrategyType.BidAsk),spot=allocation(sdk.StrategyType.Spot),curve=allocation(sdk.StrategyType.Curve);
 assert.equal(bid.status,'expected');assert.equal(bid.pairedRaw,'0','SOL-only creates no paired funding or deposit tax');
 assert.equal(bid.solRaw,solX?'999999996':'999999995','exact SDK integer dust remains visible');
 assert.ok(bid.bins[0].valueSolAtReview>bid.bins.at(-1).valueSolAtReview,'BidAsk is heavier at the far SOL/token floor');
 assert.ok(curve.bins[0].valueSolAtReview<curve.bins.at(-1).valueSolAtReview,'one-sided Curve is heavier nearest active');
 assert.ok(new Set(spot.bins.map(b=>b.solRaw)).size<(solX?11:2),'Spot uses SDK price-adjusted native amounts');
 close(bid.valueSolAtReview,Number(bid.solRaw)/1e9,'one-sided capital marked in SOL');
 assert.throws(()=>expected({range:r,strategy:0,amountXRaw:'100',amountYRaw:'100',activeXRaw:'0',activeYRaw:'0',mintX:solX?native:normal,mintY:solX?normal:native,clock}),/cannot fund paired/);
 assert.throws(()=>expected({range:r,strategy:0,amountXRaw:solX?'1':'0',amountYRaw:solX?'0':'1',activeXRaw:'0',activeYRaw:'0',mintX:solX?native:normal,mintY:solX?normal:native,clock}),/too small/);
 const both=range(bounds(ctx,solX?3:-3,solX?-3:3),ctx);
 const request={range:both,strategy:0,amountXRaw:solX?'500000000':'1000000',amountYRaw:solX?'1000000':'500000000',activeXRaw:'500000',activeYRaw:'1000000',mintX:solX?native:taxed,mintY:solX?taxed:native,clock};
 const capped=expected(request);assert.ok(BigInt(capped.pairedRaw)<=999980n&&BigInt(capped.pairedRaw)>=999973n,'one 20-raw deposit cap plus less than one raw unit of rounding per selected bin');
 assert.ok(BigInt(capped.solRaw)<=500000000n&&BigInt(capped.solRaw)>=499999993n,'native allocation conserves its budget, with only raw-unit rounding');
 const changed=expected({...request,clock:{epoch:new BN(6)}});assert.ok(BigInt(changed.pairedRaw)<BigInt(capped.pairedRaw),'current epoch changes the actual SDK deposit fee');
 // Supply shares determine simulated principal; fees and expected shape are
 // not used to manufacture the result. Raw arithmetic works above safe ints.
 const reserves=Array.from({length:both.binCount},(_,i)=>({binId:both.lowerBin+i,amountXRaw:'9007199254740993',amountYRaw:'1000000000',supplyRaw:'30'}));
 const actual=simulated({range:both,sharesRaw:reserves.map(()=> '7'),bins:reserves,reviewPriceSol:both.activePriceSol*1.02});
 assert.equal(actual.status,'simulated');assert.equal(actual.bins.length,7);assert.equal(actual.totalXRaw,(9007199254740993n*7n/30n*7n).toString());
 assert.equal(actual.totalYRaw,(1000000000n*7n/30n*7n).toString());
 assert.equal(actual.reviewPriceSol,both.activePriceSol*1.02);assert.match(actual.assumption,/returned simulated position shares/);
 assert.ok(actual.bins.every(b=>b.positionShareRaw==='7'&&b.supplyRaw==='30'));
 assert.throws(()=>simulated({range:both,sharesRaw:reserves.map(()=> '31'),bins:reserves}),/exceeds bin supply/);
 assert.throws(()=>simulated({range:both,sharesRaw:['7'],bins:reserves}),/incomplete/);
 assert.throws(()=>simulated({range:both,sharesRaw:reserves.map(()=> '7'),bins:reserves.slice(1)}),/incomplete/);
 assert.throws(()=>simulated({range:both,sharesRaw:reserves.map(()=> '7'),bins:reserves.map((b,i)=>i?b:reserves[1])}),/duplicate/);
 const empty=simulated({range:both,sharesRaw:reserves.map(()=> '0'),bins:reserves.map(b=>({...b,supplyRaw:'0'}))});assert.equal(empty.totalXRaw,'0');assert.equal(empty.totalYRaw,'0');
 assert.throws(()=>format(actual.bins.map((b,i)=>i?b:{...b,binId:999}),both,'simulated','fixture'),/does not match/);
 assert.equal(fromEvidence(capped,()=>actual).status,'simulated');
 const fallback=fromEvidence(capped,()=>{throw new IncompleteEvidence('RPC did not return one bin-array account');});assert.equal(fallback.status,'expected');assert.match(fallback.assumption,/accounts were not returned/);
 assert.throws(()=>fromEvidence(capped,()=>{throw Error('A simulated bin array belongs to another pool');}),/another pool/,'identity mismatch cannot become expected');
 assert.throws(()=>fromEvidence(capped,()=>{throw Error('A simulated bin array has the wrong program owner');}),/program owner/);
 assert.throws(()=>fromEvidence(capped,()=>simulated({range:both,sharesRaw:reserves.map(()=> '31'),bins:reserves})),/exceeds bin supply/,'invalid share maths cannot become expected');
 assert.throws(()=>fromEvidence(capped,()=>simulated({range:both,sharesRaw:reserves.map(()=> '7'),bins:reserves.map((b,i)=>i?b:reserves[1])})),/duplicate/);
 assert.throws(()=>fromEvidence(capped,()=>empty),/no principal/,'known zero principal cannot become expected');
}
console.log('PASS DLMM exact range: canonical SOL/token orientation, signed IDs, precise grid boundaries, 69-bin setup and protocol limits, SOL-only exclusion, SDK shapes/raw dust/epoch taxes, and simulated share-derived principal');
