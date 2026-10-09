import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'worldsfair-devnet-client-'));
await build({entryPoints:['src/worldsfair-devnet-client.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'client.cjs')});
const require=createRequire(import.meta.url);
const {createDevnetClient,buildMemoTransaction,DEVNET_RPC,DEVNET_GENESIS,MEMO_PROGRAM}=require(join(dir,'client.cjs'));
const {Keypair,Transaction,SystemProgram,ComputeBudgetProgram}=require('../execution/node_modules/@solana/web3.js'),bs58=require('../execution/node_modules/bs58');
const wallet=Keypair.fromSeed(Uint8Array.from({length:32},(_,i)=>i+1)),other=Keypair.fromSeed(Uint8Array.from({length:32},(_,i)=>i+2)),walletAddress=wallet.publicKey.toBase58(),blockhash=other.publicKey.toBase58();
const target={kind:'fleet-open',id:'paper-open-1'},storageKey='worldsfair:devnet-stamps:v1';
const parse=bytes=>Transaction.from(bytes),sig=bytes=>bs58.encode(parse(bytes).signature);
assert.equal(DEVNET_RPC,'https://api.devnet.solana.com');assert.equal(DEVNET_GENESIS,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const tx=buildMemoTransaction(walletAddress,'Paper record fixture',blockhash,150);
assert.equal(tx.instructions.length,3);assert.ok(tx.instructions[0].programId.equals(ComputeBudgetProgram.programId));assert.ok(tx.instructions[1].programId.equals(ComputeBudgetProgram.programId));assert.equal(tx.instructions[2].programId.toBase58(),MEMO_PROGRAM);assert.equal(tx.instructions[2].keys.length,1);assert.equal(tx.instructions[2].keys[0].isSigner,true);assert.equal(tx.instructions[2].keys[0].pubkey.toBase58(),walletAddress);
assert.equal(tx.instructions[0].data.readUInt8(0),2);assert.equal(tx.instructions[0].data.readUInt32LE(1),100000);assert.equal(tx.instructions[1].data.readUInt8(0),3);assert.equal(tx.instructions[1].data.readBigUInt64LE(1),0n);assert.equal(tx.instructions[2].data.toString('utf8'),'Paper record fixture');
for(const memo of ['', 'x'.repeat(513),'😀'.repeat(129)])assert.throws(()=>buildMemoTransaction(walletAddress,memo,blockhash,150));
for(const height of [0,-1,NaN,Infinity,1.5])assert.throws(()=>buildMemoTransaction(walletAddress,'ok',blockhash,height));
function fixture(stampTarget=target){
 const map=new Map(),calls=[],sent=[],emitted=[];let connects=0,signs=0,genesis=DEVNET_GENESIS,sendLost=false,confirmMode='confirmed',mutation=null,consentConnect=true,consentSign=true,status=null,height=100,failRecordWrite=false,capability=true,receiptFault=null;
 const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{if(failRecordWrite&&key===storageKey)throw Error('Storage failed');map.set(key,value);},removeItem:key=>map.delete(key)};
 const consent=async detail=>{calls.push({kind:'consent',detail});return detail.stage==='connect'?consentConnect:consentSign;};
 const provider={isPhantom:true,connect:async()=>{connects++;return {publicKey:wallet.publicKey};},signTransaction:async tx=>{
  signs++;assert.equal(tx.instructions.length,3);assert.equal(tx.instructions[2].programId.toBase58(),MEMO_PROGRAM);
  if(mutation==='transfer')tx.add(SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:other.publicKey,lamports:1}));
  if(mutation==='budget')tx.instructions[0]=ComputeBudgetProgram.setComputeUnitLimit({units:200000});
  tx.partialSign(wallet);if(mutation==='signature')tx.signatures[0].signature[0]^=1;return tx;
 }};
 const receipt=(targetValue=stampTarget)=>({id:'receipt-1',memo:`Paper record | devnet | v1 | ${targetValue.kind} | sha256:${'a'.repeat(64)}`,target:targetValue,eventAt:'2026-10-05T12:00:00.000Z',eventHash:'a'.repeat(64),wallet:walletAddress,status:'ready'});
 const fetcher=async(path,init)=>{
  if(path==='/api/paper/stamps'){assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');calls.push({kind:'api',path});return Response.json({paper:true,cluster:'devnet',receipts:[]});}
  assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');assert.equal(init.headers['content-type'],'application/json');const body=JSON.parse(init.body);calls.push({kind:'api',path,body});
  if(path==='/api/paper/stamp-prepare'){
   assert.deepEqual(Object.keys(body).sort(),['target','wallet']);assert.equal(body.wallet,walletAddress);
   const r=receipt(body.target);if(receiptFault==='wallet')r.wallet=other.publicKey.toBase58();if(receiptFault==='target')r.target={kind:'fleet-open',id:'other'};if(receiptFault==='memo')r.memo='x'.repeat(513);if(receiptFault==='exact-memo')r.memo='A different memo';if(receiptFault==='hash')r.eventHash='z'.repeat(64);
   return Response.json({paper:true,cluster:receiptFault==='cluster'?'mainnet-beta':'devnet',receipt:r});
  }
  assert.equal(path,'/api/paper/stamp-confirm');assert.deepEqual(Object.keys(body).sort(),['receiptId','signature']);
  if(confirmMode==='503')return Response.json({error:'Devnet read unavailable'},{status:503});
  const r=receipt();if(confirmMode==='confirmed'){r.status='confirmed';r.signature=body.signature;r.explorerUrl='https://untrusted.test/ignored';}
  return Response.json({paper:true,cluster:'devnet',receipt:r,status:confirmMode==='confirmed'?'confirmed':'pending'},{status:confirmMode==='confirmed'?200:202});
 };
 const rpc={getGenesisHash:async()=>{calls.push({kind:'rpc',method:'getGenesisHash'});return genesis;},getLatestBlockhash:async commitment=>{assert.equal(commitment,'confirmed');return {blockhash,lastValidBlockHeight:150};},sendRawTransaction:async(bytes,options)=>{
  assert.deepEqual(options,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});const saved=JSON.parse(map.get(storageKey));assert.equal(saved.length,1,'signed bytes durably persisted before broadcast');assert.equal(saved[0].wireBase64,Buffer.from(bytes).toString('base64'));assert.equal(saved[0].signature,sig(bytes));
  sent.push(Uint8Array.from(bytes));calls.push({kind:'rpc',method:'sendRawTransaction'});if(sendLost)throw Error('Ambiguous response');return sig(bytes);
 },getSignatureStatuses:async(signatures,options)=>{assert.deepEqual(options,{searchTransactionHistory:true});assert.equal(signatures.length,1);return {value:[status]};},getBlockHeight:async()=>height};
 const locks={request:async(name,options,callback)=>{assert.equal(name,'worldsfair:devnet:stamp');assert.deepEqual(options,{ifAvailable:true});return callback({name});}};
 const deps={storage,fetch:fetcher,rpc,phantom:()=>capability?provider:null,locks,consent,emit:detail=>emitted.push(detail),now:()=>Date.UTC(2026,9,5,12)};
 return {map,calls,sent,emitted,deps,client:()=>createDevnetClient(deps),get connects(){return connects;},get signs(){return signs;},set genesis(v){genesis=v;},set sendLost(v){sendLost=v;},set confirmMode(v){confirmMode=v;},set mutation(v){mutation=v;},set consentConnect(v){consentConnect=v;},set consentSign(v){consentSign=v;},set status(v){status=v;},set height(v){height=v;},set failRecordWrite(v){failRecordWrite=v;},set capability(v){capability=v;},set receiptFault(v){receiptFault=v;}};
}
let f=fixture();assert.equal(f.calls.length,0,'client construction never connects/signs or calls providers');let result=await f.client().stamp(target);assert.equal(result.status,'confirmed');assert.equal(f.connects,1);assert.equal(f.signs,1);assert.equal(f.sent.length,1);assert.match(result.explorerUrl,/^https:\/\/explorer\.solana\.com\/tx\/.*\?cluster=devnet$/);assert.doesNotMatch(result.explorerUrl,/untrusted/);assert.deepEqual(f.calls.filter(c=>c.kind==='consent').map(c=>c.detail.stage),['connect','sign']);assert.equal(f.calls.find(c=>c.kind==='consent'&&c.detail.stage==='sign').detail.memo,`Paper record | devnet | v1 | fleet-open | sha256:${'a'.repeat(64)}`);
assert.ok(f.calls.findIndex(c=>c.path==='/api/paper/stamps')<f.calls.findIndex(c=>c.path==='/api/paper/stamp-prepare'),'read-only session initialization precedes prepare');
await f.client().stamp(target);assert.equal(f.signs,1,'confirmed reload never signs again');assert.equal(f.sent.length,1);assert.ok(f.emitted.some(r=>r.status==='confirmed'));
f=fixture();f.sendLost=true;await f.client().stamp(target);const forged=JSON.parse(f.map.get(storageKey));forged[0].state='confirmed';f.map.set(storageKey,JSON.stringify(forged));f.confirmMode='pending';result=await f.client().checkPending(target);assert.equal(result.status,'pending','browser state cannot establish confirmation');assert.equal(f.signs,1);assert.equal(f.sent.length,1);
f=fixture();f.consentConnect=false;assert.equal((await f.client().stamp(target)).status,'cancelled');assert.equal(f.connects,0);assert.equal(f.signs,0);assert.equal(f.sent.length,0);
f=fixture();f.consentSign=false;assert.equal((await f.client().stamp(target)).status,'cancelled');assert.equal(f.connects,1);assert.equal(f.signs,0);assert.equal(f.sent.length,0);
f=fixture();f.capability=false;assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.connects,0);
f=fixture();delete f.deps.locks;assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.signs,0);
f=fixture();f.deps.storage.setItem=()=>{throw Error('disabled');};assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.connects,0);assert.equal(f.signs,0);
f=fixture();f.failRecordWrite=true;assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.signs,1);assert.equal(f.sent.length,0,'save failure after signing still prevents all broadcasts');
f=fixture();f.genesis='mainnet';result=await f.client().stamp(target);assert.equal(result.status,'unavailable');assert.match(result.message,/did not identify Solana devnet/);assert.equal(f.connects,0);assert.equal(f.signs,0);
for(const mutation of ['transfer','budget','signature']){f=fixture();f.mutation=mutation;assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.sent.length,0,'changed message/signature must never be broadcast');assert.equal(f.map.has(storageKey),false);}
for(const fault of ['wallet','target','memo','exact-memo','hash','cluster']){f=fixture();f.receiptFault=fault;assert.equal((await f.client().stamp(target)).status,'unavailable');assert.equal(f.signs,0);assert.equal(f.sent.length,0);}
f=fixture();f.sendLost=true;result=await f.client().stamp(target);assert.equal(result.status,'pending');assert.equal(f.signs,1);assert.equal(f.sent.length,1);assert.ok(f.map.has(storageKey));
f.sendLost=false;result=await f.client().checkPending(target);assert.equal(result.status,'confirmed');assert.equal(f.signs,1);assert.equal(f.connects,1);assert.equal(f.sent.length,2);assert.deepEqual(f.sent[0],f.sent[1],'retry after reload sends identical signed bytes');
f=fixture();f.confirmMode='pending';result=await f.client().stamp(target);assert.equal(result.status,'pending');f.status={err:null,confirmationStatus:'confirmed'};f.confirmMode='confirmed';result=await f.client().stamp(target);assert.equal(result.status,'confirmed');assert.equal(f.sent.length,1,'known confirmation checks backend without rebroadcast');assert.equal(f.signs,1);
f=fixture();f.confirmMode='503';result=await f.client().stamp(target);assert.equal(result.status,'pending');f.status={err:null,confirmationStatus:'processed'};result=await f.client().checkPending(target);assert.equal(result.status,'pending');assert.equal(f.sent.length,1);assert.equal(f.signs,1);
f=fixture();f.sendLost=true;await f.client().stamp(target);f.sendLost=false;f.height=151;f.confirmMode='pending';result=await f.client().checkPending(target);assert.equal(result.status,'expired');f.height=100;await f.client().stamp(target);assert.equal(f.signs,1);assert.equal(f.sent.length,1,'expired ambiguous attempt never re-signs or rebroadcasts after height regression');
f=fixture();f.sendLost=true;await f.client().stamp(target);f.status={err:{InstructionError:[2,'InvalidInstructionData']},confirmationStatus:'confirmed'};result=await f.client().checkPending(target);assert.equal(result.status,'failed');assert.equal(f.signs,1);
f=fixture();f.sendLost=true;await f.client().stamp(target);const saved=JSON.parse(f.map.get(storageKey));saved[0].memo='changed memo';f.map.set(storageKey,JSON.stringify(saved));result=await f.client().stamp(target);assert.equal(result.status,'unavailable');assert.equal(f.signs,1);assert.equal(f.sent.length,1,'corrupt pending record never authorizes another signature or send');
f=fixture();f.deps.locks.request=async(name,options,callback)=>callback(null);result=await f.client().stamp(target);assert.equal(result.status,'pending');assert.equal(f.connects,0);assert.equal(f.signs,0,'cross-tab lock excludes second flow');
f=fixture();assert.equal((await f.client().checkPending(target)).status,'unavailable');assert.equal(f.connects,0);assert.equal(f.signs,0);
for(const bad of [{kind:'fleet-open',id:''},{kind:'fleet-close',id:'x',closedAt:'bad'},{kind:'pot-roll',eventId:'x\n'}]){f=fixture();assert.equal((await f.client().stamp(bad)).status,'unavailable');assert.equal(f.signs,0);}
const basketTarget={kind:'still-basket',eventId:'basket-event-001'};
f=fixture(basketTarget);result=await f.client().stamp(basketTarget);assert.equal(result.status,'confirmed');assert.equal(f.signs,1);assert.equal(f.connects,1);
assert.deepEqual(f.calls.filter(call=>call.kind==='consent').map(call=>call.detail.stage),['connect','sign']);
const beforeRecovery=f.calls.length,recovered=f.client().savedAttempt(basketTarget);
assert.equal(recovered.status,'pending','Browser recovery does not assert chain confirmation');assert.equal(recovered.signature,result.signature);assert.equal(recovered.explorerUrl,result.explorerUrl);assert.equal(f.calls.length,beforeRecovery,'Rendering a saved signature never connects or sends');
await f.client().stamp(basketTarget);assert.equal(f.signs,1);assert.equal(f.sent.length,1,'Confirmed basket recovery never signs or sends another transaction');
f=fixture(basketTarget);f.sendLost=true;await f.client().stamp(basketTarget);assert.equal(f.sent.length,1);
const ownedFetch=f.deps.fetch;f.deps.fetch=async(path,init)=>path==='/api/paper/stamp-prepare'?Response.json({error:'This basket belongs to a different browser session.'},{status:404}):ownedFetch(path,init);
result=await f.client().checkPending(basketTarget);assert.equal(result.status,'pending');assert.equal(f.sent.length,1,'Lost session cannot rebroadcast an old browser recovery record');assert.equal(f.signs,1);
f.deps.fetch=ownedFetch;f.sendLost=false;result=await f.client().checkPending(basketTarget);assert.equal(result.status,'confirmed');assert.equal(f.signs,1);assert.equal(f.sent.length,2);assert.deepEqual(f.sent[0],f.sent[1],'Authorized basket retry uses exactly the original signed bytes');
for(const bad of [{kind:'still-basket',eventId:'short'},{kind:'still-basket',eventId:'x'.repeat(81)},{kind:'still-basket',eventId:'unsafe\nidentifier'}]){f=fixture();assert.equal((await f.client().stamp(bad)).status,'unavailable');assert.equal(f.signs,0);}
const source=await readFile('src/worldsfair-devnet-client.ts','utf8');assert.doesNotMatch(source,/signAndSendTransaction|\/api\/solana\/|\/api\/evm\/|api\.mainnet|clusterApiUrl/);assert.match(source,/worldsfair:devnet-ready/);assert.match(source,/span\[data-paper-stamp\]/);assert.match(source,/observation of a shared paper strategy/);assert.match(source,/your saved paper profit roll/);assert.match(source,/https:\/\/docs\.phantom\.com\/developer-powertools\/testnet-mode/);
f=fixture();f.consentConnect=false;assert.equal((await f.client().stamp({kind:'fleet-open',id:'x'.repeat(240)})).status,'cancelled');assert.equal((await f.client().stamp({kind:'fleet-open',id:'x'.repeat(241)})).status,'unavailable');
await build({entryPoints:['src/worldsfair-devnet-client.ts'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:join(dir,'browser.js'),minify:true,define:{'process.env.NODE_ENV':'"production"'}});
console.log('PASS devnet client: explicit two-step consent, fixed non-transfer instructions, devnet genesis, signed-message/signature verification, durable-before-send storage, same-bytes retries, no ambiguous re-sign, cross-tab lock, safe render hooks and browser bundle');
