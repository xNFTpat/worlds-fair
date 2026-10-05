import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const dir=await mkdtemp(join(tmpdir(),'lp-fleet-observation-'));
for(const [name,file] of [['signals','src/fleet-signals.ts'],['activity','src/fleet-observability.ts'],['fleet','src/paper-fleet.ts'],['storage','src/paper-fleet-storage.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const imp=name=>import(pathToFileURL(join(dir,name+'.mjs')));
const {observeMarkets,marketSignal}=await imp('signals');
const {recordFleetDecision,fleetDiscoveryHealth,fleetArmActivity,FLEET_MARKET_LIMIT}=await imp('activity');
const {initialFleetState,advanceFleet,fleetSummary}=await imp('fleet');
const {fleetRecords,loadFleet,MARKET_SHARD_SIZE}=await imp('storage');
const t=Date.parse('2026-09-30T00:00:00Z'),ms=m=>t+m*60000,at=m=>new Date(ms(m)).toISOString();
const SOL='So11111111111111111111111111111111111111112';
const pool=(m,id='solana:target',extra={})=>({id,address:id.split(':')[1],pair:'TARGET/SOL',chain:'solana',venue:'meteora-dlmm',base:{address:'mint-'+id,symbol:'TARGET'},quote:{address:SOL,symbol:'SOL'},priceQuote:1,tvlUsd:15000,ageHours:2,fetchedAt:at(m),activity:{fees1h:1000,volume30m:40000,volume1h:60000},...extra});
const snap=(m,pools)=>({updatedAt:at(m),pools,errors:{}});

// A pool that screening is allowed to consider must receive observations even
// below the old top600 liquidity cut. This is an actual failing old scenario.
const universe=[...Array.from({length:600},(_,i)=>pool(0,'solana:large-'+i,{tvlUsd:200000+i})),pool(0)];
let history=observeMarkets({},snap(0,universe),ms(0));
assert.equal(Object.keys(history).length,601);assert.equal(history['solana:target'].length,1);
const absent=observeMarkets(history,snap(5,[]),ms(5));assert.deepEqual(absent,history,'one missing catalogue does not erase measured observations');
const resumed=observeMarkets(absent,snap(10,[pool(10)]),ms(10));assert.equal(resumed['solana:target'].length,2,'resumption within ten minutes preserves continuity without inventing the missing sample');
assert.equal(observeMarkets(resumed,snap(25,[pool(25)]),ms(25))['solana:target'].length,1,'retention does not relax the ten-minute continuity guard');
const stale=observeMarkets(history,snap(20,[pool(0)]),ms(20));assert.equal(stale['solana:target'].length,1);assert.equal(marketSignal('scalp',pool(0),stale['solana:target'],ms(20)).ready,false,'retained points cannot qualify stale sources');
assert.equal(Object.keys(observeMarkets(history,snap(121,[]),ms(121))).length,0,'absent histories expire after the declared two-hour TTL');
const overflow=Array.from({length:FLEET_MARKET_LIMIT+1},(_,i)=>pool(5,'solana:new-'+String(i).padStart(4,'0')));
const protectedHistory={'solana:held':[[ms(0),1,50000,1000,40000]]};
const bounded=observeMarkets(protectedHistory,snap(5,overflow),ms(5),new Set(['solana:held']));
assert.equal(Object.keys(bounded).length,FLEET_MARKET_LIMIT);assert.ok(bounded['solana:held'],'currently open pools have priority over a full fresh universe');
const coverage=fleetDiscoveryHealth(snap(5,overflow),bounded,ms(5));assert.equal(coverage.capacityDropped,2);assert.equal(coverage.retainedAbsent,1);assert.equal(coverage.freshPools,FLEET_MARKET_LIMIT+1);assert.equal(coverage.memoryLimit,FLEET_MARKET_LIMIT);
const savedSource=fleetDiscoveryHealth(snap(20,[pool(0)]),stale,ms(20));assert.equal(savedSource.freshPools,0);assert.equal(savedSource.stalePools,1);assert.equal(savedSource.latestSourceAt,at(0),'fresh snapshot wrapper does not freshen cached pool source');

// Per-arm metadata outlives a noisy arm's global event window. It is bounded,
// monotone and does not edit cash, holds, historical outcomes or original events.
const quiet=initialFleetState(),quietLedger=structuredClone(quiet.portfolios);
recordFleetDecision(quiet,{at:at(0),arm:'farmer',pair:'OLD/SOL',message:'Earlier outcome remains unresolved'},'entry');
for(let i=1;i<=120;i++){const e={at:at(i),arm:'scalp',message:'Noisy Heart event '+i};recordFleetDecision(quiet,e,'position');quiet.events.push(e);}
quiet.events=quiet.events.slice(-100);
recordFleetDecision(quiet,{at:at(-1),arm:'farmer',message:'Out-of-order event'},'entry');
assert.equal(quiet.lastDecisionByArm.farmer.message,'Earlier outcome remains unresolved');assert.equal(quiet.lastEntryDecisionByArm.farmer.kind,'entry');assert.deepEqual(quiet.portfolios,quietLedger);
assert.equal(quiet.events.some(e=>e.arm==='farmer'),false);assert.equal(fleetSummary(quiet,ms(120)).arms.find(a=>a.id==='farmer').activity.latestDecision.message,'Earlier outcome remains unresolved');
quiet.portfolios.farmer.riskDataHold=true;quiet.portfolios.farmer.unscorableCount=7;quiet.portfolios.farmer.unresolvedSol=10.795894737;quiet.lastFullScanAt=at(120);
const held=fleetArmActivity(quiet,'farmer','Risk check paused entries while position values are incomplete',ms(120));assert.equal(held.state,'historical-hold');assert.match(held.detail,/Zero open positions/);assert.match(held.detail,/10\.7959 SOL/);assert.match(held.detail,/cannot reconstruct retired outcomes/);
const base=initialFleetState();base.lastFullScanAt=at(5);base.funnel={scalp:{screened:3,ready:0,warming:3,rejected:0,checked:0,entered:0,providerBlocked:0,modelRejected:0}};
assert.equal(fleetArmActivity(base,'scalp',null,ms(5)).state,'warming');base.funnel.scalp.warming=0;base.funnel.scalp.rejected=3;assert.equal(fleetArmActivity(base,'scalp',null,ms(5)).state,'no-setup');base.discoveryHealth=savedSource;base.lastFullScanAt=at(20);assert.equal(fleetArmActivity(base,'scalp',null,ms(20)).state,'source-stale');

// Through the real selection and ledger hooks: a rejected accounting check is
// an attempted quote, not an accepted quote or an invented entry/refund.
let real=advanceFleet(initialFleetState(),snap(0,[pool(0)]),[],ms(0));
const beforeCash=Object.fromEntries(Object.entries(real.portfolios).map(([id,a])=>[id,a.cashSol]));
real=advanceFleet(real,snap(5,[pool(5,'solana:target',{priceQuote:1.01})]),[{poolId:'solana:target',arm:'scalp',error:'Paper deposit would exceed 1% of a target bin'}],ms(5));
assert.equal(real.funnel.scalp.checked,1);assert.equal(real.funnel.scalp.modelRejected,1);assert.equal(real.positions.length,0);assert.equal(real.lastEntryCheckAt.scalp,at(5));assert.equal(real.lastSuccessfulEntryCheckAt?.scalp,undefined);
assert.equal(real.lastEntryDecisionByArm.scalp.kind,'entry');assert.equal(real.lastEntryDecisionByArm.scalp.message,'Paper deposit would exceed 1% of a target bin');
for(const [id,cash] of Object.entries(beforeCash))assert.equal(real.portfolios[id].cashSol,cash);
const summarized=fleetSummary(real,ms(5)),scalp=summarized.arms.find(a=>a.id==='scalp');assert.equal(scalp.activity.state,'model-rejected');assert.equal(scalp.activity.lastSuccessfulQuoteAt,null);assert.equal(scalp.activity.lastQuoteCheckAt,at(5));assert.equal(scalp.activity.source.latestSourceAt,at(5));
const journal=fleetRecords(real),reloaded=await loadFleet({get:async key=>structuredClone(journal[key])});assert.deepEqual(reloaded.lastEntryDecisionByArm,real.lastEntryDecisionByArm);assert.deepEqual(reloaded.discoveryHealth,real.discoveryHealth);

// Expanded memory still fits each DO value and the normal worst-case atomic
// write budget (16 held +12 entry reads, separate reads/journals/models).
const stress=initialFleetState(),long=.0000012345678901234567;
stress.markets=Object.fromEntries(Array.from({length:FLEET_MARKET_LIMIT},(_,i)=>['solana:'+String(i).padEnd(44,'X'),Array.from({length:25},(_,j)=>[ms(j*5),long,long,-long,-long])]));
const shards=fleetRecords(stress);assert.equal(stress.markets['solana:0'+'X'.repeat(43)].length,25);assert.equal(shards.fleet.marketShards,Math.ceil(FLEET_MARKET_LIMIT/MARKET_SHARD_SIZE));
for(const [key,value] of Object.entries(shards))assert.ok(Buffer.byteLength(JSON.stringify(value))<128*1024,key+' exceeds the128KiB value limit');
assert.ok(shards.fleet.marketShards+16+12+16+29+2<=128,'history shards leave room for bounded models/journals and split reads');

// Exercise the actual UI controller. Failed reads rerender saved values with a
// warning while preserving the current accounting explanation and decisions.
const nodes=new Map(),listeners={},requests=[];let fail=false,clock=ms(5);
class Node{constructor(){this.innerHTML='';this.textContent='';this.dataset={};this.value='';this.disabled=false;this.hidden=false;}insertAdjacentHTML(_where,html){this.innerHTML+=html;}focus(){}scrollIntoView(){}}
const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
const uiState=structuredClone(summarized),farmer=uiState.arms.find(a=>a.id==='farmer');farmer.riskDataHold=true;farmer.equitySol=null;farmer.unresolvedSol=10.795894737;farmer.unscorableCount=7;farmer.entryAllowed=false;farmer.entryReason='Risk check paused entries while position values are incomplete';farmer.activity=held;
class Clock extends Date{static now(){return clock;}}
const browser={Date:Clock,AbortSignal,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setInterval(){},matchMedia:()=>({matches:false}),localStorage:{getItem:()=>null,setItem(){}},document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),dispatchEvent(){}},fetch:async(url,options={})=>{requests.push({url,method:options.method||'GET'});if(url==='/api/paper-fleet'){if(fail)throw Error('Offline fixture');return {ok:true,json:async()=>structuredClone(uiState)};}if(url==='/api/scanner/health')return {ok:true,json:async()=>({status:'running',enabled:true,lastSuccessAt:at(5),failures:0})};return {ok:false,json:async()=>({})};}};browser.window=browser;
for(const file of ['public/scanner-status.js','public/fleet-activity.js','public/paper-fleet.js'])vm.runInNewContext(await readFile(file,'utf8'),browser);
await new Promise(setImmediate);assert.match(node('#fleetWallets').innerHTML,/Accounting hold · earlier outcomes/);assert.match(node('#fleetDetail').innerHTML,/Zero open positions/);
assert.match(node('#fleetReview').innerHTML,/How to read these paper strategies/);
assert.match(node('#fleetResearch').innerHTML,/Results describe this shared paper demo/);
assert.ok(requests.every(r=>!/^\/(?:paper-research|bot-review)[^/]*\.json/.test(r.url)),'public strategies never request private historical reports');
for(const fn of listeners.click||[])fn({target:{closest:selector=>selector==='[data-fleet-arm]'?{dataset:{fleetArm:'scalp'}}:null}});
assert.match(node('#fleetDetail').innerHTML,/Entry model \/ cost rejected/);assert.match(node('#fleetDetail').innerHTML,/Paper deposit would exceed 1% of a target bin/);assert.match(node('#fleetDetail').innerHTML,/Last attempted entry check/);assert.match(node('#fleetDetail').innerHTML,/Last accepted entry quote: None preserved/);assert.match(node('#fleetDetail').innerHTML,/Source coverage checked/);
const cashText=scalp.cashSol.toFixed(4)+' SOL';clock=ms(20);fail=true;await browser.loadPaperFleet();
assert.match(node('#fleetStatus').textContent,/Refresh failed · showing saved wallet state/);assert.equal(node('#fleetStatus').dataset.health,'warn');assert.match(node('#fleetWallets').innerHTML,/Saved \/ read failed/);assert.ok(node('#fleetWallets').innerHTML.includes(cashText),'saved cash is retained when reads fail');assert.match(node('#fleetDetail').innerHTML,/Paper deposit would exceed 1% of a target bin/);assert.equal(requests.every(r=>r.method==='GET'),true,'controller verification never touches paper controls');
assert.match(node('#fleetResearch').innerHTML,/Methodology &amp; limits/,'public methodology remains readable when API data is offline');
assert.equal(browser.lpFleetActivity({runState:'running',lastFullScanAt:at(5),positions:[],readError:'Offline'},farmer,{status:'running'},ms(5)).text,'Saved / read failed · Accounting hold · earlier outcomes');
console.log('PASS fleet observability: lower-liquidity source universe, bounded omission retention/continuity/TTL, open-pool priority and capacity coverage, source dates, durable per-arm decisions, historical holds, honest attempted/accepted quotes, unchanged cash and saved UI read errors');
