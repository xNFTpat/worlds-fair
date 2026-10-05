import {raydiumCatalogue,orcaCatalogue} from './fixtures/synthetic-public-data.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'pat-fleet-'));
// Ledger tests isolate selection; tests/strategy-v4.mjs exercises actual signals end to end.
const selectionFixture={name:'eligible-ledger-fixture',setup(b){b.onLoad({filter:/fleet-roles\.ts$/},()=>({contents:`export const ROLE_VERSION='role-signals-v2';export const metaLeaders=()=>new Set();export const roleSignal=(a,p,r,n,s)=>s;export const roleExit=()=>({state:{},reason:null});`,loader:'ts'}));b.onLoad({filter:/fleet-signals\.ts$/},()=>({contents:`export const observeMarkets=()=>({});export const marketSignal=()=>({version:'test',ready:true,score:1,reason:'Eligible fixture'});export const signalExit=()=>({state:{},reason:null});`,loader:'ts'}));}};
for(const [name,entry] of [['allocation','src/fleet-allocation.ts'],['fleet','src/paper-fleet.ts'],['storage','src/paper-fleet-storage.ts'],['sources','src/sources/solana-venues.ts'],['budget','src/data-budget.ts'],['inbox','src/range-alerts.ts']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs'),plugins:[selectionFixture]});
const {initialFleetState:fundedFleetState,advanceFleet,fleetPlan,fleetEquity,fleetCanEnter,fleetSummary,fleetPolicy,controlFleet,fleetEntryPriority,FLEET_ARMS}=await import(pathToFileURL(join(dir,'fleet.mjs')));
const {allocationRequest}=await import(pathToFileURL(join(dir,'allocation.mjs')));
const allocation=arm=>({...allocationRequest(arm,10,{score:1}),acceptedSol:2,attempts:[{budgetSol:2,reason:'Quoted fixture'}],limitedBy:'Fixture'});
// Small-bankroll ledger fixtures retain their original amounts; dedicated tests verify the new grant.
const initialFleetState=()=>{const s=fundedFleetState();for(const a of Object.values(s.portfolios)){a.cashSol=10;a.peakSol=10;a.seedSol=10;}return s;};
const {fleetRecords,loadFleet}=await import(pathToFileURL(join(dir,'storage.mjs')));
const {normalizeVenue}=await import(pathToFileURL(join(dir,'sources.mjs')));
const {reserveGecko}=await import(pathToFileURL(join(dir,'budget.mjs')));
const now=Date.parse('2026-09-14T12:00:00Z'),at=m=>new Date(now+m*60000).toISOString(),time=m=>now+m*60000;
Date.now=()=>now;
const SOL='So11111111111111111111111111111111111111112';
const pool=(m,age=30,address='pool')=>({id:'solana:'+address,address,chain:'solana',venue:'meteora-dlmm',pair:'A/SOL',base:{address:'mint'+address,symbol:'A'},quote:{address:SOL,symbol:'SOL'},tvlUsd:150000,volume24hUsd:1000000,ageHours:age,fetchedAt:at(m),activity:{fees1h:1500,volume30m:30000}});
const snap=(m,age=30)=>({updatedAt:at(m),pools:[pool(m,age)],errors:{}});
const mark=(m,changes={})=>({at:at(m),principalSol:2,feesSol:0,grossSol:2,liquidationSol:1.9999,conversionCostSol:0,networkSol:.0001,inRange:false,waiting:true,priceSol:.01,withdrawTaxSol:0,epoch:1000,transferFees:[],...changes});
const entry=(m,arm,age)=>{const p=pool(m,age),cohort=`pool:${at(m)}`;return {allocation:allocation(arm),experiment:'four-wallets-v6',budgetSol:2,rentSol:.1,entryNetworkSol:.0001,id:`fleet:${arm}:${cohort}`,cohort,arm,pool:p,mint:p.base.address,openedAt:at(m),model:{shares:[{id:-1,share:'100',feeX:'0',feeY:'0'}],lowerBin:-70,upperBin:-1,solX:false,decX:9,decY:9,mintX:p.base.address,mintY:SOL},dustSol:0,mark:mark(m),issue:null,pendingExit:null,observedInRangeMs:0};};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
let s=initialFleetState();assert.equal(s.version,'four-wallets-v6');assert.equal(s.arms,undefined);assert.equal(FLEET_ARMS.length,4);
for(const a of FLEET_ARMS)close(fleetEquity(s,a.id,now),10);
// Regression: a zero-entry wallet with four alternating failed pools used to
// monopolise every candidate scan. Rotate by actual checks, including failures.
const rotating=initialFleetState(),armIds=FLEET_ARMS.map(a=>a.id);
Object.assign(rotating.portfolios.farmer,{entriesToday:2});Object.assign(rotating.portfolios.scalp,{entriesToday:1});Object.assign(rotating.portfolios.wide,{entriesToday:1});
const turns=[];
for(let i=0;i<8;i++){const next=fleetEntryPriority(rotating,armIds)[0];turns.push(next);(rotating.lastEntryCheckAt??={})[next]=at(i*5);}
assert.equal(new Set(turns.slice(0,4)).size,4,'every continuously eligible wallet gets a turn despite failures');
assert.deepEqual(turns.slice(4),turns.slice(0,4));assert.equal(rotating.portfolios.steady.entriesToday,0,'checks do not invent entries');
assert.deepEqual(fleetEntryPriority(rotating,['farmer','wide']).sort(),['farmer','wide'],'paused/full wallets supplied by the runner stay excluded');
let failed=initialFleetState();failed=advanceFleet(failed,snap(0,300),[],time(0));failed=advanceFleet(failed,snap(5,300),[],time(5));
const failedReads=[{poolId:'solana:pool',arm:'steady',error:'Saved range exceeds the fleet read limit'}];
const originalFailed=structuredClone(failed);failed=advanceFleet(failed,snap(10,300),failedReads,time(10));
assert.equal(failed.lastEntryCheckAt.steady,at(10));assert.equal(originalFailed.lastEntryCheckAt,undefined);close(failed.portfolios.steady.cashSol,10);assert.equal(failed.positions.length,0);
assert.equal(fleetEntryPriority(failed,['steady','farmer'])[0],'farmer');
assert.ok(failed.failures['steady:solana:pool']>time(10),'existing failed-pool cooldown remains');
assert.equal(fleetPlan(failed,snap(15,300),time(15)).allowedArms['solana:pool']?.includes('steady')||false,false);
assert.equal(advanceFleet(failed,snap(10,300),failedReads,time(10)),failed,'replayed scans cannot consume another scheduling turn');
const rotationSaved=fleetRecords(failed);assert.deepEqual((await loadFleet({get:async k=>structuredClone(rotationSaved[k])})).lastEntryCheckAt,failed.lastEntryCheckAt,'rotation survives durable reload');
// Every strategy can enter its intended age regime, with independent prospective rules.
for(const [arm,age] of [['farmer',30],['scalp',1],['wide',30],['steady',300]]){
 let state=initialFleetState();state=advanceFleet(state,snap(0,age),[],time(0));state=advanceFleet(state,snap(5,age),[],time(5));
 state=advanceFleet(state,snap(10,age),[{poolId:'solana:pool',arm,entry:entry(10,arm,age)}],time(10));
 assert.equal(state.positions.length,1,arm+' must enter');close(state.portfolios[arm].cashSol,7.8999);close(fleetEquity(state,arm,time(10)),9.9998);
 assert.equal(state.positions[0].experiment,'four-wallets-v6');assert.equal(advanceFleet(state,snap(10,age),[],time(10)),state,'duplicate scan cannot debit twice');
 assert.equal(fleetCanEnter({...state,runState:'paused'},arm,time(10)),false);
 const closedMark=mark(15,{principalSol:.3,feesSol:.025,grossSol:.325,liquidationSol:.31,conversionCostSol:.0149});
 state=advanceFleet(state,snap(15,age),[{poolId:'solana:pool',arm,positionId:state.positions[0].id,mark:closedMark}],time(15));
 assert.equal(state.positions.length,0);assert.equal(state.closed.length,1);close(state.closed[0].pnlSol,-1.6901);close(state.portfolios[arm].cashSol,8.3099);close(state.portfolios[arm].realizedPnlSol,-1.6901);
 for(const other of FLEET_ARMS.filter(a=>a.id!==arm))close(state.portfolios[other.id].cashSol,10);
}
// Missing observations are neither wins nor synthetic cash refunds. Preserve capital as unresolved.
s=advanceFleet(s,snap(0,1),[],time(0));s=advanceFleet(s,snap(5,1),[{poolId:'solana:pool',arm:'scalp',entry:entry(5,'scalp',1)}],time(5));
const id=s.positions[0].id;s.positions[0].policy=fleetPolicy('scalp','four-wallets-v2');
for(let m=10;m<=100;m+=5)s=advanceFleet(s,snap(m,1),[{poolId:'solana:pool',arm:'scalp',positionId:id,error:'Rate limited'}],time(m));
assert.equal(s.positions.length,0);assert.equal(s.unscorable.length,1);assert.equal(s.closed.length,0);close(s.portfolios.scalp.cashSol,7.8999);assert.equal(fleetEquity(s,'scalp',time(100)),null);assert.equal(fleetCanEnter(s,'scalp',time(100)),true,'known unspent cash remains usable within conservative risk limit');
assert.equal(fleetSummary(s,time(100)).arms.find(a=>a.id==='scalp').unresolvedSol,2.1);
// A conservative lower-bound drawdown can stop entries without fabricating a scored equity value.
s.portfolios.scalp.cashSol=7;s=advanceFleet(s,snap(105,1),[],time(105));assert.equal(s.portfolios.scalp.halted,false);assert.equal(s.portfolios.scalp.riskDataHold,true);assert.equal(fleetCanEnter(s,'scalp',time(105)),false);
const paused=controlFleet(s,'pause');assert.equal(paused.runState,'paused');assert.equal(paused.unscorable.length,1);close(paused.portfolios.scalp.cashSol,7);
// Archived trials remain in separate DO/storage keys. Bin models cannot inflate state above DO limits.
const t=initialFleetState();t.positions=[entry(0,'wide',30)];t.positions[0].model.shares=Array.from({length:256},(_,id)=>({id,share:'9'.repeat(75),feeX:'8'.repeat(75),feeY:'7'.repeat(75)}));
const stored=fleetRecords(t);assert.equal(stored.lab,undefined);assert.equal(stored.fleet.positions[0].model.shares.length,0);assert.ok(new TextEncoder().encode(JSON.stringify(stored.fleet)).length<128*1024);
assert.equal((await loadFleet({get:async k=>structuredClone(stored[k])})).positions[0].model.shares.length,256);
// Upgrade in place: no seeded cash reset, no rescaling old inventory or unknowns.
let legacy=initialFleetState();legacy.version='four-wallets-v1';legacy.day=at(0).slice(0,10);
const oldEntry=entry(0,'farmer',30);oldEntry.experiment='four-wallets-v1';delete oldEntry.budgetSol;delete oldEntry.rentSol;delete oldEntry.entryNetworkSol;
oldEntry.experiment='four-wallets-v1';oldEntry.mark=mark(0,{principalSol:.5,grossSol:.5,liquidationSol:.4999});
legacy.positions=[oldEntry];legacy.portfolios.farmer.cashSol=9.3999;legacy.portfolios.farmer.entriesToday=1;
Object.assign(legacy.portfolios.scalp,{cashSol:8.1997,unscorableCount:3});delete legacy.portfolios.scalp.unresolvedSol;
const retained={id:'retained-close',arm:'wide',pnlSol:.02,experiment:'four-wallets-v1'};legacy.closed=[retained];
const untouched=structuredClone(legacy);
let upgraded=advanceFleet(legacy,snap(5),[{poolId:'solana:pool',arm:'farmer',positionId:oldEntry.id,mark:mark(5,{principalSol:.48,feesSol:.02,grossSol:.5,liquidationSol:.4999})}],time(5));
assert.deepEqual(legacy,untouched);assert.equal(upgraded.version,'four-wallets-v6');
assert.equal(upgraded.ruleChanges.length,1);assert.equal(upgraded.ruleChanges[0].fromBudgetSol,.5);assert.equal(upgraded.ruleChanges[0].toBudgetSol,2);
assert.deepEqual(upgraded.closed,[retained]);assert.equal(upgraded.positions[0].experiment,'four-wallets-v1');
close(upgraded.portfolios.farmer.cashSol,9.3999);assert.equal(upgraded.portfolios.farmer.entriesToday,1);
close(upgraded.portfolios.scalp.unresolvedSol,1.8);close(upgraded.portfolios.scalp.cashSol,8.1997);
const shown=fleetSummary(upgraded,time(5));close(shown.positions[0].budgetSol,.5);close(shown.positions[0].pnlSol,-.0002);
close(shown.arms.find(a=>a.id==='farmer').committedSol,.6);close(shown.arms.find(a=>a.id==='scalp').unresolvedSol,1.8);
assert.equal(shown.arms[0].policy.budgetSol,2);assert.equal(shown.arms.find(a=>a.id==='scalp').equitySol,null);
upgraded=advanceFleet(upgraded,snap(10),[{poolId:'solana:pool',arm:'farmer',positionId:oldEntry.id,mark:mark(10,{principalSol:.4,grossSol:.4,liquidationSol:.3999})}],time(10));
assert.equal(upgraded.positions.length,0,'legacy loss threshold is based on its original 0.5 SOL');
const oldClose=upgraded.closed.find(c=>c.id===oldEntry.id);close(oldClose.budgetSol,.5);close(oldClose.pnlSol,-.1002);close(upgraded.portfolios.farmer.cashSol,9.8998);
assert.equal(upgraded.ruleChanges.length,1,'migration is recorded only once');
// Reject an old worker's 0.5 SOL entry proposal after upgrading; never debit 2 SOL for it.
let transition=initialFleetState();transition=advanceFleet(transition,snap(0),[],time(0));transition=advanceFleet(transition,snap(5),[],time(5));
const obsolete=entry(10,'farmer',30);delete obsolete.budgetSol;delete obsolete.rentSol;delete obsolete.entryNetworkSol;
transition=advanceFleet(transition,snap(10),[{poolId:'solana:pool',arm:'farmer',entry:obsolete}],time(10));
assert.equal(transition.positions.length,0);close(transition.portfolios.farmer.cashSol,10);
// Unknown sums survive retention trimming and a mix of old and new entry sizes.
let mixed=initialFleetState();mixed.day=at(0).slice(0,10);mixed.portfolios.scalp.cashSol=6.0996;mixed.portfolios.scalp.unscorableCount=3;mixed.portfolios.scalp.unresolvedSol=1.8;
mixed.positions=[entry(0,'scalp',1)];mixed.positions[0].policy=fleetPolicy('scalp','four-wallets-v2');
for(const m of [30,35,40])mixed=advanceFleet(mixed,snap(m,1),[{poolId:'solana:pool',arm:'scalp',positionId:mixed.positions[0]?.id,error:'Liquidity changed beyond the small-share model'}],time(m));
close(mixed.portfolios.scalp.unresolvedSol,3.9);close(mixed.portfolios.scalp.cashSol,6.0996);assert.equal(mixed.portfolios.scalp.halted,false);assert.equal(mixed.portfolios.scalp.riskDataHold,true);
assert.equal(mixed.unscorable.at(-1).budgetSol,2);assert.equal(fleetSummary(mixed,time(40)).arms.find(a=>a.id==='scalp').equitySol,null);
// Source amounts and units: reported fees are not confused with fee APR or token prices.
for(const source of ['raydium','orca']){const raw=source==='orca'?orcaCatalogue:raydiumCatalogue;const rows=source==='orca'?raw.data:raw.data.data;const p=normalizeVenue(rows[0],source,at(0));assert.equal(p.chain,'solana');assert.ok(p.fees24hUsd>0);assert.ok(p.feeTier>=0&&p.feeTier<1);close(p.feeApr,p.fees24hUsd*365/p.tvlUsd);assert.equal(p.base.address,SOL);assert.equal(p.feeSource,'reported');assert.ok(p.url.startsWith('https://'));}
assert.equal(normalizeVenue({id:'a',mintA:{address:'x'}},'raydium'),null);
const rayFixture=raydiumCatalogue.data.data[0];
const spoofed=normalizeVenue({...rayFixture,mintB:{...rayFixture.mintB,address:'fake-usdc'}},'raydium');assert.equal(spoofed.priceUsd,null,'a USDC symbol is not a verified stable mint');
assert.equal(normalizeVenue({...rayFixture,type:'unsupported'},'raydium'),null);
// Failed provider calls consume reservations; exactly 48/day, no burst bypass, resets by UTC date.
let budget;for(let i=0;i<60;i++){const r=reserveGecko(budget,now);budget=r.state;assert.equal(r.allowed,i<48);}assert.equal(budget.attempts,48);assert.equal(reserveGecko(budget,now+86400000).state.attempts,1);
// Exercise durable atomic storage and reject duplicate concurrent commits.
const {RangeInbox}=await import(pathToFileURL(join(dir,'inbox.mjs')));const values=new Map();let chain=Promise.resolve();
const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{if(typeof k==='string')values.set(k,structuredClone(v));else Object.entries(k).forEach(([a,b])=>values.set(a,structuredClone(b)));},list:async()=>new Map(),delete:async()=>{}};
const inbox=new RangeInbox({storage,blockConcurrencyWhile:fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;}});
const permits=await Promise.all(Array.from({length:60},()=>inbox.fetch(new Request('https://test/reserve',{method:'POST'})).then(r=>r.json())));assert.equal(permits.filter(p=>p.allowed).length,48);
const body={expectedRevision:0,snapshot:snap(0),reads:[]};const commits=await Promise.all([1,2].map(()=>inbox.fetch(new Request('https://test/fleet',{method:'POST',body:JSON.stringify(body)}))));assert.deepEqual(commits.map(r=>r.status).sort(),[200,409]);
values.clear();for(const [key,value] of Object.entries(fleetRecords(untouched)))values.set(key,structuredClone(value));
const migrated=await inbox.fetch(new Request('https://test/fleet',{method:'POST',body:JSON.stringify({expectedRevision:untouched.revision,snapshot:snap(0),reads:[]})}));
assert.equal(migrated.status,200);assert.equal(values.get('fleet').version,'four-wallets-v6');
const baseline=values.get('fleet-baseline:four-wallets-v1');assert.equal(baseline.version,'four-wallets-v1');
assert.deepEqual(baseline.state.portfolios,untouched.portfolios);assert.deepEqual(baseline.state.closed,untouched.closed);
close(values.get('fleet').portfolios.farmer.cashSol,9.3999);close(values.get('fleet').portfolios.scalp.unresolvedSol,1.8);
assert.deepEqual(values.get('fleet-model:'+oldEntry.id),oldEntry.model,'migration retains the original bin shares');
console.log('Four paper wallets: accounting, strategy eligibility, unresolved capital, storage, source units and atomic quota checks passed.');

