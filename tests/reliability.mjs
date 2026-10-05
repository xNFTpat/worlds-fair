import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'lp-tests-'));
for (const [name,entry] of [['worker','src/index.ts'],['balances','src/sources/uniswap-positions.ts'],['history','src/sources/meteora-history.ts'],['charts','src/charts.ts'],['meteora','src/sources/meteora-positions.ts']]) await build({entryPoints:[entry],bundle:true,platform:'node',mainFields:['main'],format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},outfile:join(dir,name+'.mjs')});
const {default:worker} = await import(pathToFileURL(join(dir,'worker.mjs')));
const {ethBalance, accruedFees} = await import(pathToFileURL(join(dir,'balances.mjs')));
// A native optional-dependency probe in bundled Node fixtures may leave its
// stack formatter installed. Keep ordinary assertion diagnostics available.
Error.prepareStackTrace=undefined;
const originalFetch = globalThis.fetch;
const respond = (data,status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json'}});
const oldTime = '2026-09-01T12:00:00.000Z';
const oldHealth = label => ({label,status:'fresh',lastSuccessAt:oldTime,attemptedAt:oldTime});
const store = new Map();
const kv = {get:async k=>store.has(k)?JSON.parse(store.get(k)):null,put:async(k,v)=>{store.set(k,v);}};
const env = {LP_CACHE:kv,TX_KEY:'reliability-fixture-key',WALLETS:'patsol:SoLWallet,pateth:0xWallet',MIN_TVL_USD:'0'};
function seed(legacy=false) {
  store.clear();
  store.set('snapshot:v1',JSON.stringify({pools:[],errors:{},updatedAt:oldTime}));
  store.set('positions:v1',JSON.stringify({updatedAt:oldTime,errors:{},positions:[{wallet:'patsol',id:'sol',fetchedAt:oldTime},{wallet:'pateth',id:'eth',fetchedAt:oldTime}],balances:[{wallet:'patsol',chain:'solana',native:1.2,symbol:'SOL'},{wallet:'pateth',chain:'robinhood',native:legacy?0:0.005,symbol:'ETH'}],sources:legacy?undefined:Object.fromEntries(['positions:patsol','positions:pateth','balance:patsol','balance:pateth'].map(k=>[k,oldHealth(k)]))}));
}
const refresh = () => worker.fetch(new Request('https://local/api/positions?refresh=1',{headers:{'x-terminal-key':env.TX_KEY}}),env).then(r=>r.json());
const {positionBounds} = await import(pathToFileURL(join(dir,'charts.mjs')));
const chartPool={chain:'robinhood',pair:'AI/WETH',base:{address:'0xai'},quote:{address:'0xweth'}};
assert.deepEqual(positionBounds({pair:'WETH/AI',lower:5000,upper:10000},chartPool),{lower:0.0001,upper:0.0002});
assert.deepEqual(positionBounds({pair:'AI/WETH',lower:0.0001,upper:0.0002},chartPool),{lower:0.0001,upper:0.0002});
assert.equal(positionBounds({pair:'OTHER/WETH',lower:1,upper:2},chartPool),null);
assert.equal(positionBounds({pair:'AI/WETH',lower:0,upper:2},chartPool),null);
console.log('PASS: chart range orientation and unmatched/invalid bounds');
const Q = 1n << 128n;
assert.equal(accruedFees(100n*Q,20n*Q,30n*Q,40n*Q,2n,3n,0,-10,10),23n);
assert.equal(accruedFees(100n*Q,20n*Q,10n*Q,8n*Q,2n,3n,-11,-10,10),7n);
assert.equal(accruedFees(100n*Q,20n*Q,30n*Q,8n*Q,2n,3n,10,-10,10),7n);
assert.equal(accruedFees(2n*Q,0n,0n,(1n<<256n)-Q,2n,0n,0,-10,10),6n);
assert.equal(accruedFees(100n*Q,0n,0n,0n,0n,7n,0,-10,10),7n);
console.log('PASS: fee accrual in/out of range, upper boundary, uint256 rollover and zero liquidity');
try {
  const {fetchMeteoraPositions} = await import(pathToFileURL(join(dir,'meteora.mjs')));
  const pool = {poolAddress:'pool',tokenX:'TEST',tokenY:'SOL',binStep:100,totalDeposit:'86',balances:'20',pnl:'-1',pnlPctChange:'-5',openPositionCount:1,listPositions:['position']};
  const entry = {positionAddress:'position',isClosed:false,allTimeDeposits:{total:{usd:'21'},tokenX:{amount:'100'},tokenY:{amount:'0.1'}},unrealizedPnl:{balanceTokenX:{amount:'90'},balanceTokenY:{amount:'0.12'}}};
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[pool],hasNext:false}:{positions:[entry],hasNext:false});
  const [open] = await fetchMeteoraPositions({name:'test',address:'wallet'});
  assert.equal(open.depositedUsd,21,'open deposits must not inherit recycled historical pool deposits');
  assert.equal(open.depositScope,'open-positions');
  assert.deepEqual(open.depositedTokens,[{symbol:'TEST',amount:100},{symbol:'SOL',amount:0.1}]);
  assert.equal(open.currentTokens[0].amount,90);
  assert.equal(open.pnlPct,-5);
  assert.equal(open.rangeStatus.out,null,'a missing range cannot imply in-range');
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[{...pool,openPositionCount:2,listPositions:['a','b'],positionsOutOfRange:['b'],outOfRange:false}],hasNext:false}:{positions:[],hasNext:false});
  assert.deepEqual((await fetchMeteoraPositions({name:'test',address:'wallet'}))[0].rangeStatus,{total:2,out:1});
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[{...pool,openPositionCount:2,listPositions:['a'],positionsOutOfRange:[],outOfRange:false}],hasNext:false}:{positions:[],hasNext:false});
  assert.equal((await fetchMeteoraPositions({name:'test',address:'wallet'}))[0].rangeStatus.out,null,'incomplete grouped range must not imply all in range');
  globalThis.fetch=async url=>respond(String(url).includes('/portfolio/open')?{pools:[pool],hasNext:false}:{positions:[entry],hasNext:true});
  const [partial] = await fetchMeteoraPositions({name:'test',address:'wallet'});
  assert.equal(partial.depositScope,'pool-history');
  assert.deepEqual(partial.depositedTokens,[]);
  console.log('PASS: open-position deposits/holdings and incomplete detail coverage');
  const {fetchMeteoraHistory} = await import(pathToFileURL(join(dir,'history.mjs')));
  globalThis.fetch = async url => String(url).includes('/portfolio/total')
    ? respond({totalPnlUsd:'-3.9582',totalClosedPositions:10}) : respond({},400);
  const lifetime = await fetchMeteoraHistory({name:'test',address:'sol'});
  assert.equal(lifetime.totals.pnl,-3.9582);
  assert.equal(lifetime.totals.positions,10);
  assert.equal(lifetime.totals.deposits,null);
  assert.ok(lifetime.errors.length,'closed history failure must be visible without losing lifetime totals');
  globalThis.fetch = async url => String(url).includes('/portfolio/total') ? respond({},400)
    : String(url).includes('/positions/') ? respond({positions:[]})
    : respond({pools:[{poolAddress:'pool',tokenX:'SOL',tokenY:'USDC',lastClosedAt:'2026-09-01T12:00:00Z'}]});
  const partialHistory = await fetchMeteoraHistory({name:'test',address:'sol'});
  assert.equal(partialHistory.closed[0].closedAt,'2026-09-01T12:00:00.000Z');
  assert.equal(partialHistory.totals,null);
  assert.ok(partialHistory.errors.includes('Lifetime totals unavailable'));
  globalThis.fetch = async url => String(url).includes('/portfolio/total') ? respond({totalPnlUsd:'17.08',totalClosedPositions:3})
    : String(url).includes('/positions/') ? respond({positions:[{positionAddress:'individual',allTimeDeposits:{total:{usd:'21.3954'}},allTimeWithdrawals:{total:{usd:'23.9442'}},allTimeFees:{total:{usd:'11.4491'}},pnlUsd:'13.9978'}]})
    : respond({pools:[{poolAddress:'pool',tokenX:'CTO',tokenY:'SOL',totalDeposit:'86.8332'}]});
  const journey = await fetchMeteoraHistory({name:'test',address:'sol'});
  const position = journey.closed.find(x => !x.isGroup);
  assert.equal(position.depositedUsd,21.3954,'individual deposits must not inherit cumulative pool deposits');
  assert.equal(position.withdrawnUsd,23.9442);
  assert.equal(position.feesUsd,11.4491);
  assert.equal(position.pnlUsd,13.9978,'fees must not be added again to indexer PnL');
  console.log('PASS: lifetime schema, independent endpoint failures and ISO close dates');
  globalThis.fetch=async()=>respond({error:{message:'Too Many Requests'}});
  await assert.rejects(()=>ethBalance('0xWallet'),'error response must not become zero');
  globalThis.fetch=async()=>respond({});
  await assert.rejects(()=>ethBalance('0xWallet'),'missing result must not become zero');
  globalThis.fetch=async()=>respond({result:'0x0'});
  assert.equal(await ethBalance('0xWallet'),0,'genuine on-chain zero is valid');
  console.log('PASS: failed/missing ETH balance differs from genuine zero');
  seed();
  globalThis.fetch=async(url)=>String(url).includes('meteora')?respond({error:'unavailable'},400):respond({error:{message:'provider unavailable'}});
  const first=await refresh(),second=await refresh();
  assert.equal(first.positions.length,2);
  assert.equal(second.balances.find(x=>x.wallet==='pateth').native,0.005);
  for(const h of Object.values(second.sources)){assert.equal(h.lastSuccessAt,oldTime);assert.equal(h.status,'stale');}
  console.log('PASS: repeated outages retain both chains and original successful timestamps');
  seed(true);
  const legacy=await refresh();
  assert.equal(legacy.balances.find(x=>x.wallet==='pateth').native,null);
  assert.equal(legacy.sources['balance:pateth'].status,'unavailable');
  console.log('PASS: legacy false-zero balances are not trusted');
  seed();
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('meteora'))return respond({pools:[],hasNext:false});
    const q=JSON.parse(init.body);
    if(q.method==='eth_blockNumber'||q.method==='eth_call'||q.method==='eth_getBalance')return respond({result:'0x0'});
    if(q.method==='getBalance')return respond({result:{value:2000000000}});
    if(q.method==='getTokenAccountsByOwner')return respond({result:{value:[]}});
    throw new Error('Unexpected mock request');
  };
  const recovered=await refresh();
  assert.equal((await worker.fetch(new Request('https://local/api/range-alerts',{method:'POST',headers:{origin:'https://local','x-terminal-key':env.TX_KEY}}),env)).status,405,'the public inbox cannot be overwritten');
  assert.equal(recovered.positions.length,0,'confirmed empty must clear saved open positions');
  assert.equal(recovered.balances.find(x=>x.wallet==='patsol').native,2);
  for(const h of Object.values(recovered.sources))assert.equal(h.status,'fresh');
  console.log('PASS: successful empty portfolios clear saved positions and recover health');
  seed();
  let requests=0;
  const successFetch=globalThis.fetch;
  globalThis.fetch=async(...args)=>{requests++;await new Promise(resolve=>setTimeout(resolve,10));return successFetch(...args);};
  await Promise.all([refresh(),refresh()]);
  assert.equal(requests,6,'simultaneous refreshes share the same upstream work');
  console.log('PASS: concurrent refreshes coalesce');
  seed();
  store.set('snapshot:v1',JSON.stringify({pools:[{id:'sol-pool',chain:'solana',venue:'meteora-dlmm',fetchedAt:oldTime},{id:'damm-pool',chain:'solana',venue:'meteora-damm-v2',fetchedAt:oldTime},{id:'rh-pool',chain:'robinhood',fetchedAt:oldTime}],errors:{},updatedAt:oldTime,sources:{meteora:oldHealth('Meteora pools'),damm:oldHealth('Meteora DAMM v2 pools'),geckoterminal:oldHealth('Robinhood pools')}}));
  globalThis.fetch=async()=>respond({error:'Unavailable'},400);
  for(let i=0;i<2;i++)await worker.fetch(new Request('https://local/api/refresh',{method:'POST',headers:{origin:'https://local','x-terminal-key':env.TX_KEY}}),env);
  const savedPools=JSON.parse(store.get('snapshot:v1'));
  assert.equal(savedPools.pools.length,3);
  for(const key of ['meteora','damm','geckoterminal']){const h=savedPools.sources[key];assert.equal(h.lastSuccessAt,oldTime);assert.equal(h.status,'stale');}
  for(const key of ['raydium','orca'])assert.equal(savedPools.sources[key].status,'unavailable');
  console.log('PASS: repeated pool-source outages retain pools and original timestamps');
  const html=await readFile('public/index.html','utf8');
  new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  console.log('PASS: browser script parses');
} finally {globalThis.fetch=originalFetch;}

