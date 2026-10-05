import type {Env} from './env';
import type {Pool} from './schema';
import type {UnsignedTx} from './executor';
import {RH} from './sources/uniswap-positions';
import {decodeMulticall} from './exit-review';
import {verifiedPayboxCredential,payboxEvmJournal} from './paybox';
import {EVM_CHAIN_ID,evmAddress,parseUnits,formatUnits,v3ExplicitRange,v3Amounts,verifySignedEvmTransaction} from './evm-math';

const ROUTER='0xcaf681a66d020601342297493863e78c959e5cb2',QUOTER='0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';
const word=(n:bigint)=>BigInt.asUintN(256,n).toString(16).padStart(64,'0'),addr=(a:string)=>evmAddress(a).slice(2).padStart(64,'0'),hex=(n:bigint)=>'0x'+n.toString(16);
const atWord=(data:string,i:number)=>{if(!/^0x([0-9a-fA-F]{64})+$/.test(data)||data.length<2+(i+1)*64)throw Error('Chain returned incomplete ABI data.');return BigInt('0x'+data.slice(2+i*64,2+(i+1)*64));};
const atAddress=(data:string,i=0)=>'0x'+atWord(data,i).toString(16).padStart(64,'0').slice(-40);
const int24=(value:bigint)=>Number(BigInt.asIntN(24,value));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const MAX128=(1n<<128n)-1n;
interface ReadContext {rpc:string;requests:number;deadline:number}
async function rpc<T=string>(c:ReadContext,method:string,params:unknown[]):Promise<T>{
 if(c.requests>=30||Date.now()>c.deadline)throw Error('Execution read budget reached. Review again.');c.requests++;
 const response=await fetch(c.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:c.requests,method,params}),signal:AbortSignal.timeout(Math.max(1,Math.min(10000,c.deadline-Date.now())))});
 const data:any=await response.json();if(!response.ok||data.error||data.result==null)throw Error(data.error?'Transaction read or simulation failed on chain.':'Robinhood provider returned an incomplete read.');return data.result;
}
const call=(c:ReadContext,to:string,data:string,block:string,from?:string,value?:string)=>rpc<string>(c,'eth_call',[{to,data,...(from?{from}:{}),...(value?{value}:{})},block]);
function multicall(calls:string[]){const encs=calls.map(c=>{const raw=c.slice(2);return word(BigInt(raw.length/2))+raw.padEnd(Math.ceil(raw.length/64)*64,'0');});let offset=32*calls.length;const offsets=encs.map(e=>{const value=word(BigInt(offset));offset+=e.length/2;return value;});return '0xac9650d8'+word(32n)+word(BigInt(calls.length))+offsets.join('')+encs.join('');}
export interface EvmInput {action:'open'|'buy';pool:string;owner:string;credentialId:string;amountEth:string;amountToken?:string;priceLowerEth?:string;priceUpperEth?:string;lowerPriceEth?:string;upperPriceEth?:string;strategy?:string;slippageBps:number;operationId?:string}
export interface EvmPreview {previewId:string;operationId:string;action:'open'|'buy';chainId:4663;owner:string;credentialId:string;stage:'approval'|'mint'|'buy';expiresAt:number;builtAt:number;transaction:UnsignedTx;tx:UnsignedTx;transactionJson:string;steps:{id:string;kind:string;tx:UnsignedTx;summary:string}[];humanSummary:string;review:Record<string,unknown>;nextReviewRequired:boolean}
interface Operation {operationId:string;owner:string;credentialId:string;sessionId:string;action:'open'|'buy';input:EvmInput;pool:Pool;rpc:string;status:'review'|'awaiting-signature'|'submitting'|'pending'|'confirmed'|'reverted'|'expired';stage:EvmPreview['stage'];preview:EvmPreview;requestId?:string;txHash?:string;signedTransactionHex?:string;receipt?:any;updatedAt:number}

