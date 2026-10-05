import type {Pool} from './schema';
import type {MarketPoint,MarketSignal,SignalArm,SignalExitState} from './fleet-signals';
import {volumeSignal} from './volume';

export const ROLE_VERSION='role-signals-v2';
export const WATCHED_META_MINTS=['6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx']; // STONK, verified by mint; never a symbol match.
const SOL='So11111111111111111111111111111111111111112';
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const observedAmount=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const fresh=(at:string,now:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=600000;
export function metaLeaders(pools:Pool[],now:number):Set<string>{
 const byMint=new Map<string,Pool>();
 for(const p of pools){
  if(p.chain!=='solana'||p.venue!=='meteora-dlmm'||(p.base.address===SOL)===(p.quote.address===SOL)||!fresh(p.fetchedAt,now)||!positive(p.tvlUsd)||p.tvlUsd<50000||!positive(p.activity?.volume4h)||!positive(p.ageHours)||p.ageHours<6)continue;
  const mint=p.base.address===SOL?p.quote.address:p.base.address;
  if(!byMint.has(mint)||p.activity.volume4h>(byMint.get(mint)!.activity?.volume4h||0))byMint.set(mint,p);
 }
 return new Set([...byMint].sort((a,b)=>b[1].activity!.volume4h!-a[1].activity!.volume4h!||a[0].localeCompare(b[0])).slice(0,12).map(([mint])=>mint));
}
// Forward hypotheses. Rolling market volume is a selection proxy, never social
// intelligence or a promise that a narrative, token or fee yield will persist.
export function roleSignal(arm:SignalArm,p:Pool,rows:MarketPoint[],now:number,legacy:MarketSignal,leaders:Set<string>):MarketSignal{
 if(arm==='wide')return {...legacy,version:ROLE_VERSION};
 const last=rows.at(-1),price=legacy.priceSol,checks:{label:string;pass:boolean}[]=[];
 const add=(label:string,pass:boolean)=>checks.push({label,pass});
 const series=(m:number)=>rows.filter(r=>last&&r[0]<=last[0]&&last[0]-r[0]<=m*60000);
 const span=last&&rows.length?(last[0]-rows[0][0])/60000:0;
 const enough=(m:number,n:number)=>span>=m&&rows.length>=n;
 add('Fresh price and fee activity',legacy.checks[0]?.pass===true);
 let quality=0,label='';
 if(arm==='scalp'){
  label='Fast breakout';const short=series(10),prior=short.slice(0,-1),high=prior.length?Math.max(...prior.map(r=>r[1])):null;
  const move=last&&short.length>=2?last[1]/short[0][1]-1:null;
  add('Two distinct observations over at least four minutes',enough(4,2));
  add('Volume pace at least 1.5×',legacy.volumeRatio!=null&&legacy.volumeRatio>=1.5);
  add('Breaking the observed high, no more than 6% above it',positive(price)&&positive(high)&&price>=high&&price<=high*1.06);
  add('Recent rise between 0.5% and 20%',move!=null&&move>=.005&&move<=.2);
  const recent=series(15),retention=last&&recent.length?last[2]/Math.max(...recent.map(r=>r[2])):0;
  add('Liquidity retains at least 85%',retention>=.85);
  quality=.45*clamp(((legacy.volumeRatio||0)-1)/3)+.3*clamp((legacy.feeDensity||0)/.02)+.25*clamp((move||0)/.05);
 }else if(arm==='farmer'){
  label='High-volume range';const range=series(30),prices=range.map(r=>r[1]);
  const band=prices.length?Math.max(...prices)/Math.min(...prices)-1:Infinity;
  const drift=last&&range.length?last[1]/range[0][1]-1:Infinity;
  const retention=last&&range.length?last[2]/Math.max(...range.map(r=>r[2])):0;
  add('At least 30 minutes of range observations',enough(28,7));
  add('Range under 20%; drift within 6%',band<=.2&&Math.abs(drift)<=.06);
  add('Volume retains at least 70% of prior pace',legacy.volumeRatio!=null&&legacy.volumeRatio>=.7);
  add('Liquidity retains at least 90%',retention>=.9);
  quality=.5*clamp((legacy.feeDensity||0)/.01)+.3*clamp((p.activity?.volume30m||0)/250000)+.2*(1-clamp(Math.abs(drift)/.06));
 }else{
  const mint=p.base.address===SOL?p.quote.address:p.base.address,watched=WATCHED_META_MINTS.includes(mint);
  label=watched?'Watched meta · sustained trend':'Volume leader · sustained trend';
  const range=series(60),prices=range.map(r=>r[1]),band=prices.length?Math.max(...prices)/Math.min(...prices)-1:Infinity;
  const drift=last&&range.length?last[1]/range[0][1]-1:-Infinity;
  const retention=last&&range.length?last[2]/Math.max(...range.map(r=>r[2])):0;
  const h1=p.activity?.volume1h,h4=p.activity?.volume4h,prior=positive(h4)&&positive(h1)?(h4-h1)/3:null;
  add('Watched mint or top-12 token by measured four-hour volume',watched||leaders.has(mint));
  add('At least one hour of observations',enough(58,12));
  add('At least $100k four-hour volume',positive(h4)&&h4>=100000);
  add('Hourly activity retains 60% of the prior three-hour average',positive(h1)&&positive(prior)&&h1>=prior*.6);
  add('Hourly decline under 5%; range under 60%',drift>=-.05&&band<=.6);
  add('Liquidity retains at least 90%',retention>=.9);
  quality=.4*clamp((h4||0)/2000000)+.3*clamp(positive(prior)?(h1||0)/prior/2:0)+.2*clamp((drift+.05)/.2)+.1*Number(watched);
 }
 const ready=checks.every(c=>c.pass);
 return {...legacy,version:ROLE_VERSION,label,ready,score:Math.round(quality*100),reason:ready?label+' confirmed':checks.find(c=>!c.pass)!.label,checks};
}

export interface RoleExitInput {state:SignalExitState;at:string;openedAt:string;netSol:number|null;budgetSol:number;inRange:boolean;priceSol:number;entryPriceSol?:number;fillObserved?:boolean;current?:Pool;entryPool:Pool;entrySignal?:MarketSignal;continuous:boolean}
export function roleExit(arm:SignalArm,x:RoleExitInput):{state:SignalExitState;reason:string|null}{
 const state={...x.state},now=Date.parse(x.at),minutes=(now-Date.parse(x.openedAt))/60000;
 if(state.lastAt&&now<=Date.parse(state.lastAt))return {state,reason:null};
 state.lastAt=x.at;
 if(x.netSol!=null)state.peakNetSol=Math.max(state.peakNetSol||0,x.netSol);
 const waiting=arm==='wide'&&!x.fillObserved;
 state.outSince=x.inRange||waiting?undefined:x.continuous?state.outSince||x.at:x.at;
 if((arm==='scalp'||arm==='farmer')&&!x.inRange)return {state,reason:arm==='scalp'?'Heart Attack left its nine-bin range':'Fee farmer left its range'};
 if(arm==='scalp'&&positive(x.entryPriceSol)){
  if(x.priceSol<x.entryPriceSol*.985)return {state,reason:'Breakout failed: price fell 1.5% below entry'};
  if(minutes>=3&&x.priceSol<=x.entryPriceSol*1.003)return {state,reason:'No breakout follow-through after three minutes'};
 }
 if(arm==='wide'&&x.entrySignal?.lowSol&&x.priceSol<x.entrySignal.lowSol*.97)return {state,reason:'Observed pullback low failed'};
 const trailing=arm==='scalp'?{arm:.02,give:.015}:arm==='steady'?{arm:.15,give:.1}:{arm:.08,give:.05};
 if(x.netSol!=null&&(state.peakNetSol||0)/x.budgetSol>=trailing.arm&&((state.peakNetSol||0)-x.netSol)/x.budgetSol>=trailing.give)return {state,reason:'Net profit gave back '+Math.round(trailing.give*1000)/10+'% of entry'};
 const current=x.current&&fresh(x.current.fetchedAt,now)?x.current:null;
 if(current&&current.fetchedAt!==state.activityAt){
  const v=volumeSignal(current,now),fees=current.activity?.fees1h,oldFees=x.entryPool.activity?.fees1h;
  const h4=current.activity?.volume4h,entry4=x.entryPool.activity?.volume4h;
  // Long holds need sustained four-hour decay, not a quiet half hour.
  // A fully quiet window has no pace ratio when its preceding window is also
  // zero. It is still measured decay from positive entry activity.
  const zeroVolume=v.latest30m===0&&positive(x.entryPool.activity?.volume30m);
  const weak=arm==='steady'?observedAmount(h4)&&positive(entry4)&&h4<entry4*.35:
    ((v.ratio!=null&&v.ratio<.5)||zeroVolume)&&observedAmount(fees)&&positive(oldFees)&&fees<oldFees*.4;
  const continuous=state.activityAt&&Date.parse(current.fetchedAt)>Date.parse(state.activityAt)&&Date.parse(current.fetchedAt)-Date.parse(state.activityAt)<=600000;
  state.weakChecks=weak?(continuous?(state.weakChecks||0)+1:1):0;state.activityAt=current.fetchedAt;
 }
 if(!waiting&&minutes>=(arm==='steady'?240:arm==='scalp'?5:30)&&(state.weakChecks||0)>=(arm==='steady'?6:3))return {state,reason:arm==='steady'?'Four-hour volume faded across six fresh observations':'Volume and fee flow both faded across three observations'};
 const out=state.outSince?(now-Date.parse(state.outSince))/60000:0;
 if(!waiting&&out>=(arm==='steady'?120:30))return {state,reason:'Continuously observed outside range for '+Math.round(out)+' minutes'};
 return {state,reason:null};
}
