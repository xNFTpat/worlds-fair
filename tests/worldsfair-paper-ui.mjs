import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/worldsfair-paper.js';

const {createClient:rawClient,previewProfit,performanceNet,rollEligible,mergeSnapshot}=globalThis.WorldsFairPaper;
const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};};
const createClient=(options={})=>rawClient({...options,storage:options.storage===undefined?memoryStorage():options.storage});
const now='2026-10-05T12:00:00.000Z';
const close={id:'fleet:farmer:fixture',closedAt:now,arm:'farmer',pnlSol:.123456789,profitRoll:{eligible:true,claimed:false}};
assert.equal(rollEligible(close),true);
for(const changed of [{arm:'sample'},{arm:'active'},{pnlSol:0},{pnlSol:-1},{pnlSol:NaN},{closedAt:'bad'},{profitRoll:undefined},{profitRoll:{eligible:false,claimed:false}},{profitRoll:{eligible:true,claimed:true}}])assert.equal(rollEligible({...close,...changed}),false);
assert.equal(previewProfit(.123456789,50),.061728394,'The preview floors to whole lamports');
assert.equal(previewProfit(.1,100),.1);assert.equal(previewProfit(.000000001,50),0);
for(const invalid of [null,NaN,Infinity,-1,0])assert.equal(previewProfit(invalid,50),null);
for(const invalid of [null,NaN,Infinity,-1,0,100.1,101])assert.equal(previewProfit(1,invalid),null);
assert.equal(performanceNet({equitySol:9,performanceEquitySol:11,seedSol:10}),1,'Performance adds withdrawn profit back to equity without changing available assets');
assert.equal(performanceNet({equitySol:9,performanceEquitySol:null,seedSol:10}),null,'An incomplete performance value stays incomplete');
assert.equal(performanceNet({equitySol:11,seedSol:10}),1);

const calls=[],requests=new Map();let balance=0,initializations=0,uuidCount=0,failFirstSeed=true;
const account=()=>({paper:true,account:{balanceSol:balance,holdings:[],revision:requests.size,seededSol:balance,rolledProfitSol:0},history:[],cursor:null,persistence:'saved'});
const fetcher=async(path,init)=>{
  calls.push({path,init});assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');
  if(path==='/api/paper/account'){initializations++;return Response.json(account());}
  if(path.startsWith('/api/paper/history'))return Response.json({history:[],cursor:null});
  const body=JSON.parse(init.body);
  assert.equal(init.method,'POST');assert.equal(init.headers['content-type'],'application/json');
  if(path==='/api/paper/seed'){
    if(!requests.has(body.requestId)){balance+=Number(body.amountSol);requests.set(body.requestId,account());}
    if(failFirstSeed){failFirstSeed=false;throw Error('Connection interrupted after save');}
    return Response.json(requests.get(body.requestId));
  }
  if(path==='/api/paper/roll')return Response.json({...account(),receipt:{id:body.requestId,kind:'roll'}});
  throw Error('Unexpected endpoint '+path);
};
const client=createClient({fetch:fetcher,uuid:()=>`fixture-request-${++uuidCount}`});
await assert.rejects(client.write('seed',{amountSol:'1'}),/Connection interrupted/);
assert.equal(calls[0].path,'/api/paper/account','A session is established before the first write');
assert.equal(balance,1);assert.equal(client.busy,false);
const retried=await client.write('seed',{amountSol:'1'});
assert.equal(retried.account.balanceSol,1);assert.equal(balance,1,'Retrying an ambiguous save must not create a second seed');
assert.equal(uuidCount,1,'The same pending seed keeps its idempotency key');
const seedCalls=calls.filter(call=>call.path==='/api/paper/seed');
assert.equal(JSON.parse(seedCalls[0].init.body).requestId,JSON.parse(seedCalls[1].init.body).requestId);
await client.write('seed',{amountSol:'1'});assert.equal(balance,2);assert.equal(uuidCount,2,'A confirmed subsequent action is a new request');
assert.equal(initializations,1,'Writes reuse the established cookie session');
await client.write('roll',{source:'fleet',id:close.id,closedAt:close.closedAt,percent:50});
const roll=JSON.parse(calls.at(-1).init.body);
assert.deepEqual(Object.keys(roll).sort(),['source','id','closedAt','percent','requestId'].sort(),'The client does not send a claimed profit or transfer amount');
assert.equal(roll.percent,50);await client.history('next page');assert.equal(calls.at(-1).path,'/api/paper/history?cursor=next%20page');
await assert.rejects(client.write('swap',{}),/unavailable/);

