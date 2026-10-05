import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'pat-paper-'));
for(const [name,entry] of [['bot','src/paper-bot.ts'],['model','src/paper-model.ts'],['inbox','src/range-alerts.ts'],['journal','src/paper-journal.ts']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {initialPaperState,advancePaperState:advance,planPaperScan,canEnterPaper,paperEntryGate,paperEquity,paperSummary,controlPaper,SOL_MINT}=await import(pathToFileURL(join(dir,'bot.mjs')));
const {virtualShares,markAmounts,PAPER_RULES:R}=await import(pathToFileURL(join(dir,'model.mjs')));
const now=Date.now(),at=m=>new Date(now+m*60000).toISOString(),time=m=>now+m*60000;
const pool=m=>({id:'solana:pool',address:'pool',chain:'solana',venue:'meteora-dlmm',pair:'A/SOL',base:{address:'mintA',symbol:'A'},quote:{address:SOL_MINT,symbol:'SOL'},tvlUsd:100000,volume24hUsd:100000,priceUsd:1,quotePriceUsd:100,ageHours:48,fetchedAt:at(m),activity:{volume30m:10000,volume1h:14000,fees30m:30}});
const snapshot=(m,changes={})=>({updatedAt:at(m),pools:[{...pool(m),...changes}],errors:{}});
const mark=(m,over={})=>({at:at(m),principalSol:.2,feesSol:.001,grossSol:.201,liquidationSol:.199,conversionCostSol:.0019,networkSol:R.networkSol,inRange:true,priceSol:.01,...over});
const entry=m=>({id:'paper:position',pool:pool(m),mint:'mintA',openedAt:at(m),model:{shares:[],lowerBin:0,upperBin:1},mark:mark(m),investmentSol:R.budgetSol,rentSol:R.rentSol,entryNetworkSol:R.networkSol,entryVolume30m:10000,entryTvl:100000,outSince:null,fadeCount:0,pendingExit:null,issue:null});
let s=initialPaperState();assert.equal(paperEquity(s,now),1);
s=advance(s,snapshot(0),[],time(0));assert.equal(s.candidates[0].streak,1);
assert.equal(advance(s,snapshot(0),[],time(0)),s,'same observation cannot trade twice');
s=advance(s,snapshot(5),[],time(5));assert.equal(s.candidates[0].streak,2);
const seeded=advance(s,snapshot(10),[{poolId:'solana:pool',entry:entry(10)}],time(10));
assert.equal(seeded.positions.length,1);assert.ok(Math.abs(seeded.cashSol-.7399)<1e-10);assert.ok(Math.abs(paperEquity(seeded,time(10))-.9989)<1e-10,'rent stays an asset, costs reduce equity');
assert.equal(planPaperScan(s,snapshot(10,{tvlUsd:1000}),time(10)).eligible.length,0);
assert.equal(planPaperScan(s,snapshot(10,{fetchedAt:at(-10)}),time(10)).eligible.length,0);
assert.equal(planPaperScan(s,snapshot(10,{quote:{address:'fakeSOL',symbol:'SOL'}}),time(10)).eligible.length,0);
assert.equal(planPaperScan(s,snapshot(10,{priceUsd:1.2}),time(10)).eligible.length,0,'price jump resets');
assert.equal(planPaperScan(s,snapshot(30),time(30)).candidates[0].streak,1,'gaps restart confirmation');
assert.equal(planPaperScan(s,snapshot(10,{ageHours:.5}),time(10)).eligible.length,0);
let gap=advance(seeded,snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',error:'RPC unavailable'}],time(15));
assert.equal(paperEquity(gap,time(15)),null);assert.equal(canEnterPaper(gap,time(15)),false);assert.equal(paperSummary(gap,time(15)).pnlSol,null);
let recovered=advance(gap,snapshot(20),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(20)}],time(20));assert.equal(recovered.positions[0].issue,null);
let bad=advance(seeded,snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(15,{feesSol:Infinity})}],time(15));assert.equal(paperEquity(bad,time(15)),null);
let paused=controlPaper(seeded,'pause',time(11));assert.equal(canEnterPaper(paused,time(11)),false);assert.equal(paused.positions.length,1);
let stopped=controlPaper(seeded,'stop',time(11));assert.equal(stopped.runState,'stopping');
stopped=advance(stopped,snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(15,{liquidationSol:null,conversionCostSol:null})}],time(15));assert.equal(stopped.positions.length,1,'no fabricated exit when no quote');assert.equal(stopped.runState,'stopping');
stopped=advance(stopped,snapshot(20),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(20)}],time(20));assert.equal(stopped.runState,'stopped');assert.equal(stopped.positions.length,0);assert.equal(stopped.closedCount,1);assert.ok(Math.abs(stopped.realizedPnlSol+.0011)<1e-10);assert.ok(Math.abs(stopped.cashSol-.9989)<1e-10);
assert.equal(advance(stopped,snapshot(20),[],time(20)).closedCount,1);
assert.equal(controlPaper(stopped,'resume').runState,'running');assert.equal(planPaperScan(stopped,snapshot(25),time(25)).eligible.length,0,'same token cooldown');
let loss=advance(seeded,snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(15,{liquidationSol:.1})}],time(15));assert.equal(loss.closed[0].reason,'Loss limit reached');assert.ok(loss.haltReason);assert.throws(()=>controlPaper(loss,'resume'),/reviewed experiment/);
let out=seeded;for(let m=15;m<=75;m+=5)out=advance(out,snapshot(m),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(m,{inRange:false})}],time(m));assert.equal(out.closed[0].reason,'Out of range for 60 observed minutes');
const q=1n<<64n,b={id:0,x:'1000000',y:'1000000',supply:(2000000n*q).toString(),qPrice:q.toString(),feeX:'0',feeY:'0',price:1};
const shares=virtualShares([b],[{id:0,x:'1000',y:'1000'}]);assert.equal(BigInt(shares[0].share),2000n*q);
const model={shares,solX:false,decX:6,decY:9,mintX:'A',mintY:SOL_MINT,lowerBin:0,upperBin:0};
let amounts=markAmounts(model,[{...b,feeX:q.toString(),feeY:(q*2n).toString()}],.001);
assert.equal(amounts.x,'1000');assert.equal(amounts.y,'1000');assert.equal(amounts.fx,'2000');assert.equal(amounts.fy,'4000');assert.ok(Math.abs(amounts.principalSol-.000002)<1e-15);
assert.throws(()=>virtualShares([{...b,supply:'0'}],[{id:0,x:'1',y:'1'}]),/empty/);
assert.throws(()=>virtualShares([b],[{id:0,x:'20000',y:'20000'}]),/1%/);
assert.throws(()=>markAmounts({...model,shares:[{...shares[0],feeX:'1'}]},[b],1),/reset/);
assert.throws(()=>markAmounts(model,[{...b,supply:'0'}],1),/Liquidity/);
const {RangeInbox}=await import(pathToFileURL(join(dir,'inbox.mjs')));
const data=new Map();const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>{if(typeof k==='string')data.set(k,structuredClone(v));else for(const [a,b]of Object.entries(k))data.set(a,structuredClone(b));},list:async(o={})=>new Map([...data].filter(([k])=>(!o.prefix||k.startsWith(o.prefix))&&(!o.start||k>=o.start)&&(!o.startAfter||k>o.startAfter)&&(!o.end||k<o.end)).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,o.limit??Infinity)),delete:async keys=>keys.reduce((n,k)=>n+Number(data.delete(k)),0)};
const inbox=new RangeInbox({storage,blockConcurrencyWhile:fn=>fn()});
const send=body=>inbox.fetch(new Request('https://internal/bot',{method:'POST',body:JSON.stringify(body)}));
assert.equal((await send({expectedRevision:0,snapshot:snapshot(0),reads:[]})).status,200);
assert.equal((await send({expectedRevision:0,snapshot:snapshot(0),reads:[]})).status,409);
data.set('paper',seeded);
assert.equal((await inbox.fetch(new Request('https://internal/bot/control',{method:'POST',body:JSON.stringify({action:'stop'})}))).status,200);
assert.equal((await send({expectedRevision:seeded.revision,snapshot:snapshot(0),reads:[]})).status,409,'control invalidates in-flight scan');
// Persist an exit using wall-clock-fresh marks; each closed record has a durable archive key.
const before=structuredClone(data.get('paper'));before.lastScanAt=at(-10);before.positions[0].mark.at=at(-10);data.set('paper',before);
await send({expectedRevision:before.revision,snapshot:snapshot(0),reads:[{poolId:'solana:pool',positionId:'paper:position',mark:mark(0)}]});
assert.equal([...data.keys()].filter(k=>k.startsWith('paper-trade:')).length,1);
for(const file of ['src/paper-runner.ts','src/paper-bot.ts','execution/paper-reader.ts'])assert.doesNotMatch(await readFile(file,'utf8'),/sendRawTransaction|sendTransaction|Keypair|request_wallet_sign/,'paper path has no signing or broadcast');
console.log('Paper bot: accounting, fees, cadence, exits, stops, stale data, CAS and archive checks passed');

