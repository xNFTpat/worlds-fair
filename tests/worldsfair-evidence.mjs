import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const dir=await mkdtemp(join(tmpdir(),'worldsfair-evidence-'));
for(const [name,file] of [['research','src/lp-research.ts'],['reads','src/sources/research-reads.ts']])await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {researchPreflightEvidence,researchFeeRates}=await import(pathToFileURL(join(dir,'research.mjs')));
const {researchReadContext,readMintSafety,readRugSafety}=await import(pathToFileURL(join(dir,'reads.mjs')));
const require=createRequire(import.meta.url),{web3}=require('../execution/node_modules/@meteora-ag/dlmm/node_modules/@coral-xyz/anchor');
const pk=n=>new web3.PublicKey(Uint8Array.from({length:32},(_,i)=>(n*31+i)%256)).toBase58();
const now=Date.UTC(2026,9,5,12),HOUR=3600000,iso=n=>new Date(n).toISOString(),mint=pk(1),SOL='So11111111111111111111111111111111111111112',program='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const pool={chain:'solana',venue:'meteora-dlmm',address:pk(2),base:{address:mint},quote:{address:SOL},priceQuote:1,ageHours:48,fetchedAt:iso(now),tvlUsd:1000,fees24hUsd:48,activity:{fees1h:3,fees4h:8,fees12h:12},feeTvl:{h24:.048}};
class KV{values=new Map();async get(k,type){const value=this.values.get(k);return value==null?null:type==='json'?JSON.parse(value):value;}async put(k,v){this.values.set(k,v);}}
const originalFetch=globalThis.fetch,originalNow=Date.now;
const amounts=[250,100,50,50,80,70,90,60,40,10];
const accounts=amounts.map((amount,i)=>({address:pk(10+i),owner:pk(i===5?104:100+i),amount:String(amount)}));
const report={mint,score:0,risks:[],detectedAt:iso(now-96*HOUR),knownAccounts:{[accounts[0].owner]:{type:'AMM'},[accounts[1].address]:{type:'LOCKER'},[accounts[2].owner]:{type:'BURN'},[accounts[3].address]:{type:'POOL'},[accounts[4].owner]:{type:'CREATOR'}},markets:[]};
let currentReport=report,supply='1000',currentAccounts=accounts,accountProgram=program;
Date.now=()=>now;
globalThis.fetch=async(input,init)=>{
 const url=new URL(input);let out;
 if(url.hostname==='rpc.example'){
  const body=JSON.parse(init.body);
  if(Array.isArray(body))out=[{id:1,result:{value:{owner:program,data:{parsed:{type:'mint',info:{supply,decimals:6,mintAuthority:null,freezeAuthority:null}}}}}},{id:2,result:{epoch:5}},{id:3,result:{value:currentAccounts.map(a=>({address:a.address,amount:a.amount}))}}];
  else out={result:{value:body.params[0].map(address=>{const a=currentAccounts.find(a=>a.address===address);return {owner:accountProgram,data:{parsed:{type:'account',info:{mint,owner:a.owner,tokenAmount:{amount:a.amount}}}}};})}};
 }else if(url.hostname==='api.rugcheck.xyz')out=currentReport;
 else throw Error('Unexpected request '+url);
 return new Response(JSON.stringify(out),{headers:{'content-type':'application/json'}});
};
async function reads(){const context=researchReadContext({LP_CACHE:new KV(),SOLANA_RPC:'https://rpc.example'});return {rpc:await readMintSafety(mint,context),rug:await readRugSafety(mint,context),context};}
try{
 let {rpc,rug,context}=await reads(),e=researchPreflightEvidence(pool,rpc,rug,now);
 assert.equal(context.requests,3,'uses existing mint batch, owner batch and RugCheck report only');
 assert.equal(e.holders.status,'available');assert.equal(e.holders.topFraction,.15,'owner account balances group after exclusions');
 assert.equal(e.holders.owner,accounts[4].owner,'CREATOR is never an exclusion');
 assert.equal(e.holders.excludedAccounts,4,'AMM, POOL, LOCKER and BURN work for owner or account classifications');
 assert.equal(e.holders.sampleFraction,.8);assert.equal(e.holders.complete,false,'low coverage is not a complete owner census');
 assert.equal(e.tokenAge.minimumHours,96);assert.equal(e.tokenAge.basis,'rugcheck-detected');assert.equal(e.tokenAge.exact,false);
 assert.match(e.tokenAge.note,/minimum age, not the mint creation/);
 assert.equal(researchFeeRates(pool).h24,.002,'24h fee window is normalised to hourly fraction');
 assert.equal(researchFeeRates({...pool,ageHours:23}).h24,null,'partial young-pool window cannot claim a complete 24h rate');
 assert.equal(researchFeeRates({...pool,fees24hUsd:null}).h24,.002,'dated source fee/TVL fallback remains supported');
 const future=researchPreflightEvidence({...pool,fetchedAt:iso(now+1)},rpc,{...rug,status:'unavailable'},now);assert.equal(future.tokenAge.status,'unavailable');
 const young=researchPreflightEvidence({...pool,ageHours:2},rpc,{...rug,detectedAt:null},now);
 assert.equal(young.tokenAge.minimumHours,2);assert.equal(young.tokenAge.exact,false);assert.match(young.tokenAge.note,/young pool cannot prove a young token/);
 const oldPool=researchPreflightEvidence(pool,rpc,{...rug,detectedAt:iso(now-HOUR)},now);assert.equal(oldPool.tokenAge.minimumHours,48);assert.equal(oldPool.tokenAge.basis,'pool');
 for(const change of [{...rpc,status:'stale'},{...rpc,asOf:iso(now-300001)},{...rpc,holderSample:{...rpc.holderSample,asOf:iso(now-300001)}},{...rpc,holderSample:{...rpc.holderSample,mint:pk(222)}}])assert.equal(researchPreflightEvidence(pool,change,rug,now).holders.status,'unavailable','stale or mismatched owner evidence is rejected');
 for(const change of [{...rug,status:'stale'},{...rug,asOf:iso(now-600001)},{...rug,holderExclusions:{...rug.holderExclusions,asOf:iso(now-600001)}},{...rug,mint:pk(222)}])assert.equal(researchPreflightEvidence(pool,rpc,change,now).holders.status,'unavailable','stale or mismatched classification is rejected');
 currentReport={...report,mint:pk(222)};let mismatch=await reads();assert.equal(mismatch.rug.status,'unavailable');assert.equal(researchPreflightEvidence(pool,mismatch.rpc,mismatch.rug,now).holders.status,'unavailable','provider token mismatch cannot supply exclusions');
 assert.equal(mismatch.rug.detectedAt,null,'another mint detection cannot age the selected token');
 currentReport={mint,score:0,risks:[]};let missing=await reads();assert.equal(researchPreflightEvidence(pool,missing.rpc,missing.rug,now).holders.status,'unavailable','missing classification cannot pass as empty exclusions');
 currentReport={...report,knownAccounts:{},markets:[{pubkey:pool.address,mintA:mint,mintB:SOL,liquidityA:accounts[0].address,liquidityAAccount:{mint,owner:accounts[0].owner},liquidityB:accounts[1].address,liquidityBAccount:{mint:SOL,owner:accounts[1].owner}}]};
 let market=await reads(),marketEvidence=researchPreflightEvidence(pool,market.rpc,market.rug,now);assert.equal(marketEvidence.holders.excludedAccounts,1,'only exact mint-side market vault is excluded');
 currentAccounts=[accounts[0],{...accounts[4],owner:accounts[0].owner,amount:'350'},{...accounts[6],amount:'300'}];
 let shared=await reads(),sharedEvidence=researchPreflightEvidence(pool,shared.rpc,shared.rug,now);assert.equal(sharedEvidence.holders.topFraction,.35);assert.equal(sharedEvidence.holders.owner,accounts[0].owner,'market vault evidence does not exclude personal holdings sharing the vault owner');
 currentAccounts=accounts;
 currentReport={...currentReport,markets:[{...currentReport.markets[0],liquidityAAccount:{mint:pk(222),owner:accounts[0].owner}}]};market=await reads();assert.equal(researchPreflightEvidence(pool,market.rpc,market.rug,now).holders.excludedAccounts,0,'mismatched market-vault mint cannot exclude a holder');
 currentReport=report;supply='800';let full=await reads();assert.equal(researchPreflightEvidence(pool,full.rpc,full.rug,now).holders.complete,true,'only exact full-supply coverage can complete the sample');
 supply='1000';currentAccounts=accounts.map((a,i)=>({...a,amount:i===0?'450':a.amount}));full=await reads();assert.equal(researchPreflightEvidence(pool,full.rpc,full.rug,now).holders.complete,true);
 currentAccounts=accounts;accountProgram=pk(223);let bad=await reads();assert.equal(bad.rpc.holderSample.status,'unavailable','incorrect account owner program cannot contribute holder evidence');
 accountProgram=program;currentAccounts=[...accounts,accounts[0]];bad=await reads();assert.equal(bad.rpc.holderSample.status,'unavailable','duplicate token account cannot inflate balances');
 currentAccounts=[{...accounts[0],amount:'9'.repeat(1000)}];supply='9'.repeat(1000);bad=await reads();assert.equal(bad.rpc.holderSample.status,'unavailable','unbounded provider amount strings are rejected before BigInt');
 console.log('World’s Fair evidence: classification, grouping, freshness, coverage, minimum age and fee windows passed');
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
