import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dir=await mkdtemp(join(tmpdir(),'pat-t22-'));
const sdkPath=resolve('execution/node_modules/@meteora-ag/dlmm/dist/index.js'),sdk=require(sdkPath);
const spl=require(resolve('execution/node_modules/@solana/spl-token/lib/cjs/index.js'));
const {PublicKey}=require(resolve('execution/node_modules/@solana/web3.js')),BN=require(resolve('execution/node_modules/bn.js'));
for(const [name,entry]of [['reader','execution/paper-reader.ts'],['lab','execution/paper-lab-reader.ts'],['fleet','execution/paper-fleet-reader.ts']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:join(dir,name+'.cjs'),plugins:[{name:'fixture-pool',setup(b){b.onResolve({filter:/^@meteora-ag\/dlmm$/},()=>({path:'fixture-sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import * as sdk from ${JSON.stringify(sdkPath)};export const {getQPriceFromId,toAmountsBothSideByStrategy,StrategyType,calculateTransferFeeExcludedAmount}=sdk;export default {create:async()=>globalThis.__tokenPool};`,loader:'js',resolveDir:process.cwd()}));}}]});
const {readPaperPool}=require(join(dir,'reader.cjs')),{readLabPool}=require(join(dir,'lab.cjs'));
const {readFleetPool}=require(join(dir,'fleet.cjs'));
const mintKey=new PublicKey('AGi2s9zPRPHs3zEDPhPTroumTEXK5ufymYSfEFndCSSW'),q64=1n<<64n;
const config=(bps,maximum=100000000000n)=>({transferFeeConfigAuthority:PublicKey.default,withdrawWithheldAuthority:PublicKey.default,withheldAmount:0n,olderTransferFee:{epoch:0n,maximumFee:maximum,transferFeeBasisPoints:bps},newerTransferFee:{epoch:1001n,maximumFee:maximum,transferFeeBasisPoints:500}});
const tlv=c=>{const b=Buffer.alloc(4+spl.TransferFeeConfigLayout.span);b.writeUInt16LE(spl.ExtensionType.TransferFeeConfig,0);b.writeUInt16LE(spl.TransferFeeConfigLayout.span,2);spl.TransferFeeConfigLayout.encode(c,b.subarray(4));return b;};
const mint=(address,tlvData)=>({address,mintAuthority:null,freezeAuthority:null,decimals:9,supply:1000000000000n,isInitialized:true,tlvData});
let calls=[],quotedExit=true,swapFactor=99;
function fixture(solX=false,bps=300,classic=false,cap=100000000000n,depth=10000000000n){
 calls=[];quotedExit=true;swapFactor=99;
 const paired={owner:classic?spl.TOKEN_PROGRAM_ID:spl.TOKEN_2022_PROGRAM_ID,mint:mint(mintKey,classic?Buffer.alloc(0):tlv(config(bps,cap)))};
 const native={owner:spl.TOKEN_PROGRAM_ID,mint:mint(spl.NATIVE_MINT,Buffer.alloc(0))};
 const fake={tokenX:solX?native:paired,tokenY:solX?paired:native,clock:{epoch:new BN(1000)},lbPair:{tokenXMint:solX?spl.NATIVE_MINT:mintKey,tokenYMint:solX?mintKey:spl.NATIVE_MINT,activeId:0,binStep:100},getActiveBin:async()=>({binId:fake.lbPair.activeId,pricePerToken:'1',xAmount:new BN(0),yAmount:new BN(10000000000)}),getBinsBetweenLowerAndUpperBound:async(lo,hi)=>({bins:Array.from({length:hi-lo+1},(_,i)=>{const id=lo+i,x=id>0?depth:0n,y=id<=0?depth:0n;return {binId:id,xAmount:new BN(x.toString()),yAmount:new BN(y.toString()),supply:new BN((BigInt(sdk.getQPriceFromId(new BN(id),new BN(100)).toString())*x+y*q64).toString()),feeAmountXPerTokenStored:new BN(0),feeAmountYPerTokenStored:new BN(0),pricePerToken:'1'};})}),getBinArrayForSwap:async()=>[],swapQuote:(input,dir,slippage)=>{
  assert.equal(slippage.toNumber(),100);
  const inputMint=dir?fake.tokenX.mint:fake.tokenY.mint,outputMint=dir?fake.tokenY.mint:fake.tokenX.mint;
  if(!inputMint.address.equals(spl.NATIVE_MINT)&&!quotedExit)throw Error('Exit quote unavailable');
  const epoch=fake.clock.epoch.toNumber(),afterInput=sdk.calculateTransferFeeExcludedAmount(input,inputMint,epoch).amount;
  const output=sdk.calculateTransferFeeExcludedAmount(afterInput,outputMint,epoch).amount.muln(swapFactor).divn(100);
  calls.push({input:input.toString(),nativeIn:inputMint.address.equals(spl.NATIVE_MINT),output:output.toString()});
  return {consumedInAmount:input,minOutAmount:output};
 }};
 globalThis.__tokenPool=fake;
 return {fake,paired,pool:{id:'solana:test',address:spl.NATIVE_MINT.toBase58(),chain:'solana',venue:'meteora-dlmm',pair:'TEST/SOL',base:{address:fake.lbPair.tokenXMint.toBase58(),symbol:solX?'SOL':'TEST'},quote:{address:fake.lbPair.tokenYMint.toBase58(),symbol:solX?'TEST':'SOL'},activity:{volume30m:10000},tvlUsd:100000}};
}
const read=p=>readPaperPool(p,'https://unused.invalid');
for(const solX of [false,true]){
 const {pool,fake,paired}=fixture(solX);const r=await read(pool);assert.ok(r.entry,r.error);const e=r.entry;
 assert.equal(calls.length,2,'one funding and one exit quote');assert.equal(calls[0].nativeIn,true);assert.equal(calls[1].nativeIn,false);
 assert.ok(Math.abs(e.entryCosts.fundingSol-.00397)<1e-10,'funding quote includes first token transfer and slippage once');
 assert.ok(Math.abs(e.entryCosts.depositTaxSol-.0028809)<1e-10,'deposit tax is recorded, not mistaken for dust');
 assert.ok(Math.abs(e.mark.principalSol-(.1+.1*.99*.97*.97))<2e-8,'shares use after-deposit token amounts once');
 const ideal=.1+.1*.99*.97**4*.99-.0001;
 assert.ok(Math.abs(e.mark.liquidationSol-ideal)<4e-8,'funding/deposit/withdrawal/swap transfer taxes each counted once');
 assert.ok(e.entryCosts.initialRoundTripSol/.2>.05&&e.entryCosts.initialRoundTripSol/.2<.08,'3% taxed paper entry passes declared v5 gate');
 assert.ok(e.mark.withdrawTaxSol>0);assert.equal(e.mark.transferFees.find(f=>f.mint===mintKey.toBase58()).bps,300);
 fake.clock.epoch=new BN(1001);const changed=await readPaperPool(pool,'https://unused.invalid',e);
 assert.ok(changed.mark,changed.error);assert.equal(changed.mark.transferFees.find(f=>f.mint===mintKey.toBase58()).bps,500);assert.ok(changed.mark.liquidationSol<e.mark.liquidationSol);assert.equal(e.entryCosts.epoch,1000,'entry evidence stays tied to original epoch');
 quotedExit=false;const unavailable=await readPaperPool(pool,'https://unused.invalid',e);assert.equal(unavailable.mark.liquidationSol,null);assert.equal(unavailable.mark.conversionCostSol,null);
 quotedExit=true;paired.mint.mintAuthority=mintKey;assert.match((await read(pool)).error,/authority/);assert.ok((await readPaperPool(pool,'https://unused.invalid',e)).mark,'existing inventory remains readable despite entry exclusion');
 paired.mint.mintAuthority=null;paired.mint.tlvData=Buffer.from([spl.ExtensionType.PermanentDelegate,0,0,0]);assert.match((await read(pool)).error,/extension/);
}
for(const solX of [false,true]){
 const {pool,fake,paired}=fixture(solX);paired.mint.decimals=6;
 const original=fake.getActiveBin;fake.getActiveBin=async()=>({...await original(),pricePerToken:solX?'1000':'.001'});
 const r=await read(pool);assert.ok(r.entry,r.error);assert.ok(Math.abs(r.entry.mark.liquidationSol-(.1+.1*.99*.97**4*.99-.0001))<4e-8,'unequal token decimals preserve SOL-valued accounting');
}
for(const solX of [false,true]){
 const {pool}=fixture(solX,0,true);const r=await read(pool);assert.ok(r.entry,r.error);assert.equal(r.entry.entryCosts.depositTaxSol,0);assert.equal(r.entry.mark.withdrawTaxSol,0);assert.ok(Math.abs(r.entry.mark.liquidationSol-(.1+.1*.99*.99-.0001))<3e-8,'classic result unchanged');
 swapFactor=94;assert.match((await read(pool)).error,/5% untaxed paper limit/);
}
{
 const {pool}=fixture(false,1000);assert.match((await read(pool)).error,/8% transfer-taxed paper limit/);
}
{
 const {pool}=fixture(false,300,false,20n);const r=await read(pool);assert.ok(r.entry,r.error);assert.equal(r.entry.entryCosts.depositTaxSol,20/1e9,'deposit maximum fee applies once');assert.ok(r.entry.mark.withdrawTaxSol<=r.entry.model.shares.length*20/1e9);
}
{
 const {pool,paired}=fixture();paired.mint.tlvData=Buffer.alloc(0);const r=await read(pool);assert.ok(r.entry,r.error);assert.equal(r.entry.mark.withdrawTaxSol,0,'Token-2022 without transfer fee is supported');
}
// All three active lab profiles accept the same transfer-fee token and retain
// their distinct distributions/ranges. SOL-only bids need no funding swap.
{
 const {pool}=fixture();const results=await readLabPool(pool,'https://unused.invalid',[],['scalp-v4','hold-v4','pullback-v4']);
 assert.ok(results.every(r=>r.entry),JSON.stringify(results.map(r=>r.error)));assert.equal(calls.length,0);
 assert.equal(new Set(results.map(r=>r.entry.model.lowerBin+':'+r.entry.model.upperBin)).size,3);
 for(const r of results)assert.equal(r.entry.mark.transferFees[0].bps,300);
}
// The v6 wallets accept affordable Token-2022 entries (0.25% transfer tax): exercise actual SDK allocations,
// both orientations, two-sided funding and withdrawal taxes, and one-sided bids.
for(const solX of [false,true]){
 const shallow=fixture(solX,300,false,100000000000n,100000000n);
 assert.match((await readFleetPool(shallow.pool,'https://unused.invalid',[],['scalp']))[0].error,/exceed 1%/,'larger entries must still fail in a thin target bin');
 const {pool,fake}=fixture(solX,25,false,100000000000n,100000000000n);
 const results=await readFleetPool(pool,'https://unused.invalid',[],['farmer','scalp','wide','steady']);
 assert.ok(results.every(r=>r.entry),JSON.stringify(results.map(r=>({arm:r.arm,error:r.error}))));
 for(const arm of ['farmer','scalp','steady']){
  const e=results.find(r=>r.arm===arm).entry;assert.equal(e.budgetSol,2);
  assert.ok(Math.abs(e.mark.principalSol-(1+1*.99*.9975**2))<1e-7,'net deposit tax counted once at the new size');
  assert.ok(Math.abs(e.mark.liquidationSol-(1+1*.99*.9975**4*.99-.0001))<1e-7,'all four transfer legs are included');
  assert.ok(e.bidStartSol>e.entryReferenceSol&&e.bidEndSol<e.entryReferenceSol);
 }
 for(const arm of ['wide']){
  const e=results.find(r=>r.arm===arm).entry;assert.equal(e.budgetSol,2);assert.ok(Math.abs(e.mark.principalSol-2)<1e-7);
  assert.ok(e.bidStartSol<e.entryReferenceSol&&e.bidEndSol<e.bidStartSol,'SOL-only range lies below the entry price in either orientation');
 }
 assert.equal(calls.filter(c=>c.nativeIn).length,3,'three two-sided styles need funding swaps');
 quotedExit=false;const held=results.filter(r=>r.entry.arm==='farmer').map(r=>r.entry);
 const failed=await readFleetPool(pool,'https://unused.invalid',held);assert.equal(failed[0].mark.liquidationSol,null);
}
{const {pool}=fixture(false,300,false,100000000000n,100000000000n);const r=await readFleetPool(pool,'https://unused.invalid',[],['scalp']);assert.match(r[0].error,/round-trip costs exceed 2.5%/,'3% transfer tax is modelled and then rejected on cost, never a blanket Token-2022 ban');}
// Consecutive real SDK fee harvests include transfer taxes once and retain the immutable model.
for(const solX of [false,true]){
 const {pool,fake}=fixture(solX,25,false,100000000000n,100000000000n);
 const result=(await readFleetPool(pool,'https://unused.invalid',[],['scalp']))[0];assert.ok(result.entry,result.error);
 const e=result.entry;e.policy={version:'four-wallets-v4',harvestFees:true};
 assert.equal(e.model.upperBin-e.model.lowerBin+1,9);
 const model=structuredClone(e.model),readBins=fake.getBinsBetweenLowerAndUpperBound;let counter=q64/1000n;
 fake.getBinsBetweenLowerAndUpperBound=async(lo,hi)=>{const r=await readBins(lo,hi);for(const b of r.bins){b.feeAmountXPerTokenStored=new BN(counter.toString());b.feeAmountYPerTokenStored=new BN(counter.toString());}return r;};
 const first=(await readFleetPool(pool,'https://unused.invalid',[e]))[0];assert.ok(first.harvest,first.error);assert.equal(first.harvest.count,1);assert.ok(first.harvest.bankedSol>0);assert.ok(first.harvest.grossSol>first.harvest.bankedSol);assert.ok(first.harvest.taxSol>0);assert.deepEqual(e.model,model);
 const held={...e,mark:first.mark,harvest:first.harvest};
 const repeat=(await readFleetPool(pool,'https://unused.invalid',[held]))[0];assert.equal(repeat.harvest.count,1);assert.equal(repeat.harvest.bankedSol,first.harvest.bankedSol);assert.equal(repeat.mark.liquidationSol,first.mark.liquidationSol,'a repeated read cannot create more fee cash');
 counter*=2n;const second=(await readFleetPool(pool,'https://unused.invalid',[held]))[0];assert.equal(second.harvest.count,2);assert.ok(second.harvest.bankedSol>first.harvest.bankedSol);assert.ok(Math.abs(second.harvest.grossSol-first.harvest.grossSol*2)<1e-9);assert.deepEqual(e.model,model);
 quotedExit=false;const failed=(await readFleetPool(pool,'https://unused.invalid',[held]))[0];assert.ok(failed.error);assert.equal(failed.harvest,undefined,'a failed fee swap never advances a checkpoint');
}
for(const f of ['execution/paper-token-policy.ts','src/paper-token-math.ts','execution/paper-reader.ts','execution/paper-lab-reader.ts','execution/paper-fleet-reader.ts'])assert.doesNotMatch(await readFile(f,'utf8'),/sendRawTransaction|sendTransaction|Keypair|request_wallet_sign/);
// Dynamic quotes retain SDK integer math: large deep-pool entries, downsizing
// without new range fetches, and an explicit failure when even 0.1 SOL cannot fit.
await build({entryPoints:['src/fleet-allocation.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'allocation.cjs')});
const {allocationRequest}=require(join(dir,'allocation.cjs'));
for(const solX of [false,true]){
 const signal={ready:true,score:90,volumeRatio:3,drawdown:.3};
 const request=allocationRequest('scalp',100,signal);
 assert.ok(request.targetSol>98,'high-concentration paper request is actually supported');
 let data=fixture(solX,25,false,100000000000n,100000000000000n);
 let r=(await readFleetPool(data.pool,'https://unused.invalid',[],['scalp'],new Date().toISOString(),fetch,{scalp:request}))[0];
 assert.ok(r.entry,r.error);assert.equal(r.entry.budgetSol,request.targetSol);assert.equal(r.entry.allocation.attempts.length,1);
 assert.ok(r.entry.entryCosts.initialRoundTripSol>0);assert.ok(r.entry.mark.liquidationSol<r.entry.budgetSol);
 data=fixture(solX,25,false,100000000000n,10000000000n);
 let rangeReads=0;const getBins=data.fake.getBinsBetweenLowerAndUpperBound;data.fake.getBinsBetweenLowerAndUpperBound=(...args)=>{rangeReads++;return getBins(...args);};
 r=(await readFleetPool(data.pool,'https://unused.invalid',[],['scalp'],new Date().toISOString(),fetch,{scalp:request}))[0];
 assert.ok(r.entry,r.error);assert.ok(r.entry.budgetSol>=.1&&r.entry.budgetSol<2,'smaller entry salvages a pool rejected at 2 SOL');
 assert.ok(r.entry.allocation.attempts.length>1);assert.equal(rangeReads,1,'resizing reuses pool and bins');
 assert.equal(r.entry.model.upperBin-r.entry.model.lowerBin+1,9,'Heart never widens its strategy to hide a capacity failure');
 data=fixture(solX,0,true,100000000000n,1000000n);
 r=(await readFleetPool(data.pool,'https://unused.invalid',[],['scalp'],new Date().toISOString(),fetch,{scalp:request}))[0];
 assert.equal(r.entry,undefined);assert.equal(r.allocation.acceptedSol,0);assert.ok(r.allocation.attempts.length<=8);assert.match(r.error,/exceed 1%/);
 data=fixture(solX,300,false,100000000000000n,100000000000000n);
 r=(await readFleetPool(data.pool,'https://unused.invalid',[],['scalp'],new Date().toISOString(),fetch,{scalp:request}))[0];
 assert.equal(r.entry,undefined,'resizing cannot erase a proportional transfer tax');assert.match(r.error,/round-trip costs/);
 const wide=allocationRequest('wide',100,signal);assert.ok(wide.down>.35);
 data=fixture(solX,25,false,100000000000n,100000000000000n);
 r=(await readFleetPool(data.pool,'https://unused.invalid',[],['wide'],new Date().toISOString(),fetch,{wide}))[0];
 assert.ok(r.entry,r.error);assert.equal(r.entry.budgetSol,wide.targetSol);assert.ok(r.entry.bidStartSol<r.entry.entryReferenceSol&&r.entry.bidEndSol<r.entry.bidStartSol,'adaptive one-sided bids retain orientation');
}
console.log('PASS dynamic SDK sizing: nearly full cash, large and small entries, tax gates, range orientation, no extra bin fetches');
delete globalThis.__tokenPool;
console.log('PASS: all four Token-2022 readers, real SDK allocation/tax helpers, both orientations, four transfer legs, caps/epochs, failed exits, entry limits and unchanged classic math');

// Higher-cost supported tokens fail the shorter strategy's cost gate, not token identity.
{const {pool}=fixture(false,100,false,100000000000n,100000000000n);const r=await readFleetPool(pool,'https://unused.invalid',[],['farmer','scalp','steady']);assert.match(r.find(x=>x.arm==='farmer').error,/costs exceed 2%/);assert.match(r.find(x=>x.arm==='scalp').error,/costs exceed 2.5%/);assert.ok(r.find(x=>x.arm==='steady').entry);}
// A coherent on-chain price/range observation survives a held-position model failure.
{const {pool,fake}=fixture(false,25,false,100000000000n,100000000000n);const e=(await readFleetPool(pool,'https://unused.invalid',[],['scalp']))[0].entry;assert.ok(e);e.model.shares[0].share='9'.repeat(70);fake.lbPair.activeId=8;const r=(await readFleetPool(pool,'https://unused.invalid',[e]))[0];assert.match(r.error,/small-share/);assert.equal(r.market.inRange,false);assert.equal(r.market.priceSol,1);assert.equal(r.mark,undefined);}
