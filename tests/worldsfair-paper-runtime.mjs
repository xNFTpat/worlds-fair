import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
// Uses production HTTP session routing and the production durable ledger.
// Provider responses added by later scenarios are synthetic; no real order is built.
const dir=await mkdtemp(join(tmpdir(),'worldsfair-paper-runtime-'));
const compiled=await build({stdin:{contents:`
 import {worldsfairPaperRoute} from './src/worldsfair-paper';
 const worker={fetch:async(req,env)=>(await worldsfairPaperRoute(req,env))||new Response('Not found',{status:404})};
 import {WorldsfairRangeInbox} from './src/worldsfair-paper';
 import {initialFleetState} from './src/paper-fleet';
 export class TestInbox extends WorldsfairRangeInbox {
  constructor(ctx,env){super(ctx,env);this.fixtureStorage=ctx.storage;}
  async fetch(req){
   if(new URL(req.url).pathname==='/fixture'){
    const state=await this.fixtureStorage.get('fleet')||initialFleetState(),now=new Date().toISOString(),profit=Number(new URL(req.url).searchParams.get('profit')||'.2'),fixtureId=String(state.closed.length+1);state.lastScanAt=now;state.lastFullScanAt=now;
    const arm=state.portfolios.farmer;arm.cashSol+=profit;arm.peakSol=arm.cashSol;arm.realizedPnlSol+=profit;arm.closedCount++;arm.wins++;
    const trade={id:'fleet:farmer:runtime-fixture-'+fixtureId,arm:'farmer',cohort:'runtime',experiment:state.version,pair:'FIXTURE/SOL',poolAddress:'fixture',openedAt:new Date(Date.now()-3600000).toISOString(),closedAt:now,pnlSol:profit,exitSol:1+profit,feesSol:profit,withdrawTaxSol:0,reason:'Synthetic runtime fixture',observedInRangeMs:3600000,budgetSol:1,rentSol:.1,entryNetworkSol:0};
    state.closed.push(trade);await this.fixtureStorage.put({'fleet':state,['fleet-trade:'+now+':'+trade.id]:trade});return Response.json(trade);
   }
   return super.fetch(req);
  }
 }
 export default worker;
`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'synthetic-paper-basket-provider',setup(b){
 b.onResolve({filter:/^\.\/worldsfair-paper-vaults$/},()=>({path:'vault-provider',namespace:'vault-fixture'}));
 b.onLoad({filter:/.*/,namespace:'vault-fixture'},async()=>({contents:await readFile('tests/fixtures/worldsfair-vault-provider.fixture.mjs','utf8'),loader:'js'}));
 b.onResolve({filter:/^\.\/worldsfair-paper-baskets$/},()=>({path:'basket-provider',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},async()=>({contents:await readFile('tests/fixtures/worldsfair-basket-provider.fixture.mjs','utf8'),loader:'js'}));
}}]});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'paper-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],kvNamespaces:['LP_CACHE'],durableObjects:{RANGE_ALERTS:{className:'TestInbox',useSQLite:true}},bindings:{MIN_TVL_USD:'5000',WALLETS:'',ROBINHOOD_CHAIN_ID:'4663'}}],durableObjectsPersist:join(dir,'objects'),kvPersist:join(dir,'kv')}));
const origin='https://paper.test';
async function call(path,body,cookie,extra={}){
 const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json(),headers:response.headers};
}
try{
 await mf.ready;
 const namespace=await mf.getDurableObjectNamespace('RANGE_ALERTS'),stub=namespace.get(namespace.idFromName('pat-four-wallets-v1'));
 const fixture=await stub.fetch('https://internal/fixture').then(r=>r.json());
 const a=await call('/api/paper/account'),b=await call('/api/paper/account');
 assert.equal(a.status,200);assert(a.cookie&&b.cookie&&a.cookie!==b.cookie);assert.match(a.headers.get('set-cookie'),/HttpOnly/i);assert.match(a.headers.get('set-cookie'),/Secure/i);assert.match(a.headers.get('set-cookie'),/SameSite=Strict/i);
 const seed={amountSol:'1.500000001',requestId:randomUUID()};
 assert.equal((await call('/api/paper/seed',seed,a.cookie,{origin:'https://foreign.test'})).status,403);
 assert.equal((await call('/api/paper/seed',seed)).status,401);
 const funded=await call('/api/paper/seed',seed,a.cookie);assert.equal(funded.status,200,JSON.stringify(funded.data));assert.equal(funded.data.account.balanceLamports,1500000001);
 const replay=await call('/api/paper/seed',seed,a.cookie);assert.equal(replay.status,200);assert.equal(replay.data.account.balanceLamports,1500000001);
 const adds=await Promise.all(['.1','.2'].map(amountSol=>call('/api/paper/seed',{amountSol:'0'+amountSol,requestId:randomUUID()},a.cookie)));assert(adds.every(r=>r.status===200),JSON.stringify(adds.map(r=>r.data)));
 let account=await call('/api/paper/account',null,a.cookie);assert.equal(account.data.account.balanceLamports,1800000001,'Concurrent real Worker writes conserve lamports');
 assert.equal((await call('/api/paper/account',null,b.cookie,{'x-worldsfair-account':'a'.repeat(64)})).data.account.balanceLamports,0,'Caller headers cannot choose another account');
 const roll={source:'fleet',id:fixture.id,closedAt:fixture.closedAt,percent:50,requestId:randomUUID()};
 const moved=await call('/api/paper/roll',roll,a.cookie);assert.equal(moved.status,200,JSON.stringify(moved.data));assert.equal(moved.data.account.balanceLamports,1900000001);
 const again=await call('/api/paper/roll',roll,a.cookie);assert.equal(again.status,200);assert.equal(again.data.account.balanceLamports,1900000001);
 const duplicate=await call('/api/paper/roll',{...roll,requestId:randomUUID()},b.cookie);assert(duplicate.status>=400,'A second visitor cannot claim the same fleet cash');
 const fleet=await stub.fetch('https://internal/fleet/raw').then(r=>r.json());assert(Math.abs(fleet.portfolios.farmer.withdrawnSol-.1)<1e-10);assert(fleet.revision>0);assert(Math.abs(fleet.portfolios.farmer.realizedPnlSol-.2)<1e-10);
 account=await call('/api/paper/account',null,a.cookie);assert(account.data.history.length>=4,'Every committed seed/roll has a timestamped event');assert(account.data.history.every(e=>Number.isFinite(Date.parse(e.at||e.timestamp))));
 const basketRequest={slug:'synthetic-basket',amountSol:'0.5',requestId:randomUUID()};
 const bought=await call('/api/paper/basket',basketRequest,a.cookie);assert.equal(bought.status,200,JSON.stringify(bought.data));assert.equal(bought.data.account.balanceLamports,1400000001);assert.equal(bought.data.account.holdings.length,1);
 const held=bought.data.account.holdings[0];assert.equal(held.kind,'basket');assert.equal(held.amountLamports,500000000);assert.equal(held.legs.length,2);assert.equal(held.legs[1].unitsRaw,'20000000');assert.equal(held.legs[1].priceImpactFraction,.01);
 const buyReplay=await call('/api/paper/basket',basketRequest,a.cookie);assert.equal(buyReplay.status,200);assert.equal(buyReplay.data.account.holdings.length,1);assert.equal(buyReplay.data.account.balanceLamports,1400000001);
 assert.equal((await call('/api/paper/basket',{...basketRequest,amountSol:'0.6'},a.cookie)).status,409,'A request ID cannot buy a different amount');
 for(const slug of ['provider-fails','expired-quotes']){const failed=await call('/api/paper/basket',{slug,amountSol:'0.1',requestId:randomUUID()},a.cookie);assert(failed.status>=400,slug+' must reject');}
 const forged=await call('/api/paper/basket',{...basketRequest,requestId:randomUUID(),unitsRaw:'999999999'},a.cookie);assert.equal(forged.status,400,'Clients cannot supply their own paper fill');
 const marked=await call('/api/paper/refresh',{requestId:randomUUID()},a.cookie);assert.equal(marked.status,200,JSON.stringify(marked.data));assert.equal(marked.data.account.balanceLamports,1400000001);assert.equal(marked.data.account.holdings.length,1);
 const mark=marked.data.account.holdings[0].valuation;assert(mark,'A refresh persists the current dated valuation');assert.equal(mark.valueSol,.4);assert.equal(mark.valueUsd,80);assert(Math.abs(mark.pnlSol+.1)<1e-10);assert.equal(mark.vsHoldSolUsd,-20);assert.equal(mark.absolutePnlUsd,30);
 assert.equal((await call('/api/paper/account',null,b.cookie)).data.account.holdings.length,0,'Paper basket holdings remain session-isolated');
 const depositRequest={ideaId:'synthetic-staking',amountSol:'0.25',requestId:randomUUID()};
 const deposited=await call('/api/paper/deposit',depositRequest,a.cookie);assert.equal(deposited.status,200,JSON.stringify(deposited.data));assert.equal(deposited.data.account.balanceLamports,1150000001);assert.equal(deposited.data.account.holdings.filter(h=>h.kind==='vault').length,1);
 const vault=deposited.data.account.holdings.find(h=>h.kind==='vault');assert.equal(vault.principalUnitsRaw,'250000000');assert.equal(vault.rate,5);assert.equal(vault.accrual.label,'estimate at quoted rate');assert(vault.accrual.estimatedUnits>=.25);
 const depositReplay=await call('/api/paper/deposit',depositRequest,a.cookie);assert.equal(depositReplay.status,200);assert.equal(depositReplay.data.account.balanceLamports,1150000001);
 const badDeposit=await call('/api/paper/deposit',{ideaId:'provider-fails-vault',amountSol:'0.1',requestId:randomUUID()},a.cookie);assert(badDeposit.status>=400);
 const rule={enabled:true,lpPercent:50,vaultPercent:25,basketPercent:25,vaultId:'synthetic-staking',basketSlug:'synthetic-basket',requestId:randomUUID()};
 const savedRule=await call('/api/paper/rule',rule,a.cookie);assert.equal(savedRule.status,200,JSON.stringify(savedRule.data));assert.equal(savedRule.data.account.profitRule.enabled,true);assert.equal(savedRule.data.account.balanceLamports,1150000001);
 const fixtureTwo=await stub.fetch('https://internal/fixture?profit=0.4').then(r=>r.json()),ruleRoll={source:'fleet',id:fixtureTwo.id,closedAt:fixtureTwo.closedAt,percent:50,requestId:randomUUID()};
 const ruled=await call('/api/paper/roll',ruleRoll,a.cookie);assert.equal(ruled.status,200,JSON.stringify(ruled.data));assert.equal(ruled.data.account.balanceLamports,1150000001,'Rule allocations go directly to holdings');assert.equal(ruled.data.account.holdings.length,4);assert.equal(ruled.data.account.retainedLpSol,.3);assert.equal(ruled.data.account.rolledProfitSol,.3);
 const ruleReplay=await call('/api/paper/roll',ruleRoll,a.cookie);assert.equal(ruleReplay.status,200);assert.equal(ruleReplay.data.account.holdings.length,4);
 assert(ruled.data.history.some(e=>e.allocationSnapshot&&e.allocationSnapshot.cashSol===1.150000001),'Journal carries contributed-capital allocation snapshots');
 const fleetAfterRule=await stub.fetch('https://internal/fleet/raw').then(r=>r.json());assert(Math.abs(fleetAfterRule.portfolios.farmer.withdrawnSol-.3)<1e-10,'Only the vault and basket shares leave funded LP cash');
 const failedRule=await call('/api/paper/rule',{...rule,basketSlug:'provider-fails',requestId:randomUUID()},a.cookie);assert.equal(failedRule.status,200);
 const fixtureThree=await stub.fetch('https://internal/fixture?profit=0.4').then(r=>r.json()),thirdRoll={source:'fleet',id:fixtureThree.id,closedAt:fixtureThree.closedAt,percent:50,requestId:randomUUID()};
 const rejectedRule=await call('/api/paper/roll',thirdRoll,a.cookie);assert(rejectedRule.status>=400,'A failed rule destination rejects the whole move');
 const afterFailedRule=await call('/api/paper/account',null,a.cookie);assert.equal(afterFailedRule.data.account.balanceLamports,1150000001);assert.equal(afterFailedRule.data.account.holdings.length,4);assert.equal(afterFailedRule.data.account.rolledProfitSol,.3);
 const onlyLp=await call('/api/paper/rule',{enabled:true,lpPercent:100,vaultPercent:0,basketPercent:0,vaultId:null,basketSlug:null,requestId:randomUUID()},a.cookie);assert.equal(onlyLp.status,200);
 const kept=await call('/api/paper/roll',{...thirdRoll,requestId:randomUUID()},a.cookie);assert.equal(kept.status,200,JSON.stringify(kept.data));assert.equal(kept.data.account.balanceLamports,1150000001);assert.equal(kept.data.account.holdings.length,4);assert.equal(kept.data.account.retainedLpSol,.7,'Failed attempt left the close unclaimed;100%LP then conserves the full profit');assert.equal(kept.data.account.rolledProfitSol,.3);
 const kv=await mf.getKVNamespace('LP_CACHE'),keys=await kv.list({prefix:'wf:'});assert(keys.keys.some(k=>k.name.startsWith('wf:account:')),'Pot is also stored in isolated KV');assert(keys.keys.filter(k=>k.name.startsWith('wf:event:')).length>=4,'KV retains each movement');
 console.log('PASS real paper Worker: secure isolated sessions, exact/concurrent seeds, idempotent transfer, source cash debit, cross-session duplicate denial, KV journal persistence, atomic quote-only purchases, failed/expired quote rollback, current-price marks, vault deposits and whole-profit rules');
}finally{await mf.dispose();}
