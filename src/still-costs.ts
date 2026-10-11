import type {Env} from './env';
import {solanaReadFetch} from './solana-read-rpc';
import {readResearchRpcCooldown,noteResearchRpcRateLimit} from './sources/research-reads';
/** Observed fees for explicit unsigned paper-plan message templates. Never a
 * simulation or an executable LP transaction. Nothing is signed or submitted. */
export interface StillNetworkRead {asOf:string;singleLamports:number;doubleLamports:number;source:string}
// Base fees are a dated paper-plan input, not an execution promise. Retain the
// actual observation for ten minutes; never refresh its source time on reuse.
export const STILL_NETWORK_MAX_AGE_MS=10*60_000;
const key='still:network-fees:v1';
const pending=new WeakMap<object,Map<string,Promise<StillNetworkRead|null>>>();
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function decode58(s:string){let n=0n;for(const c of s){const i='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c);if(i<0)throw Error('Invalid blockhash');n=n*58n+BigInt(i);}const out=new Uint8Array(32);for(let i=31;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}if(n)throw Error('Oversized blockhash');return out;}
export function feeMessage(blockhash:string,signatures:1|2){
 const keys=Array.from({length:signatures},(_,i)=>new Uint8Array(32).fill(i+1));
 const bytes=new Uint8Array([signatures,0,0,signatures,...keys.flatMap(k=>[...k]),...decode58(blockhash),0]);
 return btoa(String.fromCharCode(...bytes));
}
export async function readStillNetwork(env:Env,live=false):Promise<StillNetworkRead|null>{
 try{const saved=await env.LP_CACHE.get<StillNetworkRead>(key,'json');if(saved&&valid(saved.singleLamports)&&valid(saved.doubleLamports)&&Date.now()-Date.parse(saved.asOf)>=0&&Date.now()-Date.parse(saved.asOf)<STILL_NETWORK_MAX_AGE_MS)return saved;}catch{}
 if(!live)return null;
 const url=env.SOLANA_RPC||'https://api.mainnet-beta.solana.com';
 let reads=pending.get(env.LP_CACHE);if(!reads){reads=new Map();pending.set(env.LP_CACHE,reads);}
 if(reads.has(url))return reads.get(url)!;
 const work=readNetworkLive(env,url);reads.set(url,work);
 try{return await work;}finally{reads.delete(url);}
}
async function readNetworkLive(env:Env,url:string):Promise<StillNetworkRead|null>{
 try{
  const rpc=async(requests:{method:string;params:unknown[]}[])=>{if(await readResearchRpcCooldown(env,url))throw Error('RPC provider cooldown');const batch=requests.map((request,i)=>({jsonrpc:'2.0',id:i+1,...request})),r=await solanaReadFetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch.length===1?batch[0]:batch),signal:AbortSignal.timeout(6000)},{deadline:Date.now()+6000,env});if(r.status===429)await noteResearchRpcRateLimit(env,url,r.headers,requests.map(request=>request.method));const d=await r.json() as any,rows=Array.isArray(d)?d:[d];if(!r.ok||rows.length!==batch.length||batch.some(b=>rows.filter(v=>v?.jsonrpc==='2.0'&&v.id===b.id&&!v.error).length!==1))throw Error('RPC unavailable');return batch.map(b=>rows.find(v=>v.id===b.id).result);};
  const hash=(await rpc([{method:'getLatestBlockhash',params:[{commitment:'confirmed'}]}]))[0].value?.blockhash;
  if(typeof hash!=='string'||hash.length<32||hash.length>44)return null;
  const fees=await rpc(([1,2] as const).map(n=>({method:'getFeeForMessage',params:[feeMessage(hash,n),{commitment:'confirmed'}]})));
  if(!fees.every(v=>valid(v?.value)))return null;
  const read={asOf:new Date().toISOString(),singleLamports:fees[0].value,doubleLamports:fees[1].value,source:'Solana RPC getFeeForMessage · unsigned paper templates'};
  try{await env.LP_CACHE.put(key,JSON.stringify(read),{expirationTtl:660});}catch{}return read;
 }catch{return null;}
}
