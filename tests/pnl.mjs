import {pnlPositions} from './fixtures/synthetic-public-data.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'lp-pnl-'));
for(const [name,entry] of [['pnl','src/pnl.ts'],['positions','src/sources/meteora-positions.ts'],['history','src/sources/meteora-history.ts']])
  await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {money,meteoraPnl,combinePnl,matchingOpenPositions}=await import(pathToFileURL(join(dir,'pnl.mjs')));
const {fetchMeteoraPositions}=await import(pathToFileURL(join(dir,'positions.mjs')));
const {fetchMeteoraHistory}=await import(pathToFileURL(join(dir,'history.mjs')));
const fixture={positionAddress:'a',isClosed:false,minPrice:'0.25',maxPrice:'0.5',
  allTimeDeposits:{total:{usd:'100'}}, allTimeWithdrawals:{total:{usd:'20'}}, allTimeFees:{total:{usd:'5'}},
  unrealizedPnl:{balances:70,unclaimedFeeTokenX:{usd:'2'},unclaimedFeeTokenY:{usd:'1'},unclaimedRewardTokenX:{usd:'0'},unclaimedRewardTokenY:{usd:'0'}},pnlUsd:'-2'};
const b=meteoraPnl(fixture);
assert.equal(b.positionPnlUsd,-10,'principal withdrawals count towards position performance');
assert.equal(b.claimedFeesUsd,5);
assert.equal(b.unclaimedFeesUsd,3);
assert.equal(b.totalPnlUsd,-2,'reported total already contains both kinds of fees');
assert.equal(b.status,'reconciled');
// Claiming one dollar transfers between fee buckets without changing performance.
const afterClaim=structuredClone(fixture);
afterClaim.allTimeFees.total.usd='6';afterClaim.unrealizedPnl.unclaimedFeeTokenY.usd='0';
assert.equal(meteoraPnl(afterClaim).totalPnlUsd,-2);
assert.equal(meteoraPnl(afterClaim).status,'reconciled');
const missing=structuredClone(fixture);delete missing.allTimeFees;
assert.equal(meteoraPnl(missing).claimedFeesUsd,null);
assert.equal(meteoraPnl(missing).status,'incomplete');
assert.equal(meteoraPnl(missing).positionPnlUsd,-10,'missing fees must not contaminate principal calculation');
const missingSide=structuredClone(fixture);delete missingSide.unrealizedPnl.unclaimedFeeTokenY;
assert.equal(meteoraPnl(missingSide).unclaimedFeesUsd,null,'one known fee token is not a complete USD total');
const reward=structuredClone(fixture);reward.unrealizedPnl.unclaimedRewardTokenX.usd='4';reward.pnlUsd='2';
assert.equal(meteoraPnl(reward).status,'reconciled');
assert.equal(meteoraPnl(reward).unclaimedRewardsUsd,4);
assert.equal(meteoraPnl(reward).claimedFeesUsd,5,'rewards must not become claimed fees');
assert.equal(meteoraPnl({...fixture,pnlUsd:'100'}).status,'mismatch');
assert.equal(meteoraPnl({...fixture,pnlUsd:null}).totalPnlUsd,null);
const negativeFee=structuredClone(fixture);negativeFee.allTimeFees.total.usd='-1';
assert.equal(meteoraPnl(negativeFee).claimedFeesUsd,null);
for(const invalid of [null,undefined,'', ' ',true,false,{},[],NaN,Infinity,'1 dollar'])assert.equal(money(invalid),null);
assert.equal(money('0'),0);
const closed={...fixture,isClosed:true,unrealizedPnl:undefined,allTimeWithdrawals:{total:{usd:'110'}},pnlUsd:'15'};
assert.equal(meteoraPnl(closed,true).positionPnlUsd,10);
assert.equal(meteoraPnl(closed,true).unclaimedFeesUsd,0);
assert.equal(meteoraPnl(closed,true).totalPnlUsd,15);
assert.equal(meteoraPnl(closed,true).status,'reconciled');
assert.equal(meteoraPnl({...closed,unrealizedPnl:{}},true).status,'incomplete','an incomplete remaining balance must not be assumed zero');
const combined=combinePnl([b,meteoraPnl(missing)]);
assert.equal(combined.positionPnlUsd,-20);
assert.equal(combined.claimedFeesUsd,null,'partial fees must never look like the whole group total');
assert.equal(combined.status,'incomplete');
assert.equal(combinePnl([meteoraPnl({...fixture,pnlUsd:'8'}),meteoraPnl({...fixture,pnlUsd:'-12'})]).status,'mismatch','opposing discrepancies must not cancel to a reconciled group');
assert.equal(matchingOpenPositions([fixture,fixture],['a','b'],2),false);
assert.equal(matchingOpenPositions([fixture,{...fixture,positionAddress:'b'}],['a','a'],2),false);
assert.equal(matchingOpenPositions([fixture,{...fixture,positionAddress:'foreign'}],['a','b'],2),false);
assert.equal(matchingOpenPositions([fixture,closed],['a','b'],2),false);
assert.equal(matchingOpenPositions([fixture,{...fixture,positionAddress:'b'}],['a','b'],2),true);
for(const position of pnlPositions) {
  const p=meteoraPnl(position);
  assert.equal(p.claimedFeesUsd,0);assert.ok(p.unclaimedFeesUsd>0);assert.equal(p.status,'reconciled');
}
console.log('PASS: open/closed accounting, partial withdrawals, claimed vs unclaimed, missing data, rewards and synthetic position fixtures');

