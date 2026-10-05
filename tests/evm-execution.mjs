import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{secp256k1}=require('../execution/node_modules/@noble/curves/secp256k1'),{keccak_256}=require('../execution/node_modules/@noble/hashes/sha3');
const dir=await mkdtemp(join(tmpdir(),'lp-evm-'));
await build({entryPoints:['src/evm-math.ts','src/evm-execution.ts','src/paybox.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},outExtension:{'.js':'.mjs'}});
const math=await import(join(dir,'evm-math.mjs')),{buildEvmPreview,EvmExecution,evmRoute}=await import(join(dir,'evm-execution.mjs')),{verifiedPayboxCredential,payboxRoute}=await import(join(dir,'paybox.mjs'));
const {parseUnits,formatUnits,sqrtRatioAtTick,v3ExplicitRange,v3Amounts,hexBytes,bytesHex,rlpEncode,unsignedEvmFields,evmSigningHash,verifySignedEvmTransaction,signedEvmTransaction}=math;
const key=new Uint8Array(32).fill(1),owner=bytesHex(keccak_256(secp256k1.getPublicKey(key,false).slice(1)).slice(-20));
const weth='0x0bd7d308f8e1639fab988df18a8011f41eacad73',token='0x9000000000000000000000000000000000000001',factory='0x1f7d7550b1b028f7571e69a784071f0205fd2efa',npm='0x73991a25c818bf1f1128deaab1492d45638de0d3',poolAddress='0x4400000000000000000000000000000000000001';
const word=n=>BigInt.asUintN(256,BigInt(n)).toString(16).padStart(64,'0'),abi=(...ns)=>'0x'+ns.map(word).join(''),addressAbi=a=>abi(BigInt(a));
const pool={id:'robinhood:uniswap-v3:'+poolAddress,address:poolAddress,chain:'robinhood',venue:'uniswap-v3',pair:'TKN/WETH',base:{address:token,symbol:'TKN'},quote:{address:weth,symbol:'WETH'},feeTier:.003};
const input={action:'open',pool:pool.id,owner,credentialId:'granted-wallet',amountEth:'1',amountToken:'1',priceLowerEth:'0.8',priceUpperEth:'1.2',slippageBps:100};
const scalar=n=>n===0n?new Uint8Array():hexBytes('0x'+n.toString(16).padStart(Math.ceil(n.toString(16).length/2)*2,'0'));
function signed(tx,k=key){const s=secp256k1.sign(evmSigningHash(tx),k,{lowS:true}),fields=[...unsignedEvmFields(tx),scalar(BigInt(s.recovery)),scalar(s.r),scalar(s.s)];return '0x02'+bytesHex(rlpEncode(fields)).slice(2);}
function returnMulticall(calls){const enc=calls.map(c=>word(c.length/2)+c.padEnd(Math.ceil(c.length/64)*64,'0'));let at=calls.length*32;return '0x'+word(32)+word(calls.length)+enc.map(x=>{const w=word(at);at+=x.length/2;return w;}).join('')+enc.join('');}
assert.equal(parseUnits('0.000000000000000001',18),1n);assert.equal(formatUnits(1234567890123456789n),'1.234567890123456789');
for(const x of ['1e-9','-1','01','0.0000001',null])assert.throws(()=>parseUnits(x,6));
assert.equal(sqrtRatioAtTick(-887272),4295128739n);assert.equal(sqrtRatioAtTick(0),1n<<96n);assert.equal(sqrtRatioAtTick(887272),1461446703485210103287273052203988822378723970342n);
for(const wethIs0 of [false,true]){
 const r=v3ExplicitRange('.8'.replace(/^\./,'0.'),'1.2',wethIs0,18,60);assert.ok(Number(r.priceLowerEth)<=.8&&Number(r.priceUpperEth)>=1.2);
 const below=v3ExplicitRange('0.5','0.7',wethIs0,18,60),a=v3Amounts(1n<<96n,below.tickLower,below.tickUpper,wethIs0?10n**18n:0n,wethIs0?0n:10n**18n);
 assert.equal(wethIs0?a.amount1:a.amount0,0n,'Human below-price range accepts native ETH only in either token orientation');assert.ok((wethIs0?a.amount0:a.amount1)<=10n**18n);
 const above=v3ExplicitRange('1.3','1.5',wethIs0,18,60),b=v3Amounts(1n<<96n,above.tickLower,above.tickUpper,wethIs0?0n:10n**18n,wethIs0?10n**18n:0n);assert.equal(wethIs0?b.amount0:b.amount1,0n);
 assert.throws(()=>v3Amounts(1n<<96n,r.tickLower,r.tickUpper,1n,0n),/positive liquidity/);
 for(let n=1n;n<=20n;n++){try{const m=v3Amounts(1n<<96n,r.tickLower,r.tickUpper,n*1000000n,n*999999n);assert.ok(m.amount0<=n*1000000n&&m.amount1<=n*999999n);}catch(e){assert.match(e.message,/positive liquidity/);}}
}
assert.throws(()=>v3ExplicitRange('0.'+'0'.repeat(59)+'1','0.1',false,18,1),/native Uniswap tick bounds/);assert.throws(()=>v3ExplicitRange('1','1'+'0'.repeat(60),true,18,1),/native Uniswap tick bounds/);
console.log('PASS: exact units, canonical TickMath, both orientations, one-sided liquidity, integer budget conservation and native bounds');

const originalFetch=globalThis.fetch,originalNow=Date.now;let now=originalNow(),state;
Date.now=()=>now;
const reset=()=>state={chain:'0x1237',allowance:0n,balance:10n**20n,tokenBalance:10n**20n,nonce:0n,receipt:null,broadcasts:[],reads:[],failSend:false,estimateAdvance:0,nonceAdvance:0,identityFactory:factory};reset();
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.paybox.sh/')){
  const body=JSON.parse(options.body);state.payboxCalls??=[];state.payboxCalls.push({body,headers:{...options.headers}});
  if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fixture',version:'1'}}},{headers:{'mcp-session-id':'fixture-session'}});
  if(body.method==='notifications/initialized'||body.params?.name==='list_credentials')assert.equal(options.headers['mcp-session-id'],'fixture-session','Credential list follows standards-correct MCP initialization');
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  const name=body.params?.name;
  if(name==='list_credentials')return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify({credentials:[{credential_id:'granted-wallet',kind:'wallet',metadata:{address:owner}}]})}]}});
  if(name==='request_wallet_sign')return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify({request_id:'fixture-request'})}]}});
  throw Error('Unexpected PayBox mock call');
 }
 const {method,params}=JSON.parse(options.body);state.reads.push({method,params});let result;
 if(method==='eth_chainId')result=state.chain;
 else if(method==='eth_blockNumber')result='0xabc';
 else if(method==='eth_getBalance')result='0x'+state.balance.toString(16);
 else if(method==='eth_getTransactionCount'){now+=state.nonceAdvance;result='0x'+state.nonce.toString(16);}
 else if(method==='eth_gasPrice')result='0x989680';
 else if(method==='eth_getCode')result='0x6000';
 else if(method==='eth_estimateGas'){now+=state.estimateAdvance;result='0x30000';}
 else if(method==='eth_getTransactionReceipt')result=state.receipt;
 else if(method==='eth_sendRawTransaction'){state.broadcasts.push(params[0]);if(state.onBroadcast)await state.onBroadcast();if(state.failSend)throw Error('Transport failed before delivery');result=bytesHex(keccak_256(hexBytes(params[0])));}
 else if(method==='eth_call'){
  const d=params[0].data,selector=d.slice(0,10);
  const reads={'0xc45a0155':addressAbi(state.identityFactory),'0x0dfe1681':addressAbi(weth),'0xd21220a7':addressAbi(token),'0xddca3f43':abi(3000),'0xd0c93a7c':abi(60),'0x3850c7bd':abi(1n<<96n,0,0,0,0,0,1),'0x1698ee82':addressAbi(poolAddress),'0x313ce567':abi(18),'0x70a08231':abi(state.tokenBalance),'0xdd62ed3e':abi(state.allowance),'0xc6a5026a':abi(2n*10n**18n,1n<<96n,0,100000),'0x04e45aaf':abi(2n*10n**18n),'0x095ea7b3':abi(1)};
  result=reads[selector];
  if(selector==='0xac9650d8'){
   // Mint starts after selector+offset+length+two offsets+first bytes length.
   const mint=d.slice(10+64*5),body=mint.slice(8),words=Array.from({length:11},(_,i)=>BigInt('0x'+body.slice(i*64,(i+1)*64))),lower=Number(BigInt.asIntN(24,words[3])),upper=Number(BigInt.asIntN(24,words[4])),a=v3Amounts(1n<<96n,lower,upper,words[5],words[6]);
   result=returnMulticall([word(1)+word(a.liquidity)+word(a.amount0)+word(a.amount1),'']);
  }
  if(result==null)throw Error('Unexpected ABI selector '+selector);
 }else throw Error('Unexpected RPC method '+method);
 return Response.json({jsonrpc:'2.0',id:1,result});
};
try{
 let p=await buildEvmPreview(input,pool,'https://fixture-rpc');assert.equal(p.stage,'approval');assert.equal(p.transaction.value,'0x0');assert.equal(BigInt('0x'+p.transaction.data.slice(-64)),10n**18n);assert.ok(p.nextReviewRequired);assert.ok(state.reads.filter(r=>r.method==='eth_call').every(r=>r.params[1]==='0xabc'));
 const raw=signed(p.transaction),v=verifySignedEvmTransaction(raw,p.transaction);assert.equal(v.txHash,bytesHex(keccak_256(hexBytes(raw))));assert.deepEqual(signedEvmTransaction(p.transaction,{output:{value:{serializedTransaction:raw}}}),v);
 assert.throws(()=>signedEvmTransaction(p.transaction,{output:{value:{signature:raw}}}),/documented/);assert.throws(()=>verifySignedEvmTransaction(raw,{...p.transaction,value:'0x1'}),/differs/);assert.throws(()=>verifySignedEvmTransaction(signed(p.transaction,new Uint8Array(32).fill(2)),p.transaction),/different wallet/);assert.throws(()=>verifySignedEvmTransaction(raw+'00',p.transaction),/Trailing/);
 reset();state.allowance=10n**20n;p=await buildEvmPreview(input,pool,'https://fixture-rpc');assert.equal(p.stage,'mint');assert.equal(p.review.simulated.eth,p.review.expectedEth);assert.ok(BigInt(p.review.allocation.amount0Raw)<=10n**18n&&BigInt(p.review.allocation.amount1Raw)<=10n**18n);assert.ok(p.expiresAt<=p.review.contractDeadline*1000-5000);
 reset();p=await buildEvmPreview({...input,amountToken:'0',priceLowerEth:'0.5',priceUpperEth:'0.7'},pool,'https://fixture-rpc');assert.equal(p.stage,'mint');assert.equal(p.review.expectedToken,'0','ETH-only below-price range does not require token approval');
 reset();state.estimateAdvance=30000;p=await buildEvmPreview({...input,amountToken:'0',priceLowerEth:'0.5',priceUpperEth:'0.7'},pool,'https://fixture-rpc');assert.ok(p.expiresAt<p.builtAt+75000,'Slow simulation cannot outlive calldata deadline');
 reset();p=await buildEvmPreview({...input,action:'buy'},pool,'https://fixture-rpc');assert.equal(p.stage,'buy');assert.equal(p.review.minimumToken,'1.98');assert.equal(p.transaction.value,'0xde0b6b3a7640000');
 reset();state.chain='0x1';await assert.rejects(()=>buildEvmPreview(input,pool,'https://fixture-rpc'),/chain4663/);
 reset();state.identityFactory='0x'+'12'.repeat(20);await assert.rejects(()=>buildEvmPreview(input,pool,'https://fixture-rpc'),/identity/);
 reset();state.balance=10n**18n-1n;await assert.rejects(()=>buildEvmPreview(input,pool,'https://fixture-rpc'),/ETH budget/);assert.ok(!state.reads.some(r=>r.params[0]?.data?.startsWith('0x095ea7b3')),'Impossible native budget cannot spend approval gas');
 reset();state.balance=10n**18n;await assert.rejects(()=>buildEvmPreview(input,pool,'https://fixture-rpc'),/maximum simulated gas/);
 console.log('PASS: canonical RPC identity, pinned simulation, exact approvals, native-only mint, deadline, buy minimum and wallet budget failures');

 const storageMap=new Map(),storage={get:async k=>structuredClone(storageMap.get(k)),put:async(k,v)=>storageMap.set(k,structuredClone(v))},journal=new EvmExecution({storage},{});
 const invoke=async(path,body)=>{const response=await journal.fetch(new Request('https://journal'+path,{method:'POST',body:JSON.stringify({owner,credentialId:input.credentialId,sessionId:'session-a',...body})}));return {status:response.status,data:await response.json()};};
 reset();assert.equal((await invoke('/status',{})).data.status,'none');
 p=(await invoke('/preview',{input,pool,rpc:'https://fixture-rpc'})).data;
 await assert.rejects(async()=>{const r=await invoke('/preview',{operationId:p.operationId,input,pool,rpc:'https://fixture-rpc'});if(r.status>=400)throw Error(r.data.error);},/approval receipt/);
 const reservations=await Promise.all([invoke('/prepare-sign',{previewId:p.previewId,transactionJson:p.transactionJson}),invoke('/prepare-sign',{previewId:p.previewId,transactionJson:p.transactionJson})]);assert.deepEqual(reservations.map(x=>x.status).sort(),[200,400]);
 assert.equal((await invoke('/send',{previewId:p.previewId,signedTransactionHex:signed(p.transaction)})).status,400,'Unsigned request reservation alone is not a PayBox-bound request');
 await invoke('/bind-request',{previewId:p.previewId,requestId:'request-a'});
 assert.equal((await invoke('/send',{previewId:p.previewId,signedTransactionHex:signed({...p.transaction,value:'0x1'})})).status,400);
 state.onBroadcast=async()=>{const saved=await storage.get('operation');assert.equal(saved.status,'submitting');assert.equal(saved.txHash,bytesHex(keccak_256(hexBytes(saved.signedTransactionHex))),'Hash and exact bytes are durable before submission');};
 state.failSend=true;let r=await invoke('/send',{previewId:p.previewId,signedTransactionHex:signed(p.transaction)});assert.equal(r.data.status,'submitting');assert.ok(r.data.retrySameAvailable);assert.equal(state.broadcasts.length,1);
 r=await invoke('/send',{previewId:p.previewId,signedTransactionHex:signed(p.transaction)});assert.equal(state.broadcasts.length,1,'Repeated send reconciles without a blind second broadcast');
 state.failSend=false;r=await invoke('/send',{previewId:p.previewId,retrySame:true,signedTransactionHex:'malicious replacement'});assert.equal(r.data.status,'pending');assert.equal(state.broadcasts.length,2);assert.equal(state.broadcasts[0],state.broadcasts[1],'Explicit retry submits only the durable same bytes');
 assert.equal((await invoke('/status',{credentialId:'different'})).status,400);
 state.receipt={transactionHash:r.data.txHash,from:owner,to:p.transaction.to,gasUsed:'0x100'};assert.equal((await invoke('/status',{})).status,400);assert.equal((await storage.get('operation')).status,'pending','Incomplete receipt cannot release the wallet journal');
 state.receipt={...state.receipt,status:'0x1',blockNumber:'0xabc'};r=await invoke('/status',{});assert.equal(r.data.status,'confirmed');assert.equal(r.data.nextReviewRequired,true);
 state.allowance=10n**20n;state.nonce=1n;p=(await invoke('/preview',{operationId:p.operationId,input,pool,rpc:'https://fixture-rpc',sessionId:'session-b'})).data;assert.equal(p.stage,'mint');assert.equal(p.transaction.nonce,1);assert.notEqual(p.previewId,reservations[0].data.previewId,'Approval confirmation requires a new simulation and signing review');
 await invoke('/prepare-sign',{previewId:p.previewId,transactionJson:p.transactionJson,sessionId:'session-b'});await invoke('/bind-request',{previewId:p.previewId,requestId:'request-b',sessionId:'session-b'});
 const count=state.broadcasts.length;now=p.expiresAt-10;state.nonceAdvance=20;r=await invoke('/send',{previewId:p.previewId,signedTransactionHex:signed(p.transaction)});assert.equal(r.status,400);assert.match(r.data.error,/expired during/);assert.equal(state.broadcasts.length,count);
 console.log('PASS: durable hash before send, nonce/signature binding, serialized signing reservation, approval then fresh mint, explicit same-hash retry and final expiry guard');

 reset();now=originalNow();const sid='a'.repeat(43),sid2='b'.repeat(43),kvMap=new Map([['paybox:session:'+sid,JSON.stringify({token:'fixture-not-a-secret',expiresAt:now+60000})],['paybox:session:'+sid2,JSON.stringify({token:'fixture-not-a-secret',expiresAt:now+60000})]]),kv={get:async k=>kvMap.has(k)?JSON.parse(kvMap.get(k)):null,put:async(k,v)=>kvMap.set(k,v)};
 const origin='https://terminal.test',request=(path,method='GET',body,session=sid,site=origin)=>new Request(origin+path,{method,headers:{cookie:'lp_paybox='+session,origin:site,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const freshStorage=new Map(),freshJournal=new EvmExecution({storage:{get:async k=>structuredClone(freshStorage.get(k)),put:async(k,v)=>freshStorage.set(k,structuredClone(v))}},{});let failBindOnce=true;
 const env={LP_CACHE:kv,EVM_EXECUTION:{idFromName:n=>n,get:()=>({fetch:(url,options)=>{if(String(url).endsWith('/bind-request')&&failBindOnce){failBindOnce=false;return Response.json({error:'Transient journal write failed'},{status:503});}return freshJournal.fetch(new Request(url,options));}})}};
 await assert.rejects(()=>verifiedPayboxCredential(request('/'),env,'ungranted',owner),/not granted/);assert.deepEqual(state.payboxCalls.slice(0,3).map(c=>c.body.method),['initialize','notifications/initialized','tools/call']);
 assert.equal((await evmRoute(request('/api/evm/preview','POST',input,sid,'https://evil.test'),env,async()=>({pools:[pool]}),async()=>'https://fixture-rpc')).status,403);
 let response=await evmRoute(request('/api/evm/preview','POST',input),env,async()=>({pools:[pool]}),async()=>'https://fixture-rpc');p=await response.json();assert.equal(response.status,200);
 // Proxy forwards only the exact stored normalized intent and records the upstream request ID.
 const tool={method:'tools/call',params:{name:'request_wallet_sign',arguments:{credential_id:input.credentialId,_evmPreviewId:p.previewId,intent:{op:'transaction',transaction:p.transactionJson}}}};
 response=await payboxRoute(request('/api/paybox/mcp','POST',tool),env);assert.equal(response.status,200);assert.equal((await freshStorage.get('operation')).requestId,undefined);assert.ok(kvMap.has('paybox:request:'+sid+':'+p.previewId));assert.ok(kvMap.has('paybox:signing:'+sid+':fixture-request'));
 response=await evmRoute(request('/api/evm/status?owner='+owner+'&credentialId='+input.credentialId),env,async()=>({pools:[pool]}),async()=>'https://fixture-rpc');assert.equal(response.status,200);assert.equal((await response.json()).requestId,'fixture-request','Same-session status repairs a transient bind failure without another signing request');assert.equal(state.payboxCalls.filter(c=>c.body.params?.name==='request_wallet_sign').length,1);
 response=await evmRoute(request('/api/evm/status?owner='+owner+'&credentialId='+input.credentialId,'GET',null,sid2),env,async()=>({pools:[pool]}),async()=>'https://fixture-rpc');r=await response.json();assert.equal(r.requestId,'fixture-request');assert.ok(kvMap.has('paybox:signing:'+sid2+':fixture-request'),'A separately granted web session recovers the existing request without creating another one');
 response=await evmRoute(request('/api/evm/status?owner='+owner+'&credentialId=ungranted'),env,async()=>({pools:[pool]}),async()=>'https://fixture-rpc');assert.equal(response.status,400);
 console.log('PASS: same-origin routes, OAuth grant ownership, MCP handshake/session headers, exact PayBox intent and cross-session same-request recovery');
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
