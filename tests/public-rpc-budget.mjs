import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'still-rpc-budget-'));
await build({entryPoints:['src/public-rpc-budget.ts','src/solana-read-rpc.ts'],bundle:true,platform:'node',format:'esm',outdir:dir});
const {reservePublicRpcBudget,cooldownPublicRpcBudget,publicRpcBudgetRequest,reservePublicRpc,notePublicRpcRateLimit}=await import(join(dir,'public-rpc-budget.js'));
const {createSolanaReadRpc,ONFINALITY_SOLANA_READ_RPC:URL,SOLANA_MAINNET_GENESIS:GENESIS}=await import(join(dir,'solana-read-rpc.js'));
const RealDate=Date,realTimeout=globalThis.setTimeout;let clock=Date.UTC(2026,9,11,15);
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
class State{
 values=new Map();tail=Promise.resolve();failRead=false;failWrite=false;
 storage={get:async key=>{if(this.failRead)throw Error('unavailable');return structuredClone(this.values.get(key));},put:async(key,value)=>{if(this.failWrite)throw Error('unavailable');this.values.set(key,structuredClone(value));}};
 blockConcurrencyWhile(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
}
const envFor=(state,inspect=()=>{})=>({RANGE_ALERTS:{idFromName:name=>{assert.equal(name,'still-public-rpc-budget-v1');return name;},get:()=>({fetch:async request=>{inspect(request);return publicRpcBudgetRequest(state,request);}})}});
const req=(method,id=1)=>({jsonrpc:'2.0',id,method,params:method==='getBlockTime'?[123]:[]});
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
try{
 const state=new State(),a=envFor(state),b=envFor(state),start=clock;
 const burst=await Promise.all(Array.from({length:20},(_,i)=>reservePublicRpc(i%2?a:b,1)));
 assert.equal(burst.filter(x=>x.allowed).length,4);assert.ok(burst.filter(x=>!x.allowed).every(x=>x.retryAt===start+1250));
 assert.ok(burst.filter(x=>x.allowed).every(x=>x.reservedAt===start&&x.dispatchUntil===start+250));
 clock+=1000;assert.equal((await reservePublicRpc(a,1)).allowed,false,'dispatch grace remains held beyond the provider second');
 clock+=250;assert.equal((await reservePublicRpc(a,4)).allowed,true);
 let weighted=reservePublicRpcBudget(undefined,3,clock);assert.equal(reservePublicRpcBudget(weighted.state,2,clock).reservation.allowed,false);assert.equal(reservePublicRpcBudget(weighted.state,1,clock).reservation.allowed,true);
 let history;const sends=[];
 for(let step=0;step<20000;step+=17){const count=step%4+1,next=reservePublicRpcBudget(history,count,start+step);history=next.state;if(next.reservation.allowed)sends.push(...Array.from({length:count},()=>start+step+(step%2?249:0)));}
 sends.sort((a,b)=>a-b);for(const at of sends)assert.ok(sends.filter(t=>t>at-1000&&t<=at).length<=4,'delayed dispatches remain <=4 methods in every rolling second');
 const delayedState=new State(),delayed=envFor(delayedState);const normalFetch=delayed.RANGE_ALERTS.get;
 delayed.RANGE_ALERTS.get=()=>({fetch:async request=>{const response=await normalFetch().fetch(request);clock+=251;return response;}});
 const late=await reservePublicRpc(delayed,4);assert.equal(late.allowed,false);assert.equal(late.reason,'budget');assert.equal((await reservePublicRpc(envFor(delayedState),1)).allowed,false,'expired grants are never released early');
 const future={RANGE_ALERTS:{idFromName:()=>'',get:()=>({fetch:async()=>Response.json({allowed:true,reason:'allowed',retryAt:null,reservedAt:clock+1,dispatchUntil:clock+251})})}};
 assert.equal((await reservePublicRpc(future,1)).reason,'unavailable');
 const cooldown=await notePublicRpcRateLimit(a,new Headers({'retry-after':'7200','authorization':'never-forward'}));assert.equal(cooldown.retryAt,clock+7200000);
 assert.equal((await reservePublicRpc(envFor(state),1)).reason,'cooldown');assert.equal((await notePublicRpcRateLimit(b,new Headers())).retryAt,cooldown.retryAt);
 const saved=[...state.values.values()][0];assert.equal(saved.attempts,1,'concurrent in-flight rate limits are one incident');
 assert.equal(cooldownPublicRpcBudget(undefined,{retryAfter:new RealDate(clock+180000).toUTCString()}).cooldownUntil,Math.floor((clock+180000)/1000)*1000);
 for(const flag of ['failRead','failWrite']){const broken=new State();broken[flag]=true;assert.equal((await reservePublicRpc(envFor(broken),1)).reason,'unavailable');}
 assert.equal((await reservePublicRpc({},1)).allowed,false);
 assert.equal(reservePublicRpcBudget({...saved,updatedAt:clock+1},1,clock).reservation.allowed,false,'future stored state fails closed');
 assert.equal(await publicRpcBudgetRequest(state,new Request('https://internal/other')),null);
 assert.equal((await publicRpcBudgetRequest(state,new Request('https://internal/public-rpc/reserve'))).status,405);
 assert.equal((await publicRpcBudgetRequest(state,new Request('https://internal/public-rpc/reserve',{method:'POST',body:JSON.stringify({count:5})}))).status,400);
 const privateState=new State();let posted;
 await notePublicRpcRateLimit(envFor(privateState,r=>posted=r.clone()),new Headers({'retry-after':'60','x-api-key':'never-forward','authorization':'never-forward'}));
 assert.deepEqual(await posted.json(),{retryAfter:'60',rateLimitReset:null});assert.deepEqual([...posted.headers.keys()],['content-type']);

 // Accelerated deterministic queue clock. No real provider traffic occurs.
 globalThis.setTimeout=(fn,delay,...args)=>realTimeout(()=>{clock+=Number(delay)||0;fn(...args);},0);
 const wire=[];let failure=null;
 const fetcher=async(url,options)=>{assert.equal(url,URL);const body=JSON.parse(options.body),requests=Array.isArray(body)?body:[body];wire.push({at:clock,methods:requests.map(x=>x.method)});if(failure)return new Response('rate limit',{status:429,headers:{'retry-after':failure}});return Response.json((Array.isArray(body)?requests:[requests[0]]).map(r=>({jsonrpc:'2.0',id:r.id,result:r.method==='getGenesisHash'?GENESIS:123})));};
 const wireState=new State(),wireEnv=envFor(wireState),rpc=createSolanaReadRpc({fetcher,now:()=>clock});
 assert.equal((await rpc(URL,init(req('getSlot')))).status,503);assert.equal(wire.length,0,'public OnFinality without a shared binding fails closed');
 const nine=Array.from({length:9},(_,i)=>req('getSlot',i+1));const output=await rpc(URL,init(nine),{env:wireEnv,deadline:clock+8000}).then(r=>r.json());
 assert.deepEqual(output.map(r=>r.id),nine.map(r=>r.id));assert.deepEqual(wire.map(r=>r.methods.length),[4,4,2],'genesis is counted and large batches are bounded chunks');
 const dispatched=wire.flatMap(r=>r.methods.map(()=>r.at));for(const at of dispatched)assert.ok(dispatched.filter(t=>t>at-1000&&t<=at).length<=4);
 assert.equal(wire.flatMap(r=>r.methods).filter(m=>m==='getGenesisHash').length,1);
 const previous=wire.length,short=createSolanaReadRpc({fetcher,now:()=>clock});assert.equal((await short(URL,init(nine),{env:wireEnv,deadline:clock+50})).status,503);assert.equal(wire.length,previous,'insufficient queue deadline sends no ungranted request');
 clock+=1250;const lateDispatch=createSolanaReadRpc({fetcher,now:()=>clock});const beforeLate=wire.length;assert.equal((await lateDispatch(URL,init(req('getSlot')),{env:wireEnv,onRequest:()=>{clock+=251;}})).status,503);assert.equal(wire.length,beforeLate,'slow callbacks cannot dispatch an expired grant');
 clock+=1250;const deadlineDispatch=createSolanaReadRpc({fetcher,now:()=>clock});const beforeDeadline=wire.length;await assert.rejects(deadlineDispatch(URL,init(req('getSlot')),{env:wireEnv,deadline:clock+100,onRequest:()=>{clock+=101;}}),/deadline/);assert.equal(wire.length,beforeDeadline);
 clock+=1250;failure='7200';const limited=createSolanaReadRpc({fetcher,now:()=>clock});assert.equal((await limited(URL,init(req('getSlot')),{env:wireEnv})).status,429);const count=wire.length;
 const anotherIsolate=createSolanaReadRpc({fetcher,now:()=>clock});const blocked=await anotherIsolate(URL,init(req('getSlot')),{env:envFor(wireState)});assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'7200');assert.equal(wire.length,count,'provider cooldown is shared across distinct RPC wrapper isolates');
 const headerCalls=[],headerRpc=createSolanaReadRpc({now:()=>clock,fetcher:async(url,options)=>{headerCalls.push({url,options});const body=JSON.parse(options.body),rows=Array.isArray(body)?body:[body];return Response.json(rows.map(r=>({jsonrpc:'2.0',id:r.id,result:r.method==='getGenesisHash'?GENESIS:123})));}});
 const diagnostic={...init(req('getSlot')),headers:{'content-type':'application/json','x-sdk-diagnostic':'version-1'}};
 assert.equal((await headerRpc(URL,diagnostic)).status,503);assert.equal(headerCalls.length,0,'unexpected diagnostic headers cannot bypass missing shared budget');
 assert.equal((await headerRpc(URL,diagnostic,{env:envFor(new State())})).status,200);assert.equal(new Headers(headerCalls[0].options.headers).has('x-sdk-diagnostic'),false);
 for(const name of ['authorization','x-api-key','cookie','x-access-token']){const before=headerCalls.length;assert.equal((await headerRpc(URL,{...init(req('getSlot')),headers:{[name]:'synthetic-secret'}},{env:envFor(new State())})).status,503);assert.equal(headerCalls.length,before,'credential-bearing fixed public requests fail closed');}
 const keyedUrl=URL+'?api-key=synthetic-secret',keyedInit={...init(req('getSlot')),headers:{authorization:'synthetic-secret'}};await headerRpc(keyedUrl,keyedInit);assert.equal(headerCalls.at(-1).url,keyedUrl);assert.equal(headerCalls.at(-1).options,keyedInit,'explicit keyed/custom endpoint behavior is preserved');
 console.log('Public RPC budget: atomic weighted limits, late-grant expiry, actual-send rolling bounds, chunked proof, cross-isolate cooldown, private transport and deadline/abort boundaries passed.');
}finally{globalThis.Date=RealDate;globalThis.setTimeout=realTimeout;await rm(dir,{recursive:true,force:true});}
