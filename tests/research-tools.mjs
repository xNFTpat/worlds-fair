import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const dir=await mkdtemp(join(tmpdir(),'lp-range-ui-'));
await build({entryPoints:['src/research-range.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'range.cjs')});
const require=createRequire(import.meta.url),math=require(join(dir,'range.cjs'));
const source=(await readFile('public/research-tools.js','utf8')).replace(/^import[^\n]+\n/gm,'');
const now=Date.parse('2026-09-29T12:00:00Z'),asOf=new Date(now).toISOString();
let clockNow=now;
class FixedDate extends Date {static now(){return clockNow;}}
const result={innerHTML:''},host={innerHTML:''},button={textContent:'',onclick:null};
const copyHeading={textContent:''};
const form={values:{size:'1',price:'.001',floor:'.0008',binStep:'100',shape:'Spot',sided:'two',mode:'best',network:'0.0001',rent:'0',saleCost:'',fundingCost:''},elements:{support:{onchange:null},floor:{value:'.0008'}},onsubmit:null};
const nodes=new Map([['researchRangeResult',result],['researchRangeBuilder',host],['researchRangeForm',form],['copyResearchRange',button],['researchCopyHeading',copyHeading]]);
let copied='',clipboardWrites=0;
let legacyComposerCalls=0;
const context={...math,Date:FixedDate,console,document:{getElementById:id=>nodes.get(id),addEventListener(){}},window:{LPExecutionLink:{build(){legacyComposerCalls++;return '/synthetic-legacy-compose';}}},navigator:{clipboard:{writeText:async text=>{clipboardWrites++;copied=text;}}},FormData:class{constructor(form){this.form=form;}get(key){return this.form.values[key]??null;}}};
vm.runInNewContext(source+'\nglobalThis.rangeUI={taxInputs,quoteInputs,rangeAnchor,renderRange,calculateRange,last:()=>lastRange};',context);
const ui=context.rangeUI;
const row={pool:{fetchedAt:asOf,base:{address:'token'}},priceSol:.001,config:{binStep:100},feeRates:{h1:.001,h4:.009,asOf},
  safety:{rpc:{status:'available',asOf,decimals:6,transferFeeStatus:'none',transferFee:null}},
  structure:{asOf,supportLevels:[.0005,.0009,.0009,.0008,.002]},quotes:[
    {sizeSol:.5,mode:'best',status:'quoted',asOf,tokenRaw:'495000000',exitCostSol:.00495,selectedPoolMatched:true},
    {sizeSol:1,mode:'best',status:'quoted',asOf,tokenRaw:'990000000',exitCostSol:.0198,selectedPoolMatched:false},
  ]};
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-10,`${msg}: ${a} vs ${b}`);

// Position-size exit reference and half-position funding must remain distinct.
const quote=ui.quoteInputs(row,1,'best',.5);
near(quote.exitCostFraction,.02,'one-SOL exit reference');
near(quote.fundingCostFraction,.01,'half-SOL funding reference');
assert.equal(quote.selectedPoolMatched,false);
assert.equal(ui.quoteInputs(row,.5,'best',.25).fundingCostFraction,null,'no full-size substitution for missing quarter-SOL funding');
assert.equal(ui.quoteInputs(row,.75,'best',.375).exitCostFraction,null,'no neighbouring size substitution');
assert.equal(ui.quoteInputs(row,1,'dlmm',.5).exitCostFraction,null,'no best-route substitution for DLMM route');
assert.equal(ui.quoteInputs(row,1,'best').fundingCostFraction,null,'SOL-only needs no funding quote');
const oldQuote={...row,quotes:row.quotes.map(q=>({...q,asOf:new Date(now-45001).toISOString()}))};
assert.equal(ui.quoteInputs(oldQuote,1,'best',.5).exitCostFraction,null,'expired quote does not become zero cost');
assert.equal(ui.quoteInputs(oldQuote,1,'best',.5).fundingCostFraction,null);
const futureQuote={...row,quotes:row.quotes.map(q=>({...q,asOf:new Date(now+60001).toISOString()}))};
assert.equal(ui.quoteInputs(futureQuote,1,'best',.5).exitCostFraction,null);
const stalePool={...row,pool:{...row.pool,fetchedAt:new Date(now-600001).toISOString()}};
assert.equal(ui.quoteInputs(stalePool,1,'best',.5).exitCostFraction,null,'fresh quote with saved pool mark is not current cost fraction');
assert.equal(ui.taxInputs({...row,safety:{rpc:{...row.safety.rpc,status:'stale'}}}).transferFeeBps,null);
assert.equal(ui.taxInputs({...row,safety:{rpc:{...row.safety.rpc,asOf:new Date(now-300001).toISOString()}}}).transferFeeBps,null);
assert.equal(ui.taxInputs(row).transferFeeBps,0,'verified classic token has explicit zero tax');

ui.calculateRange(row,form);
assert.ok(ui.last());
near(ui.last().roughFeeSolPerHour,.001,'uses labelled 1h rate, not 4h pace');
near(ui.last().selected.fundingCostSol,.005,'one-sided quote loss applies to half funded SOL');
near(ui.last().selected.initialPairedTokens,495,'token half funding from actual half-size quote');
assert.match(result.innerHTML,/Approximate bin alignment/);
assert.match(result.innerHTML,/Copy estimate/);
assert.equal(legacyComposerCalls,0,'public research never invokes the legacy signing link builder');
assert.doesNotMatch(result.innerHTML,/PayBox|Prepare this range|synthetic-legacy-compose/,'public research exposes calculation and copy only');
assert.match(result.innerHTML,/not a quote for the eventual exit inventory/);
assert.match(result.innerHTML,/selected-pool match: not matched/);
assert.match(result.innerHTML,/Lifecycle costs/);
assert.doesNotMatch(result.innerHTML,/NaN|Infinity/);
await button.onclick({target:button});
assert.match(copied,/SOL per paired token/);
assert.equal(button.textContent,'Copied');

// Inversion affects copied native Y/X bounds only; all scenarios stay SOL/token.
const inverted={...row,pool:{...row.pool,base:{address:'So11111111111111111111111111111111111111112'}}};
const original=ui.last();ui.calculateRange(inverted,form);
const reverse=ui.last();
near(reverse.selected.atFloor.pnlSol,original.selected.atFloor.pnlSol,'orientation cannot change SOL economics');
near(reverse.copyPrices.top,1/original.bottomPriceSol,'native inverse top');
near(reverse.copyPrices.bottom,1/original.topPriceSol,'native inverse bottom');
assert.match(result.innerHTML,/paired token per SOL/);

// Freshness affects current-rate/tax results, while saved inventory scenarios
// remain viewable with honest unavailable fields.
ui.calculateRange(stalePool,form);
assert.equal(ui.last().roughFeeSolPerHour,null);
assert.equal(ui.last().selected.atFloor.pnlSol,null);
assert.match(result.innerHTML,/saved\/unavailable fee rate is not used/);
ui.calculateRange({...row,safety:{rpc:{...row.safety.rpc,status:'unavailable'}}},form);
assert.equal(ui.last().selected.atFloor.pnlSol,null);
assert.match(result.innerHTML,/transfer fee unavailable/);
const noFees={...row,feeRates:{...row.feeRates,h1:0}};ui.calculateRange(noFees,form);
assert.equal(ui.last().roughFeeSolPerHour,0);
assert.match(result.innerHTML,/No fees at current rate/);

// A blank required cost is not silently a zero-cost scenario. Explicit user
// cost assumptions can replace missing size-specific quote evidence.
form.values.network='';ui.calculateRange(row,form);
assert.equal(ui.last(),null);assert.match(result.innerHTML,/network cost.*assumption/);
form.values.network='0';form.values.rent='';ui.calculateRange(row,form);
assert.equal(ui.last(),null);assert.match(result.innerHTML,/refundable rent.*assumption/);
form.values.rent='0';form.values.size='';ui.calculateRange(row,form);
assert.equal(ui.last(),null);assert.match(result.innerHTML,/positive position size/);
form.values.size='.5';ui.calculateRange(row,form);
assert.equal(ui.last().selected.atFloor.pnlSol,null);
assert.match(result.innerHTML,/Two-sided funding quote unavailable/);
form.values.fundingCost='1';ui.calculateRange(row,form);
assert.ok(Number.isFinite(ui.last().selected.atFloor.pnlSol));
assert.match(result.innerHTML,/your 1% assumption/);
form.values.size='.75';form.values.saleCost='2';ui.calculateRange(row,form);
assert.ok(Number.isFinite(ui.last().selected.atFloor.pnlSol));
assert.match(result.innerHTML,/your 2% assumption/);
form.values.saleCost='-1';ui.calculateRange(row,form);
assert.equal(ui.last(),null);assert.match(result.innerHTML,/exitCostFraction/);

// Nearest support appears first, duplicates and levels above price are removed.
form.values={...form.values,size:'1',saleCost:'',fundingCost:'',network:'.0001'};
ui.renderRange(row);
assert.match(host.innerHTML,/name="floor"[^>]+value="0\.0009"/);
assert.equal((host.innerHTML.match(/value="0\.0009"/g)||[]).length,2,'floor + one unique support option');
assert.ok(host.innerHTML.indexOf('Nearest · 0.0009000000000')<host.innerHTML.indexOf('0.0008000000000'));
assert.match(host.innerHTML,/name="price"[^>]+readonly/);
assert.match(host.innerHTML,/name="binStep"[^>]+readonly/);
form.elements.support.onchange({target:{value:'.0008'}});
assert.equal(form.elements.floor.value,'.0008');

// Fresh validated native RPC evidence replaces the catalogue price as a bin
// reference, while quote-cost fractions retain their own catalogue mark.
const anchored={...row,rangeAnchor:{status:'available',asOf,activeBinId:321,activeBinPriceSol:.0012345678901234567,binStep:100,slot:400123456,minNativeBinId:-10000,maxNativeBinId:10000,note:'Validated native account'}};
ui.calculateRange(anchored,form);
const verified=ui.last();
assert.equal(verified.alignment,'native-active-bin');
assert.equal(verified.priceSol,anchored.rangeAnchor.activeBinPriceSol);
assert.equal(verified.activeBinId,321);
assert.ok(verified.selected.bins.every(b=>Number.isSafeInteger(b.nativeBinId)));
near(ui.quoteInputs(anchored,1,'best',.5).exitCostFraction,quote.exitCostFraction,'anchor never revalues a previously measured quote cost');
near(verified.selected.fundingCostSol,.005,'same half-size quote loss fraction remains a cost assumption');
assert.match(result.innerHTML,/RPC-verified bin alignment/);
assert.match(result.innerHTML,/slot 400123456/);
assert.match(result.innerHTML,/Native position bins/);
assert.match(result.innerHTML,/Verified bin-aligned copy prices/);
assert.match(result.innerHTML,/Copy bin bounds/);
assert.match(result.innerHTML,/17 significant digits/);
assert.match(result.innerHTML,/Fee share, deposit shape and future exit costs remain estimates/);
assert.match(result.innerHTML,/not a bit-exact Q64 execution price/);
assert.match(result.innerHTML,/Confirm these native bin IDs after pasting prices into Meteora/);
assert.doesNotMatch(result.innerHTML,/Approximate bin alignment/);
const displayedBottom=result.innerHTML.match(/Bottom <code>([^<]+)<\/code>/)[1];
const displayedTop=result.innerHTML.match(/Top <code>([^<]+)<\/code>/)[1];
assert.equal(Number(displayedBottom),verified.copyPrices.bottom,'displayed bound round-trips full Number precision');
assert.equal(Number(displayedTop),verified.copyPrices.top);
assert.equal(displayedBottom,verified.copyPrices.bottom.toPrecision(17));
assert.equal(displayedTop,verified.copyPrices.top.toPrecision(17));
await button.onclick({target:button});
assert.match(copied,/Verified active bin 321/);
assert.match(copied,new RegExp('Native bins '+verified.lowerNativeBin+' to '+verified.upperNativeBin));
assert.ok(copied.includes(displayedBottom)&&copied.includes(displayedTop));
assert.doesNotMatch(copied,/Estimated bounds/);
assert.match(copied,/Confirm these native bin IDs after pasting prices into Meteora/);
const writesBeforeExpiry=clipboardWrites,copyBeforeExpiry=copied;
clockNow=now+60001;
await button.onclick({target:button});
assert.equal(clipboardWrites,writesBeforeExpiry,'copy click rechecks anchor TTL before clipboard write');
assert.equal(copied,copyBeforeExpiry,'expired alignment never replaces clipboard with stale verified bounds');
assert.equal(button.textContent,'Refresh pool data to copy');
assert.match(copyHeading.textContent,/Saved bin alignment/);
clockNow=now;
const anchoredInverse={...anchored,pool:{...anchored.pool,base:{address:'So11111111111111111111111111111111111111112'}}};
ui.calculateRange(anchoredInverse,form);
const nativeReverse=ui.last();
assert.equal(nativeReverse.alignment,'native-active-bin');
near(nativeReverse.selected.atFloor.pnlSol,verified.selected.atFloor.pnlSol,'verified canonical economics invariant to native orientation');
assert.equal(nativeReverse.lowerNativeBin,321-nativeReverse.selected.bins.at(-1).offset);
assert.equal(nativeReverse.upperNativeBin,321-nativeReverse.selected.bins[0].offset);
assert.equal(nativeReverse.copyPrices.bottom,1/verified.topPriceSol);
assert.equal(nativeReverse.copyPrices.top,1/verified.bottomPriceSol);
assert.match(result.innerHTML,/paired token per SOL/);

for(const patch of [
 {status:'unknown'},{status:'stale'},{asOf:new Date(now-60001).toISOString()},
 {asOf:new Date(now+60001).toISOString()},{activeBinId:321.5},{activeBinPriceSol:0},
 {activeBinPriceSol:Infinity},{binStep:101},{binStep:0},{binStep:100.5},
 {minNativeBinId:322},{maxNativeBinId:320},{minNativeBinId:2.5},
 {minNativeBinId:400,maxNativeBinId:300},
 {minNativeBinId:null},{maxNativeBinId:undefined},
]){
 const invalid={...anchored,rangeAnchor:{...anchored.rangeAnchor,...patch}};
 assert.equal(ui.rangeAnchor(invalid),null,JSON.stringify(patch));
 ui.calculateRange(invalid,form);
 assert.equal(ui.last().alignment,'assumed-active-price');
 assert.equal(ui.last().priceSol,row.priceSol,'unverified RPC source cannot remain a live anchor');
 assert.match(result.innerHTML,/Approximate bin alignment/);
 assert.match(result.innerHTML,/Copy estimate/);
}
assert.ok(ui.rangeAnchor({...anchored,rangeAnchor:{...anchored.rangeAnchor,activeBinId:0,asOf:new Date(now-60000).toISOString()}}),'native bin0 and exact60sTTL are valid');
assert.ok(ui.rangeAnchor({...anchored,rangeAnchor:{...anchored.rangeAnchor,activeBinId:-123}}),'negative native bin IDs are valid');
assert.ok(ui.rangeAnchor({...anchored,config:{binStep:null}}),'native decoded bin step fills an unknown catalogue config');
const limited={...anchored,rangeAnchor:{...anchored.rangeAnchor,minNativeBinId:320,maxNativeBinId:322}};
assert.ok(ui.rangeAnchor(limited),'active bin can be valid while requested position exceeds protocol bounds');
ui.calculateRange(limited,form);
assert.equal(ui.last(),null);
assert.match(result.innerHTML,/exceed the pool-supported bounds 320 to 322/);
assert.doesNotMatch(result.innerHTML,/Copy bin bounds|Verified bin-aligned copy prices/);
ui.calculateRange({...limited,pool:anchoredInverse.pool},form);
assert.equal(ui.last(),null,'SOL-base orientation also checks native min/max protocol bounds');
assert.match(result.innerHTML,/exceed the pool-supported bounds/);
ui.calculateRange({...limited,rangeAnchor:{...limited.rangeAnchor,minNativeBinId:undefined,maxNativeBinId:undefined,minBinId:320,maxBinId:322}},form);
assert.equal(ui.last(),null,'legacy bounds aliases retain protocol protection');
const lowerAnchor={...anchored,rangeAnchor:{...anchored.rangeAnchor,activeBinPriceSol:.00085}};
ui.renderRange(lowerAnchor);
assert.match(host.innerHTML,/RPC active bin · SOL per token/);
assert.match(host.innerHTML,/name="price"[^>]+value="0\.00085"[^>]+readonly/);
assert.match(host.innerHTML,/name="floor"[^>]+value="0\.0008"/);
assert.doesNotMatch(host.innerHTML,/value="0\.0009"/,'support above the verified active reference is excluded');
assert.doesNotMatch(source,/fetch\(|sendTransaction|sendRawTransaction|request_wallet_sign/);
console.log('PASS range UI: quote size/route and TTL separation, true half-size funding, observed rate/tax freshness, verified native anchors/IDs/full-precision copies, inverse orientation, stale anchor fallback, support selection, explicit zero vs unknown costs and read-only controls');
