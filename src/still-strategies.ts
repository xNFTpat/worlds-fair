import {parseStillRangeOptions, type StillRangeOptions} from './still-preflight-config';
import type {Pool} from './schema';
export type StillBot = {name:string;shape:'Spot'|'BidAsk'|'Curve';width:number;holdMinutes:number;trigger:'any'|'volume'|'pullback'|'evening';sizeSol:number};
export type StillStrategy = {id:string;name:string;style:string;rules:string;behaviour:string;handle?:string;sourceUrl?:string;sourceNote?:string;attribution?:string;bot:StillBot;mode?:'heart'|'narrow'|'early'|'steady'};
const bot=(name:string,shape:StillBot['shape'],width:number,holdMinutes:number,trigger:StillBot['trigger'],sizeSol=.5):StillBot=>({name,shape,width,holdMinutes,trigger,sizeSol});
// Public post URLs supplied in the Still MVP brief. No endorsement is implied.
// Exact retrace percentages, entry windows, sizes and holds are declared paper examples.
export const STILL_STRATEGIES:StillStrategy[]=[
 {id:'heart',name:'Heart Attack',style:'Jump on volume bursts, wait for the pullback, get out fast.',rules:'Waits for about $1M of observed volume in 5 minutes, then a small retrace. Opens a two-sided Spot range, takes the fee burst and exits fast.',behaviour:'Busy and short. Lots of small trades and misses. Sharp when it works.',handle:'molusol',sourceUrl:'https://x.com/molusol/status/2107563392084873543',sourceNote:'Still example: at least $1M of measured 5-minute volume, a subsequent 5% retrace within 10 minutes, Spot ±10%, and a 15-minute hold. A measured increase of at least $1M in cumulative volume between fresh reads no more than 5 minutes apart also qualifies. No pre-run backfill or division of longer windows.',bot:bot('Heart Attack','Spot',10,15,'pullback'),mode:'heart'},
 {id:'narrow',name:'Narrow Spot',style:'A narrow range just under price, in and out within the hour.',rules:'Spot range 20–30% below price. Only 0.5% base-fee, bin-step-50 pools with volume around 10× TVL. Holds 8–38 minutes.',behaviour:'Fast. Earns while the volume lasts. Exit cost matters a lot at this pace.',handle:'razzaer',sourceUrl:'https://x.com/razzaer/status/2107576780391387512',sourceNote:'Still example: observed 30-minute volume of at least 10× TVL, a range from −30% to −20%, 0.5 SOL and a 30-minute hold. The 0.5% requirement is the pool’s reported base fee, not its dynamic fee.',bot:bot('Narrow Spot','Spot',30,30,'volume'),mode:'narrow'},
 {id:'rider',name:'Pump & Dump Rider',style:'Ride busy trading, then leave when the planned hold ends.',rules:'Ride launch pumps and dumps with DLMM shapes and short holds. Inspired by the public article “1 → 100 SOL in just 12 Days: My Pump and Dump Strategies in DLMM”. The author’s result is not a Still result or a promise.',behaviour:'Short Spot positions. Fast falls can overwhelm the fees.',handle:'Eyyyys',sourceUrl:'https://x.com/Eyyyys/status/2099817371372560521',sourceNote:'Still uses a two-sided Spot example and a 30-minute hold after observed volume doubles the preceding 30 minutes. These settings do not reproduce the article’s reported returns.',bot:bot('Pump & Dump Rider','Spot',20,30,'volume')},
 {id:'catch',name:'SOL-only Bid-Ask Catch',style:'Provide SOL below price and let a dip fill the range.',rules:'Single-sided SOL Bid-Ask with a −30% floor, entering on volume to absorb dumps.',behaviour:'Waits above the range; holds more of the token after a fall. A floor is not a stop-loss.',handle:'Jaypee_Sol',sourceUrl:'https://x.com/Jaypee_Sol/status/2107017949215383786',bot:bot('SOL-only Bid-Ask Catch','BidAsk',30,240,'volume')},
 {id:'early',name:'Early Window',style:'Fresh volume only. Review every trade afterwards.',rules:'Enters only on fresh volume and records a post-mortem on every paper close.',behaviour:'Early pools can reverse quickly. Missed or stale observations stay unavailable.',handle:'VladimirKovacs',sourceUrl:'https://x.com/VladimirKovacs/status/2099778321298890892',sourceNote:'Still example: pools under 24 hours old, observed 30-minute volume doubling the preceding 30 minutes, and a 30-minute hold. Every paper close records a post-mortem for review alongside Learn.',bot:bot('Early Window','Spot',20,30,'volume'),mode:'early'},
 {id:'overnight',name:"Pat’s Overnight",style:'A wide SOL-only Bid-Ask range, held for up to a day.',rules:'SOL-only Bid-Ask with a floor 42–48% below price and a hold of up to 24 hours.',behaviour:'More room for dips means more token inventory after a fall. The floor is not a stop-loss.',attribution:"Pat’s house strategy. Paper only.",sourceNote:'Still example: −45% floor, 0.5 SOL and a 24-hour hold. The actual range follows the available pool grid.',bot:bot('Pat’s Overnight','BidAsk',45,1440,'any')},
 {id:'drip',name:'Steady Drip',style:'Two-sided Spot ranges on established pools.',rules:'Established pools only. Two-sided Spot range ±10%. Closes on an observed range exit.',behaviour:'Slow and even. Lower fees, less to watch.',attribution:'A Still house example. Paper only.',bot:bot('Steady Drip','Spot',10,2880,'any'),mode:'steady'},
];
export function parseStillBot(value:unknown):StillBot {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Pick a range and a size to start.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['name','shape','width','holdMinutes','trigger','sizeSol'].includes(k))||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||typeof v.width!=='number'||!Number.isFinite(v.width)||v.width<1||v.width>80||typeof v.sizeSol!=='number'||!Number.isFinite(v.sizeSol)||v.sizeSol<.001||v.sizeSol>10||!Number.isSafeInteger(Math.round(v.sizeSol*1e9))||Math.abs(v.sizeSol*1e9-Math.round(v.sizeSol*1e9))>1e-5||!['any','volume','pullback','evening'].includes(String(v.trigger)))throw Error('Pick a range and a size to start.');
 parseStillRangeOptions({shape:v.shape,floorPct:v.width,ceilingPct:v.shape==='BidAsk'?0:v.width,holdMinutes:v.holdMinutes});
 return {...v,name:v.name.trim()} as StillBot;
}
export const botRange=(b:StillBot,mode?:StillStrategy['mode']):StillRangeOptions=>({shape:b.shape,floorPct:mode==='narrow'?30:b.width,ceilingPct:mode==='narrow'?-20:b.shape==='BidAsk'?0:b.width,holdMinutes:b.holdMinutes});
interface StillVolumeSample {at:string;totalUsd:number}
export interface StillMarketMemory {at:string;price:number;burstAt?:string;peak?:number;volumeSamples?:StillVolumeSample[];volumeEvidence?:{from:string;to:string;increaseUsd:number;source:string}}
export interface StillFollowRun {id:string;strategyId:string|null;bot:StillBot;mode?:StillStrategy['mode'];startedAt:string;active:boolean;lastCheckAt:string|null;lastEntryAt?:string;note:string;memory:Record<string,StillMarketMemory>}
const known=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function strategySignal(run:StillFollowRun,pool:Pool,price:number,now:number):{ready:boolean;reason:string;memory:StillMarketMemory} {
 const old=run.memory[pool.address],at=pool.fetchedAt,age=now-Date.parse(at),tvl=pool.tvlUsd;
 const next:StillMarketMemory={at,price};
 const no=(reason:string)=>({ready:false,reason,memory:next});
 if(!known(price)||price<=0||!Number.isFinite(age)||age<0||age>600000||Date.parse(at)<Date.parse(run.startedAt))return no('Waiting for a fresh observation after this run started.');
 if(!known(tvl)||tvl<=0||pool.venue!=='meteora-dlmm')return no('Pool liquidity unavailable.');
 if(run.mode==='steady'&&(!(pool.ageHours!=null&&pool.ageHours>=168)||tvl<100000||!(pool.activity?.fees1h!=null&&pool.fees24hUsd!=null&&pool.activity.fees1h<=pool.fees24hUsd/12)))return no('Waiting for an established Steady pool.');
 const volume=pool.activity?.volume30m,volumeHour=pool.activity?.volume1h,volume5m=pool.activity?.volume5m;
 let measuredBurst=false;
 if(run.mode==='heart'){
  // A short observed cumulative delta is a lower bound on volume in five minutes,
  // not an extrapolated five-minute total. Keep only this run's forward reads.
  if(age>120000)return no('Waiting for a fresh volume observation, no more than two minutes old.');
  if(old&&Date.parse(at)<=Date.parse(old.at)){
   next.at=old.at;next.price=old.price;next.volumeSamples=old.volumeSamples?.slice(-8);next.burstAt=old.burstAt;next.peak=old.peak;next.volumeEvidence=old.volumeEvidence;
   return no('Waiting for a new timestamped volume observation.');
  }
  const total=pool.activity?.cumulativeVolumeUsd,atMs=Date.parse(at),started=Date.parse(run.startedAt);
  let samples=old?.volumeSamples||[];
  const coherent=Array.isArray(samples)&&samples.every((s,i)=>known(s.totalUsd)&&s.totalUsd>=0&&Number.isFinite(Date.parse(s.at))&&Date.parse(s.at)>=started&&Date.parse(s.at)<atMs&&(!i||(Date.parse(s.at)>Date.parse(samples[i-1].at)&&s.totalUsd>=samples[i-1].totalUsd)));
  samples=coherent?samples:[];
  const reset=known(total)&&total>=0&&samples.length>0&&total<samples[samples.length-1].totalUsd;
  if(reset)samples=[];
  samples=samples.filter(s=>atMs-Date.parse(s.at)<=300000).slice(-7);
  if(known(total)&&total>=0){
   const first=samples[0];
   if(first&&total>=first.totalUsd)next.volumeEvidence={from:first.at,to:at,increaseUsd:total-first.totalUsd,source:'Meteora observed cumulative-volume change; interval no longer than five minutes'};
   next.volumeSamples=[...samples,{at,totalUsd:total}];
  }
  if(reset)return no('The cumulative-volume counter reset. Waiting for a new measured interval.');
  const direct=known(volume5m)&&volume5m>=0;
  if(!direct&&!next.volumeEvidence)return no('5-minute volume unavailable. Collecting a new measured volume interval; no paper entry.');
  measuredBurst=(direct&&volume5m>=1000000)||(next.volumeEvidence?.increaseUsd??0)>=1000000;
 }
 const burst=run.mode==='heart'?measuredBurst:known(volume)&&known(volumeHour)&&volumeHour>volume&&volume>=2*(volumeHour-volume)&&volume>0;
 if(run.mode==='narrow'){
  const baseFee=pool.poolConfig?.baseFee??pool.feeTier;
  if(!known(baseFee)||pool.poolConfig?.binStep!==50||Math.abs(baseFee-.005)>1e-9)return no('Waiting for a reported 0.5% base-fee pool with bin step 50.');
  if(!(known(volume)&&volume/tvl>=10))return no('Waiting for 30-minute volume of at least 10× TVL.');
 }
 if(run.mode==='early'&&!(pool.ageHours!=null&&pool.ageHours<=24))return no('Waiting for a pool under a day old with fresh volume.');
 if(run.bot.trigger==='evening'){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Europe/London'}).format(now));
  if(hour<18||hour>=23)return no('Waiting for the evening window, 18:00–23:00 UK.');
 }
 if(run.bot.trigger==='volume'&&run.mode!=='narrow'&&!burst)return no('Waiting for 30-minute volume to double the preceding 30 minutes.');
 if(run.bot.trigger==='pullback'){
  const continuous=old&&Date.parse(at)>Date.parse(old.at)&&Date.parse(at)-Date.parse(old.at)<=600000;
  const recent=continuous&&old.burstAt&&now>=Date.parse(old.burstAt)&&now-Date.parse(old.burstAt)<=(run.mode==='heart'?600000:3600000);
  next.burstAt=recent?old.burstAt:burst?at:undefined;next.peak=recent?Math.max(old.peak||old.price,price):burst?price:undefined;
  if(!(recent&&next.peak&&price<=next.peak*.95))return no(run.mode==='heart'&&!recent&&!burst?'Waiting for at least $1M of measured volume in 5 minutes.':'Waiting for a 5% pullback after an observed volume burst.');
 }
 return {ready:true,reason:'The declared paper entry conditions are met.',memory:next};
}
