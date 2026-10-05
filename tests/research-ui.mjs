import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile('public/lp-research.js','utf8'),html=await readFile('public/research.html','utf8');
let clockNow=Date.now();const clockStart=clockNow;class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clockNow]));}static now(){return clockNow;}}
const pure={URL,URLSearchParams,Intl,Date:ClockDate};vm.runInNewContext(source,pure);const ui=pure.LPResearch;
const at=new Date(clockStart).toISOString(),seconds=Math.floor(clockStart/1000);const quoteDates={buyAsOf:at,sellAsOf:at,expiresAt:clockStart+45000};
const row={pool:{id:'solana:test',address:'test',pair:'TEST/SOL',tvlUsd:100000,ageHours:12,fetchedAt:at,url:'https://app.meteora.ag/dlmm/test'},feeRates:{h1:.001,h4:.002,h12:null,asOf:at},trend:{volume1h:50000,volume4h:100000,volume24h:500000,previous4h:null,tvlChange4h:null,asOf:at},config:{binStep:20,baseFee:.003,dynamicFee:null},quotes:[{...quoteDates,sizeSol:1,mode:'best',status:'quoted',roundTripCostSol:.006,exitCostSol:.002,asOf:at,note:'Swap-only quote; LP costs excluded.'},{sizeSol:.5,mode:'dlmm',status:'unavailable',roundTripCostSol:null,exitCostSol:null,asOf:at,note:'No DLMM route'}],net:{sizeSol:1,quoteMode:'best',horizonHours:4,hourlyFeeRate:.002,costFraction:.006,grossFeeFraction:.008,netFraction:.002,feesCoverCostHours:3,feesCoverExitHours:1,status:'estimated',note:'Pool fee proxy; LP tax and rent excluded.'},safety:{status:'partial',flags:[{label:'Known 1% transfer fee',severity:'info'}],rpc:{status:'available',asOf:at,decimals:6,mintAuthority:null,freezeAuthority:null,extensions:[],transferFeeStatus:'known',transferFee:{bps:100,maximumRaw:'500',maximumTokens:.5,configAuthority:null,withdrawAuthority:null},concentration:{top1Fraction:.2,top10Fraction:.6,top20Fraction:.8,label:'Token accounts include vaults; not distinct holders.'},flags:[]},rugcheck:{status:'unknown',asOf:null},dexscreener:{status:'unknown',asOf:null}},priceSol:.001,tokenMint:'mint',structure:{asOf:at,hourlyHighTrend:'mixed',supportLevels:[.0009],windows:[{hours:4,high:.0012,low:.0009,complete:false,observations:2}],candles:[{t:seconds-3600,o:.001,h:.0012,l:.0009,c:.0011},{t:seconds,o:.0011,h:.0012,l:.001,c:.001}]} };

