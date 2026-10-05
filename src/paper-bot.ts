import type {Pool,Snapshot} from './schema';
import {volumeSignal} from './volume';
import {PAPER_RULES as R,type PaperModel,type PaperMark,type PaperEntryCosts,type PaperTokenPolicy,type PaperDiagnostics} from './paper-model';
export {PAPER_RULES} from './paper-model';
export const SAMPLE_VERSION='active-lp-samples-v1';
export const isPaperSample=(s:PaperState)=>s.mode==='independent-samples';
export const SOL_MINT='So11111111111111111111111111111111111111112';
export interface PaperPosition {id:string;experiment?:string;diagnostics?:PaperDiagnostics;failureExitAt?:string;failure?:{since:string;lastAt:string;count:number;structural:boolean};pool:Pool;mint:string;openedAt:string;model:PaperModel;mark:PaperMark;investmentSol:number;rentSol:number;entryNetworkSol:number;entryCosts?:PaperEntryCosts;entryVolume30m:number;entryTvl:number;outSince:string|null;fadeCount:number;pendingExit:string|null;issue:string|null}
export interface PaperCandidate {poolId:string;address:string;pair:string;mint:string;streak:number;fees30m:number;volume30m:number;ratio:number;reason:string}
interface Memory {at:string;streak:number;price:number;tvl:number}
export interface PaperEvent {id:string;at:string;kind:string;pair?:string;message:string;pnlSol?:number}
export interface PaperClosed {id:string;experiment?:string;pair:string;mint:string;poolAddress:string;openedAt:string;closedAt:string;reason:string;pnlSol:number;investmentSol:number;exitSol:number;feesSol:number;entryNetworkSol:number;exitNetworkSol:number;conversionCostSol:number|null;entryCosts?:PaperEntryCosts;withdrawTaxSol?:number;exitTransferFees?:PaperTokenPolicy[]}
export interface PaperRuleChange {note?:string;at:string;from:string;to:string;fromDailyLimit:number;toDailyLimit:number;equitySol:number|null;closedCount:number;realizedPnlSol:number}
export interface PaperUnscorable {id:string;experiment:string;pair:string;poolAddress:string;mint:string;openedAt:string;recordedAt:string;reason:string;pendingExit:string|null;investmentSol:number;pnlSol:null;lastMark:PaperMark;diagnostics?:PaperDiagnostics;failure:NonNullable<PaperPosition['failure']>}
export interface PaperState {version:string;outcomeDays?:Record<string,{scored:number;unscorable:number;pnlSol:number;feesSol:number}>;mode?:'independent-samples';entriesArchivedAt?:string;attemptCount?:number;unscorableCount?:number;unscorable?:PaperUnscorable[];ruleChanges?:PaperRuleChange[];runState:'running'|'paused'|'stopping'|'stopped';revision:number;startedAt:string|null;lastScanAt:string|null;cashSol:number;positions:PaperPosition[];readFailures?:Record<string,{at:string;reason:string}>;memory:Record<string,Memory>;cooldowns:Record<string,number>;candidates:PaperCandidate[];lastSkips:Record<string,number>;events:PaperEvent[];closed:PaperClosed[];closedCount:number;wins:number;losses:number;realizedPnlSol:number;peakSol:number;maxDrawdown:number;haltReason:string|null;day:{date:string;entries:number;realized:number};history:{at:string;equitySol:number|null}[];unavailableScans:number}
export interface PaperRead {poolId:string;positionId?:string;entry?:PaperPosition;mark?:PaperMark;error?:string;diagnostics?:PaperDiagnostics}
export function initialPaperState():PaperState{return {version:R.version,ruleChanges:[],runState:'running',revision:0,startedAt:null,lastScanAt:null,cashSol:R.seedSol,positions:[],readFailures:{},memory:{},cooldowns:{},candidates:[],lastSkips:{},events:[],closed:[],closedCount:0,wins:0,losses:0,realizedPnlSol:0,peakSol:R.seedSol,maxDrawdown:0,haltReason:null,day:{date:'',entries:0,realized:0},history:[],unavailableScans:0};}
export function initialPaperSampleState():PaperState{return {...initialPaperState(),version:SAMPLE_VERSION,mode:'independent-samples',cashSol:0,peakSol:0,attemptCount:0,unscorableCount:0,unscorable:[],outcomeDays:{}};}
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validMark=(m:PaperMark)=>[m.principalSol,m.feesSol,m.grossSol,m.priceSol,m.networkSol].every(n=>Number.isFinite(n)&&n>=0)&&m.priceSol>0&&(m.liquidationSol===null||Number.isFinite(m.liquidationSol))&&(m.conversionCostSol===null||Number.isFinite(m.conversionCostSol))&&Math.abs(m.grossSol-m.principalSol-m.feesSol)<1e-8;
const fresh=(at:string,now:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=R.maxGapMs;
export function canScan(s:PaperState,snapshot:Snapshot,now=Date.now()){
  const at=Date.parse(snapshot.updatedAt),prior=Date.parse(s.lastScanAt||'');
  return fresh(snapshot.updatedAt,now)&&(!Number.isFinite(prior)||at-prior>=R.minScanMs);
}
export function planPaperScan(s:PaperState,snapshot:Snapshot,now=Date.now()){
  const memory:Record<string,Memory>={},skips:Record<string,number>={},candidates:PaperCandidate[]=[],eligible:Pool[]=[];
  const skip=(why:string)=>{skips[why]=(skips[why]||0)+1;};
  for(const p of snapshot.pools){
    if(p.venue!=='meteora-dlmm'||p.chain!=='solana')continue;
    const solX=p.base.address===SOL_MINT,solY=p.quote.address===SOL_MINT;
    if(solX===solY){skip('Not a token/SOL DLMM pair');continue;}
    const mint=solX?p.quote.address:p.base.address;
    if(!fresh(p.fetchedAt,now)){skip('Saved or unavailable data');continue;}
    if(!positive(p.tvlUsd)||p.tvlUsd<R.minTvl){skip('Below liquidity floor');continue;}
    if(p.volume24hUsd<R.minVolume24h||!positive(p.ageHours)||p.ageHours<R.minAgeHours){skip('Insufficient volume or history');continue;}
    const v=volumeSignal(p,now);
    if(v.latest30m==null||v.latest30m<R.minVolume30m||v.ratio==null||v.ratio<R.minRatio){skip('Volume not sustained');continue;}
    const price=solX?(positive(p.quotePriceUsd)&&positive(p.priceUsd)?p.quotePriceUsd/p.priceUsd:null):(positive(p.quotePriceUsd)&&positive(p.priceUsd)?p.priceUsd/p.quotePriceUsd:null);
    if(!positive(price)||!positive(p.activity?.fees30m)){skip('Price or recent fees missing');continue;}
    const old=s.memory[p.id],gap=old?Date.parse(p.fetchedAt)-Date.parse(old.at):Infinity;
    const continuous=old&&gap>=R.minScanMs&&gap<=R.maxGapMs;
    const shock=continuous&&(Math.abs(price/old.price-1)>0.1||p.tvlUsd/old.tvl<0.85);
    const streak=shock?0:continuous?old.streak+1:old&&gap>=0&&gap<R.minScanMs?old.streak:1;
    memory[p.id]={at:old&&gap>=0&&gap<R.minScanMs?old.at:p.fetchedAt,streak:Math.min(streak,R.confirmations),price,tvl:p.tvlUsd};
    if(shock){skip('Price jump or liquidity loss');continue;}
    if((s.cooldowns[mint]||0)>now||s.positions.some(x=>x.mint===mint)){skip('Already held or cooling down');continue;}
    candidates.push({poolId:p.id,address:p.address,pair:p.pair,mint,streak:Math.min(streak,R.confirmations),fees30m:p.activity!.fees30m!,volume30m:v.latest30m,ratio:v.ratio,reason:streak>=R.confirmations?'Volume confirmed; waiting for bin and quote checks':`Volume held up · ${streak} of ${R.confirmations} checks`});
  }
  candidates.sort((a,b)=>b.fees30m-a.fees30m||b.volume30m-a.volume30m||a.poolId.localeCompare(b.poolId));
  for(const c of candidates){const failed=s.readFailures?.[c.poolId];if(failed&&now-Date.parse(failed.at)<900000){c.reason=failed.reason+' · recheck after 15 minutes';skip('Bin or quote check cooling down');}else if(c.streak>=R.confirmations)eligible.push(snapshot.pools.find(p=>p.id===c.poolId)!);}
  return {memory,skips,candidates:candidates.slice(0,5),eligible};
}
export function paperEquity(s:PaperState,now=Date.now()):number|null{
  if(isPaperSample(s))return null;
  if(s.positions.some(p=>p.issue||!fresh(p.mark.at,now)||p.mark.liquidationSol==null))return null;
  return s.cashSol+s.positions.reduce((n,p)=>n+p.mark.liquidationSol!+p.rentSol,0);
}
export function paperEntryGate(s:PaperState,now=Date.now()){
  const day=new Date(now).toISOString().slice(0,10),same=s.day.date===day;
  const resetAt=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString();
  const blocked=(code:string,reason:string,resetsAt:string|null=null)=>({allowed:false,code,reason,resetsAt});
  if(s.entriesArchivedAt)return blocked('archived','Original wallet retained; new entries run in Active LP samples');
  if(s.runState!=='running')return blocked(s.runState,s.runState==='paused'?'New entries paused':s.runState==='stopping'?'Closing paper positions':'Paper trial stopped');
  if(!isPaperSample(s)&&s.haltReason)return blocked('drawdown',s.haltReason);
  if(s.positions.length>=R.maxOpen)return blocked('position-limit',`${R.maxOpen} of ${R.maxOpen} paper positions open`);
  if(!isPaperSample(s)&&paperEquity(s,now)==null)return blocked('data-unavailable','Waiting for fresh position data and exit quotes');
  if(same&&!(s.day.entries<R.maxDailyEntries))return blocked('daily-entry-limit',`Daily entry limit reached · ${s.day.entries} of ${R.maxDailyEntries}`,resetAt);
  if(!isPaperSample(s)&&same&&!(s.day.realized>-R.maxDailyLossSol))return blocked('daily-loss-limit','Daily realised-loss limit reached',resetAt);
  if(!isPaperSample(s)&&!(s.cashSol>=R.budgetSol+R.rentSol+R.networkSol+R.reserveSol))return blocked('cash-reserve','Keeping the paper cash reserve');
  return {allowed:true,code:'ready',reason:'Watching for eligible pools',resetsAt:null};
}
export function canEnterPaper(s:PaperState,now=Date.now()){return paperEntryGate(s,now).allowed;}
export function advancePaperState(previous:PaperState,snapshot:Snapshot,reads:PaperRead[],now=Date.now(),archiveEntries=false):PaperState{
  if(!canScan(previous,snapshot,now))return previous;
  const s:PaperState=structuredClone(previous),at=snapshot.updatedAt,plan=planPaperScan(previous,snapshot,now),newClosed:PaperClosed[]=[];
  s.revision++;s.startedAt??=at;s.lastScanAt=at;s.memory=plan.memory;s.candidates=plan.candidates;s.lastSkips=plan.skips;
  const date=new Date(now).toISOString().slice(0,10);if(s.day.date!==date)s.day={date,entries:0,realized:0};
  s.cooldowns=Object.fromEntries(Object.entries(s.cooldowns).filter(([,until])=>until>now));
  const event=(kind:string,message:string,pair?:string,pnlSol?:number)=>s.events.push({id:`${s.revision}:${s.events.length}`,at,kind,message,pair,pnlSol});
  if(archiveEntries&&!s.entriesArchivedAt){s.entriesArchivedAt=at;if(s.runState==='running')s.runState='paused';event('archived','Results retained. New entries now run in the four 10 SOL paper wallets; existing positions remain monitored.');}
  if(!isPaperSample(s)&&s.version!==R.version){
    const priorVersion=s.version;
    const change:PaperRuleChange={note:"Supported Token-2022 entries include funding, deposit, withdrawal, claim and swap fees. Initial cost limit: 8% for transfer-taxed entries, 5% otherwise. Existing exit rules, balances and outcomes retained.",at,from:priorVersion,to:R.version,fromDailyLimit:priorVersion==='spot-volume-v1'?4:priorVersion==='spot-volume-v2'?12:R.maxDailyEntries,toDailyLimit:R.maxDailyEntries,equitySol:paperEquity(previous,now),closedCount:s.closedCount,realizedPnlSol:s.realizedPnlSol};
    s.ruleChanges=[...(s.ruleChanges||[]),change];
    for(const p of s.positions)p.experiment??=priorVersion;
    s.version=R.version;
    s.readFailures=Object.fromEntries(Object.entries(s.readFailures||{}).filter(([,v])=>v.reason!=='Extended-token accounting is outside this paper trial'));
    event('rule-change',`Token-2022 accounting starts for Active LP. ${priorVersion} results retained; ${R.version} starts here.`);
  }
  const recordOutcome=(at:string,pnl:number|null,fees=0)=>{
    if(!isPaperSample(s))return;const days=s.outcomeDays??={},key=at.slice(0,10),d=days[key]??={scored:0,unscorable:0,pnlSol:0,feesSol:0};
    if(pnl===null)d.unscorable++;else{d.scored++;d.pnlSol+=pnl;d.feesSol+=fees;}
  };
  const retire=(p:PaperPosition,read:PaperRead|undefined)=>{
    if(!isPaperSample(s))return;
    const structural=!!read?.diagnostics||/small-share model|paper bin is missing|Fee counters reset/.test(p.issue||'');
    const prior=p.failure,continuous=prior&&Date.parse(at)-Date.parse(prior.lastAt)<=R.maxGapMs&&prior.structural===structural;
    p.failure={since:continuous?prior.since:at,lastAt:at,count:continuous?prior.count+1:1,structural};
    const elapsed=Date.parse(at)-Date.parse(p.failure.since);
    // A transient failure needs an hour after its exit was first queued, not
    // an assumed historical close time inferred from an old opening timestamp.
    if(p.pendingExit){p.failureExitAt??=at;}
    const invalid=structural?p.failure.count>=3&&elapsed>=600000:p.pendingExit&&elapsed>=3600000&&Date.parse(at)-Date.parse(p.failureExitAt||at)>=3600000;
    if(!invalid)return;
    const outcome:PaperUnscorable={id:p.id,experiment:p.experiment||s.version,pair:p.pool.pair,poolAddress:p.pool.address,mint:p.mint,openedAt:p.openedAt,recordedAt:at,reason:p.issue||'Exit quote unavailable',pendingExit:p.pendingExit,investmentSol:p.investmentSol,pnlSol:null,lastMark:p.mark,diagnostics:p.diagnostics,failure:p.failure};
    (s.unscorable??=[]).push(outcome);s.unscorableCount=(s.unscorableCount||0)+1;s.cooldowns[p.mint]=now+R.cooldownMs;
    recordOutcome(at,null);
    event('unscorable','Measurement failed; result unknown. Original model retained; no simulated proceeds or win/loss.',p.pool.pair);
  };
  for(const p of s.positions){
    const legacy=!['active-lp-v4',R.version,SAMPLE_VERSION].includes(p.experiment||''),outMinutes=legacy?30:R.outMinutes,fadeChecks=legacy?2:R.fadeChecks,minVolumeHoldMinutes=legacy?0:R.minVolumeHoldMinutes;
    const read=reads.find(r=>r.positionId===p.id),oldAt=Date.parse(p.mark.at),wasIssue=p.issue;
    if(!read?.mark||!validMark(read.mark)||read.poolId!==p.pool.id||read.error||!fresh(read.mark.at,now)||Date.parse(read.mark.at)<=oldAt){
      p.issue=read?.error||'Fresh bin accounting is unavailable';p.diagnostics=read?.diagnostics;p.outSince=null;p.fadeCount=0;
      // The declared wall-clock holding limit does not depend on a usable
      // valuation. Queue it from the fresh scan; settlement still needs a quote.
      if(Date.parse(at)-Date.parse(p.openedAt)>=R.maxHoldHours*3600000)p.pendingExit??='24-hour holding limit';
      if(!wasIssue)event('data-gap',isPaperSample(s)?'Paper mark unavailable; this sample is under review.':'Paper mark unavailable; new entries paused.',p.pool.pair);retire(p,read);continue;
    }
    p.mark=read.mark;p.issue=read.mark.liquidationSol==null?(read.mark.issue||'Exit quote unavailable'):null;
    p.diagnostics=read.diagnostics;
    if(!p.issue){delete p.failure;delete p.failureExitAt;}
    if(wasIssue&&!p.issue)event('data-restored','Paper accounting is available again.',p.pool.pair);
    const continuous=Date.parse(read.mark.at)-oldAt<=R.maxGapMs&&!wasIssue;
    p.outSince=p.mark.inRange?null:continuous?(p.outSince||read.mark.at):read.mark.at;
    const pool=snapshot.pools.find(x=>x.id===p.pool.id),volume=pool&&fresh(pool.fetchedAt,now)?pool.activity?.volume30m:null;
    p.fadeCount=volume!=null&&volume<p.entryVolume30m/2?(continuous?p.fadeCount+1:1):0;
    const pnl=p.mark.liquidationSol==null?null:p.mark.liquidationSol-p.investmentSol-p.entryNetworkSol;
    p.pendingExit??=(s.runState==='stopping'?'Paper trial stopped by Pat':pool&&fresh(pool.fetchedAt,now)&&positive(pool.tvlUsd)&&pool.tvlUsd<p.entryTvl*0.7?'Pool liquidity fell by 30%':pnl!=null&&pnl/p.investmentSol<=R.stopLoss?'Loss limit reached':pnl!=null&&pnl/p.investmentSol>=R.takeProfit?'Profit target reached':p.outSince&&Date.parse(p.mark.at)-Date.parse(p.outSince)>=outMinutes*60000?`Out of range for ${outMinutes} observed minutes`:p.fadeCount>=fadeChecks&&Date.parse(p.mark.at)-Date.parse(p.openedAt)>=minVolumeHoldMinutes*60000?`Volume faded across ${fadeChecks} checks${legacy?'':' after at least an hour held'}`:Date.parse(p.mark.at)-Date.parse(p.openedAt)>=R.maxHoldHours*3600000?'24-hour holding limit':null);
    if(p.issue)retire(p,read);
    if(p.pendingExit&&p.mark.liquidationSol!=null){
      const closed:PaperClosed={id:p.id,experiment:p.experiment||s.version,pair:p.pool.pair,mint:p.mint,poolAddress:p.pool.address,openedAt:p.openedAt,closedAt:p.mark.at,reason:p.pendingExit,pnlSol:pnl!,investmentSol:p.investmentSol,exitSol:p.mark.liquidationSol,feesSol:p.mark.feesSol,entryNetworkSol:p.entryNetworkSol,exitNetworkSol:p.mark.networkSol,conversionCostSol:p.mark.conversionCostSol,...(p.entryCosts?{entryCosts:p.entryCosts,withdrawTaxSol:p.mark.withdrawTaxSol,exitTransferFees:p.mark.transferFees}:{})};
      newClosed.push(closed);if(!isPaperSample(s))s.cashSol+=p.mark.liquidationSol+p.rentSol;s.cooldowns[p.mint]=now+R.cooldownMs;s.realizedPnlSol+=pnl!;s.day.realized+=pnl!;s.closedCount++;if(pnl!>0)s.wins++;else if(pnl!<0)s.losses++;
      recordOutcome(p.mark.at,pnl!,p.mark.feesSol);
      event('paper-exit',p.pendingExit,p.pool.pair,pnl!);
    }
  }
  s.positions=s.positions.filter(p=>!newClosed.some(c=>c.id===p.id)&&!s.unscorable?.some(c=>c.id===p.id));s.closed=[...s.closed,...newClosed];
  if(s.runState==='stopping'&&!s.positions.length)s.runState='stopped';
  const equity=paperEquity(s,now);
  if(equity==null){if(!isPaperSample(s)||s.positions.some(p=>p.issue))s.unavailableScans++;}
  else{s.peakSol=Math.max(s.peakSol,equity);s.maxDrawdown=Math.max(s.maxDrawdown,1-equity/s.peakSol);if(!s.haltReason&&1-equity/s.peakSol>=R.maxDrawdown){s.haltReason='10% paper drawdown reached';event('paused',s.haltReason);}}
  s.readFailures=Object.fromEntries(Object.entries(s.readFailures||{}).filter(([,v])=>now-Date.parse(v.at)<900000));
  for(const failed of reads.filter(r=>!r.positionId&&r.error)){s.readFailures[failed.poolId]={at,reason:failed.error!};const c=s.candidates.find(c=>c.poolId===failed.poolId);if(c)c.reason=failed.error!;event('paper-skip',failed.error!,snapshot.pools.find(p=>p.id===failed.poolId)?.pair);}
  if(canEnterPaper(s,now)){
    const eligibleIds=new Set(plan.eligible.map(p=>p.id));
    const candidate=reads.find(r=>r.entry&&eligibleIds.has(r.poolId)&&!r.error);
    if(candidate?.entry){
      const p=structuredClone(candidate.entry);
      if(p.pool.id===candidate.poolId&&p.mint===(p.pool.base.address===SOL_MINT?p.pool.quote.address:p.pool.base.address)&&validMark(p.mark)&&!p.issue&&fresh(p.mark.at,now)&&p.mark.liquidationSol!=null&&p.investmentSol===R.budgetSol&&p.rentSol===R.rentSol&&p.entryNetworkSol===R.networkSol&&!s.positions.some(x=>x.mint===p.mint)&&!(s.cooldowns[p.mint]>now)){
        p.experiment=s.version;s.positions.push(p);s.attemptCount=(s.attemptCount||0)+1;if(!isPaperSample(s))s.cashSol-=p.investmentSol+p.rentSol+p.entryNetworkSol;s.day.entries++;event('paper-entry','Three volume checks passed; opened a two-sided Spot paper position.',p.pool.pair);
      }
    }else {const failed=reads.find(r=>!r.positionId&&r.error);if(failed){const c=s.candidates.find(c=>c.poolId===failed.poolId);if(c)c.reason=failed.error!;}}
  }
  const finalEquity=paperEquity(s,now);if(finalEquity!=null){s.maxDrawdown=Math.max(s.maxDrawdown,1-finalEquity/s.peakSol);if(!s.haltReason&&1-finalEquity/s.peakSol>=R.maxDrawdown){s.haltReason='10% paper drawdown reached';event('paused',s.haltReason);}}s.history.push({at,equitySol:finalEquity});s.history=s.history.filter(h=>Date.parse(h.at)>=now-86400000).slice(-288);s.events=s.events.slice(-100);
  return s;
}
export function paperSummary(s:PaperState,now=Date.now()){
  const equity=paperEquity(s,now);
  const date=new Date(now).toISOString().slice(0,10);
  const daily={date,entries:s.day.date===date?s.day.entries:0,limit:R.maxDailyEntries,resetsAt:new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString()};
  return {name:'Pat Bot',mode:'paper',sampleMode:isPaperSample(s),outcomeDays:s.outcomeDays||{},entriesArchivedAt:s.entriesArchivedAt||null,attemptCount:isPaperSample(s)?s.attemptCount||0:s.closedCount+s.positions.length,unscorableCount:s.unscorableCount||0,unscorable:(s.unscorable||[]).slice(-40).reverse(),experiment:s.version,ruleChanges:s.ruleChanges||[],runState:s.runState,entryGate:paperEntryGate(s,now),daily,rules:{...R,version:s.version,...(isPaperSample(s)?{seedSol:null,reserveSol:null,maxDailyLossSol:null,maxDrawdown:null}:{})},revision:s.revision,startedAt:s.startedAt,lastScanAt:s.lastScanAt,cashSol:isPaperSample(s)?null:s.cashSol,equitySol:equity,pnlSol:equity==null?null:equity-R.seedSol,benchmarkSol:isPaperSample(s)?null:R.seedSol,realizedPnlSol:s.realizedPnlSol,closedCount:s.closedCount,wins:s.wins,losses:s.losses,maxDrawdown:isPaperSample(s)?null:s.maxDrawdown,haltReason:s.haltReason,unavailableScans:s.unavailableScans,candidates:s.candidates,skips:s.lastSkips,events:s.events.slice().reverse(),closed:s.closed.slice(-50).reverse(),history:s.history,positions:s.positions.map(({model,...p})=>({...p,model:{lowerBin:model.lowerBin,upperBin:model.upperBin},pnlSol:p.issue||!fresh(p.mark.at,now)||p.mark.liquidationSol==null?null:p.mark.liquidationSol-p.investmentSol-p.entryNetworkSol}))};
}

export function controlPaper(s:PaperState,action:string,now=Date.now()):PaperState{
  if(!['resume','pause','stop'].includes(action))throw Error('Unknown paper control');
  if(action==='resume'&&s.entriesArchivedAt)throw Error('The original wallet is retained. Use the separate Active LP samples for new entries.');
  if(action==='resume'&&s.haltReason)throw Error('The drawdown stop needs a new reviewed experiment. This trial keeps its results.');
  const next=structuredClone(s);next.revision++;
  next.runState=action==='resume'?'running':action==='pause'?'paused':next.positions.length?'stopping':'stopped';
  if(action==='stop')for(const p of next.positions)p.pendingExit??='Paper trial stopped by Pat';
  // Resuming cannot undo an exit that is waiting for a usable quote.
  next.events.push({id:`${next.revision}:control`,at:new Date(now).toISOString(),kind:'control',message:action==='resume'?'Paper entries resumed.':action==='pause'?'New paper entries paused; existing positions still monitored.':'Paper stop requested; open positions close at the next usable quote.'});
  next.events=next.events.slice(-100);return next;
}
