import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const dir=await mkdtemp(join(tmpdir(),'lp-bots-ui-'));
await build({entryPoints:['src/research-paper.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'paper.cjs')});
const require=createRequire(import.meta.url),math=require(join(dir,'paper.cjs'));
const source=(await readFile('public/research-bots.js','utf8')).replace(/^import[^\n]+\n/gm,'');
const now=Date.parse('2026-09-30T12:00:00Z'),at=t=>new Date(t).toISOString(),asOf=at(now),SOL='So11111111111111111111111111111111111111112';
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const form={values:{bot:'overnight-floor',evidence:'measured',size:'.5',seed:'2',tvl:'25000',volume:'150000',fee:'.1',lookback:'24',hold:'12',exitVolume:'80000',resetVolume:'150000',tvlFall:'40',sale:'',funding:'',network:'.0001',rent:'0',tax:'',authorities:'on'},elements:{},onsubmit:null};
for(const key of Object.keys(form.values))form.elements[key]={get value(){return form.values[key];},set value(v){form.values[key]=String(v);},onchange:null};
const host={innerHTML:''},resultHost={innerHTML:''},rules={innerHTML:''},download={onclick:null},nodes=new Map([['researchBots',host],['researchBotForm',form],['researchBotResults',resultHost],['researchBotRules',rules],['downloadResearchBot',download]]);
const listeners=new Map(),downloads=[];let blob=null,revoked=null;
const context={...math,Date:FixedDate,console,Blob,Map,setTimeout:f=>f(),document:{getElementById:id=>nodes.get(id),addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>({href:'',download:'',click(){downloads.push({href:this.href,download:this.download});}})},window:{},URL:{createObjectURL:b=>{blob=b;return 'blob:read-only';},revokeObjectURL:u=>{revoked=u;}},FormData:class{constructor(f){this.form=f;}get(k){return this.form.values[k]??null;}}};
vm.runInNewContext(source+'\nglobalThis.botUI={replayObservations,createReplayInput,renderBots,renderReplay,runBot,runs:()=>results};',context);
const ui=context.botUI,plain=x=>JSON.parse(JSON.stringify(x));
const row={pool:{id:'solana:fixture',fetchedAt:asOf,base:{address:'token'},tvlUsd:200000,activity:{fees1h:1000}},config:{binStep:100},trend:{volume4h:500000},
 safety:{rpc:{status:'available',asOf,decimals:6,mintAuthority:null,freezeAuthority:null,transferFeeStatus:'none',transferFee:null}},
 historyCoverage:{to:at(now-3600000)},marketHistory:Array.from({length:4},(_,i)=>({at:at(now-(4-i)*1800000),priceSol:1,tvlUsd:100000+i,fees1h:100+i,volume4h:300000+i})),
 structure:{asOf,unit:'SOL per token',candles:Array.from({length:4},(_,i)=>({t:now/1000-(5-i)*3600,o:9,h:10,l:.5,c:1,v:999}))}};

// Measured evidence retains its dated values and does not borrow today's flags.
const measured=ui.replayObservations(row,'measured');
assert.equal(measured[0].at,row.marketHistory[0].at);assert.equal(measured[0].priceSol,1);assert.equal(measured[0].tvlUsd,100000);assert.equal(measured[0].fees1h,100);assert.equal(measured[0].volume4h,300000);
assert.ok(measured.every(o=>o.mintAuthority===null&&o.freezeAuthority===null));
assert.equal(row.marketHistory[0].mintAuthority,undefined,'input history is not mutated');
const point=row.marketHistory[0],date=Date.parse(point.at);
for(const [delta,expected] of [[0,false],[-300000,false],[-300001,null],[1,null]]){
 const dated={...row,marketHistory:[{...point,authorityAt:at(date+delta),mintAuthority:false,freezeAuthority:true}]};
 const observation=ui.replayObservations(dated,'measured')[0];assert.equal(observation.mintAuthority,expected,'only fresh prior authority evidence is used');assert.equal(observation.freezeAuthority,expected===false?true:null);
}
assert.equal(ui.replayObservations({...row,marketHistory:[{...point,authorityAt:'invalid',mintAuthority:false}]},'measured')[0].mintAuthority,null);
assert.equal(ui.replayObservations({...row,marketHistory:[{...point,at:date,authorityAt:at(date),mintAuthority:false}]},'measured')[0].mintAuthority,false,'epoch-millisecond market dates remain correctly dated');

// A candle close belongs to the end of its hour, never its opening timestamp.
const scenario=ui.replayObservations(row,'scenario');
assert.equal(scenario[0].at,at((row.structure.candles[0].t+3600)*1000));assert.equal(scenario[0].priceSol,1,'use close, not open/high/low');
assert.equal(scenario[0].tvlUsd,200000);assert.equal(scenario[0].fees1h,1000);assert.equal(scenario[0].volume4h,500000);assert.equal(scenario[0].mintAuthority,false);assert.equal(scenario[0].freezeAuthority,false);
assert.equal(ui.replayObservations({...row,safety:{rpc:{...row.safety.rpc,mintAuthority:'active-authority'}}},'scenario')[0].mintAuthority,true);
assert.equal(ui.replayObservations({...row,safety:{rpc:{...row.safety.rpc,mintAuthority:undefined}}},'scenario')[0].mintAuthority,null);
for(const rpc of [{...row.safety.rpc,status:'stale'},{...row.safety.rpc,asOf:at(now-300001)},{...row.safety.rpc,asOf:at(now+60001)},{...row.safety.rpc,asOf:'invalid'}])assert.equal(ui.replayObservations({...row,safety:{rpc}},'scenario')[0].mintAuthority,null);
const stale={...row,pool:{...row.pool,fetchedAt:at(now-600001)}};
assert.equal(ui.replayObservations(stale,'scenario')[0].tvlUsd,null);assert.equal(ui.replayObservations(stale,'scenario')[0].fees1h,null);
assert.throws(()=>ui.replayObservations(row,'invented-mode'),/Choose measured/);

ui.renderBots(row);assert.match(host.innerHTML,/name="bot" aria-label="Bot"/);assert.match(host.innerHTML,/name="evidence" aria-label="Evidence"/);assert.match(host.innerHTML,/Measured market observations/);assert.match(rules.innerHTML,/24 hours/);
const defaults=plain(math.starterResearchBots);
for(const bot of math.starterResearchBots){
 form.values.bot=bot.id;form.elements.bot.onchange();
 const input=ui.createReplayInput(row,form);
 for(const key of ['minTvl','minVolume4h','minFeeRateHourly','floorLookbackHours','maxHoldHours','exitVolume4h','resetVolume4h','maxTvlFall'])assert.equal(input.config[key],bot[key],key+' uses the selected bot default');
 assert.equal(input.config.fixedBinCount,bot.fixedBinCount);assert.equal(input.config.shape,bot.shape);assert.equal(input.config.oneSided,bot.oneSided);
}
assert.deepEqual(plain(math.starterResearchBots),defaults,'rendering/selecting cannot mutate starter rules');
form.values={...form.values,bot:'overnight-floor',evidence:'scenario',tvl:'12345',volume:'23456',fee:'.25',lookback:'.5',hold:'6',exitVolume:'34567',resetVolume:'45678',tvlFall:'25',network:'0',rent:'0'};
const custom=ui.createReplayInput(row,form);
assert.equal(custom.config.minTvl,12345);assert.equal(custom.config.minVolume4h,23456);assert.equal(custom.config.minFeeRateHourly,.0025);assert.equal(custom.config.floorLookbackHours,.5);assert.equal(custom.config.maxHoldHours,6);assert.equal(custom.config.maxTvlFall,.25);assert.equal(custom.config.maxSourceGapMinutes,90);assert.equal(custom.feeMode,'constant-current-conditions');
assert.equal(custom.transferFeeBps,0);assert.equal(custom.costAssumption.fundingCostFraction,null);assert.equal(custom.costAssumption.exitCostFraction,null);assert.equal(custom.costAssumption.networkSol,0);assert.equal(custom.costAssumption.positionRentSol,0);
assert.throws(()=>ui.createReplayInput(stale,form),/fresh pool/);
form.values.evidence='invented-mode';assert.throws(()=>ui.createReplayInput(row,form),/Choose measured/);form.values.evidence='scenario';

// The actual current cap is carried in raw units; a user override has no inferred cap.
const taxed={...row,safety:{rpc:{...row.safety.rpc,transferFeeStatus:'known',transferFee:{bps:100,maximumRaw:'10'}}}};
const capInput=ui.createReplayInput(taxed,form);assert.equal(capInput.transferFeeBps,100);assert.equal(capInput.transferFeeMaximumRaw,'10');assert.equal(capInput.pairedDecimals,6);
for(const rpc of [{...taxed.safety.rpc,decimals:null},{...taxed.safety.rpc,transferFee:{bps:100}},{...taxed.safety.rpc,transferFee:{bps:100,maximumRaw:'not-raw'}},{...taxed.safety.rpc,status:'unavailable'}])assert.equal(ui.createReplayInput({...row,safety:{rpc}},form).transferFeeBps,null,'an incomplete verified policy stays unknown');
form.values.tax='200';const override=ui.createReplayInput(taxed,form);assert.equal(override.transferFeeBps,200);assert.equal(override.transferFeeMaximumRaw,null);form.values.tax='';
form.values.funding='1';form.values.sale='2';const costs=ui.createReplayInput(row,form);assert.equal(costs.costAssumption.fundingCostFraction,.01);assert.equal(costs.costAssumption.exitCostFraction,.02);form.values.funding='';form.values.sale='';
for(const key of ['network','rent']){const original=form.values[key];form.values[key]='';assert.throws(()=>ui.createReplayInput(row,form),new RegExp('valid '+key));form.values[key]=original;}
assert.equal(ui.createReplayInput({...row,pool:{...row.pool,base:{address:SOL}}},form).solIsBase,true);

// Exercise the real replay through the form: absence of outcomes is not zero.
form.values={...form.values,evidence:'measured',tvl:'0',volume:'0',fee:'0',lookback:'.5',hold:'12',exitVolume:'0',resetVolume:'0',tvlFall:'40',authorities:'on'};
ui.runBot(row,form);let replay=ui.runs().get('overnight-floor');
assert.equal(replay.scoreboard.netPnlSol,null);assert.equal(replay.scoreboard.tradeCount,0);assert.ok(replay.decisions.every(d=>d.action==='skip'));assert.ok(replay.decisions.some(d=>d.reason.includes('authority evidence unavailable')));assert.match(resultHost.innerHTML,/Closed net SOL P&L/);assert.match(resultHost.innerHTML,/Unavailable/);
form.values.authorities=null;ui.runBot(row,form);replay=ui.runs().get('overnight-floor');
assert.equal(replay.scoreboard.netPnlSol,0,'explicit zero costs and scored zero-return closes remain numeric zero');assert.ok(replay.scoreboard.scoredTrades>0);assert.equal(replay.scoreboard.unresolvedTrades,0);assert.match(resultHost.innerHTML,/Scored closed-trade subtotal 0 SOL/);
const gapRow={...row,marketHistory:[row.marketHistory[0],{...row.marketHistory[1],priceSol:null},row.marketHistory[2],row.marketHistory[3]]};ui.runBot(gapRow,form);const gaps=ui.runs().get('overnight-floor');assert.match(gaps.warnings[0],/1 observations.*omitted/);assert.equal(gaps.decisions.find(d=>d.at===row.marketHistory[2].at).action,'skip','removing an unknown price retains the gap and does not invent warm history');assert.equal(ui.createReplayInput(gapRow,form).omittedObservationCount,1);
ui.runBot(row,form);replay=ui.runs().get('overnight-floor');const previousScore=replay.scoreboard.netPnlSol;form.values.sale='';ui.runBot({...row,safety:{rpc:{...row.safety.rpc,status:'unavailable'}}},form);replay=ui.runs().get('overnight-floor');assert.equal(previousScore,0);assert.equal(replay.scoreboard.netPnlSol,null);assert.ok(replay.scoreboard.unresolvedTrades>0);assert.match(resultHost.innerHTML,/Token transfer tax unavailable/);
const noNetwork=math.runResearchReplay({...custom,costAssumption:{...custom.costAssumption,networkSol:null}});assert.equal(noNetwork.scoreboard.netPnlSol,null);assert.ok(noNetwork.trades.some(t=>t.unavailableReasons.includes('Network cost unavailable')));
const noRent=math.runResearchReplay({...custom,costAssumption:{...custom.costAssumption,positionRentSol:null}});assert.equal(noRent.scoreboard.netPnlSol,null);assert.ok(noRent.trades.some(t=>t.unavailableReasons.includes('Refundable rent requirement unavailable')));

// All externally supplied labels and decision fields are escaped in the result.
const injection='<img src=x onerror="steal()">';
const unsafe={...replay,config:{...replay.config,name:injection},label:injection,warnings:[injection],assumptions:[injection],decisions:[{at:injection,action:injection,reason:injection,numbers:{message:injection}}],trades:[{entryAt:injection,exitAt:injection,reason:injection,feesSol:0,pnlSol:null,unavailableReasons:[injection]}]};
const html=ui.renderReplay(unsafe);assert.doesNotMatch(html,/<img|onerror="/);assert.match(html,/&lt;img/);assert.match(html,/&quot;steal\(\)&quot;/);assert.match(html,/Scored closed-trade subtotal/);
form.values.evidence='measured';form.values.network='';ui.runBot(row,form);assert.match(resultHost.innerHTML,/valid network/);assert.equal(ui.runs().get('overnight-floor'),replay,'a rejected form cannot replace prior evidence');form.values.network='0';
ui.runBot(row,form);download.onclick();assert.equal(downloads.length,1);assert.equal(downloads[0].href,'blob:read-only');assert.equal(revoked,'blob:read-only');const exported=JSON.parse(await blob.text());assert.equal(exported.poolId,row.pool.id);assert.equal(exported.checkedAt,asOf);assert.equal(exported.experiment.scoreboard.netPnlSol,0);
listeners.get('lp:research-pool')({detail:row});assert.equal(ui.runs().size,0,'changing pools resets the per-pool experiment comparison');
assert.doesNotMatch(source,/fetch\(|sendTransaction|sendRawTransaction|request_wallet_sign|localStorage|\/api\/fleet/);
console.log('PASS research bot UI: dated measured evidence, correct candle close times, scenario-only current flags, verified capped vs unknown tax, explicit costs, editable defaults, real unknown/zero replays, safe rendering, JSON evidence and read-only actions');