// Clock expiry must still queue through a broken bin model. It cannot invent
// a fill or use the saved mark, and recovery must honor the original deadline.
{
 const before=structuredClone(seeded);before.lastScanAt=at(-5);before.positions[0].openedAt=at(-1441);before.positions[0].mark=mark(-5);
 const saved=structuredClone(before);
 for(const read of [undefined,{error:'Liquidity changed beyond the small-share model'},{mark:mark(-10)},{mark:mark(0,{feesSol:NaN})}]){
  const expired=advance(before,snapshot(0),read?[{poolId:'solana:pool',positionId:'paper:position',...read}]:[],time(0));
  assert.equal(expired.positions[0].pendingExit,'24-hour holding limit');
  assert.equal(expired.cashSol,before.cashSol);assert.equal(expired.closedCount,before.closedCount);assert.equal(paperEquity(expired,time(0)),null);assert.deepEqual(expired.positions[0].model,before.positions[0].model);assert.deepEqual(expired.positions[0].mark,before.positions[0].mark);
  const recovered=advance(expired,snapshot(5),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(5)}],time(5));
  assert.equal(recovered.positions.length,0);assert.equal(recovered.closed.at(-1).reason,'24-hour holding limit');assert.equal(recovered.closed.at(-1).closedAt,at(5));
 }
 assert.deepEqual(before,saved,'expiry does not mutate prior observations');
 const early=structuredClone(before);early.positions[0].openedAt=at(-1439);
 assert.equal(advance(early,snapshot(0),[],time(0)).positions[0].pendingExit,null,'no early expiry');
 assert.equal(advance(before,snapshot(-20),[],time(0)),before,'a stale overall observation cannot trigger expiry');
 const pending=structuredClone(before);pending.positions[0].pendingExit='Loss limit reached';
 assert.equal(advance(pending,snapshot(0),[],time(0)).positions[0].pendingExit,'Loss limit reached','preserve earlier pending reason');
 console.log('PASS: 24-hour expiry queues through unavailable accounting without fabricated fills, cash or historical mutation');
}

