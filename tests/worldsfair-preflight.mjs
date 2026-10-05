import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scorePreflight,preflightHtml} from '../public/worldsfair-preflight.js';
import {PREFLIGHT_THRESHOLDS as thresholds} from '../public/worldsfair-thresholds.js';
import {suggestOvernightRange} from '../public/worldsfair-suggested-range.js';
import {buildResearchRange} from '../public/research-range.js';

const now=Date.UTC(2026,9,5,12),iso=offset=>new Date(now+offset).toISOString();
function fixture(){
  return {
    row:{pool:{fetchedAt:iso(0),ageHours:48},feeRates:{asOf:iso(0),h1:.001,h4:.001,h24:.001},
      safety:{rpc:{status:'available',asOf:iso(0),transferFeeStatus:'none'}},
      preflightEvidence:{holders:{status:'available',asOf:iso(0),topFraction:.09,complete:true},tokenAge:{status:'available',asOf:iso(0),minimumHours:48,exact:false}},
      structure:{status:'available',asOf:iso(0),windows:[{hours:24,complete:true,low:.5}]}},
    model:{now,sizeSol:.5,reference:1,referenceCost:.01,referenceExit:.005,
      sale:{asOf:iso(0),expiresAt:now+600000,retained:false},taxAssumed:false,saleAssumed:false,fundingAssumed:false,
      range:{bottomPriceSol:.5,exceedsSetupBins:false,selected:{atFloor:{pnlSol:0,returnFraction:0,unavailableReasons:[]}}}}
  };
}
const score=(f,time=now,config=thresholds)=>scorePreflight(f.row,f.model,time,config);
const line=(f,id,time=now)=>score(f,time).lines.find(item=>item.id===id);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} differs from ${b}`);

let f=fixture(),result=score(f);
assert.equal(result.lines.length,8);assert.equal(result.status,'pass');
near(result.netDailyFraction,.024-.01/.5);
assert.equal(line(f,'costs').status,'pass','Round-trip cost exactly at 2% passes');
assert.match(line(f,'net').reason,/exit is included once/);
f.model.referenceExit=.009;
near(score(f).netDailyFraction,result.netDailyFraction,'Exit is already inside referenceCost and must not be subtracted a second time');

f=fixture();f.row.feeRates.h24=.02/24;f.model.referenceCost=.005;
assert.equal(line(f,'net').status,'pass','Exactly 2% daily fees clears the configured minimum');
f.row.feeRates.h24=(.02-1e-9)/24;assert.equal(line(f,'net').status,'fail');
f.row.feeRates.h24=.024/24;f.model.referenceCost=.012;
assert.equal(line(f,'net').status,'fail','Zero net is not a positive fee cushion');
f.model.referenceCost=.013;assert.equal(line(f,'net').status,'fail');
f.row.pool.ageHours=23.999;assert.equal(line(f,'net').status,'caution','A partial daily fee window cannot pass');
f=fixture();f.model.referenceCost=.010000001;assert.equal(line(f,'costs').status,'caution');
f.model.sale.retained=true;assert.equal(line(f,'net').status,'caution');assert.match(line(f,'costs').reason,/Dated fallback/);

for(const [floor,expected]of [[.55,'pass'],[.550001,'fail'],[.5,'pass'],[0,'caution'],[-1,'caution'],[2,'caution'],[NaN,'caution']]){
  f=fixture();f.model.range.bottomPriceSol=floor;assert.equal(line(f,'floor').status,expected,'Floor '+floor);
}
f=fixture();f.model.range.exceedsSetupBins=true;assert.equal(line(f,'floor').status,'fail');
f=fixture();f.model.range.selected.atFloor={pnlSol:-.25,returnFraction:-.5,unavailableReasons:[]};
assert.equal(line(f,'worst').status,'fail','50% loss hits the configured failure boundary');
f.model.range.selected.atFloor={pnlSol:-.249,returnFraction:-.498,unavailableReasons:[]};assert.equal(line(f,'worst').status,'caution');
f.model.range.selected.atFloor.unavailableReasons=['Tax missing'];assert.equal(line(f,'worst').status,'caution');
f.model.saleAssumed=true;assert.equal(line(f,'worst').status,'caution');

for(const [share,complete,expected]of [[.099999,true,'pass'],[.1,true,'fail'],[.1,false,'fail'],[.099999,false,'caution'],[NaN,true,'caution'],[-.1,true,'caution'],[1.1,true,'caution']]){
  f=fixture();Object.assign(f.row.preflightEvidence.holders,{topFraction:share,complete});assert.equal(line(f,'holders').status,expected);
}
f=fixture();f.row.preflightEvidence.holders.asOf=iso(-thresholds.policyMaxAgeMs-1);assert.equal(line(f,'holders').status,'caution');
f.row.preflightEvidence.holders.topFraction=.2;assert.equal(line(f,'holders').status,'caution','An expired sampled large owner is not a current failure claim');

f=fixture();f.row.safety.rpc.transferFeeStatus='known';f.row.safety.rpc.transferFee={bps:100,configAuthority:'active',withdrawAuthority:null};
assert.equal(line(f,'tax').status,'fail');
f.row.safety.rpc.transferFee.bps=0;assert.equal(line(f,'tax').status,'fail','A zero current tax may still be changed');
f.row.safety.rpc.transferFee={bps:100,configAuthority:null,withdrawAuthority:'active'};
assert.equal(line(f,'tax').status,'caution','Withheld-fee withdrawal authority is not the fee-setting authority');
assert.match(line(f,'tax').reason,/withdrawal tax is included in costs/);
f.model.taxAssumed=true;assert.match(line(f,'tax').reason,/complete costs are still unavailable/);
delete f.row.safety.rpc.transferFee.configAuthority;assert.equal(line(f,'tax').status,'caution');
f.row.safety.rpc.transferFee.bps=NaN;assert.equal(line(f,'tax').status,'caution');
f.row.safety.rpc.transferFee={bps:100,configAuthority:'active'};f.row.safety.rpc.status='stale';assert.equal(line(f,'tax').status,'caution');

f=fixture();f.row.preflightEvidence.tokenAge.minimumHours=24;assert.equal(line(f,'age').status,'pass');
assert.match(line(f,'age').value,/At least 24/);
f.row.preflightEvidence.tokenAge.minimumHours=23.999;assert.equal(line(f,'age').status,'caution','A lower bound below 24h does not prove a young token');
f=fixture();f.row.structure.windows[0].low=1/3;assert.equal(score(f).spikeMultiple,3);assert.equal(line(f,'age').status,'pass','Exactly 3× does not meet the >3× spike condition');
f.row.structure.windows[0].low=1/3.00001;assert.equal(line(f,'age').status,'caution');assert.match(line(f,'age').reason,/Launch-spike flag/);
f.row.structure.windows[0].complete=false;assert.equal(line(f,'age').status,'caution');assert.ok(score(f).spikeMultiple>3,'An observed partial low can prove a spike whose full-window size is at least as large');assert.match(line(f,'age').reason,/Launch-spike flag.*partial/);
f.row.preflightEvidence.tokenAge.minimumHours=2;assert.match(line(f,'age').reason,/Launch-spike flag/,'A short age lower bound does not hide an observed spike');
delete f.row.preflightEvidence.tokenAge;assert.match(line(f,'age').reason,/Launch-spike flag/,'Missing age evidence does not hide an observed spike');
f.row.structure.windows[0].low=.5;assert.equal(line(f,'age').status,'caution');assert.doesNotMatch(line(f,'age').reason,/Launch-spike flag/);
f=fixture();f.row.structure.windows[0].complete=false;assert.equal(line(f,'age').status,'caution','A partial low cannot establish absence of a launch spike');
f=fixture();f.row.structure.asOf=iso(-thresholds.structureMaxAgeMs-1);assert.equal(line(f,'age').status,'caution');

f=fixture();f.row.feeRates.h1=.00075;assert.equal(line(f,'trend').status,'pass');
f.row.feeRates.h1=.000749999;assert.equal(line(f,'trend').status,'caution');assert.match(line(f,'trend').reason,/Fading/);
f=fixture();f.row.feeRates.h4=.00075;assert.equal(line(f,'trend').status,'pass');
f.row.feeRates.h4=.000749999;assert.equal(line(f,'trend').status,'caution');
f=fixture();f.row.feeRates.h1=0;assert.equal(line(f,'trend').status,'caution');
f.row.feeRates.h24=null;assert.equal(line(f,'net').status,'caution');assert.equal(line(f,'trend').status,'caution');
f=fixture();f.row.feeRates.h24=NaN;assert.equal(line(f,'net').status,'caution');assert.doesNotMatch(preflightHtml(f.row,f.model,now),/NaN|Unknown|undefined|Infinity/);

for(const field of ['referenceCost','referenceExit','sizeSol'])for(const invalid of [null,undefined,NaN,Infinity,-1]){
  f=fixture();f.model[field]=invalid;assert.equal(line(f,'net').status,'caution',field+' '+invalid);assert.equal(line(f,'costs').status,'caution');
}
f=fixture();f.model.sale.expiresAt=now;assert.equal(line(f,'costs').status,'caution','Expiry is exclusive');
f=fixture();f.model.sale.asOf=iso(1);assert.equal(line(f,'costs').status,'caution','Future evidence is never current');
f=fixture();assert.equal(line(f,'tax',now+thresholds.policyMaxAgeMs).status,'pass');assert.equal(line(f,'tax',now+thresholds.policyMaxAgeMs+1).status,'caution');
assert.ok(score(f,now+thresholds.marketMaxAgeMs+1).lines.every(item=>item.status==='caution'),'Every expired evidence line loses Pass');
assert.ok(scorePreflight({}, {}, now).lines.every(item=>item.status==='caution'),'Blank evidence never passes');
assert.doesNotMatch(preflightHtml({}, {}, now),/NaN|Unknown|undefined|Infinity/);
assert.equal(score(f,now,{...thresholds,minDailyFeeFraction:.03}).lines.find(item=>item.id==='net').status,'fail','Threshold overrides affect scoring');

const html=preflightHtml(f.row,f.model,now);
assert.equal((html.match(/data-preflight=/g)||[]).length,8);assert.match(html,/Pre-flight/);assert.match(html,/Screen thresholds/);
f.row.preflightEvidence.tokenAge.minimumHours=NaN;assert.doesNotMatch(preflightHtml(f.row,f.model,now),/NaN/);
const drawer=await readFile('public/main-pool-drawer.js','utf8');
assert.ok(drawer.indexOf('data-mpd-panel="preflight" aria-label')<drawer.indexOf('data-mpd-panel="worth"></section>'),'Pre-flight precedes the older drawer panels');
assert.match(drawer,/scorePreflight\(row,m,m.now\)/,'Expiry participates in the drawer refresh signature');
console.log('PASS: pre-flight thresholds, daily-cost math, no double-counted exit, age bounds, spike completeness, authorities, holder coverage, stale/missing evidence and eight-row UI');

// Suggestions choose an actual whole-bin floor in the requested band. A narrow
// pool must never get a silently capped range labelled as an overnight fit.
const narrow=suggestOvernightRange({priceSol:1,binStep:50});
assert.equal(narrow.status,'infeasible');assert.equal(narrow.requiredBins,120);assert.equal(narrow.maximumBins,69);assert.ok(narrow.attainableDepthFraction<.30);assert.equal(narrow.floorPriceSol,null);assert.match(narrow.reason,/does not meet the overnight screen/);assert.match(narrow.reason,/manual range/);
const normal=suggestOvernightRange({priceSol:1,binStep:100});assert.equal(normal.status,'ready');assert.equal(normal.binCount,65);assert.equal(normal.alignment,'estimated');assert.match(normal.reason,/alignment is not verified/);assert.equal(normal.lowerNativeBin,null);
const coarse=suggestOvernightRange({priceSol:1,binStep:1500});assert.equal(coarse.status,'infeasible');assert.match(coarse.reason,/no whole-bin floor/);
for(let binStep=1;binStep<=10000;binStep++){
 const suggestion=suggestOvernightRange({priceSol:.0001,binStep});
 if(suggestion.status!=='ready')continue;
 assert.ok(suggestion.binCount>=1&&suggestion.binCount<=69);
 assert.ok(suggestion.actualDepthFraction>=.45-1e-12&&suggestion.actualDepthFraction<=.50+1e-12);
 const range=buildResearchRange({priceSol:.0001,binStep,floorPriceSol:suggestion.floorPriceSol,oneSided:true,shape:'BidAsk',transferFeeBps:0,exitCostFraction:0});
 assert.equal(range.binCount,suggestion.binCount,'inclusive bin count for '+binStep+' bps');
 assert.ok(Math.abs(range.bottomPriceSol-suggestion.floorPriceSol)/suggestion.floorPriceSol<1e-12);
 assert.ok(Math.abs(range.topPriceSol-suggestion.topPriceSol)/suggestion.topPriceSol<1e-12);
 assert.equal(range.exceedsSetupBins,false);
}
for(const solIsBase of [true,false]){
 const aligned=suggestOvernightRange({priceSol:1,binStep:100,solIsBase,activeBinId:100,minNativeBinId:0,maxNativeBinId:200});
 assert.equal(aligned.status,'ready');assert.equal(aligned.alignment,'verified');assert.equal(aligned.upperNativeBin-aligned.lowerNativeBin+1,aligned.binCount);
 assert.equal(aligned.lowerNativeBin,solIsBase?101:35);assert.equal(aligned.upperNativeBin,solIsBase?165:99);
 const limited=suggestOvernightRange({priceSol:1,binStep:100,solIsBase,activeBinId:100,minNativeBinId:solIsBase?0:50,maxNativeBinId:solIsBase?150:200});
 assert.equal(limited.status,'infeasible');assert.equal(limited.maximumBins,50);assert.match(limited.reason,/native bin limit/);
}
for(const priceSol of [1e-18,1e-8,1,1e8,1e18]){const s=suggestOvernightRange({priceSol,binStep:100});assert.equal(s.status,'ready');near(s.actualDepthFraction,normal.actualDepthFraction);}
for(const priceSol of [0,-1,null,NaN,Infinity,Number.MIN_VALUE])assert.equal(suggestOvernightRange({priceSol,binStep:100}).status,'unavailable');
for(const binStep of [0,-1,null,NaN,Infinity,1.5,10001])assert.equal(suggestOvernightRange({priceSol:1,binStep}).status,'unavailable');
assert.equal(suggestOvernightRange({priceSol:1,binStep:100,solIsBase:'false'}).status,'unavailable');
assert.equal(suggestOvernightRange({priceSol:1,binStep:100,activeBinId:0}).status,'unavailable','partial native fields do not claim verified alignment');
assert.equal(suggestOvernightRange({priceSol:1,binStep:100},{maxSuggestedBins:70}).status,'unavailable');
f=fixture();f.model.overnightSuggested=normal;const suggestionHtml=preflightHtml(f.row,f.model,now);assert.equal((suggestionHtml.match(/>Use suggested range<\/button>/g)||[]).length,1);assert.doesNotMatch(suggestionHtml.match(/<button[^>]*data-mpd-suggested[^>]*>/)[0],/disabled/);assert.ok(suggestionHtml.indexOf('wf-preflight-verdict')<suggestionHtml.indexOf('data-mpd-suggested'));
f.model.overnightSuggested=narrow;assert.match(preflightHtml(f.row,f.model,now),/data-mpd-suggested[^>]*disabled/);assert.match(preflightHtml(f.row,f.model,now),/120 bins/);
assert.match(preflightHtml({}, {},now),/data-mpd-suggested[^>]*disabled/);
console.log('PASS suggested range: exact 45–50% whole-bin band, at most69 bins, small/coarse-step infeasibility, native limits/orientation, scale invariance and one explicit CTA');
