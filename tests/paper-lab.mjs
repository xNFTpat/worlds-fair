import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const dir=await mkdtemp(join(tmpdir(),'pat-lab-'));
for(const [name,entry] of [['lab','src/paper-lab.ts'],['math','src/paper-lab-math.ts'],['inbox','src/range-alerts.ts'],['storage','src/paper-lab-storage.ts']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {LAB_RULES:R,LAB_ARMS:allArms,labPolicy,initialLabState:productionInitialState,advanceLab:advance,labPlan,labCanScan,labEquity,labSummary,labCanEnter,controlLab}=await import(pathToFileURL(join(dir,'lab.mjs')));
// Keep historical lifecycle cases exercising the six saved wallet profiles explicitly.
// Production defaults are separately checked below and do not enable these entries.
const initialLabState=()=>({...productionInitialState(),entryProfiles:allArms.filter(a=>['range','launch','longer'].includes(a.group)).map(a=>a.id)});
const arms=allArms.filter(a=>a.group==='range');
const {downsideBins,transferNet}=await import(pathToFileURL(join(dir,'math.mjs')));
const {labRecords,loadLab}=await import(pathToFileURL(join(dir,'storage.mjs')));
const SOL='So11111111111111111111111111111111111111112';
const now=Date.now(),time=m=>now+m*60000,at=m=>new Date(time(m)).toISOString();
const pool=m=>({id:'solana:pool',address:'pool',chain:'solana',venue:'meteora-dlmm',pair:'A/SOL',base:{address:'mintA',symbol:'A'},quote:{address:SOL,symbol:'SOL'},tvlUsd:50000,volume24hUsd:1000000,ageHours:12,fetchedAt:at(m),activity:{fees1h:1500,volume30m:10000}});
const snap=(m,changes={})=>({updatedAt:at(m),pools:[{...pool(m),...changes}],errors:{}});
const mark=(m,changes={})=>({at:at(m),principalSol:.2,feesSol:0,grossSol:.2,liquidationSol:.1999,conversionCostSol:0,networkSol:.0001,inRange:false,waiting:true,priceSol:.01,withdrawTaxSol:0,epoch:1000,transferFees:[],...changes});
const entry=(m,arm)=>{const cohort=`pool:${at(m)}`;return {id:`lab:${arm}:${cohort}`,cohort,arm,pool:pool(m),mint:'mintA',openedAt:at(m),model:{shares:[{id:-1,share:'100',feeX:'0',feeY:'0'}],lowerBin:-70,upperBin:-1,solX:false,decX:9,decY:9,mintX:'mintA',mintY:SOL},dustSol:0,mark:mark(m),issue:null,pendingExit:null,observedInRangeMs:0};};
const entries=m=>arms.map(a=>({poolId:'solana:pool',arm:a.id,entry:entry(m,a.id)}));
const reads=(s,m,changes={})=>s.positions.map(p=>({poolId:p.pool.id,arm:p.arm,positionId:p.id,mark:mark(m,changes)}));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
for(const down of [.5,.8])for(const solX of [true,false]){const r=downsideBins(100,100,down,solX);assert.ok(r.upper<100||r.lower>100);const steps=solX?r.upper-100:100-r.lower;assert.ok((1.01)**(-steps)<=1-down);assert.ok((1.01)**(-(steps-1))>1-down);}
assert.throws(()=>downsideBins(0,20,.8,false),/limit/);assert.throws(()=>downsideBins(0,0,.5,true),/Invalid/);
assert.deepEqual(transferNet(101n,300,1000n),{amount:97n,fee:4n});assert.deepEqual(transferNet(10000n,300,20n),{amount:9980n,fee:20n});assert.deepEqual(transferNet(0n,300,20n),{amount:0n,fee:0n});assert.throws(()=>transferNet(1n,10001,1n),/Invalid/);
let s=initialLabState();for(const a of arms)assert.equal(labEquity(s,a.id,now),1);
s=advance(s,snap(0),[],time(0));assert.equal(s.candidates[0].streak,1);assert.equal(advance(s,snap(0),[],time(0)),s);
s=advance(s,snap(5),[],time(5));assert.equal(s.candidates[0].streak,2);
assert.equal(labPlan(s,snap(10,{fetchedAt:at(5)}),time(10)).eligible.length,0,'same pool read cannot confirm again');
assert.equal(labPlan(s,snap(25),time(25)).candidates[0].streak,1,'gaps restart streak');
for(const change of [{tvlUsd:9999},{ageHours:.5},{ageHours:73},{fetchedAt:at(-20)},{quote:{address:'fakeSOL',symbol:'SOL'}},{activity:{fees1h:999,volume30m:10000}}])assert.equal(labPlan(s,snap(10,change),time(10)).eligible.length,0);
assert.equal(labCanScan(s,snap(-1),time(10)),false);assert.equal(labCanScan(s,snap(20),time(10)),false);assert.equal(labCanScan({...s,version:'future'},snap(10),time(10)),false);
const seeded=advance(s,snap(10),[...entries(10),entries(10)[0]],time(10));assert.equal(seeded.positions.length,3,'one entry per arm, duplicate ignored');
for(const a of arms){close(seeded.portfolios[a.id].cashSol,.6999);close(labEquity(seeded,a.id,time(10)),.9998);}
assert.equal(new Set(seeded.positions.map(p=>p.cohort)).size,1);
const invalid=entries(10);invalid[0].entry.pool.address='other';invalid[1].entry.mark.liquidationSol=.1;invalid[2].entry.cohort='wrong';assert.equal(advance(s,snap(10),invalid,time(10)).positions.length,0);
const partial=advance(s,snap(10),[entries(10)[0],{poolId:'solana:pool',arm:arms[1].id,error:'Empty bin'}],time(10));assert.equal(partial.positions.length,1);assert.ok(partial.events.some(e=>e.message==='Empty bin'));close(partial.portfolios[arms[1].id].cashSol,1);
let missing=advance(seeded,snap(15),[],time(15));for(const a of arms){assert.equal(labEquity(missing,a.id,time(15)),null);assert.equal(labCanEnter(missing,a.id,time(15)),false);}assert.ok(labSummary(missing,time(15)).positions.every(p=>p.pnlSol===null));
const corrupt=advance(seeded,snap(15),reads(seeded,15,{conversionCostSol:Infinity}),time(15));assert.ok(corrupt.positions.every(p=>p.issue));
let stopped=controlLab(seeded,'stop',time(11));assert.equal(stopped.runState,'stopping');
stopped=advance(stopped,snap(15),reads(stopped,15,{liquidationSol:null,conversionCostSol:null}),time(15));assert.equal(stopped.positions.length,3);assert.ok(stopped.positions.every(p=>p.pendingExit));
stopped=advance(stopped,snap(20),reads(stopped,20),time(20));assert.equal(stopped.positions.length,0);assert.equal(stopped.runState,'stopped');assert.equal(stopped.closed.length,3);for(const a of arms){close(stopped.portfolios[a.id].cashSol,.9998);close(stopped.portfolios[a.id].realizedPnlSol,-.0002);}
assert.equal(advance(stopped,snap(20),[],time(20)).closed.length,3);
assert.ok(controlLab(controlLab(seeded,'stop'),'resume').positions.every(p=>p.pendingExit),'resume never cancels a requested exit');
const paused=controlLab(seeded,'pause');assert.equal(labCanEnter(paused,arms[0].id,time(10)),false);assert.equal(advance(paused,snap(15),reads(paused,15,{liquidationSol:.15}),time(15)).closed.length,3,'pause leaves risk exits active');
let held=seeded;for(let m=15;m<=45;m+=5)held=advance(held,snap(m),reads(held,m),time(m));assert.equal(held.positions.length,3,'waiting below entry has no baseline out-of-range exit');
let range=advance(seeded,snap(15),reads(seeded,15,{inRange:true,waiting:false}),time(15));range=advance(range,snap(20),reads(range,20,{inRange:true,waiting:false}),time(20));assert.equal(range.positions[0].observedInRangeMs,300000);range=advance(range,snap(40),reads(range,40,{inRange:true,waiting:false}),time(40));assert.equal(range.positions[0].observedInRangeMs,300000,'unknown gap is not counted in range');
const latch=structuredClone(seeded);latch.portfolios[arms[0].id].peakSol=2;const latched=advance(latch,snap(15),reads(latch,15),time(15));assert.equal(latched.portfolios[arms[0].id].halted,true);assert.equal(latched.portfolios[arms[1].id].halted,false);assert.equal(controlLab(latched,'resume').portfolios[arms[0].id].halted,true);
const cap={...initialLabState(),day:at(0).slice(0,10)};cap.portfolios[arms[0].id].entriesToday=24;assert.equal(labCanEnter(cap,arms[0].id,now),false);assert.equal(labCanEnter(cap,arms[0].id,now+86400000),true);
const {RangeInbox}=await import(pathToFileURL(join(dir,'inbox.mjs')));
const data=new Map();const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>{const records=typeof k==='string'?{[k]:v}:k;for(const [a,b]of Object.entries(records)){assert.ok(Buffer.byteLength(JSON.stringify(b))<128*1024,'DO value under 128 KiB');data.set(a,structuredClone(b));}},list:async(o={})=>new Map([...data].filter(([k])=>(!o.prefix||k.startsWith(o.prefix))&&(!o.startAfter||k>o.startAfter)&&(!o.end||k<o.end)).sort(([a],[b])=>a.localeCompare(b)).slice(0,o.limit??Infinity)),delete:async keys=>keys.reduce((n,k)=>n+Number(data.delete(k)),0)};
const inbox=new RangeInbox({storage,blockConcurrencyWhile:fn=>fn()});const send=body=>inbox.fetch(new Request('https://internal/lab',{method:'POST',body:JSON.stringify(body)}));
data.set('paper',{baseline:'unchanged'});
const ready=advance(advance(initialLabState(),snap(-10),[],time(-10)),snap(-5),[],time(-5));await storage.put(labRecords(ready));
assert.equal((await send({expectedRevision:ready.revision,snapshot:snap(0),reads:entries(0)})).status,200);
assert.equal((await send({expectedRevision:ready.revision,snapshot:snap(0),reads:entries(0)})).status,409);
assert.equal(data.get('lab').positions[0].model.shares.length,0);assert.equal((await loadLab(storage)).positions[0].model.shares.length,1);assert.equal(data.get('paper').baseline,'unchanged');
const archiveScan=[...data].find(([k])=>k.startsWith('lab-scan:'))[1];assert.ok(archiveScan.reads[0].entry.modelRef);assert.equal(archiveScan.reads[0].entry.model,undefined);
await inbox.fetch(new Request('https://internal/lab/control',{method:'POST',body:JSON.stringify({action:'stop'})}));const before=await loadLab(storage);before.lastScanAt=at(-10);for(const p of before.positions)p.mark.at=at(-10);await storage.put(labRecords(before));
await send({expectedRevision:before.revision,snapshot:snap(0),reads:reads(before,0)});assert.equal([...data.keys()].filter(k=>k.startsWith('lab-trade:')).length,3);assert.equal((await loadLab(storage)).runState,'stopped');
const wide=structuredClone(seeded);wide.positions.push(...seeded.positions.map(p=>({...p,id:p.id+'second'})),...seeded.positions.map((p,i)=>({...p,id:p.id+'style',arm:allArms[i+3].id})));for(const p of wide.positions)p.model.shares=Array.from({length:256},(_,id)=>({id,share:'9'.repeat(50),feeX:'9'.repeat(60),feeY:'9'.repeat(60)}));await storage.put(labRecords(wide));assert.equal((await loadLab(storage)).positions.length,9);
data.delete('lab-model:'+wide.positions[0].id);await assert.rejects(()=>loadLab(storage),/retained/);
for(const f of ['src/paper-lab.ts','src/paper-lab-runner.ts','execution/paper-lab-reader.ts'])assert.doesNotMatch(await readFile(f,'utf8'),/sendRawTransaction|sendTransaction|Keypair|request_wallet_sign/);
console.log('PASS lab: ranges, integer taxes, isolated budgets, cohorts, stale reads, limits, exits, cadence, storage/CAS and archives');
// Exercise the real allocation/fee SDK with deterministic pool reads. No RPC.
const require=createRequire(import.meta.url),sdkPath=resolve('execution/node_modules/@meteora-ag/dlmm/dist/index.js');
const sdk=require(sdkPath),spl=require(resolve('execution/node_modules/@solana/spl-token/lib/cjs/index.js'));
const {PublicKey}=require(resolve('execution/node_modules/@solana/web3.js')),BN=require(resolve('execution/node_modules/bn.js'));
const readerPath=join(dir,'reader.cjs');
await build({entryPoints:['execution/paper-lab-reader.ts'],bundle:true,platform:'node',format:'cjs',outfile:readerPath,plugins:[{name:'fixture-pool',setup(b){b.onResolve({filter:/^@meteora-ag\/dlmm$/},()=>({path:'fixture-sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import * as sdk from ${JSON.stringify(sdkPath)};export const {getQPriceFromId,toAmountsBothSideByStrategy,StrategyType}=sdk;export default {create:async()=>globalThis.__labPool};`,loader:'js',resolveDir:process.cwd()}));}}]});
const {readLabPool}=require(readerPath),q64=1n<<64n,mintKey=new PublicKey('AGi2s9zPRPHs3zEDPhPTroumTEXK5ufymYSfEFndCSSW');
const feeConfig={transferFeeConfigAuthority:PublicKey.default,withdrawWithheldAuthority:PublicKey.default,withheldAmount:0n,olderTransferFee:{epoch:0n,maximumFee:100000000000n,transferFeeBasisPoints:300},newerTransferFee:{epoch:1001n,maximumFee:100000000000n,transferFeeBasisPoints:500}};
const tlv=Buffer.alloc(4+spl.TransferFeeConfigLayout.span);tlv.writeUInt16LE(spl.ExtensionType.TransferFeeConfig,0);tlv.writeUInt16LE(spl.TransferFeeConfigLayout.span,2);spl.TransferFeeConfigLayout.encode(feeConfig,tlv.subarray(4));
const mint={address:mintKey,mintAuthority:null,freezeAuthority:null,decimals:9,supply:1000000000000n,isInitialized:true,tlvData:tlv};
const nativeMint={...mint,address:spl.NATIVE_MINT,tlvData:Buffer.alloc(0)};
for(const epoch of [1000n,1001n])for(const raw of [0n,1n,101n,100000000000000n]){const f=spl.getEpochFee(feeConfig,epoch);assert.equal(transferNet(raw,f.transferFeeBasisPoints,f.maximumFee).fee,spl.calculateFee(f,raw));}
let swapInputs=[],arrayReads=0,mode='native';
const fake={lbPair:{tokenXMint:mintKey,tokenYMint:spl.NATIVE_MINT,activeId:0,binStep:100},tokenX:{owner:spl.TOKEN_2022_PROGRAM_ID,mint},tokenY:{owner:spl.TOKEN_PROGRAM_ID,mint:nativeMint},clock:{epoch:new BN(1000)},getActiveBin:async()=>({binId:fake.lbPair.activeId,pricePerToken:'1',xAmount:new BN(0),yAmount:new BN(10000000000)}),getBinsBetweenLowerAndUpperBound:async(lo,hi)=>({bins:Array.from({length:hi-lo+1},(_,i)=>({binId:lo+i,xAmount:new BN(mode==='native'?0:10000000000),yAmount:new BN(mode==='native'?10000000000:0),supply:new BN((10000000000n*q64).toString()),feeAmountXPerTokenStored:new BN(mode==='native'?0:q64/100n),feeAmountYPerTokenStored:new BN(0),pricePerToken:'1'}))}),getBinArrayForSwap:async()=>{arrayReads++;return [];},swapQuote:(input,dir,slippage)=>{assert.equal(dir,true);assert.equal(slippage.toNumber(),100);swapInputs.push(input.toString());const afterSwapTax=sdk.calculateTransferFeeExcludedAmount(input,mint,fake.clock.epoch.toNumber()).amount;return {consumedInAmount:input,minOutAmount:afterSwapTax.muln(99).divn(100)};}};
globalThis.__labPool=fake;
const realPool={...pool(0),address:SOL,base:{address:mintKey.toBase58(),symbol:'A'},quote:{address:SOL,symbol:'SOL'}};
const allocations=await readLabPool(realPool,'https://unused.invalid',[],arms.map(a=>a.id),at(0));assert.ok(allocations.every(r=>r.entry),JSON.stringify(allocations.map(r=>r.error)));assert.deepEqual(allocations.map(r=>r.entry.model.shares.length),[70,70,162]);assert.equal(arrayReads,0,'SOL-only initial exit needs no swap quote');
const bids=allocations[1].entry.model.shares;assert.ok(BigInt(bids[0].share)>BigInt(bids.at(-1).share),'Bid-Ask weights deeper bids more heavily');
const spots=allocations[0].entry.model.shares;assert.equal(spots[0].share,spots.at(-1).share,'Spot distributes SOL evenly in these bins');
const launchAllocations=await readLabPool(realPool,'https://unused.invalid',[],['launch-scalp','launch-bidask'],at(0));
assert.ok(launchAllocations.every(r=>r.entry),JSON.stringify(launchAllocations.map(r=>r.error)));
assert.deepEqual(launchAllocations.map(r=>r.entry.model.shares.length),[21,154]);
for(const r of launchAllocations){assert.ok(r.entry.bidStartSol<=r.entry.entryReferenceSol*.92);assert.ok(r.entry.bidEndSol<r.entry.bidStartSol);assert.equal(r.entry.mark.waiting,true);}
mode='token';fake.lbPair.activeId=-200;const marked=await readLabPool(realPool,'https://unused.invalid',allocations.map(r=>r.entry));assert.ok(marked.every(r=>r.mark),JSON.stringify(marked.map(r=>r.error)));assert.equal(arrayReads,1,'three arms share one exit bin-array read');assert.equal(swapInputs.length,3);
for(const r of marked){assert.ok(r.mark.withdrawTaxSol>0);assert.ok(r.mark.feesSol>0);assert.ok(r.mark.liquidationSol<r.mark.grossSol-r.mark.withdrawTaxSol);assert.equal(r.mark.transferFees[0].bps,300);assert.equal(r.mark.waiting,false);}
fake.clock.epoch=new BN(1001);const higherTax=await readLabPool(realPool,'https://unused.invalid',[allocations[0].entry]);assert.equal(higherTax[0].mark.transferFees[0].bps,500);assert.ok(higherTax[0].mark.liquidationSol<marked[0].mark.liquidationSol,'new epoch tax applies to the future exit');
const savedQuote=fake.swapQuote;fake.swapQuote=()=>{throw Error('No exit liquidity');};const noQuote=await readLabPool(realPool,'https://unused.invalid',[allocations[0].entry]);assert.equal(noQuote[0].mark.liquidationSol,null);assert.match(noQuote[0].mark.issue,/No exit liquidity/);fake.swapQuote=savedQuote;
fake.tokenX.mint={...mint,mintAuthority:mintKey};assert.match((await readLabPool(realPool,'https://unused.invalid',[],[arms[0].id]))[0].error,/authority/);
fake.tokenX.mint={...mint,tlvData:Buffer.from([spl.ExtensionType.PermanentDelegate,0,0,0])};assert.match((await readLabPool(realPool,'https://unused.invalid',[],[arms[0].id]))[0].error,/extension/);
// Supported SOL-X orientation builds above raw active ID, still below token/SOL price.
fake.tokenX={owner:spl.TOKEN_PROGRAM_ID,mint:nativeMint};fake.tokenY={owner:spl.TOKEN_PROGRAM_ID,mint:{...mint,tlvData:Buffer.alloc(0)}};fake.lbPair.tokenXMint=spl.NATIVE_MINT;fake.lbPair.tokenYMint=mintKey;fake.lbPair.activeId=0;fake.clock.epoch=new BN(1000);
const inverted=await readLabPool({...realPool,base:{address:SOL,symbol:'SOL'},quote:{address:mintKey.toBase58(),symbol:'A'}},'https://unused.invalid',[],[arms[0].id]);assert.ok(inverted[0].entry,inverted[0].error);assert.equal(inverted[0].entry.model.lowerBin,1);assert.equal(inverted[0].entry.mark.waiting,true);
const inverseLaunch=await readLabPool({...realPool,base:{address:SOL,symbol:'SOL'},quote:{address:mintKey.toBase58(),symbol:'A'}},'https://unused.invalid',[],['launch-scalp']);assert.ok(inverseLaunch[0].entry,inverseLaunch[0].error);assert.equal(inverseLaunch[0].entry.model.lowerBin,9);assert.ok(inverseLaunch[0].entry.bidStartSol<=.92);
delete globalThis.__labPool;
console.log('PASS reader: SDK allocations, SOL orientation, withdrawal/claim + swap taxes, epochs, shared reads, extension exclusions and failed quotes');

// UI renders separately, escapes source text and refreshes only stored summaries.
const elements=new Map(),handlers=new Map(),nodes=arms.map(a=>({dataset:{labAction:a.id},addEventListener(){},setAttribute(){}}));
const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,addEventListener:(event,fn)=>handlers.set(id+':'+event,fn)});return elements.get(id);};
const uiState=structuredClone(labSummary(seeded,time(10)));uiState.positions[0].pool.pair='<img src=x onerror=alert(1)>';let requests=[];
const context={document:{querySelector:el,querySelectorAll:()=>nodes,hidden:false},fetch:async(url)=>{requests.push(url);return {ok:true,json:async()=>uiState};},localStorage:{getItem:()=>''},setInterval:()=>{},AbortSignal,Date,console};
vm.runInNewContext(await readFile('public/paper-lab.js','utf8'),context);await new Promise(r=>setTimeout(r,10));assert.equal(requests[0],'/api/paper-lab');assert.match(el('#labArms').innerHTML,/Spot · down 50%/);assert.match(el('#labArms').innerHTML,/Bid-Ask · down 80%/);assert.match(el('#labArms').innerHTML,/&lt;img/);assert.doesNotMatch(el('#labArms').innerHTML,/<img/);assert.match(el('#labArms').innerHTML,/Waiting for a pullback/);assert.equal(elements.has('#botMetrics'),false,'lab does not replace baseline view');
console.log('PASS UI: separate balances, escaped pool names, waiting state and read-only refresh');
await mkdir('validation',{recursive:true});
await writeFile('validation/paper-lab-test-summary.txt','Paper lab regression checks passed: state, storage, SDK reader lifecycle and UI.\n');

await writeFile('validation/paper-lab-ui-fixture.json',JSON.stringify(labSummary(seeded,time(10)),null,2));

// v1 migration keeps the two prior matching bids and all outcomes, while allowing 202-bin reads.
{
 const prior=structuredClone(seeded);prior.version='downside-lab-v1';prior.ruleChanges=[];prior.lastScanAt=at(-5);
 for(const p of prior.positions){delete p.experiment;p.mark.at=at(-5);}
 prior.portfolios[arms[0].id].entriesToday=12;prior.portfolios[arms[0].id].halted=true;
 const changed=advance(prior,snap(0),reads(prior,0),time(0));
 assert.equal(changed.version,R.version);assert.equal(changed.ruleChanges[0].fromDailyLimit,12);assert.equal(changed.ruleChanges[0].toDailyLimit,24);
 assert.equal(changed.ruleChanges[0].fromMaxBins,200);assert.equal(changed.ruleChanges[0].toMaxBins,256);
 assert.equal(changed.positions.length,3);assert.ok(changed.positions.every(p=>p.experiment==='downside-lab-v1'));
 assert.equal(changed.portfolios[arms[0].id].entriesToday,12);assert.equal(changed.portfolios[arms[0].id].halted,true);
 assert.equal(changed.portfolios[arms[0].id].cashSol,prior.portfolios[arms[0].id].cashSol);
 assert.equal(advance(changed,snap(5),reads(changed,5),time(5)).ruleChanges.length,1);
 const r=downsideBins(0,80,.8,false);assert.equal(r.upper-r.lower+1,202);
 await storage.put(labRecords(prior));await send({expectedRevision:prior.revision,snapshot:snap(0),reads:reads(prior,0)});
 assert.equal(data.get('lab-baseline:downside-lab-v1').state.positions.length,3);assert.equal(data.get('lab').version,R.version);
 assert.match(el('#homeLab').innerHTML,/PAPER EXPERIMENTS/);assert.match(el('#homeLab').innerHTML,/Compare styles/);
 console.log('PASS: lab cap/bin migration preserves open models, balances, latches, counters and archived v1');
}

// Independent launch/longer policies, exact offsets and state-preserving v2 migration.
{
  assert.equal(allArms.length,9);assert.equal(labPolicy('launch-scalp').maxOpen,1);
  for(const solX of [true,false])for(const down of [.25,.8]){
    const b=downsideBins(17,100,down,solX,.08),near=solX?b.lower-17:17-b.upper,far=solX?b.upper-17:17-b.lower;
    assert.ok(1.01**(-near)<=.92&&1.01**(-(near-1))>.92,'near bid starts at least 8% below reference');
    assert.ok(1.01**(-far)<=1-down&&1.01**(-(far-1))>1-down,'far edge rounds one bin outwards');
  }
  assert.throws(()=>downsideBins(0,100,.25,false,.25),/Invalid/);
  const launchSnap=m=>snap(m,{ageHours:.25});
  const readyLaunch=advance(initialLabState(),launchSnap(0),[],time(0));
  const plan=labPlan(readyLaunch,launchSnap(5),time(5));
  assert.deepEqual(plan.allowedArms['solana:pool'],['launch-scalp','launch-bidask']);
  assert.equal(labPlan(readyLaunch,{...launchSnap(5),pools:[{...launchSnap(5).pools[0],fetchedAt:at(0)}]},time(5)).eligible.length,0,'reusing a launch read is not a second check');
  for(const change of [{ageHours:.07},{ageHours:2.1},{tvlUsd:9999},{activity:{fees1h:1500,volume30m:9999}}])assert.equal(labPlan(readyLaunch,snap(5,change),time(5)).allowedArms['solana:pool']?.includes('launch-scalp')||false,false);
  const makeLaunch=m=>['launch-scalp','launch-bidask'].map(arm=>({poolId:'solana:pool',arm,entry:{...entry(m,arm),pool:launchSnap(m).pools[0]}}));
  const launches=advance(readyLaunch,launchSnap(5),[...makeLaunch(5),entries(5)[0]],time(5));
  assert.deepEqual(launches.positions.map(p=>p.arm),['launch-scalp','launch-bidask'],'a range entry cannot bypass launch-only eligibility');
  assert.equal(labCanEnter(launches,'launch-scalp',time(5)),false);assert.equal(labCanEnter(launches,'spot-down50',time(5)),true);
  const waiting=advance(launches,launchSnap(25),reads(launches,25),time(25));
  assert.equal(waiting.closed[0].reason,'No observed fill after 20 minutes');assert.equal(waiting.positions.length,1);
  const noFill=advance(waiting,launchSnap(35),reads(waiting,35),time(35));assert.equal(noFill.closed[1].reason,'No observed fill after 30 minutes');
  let filled=advance(launches,launchSnap(10),reads(launches,10,{inRange:true,waiting:false}),time(10));
  filled=advance(filled,launchSnap(25),reads(filled,25),time(25));assert.equal(filled.positions.length,2,'observed fill latches even when price returns above bids');
  filled=advance(filled,launchSnap(50),reads(filled,50),time(50));assert.equal(filled.closed[0].reason,'45-minute holding limit');assert.equal(filled.positions[0].arm,'launch-bidask');
  const loss=advance(launches,launchSnap(10),reads(launches,10,{liquidationSol:.18}),time(10));assert.equal(loss.closed.length,1);assert.equal(loss.closed[0].arm,'launch-scalp');assert.match(loss.closed[0].reason,/8%/);
  const profit=advance(launches,launchSnap(10),reads(launches,10,{principalSol:.214,grossSol:.214,liquidationSol:.2139}),time(10));assert.equal(profit.closed.length,1);assert.match(profit.closed[0].reason,/5%/);
  const unknown=controlLab(launches,'pause');const unquoted=advance(unknown,launchSnap(25),reads(unknown,25,{liquidationSol:null,conversionCostSol:null}),time(25));assert.equal(unquoted.closed.length,0);assert.match(unquoted.positions[0].pendingExit,/No observed fill/);
  const mature=m=>snap(m,{ageHours:200,tvlUsd:200000,activity:{fees1h:200,volume30m:20000}});
  let longReady=initialLabState();for(const m of [0,5])longReady=advance(longReady,mature(m),[],time(m));
  assert.deepEqual(labPlan(longReady,mature(10),time(10)).allowedArms['solana:pool'],['longer-spot']);
  assert.equal(labPlan(longReady,snap(10,{...mature(10).pools[0],ageHours:167}),time(10)).eligible.length,0);
  assert.equal(labPlan(longReady,snap(10,{...mature(10).pools[0],tvlUsd:99999}),time(10)).eligible.length,0);
  let long=advance(longReady,mature(10),[{poolId:'solana:pool',arm:'longer-spot',entry:{...entry(10,'longer-spot'),pool:mature(10).pools[0]}}],time(10));
  long=advance(long,mature(490),reads(long,490),time(490));assert.equal(long.positions.length,1,'longer style retains its own 48h horizon');
  long=advance(long,mature(2890),reads(long,2890),time(2890));assert.equal(long.closed[0].reason,'48-hour holding limit');
  const prior=structuredClone(seeded);prior.version='downside-lab-v2';prior.ruleChanges=[];
  for(const a of allArms.filter(a=>a.group!=='range'))delete prior.portfolios[a.id];
  for(const p of prior.positions)p.experiment='downside-lab-v2';
  prior.portfolios[arms[0].id].halted=true;prior.portfolios[arms[0].id].entriesToday=20;
  const oldJson=JSON.stringify(prior),summary=labSummary(prior,time(10));assert.equal(summary.arms.length,9);assert.equal(JSON.stringify(prior),oldJson,'pre-migration summary cannot mutate archived state');
  const migrated=advance(prior,snap(15),reads(prior,15),time(15));assert.equal(migrated.version,R.version);assert.deepEqual(migrated.ruleChanges[0].profilesAdded,['launch-scalp','launch-bidask','longer-spot','scalp-v4','hold-v4','pullback-v4']);
  for(const a of arms){assert.equal(migrated.portfolios[a.id].cashSol,prior.portfolios[a.id].cashSol);assert.equal(migrated.portfolios[a.id].entriesToday,prior.portfolios[a.id].entriesToday);assert.equal(migrated.portfolios[a.id].halted,prior.portfolios[a.id].halted);}
  for(const a of allArms.filter(a=>a.group!=='range'))assert.equal(migrated.portfolios[a.id].cashSol,1);
  assert.ok(migrated.positions.every(p=>p.experiment==='downside-lab-v2'));
  const failed=advance(readyLaunch,launchSnap(5),[{poolId:'solana:pool',arm:'launch-scalp',error:'Empty target bin'}],time(5));
  assert.deepEqual(labPlan(failed,launchSnap(10),time(10)).allowedArms['solana:pool'],['launch-bidask'],'one failed profile does not starve another');
  const cooled=structuredClone(readyLaunch);cooled.cooldowns['launch-scalp:mintA']=time(60);
  assert.deepEqual(labPlan(cooled,launchSnap(5),time(5)).allowedArms['solana:pool'],['launch-bidask']);
  assert.match(el('#labArms').innerHTML,/Launch scalp/);assert.match(el('#labArms').innerHTML,/Longer hold/);assert.match(el('#homeLab').innerHTML,/trials today/);
  // Populate only a local preview fixture. No live journal writes or artificial scheduled fills.
  await writeFile('validation/paper-styles-ui-fixture.json',JSON.stringify(labSummary({...launches,positions:[...seeded.positions,...launches.positions]},time(5)),null,2));
  console.log('PASS styles: 8% offsets, group filters, separate loss/profit/hold/no-fill exits, cooldowns and v2 migration');
}

// Archived runner drains all held cohorts and opens no further positions.
{
 const runPath=join(dir,'runner.mjs');
 await build({entryPoints:['src/paper-lab-runner.ts'],bundle:true,platform:'node',format:'esm',outfile:runPath,plugins:[{name:'fixture-reader',setup(b){b.onResolve({filter:/paper-lab-reader$/},()=>({path:'reader',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const readLabPool=(...args)=>globalThis.__readLab(...args);',loader:'js'}));}}]});
 const {runPaperLab}=await import(pathToFileURL(runPath));
 const state=structuredClone(seeded);state.lastScanAt=at(-5);state.day=at(0).slice(0,10);
 state.positions.push(...seeded.positions.map(p=>({...p,id:p.id+'second',cohort:'second:'+at(-10),pool:{...p.pool,id:'second',address:'second'},mint:'secondMint'})));
 state.memory['launch:solana:launch']={at:at(-5),streak:1};
 for(const p of state.positions)p.mark.at=at(-5);
 const fresh={updatedAt:at(0),pools:[{...pool(0),id:'solana:launch',address:'launch',pair:'LAUNCH/SOL',base:{address:'newMint',symbol:'LAUNCH'},ageHours:.25}],errors:{}};
 let calls=[],commits=[];globalThis.__readLab=async(p,rpc,existing=[],newArms=[])=>{calls.push({pool:p.id,existing:existing.length,newArms});return existing.map(p=>({poolId:p.pool.id,arm:p.arm,positionId:p.id,mark:mark(0)}));};
 const ns={idFromName:n=>n,get:()=>({fetch:async(url,init)=>init?(commits.push(JSON.parse(init.body)),new Response('{}')):Response.json(state)})};
 await runPaperLab(ns,fresh,'https://unused.invalid');
 assert.equal(calls.filter(c=>c.existing).length,2,'held cohorts share reads internally');assert.equal(calls.filter(c=>c.newArms.length).length,0);assert.equal(commits[0].archiveEntries,true);assert.equal(commits[0].expectedRevision,state.revision);
 // A third cohort of the same pool stays separate; anchoring at a later price does not inflate a union bin read.
 calls=[];state.positions.push({...state.positions[0],id:'third',cohort:'third',arm:'longer-spot'});
 await runPaperLab(ns,fresh,'https://unused.invalid');assert.equal(calls.filter(c=>c.existing).length,3);
 calls=[];state.portfolios['launch-scalp'].entriesToday=24;state.portfolios['launch-bidask'].entriesToday=24;
 await runPaperLab(ns,fresh,'https://unused.invalid');assert.equal(calls.filter(c=>c.newArms.length).length,0);
 delete globalThis.__readLab;
 console.log('PASS runner: independent capacity, cohort-specific reads, bounded candidate selection and daily limits');
}

// Regression: an unusable mark must not stop known paper deadlines from queuing an exit.
{
 const state=initialLabState(),p=entry(0,'launch-scalp');state.positions=[p];state.lastScanAt=at(0);state.day=at(0).slice(0,10);state.portfolios['launch-scalp'].cashSol=.6999;state.portfolios['launch-scalp'].entriesToday=1;
 const failure=m=>[{poolId:p.pool.id,arm:p.arm,positionId:p.id,error:'Liquidity changed beyond the small-share model'}];
 const beforeDeadline=advance(state,snap(15),failure(15),time(15));assert.equal(beforeDeadline.positions[0].pendingExit,null);
 for(const badReads of [[],failure(20),reads(state,20,{conversionCostSol:Infinity}),reads(state,0)]){
   const expired=advance(state,snap(20),badReads,time(20));
   assert.equal(expired.positions[0].pendingExit,'No observed fill after 20 minutes','clock deadline survives missing/error/invalid/regressed marks');
   assert.equal(expired.closed.length,0);assert.equal(expired.portfolios['launch-scalp'].cashSol,.6999);assert.equal(labSummary(expired,time(20)).positions[0].pnlSol,null);
   const stillMissing=advance(expired,snap(25),failure(25),time(25));assert.equal(stillMissing.positions[0].pendingExit,expired.positions[0].pendingExit);
   const recovered=advance(stillMissing,snap(30),reads(stillMissing,30,{inRange:true,waiting:false}),time(30));
   assert.equal(recovered.positions.length,0);assert.equal(recovered.closed.length,1);assert.equal(recovered.closed[0].reason,expired.positions[0].pendingExit);close(recovered.portfolios['launch-scalp'].cashSol,.9998);
 }
 const observed=structuredClone(state);observed.positions[0].fillObserved=true;
 assert.equal(advance(observed,snap(25),failure(25),time(25)).positions[0].pendingExit,null,'previously observed fill avoids no-fill expiry');
 assert.equal(advance(observed,snap(45),failure(45),time(45)).positions[0].pendingExit,'45-minute holding limit');
 const freshFill=advance(state,snap(20),reads(state,20,{inRange:true,waiting:false}),time(20));assert.equal(freshFill.positions[0].pendingExit,null,'fresh fill is considered before no-fill deadline');
 assert.equal(advance(state,snap(20),failure(20),time(40)),state,'stale overall observations cannot invent a deadline observation');
 console.log('PASS lab deadlines: queued through missing accounting, unchanged cash/unknown P&L, latched reason and quote-gated recovery');
}

// Production v4: independent samples cannot consume/refund legacy cash or hide model failures.
{
 const initial=productionInitialState();
 assert.deepEqual(initial.entryProfiles,['scalp-v4','hold-v4','pullback-v4']);
 assert.equal(labCanEnter(initial,'launch-scalp',time(0)),false);
 assert.equal(labCanEnter(initial,'scalp-v4',time(0)),true);
 assert.equal(labEquity(initial,'scalp-v4',time(0)),null,'samples do not masquerade as compounded wallets');
 const launch=m=>snap(m,{ageHours:.25});
 let sample=advance(initial,launch(0),[],time(0));
 sample=advance(sample,launch(5),[{poolId:'solana:pool',arm:'scalp-v4',entry:{...entry(5,'scalp-v4'),pool:launch(5).pools[0]}}],time(5));
 assert.equal(sample.positions.length,1);assert.equal(sample.portfolios['scalp-v4'].entriesToday,1);
 assert.equal(sample.portfolios['scalp-v4'].cashSol,initial.portfolios['scalp-v4'].cashSol,'sample does not debit a simulated-wallet balance');
 const failures=m=>sample.positions.map(p=>({poolId:p.pool.id,arm:p.arm,positionId:p.id,error:'Liquidity changed beyond the small-share model'}));
 for(const m of [25,30,35])sample=advance(sample,launch(m),failures(m),time(m));
 assert.equal(sample.positions.length,0);assert.equal(sample.closed.length,0);assert.equal(sample.unscorable.length,1);
 assert.equal(sample.unscorable[0].pnlSol,null);assert.equal(sample.portfolios['scalp-v4'].unscorableCount,1);
 assert.equal(sample.portfolios['scalp-v4'].realizedPnlSol,0);assert.equal(sample.portfolios['scalp-v4'].wins,0);
 assert.equal(labCanEnter(sample,'scalp-v4',time(35)),true,'unscorable sample releases an experiment slot, not money');
 assert.equal(labPlan(sample,launch(40),time(40)).eligible.length,0,'failed token has 24h cooldown');
 let transient=advance(initial,launch(0),[],time(0));
 transient=advance(transient,launch(5),[{poolId:'solana:pool',arm:'scalp-v4',entry:{...entry(5,'scalp-v4'),pool:launch(5).pools[0]}}],time(5));
 transient=advance(transient,launch(25),reads(transient,25,{liquidationSol:null}),time(25));
 assert.equal(transient.unscorable.length,0,'rate limits do not instantly count as failed models');
 transient=advance(transient,launch(30),reads(transient,30),time(30));
 assert.equal(transient.closed.length,1,'recovered quote can close at its real estimate');
 const legacy=structuredClone(seeded);legacy.version='paper-styles-v3';
 const migrated=advance(legacy,snap(15),reads(legacy,15),time(15));
 assert.deepEqual(migrated.entryProfiles,initial.entryProfiles);
 assert.equal(migrated.portfolios['spot-down50'].cashSol,legacy.portfolios['spot-down50'].cashSol);
 assert.equal(migrated.positions.length,legacy.positions.length);
 assert.equal(labCanEnter(migrated,'spot-down50',time(15)),false);
 assert.equal(labPolicy('hold-v4').maxHoldHours,48);assert.equal(labPolicy('scalp-v4').maxHoldHours,.75);assert.equal(labPolicy('pullback-v4').maxHoldHours,8);
 assert.equal(labPolicy('hold-v4').minAgeHours,168);assert.equal(labPolicy('pullback-v4').minAgeHours,4);
 console.log('PASS v4: prospective profiles, independent sample accounting, recorded unscorable outcomes, recovery, cooldowns and legacy preservation');
}
// Failed experiments and their bin models survive removal from the active list.
{
 const s=productionInitialState();s.revision=7;s.lastScanAt=at(-5);
 const p=entry(-45,'scalp-v4');p.issue='Liquidity changed beyond the small-share model';p.issueSince=at(-15);p.structuralFailures=2;p.pendingExit='No observed fill after 20 minutes';
 s.positions=[p];await storage.put(labRecords(s));
 const r=await send({expectedRevision:7,snapshot:snap(0),reads:[{poolId:p.pool.id,arm:p.arm,positionId:p.id,error:p.issue}]});assert.equal(r.status,200);
 assert.equal(data.get('lab').positions.length,0);assert.equal(data.get('lab').closed.length,0);
 assert.ok(data.has('lab-model:'+p.id),'immutable bin model is retained');
 const result=await inbox.fetch(new Request('https://internal/lab/unscorable')).then(r=>r.json());
 assert.equal(result.records.length,1);assert.equal(result.records[0].id,p.id);assert.equal(result.records[0].pnlSol,null);
 assert.equal(data.get('lab').portfolios['scalp-v4'].unscorableCount,1);
 assert.equal((await send({expectedRevision:7,snapshot:snap(0),reads:[]})).status,409,'stale scan cannot double-count a failure');
 console.log('PASS: permanent unscorable archive, preserved bin models and atomic duplicate suppression');
}
