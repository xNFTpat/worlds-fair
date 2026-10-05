import type {Pool} from './schema';

// Raydium's own pool-list Deposit buttons use these routes. Keep the pool ID,
// since the same token pair can have several pools and fee tiers.
export function raydiumPoolUrl(address:string,concentrated=false):string {
  const id=encodeURIComponent(address);
  return concentrated
    ? `https://raydium.io/clmm/create-position/?pool_id=${id}`
    : `https://raydium.io/liquidity/increase/?mode=add&pool_id=${id}`;
}

export function withRaydiumPoolUrl(pool:Pool):Pool {
  if(!['raydium-clmm','raydium-cpmm','raydium-amm'].includes(pool.venue))return pool;
  return {...pool,url:raydiumPoolUrl(pool.address,pool.venue==='raydium-clmm')};
}
