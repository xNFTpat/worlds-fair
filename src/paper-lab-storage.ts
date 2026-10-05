import {initialLabState,type LabState} from './paper-lab';

// A DO value is limited to 128 KiB. Keep each immutable bin model in its own
// record, so wide samples and draining legacy positions cannot overflow the portfolio record.
export async function loadLab(storage:DurableObjectStorage):Promise<LabState>{
  const state=await storage.get<LabState>('lab')||initialLabState();
  await Promise.all(state.positions.map(async p=>{
    if(!p.model.shares.length){
      const model=await storage.get<typeof p.model>('lab-model:'+p.id);
      if(!model)throw Error('Saved lab model unavailable; existing records retained');
      p.model=model;
    }
  }));
  return state;
}

export function labRecords(state:LabState):Record<string,unknown>{
  const saved=structuredClone(state),records:Record<string,unknown>={};
  for(const p of saved.positions){
    records['lab-model:'+p.id]=p.model;
    p.model={...p.model,shares:[]};
  }
  records.lab=saved;
  return records;
}