const skipped=advance(s,snapshot(10),[{poolId:'solana:pool',error:'The range needs more than 69 bins'}],time(10));
assert.equal(planPaperScan(skipped,snapshot(15),time(15)).eligible.length,0);
assert.match(planPaperScan(skipped,snapshot(15),time(15)).candidates[0].reason,/15 minutes/);
const unblocked={...skipped,memory:{'solana:pool':{at:at(20),streak:3,price:.01,tvl:100000}}};
assert.equal(planPaperScan(unblocked,snapshot(25),time(25)).eligible.length,1);
console.log('PASS: failed pool checks cool down without starving other eligible ideas');

// A full daily budget explains the wait without changing entry rules or saved outcomes.
const lastMinute=Date.parse('2026-09-07T23:59:59Z');
const capped={...initialPaperState(),day:{date:'2026-09-07',entries:R.maxDailyEntries,realized:-.022398828}};
const preserved=JSON.stringify(capped);
const gate=paperEntryGate(capped,lastMinute);
assert.equal(gate.allowed,false);assert.equal(gate.code,'daily-entry-limit');assert.equal(gate.resetsAt,'2026-09-08T00:00:00.000Z');
assert.equal(paperSummary(capped,lastMinute).entryGate.code,'daily-entry-limit');assert.equal(JSON.stringify(capped),preserved,'summary does not mutate counters or journal');
assert.equal(paperSummary(capped,lastMinute).daily.entries,24);
assert.equal(paperSummary(capped,lastMinute+1000).daily.entries,0);
assert.equal(paperSummary(capped,lastMinute+1000).daily.resetsAt,'2026-09-09T00:00:00.000Z');
assert.equal(JSON.stringify(capped),preserved,'daily display does not reset stored counters');
assert.equal(paperEntryGate(capped,lastMinute+1000).allowed,true,'UTC rollover permits the existing next-day rules');
assert.equal(paperEntryGate({...capped,day:{...capped.day,entries:2,realized:-.05}},lastMinute).code,'daily-loss-limit');
assert.equal(paperEntryGate({...capped,runState:'paused'},lastMinute).code,'paused');
assert.equal(paperEntryGate({...capped,haltReason:'10% paper drawdown reached'},lastMinute).code,'drawdown');
assert.equal(paperEntryGate({...initialPaperState(),cashSol:0},lastMinute).code,'cash-reserve');
assert.equal(paperEntryGate(gap,time(15)).code,'data-unavailable');
const oldDecision=(s,now)=>s.runState==='running'&&!s.haltReason&&s.positions.length<R.maxOpen&&paperEquity(s,now)!=null&&(s.day.date!==new Date(now).toISOString().slice(0,10)||(s.day.entries<R.maxDailyEntries&&s.day.realized>-R.maxDailyLossSol))&&s.cashSol>=R.budgetSol+R.rentSol+R.networkSol+R.reserveSol;
for(const runState of ['running','paused','stopping','stopped'])for(const entries of [0,3,4,12,24,NaN])for(const realized of [0,-.05,-.06,NaN])for(const cashSol of [0,1,NaN]){
 const candidate={...capped,runState,cashSol,day:{...capped.day,entries,realized}};
 assert.equal(canEnterPaper(candidate,lastMinute),oldDecision(candidate,lastMinute),'display refactor preserves the existing entry decision');
}
console.log('PASS: entry-block reasons, daily reset, read-only summary and unchanged strategy decisions');

