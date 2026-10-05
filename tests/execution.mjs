import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), sol=require('../execution/node_modules/@solana/web3.js');
const {Keypair,TransactionMessage,VersionedTransaction,SystemProgram}=sol;
const dir=await mkdtemp(join(tmpdir(),'lp-execution-'));
await build({entryPoints:['execution/solana.ts','execution/paybox-browser.ts','src/paybox.ts','src/cesto.ts'],outdir:dir,outbase:'.',bundle:true,platform:'node',mainFields:['main'],format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},outExtension:{'.js':'.mjs'}});
const {solAmount,validSettings,verifiedTransaction}=await import(join(dir,'execution/solana.mjs'));
const {applyPayboxSignature}=await import(join(dir,'execution/paybox-browser.mjs'));
const {payboxRoute}=await import(join(dir,'src/paybox.mjs'));
const {allocations,performance,cestoData}=await import(join(dir,'src/cesto.mjs'));
assert.equal(solAmount('0.1'),100000000n);assert.equal(solAmount('0.000000001'),1n);assert.equal(solAmount('100'),100000000000n);
for(const input of ['1e-9','0','-1','100.1','0.1234567891','01','NaN',0.1])assert.throws(()=>solAmount(input));
for(const strategy of [0,1,2])assert.equal(validSettings({strategy}).strategy,strategy);
for(const input of [{strategy:3},{widthPct:0},{widthPct:51},{slippageBps:NaN},{slippageBps:301}])assert.throws(()=>validSettings(input));
const owner=Keypair.generate(),position=Keypair.generate(),wrong=Keypair.generate();
const message=new TransactionMessage({payerKey:owner.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.createAccount({fromPubkey:owner.publicKey,newAccountPubkey:position.publicKey,lamports:1,space:0,programId:SystemProgram.programId})]}).compileToV0Message();
const tx=new VersionedTransaction(message),preview={messageHex:Buffer.from(message.serialize()).toString('hex'),expiresAt:Date.now()+60000};
tx.sign([position]);const positionSignature=Buffer.from(tx.signatures[1]).toString('hex');
const {ed25519}=require('../execution/node_modules/@noble/curves/ed25519');
const artifact=who=>({output:{value:{scheme:'eddsa_ed25519',signature:{signature:Buffer.from(ed25519.sign(message.serialize(),who.secretKey.subarray(0,32))).toString('hex')}}}});
assert.throws(()=>applyPayboxSignature(tx,artifact(wrong),owner.publicKey.toBase58()),/did not match/);
const encoded=applyPayboxSignature(tx,artifact(owner),owner.publicKey.toBase58());
assert.equal(Buffer.from(tx.signatures[1]).toString('hex'),positionSignature,'Position cosignature survives wallet signing');
assert.deepEqual((await verifiedTransaction(encoded,preview)).serialize(),tx.serialize());
await assert.rejects(()=>verifiedTransaction(encoded,{...preview,expiresAt:Date.now()-1}),/expired/);
await assert.rejects(()=>verifiedTransaction(encoded,{...preview,messageHex:preview.messageHex+'00'}),/differs/);
const missing=new VersionedTransaction(message);missing.sign([owner]);await assert.rejects(()=>verifiedTransaction(Buffer.from(missing.serialize()).toString('base64'),preview),/signature/);
console.log('PASS: exact SOL units, limits, all strategies, v0 signatures, cosignature preservation, altered messages and expiry');

