import type {Env} from './env';
import type {StillRange} from './still-preflight';
import {stillReadRpcUrl} from './still-rpc-env';
import {solanaReadFetch} from './solana-read-rpc';
import {readResearchRpcCooldown,noteResearchRpcRateLimit} from './sources/research-reads';
import {stillAddressBytes,stillBinArrayAddress,stillBitmapAddress} from '../execution/still-account-layout';

// Full account sizes including Anchor's 8-byte discriminator, verified against
// installed @meteora-ag/dlmm 1.9.14 BorshAccountsCoder in the regression test.
// These are bytes, not rent estimates. All lamports come from the selected RPC.
export const STILL_ACCOUNT_LAYOUT=Object.freeze({program:'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',positionBytes:8120,binArrayBytes:10136,bitmapBytes:1576,binArrayDiscriminator:[92,142,92,220,5,148,70,181],bitmapDiscriminator:[80,111,124,113,55,237,18,5]});
export const STILL_ACCOUNT_COST_TTL=600000;
export interface StillAccountCosts {asOf:string;poolAddress:string;positionBytes:number;positionRentLamports:number;setupRentLamports:number|null;missingAccounts:number|null;rangeKey:string|null;source:string;note:string}
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const fresh=(at:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.now()&&Date.now()-Date.parse(at)<STILL_ACCOUNT_COST_TTL;
export function stillAccountRangeKey(range:StillRange|null):string|null {const ids=range?.bins.map(b=>b.nativeBinId);return ids?.length&&ids.length<=69&&ids.every(n=>Number.isSafeInteger(n))?[...new Set(ids.map(n=>Math.floor(n!/70)))].sort((a,b)=>a-b).join(','):null;}
async function rpc(env:Env,requests:{method:string;params:unknown[]}[]){
 const url=stillReadRpcUrl(env);if(await readResearchRpcCooldown(env,url))throw Error('RPC unavailable');
 const batch=requests.map((r,i)=>({jsonrpc:'2.0',id:i+1,...r}));
 const response=await solanaReadFetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch.length===1?batch[0]:batch),signal:AbortSignal.timeout(6500)},{env,deadline:Date.now()+6500});
 if(response.status===429)await noteResearchRpcRateLimit(env,url,response.headers,requests.map(r=>r.method));
 const data=await response.json() as any,rows=Array.isArray(data)?data:[data];
 if(!response.ok||rows.length!==batch.length||batch.some(r=>rows.filter(v=>v?.jsonrpc==='2.0'&&v.id===r.id&&!v.error).length!==1))throw Error('RPC unavailable');return batch.map(r=>rows.find(v=>v.id===r.id).result);
}
/** Dated rent allocation for the new paper-plan position, not existing funds.
 * Bin-array rent stays with the pool and is not refunded on position close. */
export async function readStillAccountCosts(env:Env,poolAddress:string,range:StillRange|null,live=false):Promise<StillAccountCosts|null>{
 const rangeKey=stillAccountRangeKey(range),layout=STILL_ACCOUNT_LAYOUT;
 if(!range||range.binCount<1||range.binCount>69)return null;
 let scope:string;try{scope=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stillReadRpcUrl(env))))).slice(0,16).map(n=>n.toString(16).padStart(2,'0')).join('');}catch{return null;}
 const key='still:account-costs:v1:'+scope+':'+poolAddress+':'+(rangeKey??'unverified');
 try{const cached=await env.LP_CACHE.get<StillAccountCosts>(key,'json');if(cached&&fresh(cached.asOf)&&cached.poolAddress===poolAddress&&cached.rangeKey===rangeKey&&cached.positionBytes===layout.positionBytes&&valid(cached.positionRentLamports)&&(cached.setupRentLamports===null||valid(cached.setupRentLamports))&&(cached.missingAccounts===null||valid(cached.missingAccounts)))return cached;}catch{}
 if(!live)return null;
 try{
  const rent=(await rpc(env,[{method:'getMinimumBalanceForRentExemption',params:[layout.positionBytes,{commitment:'confirmed'}]}]))[0];if(!valid(rent))return null;const asOf=new Date().toISOString();
  let setupRentLamports:number|null=null,missingAccounts:number|null=null;
  if(rangeKey!==null){try{
   const indices=rangeKey.split(',').map(Number),pool=stillAddressBytes(poolAddress);
   if(indices.length<1||indices.length>2||indices.some(n=>!Number.isSafeInteger(n)))throw Error('Unsupported bin coverage');
   const accounts:{address:string;index:number;size:number;discriminator:readonly number[];poolOffset:number}[]=await Promise.all(indices.map(async index=>({address:await stillBinArrayAddress(poolAddress,index,layout.program),index,size:layout.binArrayBytes,discriminator:layout.binArrayDiscriminator,poolOffset:24})));
   if(indices.some(n=>n < -512 || n > 511))accounts.push({address:await stillBitmapAddress(poolAddress,layout.program),index:NaN,size:layout.bitmapBytes,discriminator:layout.bitmapDiscriminator,poolOffset:8});
   const result=(await rpc(env,[{method:'getMultipleAccounts',params:[accounts.map(a=>a.address),{encoding:'base64',commitment:'confirmed'}]}]))[0];
   if(!valid(result?.context?.slot)||!Array.isArray(result?.value)||result.value.length!==accounts.length)throw Error('Account coverage unavailable');
   const missing:number[]=[];
   result.value.forEach((account:any,i:number)=>{
    if(account===null){missing.push(i);return;}
    const expected=accounts[i];if(account.owner!==layout.program||account.executable!==false||!Array.isArray(account.data)||account.data[1]!=='base64'||typeof account.data[0]!=='string'||account.data[0].length>Math.ceil(expected.size/3)*4)throw Error('Account layout unavailable');
    const bytes=Uint8Array.from(atob(account.data[0]),c=>c.charCodeAt(0));
    if(bytes.length!==expected.size||!expected.discriminator.every((v,j)=>bytes[j]===v)||!pool.every((v,j)=>bytes[expected.poolOffset+j]===v)||Number.isFinite(expected.index)&&new DataView(bytes.buffer).getBigInt64(8,true)!==BigInt(expected.index))throw Error('Account identity unavailable');
   });
   const rents=missing.length?await rpc(env,missing.map(i=>({method:'getMinimumBalanceForRentExemption',params:[accounts[i].size,{commitment:'confirmed'}]}))):[];
   if(!rents.every(valid)||!valid(rents.reduce((sum,n)=>sum+n,0)))throw Error('Setup rent unavailable');
   setupRentLamports=rents.reduce((sum,n)=>sum+n,0);missingAccounts=missing.length;
  }catch{/* Keep the observed refundable rent; unverified setup stays null. */}}
  const read:StillAccountCosts={asOf,poolAddress,positionBytes:layout.positionBytes,positionRentLamports:rent,setupRentLamports,missingAccounts,rangeKey,source:'Confirmed Solana RPC rent exemption + exact DLMM bin-array accounts',note:'New position rent is returned when its empty position account closes. Pool bin arrays/bitmap are not returned on position close. Token account rent is outside this position deposit; no wallet-specific token account is assumed.'};
  // Cache only complete observations; retry unknown setup on the next explicit check.
  if(setupRentLamports!==null)try{await env.LP_CACHE.put(key,JSON.stringify(read),{expirationTtl:600});}catch{}
  return read;
 }catch{return null;}
}