// Paper controls require the same-origin owner key; public reads cannot mutate either trial.
for(const endpoint of ['bot','paper-lab','active-lp','paper-fleet']){
 let changes=0;
 const botEnv={...env,TX_KEY:'test-owner-key',RANGE_ALERTS:{idFromName:n=>n,get:()=>({fetch:async()=>{changes++;return respond({ok:true});}})}};
 const control=(headers={},body={action:'stop'},override=botEnv)=>worker.fetch(new Request('https://local/api/'+endpoint+'/control',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}),override);
 assert.equal((await control()).status,401);
 assert.equal((await control({origin:'https://elsewhere','x-terminal-key':'test-owner-key'})).status,403);
 assert.equal((await control({origin:'https://local'})).status,401);
 assert.equal((await control({origin:'https://local','x-terminal-key':'wrong'})).status,401);
 assert.equal((await control({origin:'https://local','x-terminal-key':'test-owner-key'},{action:'stop'},{...botEnv,TX_KEY:undefined})).status,401);
 assert.equal((await control({origin:'https://local','x-terminal-key':'test-owner-key'},{action:'reset'})).status,400);
 assert.equal(changes,0);
 assert.equal((await control({origin:'https://local','x-terminal-key':'test-owner-key'})).status,200);assert.equal(changes,1);
 assert.equal((await worker.fetch(new Request('https://local/api/'+endpoint,{method:'POST'}),botEnv)).status,405);assert.equal(changes,1);
 assert.equal((await worker.fetch(new Request('https://local/api/'+endpoint+'/scans',{method:'POST'}),botEnv)).status,405);assert.equal(changes,1);
 console.log('PASS: paper controls fail closed without owner key, reject cross-origin/unknown actions, preserve public read-only access');
}
