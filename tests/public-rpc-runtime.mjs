import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'still-public-rpc-runtime-'));
const RPC='https://solana.api.onfinality.io/public',GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const bundle=await build({stdin:{contents:`
 import {WorldsfairRangeInbox} from './src/worldsfair-paper';
 import {reservePublicRpc} from './src/public-rpc-budget';
 import {solanaReadFetch,createSolanaReadRpc,ONFINALITY_SOLANA_READ_RPC} from './src/solana-read-rpc';
 export {WorldsfairRangeInbox};
 export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/permit')return Response.json(await reservePublicRpc(env,Number(url.searchParams.get('count')||1)));
  const count=Number(url.searchParams.get('count')||1),reads=Array.from({length:count},(_,i)=>({jsonrpc:'2.0',id:i+1,method:'getSlot',params:[]}));
  const reader=url.pathname==='/new-reader'?createSolanaReadRpc():solanaReadFetch;
  return reader(ONFINALITY_SOLANA_READ_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(count===1?reads[0]:reads),signal:AbortSignal.timeout(15000)},{env,deadline:Date.now()+15000});
 }};
`,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'esm',platform:'browser',write:false,alias:{util:'./tests/fixtures/worker-util.mjs'}});
let mode='valid';const calls=[];
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'still-public-rpc-runtime',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],kvNamespaces:['LP_CACHE'],durableObjects:{RANGE_ALERTS:{className:'WorldsfairRangeInbox',useSQLite:true}},bindings:{MIN_TVL_USD:'5000',WALLETS:'',SOLANA_RPC:RPC},outboundService:async request=>{
 assert.equal(request.url,RPC,'No actual provider or alternative endpoint may be reached');assert.equal(request.method,'POST');
 const body=await request.json(),rows=Array.isArray(body)?body:[body];assert(rows.length<=4);calls.push({at:Date.now(),methods:rows.map(row=>row.method)});
 if(mode==='429')return new Response('synthetic provider rate limit',{status:429,headers:{'retry-after':'30'}});
 const result=rows.map(row=>{assert(['getGenesisHash','getSlot'].includes(row.method));return {jsonrpc:'2.0',id:row.id,result:row.method==='getGenesisHash'?(mode==='wrong-chain'?'synthetic-wrong-chain':GENESIS):123456};});
 return Response.json(Array.isArray(body)?result:result[0]);
}}],durableObjectsPersist:join(dir,'do'),kvPersist:join(dir,'kv')}));
const call=path=>mf.dispatchFetch('https://still-runtime.test'+path);
try{
 await mf.ready;
 const namespace=await mf.getDurableObjectNamespace('RANGE_ALERTS'),inbox=namespace.get(namespace.idFromName('still-public-rpc-budget-v1'));
 const direct=await inbox.fetch('https://private/public-rpc/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({count:3})});
 assert.equal(direct.status,200);const grant=await direct.json();assert.equal(grant.allowed,true,JSON.stringify(grant));assert.equal(grant.dispatchUntil,grant.reservedAt+250,'Actual inherited private route grants a dated permit');
 const accepted=await (await call('/permit?count=1')).json();assert.equal(accepted.allowed,true,JSON.stringify(accepted));
 const exhausted=await (await call('/permit?count=1')).json();assert.equal(exhausted.allowed,false);assert.equal(exhausted.reason,'budget','Durable storage retains permits across direct and Worker calls');assert.equal(calls.length,0);
 let response=await call('/rpc?count=7'),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.deepEqual(data.map(row=>[row.id,row.result]),Array.from({length:7},(_,i)=>[i+1,123456]));assert.deepEqual(calls.map(row=>row.methods),[['getGenesisHash','getSlot','getSlot','getSlot'],['getSlot','getSlot','getSlot','getSlot']]);assert(calls[1].at-calls[0].at>=1000,'Actual workerd queue respects the shared rolling allowance');
 response=await call('/rpc');data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.result,123456);assert.deepEqual(calls.at(-1).methods,['getSlot'],'Only a successfully checked mainnet identity is reused');
 mode='wrong-chain';response=await call('/new-reader');data=await response.json();assert.equal(response.status,503);assert.match(data.error.message,/mainnet identity/);
 mode='429';response=await call('/new-reader');data=await response.json();assert.equal(response.status,429,JSON.stringify(data));const count=calls.length;
 mode='valid';response=await call('/new-reader');data=await response.json();assert.equal(response.status,429,JSON.stringify(data));assert.equal(calls.length,count,'Durable cooldown blocks a fresh wrapper, not just isolate-local retries');
 console.log('PASS actual workerd public RPC: WorldsfairRangeInbox private routing/storage, dated permit validation, proof-first batching, rolling allowance, identity rejection and cross-wrapper cooldown; all outbound RPC mocked');
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
