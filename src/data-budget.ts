export const GECKO_DAILY_LIMIT=48;
export interface DataBudget {day:string;attempts:number}
export function reserveGecko(previous:DataBudget|undefined,now=Date.now()){
  const day=new Date(now).toISOString().slice(0,10);
  const state=previous?.day===day?{...previous}:{day,attempts:0};
  const allowed=state.attempts<GECKO_DAILY_LIMIT;
  if(allowed)state.attempts++;
  return {state,allowed};
}
export const dataInbox=(ns:DurableObjectNamespace)=>ns.get(ns.idFromName('pat-data-budget-v1'));
