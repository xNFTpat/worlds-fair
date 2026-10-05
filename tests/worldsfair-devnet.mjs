import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'paper-devnet-test-'));
await build({entryPoints:['src/worldsfair-devnet.ts','src/worldsfair-paper.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const {WorldsfairRangeInbox,worldsfairPaperRoute}=await import(join(dir,'worldsfair-paper.mjs'));
const {createStampReceipt,stampTarget,stampBase58,verifyStampTransaction,DEVNET_RPC,DEVNET_GENESIS,MEMO_PROGRAM,COMPUTE_PROGRAM}=await import(join(dir,'worldsfair-devnet.mjs'));
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){let n=0n;for(const b of bytes)n=(n<<8n)+BigInt(b);let text='';while(n){text=alphabet[Number(n%58n)]+text;n/=58n;}for(const b of bytes){if(b!==0)break;text='1'+text;}return text;}
const wallet=b58(new Uint8Array(32).fill(7)),otherWallet=b58(new Uint8Array(32).fill(8));
const signature=b58(new Uint8Array(64).fill(9)),secondSignature=b58(new Uint8Array(64).fill(10));
const at=new Date().toISOString(),account='a'.repeat(64),other='b'.repeat(64);
const entry={id:'fleet:farmer:fixture:'+at,arm:'farmer',openedAt:at,budgetSol:1,pool:{address:'fixture-pool',pair:'FIX/SOL'}};
const close={...entry,closedAt:at,exitSol:1.2,pnlSol:.2,pair:'FIX/SOL',poolAddress:'fixture-pool'};
const event={id:'saved-roll-001',kind:'roll',source:'fleet',at,tradeId:entry.id,closedAt:at,amountLamports:100000000,retainedSol:.1};
const openTarget={kind:'fleet-open',id:entry.id},closeTarget={kind:'fleet-close',id:close.id,closedAt:at},rollTarget={kind:'pot-roll',eventId:event.id};
function transaction(receipt,sig=signature){return {slot:123456,blockTime:Math.floor(Date.now()/1000),version:'legacy',transaction:{signatures:[sig],message:{accountKeys:[wallet,COMPUTE_PROGRAM,MEMO_PROGRAM],header:{numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:2},instructions:[
  {programIdIndex:1,accounts:[],data:b58(new Uint8Array([2,160,134,1,0]))},
  {programIdIndex:1,accounts:[],data:b58(new Uint8Array([3,0,0,0,0,0,0,0,0]))},
  {programIdIndex:2,accounts:[0],data:b58(new TextEncoder().encode(receipt.memo))},
]}},meta:{err:null,fee:5000,preBalances:[100000,1,1],postBalances:[95000,1,1],innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}};}
const receipt=await createStampReceipt(account,openTarget,entry,wallet);
assert.equal(receipt.memo,'Paper record | devnet | v1 | fleet-open | sha256:'+receipt.eventHash);
assert.equal((await createStampReceipt(account,openTarget,entry,wallet)).id,receipt.id);
assert.notEqual((await createStampReceipt(other,openTarget,entry,wallet)).id,receipt.id,'Stamp identities are session-isolated');
assert.equal(receipt.description,'Observation of a shared Paper fleet open');
assert.equal((await createStampReceipt(account,rollTarget,{event},wallet)).description,'Your saved Paper roll');
assert.ok(!receipt.memo.includes(account)&&!receipt.memo.includes(entry.id),'Only an evidence hash, event kind and paper/devnet label go on chain');
assert.equal(verifyStampTransaction(receipt,signature,transaction(receipt)).explorerUrl,'https://explorer.solana.com/tx/'+signature+'?cluster=devnet');
for(const bytes of [new Uint8Array(32),new Uint8Array([0,0,7,255]),new Uint8Array(64).fill(255)])assert.deepEqual(stampBase58(b58(bytes),64),bytes);
for(const bad of [null,{},'anything',{kind:'fleet-open',id:entry.id,amountSol:999},{kind:'mainnet',id:entry.id},{kind:'pot-roll',eventId:'fake'}])assert.throws(()=>stampTarget(bad));
for(const mutate of [
  tx=>tx.meta.err={InstructionError:[0,'failed']},tx=>tx.transaction.signatures[0]=secondSignature,
  tx=>tx.transaction.message.accountKeys[0]=otherWallet,tx=>tx.transaction.message.instructions[2].data=b58(new TextEncoder().encode('invented memo')),
  tx=>tx.transaction.message.instructions[2].accounts=[],tx=>tx.transaction.message.instructions.push(tx.transaction.message.instructions[2]),
  tx=>tx.transaction.message.instructions[1].data=b58(new Uint8Array([3,1,0,0,0,0,0,0,0])),
  tx=>tx.transaction.message.instructions[0].programIdIndex=2,tx=>tx.meta.postBalances[0]-=1,
  tx=>tx.meta.postBalances[1]+=1,tx=>tx.meta.preTokenBalances=[{}],tx=>tx.meta.innerInstructions=[{}],
  tx=>tx.version=0,tx=>tx.transaction.message.header.numRequiredSignatures=2,
  tx=>tx.transaction.message.addressTableLookups=[{}],tx=>tx.meta.fee=Infinity,tx=>tx.blockTime='unknown',
]){const tx=transaction(receipt);mutate(tx);assert.throws(()=>verifyStampTransaction(receipt,signature,tx));}

class Storage {
  rows=new Map();puts=[];
  async get(key){return structuredClone(this.rows.get(key));}
  async put(key,value){const rows=typeof key==='string'?{[key]:value}:key;this.puts.push(Object.keys(rows));for(const [k,v]of Object.entries(rows))this.rows.set(k,structuredClone(v));}
  async delete(key){return this.rows.delete(key);}
  async list(options={}){let rows=[...this.rows].filter(([key])=>(!options.prefix||key.startsWith(options.prefix))&&(!options.end||key<options.end)).sort(([a],[b])=>a.localeCompare(b));if(options.reverse)rows.reverse();return new Map(rows.slice(0,options.limit||rows.length).map(([k,v])=>[k,structuredClone(v)]));}
}
const storage=new Storage(),kv=new Map();let queue=Promise.resolve(),guarded=false,failKv=false;
const ctx={storage,blockConcurrencyWhile(fn){const task=queue.then(async()=>{guarded=true;try{return await fn();}finally{guarded=false;}});queue=task.catch(()=>{});return task;}};
const object=new WorldsfairRangeInbox(ctx,{LP_CACHE:{put:async(key,value)=>{if(failKv)throw Error('KV down');kv.set(key,value);}}});
const paperState={version:1,revision:19,balanceLamports:700000000,holdings:[]};
await storage.put({fleet:{revision:81,portfolios:{farmer:{cashSol:9,withdrawnSol:.1}}},['fleet-entry:'+entry.id]:entry,['fleet-trade:'+at+':'+close.id]:close,['wf:receipt:'+account+':'+event.id]:{event},['wf:account:'+account]:paperState});
const baselineFleet=await storage.get('fleet'),baselineAccount=await storage.get('wf:account:'+account);
const run=async(action,body,owner=account)=>{const r=await object.fetch(new Request('https://paper/worldsfair-paper/'+action,{method:body?'POST':'GET',headers:{'x-worldsfair-account':owner},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,data:await r.json()};};
const realFetch=globalThis.fetch;let rpc=[],rpcMode='confirmed',currentReceipt=receipt,gate=null;
globalThis.fetch=async(url,init)=>{
  assert.equal(url,DEVNET_RPC,'No caller RPC or mainnet endpoint is accepted');assert.equal(guarded,false,'RPC confirmation runs outside the money-writer lock');
  const body=JSON.parse(init.body);rpc.push(body);assert.ok(['getGenesisHash','getTransaction'].includes(body.method),'Server reads only');
  if(gate)await gate;
  if(rpcMode==='offline')throw Error('Provider down');
  let result=body.method==='getGenesisHash'?(rpcMode==='wrong-network'?'mainnet-fixture':DEVNET_GENESIS):rpcMode==='pending'?null:transaction(currentReceipt,body.params[0]);
  if(body.method==='getTransaction'&&rpcMode==='wrong-memo')result.transaction.message.instructions[2].data=b58(new TextEncoder().encode('wrong'));
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}));
};
try {
  failKv=true;
  let result=await run('stamp-prepare',{target:openTarget,wallet});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.persistence,'retrying');currentReceipt=result.data.receipt;
  assert.deepEqual(result.data.receipt,{...receipt,createdAt:currentReceipt.createdAt});assert.equal(rpc.length,0,'Prepare never makes a chain request or submits a transaction');
  const prepared=await run('stamp-prepare',{target:openTarget,wallet});assert.deepEqual(prepared.data.receipt,currentReceipt);
  assert.equal((await run('stamp-prepare',{target:openTarget,wallet:otherWallet})).status,409);
  assert.equal((await run('stamp-prepare',{target:rollTarget,wallet},other)).status,404,'Another session cannot stamp this private roll');
  assert.equal((await run('stamp-prepare',{target:rollTarget,wallet,amountLamports:999})).status,400);
  assert.equal((await run('stamp-prepare',{target:{kind:'fleet-open',id:entry.id+'-fake'},wallet})).status,404);
  const confirm={receiptId:receipt.id,signature};
  rpcMode='pending';result=await run('stamp-confirm',confirm);assert.equal(result.status,202);assert.equal(result.data.receipt.status,'ready');assert.equal(result.data.persistence,'retrying','Pending confirmation reports the durable KV outbox honestly');
  for(const mode of ['wrong-network','wrong-memo','offline']){rpcMode=mode;result=await run('stamp-confirm',confirm);assert.ok(result.status>=400,mode);assert.equal((await storage.get('wf:stamp:'+account+':'+receipt.id)).status,'ready');}
  assert.equal((await run('stamp-confirm',confirm,other)).status,404);
  assert.equal((await run('stamp-confirm',{...confirm,rpc:'https://api.mainnet-beta.solana.com'})).status,400);
  rpcMode='confirmed';failKv=true;result=await run('stamp-confirm',confirm);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.receipt.status,'confirmed');assert.equal(result.data.persistence,'retrying');
  const calls=rpc.length;result=await run('stamp-confirm',confirm);assert.equal(result.status,200);assert.equal(rpc.length,calls,'Confirmed receipts replay without another network request');
  assert.equal((await run('stamp-confirm',{...confirm,signature:secondSignature})).status,409);
  failKv=false;result=await run('stamps');assert.equal(result.data.receipts.length,1);assert.equal(JSON.parse(kv.get('wf:stamp:'+account+':'+receipt.id)).status,'confirmed');
  assert.deepEqual((await run('stamps',undefined,other)).data.receipts,[]);
  assert.deepEqual(await storage.get('fleet'),baselineFleet);assert.deepEqual(await storage.get('wf:account:'+account),baselineAccount,'Stamp lifecycle never changes paper cash or revision');
  assert.ok(storage.puts.filter(keys=>keys.some(key=>key.startsWith('wf:stamp:'))).every(keys=>keys.every(key=>key.startsWith('wf:stamp:')||key.startsWith('wf:stamp-outbox:'))),'Confirmed stamps and retryable mirrors are atomic and separate from money');
  result=await run('stamp-prepare',{target:closeTarget,wallet});assert.equal(result.status,200);currentReceipt=result.data.receipt;
  let release;gate=new Promise(resolve=>{release=resolve;});const racing=run('stamp-confirm',{receiptId:currentReceipt.id,signature});await new Promise(resolve=>setTimeout(resolve,10));
  const changed=await storage.get('fleet-trade:'+at+':'+close.id);changed.pnlSol=.7;await storage.put('fleet-trade:'+at+':'+close.id,changed);release();gate=null;
  result=await racing;assert.equal(result.status,409);assert.equal(result.data.code,'paper_stamp_event_changed');
  result=await run('stamp-prepare',{target:rollTarget,wallet});assert.equal(result.status,200);assert.equal(result.data.receipt.target.kind,'pot-roll');
  const publicEnv={RANGE_ALERTS:{idFromName:()=>1,get:()=>({fetch:async(url,init)=>object.fetch(new Request(url,init))})}};
  assert.equal((await worldsfairPaperRoute(new Request('https://paper/api/paper/stamp-prepare',{method:'POST',headers:{origin:'https://foreign','content-type':'application/json'},body:JSON.stringify({target:openTarget,wallet})}),publicEnv)).status,403);
  assert.equal((await worldsfairPaperRoute(new Request('https://paper/api/paper/stamp-prepare',{method:'POST',headers:{origin:'https://paper','content-type':'application/json'},body:JSON.stringify({target:openTarget,wallet})}),publicEnv)).status,401);
  assert.equal((await run('stamp-send',{transaction:'untrusted'})).status,404,'There is no server send endpoint');
  console.log('PASS: devnet-pinned read-only verification, canonical authoritative events, exact Memo/no transfers, malformed/wrong-network rejection, session isolation, replay and failed-KV recovery, source-race guard, no paper cash/revision mutation. No real signing or network calls.');
}finally{globalThis.fetch=realFetch;}