let finish;const gate=new Promise(resolve=>{finish=resolve;});let posts=0;
const busyClient=createClient({uuid:()=> 'single-action',fetch:async(path,init)=>{
  if(path==='/api/paper/account')return Response.json(account());
  posts++;await gate;return Response.json(account());
}});
await busyClient.account();const pending=busyClient.write('seed',{amountSol:'1'});
assert.equal(busyClient.busy,true);await assert.rejects(busyClient.write('seed',{amountSol:'1'}),/already being saved/);
assert.equal(posts,1,'Double-clicks cannot dispatch another paper mutation');finish();await pending;assert.equal(busyClient.busy,false);

let initFinish;const initGate=new Promise(resolve=>{initFinish=resolve;});let reads=0;
const simultaneous=createClient({fetch:async()=>{reads++;await initGate;return Response.json(account());}});
const first=simultaneous.account(),second=simultaneous.account();initFinish();await Promise.all([first,second]);assert.equal(reads,1,'Concurrent account reads share one cookie initialization');

// A reload must recover a request even when a different amount was attempted
// in between. Only request intent and its key may live in session storage.
const reloadStorage=memoryStorage(),reloadLedger=new Map(),reloadLost=new Set();let reloadBalance=0,reloadIds=0;
const reloadFetch=async(path,init)=>{
  if(path==='/api/paper/account')return Response.json({account:{balanceSol:reloadBalance,revision:reloadLedger.size},history:[]});
  const body=JSON.parse(init.body);
  if(!reloadLedger.has(body.requestId)){reloadBalance+=Number(body.amountSol);reloadLedger.set(body.requestId,{account:{balanceSol:reloadBalance,revision:reloadLedger.size+1},history:[{id:body.requestId}]});}
  if(!reloadLost.has(body.requestId)){reloadLost.add(body.requestId);throw Error('Saved before connection loss');}
  return Response.json(reloadLedger.get(body.requestId));
};
const reloadClient=()=>createClient({storage:reloadStorage,fetch:reloadFetch,uuid:()=>`reload-${++reloadIds}`});
await assert.rejects(reloadClient().write('seed',{amountSol:'1'}),/connection loss/);
assert.equal(reloadBalance,1);assert.equal(reloadClient().pending.length,1);
await assert.rejects(reloadClient().write('seed',{amountSol:'2'}),/connection loss/);
assert.equal(reloadBalance,3);assert.equal(reloadClient().pending.length,2,'Changing the payload retains the earlier unresolved ID');
await reloadClient().write('seed',{amountSol:'1'});
assert.equal(reloadBalance,3);assert.equal(reloadIds,2,'Reload + original amount reuses its first ID');
assert.equal(reloadClient().pending.length,1);
await reloadClient().write('seed',{amountSol:'2'});assert.equal(reloadBalance,3);assert.equal(reloadClient().pending.length,0);
const metadata=JSON.parse(reloadStorage.getItem('worldsfair:paper-pending:v1'));assert.deepEqual(metadata,[]);

