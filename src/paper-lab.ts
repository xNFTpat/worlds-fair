import type {Pool,Snapshot} from './schema';
import type {PaperModel,PaperMark,PaperDiagnostics} from './paper-model';

// Independent, prospectively declared experiments. Never imports or rewrites baseline state.
export const LAB_RULES=Object.freeze({version:'paper-experiments-v4',seedSol:1,budgetSol:.2,rentSol:.1,networkSol:.0001,slippageBps:100,maxBins:256,maxOpen:2,maxDailyEntries:24,minTvl:10000,minFees1h:1000,minVolume30m:5000,minAgeHours:1,maxAgeHours:72,confirmations:3,minScanMs:240000,maxGapMs:600000,stopLoss:-.15,takeProfit:.2,maxHoldHours:8,maxDrawdown:.25,cooldownMs:3600000});
export const LAB_ARMS=[
  {id:'spot-down50',name:'Spot · down 50%',shape:'Spot',down:.5,offset:0,group:'range'},
  {id:'bidask-down50',name:'Bid-Ask · down 50%',shape:'BidAsk',down:.5,offset:0,group:'range'},
  {id:'bidask-down80',name:'Bid-Ask · down 80%',shape:'BidAsk',down:.8,offset:0,group:'range'},
  {id:'launch-scalp',name:'Launch scalp',shape:'BidAsk',down:.25,offset:.08,group:'launch'},
  {id:'launch-bidask',name:'Degen launch bids',shape:'BidAsk',down:.8,offset:.08,group:'launch'},
  {id:'longer-spot',name:'Longer hold',shape:'Spot',down:.25,offset:0,group:'longer'},
  {id:'scalp-v4',name:'Launch scalp',shape:'BidAsk',down:.25,offset:.08,group:'scalp'},
  {id:'hold-v4',name:'Longer hold',shape:'Spot',down:.25,offset:0,group:'hold'},
  {id:'pullback-v4',name:'Pullback bids',shape:'BidAsk',down:.5,offset:.08,group:'pullback'},
] as const;
export const ACTIVE_LAB_PROFILES:LabArmId[]=['scalp-v4','hold-v4','pullback-v4'];
export const isSample=(arm:LabArmId)=>ACTIVE_LAB_PROFILES.includes(arm);
export type LabArmId=typeof LAB_ARMS[number]['id'];
// All choices are declared before future observations; no model-driven rule changes.
export function labPolicy(id:LabArmId){
  const arm=LAB_ARMS.find(a=>a.id===id)!;
  if(isSample(id))return {...LAB_RULES,maxOpen:2,maxWaitMinutes:id==='scalp-v4'?20:id==='pullback-v4'?120:0,
    minAgeHours:id==='scalp-v4'?5/60:id==='hold-v4'?168:4,maxAgeHours:id==='scalp-v4'?2:id==='hold-v4'?87600:168,
    minTvl:id==='scalp-v4'?10000:id==='hold-v4'?100000:25000,minFees1h:id==='scalp-v4'?1000:100,minVolume30m:10000,
    confirmations:id==='scalp-v4'?2:3,maxHoldHours:id==='scalp-v4'?.75:id==='hold-v4'?48:8,
    stopLoss:id==='scalp-v4'?-.08:id==='hold-v4'?-.1:-.15,takeProfit:id==='scalp-v4'?.05:.15,offset:arm.offset,down:arm.down};
  const entry=arm.group==='launch'?{minAgeHours:5/60,maxAgeHours:2,minVolume30m:10000,confirmations:2}:arm.group==='longer'?{minAgeHours:168,maxAgeHours:87600,minTvl:100000,minFees1h:100,minVolume30m:10000}:{};
  const exit=id==='launch-scalp'?{maxOpen:1,maxHoldHours:.75,maxWaitMinutes:20,stopLoss:-.08,takeProfit:.05}:id==='launch-bidask'?{maxOpen:1,maxHoldHours:4,maxWaitMinutes:30,stopLoss:-.2,takeProfit:.1}:id==='longer-spot'?{maxOpen:1,maxHoldHours:48,stopLoss:-.1,takeProfit:.15}:{};
  return {...LAB_RULES,maxWaitMinutes:0,...entry,...exit,offset:arm.offset,down:arm.down};
}
const freshPortfolio=():LabPortfolio=>({cashSol:LAB_RULES.seedSol,realizedPnlSol:0,closedCount:0,wins:0,losses:0,peakSol:LAB_RULES.seedSol,maxDrawdown:0,halted:false,entriesToday:0});
const portfolio=(s:LabState,id:LabArmId)=>s.portfolios[id]||freshPortfolio();
const cooling=(s:LabState,arm:LabArmId,mint:string,now:number)=>(s.cooldowns[arm+':'+mint]||s.cooldowns[mint]||0)>now;
const SOL='So11111111111111111111111111111111111111112';
export interface LabMark extends PaperMark {waiting:boolean;withdrawTaxSol:number;epoch:number;transferFees:{mint:string;bps:number;maximumRaw:string}[]}
export interface LabPosition {id:string;experiment?:string;cohort:string;arm:LabArmId;pool:Pool;mint:string;openedAt:string;model:PaperModel;dustSol:number;mark:LabMark;issue:string|null;issueSince?:string;pendingSince?:string;structuralFailures?:number;pendingExit:string|null;observedInRangeMs:number;fillObserved?:boolean;entryReferenceSol?:number;bidStartSol?:number;bidEndSol?:number}
export interface LabClosed {fillObserved?:boolean;entryReferenceSol?:number;bidStartSol?:number;bidEndSol?:number;id:string;experiment?:string;cohort:string;arm:LabArmId;pair:string;poolAddress:string;openedAt:string;closedAt:string;pnlSol:number;exitSol:number;feesSol:number;withdrawTaxSol:number;reason:string;observedInRangeMs:number}
export interface LabRead {poolId:string;arm:LabArmId;positionId?:string;entry?:LabPosition;mark?:LabMark;error?:string;diagnostics?:PaperDiagnostics}
export interface LabPortfolio {unscorableCount?:number;cashSol:number;realizedPnlSol:number;closedCount:number;wins:number;losses:number;peakSol:number;maxDrawdown:number;halted:boolean;entriesToday:number}
export interface LabRuleChange {at:string;from:string;to:string;fromDailyLimit:number;toDailyLimit:number;fromMaxBins:number;toMaxBins:number;portfolios:Record<LabArmId,{equitySol:number|null;closedCount:number;realizedPnlSol:number}>;profilesAdded?:LabArmId[];note?:string}
export interface LabUnscorable {id:string;arm:LabArmId;experiment?:string;pair:string;poolAddress:string;openedAt:string;endedAt:string;reason:string;budgetSol:number;pnlSol:null}
export interface LabState {entryProfiles?:LabArmId[];unscorable?:LabUnscorable[];version:string;ruleChanges?:LabRuleChange[];revision:number;runState:'running'|'paused'|'stopping'|'stopped';startedAt:string|null;lastScanAt:string|null;day:string;portfolios:Record<LabArmId,LabPortfolio>;positions:LabPosition[];closed:LabClosed[];memory:Record<string,{at:string;streak:number}>;cooldowns:Record<string,number>;failures:Record<string,number>;candidates:{poolId:string;pair:string;streak:number;fees1h:number;group?:string;arms?:LabArmId[];confirmations?:number;reason?:string}[];skips:Record<string,number>;events:{at:string;message:string;pair?:string;arm?:LabArmId}[]}
export const labFresh=(at:string|null,now:number)=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=LAB_RULES.maxGapMs;
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function initialLabState():LabState{return {version:LAB_RULES.version,entryProfiles:[...ACTIVE_LAB_PROFILES],unscorable:[],revision:0,runState:'running',startedAt:null,lastScanAt:null,day:'',portfolios:Object.fromEntries(LAB_ARMS.map(a=>[a.id,freshPortfolio()])) as LabState['portfolios'],positions:[],closed:[],memory:{},cooldowns:{},failures:{},candidates:[],skips:{},events:[]};}
export function labCanScan(s:LabState,snapshot:Snapshot,now=Date.now()){return [LAB_RULES.version,'paper-styles-v3','downside-lab-v1','downside-lab-v2'].includes(s.version)&&labFresh(snapshot.updatedAt,now)&&(!s.lastScanAt||Date.parse(snapshot.updatedAt)-Date.parse(s.lastScanAt)>=LAB_RULES.minScanMs);}
export function labEquity(s:LabState,arm:LabArmId,now=Date.now()):number|null{
  if(isSample(arm)||portfolio(s,arm).unscorableCount)return null;
  const positions=s.positions.filter(p=>p.arm===arm);
  if(positions.some(p=>p.issue||!labFresh(p.mark.at,now)||p.mark.liquidationSol==null))return null;
  return portfolio(s,arm).cashSol+positions.reduce((sum,p)=>sum+p.mark.liquidationSol!+LAB_RULES.rentSol,0);
}
export function labEntryReason(s:LabState,arm:LabArmId,now=Date.now()):string|null{
  const a=portfolio(s,arm),rule=labPolicy(arm),same=s.day===new Date(now).toISOString().slice(0,10);
  if(s.runState!=='running')return 'Entries paused or stopped';
  if(!(s.entryProfiles||ACTIVE_LAB_PROFILES).includes(arm))return 'Archived trial · no new entries';
  if(!isSample(arm)&&a.halted)return '25% drawdown limit reached';
  if(!isSample(arm)&&labEquity(s,arm,now)==null)return 'Waiting for fresh position accounting';
  if(s.positions.filter(p=>p.arm===arm).length>=rule.maxOpen)return 'This trial is at its open-position limit';
  if(same&&a.entriesToday>=rule.maxDailyEntries)return '24-entry daily ceiling reached; resets at midnight UTC';
  if(!isSample(arm)&&a.cashSol<rule.budgetSol+rule.rentSol+rule.networkSol+.1)return 'Insufficient virtual SOL after account and cash reserves';
  return null;
}
export const labCanEnter=(s:LabState,arm:LabArmId,now=Date.now())=>labEntryReason(s,arm,now)===null;
export function labPlan(s:LabState,snapshot:Snapshot,now=Date.now()){
  const memory:LabState['memory']={},skips:Record<string,number>={},candidates:LabState['candidates']=[],allowedArms:Record<string,LabArmId[]>={};
  const groups=['range','launch','longer','scalp','hold','pullback'] as const;
  for(const group of groups){
    const members=LAB_ARMS.filter(a=>a.group===group&&(s.entryProfiles||ACTIVE_LAB_PROFILES).includes(a.id));if(!members.length)continue;const rule=labPolicy(members[0].id),skip=(why:string)=>{const key=group+' · '+why;skips[key]=(skips[key]||0)+1;};
    for(const p of snapshot.pools){
      if(p.chain!=='solana'||p.venue!=='meteora-dlmm'||(p.base.address===SOL)===(p.quote.address===SOL))continue;
      if(!labFresh(p.fetchedAt,now)){skip('Source is stale');continue;}
      if(!positive(p.tvlUsd)||p.tvlUsd<rule.minTvl){skip('Below liquidity threshold');continue;}
      if(!positive(p.ageHours)||p.ageHours<rule.minAgeHours||p.ageHours>rule.maxAgeHours){skip('Outside pool-age window');continue;}
      if(!positive(p.activity?.fees1h)||p.activity.fees1h<rule.minFees1h||!positive(p.activity.volume30m)||p.activity.volume30m<rule.minVolume30m){skip('Reported fees or 30m volume below threshold');continue;}
      const mint=p.base.address===SOL?p.quote.address:p.base.address;
      const arms=members.filter(a=>!s.positions.some(x=>x.arm===a.id&&x.mint===mint)&&!cooling(s,a.id,mint,now)).map(a=>a.id);
      if(!arms.length){skip('Already held or cooling down in these trials');continue;}
      const key=group==='range'?p.id:group+':'+p.id,old=s.memory[key],gap=old?Date.parse(p.fetchedAt)-Date.parse(old.at):Infinity;
      const streak=old&&gap>=0&&gap<rule.minScanMs?old.streak:old&&gap>=rule.minScanMs&&gap<=rule.maxGapMs?Math.min(rule.confirmations,old.streak+1):1;
      memory[key]={at:old&&gap>=0&&gap<rule.minScanMs?old.at:p.fetchedAt,streak};
      const checked=arms.filter(arm=>(s.failures[arm+':'+p.id]||s.failures[p.id]||0)<=now);
      const reason=!checked.length?'Recent accounting check failed; 15-minute cooldown':streak<rule.confirmations?`${streak} of ${rule.confirmations} fresh activity checks`:'Activity confirmed; waiting for an available trial and accounting check';
      candidates.push({poolId:p.id,pair:p.pair,streak,fees1h:p.activity.fees1h,group,arms,confirmations:rule.confirmations,reason});
      if(streak>=rule.confirmations&&checked.length)allowedArms[p.id]=[...new Set([...(allowedArms[p.id]||[]),...checked])];
    }
  }
  candidates.sort((a,b)=>b.fees1h-a.fees1h||a.poolId.localeCompare(b.poolId));
  const eligible=snapshot.pools.filter(p=>allowedArms[p.id]?.length).sort((a,b)=>b.activity!.fees1h!-a.activity!.fees1h!||a.id.localeCompare(b.id));
  // Keep a small visible shortlist per selection family, so launch activity cannot hide longer-hold ideas.
  return {memory,skips,candidates:groups.flatMap(group=>candidates.filter(c=>c.group===group).slice(0,3)),eligible,allowedArms};
}
function validMark(m:LabMark,now:number){return labFresh(m.at,now)&&[m.principalSol,m.feesSol,m.grossSol,m.priceSol,m.networkSol,m.withdrawTaxSol].every(n=>Number.isFinite(n)&&n>=0)&&m.priceSol>0&&Math.abs(m.grossSol-m.principalSol-m.feesSol)<1e-8&&(m.liquidationSol===null||(Number.isFinite(m.liquidationSol)&&m.liquidationSol>=-m.networkSol))&&(m.conversionCostSol===null||Number.isFinite(m.conversionCostSol))&&Number.isInteger(m.epoch)&&m.epoch>=0&&Array.isArray(m.transferFees)&&m.transferFees.every(f=>typeof f.mint==='string'&&Number.isInteger(f.bps)&&f.bps>=0&&f.bps<=10000&&/^\d+$/.test(f.maximumRaw))&&typeof m.waiting==='boolean'&&typeof m.inRange==='boolean';}
export function advanceLab(previous:LabState,snapshot:Snapshot,reads:LabRead[],now=Date.now()):LabState{
  if(!labCanScan(previous,snapshot,now))return previous;
  const s=structuredClone(previous),plan=labPlan(previous,snapshot,now),at=snapshot.updatedAt;
  for(const a of LAB_ARMS)s.portfolios[a.id]??=freshPortfolio();
  s.revision++;s.startedAt??=at;s.lastScanAt=at;s.memory=plan.memory;s.skips=plan.skips;s.candidates=plan.candidates;
  const day=new Date(now).toISOString().slice(0,10);if(s.day!==day){s.day=day;for(const a of LAB_ARMS)s.portfolios[a.id].entriesToday=0;}
  s.cooldowns=Object.fromEntries(Object.entries(s.cooldowns).filter(([,until])=>until>now));s.failures=Object.fromEntries(Object.entries(s.failures).filter(([,until])=>until>now));
  const event=(message:string,pair?:string,arm?:LabArmId)=>s.events.push({at,message,pair,arm});
  if(s.version!==LAB_RULES.version){
    const from=s.version;s.entryProfiles=[...ACTIVE_LAB_PROFILES];
    s.ruleChanges=[...(s.ruleChanges||[]),{at,from,to:LAB_RULES.version,profilesAdded:LAB_ARMS.filter(a=>!previous.portfolios[a.id]).map(a=>a.id),note:'New independent 0.2 SOL samples: launch scalp, longer hold and established-pool pullbacks. Six earlier wallets archived for new entries; existing positions keep their exit rules. Unknown outcomes are recorded as unscorable, never gains or refunds.',fromDailyLimit:from==='downside-lab-v1'?12:24,toDailyLimit:LAB_RULES.maxDailyEntries,fromMaxBins:from==='downside-lab-v1'?200:256,toMaxBins:LAB_RULES.maxBins,portfolios:Object.fromEntries(LAB_ARMS.map(a=>[a.id,{equitySol:labEquity(previous,a.id,now),closedCount:s.portfolios[a.id].closedCount,realizedPnlSol:s.portfolios[a.id].realizedPnlSol}])) as LabRuleChange['portfolios']}];
    for(const p of s.positions)p.experiment??=from;
    s.version=LAB_RULES.version;
    event('Independent sample trials started. Earlier wallets, balances and results retained; no further entries in archived profiles.');
  }
  const closed:LabClosed[]=[],unscorable:LabUnscorable[]=[];
  const trackIssue=(p:LabPosition,r:LabRead|undefined)=>{
    p.issueSince??=at;if(p.pendingExit)p.pendingSince??=at;
    const structural=!!r?.error&&/Liquidity changed beyond the small-share model|Fee counters reset/.test(r.error);
    p.structuralFailures=structural?(p.structuralFailures||0)+1:0;
    const elapsed=Date.parse(at)-Date.parse(p.issueSince);
    // Observed persistent model failure is an unscorable experiment, never a synthetic exit.
    // Transient quote failures get an hour beyond their deadline before retiring a sample.
    if(p.pendingExit&&((p.structuralFailures>=3&&elapsed>=600000)||(isSample(p.arm)&&elapsed>=3600000&&Date.parse(at)-Date.parse(p.pendingSince||at)>=3600000))){
      unscorable.push({id:p.id,arm:p.arm,experiment:p.experiment,pair:p.pool.pair,poolAddress:p.pool.address,openedAt:p.openedAt,endedAt:at,reason:p.issue||'Accounting unavailable',budgetSol:LAB_RULES.budgetSol,pnlSol:null});
      const a=s.portfolios[p.arm];a.unscorableCount=(a.unscorableCount||0)+1;
      s.cooldowns[p.arm+':'+p.mint]=now+86400000;
      event('Unscorable trial: '+p.issue+'. No exit value or refund recorded.',p.pool.pair,p.arm);
    }
  };
  for(const p of s.positions){
    const rule=labPolicy(p.arm);
    const timeExit=(observedAt:string)=>{
      const elapsed=Date.parse(observedAt)-Date.parse(p.openedAt);
      return rule.maxWaitMinutes>0&&!p.fillObserved&&elapsed>=rule.maxWaitMinutes*60000?`No observed fill after ${rule.maxWaitMinutes} minutes`:elapsed>=rule.maxHoldHours*3600000?`${rule.maxHoldHours*60<60?rule.maxHoldHours*60+'-minute':rule.maxHoldHours+'-hour'} holding limit`:null;
    };
    const r=reads.find(r=>r.positionId===p.id&&r.poolId===p.pool.id&&r.arm===p.arm),oldAt=Date.parse(p.mark.at),wasIssue=p.issue;
    if(!r?.mark||r.error||!validMark(r.mark,now)||Date.parse(r.mark.at)<=oldAt){
      p.issue=r?.error||'Fresh accounting unavailable';
      // Deadlines depend on elapsed time, not a usable inventory/exit quote.
      // Preserve unknown value and locked cash until fresh accounting can settle it.
      if(!p.pendingExit){p.pendingExit=timeExit(at);if(p.pendingExit)event(p.pendingExit+'; exit pending fresh accounting',p.pool.pair,p.arm);}
      trackIssue(p,r);continue;
    }
    const continuous=!wasIssue&&Date.parse(r.mark.at)-oldAt<=LAB_RULES.maxGapMs;
    if(continuous&&p.mark.inRange&&r.mark.inRange)p.observedInRangeMs+=Date.parse(r.mark.at)-oldAt;
    p.fillObserved=!!p.fillObserved||r.mark.inRange||!r.mark.waiting||r.mark.feesSol>0;
    p.mark=r.mark;p.issue=r.mark.liquidationSol==null?(r.mark.issue||'Exit quote unavailable'):null;
    const pnl=r.mark.liquidationSol==null?null:r.mark.liquidationSol-LAB_RULES.budgetSol-LAB_RULES.networkSol;
    const current=snapshot.pools.find(x=>x.id===p.pool.id);
    p.pendingExit??=s.runState==='stopping'?'Stopped by Pat':current&&labFresh(current.fetchedAt,now)&&positive(current.tvlUsd)&&current.tvlUsd<p.pool.tvlUsd!*.7?'Liquidity fell 30%':pnl!=null&&pnl/LAB_RULES.budgetSol<=rule.stopLoss?`${Math.round(-rule.stopLoss*100)}% net loss limit`:pnl!=null&&pnl/LAB_RULES.budgetSol>=rule.takeProfit?`${Math.round(rule.takeProfit*100)}% net profit target`:timeExit(p.mark.at);
    if(p.issue)trackIssue(p,r);else{delete p.issueSince;p.structuralFailures=0;}
    if(p.pendingExit&&p.mark.liquidationSol!=null&&!p.issue){
      const c:LabClosed={fillObserved:p.fillObserved,entryReferenceSol:p.entryReferenceSol,bidStartSol:p.bidStartSol,bidEndSol:p.bidEndSol,id:p.id,experiment:p.experiment||s.version,cohort:p.cohort,arm:p.arm,pair:p.pool.pair,poolAddress:p.pool.address,openedAt:p.openedAt,closedAt:p.mark.at,pnlSol:pnl!,exitSol:p.mark.liquidationSol,feesSol:p.mark.feesSol,withdrawTaxSol:p.mark.withdrawTaxSol,reason:p.pendingExit,observedInRangeMs:p.observedInRangeMs};
      closed.push(c);const a=s.portfolios[p.arm];if(!isSample(p.arm))a.cashSol+=c.exitSol+LAB_RULES.rentSol;a.realizedPnlSol+=c.pnlSol;a.closedCount++;if(c.pnlSol>0)a.wins++;else if(c.pnlSol<0)a.losses++;
      event(c.reason,p.pool.pair,p.arm);s.cooldowns[p.arm+':'+p.mint]=now+LAB_RULES.cooldownMs;
    }
  }
  s.positions=s.positions.filter(p=>!closed.some(c=>c.id===p.id)&&!unscorable.some(c=>c.id===p.id));s.closed.push(...closed);s.unscorable=[...(s.unscorable||[]),...unscorable];
  const updateRisk=()=>{for(const arm of LAB_ARMS){const a=s.portfolios[arm.id],equity=labEquity(s,arm.id,now);if(equity!=null){a.peakSol=Math.max(a.peakSol,equity);a.maxDrawdown=Math.max(a.maxDrawdown,1-equity/a.peakSol);if(a.maxDrawdown>=LAB_RULES.maxDrawdown)a.halted=true;}}};
  updateRisk();
  const eligible=new Set(plan.eligible.map(p=>p.id));
  // All successful arms for one chosen pool have the same cohort timestamp; failures remain visible.
  const chosen=reads.find(r=>!r.positionId&&eligible.has(r.poolId))?.poolId;
  for(const r of reads.filter(r=>!r.positionId&&r.poolId===chosen)){
    if(!LAB_ARMS.some(a=>a.id===r.arm)||!plan.allowedArms[r.poolId]?.includes(r.arm))continue;
    if(r.error){event(r.error,snapshot.pools.find(p=>p.id===r.poolId)?.pair,r.arm);s.failures[r.arm+':'+r.poolId]=now+900000;continue;}
    const p=r.entry,source=snapshot.pools.find(x=>x.id===r.poolId);
    if(!p||!source||p.pool.address!==source.address||p.pool.base.address!==source.base.address||p.pool.quote.address!==source.quote.address||p.cohort!==`${source.address}:${snapshot.updatedAt}`||p.id!==`lab:${r.arm}:${p.cohort}`||!labFresh(p.openedAt,now)||p.pendingExit||p.observedInRangeMs!==0||p.mark.liquidationSol===null||p.mark.liquidationSol-LAB_RULES.networkSol<LAB_RULES.budgetSol*.95||p.arm!==r.arm||p.pool.id!==r.poolId||p.mint!==(p.pool.base.address===SOL?p.pool.quote.address:p.pool.base.address)||!validMark(p.mark,now)||p.mark.liquidationSol==null||p.issue||!Number.isFinite(p.dustSol)||p.dustSol<0||p.dustSol>0.000001||!p.model.shares.length||!labCanEnter(s,r.arm,now)||s.positions.some(x=>x.arm===r.arm&&x.mint===p.mint)||cooling(s,r.arm,p.mint,now))continue;
    p.experiment=LAB_RULES.version;s.positions.push(p);const a=s.portfolios[r.arm];if(!isSample(r.arm))a.cashSol-=LAB_RULES.budgetSol+LAB_RULES.rentSol+LAB_RULES.networkSol;a.entriesToday++;
    event('Opened SOL-only paper bids',p.pool.pair,p.arm);
  }
  if(s.runState==='stopping'&&!s.positions.length)s.runState='stopped';
  updateRisk();s.events=s.events.slice(-100);return s;
}
export function controlLab(s:LabState,action:string,now=Date.now()):LabState{
  if(!['pause','resume','stop'].includes(action))throw Error('Unknown lab control');
  const n=structuredClone(s);n.revision++;n.runState=action==='pause'?'paused':action==='stop'?(n.positions.length?'stopping':'stopped'):'running';
  if(action==='stop')for(const p of n.positions)p.pendingExit??='Stopped by Pat';
  n.events.push({at:new Date(now).toISOString(),message:`Lab ${action}; balances and outcomes retained`});n.events=n.events.slice(-100);return n;
}
export function labSummary(s:LabState,now=Date.now()){
  const {memory,failures,cooldowns,portfolios,...visible}=s;
  return {...visible,unscorable:(s.unscorable||[]).slice(-40).reverse(),rules:LAB_RULES,arms:LAB_ARMS.map(a=>({...a,...portfolio(s,a.id),mode:isSample(a.id)?'independent-samples':'archived-wallet',active:(s.entryProfiles||ACTIVE_LAB_PROFILES).includes(a.id),policy:labPolicy(a.id),equitySol:labEquity(s,a.id,now),entryAllowed:labCanEnter(s,a.id,now),entryReason:labEntryReason(s,a.id,now),entriesToday:s.day===new Date(now).toISOString().slice(0,10)?portfolio(s,a.id).entriesToday:0})),events:s.events.slice(-15).reverse(),closed:s.closed.slice(-30).reverse(),positions:s.positions.map(({model,...p})=>({...p,model:{lowerBin:model.lowerBin,upperBin:model.upperBin},pnlSol:p.issue||!labFresh(p.mark.at,now)||p.mark.liquidationSol==null?null:p.mark.liquidationSol-LAB_RULES.budgetSol-LAB_RULES.networkSol}))};
}