async function identity(pool:Pool,c:ReadContext){
 if(pool.chain!=='robinhood'||pool.venue!=='uniswap-v3'||pool.feeTier==null)throw Error('Choose a catalogued Robinhood Uniswap V3 WETH pool.');
 if(BigInt(await rpc(c,'eth_chainId',[]))!==BigInt(EVM_CHAIN_ID))throw Error('RPC is not Robinhood mainnet chain4663.');
 const block=await rpc(c,'eth_blockNumber',[]),poolAddress=evmAddress(pool.address);
 const [factory,t0,t1,feeRead,spacingRead,slot0]=await Promise.all(['0xc45a0155','0x0dfe1681','0xd21220a7','0xddca3f43','0xd0c93a7c','0x3850c7bd'].map(selector=>call(c,poolAddress,selector,block)));
 const token0=atAddress(t0),token1=atAddress(t1),fee=Number(atWord(feeRead,0)),spacing=Number(atWord(spacingRead,0)),sqrtP=atWord(slot0,0),tick=int24(atWord(slot0,1));
 if(atAddress(factory)!==RH.v3Factory.toLowerCase()||token0>=token1||!Number.isInteger(fee)||fee<=0||fee>1000000||Math.round(pool.feeTier*1e6)!==fee||!Number.isInteger(spacing)||spacing<1||spacing>16384||sqrtP<=0n||tick<-887272||tick>887272||![pool.base.address.toLowerCase(),pool.quote.address.toLowerCase()].every(t=>t===token0||t===token1))throw Error('Selected pool identity or configuration did not match the canonical factory.');
 if(atAddress(await call(c,RH.v3Factory,'0x1698ee82'+addr(token0)+addr(token1)+word(BigInt(fee)),block))!==poolAddress)throw Error('Factory pool address differs from the selected pool.');
 const wethIs0=token0===RH.weth.toLowerCase();if(!wethIs0&&token1!==RH.weth.toLowerCase())throw Error('Robinhood opening supports WETH pairs.');const token=wethIs0?token1:token0;
 const decimals=Number(atWord(await call(c,token,'0x313ce567',block),0));if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Token decimals could not be verified.');
 return {block,poolAddress,token0,token1,token,decimals,wethIs0,fee,spacing,sqrtP,tick,symbol:pool.base.address.toLowerCase()===token?pool.base.symbol:pool.quote.symbol};
}
export async function buildEvmPreview(input:EvmInput,pool:Pool,rpcUrl:string,operationId=crypto.randomUUID()):Promise<EvmPreview>{
 const owner=evmAddress(input.owner),c:ReadContext={rpc:rpcUrl,requests:0,deadline:Date.now()+40000};
 if(!['open','buy'].includes(input.action)||!Number.isInteger(input.slippageBps)||input.slippageBps<10||input.slippageBps>300)throw Error('Choose opening or buying with slippage between0.1% and3%.');
 if(input.strategy&&input.strategy!=='spot')throw Error('Robinhood V3 currently opens one uniform-liquidity range. Native Bid-Ask is available on Meteora.');
 const p=await identity(pool,c),ethBudget=parseUnits(input.amountEth,18);if(ethBudget>100n*10n**18n)throw Error('The ETH budget exceeds100ETH.');
 const [ethBalanceHex,tokenBalanceHex,nonceHex,gasPriceHex]=await Promise.all([rpc(c,'eth_getBalance',[owner,p.block]),call(c,p.token,'0x70a08231'+addr(owner),p.block),rpc(c,'eth_getTransactionCount',[owner,'pending']),rpc(c,'eth_gasPrice',[])]);
 const ethBalance=BigInt(ethBalanceHex),tokenBalance=atWord(tokenBalanceHex,0),nonce=Number(BigInt(nonceHex)),gasPrice=BigInt(gasPriceHex);if(!Number.isSafeInteger(nonce)||nonce<0||gasPrice<=0n)throw Error('Current transaction nonce or gas price is invalid.');
 if(ethBudget>ethBalance)throw Error('Explicit native ETH budget exceeds this wallet balance.');
 let to:string,data:string,value=0n,stage:EvmPreview['stage'],summary:string,review:Record<string,unknown>,expected0=0n,expected1=0n,contractDeadline:number|undefined;
 if(input.action==='buy'){
  if(ethBudget<=0n)throw Error('Choose a positive explicit ETH buy budget.');
  const quoted=await call(c,QUOTER,'0xc6a5026a'+addr(RH.weth)+addr(p.token)+word(ethBudget)+word(BigInt(p.fee))+word(0n),p.block),expected=atWord(quoted,0),minimum=expected*BigInt(10000-input.slippageBps)/10000n;
  if(expected<=0n||minimum<=0n)throw Error('Buy quote returned no usable minimum token output.');
  to=ROUTER;data='0x04e45aaf'+addr(RH.weth)+addr(p.token)+word(BigInt(p.fee))+addr(owner)+word(ethBudget)+word(minimum)+word(0n);value=ethBudget;stage='buy';summary='Buy '+formatUnits(ethBudget)+' ETH of '+p.symbol+' through the selected V3 pool. Minimum '+formatUnits(minimum,p.decimals)+' '+p.symbol+'.';
  review={amountEth:formatUnits(ethBudget),expectedToken:formatUnits(expected,p.decimals),minimumToken:formatUnits(minimum,p.decimals),tokenBalanceBefore:formatUnits(tokenBalance,p.decimals)};
 }else{
  const tokenBudget=parseUnits(input.amountToken,p.decimals);if(tokenBudget>MAX128)throw Error('Token budget exceeds the supported raw-unit bound.');
  const range=v3ExplicitRange(input.priceLowerEth??input.lowerPriceEth??'',input.priceUpperEth??input.upperPriceEth??'',p.wethIs0,p.decimals,p.spacing),budget0=p.wethIs0?ethBudget:tokenBudget,budget1=p.wethIs0?tokenBudget:ethBudget,amounts=v3Amounts(p.sqrtP,range.tickLower,range.tickUpper,budget0,budget1);
  expected0=amounts.amount0;expected1=amounts.amount1;const expectedToken=p.wethIs0?expected1:expected0,expectedEth=p.wethIs0?expected0:expected1;
  if(tokenBudget>tokenBalance)throw Error('Explicit token budget exceeds this wallet token balance. Buy tokens separately or lower the budget.');
  const allowance=atWord(await call(c,p.token,'0xdd62ed3e'+addr(owner)+addr(RH.npm),p.block),0);
  review={amountEth:formatUnits(ethBudget),amountToken:formatUnits(tokenBudget,p.decimals),expectedEth:formatUnits(expectedEth),expectedToken:formatUnits(expectedToken,p.decimals),range,allocation:{liquidity:amounts.liquidity.toString(),amount0Raw:expected0.toString(),amount1Raw:expected1.toString(),token0:p.token0,token1:p.token1},unusedEth:formatUnits(ethBudget-expectedEth),unusedToken:formatUnits(tokenBudget-expectedToken,p.decimals),tokenBalanceBefore:formatUnits(tokenBalance,p.decimals)};
  if(expectedToken>0n&&allowance<tokenBudget){to=p.token;data='0x095ea7b3'+addr(RH.npm)+word(tokenBudget);stage='approval';summary='Approve exactly '+formatUnits(tokenBudget,p.decimals)+' '+p.symbol+' for the canonical V3 position manager. This does not open liquidity. After confirmation, review a freshly simulated mint.';}
  else{to=RH.npm;value=ethBudget;contractDeadline=Math.floor(Date.now()/1000)+90;const minimum=(n:bigint)=>n*BigInt(10000-input.slippageBps)/10000n,deadline=BigInt(contractDeadline),mint='0x88316456'+addr(p.token0)+addr(p.token1)+word(BigInt(p.fee))+word(BigInt(range.tickLower))+word(BigInt(range.tickUpper))+word(budget0)+word(budget1)+word(minimum(expected0))+word(minimum(expected1))+addr(owner)+word(deadline);data=multicall([mint,'0x12210e8a']);stage='mint';summary='Open one '+pool.pair+' V3 position at native ticks '+range.tickLower+' to '+range.tickUpper+'. ETH and paired-token budgets are explicit; unused ETH is refunded and unused tokens remain in your wallet.';}
 }
 if(value>ethBalance)throw Error('Explicit native ETH budget exceeds this wallet balance.');
 const code=await rpc(c,'eth_getCode',[to,p.block]);if(!/^0x[0-9a-fA-F]+$/.test(code)||code==='0x'||code==='0x0')throw Error('Execution target has no verified deployed code.');
 const simulation=await call(c,to,data,p.block,owner,hex(value));
 if(stage==='buy'&&atWord(simulation,0)<parseUnits(String(review.minimumToken),p.decimals))throw Error('Buy simulation returned less than the reviewed minimum output.');
 if(stage==='approval'){if(simulation!=='0x'&&atWord(simulation,0)!==1n)throw Error('Token approval simulation did not succeed.');}
 if(stage==='mint'){const results=decodeMulticall(simulation);if(results.length!==2)throw Error('Mint simulation returned incomplete results.');const mintResult='0x'+results[0],liquidity=atWord(mintResult,1),actual0=atWord(mintResult,2),actual1=atWord(mintResult,3),budget0=p.wethIs0?ethBudget:parseUnits(input.amountToken,p.decimals),budget1=p.wethIs0?parseUnits(input.amountToken,p.decimals):ethBudget;
  if(liquidity<=0n||actual0>budget0||actual1>budget1||actual0<expected0*BigInt(10000-input.slippageBps)/10000n||actual1<expected1*BigInt(10000-input.slippageBps)/10000n)throw Error('Simulated mint exceeds its reviewed budgets or minimums.');review.simulated={liquidity:liquidity.toString(),amount0Raw:actual0.toString(),amount1Raw:actual1.toString(),eth:formatUnits(p.wethIs0?actual0:actual1),token:formatUnits(p.wethIs0?actual1:actual0,p.decimals)};
 }
 const estimate=BigInt(await rpc(c,'eth_estimateGas',[{from:owner,to,data,value:hex(value)},p.block]));if(estimate<=0n)throw Error('Gas simulation returned no usable estimate.');const gas=estimate*13n/10n,maxFee=gasPrice*2n,gasBudget=gas*maxFee;
 if((stage==='approval'?ethBudget:value)+gasBudget>ethBalance)throw Error('Budget plus maximum simulated gas exceeds the wallet ETH balance.');
 const tx:UnsignedTx={chainId:EVM_CHAIN_ID,from:owner,to:evmAddress(to),data,value:hex(value),nonce,gas:hex(gas),maxFeePerGas:hex(maxFee),maxPriorityFeePerGas:hex(gasPrice/10n||1n),type:'0x2'},previewId=crypto.randomUUID(),builtAt=Date.now();
 const expiresAt=Math.min(builtAt+75000,contractDeadline?contractDeadline*1000-5000:Infinity);if(expiresAt<=builtAt)throw Error('The simulated mint deadline expired. Review again.');
 return {previewId,operationId,action:input.action,chainId:EVM_CHAIN_ID,owner,credentialId:input.credentialId,stage,expiresAt,builtAt,transaction:tx,tx,transactionJson:JSON.stringify(tx),steps:[{id:previewId,kind:stage,tx,summary}],humanSummary:summary,review:{...review,budgets:{amountEth:review.amountEth,amountToken:review.amountToken??'0'},allocations:{amountEth:review.expectedEth??review.amountEth,amountToken:review.expectedToken??'0'},gasMaxEth:formatUnits(gasBudget),minimumTokenOut:review.minimumToken,contractDeadline:contractDeadline??null,pool:pool.id,poolAddress:p.poolAddress,pair:pool.pair,token:{address:p.token,symbol:p.symbol,decimals:p.decimals},nativeBalanceEth:formatUnits(ethBalance),maximumGasEth:formatUnits(gasBudget),simulationBlock:BigInt(p.block).toString(),gasEstimate:estimate.toString(),slippageBps:input.slippageBps,network:'Robinhood Chain mainnet',shape:'Uniform V3 liquidity; native DLMM Bid-Ask is not a V3 feature.',reads:c.requests},nextReviewRequired:stage==='approval'};
}