const originalFetch=globalThis.fetch;
const respond=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
try {
  const pool={poolAddress:'pool',tokenX:'TEST',tokenY:'SOL',binStep:100,openPositionCount:1,listPositions:['a'],
    balances:'999',pnl:'777',unclaimedFees:'888',totalDeposit:'1234'};
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[pool],hasNext:false}:{positions:[fixture],hasNext:false});
  const [position]=await fetchMeteoraPositions({name:'test',address:'wallet'});
  assert.equal(position.valueUsd,70,'accounting must use the same read, not an older aggregate balance');
  assert.equal(position.lower,0.25);assert.equal(position.upper,0.5,'reported bounds must not use guessed token decimals or an extra bin');
  assert.equal(position.depositedUsd,100);assert.equal(position.pnlUsd,-2);assert.equal(position.feesEarnedUsd,3);
  assert.equal(position.pnlPct,-2);assert.equal(position.pnlBreakdown.status,'reconciled');
  for(const detail of [{positions:[fixture],hasNext:true},{positions:[fixture,fixture],hasNext:false}]) {
    globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[pool],hasNext:false}:detail);
    const [partial]=await fetchMeteoraPositions({name:'test',address:'wallet'});
    assert.equal(partial.pnlBreakdown.claimedFeesUsd,null);
    assert.equal(partial.pnlBreakdown.positionPnlUsd,null);
    assert.equal(partial.pnlBreakdown.status,'incomplete');
  }
  const second={...structuredClone(fixture),positionAddress:'b',minPrice:'0.7',maxPrice:'0.9',createdAt:'2026-10-01T10:00:00Z',allTimeDeposits:{total:{usd:'200'}},allTimeWithdrawals:{total:{usd:'0'}},allTimeFees:{total:{usd:'7'}},unrealizedPnl:{...fixture.unrealizedPnl,balances:190},pnlUsd:'0'};
  const sharedPool={...pool,openPositionCount:2,listPositions:['a','b'],positionsOutOfRange:['b']};
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[sharedPool],hasNext:false}:{positions:[second,fixture],hasNext:false});
  const records=await fetchMeteoraPositions({name:'test',address:'wallet'});
  assert.equal(records.length,2);
  assert.deepEqual(records.map(p=>[p.id,p.positionAddress,p.depositedUsd,p.valueUsd,p.lower,p.upper,p.pnlUsd,p.inRange]),[
    ['solana:a','a',100,70,0.25,0.5,-2,true],['solana:b','b',200,190,0.7,0.9,0,false]
  ],'independent same-pool deposits, ranges, accounting and identities survive reversed detail order');
  assert.equal(records[0].poolGroupId,records[1].poolGroupId,'presentation may group rows without merging them');
  const noBounds={...fixture,minPrice:undefined,maxPrice:undefined,lowerBinId:1,upperBinId:2};
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[pool],hasNext:false}:{positions:[noBounds],hasNext:false});
  assert.equal((await fetchMeteoraPositions({name:'test',address:'wallet'}))[0].lower,null,'unknown token decimals must never manufacture a price range');
  for(const ids of [['a','a'],['a'],[]]){
    globalThis.fetch=async()=>respond({pools:[{...sharedPool,listPositions:ids}],hasNext:false});
    await assert.rejects(()=>fetchMeteoraPositions({name:'test',address:'wallet'}),/identities are incomplete/);
  }
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/total')?{totalPnlUsd:'15',totalClosedPositions:1}:
    String(url).includes('/positions/')?{positions:[closed],hasNext:false}:
    {pools:[{...pool,totalDeposit:'9999'}],hasNext:false});
  const history=await fetchMeteoraHistory({name:'test',address:'wallet'});
  const c=history.closed.find(x=>!x.isGroup);
  assert.equal(c.depositedUsd,100);assert.equal(c.pnlBreakdown.positionPnlUsd,10);
  assert.equal(c.pnlBreakdown.claimedFeesUsd,5);assert.equal(c.pnlUsd,15);
  assert.equal(history.totals.deposits,null,'partial table rows must not be relabelled lifetime capital');
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: consistent source snapshots, incomplete/group coverage, closed record separation');

