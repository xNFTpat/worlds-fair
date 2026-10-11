import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'still-park-preview-'));
const realFetch=globalThis.fetch,realNow=Date.now;
try {
  await build({entryPoints:['src/still-park.ts','src/still-paper.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
  const {stillParkData}=await import(join(dir,'still-park.mjs'));
  const {StillPaperLedger}=await import(join(dir,'still-paper.mjs'));
  const now=Date.UTC(2026,9,11,16),at=new Date(now).toISOString(),SOL='So11111111111111111111111111111111111111112',mint='T'.repeat(32);
  Date.now=()=>now;
  let calls=0,writes=0,reads=[];
  globalThis.fetch=async()=>{calls++;throw Error('A cached Grow preview must not request quotes or RPC');};
  const pools=[...'ABCDEFGHJKLM'].map(letter=>({id:'solana:'+letter.repeat(32),address:letter.repeat(32),chain:'solana',venue:'meteora-dlmm',pair:'TEST/SOL',base:{address:mint,symbol:'TEST'},quote:{address:SOL,symbol:'SOL'},fetchedAt:at,tvlUsd:200000,ageHours:240,priceQuote:.01,priceUsd:1,quotePriceUsd:100,feeSource:'reported',fees24hUsd:4800,volume24hUsd:2400000,activity:{volume1h:100000,fees1h:1200,fees4h:4800,fees12h:14400},poolConfig:{binStep:100},tags:[]}));
  let snapshot={updatedAt:at,pools,errors:{}};
  const rpc={status:'available',asOf:at,mint,decimals:6,transferFeeStatus:'none',transferFee:null,freezeAuthority:null,
    holderSample:{status:'available',asOf:at,mint,supplyRaw:'1000',complete:true,accounts:Array.from({length:40},(_,i)=>({address:'account-'+i,owner:'owner-'+i,amountRaw:'25'}))}};
  const candles={status:'available',asOf:at,note:'Synthetic exact-pool Meteora candles',candles:Array.from({length:24},(_,i)=>({t:now/1000-(24-i)*3600,o:.01,c:.01,h:.0105,l:.0095,v:100}))};
  const quote={tokenDecimals:6,tokenRaw:'25000000',returnedSol:.249,priceMark:{source:'active-bin',priceSol:.01,asOf:at},mode:'best',sizeSol:.25,status:'quoted',asOf:at,buyAsOf:at,sellAsOf:at,expiresAt:now+45000,exitFeeSource:'jupiter-route',exitCostSol:.001,verifiedExitSwapSol:.001,roundTripCostSol:.002};
  const network={asOf:at,singleLamports:5000,doubleLamports:10000,source:'Synthetic RPC fees'};
  const input=pool=>({accountCosts:{asOf:at,poolAddress:pool.address,positionBytes:8120,positionRentLamports:57406080,setupRentLamports:0,missingAccounts:0,rangeKey:'-1'},rangeAnchor:{status:'available',asOf:at,activeBinId:0,activeBinPriceSol:.01,binStep:100,minNativeBinId:-10000,maxNativeBinId:10000},pool,safety:{rpc},candles,quotes:[quote],network,rug:{mint,status:'available',asOf:at,holderExclusions:{mint,status:'available',asOf:at,addresses:[]}}});
  let cacheMode='fresh';
  const env={LP_CACHE:{async get(key){
    reads.push(key);
    if(key==='snapshot:v1')return snapshot;
    if(key==='cesto:v1:/products')return {readAt:now,data:[]};
    if(key==='cesto:v1:/products/analytics')return {readAt:now,data:{}};
    if(key.startsWith('long-game:v1:'))return {readAt:at,items:[]};
    const pool=pools.find(p=>key==='still:preflight-input:v5:'+p.address+':500000000:null');
    if(!pool||cacheMode==='missing')return null;
    const detail=input(pool);
    if(cacheMode==='expired-quote')detail.quotes=[{...quote,expiresAt:now-1}];
    return {at:cacheMode==='expired-wrapper'?new Date(now-45001).toISOString():at,input:detail};
  },async put(){writes++;throw Error('Grow pool previews must not write evidence');}}};
  let result=await stillParkData(env);
  assert.equal(result.pools.length,3,'Only three passing preview choices are presented');
  assert.equal(reads.filter(k=>k.startsWith('still:preflight-input:')).length,8,'At most eight exact cache reads screen the shortlist');
  assert.equal(reads.filter(k=>k==='snapshot:v1').length,1,'The market snapshot is read once');
  assert(result.pools.every(p=>p.sizeSol===.5&&p.scope==='0.5 paper SOL · default range'&&p.asOf===at));
  assert.match(result.poolNote,/Confirming rechecks fresh evidence at your actual pool allocation/);
  assert.deepEqual(result.basketPreviews,[]);
  assert.equal(calls,0);assert.equal(writes,0);
  for(const mode of ['missing','expired-wrapper','expired-quote']){
    cacheMode=mode;reads=[];result=await stillParkData(env);
    assert.deepEqual(result.pools,[],mode+' never promotes unavailable evidence to a passing destination');
    assert.equal(reads.filter(k=>k.startsWith('still:preflight-input:')).length,8);
    assert.equal(calls,0);assert.equal(writes,0);
  }
  snapshot=null;reads=[];result=await stillParkData(env);
  assert.deepEqual(result.pools,[]);assert.equal(reads.filter(k=>k.startsWith('still:preflight-input:')).length,0);
  assert.equal(calls,0,'A cold market cache does not trigger the snapshot provider refresh');

  // A passing default-size preview is only discovery. The real ledger must
  // still request a live check at the selected split and reject a weak result.
  const store=new Map(),storage={async get(key){return structuredClone(store.get(key));},async put(key,value){for(const [k,v]of Object.entries(typeof key==='string'?{[key]:value}:key))store.set(k,structuredClone(v));}};
  let queue=Promise.resolve();const ctx={storage,blockConcurrencyWhile(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}};
  const checks=[];
  const ledger=new StillPaperLedger(ctx,env,{now:()=>now,id:()=> 'preview-fixture',preflight:async(...args)=>{checks.push(args);return {verdict:{label:'Marginal',reason:'Actual allocation costs unavailable'}};}});
  const rejection=await ledger.handle('a'.repeat(64),'still-park',{requestId:'preview-confirm-001',confirmed:true,mode:'example',split:[40,0,60],poolAddress:pools[0].address,basketSlug:null,vaultId:'fixture-vault'});
  assert.equal(rejection.status,409,'Cached discovery cannot authorize a deposit after the fresh size check fails');
  assert.equal(checks.length,1);assert.equal(checks[0][1],pools[0].address);assert.equal(checks[0][2],.4);assert.equal(checks[0][3],undefined);assert.equal(checks[0][4],true);
  const account=await ledger.handle('a'.repeat(64),'still-account',{}).then(r=>r.json());
  assert.equal(account.account.park.exampleRemainingLamports,1e9);assert.equal(account.account.park.records.length,0);assert.equal(account.account.positions.length,0);
  assert.equal(calls,0);assert.equal(writes,0);
  console.log('PASS Grow previews: eight bounded exact cache reads, no RPC/quotes or cold-cache refresh, expired evidence unavailable, actual-size live confirmation still required.');
} finally {globalThis.fetch=realFetch;Date.now=realNow;await rm(dir,{recursive:true,force:true});}
