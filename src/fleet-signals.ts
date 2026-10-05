import type {Pool,Snapshot} from './schema';
import {volumeSignal} from './volume';
import {FLEET_MARKET_LIMIT,FLEET_MARKET_TTL_MS,FLEET_MARKET_POINTS,fleetMarketPool} from './fleet-observability';

export const SIGNAL_VERSION='market-signals-v1';
export const SIGNAL_ARMS=['farmer','scalp','wide','steady'] as const;
export type SignalArm=typeof SIGNAL_ARMS[number];
// Source timestamp, paired-token price in SOL, TVL USD, fees/hour, volume/30m.
export type MarketPoint=[number,number,number,number,number];
export type MarketMemory=Record<string,MarketPoint[]>;
export interface MarketSignal {
 version:string;arm:SignalArm;ready:boolean;score:number;label:string;reason:string;at:string;
 observations:number;minutes:number;priceSol:number|null;volumeRatio:number|null;paceKind:string;
 change:number|null;drawdown:number|null;rebound:number|null;lowSol:number|null;feeDensity:number|null;
 checks:{label:string;pass:boolean}[];
}
const SOL='So11111111111111111111111111111111111111112';
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const fresh=(at:string,now:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=600000;
export function tokenPriceSol(p:Pool):number|null {
 const x=p.base.address===SOL,y=p.quote.address===SOL;if(x===y)return null;
 if(positive(p.priceQuote))return x?1/p.priceQuote:p.priceQuote;
 if(!positive(p.priceUsd)||!positive(p.quotePriceUsd))return null;
 return x?p.quotePriceUsd/p.priceUsd:p.priceUsd/p.quotePriceUsd;
}
export function observeMarkets(previous:MarketMemory,snapshot:Snapshot,now:number,protectedPoolIds:ReadonlySet<string>=new Set()):MarketMemory {
 const next:MarketMemory={};
 // A temporary catalogue omission must not erase a continuous setup. Retained
 // points keep their original source time and cannot qualify a stale source.
 for(const [id,old] of Object.entries(previous)){
  const rows=old.filter(x=>Number.isFinite(x[0])&&x[0]<=now+60000&&now-x[0]<=FLEET_MARKET_TTL_MS).slice(-FLEET_MARKET_POINTS);
  if(rows.length)next[id]=rows;
 }
 // Screening may consider low-TVL launch pools. Observe the same native-SOL
 // universe rather than silently confining evidence to the top600 by TVL.
 const pools=snapshot.pools.filter(fleetMarketPool);
 for(const p of pools){
  const price=tokenPriceSol(p),t=Date.parse(p.fetchedAt),old=next[p.id]||[];
  if(!fresh(p.fetchedAt,now)||!positive(price)||!positive(p.tvlUsd))continue;
  let rows=old.filter(x=>x[0]<=t&&t-x[0]<=FLEET_MARKET_TTL_MS);
  const last=rows.at(-1);
  if(old.at(-1)&&t<old.at(-1)![0]){next[p.id]=old;continue;}
  if(last&&t-last[0]>600000)rows=[];
  if(!last||t-last[0]>=240000)rows.push([t,price,p.tvlUsd,p.activity?.fees1h??0,p.activity?.volume30m??0]);
  next[p.id]=rows.slice(-FLEET_MARKET_POINTS);
 }
 // Bound storage without rotating away warm histories each scan. Open-pool
 // histories come first, then recent sources and existing continuity. The API
 // reports current sources excluded by this explicit capacity limit.
 return Object.fromEntries(Object.entries(next).sort(([a,x],[b,y])=>Number(protectedPoolIds.has(b))-Number(protectedPoolIds.has(a))||y.at(-1)![0]-x.at(-1)![0]||Number(!!previous[b])-Number(!!previous[a])||a.localeCompare(b)).slice(0,FLEET_MARKET_LIMIT));
}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function marketSignal(arm:SignalArm,p:Pool,rows:MarketPoint[],now:number):MarketSignal {
 const price=tokenPriceSol(p),last=rows.at(-1),v=volumeSignal(p,now),checks:{label:string;pass:boolean}[]=[];
 const add=(label:string,pass:boolean)=>checks.push({label,pass});
 const duration=last&&rows.length?(last[0]-rows[0][0])/60000:0;
 const series=(minutes:number)=>rows.filter(x=>last&&last[0]-x[0]<=minutes*60000);
 const short=series(15),first=short[0],previous=short.at(-2);
 const change=last&&first&&short.length>=3?last[1]/first[1]-1:null;
 const step=last&&previous?last[1]/previous[1]-1:null;
 let ratio=v.ratio,paceKind='Latest 30m / preceding 30m';
 // Under 30m the rolling window is the pool's full lifetime: differences
 // between source observations are disjoint intervals. Never apply this after 30m.
 if(p.ageHours!=null&&p.ageHours<.5&&rows.length>=3){
  const [a,b,c]=rows.slice(-3),before=b[4]-a[4],latest=c[4]-b[4];
  ratio=before>=100&&latest>=0&&b[0]>a[0]&&c[0]>b[0]?(latest/(c[0]-b[0]))/(before/(b[0]-a[0])):null;
  paceKind='Observed launch intervals';
 }
 const feeDensity=positive(p.tvlUsd)&&positive(p.activity?.fees1h)?p.activity.fees1h/p.tvlUsd:null;
 const recent=series(60),high=recent.length?Math.max(...recent.map(x=>x[1])):null;
 const peakIndex=high==null?-1:recent.findIndex(x=>x[1]===high);
 const afterPeak=recent.slice(Math.max(0,peakIndex+1));
 const low=afterPeak.length?Math.min(...afterPeak.map(x=>x[1])):null;
 const drawdown=high&&low?1-low/high:null,rebound=low&&price?price/low-1:null;
 const tvlRetention=recent.length&&last?last[2]/Math.max(...recent.map(x=>x[2])):0;
 const enough=(minutes:number,count:number)=>duration>=minutes&&rows.length>=count;
 add('Fresh price and activity',fresh(p.fetchedAt,now)&&positive(price)&&!!last&&last[0]===Date.parse(p.fetchedAt)&&positive(p.activity?.volume30m)&&positive(p.activity?.fees1h));
 let label='',quality=0;
 if(arm==='scalp'){
  label='Heart Attack breakout';
  add('At least 10 minutes of observations',enough(8,3));
  add('Volume pace at least 1.2×',ratio!=null&&ratio>=1.2);
  const prior=short.slice(0,-1),resistance=prior.length?Math.max(...prior.map(x=>x[1])):null;
  add('Testing the observed high, not chasing beyond 3%',price!=null&&resistance!=null&&price/resistance>=.99&&price/resistance<=1.03);
  add('Price rising without a 30% chase',change!=null&&change>=.01&&change<=.3&&step!=null&&step>=0&&step<=.15);
  add('Liquidity retains at least 85%',tvlRetention>=.85);
  quality=.5*clamp(((ratio||0)-1)/2)+.3*clamp((change||0)/.15)+.2*clamp((feeDensity||0)/.02);
 }else if(arm==='wide'){
  label='Pullback reclaim';
  add('At least 20 minutes of observations',enough(18,5));
  add('Observed 8–45% drop from a prior high',drawdown!=null&&drawdown>=.08&&drawdown<=.45&&peakIndex<recent.length-3);
  const rising=rows.length>=3&&rows.at(-1)![1]>rows.at(-2)![1]&&rows.at(-2)![1]>rows.at(-3)![1];
  add('Two rising observations and 2–20% rebound',rising&&rebound!=null&&rebound>=.02&&rebound<=.2);
  add('Volume retains at least 70% of prior pace',ratio!=null&&ratio>=.7);
  add('Liquidity retains at least 85%',tvlRetention>=.85);
  quality=.45*clamp((rebound||0)/.08)+.3*clamp((ratio||0)/2)+.25*clamp((feeDensity||0)/.02);
 }else if(arm==='farmer'){
  label='Range fee harvest';const range=series(30),prices=range.map(x=>x[1]);
  const band=prices.length?Math.max(...prices)/Math.min(...prices)-1:Infinity;
  const drift=last&&range.length?last[1]/range[0][1]-1:Infinity;
  add('At least 30 minutes of observations',enough(28,7));
  add('Range below 25%; drift within 10%',band<=.25&&Math.abs(drift)<=.1);
  add('Volume pace between 0.7× and 2.5×',ratio!=null&&ratio>=.7&&ratio<=2.5);
  add('Liquidity retains at least 90%',tvlRetention>=.9);
  quality=.5*clamp((feeDensity||0)/.02)+.3*(1-clamp(Math.abs(drift)/.1))+.2*clamp(tvlRetention);
 }else{
  label='Durable fee trend';const range=series(60),prices=range.map(x=>x[1]);
  const band=prices.length?Math.max(...prices)/Math.min(...prices)-1:Infinity;
  const drift=last&&range.length?last[1]/range[0][1]-1:-Infinity;
  const feeRetention=last&&range.length&&range[0][3]>0?last[3]/range[0][3]:0;
  add('At least one hour of observations',enough(58,12));
  add('Hourly decline under 8%; range under 50%',drift>=-.08&&band<=.5);
  add('Fee flow retains at least 60%',feeRetention>=.6);
  add('Volume retains at least 60% of prior pace',ratio!=null&&ratio>=.6);
  add('Liquidity retains at least 90%',tvlRetention>=.9);
  quality=.4*clamp(feeRetention)+.3*clamp(tvlRetention)+.3*clamp((feeDensity||0)/.01);
 }
 const ready=checks.every(c=>c.pass);
 return {version:SIGNAL_VERSION,arm,ready,score:Math.round(quality*100),label,reason:ready?label+' confirmed':checks.find(c=>!c.pass)!.label,at:p.fetchedAt,observations:rows.length,minutes:Math.round(duration),priceSol:price,volumeRatio:ratio,paceKind,change,drawdown,rebound,lowSol:low,feeDensity,checks};
}

export interface SignalExitState {peakNetSol?:number;weakChecks?:number;outSince?:string;lastAt?:string;activityAt?:string}
export function signalExit(arm:SignalArm,input:{state:SignalExitState;at:string;openedAt:string;netSol:number;budgetSol:number;inRange:boolean;priceSol:number;current?:Pool;entryPool:Pool;entrySignal?:MarketSignal;continuous:boolean}):{state:SignalExitState;reason:string|null}{
 const {at,openedAt,netSol,budgetSol,inRange,priceSol,current,entryPool,entrySignal,continuous}=input;
 const state={...input.state},now=Date.parse(at),minutes=(now-Date.parse(openedAt))/60000;
 if(state.lastAt&&now<=Date.parse(state.lastAt))return {state,reason:null};
 state.peakNetSol=Math.max(state.peakNetSol??0,netSol);state.lastAt=at;
 state.outSince=inRange?undefined:continuous?state.outSince||at:at;
 const outMinutes=state.outSince?(now-Date.parse(state.outSince))/60000:0;
 const v=current&&fresh(current.fetchedAt,now)?volumeSignal(current,now):null;
 const entryFees=entryPool.activity?.fees1h,fees=current?.activity?.fees1h;
 const feeRatio=positive(entryFees)&&positive(fees)?fees/entryFees:null;
 const weak=v?.ratio!=null&&(v.ratio<(arm==='scalp'?.65:.5)||feeRatio!=null&&feeRatio<.4);
 if(current&&v&&current.fetchedAt!==state.activityAt){
  const activityContinuous=state.activityAt&&Date.parse(current.fetchedAt)>Date.parse(state.activityAt)&&Date.parse(current.fetchedAt)-Date.parse(state.activityAt)<=600000;
  state.weakChecks=weak?(activityContinuous?(state.weakChecks||0)+1:1):0;state.activityAt=current.fetchedAt;
 }
 const trailing=arm==='scalp'?{arm:.06,give:.04}:arm==='wide'?{arm:.08,give:.05}:arm==='farmer'?{arm:.08,give:.05}:{arm:.12,give:.08};
 let reason:string|null=null;
 if(arm==='scalp'&&!inRange)return {state,reason:'Heart Attack left its nine-bin range'};
 if(state.peakNetSol/budgetSol>=trailing.arm&&(state.peakNetSol-netSol)/budgetSol>=trailing.give)reason='Net profit gave back '+Math.round(trailing.give*100)+'% of entry';
 else if(arm==='wide'&&entrySignal?.lowSol&&priceSol<entrySignal.lowSol*.97)reason='Observed pullback low failed';
 else if(minutes>=(arm==='scalp'?15:arm==='steady'?120:30)&&(state.weakChecks||0)>=2)reason='Fee or volume activity faded on two observations';
 else if(outMinutes>=(arm==='scalp'?10:arm==='wide'?30:arm==='farmer'?20:60))reason='Continuously observed outside range for '+Math.round(outMinutes)+' minutes';
 return {state,reason};
}
