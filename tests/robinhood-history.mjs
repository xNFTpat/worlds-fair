// Fully synthetic lifecycle fixtures; no private wallet or transaction history.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
const dir=await mkdtemp(join(tmpdir(),'rh-history-'));
await build({entryPoints:['src/sources/uniswap-history.ts','src/robinhood-intelligence.ts'],outdir:dir,outbase:'src',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const {fetchUniswapHistory,EVENTS,eventLogs}=await import(join(dir,'sources/uniswap-history.mjs'));
const {robinhoodHistory,indexedWalletEvents}=await import(join(dir,'robinhood-intelligence.mjs'));
const open=JSON.parse(await readFile('tests/fixtures/robinhood-open-synthetic.json')).result;
const close=JSON.parse(await readFile('tests/fixtures/robinhood-close-synthetic.json')).result;
const npm='0x73991a25c818bf1f1128deaab1492d45638de0d3',owner=close.from,pool='0x'+'2'.repeat(40);
const token0='0x'+'3'.repeat(40),token1='0x'+'4'.repeat(40);
const pad=v=>'0x'+v.replace(/^0x/,'').padStart(64,'0');
const all=[...open.logs,...close.logs].filter(l=>l.address===npm);
const original=globalThis.fetch;let logs=structuredClone(all), fail=false,mode='normal';
const answer=result=>Response.json({jsonrpc:'2.0',id:1,result});
const rpc=async(url,opts)=>{
 const {method,params}=JSON.parse(opts.body);
 if(fail)throw new Error('offline');
 if(method==='eth_blockNumber')return answer('0x4000000');
 if(method==='eth_getLogs'){
  const q=params[0];
  if(mode==='split'&&Number(BigInt(q.toBlock))-Number(BigInt(q.fromBlock))>1)return Response.json({error:{message:'block range limit'}});
  return answer(logs.filter(l=>Number(BigInt(l.blockNumber))>=Number(BigInt(q.fromBlock))&&Number(BigInt(l.blockNumber))<=Number(BigInt(q.toBlock))&&q.topics.every((t,i)=>t===null||(Array.isArray(t)?t.includes(l.topics[i]):t===l.topics[i]))));
 }
 if(method==='alchemy_getAssetTransfers')return answer({transfers:[{hash:open.logs[0].transactionHash},{hash:close.logs[0].transactionHash}]});
 if(method==='eth_getTransactionReceipt')return answer(params[0]===close.logs[0].transactionHash?close:open);
 if(method==='eth_call'){
  const s=params[0].data;
  assert.ok(!s.startsWith('0x99fbab88'),'Burned NFTs must be reconstructed without positions(id)');
  const value={'0xc45a0155':'0x1f7d7550b1b028f7571e69a784071f0205fd2efa','0x0dfe1681':token0,'0xd21220a7':token1,'0xddca3f43':(10000).toString(16),'0x313ce567':'12','0x95d89b41':Buffer.from(params[0].to===token0?'FIX0':'FIX1').toString('hex').padEnd(64,'0')}[s];
  assert.ok(value,'Unexpected call '+s);return answer(pad(value));
 }
 throw new Error('Unexpected method '+method);
};
const read=()=>fetchUniswapHistory({name:'Synthetic wallet',address:owner},()=>999,t=>Promise.resolve({symbol:t===token0?'FIX0':'FIX1',decimals:18}),'https://rpc.test');
try{
 globalThis.fetch=rpc;
 let h=await read();assert.equal(h.complete,true);assert.equal(h.closed.length,1);
 const p=h.closed[0];assert.equal(p.positionAddress,'#42');assert.equal(p.poolAddress,pool);
 assert.equal(p.depositedTokens[0].raw,'500000000000000000');assert.equal(p.depositedTokens[1].raw,'250000000000000000000');
 assert.equal(p.feeTokens[0].raw,'10000000000000000');assert.equal(p.feeTokens[1].raw,'2000000000000000000');
 assert.equal(p.pnlUsd,null,'Today’s token price is not historical profit');assert.equal(p.feesUsd,null);
 assert.equal(p.openedAt,'2026-01-01T12:00:00.000Z');assert.equal(p.closedAt,'2026-01-02T12:00:00.000Z');assert.equal(p.actions.length,3);
 logs=all.filter(l=>l.topics[0]!==EVENTS.col);h=await read();assert.equal(h.closed.length,0);assert.equal(h.records[0].status,'awaiting collection');assert.equal(h.records[0].feeTokens,null);
 // Another wallet minted it, then transferred the NFT in before withdrawal.
 logs=structuredClone(all);const mint=logs.find(l=>l.topics[0]===EVENTS.transfer);mint.topics[2]=pad('0x'+'1'.repeat(40));
 logs.push({...mint,topics:[EVENTS.transfer,mint.topics[2],pad(owner),mint.topics[3]],blockNumber:'0x200',logIndex:'0x1'});
 h=await read();assert.equal(h.records[0].ownershipComplete,false);assert.equal(h.records[0].depositedTokens[0].amount,0);assert.equal(h.records[0].feeTokens,null);assert.equal(h.records[0].pnlUsd,null);
 // A transfer to another owner is not a profitable closed position.
 logs=structuredClone(all);logs.at(-1).topics[2]=pad('0x'+'1'.repeat(40));
 h=await read();assert.equal(h.records[0].status,'transferred');assert.equal(h.closed.length,0);
 logs=structuredClone(all);mode='split';const ranges=await eventLogs('https://rpc.test',[EVENTS.transfer],3);assert.deepEqual(ranges,[]);mode='normal';
 const store=new Map(),kv={get:async key=>store.get(key)||null,put:async(key,v)=>store.set(key,JSON.parse(v))};
 const wallet={name:'Synthetic wallet',address:owner};await robinhoodHistory(kv,wallet,'https://rpc.test');
 const indexed=await indexedWalletEvents(kv,wallet,'https://alchemy.com/rpc');
 assert.equal(indexed.receipts.length,2,'Duplicate transfer hashes become one receipt');
 h=await fetchUniswapHistory(wallet,()=>999,t=>Promise.resolve({symbol:t===token0?'FIX0':'FIX1',decimals:18}),'https://rpc.test',indexed);
 assert.equal(h.closed[0].feeTokens[0].raw,'10000000000000000');assert.equal(h.historyScope,'wallet-transactions');
 fail=true;h=await robinhoodHistory(kv,wallet,'https://rpc.test',true);assert.equal(h.status,'stale');assert.equal(h.closed.length,1);assert.equal(h.complete,false);
 console.log('PASS: burned NFT receipt reconstruction, exact fees, no fabricated USD profit, ownership changes, uncollected principal, range splitting and stale history');
}finally{globalThis.fetch=original;}
