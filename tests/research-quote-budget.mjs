import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'lp-research-budget-'));
await build({entryPoints:['src/research-quote-budget.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'budget.mjs')});
const {reserveJupiterBudget,coolDownJupiterBudget,researchJupiterBudgetRequest,reserveResearchJupiter,noteResearchJupiterRateLimit}=await import(pathToFileURL(join(dir,'budget.mjs')));
const RealDate=Date,initial=RealDate.parse('2026-09-30T21:00:00Z');let clock=initial;
class ClockDate extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
globalThis.Date=ClockDate;
class State {
 values=new Map();tail=Promise.resolve();failedRead=false;failedWrite=false;reads=0;writes=0;
 storage={get:async key=>{this.reads++;await Promise.resolve();if(this.failedRead)throw Error('storage unavailable');return structuredClone(this.values.get(key));},put:async(key,value)=>{this.writes++;await Promise.resolve();if(this.failedWrite)throw Error('storage unavailable');this.values.set(key,structuredClone(value));}};
 blockConcurrencyWhile(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
}
const environment=(state,requests=[])=>({RANGE_ALERTS:{idFromName:name=>{assert.equal(name,'pat-data-budget-v1');return name;},get:id=>{assert.equal(id,'pat-data-budget-v1');return {fetch:async request=>{requests.push({path:new URL(request.url).pathname,method:request.method,headers:Object.fromEntries(request.headers)});return researchJupiterBudgetRequest(state,request);}};}}});
try{
 // Separate caller environments still reserve through one atomic shared writer.
 const state=new State(),first=environment(state),second=environment(state);
 const burst=await Promise.all(Array.from({length:50},(_,i)=>reserveResearchJupiter(i%2?first:second)));
 assert.equal(burst.filter(r=>r.allowed).length,30);assert.equal(burst.filter(r=>r.reason==='budget').length,20);
 assert.ok(burst.filter(r=>!r.allowed).every(r=>r.retryAt===initial+60000));
 clock+=1000;assert.equal((await reserveResearchJupiter(first)).allowed,false,'half a replenished allowance must not become a full request');
 clock+=1000;assert.equal((await reserveResearchJupiter(second)).allowed,false,'token refill must not bypass the rolling window');assert.equal((await reserveResearchJupiter(first)).allowed,false,'the allowance is shared, not local to a caller');
 clock+=60000;const replenished=await Promise.all(Array.from({length:35},()=>reserveResearchJupiter(first)));assert.equal(replenished.filter(r=>r.allowed).length,30,'idle time may refill only to the configured capacity');
 // A server cooldown is global, survives a new caller and honors Retry-After.
 const cooldown=await noteResearchJupiterRateLimit(first,new Headers({'retry-after':'180','x-api-key':'must-never-cross-the-budget'}));assert.equal(cooldown.recorded,true);assert.equal(cooldown.retryAt,clock+180000);
 const other=environment(state),denied=await reserveResearchJupiter(other);assert.equal(denied.reason,'cooldown');assert.equal(denied.retryAt,cooldown.retryAt);
 await noteResearchJupiterRateLimit(second,new Headers());assert.equal(state.values.get('research-jupiter-budget').attempts,1,'parallel in-flight 429s are one incident');
 clock=cooldown.retryAt;assert.equal((await reserveResearchJupiter(other)).allowed,true);
 const repeated=await noteResearchJupiterRateLimit(other,new Headers());assert.equal(repeated.retryAt,clock+60000);assert.equal(state.values.get('research-jupiter-budget').attempts,2);
 clock=repeated.retryAt;const dated=await noteResearchJupiterRateLimit(first,new Headers({'retry-after':new RealDate(clock+600000).toUTCString(),'x-ratelimit-reset':String((clock+660000)/1000)}));assert.equal(dated.retryAt,clock+660000);
 // A provider-specified longer wait is retained, not capped to the local backoff.
 const long=coolDownJupiterBudget(undefined,{retryAfter:'7200'},clock);assert.equal(long.cooldownUntil,clock+7200000);
 const configurable=reserveJupiterBudget(undefined,clock,{requestsPerMinute:10,capacity:2,backoffBaseMs:1000,backoffMaxMs:60000});assert.equal(configurable.state.tokens,1);
 const oldState={tokens:0,refilledAt:clock,cooldownUntil:0,attempts:0,last429At:0};assert.equal(reserveJupiterBudget(oldState,clock).reservation.allowed,false,'old spent budget migrates conservatively');
 const refilledLegacy={...oldState,tokens:14,refilledAt:clock};assert.equal(reserveJupiterBudget(refilledLegacy,clock).reservation.allowed,false,'legacy refill cannot reconstruct past window usage: reserve a full conservative window');assert.equal(reserveJupiterBudget({...oldState,refilledAt:clock-60001},clock).reservation.allowed,true,'an old idle legacy state has no recent calls');assert.equal(reserveJupiterBudget({...oldState,refilledAt:clock+1},clock).reservation.allowed,false,'future stored state fails closed');
 const corruptHistory={...oldState,tokens:30,recentReservations:[NaN]};assert.equal(reserveJupiterBudget(corruptHistory,clock).reservation.allowed,false,'corrupt history does not grant a fresh burst');
 let paced;const accepted=[];for(let t=0;t<240000;t+=137){const next=reserveJupiterBudget(paced,clock+t);paced=next.state;if(next.reservation.allowed)accepted.push(clock+t);assert.ok(accepted.filter(at=>at>clock+t-60000).length<=30,'every rolling60s window is bounded');}
 // Missing bindings, transport failures, corrupt replies and storage errors fail closed.
 assert.deepEqual(await reserveResearchJupiter({}),{allowed:false,reason:'unavailable',retryAt:null});
 const failing={RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:()=>{throw Error('unavailable');}})}};assert.equal((await reserveResearchJupiter(failing)).allowed,false);
 const corrupt={RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:async()=>new Response(JSON.stringify({allowed:true,reason:'budget',retryAt:null}))})}};assert.equal((await reserveResearchJupiter(corrupt)).reason,'unavailable');
 const readFailure=new State();readFailure.failedRead=true;assert.equal((await reserveResearchJupiter(environment(readFailure))).reason,'unavailable');
 const writeFailure=new State();writeFailure.failedWrite=true;assert.equal((await reserveResearchJupiter(environment(writeFailure))).reason,'unavailable');assert.equal(writeFailure.values.size,0,'a reservation is allowed only once durably saved');
 const requests=[];await noteResearchJupiterRateLimit(environment(new State(),requests),new Headers({'retry-after':'90','authorization':'private','x-api-key':'private'}));assert.deepEqual(requests[0],{path:'/jupiter/cooldown',method:'POST',headers:{'content-type':'application/json'}},'only provider wait hints cross the internal binding');
 assert.equal(await researchJupiterBudgetRequest(new State(),new Request('https://internal/another')),null);
 assert.equal((await researchJupiterBudgetRequest(new State(),new Request('https://internal/jupiter/reserve'))).status,405);
 assert.equal((await researchJupiterBudgetRequest(new State(),new Request('https://internal/jupiter/cooldown',{method:'POST',body:'bad json'}))).status,400);
 console.log('Shared Jupiter budget: concurrent reservations, bounded refill, cross-isolate Retry-After/exponential cooldown, private transport and fail-closed storage passed.');
}finally{globalThis.Date=RealDate;await rm(dir,{recursive:true,force:true});}
