import type {Pool,Snapshot} from './schema';
import type {MarketMemory} from './fleet-signals';
import type {FleetArmId,FleetState} from './paper-fleet';

// This is the short, continuous evidence used by the original fleet, not the
// separate research replay history. Retention never extends signal continuity.
export const FLEET_MARKET_LIMIT=2048;
export const FLEET_MARKET_TTL_MS=120*60000;
export const FLEET_MARKET_POINTS=25;
const SOL='So11111111111111111111111111111111111111112';
const ARMS:FleetArmId[]=['farmer','scalp','wide','steady'];
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const fresh=(at:string,now:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+60000&&now-Date.parse(at)<=600000;
export const fleetMarketPool=(p:Pool)=>p.chain==='solana'&&p.venue==='meteora-dlmm'&&((p.base.address===SOL)!==(p.quote.address===SOL));
const usablePrice=(p:Pool)=>positive(p.priceQuote)?positive(p.base.address===SOL?1/p.priceQuote:p.priceQuote):positive(p.priceUsd)&&positive(p.quotePriceUsd)&&positive(p.base.address===SOL?p.quotePriceUsd/p.priceUsd:p.priceUsd/p.quotePriceUsd);

export interface FleetDecision {at:string;message:string;pair?:string;arm?:FleetArmId;kind?:'entry'|'position'}
export interface FleetDiscoveryHealth {
 asOf:string;snapshotAt:string;latestSourceAt:string|null;pools:number;freshPools:number;stalePools:number;invalidSources:number;
 usablePools:number;trackedPools:number;retainedAbsent:number;capacityDropped:number;memoryLimit:number;retentionMinutes:number;
}
interface DecisionMetadata {
 lastDecisionByArm?:Partial<Record<FleetArmId,FleetDecision>>;
 lastEntryDecisionByArm?:Partial<Record<FleetArmId,FleetDecision>>;
 lastSuccessfulEntryCheckAt?:Partial<Record<FleetArmId,string>>;
 discoveryHealth?:FleetDiscoveryHealth;
}
const newer=(a:FleetDecision,b:FleetDecision|undefined)=>!b||Date.parse(a.at)>=Date.parse(b.at);
function saveDecision(map:Partial<Record<FleetArmId,FleetDecision>>,e:FleetDecision){
 if(e.arm&&ARMS.includes(e.arm)&&Number.isFinite(Date.parse(e.at))&&newer(e,map[e.arm]))map[e.arm]={...e,message:e.message.slice(0,1000),...(e.pair?{pair:e.pair.slice(0,160)}:{})};
}
export function recordFleetDecision(s:Pick<FleetState,'events'>&DecisionMetadata,e:FleetDecision,kind:'entry'|'position'='position'){
 if(!s.lastDecisionByArm){s.lastDecisionByArm={};for(const old of s.events)saveDecision(s.lastDecisionByArm,old);}
 saveDecision(s.lastDecisionByArm,{...e,kind});
 if(kind==='entry'){s.lastEntryDecisionByArm??={};saveDecision(s.lastEntryDecisionByArm,{...e,kind});}
}
export function fleetDiscoveryHealth(snapshot:Snapshot,markets:MarketMemory,now=Date.now()):FleetDiscoveryHealth {
 const pools=snapshot.pools.filter(fleetMarketPool),current=new Set(pools.map(p=>p.id));
 const valid=pools.filter(p=>Number.isFinite(Date.parse(p.fetchedAt))&&Date.parse(p.fetchedAt)<=now+60000);
 const freshPools=valid.filter(p=>fresh(p.fetchedAt,now)),usable=freshPools.filter(p=>positive(p.tvlUsd)&&usablePrice(p));
 const latest=valid.reduce((n,p)=>Math.max(n,Date.parse(p.fetchedAt)),0);
 return {asOf:new Date(now).toISOString(),snapshotAt:snapshot.updatedAt,latestSourceAt:latest?new Date(latest).toISOString():null,pools:pools.length,
  freshPools:freshPools.length,stalePools:valid.length-freshPools.length,invalidSources:pools.length-valid.length,usablePools:usable.length,
  trackedPools:Object.keys(markets).length,retainedAbsent:Object.keys(markets).filter(id=>!current.has(id)).length,
  capacityDropped:usable.filter(p=>!markets[p.id]?.length).length,memoryLimit:FLEET_MARKET_LIMIT,retentionMinutes:FLEET_MARKET_TTL_MS/60000};
}
export function fleetArmActivity(s:FleetState&DecisionMetadata,arm:FleetArmId,entryReason:string|null,now=Date.now()){
 const a=s.portfolios[arm],open=s.positions.filter(p=>p.arm===arm).length;
 const latest=s.events.filter(e=>e.arm===arm).reduce<FleetDecision|undefined>((best,e)=>newer(e,best)?e:best,undefined);
 const latestDecision=s.lastDecisionByArm?.[arm]||latest||null,latestEntryDecision=s.lastEntryDecisionByArm?.[arm]||null;
 const funnel=s.funnel?.[arm]||null,asOf=s.lastFullScanAt||s.lastScanAt,source=s.discoveryHealth||null;
 const unresolved=a?.unresolvedSol??(a?.unscorableCount||0)*.6;
 let state='scanning',label='Scanning for entries',tone='ok',detail='A qualifying setup and usable entry valuation are required.';
 if(s.runState!=='running'){state='paused';label=s.runState==='stopping'?'Closing positions':'Entries paused';tone='warn';detail='The saved fleet run state pauses new entries.';}
 else if(s.entryProfiles&&!s.entryProfiles.includes(arm)){state='archived';label='Archived';tone='muted';detail='This arm is excluded from new entries.';}
 else if(a?.halted){state='risk-stop';label='Entries stopped · risk guard';tone='warn';detail=entryReason||'The saved risk stop blocks new entries.';}
 else if(a?.riskDataHold||entryReason?.includes('values are incomplete')){
  const historical=open===0&&(unresolved>0||!!a?.unscorableCount);state=historical?'historical-hold':'valuation-hold';label=historical?'Accounting hold · earlier outcomes':'Waiting for position values';tone='warn';
  detail=historical?`Zero open positions; ${unresolved>0?unresolved.toFixed(4)+' SOL remains unresolved from earlier outcomes':'earlier unscorable outcomes keep value incomplete'}. The unchanged accounting risk guard blocks new entries. Routine scans cannot reconstruct retired outcomes.`:'Incomplete current or earlier position values pause new entries. Missing capital stays unresolved and is not refunded.';
 }else if(!asOf||!fresh(asOf,now)){state='scan-stale';label='Scan status needs attention';tone='warn';detail='The last full discovery scan is older than ten minutes or unavailable.';}
 else if(source&&source.freshPools===0){state='source-stale';label='Waiting for fresh pool sources';tone='warn';detail=`The scan ran, but none of ${source.pools} native-SOL DLMM pool sources was fresh. Cached source timestamps are not new observations.`;}
 else if(entryReason){state='entry-hold';label=entryReason.includes('open-position')?'Managing · at capacity':'New entries on hold';tone='muted';detail=entryReason;}
 else if(funnel){
  if(funnel.checked>0&&funnel.entered===0&&(funnel.providerBlocked>0||funnel.modelRejected>0)){
   state=funnel.providerBlocked>0&&funnel.modelRejected===0?'provider-blocked':funnel.modelRejected>0&&funnel.providerBlocked===0?'model-rejected':'entry-blocked';
   label=state==='provider-blocked'?'Entry quote provider blocked':state==='model-rejected'?'Entry model / cost rejected':'Entry checks blocked';tone='warn';
   detail=`${funnel.checked} entry checks: ${funnel.modelRejected} model or cost rejections and ${funnel.providerBlocked} provider delays; ${funnel.entered} opened. ${latestEntryDecision?.message||'See the preserved wallet decision for the reported reason.'}`;
  }else if(funnel.ready>0&&funnel.entered===0){state='ready';label='Setup ready · awaiting entry check';detail=`${funnel.ready} setups passed; confirmation, cooldown, capacity and the shared quote budget still apply.`;}
  else if(funnel.screened===0){state='no-activity';label='No pools pass activity filters';tone='muted';detail='Fresh source, liquidity, age, reported fees and volume filters precede the price setup.';}
  else if(funnel.warming>0&&funnel.ready===0){state='warming';label='Building setup history';tone='muted';detail=`${funnel.warming} activity-qualified pools need more continuous observations; ${funnel.rejected} did not match the setup.`;}
  else if(funnel.ready===0){state='no-setup';label='No qualifying price setup';tone='muted';detail=`${funnel.screened} pools passed activity filters; ${funnel.rejected} did not match the price setup.`;}
  else if(funnel.entered>0){state='entered';label='Entry accepted · scanning';detail=`${funnel.entered} entries accepted from ${funnel.checked} checks in the last full scan.`;}
 }
 return {state,label,tone,detail,asOf,funnel,latestDecision,latestEntryDecision,lastQuoteCheckAt:s.lastEntryCheckAt?.[arm]||null,
  lastSuccessfulQuoteAt:s.lastSuccessfulEntryCheckAt?.[arm]||null,source};
}
