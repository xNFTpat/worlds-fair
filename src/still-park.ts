import type {Env} from './env';
import {cestoData} from './cesto';
import {longGameData} from './long-game';
import {getStillPreflight,listStillPools} from './still-preflight';
import {getSnapshot} from './refresh';
import {preparePaperBasketPurchase,markPaperBaskets,type PaperBasketHolding} from './worldsfair-paper-baskets';
import {preparePaperVaultDeposit,accruePaperVault,type PaperVaultHolding} from './worldsfair-paper-vaults';
export const EXAMPLE_PARK_LAMPORTS=1_000_000_000;
export interface StillParkInput {mode:'example';split:[number,number,number];poolAddress:string|null;basketSlug:string|null;vaultId:string|null}
export interface StillParkRecord {id:string;mode:'example';at:string;amountLamports:number;split:[number,number,number];poolPositionIds:string[];basket?:PaperBasketHolding;vault?:PaperVaultHolding;basketMark?:Awaited<ReturnType<typeof markPaperBaskets>>['marks'][number]}
export function parseParkInput(input:Record<string,unknown>):StillParkInput {
 if(input.mode!=='example'||!Array.isArray(input.split)||input.split.length!==3||input.split.some(n=>!Number.isInteger(n)||n<0||n>100||n%5!==0)||input.split.reduce((a,n)=>a+n,0)!==100)throw Error('Choose a paper example split in 5% steps that totals 100%.');
 const split=input.split as [number,number,number];
 const valid=(key:string,re:RegExp,index:number)=>{if(!split[index]){if(input[key]!=null)throw Error('A zero split cannot select a destination.');return null;}if(typeof input[key]!=='string'||!re.test(input[key] as string))throw Error('Choose every destination in your split.');return input[key] as string;};
 return {mode:'example',split,poolAddress:valid('poolAddress',/^[1-9A-HJ-NP-Za-km-z]{32,44}$/,0),basketSlug:valid('basketSlug',/^[a-zA-Z0-9_-]{1,100}$/,1),vaultId:valid('vaultId',/^[a-zA-Z0-9_:-]{1,120}$/,2)};
}
export function parkSplit(total:number,split:readonly number[]):[number,number,number]{
 if(!Number.isSafeInteger(total)||total<1||split.length!==3||split.some(n=>!Number.isInteger(n)||n<0||n>100)||split.reduce((a,n)=>a+n,0)!==100)throw Error('Invalid paper allocation.');
 const amounts=split.map(p=>Math.floor(total*p/100)),last=split[2]>0?2:split[1]>0?1:0;amounts[last]+=total-amounts.reduce((a,n)=>a+n,0);return amounts as [number,number,number];
}
export async function stillParkData(env:Env){
 const [market,baskets,vaults]=await Promise.allSettled([getSnapshot(env),cestoData(env.LP_CACHE,null),longGameData(env.LP_CACHE)]);
 const pools=market.status==='fulfilled'?listStillPools(market.value):[];
 const checked=await Promise.all(pools.slice(0,8).map(p=>getStillPreflight(env,p.address,.4).catch(()=>null)));
 return {paper:true,checkedAt:new Date().toISOString(),pools:checked.filter(p=>p?.verdict.label==='Worth it').slice(0,3).map(p=>({address:p!.poolAddress,name:p!.name,asOf:p!.fetchedAt,source:p!.priceSol.source})),
  poolNote:'Only pools with a complete “Worth a look” pre-flight are shown. If none qualify, set Pools to 0% or try a pool separately.',
  baskets:baskets.status==='fulfilled'&&!baskets.value.stale?baskets.value.baskets:[],basketAsOf:baskets.status==='fulfilled'?new Date(baskets.value.readAt).toISOString():null,
  vaults:vaults.status==='fulfilled'?vaults.value.items.filter((v:any)=>v.chain==='Solana'&&!v.stale&&!v.disabled&&v.depositEnabled===true&&Number.isFinite(v.rate)&&v.rate>=0&&v.inputTokenMint&&Number.isInteger(v.inputTokenDecimals)).slice(0,40):[],
  errors:[...(baskets.status==='rejected'||baskets.value.stale?['Cesto catalogue unavailable.']:[]),...(vaults.status==='rejected'?['Backyard rates unavailable.']:vaults.value.errors)]};
}
export const parkProviders={basket:preparePaperBasketPurchase,vault:preparePaperVaultDeposit,marks:markPaperBaskets};
export function validateParkQuotes(record:StillParkRecord,input:StillParkInput,now:number){
 const amounts=parkSplit(record.amountLamports,input.split);
 for(const [i,p] of [[1,record.basket],[2,record.vault]] as const){
  if(!amounts[i]){if(p)throw Error('Unexpected destination quote.');continue;}
  if(!p||p.paper!==true||p.amountLamports!==amounts[i]||p.costSol!==amounts[i]/1e9||!Number.isFinite(p.expiresAt)||p.expiresAt<=now||!Number.isFinite(Date.parse(p.quoteAsOf))||Date.parse(p.quoteAsOf)>now)throw Error('A destination quote expired or did not match the split. Nothing was parked.');
 }
 const b=record.basket;if(b&&(b.kind!=='basket'||b.slug!==input.basketSlug||!Array.isArray(b.legs)||!b.legs.length||b.legs.length>20||new Set(b.legs.map(l=>l.mint)).size!==b.legs.length||b.legs.reduce((n,l)=>n+l.inputLamports,0)!==amounts[1]||b.legs.some(l=>!Number.isSafeInteger(l.inputLamports)||l.inputLamports<=0||!/^\d+$/.test(l.unitsRaw)||BigInt(l.unitsRaw)<=0n||!Number.isInteger(l.decimals)||l.decimals<0||l.decimals>18)))throw Error('Basket token units could not be verified. Nothing was parked.');
 const v=record.vault;if(v&&(v.kind!=='vault'||v.ideaId!==input.vaultId||!Number.isFinite(v.rate)||v.rate<0||!['APR','APY'].includes(v.rateType)||!/^\d+$/.test(v.principalUnitsRaw)||BigInt(v.principalUnitsRaw)<=0n||!Number.isInteger(v.decimals)||v.decimals<0||v.decimals>18||!Number.isFinite(Date.parse(v.rateReadAt))))throw Error('Vault units or rate could not be verified. Nothing was parked.');
}
export function parkView(record:StillParkRecord,now:number){return {...record,vaultAccrual:record.vault?accruePaperVault(record.vault,now):null};}
