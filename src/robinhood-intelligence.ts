import {fetchUniswapHistory,historyTokenMeta,rhRead,RobinhoodHistory,Receipt,IndexedEvents} from './sources/uniswap-history';
import {RH} from './sources/uniswap-positions';
import type {WalletRef} from './sources/meteora-positions';
import {publicError} from './health';

// Indexed transfers include zero-value contract calls. Fetch receipts to verify
// their actual NPM events; never infer LP deposits from a transfer's USD value.
export async function indexedWalletEvents(kv:KVNamespace,wallet:WalletRef,rpc:string):Promise<IndexedEvents>{
 const hashes=new Set<string>(),errors:string[]=[];
 for(const direction of ['fromAddress','toAddress']){
  let pageKey:string|undefined;
  for(let page=0;page<2;page++){
   const result=await rhRead<{transfers:{hash:string}[];pageKey?:string}>(rpc,'alchemy_getAssetTransfers',[{fromBlock:'0x0',toBlock:'latest',[direction]:wallet.address,category:['external','erc20','erc721'],maxCount:'0x64',excludeZeroValue:false,withMetadata:true,...(pageKey?{pageKey}:{})}]);
   if(!Array.isArray(result.transfers))throw new Error('Indexed transfer response unavailable');
   for(const t of result.transfers)hashes.add(t.hash);
   pageKey=result.pageKey;if(!pageKey)break;
  }
  if(pageKey)errors.push('More wallet transactions exist. This view covers up to 200 transfers in each direction.');
 }
 if(hashes.size>150)errors.push('Receipt coverage limited to 150 transactions.');
 const receipts:Receipt[]=[];
 for(const hash of [...hashes].slice(-150)){
  if(!/^0x[0-9a-f]{64}$/i.test(hash))continue;
  try{
   const key='rh:receipt:v1:'+hash;
   let receipt=await kv.get<Receipt>(key,'json');
   if(!receipt){receipt=await rhRead<Receipt>(rpc,'eth_getTransactionReceipt',[hash]);await kv.put(key,JSON.stringify(receipt),{expirationTtl:604800});}
   if(receipt.status==='0x1')receipts.push(receipt);
  }catch{errors.push('A transaction receipt is unavailable; coverage is partial.');}
 }
 return {receipts,complete:!errors.length,errors:[...new Set(errors)]};
}

export async function robinhoodHistory(kv:KVNamespace,wallet:WalletRef,rpc:string,refresh=false):Promise<RobinhoodHistory>{
 const key='rh:history:v4:'+wallet.address.toLowerCase();
 const previous=await kv.get<RobinhoodHistory>(key,'json');
 if(previous&&!refresh&&Date.now()-Date.parse(previous.updatedAt)<300000)return {...previous,wallet:wallet.name};
 const metadata=new Map<string,Awaited<ReturnType<typeof historyTokenMeta>>>();
 try{
  const indexed=/alchemy\.com/.test(rpc)?await indexedWalletEvents(kv,wallet,rpc):undefined;
  const result=await fetchUniswapHistory(wallet,()=>null,async token=>{
   if(!metadata.has(token))metadata.set(token,await historyTokenMeta(rpc,token));
   return metadata.get(token)!;
  },rpc,indexed);
  if(!result.complete&&previous?.records.length&&!result.records.length)return {...previous,status:'stale',complete:false,errors:result.errors};
  await kv.put(key,JSON.stringify(result),{expirationTtl:604800});return result;
 }catch(error){
  console.warn('Robinhood history read:',publicError(error));
  if(previous)return {...previous,status:'stale',complete:false,errors:['Robinhood history refresh failed. Showing the last successful read.']};
  throw new Error('Robinhood history is unavailable. Try refreshing shortly.');
 }
}
export async function walletIntelligence(kv:KVNamespace,wallet:WalletRef,rpc:string,refresh=false){
 const history=await robinhoodHistory(kv,wallet,rpc,refresh);
 const tokens=new Map(history.records.flatMap(p=>p.depositedTokens.map(t=>[t.address,t] as const)));
 const errors=[...history.errors],holdings:{address:string;symbol:string;amount:number|null}[]=[];
 try{holdings.push({address:'native',symbol:'ETH',amount:Number(BigInt(await rhRead<string>(rpc,'eth_getBalance',[wallet.address,'latest'])))/1e18});}
 catch{holdings.push({address:'native',symbol:'ETH',amount:null});errors.push('ETH balance unavailable.');}
 for(const token of tokens.values()){
  try{
   const result=await rhRead<string>(rpc,'eth_call',[{to:token.address,data:'0x70a08231'+wallet.address.slice(2).toLowerCase().padStart(64,'0')},'latest']);
   holdings.push({address:token.address,symbol:token.symbol,amount:Number(BigInt(result))/10**token.decimals});
  }catch{holdings.push({address:token.address,symbol:token.symbol,amount:null});errors.push(`${token.symbol} balance unavailable.`);}
 }
 const closed=history.records.filter(p=>p.status==='closed');
 const durations=closed.filter(p=>p.openedAt&&p.closedAt&&p.ownershipComplete).map(p=>(Date.parse(p.closedAt!)-Date.parse(p.openedAt!))/36e5).sort((a,b)=>a-b);
 const mid=Math.floor(durations.length/2);
 return { ...history,errors,holdings,balancesAt:new Date().toISOString(),
  overview:{open:history.records.filter(p=>p.status==='open').length,closed:closed.length,pools:new Set(history.records.map(p=>p.poolAddress)).size,
   medianHeldHours:durations.length?(durations.length%2?durations[mid]:(durations[mid-1]+durations[mid])/2):null},
  explorer:`${RH.explorer}/address/${wallet.address}`,
  coverage:'Robinhood Uniswap V3 activity from wallet transactions and transfer receipts. Operator calls without a wallet transfer may be absent. Balances cover ETH and LP tokens; other holdings are excluded.'};
}