assert.equal(ui.pct(.001),'0.1%','fee fractions are displayed as percent, without applying the window again');
assert.equal(ui.pct(null),'Unavailable');assert.equal(ui.pct(0),'0%','a measured zero stays distinct from unavailable data');
const stale={...row,pool:{...row.pool,fetchedAt:new Date(Date.now()-11*60000).toISOString()}};assert.equal(ui.sourceState(stale).kind,'saved');assert.match(ui.renderTable([stale]),/Saved source/);assert.match(ui.renderCards([stale]),/Saved source/);assert.match(ui.renderTable([stale]),/Saved fee rates/);assert.equal(ui.sourceCounts([row,stale]).fresh,1);assert.equal(ui.sourceCounts([row,stale]).saved,1);
assert.equal(ui.estimate(row).net,.002,'uses backend net instead of recomputing incomplete quote costs');
assert.equal(ui.estimate({...row,net:{...row.net,netFraction:null}}).net,null,'authoritative unknown must not become a quote-only estimate');
assert.equal(ui.estimate({...row,net:undefined}).net,null,'missing backend cost estimate stays unknown even with a swap quote');
assert.equal(ui.estimate(row,.5,'dlmm').net,null,'a quote for a different size/route is never substituted');
const multi={...row,quotes:[row.quotes[0],{...row.quotes[0],sizeSol:.5,mode:'dlmm'}],nets:[{status:'estimated',sizeSol:.5,mode:'dlmm',horizonHours:4,netFraction:-.004,grossFraction:.008,roundTripRecoveryHours:6,exitRecoveryHours:2}]};assert.equal(ui.estimate(multi,.5,'dlmm').net,-.004,'detail uses the selected authoritative size/route model');assert.equal(ui.estimate(multi,.5,'dlmm').roundTripHours,6);assert.equal(ui.estimate(multi,.5,'dlmm').exitHours,2);
assert.equal(ui.estimate({...row,net:{...row.net,netFraction:0}}).net,0);
// Dated quote legs expire even when the browser retains a previously estimated model.
assert.equal(ui.quoteState(row.quotes[0]).usable,true);
assert.equal(ui.quoteState({...row.quotes[0],buyAsOf:null}).usable,false,'legacy missing leg provenance cannot look current');
assert.equal(ui.quoteState({...row.quotes[0],buyAsOf:new Date(clockStart-45001).toISOString()}).usable,false,'the oldest leg controls quote freshness');
assert.equal(ui.quoteState({...row.quotes[0],sellAsOf:new Date(clockStart+60001).toISOString()}).usable,false,'future evidence is unknown');
const freshQuoteStaleMint={...row,safety:{...row.safety,rpc:{...row.safety.rpc,asOf:new Date(clockStart-300001).toISOString()}}};
assert.equal(ui.estimate(freshQuoteStaleMint).net,null,'stale mint costs invalidate complete net');
assert.equal(ui.quoteState(freshQuoteStaleMint.quotes[0]).usable,true,'a raw round-trip quote does not depend on mint tax assumptions');
assert.equal(ui.estimate({...row,feeRates:{...row.feeRates,asOf:new Date(clockStart-600001).toISOString()}}).net,null);
assert.equal(ui.estimate(stale).net,null,'saved pool prices cannot produce a current cost comparison');
clockNow=clockStart+45001;
assert.equal(ui.estimate(row).net,null);assert.equal(ui.estimate(row).roundTripHours,null);assert.equal(ui.estimate(row).exitHours,null);
assert.match(ui.renderTable([row]),/Expired · saved quote/);assert.match(ui.renderCards([row]),/Expired · saved quote/);
assert.match(ui.renderCostPanels(row),/Current comparison unavailable: Expired · saved quote/);
assert.equal(row.quotes[0].status,'quoted','presentation expiry preserves original evidence and dates');
assert.equal(row.quotes[0].asOf,at);
clockNow=clockStart;
// The new economic contract keeps original, bounded research estimates after
// executable legs expire. It cannot revive legacy or undated model objects.
const economicRow=structuredClone(row);
economicRow.quotes[0].economicEstimate={costModelVersion:3,retainedUntil:clockStart+3600000,status:'available',roundTripCostSol:.006,exitCostSol:.002,asOf:at,dataAsOf:at,expiresAt:clockStart+600000,cached:false,markAsOf:at,markPriceSol:.001,tokenDecimals:6,note:'Dated economic estimate; not an executable quote.'};
assert.equal(ui.quoteState({...economicRow.quotes[0],economicEstimate:{...economicRow.quotes[0].economicEstimate,costModelVersion:2}}).usable,false,'superseded model cannot reappear through a still-current raw quote');
Object.assign(economicRow.net,{quoteFreshness:'current',estimateCached:false,dataAsOf:at,economicPolicyAsOf:at,expiresAt:clockStart+600000});
clockNow=clockStart+45001;
assert.equal(ui.quoteState(economicRow.quotes[0]).usable,false);
assert.equal(ui.economicState(economicRow.quotes[0]).usable,true);
assert.equal(ui.estimate(economicRow).net,.002,'uses the authoritative dated ten-minute model, without recomputing quote-only net');
assert.equal(ui.estimate(economicRow).evidence.cached,true);
assert.match(ui.renderTable([economicRow]),/Cached estimate/);assert.match(ui.renderCards([economicRow]),/Cached estimate/);
assert.match(ui.renderCostPanels(economicRow),/Dated economic cost estimate · refresh 10m, last good up to 60m/);
assert.match(ui.renderCostPanels(economicRow),/0\.006 SOL/);assert.match(ui.renderCostPanels(economicRow),/10-minute window/);
assert.equal(ui.estimate({...economicRow,net:{...row.net}}).net,null,'new quote metadata alone cannot loosen a legacy model’s45-second gate');
assert.equal(ui.estimate({...economicRow,net:{...economicRow.net,status:'unknown'}}).net,null,'authoritative unknown remains unknown');
assert.equal(ui.estimate({...economicRow,net:{...economicRow.net,expiresAt:clockStart+10000}}).net,null,'model expiry can be earlier than quote expiry');
for(const patch of [{asOf:new Date(clockStart+1).toISOString()},{expiresAt:clockStart+600001},{retainedUntil:clockStart+3600001}])assert.equal(ui.economicState({...economicRow.quotes[0],economicEstimate:{...economicRow.quotes[0].economicEstimate,...patch}}).usable,false,'invalid or renewed economic dates stay unknown');
assert.equal(ui.economicState({...economicRow.quotes[0],buyAsOf:null}).usable,false);
clockNow=clockStart+6*60000;
const cachedPolicy={...economicRow,safety:{...economicRow.safety,rpc:{...economicRow.safety.rpc,status:'stale'}}};
assert.equal(ui.estimate(cachedPolicy).net,.002,'dated tax policy may support an explicitly cached scenario after RPC safety expires');
assert.equal(ui.estimate({...cachedPolicy,safety:{...cachedPolicy.safety,rpc:{...cachedPolicy.safety.rpc,transferFeeStatus:'unknown'}}}).net,null);
assert.equal(ui.estimate({...cachedPolicy,net:{...cachedPolicy.net,economicPolicyAsOf:new Date(clockStart+1).toISOString()}}).net,null,'a model must match its dated tax-policy evidence');
clockNow=clockStart+600000;
assert.equal(ui.economicState(economicRow.quotes[0]).usable,true);assert.equal(ui.estimate(economicRow).net,null,'old fee/pool source still prevents a fresh net model');
assert.match(ui.renderCostPanels(economicRow),/Last good cost · up to 60 minutes/);
clockNow=clockStart+3600001;assert.equal(ui.economicState(economicRow.quotes[0]).usable,false);assert.match(ui.renderCostPanels(economicRow),/Expired · saved economic estimate/);
assert.equal(economicRow.quotes[0].economicEstimate.asOf,at);assert.equal(economicRow.quotes[0].economicEstimate.markAsOf,at);
clockNow=clockStart;
assert.match(ui.direction(row).text,/unavailable/,'a large 1h volume cannot substitute for the preceding four-hour window');
assert.match(ui.direction({...row,trend:{...row.trend,previous4h:50000}}).text,/100%/);
assert.match(ui.direction({...row,trend:{...row.trend,previous4h:0}}).text,/resumed/);
const table=ui.renderTable([row]);assert.match(table,/0\.1%/);assert.match(table,/0\.2%/);assert.match(table,/neutral-flag/,'a known transfer fee is shown as neutral cost information');assert.match(table,/4h direction unavailable/);
assert.match(table,/Fresh pool &lt;24h/);
const established={...row,pool:{...row.pool,id:'established',pair:'ESTABLISHED/SOL',ageHours:48}},young={...row,pool:{...row.pool,id:'young',pair:'YOUNG/SOL',ageHours:4}};
const grouped=ui.renderTable([young,row,established]);assert.ok(grouped.indexOf('ESTABLISHED/SOL')<grouped.indexOf('YOUNG/SOL'));assert.ok(grouped.indexOf('YOUNG/SOL')<grouped.indexOf('TEST/SOL'),'rank order is preserved within the fresh group');
const detail=ui.renderDetail(row);assert.match(detail,/Partial · 2 candles/);assert.match(detail,/None recorded/);assert.match(detail,/20%/);assert.match(detail,/Token accounts include vaults; not distinct holders/);assert.match(detail,/Largest sampled owner/);assert.match(detail,/Unavailable/);assert.doesNotMatch(detail.replace(/<[^>]*>/g,' '),/\b(?:Unknown|NaN)\b/,'incomplete research detail uses explicit unavailable labels');assert.match(detail,/Data as of/);assert.match(detail,/role="img"/);assert.match(detail,/SOL per token/);assert.doesNotMatch(detail,/NaN|Infinity/);
const hostile={...row,pool:{...row.pool,pair:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)'},safety:{...row.safety,flags:[{label:'<script>alert(1)</script>',severity:'attention'}]}};
const safe=ui.renderDetail(hostile)+ui.renderTable([hostile])+ui.renderCards([hostile]);assert.doesNotMatch(safe,/<img|<script|href="javascript:/);assert.match(safe,/&lt;img/);assert.match(safe,/&lt;script/);
const params=ui.buildParams({size:'.5',mode:'wrong',sort:'wrong',ageGroup:'wrong',hideFlagged:true});assert.equal(params.get('size'),'1');assert.equal(params.get('mode'),'best');assert.equal(params.get('sort'),'net');assert.equal(params.get('ageGroup'),'all');assert.equal(params.get('horizon'),'4');assert.equal(params.get('hideFlagged'),'1');
for(const mount of ['researchRangeBuilder','researchBots','researchManualCheck'])assert.ok(html.includes('id="'+mount+'"'));
assert.match(html,/<dialog[^>]+aria-labelledby="researchDetailTitle"/);assert.doesNotMatch(html,/phantom\.js|solana\.js|paper-fleet\.js/);

// Browser-level controller exercise: read-only requests, retained results, detail event,
// modal dismissal and focus restore. No live services or transaction endpoints; the clock timer makes no provider calls.
const nodes=new Map(),documentEvents=[],timers=[];let activeElement=null,fail=false,detailFailure=false,responseRow=row;const requests=[];
class Node{
 constructor(id){this.id=id;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this.innerHTML='';this.textContent='';this.dataset={};this.attributes={};this.listeners={};this.scrollTop=0;this.focusCount=0;}
 addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);}
 setAttribute(key,value){this.attributes[key]=value;}
 replaceChildren(){this.innerHTML='';}
 showModal(){this.open=true;}
 close(){this.open=false;for(const fn of this.listeners.close||[])fn({});}
 focus(){activeElement=this;this.focusCount++;}
}
for(const id of [...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,new Node(id));
nodes.set('researchCostPanels',new Node('researchCostPanels'));
Object.assign(nodes.get('researchMinTvl'),{value:'15000'});Object.assign(nodes.get('researchMinVolume'),{value:'10000'});Object.assign(nodes.get('researchAgeGroup'),{value:'all'});Object.assign(nodes.get('researchSort'),{value:'net'});Object.assign(nodes.get('researchSize'),{value:'1'});Object.assign(nodes.get('researchMode'),{value:'best'});
const browser={URL,URLSearchParams,Intl,Date:ClockDate,AbortSignal,setTimeout,clearTimeout,setInterval:(callback,ms)=>{timers.push({callback,ms});return timers.length;},clearInterval(){},location:{href:'https://terminal.test/research.html',search:''},history:{replaceState(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document:{getElementById:id=>nodes.get(id),get activeElement(){return activeElement;},addEventListener(){},dispatchEvent:event=>documentEvents.push(event)},fetch:async(url,options)=>{requests.push({url,method:options.method});if(fail)throw Error('Offline');if(url.startsWith('/api/research/pool?'))return {ok:!detailFailure,json:async()=>detailFailure?{error:'This pool is outside supported research coverage.'}:structuredClone(responseRow)};return {ok:true,json:async()=>({rows:[structuredClone(responseRow)],asOf:at,coverage:{jupiterConfigured:false,note:'Bounded cached catalogue.'}})};}};browser.window=browser;vm.runInNewContext(source,browser);
await browser.LPResearch.load();assert.match(nodes.get('researchRows').innerHTML,/TEST\/SOL/);assert.match(nodes.get('researchCoverage').innerHTML,/Jupiter quotes unavailable until API key is configured/);assert.equal(requests.every(r=>r.method==='GET'),true);
const trigger=new Node('trigger');await browser.LPResearch.openPool(row.pool.id,trigger);assert.equal(nodes.get('researchDrawer').open,true);assert.equal(browser.LPResearch.current().pool.id,row.pool.id);assert.equal(documentEvents.at(-1).type,'lp:research-pool');assert.equal(documentEvents.at(-1).detail.pool.id,row.pool.id);browser.LPResearch.close();assert.equal(nodes.get('researchDrawer').open,false);assert.ok(trigger.focusCount>0);
const saved=nodes.get('researchRows').innerHTML;fail=true;await browser.LPResearch.load();assert.equal(nodes.get('researchRows').innerHTML,saved,'failed reads keep the saved catalogue');assert.match(nodes.get('researchStatus').textContent,/Refresh failed · showing saved catalogue/);assert.equal(nodes.get('researchStatus').dataset.tone,'warn');assert.equal(nodes.get('researchResults').attributes['aria-busy'],'false');
fail=false;detailFailure=true;await browser.LPResearch.openPool('solana:unsupported',trigger);assert.match(nodes.get('researchDetail').innerHTML,/outside supported research coverage/);assert.match(nodes.get('researchDetail').innerHTML,/Retry bounded checks/);assert.equal(browser.LPResearch.current(),null,'failed detail cannot retain another pool’s calculations');
// One display-only timer ages current costs without reloading the drawer or
// dispatching a pool event, so extension inputs, focus and scroll survive.
detailFailure=false;await browser.LPResearch.openPool(row.pool.id,trigger);
assert.equal(timers.length,1);assert.equal(timers[0].ms,1000);
const mounts=['researchRangeBuilder','researchBots','researchManualCheck'];
for(const id of mounts){nodes.get(id).innerHTML='<input value="unsaved scenario">';nodes.get(id).value='unsaved scenario';}
nodes.get('researchManualCheck').focus();nodes.get('researchDrawer').scrollTop=321;
const detailBefore=nodes.get('researchDetail').innerHTML,eventsBefore=documentEvents.length,requestsBefore=requests.length,focusBefore=activeElement;
nodes.get('researchCostPanels').innerHTML=browser.LPResearch.renderCostPanels(row);
clockNow=clockStart+45001;timers[0].callback();
assert.match(nodes.get('researchCostPanels').innerHTML,/Expired · saved quote/);
assert.match(nodes.get('researchRows').innerHTML,/Expired · saved quote/);
assert.equal(nodes.get('researchDetail').innerHTML,detailBefore,'only the dedicated cost panels are replaced');
for(const id of mounts){assert.equal(nodes.get(id).innerHTML,'<input value="unsaved scenario">');assert.equal(nodes.get(id).value,'unsaved scenario');}
assert.equal(activeElement,focusBefore);assert.equal(nodes.get('researchDrawer').scrollTop,321);
assert.equal(documentEvents.length,eventsBefore);assert.equal(requests.length,requestsBefore,'clock expiry never fetches providers');
fail=true;await browser.LPResearch.load();assert.match(nodes.get('researchRows').innerHTML,/Expired · saved quote/,'failed refresh cannot revive expired costs');
clockNow=clockStart;
fail=false;responseRow=economicRow;await browser.LPResearch.openPool(row.pool.id,trigger);
for(const id of mounts){nodes.get(id).innerHTML='<input value="economic scenario">';nodes.get(id).value='economic scenario';}
nodes.get('researchManualCheck').focus();nodes.get('researchDrawer').scrollTop=654;
const economicDetail=nodes.get('researchDetail').innerHTML,economicEvents=documentEvents.length,economicRequests=requests.length,economicFocus=activeElement;
clockNow=clockStart+45001;timers[0].callback();assert.match(nodes.get('researchCostPanels').innerHTML,/Dated economic cost estimate · refresh 10m, last good up to 60m/);assert.match(nodes.get('researchRows').innerHTML,/Cached estimate/);assert.equal(browser.LPResearch.estimate(browser.LPResearch.current()).net,.002);
clockNow=clockStart+600000;timers[0].callback();assert.match(nodes.get('researchCostPanels').innerHTML,/Last good cost · up to 60 minutes/);assert.equal(browser.LPResearch.estimate(browser.LPResearch.current()).net,null);
assert.equal(nodes.get('researchDetail').innerHTML,economicDetail);assert.equal(nodes.get('researchDrawer').scrollTop,654);assert.equal(activeElement,economicFocus);assert.equal(documentEvents.length,economicEvents);assert.equal(requests.length,economicRequests);
for(const id of mounts)assert.equal(nodes.get(id).value,'economic scenario');
console.log('PASS research UI: authoritative dated ten-minute economic estimates, legacy45-second executable gates, source/tax freshness, timer expiry preserving inputs/focus/scroll, size/route separation and read-only requests');
