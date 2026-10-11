import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(join(process.cwd(),'execution/package.json'));
const {PublicKey}=require('@solana/web3.js');
const key=n=>new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const owner=key(1),poolAddress=key(2),positionAddress=key(3),otherPosition=key(4),mint=key(5),SOL='So11111111111111111111111111111111111111112';
const dir=await mkdtemp(join(tmpdir(),'still-wallet-'));
const banner={js:"import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {dirname} from 'node:path';const require=createRequire(import.meta.url),__filename=fileURLToPath(import.meta.url),__dirname=dirname(__filename);"};
const realFetch=globalThis.fetch;
try {
  for(const [name,entry] of [['wallet','src/still-wallet.ts'],['reader','execution/still-wallet-reader.ts']])await build({entryPoints:[entry],outfile:join(dir,name+'.mjs'),bundle:true,platform:'node',format:'esm',mainFields:['main'],banner});
  const {readStillWallet,readStillWalletPosition,buildWalletPaperPreflight,readWalletExitQuote,walletChecks}=await import(join(dir,'wallet.mjs'));
  const {normaliseWalletBins,walletPublicKey}=await import(join(dir,'reader.mjs'));
  const now=Date.now(),at=new Date(now).toISOString();
  const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
  const fixture={address:owner,poolAddress,positionAddress,owner,positionPool:poolAddress,mintX:mint,mintY:SOL,decX:9,decY:9,binStep:100,activeId:0,priceYX:1,lowerBinId:-1,upperBinId:1,totalXRaw:'1500000000',totalYRaw:'1500000000',withdrawableXRaw:'1500000000',withdrawableYRaw:'1500000000',feeXRaw:'1000000',feeYRaw:'2000000',feesOwned:true,bins:[
    {binId:-1,pricePerToken:String(1/1.01),positionXAmount:'0',positionYAmount:'1000000000'},
    {binId:0,pricePerToken:'1',positionXAmount:'500000000',positionYAmount:'500000000'},
    {binId:1,pricePerToken:'1.01',positionXAmount:'1000000000',positionYAmount:'0'},
  ],asOf:at,modelSupported:true,policyNote:'Fixture token has no transfer fee.',transferFeeBps:0,transferFeeChangeable:false};
  const read=normaliseWalletBins(fixture,now);close(read.valueSol,3);close(read.feesSol,.003);close(read.floorPriceSol,1/1.01);close(read.topPriceSol,1.01);
  assert.equal(read.pairedRaw,'1500000000');assert.equal(read.pairedWithdrawableRaw,'1500000000');
  const reversed=normaliseWalletBins({...fixture,mintX:SOL,mintY:mint,totalXRaw:fixture.totalYRaw,totalYRaw:fixture.totalXRaw,feeXRaw:fixture.feeYRaw,feeYRaw:fixture.feeXRaw,bins:fixture.bins.map(b=>({...b,binId:-b.binId,pricePerToken:String(1/Number(b.pricePerToken)),positionXAmount:b.positionYAmount,positionYAmount:b.positionXAmount}))},now);
  close(reversed.valueSol,read.valueSol);close(reversed.feesSol,read.feesSol);close(reversed.floorPriceSol,read.floorPriceSol);close(reversed.topPriceSol,read.topPriceSol);
  for(const change of [{owner:key(6)},{positionPool:key(6)},{mintY:key(6)},{asOf:new Date(now-60001).toISOString()},{asOf:new Date(now+1).toISOString()},{totalXRaw:'1500000001'},{withdrawableXRaw:'1500000001'},{bins:fixture.bins.slice(1)},{bins:[fixture.bins[0],fixture.bins[0],fixture.bins[2]]},{bins:fixture.bins.map((b,i)=>i?b:{...b,pricePerToken:'42'})}])assert.throws(()=>normaliseWalletBins({...fixture,...change},now));
  assert.equal(normaliseWalletBins({...fixture,feesOwned:false},now).feesSol,null);
  assert.throws(()=>walletPublicKey('not-an-address'));assert.equal(walletPublicKey(owner),owner);

  let serverWrites=0,providerCalls=0;
  const env={LP_CACHE:{get:async()=>{throw Error('Wallet data must not use server KV');},put:async()=>{serverWrites++;throw Error('No wallet persistence');}},SOLANA_RPC:'https://api.mainnet-beta.solana.com'};
  const row={poolAddress,tokenXMint:mint,tokenYMint:SOL,tokenX:'TEST',tokenY:'SOL',openPositionCount:2,listPositions:[positionAddress,otherPosition],positionsOutOfRange:[otherPosition],poolPrice:1};
  const indexDetails=[{positionAddress,isClosed:false,minPrice:'0.9',maxPrice:'1.1',isOutOfRange:false,unrealizedPnl:{balances:12,unclaimedFeeTokenX:{usd:1},unclaimedFeeTokenY:{usd:2}}},{positionAddress:otherPosition,isClosed:false,minPrice:'1.2',maxPrice:'1.4',isOutOfRange:true,unrealizedPnl:{balances:34,unclaimedFeeTokenX:{usd:3},unclaimedFeeTokenY:{usd:4}}}];
  const response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
  globalThis.fetch=async (url,init)=>{providerCalls++;assert.equal(init.redirect,'manual');return response(String(url).includes('/portfolio/open')?{hasNext:false,pools:[row]}:{hasNext:false,positions:indexDetails});};
  let index=await readStillWallet(env,owner);
  assert.equal(index.status,'available');assert.equal(index.positions.length,2);assert.deepEqual(index.positions.map(p=>p.valueUsd),[12,34]);assert.deepEqual(index.positions.map(p=>p.feesEarnedUsd),[3,7]);assert.deepEqual(index.positions.map(p=>p.inRange),[true,false]);assert.notEqual(index.positions[0].positionAddress,index.positions[1].positionAddress);assert.equal(serverWrites,0);
  globalThis.fetch=async url=>response(String(url).includes('/portfolio/open')?{hasNext:false,pools:[row]}:{hasNext:false,positions:[]});
  index=await readStillWallet(env,owner);assert.equal(index.status,'partial');assert.equal(index.positions.length,2);assert(index.positions.every(p=>p.valueUsd===null&&p.feesEarnedUsd===null));
  globalThis.fetch=async()=>response({hasNext:false,pools:[{...row,listPositions:[positionAddress,positionAddress]}]});
  index=await readStillWallet(env,owner);assert.equal(index.status,'unavailable');assert.deepEqual(index.positions,[]);
  globalThis.fetch=async()=>response({hasNext:false,pools:[]});
  index=await readStillWallet(env,owner);assert.equal(index.status,'available');assert.deepEqual(index.positions,[]);
  globalThis.fetch=async (_url,init)=>{assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.invalid/redirect'}});};
  index=await readStillWallet(env,owner);assert.equal(index.status,'unavailable','Redirects are rejected rather than followed with a wallet address');

  const pool={id:'solana:'+poolAddress,address:poolAddress,chain:'solana',venue:'meteora-dlmm',pair:'TEST/SOL',base:{address:mint,symbol:'TEST'},quote:{address:SOL,symbol:'SOL'},fetchedAt:at,tvlUsd:200000,ageHours:240,priceQuote:1,priceUsd:100,quotePriceUsd:100,feeSource:'reported',fees24hUsd:24000,volume24hUsd:10000000,feeTvl:{h1:.005,mid:.02,midHours:4,h24:.12},activity:{fees1h:1000,fees4h:4000,fees12h:12000,volume1h:400000},poolConfig:{binStep:100,concentrated:true,feeSchedulerActive:false,compoundingFeePct:0,launchpad:null},tags:[],feeTier:.0025,feeApr:40,change24h:null,txns24h:null,url:'https://meteora.ag/dlmm/'+poolAddress};
  const end=Math.floor(now/3600000)*3600,candles={status:'available',asOf:at,unit:'SOL per token',note:'Exact-pool Meteora candles',candles:Array.from({length:24},(_,i)=>({t:end-(24-i)*3600,o:1,c:1,h:1.002,l:.998,v:10}))};
  const quoted={status:'available',inputRaw:read.pairedWithdrawableRaw,inputMint:mint,outputSol:1.499,costSol:.001,asOf:at,source:'Fixture Jupiter exact input',note:'Actual principal only. Excludes LP network costs.'};
  const deps={readBins:async()=>read,pool:async()=>pool,candles:async()=>candles,now:()=>now,quote:async()=>quoted};
  let detail=await readStillWalletPosition(env,owner,poolAddress,positionAddress,deps);
  assert.equal(detail.canPractise,true);assert.equal(detail.status,'available');assert.equal(detail.feeRateHourly,.005);assert.deepEqual(detail.checks.map(c=>[c.id,c.status]),[['fees','pass'],['cost','pass'],['floor','pass']]);
  let paper=buildWalletPaperPreflight(detail,.5,now);
  assert.equal(paper.canOpen,true);assert.equal(paper.range.shape,'Observed wallet allocation');close(paper.range.floorPriceSol,detail.floorPriceSol);close(paper.range.topPriceSol,detail.topPriceSol);assert.deepEqual(paper.ledger.bins.map(b=>b.nativeBinId),read.bins.map(b=>b.nativeBinId));
  close(paper.ledger.bins.reduce((s,b)=>s+b.sol+b.token*paper.priceSol.value,0),.5);
  for(let i=0;i<read.bins.length;i++){close(paper.ledger.bins[i].sol,read.bins[i].sol/6);close(paper.ledger.bins[i].token,read.bins[i].token/6);}
  assert.equal(paper.entryCostSol.value,null);assert.equal(paper.exitCostSol.value,null);assert.equal(paper.ledger.exitCostsSol,null);assert.equal(paper.paperCostModel.netAfterHoldSol.value,null);assert(paper.checks.some(c=>c.id==='cost'&&c.status==='unavailable'));
  assert.match(paper.range.note,/No original strategy shape is inferred/);
  for(const change of [{asOf:new Date(now-60001).toISOString()},{canPractise:false},{rangeBinCount:70},{valueSol:99},{bins:detail.bins.slice(1)},{bins:detail.bins.map((b,i)=>i?b:{...b,nativeBinId:123})},{floorPriceSol:.1}])assert.throws(()=>buildWalletPaperPreflight({...detail,...change},.5,now));
  assert.throws(()=>buildWalletPaperPreflight(detail,100,now));
  const wrong=await readStillWalletPosition(env,owner,poolAddress,positionAddress,{...deps,readBins:async()=>({...read,address:key(6)})});assert.equal(wrong.status,'unavailable');assert.equal(wrong.canPractise,false);
  const long=await readStillWalletPosition(env,owner,poolAddress,positionAddress,{...deps,readBins:async()=>({...read,rangeBinCount:70})});assert.equal(long.canPractise,false);assert.equal(long.status,'available');
  const unsupported=await readStillWalletPosition(env,owner,poolAddress,positionAddress,{...deps,readBins:async()=>({...read,modelSupported:false})});assert.equal(unsupported.canPractise,false);
  const noCandle=walletChecks({...detail,candles:null},now);assert.equal(noCandle.find(c=>c.id==='floor').status,'unavailable');

  let reservations=0,cooldowns=0,quoteRequests=0;
  const quoteEnv={...env,RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:async req=>{if(String(req.url).includes('/cooldown')){cooldowns++;return response({recorded:true,retryAt:Date.now()+30000});}reservations++;return response({allowed:true,reason:'allowed',retryAt:null});}})}};
  globalThis.fetch=async (url,init)=>{quoteRequests++;assert.equal(init.redirect,'manual');const q=new URL(url).searchParams;assert.equal(q.get('inputMint'),mint);assert.equal(q.get('outputMint'),SOL);assert.equal(q.get('amount'),'1490000000');return response({inputMint:mint,outputMint:SOL,inAmount:'1490000000',outAmount:'1489000000',routePlan:[{swapInfo:{ammKey:poolAddress}}]});};
  let exit=await readWalletExitQuote(quoteEnv,{...read,pairedWithdrawableRaw:'1490000000'});
  assert.equal(exit.status,'available');close(exit.outputSol,1.489);close(exit.costSol,.011);assert.equal(reservations,1);assert.equal(quoteRequests,1);assert.equal(serverWrites,0);assert.match(exit.note,/Excludes unclaimed fees/);
  const calls=quoteRequests;
  exit=await readWalletExitQuote(quoteEnv,{...read,pairedRaw:'0',pairedWithdrawableRaw:'0'});assert.equal(exit.status,'available');assert.equal(exit.costSol,0);assert.equal(quoteRequests,calls,'Verified zero inventory needs no fabricated quote');
  globalThis.fetch=async()=>response({inputMint:mint,outputMint:SOL,inAmount:'1',outAmount:'1489000000',routePlan:[{swapInfo:{ammKey:poolAddress}}]});
  exit=await readWalletExitQuote(quoteEnv,read);assert.equal(exit.status,'unavailable','Foreign input amount cannot quote this inventory');
  globalThis.fetch=async()=>new Response('{}',{status:429});exit=await readWalletExitQuote(quoteEnv,read);assert.equal(exit.status,'unavailable');assert.equal(cooldowns,1);
  globalThis.fetch=async (_url,init)=>{assert.equal(init.redirect,'manual');return new Response(null,{status:307,headers:{location:'https://untrusted.invalid/quote'}});};
  exit=await readWalletExitQuote(quoteEnv,read);assert.equal(exit.status,'unavailable','Quote redirects cannot forward amount or API credentials');
  exit=await readWalletExitQuote({...env,RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:async()=>response({allowed:false,reason:'cooldown',retryAt:Date.now()+30000})})}},read);assert.equal(exit.status,'unavailable');
  const readerSource=await readFile('execution/still-wallet-reader.ts','utf8');
  assert.doesNotMatch(readerSource,/from ['"]\.\/solana['"]|signTransaction|sendTransaction|simulateTransaction|initializePosition|removeLiquidity/);
  assert.match(readerSource,/paperRpcTransport/);
  // Exercise the real Workers fetch parser: Node accepts redirect:'error', but
  // Workers reject it before any outbound request. All providers stay mocked.
  globalThis.fetch=realFetch;
  const compiled=await build({stdin:{contents:`
    import {readStillWallet,readWalletExitQuote} from './src/still-wallet';
    const env={LP_CACHE:{get:async()=>{throw Error('No wallet cache');},put:async()=>{throw Error('No wallet cache');}},
      RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:async()=>Response.json({allowed:true,reason:'allowed',retryAt:null})})}};
    export default {async fetch(req){
      if(new URL(req.url).pathname==='/quote')return Response.json(await readWalletExitQuote(env,{...${JSON.stringify(read)},asOf:new Date().toISOString()}));
      return Response.json(await readStillWallet(env,'${SOL}'));
    }};
  `,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'esm',platform:'browser',write:false,alias:{util:'./tests/fixtures/worker-util.mjs'}});
  let runtimeMode='empty',runtimeReads=0;
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'still-wallet-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
    runtimeReads++;const url=new URL(request.url);
    assert.equal(request.method,'GET');
    if(runtimeMode==='redirect')return new Response(null,{status:302,headers:{location:'https://untrusted.invalid/redirect'}});
    if(url.origin==='https://dlmm.datapi.meteora.ag'){
      assert.equal(url.pathname,'/portfolio/open');assert.equal(url.searchParams.get('user'),SOL);
      return Response.json({page:1,pageSize:50,hasNext:false,totalCount:0,totalPositions:0,pools:[]});
    }
    assert.equal(url.origin,'https://api.jup.ag');assert.equal(url.pathname,'/swap/v1/quote');
    assert.equal(url.searchParams.get('amount'),read.pairedWithdrawableRaw);
    return Response.json({inputMint:mint,outputMint:SOL,inAmount:read.pairedWithdrawableRaw,outAmount:'1499000000',routePlan:[{swapInfo:{ammKey:poolAddress}}]});
  }}]}));
  try {
    await mf.ready;
    const wallet=await mf.dispatchFetch('https://still.test/wallet').then(r=>r.json());
    assert.equal(wallet.status,'available','Production wallet parser reads a valid empty portfolio in workerd');assert.deepEqual(wallet.positions,[]);assert.equal(runtimeReads,1);
    const quoted=await mf.dispatchFetch('https://still.test/quote').then(r=>r.json());
    assert.equal(quoted.status,'available','Actual-inventory quote reaches the provider in workerd');assert.equal(quoted.outputSol,1.499);assert.equal(runtimeReads,2);
    runtimeMode='redirect';
    assert.equal((await mf.dispatchFetch('https://still.test/wallet').then(r=>r.json())).status,'unavailable');
    assert.equal((await mf.dispatchFetch('https://still.test/quote').then(r=>r.json())).status,'unavailable');
    assert.equal(runtimeReads,4,'Each manual redirect is rejected after one request; no follow-up leaks');
  } finally {await mf.dispose();}
  console.log('PASS: read-only wallet identities, exact bins, both SOL orientations, indexed accounting, bounded fallbacks, quote amounts/budget and paper-copy isolation');
} finally {globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true});}
