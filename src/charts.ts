import type { Pool, Position } from './schema';
import type { Candle } from './suggest';
import type {Env} from './env';
import { getTokenCandleSeries } from './sources/geckoterminal';

export async function poolChart(pool: Pool, days: number,env?:Env) {
  const series=await getTokenCandleSeries(pool,days*24,env?{key:env.GECKO_KEY,cache:env.LP_CACHE,namespace:env.RANGE_ALERTS}:undefined);
  return {...series,baseAddress:pool.base.address,quoteAddress:pool.quote.address,fetchedAt:series.asOf};
}
export function positionBounds(position: Position, pool: Pool) {
  if (position.lower == null || position.upper == null || position.lower <= 0 || position.upper <= position.lower) return null;
  const equal=(a:string,b:string)=>pool.chain==='solana'?a===b:a.toLowerCase()===b.toLowerCase();
  const same = position.baseAddress && position.quoteAddress
    ? equal(position.baseAddress,pool.base.address) && equal(position.quoteAddress,pool.quote.address)
    : position.pair === pool.pair;
  const reversed = position.baseAddress && position.quoteAddress
    ? equal(position.baseAddress,pool.quote.address) && equal(position.quoteAddress,pool.base.address)
    : position.pair.split('/').reverse().join('/') === pool.pair;
  if(same) return {lower:position.lower, upper:position.upper};
  if(reversed) return {lower:1/position.upper, upper:1/position.lower};
  return null;
}
