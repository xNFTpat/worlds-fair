import {FLEET_ARMS,initialFleetState,fleetCanScan,fleetPlan,fleetCanEnter,fleetEntryPriority,type FleetState,type FleetRead} from './paper-fleet';
import {readFleetPool} from '../execution/paper-fleet-reader';
import type {Snapshot} from './schema';
import {paperRpcTransport} from '../execution/paper-rpc';
import {allocationRequest,ALLOCATION_LIMITS} from './fleet-allocation';
export function fleetInbox(namespace:DurableObjectNamespace){return namespace.get(namespace.idFromName('pat-four-wallets-v1'));}
export async function runPaperFleet(namespace:DurableObjectNamespace,snapshot:Snapshot,rpc:string,mode:'full'|'heart'='full'){
  const inbox=fleetInbox(namespace),response=await inbox.fetch('https://paper-fleet/fleet/raw');
  if(!response.ok)throw Error('Fleet journal unavailable');
  const state:FleetState=await response.json() as FleetState||initialFleetState();
  if(!fleetCanScan(state,snapshot,Date.now(),mode))return {status:'unchanged' as const,at:state.lastScanAt,revision:state.revision};
  const transport=paperRpcTransport(),reads:FleetRead[]=[],groups=new Map<string,typeof state.positions>();
  for(const p of state.positions.filter(p=>mode==='full'||p.arm==='scalp'&&['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(p.experiment||'')))groups.set(p.pool.id,[...(groups.get(p.pool.id)||[]),p]);
  // Oldest observations first prevent a busy Heart wallet from starving other
  // holdings when the provider budget is exhausted. Equal-age exits go first.
  const oldest=(positions:typeof state.positions)=>Math.min(...positions.map(p=>Date.parse(p.mark.at)));
  for(const positions of [...groups.values()].sort((a,b)=>oldest(a)-oldest(b)||Number(b.some(p=>p.arm==='scalp'||p.pendingExit))-Number(a.some(p=>p.arm==='scalp'||p.pendingExit))))reads.push(...await readFleetPool(positions[0].pool,rpc,positions,[],snapshot.updatedAt,transport.fetch));
  const refreshed=structuredClone(state);
  for(const p of refreshed.positions){const r=reads.find(r=>r.positionId===p.id);if(r?.mark){p.mark=r.mark;p.issue=r.mark.liquidationSol==null?'Exit quote unavailable':null;}else p.issue=r?.error||'Position read unavailable';}
  const plan=fleetPlan(state,snapshot),checked=new Set<string>();
  for(let i=0;mode==='full'&&i<ALLOCATION_LIMITS.maxPoolsPerScan;i++){
    // Reserve time for commitment; quotes at several sizes reuse loaded bins.
    if(transport.stats.requests>=90||transport.stats.elapsedMs>=40000)break;
    const arms=FLEET_ARMS.filter(a=>fleetCanEnter(refreshed,a.id)).map(a=>a.id);
    const eligible=plan.eligible.filter(p=>!checked.has(p.id));
    const priority=fleetEntryPriority(refreshed,arms);
    const nextArm=priority.find(a=>eligible.some(p=>plan.allowedArms[p.id].includes(a)));
    const candidate=eligible.filter(p=>nextArm&&plan.allowedArms[p.id].includes(nextArm)).sort((a,b)=>(plan.signals[b.id]?.[nextArm!]?.score||0)-(plan.signals[a.id]?.[nextArm!]?.score||0)||a.id.localeCompare(b.id))[0];
    if(!candidate)break;checked.add(candidate.id);
    const chosen=plan.allowedArms[candidate.id].filter(a=>arms.includes(a)&&!refreshed.positions.some(p=>p.arm===a&&(p.pool.base.address===candidate.base.address&&p.pool.quote.address===candidate.quote.address)));
    const requests=Object.fromEntries(chosen.map(a=>[a,allocationRequest(a,refreshed.portfolios[a].cashSol,plan.signals[candidate.id][a])]));
    const results=await readFleetPool(candidate,rpc,[],chosen,snapshot.updatedAt,transport.fetch,requests);reads.push(...results);
    for(const r of results){
      (refreshed.lastEntryCheckAt??={})[r.arm]=snapshot.updatedAt;
      if(r.entry){refreshed.positions.push(r.entry);refreshed.portfolios[r.arm].cashSol-=r.entry.budgetSol!+r.entry.rentSol!+r.entry.entryNetworkSol!;refreshed.portfolios[r.arm].entriesToday++;}
    }
  }
  const committed=await inbox.fetch('https://paper-fleet/fleet',{method:'POST',body:JSON.stringify({expectedRevision:state.revision,snapshot,reads,mode,readHealth:transport.stats})});
  if(!committed.ok)throw Error('Fleet scan was not committed');
  const saved=await committed.json() as {revision?:number;unchanged?:boolean};
  return {status:saved.unchanged?'unchanged' as const:'committed' as const,at:saved.unchanged?state.lastScanAt:snapshot.updatedAt,revision:saved.revision??state.revision};
}
