import type {FleetArmId} from './paper-fleet';
import type {MarketSignal} from './fleet-signals';

export const ALLOCATION_VERSION='pool-sized-v1';
export const ALLOCATION_LIMITS=Object.freeze({minSol:.1,cashReserveSol:.2,maxPoolsPerScan:3,maxAttempts:8});
export interface AllocationRequest {
 version:string;targetSol:number;minSol:number;cashAvailableSol:number;fraction:number;
 down:number;offset:number;rangeBins:number;score:number;reasons:string[];
}
export interface AllocationEvidence extends AllocationRequest {
 acceptedSol:number;attempts:{budgetSol:number;reason:string}[];limitedBy:string;
}
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
export const floorSol=(n:number)=>Math.floor(Math.max(0,n)*1e9)/1e9;
// A declared sizing experiment, not a return forecast. No pool-fee projection
// can increase cash or create profits. The SDK reader must quote every size.
export function allocationRequest(arm:FleetArmId,cashSol:number,signal?:MarketSignal):AllocationRequest {
 const score=Number.isFinite(signal?.score)?clamp(signal!.score,0,100):0,q=score/100;
 const drop=Number.isFinite(signal?.drawdown)?clamp(signal!.drawdown!,0,.5):0;
 const cash=floorSol(cashSol-.1-.0001-ALLOCATION_LIMITS.cashReserveSol);
 let fraction=arm==='farmer'?.15+.2*q:arm==='wide'?.2+.4*q:arm==='steady'?.2+.3*q:.1+.4*q;
 const reasons=[`Setup fit ${score}/100; not a win probability`];
 if(arm==='scalp'&&signal?.ready&&score>=85&&(signal.volumeRatio||0)>=2){
  fraction=.99;reasons.push('High-concentration Heart paper test: fit ≥85 and volume pace ≥2×');
 }else reasons.push(`${Math.round(fraction*100)}% of available cash before pool capacity and costs`);
 const aligned=signal?.version==='role-signals-v2'&&arm==='wide'&&signal.lowSol&&signal.priceSol?clamp(1-signal.lowSol/signal.priceSol+.02,.04,.18):null;
 const down=arm==='scalp'?.12:arm==='farmer'?clamp(.1+drop*.25,.1,.2):arm==='wide'?(aligned??clamp(Math.max(.35,drop*1.5),.35,.6)):clamp(.25+drop*.3,.25,.4);
 return {version:ALLOCATION_VERSION,targetSol:floorSol(Math.min(cash,Math.max(2,cash*fraction))),minSol:ALLOCATION_LIMITS.minSol,cashAvailableSol:cash,fraction,down,offset:arm==='wide'?(aligned?.01:.05):0,rangeBins:arm==='scalp'?9:0,score,reasons};
}
export function validAllocation(e:AllocationEvidence|undefined,budget:number,cap:AllocationRequest,cashSol:number){
 if(!e||e.version!==ALLOCATION_VERSION||!Number.isFinite(budget)||budget<cap.minSol||budget>cap.targetSol+1e-9||budget>cashSol-.1-.0001-ALLOCATION_LIMITS.cashReserveSol+1e-9)return false;
 if(e.acceptedSol!==budget||e.targetSol>cap.targetSol+1e-9||e.targetSol<budget||!Number.isFinite(e.targetSol)||e.minSol!==cap.minSol||e.down!==cap.down||e.offset!==cap.offset||e.rangeBins!==cap.rangeBins||e.score!==cap.score)return false;
 return Array.isArray(e.attempts)&&e.attempts.length>0&&e.attempts.length<=ALLOCATION_LIMITS.maxAttempts&&e.attempts.every(a=>Number.isFinite(a.budgetSol)&&a.budgetSol>=cap.minSol&&a.budgetSol<=cap.targetSol+1e-9&&typeof a.reason==='string')&&e.attempts.at(-1)!.budgetSol===budget;
}