// One object per Robinhood wallet serializes reviews, signing reservations and
// deterministic submission hashes. Tokens/keys never enter this journal.
export class EvmExecution {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private state:DurableObjectState,private env:Env){}
 fetch(req:Request):Promise<Response>{const work=this.tail.then(()=>this.handle(req));this.tail=work.catch(()=>{});return work;}
 private async handle(req:Request):Promise<Response>{try{
  const input:any=await req.json(),path=new URL(req.url).pathname,owner=evmAddress(input.owner);let op=await this.state.storage.get<Operation>('operation');
  const check=()=>{if(!op||op.owner!==owner||op.credentialId!==input.credentialId||input.operationId&&op.operationId!==input.operationId||input.previewId&&op.preview.previewId!==input.previewId)throw Error('This operation does not belong to the selected wallet and credential.');};
  const save=async()=>{op!.updatedAt=Date.now();await this.state.storage.put('operation',op!);};
  if(path==='/preview'){
   if(op&&['awaiting-signature','submitting','pending'].includes(op.status)&&!(op.status==='awaiting-signature'&&!op.txHash&&op.preview.expiresAt<=Date.now()))throw Error('Resume the existing operation before making another review.');
   if(input.operationId){check();if(op!.status!=='confirmed'||op!.stage!=='approval')throw Error('A new mint review requires the approval receipt to be confirmed.');}
   const preview=await buildEvmPreview(input.input,input.pool,input.rpc,input.operationId||crypto.randomUUID());
   op={operationId:preview.operationId,owner,credentialId:input.credentialId,sessionId:input.sessionId,action:preview.action,input:input.input,pool:input.pool,rpc:input.rpc,status:'review',stage:preview.stage,preview,updatedAt:Date.now()};await save();return json(preview);
  }
  if(path==='/status'&&!op)return json({status:'none',operationId:null,preview:null});check();
  if(path==='/prepare-sign'){
   if(typeof input.previewId!=='string'||!input.previewId||op!.preview.expiresAt<=Date.now()||op!.status!=='review'||op!.preview.transactionJson!==input.transactionJson)throw Error(op!.requestId?'Resume the existing PayBox signing request.':'This exact unsigned review is expired or already reserved. Review again.');
   op!.sessionId=input.sessionId;op!.status='awaiting-signature';await save();return json({operationId:op!.operationId,previewId:op!.preview.previewId});
  }
  if(path==='/bind-request'){if(op!.status!=='awaiting-signature'||op!.sessionId!==input.sessionId||typeof input.requestId!=='string')throw Error('Signing request does not match the reserved review.');if(op!.requestId&&op!.requestId!==input.requestId)throw Error('An existing request is already bound.');op!.requestId=input.requestId;await save();return json({ok:true});}
  if(path==='/send'){
   if(op!.txHash){
    if(!input.retrySame)return json(this.publicOperation(op!));
    if(op!.status!=='submitting'||!op!.signedTransactionHex||op!.preview.expiresAt<=Date.now())throw Error('This operation cannot retry. Reconcile its existing hash.');
    const c:ReadContext={rpc:op!.rpc,requests:0,deadline:Date.now()+15000};if(BigInt(await rpc(c,'eth_chainId',[]))!==BigInt(EVM_CHAIN_ID))throw Error('RPC is not Robinhood mainnet.');
    if(op!.preview.expiresAt<=Date.now())throw Error('The reviewed transaction expired before retry.');
    try{const hash=await rpc(c,'eth_sendRawTransaction',[op!.signedTransactionHex]);if(hash.toLowerCase()!==op!.txHash)throw Error('Unexpected transaction hash.');op!.status='pending';await save();}catch{}
    return json(this.publicOperation(op!));
   }if(op!.preview.expiresAt<=Date.now()||op!.status!=='awaiting-signature'||!op!.requestId)throw Error('Only the current PayBox-bound signed review can be submitted.');
   const verified=verifySignedEvmTransaction(input.signedTransactionHex,op!.preview.transaction,owner),c:ReadContext={rpc:op!.rpc,requests:0,deadline:Date.now()+20000};
   if(BigInt(await rpc(c,'eth_chainId',[]))!==BigInt(EVM_CHAIN_ID)||Number(BigInt(await rpc(c,'eth_getTransactionCount',[owner,'pending'])))!==op!.preview.transaction.nonce)throw Error('Network or pending nonce changed. Check wallet activity and review again.');
   if(op!.preview.expiresAt<=Date.now())throw Error('The reviewed transaction expired during network checks.');
   op!.txHash=verified.txHash;op!.signedTransactionHex=verified.signedTransactionHex;op!.status='submitting';await save();
   try{const hash=await rpc(c,'eth_sendRawTransaction',[verified.signedTransactionHex]);if(hash.toLowerCase()!==verified.txHash)throw Error('Provider returned a different transaction hash.');op!.status='pending';await save();}catch{/* Persisted deterministic hash is authoritative for reconciliation. Never create a replacement after an uncertain send. */}
   return json(this.publicOperation(op!));
  }
  if(path==='/status'){
   if(op!.txHash){const c:ReadContext={rpc:op!.rpc,requests:0,deadline:Date.now()+15000};let receipt:any;try{receipt=await rpc(c,'eth_getTransactionReceipt',[op!.txHash]);}catch{}
    if(receipt){if(receipt.transactionHash?.toLowerCase()!==op!.txHash||receipt.from?.toLowerCase()!==owner||receipt.to?.toLowerCase()!==op!.preview.transaction.to)throw Error('Receipt identity differs from this reviewed transaction.');if(!['0x0','0x1'].includes(receipt.status)||typeof receipt.blockNumber!=='string'||!/^0x[0-9a-f]+$/i.test(receipt.blockNumber)||BigInt(receipt.blockNumber)<=0n)throw Error('The provider receipt is not complete mined evidence. Keep reconciling the existing hash.');op!.receipt={transactionHash:receipt.transactionHash,status:receipt.status,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed};op!.status=receipt.status==='0x1'?'confirmed':'reverted';await save();}
   }else if(op!.preview.expiresAt<=Date.now()){op!.status='expired';await save();}
   return json(this.publicOperation(op!));
  }
  throw Error('Unknown execution journal action.');
 }catch(e){return json({error:e instanceof Error?e.message:'Execution is unavailable.'},400);}}
 private publicOperation(op:Operation){return {operationId:op.operationId,action:op.action,owner:op.owner,credentialId:op.credentialId,stage:op.stage,status:op.status,preview:op.preview,requestId:op.requestId??null,txHash:op.txHash??null,receipt:op.receipt??null,retrySameAvailable:op.status==='submitting'&&!!op.signedTransactionHex&&op.preview.expiresAt>Date.now(),nextReviewRequired:op.status==='confirmed'&&op.stage==='approval',explorer:op.txHash?RH.explorer+'/tx/'+op.txHash:null};}
}

