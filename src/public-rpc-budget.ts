/** Fixed public OnFinality mainnet allowance. Their published public limit is
 * five requests/sec; count each JSON-RPC method, including genesis proof, and
 * keep a conservative two-method allowance. No transaction permission is granted here.
 * https://www.onfinality.io/en/networks/solana */
export const PUBLIC_RPC_BUDGET = Object.freeze({methodsPerSecond:2, windowMs:1250, dispatchMs:250});
export interface PublicRpcBudgetEnv {RANGE_ALERTS?:DurableObjectNamespace}
export interface PublicRpcBudgetState {recent:number[];updatedAt:number;cooldownUntil:number;attempts:number;last429At:number}
export interface PublicRpcReservation {allowed:boolean;reason:'allowed'|'budget'|'cooldown'|'unavailable';retryAt:number|null;reservedAt:number|null;dispatchUntil:number|null;observedAt?:number;retryAfterMs?:number;detail?:'budget-unbound'|'budget-deadline'|'budget-storage'|'budget-route'|'budget-response'|'budget-transport'|'grant-future'|'grant-expired'}
const key='still-onfinality-mainnet-budget-v1';
// Earlier releases granted four methods. Preserve their persisted reservations
// until the original hold expires instead of resetting history during rollout.
const maxRecordedMethods=Math.max(4,PUBLIC_RPC_BUDGET.methodsPerSecond);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const unavailable=(detail?:PublicRpcReservation['detail']):PublicRpcReservation=>({allowed:false,reason:'unavailable',retryAt:null,reservedAt:null,dispatchUntil:null,...(detail?{detail}:{})});
function stateAt(previous:PublicRpcBudgetState|undefined,now:number):PublicRpcBudgetState {
 if(!previous)return {recent:[],updatedAt:now,cooldownUntil:0,attempts:0,last429At:0};
 const valid=finite(previous.updatedAt)&&previous.updatedAt<=now&&finite(previous.cooldownUntil)&&previous.cooldownUntil>=0&&Number.isSafeInteger(previous.attempts)&&previous.attempts>=0&&finite(previous.last429At)&&previous.last429At<=now&&Array.isArray(previous.recent)&&previous.recent.length<=maxRecordedMethods&&previous.recent.every(at=>finite(at)&&at<=now);
 if(!valid)return {recent:Array.from({length:PUBLIC_RPC_BUDGET.methodsPerSecond},()=>now),updatedAt:now,cooldownUntil:Math.max(now+PUBLIC_RPC_BUDGET.windowMs,finite(previous.cooldownUntil)?previous.cooldownUntil:0),attempts:0,last429At:now};
 return {...previous,recent:previous.recent.filter(at=>at>now-PUBLIC_RPC_BUDGET.windowMs),updatedAt:now};
}
export function reservePublicRpcBudget(previous:PublicRpcBudgetState|undefined,count:number,now=Date.now()){
 const state=stateAt(previous,now);
 if(!Number.isSafeInteger(count)||count<1||count>PUBLIC_RPC_BUDGET.methodsPerSecond)return {state,reservation:unavailable()};
 if(state.cooldownUntil>now)return {state,reservation:{...unavailable(),reason:'cooldown',retryAt:state.cooldownUntil,observedAt:now,retryAfterMs:state.cooldownUntil-now} as PublicRpcReservation};
 if(state.recent.length+count>PUBLIC_RPC_BUDGET.methodsPerSecond){const sorted=[...state.recent].sort((a,b)=>a-b),needed=state.recent.length+count-PUBLIC_RPC_BUDGET.methodsPerSecond,retryAt=sorted[needed-1]+PUBLIC_RPC_BUDGET.windowMs;return {state,reservation:{...unavailable(),reason:'budget',retryAt,observedAt:now,retryAfterMs:retryAt-now} as PublicRpcReservation};}
 state.recent.push(...Array.from({length:count},()=>now));
 // A grant is usable for only 250ms, while its capacity remains held for
 // 1250ms. Even maximally delayed sends stay <=2 per rolling 1000ms window.
 return {state,reservation:{allowed:true,reason:'allowed',retryAt:null,reservedAt:now,dispatchUntil:now+PUBLIC_RPC_BUDGET.dispatchMs} as PublicRpcReservation};
}
export function cooldownPublicRpcBudget(previous:PublicRpcBudgetState|undefined,headers:{retryAfter?:string|null;rateLimitReset?:string|null},now=Date.now()):PublicRpcBudgetState{
 const state=stateAt(previous,now),attempts=state.cooldownUntil>now?Math.max(1,state.attempts):Math.min(8,state.attempts+1);
 const seconds=Number(headers.retryAfter),date=finite(seconds)&&headers.retryAfter?.trim()?NaN:Date.parse(headers.retryAfter||''),reset=Number(headers.rateLimitReset)*1000;
 const serverUntil=Math.max(finite(seconds)&&seconds>0?now+seconds*1000:0,finite(date)?date:0,finite(reset)&&reset>now?reset:0);
 return {...state,attempts,last429At:now,cooldownUntil:Math.max(state.cooldownUntil,now+Math.min(900000,30000*2**(attempts-1)),serverUntil)};
}
/** Private Durable Object routes, never exposed by the public Worker router. */
export async function publicRpcBudgetRequest(ctx:DurableObjectState,request:Request):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 if(path!=='/public-rpc/reserve'&&path!=='/public-rpc/cooldown')return null;
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let body:any;try{body=await request.json();}catch{return reply({error:'Invalid RPC budget request'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid RPC budget request'},400);
 if(path.endsWith('/reserve')&&(!Number.isSafeInteger(body.count)||body.count<1||body.count>PUBLIC_RPC_BUDGET.methodsPerSecond||Object.keys(body).some(k=>k!=='count')))return reply({error:'Invalid method count'},400);
 if(path.endsWith('/cooldown')&&(Object.keys(body).some(k=>!['retryAfter','rateLimitReset'].includes(k))||Object.values(body).some(v=>v!==null&&(typeof v!=='string'||v.length>128))))return reply({error:'Invalid provider cooldown'},400);
 try{return await ctx.blockConcurrencyWhile(async()=>{
  const previous=await ctx.storage.get<PublicRpcBudgetState>(key);
  if(path.endsWith('/cooldown')){const state=cooldownPublicRpcBudget(previous,body);await ctx.storage.put(key,state);const observedAt=Date.now();return reply({recorded:true,retryAt:state.cooldownUntil,observedAt,retryAfterMs:Math.max(0,state.cooldownUntil-observedAt)});}
  const {state,reservation}=reservePublicRpcBudget(previous,body.count);await ctx.storage.put(key,state);return reply(reservation);
 });}catch{return reply(path.endsWith('/reserve')?unavailable('budget-storage'):{recorded:false,retryAt:null},503);}
}
const inbox=(env:PublicRpcBudgetEnv)=>env.RANGE_ALERTS?.get(env.RANGE_ALERTS.idFromName('still-public-rpc-budget-v1'));
export async function reservePublicRpc(env:PublicRpcBudgetEnv,count:number,deadline=Date.now()+2500):Promise<PublicRpcReservation>{
 if(!env.RANGE_ALERTS)return unavailable('budget-unbound');if(deadline<=Date.now())return unavailable('budget-deadline');
 const requestedAt=Date.now();
 try{
  const response=await inbox(env)!.fetch(new Request('https://public-rpc-budget.internal/public-rpc/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({count}),signal:AbortSignal.timeout(Math.max(1,Math.min(2500,deadline-Date.now())))}));
  if(!response.ok)return unavailable(response.status===503?'budget-storage':'budget-route');const value=await response.json() as PublicRpcReservation;
  if(typeof value?.allowed!=='boolean'||!['allowed','budget','cooldown','unavailable'].includes(value.reason)||value.allowed!==(value.reason==='allowed')||(value.retryAt!==null&&!finite(value.retryAt)))return unavailable('budget-response');
  if(value.allowed){
   if(value.retryAt!==null||!finite(value.reservedAt)||value.dispatchUntil!==value.reservedAt+PUBLIC_RPC_BUDGET.dispatchMs||Date.now()<requestedAt)return unavailable('budget-response');
   // DO and Worker clocks are independent. The caller's entire round trip
   // upper-bounds grant age, so it gives a stricter local dispatch deadline
   // without comparing timestamps across hosts or extending the 250ms lease.
   if(Date.now()>=requestedAt+PUBLIC_RPC_BUDGET.dispatchMs)return {...unavailable('grant-expired'),reason:'budget',retryAt:requestedAt+PUBLIC_RPC_BUDGET.windowMs};
   value.reservedAt=requestedAt;value.dispatchUntil=requestedAt+PUBLIC_RPC_BUDGET.dispatchMs;
  }
  else{
   if(value.reservedAt!==null||value.dispatchUntil!==null)return unavailable('budget-response');
   if(value.reason!=='unavailable'){
    if(!finite(value.retryAt)||!finite(value.observedAt)||!finite(value.retryAfterMs)||value.retryAfterMs<0||value.retryAfterMs!==Math.max(0,value.retryAt-value.observedAt)||(value.reason==='budget'&&value.retryAfterMs>PUBLIC_RPC_BUDGET.windowMs))return unavailable('budget-response');
    // Reacquire after this caller-local wait. Adding the full observed remaining
    // duration at receipt is conservative despite cross-host clock skew.
    value.retryAt=Date.now()+value.retryAfterMs;
   }
  }
  if(value.detail&&!['budget-unbound','budget-deadline','budget-storage','budget-route','budget-response','budget-transport','grant-future','grant-expired'].includes(value.detail))return unavailable('budget-response');
  return value;
 }catch{return unavailable('budget-transport');}
}
export async function notePublicRpcRateLimit(env:PublicRpcBudgetEnv,headers:Headers):Promise<{recorded:boolean;retryAt:number|null}>{
 if(!env.RANGE_ALERTS)return {recorded:false,retryAt:null};
 try{
  // Absolute provider dates belong to the receiving caller's clock. Carry a
  // rounded-up relative wait across the DO boundary so its clock cannot shorten
  // the original Retry-After/reset period for another Worker isolate.
  const now=Date.now(),raw=headers.get('retry-after'),seconds=Number(raw),date=finite(seconds)&&raw?.trim()?NaN:Date.parse(raw||''),reset=Number(headers.get('x-ratelimit-reset'))*1000;
  const waitMs=Math.max(finite(seconds)&&seconds>0?seconds*1000:0,finite(date)?date-now:0,finite(reset)?reset-now:0),retryAfter=waitMs>0?String(Math.ceil(waitMs/1000)):null;
  const response=await inbox(env)!.fetch(new Request('https://public-rpc-budget.internal/public-rpc/cooldown',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({retryAfter,rateLimitReset:null}),signal:AbortSignal.timeout(2500)}));
  const value=await response.json() as {recorded:boolean;retryAt:number|null;observedAt?:number;retryAfterMs?:number};
  return response.ok&&value.recorded===true&&finite(value.retryAt)&&finite(value.observedAt)&&finite(value.retryAfterMs)&&value.retryAfterMs>=0&&value.retryAfterMs===Math.max(0,value.retryAt-value.observedAt)?{recorded:true,retryAt:Date.now()+value.retryAfterMs}:{recorded:false,retryAt:null};
 }catch{return {recorded:false,retryAt:null};}
}
