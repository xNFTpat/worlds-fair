import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const dir=await mkdtemp(join(tmpdir(),'pat-risk-'));
await build({entryPoints:['src/paper-fleet.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'fleet.mjs')});
const {initialFleetState,advanceFleet,fleetCanEnter,fleetEquity,fleetPolicy,controlFleet,fleetSummary}=await import(pathToFileURL(join(dir,'fleet.mjs')));
const base=Date.parse('2026-09-18T15:30:00Z'),at=m=>new Date(base+m*60000).toISOString(),now=m=>base+m*60000;
const SOL='So11111111111111111111111111111111111111112';
const pool={id:'solana:fixture',address:'fixture',base:{address:'mint'},quote:{address:SOL},pair:'A/SOL',tvlUsd:100000};
const mark=(m,value=39.9999)=>({at:at(m),principalSol:value+.0001,feesSol:0,grossSol:value+.0001,liquidationSol:value,conversionCostSol:0,networkSol:.0001,inRange:true,waiting:false,priceSol:.01,withdrawTaxSol:0,epoch:1000,transferFees:[]});
const snap=m=>({updatedAt:at(m),pools:[],errors:{}});
function fixture(){const s=initialFleetState();Object.assign(s.portfolios.farmer,{cashSol:59.9,peakSol:100,seedSol:100});s.positions=[{id:'held',arm:'farmer',experiment:s.version,cohort:'fixture',pool,mint:'mint',openedAt:at(0),budgetSol:40,rentSol:.1,entryNetworkSol:.0001,policy:fleetPolicy('farmer'),model:{shares:[{id:0,share:'100',feeX:'0',feeY:'0'}]},dustSol:0,mark:mark(0),issue:null,pendingExit:null,observedInRangeMs:0}];return s;}
const read=(m,value)=>[{poolId:pool.id,arm:'farmer',positionId:'held',mark:mark(m,value)}];
const original=fixture();
let failed=advanceFleet(original,snap(5),[{poolId:pool.id,arm:'farmer',positionId:'held',error:'Pool moved during the read; retry on the next scan'}],now(5));
assert.equal(failed.portfolios.farmer.halted,false);assert.equal(failed.portfolios.farmer.riskDataHold,true);assert.equal(fleetCanEnter(failed,'farmer',now(5)),false);
assert.equal(fleetEquity(failed,'farmer',now(5)),null);assert.equal(failed.portfolios.farmer.cashSol,59.9);assert.equal(failed.closed.length,0);assert.equal(original.positions[0].issue,null);
const restored=advanceFleet(failed,snap(10),read(10),now(10));
assert.equal(restored.portfolios.farmer.riskDataHold,false);assert.equal(restored.portfolios.farmer.halted,false);assert.equal(fleetCanEnter(restored,'farmer',now(10)),true);
assert.equal(restored.portfolios.farmer.cashSol,59.9);assert.equal(restored.portfolios.farmer.maxDrawdown,failed.portfolios.farmer.maxDrawdown,'historical conservative drawdown is not erased or re-latched');
assert.equal(advanceFleet(restored,snap(10),read(10),now(10)),restored,'replay is still inert');
// Both structural failures and old unknown outcomes keep missing money locked.
const missing=initialFleetState();Object.assign(missing.portfolios.wide,{cashSol:70,peakSol:100,unresolvedSol:30,unscorableCount:2});
const hold=advanceFleet(missing,snap(5),[],now(5));assert.equal(hold.portfolios.wide.riskDataHold,true);assert.equal(fleetCanEnter(hold,'wide',now(5)),false);assert.equal(fleetEquity(hold,'wide',now(5)),null);assert.equal(hold.portfolios.wide.cashSol,70);
const resumed=controlFleet(hold,'resume',now(5));assert.equal(fleetCanEnter(resumed,'wide',now(5)),false,'resume must not override an unresolved risk hold');
const loss=advanceFleet(fixture(),snap(5),read(5,14),now(5));
assert.equal(loss.closed.length,1);assert.equal(loss.portfolios.farmer.halted,true);assert.equal(loss.portfolios.farmer.riskDataHold,false);assert.equal(loss.portfolios.farmer.confirmedHaltAt,at(5));
loss.portfolios.farmer.cashSol=95;
const later=advanceFleet(loss,snap(10),[],now(10));assert.equal(later.portfolios.farmer.halted,true,'fully valued losses remain latched after recovery');assert.equal(fleetCanEnter(controlFleet(later,'resume'),'farmer',now(10)),false);
// Public builds contain no private recovery allowlist. Synthetic legacy stops
// remain stopped, even after values recover, and retain all accounting records.
function legacy(){const s=initialFleetState();s.version='four-wallets-v5';s.day=at(0).slice(0,10);s.lastEntryCheckAt={farmer:at(0),steady:at(0)};for(const id of ['farmer','steady'])Object.assign(s.portfolios[id],{halted:true,peakSol:100,maxDrawdown:.35,cashSol:90,realizedPnlSol:-10,closedCount:1,unresolvedSol:0,unscorableCount:0,entriesToday:2});s.closed=[{id:'synthetic-closed',arm:'farmer',pnlSol:-10}];s.unscorable=[];return s;}
const prior=legacy(),reviewed=advanceFleet(prior,snap(5),[],now(5));
for(const id of ['farmer','steady']){assert.equal(reviewed.portfolios[id].halted,true);assert.equal(reviewed.portfolios[id].riskReview,undefined);for(const k of ['cashSol','peakSol','maxDrawdown','funding','realizedPnlSol','unresolvedSol','closedCount','unscorableCount','entriesToday'])assert.deepEqual(reviewed.portfolios[id][k],prior.portfolios[id][k],id+' '+k+' retained');}
assert.deepEqual(reviewed.closed,prior.closed);assert.deepEqual(reviewed.unscorable,prior.unscorable);assert.equal(prior.portfolios.farmer.halted,true);
const twice=advanceFleet(reviewed,snap(10),[],now(10));assert.equal(twice.events.filter(e=>e.message.startsWith('Reviewed data-related')).length,0,'public build never invents an audit');
for(const change of [s=>s.lastEntryCheckAt.farmer=at(1),s=>s.portfolios.farmer.maxDrawdown=.6,s=>s.portfolios.farmer.confirmedHaltAt=at(0),s=>s.portfolios.farmer.cashSol=40]){const different=legacy();change(different);const result=advanceFleet(different,snap(5),[],now(5));assert.equal(result.portfolios.farmer.halted,true);assert.equal(result.portfolios.farmer.riskReview,undefined);}
// UI must distinguish an empty but active wallet from a risk stop or stale data.
const context={window:{},Date};vm.runInNewContext(await readFile('public/fleet-activity.js','utf8'),context);
const status=context.window.lpFleetActivity,s={runState:'running',lastFullScanAt:at(0)},a={active:true,entryAllowed:true,entriesToday:49};
assert.equal(status(s,a,{status:'running'},now(1)).text,'Scanning for entries');
assert.match(status(s,{...a,halted:true},{status:'running'},now(1)).text,/stopped/);
assert.match(status(s,{...a,riskDataHold:true},{status:'running'},now(1)).text,/values/);
assert.match(status(s,a,{status:'running'},now(20)).text,/attention/);
assert.match(status(s,a,null,now(1)).text,/attention/);
assert.equal(fleetSummary(reviewed,now(5)).arms.find(a=>a.id==='farmer').riskReview,undefined);
console.log('PASS: transient valuation hold and recovery; real loss remains stopped; missing capital never refunded; public legacy halt preservation; activity states');