// v3 preserves existing degen policy and requires two new observations before new entries.
const v2=initialFleetState();v2.version='four-wallets-v2';v2.positions=[entry(0,'wide',30)];v2.positions[0].experiment='four-wallets-v2';v2.portfolios.wide.cashSol=7.8999;
v2.memory={'wide:solana:pool':{at:at(0),streak:3}};
const v3=advanceFleet(v2,snap(5),[{poolId:'solana:pool',arm:'wide',positionId:v2.positions[0].id,mark:mark(5)}],time(5));
assert.equal(v3.positions[0].policy.maxHoldHours,12);assert.equal(v3.positions[0].policy.maxWaitMinutes,180);assert.equal(fleetPolicy('wide').maxHoldHours,8);
assert.equal(v3.ruleChanges[0].fromBudgetSol,2);assert.equal(v3.ruleChanges[0].toBudgetSol,2);close(v3.portfolios.wide.cashSol,v2.portfolios.wide.cashSol);
assert.equal(fleetPolicy('scalp').twoSided,true);assert.equal(fleetPolicy('scalp','four-wallets-v2').twoSided,false);
assert.equal(fleetPolicy('farmer').stopLoss,fleetPolicy('farmer','four-wallets-v2').stopLoss);
const proposal=entry(10,'farmer',30);proposal.experiment='four-wallets-v2';
assert.equal(advanceFleet(transition,snap(15),[{poolId:'solana:pool',arm:'farmer',entry:proposal}],time(15)).positions.length,0,'old worker proposals cannot cross policy versions');
console.log('PASS v3: original policies and balances retained; prospective shapes and worker version isolation');
