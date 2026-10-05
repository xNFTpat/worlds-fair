import {readFetch} from './read-fetch';
import {num,feeApr,type Pool,type Venue} from '../schema';
import {raydiumPoolUrl,withRaydiumPoolUrl} from '../pool-links';

const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const nonnegative=(v:unknown)=>{const n=num(v);return n!=null&&n>=0?n:null;};
export function normalizeVenue(raw:any,source:'raydium'|'orca',at=new Date().toISOString()):Pool|null{
  const orca=source==='orca',a=orca?raw.tokenA:raw.mintA,b=orca?raw.tokenB:raw.mintB;
  if(!orca&&!['Concentrated','Standard'].includes(raw.type))return null;
  const address=orca?raw.address:raw.id;
  if(!address||!a?.address||!b?.address||raw.hasWarning)return null;
  const tvl=nonnegative(orca?raw.tvlUsdc:raw.tvl),volume=nonnegative(orca?raw.stats?.['24h']?.volume:raw.day?.volume);
  if(!tvl||volume==null)return null;
  const fees=nonnegative(orca?raw.stats?.['24h']?.fees:raw.day?.volumeFee);
  const ratio=nonnegative(raw.price),usdQuote=b.address===USDC?1:null;
  const venue:Venue=orca?'orca-whirlpool':raw.type==='Concentrated'?'raydium-clmm':raw.programId==='675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'?'raydium-amm':'raydium-cpmm';
  const win=(w:string,k:string)=>nonnegative(raw.stats?.[w]?.[k]);
  const opened=Number(raw.openTime),age=!orca&&opened>0?Math.max(0,(Date.now()/1000-opened)/3600):null;
  const observed=orca&&Number.isFinite(Date.parse(raw.updatedAt))?raw.updatedAt:at;
  return {id:'solana:'+address,chain:'solana',venue,address,pair:a.symbol+'/'+b.symbol,
    base:{address:a.address,symbol:a.symbol,name:a.name},quote:{address:b.address,symbol:b.symbol,name:b.name},
    tvlUsd:tvl,volume24hUsd:volume,fees24hUsd:fees,feeSource:'reported',feeTier:raw.hasDynamicFee||raw.adaptiveFeeEnabled?null:nonnegative(raw.feeRate)==null?null:raw.feeRate/(orca?1e6:1),feeApr:feeApr(fees,tvl),
    priceUsd:usdQuote&&ratio!=null?ratio:null,quotePriceUsd:usdQuote,change24h:orca?num(raw.stats?.['24h']?.priceDelta):null,ageHours:age,
    tags:[...(tvl<25000?['thin']:[]),...(tvl<100?['near-empty']:[]),...(raw.hasDynamicFee||raw.adaptiveFeeEnabled?['dynamic-fee']:[])],
    url:orca?'https://www.orca.so/pools/'+address:raydiumPoolUrl(address,venue==='raydium-clmm'),
    fetchedAt:observed,txns24h:null,feeTvl:{h1:orca&&win('1h','fees')!=null?win('1h','fees')!/tvl:null,mid:orca&&win('4h','fees')!=null?win('4h','fees')!/tvl:null,midHours:4,h24:fees==null?null:fees/tvl},
    ...(orca?{activity:{fees30m:win('30m','fees'),fees1h:win('1h','fees'),fees4h:win('4h','fees'),volume30m:win('30m','volume'),volume1h:win('1h','volume'),volume4h:win('4h','volume')}}:{}),
  };
}

export async function fetchSolanaVenue(source:'raydium'|'orca',cache:KVNamespace):Promise<Pool[]>{
  const key='venue-pools:v2:'+source,saved=await cache.get<{at:number;pools:Pool[]}>(key,'json');
  if(saved&&Date.now()-saved.at<600000)return saved.pools.map(withRaydiumPoolUrl);
  const url=source==='orca'?'https://api.orca.so/v2/solana/pools?sortBy=volume24h&sortDirection=desc&size=100&stats=30m,1h,4h,24h':'https://api-v3.raydium.io/pools/info/list-v2?sortField=volume24h&sortType=desc&size=150';
  const response=await readFetch(url);if(!response.ok)throw Error(source+' returned '+response.status);
  const data=await response.json() as any,rows=source==='orca'?data.data:data.data?.data;
  if(!Array.isArray(rows)||!rows.length||data.success===false)throw Error(source+' returned no usable catalogue');
  const pools=rows.map(r=>normalizeVenue(r,source)).filter((p):p is Pool=>p!==null);
  if(!pools.length)throw Error(source+' token identities or pool data unavailable');
  await cache.put(key,JSON.stringify({at:Date.now(),pools}),{expirationTtl:3600});return pools;
}
