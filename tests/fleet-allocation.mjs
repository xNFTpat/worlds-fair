import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'pat-sizing-'));
const fixture={name:'sizing-isolates-selection',setup(b){b.onLoad({filter:/fleet-roles\.ts$/},()=>({contents:`export const ROLE_VERSION='role-signals-v2';export const metaLeaders=()=>new Set();export const roleSignal=(a,p,r,n,s)=>s;export const roleExit=()=>({state:{},reason:null});`,loader:'ts'}));b.onLoad({filter:/fleet-signals\.ts$/},()=>({contents:`export const observeMarkets=x=>x;export const marketSignal=()=>({version:'fixture',ready:true,score:90,volumeRatio:3,drawdown:.3,reason:'Setup fixture'});export const signalExit=()=>({state:{},reason:null});`,loader:'ts'}));b.onLoad({filter:/paper-fleet-reader\.ts$/},()=>({contents:`export const readFleetPool=(...a)=>globalThis.__readFleetPool(...a);`,loader:'ts'}));}};
for(const [n,p] of [['fleet','src/paper-fleet.ts'],['sizing','src/fleet-allocation.ts'],['runner','src/paper-fleet-runner.ts'],['storage','src/paper-fleet-storage.ts']])await build({entryPoints:[p],bundle:true,platform:'node',format:'esm',outfile:join(dir,n+'.mjs'),plugins:[fixture]});
const load=n=>import(pathToFileURL(join(dir,n+'.mjs')));
const {initialFleetState,advanceFleet,fleetPlan,fleetPolicy,fleetEquity,fleetEntryReason,fleetSummary,FLEET_RULES}=await load('fleet');
const {allocationRequest,validAllocation}=await load('sizing');const {runPaperFleet}=await load('runner');const {fleetRecords,loadFleet}=await load('storage');
const now=Date.parse('2026-09-14T22:00:00Z'),at=new Date(now).toISOString();Date.now=()=>now;
const SOL='So11111111111111111111111111111111111111112',arms=['farmer','scalp','wide','steady'];
const signal={ready:true,score:90,volumeRatio:3,drawdown:.3};
const pool=i=>({id:'solana:pool'+i,address:'pool'+i,chain:'solana',venue:'meteora-dlmm',pair:'TOKEN'+i+'/SOL',base:{address:'mint'+i,symbol:'TOKEN'+i},quote:{address:SOL,symbol:'SOL'},tvlUsd:300000,ageHours:168,fetchedAt:at,activity:{fees1h:1000,volume30m:40000}});
const pools=[0,1,2,3].map(pool),snapshot={updatedAt:at,pools,errors:{}};
const state=()=>{const s=initialFleetState();s.day=at.slice(0,10);s.memory=Object.fromEntries(arms.flatMap(a=>pools.map(p=>[a+':'+p.id,{at:new Date(now-300000).toISOString(),streak:3}])));return s;};
const mark=(size,changes={})=>({at,principalSol:size,feesSol:0,grossSol:size,liquidationSol:size-.0001,conversionCostSol:0,networkSol:.0001,inRange:true,waiting:false,priceSol:.01,withdrawTaxSol:0,epoch:10,transferFees:[],...changes});
const entry=(arm,p,request,budget=request.targetSol)=>{const cohort=p.address+':'+at;return {allocation:{...request,acceptedSol:budget,attempts:[{budgetSol:budget,reason:'Quoted fixture'}],limitedBy:'Fixture'},budgetSol:budget,rentSol:.1,entryNetworkSol:.0001,experiment:FLEET_RULES.version,id:'fleet:'+arm+':'+cohort,cohort,arm,pool:p,mint:p.base.address,openedAt:at,model:{shares:[{id:0,share:'100',feeX:'0',feeY:'0'}],lowerBin:0,upperBin:0,solX:false,decX:9,decY:9,mintX:p.base.address,mintY:SOL},dustSol:0,mark:mark(budget),issue:null,pendingExit:null,observedInRangeMs:0};};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const low=allocationRequest('farmer',100,{score:10}),high=allocationRequest('farmer',100,{score:90});assert.ok(high.targetSol>low.targetSol&&high.targetSol>30);
const full=allocationRequest('scalp',100,signal);assert.ok(full.targetSol>98&&full.targetSol<100);assert.equal(allocationRequest('scalp',100,{...signal,volumeRatio:1.5}).fraction<.99,true);
assert.equal(allocationRequest('scalp',100,{...signal,ready:false}).fraction<.99,true);assert.ok(allocationRequest('wide',100,signal).down>.35);
assert.ok(allocationRequest('wide',.2,signal).targetSol===0);
// Large and resized entries debit their actual sizes; replay, nonfinite and over-cash proposals fail.
for(const arm of arms){
 const s=state(),request=allocationRequest(arm,s.portfolios[arm].cashSol,signal),e=entry(arm,pools[0],request),read={poolId:pools[0].id,arm,entry:e};
 let result=advanceFleet(s,snapshot,[read,read],now);assert.equal(result.positions.length,1);close(result.portfolios[arm].cashSol,s.portfolios[arm].cashSol-e.budgetSol-.1001);assert.equal(result.portfolios[arm].trial.entries,1);assert.equal(result.portfolios[arm].trial.checks,1);close(result.portfolios[arm].trial.deployedSol,e.budgetSol);
 assert.equal(result.lastSuccessfulEntryCheckAt[arm],e.mark.at,'only an accepted entry records a successful quote');
 assert.equal(result.lastEntryDecisionByArm[arm].kind,'entry');assert.match(result.lastEntryDecisionByArm[arm].message,/Opened/);
 assert.equal(result.discoveryHealth.snapshotAt,at);assert.equal(result.discoveryHealth.freshPools,pools.length);
 const activity=fleetSummary(result,now).arms.find(a=>a.id===arm).activity;
 assert.equal(activity.lastSuccessfulQuoteAt,e.mark.at);assert.equal(activity.latestEntryDecision.at,at);assert.equal(activity.funnel.entered,1);
 assert.equal(advanceFleet(result,snapshot,[read],now),result);assert.equal(result.positions[0].policy.down,request.down);
 for(const bad of [NaN,Infinity,-1,0,request.targetSol+1]){const proposal=structuredClone(e);proposal.budgetSol=bad;proposal.allocation.acceptedSol=bad;assert.equal(advanceFleet(s,snapshot,[{...read,entry:proposal}],now).positions.length,0);}
 const missing=structuredClone(e);delete missing.allocation;assert.equal(advanceFleet(s,snapshot,[{...read,entry:missing}],now).positions.length,0);
 const tiny=entry(arm,pools[0],request,.1);result=advanceFleet(s,snapshot,[{...read,entry:tiny}],now);assert.equal(result.positions.length,1);close(result.portfolios[arm].cashSol,s.portfolios[arm].cashSol-.2001);assert.equal(result.portfolios[arm].trial.resized,1);
 // Close the large sample later: principal is not reset to 2 SOL.
 const later=now+300000,laterAt=new Date(later).toISOString(),large=advanceFleet(s,snapshot,[read],now),closed=advanceFleet(large,{...snapshot,updatedAt:laterAt,pools:pools.map(p=>({...p,fetchedAt:laterAt}))},[{poolId:pools[0].id,arm,positionId:e.id,mark:{...mark(e.budgetSol*.5),at:laterAt}}],later);
 assert.equal(closed.closed.length,1);close(closed.closed[0].pnlSol,-e.budgetSol*.5-.0002);assert.equal(closed.closed[0].allocation.acceptedSol,e.budgetSol);
}
const providerFailure=advanceFleet(state(),snapshot,[{poolId:pools[0].id,arm:'farmer',error:'Provider cooldown: HTTP 429'}],now);
assert.equal(providerFailure.lastSuccessfulEntryCheckAt?.farmer,undefined,'a blocked attempt cannot claim a successful quote');
assert.equal(providerFailure.lastEntryDecisionByArm.farmer.kind,'entry');assert.match(providerFailure.lastEntryDecisionByArm.farmer.message,/429/);
assert.equal(fleetSummary(providerFailure,now).arms.find(a=>a.id==='farmer').activity.state,'provider-blocked');
// Three pool cohorts can settle in one observation; duplicate reads cannot double-debit.
let multi=state();const reads=pools.map(p=>({poolId:p.id,arm:'farmer',entry:entry('farmer',p,allocationRequest('farmer',multi.portfolios.farmer.cashSol,signal),2)}));
multi=advanceFleet(multi,snapshot,reads,now);assert.equal(multi.positions.length,3);close(multi.portfolios.farmer.cashSol,FLEET_RULES.seedSol-6.3003);
const daily=state();daily.portfolios.farmer.entriesToday=95;assert.equal(advanceFleet(daily,snapshot,reads,now).positions.length,1,'new daily ceiling is enforced across a multi-pool batch');
const capped=state();capped.portfolios.farmer.entriesToday=96;assert.match(fleetEntryReason(capped,'farmer',now),/96-entry/);
// Preserve the funded v4 ledger, policies, current losses and unknown capital.
const old=state();old.version='four-wallets-v4';const request=allocationRequest('steady',old.portfolios.steady.cashSol,signal),legacy=entry('steady',pools[0],request,2);legacy.experiment='four-wallets-v4';legacy.policy=fleetPolicy('steady','four-wallets-v4');legacy.openedAt=new Date(now-600000).toISOString();delete legacy.allocation;
legacy.issue='Liquidity changed beyond the small-share model';legacy.mark=mark(2,{liquidationSol:null});old.positions=[legacy];old.portfolios.steady.cashSol-=2.1001;old.portfolios.steady.unresolvedSol=2.1;old.portfolios.steady.unscorableCount=1;old.portfolios.steady.trial={version:'four-wallets-v4',closedCount:2,unscorableCount:1,realizedPnlSol:-.5};old.portfolios.farmer.realizedPnlSol=-1.2;old.portfolios.farmer.maxDrawdown=.15;
const migrated=advanceFleet(old,snapshot,[{poolId:pools[0].id,arm:'steady',positionId:legacy.id,error:legacy.issue}],now);
assert.equal(migrated.version,'four-wallets-v6');assert.deepEqual(migrated.portfolios.steady.funding,old.portfolios.steady.funding);close(migrated.portfolios.steady.cashSol,old.portfolios.steady.cashSol);close(migrated.portfolios.farmer.realizedPnlSol,-1.2);assert.equal(migrated.portfolios.farmer.maxDrawdown,.15);assert.deepEqual(migrated.positions[0].policy,legacy.policy);assert.deepEqual(migrated.positions[0].model,legacy.model);assert.equal(migrated.portfolios.steady.trial.closedCount,0);
assert.equal(fleetEquity(migrated,'steady',now),null);assert.equal(fleetEntryReason(migrated,'steady',now),null,'unavailable old principal stays locked but remaining cash is usable');
const poor=structuredClone(old);poor.portfolios.steady.cashSol=50;const halted=advanceFleet(poor,snapshot,[],now);assert.equal(halted.portfolios.steady.halted,false);assert.equal(halted.portfolios.steady.riskDataHold,true,'unavailable positions still block entries, without latching a confirmed-loss stop');assert.ok(fleetEntryReason(halted,'steady',now));
// Runner uses three distinct pool reads, keeps per-wallet amounts bounded and
// records failed turns. It never performs a second RPC range read to try sizes.
let committed;const rs=state(),calls=[];globalThis.__readFleetPool=async(p,rpc,existing,chosen,cohort,fetcher,requests)=>{calls.push(p.id);return chosen.map(arm=>({poolId:p.id,arm,entry:entry(arm,p,requests[arm],Math.min(2,requests[arm].targetSol))}));};
const namespace={idFromName:n=>{assert.equal(n,'pat-four-wallets-v1');return n;},get:()=>({fetch:async(url,init)=>{if(!init)return Response.json(rs);committed=JSON.parse(init.body);return Response.json({ok:true});}})};
await runPaperFleet(namespace,snapshot,'https://unused.invalid');assert.equal(calls.length,3);assert.equal(new Set(calls).size,3);assert.equal(committed.reads.length,12);const batch=advanceFleet(rs,snapshot,committed.reads,now);assert.equal(batch.positions.length,12);for(const a of arms)close(batch.portfolios[a].cashSol,FLEET_RULES.seedSol-6.3003);
// All evidence survives reload and record sizes stay below the durable limit.
const saved=fleetRecords(batch);for(const [key,value] of Object.entries(saved))assert.ok(Buffer.byteLength(JSON.stringify(value))<128*1024,key);const restored=await loadFleet({get:async k=>structuredClone(saved[k])});assert.deepEqual(restored.positions,batch.positions);
assert.deepEqual(restored.lastEntryDecisionByArm,batch.lastEntryDecisionByArm);assert.deepEqual(restored.lastSuccessfulEntryCheckAt,batch.lastSuccessfulEntryCheckAt);assert.deepEqual(restored.discoveryHealth,batch.discoveryHealth,'activity evidence survives journal reload');
delete globalThis.__readFleetPool;
console.log('PASS v5: allocation envelopes, large/mixed-size debits, batch limits, runner rotation, legacy preservation, conservative risk, durable evidence');