const store=new Map(),kv={get:async k=>store.has(k)?JSON.parse(store.get(k)):null,put:async(k,v)=>store.set(k,v),delete:async k=>store.delete(k)};
const origin='https://terminal.test',sid='a'.repeat(43),env={LP_CACHE:kv};
store.set('paybox:session:'+sid,JSON.stringify({token:'test-token-only',expiresAt:Date.now()+60000}));
const post=(path,body,extra={})=>payboxRoute(new Request(origin+path,{method:'POST',headers:{origin,cookie:'lp_paybox='+sid,'content-type':'application/json',...extra},body:JSON.stringify(body)}),env);
const original=globalThis.fetch;let calls=[];
globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/oauth/register'))return Response.json({client_id:'test-client'});return Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({request_id:'test-request'})}]}});};
try{
 assert.equal((await post('/api/paybox/connect',{}, {origin:'https://evil.test'})).status,403);
 const connect=await post('/api/paybox/connect',{}),info=await connect.json(),target=new URL(info.url);
 assert.equal(target.searchParams.get('scope'),'mcp');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.ok(connect.headers.get('set-cookie').includes('HttpOnly'));
 await post('/api/paybox/connect',{});assert.equal(calls.filter(c=>c.url.endsWith('/oauth/register')).length,1,'Reconnect reuses client to keep signing setup stable');
 const tool=(intent,extra={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'request_wallet_sign',arguments:{credential_id:'wallet',intent,...extra}}});
 assert.equal((await post('/api/paybox/mcp',tool({op:'raw',rawSigningPayloadHex:'beef'}))).status,400);
 assert.equal((await post('/api/paybox/mcp',tool({op:'solanaMessage',message:'send money'}))).status,400);
 assert.equal((await post('/api/paybox/mcp',{method:'tools/call',params:{name:'request_swap',arguments:{}}})).status,403);
 store.set('solana:preview:plan',JSON.stringify(preview));
 const allowed=await post('/api/paybox/mcp',tool({op:'raw',rawSigningPayloadHex:preview.messageHex},{_previewId:'plan'}));assert.equal(allowed.status,200);
 const forwarded=JSON.parse(calls.at(-1).options.body);assert.equal(forwarded.params.arguments._previewId,undefined);
 const recovered=await payboxRoute(new Request(origin+'/api/paybox/recover?previewId=plan',{headers:{cookie:'lp_paybox='+sid}}),env);assert.equal((await recovered.json()).requestId,'test-request');
 for(const name of ['moonx_resolve_binding','moonx_sign','submit_signature']){
   const request=(id)=>({method:'tools/call',params:{name,arguments:{request_id:id,api_pub:'public-test-value',signed_body:'test-proof',agent_signature:'test-signature'}}});
   assert.equal((await post('/api/paybox/mcp',request('unknown-request'))).status,403,'Signing UI cannot act on an unbound request');
   assert.equal((await post('/api/paybox/mcp',request('test-request'))).status,200,'Official signing UI step must reach PayBox');
   assert.equal(JSON.parse(calls.at(-1).options.body).params.name,name);
 }
 store.delete('paybox:signing:'+sid+':test-request');
 await post('/api/paybox/mcp',{method:'tools/call',params:{name:'reopen_signing_window',arguments:{request_id:'test-request'}}});
 assert.ok(store.has('paybox:signing:'+sid+':test-request'),'An existing PayBox-authorized request can recover after reload');
 assert.equal((await payboxRoute(new Request(origin+'/api/paybox/callback?code=invalid&state=wrong'),env)).status,400);
 await post('/api/paybox/disconnect',{});assert.ok(!store.has('paybox:session:'+sid));
}finally{globalThis.fetch=original;}
console.log('PASS: OAuth client reuse, PKCE, no offline scope, state/CSRF, signing allowlist, reviewed-message binding, request recovery and logout');

assert.equal(performance({tokenPerformance30d:{return:0}}).thirtyDay,0);assert.equal(performance({}).thirtyDay,null);
const basket={definition:{bucket:{mode:'parallel',nodes:[{nodeType:'swap.token',amount:{percentage:60},parameters:{toToken:'A'}},{nodeType:'swap.token',amount:{percentage:40},parameters:{toToken:'B'}}]}}};
assert.equal(allocations(basket,[{mint:'A',symbol:'ALPHA'}]).complete,true);
assert.equal(allocations({...basket,definition:{bucket:{...basket.definition.bucket,mode:'sequential'}}},[]).complete,false);
assert.equal(allocations({definition:{bucket:{mode:'parallel',nodes:[basket.definition.bucket.nodes[0]]}}},[]).complete,false);
const old=Date.now()-1000000;store.set('cesto:v1:/products',JSON.stringify({readAt:old,data:[{id:'1',name:'Test',slug:'test',isActive:true,isPublished:true}]}));
globalThis.fetch=async()=>{throw Error('Unavailable');};
try{const d=await cestoData(kv,null,true);assert.equal(d.stale,true);assert.equal(d.readAt,old);assert.equal(d.baskets[0].thirtyDay,null);}finally{globalThis.fetch=original;}
console.log('PASS: basket weights, complex allocation exclusions, real zero versus unavailable returns, and stale data retention');
for(const file of ['public/index.html','public/baskets.js']){const source=await readFile(file,'utf8');if(file.endsWith('.js'))new Function(source);else for(const script of source.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(script[1]);}
