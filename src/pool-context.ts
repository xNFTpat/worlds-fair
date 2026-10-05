import type {Pool, Snapshot} from './schema';

// Relations come from mint identities in the saved catalogue, never ticker matches.
const normalized=(chain:string,address:string)=>chain==='robinhood'?address.toLowerCase():address;
const same=(chain:string,a:string,b:string)=>normalized(chain,a)===normalized(chain,b);
const COMMON_SOL=new Set(['So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
export function poolContext(snapshot:Snapshot,id:string,focus?:string,now=Date.now()) {
 const pool=snapshot.pools.find(p=>p.id===id);if(!pool)return null;
 const tokens=[pool.base,pool.quote];
 const token=focus?tokens.find(t=>same(pool.chain,t.address,focus)):pool.chain==='solana'&&COMMON_SOL.has(pool.base.address)&&!COMMON_SOL.has(pool.quote.address)?pool.quote:pool.base;
 if(!token)return null;
 const rows=[...new Map(snapshot.pools.filter(p=>p.chain===pool.chain&&p.id!==pool.id&&[p.base,p.quote].some(t=>same(pool.chain,t.address,token.address))).map(p=>[p.id,p])).values()];
 rows.sort((a,b)=>(b.tvlUsd??-1)-(a.tvlUsd??-1)||a.id.localeCompare(b.id));
 const stale=(p:Pool)=>!Number.isFinite(Date.parse(p.fetchedAt))||now-Date.parse(p.fetchedAt)>600000;
 return {pool,token,related:rows.slice(0,12).map(p=>({pool:p,pairedWith:same(p.chain,p.base.address,token.address)?p.quote:p.base,stale:stale(p)})),total:rows.length,updatedAt:snapshot.updatedAt,
  scope:'Saved catalogue · same chain and exact token address. Pairing does not establish backing, rewards or redemption rights.'};
}
