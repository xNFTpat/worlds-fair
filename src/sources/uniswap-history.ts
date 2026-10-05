import { readFetch } from './read-fetch';
import type { ClosedPosition } from './meteora-history';
import type { WalletRef } from './meteora-positions';
import { RH } from './uniswap-positions';
export const EVENTS = {
 transfer:'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
 inc:'0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
 dec:'0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4',
 col:'0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01',
 mint:'0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
};
const PUBLIC_RPC='https://rpc.mainnet.chain.robinhood.com',ZERO='0x'+'0'.repeat(40);
const pad=(v:string)=>v.replace(/^0x/,'').padStart(64,'0');
const word=(v:string,n:number)=>'0x'+v.replace(/^0x/,'').slice(n*64,(n+1)*64);
const address=(v:string)=>'0x'+v.slice(-40).toLowerCase();
const integer=(v:string)=>Number(BigInt(v));
const tick=(v:string)=>Number(BigInt.asIntN(24,BigInt(v)));
const order=(a:Log,b:Log)=>integer(a.blockNumber)-integer(b.blockNumber)||integer(a.logIndex)-integer(b.logIndex);
export interface Log {address:string;topics:string[];data:string;blockNumber:string;logIndex:string;transactionHash:string;removed?:boolean;blockTimestamp?:string}
export interface Receipt {logs:Log[];status:string;from:string;gasUsed:string;effectiveGasPrice:string;blockNumber:string}
export interface IndexedEvents {receipts:Receipt[];complete:boolean;errors:string[]}
export interface TokenAmount {address:string;symbol:string;decimals:number;amount:number;raw:string}
export interface LPRecord extends ClosedPosition {
 tokenId:string;status:'open'|'closed'|'transferred'|'awaiting collection';
 depositedTokens:TokenAmount[];withdrawnTokens:TokenAmount[];collectedTokens:TokenAmount[];feeTokens:TokenAmount[]|null;
 feeTier:number;tickLower:number;tickUpper:number;ownershipComplete:boolean;note:string;
 actions:{kind:string;at:string;hash:string;tokens:TokenAmount[];url:string}[];
}
export interface RobinhoodHistory {
 wallet:string;address:string;records:LPRecord[];closed:LPRecord[];errors:string[];
 updatedAt:string;block:number;complete:boolean;discovered:number;status:'fresh'|'partial'|'stale';historyScope?:'wallet-transactions'|'position-events';
}
// Hosted nodes can reject a full-chain range. Try the public indexed node before
// splitting, and never silently narrow coverage to recent blocks.
export async function rhRead<T>(url:string,method:string,params:unknown[]):Promise<T>{
 let last='Robinhood read unavailable';
 for(const endpoint of [...new Set([url,PUBLIC_RPC])])for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await readFetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
   const j=await r.json() as {result?:T;error?:{message:string}};
   if(r.ok&&!j.error&&j.result!=null)return j.result;
   last=j.error?.message??`Read failed (${r.status})`;
   if(!/429|rate|too many|unable to complete|timeout/i.test(last))break;
  }catch{last='Robinhood node did not respond';}
  if(attempt<2)await new Promise(r=>setTimeout(r,600*(attempt+1)));
 }
 throw new Error(last);
}
export async function eventLogs(url:string,topics:(string|string[]|null)[],end:number,from=0):Promise<Log[]>{
 let requests=0;
 async function range(a:number,b:number):Promise<Log[]>{
  if(++requests>48)throw new Error('History range could not be fully read');
  try{
   const data=await rhRead<Log[]>(url,'eth_getLogs',[{address:RH.npm,fromBlock:'0x'+a.toString(16),toBlock:'0x'+b.toString(16),topics}]);
   if(!Array.isArray(data))throw new Error('Invalid event response');
   if(data.length>=1000)throw new Error('Event result limit reached');
   return data.filter(x=>!x.removed);
  }catch(error){
   if(a===b||!/range|limit|results|blocks/i.test(String(error)))throw error;
   const mid=Math.floor((a+b)/2);return [...await range(a,mid),...await range(mid+1,b)];
  }
 }
 return (await range(from,end)).sort(order);
}
export async function historyTokenMeta(url:string,token:string){
 const call=(data:string)=>rhRead<string>(url,'eth_call',[{to:token,data},'latest']);
 const decimals=integer(await call('0x313ce567'));
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Token decimals unavailable');
 const encoded=(await call('0x95d89b41')).slice(2);
 const bytes=encoded.length===64?encoded:encoded.slice(128,128+integer('0x'+encoded.slice(64,128))*2);
 const symbol=new TextDecoder().decode(Uint8Array.from(bytes.match(/../g)??[],h=>parseInt(h,16))).replace(/\0/g,'').slice(0,40)||token.slice(0,8);
 return {symbol,decimals};
}
// A burned NFT's positions(id) reverts. Recover its immutable pool/range from
// the original receipt by matching the pool Mint to this exact manager increase.
export function mintPool(receipt:Receipt,id:string){
 const inc=receipt.logs.find(l=>l.address.toLowerCase()===RH.npm&&l.topics[0]===EVENTS.inc&&BigInt(l.topics[1])===BigInt(id));
 if(!inc)throw new Error('Original deposit event missing');
 const matches=receipt.logs.filter(l=>l.topics[0]===EVENTS.mint&&address(l.topics[1])===RH.npm&&order(l,inc)<0&&
  BigInt(word(l.data,1))===BigInt(word(inc.data,0))&&BigInt(word(l.data,2))===BigInt(word(inc.data,1))&&BigInt(word(l.data,3))===BigInt(word(inc.data,2)));
 const pool=matches.sort(order).at(-1);if(!pool)throw new Error('Pool could not be verified from deposit');
 return {pool:pool.address.toLowerCase(),lower:tick(pool.topics[2]),upper:tick(pool.topics[3])};
}
export async function fetchUniswapHistory(w:WalletRef,_usdPrice:(token:string)=>number|null,
 metaOf:(token:string)=>Promise<{symbol:string;decimals:number}>,rpcUrl=PUBLIC_RPC,indexed?:IndexedEvents):Promise<RobinhoodHistory>{
 const end=Math.max(0,integer(await rhRead<string>(rpcUrl,'eth_blockNumber',[]))-20);
 const indexedLogs=indexed?.receipts.flatMap(r=>r.logs).filter(l=>l.address.toLowerCase()===RH.npm&&integer(l.blockNumber)<=end&&!l.removed).sort(order);
 const readLogs=async(topics:(string|string[]|null)[],from=0)=>indexedLogs?indexedLogs.filter(l=>integer(l.blockNumber)>=from&&topics.every((t,i)=>t===null||(Array.isArray(t)?t.includes(l.topics[i]):t===l.topics[i]))):eventLogs(rpcUrl,topics,end,from);
 const incoming=await readLogs([EVENTS.transfer,null,'0x'+pad(w.address.toLowerCase())]);
 const ids=[...new Set(incoming.map(l=>BigInt(l.topics[3]).toString()))];
 const report:RobinhoodHistory={wallet:w.name,address:w.address,records:[],closed:[],errors:[...(indexed?.errors??[])],updatedAt:new Date().toISOString(),block:end,complete:true,discovered:ids.length,status:'fresh',historyScope:indexed?'wallet-transactions':'position-events'};
 if(ids.length>40)report.errors.push(`Showing the latest 40 of ${ids.length} position NFTs. Coverage is partial.`);
 const receipts=new Map<string,Receipt>(),times=new Map<string,string>();
 for(const r of indexed?.receipts??[])if(r.logs[0])receipts.set(r.logs[0].transactionHash,r);
 async function receipt(hash:string){if(!receipts.has(hash))receipts.set(hash,await rhRead<Receipt>(rpcUrl,'eth_getTransactionReceipt',[hash]));return receipts.get(hash)!;}
 async function time(log:Log){
  if(!times.has(log.blockNumber)){
   const ts=log.blockTimestamp&&BigInt(log.blockTimestamp)>0n?log.blockTimestamp:(await rhRead<{timestamp:string}>(rpcUrl,'eth_getBlockByNumber',[log.blockNumber,false])).timestamp;
   times.set(log.blockNumber,new Date(integer(ts)*1000).toISOString());
  }return times.get(log.blockNumber)!;
 }
 for(const id of ids.slice(-40))try{
  const topic='0x'+pad(BigInt(id).toString(16));
  const first=incoming.find(l=>BigInt(l.topics[3])===BigInt(id))!;
  // The known mint is a safe lower bound. Querying decades of empty blocks
  // before this NFT existed wastes provider indexing capacity.
  const from=address(first.topics[1])===ZERO?integer(first.blockNumber):0;
  const transfers=await readLogs([EVENTS.transfer,null,null,topic],from);
  const events=await readLogs([[EVENTS.inc,EVENTS.dec,EVENTS.col],topic],from);
  const mint=transfers.find(l=>address(l.topics[1])===ZERO);if(!mint)throw new Error('Mint record unavailable');
  const poolInfo=mintPool(await receipt(mint.transactionHash),id);
  const call=(data:string)=>rhRead<string>(rpcUrl,'eth_call',[{to:poolInfo.pool,data},'0x'+end.toString(16)]);
  if(address(await call('0xc45a0155'))!==RH.v3Factory.toLowerCase())throw new Error('Pool factory mismatch');
  const token0=address(await call('0x0dfe1681')),token1=address(await call('0xd21220a7')),fee=integer(await call('0xddca3f43'));
  const m0=await metaOf(token0),m1=await metaOf(token1);
  if(![m0.decimals,m1.decimals].every(x=>Number.isInteger(x)&&x>=0&&x<=36))throw new Error('Token decimals unavailable');
  const amounts=(a0:bigint,a1:bigint):TokenAmount[]=>[{address:token0,...m0,amount:Number(a0)/10**m0.decimals,raw:a0.toString()},{address:token1,...m1,amount:Number(a1)/10**m1.decimals,raw:a1.toString()}];
  const owner=w.address.toLowerCase();let held=false;const owned:Log[]=[];
  for(const l of [...transfers,...events].sort(order)){
   if(l.topics[0]===EVENTS.transfer)held=address(l.topics[2])===owner;
   else if(held)owned.push(l);
  }
  const ownershipComplete=address(mint.topics[2])===owner&&transfers.every(l=>address(l.topics[2])===owner||address(l.topics[2])===ZERO);
  const sum=(kind:string,index:number,rows=owned)=>rows.filter(l=>l.topics[0]===kind).reduce((n,l)=>n+BigInt(word(l.data,index)),0n);
  const liquidity=sum(EVENTS.inc,0,events)-sum(EVENTS.dec,0,events);if(liquidity<0n)throw new Error('Liquidity events incomplete');
  const in0=sum(EVENTS.inc,1),in1=sum(EVENTS.inc,2),de0=sum(EVENTS.dec,1),de1=sum(EVENTS.dec,2),co0=sum(EVENTS.col,1),co1=sum(EVENTS.col,2);
  const lastOwner=address(transfers.at(-1)!.topics[2]),fullyCollected=co0>=de0&&co1>=de1;
  const endedElsewhere=lastOwner!==owner&&(lastOwner!==ZERO||address(transfers.at(-1)!.topics[1])!==owner);
  const status:LPRecord['status']=endedElsewhere?'transferred':liquidity>0n?'open':fullyCollected?'closed':'awaiting collection';
  const start=incoming.find(l=>BigInt(l.topics[3])===BigInt(id))!,last=owned.at(-1)??start;
  const actions:LPRecord['actions']=[];
  for(const l of owned)actions.push({kind:l.topics[0]===EVENTS.inc?'Deposit':l.topics[0]===EVENTS.dec?'Withdraw liquidity':'Collect payout',at:await time(l),hash:l.transactionHash,tokens:amounts(BigInt(word(l.data,1)),BigInt(word(l.data,2))),url:`${RH.explorer}/tx/${l.transactionHash}`});
  const record:LPRecord={chain:'robinhood',venue:'uniswap-v3',wallet:w.name,tokenId:id,positionAddress:'#'+id,poolAddress:poolInfo.pool,pair:`${m0.symbol}/${m1.symbol}`,status,
   depositedUsd:null,withdrawnUsd:null,feesUsd:null,pnlUsd:null,pnlPct:null,
   depositedTokens:amounts(in0,in1),withdrawnTokens:amounts(de0,de1),collectedTokens:amounts(co0,co1),
   feeTokens:ownershipComplete&&fullyCollected?amounts(co0-de0,co1-de1):null,
   feeTier:fee/1e6,tickLower:poolInfo.lower,tickUpper:poolInfo.upper,ownershipComplete,
   openedAt:await time(start),closedAt:status==='closed'?await time(last):null,url:`${RH.explorer}/token/${RH.npm}/instance/${id}`,actions,
   note:ownershipComplete?'Token amounts from on-chain events. Historical USD prices and gas-adjusted P&L are not yet available.':'NFT ownership changed. Amounts cover this wallet’s events only; original cost basis and total fees are unknown.'};
  report.records.push(record);if(status==='closed')report.closed.push(record);
 }catch{report.errors.push(`Position #${id} could not be fully read. Refresh to retry.`);}
 report.complete=!report.errors.length&&indexed?.complete!==false;report.status=report.complete?'fresh':'partial';return report;
}
