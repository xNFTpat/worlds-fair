import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/worldsfair-paper.js';

const {createClient,ruleProblem,ruleSummary,ruleWithLabels,depositAvailable,vaultHoldingHtml,allocationSeries,allocationChartHtml,recoveryLabel,ratePublicationText}=globalThis.WorldsFairPaper;
const now=Date.UTC(2026,9,5,12),iso=delta=>new Date(now+delta).toISOString();
assert.equal(ratePublicationText(null),'Provider publication time unavailable');assert.equal(ratePublicationText('bad'),'Provider publication time unavailable');assert.match(ratePublicationText(iso(0)),/^Provider rate dated/);
const off={enabled:false,lpPercent:50,vaultPercent:25,basketPercent:25,vaultId:null,basketSlug:null};
assert.equal(ruleProblem(off),null,'The off-by-default rule does not require destinations');
assert.match(ruleProblem({...off,enabled:true}),/Choose a Solana/);
assert.match(ruleProblem({...off,enabled:true,vaultId:'jito-liquid-staking'}),/Choose a basket/);
const on={...off,enabled:true,vaultId:'jito-liquid-staking',basketSlug:'solana'};
assert.equal(ruleProblem(on),null);assert.match(ruleSummary(on),/50% shared LP capital · 25% selected vault · 25% selected basket/);
const named=ruleWithLabels(on,[{id:on.vaultId,name:'JitoSOL'}],[{slug:on.basketSlug,name:'Solana growth'}]);assert.equal(named.vaultId,on.vaultId);assert.equal(named.basketSlug,on.basketSlug);assert.match(ruleSummary(named),/25% JitoSOL · 25% Solana growth/);assert.doesNotMatch(ruleSummary(on),/jito-liquid-staking|solana/);assert.equal(ruleWithLabels(on).vaultName,null);
assert.match(ruleSummary(off),/^Off/);
for(const value of [NaN,Infinity,-1,101,1.5,null,'50'])assert.ok(ruleProblem({...off,lpPercent:value}));
assert.ok(ruleProblem({...off,lpPercent:49}));assert.ok(ruleProblem({...off,enabled:undefined}));
assert.equal(ruleProblem({...off,enabled:true,lpPercent:100,vaultPercent:0,basketPercent:0}),null,'Zero destination shares do not require IDs');
assert.equal(ruleProblem({...on,lpPercent:0,vaultPercent:100,basketPercent:0,basketSlug:null}),null);

const staking={id:'jito-liquid-staking',name:'JitoSOL',kind:'staking',chain:'Solana',asset:'SOL',depositEnabled:true,rate:6,rateType:'APY',readAt:iso(0),rateAsOf:null};
assert.equal(depositAvailable(staking,now),true);assert.equal(depositAvailable(staking,now+3600000),true);assert.equal(depositAvailable(staking,now+3600001),false);
for(const change of [{stale:true},{disabled:true},{depositEnabled:null},{rate:NaN},{rate:null},{rate:-1},{asset:'ETH'},{chain:'Ethereum'},{readAt:null},{readAt:iso(1)},{rateAsOf:iso(-3600001)},{rateAsOf:'bad'},{rateType:'estimated'}])assert.equal(depositAvailable({...staking,...change},now),false);
assert.equal(depositAvailable({...staking,rate:0},now),true,'A verified zero rate is valid and distinct from missing evidence');
const vault={...staking,id:'backyard:sol',kind:'vault',inputTokenMint:'So11111111111111111111111111111111111111112',inputTokenDecimals:9};
assert.equal(depositAvailable(vault,now),true);
for(const change of [{inputTokenMint:null},{inputTokenMint:'bad'},{inputTokenDecimals:null},{inputTokenDecimals:19},{inputTokenDecimals:1.5}])assert.equal(depositAvailable({...vault,...change},now),false);

const holding={id:'v1',kind:'vault',ideaId:staking.id,name:'JitoSOL',asset:'SOL',basis:'native-sol',costSol:1,openedAt:iso(-3600000),rate:6,rateType:'APY',rateReadAt:iso(-3600000),rateAsOf:null,risk:'SOL price risk.',exit:'Delayed unstaking or a market swap.',accrual:{status:'estimated',asOf:iso(0),principalUnits:1,accruedUnits:.01,estimatedUnits:1.01}};
const html=vaultHoldingHtml(holding);
assert.match(html,/Starting asset units<\/span><b>1 SOL/);assert.match(html,/Estimated rewards<\/span><b>0\.01 SOL/);assert.match(html,/Estimated total units<\/span><b>1\.01 SOL/);
assert.match(html,/6\.00% APY/);assert.match(html,/estimate at quoted rate/);assert.match(html,/linear, without compounding/);assert.match(html,/Provider publication time unavailable/);
assert.match(html,/SOL price risk/);assert.match(html,/Delayed unstaking/);assert.doesNotMatch(html,/1\.01 JitoSOL|\$|NaN|undefined/);
const unavailable=vaultHoldingHtml({...holding,accrual:{status:'unavailable',principalUnits:null,accruedUnits:NaN,estimatedUnits:null},rate:null});
assert.match(unavailable,/Estimated rewards<\/span><b>Unavailable/);assert.doesNotMatch(unavailable,/NaN|undefined/);
const usdc=vaultHoldingHtml({...holding,name:'USDC vault',asset:'USDC',costSol:.1,accrual:{...holding.accrual,principalUnits:20,accruedUnits:1,estimatedUnits:21}});
assert.match(usdc,/21 USDC/);assert.doesNotMatch(usdc,/\$/,'No stablecoin dollar peg is assumed');
assert.doesNotMatch(vaultHoldingHtml({...holding,risk:'<script>alert(1)</script>'}),/<script>/);

