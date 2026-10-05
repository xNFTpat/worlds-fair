import {initialPaperState,initialPaperSampleState,canScan,planPaperScan,canEnterPaper,type PaperState,type PaperRead} from './paper-bot';
import {readPaperPool} from '../execution/paper-reader';
import type {Snapshot} from './schema';
export function paperInbox(namespace:DurableObjectNamespace,samples=false){return namespace.get(namespace.idFromName(samples?'pat-active-lp-samples-v1':'pat-paper-bot-v1'));}
export async function runPaperBot(namespace:DurableObjectNamespace,snapshot:Snapshot,rpc:string,samples=false){
  const inbox=paperInbox(namespace,samples),path=samples?'/samples':'/bot',response=await inbox.fetch('https://paper-bot'+path+'/raw');
  if(!response.ok)throw Error('Paper journal unavailable');
  const state:PaperState=(await response.json() as PaperState|null)||(samples?initialPaperSampleState():initialPaperState()),now=Date.now();
  if(!canScan(state,snapshot,now))return;
  const plan=planPaperScan(state,snapshot,now);
  // Read at most two existing positions and one new candidate. No data-source fanout per pool list.
  const reads:PaperRead[]=await Promise.all(state.positions.map(p=>readPaperPool(p.pool,rpc,p)));
  const refreshed=structuredClone(state);
  for(const p of refreshed.positions){const r=reads.find(r=>r.positionId===p.id);if(r?.mark){p.mark=r.mark;p.issue=r.mark.liquidationSol==null?'Exit quote unavailable':null;}else p.issue=r?.error||'Position read unavailable';}
  const committed=await inbox.fetch('https://paper-bot'+path,{method:'POST',body:JSON.stringify({expectedRevision:state.revision,snapshot,reads,archiveEntries:true})});
  if(!committed.ok)throw Error('Paper scan was not committed');
}

export async function runPaperTrials(namespace:DurableObjectNamespace,snapshot:Snapshot,rpc:string){
  const results=await Promise.allSettled([runPaperBot(namespace,snapshot,rpc),runPaperBot(namespace,snapshot,rpc,true)]);
  if(results.some(r=>r.status==='rejected'))throw Error('One Active LP journal scan is incomplete');
}
