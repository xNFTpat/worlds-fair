import {basketMint} from './worldsfair-basket-math';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const COMPUTE_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const STAMP_COMPUTE_UNITS = 100000;
export type PaperStampTarget = {kind:'fleet-open';id:string} | {kind:'fleet-close';id:string;closedAt:string} | {kind:'pot-roll';eventId:string};
export interface PaperStampReceipt {
  id:string;paper:true;cluster:'devnet';target:PaperStampTarget;eventAt:string;eventHash:string;
  wallet:string;memo:string;description:string;status:'ready'|'confirmed';createdAt:string;
  signature?:string;explorerUrl?:string;slot?:number;blockTime?:number|null;confirmedAt?:string;
}
export class PaperStampError extends Error {
  constructor(message:string, readonly status=400, readonly code='invalid_paper_stamp') {super(message);}
}
export const stampDigest = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const exact = (value:Record<string,unknown>,fields:string[]) => {if(Object.keys(value).some(key=>!fields.includes(key)))throw new PaperStampError('Only a saved Paper event can be stamped.');};
const dated = (value:unknown):value is string => typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export function stampTarget(input:unknown):PaperStampTarget {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new PaperStampError('Choose a saved Paper event.');
  const row=input as Record<string,unknown>;
  if(row.kind==='pot-roll') {
    exact(row,['kind','eventId']);
    if(typeof row.eventId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(row.eventId))throw new PaperStampError('Choose a saved Paper roll.');
    return {kind:'pot-roll',eventId:row.eventId};
  }
  if(!['fleet-open','fleet-close'].includes(String(row.kind))||typeof row.id!=='string'||row.id.length>240||!/^fleet:[a-z0-9-]+:/.test(row.id))throw new PaperStampError('Choose a saved shared Paper fleet observation.');
  exact(row,row.kind==='fleet-open'?['kind','id']:['kind','id','closedAt']);
  if(row.kind==='fleet-open')return {kind:'fleet-open',id:row.id};
  if(!dated(row.closedAt))throw new PaperStampError('The Paper close date is missing.');
  return {kind:'fleet-close',id:row.id,closedAt:row.closedAt};
}
/** Only a fixed projection of authoritative journal fields enters the public hash. */
export function stampEvidence(target:PaperStampTarget, record:any) {
  if(!record||typeof record!=='object')throw new PaperStampError('This Paper event is not in the saved journal.',404,'paper_stamp_event_missing');
  if(target.kind==='pot-roll') {
    const event=record.event;
    if(!event||event.kind!=='roll'||event.id!==target.eventId||event.source!=='fleet'||!dated(event.at)||!Number.isSafeInteger(event.amountLamports)||event.amountLamports<0||!Number.isFinite(event.retainedSol))throw new PaperStampError('Only this browser’s saved Paper profit rolls can be stamped.',404,'paper_stamp_event_missing');
    return {version:1,paper:true,kind:target.kind,eventId:event.id,at:event.at,tradeId:event.tradeId,closedAt:event.closedAt,amountLamports:event.amountLamports,retainedSol:event.retainedSol,ruleAllocation:event.ruleAllocation??null};
  }
  const at=target.kind==='fleet-open'?record.openedAt:record.closedAt;
  if(record.id!==target.id||typeof record.arm!=='string'||!record.id.startsWith('fleet:'+record.arm+':')||!dated(at)||target.kind==='fleet-close'&&record.closedAt!==target.closedAt||!Number.isFinite(record.budgetSol)||record.budgetSol<=0)throw new PaperStampError('The saved Paper fleet event is incomplete.',404,'paper_stamp_event_missing');
  if(target.kind==='fleet-close'&&(!Number.isFinite(record.exitSol)||!Number.isFinite(record.pnlSol)))throw new PaperStampError('An unscored outcome cannot be stamped as a Paper close.',404,'paper_stamp_event_missing');
  return {version:1,paper:true,kind:target.kind,id:record.id,arm:record.arm,at,pool:record.poolAddress??record.pool?.address??null,pair:record.pair??record.pool?.pair??null,budgetSol:record.budgetSol,...(target.kind==='fleet-close'?{exitSol:record.exitSol,pnlSol:record.pnlSol}:{})};
}
export async function createStampReceipt(account:string,target:PaperStampTarget,record:unknown,wallet:unknown):Promise<PaperStampReceipt> {
  if(!basketMint(wallet))throw new PaperStampError('Choose a valid Phantom Solana address.');
  const evidence=stampEvidence(target,record),eventHash=await stampDigest(JSON.stringify(evidence));
  const id=await stampDigest('paper-devnet-v1:'+account+':'+eventHash);
  return {id,paper:true,cluster:'devnet',target,eventAt:evidence.at,eventHash,wallet,
    memo:'Paper record | devnet | v1 | '+target.kind+' | sha256:'+eventHash,
    description:target.kind==='pot-roll'?'Your saved Paper roll':'Observation of a shared Paper fleet '+(target.kind==='fleet-open'?'open':'close'),status:'ready',createdAt:new Date().toISOString()};
}
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Bounded decoder used for instruction bytes and signatures; no transaction SDK on the server. */
export function stampBase58(input:unknown,maximumBytes=1232):Uint8Array|null {
  if(typeof input!=='string'||!input.length||input.length>Math.ceil(maximumBytes*1.4)+2)return null;
  let value=0n;
  for(const char of input) {const digit=alphabet.indexOf(char);if(digit<0)return null;value=value*58n+BigInt(digit);}
  const bytes:number[]=[];while(value>0n){bytes.push(Number(value&255n));value>>=8n;}
  bytes.reverse();let zeros=0;while(input[zeros]==='1')zeros++;
  if(zeros+bytes.length>maximumBytes)return null;
  return new Uint8Array([...new Array(zeros).fill(0),...bytes]);
}
export const stampSignature = (value:unknown):value is string => stampBase58(value,64)?.length===64;
const sameBytes=(value:unknown,expected:Uint8Array)=>{const bytes=stampBase58(value,512);return !!bytes&&bytes.length===expected.length&&bytes.every((byte,i)=>byte===expected[i]);};
/** Verify the exact, non-transfer transaction shape from the confirmed devnet RPC. */
export function verifyStampTransaction(receipt:PaperStampReceipt, signature:string, result:any) {
  const message=result?.transaction?.message,meta=result?.meta,keys=message?.accountKeys,instructions=message?.instructions;
  const invalid=()=>new PaperStampError('Devnet did not confirm the exact Memo for this Paper record.',409,'paper_stamp_mismatch');
  if(!stampSignature(signature)||!result||!Number.isSafeInteger(result.slot)||result.slot<1||result.version!==undefined&&result.version!=='legacy'||!meta||meta.err!==null
    ||!Number.isSafeInteger(meta.fee)||meta.fee<0||meta.fee>100000||!Array.isArray(result.transaction.signatures)||result.transaction.signatures.length!==1||result.transaction.signatures[0]!==signature
    ||!Array.isArray(keys)||keys.length!==3||keys[0]!==receipt.wallet||new Set(keys).size!==3||!keys.includes(MEMO_PROGRAM)||!keys.includes(COMPUTE_PROGRAM)
    ||message.header?.numRequiredSignatures!==1||message.header?.numReadonlySignedAccounts!==0||message.header?.numReadonlyUnsignedAccounts!==2
    ||!Array.isArray(instructions)||instructions.length!==3||message.addressTableLookups?.length||meta.innerInstructions?.length)throw invalid();
  const expected=[{program:COMPUTE_PROGRAM,data:new Uint8Array([2,160,134,1,0]),accounts:[]},{program:COMPUTE_PROGRAM,data:new Uint8Array([3,0,0,0,0,0,0,0,0]),accounts:[]},{program:MEMO_PROGRAM,data:new TextEncoder().encode(receipt.memo),accounts:[0]}];
  if(expected.some((row,i)=>keys[instructions[i]?.programIdIndex]!==row.program||!sameBytes(instructions[i]?.data,row.data)||JSON.stringify(instructions[i]?.accounts)!==JSON.stringify(row.accounts)))throw invalid();
  if(!Array.isArray(meta.preBalances)||!Array.isArray(meta.postBalances)||meta.preBalances.length!==3||meta.postBalances.length!==3
    ||[...meta.preBalances,...meta.postBalances].some(value=>!Number.isSafeInteger(value)||value<0)
    ||meta.preBalances[0]-meta.postBalances[0]!==meta.fee||meta.preBalances.slice(1).some((value:number,i:number)=>value!==meta.postBalances[i+1])
    ||meta.preTokenBalances?.length||meta.postTokenBalances?.length)throw invalid();
  if(result.blockTime!==null&&(!Number.isSafeInteger(result.blockTime)||result.blockTime<1))throw invalid();
  return {signature,explorerUrl:'https://explorer.solana.com/tx/'+signature+'?cluster=devnet',slot:result.slot as number,blockTime:result.blockTime as number|null,confirmedAt:new Date().toISOString()};
}
async function devnetRead(method:'getGenesisHash'|'getTransaction',params:unknown[]) {
  let response:Response;
  try {response=await fetch(DEVNET_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});}
  catch {throw new PaperStampError('Devnet is unavailable. Your Paper action is already saved; check this same stamp later.',503,'paper_stamp_network_unavailable');}
  if(!response.ok||Number(response.headers.get('content-length')||0)>65536){await response.body?.cancel();throw new PaperStampError('Devnet could not verify this stamp yet.',503,'paper_stamp_network_unavailable');}
  const text=await response.text();if(text.length>65536)throw new PaperStampError('Devnet returned an oversized response.',503,'paper_stamp_network_unavailable');
  let body:any;try{body=JSON.parse(text);}catch{throw new PaperStampError('Devnet returned unreadable data.',503,'paper_stamp_network_unavailable');}
  if(body?.error||body?.id!==1||!Object.hasOwn(body||{},'result'))throw new PaperStampError('Devnet could not verify this stamp yet.',503,'paper_stamp_network_unavailable');
  return body.result;
}
export async function confirmDevnetStamp(receipt:PaperStampReceipt,signature:string) {
  if(!stampSignature(signature))throw new PaperStampError('The Devnet signature is invalid.');
  if(await devnetRead('getGenesisHash',[])!==DEVNET_GENESIS)throw new PaperStampError('The network could not be verified as Solana Devnet.',503,'paper_stamp_wrong_network');
  const result=await devnetRead('getTransaction',[signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:0}]);
  if(result===null)return null;
  return verifyStampTransaction(receipt,signature,result);
}