const snapshot=(cash,lp,vault,basket)=>({cashSol:cash,lpContributedSol:lp,vaultCostSol:vault,basketCostSol:basket});
const events=[{at:iso(1000),sequence:3,allocationSnapshot:snapshot(.5,.2,.2,.1)},{at:iso(0),sequence:1,allocationSnapshot:snapshot(1,0,0,0)},{at:iso(1000),sequence:2,allocationSnapshot:snapshot(.8,0,.2,0)},{at:iso(-1),sequence:0}, {at:iso(2000),allocationSnapshot:snapshot(NaN,0,0,0)}];
const series=allocationSeries(events);assert.equal(series.length,3);assert.equal(series[0].cashSol,1);assert.equal(series[1].cashSol,.8);assert.equal(series[2].cashSol,.5);
assert.equal(allocationSeries(Array.from({length:50},(_,i)=>({at:iso(i),allocationSnapshot:snapshot(i,0,0,0)}))).length,30);
const chart=allocationChartHtml(events);assert.match(chart,/Capital placed over time \(SOL at entry\)/);assert.match(chart,/Available paper SOL/);assert.match(chart,/not part of your available balance or owned current equity/);assert.match(chart,/0\.5000 SOL/);assert.doesNotMatch(chart,/NaN|Infinity|undefined/);
assert.match(allocationChartHtml([]),/New paper moves/);
assert.doesNotMatch(allocationChartHtml([{at:iso(0),allocationSnapshot:snapshot(0,0,0,0)}]),/NaN|Infinity/,'An all-zero snapshot has a finite chart');
assert.match(recoveryLabel({action:'roll',payload:{}}),/whole-profit rule/);assert.match(recoveryLabel({action:'deposit',payload:{ideaId:'jito-liquid-staking',amountSol:'.5'}}),/deposit/);assert.match(recoveryLabel({action:'rule',payload:{enabled:false}}),/off/);

const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)},processed=new Map(),calls=[];let ids=0,lost=true,balance=1;
const fetcher=async(path,init)=>{
  assert.equal(init.credentials,'same-origin');calls.push(path);
  if(path==='/api/paper/account')return Response.json({paper:true,account:{balanceSol:balance,profitRule:off,holdings:[]},history:[]});
  const body=JSON.parse(init.body);
  if(path==='/api/paper/deposit'){
    assert.deepEqual(Object.keys(body).sort(),['ideaId','amountSol','requestId'].sort(),'The browser cannot supply rates or accrued units');
    if(!processed.has(body.requestId)){balance-=Number(body.amountSol);processed.set(body.requestId,{account:{balanceSol:balance,holdings:[holding]},receipt:{kind:'deposit'}});}
    if(lost){lost=false;throw Error('Response lost');}return Response.json(processed.get(body.requestId));
  }
  if(path==='/api/paper/rule')return Response.json({account:{balanceSol:balance,profitRule:body,holdings:[holding]},receipt:{kind:'rule'}});
  if(path==='/api/paper/roll'){assert.equal(body.percent,undefined,'Enabled rule rolls do not carry the disabled slider share');return Response.json({account:{balanceSol:balance},receipt:{kind:'roll',ruleApplied:true}});}
  throw Error('Unexpected endpoint');
};
const client=()=>createClient({fetch:fetcher,storage,uuid:()=>String(++ids)});
await assert.rejects(client().write('deposit',{ideaId:staking.id,amountSol:'.5'}),/Response lost/);assert.equal(balance,.5);
assert.equal((await client().write('deposit',{ideaId:staking.id,amountSol:'.5'})).receipt.kind,'deposit');assert.equal(balance,.5);assert.equal(ids,1,'Reload recovery repeats the deposit ID');
await client().write('rule',on);await client().write('roll',{source:'fleet',id:'close',closedAt:iso(0)});assert.equal(balance,.5,'Rule changes and whole-profit routing do not debit idle paper SOL');
const [paper,longGame]=await Promise.all(['public/worldsfair-paper.js','public/long-game.js'].map(path=>readFile(path,'utf8')));
assert.match(longGame,/data-paper-deposit/);assert.match(longGame,/WorldsFairPaper\?\.openDeposit/);assert.match(paper,/slider\.disabled=enabled/);assert.match(paper,/data-paper-rule-total/);assert.doesNotMatch(paper,/localStorage|\/api\/(?:solana|evm|tx|paybox)\//);
console.log('PASS: paper vault evidence, underlying-unit estimates, rule totals and destinations, capital history, reload-safe deposit, and whole-profit routing');