const html=await readFile('public/index.html','utf8');
const helpers=html.slice(html.indexOf('  const usd ='),html.indexOf('  // ---------- data ----------'));
const {pnlData,pnlBreakdown,breakEvenData,breakEvenVisual}=new Function(helpers+';return {pnlData,pnlBreakdown,breakEvenData,breakEvenVisual};')();
const legacyEth={chain:'robinhood',feesEarnedUsd:15,pnlUsd:null};
assert.equal(pnlData(legacyEth).claimedFeesUsd,null);
assert.equal(pnlData(legacyEth).unclaimedFeesUsd,null,'Uniswap owed principal must never be shown as fees');
assert.ok(pnlBreakdown(legacyEth).includes('may include withdrawn principal'));
assert.ok(pnlBreakdown(legacyEth).includes('Unavailable'));
const rendered=pnlBreakdown({chain:'solana',pnlBreakdown:b});
assert.ok(rendered.includes('-$10.00')&&rendered.includes('+$5.00')&&rendered.includes('+$3.00')&&rendered.includes('-$2.00'));
console.log('PASS: display distinguishes fee buckets, losses, real zero and unknown Robinhood accounting');
assert.equal(breakEvenData(null),null);
assert.equal(breakEvenData(0).label,'At break-even');
assert.equal(breakEvenData(-0.003).label,'Within $0.01 of break-even');
assert.equal(breakEvenData(-2).label,'$2.00 below break-even');
assert.equal(breakEvenData(2).label,'$2.00 profit cushion');
assert.equal(breakEvenData(0).point,50);
assert.equal(breakEvenData(-2).point,100-breakEvenData(2).point,'the same break-even marker applies to loss and profit');
for(const v of [-1000000,-100,-1,0,1,100,1000000])assert.ok(breakEvenData(v).point>=0&&breakEvenData(v).point<=100);
assert.equal(breakEvenVisual({totalPnlUsd:null}),'','unknown P&L must not draw a break-even point');
assert.ok(breakEvenVisual(b).includes('$2.00 below break-even'),'gap must include both fee buckets, not just the $10 principal loss');
console.log('PASS: fee-inclusive break-even gap, profit cushion, true zero, missing values and a symmetric labelled dollar scale');