// Render archived trades as well as the empty-position state; browser error handling
// must not hide a scoped-variable error after partial rendering.
{
 const {runInNewContext}=await import('node:vm');
 const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'',addEventListener(){}});return nodes.get(selector);};
 let view=paperSummary({...capped,lastScanAt:at(0),closed:stopped.closed,closedCount:1},lastMinute);let failRead=false;
 const browser={window:{},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:()=>null},fetch:async()=>{if(failRead)throw Error('Offline');return {ok:true,json:async()=>view};},setInterval(){},Date,AbortSignal,console};
 runInNewContext(await readFile('public/paper-bot.js','utf8'),browser);
 await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(node('#botStatus').textContent,/not defined|unavailable/i);
 assert.match(node('#botStatus').innerHTML,/Daily entry limit reached/);
 assert.match(node('#botPositions').innerHTML,/Daily entry limit reached/);
 assert.match(node('#botClosed').innerHTML,/Paper trial stopped by Pat/);
 assert.match(node('#homeBot').innerHTML,/Daily entry limit reached/);
 assert.match(node('#botStatus').innerHTML,/24 \/ 24 entries today/);
 view=paperSummary(seeded,time(10));await browser.window.loadPatBot();
 assert.match(node('#botPositions').innerHTML,/opened /);
 assert.match(node('#botPositions').innerHTML,/Net P&L/);
 assert.match(node('#botPositions').innerHTML,/of entry budget/);
 assert.match(node('#homeBot').innerHTML,/A\/SOL/);
 const savedCard=node('#botPositions').innerHTML;
 failRead=true;await browser.window.loadPatBot();
 assert.match(node('#botStatus').innerHTML,/Refresh failed · showing saved results/);
 assert.equal(node('#botPositions').innerHTML,savedCard,'failed refresh retains the saved position');
 assert.equal(node('#refreshBot').disabled,false,'refresh is available after failure');
 failRead=false;view=paperSummary(gap,time(15));await browser.window.loadPatBot();
 assert.match(node('#botPositions').innerHTML,/Data unavailable/);
 assert.doesNotMatch(node('#botPositions').innerHTML,/of entry budget/,'unknown P&L is never rendered as zero percent');
 assert.doesNotMatch(node('#botMetrics').innerHTML,/0.0% versus starting SOL/);
 view={...view,lastScanAt:at(0),entryGate:{allowed:false,reason:'Daily entry limit reached'},candidates:[{pair:'ZCAT/SOL',mint:'zcat',address:'pool',streak:3,ratio:2,volume30m:10000,fees30m:100,reason:'Extended-token accounting is outside this paper trial'}],events:[
  {kind:'paper-skip',at:at(-5),message:'Extended-token accounting is outside this paper trial'},
  {kind:'paper-skip',at:at(-10),message:'Extended-token accounting is outside this paper trial'},
  {kind:'paper-skip',at:at(-60),message:'Old rejection must be excluded'},
  {kind:'paper-skip',at:at(5),message:'Future rejection must be excluded'},
  {kind:'paper-entry',at:at(-15),message:'An entry is not a rejected check'},
  {kind:'paper-skip',at:at(-20),message:'<img src=x onerror=alert(1)>'}
 ],skips:{'Volume not sustained':7}};
 const untouched=JSON.stringify(view);await browser.window.loadPatBot();
 assert.match(node('#botWatching').innerHTML,/Token-2022 was excluded by the earlier Active LP version/,'portfolio gates must not hide token incompatibility');
 assert.match(node('#botWatching').innerHTML,/Entries also blocked: Daily entry limit reached/);
 assert.match(node('#botSkips').innerHTML,/3 rejected checks/);
 assert.match(node('#botSkips').innerHTML,/<b>2<\/b> · Token-2022/);
 assert.match(node('#botSkips').innerHTML,/30m volume or acceleration below the entry threshold/);
 assert.match(node('#botSkips').innerHTML,/&lt;img/);
 assert.doesNotMatch(node('#botSkips').innerHTML,/<img|Old rejection|Future rejection|An entry is not/);
 assert.equal(JSON.stringify(view),untouched,'skip explanations do not mutate trading data or historical reasons');
 failRead=true;await browser.window.loadPatBot();
 assert.match(node('#botStatus').innerHTML,/Refresh failed/);
 assert.match(node('#botSkips').innerHTML,/3 rejected checks/,'saved reports stay tied to their saved scan, not a moving current-time window');
 console.log('PASS: daily progress, position returns and recoverable refresh failure render correctly');
}

