import type {Env} from './env';
import {solanaReadFetch} from './solana-read-rpc';
/** Observed fees for explicit unsigned paper-plan message templates. Never a
 * simulation or an executable LP transaction. Nothing is signed or submitted. */
export interface StillNetworkRead {asOf:string;singleLamports:number;doubleLamports:number;source:string}
const key='still:network-fees:v1';
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function decode58(s:string){let n=0n;for(const c of s){const i='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c);if(i<0)throw Error('Invalid blockhash');n=n*58n+BigInt(i);}const out=new Uint8Array(32);for(let i=31;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}if(n)throw Error('Oversized blockhash');return out;}
export function feeMessage(blockhash:string,signatures:1|2){
 const keys=Array.from({length:signatures},(_,i)=>new Uint8Array(32).fill(i+1));
 const bytes=new Uint8Array([signatures,0,0,signatures,...keys.flatMap(k=>[...k]),...decode58(blockhash),0]);
 return btoa(String.fromCharCode(...bytes));
}
export async function readStillNetwork(env:Env,live=false):Promise<StillNetworkRead|null>{
 try{const saved=await env.LP_CACHE.get<StillNetworkRead>(key,'json');if(saved&&valid(saved.singleLamports)&&valid(saved.doubleLamports)&&Date.now()-Date.parse(saved.asOf)>=0&&Date.now()-Date.parse(saved.asOf)<60000)return saved;}catch{}
 if(!live)return null;
 try{
  const rpc=async(method:string,params:unknown[])=>{const r=await solanaReadFetch(env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(6000)},{deadline:Date.now()+6000});const d=await r.json() as any;if(!r.ok||d.error)throw Error('RPC unavailable');return d.result;};
  const hash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value?.blockhash;
  if(typeof hash!=='string'||hash.length<32||hash.length>44)return null;
  const fees=await Promise.all(([1,2] as const).map(n=>rpc('getFeeForMessage',[feeMessage(hash,n),{commitment:'confirmed'}])));
  if(!fees.every(v=>valid(v?.value)))return null;
  const read={asOf:new Date().toISOString(),singleLamports:fees[0].value,doubleLamports:fees[1].value,source:'Solana RPC getFeeForMessage · unsigned paper templates'};
  try{await env.LP_CACHE.put(key,JSON.stringify(read),{expirationTtl:120});}catch{}return read;
 }catch{return null;}
}
