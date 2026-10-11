/** Fixed public OnFinality mainnet allowance. Their published public limit is
 * five requests/sec; count each JSON-RPC method, including genesis proof, and
 * keep one request of headroom. No transaction permission is granted here.
 * https://www.onfinality.io/en/networks/solana */
export const PUBLIC_RPC_BUDGET = Object.freeze({methodsPerSecond:4, windowMs:1250, dispatchMs:250});
export interface PublicRpcBudgetEnv {RANGE_ALERTS?:DurableObjectNamespace}
export interface PublicRpcBudgetState {recent:number[];updatedAt:number;cooldownUntil:number;attempts:number;last429At:number}
export interface PublicRpcReservation {allowed:boolean;reason:'allowed'|'budget'|'cooldown'|'unavailable';retryAt:number|null;reservedAt:number|null;dispatchUntil:number|null}
const key='still-onfinality-mainnet-budget-v1';
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const unavailable=():PublicRpcReservation=>({allowed:false,reason:'unavailable',retryAt:null,reservedAt:null,dispatchUntil:null});
function stateAt(previous:PublicRpcBudgetState|undefined,now:number):PublicRpcBudgetState {
 if(!previous)return {recent:[],updatedAt:now,cooldownUntil:0,attempts:0,last429At:0};
 const valid=finite(previous.updatedAt)&&previous.updatedAt<=now&&finite(previous.cooldownUntil)&&previous.cooldownUntil>=0&&Number.isSafeInteger(previous.attempts)&&previous.attempts>=0&&finite(previous.last429At)&&previous.last429At<=now&&Array.isArray(previous.recent)&&previous.recent.length<=4&&previous.recent.every(at=>finite(at)&&at<=now);
 if(!valid)return {recent:[now,now,now,now],updatedAt:now,cooldownUntil:Math.max(now+1250,finite(previous.cooldownUntil)?previous.cooldownUntil:0),attempts:0,last429At:now};
 return {...previous,recent:previous.recent.filter(at=>at>now-1250),updatedAt:now};
}
export function reservePublicRpcBudget(previous:PublicRpcBudgetState|undefined,count:number,now=Date.now()){
 const state=stateAt(previous,now);
 if(!Number.isSafeInteger(count)||count<1||count>4)return {state,reservation:unavailable()};
 if(state.cooldownUntil>now)return {state,reservation:{...unavailable(),reason:'cooldown',retryAt:state.cooldownUntil} as PublicRpcReservation};
 if(state.recent.length+count>4){const sorted=[...state.recent].sort((a,b)=>a-b),needed=state.recent.length+count-4;return {state,reservation:{...unavailable(),reason:'budget',retryAt:sorted[needed-1]+1250} as PublicRpcReservation};}
 state.recent.push(...Array.from({length:count},()=>now));
 // A grant is usable for only 250ms, while its capacity remains held for
 // 1250ms. Even maximally delayed sends stay <=4 per rolling 1000ms window.
 return {state,reservation:{allowed:true,reason:'allowed',retryAt:null,reservedAt:now,dispatchUntil:now+250} as PublicRpcReservation};
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
 if(path.endsWith('/reserve')&&(!Number.isSafeInteger(body.count)||body.count<1||body.count>4||Object.keys(body).some(k=>k!=='count')))return reply({error:'Invalid method count'},400);
 if(path.endsWith('/cooldown')&&(Object.keys(body).some(k=>!['retryAfter','rateLimitReset'].includes(k))||Object.values(body).some(v=>v!==null&&(typeof v!=='string'||v.length>128))))return reply({error:'Invalid provider cooldown'},400);
 try{return await ctx.blockConcurrencyWhile(async()=>{
  const previous=await ctx.storage.get<PublicRpcBudgetState>(key);
  if(path.endsWith('/cooldown')){const state=cooldownPublicRpcBudget(previous,body);await ctx.storage.put(key,state);return reply({recorded:true,retryAt:state.cooldownUntil});}
  const {state,reservation}=reservePublicRpcBudget(previous,body.count);await ctx.storage.put(key,state);return reply(reservation);
 });}catch{return reply(path.endsWith('/reserve')?unavailable():{recorded:false,retryAt:null},503);}
}
const inbox=(env:PublicRpcBudgetEnv)=>env.RANGE_ALERTS?.get(env.RANGE_ALERTS.idFromName('still-public-rpc-budget-v1'));
export async function reservePublicRpc(env:PublicRpcBudgetEnv,count:number,deadline=Date.now()+2500):Promise<PublicRpcReservation>{
 if(!env.RANGE_ALERTS||deadline<=Date.now())return unavailable();
 try{
  const response=await inbox(env)!.fetch(new Request('https://public-rpc-budget.internal/public-rpc/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({count}),signal:AbortSignal.timeout(Math.max(1,Math.min(2500,deadline-Date.now())))}));
  if(!response.ok)return unavailable();const value=await response.json() as PublicRpcReservation;
  if(typeof value?.allowed!=='boolean'||!['allowed','budget','cooldown','unavailable'].includes(value.reason)||value.allowed!==(value.reason==='allowed')||(value.retryAt!==null&&!finite(value.retryAt)))return unavailable();
  if(value.allowed){if(value.retryAt!==null||!finite(value.reservedAt)||value.reservedAt>Date.now()||value.dispatchUntil!==value.reservedAt+250)return unavailable();if(Date.now()>=value.dispatchUntil)return {...unavailable(),reason:'budget',retryAt:value.reservedAt+1250};}
  else if(value.reservedAt!==null||value.dispatchUntil!==null||(value.reason!=='unavailable'&&(!finite(value.retryAt)||value.retryAt<Date.now()-1250)))return unavailable();
  return value;
 }catch{return unavailable();}
}
export async function notePublicRpcRateLimit(env:PublicRpcBudgetEnv,headers:Headers):Promise<{recorded:boolean;retryAt:number|null}>{
 if(!env.RANGE_ALERTS)return {recorded:false,retryAt:null};
 try{
  const response=await inbox(env)!.fetch(new Request('https://public-rpc-budget.internal/public-rpc/cooldown',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({retryAfter:headers.get('retry-after'),rateLimitReset:headers.get('x-ratelimit-reset')}),signal:AbortSignal.timeout(2500)}));
  const value=await response.json() as {recorded:boolean;retryAt:number|null};return response.ok&&value.recorded===true&&finite(value.retryAt)?value:{recorded:false,retryAt:null};
 }catch{return {recorded:false,retryAt:null};}
}
