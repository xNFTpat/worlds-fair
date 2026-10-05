import {BASKET_SOL, basketMint} from './worldsfair-basket-math';
// Public, read-only research. No balances, wallet access or deposit construction.
export interface YieldIdea {id:string;name:string;kind:'staking'|'vault';chain:string;asset:string;provider:string;rate:number|null;rateType:'APY'|'APR';basis:string;tvlUsd:number|null;wrapperTvlUsd?:number|null;url:string;source:string;docs:string;risk:string;exit:string;disabled?:boolean;rateAsOf?:string|null;inputTokenMint?:string|null;inputTokenDecimals?:number|null;assetPriceUsd?:number|null;depositEnabled?:boolean|null}
export const safeUrl=(v:unknown)=>{try{const u=new URL(String(v));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const finite=(n:unknown)=>{if(n==null||typeof n==='boolean'||typeof n==='string'&&!n.trim())return null;const v=Number(n);return Number.isFinite(v)&&v>=0?v:null;};
const STAKING=[
 {id:'jito-liquid-staking',name:'JitoSOL',asset:'SOL',symbol:'JITOSOL',url:'https://www.jito.network/staking/',docs:'https://www.jito.network/docs/jitosol/get-started/viewing-jitosol-rewards/',risk:'SOL price exposure, validator performance, stake-pool and token liquidity risks.',exit:'Swap at the available market price, or request delayed unstaking through Jito.'},
 {id:'marinade-liquid-staking',name:'Marinade mSOL',asset:'SOL',symbol:'MSOL',url:'https://app.marinade.finance/',docs:'https://docs.marinade.finance/marinade-protocol/faq',risk:'SOL price exposure, staking performance, smart-contract and mSOL liquidity risks.',exit:'Delayed unstaking or a market swap; immediate exit price and fees depend on liquidity.'},
 {id:'jupiter-staked-sol',name:'Jupiter JupSOL',asset:'SOL',symbol:'JUPSOL',url:'https://jup.ag/stake',docs:'https://jup.ag/stake',risk:'SOL price exposure, validator performance, stake-pool and JupSOL liquidity risks.',exit:'Use the provider’s unstaking flow or a market swap; review the quoted fee and delay.'},
] as const;
export function normalizeStaking(body:any):YieldIdea[]{
 if(!Array.isArray(body?.data))throw Error('Staking source returned no catalogue');
 return STAKING.map(p=>{const row=body.data.find((r:any)=>r.project===p.id&&r.chain==='Solana'&&r.symbol===p.symbol);return {id:p.id,name:p.name,kind:'staking',chain:'Solana',asset:p.asset,provider:p.name,inputTokenMint:BASKET_SOL,inputTokenDecimals:9,assetPriceUsd:null,depositEnabled:row?row.isDepositDisabled!==true&&row.isActive!==false:null,rate:finite(row?.apy),rateType:'APY',basis:'Provider APY indexed by DefiLlama. Native-token yield, not a USD return. Calculation windows vary by provider.',tvlUsd:finite(row?.tvlUsd),url:p.url,docs:p.docs,source:'https://defillama.com/yields',risk:p.risk,exit:p.exit};});
}
export function normalizeLido(body:any):YieldIdea[]{
 if(!body?.data)throw Error('Lido rate unavailable');
 const times=(body.data.aprs||[]).map((r:any)=>finite(r.timeUnix)).filter((n:any)=>n!=null);
 return [{id:'lido-steth',name:'Lido stETH',kind:'staking',chain:'Ethereum',asset:'ETH',provider:'Lido',rate:finite(body.data.smaApr),rateType:'APR',basis:'Seven-day average stETH APR from Lido. APR does not assume compounding. Ethereum mainnet; this is not staking on Robinhood Chain.',tvlUsd:null,url:'https://stake.lido.fi/',source:'https://eth-api.lido.fi/v1/protocol/steth/apr/sma',docs:'https://docs.lido.fi/integrations/api/',rateAsOf:times.length?new Date(Math.max(...times)*1000).toISOString():null,risk:'ETH price exposure, validator/slashing, smart-contract and stETH liquidity risks.',exit:'Request withdrawal through Lido’s queue, or swap at the available market price. Queue times vary.'}];
}
export function normalizeBackyard(body:any):YieldIdea[]{
 if(!Array.isArray(body))throw Error('Backyard returned no vault catalogue');
 return body.filter(v=>typeof v.id==='string'&&typeof v.name==='string').map(v=>({id:'backyard:'+v.id,name:v.name,kind:'vault',chain:'Solana',asset:String(v.inputTokenSymbol||v.name),inputTokenMint:basketMint(v.inputTokenMint)?v.inputTokenMint:null,inputTokenDecimals:finite(v.inputTokenDecimals)!==null&&Number.isInteger(Number(v.inputTokenDecimals))&&Number(v.inputTokenDecimals)<=18?Number(v.inputTokenDecimals):null,assetPriceUsd:finite(v.assetPrice),depositEnabled:typeof v.isDepositDisabled==='boolean'?!v.isDepositDisabled:null,provider:'Backyard / '+String(v.platformLabel||v.platform||'Provider not listed'),rate:finite(v.apy),rateType:'APY',basis:'APY reported by Backyard for the underlying vault. Incentive and fee breakdown is not supplied by this endpoint; quoted YARD rewards are not added here.',tvlUsd:finite(v.protocolTvlUsd),wrapperTvlUsd:finite(v.backyardTvlUsd),url:'https://app.backyard.finance/',source:'https://alpha.api.backyard.finance/vaults',docs:'https://backyard-fi.gitbook.io/backyard-finance/yield-manager/what-is-yield-manager',disabled:v.isDepositDisabled===true,risk:'Backyard and underlying protocol contracts, lending/liquidity risk and the deposit asset’s price or peg. RWA vaults also depend on their issuers and redemption terms.',exit:'Review the specific vault’s available liquidity, withdrawal queue and fees on Backyard. Borrowing against a vault adds separate liquidation risk.'}));
}
const inflight=new Map<string,Promise<any>>();
async function readSource(kv:KVNamespace,id:string,url:string,normalize:(body:any)=>YieldIdea[],force:boolean){
 const key='long-game:v1:'+id,saved=await kv.get<any>(key,'json'),age=saved?Date.now()-Date.parse(saved.readAt):Infinity;
 if(saved&&age<(force?60000:3600000))return {...saved,stale:false};
 if(inflight.has(key))return inflight.get(key);
 const work=(async()=>{try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Provider unavailable');const entry={items:normalize(await r.json()),readAt:new Date().toISOString()};await kv.put(key,JSON.stringify(entry),{expirationTtl:604800});return {...entry,stale:false};}catch{return {...(saved||{items:[],readAt:null}),stale:true,error:id+' rates could not be refreshed.'};}})().finally(()=>inflight.delete(key));inflight.set(key,work);return work;
}
export async function longGameData(kv:KVNamespace,force=false){
 const result=await Promise.all([
 readSource(kv,'Solana staking','https://yields.llama.fi/pools',normalizeStaking,force),
 readSource(kv,'Lido','https://eth-api.lido.fi/v1/protocol/steth/apr/sma',normalizeLido,force),
 readSource(kv,'Backyard','https://alpha.api.backyard.finance/vaults',normalizeBackyard,force),
 ]);
 return {items:result.flatMap(s=>s.items.map((p:YieldIdea)=>({...p,readAt:s.readAt,stale:s.stale}))),errors:result.filter(s=>s.error).map(s=>s.error),checkedAt:new Date().toISOString(),refreshMinutes:60};
}