// User-approved v2 raises only the cap and records the old results without a reset.
{
 const prior={...initialPaperState(),version:'spot-volume-v1',startedAt:at(-10),lastScanAt:at(-5),cashSol:.977601172,closedCount:4,wins:2,losses:2,realizedPnlSol:-.022398828,day:{date:at(0).slice(0,10),entries:4,realized:-.022398828}};
 const updated=advance(prior,snapshot(0),[],time(0));
 assert.equal(updated.version,R.version);assert.equal(updated.cashSol,prior.cashSol);assert.equal(updated.closedCount,4);assert.equal(updated.day.entries,4);assert.equal(updated.realizedPnlSol,prior.realizedPnlSol);
 assert.equal(updated.ruleChanges[0].fromDailyLimit,4);assert.equal(updated.ruleChanges[0].toDailyLimit,24);assert.equal(updated.ruleChanges[0].equitySol,prior.cashSol);assert.equal(updated.events.filter(e=>e.kind==='rule-change').length,1);
 assert.equal(canEnterPaper(updated,time(0)),true);assert.equal(advance(updated,snapshot(5),[],time(5)).ruleChanges.length,1);
 data.set('paper',prior);await send({expectedRevision:prior.revision,snapshot:snapshot(0),reads:[]});
 assert.deepEqual(data.get('paper-baseline:spot-volume-v1').state,prior,'immutable baseline retains the original results and state');
 assert.equal(data.get('paper').version,R.version);
 console.log('PASS: v2 cap increase preserves bankroll, daily count, losses and archived baseline');
}

