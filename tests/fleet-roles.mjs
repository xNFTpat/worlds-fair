import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'pat-roles-'));
for(const [name,file] of [['roles','src/fleet-roles.ts'],['signals','src/fleet-signals.ts'],['fleet','src/paper-fleet.ts'],['allocation','src/fleet-allocation.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const load=n=>import(pathToFileURL(join(dir,n+'.mjs')));
const {roleSignal,roleExit,metaLeaders,ROLE_VERSION,WATCHED_META_MINTS}=await load('roles');
const {marketSignal}=await load('signals');
const {initialFleetState,advanceFleet,fleetPolicy,fleetPlan,fleetCanEnter,fleetEquity}=await load('fleet');
const {allocationRequest}=await load('allocation');
const base=Date.parse('2026-09-21T01:00:00Z'),ms=m=>base+m*60000,at=m=>new Date(ms(m)).toISOString();
const SOL='So11111111111111111111111111111111111111112';
const pool=(m,price=1,extra={})=>({id:'solana:test',address:'test',chain:'solana',venue:'meteora-dlmm',pair:'TEST/SOL',base:{address:'mint',symbol:'TEST'},quote:{address:SOL,symbol:'SOL'},tvlUsd:200000,priceQuote:price,ageHours:12,fetchedAt:at(m),activity:{fees1h:1000,volume30m:40000,volume1h:60000,volume4h:200000},...extra});
const rows=prices=>prices.map((p,i)=>[ms(i*5),p,200000,1000,40000]);
const signal=(arm,p,r,leaders=new Set(['mint']))=>roleSignal(arm,p,r,Date.parse(p.fetchedAt),marketSignal(arm,p,r,Date.parse(p.fetchedAt)),leaders);
assert.equal(signal('scalp',pool(5,1.02),rows([1,1.02])).ready,true,'two fresh observations can qualify a fast breakout');
assert.equal(signal('scalp',pool(5,.98),rows([1,.98])).ready,false,'do not buy a falling price just because volume is high');
assert.equal(signal('scalp',pool(5,1.2),rows([1,1.2])).ready,false,'do not chase a discontinuous jump');
assert.equal(signal('scalp',pool(5,1.02),rows([1])).ready,false,'cached price cannot stand in for another observation');
assert.equal(signal('farmer',pool(30),rows([1,1.01,.99,1.02,1,1.01,1])).ready,true);
assert.equal(signal('farmer',pool(30,1.1),rows([1,1.01,1.02,1.03,1.04,1.08,1.1])).ready,false);
const long=pool(60,1.02),history=rows(Array.from({length:13},(_,i)=>1+i/600));
assert.equal(signal('steady',long,history).ready,true,'a 12-hour pool can qualify for long hold');
assert.equal(signal('steady',long,history,new Set()).ready,false,'generic deep old pool is not automatically a meta candidate');
assert.equal(signal('steady',{...long,base:{address:WATCHED_META_MINTS[0]}},history,new Set()).ready,true);
assert.equal(signal('steady',{...long,base:{address:'fake',symbol:'STONK'}},history,new Set()).ready,false,'watchlist is exact mint, not symbol');
const fade={...long,activity:{...long.activity,volume1h:10000,volume4h:200000}};
assert.equal(signal('steady',fade,history).ready,false,'watch status cannot bypass sustained activity');
assert.equal(metaLeaders([long,{...long,id:'copy',address:'copy'},{...long,id:'stale',base:{address:'old'},fetchedAt:at(0)}],ms(60)).size,1,'deduplicate tokens and exclude stale sources');
const x=(m,extra={})=>({state:{},at:at(m),openedAt:at(0),netSol:0,budgetSol:2,inRange:true,priceSol:1.01,entryPriceSol:1,fillObserved:true,entryPool:pool(0),continuous:true,...extra});
assert.match(roleExit('scalp',x(1,{inRange:false,netSol:null})).reason,/nine-bin range/,'range exit does not require a successful quote');
assert.match(roleExit('farmer',x(1,{inRange:false,netSol:null})).reason,/left its range/);
assert.match(roleExit('scalp',x(3,{priceSol:1.002})).reason,/follow-through/);
assert.match(roleExit('scalp',x(1,{priceSol:.98})).reason,/Breakout failed/);
assert.match(roleExit('scalp',x(2,{state:{peakNetSol:.08},netSol:.04})).reason,/gave back/);
assert.equal(roleExit('wide',x(40,{inRange:false,fillObserved:false,state:{outSince:at(0)}})).reason,null,'unfilled bids are not stopped as an out-of-range holding');
const aligned=allocationRequest('wide',100,{version:ROLE_VERSION,ready:true,score:50,drawdown:.2,lowSol:.8,priceSol:.85});
assert.ok(aligned.down<.1&&aligned.offset===.01,'new bids track the observed low instead of a fixed 35% decline');
assert.equal(allocationRequest('wide',100,{version:'market-signals-v1',score:50,drawdown:.2}).down,.35,'old declared sizing remains reproducible');
let weakState={};
for(let m=120;m<=150;m+=5){const result=roleExit('steady',x(m,{state:weakState,current:pool(m,1,{activity:{fees1h:50,volume30m:1000,volume1h:10000,volume4h:20000}})}));weakState=result.state;assert.equal(result.reason,null,'long hold does not exit a quiet patch after two hours');}
weakState={};let exit;
for(let m=240;m<=265;m+=5){exit=roleExit('steady',x(m,{state:weakState,current:pool(m,1,{activity:{fees1h:50,volume30m:1000,volume1h:10000,volume4h:20000}})}));weakState=exit.state;}
assert.match(exit.reason,/six fresh observations/);
assert.equal(roleExit('steady',x(270,{state:weakState,current:pool(265,1,{activity:{fees1h:50,volume30m:1000,volume1h:10000,volume4h:20000}})})).state.weakChecks,6,'reused source timestamp never counts twice');
const snap=(m,pools=[])=>({updatedAt:at(m),pools,errors:{}});
const mark=(m,extra={})=>({at:at(m),principalSol:1.98,feesSol:0,grossSol:1.98,liquidationSol:1.9799,conversionCostSol:0,networkSol:.0001,inRange:true,waiting:false,priceSol:1.01,withdrawTaxSol:0,epoch:1,transferFees:[],...extra});
function held(arm='scalp',version='four-wallets-v6'){
 const s=initialFleetState();s.day=at(0).slice(0,10);s.version=version;
 s.portfolios[arm].cashSol-=2.1001;
 s.positions=[{id:'held',experiment:version,arm,pool:pool(0),mint:'mint',openedAt:at(0),entryReferenceSol:1,budgetSol:2,rentSol:.1,entryNetworkSol:.0001,policy:fleetPolicy(arm,version),cohort:'fixture',model:{shares:[{id:0,share:'100',feeX:'0',feeY:'0'}]},dustSol:0,mark:mark(0),issue:null,pendingExit:null,observedInRangeMs:0}];return s;
}
const initial=held(),balance=initial.portfolios.scalp.cashSol;
const failed=advanceFleet(initial,snap(1),[{poolId:'solana:test',arm:'scalp',positionId:'held',market:{at:at(1),inRange:false,priceSol:.98},error:'Liquidity changed beyond the small-share model'}],ms(1),'heart');
assert.match(failed.positions[0].pendingExit,/nine-bin range/);assert.equal(failed.closed.length,0);assert.equal(failed.portfolios.scalp.cashSol,balance);assert.equal(fleetEquity(failed,'scalp',ms(1)),null);
const resolved=advanceFleet(failed,snap(2),[{poolId:'solana:test',arm:'scalp',positionId:'held',mark:mark(2)}],ms(2),'heart');
assert.equal(resolved.positions.length,0);assert.equal(resolved.closed.length,1);assert.equal(resolved.closed[0].closedAt,at(2),'settle at fresh quote time, never backfill exit');
assert.equal(resolved.portfolios.scalp.cashSol,balance+1.9799+.1);
const stale=advanceFleet(initial,snap(1),[{poolId:'solana:test',arm:'scalp',positionId:'held',market:{at:at(-20),inRange:false,priceSol:.98},error:'Unavailable'}],ms(1),'heart');
assert.equal(stale.positions[0].pendingExit,null,'stale market data cannot trigger an exit');
const deadline=advanceFleet(initial,snap(10),[{poolId:'solana:test',arm:'scalp',positionId:'held',error:'Unavailable'}],ms(10),'heart');assert.match(deadline.positions[0].pendingExit,/10-minute/);assert.equal(deadline.closed.length,0);
const outFarmer=advanceFleet(held('farmer'),snap(5),[{poolId:'solana:test',arm:'farmer',positionId:'held',mark:mark(5,{inRange:false,liquidationSol:null,issue:'Exit quote unavailable'})}],ms(5));assert.match(outFarmer.positions[0].pendingExit,/left its range/);
const legacy=held('scalp','four-wallets-v5'),copy=structuredClone(legacy);
const upgraded=advanceFleet(legacy,snap(10),[{poolId:'solana:test',arm:'scalp',positionId:'held',mark:mark(10)}],ms(10));
assert.deepEqual(legacy,copy);assert.equal(upgraded.positions[0].policy.maxHoldHours,.5);assert.equal(fleetPolicy('scalp').maxHoldHours,1/6);assert.equal(upgraded.version,'four-wallets-v6');
for(const a of ['farmer','scalp','wide','steady'])for(const k of ['cashSol','seedSol','funding','realizedPnlSol','closedCount'])assert.deepEqual(upgraded.portfolios[a][k],legacy.portfolios[a][k],a+' '+k+' preserved');
const blocked=held();blocked.portfolios.wide.cashSol=60;blocked.portfolios.wide.unscorableCount=3;blocked.portfolios.wide.unresolvedSol=40;
assert.equal(fleetCanEnter(advanceFleet(blocked,snap(5),[],ms(5)),'wide',ms(5)),false,'new roles cannot bypass an existing risk pause');
// Actual new selection + ledger entry, not just isolated signal functions.
let live=initialFleetState();live=advanceFleet(live,snap(0,[pool(0)]),[],ms(0));live=advanceFleet(live,snap(5,[pool(5,1.02)]),[],ms(5));
const plan=fleetPlan(live,snap(10,[pool(10,1.03)]),ms(10));assert.ok(plan.allowedArms['solana:test'].includes('scalp'));assert.equal(plan.signals['solana:test'].scalp.version,ROLE_VERSION);

// Measured zero is weak activity, whereas absent/invalid windows remain unknown.
for(const arm of ['farmer','steady']){
 let state={},result;
 const start=arm==='steady'?240:30,count=arm==='steady'?6:3;
 for(let i=0;i<count;i++){
  const m=start+i*5;
  result=roleExit(arm,x(m,{state,current:pool(m,1,{activity:{fees1h:0,volume30m:0,volume1h:0,volume4h:0}})}));state=result.state;
  assert.equal(state.weakChecks,i+1);
 }
 assert.match(result.reason,arm==='steady'?/six fresh/:/three observations/);
 for(const invalid of [null,undefined,-1,NaN,Infinity]){
  const m=start+count*5;
  const unknown=roleExit(arm,x(m,{state,current:pool(m,1,{activity:{fees1h:invalid,volume30m:invalid,volume1h:0,volume4h:invalid}})}));
  assert.equal(unknown.state.weakChecks,0,'invalid amount does not count as observed decay');
  assert.equal(unknown.reason,null);
 }
}
// A fresh liquidity warning does not need a model or quote, and never fabricates settlement.
for(const arm of ['farmer','scalp','wide','steady']){
 const start=held(arm),cash=start.portfolios[arm].cashSol;
 const r={poolId:'solana:test',arm,positionId:'held',market:{at:at(5),inRange:true,priceSol:1.01},error:'Pool moved during the read'};
 const queued=advanceFleet(start,snap(5,[pool(5,1,{tvlUsd:120000})]),[r],ms(5));
 assert.equal(queued.positions[0].pendingExit,'Liquidity fell 30%');assert.equal(queued.closed.length,0);assert.equal(queued.portfolios[arm].cashSol,cash);
 assert.equal(queued.positions[0].exitState.lastAt,at(5));
 const repeated=advanceFleet(queued,snap(10),[{...r,market:{...r.market,at:at(10)}}],ms(10));
 assert.equal(repeated.positions[0].exitState.lastAt,at(10),'observation state persists after intent is already pending');
 const paid=advanceFleet(repeated,snap(15),[{poolId:'solana:test',arm,positionId:'held',mark:mark(15)}],ms(15));
 assert.equal(paid.closed[0].reason,'Liquidity fell 30%');assert.equal(paid.closed[0].closedAt,at(15));assert.equal(paid.portfolios[arm].cashSol,cash+1.9799+.1);
 for(const current of [pool(5,1,{tvlUsd:140000}),pool(-20,1,{tvlUsd:120000}),pool(5,1,{tvlUsd:null})]){
  assert.equal(advanceFleet(start,snap(5,[current]),[r],ms(5)).positions[0].pendingExit,null,'exact threshold and unavailable source do not queue liquidity intent');
 }
}
const walk=(s,m,kind='quote',extra={})=>advanceFleet(s,snap(m),[{poolId:'solana:test',arm:s.positions[0].arm,positionId:'held',...(kind==='quote'?{mark:mark(m,{inRange:false,liquidationSol:null,issue:'Exit quote unavailable',...extra})}:kind==='missing'?{error:'Provider timeout'}:{market:{at:at(m),inRange:false,priceSol:1.01,...extra},error:'Liquidity changed beyond the small-share model'})}],ms(m));
for(const mixed of [false,true]){
 let s=held('steady');const cash=s.portfolios.steady.cashSol;
 for(let m=5;m<=125;m+=5){s=walk(s,m,mixed&&m%10===0?'model':'quote');assert.equal(s.positions[0].exitState.lastAt,at(m));assert.equal(s.positions[0].exitState.outSince,at(5));assert.equal(s.portfolios.steady.cashSol,cash);assert.equal(s.closed.length,0);}
 assert.match(s.positions[0].pendingExit,/outside range for 120 minutes/);
 const paid=advanceFleet(s,snap(130),[{poolId:'solana:test',arm:'steady',positionId:'held',mark:mark(130)}],ms(130));
 assert.equal(paid.closed[0].closedAt,at(130));assert.equal(paid.portfolios.steady.cashSol,cash+1.9799+.1);
}
let gaps=held('steady');for(let m=5;m<=25;m+=5)gaps=walk(gaps,m);
gaps=walk(gaps,30,'missing');assert.equal(gaps.positions[0].exitState.outSince,undefined);
gaps=walk(gaps,35,'model');assert.equal(gaps.positions[0].exitState.outSince,at(35));
gaps=walk(gaps,45,'model');assert.equal(gaps.positions[0].exitState.outSince,at(35),'ten-minute boundary retains observed continuity');
gaps=walk(gaps,60,'model');assert.equal(gaps.positions[0].exitState.outSince,at(60),'longer gap resets range clock');
gaps=walk(gaps,65,'model',{at:at(60)});assert.equal(gaps.positions[0].exitState.lastAt,at(60),'duplicate observation is inert');
gaps=walk(gaps,70,'model',{at:at(55)});assert.equal(gaps.positions[0].exitState.lastAt,at(60),'regressing observation is inert');
gaps=walk(gaps,75,'model',{at:at(50)});assert.equal(gaps.positions[0].exitState.outSince,undefined,'stale observation breaks continuity');
// Market-only evidence cannot invent a bid fill or unlock virtual money.
let bids=held('wide');bids.positions[0].fillObserved=false;
for(let m=5;m<=55;m+=5){bids=walk(bids,m,'model',{inRange:true});assert.equal(bids.positions[0].fillObserved,false);assert.equal(bids.positions[0].pendingExit,null);assert.equal(bids.positions[0].exitState.outSince,undefined);}
bids=walk(bids,60,'model',{inRange:true});assert.equal(bids.closed.length,0);assert.equal(bids.unscorable.length,1);assert.equal(bids.portfolios.wide.unresolvedSol,2.1);assert.equal(bids.portfolios.wide.cashSol,held('wide').portfolios.wide.cashSol);assert.match(bids.events.find(e=>e.message.includes('No observed fill')).message,/60 minutes/);
const pending=advanceFleet(held('steady'),snap(10,[pool(10,1,{tvlUsd:120000})]),[{poolId:'solana:test',arm:'steady',positionId:'held',error:'Provider timeout'}],ms(10));
const beforeIntent=advanceFleet(pending,snap(15),[{poolId:'solana:test',arm:'steady',positionId:'held',mark:mark(5)}],ms(15));
assert.equal(beforeIntent.closed.length,0,'a recovered quote predating the pending intent cannot backfill settlement');assert.equal(beforeIntent.positions[0].mark.at,at(0));assert.equal(beforeIntent.portfolios.steady.cashSol,pending.portfolios.steady.cashSol);
console.log('PASS v6 exits: zero activity, independent liquidity intent, coherent range state across unavailable accounting, gap boundaries, locked funds and waiting bids');