const rejectedStorage=memoryStorage();const rejected=createClient({storage:rejectedStorage,fetch:async path=>path==='/api/paper/account'?Response.json(account()):Response.json({error:'Amount rejected'},{status:400})});
await assert.rejects(rejected.write('seed',{amountSol:'bad'}),/Amount rejected/);assert.equal(rejected.pending.length,0,'Definitive client rejection clears pending metadata');
const temporary=createClient({storage:rejectedStorage,fetch:async path=>path==='/api/paper/account'?Response.json(account()):Response.json({error:'Temporary outage'},{status:503})});
await assert.rejects(temporary.write('seed',{amountSol:'3'}),/Temporary outage/);assert.equal(temporary.pending.length,1,'A server error preserves the same retry ID');
const savedIntent=JSON.parse(rejectedStorage.getItem('worldsfair:paper-pending:v1'))[0];
assert.deepEqual(Object.keys(savedIntent).sort(),['action','payload','requestId']);assert.doesNotMatch(JSON.stringify(savedIntent),/balanceSol|history|holdings|revision/);
let unavailablePosts=0;const noStorage=createClient({storage:null,fetch:async()=>{unavailablePosts++;return Response.json(account());}});
await assert.rejects(noStorage.write('seed',{amountSol:'1'}),/session storage/);assert.equal(unavailablePosts,0,'A request is not dispatched when its retry ID cannot survive a reload');
const bounded=createClient({fetch:async path=>path==='/api/paper/account'?Response.json(account()):Promise.reject(Error('offline'))});
for(let i=1;i<=32;i++)await assert.rejects(bounded.write('seed',{amountSol:String(i)}),/offline/);
await assert.rejects(bounded.write('seed',{amountSol:'33'}),/earlier pending/);assert.equal(bounded.pending.length,32,'The bound refuses new actions instead of evicting unresolved IDs');

// An earlier GET completing after a saved mutation cannot undo its visible
// account revision, new receipt, or pagination cursor.
let visible={accountData:{account:{revision:0,balanceSol:0}},events:[],cursor:null},finishOld;
const oldRead=new Promise(resolve=>{finishOld=resolve;}).then(data=>{visible=mergeSnapshot(visible,data);});
visible=mergeSnapshot(visible,{account:{revision:1,balanceSol:1},history:[{id:'saved-seed'}],cursor:'new-cursor'});
finishOld({account:{revision:0,balanceSol:0},history:[],cursor:null});await oldRead;
assert.equal(visible.accountData.account.balanceSol,1);assert.deepEqual(visible.events,[{id:'saved-seed'}]);assert.equal(visible.cursor,'new-cursor');
assert.equal(mergeSnapshot(visible,{account:{balanceSol:0},history:[]}),visible,'An undated revision cannot replace a known revision');
visible=mergeSnapshot(visible,{history:[{id:'older-seed'}],cursor:null},true);assert.equal(visible.events.length,2);assert.equal(visible.accountData.account.balanceSol,1);

const [source,index,fleet]=await Promise.all(['public/worldsfair-paper.js','public/index.html','public/paper-fleet.js'].map(path=>readFile(path,'utf8')));
assert.doesNotMatch(source,/localStorage/);assert.match(source,/worldsfair:paper-pending:v1/);
assert.match(source,/data-paper-recover/,'Unresolved actions can be recovered after reload');
assert.match(source,/type="range" min="1" max="100" step="1" value="'\+\(enabled\?'100':'50'\)/,'Disabled profit rules preserve the 50% slider default; enabled rules allocate the whole profit');
assert.match(source,/max="1000"/);assert.match(source,/A close can be rolled once across the demo/);
assert.match(index,/id="worldsfairPaperPot"/);assert.ok(index.indexOf('/worldsfair-paper.js')<index.indexOf('/paper-fleet.js'));
assert.match(fleet,/WorldsFairPaper\?\.rollButton\(t\)/);assert.match(fleet,/performanceNet\(a\)/);assert.match(fleet,/Paper profit rolled out/);
assert.doesNotMatch(source,/\/api\/(?:solana|evm|tx|paybox)\//);
console.log('PASS: paper session initialization, retry idempotency, busy lock, funded-close eligibility, lamport preview, performance withdrawals, pagination and server-owned ledger');