// Scan research records reuse observations and remain separate from trading state.
{
 const {paperScanRecord,scanKey,SCAN_RETENTION_DAYS}=await import(pathToFileURL(join(dir,'journal.mjs')));
 const catalogue={...snapshot(0),pools:Array.from({length:40},(_,i)=>({...pool(0),id:'solana:'+i,volume24hUsd:i*10000,activity:{...pool(0).activity,volume30m:(40-i)*1000}}))};
 const unchanged=JSON.stringify({seeded,catalogue});
 const record=paperScanRecord(s,seeded,catalogue,[{poolId:'solana:pool',error:'Unsupported token'}],time(10));
 assert.equal(record.markets.length,24,'sample bounded to two sets of twelve');
 assert.equal(new Set(record.markets.map(p=>p.id)).size,24);
 assert.ok(record.markets.some(p=>p.id==='solana:0'));
 assert.ok(record.markets.some(p=>p.id==='solana:39'));
 assert.equal(record.checks[0].result,'failed');
 assert.equal(JSON.stringify({seeded,catalogue}),unchanged,'research does not mutate inputs or trading state');
 assert.equal(paperScanRecord(s,gap,snapshot(15),[],time(15)).equitySol,null,'missing marks remain unknown');
 assert.ok(Buffer.byteLength(JSON.stringify(record))<32000,'compact journal avoids oversized records');
 assert.equal(SCAN_RETENTION_DAYS,8);
 // A successful normal scan saves exactly one record; replay cannot duplicate it.
 data.set('paper',initialPaperState());
 const oldKey='paper-scan:'+new Date(now-9*86400000).toISOString()+':000000000001';
 data.set(oldKey,{expired:true});data.set('paper-trade:old-outcome',{retained:true});
 const scanned=await send({expectedRevision:0,snapshot:snapshot(0),reads:[]});assert.equal(scanned.status,200);
 const stored=data.get('paper'),journalKey=scanKey(stored);
 assert.ok(data.has(journalKey));assert.equal(data.has(oldKey),false);assert.ok(data.has('paper-trade:old-outcome'));
 const keysBefore=[...data.keys()];
 await send({expectedRevision:stored.revision,snapshot:snapshot(0),reads:[]});assert.deepEqual([...data.keys()],keysBefore);
 // A retention-store failure must not report that an already committed scan failed.
 const workingList=storage.list;storage.list=async options=>{if(options.end)throw Error('Cleanup unavailable');return workingList(options);};
 data.set('paper',initialPaperState());
 const cleanupFailure=await send({expectedRevision:0,snapshot:snapshot(0),reads:[]});
 assert.equal(cleanupFailure.status,200);assert.ok(data.has(scanKey(data.get('paper'))));storage.list=workingList;
 // Paginate chronologically, with no gaps or duplicate pages; only scan keys are read.
 for(const k of data.keys())if(k.startsWith('paper-scan:'))data.delete(k);
 const expected=[];
 for(let i=0;i<53;i++){const k='paper-scan:'+new Date(now-3600000+i*1000).toISOString()+':'+String(i).padStart(12,'0');data.set(k,{revision:i});expected.push(i);}
 const first=await (await inbox.fetch(new Request('https://internal/bot/scans'))).json();
 assert.equal(first.scans.length,50);assert.ok(first.cursor);
 const second=await (await inbox.fetch(new Request('https://internal/bot/scans?cursor='+encodeURIComponent(first.cursor)))).json();
 assert.deepEqual([...first.scans,...second.scans].map(s=>s.revision),expected);assert.equal(second.cursor,null);
 assert.equal((await inbox.fetch(new Request('https://internal/bot/scans?cursor=paper-trade:wrong'))).status,400);
 assert.equal((await inbox.fetch(new Request('https://internal/bot/scans',{method:'POST',body:'{}'}))).status,405);
 console.log('PASS: compact scan journal, preserved inputs, stale marks, atomic scan record, replay, eight-day pruning and pagination');
}

