import {allocationRequest,validAllocation,ALLOCATION_LIMITS,type AllocationEvidence} from './fleet-allocation';
import type {Pool,Snapshot} from './schema';
import {recordFleetDecision,fleetDiscoveryHealth,fleetArmActivity,type FleetDecision,type FleetDiscoveryHealth} from './fleet-observability';
import {ROLE_VERSION,metaLeaders,roleSignal,roleExit} from './fleet-roles';
import {observeMarkets,marketSignal,signalExit,type MarketMemory,type MarketSignal,type SignalExitState} from './fleet-signals';
import type {PaperModel,PaperMark,PaperDiagnostics,PaperEntryCosts,PaperTokenPolicy} from './paper-model';

export const FLEET_FUNDING=Object.freeze({id:'paper-capital-2026-09-14',targetUsd:10000,solUsd:99.45694903481044,sol:100.546016,priceAt:'2026-09-13T23:21:43.476Z',source:'Median of 57 Meteora SOL price readings'});
// Independent, prospectively declared experiments. Never imports or rewrites baseline state.
export const FLEET_RULES=Object.freeze({version:'four-wallets-v6',seedSol:FLEET_FUNDING.sol,budgetSol:2,rentSol:.1,networkSol:.0001,slippageBps:100,maxBins:256,maxOpen:4,maxDailyEntries:96,minTvl:25000,minFees1h:100,minVolume30m:10000,minAgeHours:24,maxAgeHours:87600,confirmations:3,minScanMs:240000,maxGapMs:600000,stopLoss:-.15,takeProfit:.25,maxHoldHours:24,maxDrawdown:.25,cooldownMs:3600000});
export const FLEET_ARMS=[
 {id:'farmer',name:'Fee farmer',shape:'Spot',down:.1,offset:0,group:'farmer',twoSided:true,description:'Two-sided Spot around the current price. High-volume, stable ranges; exit on the first observed range break. Eight-hour maximum.'},
 {id:'scalp',name:'Heart Attack',shape:'Spot',down:.12,offset:0,group:'scalp',twoSided:true,description:'Fast nine-bin breakout test: no-follow-through and failed-breakout exits, ten-minute maximum. Checked each minute; quotes can delay settlement.'},
 {id:'wide',name:'Degen pullbacks',shape:'BidAsk',down:.35,offset:.05,group:'wide',twoSided:false,description:'SOL bids near a measured pullback low after a reclaim. Wait up to one hour for a fill; exit if that low fails.'},
 {id:'steady',name:'Longer hold',shape:'Curve',down:.25,offset:0,group:'steady',twoSided:true,description:'Watched tokens and sustained volume leaders, with a wider range and 48-hour horizon. Entry still needs a usable price trend and quote.'},
] as const;
export const ACTIVE_FLEET_PROFILES:FleetArmId[]=FLEET_ARMS.map(a=>a.id);
export const isSample=(_arm:FleetArmId)=>false;
export type FleetArmId=typeof FLEET_ARMS[number]['id'];
// Prospective hypotheses, versioned independently of every earlier trial.
export function fleetPolicy(id:FleetArmId,version:string=FLEET_RULES.version){
 const arm=FLEET_ARMS.find(a=>a.id===id)!;
 const specific=id==='farmer'?{minTvl:50000,maxOpen:4,maxWaitMinutes:0,maxInitialCost:.15}:
 id==='scalp'?{minAgeHours:5/60,maxAgeHours:4,minTvl:15000,minFees1h:200,confirmations:2,maxHoldHours:1.5,maxWaitMinutes:30,stopLoss:-.15,takeProfit:.2,maxInitialCost:.05}:
 id==='wide'?{minAgeHours:4,maxAgeHours:168,maxHoldHours:12,maxWaitMinutes:180,stopLoss:-.2,takeProfit:.3,maxInitialCost:.05}:
 {minAgeHours:168,minTvl:100000,minFees1h:50,minVolume30m:5000,maxHoldHours:48,maxWaitMinutes:0,stopLoss:-.2,takeProfit:.3,maxInitialCost:.15};
 const legacy=version==='four-wallets-v1'||version==='four-wallets-v2';
 const updated=legacy?{}:id==='scalp'?{maxAgeHours:8,maxHoldHours:2,maxWaitMinutes:0,maxInitialCost:.1}:id==='wide'?{minAgeHours:1,confirmations:2,maxHoldHours:8,maxWaitMinutes:90,stopLoss:-.18,takeProfit:.25,maxInitialCost:.08}:{};
 const offset=legacy&&id==='scalp'?.03:legacy&&id==='wide'?.08:arm.offset;
 const down=legacy&&id==='scalp'?.25:legacy&&id==='wide'?.6:arm.down;
 const modern=['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(version);
 const dynamic=['four-wallets-v5','four-wallets-v6'].includes(version);
 const allocation=dynamic?{cooldownMs:(id==='scalp'?5:id==='wide'?15:id==='farmer'?30:60)*60000}:{};
 const signals=modern?{signalVersion:'market-signals-v1',maxInitialCost:id==='farmer'?.05:id==='steady'?.06:id==='wide'?.04:.05,...(id==='scalp'?{minAgeHours:.25,maxAgeHours:168,maxHoldHours:.5,stopLoss:-.08,takeProfit:.12,rangeBins:9,harvestFees:true}:{rangeBins:0,harvestFees:false})}:{};
 const roles=version==='four-wallets-v6'?{signalVersion:ROLE_VERSION,...(id==='scalp'?{minAgeHours:5/60,maxHoldHours:1/6,stopLoss:-.05,takeProfit:.06,maxInitialCost:.025}:id==='farmer'?{minAgeHours:6,minVolume30m:25000,maxHoldHours:8,maxInitialCost:.02}:id==='steady'?{minAgeHours:6,minTvl:50000,maxInitialCost:.04,takeProfit:.6}:{maxWaitMinutes:60})}:{};
 return {...FLEET_RULES,maxDailyEntries:dynamic?96:24,maxOpen:dynamic?4:3,dynamicSizing:dynamic,seedSol:modern?FLEET_RULES.seedSol:10,signalVersion:undefined as string|undefined,rangeBins:0,harvestFees:false,...specific,...updated,...signals,...allocation,...roles,version,offset,down,shape:legacy&&id==='scalp'?'BidAsk':arm.shape,twoSided:legacy&&id==='scalp'?false:arm.twoSided};
}
const freshPortfolio=():FleetPortfolio=>({cashSol:FLEET_RULES.seedSol,realizedPnlSol:0,closedCount:0,wins:0,losses:0,peakSol:FLEET_RULES.seedSol,maxDrawdown:0,halted:false,entriesToday:0,unresolvedSol:0,seedSol:FLEET_RULES.seedSol,funding:[{...FLEET_FUNDING,amountSol:FLEET_RULES.seedSol}]});
export const fleetSeed=(s:FleetState,id:FleetArmId)=>s.portfolios[id]?.seedSol??10;
const portfolio=(s:FleetState,id:FleetArmId)=>s.portfolios[id]||freshPortfolio();
const cooling=(s:FleetState,arm:FleetArmId,mint:string,now:number)=>(s.cooldowns[arm+':'+mint]||s.cooldowns[mint]||0)>now;
const SOL='So11111111111111111111111111111111111111112';
export interface FleetMark extends PaperMark {waiting:boolean;withdrawTaxSol:number;epoch:number;transferFees:{mint:string;bps:number;maximumRaw:string}[]}
export interface FleetSizing {allocation?:AllocationEvidence;budgetSol?:number;rentSol?:number;entryNetworkSol?:number}
export const fleetSizing=(p:FleetSizing)=>({budgetSol:p.budgetSol??.5,rentSol:p.rentSol??.1,entryNetworkSol:p.entryNetworkSol??.0001});
export interface FleetPosition extends FleetSizing {harvest?:FleetHarvest;entrySignal?:MarketSignal;exitState?:SignalExitState;policy?:ReturnType<typeof fleetPolicy>;entryCosts?:PaperEntryCosts;id:string;experiment?:string;cohort:string;arm:FleetArmId;pool:Pool;mint:string;openedAt:string;model:PaperModel;dustSol:number;mark:FleetMark;issue:string|null;issueSince?:string;pendingSince?:string;structuralFailures?:number;pendingExit:string|null;observedInRangeMs:number;fillObserved?:boolean;entryReferenceSol?:number;bidStartSol?:number;bidEndSol?:number}
export interface FleetClosed extends FleetSizing {harvest?:FleetHarvest;entrySignal?:MarketSignal;exitState?:SignalExitState;policy?:ReturnType<typeof fleetPolicy>;entryCosts?:PaperEntryCosts;exitTransferFees?:PaperTokenPolicy[];fillObserved?:boolean;entryReferenceSol?:number;bidStartSol?:number;bidEndSol?:number;id:string;experiment?:string;cohort:string;arm:FleetArmId;pair:string;poolAddress:string;openedAt:string;closedAt:string;pnlSol:number;exitSol:number;feesSol:number;withdrawTaxSol:number;reason:string;observedInRangeMs:number}
export interface FleetHarvest {counters:{id:number;feeX:string;feeY:string}[];bankedSol:number;grossSol:number;taxSol:number;count:number;at:string}
export interface FleetRead {market?:{at:string;inRange:boolean;priceSol:number};harvest?:FleetHarvest;poolId:string;arm:FleetArmId;positionId?:string;entry?:FleetPosition;mark?:FleetMark;error?:string;allocation?:AllocationEvidence;diagnostics?:PaperDiagnostics}
export interface FleetPortfolio {withdrawnSol?:number;riskDataHold?:boolean;confirmedHaltAt?:string;riskReview?:{id:string;at:string;sourceScanAt:string;priorHalted:boolean;priorMaxDrawdown:number;priorPeakSol:number;reason:string};trial?:{checks?:number;entries?:number;resized?:number;modelRejected?:number;providerBlocked?:number;deployedSol?:number;version:string;startedAt:string;closedCount:number;unscorableCount:number;realizedPnlSol:number};seedSol?:number;funding?:Array<typeof FLEET_FUNDING & {amountSol:number;priorRisk?:{halted:boolean;maxDrawdown:number;peakSol:number}}>;unscorableCount?:number;unresolvedSol?:number;cashSol:number;realizedPnlSol:number;closedCount:number;wins:number;losses:number;peakSol:number;maxDrawdown:number;halted:boolean;entriesToday:number}
export interface FleetRuleChange {fromBudgetSol?:number;toBudgetSol?:number;sizingMode?:string;at:string;from:string;to:string;fromDailyLimit:number;toDailyLimit:number;fromMaxBins:number;toMaxBins:number;portfolios:Record<FleetArmId,{equitySol:number|null;closedCount:number;realizedPnlSol:number}>;profilesAdded?:FleetArmId[];note?:string}
export interface FleetUnscorable extends FleetSizing {id:string;arm:FleetArmId;experiment?:string;pair:string;poolAddress:string;openedAt:string;endedAt:string;reason:string;budgetSol:number;pnlSol:null}
export interface FleetState {lastDecisionByArm?:Partial<Record<FleetArmId,FleetDecision>>;lastEntryDecisionByArm?:Partial<Record<FleetArmId,FleetDecision>>;lastSuccessfulEntryCheckAt?:Partial<Record<FleetArmId,string>>;discoveryHealth?:FleetDiscoveryHealth;lastFullScanAt?:string;lastObservationMode?:'full'|'heart';markets?:MarketMemory;marketShards?:number;funnel?:Partial<Record<FleetArmId,{screened:number;ready:number;warming:number;rejected:number;checked:number;entered:number;providerBlocked:number;modelRejected:number}>>;readHealth?:{requests:number;rateLimits:number;failed:number;elapsedMs:number};entryProfiles?:FleetArmId[];lastEntryCheckAt?:Partial<Record<FleetArmId,string>>;unscorable?:FleetUnscorable[];version:string;ruleChanges?:FleetRuleChange[];revision:number;runState:'running'|'paused'|'stopping'|'stopped';startedAt:string|null;lastScanAt:string|null;day:string;portfolios:Record<FleetArmId,FleetPortfolio>;positions:FleetPosition[];closed:FleetClosed[];memory:Record<string,{at:string;streak:number}>;cooldowns:Record<string,number>;failures:Record<string,number>;candidates:{poolId:string;pair:string;streak:number;fees1h:number;group?:string;arms?:FleetArmId[];confirmations?:number;reason?:string;signal?:MarketSignal}[];skips:Record<string,number>;events:{at:string;message:string;pair?:string;arm?:FleetArmId}[]}
export const fleetFresh=(at:string|null,now:number)=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=FLEET_RULES.maxGapMs;
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function initialFleetState():FleetState{return {version:FLEET_RULES.version,entryProfiles:[...ACTIVE_FLEET_PROFILES],unscorable:[],revision:0,runState:'running',startedAt:null,lastScanAt:null,day:'',portfolios:Object.fromEntries(FLEET_ARMS.map(a=>[a.id,freshPortfolio()])) as FleetState['portfolios'],positions:[],closed:[],memory:{},cooldowns:{},failures:{},candidates:[],skips:{},events:[]};}
export function fleetCanScan(s:FleetState,snapshot:Snapshot,now=Date.now(),mode:'full'|'heart'='full'){
 const last=mode==='full'?(s.lastFullScanAt||s.lastScanAt):s.lastScanAt;
 if(mode==='heart'&&(s.version!==FLEET_RULES.version||!s.positions.some(p=>p.arm==='scalp'&&['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(p.experiment||''))))return false;
 return [FLEET_RULES.version,'four-wallets-v1','four-wallets-v2','four-wallets-v3','four-wallets-v4','four-wallets-v5'].includes(s.version)&&fleetFresh(snapshot.updatedAt,now)&&(!last||Date.parse(snapshot.updatedAt)-Date.parse(last)>=(mode==='heart'?55000:FLEET_RULES.minScanMs));
}
export function fleetEquity(s:FleetState,arm:FleetArmId,now=Date.now()):number|null{
  if(isSample(arm)||portfolio(s,arm).unscorableCount)return null;
  const positions=s.positions.filter(p=>p.arm===arm);
  if(positions.some(p=>p.issue||!fleetFresh(p.mark.at,now)||p.mark.liquidationSol==null))return null;
  return portfolio(s,arm).cashSol+positions.reduce((sum,p)=>sum+p.mark.liquidationSol!+fleetSizing(p).rentSol,0);
}
export function fleetRisk(s:FleetState,arm:FleetArmId,now=Date.now()){
  const a=portfolio(s,arm),positions=s.positions.filter(p=>p.arm===arm);
  const unavailable=positions.filter(p=>p.issue||!fleetFresh(p.mark.at,now)||p.mark.liquidationSol==null);
  const knownEquitySol=a.cashSol+positions.filter(p=>!unavailable.includes(p)).reduce((n,p)=>n+p.mark.liquidationSol!+fleetSizing(p).rentSol,0);
  return {knownEquitySol,drawdown:Math.max(0,1-knownEquitySol/a.peakSol),incomplete:unavailable.length>0||!!a.unscorableCount||!!a.unresolvedSol,unavailablePositions:unavailable.length};
}
// Public distribution omits the original private recovery records. No
// historical stop is automatically cleared without its audited evidence.
const REVIEWED_DATA_STOPS:Partial<Record<FleetArmId,{sourceScanAt:string;lastCheckAt:string;peak:number;drawdown:number}>>={};
function reviewLegacyDataStop(s:FleetState,arm:FleetArmId,now:number){
  const reviewed=REVIEWED_DATA_STOPS[arm as keyof typeof REVIEWED_DATA_STOPS],a=portfolio(s,arm);
  if(!reviewed||s.version!=='four-wallets-v5'||a.riskReview||a.confirmedHaltAt||!a.halted||s.lastEntryCheckAt?.[arm]!==reviewed.lastCheckAt||Math.abs(a.peakSol-reviewed.peak)>1e-9||Math.abs(a.maxDrawdown-reviewed.drawdown)>1e-9||!a.funding?.some(f=>f.id===FLEET_FUNDING.id)||fleetRisk(s,arm,now).drawdown>=FLEET_RULES.maxDrawdown)return;
  a.riskReview={id:'data-stop-review-2026-09-18',at:new Date(now).toISOString(),sourceScanAt:reviewed.sourceScanAt,priorHalted:a.halted,priorMaxDrawdown:a.maxDrawdown,priorPeakSol:a.peakSol,reason:'Audited temporary quote failure triggered the legacy permanent stop. Known remaining value is now above the unchanged 25% guard. Historical losses, unknown capital and worst conservative drawdown retained.'};
  a.halted=false;
  s.events.push({at:new Date(now).toISOString(),arm,message:'Reviewed data-related stop cleared; the 25% risk guard remains active. Balances and history retained.'});
}
export function fleetEntryReason(s:FleetState,arm:FleetArmId,now=Date.now()):string|null{
  const a=portfolio(s,arm),rule=fleetPolicy(arm),same=s.day===new Date(now).toISOString().slice(0,10);
  if(s.runState!=='running')return 'Entries paused or stopped';
  if(!(s.entryProfiles||ACTIVE_FLEET_PROFILES).includes(arm))return 'Archived trial · no new entries';
  if(!isSample(arm)&&a.halted)return '25% drawdown limit reached';
  if(!isSample(arm)&&a.riskDataHold)return 'Risk check paused entries while position values are incomplete';
  const risk=fleetRisk(s,arm,now);
  if(!isSample(arm)&&risk.drawdown>=FLEET_RULES.maxDrawdown)return risk.incomplete?'Risk check paused entries while position values are incomplete':'25% drawdown limit reached';
  if(s.positions.filter(p=>p.arm===arm).length>=rule.maxOpen)return 'This trial is at its open-position limit';
  if(same&&a.entriesToday>=rule.maxDailyEntries)return `${rule.maxDailyEntries}-entry daily ceiling reached; resets at midnight UTC`;
  if(!isSample(arm)&&a.cashSol<ALLOCATION_LIMITS.minSol+rule.rentSol+rule.networkSol+ALLOCATION_LIMITS.cashReserveSol)return 'Insufficient virtual SOL after account and cash reserves';
  return null;
}
export const fleetCanEnter=(s:FleetState,arm:FleetArmId,now=Date.now())=>fleetEntryReason(s,arm,now)===null;
// Failed checks consume a scheduling turn too. Successful-entry counts alone
// let an unmodellable wallet monopolise every scan while staying at zero entries.
export function fleetEntryPriority(s:FleetState,arms:FleetArmId[]){
  const last=(arm:FleetArmId)=>Date.parse(s.lastEntryCheckAt?.[arm]||'')||0;
  return [...arms].sort((a,b)=>last(a)-last(b)||(s.portfolios[a]?.entriesToday||0)-(s.portfolios[b]?.entriesToday||0)||ACTIVE_FLEET_PROFILES.indexOf(a)-ACTIVE_FLEET_PROFILES.indexOf(b));
}
export function fleetPlan(s:FleetState,snapshot:Snapshot,now=Date.now()){
  const memory:FleetState['memory']={},skips:Record<string,number>={},candidates:FleetState['candidates']=[],allowedArms:Record<string,FleetArmId[]>={};
  const leaders=metaLeaders(snapshot.pools,now);
  const groups=ACTIVE_FLEET_PROFILES,markets=observeMarkets(s.markets||{},snapshot,now,new Set(s.positions.map(p=>p.pool.id))),signals:Record<string,Partial<Record<FleetArmId,MarketSignal>>>={},funnel:NonNullable<FleetState['funnel']>={};
  for(const group of groups){
    const counts={screened:0,ready:0,warming:0,rejected:0,checked:0,entered:0,providerBlocked:0,modelRejected:0};funnel[group]=counts;
    const members=FLEET_ARMS.filter(a=>a.group===group&&(s.entryProfiles||ACTIVE_FLEET_PROFILES).includes(a.id));if(!members.length)continue;const rule=fleetPolicy(members[0].id),skip=(why:string)=>{const key=group+' · '+why;skips[key]=(skips[key]||0)+1;};
    for(const p of snapshot.pools){
      if(p.chain!=='solana'||p.venue!=='meteora-dlmm'||(p.base.address===SOL)===(p.quote.address===SOL))continue;
      if(!fleetFresh(p.fetchedAt,now)){skip('Source is stale');continue;}
      if(!positive(p.tvlUsd)||p.tvlUsd<rule.minTvl){skip('Below liquidity threshold');continue;}
      if(!positive(p.ageHours)||p.ageHours<rule.minAgeHours||p.ageHours>rule.maxAgeHours){skip('Outside pool-age window');continue;}
      if(!positive(p.activity?.fees1h)||p.activity.fees1h<rule.minFees1h||!positive(p.activity.volume30m)||p.activity.volume30m<rule.minVolume30m){skip('Reported fees or 30m volume below threshold');continue;}
      counts.screened++;
      const baseSignal=marketSignal(group,p,markets[p.id]||[],now);
      const signal=rule.signalVersion===ROLE_VERSION?roleSignal(group,p,markets[p.id]||[],now,baseSignal,leaders):baseSignal;(signals[p.id]??={})[group]=signal;
      if(signal.ready)counts.ready++;else if(signal.observations<3||signal.reason.includes('observations'))counts.warming++;else counts.rejected++;
      const mint=p.base.address===SOL?p.quote.address:p.base.address;
      const arms=members.filter(a=>!s.positions.some(x=>x.arm===a.id&&x.mint===mint)&&!cooling(s,a.id,mint,now)).map(a=>a.id);
      if(!arms.length){skip('Already held or cooling down in these trials');continue;}
      const key=group+':'+p.id,old=s.version!==FLEET_RULES.version?undefined:s.memory[key],gap=old?Date.parse(p.fetchedAt)-Date.parse(old.at):Infinity;
      const streak=old&&gap>=0&&gap<rule.minScanMs?old.streak:old&&gap>=rule.minScanMs&&gap<=rule.maxGapMs?Math.min(rule.confirmations,old.streak+1):1;
      memory[key]={at:old&&gap>=0&&gap<rule.minScanMs?old.at:p.fetchedAt,streak};
      const checked=arms.filter(arm=>(s.failures[arm+':'+p.id]||s.failures[p.id]||0)<=now);
      const reason=!signal.ready?signal.reason:!checked.length?'Recent accounting check failed; 15-minute cooldown':streak<rule.confirmations?`${streak} of ${rule.confirmations} fresh activity checks`:'Activity confirmed; waiting for an available trial and accounting check';
      candidates.push({poolId:p.id,pair:p.pair,streak,fees1h:p.activity.fees1h,group,arms,confirmations:rule.confirmations,reason,signal});
      if(signal.ready&&streak>=rule.confirmations&&checked.length)allowedArms[p.id]=[...new Set([...(allowedArms[p.id]||[]),...checked])];
    }
  }
  candidates.sort((a,b)=>Number(b.signal?.ready)-Number(a.signal?.ready)||(b.signal?.score||0)-(a.signal?.score||0)||a.poolId.localeCompare(b.poolId));
  const eligible=snapshot.pools.filter(p=>allowedArms[p.id]?.length).sort((a,b)=>b.activity!.fees1h!-a.activity!.fees1h!||a.id.localeCompare(b.id));
  // Keep a small visible shortlist per selection family, so launch activity cannot hide longer-hold ideas.
  return {memory,markets,signals,funnel,skips,candidates:groups.flatMap(group=>candidates.filter(c=>c.group===group).slice(0,3)),eligible,allowedArms};
}
function liquidityExit(p:FleetPosition,current:Pool|undefined,now:number):string|null {
 return current&&fleetFresh(current.fetchedAt,now)&&positive(current.tvlUsd)&&positive(p.pool.tvlUsd)&&current.tvlUsd<p.pool.tvlUsd*.7?'Liquidity fell 30%':null;
}
function observedExit(p:FleetPosition,r:FleetRead|undefined,at:string,current:Pool|undefined):string|null {
 const m=r?.market,rule=p.policy??fleetPolicy(p.arm,p.experiment);
 const priorAt=Date.parse(p.exitState?.lastAt||p.mark.at);
 if(!m||!fleetFresh(m.at,Date.parse(at))||typeof m.inRange!=='boolean'||!positive(m.priceSol)){
  // Accounting can be missing while price evidence remains coherent. Missing
  // price evidence itself cannot support a continuous range clock.
  if(rule.signalVersion===ROLE_VERSION&&p.exitState?.outSince)p.exitState={...p.exitState,outSince:undefined};
  return null;
 }
 if(Date.parse(m.at)<=priorAt)return null;
 if(rule.signalVersion!==ROLE_VERSION)return p.arm==='scalp'&&rule.rangeBins===9&&!m.inRange?'Heart Attack left its nine-bin range':null;
 const result=roleExit(p.arm,{state:p.exitState||{},at:m.at,openedAt:p.openedAt,netSol:null,budgetSol:fleetSizing(p).budgetSol,inRange:m.inRange,priceSol:m.priceSol,entryPriceSol:p.entryReferenceSol,fillObserved:p.fillObserved,current,entryPool:p.pool,entrySignal:p.entrySignal,continuous:Date.parse(m.at)-priorAt<=FLEET_RULES.maxGapMs});
 p.exitState=result.state;
 return result.reason;
}
function validMark(m:FleetMark,now:number){return fleetFresh(m.at,now)&&[m.principalSol,m.feesSol,m.grossSol,m.priceSol,m.networkSol,m.withdrawTaxSol].every(n=>Number.isFinite(n)&&n>=0)&&m.priceSol>0&&Math.abs(m.grossSol-m.principalSol-m.feesSol)<1e-8&&(m.liquidationSol===null||(Number.isFinite(m.liquidationSol)&&m.liquidationSol>=-m.networkSol))&&(m.conversionCostSol===null||Number.isFinite(m.conversionCostSol))&&Number.isInteger(m.epoch)&&m.epoch>=0&&Array.isArray(m.transferFees)&&m.transferFees.every(f=>typeof f.mint==='string'&&Number.isInteger(f.bps)&&f.bps>=0&&f.bps<=10000&&/^\d+$/.test(f.maximumRaw))&&typeof m.waiting==='boolean'&&typeof m.inRange==='boolean';}
export function validFleetHarvest(p:FleetPosition,h:FleetHarvest|undefined,now:number){
 const old=p.harvest;
 if(!h)return !old;
 if(p.arm!=='scalp'||!['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(p.policy?.version||'')||!p.policy?.harvestFees)return false;
 if(JSON.stringify(old)===JSON.stringify(h))return true;
 if(!fleetFresh(h.at,now)||Date.parse(h.at)<Date.parse(p.mark.at)||!Number.isInteger(h.count)||h.count!==(old?.count||0)+1)return false;
 if(![h.bankedSol,h.grossSol,h.taxSol].every(n=>Number.isFinite(n)&&n>=0)||h.bankedSol<=(old?.bankedSol||0)||h.grossSol<=(old?.grossSol||0)||h.taxSol<(old?.taxSol||0)||h.bankedSol>h.grossSol||h.taxSol>h.grossSol)return false;
 if(!Array.isArray(h.counters)||h.counters.length!==p.model.shares.length||new Set(h.counters.map(c=>c.id)).size!==h.counters.length)return false;
 return p.model.shares.every(s=>{const c=h.counters.find(c=>c.id===s.id),prior=old?.counters.find(c=>c.id===s.id)||s;return c&&/^\d+$/.test(c.feeX)&&/^\d+$/.test(c.feeY)&&BigInt(c.feeX)>=BigInt(prior.feeX)&&BigInt(c.feeY)>=BigInt(prior.feeY);});
}
export function advanceFleet(previous:FleetState,snapshot:Snapshot,reads:FleetRead[],now=Date.now(),mode:'full'|'heart'='full'):FleetState{
  if(!fleetCanScan(previous,snapshot,now,mode))return previous;
  const s=structuredClone(previous),plan=fleetPlan(previous,snapshot,now),at=snapshot.updatedAt;
  for(const a of FLEET_ARMS)s.portfolios[a.id]??=freshPortfolio();
  for(const a of FLEET_ARMS)reviewLegacyDataStop(s,a.id,now);
  if(s.version!==FLEET_RULES.version){
    s.ruleChanges=[...(s.ruleChanges||[]),{at,from:s.version,to:FLEET_RULES.version,fromBudgetSol:s.version==='four-wallets-v1'?.5:2,toBudgetSol:FLEET_RULES.budgetSol,fromDailyLimit:s.version==='four-wallets-v5'?96:24,toDailyLimit:96,sizingMode:'pool-sized-v1',fromMaxBins:256,toMaxBins:256,portfolios:Object.fromEntries(FLEET_ARMS.map(a=>[a.id,{equitySol:fleetEquity(previous,a.id,now),closedCount:portfolio(previous,a.id).closedCount,realizedPnlSol:portfolio(previous,a.id).realizedPnlSol}])) as FleetRuleChange['portfolios'],note:'Prospective role-specific v6: ten-minute Heart, immediate Farmer range exit, sustained-volume long holds, pullback bids near the observed low. Prior policies, capital, risk and outcomes retained; no funding reset.'}];
    for(const p of s.positions)p.policy??=fleetPolicy(p.arm,p.experiment||s.version);
    for(const a of FLEET_ARMS){const wallet=s.portfolios[a.id];if(!(wallet.funding||[]).some(f=>f.id===FLEET_FUNDING.id)){const grant=Math.max(0,FLEET_FUNDING.sol-(wallet.seedSol??10));wallet.funding=[...(wallet.funding||[]),{...FLEET_FUNDING,amountSol:grant,priorRisk:{halted:wallet.halted,maxDrawdown:wallet.maxDrawdown,peakSol:wallet.peakSol}}];wallet.cashSol+=grant;wallet.peakSol+=grant;wallet.seedSol=(wallet.seedSol??10)+grant;if(grant>0){wallet.halted=false;wallet.maxDrawdown=0;}}}
    s.version=FLEET_RULES.version;
  }
  for(const a of FLEET_ARMS){const wallet=s.portfolios[a.id];if(wallet.trial?.version!==FLEET_RULES.version)wallet.trial={version:FLEET_RULES.version,startedAt:at,closedCount:0,unscorableCount:0,realizedPnlSol:0};}
  for(const a of FLEET_ARMS)s.portfolios[a.id].unresolvedSol??=(s.portfolios[a.id].unscorableCount||0)*.6;
  s.revision++;s.startedAt??=at;s.lastScanAt=at;s.lastObservationMode=mode;
  if(mode==='full'){s.lastFullScanAt=at;s.memory=plan.memory;s.skips=plan.skips;s.candidates=plan.candidates;s.markets=plan.markets;s.funnel=plan.funnel;s.discoveryHealth=fleetDiscoveryHealth(snapshot,s.markets,now);}
  const day=new Date(now).toISOString().slice(0,10);if(s.day!==day){s.day=day;for(const a of FLEET_ARMS)s.portfolios[a.id].entriesToday=0;}
  s.cooldowns=Object.fromEntries(Object.entries(s.cooldowns).filter(([,until])=>until>now));s.failures=Object.fromEntries(Object.entries(s.failures).filter(([,until])=>until>now));
  const event=(message:string,pair?:string,arm?:FleetArmId,kind:'entry'|'position'='position')=>{const e={at,message,pair,arm};recordFleetDecision(s,e,kind);s.events.push(e);};
  const closed:FleetClosed[]=[],unscorable:FleetUnscorable[]=[];
  const trackIssue=(p:FleetPosition,r:FleetRead|undefined)=>{
    p.issueSince??=at;if(p.pendingExit)p.pendingSince??=at;
    const structural=!!r?.error&&/Liquidity changed beyond the small-share model|Fee counters reset/.test(r.error);
    p.structuralFailures=structural?(p.structuralFailures||0)+1:0;
    const elapsed=Date.parse(at)-Date.parse(p.issueSince);
    // Observed persistent model failure is an unscorable experiment, never a synthetic exit.
    // Transient quote failures get an hour beyond their deadline before retiring a sample.
    if(p.pendingExit&&((p.structuralFailures>=3&&elapsed>=600000)||(elapsed>=3600000&&Date.parse(at)-Date.parse(p.pendingSince||at)>=3600000))){
      unscorable.push({id:p.id,arm:p.arm,experiment:p.experiment,pair:p.pool.pair,poolAddress:p.pool.address,openedAt:p.openedAt,endedAt:at,reason:p.issue||'Accounting unavailable',...fleetSizing(p),allocation:p.allocation,pnlSol:null});
      const a=s.portfolios[p.arm];if(p.experiment===s.version)a.trial!.unscorableCount++;a.unscorableCount=(a.unscorableCount||0)+1;a.unresolvedSol=(a.unresolvedSol||0)+fleetSizing(p).budgetSol+fleetSizing(p).rentSol;
      s.cooldowns[p.arm+':'+p.mint]=now+86400000;
      event('Unscorable trial: '+p.issue+'. No exit value or refund recorded.',p.pool.pair,p.arm);
    }
  };
  for(const p of s.positions){
    if(mode==='heart'&&(p.arm!=='scalp'||!['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(p.experiment||'')))continue;
    const rule=p.policy??fleetPolicy(p.arm,p.experiment||s.version),terms=fleetSizing(p);
    const timeExit=(observedAt:string)=>{
      const elapsed=Date.parse(observedAt)-Date.parse(p.openedAt);
      return rule.maxWaitMinutes>0&&!p.fillObserved&&elapsed>=rule.maxWaitMinutes*60000?`No observed fill after ${rule.maxWaitMinutes} minutes`:elapsed>=rule.maxHoldHours*3600000?`${rule.maxHoldHours*60<60?rule.maxHoldHours*60+'-minute':rule.maxHoldHours+'-hour'} holding limit`:null;
    };
    const r=reads.find(r=>r.positionId===p.id&&r.poolId===p.pool.id&&r.arm===p.arm),oldAt=Date.parse(p.mark.at),wasIssue=p.issue;
    // Range observations have their own clock; a failed quote cannot erase
    // independently observed price/range evidence or turn it into fill value.
    const current=snapshot.pools.find(x=>x.id===p.pool.id),rangeAt=Date.parse(p.exitState?.lastAt||p.mark.at);
    if(!r?.mark||r.error||!validMark(r.mark,now)||Date.parse(r.mark.at)<=oldAt||(p.pendingExit&&p.pendingSince&&Date.parse(r.mark.at)<Date.parse(p.pendingSince))||!validFleetHarvest(p,r.harvest,now)){
      p.issue=r?.error||'Fresh accounting unavailable';
      // Deadlines depend on elapsed time, not a usable inventory/exit quote.
      // Preserve unknown value and locked cash until fresh accounting can settle it.
      const observed=observedExit(p,r,at,current);
      if(!p.pendingExit){p.pendingExit=s.runState==='stopping'?'Stopped by Pat':liquidityExit(p,current,now)||observed||timeExit(at);if(p.pendingExit)event(p.pendingExit+'; exit pending fresh accounting',p.pool.pair,p.arm);}
      trackIssue(p,r);continue;
    }
    const continuous=!wasIssue&&Date.parse(r.mark.at)-oldAt<=FLEET_RULES.maxGapMs;
    if(continuous&&p.mark.inRange&&r.mark.inRange)p.observedInRangeMs+=Date.parse(r.mark.at)-oldAt;
    p.fillObserved=!!p.fillObserved||r.mark.inRange||!r.mark.waiting||r.mark.feesSol>0;
    if(r.harvest)p.harvest=r.harvest;
    p.mark=r.mark;p.issue=r.mark.liquidationSol==null?(r.mark.issue||'Exit quote unavailable'):null;
    const pnl=r.mark.liquidationSol==null?null:r.mark.liquidationSol-terms.budgetSol-terms.entryNetworkSol;
    let conditionalExit:string|null=null;
    if(rule.signalVersion===ROLE_VERSION){const result=roleExit(p.arm,{state:p.exitState||{},at:r.mark.at,openedAt:p.openedAt,netSol:pnl,budgetSol:terms.budgetSol,inRange:r.mark.inRange,priceSol:r.mark.priceSol,entryPriceSol:p.entryReferenceSol,fillObserved:p.fillObserved,current,entryPool:p.pool,entrySignal:p.entrySignal,continuous:Date.parse(r.mark.at)-rangeAt<=FLEET_RULES.maxGapMs});p.exitState=result.state;conditionalExit=result.reason;}
    else if(['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(rule.version)&&pnl!=null&&!p.issue){const result=signalExit(p.arm,{state:p.exitState||{},at:r.mark.at,openedAt:p.openedAt,netSol:pnl,budgetSol:terms.budgetSol,inRange:r.mark.inRange,priceSol:r.mark.priceSol,current,entryPool:p.pool,entrySignal:p.entrySignal,continuous});p.exitState=result.state;conditionalExit=result.reason;}
    if(p.arm==='scalp'&&rule.rangeBins===9&&!r.mark.inRange)conditionalExit??='Heart Attack left its nine-bin range';
    p.pendingExit??=s.runState==='stopping'?'Stopped by Pat':liquidityExit(p,current,now)||(pnl!=null&&pnl/terms.budgetSol<=rule.stopLoss?`${Math.round(-rule.stopLoss*100)}% net loss limit`:pnl!=null&&pnl/terms.budgetSol>=rule.takeProfit?`${Math.round(rule.takeProfit*100)}% net profit target`:conditionalExit||timeExit(p.mark.at));
    if(p.issue)trackIssue(p,r);else{delete p.issueSince;p.structuralFailures=0;}
    if(p.pendingExit&&p.mark.liquidationSol!=null&&!p.issue){
      const c:FleetClosed={...terms,allocation:p.allocation,harvest:p.harvest,entrySignal:p.entrySignal,exitState:p.exitState,policy:rule,entryCosts:p.entryCosts,exitTransferFees:p.mark.transferFees,fillObserved:p.fillObserved,entryReferenceSol:p.entryReferenceSol,bidStartSol:p.bidStartSol,bidEndSol:p.bidEndSol,id:p.id,experiment:p.experiment||s.version,cohort:p.cohort,arm:p.arm,pair:p.pool.pair,poolAddress:p.pool.address,openedAt:p.openedAt,closedAt:p.mark.at,pnlSol:pnl!,exitSol:p.mark.liquidationSol,feesSol:p.mark.feesSol,withdrawTaxSol:p.mark.withdrawTaxSol,reason:p.pendingExit,observedInRangeMs:p.observedInRangeMs};
      closed.push(c);const a=s.portfolios[p.arm];if(!isSample(p.arm))a.cashSol+=c.exitSol+terms.rentSol;a.realizedPnlSol+=c.pnlSol;a.closedCount++;if(c.experiment===s.version){a.trial!.realizedPnlSol+=c.pnlSol;a.trial!.closedCount++;}if(c.pnlSol>0)a.wins++;else if(c.pnlSol<0)a.losses++;
      event(c.reason,p.pool.pair,p.arm);s.cooldowns[p.arm+':'+p.mint]=now+rule.cooldownMs;
    }
  }
  s.positions=s.positions.filter(p=>!closed.some(c=>c.id===p.id)&&!unscorable.some(c=>c.id===p.id));s.closed.push(...closed);s.unscorable=[...(s.unscorable||[]),...unscorable];
  const updateRisk=()=>{for(const arm of FLEET_ARMS){const a=s.portfolios[arm.id];
    reviewLegacyDataStop(s,arm.id,now);
    // Missing value still contributes zero: no guessed price or cash refund.
    // Incomplete valuations pause entries until the current conservative check
    // clears; only a fully valued breach permanently latches a new loss stop.
    const risk=fleetRisk(s,arm.id,now);
    a.peakSol=Math.max(a.peakSol,risk.knownEquitySol);a.maxDrawdown=Math.max(a.maxDrawdown,risk.drawdown);
    a.riskDataHold=risk.incomplete&&risk.drawdown>=FLEET_RULES.maxDrawdown;
    if(!risk.incomplete&&risk.drawdown>=FLEET_RULES.maxDrawdown){a.halted=true;a.confirmedHaltAt??=at;}
  }};
  updateRisk();
  const eligible=new Set(mode==='heart'?[]:plan.eligible.map(p=>p.id));
  // All successful arms for one chosen pool have the same cohort timestamp; failures remain visible.
  const chosen=new Set([...new Set(reads.filter(r=>!r.positionId&&eligible.has(r.poolId)).map(r=>r.poolId))].slice(0,ALLOCATION_LIMITS.maxPoolsPerScan));
  const attempted=new Set<string>();
  for(const r of reads.filter(r=>!r.positionId&&chosen.has(r.poolId))){
    const attemptKey=r.arm+':'+r.poolId;if(attempted.has(attemptKey))continue;attempted.add(attemptKey);
    if(!FLEET_ARMS.some(a=>a.id===r.arm)||!plan.allowedArms[r.poolId]?.includes(r.arm))continue;
    (s.lastEntryCheckAt??={})[r.arm]=at;
    const counts=s.funnel![r.arm]!;counts.checked++;const trial=s.portfolios[r.arm].trial!;trial.checks=(trial.checks||0)+1;
    if(r.error){const provider=/rate.limit|429|Provider cooldown|read budget|timeout|fetch failed/i.test(r.error);if(provider){counts.providerBlocked++;trial.providerBlocked=(trial.providerBlocked||0)+1;}else{counts.modelRejected++;trial.modelRejected=(trial.modelRejected||0)+1;}event(r.error,snapshot.pools.find(p=>p.id===r.poolId)?.pair,r.arm,'entry');s.failures[r.arm+':'+r.poolId]=now+(provider?240000:900000);continue;}
    const p=r.entry,source=snapshot.pools.find(x=>x.id===r.poolId);
    if(!p||!source||p.experiment!==FLEET_RULES.version||!validAllocation(p.allocation,p.budgetSol!,allocationRequest(r.arm,previous.portfolios[r.arm].cashSol,plan.signals[r.poolId]?.[r.arm]),s.portfolios[r.arm].cashSol)||p.rentSol!==FLEET_RULES.rentSol||p.entryNetworkSol!==FLEET_RULES.networkSol||p.pool.address!==source.address||p.pool.base.address!==source.base.address||p.pool.quote.address!==source.quote.address||p.cohort!==`${source.address}:${snapshot.updatedAt}`||p.id!==`fleet:${r.arm}:${p.cohort}`||!fleetFresh(p.openedAt,now)||p.pendingExit||p.observedInRangeMs!==0||p.mark.liquidationSol===null||p.mark.liquidationSol-FLEET_RULES.networkSol<p.budgetSol!*(1-fleetPolicy(r.arm).maxInitialCost)||p.arm!==r.arm||p.pool.id!==r.poolId||p.mint!==(p.pool.base.address===SOL?p.pool.quote.address:p.pool.base.address)||!validMark(p.mark,now)||p.mark.liquidationSol==null||p.issue||!Number.isFinite(p.dustSol)||p.dustSol<0||p.dustSol>0.000001||!p.model.shares.length||!fleetCanEnter(s,r.arm,now)||s.positions.some(x=>x.arm===r.arm&&x.mint===p.mint)||cooling(s,r.arm,p.mint,now)){counts.modelRejected++;trial.modelRejected=(trial.modelRejected||0)+1;event('Entry no longer fits the current budget, capacity or quote checks',source?.pair,r.arm,'entry');continue;}
    (s.lastSuccessfulEntryCheckAt??={})[r.arm]=p.mark.at;
    counts.entered++;p.entrySignal=plan.signals[r.poolId][r.arm];p.experiment=FLEET_RULES.version;p.policy={...fleetPolicy(p.arm),down:p.allocation!.down,offset:p.allocation!.offset,rangeBins:p.allocation!.rangeBins};s.positions.push(p);const a=s.portfolios[r.arm];if(!isSample(r.arm))a.cashSol-=p.budgetSol!+FLEET_RULES.rentSol+FLEET_RULES.networkSol;a.entriesToday++;trial.entries=(trial.entries||0)+1;trial.deployedSol=(trial.deployedSol||0)+p.budgetSol!;if(p.allocation!.acceptedSol<p.allocation!.targetSol)trial.resized=(trial.resized||0)+1;
    event(`Opened ${p.budgetSol!.toFixed(3)} SOL · ${p.allocation!.limitedBy} · `+(FLEET_ARMS.find(a=>a.id===r.arm)!.twoSided?'two-sided liquidity':'SOL-only bids'),p.pool.pair,p.arm,'entry');
  }
  if(s.runState==='stopping'&&!s.positions.length)s.runState='stopped';
  updateRisk();s.events=s.events.slice(-100);return s;
}
export function controlFleet(s:FleetState,action:string,now=Date.now()):FleetState{
  if(!['pause','resume','stop'].includes(action))throw Error('Unknown fleet control');
  const n=structuredClone(s);n.revision++;n.runState=action==='pause'?'paused':action==='stop'?(n.positions.length?'stopping':'stopped'):'running';
  if(action==='stop')for(const p of n.positions)p.pendingExit??='Stopped by Pat';
  n.events.push({at:new Date(now).toISOString(),message:`Fleet ${action}; balances and outcomes retained`});n.events=n.events.slice(-100);return n;
}
export function fleetSummary(s:FleetState,now=Date.now()){
  const {memory,markets,marketShards,failures,cooldowns,portfolios,...visible}=s;
  return {...visible,fundingReference:FLEET_FUNDING,unscorable:(s.unscorable||[]).slice(-40).reverse(),rules:FLEET_RULES,allocationLimits:ALLOCATION_LIMITS,arms:FLEET_ARMS.map(a=>({...a,...portfolio(s,a.id),mode:'paper-wallet',seedSol:fleetSeed(s,a.id),unresolvedSol:portfolio(s,a.id).unresolvedSol??(portfolio(s,a.id).unscorableCount||0)*.6,committedSol:s.positions.filter(p=>p.arm===a.id).reduce((n,p)=>n+fleetSizing(p).budgetSol+fleetSizing(p).rentSol,0),currentTrial:fleetTrial(s,a.id,now),active:(s.entryProfiles||ACTIVE_FLEET_PROFILES).includes(a.id),policy:fleetPolicy(a.id),equitySol:fleetEquity(s,a.id,now),withdrawnSol:portfolio(s,a.id).withdrawnSol??0,performanceEquitySol:fleetEquity(s,a.id,now)===null?null:fleetEquity(s,a.id,now)!+(portfolio(s,a.id).withdrawnSol??0),entryAllowed:fleetCanEnter(s,a.id,now),entryReason:fleetEntryReason(s,a.id,now),activity:fleetArmActivity(s,a.id,fleetEntryReason(s,a.id,now),now),entriesToday:s.day===new Date(now).toISOString().slice(0,10)?portfolio(s,a.id).entriesToday:0})),events:s.events.slice(-15).reverse(),closed:s.closed.slice(-30).reverse(),positions:s.positions.map(({model,...p})=>({...p,policy:p.policy??fleetPolicy(p.arm,p.experiment||s.version),...fleetSizing(p),model:{lowerBin:model.lowerBin,upperBin:model.upperBin},pnlSol:p.issue||!fleetFresh(p.mark.at,now)||p.mark.liquidationSol==null?null:p.mark.liquidationSol-fleetSizing(p).budgetSol-fleetSizing(p).entryNetworkSol}))};
}

export function fleetTrial(s:FleetState,arm:FleetArmId,now=Date.now()){
 const trial=s.portfolios[arm].trial,positions=s.positions.filter(p=>p.arm===arm&&p.experiment===s.version);
 const incomplete=!!trial?.unscorableCount||positions.some(p=>p.issue||!fleetFresh(p.mark.at,now)||p.mark.liquidationSol==null);
 return {...trial,version:s.version,openCount:positions.length,netSol:incomplete?null:(trial?.realizedPnlSol||0)+positions.reduce((n,p)=>n+p.mark.liquidationSol!-fleetSizing(p).budgetSol-fleetSizing(p).entryNetworkSol,0)};
}
