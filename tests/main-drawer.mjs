import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

// Drive the real drawer model and markup helpers against the same pure math as
// production. No wallet provider, network request or browser signing is loaded.
const dir=await mkdtemp(join(tmpdir(),'lp-main-drawer-'));
const source=await readFile('public/main-pool-drawer.js','utf8');
await build({stdin:{contents:source+'\nexport {moreHtml,scenariosHtml,comparisonHtml,rangeHtml,modelSignature,setDefault,update,refreshAgedSources};',resolveDir:resolve('public'),sourcefile:'main-pool-drawer.js'},outfile:join(dir,'drawer.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'source-range',setup(b){b.onResolve({filter:/^\.\/research-range\.js$/},()=>({path:resolve('src/research-range.ts')}));}}]});
const {poolDrawerModel,applySuggestedRange,applyFloorDepth,moreHtml,scenariosHtml,comparisonHtml,rangeHtml,modelSignature,setDefault,update,refreshAgedSources}=await import(join(dir,'drawer.mjs'));
const now=Date.UTC(2026,8,30,12),iso=t=>new Date(t).toISOString();
const SOL='So11111111111111111111111111111111111111112';
function fixture(){return {pool:{id:'solana:4fvH46ajCnwsDxcdr9LWMMB4BfPnxtk8KLof9bTrBp9K',pair:'e/acc-SOL',fetchedAt:iso(now),base:{address:'paired'},quote:{address:SOL},tvlUsd:100000},priceSol:1.09212e-4,config:{binStep:50},feeRates:{asOf:iso(now),h1:.02,h4:.001,h12:.003},safety:{rpc:{status:'available',asOf:iso(now),decimals:6,mintAuthority:null,freezeAuthority:null,transferFeeStatus:'none',concentration:{holders:{status:'available',asOf:iso(now),top10Fraction:.7,top1Fraction:.2,label:'Sampled owner concentration'}}},flags:[]},structure:{asOf:iso(now),supportLevels:[],windows:[]},quotes:[]};}
const input={sizeSol:.5,oneSided:true,floorPriceSol:8.1909e-5,saleCostFraction:.005,networkSol:0};
let row=fixture(),m=poolDrawerModel(row,input,now);
assert.equal(m.range.binCount,58);
assert.ok(Math.abs(m.range.topPriceSol-1.0866865671641792e-4)<1e-18);
assert.ok(Math.abs(m.range.bottomPriceSol-8.177843186770718e-5)<1e-18);
const spot=m.range.comparison.find(c=>c.shape==='Spot'),bid=m.range.comparison.find(c=>c.shape==='BidAsk');
assert.equal((spot.atFloor.returnFraction*100).toFixed(1),'-13.4');
assert.equal((bid.atFloor.returnFraction*100).toFixed(1),'-9.3');
assert.ok(spot.belowFloor.returnFraction<spot.atFloor.returnFraction);
assert.ok(bid.belowFloor.returnFraction<bid.atFloor.returnFraction);
assert.equal(m.rate,.001,'the primary rate is the 4h-window fee density, even when h1 differs');
assert.ok(bid.atFloor.exitRecoveryHours>0&&bid.atFloor.exitRecoveryHours<bid.atFloor.scenarioBreakEvenHours,'exit costs and full scenario loss have distinct recovery horizons');
const scenarioMarkup=scenariosHtml(row,m);
assert.match(scenarioMarkup,/0\.4331 SOL/);assert.match(scenarioMarkup,/-13\.4%/);
assert.match(scenarioMarkup,/0\.4536 SOL/);assert.match(scenarioMarkup,/-9\.3%/);
assert.match(scenarioMarkup,/10% lower/);assert.match(comparisonHtml(row,m),/Fees to cover this range exit/);
assert.match(comparisonHtml(row,m),/4h window \/ hour/);

// Two-sided defaults narrow to fit the local setup; an explicit deeper floor
// remains the user's scenario and must be warned about rather than rewritten.
for(const oneSided of [true,false]){
 const d=poolDrawerModel(row,{oneSided,networkSol:0},now);
 assert.ok(d.range.binCount<=69);
}
const deep=poolDrawerModel(row,{...input,oneSided:false,floorPriceSol:row.priceSol*.8},now);
assert.ok(deep.range.binCount>69);assert.equal(deep.range.exceedsSetupBins,true);
assert.equal(deep.range.requestedFloorPriceSol,row.priceSol*.8);
assert.match(rangeHtml(row,deep),/Over 69 bins/);
for(const invalid of [{sizeSol:null},{floorPriceSol:null},{networkSol:null}])assert.equal(poolDrawerModel(row,{...input,...invalid},now).range,null,'blank required inputs are not silently defaulted');
row.feeRates.h4=null;assert.equal(poolDrawerModel(row,input,now).rate,null,'h1 must not silently replace an unknown 4h window');row=fixture();

// A cached economic estimate uses its original marked value and dated quote
// legs. Changing a later pool scan cannot invent a cheaper sale/funding ratio.
const old=now-120000,markedPrice=.0001;
row.quotes=[{sizeSol:.5,mode:'best',status:'stale',asOf:iso(old),buyAsOf:iso(old),sellAsOf:iso(old+1000),tokenRaw:'5000000000',economicEstimate:{costModelVersion:3,status:'available',roundTripCostSol:.01,exitCostSol:.005,asOf:iso(old),dataAsOf:iso(old-1000),expiresAt:old+600000,cached:true,markAsOf:iso(old-1000),markPriceSol:markedPrice,tokenDecimals:6}}];
const cached=poolDrawerModel(row,{sizeSol:.5,networkSol:0},now);
assert.equal(cached.exitFraction,.01);assert.equal(cached.net4h,.004-.02);
row.quotes[0].economicEstimate.exitCostSol=0;row.quotes[0].economicEstimate.exitFeeFloorSol=.0025;
assert.equal(poolDrawerModel(row,{sizeSol:.5,networkSol:0},now).exitFraction,.005,'the original sell pool-fee floor cannot become a zero-cost scenario');
row.quotes[0].economicEstimate.exitCostSol=.005;delete row.quotes[0].economicEstimate.exitFeeFloorSol;
row.quotes[0].economicEstimate.exitFeeSource='assumed';
assert.match(scenariosHtml(row,poolDrawerModel(row,{sizeSol:.5,networkSol:0},now)),/fee floor assumed/,'a dated quote with an assumed sell-fee floor says so visibly');
delete row.quotes[0].economicEstimate.exitFeeSource;
row.priceSol*=2;const repriced=poolDrawerModel(row,{sizeSol:.5,networkSol:0},now);
assert.equal(repriced.exitFraction,cached.exitFraction);assert.equal(repriced.net4h,cached.net4h);
delete row.quotes[0].economicEstimate.costModelVersion;
assert.equal(poolDrawerModel(row,{sizeSol:.5,networkSol:0},now).sale,null,'pre-v3 estimates with the old zero-cost bug are never reused');
const oldQuoted=structuredClone(row);Object.assign(oldQuoted.quotes[0],{status:'quoted',asOf:iso(now-1000),buyAsOf:iso(now-1000),sellAsOf:iso(now),expiresAt:now+44000});
oldQuoted.quotes[0].economicEstimate.costModelVersion=2;oldQuoted.quotes[0].economicEstimate.markAsOf=iso(now-1000);
assert.equal(poolDrawerModel(oldQuoted,{sizeSol:.5,networkSol:0},now).sale,null,'fresh raw quote fallback cannot revive a pre-v3 cost model');
row.quotes[0].economicEstimate.costModelVersion=3;
row.quotes[0].economicEstimate.markAsOf=iso(now-3600001);
const oldMark=poolDrawerModel(row,{sizeSol:.5,networkSol:0},now);
assert.equal(oldMark.sale.roundTripCostSol,.01,'an absolute round-trip estimate retains its original cost even without a usable old mark');
assert.equal(oldMark.exitFraction,.005,'an unusable mark uses the explicitly assumed sale fraction rather than a later scan');
assert.equal(oldMark.saleAssumed,true);assert.ok(Number.isFinite(oldMark.range.selected.atFloor.returnFraction));
row.quotes[0].economicEstimate.markAsOf=iso(old-1000);
const beforeExpiry=poolDrawerModel(row,{sizeSol:.5,networkSol:0},old+600000-1),retained=poolDrawerModel(row,{sizeSol:.5,networkSol:0},old+600000);
assert.ok(beforeExpiry.sale&&retained.sale,'last good research cost remains available after the refresh TTL');
assert.equal(retained.sale.retained,true);assert.equal(retained.exitFraction,.01);
assert.notEqual(modelSignature(beforeExpiry),modelSignature(retained),'timer observes fresh-to-last-good label changes');
assert.ok(Number.isFinite(retained.range.selected.atFloor.returnFraction));
assert.match(scenariosHtml(row,retained),/last good/);
assert.equal(poolDrawerModel(row,{sizeSol:.5},old+3600000).sale,null,'last good research estimate expires exactly at sixty minutes');
row.quotes[0].economicEstimate.status='stale';row.quotes[0].economicEstimate.retainedUntil=old+3600000;
assert.equal(poolDrawerModel(row,{sizeSol:.5},old+1800000).sale.retained,true,'backend stale contract keeps its immutable quote mark');
row.quotes[0].economicEstimate.retainedUntil=old+3600001;assert.equal(poolDrawerModel(row,{sizeSol:.5},now).sale,null,'overextended retention is rejected');
row.quotes[0].economicEstimate.retainedUntil=old+3600000;row.quotes[0].economicEstimate.expiresAt=old+600001;assert.equal(poolDrawerModel(row,{sizeSol:.5},now).sale,null,'overextended refresh TTL is rejected');
row.quotes[0].economicEstimate.expiresAt=old+600000;row.quotes[0].sellAsOf=iso(now+1);assert.equal(poolDrawerModel(row,{sizeSol:.5},now).sale,null,'future quote legs are rejected');

// Missing quotes and older token policy cannot suppress conversion scenarios.
// Safety chips stay strict; every scenario makes its cost assumptions explicit.
row=fixture();m=poolDrawerModel(row,{...input,saleCostFraction:undefined},now);
assert.equal(m.exitFraction,.005);assert.equal(m.saleAssumed,true);
assert.match(scenariosHtml(row,m),/Exit: 0\.5% assumed/);
assert.doesNotMatch(scenariosHtml(row,m).match(/<table[\s\S]*?<\/table>/)[0],/Unknown/);
assert.match(moreHtml(row,m),/Mint authority off · freeze off/);
assert.match(moreHtml(row,m),/top 10 70\.0% · largest 20\.0%/);
const stale=poolDrawerModel(row,input,now+300001);
assert.equal(stale.tax.transferFeeBps,null);assert.equal(stale.scenarioTax.transferFeeBps,0);
assert.ok(Number.isFinite(stale.range.selected.atFloor.returnFraction),'dated policy remains a disclosed scenario assumption');
assert.match(moreHtml(row,stale),/Mint authority not verified · freeze not verified/);
assert.match(moreHtml(row,stale),/top 10 Unavailable · largest Unavailable/);
assert.match(moreHtml(row,stale),/Stress scenarios reuse dated costs and token policy for up to 60 minutes/);
for(const status of ['stale','rate-limited','unavailable']){
 row.safety.rpc.status=status;
 const lastPolicy=poolDrawerModel(row,input,now+300001);
 assert.equal(lastPolicy.scenarioTax.transferFeeBps,0,'explicit dated none policy survives a failed refresh');
 assert.equal(lastPolicy.taxAssumed,false);
 assert.equal(lastPolicy.rpcCurrent,false,'failed refresh never makes safety current');
}
row.safety.rpc.status='stale';row.safety.rpc.decimals=null;
assert.equal(poolDrawerModel(row,input,now).taxAssumed,true,'last policy requires original verified token decimals');
row.safety.rpc.decimals=6;
row.safety.rpc.status='unknown';m=poolDrawerModel(row,{...input,saleCostFraction:undefined},now);
assert.equal(m.rpcCurrent,false);assert.equal(m.taxAssumed,true);
assert.match(moreHtml(row,m),/Mint authority not verified/);assert.match(scenariosHtml(row,m),/unverified token tax excluded/);
assert.ok(Number.isFinite(m.range.comparison[0].atFloor.pnlSol));
assert.ok(Number.isFinite(m.range.comparison[1].belowFloor.pnlSol));
assert.doesNotMatch(scenariosHtml(row,m).match(/<table[\s\S]*?<\/table>/)[0],/Unknown/);
row.feeRates.h4=null;m=poolDrawerModel(row,{...input,saleCostFraction:undefined},now);
assert.equal(m.rate,null);assert.equal(m.scenarioRate,0);
assert.match(scenariosHtml(row,m),/∞/);assert.match(scenariosHtml(row,m),/No dated positive 4h fee pace/);
assert.doesNotMatch(scenariosHtml(row,m).match(/<table[\s\S]*?<\/table>/)[0],/Unknown/);
row=fixture();m=poolDrawerModel(row,{...input,saleCostFraction:undefined},now+3600001);
assert.equal(m.saleAssumed,true);assert.equal(m.scenarioRate,0);assert.equal(m.taxAssumed,true);
assert.match(scenariosHtml(row,m),/Exit: 0\.5% assumed/);assert.match(scenariosHtml(row,m),/∞/);
row=fixture();const twoSidedFallback=poolDrawerModel(row,{sizeSol:.5,oneSided:false,networkSol:0},now);
assert.equal(twoSidedFallback.fundingFraction,.005);assert.equal(twoSidedFallback.fundingAssumed,true);
assert.ok(twoSidedFallback.range.comparison.every(c=>Number.isFinite(c.atFloor.pnlSol)&&Number.isFinite(c.belowFloor.pnlSol)));
assert.match(scenariosHtml(row,twoSidedFallback),/funding 0\.5% assumed/);

// Token-2022 withdrawal tax uses raw paired-token units and its cap. SOL-only
// entry has no token funding/deposit transfer to tax.
row=fixture();Object.assign(row.safety.rpc,{transferFeeStatus:'known',transferFee:{bps:100,maximumRaw:'1000000'}});
const capped=poolDrawerModel(row,{...input,saleCostFraction:0},now).range.selected;
assert.equal(capped.depositTaxSol,0);
assert.ok(Math.abs(capped.atFloor.withdrawalTaxSol-capped.atFloor.priceSol)<1e-15,'one-token raw cap is valued at the floor, not interpreted as one SOL');

// Native IDs are exact orientation evidence, while human prices remain a
// floating bin-grid representation. Both orientations stay inside pool bounds.
row=fixture();row.rangeAnchor={status:'available',asOf:iso(now),activeBinId:-450,activeBinPriceSol:row.priceSol,binStep:50,minNativeBinId:-2000,maxNativeBinId:2000};
const solY=poolDrawerModel(row,input,now);
assert.equal(solY.range.lowerNativeBin,-508);assert.equal(solY.range.upperNativeBin,-451);
assert.match(rangeHtml(row,solY),/RPC bins -508 → -451/);
assert.match(rangeHtml(row,solY),/Exit fees: <b>4\.6h<\/b> · rough fee share/);
row.pool.base.address=SOL;
const solX=poolDrawerModel(row,input,now);
assert.equal(solX.range.lowerNativeBin,-449);assert.equal(solX.range.upperNativeBin,-392);
assert.equal(solX.range.copyPrices.bottom,1/solX.range.topPriceSol);
assert.equal(solX.range.copyPrices.top,1/solX.range.bottomPriceSol);
assert.equal(poolDrawerModel(row,input,now+60001).anchor,null,'native verification expires after sixty seconds');
row.rangeAnchor.maxNativeBinId=-440;assert.equal(poolDrawerModel(row,input,now).range,null,'a range outside the decoded protocol limits cannot be copied as verified');

// Drive the real mounted-controller methods with retained input nodes. Expiry
// changes the reference from RPC's active bin to a discrepant catalogue mark;
// only the automatic default is recalculated. User and support floors survive.
const OriginalDate=globalThis.Date;let clock=now;
globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
function controller(autoFloor=true){
 const data=fixture();data.priceSol*=1.05;data.structure.supportLevels=[data.priceSol/1.05*.6];data.rangeAnchor={status:'available',asOf:iso(now),activeBinId:-450,activeBinPriceSol:data.priceSol/1.05,binStep:50,minNativeBinId:-2000,maxNativeBinId:2000};
 const nodes=new Map(),node=(value='')=>({value,innerHTML:'',textContent:'',title:''});
 for(const [field,value]of Object.entries({size:'.5',shape:'BidAsk',mix:'one',floor:'',sale:'',funding:'',network:'0',rent:'0'}))nodes.set('[data-mpd-field="'+field+'"]',node(value));
 for(const panel of ['preflight','worth','structure','range','scenarios','rule'])nodes.set('[data-mpd-panel="'+panel+'"]',node());
 for(const selector of ['[data-mpd-default]','[data-mpd-reference]','[data-mpd-status]','.mpd-input-panel .mpd-panel-head'])nodes.set(selector,node());
 const c={row:data,mode:'best',sizeSol:.5,autoFloor,signature:'',dialog:{open:true,querySelector:s=>nodes.get(s)||null}};
 return {c,field:name=>nodes.get('[data-mpd-field="'+name+'"]'),panel:name=>nodes.get('[data-mpd-panel="'+name+'"]')};
}
try{
 const suggested=controller(false);suggested.c.row.config.binStep=100;suggested.c.row.rangeAnchor.binStep=100;
 suggested.field('shape').value='Curve';suggested.field('mix').value='two';suggested.field('floor').value='0.00001';suggested.field('sale').value='1';
 assert.equal(applySuggestedRange(suggested.c),true);assert.equal(suggested.field('shape').value,'BidAsk');assert.equal(suggested.field('mix').value,'one');assert.equal(suggested.field('sale').value,'1','keeps explicit cost assumptions');assert.equal(suggested.field('size').value,'.5');assert.equal(suggested.c.autoFloor,false);
 assert.equal(suggested.c.model.range.binCount,65);assert.ok(suggested.c.model.range.rangeDepthFraction>=.45&&suggested.c.model.range.rangeDepthFraction<=.5);assert.equal(suggested.c.model.range.exceedsSetupBins,false);assert.match(suggested.panel('range').innerHTML,/Top/);
 const chosen=suggested.field('floor').value;clock=now+60001;refreshAgedSources(suggested.c);assert.equal(suggested.field('floor').value,chosen,'applied suggestion is preserved as a deliberate choice after anchor expiry');assert.equal(suggested.c.model.overnightSuggested.alignment,'estimated');assert.match(suggested.panel('preflight').innerHTML,/alignment is not verified/);
 clock=now;const tooNarrow=controller(false);tooNarrow.field('shape').value='Spot';tooNarrow.field('floor').value='.00007';assert.equal(applySuggestedRange(tooNarrow.c),false);assert.equal(tooNarrow.field('shape').value,'Spot');assert.equal(tooNarrow.field('floor').value,'.00007','infeasible suggestion never rewrites manual floor');
 clock=now+600001;assert.equal(applySuggestedRange(suggested.c),false,'recheck source age when clicked');assert.equal(suggested.field('floor').value,chosen);assert.equal(suggested.c.model.overnightSuggested.status,'unavailable');
 clock=now;
 const depthChosen=controller(false);applyFloorDepth(depthChosen.c,'45');
 assert.ok(Math.abs(Number(depthChosen.field('floor').value)/depthChosen.c.row.rangeAnchor.activeBinPriceSol-.55)<1e-12,'plain percent input chooses a price 45% below the current reference');
 assert.equal(depthChosen.c.autoFloor,false);
 const typedFloor=depthChosen.field('floor').value;clock=now+60001;refreshAgedSources(depthChosen.c);assert.equal(depthChosen.field('floor').value,typedFloor,'a deliberate percentage floor remains a fixed price when the reference changes');clock=now;
 for(const value of ['','0','100','-1','NaN','Infinity']){applyFloorDepth(depthChosen.c,value);assert.equal(depthChosen.field('floor').value,'');assert.equal(depthChosen.c.model.range,null,'invalid depth cannot leave a previous valid scenario on screen');}
 const automatic=controller();setDefault(automatic.c);update(automatic.c);
 assert.equal(automatic.c.model.range.binCount,69);
 const automaticBefore=automatic.field('floor').value;clock=now+60001;refreshAgedSources(automatic.c);
 assert.equal(automatic.c.model.anchor,null);assert.ok(automatic.c.model.range.binCount<=69);
 assert.notEqual(automatic.field('floor').value,automaticBefore,'an automatic floor follows the replacement reference at anchor expiry');
 assert.doesNotMatch(automatic.panel('range').innerHTML,/Over 69 bins/);
 assert.equal(automatic.field('size').value,'.5','timer preserves the size input');
 for(const chosenFloor of [automaticBefore,String(6e-5)]){
  clock=now;const explicit=controller(false);explicit.field('floor').value=chosenFloor;update(explicit.c);
  clock=now+60001;refreshAgedSources(explicit.c);
  assert.equal(explicit.field('floor').value,chosenFloor,'typed or support-selected floors are preserved at anchor expiry');
  assert.ok(explicit.c.model.range.binCount>69);assert.match(explicit.panel('range').innerHTML,/Over 69 bins/);
 }
}finally{globalThis.Date=OriginalDate;}
console.log('PASS: main drawer SDK fixture, dated/assumed quote-free downside scenarios and fee hours, 60-minute retention, strict safety, native bounds, and preserved manual floors');