// v2 → v3 also preserves existing counters, inventory and loss controls.
{
 const prior={...seeded,positions:seeded.positions.map(p=>({...p,experiment:'spot-volume-v2'})),version:'spot-volume-v2',lastScanAt:at(-5),day:{date:at(0).slice(0,10),entries:12,realized:-.03}};
 const migrated=advance(prior,snapshot(0),[],time(0));
 assert.equal(migrated.ruleChanges.at(-1).fromDailyLimit,12);assert.equal(migrated.ruleChanges.at(-1).toDailyLimit,24);
 assert.equal(migrated.day.entries,12);assert.equal(migrated.day.realized,-.03);assert.equal(migrated.cashSol,prior.cashSol);
 assert.equal(migrated.positions[0].experiment,'spot-volume-v2');assert.equal(migrated.closedCount,prior.closedCount);
 const full={...initialPaperState(),day:{date:at(0).slice(0,10),entries:24,realized:0}};
 assert.equal(canEnterPaper(full,time(0)),false);full.day.entries=23;assert.equal(canEnterPaper(full,time(0)),true);
 console.log('PASS: 24-entry boundary and v2 bankroll, position provenance and loss controls survive migration');
}
// New entries wait through an ordinary volume lull; old positions keep their original exits.
{
 let patient=structuredClone(seeded);
 for(let m=15;m<=65;m+=5)patient=advance(patient,{...snapshot(m),pools:[{...pool(m),activity:{...pool(m).activity,volume30m:1000}}]},[{poolId:'solana:pool',positionId:'paper:position',mark:mark(m)}],time(m));
 assert.equal(patient.positions.length,1,'volume alone cannot close a v4 position in its first hour');
 patient=advance(patient,{...snapshot(70),pools:[{...pool(70),activity:{...pool(70).activity,volume30m:1000}}]},[{poolId:'solana:pool',positionId:'paper:position',mark:mark(70)}],time(70));
 assert.match(patient.closed[0].reason,/after at least an hour held/);
 let old=structuredClone(seeded);old.positions[0].experiment='spot-volume-v3';
 for(let m=15;m<=45;m+=5)old=advance(old,snapshot(m),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(m,{inRange:false})}],time(m));
 assert.equal(old.closed[0].reason,'Out of range for 30 observed minutes');
 console.log('PASS: patient volume exit is prospective; old positions retain their 30-minute range exit');
}

// v5 token support must not shorten already-open v4 positions or reset results.
{
 const previous=structuredClone(seeded);previous.version='active-lp-v4';previous.positions[0].experiment='active-lp-v4';
 previous.readFailures={oldToken:{at:at(10),reason:'Extended-token accounting is outside this paper trial'},rpc:{at:at(10),reason:'RPC unavailable'}};
 const before=structuredClone(previous);let next=previous;
 for(let m=15;m<=45;m+=5)next=advance(next,snapshot(m),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(m,{inRange:false})}],time(m));
 assert.equal(next.positions.length,1,'v4 range patience stays 60 minutes after v5 deploy');
 assert.equal(next.positions[0].experiment,'active-lp-v4');assert.equal(next.cashSol,previous.cashSol);assert.equal(next.ruleChanges.length,1);
 assert.deepEqual(previous,before,'migration does not mutate the prior experiment');
 const first=advance(previous,snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(15)}],time(15));
 assert.equal(first.readFailures.oldToken,undefined);assert.ok(first.readFailures.rpc,'unrelated failure backoff is retained');
 for(let m=50;m<=75;m+=5)next=advance(next,snapshot(m),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(m,{inRange:false})}],time(m));
 assert.equal(next.closed[0].reason,'Out of range for 60 observed minutes');assert.equal(next.closed[0].experiment,'active-lp-v4');
 const taxed=structuredClone(seeded);taxed.positions[0].entryCosts={fundingSol:.004,depositTaxSol:.003,initialRoundTripSol:.014,epoch:1000,transferFees:[{mint:'mintA',bps:300,maximumRaw:'100000'}]};
 const closed=advance(controlPaper(taxed,'stop',time(11)),snapshot(15),[{poolId:'solana:pool',positionId:'paper:position',mark:mark(15,{withdrawTaxSol:.003,transferFees:[{mint:'mintA',bps:500,maximumRaw:'100000'}]})}],time(15)).closed[0];
 assert.deepEqual(closed.entryCosts,taxed.positions[0].entryCosts);assert.equal(closed.withdrawTaxSol,.003);assert.equal(closed.exitTransferFees[0].bps,500);
 console.log('PASS: v5 migration preserves v4 patience, historical identity, bankroll, unrelated backoff and archived entry/exit fee evidence');
}
