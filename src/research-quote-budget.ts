import {dataInbox} from './data-budget';

// The same durable singleton serves every Worker isolate and browser. These are
// public research GET allowances, never transaction authorizations.
// https://developers.jup.ag/docs/portal/rate-limits: keyless api.jup.ag is
// 30 requests in a rolling60s window, shared by Quote and Price reads.
export const RESEARCH_JUPITER_BUDGET=Object.freeze({requestsPerMinute:30,capacity:30,backoffBaseMs:30000,backoffMaxMs:900000});
export interface ResearchJupiterBudgetState {tokens:number;refilledAt:number;cooldownUntil:number;attempts:number;last429At:number;recentReservations?:number[]}
export interface ResearchJupiterReservation {allowed:boolean;reason:'allowed'|'budget'|'cooldown'|'unavailable';retryAt:number|null}
interface BudgetPolicy {requestsPerMinute:number;capacity:number;backoffBaseMs:number;backoffMaxMs:number}
type BudgetEnvironment={RANGE_ALERTS?:DurableObjectNamespace};
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const unavailable=():ResearchJupiterReservation=>({allowed:false,reason:'unavailable',retryAt:null});
function stateAt(previous:ResearchJupiterBudgetState|undefined,now:number,policy:BudgetPolicy):ResearchJupiterBudgetState {
 const valid=previous&&number(previous.tokens)&&previous.tokens>=0&&number(previous.refilledAt)&&previous.refilledAt<=now&&number(previous.cooldownUntil)&&number(previous.attempts)&&previous.attempts>=0&&number(previous.last429At);
 if(!valid)return previous?{tokens:0,refilledAt:now,cooldownUntil:now+60000,attempts:0,last429At:0,recentReservations:Array.from({length:policy.requestsPerMinute},()=>now)}:{tokens:policy.capacity,refilledAt:now,cooldownUntil:0,attempts:0,last429At:0,recentReservations:[]};
 const recent=previous.recentReservations;
 // Upgrade old token-bucket state conservatively: spent capacity may still
 // fall inside the provider window. Corrupt history never grants a fresh burst.
 const usable=Array.isArray(recent)&&recent.length<=policy.requestsPerMinute&&recent.every(at=>number(at)&&at<=now);
 const migrated=recent===undefined&&previous.refilledAt<=now-60000?0:policy.requestsPerMinute;
 const recentReservations=usable?recent.filter(at=>at>now-60000):Array.from({length:migrated},()=>now);
 return {...previous,tokens:Math.min(policy.capacity,previous.tokens+(now-previous.refilledAt)*policy.requestsPerMinute/60000),refilledAt:now,recentReservations};
}
export function reserveJupiterBudget(previous:ResearchJupiterBudgetState|undefined,now=Date.now(),policy:BudgetPolicy=RESEARCH_JUPITER_BUDGET){
 const state=stateAt(previous,now,policy);
 if(state.cooldownUntil>now)return {state,reservation:{allowed:false,reason:'cooldown',retryAt:state.cooldownUntil} as ResearchJupiterReservation};
 const recent=state.recentReservations||[];
 // Jupiter keyless access is a pure 30-request rolling60s window. Keeping
 // this guard alongside the bucket prevents refill from doubling a burst.
 if(recent.length>=policy.requestsPerMinute)return {state,reservation:{allowed:false,reason:'budget',retryAt:Math.min(...recent)+60000} as ResearchJupiterReservation};
 if(state.tokens<1)return {state,reservation:{allowed:false,reason:'budget',retryAt:now+Math.ceil((1-state.tokens)*60000/policy.requestsPerMinute)} as ResearchJupiterReservation};
 state.tokens-=1;state.recentReservations=[...recent,now];
 return {state,reservation:{allowed:true,reason:'allowed',retryAt:null} as ResearchJupiterReservation};
}
export function coolDownJupiterBudget(previous:ResearchJupiterBudgetState|undefined,headers:{retryAfter?:string|null;rateLimitReset?:string|null},now=Date.now(),policy:BudgetPolicy=RESEARCH_JUPITER_BUDGET){
 const state=stateAt(previous,now,policy);
 // Concurrent in-flight 429s belong to one incident, not eight independent
 // exponential steps. A later 429 after the cooldown increments the backoff.
 const attempts=state.cooldownUntil>now?Math.max(1,state.attempts):Math.min(16,state.attempts+1);
 const seconds=Number(headers.retryAfter),date=number(seconds)&&headers.retryAfter?.trim()?NaN:Date.parse(headers.retryAfter||''),reset=Number(headers.rateLimitReset)*1000;
 const serverUntil=Math.max(number(seconds)&&seconds>0?now+seconds*1000:0,number(date)?date:0,number(reset)&&reset>now?reset:0);
 const exponential=now+Math.min(policy.backoffMaxMs,policy.backoffBaseMs*2**(attempts-1));
 return {...state,attempts,last429At:now,cooldownUntil:Math.max(state.cooldownUntil,exponential,serverUntil)};
}

