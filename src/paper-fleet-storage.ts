import {initialFleetState,type FleetState} from './paper-fleet';
export const MARKET_SHARD_SIZE=40;

// A DO value is limited to 128 KiB. Keep each immutable bin model in its own
// record, so wide samples and draining legacy positions cannot overflow the portfolio record.
export async function loadFleet(storage:DurableObjectStorage):Promise<FleetState>{
  const state=await storage.get<FleetState>('fleet')||initialFleetState();
  if(state.marketShards){
    const shards=await Promise.all(Array.from({length:state.marketShards},(_,i)=>storage.get<NonNullable<FleetState['markets']>>('fleet-markets:'+i)));
    if(shards.some(s=>!s))throw Error('Saved signal history unavailable; existing records retained');
    state.markets=Object.assign({},...shards);
  }
  await Promise.all(state.positions.map(async p=>{
    if(!p.model.shares.length){
      const model=await storage.get<typeof p.model>('fleet-model:'+p.id);
      if(!model)throw Error('Saved fleet model unavailable; existing records retained');
      p.model=model;
    }
  }));
  return state;
}

export function fleetRecords(state:FleetState):Record<string,unknown>{
  const saved=structuredClone(state),records:Record<string,unknown>={};
  const rows=Object.entries(saved.markets||{});
  // Up to 2,048 histories use 52 values, leaving room in the atomic 128-key
  // write for position models, entry/close journals and the scan record.
  saved.marketShards=Math.ceil(rows.length/MARKET_SHARD_SIZE);
  for(let i=0;i<saved.marketShards;i++)records['fleet-markets:'+i]=Object.fromEntries(rows.slice(i*MARKET_SHARD_SIZE,(i+1)*MARKET_SHARD_SIZE));
  delete saved.markets;
  // Full close evidence is written once to fleet-trade:* by the journal.
  // Keep the bounded recent-close index small even after 90 signal-rich closes.
  saved.closed=saved.closed.map(({policy,entrySignal,exitState,harvest,allocation,...close})=>close);
  for(const p of saved.positions){
    records['fleet-model:'+p.id]=p.model;
    p.model={...p.model,shares:[]};
  }
  records.fleet=saved;
  return records;
}

export function fleetScanRecords(at:string,scan:{reads:unknown[];[key:string]:unknown}):Record<string,unknown>{
 const key='fleet-scan:'+at;
 if(new TextEncoder().encode(JSON.stringify(scan)).length<96000)return {[key]:scan};
 // A failed wide-bin read can carry hundreds of diagnostics. Preserve each
 // full read separately instead of overflowing the single scan value.
 const records:Record<string,unknown>={},readRefs=scan.reads.map((read,i)=>{const ref='fleet-scan-read:'+at+':'+i;records[ref]=read;return ref;});
 records[key]={...scan,reads:[],readRefs};return records;
}