export async function evmRoute(req:Request,env:Env,snapshot:()=>Promise<{pools:Pool[]}>,chooseRpc:()=>Promise<string>):Promise<Response|null>{
 const url=new URL(req.url);if(!url.pathname.startsWith('/api/evm/'))return null;
 if(req.method==='POST'&&req.headers.get('origin')!==(env.PREVIEW_ORIGIN||url.origin))return json({error:'Open the terminal to review or submit a transaction.'},403);
 try{
  const isPreview=url.pathname==='/api/evm/preview',isSend=url.pathname==='/api/evm/send',isStatus=url.pathname==='/api/evm/status';if(!isPreview&&!isSend&&!isStatus)return json({error:'Unknown Robinhood execution route.'},404);
  if(isStatus?req.method!=='GET':req.method!=='POST')return json({error:'Use the documented execution method.'},405);
  let input:any;if(isStatus)input=Object.fromEntries(url.searchParams);else{const raw=await req.text();if(raw.length>24000)return json({error:'Request too large.'},413);input=JSON.parse(raw);}
  const wallet=await verifiedPayboxCredential(req,env,input.credentialId,input.owner),base={...wallet,operationId:input.operationId,previewId:input.previewId};
  if(isPreview){const pool=(await snapshot()).pools.find(p=>p.id===input.pool);if(!pool)return json({error:'Choose a catalogued Robinhood pool.'},404);return json(await payboxEvmJournal(env,wallet.owner,'/preview',{...base,input,pool,rpc:await chooseRpc()}));}
  let result=await payboxEvmJournal(env,wallet.owner,isSend?'/send':'/status',{...base,signedTransactionHex:input.signedTransactionHex,retrySame:input.retrySame===true});
  if(isStatus&&result.status==='awaiting-signature'&&!result.requestId&&result.preview?.previewId){
   const saved=await env.LP_CACHE.get<{requestId:string}>('paybox:request:'+wallet.sessionId+':'+result.preview.previewId,'json');
   if(saved?.requestId){await payboxEvmJournal(env,wallet.owner,'/bind-request',{...base,operationId:result.operationId,previewId:result.preview.previewId,requestId:saved.requestId});result=await payboxEvmJournal(env,wallet.owner,'/status',{...base,operationId:result.operationId});}
  }
  if(isStatus&&result.requestId)await env.LP_CACHE.put('paybox:signing:'+wallet.sessionId+':'+result.requestId,JSON.stringify({requestId:result.requestId}),{expirationTtl:3600});
  return json(result);
 }catch(e){return json({error:e instanceof Error?e.message:'Robinhood execution is unavailable.'},400);}
}
