import {parseStillRangeOptions, type StillRangeOptions} from './still-preflight-config';
import type {Pool} from './schema';
export type StillBot = {name:string;shape:'Spot'|'BidAsk'|'Curve';width:number;holdMinutes:number;trigger:'any'|'volume'|'pullback'|'evening';sizeSol:number};
export type StillStrategy = {id:string;name:string;style:string;rules:string;behaviour:string;handle?:string;sourceUrl?:string;sourceNote?:string;attribution?:string;bot:StillBot;mode?:'heart'|'narrow'|'early'|'steady'};
const bot=(name:string,shape:StillBot['shape'],width:number,holdMinutes:number,trigger:StillBot['trigger'],sizeSol=.5):StillBot=>({name,shape,width,holdMinutes,trigger,sizeSol});
// TODO(permission): @molusol, @razzaer, @Eyyyys, @Jaypee_Sol and @VladimirKovacs.
// Source links discovered in LP Army's public strategy catalogue on 11 Oct 2026.
// Exact thresholds below are Still's declared example implementation, not endorsed creator rules.
export const STILL_STRATEGIES:StillStrategy[]=[
 {id:'heart',name:'Heart attack',style:'Jump on volume bursts, wait for the pullback, get out fast.',rules:'Waits for a volume-burst ping. Waits for price to retrace. Opens a two-sided Spot range. Looks for fees of 20% of TVL within 30 minutes.',behaviour:'Busy and short. Lots of small trades and misses. Sharp when it works.',handle:'molusol',sourceUrl:'https://x.com/molusol/status/1966094407045886009',bot:bot('Heart attack','Spot',10,30,'pullback'),mode:'heart'},
 {id:'narrow',name:'Narrow and quick',style:'A narrow range just under price, in and out within the hour.',rules:'Trades when volume is around 10× TVL. Spot range 20 to 30% below price. Holds 8 to 38 minutes. 3 SOL per position.',behaviour:'Fast. Earns while the volume lasts. Exit cost matters a lot at this pace.',handle:'razzaer',sourceUrl:'https://x.com/razzaer/status/1974613647704887505',bot:bot('Narrow and quick','Spot',25,30,'volume',3),mode:'narrow'},
 {id:'rider',name:'Pump & dump rider',style:'Ride busy trading, then leave when the planned hold ends.',rules:'A paper interpretation of the public “1 → 100 SOL in 12 days” DLMM article. The author’s result is not a Still result or a promise.',behaviour:'Short Spot positions. Fast falls can overwhelm the fees.',handle:'Eyyyys',sourceUrl:'https://x.com/Eyyyys/status/2099817371372560521',sourceNote:'The article is indexed by LP Army. These example settings are not a reproduction of its reported returns.',bot:bot('Pump & dump rider','Spot',20,30,'volume')},
 {id:'catch',name:'SOL-only Bid-Ask catch',style:'Provide SOL below price and let a dip fill the range.',rules:'Single-sided SOL Bid-Ask, −30% floor, enter on volume.',behaviour:'Waits above the range; holds more of the token after a fall. A floor is not a stop-loss.',handle:'Jaypee_Sol',sourceUrl:'https://x.com/Jaypee_Sol/status/1987773963619999966',bot:bot('SOL-only Bid-Ask catch','BidAsk',30,240,'volume')},
 {id:'early',name:'Early window',style:'Fresh volume only. Review every trade afterwards.',rules:'Looks for fresh volume and records a post-mortem on every paper close.',behaviour:'Early pools can reverse quickly. Missed or stale observations stay unavailable.',handle:'VladimirKovacs',sourceUrl:'https://x.com/VladimirKovacs/status/2104497731939033572',bot:bot('Early window','Spot',20,30,'volume'),mode:'early'},
 {id:'overnight',name:'Overnight patience',style:'A wide Bid-Ask range, left overnight.',rules:'Bid-Ask shape. Floor 45% below price. Opened in the evening, closed the next morning.',behaviour:'Quiet. Smaller fees, fewer decisions, more room for dips. Smaller fees, less stress.',attribution:"Pat's own strategy.",bot:bot('Overnight patience','BidAsk',45,720,'evening')},
 {id:'drip',name:'Steady drip',style:'Wide Spot ranges on established pools.',rules:'Steady pools only. Spot range ±10%. Moves only when out of range.',behaviour:'Slow and even. Lower fees, less to watch.',attribution:'A Still house example.',bot:bot('Steady drip','Spot',10,2880,'any'),mode:'steady'},
];
export function parseStillBot(value:unknown):StillBot {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Pick a range and a size to start.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['name','shape','width','holdMinutes','trigger','sizeSol'].includes(k))||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||typeof v.width!=='number'||!Number.isFinite(v.width)||v.width<1||v.width>80||typeof v.sizeSol!=='number'||!Number.isFinite(v.sizeSol)||v.sizeSol<.001||v.sizeSol>10||!Number.isSafeInteger(Math.round(v.sizeSol*1e9))||Math.abs(v.sizeSol*1e9-Math.round(v.sizeSol*1e9))>1e-5||!['any','volume','pullback','evening'].includes(String(v.trigger)))throw Error('Pick a range and a size to start.');
 parseStillRangeOptions({shape:v.shape,floorPct:v.width,ceilingPct:v.shape==='BidAsk'?0:v.width,holdMinutes:v.holdMinutes});
 return {...v,name:v.name.trim()} as StillBot;
}
export const botRange=(b:StillBot,mode?:StillStrategy['mode']):StillRangeOptions=>({shape:b.shape,floorPct:b.width,ceilingPct:b.shape==='BidAsk'||mode==='narrow'?0:b.width,holdMinutes:b.holdMinutes});
export interface StillMarketMemory {at:string;price:number;burstAt?:string;peak?:number}
export interface StillFollowRun {id:string;strategyId:string|null;bot:StillBot;mode?:StillStrategy['mode'];startedAt:string;active:boolean;lastCheckAt:string|null;lastEntryAt?:string;note:string;memory:Record<string,StillMarketMemory>}
const known=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function strategySignal(run:StillFollowRun,pool:Pool,price:number,now:number):{ready:boolean;reason:string;memory:StillMarketMemory} {
 const old=run.memory[pool.address],at=pool.fetchedAt,age=now-Date.parse(at),tvl=pool.tvlUsd;
 const next:StillMarketMemory={at,price};
 const no=(reason:string)=>({ready:false,reason,memory:next});
 if(!known(price)||price<=0||!Number.isFinite(age)||age<0||age>600000||Date.parse(at)<Date.parse(run.startedAt))return no('Waiting for a fresh observation after this run started.');
 if(!known(tvl)||tvl<=0||pool.venue!=='meteora-dlmm')return no('Pool liquidity unavailable.');
 if(run.mode==='steady'&&(!(pool.ageHours!=null&&pool.ageHours>=168)||tvl<100000||!(pool.activity?.fees1h!=null&&pool.fees24hUsd!=null&&pool.activity.fees1h<=pool.fees24hUsd/12)))return no('Waiting for an established Steady pool.');
 const volume=pool.activity?.volume30m,volumeHour=pool.activity?.volume1h;
 const burst=known(volume)&&known(volumeHour)&&volumeHour>volume&&volume>=2*(volumeHour-volume)&&volume>0;
 if(run.mode==='heart'&&!(known(pool.activity?.fees30m)&&pool.activity!.fees30m!/tvl>=.2))return no('Waiting for observed 30-minute fees of at least 20% of TVL.');
 if(run.mode==='narrow'&&!(known(volume)&&volume/tvl>=10))return no('Waiting for 30-minute volume of at least 10× TVL.');
 if(run.mode==='early'&&!(pool.ageHours!=null&&pool.ageHours<=24))return no('Waiting for a pool under a day old with fresh volume.');
 if(run.bot.trigger==='evening'){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Europe/London'}).format(now));
  if(hour<18||hour>=23)return no('Waiting for the evening window, 18:00–23:00 UK.');
 }
 if(run.bot.trigger==='volume'&&run.mode!=='narrow'&&!burst)return no('Waiting for 30-minute volume to double the preceding 30 minutes.');
 if(run.bot.trigger==='pullback'){
  const continuous=old&&Date.parse(at)>Date.parse(old.at)&&Date.parse(at)-Date.parse(old.at)<=600000;
  const recent=continuous&&old.burstAt&&now-Date.parse(old.burstAt)<=3600000;
  next.burstAt=recent?old.burstAt:burst?at:undefined;next.peak=recent?Math.max(old.peak||old.price,price):burst?price:undefined;
  if(!(recent&&next.peak&&price<=next.peak*.95))return no('Waiting for a 5% pullback after an observed volume burst.');
 }
 return {ready:true,reason:'The declared paper entry conditions are met.',memory:next};
}