// Called only through the existing private Durable Object binding. Neither this
// endpoint nor the provider credentials are exposed as a Worker HTTP route.
export async function researchJupiterBudgetRequest(ctx:DurableObjectState,request:Request):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 if(path!=='/jupiter/reserve'&&path!=='/jupiter/cooldown')return null;
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let headers:{retryAfter?:string|null;rateLimitReset?:string|null}={};
 if(path==='/jupiter/cooldown'){
  try{const body=await request.json() as typeof headers;if(!body||typeof body!=='object'||Object.values(body).some(v=>v!==null&&(typeof v!=='string'||v.length>128)))return reply({error:'Invalid provider cooldown'},400);headers={retryAfter:body.retryAfter,rateLimitReset:body.rateLimitReset};}catch{return reply({error:'Invalid provider cooldown'},400);}
 }
 try{return await ctx.blockConcurrencyWhile(async()=>{
  const previous=await ctx.storage.get<ResearchJupiterBudgetState>('research-jupiter-budget');
  if(path==='/jupiter/cooldown'){
   const state=coolDownJupiterBudget(previous,headers);await ctx.storage.put('research-jupiter-budget',state);
   return reply({recorded:true,retryAt:state.cooldownUntil});
  }
  const {state,reservation}=reserveJupiterBudget(previous);await ctx.storage.put('research-jupiter-budget',state);
  return reply(reservation);
 });}catch{return reply(path==='/jupiter/reserve'?unavailable():{recorded:false,retryAt:null},503);}
}
export async function reserveResearchJupiter(env:BudgetEnvironment):Promise<ResearchJupiterReservation>{
 if(!env.RANGE_ALERTS)return unavailable();
 try{
  const response=await dataInbox(env.RANGE_ALERTS).fetch(new Request('https://research-budget.internal/jupiter/reserve',{method:'POST',signal:AbortSignal.timeout(2500)}));
  if(!response.ok)return unavailable();const value=await response.json() as ResearchJupiterReservation;
  if(typeof value?.allowed!=='boolean'||!['allowed','budget','cooldown','unavailable'].includes(value.reason)||(value.retryAt!==null&&!number(value.retryAt))||value.allowed!==(value.reason==='allowed'))return unavailable();
  return value;
 }catch{return unavailable();}
}
export async function noteResearchJupiterRateLimit(env:BudgetEnvironment,headers:Headers):Promise<{recorded:boolean;retryAt:number|null}>{
 if(!env.RANGE_ALERTS)return {recorded:false,retryAt:null};
 try{
  const response=await dataInbox(env.RANGE_ALERTS).fetch(new Request('https://research-budget.internal/jupiter/cooldown',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({retryAfter:headers.get('retry-after'),rateLimitReset:headers.get('x-ratelimit-reset')}),signal:AbortSignal.timeout(2500)}));
  if(!response.ok)return {recorded:false,retryAt:null};const value=await response.json() as {recorded:boolean;retryAt:number|null};
  return value?.recorded===true&&number(value.retryAt)?value:{recorded:false,retryAt:null};
 }catch{return {recorded:false,retryAt:null};}
}
