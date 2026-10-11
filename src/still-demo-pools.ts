import type {Env} from './env';
import type {Pool,Snapshot} from './schema';
import {fetchMeteoraPool,fetchMeteoraHotSolPools} from './sources/meteora';

/** One exact pool illustrates why small pools need a cost check. The symbol is
 * display copy only: address AND both mints must match on every observation.
 * No return, quote, liquidity or verdict is pinned. */
export const STILL_THIN_DEMO = Object.freeze({
  address:'BCv5Ggg5563AYfkrErdXok2hKfjgUNtQ1A4yKuNbTjQ9',
  mintX:'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
  mintY:'So11111111111111111111111111111111111111112',
});
export function isStillThinDemo(pool:Pool):boolean {
  return pool.chain==='solana'&&pool.venue==='meteora-dlmm'&&pool.address===STILL_THIN_DEMO.address&&
    pool.base.address===STILL_THIN_DEMO.mintX&&pool.quote.address===STILL_THIN_DEMO.mintY;
}
/** Keep the teaching example in the bounded shortlist without relaxing eligibility. */
export function withStillThinDemo(picked:Pool[],eligible:Pool[]):Pool[] {
  const example=eligible.find(isStillThinDemo);
  const ordinary=picked.filter(p=>p.address!==STILL_THIN_DEMO.address);
  return example?[...ordinary.slice(0,7),example]:ordinary.slice(0,8);
}
const key='still:thin-demo-pool:v1';
const fresh=(p:Pool|undefined|null)=>!!p&&isStillThinDemo(p)&&Number.isFinite(Date.parse(p.fetchedAt))&&Date.now()-Date.parse(p.fetchedAt)>=0&&Date.now()-Date.parse(p.fetchedAt)<600_000;
/** A cached observation for list views; a bounded public read only on an
 * explicit Pre-flight or background refresh if the activity catalogue omits it.
 * Failure never inserts fixture data or re-dates stale observations. */
export async function withStillDemoObservation(snapshot:Snapshot,env:Env,live=false):Promise<Snapshot> {
  const fromSnapshot=snapshot.pools.find(p=>p.address===STILL_THIN_DEMO.address);
  if(fresh(fromSnapshot))return snapshot;
  let pool:Pool|null=null;
  try {const cached=await env.LP_CACHE.get<Pool>(key,'json');if(fresh(cached))pool=cached;}catch{}
  if(!pool&&live){
    try {const read=await fetchMeteoraPool(STILL_THIN_DEMO.address);if(fresh(read)){pool=read;await env.LP_CACHE.put(key,JSON.stringify(read),{expirationTtl:600});}}catch{}
  }
  if(!pool)return snapshot;
  return {...snapshot,pools:[...snapshot.pools.filter(p=>p.address!==STILL_THIN_DEMO.address),pool]};
}

const HOT_KEY='still:hot-sol-pools:v1';
export const STILL_HOT_POOL_TTL_MS=300_000;
const hotPending=new WeakMap<object,Promise<Snapshot>>();
/** Five-minute KV catalogue. Failure is empty/unavailable, never stale data with a new date. */
export async function readStillHotPools(env:Env,live=true):Promise<Snapshot> {
  try {
    const saved=await env.LP_CACHE.get<Snapshot>(HOT_KEY,'json'),age=Date.now()-Date.parse(saved?.updatedAt||'');
    if(saved&&Array.isArray(saved.pools)&&age>=0&&age<STILL_HOT_POOL_TTL_MS)return saved;
  }catch{}
  const empty:Snapshot={updatedAt:'',pools:[],errors:{'meteora-dlmm':'Live one-hour pool list unavailable.'}};
  if(!live)return empty;
  const existing=hotPending.get(env.LP_CACHE);if(existing)return existing;
  const work=(async()=>{
    try {
      const pools=await fetchMeteoraHotSolPools();
      const snapshot=await withStillDemoObservation({updatedAt:pools[0]?.fetchedAt||new Date().toISOString(),pools,errors:{}},env,true);
      try{await env.LP_CACHE.put(HOT_KEY,JSON.stringify(snapshot),{expirationTtl:300});}catch{}
      return snapshot;
    }catch{return {...empty,...await withStillDemoObservation(empty,env)};}
  })();
  hotPending.set(env.LP_CACHE,work);
  try{return await work;}finally{hotPending.delete(env.LP_CACHE);}
}
