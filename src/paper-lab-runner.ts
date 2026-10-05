import {ACTIVE_LAB_PROFILES,LAB_ARMS,initialLabState,labCanScan,labPlan,labCanEnter,type LabState,type LabRead} from './paper-lab';
import {readLabPool} from '../execution/paper-lab-reader';
import type {Snapshot} from './schema';
export function labInbox(namespace:DurableObjectNamespace){return namespace.get(namespace.idFromName('pat-downside-lab-v1'));}
export async function runPaperLab(namespace:DurableObjectNamespace,snapshot:Snapshot,rpc:string){
  const inbox=labInbox(namespace),response=await inbox.fetch('https://paper-lab/lab/raw');
  if(!response.ok)throw Error('Lab journal unavailable');
  const state:LabState=await response.json() as LabState||initialLabState();
  if(!labCanScan(state,snapshot))return;
  const reads:LabRead[]=[],groups=new Map<string,typeof state.positions>();
  for(const p of state.positions)groups.set(p.cohort,[...(groups.get(p.cohort)||[]),p]);
  // At most six new samples plus nine draining legacy positions. Each cohort shares its pool reads.
  for(const positions of groups.values())reads.push(...await readLabPool(positions[0].pool,rpc,positions));
  const refreshed=structuredClone(state);
  for(const p of refreshed.positions){const r=reads.find(r=>r.positionId===p.id);if(r?.mark){p.mark=r.mark;p.issue=r.mark.liquidationSol==null?'Exit quote unavailable':null;}else p.issue=r?.error||'Position read unavailable';}
  const arms:import('./paper-lab').LabArmId[]=[],plan=labPlan(state,snapshot);
  // One new pool cohort per scan; failed/full profiles cannot starve another profile.
  const priority=[...arms].sort((a,b)=>(state.portfolios[a]?.entriesToday||0)-(state.portfolios[b]?.entriesToday||0)||ACTIVE_LAB_PROFILES.indexOf(a)-ACTIVE_LAB_PROFILES.indexOf(b));
  const nextArm=priority.find(a=>plan.eligible.some(p=>plan.allowedArms[p.id].includes(a)));
  const candidate=plan.eligible.find(p=>nextArm&&plan.allowedArms[p.id].includes(nextArm));
  if(candidate)reads.push(...await readLabPool(candidate,rpc,[],plan.allowedArms[candidate.id].filter(a=>arms.includes(a)),snapshot.updatedAt));
  const committed=await inbox.fetch('https://paper-lab/lab',{method:'POST',body:JSON.stringify({expectedRevision:state.revision,snapshot,reads,archiveEntries:true})});
  if(!committed.ok)throw Error('Lab scan was not committed');
}
