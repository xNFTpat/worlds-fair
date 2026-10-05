import {backyardVaults} from './fixtures/synthetic-public-data.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'worldsfair-vaults-'));
for(const [name,file] of [['vaults','src/worldsfair-paper-vaults.ts'],['math','src/worldsfair-vault-math.ts'],['ideas','src/long-game.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {preparePaperVaultDeposit,accruePaperVault,PaperVaultError}=await import(join(dir,'vaults.mjs'));
const {linearVaultEstimate,VAULT_YEAR_MS:YEAR}=await import(join(dir,'math.mjs'));
const {normalizeBackyard,normalizeStaking}=await import(join(dir,'ideas.mjs'));
const SOL='So11111111111111111111111111111111111111112',A='USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const originalFetch=globalThis.fetch,realNow=Date.now;
let clock=Date.UTC(2026,9,5,12),calls=[],key=false,sourceFault=null,quoteFault=null,rpcFault=null,priceFault=null,budget=true;
Date.now=()=>clock;
const openedAt=new Date(clock).toISOString();
assert.deepEqual(linearVaultEstimate('1000000000',9,5,openedAt,clock+YEAR),{principalUnits:1,accruedUnits:.05,estimatedUnits:1.05,elapsedYears:1});
assert.equal(linearVaultEstimate('1000000000',9,5,openedAt,clock+2*YEAR).estimatedUnits,1.1,'APY source must not compound into1.1025');
assert.equal(linearVaultEstimate('1000000000',9,5,openedAt,clock-YEAR).accruedUnits,0,'clock before deposit clamps to zero');
assert.equal(linearVaultEstimate('1',18,0,openedAt,clock+YEAR).estimatedUnits,1e-18);
for(let i=1;i<=500;i+=7){const raw=String(i*123456),rate=i/7,years=i/100;const value=linearVaultEstimate(raw,6,rate,openedAt,clock+YEAR*years);const expected=Number(raw)/1e6*(1+rate/100*years);assert.ok(Math.abs(value.estimatedUnits-expected)<=Math.max(1,expected)*1e-12,'linear original-principal formula');assert.ok(value.accruedUnits>=0);}
for(const args of [['0',9,5,openedAt,clock],['NaN',9,5,openedAt,clock],['18446744073709551616',9,5,openedAt,clock],['1'.repeat(10000),9,5,openedAt,clock],['1000',null,5,openedAt,clock],['1000',19,5,openedAt,clock],['1000',9,-1,openedAt,clock],['1000',9,Infinity,openedAt,clock],['1000',9,5,'bad',clock],['1000',9,5,openedAt,Infinity],['18446744073709551615',0,Number.MAX_VALUE,openedAt,clock+YEAR]])assert.equal(linearVaultEstimate(...args),null,'invalid or overflowing inputs never become earnings');
const fixtures=backyardVaults,normal=normalizeBackyard(fixtures);
assert.equal(normal[0].inputTokenMint,fixtures[0].inputTokenMint);assert.equal(normal[0].inputTokenDecimals,6);assert.equal(normal[0].assetPriceUsd,1.02);assert.equal(normal[0].depositEnabled,true);
const malformed=normalizeBackyard([{id:'bad',name:'Bad',inputTokenDecimals:true,inputTokenMint:'invalid',assetPrice:'',apy:1}])[0];assert.equal(malformed.inputTokenDecimals,null);assert.equal(malformed.inputTokenMint,null);assert.equal(malformed.assetPriceUsd,null);assert.equal(malformed.depositEnabled,null);
class KV{values=new Map();puts=0;async get(k,type){const value=this.values.get(k);return value==null?null:type==='json'?JSON.parse(value):value;}async put(k,v){if(k.startsWith('paper-jupiter:v1:'))return;this.puts++;this.values.set(k,v);}}
const kv=new KV(),json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const env=()=>({LP_CACHE:kv,...(key?{JUPITER_API_KEY:'vault-fixture-key'}:{}),SOLANA_RPC:'https://rpc.test',RANGE_ALERTS:{idFromName:name=>name,get:()=>({fetch:async req=>{calls.push({host:'budget',path:new URL(req.url).pathname,method:req.method});return json({allowed:budget,reason:budget?'allowed':'budget',retryAt:null});}})}});
const staking=()=>({data:[{project:'jito-liquid-staking',chain:'Solana',symbol:'JITOSOL',apy:sourceFault==='rate'?null:5,isDepositDisabled:sourceFault==='disabled'}]});
const backyard=()=>[{id:'fixture',name:'Fixture USDS',inputTokenSymbol:'USDS',inputTokenMint:sourceFault==='mint'?'invalid':A,inputTokenDecimals:sourceFault==='decimals'?'7':'6',apy:sourceFault==='rate'?null:'5',assetPrice:'1',isDepositDisabled:sourceFault==='disabled'?true:sourceFault==='enabled-unknown'?undefined:false}];
globalThis.fetch=async(input,init={})=>{
 const url=new URL(input),method=init.method||'GET';calls.push({host:url.hostname,path:url.pathname,method});
 assert.ok(!/(?:swap-instructions|sendTransaction|execute|\/swap$|\/build$)/.test(url.pathname),'vaults never construct/sign/send transactions');
 if(['yields.llama.fi','alpha.api.backyard.finance'].includes(url.hostname)){
  assert.equal(method,'GET');assert.ok(['/pools','/vaults'].includes(url.pathname));
  if(sourceFault==='http')return new Response('unavailable',{status:503});
  if(sourceFault==='timeout'){clock+=26000;throw Error('timeout');}
  return json(url.hostname==='yields.llama.fi'?staking():backyard());
 }
 if(url.hostname==='rpc.test'){
  assert.equal(method,'POST');const body=JSON.parse(init.body);
  if(Array.isArray(body))return json(body.map(r=>{assert.equal(r.method,'getBlockTime');return {id:r.id,result:Math.floor(clock/1000)+(quoteFault==='old-slot'?-46:quoteFault==='future-slot'?1:priceFault==='stale'?-301:-2)};}));
  assert.equal(body.method,'getMultipleAccounts');assert.deepEqual(body.params[0],[A]);
  return json({result:{value:[{owner:rpcFault==='owner'?A:PROGRAM,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:rpcFault==='decimals'?7:6}}}}]}});
 }
 if(url.hostname==='api.jup.ag'){
  assert.equal(method,'GET');assert.equal(init.headers['x-api-key'],key?'vault-fixture-key':undefined);if(!key)assert.equal(Object.hasOwn(init.headers,'x-api-key'),false);
  if(url.pathname==='/price/v3'){
   if(priceFault==='timeout'){clock+=26000;throw Error('optional timeout');}
   if(priceFault==='delay')clock+=2000;
   if(priceFault==='missing')return json({});
   return json(Object.fromEntries(url.searchParams.get('ids').split(',').map(mint=>[mint,{usdPrice:mint===SOL?100:1.1,decimals:mint===SOL?9:6,blockId:1000000,createdAt:'2020-01-01T00:00:00Z'}])));
  }
  assert.equal(url.pathname,'/swap/v1/quote');assert.equal(url.searchParams.get('inputMint'),SOL);assert.equal(url.searchParams.get('outputMint'),A);assert.equal(url.searchParams.get('swapMode'),'ExactIn');
  if(quoteFault==='http')return new Response('unavailable',{status:503});
  return json({inputMint:SOL,outputMint:quoteFault==='mint'?SOL:A,inAmount:quoteFault==='amount'?'1':url.searchParams.get('amount'),outAmount:quoteFault==='units'?'0':'98765432',otherAmountThreshold:'98000000',swapMode:'ExactIn',slippageBps:50,priceImpactPct:quoteFault==='impact'?'99':'.01'.replace(/^\./,'0.'),routePlan:[{}],contextSlot:1000000});
 }
 throw Error('Unexpected provider '+url.href+'; no Lido/Cesto/global catalogue fan-out allowed');
};
try{
 const native=await preparePaperVaultDeposit(env(),{ideaId:'jito-liquid-staking',amountSol:'1.000000001'});
 assert.equal(native.amountLamports,1000000001);assert.equal(native.principalUnitsRaw,'1000000001');assert.equal(native.asset,'SOL');assert.equal(native.mint,SOL);assert.equal(native.decimals,9);assert.equal(native.basis,'native-sol');assert.equal(native.rateAsOf,null);assert.equal(native.rateReadAt,new Date(clock).toISOString());assert.equal(native.entrySolUsd,100);assert.ok(native.expiresAt>clock);assert.equal(calls.filter(c=>c.host==='yields.llama.fi').length,1,'native staking reads its selected rate provider');assert.ok(!calls.some(c=>c.path==='/swap/v1/quote'),'native SOL never requires a conversion quote');assert.ok(native.note.includes('no LST'));
 const holding={...native,id:'vault1',openedAt:native.preparedAt};const accrual=accruePaperVault(holding,clock+YEAR);assert.equal(accrual.label,'estimate at quoted rate');assert.equal(accrual.status,'estimated');assert.ok(Math.abs(accrual.estimatedUnits-1.000000001*1.05)<1e-12);assert.equal(accruePaperVault({...holding,principalUnitsRaw:'NaN'},clock).status,'unavailable');
 await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'lido-steth',amountSol:'1'}),e=>e.code==='vault_invalid');
 for(const amount of ['0','-1','1e3','0.0000000001'])await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'jito-liquid-staking',amountSol:amount}),e=>e.code==='vault_invalid');
 for(const fault of ['rate','disabled']){sourceFault=fault;await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'jito-liquid-staking',amountSol:'1'}),e=>e.code==='vault_unavailable');}sourceFault=null;
 const freshStaking={items:normalizeStaking(staking()),readAt:new Date(clock-1000).toISOString()};kv.values.set('long-game:v1:Solana staking',JSON.stringify(freshStaking));const beforeCache=calls.filter(c=>c.host==='yields.llama.fi').length;await preparePaperVaultDeposit(env(),{ideaId:'jito-liquid-staking',amountSol:'1'});assert.equal(calls.filter(c=>c.host==='yields.llama.fi').length,beforeCache,'fresh selected-source evidence reused');kv.values.clear();
 const publicVault=await preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'});assert.equal(publicVault.principalUnitsRaw,'98765432','keyless conversion preserves verified raw units');key=true;
 const oldShape={...normalizeBackyard(backyard())[0]};delete oldShape.inputTokenMint;delete oldShape.inputTokenDecimals;delete oldShape.depositEnabled;kv.values.set('long-game:v1:Backyard',JSON.stringify({items:[oldShape],readAt:new Date(clock).toISOString()}));const beforeRefetch=calls.filter(c=>c.host==='alpha.api.backyard.finance').length;
 const vault=await preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'});assert.equal(calls.filter(c=>c.host==='alpha.api.backyard.finance').length,beforeRefetch+1,'old fresh cache shape requires metadata refetch');kv.values.clear();
 assert.equal(vault.amountLamports,1000000000);assert.equal(vault.principalUnitsRaw,'98765432');assert.equal(vault.decimals,6);assert.equal(vault.rate,5);assert.equal(vault.basis,'quoted-token');assert.equal(vault.priceImpactFraction,.01);assert.equal(vault.assetPriceUsd,1.1,'uses block-dated market evidence rather than assuming stablecoin peg');assert.equal(vault.entrySolUsd,100);assert.equal(vault.quoteAsOf,new Date(clock-2000).toISOString());
 assert.ok(Math.abs(accruePaperVault({...vault,id:'vault2',openedAt:vault.preparedAt},clock+2*YEAR).estimatedUnits-98.765432*1.1)<1e-12);
 for(const fault of ['disabled','enabled-unknown','rate','mint','decimals']){sourceFault=fault;await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code.startsWith('vault_'));}sourceFault=null;
 for(const fault of ['mint','amount','units','impact','http','old-slot','future-slot']){quoteFault=fault;await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code.startsWith('vault_quote'));}quoteFault=null;
 for(const fault of ['owner','decimals']){rpcFault=fault;await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code.startsWith('vault_mint'));}rpcFault=null;
 budget=false;await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code==='vault_quote_budget');budget=true;
 for(const fault of ['missing','timeout']){priceFault=fault;const value=await preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'});assert.equal(value.assetPriceUsd,null);assert.equal(value.entrySolUsd,null);assert.ok(value.expiresAt>clock,'optional dollar marks cannot prevent fresh deposit');}priceFault=null;
 const expiringRate={...normalizeBackyard(backyard())[0],rateAsOf:new Date(clock-3599000).toISOString()};kv.values.set('long-game:v1:Backyard',JSON.stringify({items:[expiringRate],readAt:new Date(clock).toISOString()}));priceFault='delay';await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code==='vault_quote_expired','59m59s published rate expires during a two-second optional read');priceFault=null;kv.values.clear();
 for(const age of [3600001,-1000]){kv.values.set('long-game:v1:Backyard',JSON.stringify({items:normalizeBackyard(backyard()),readAt:new Date(clock-age).toISOString()}));sourceFault='http';await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'backyard:fixture',amountSol:'1'}),e=>e.code==='vault_provider_unavailable','stale/future cache cannot rescue failed source');sourceFault=null;}kv.values.clear();
 sourceFault='timeout';await assert.rejects(preparePaperVaultDeposit(env(),{ideaId:'jito-liquid-staking',amountSol:'1'}),e=>e.code==='vault_provider_timeout');sourceFault=null;
 assert.equal(kv.puts,0,'provider preparation does not persist or debit ledger money');
 console.log('PASS vault providers/math: selected fresh Solana sources, enabled-state evidence, retained mint metadata, native SOL without key, verified conversion units/quotes, optional prices, linear original-principal accrual, no transaction calls');
}finally{globalThis.fetch=originalFetch;Date.now=realNow;}
