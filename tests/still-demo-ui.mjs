import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile('public/still-demo.js', 'utf8');
const lessons = await readFile('public/still-lessons.js', 'utf8');
const walletClient = await readFile('public/still-wallet-client.js','utf8');
const browserSource = walletClient.replace(/^export /gm,'') + lessons.replace(/^export /gm, '') + source.replace(/let STILL_LESSONS=\[\];\nconst loadLessons=.*?;\n/, 'const loadLessons=()=>Promise.resolve();\n').replace(/let visualAssets=null,creatorAssets=null,visualLoading=null;\nconst loadVisualAssets=.*?;\n/, 'let visualAssets=null,creatorAssets=null;const loadVisualAssets=()=>Promise.resolve();\n').replace(/^import .*from '\.\/still-(lessons|wallet-client).js';$/gm, '').replace(/^export /gm, '');
const helpers = runInNewContext(browserSource + '\n({esc,number,sol,money,netSummary,ticketSentence,groupPositions,requestFingerprint,readOnboarding,sortForPreference})', {Intl});
assert.equal(helpers.sol(null), 'Unavailable');
assert.equal(helpers.sol(0), '0 SOL');
assert.equal(helpers.sol(Infinity), 'Unavailable');
assert.equal(helpers.esc('<img src=x onerror="run()">'), '&lt;img src=x onerror=&quot;run()&quot;&gt;');
const individual = [{id:'paper:one',positionAddress:'paper:one',poolAddress:'same',name:'One'}, {id:'paper:two',positionAddress:'paper:two',poolAddress:'same',name:'One'}];
const groups = helpers.groupPositions(individual);
assert.equal(groups.length, 1); assert.equal(groups[0].positions.length, 2);
assert.equal(groups[0].positions[0], individual[0]); assert.equal(groups[0].positions[1], individual[1], 'Grouping preserves each distinct position record');

assert.equal(helpers.readOnboarding({getItem(){throw Error('blocked');}}).complete,false);
assert.equal(helpers.readOnboarding({getItem(){return '{bad';}}).preference,'balanced');
assert.equal(helpers.readOnboarding({getItem(){return '{"complete":true,"preference":"calm"}';}}).preference,'calm');
const unordered = ['Spicy','Steady','Busy'].map(label=>({risk:{label}}));
assert.equal(helpers.sortForPreference(unordered,'calm')[0].risk.label,'Steady');
assert.equal(helpers.sortForPreference(unordered,'quick')[0].risk.label,'Spicy');
assert.equal(unordered[0].risk.label,'Spicy','Sorting preferences never mutate source data');

class Element {
  innerHTML = ''; textContent = ''; hidden = false; disabled = false; value = '0.5'; dataset = {}; open = false; attributes = {}; listeners = new Map();
  addEventListener(kind, callback) {const list = this.listeners.get(kind) || []; list.push(callback); this.listeners.set(kind,list);}
  setAttribute(key,value) {this.attributes[key] = value;}
  querySelector(selector) {return selector === 'form' ? this.form : this.deposit;}
  showModal() {this.open = true;}
  close() {this.open = false;}
  focus() {this.focused = true;}
  async dispatch(kind, event = {}) {for (const callback of this.listeners.get(kind) || []) await callback(event);}
}
const flush = async () => {for(let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve));};
function fixture({initialHash="",walletPositions=[],walletStatus="available",poolFields={},additionalPools=[],initialStorage=[],preflightFields={}}={}) {
  let clock = Date.parse('2026-10-09T12:00:00.000Z'), serial = 0;
  const address = 'A'.repeat(32), requests = [], stored = new Map(initialStorage), steps = ['pools','preflight','positions','baskets'].map(go => Object.assign(new Element(),{dataset:{go}}));
  const ids = ['screen','confirmation','notice','home','journey','step-preflight','build-version','confirm-submit','confirm-cancel','confirm-error','confirm-content','paper-amount','wallet-address'];
  const elements = Object.fromEntries(ids.map(id => ['#'+id,new Element()]));
  elements['#confirmation'].form = new Element(); elements['#screen'].deposit = new Element();
  const document = new Element(); document.querySelector = selector => elements[selector]; document.querySelectorAll = () => steps;
  const window = new Element(); window.scrollTo = () => {};
  const location = {hash:initialHash,pathname:'/',search:''}; const history = {pushState(_state,_unused,hash){location.hash=hash;},replaceState(_state,_unused,hash){location.hash=hash;}};
  const evidence = value => ({value,status:value === null?'unavailable':'available',asOf:new Date(clock).toISOString(),source:'Synthetic observed source',note:'Synthetic note'});
  const pool = {address,id:'solana:'+address,name:'<img src=x onerror="run()">/SOL',binStep:evidence(100),risk:{label:'Busy',reason:'<script>not code</script>'},tvlUsd:evidence(50000),fees24hFraction:evidence(.01),feeTrend:evidence(.2),ageHours:evidence(100),priceSol:evidence(1),...poolFields};
  const account = {balanceSol:10,seededSol:10,seedNote:'Practice seed',settlementNote:'Gross model only',feeModelNote:'Modelled fees only',positions:[]};
  const preflight = () => ({poolAddress:address,name:pool.name,sizeSol:.5,fetchedAt:new Date(clock).toISOString(),canOpen:true,priceSol:evidence(1),range:{bins:[{sol:.5}],floorPriceSol:.6,topPriceSol:.95,depthFraction:.4,binCount:3,alignment:'estimated',source:'Synthetic model',asOf:new Date(clock).toISOString(),note:'No live execution'},expectedFeesPerDaySol:evidence(.001),transferFeeBps:evidence(null),entryCostSol:evidence(null),exitCostSol:evidence(null),entryConversionSol:evidence(0),exitConversionSol:evidence(null),networkCostSol:evidence(null),missingEvidence:['Costs'],verdict:{label:'Marginal',reason:'<script>unknown costs</script>'},scenarios:[.2,.5].map(dropFraction=>({dropFraction,grossValueSol:evidence(.4),grossPnlSol:evidence(-.1),netValueSol:evidence(null)})),...preflightFields});
  let failMode = null,accountReady=false;
  const fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; requests.push({path,method:options.method,body});
    if(path === '/api/version')return new Response(JSON.stringify({gitSha:'abcdef0123'}));
    if(path === '/api/still/pools')return new Response(JSON.stringify({pools:[pool,...additionalPools],updatedAt:new Date(clock).toISOString()}));
    if(path.startsWith('/api/still/preflight?'))return new Response(JSON.stringify(preflight()));
    if(path.startsWith('/api/still/wallet?'))return new Response(JSON.stringify({status:walletStatus,positions:walletPositions,source:'Synthetic public index',asOf:new Date(clock).toISOString()}));
    if(path.startsWith('/api/still/wallet-position?'))return new Response(JSON.stringify({status:'available',canPractise:true,checks:[],valueSol:1,feesSol:0,feeRateHourly:.001,feeAsOf:new Date(clock).toISOString(),floorPriceSol:.5,topPriceSol:1.5,distanceToFloorPct:50,inRange:true,source:'Synthetic confirmed bins',asOf:new Date(clock).toISOString(),exitQuote:{costSol:.01,asOf:new Date(clock).toISOString(),source:'Synthetic quote'}}));
    if(path === '/api/paper/still-account'){
      if(failMode==='account')return new Response(JSON.stringify({error:'Synthetic account temporarily unavailable'}),{status:403});
      accountReady=true;return new Response(JSON.stringify({paper:true,account}));
    }
    if(path === '/api/paper/still-clone'){
      if(!accountReady)return new Response(JSON.stringify({error:'Paper account cookie missing'}),{status:401});
      if(failMode==='network')throw new Error('Synthetic interrupted response');
      if(failMode==='clone-pending')return new Response(JSON.stringify({error:'No confirmed receipt yet. Keep the same request.',code:'still_clone_pending'}),{status:409});
      return new Response(JSON.stringify({paper:true,account,receipt:{requestId:body.requestId,action:'still-clone',positionIds:['paper:clone-1'],amountSol:.5}}));
    }
    if(path === '/api/paper/still-open'){
      if(failMode === 'network')throw new Error('Synthetic interrupted response');
      if(failMode === 'invalid')return new Response('{}');
      return new Response(JSON.stringify({paper:true,account,receipt:{requestId:body.requestId,action:'still-open',positionIds:['paper:fixture-1'],amountSol:.5}}));
    }
    throw Error('Unexpected browser request: '+path);
  };
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const sessionStorage = {getItem:key=>stored.get(key) ?? null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  runInNewContext(browserSource, {document,window,location,history,sessionStorage,localStorage:sessionStorage,fetch,Date:TestDate,URLSearchParams,AbortController,Intl,crypto:{randomUUID:()=>`request-${++serial}`},setTimeout:()=>1,clearTimeout:()=>{}});
  const click = async dataset => {await document.dispatch('click',{preventDefault(){},target:{closest:selector=>selector==='[data-lesson]'&&!dataset.lesson?null:({dataset,disabled:false})}}); await flush();};
  const confirm = async () => {await elements['#confirm-submit'].dispatch('click'); await flush();};
  return {elements,requests,stored,click,confirm,address,pool,window,location,setPool(patch){Object.assign(pool,patch);},async ready(){await flush();await click({go:'pools'});await click({pool:address});},advance(ms){clock+=ms;},fail(value){failMode=value;}};
}
const browser = fixture(); await browser.ready();
assert.ok(browser.elements['#screen'].innerHTML.includes('&lt;img'), 'Source names are escaped in rendered pre-flight');
assert.ok(!browser.elements['#screen'].innerHTML.includes('<script>unknown costs'), 'Untrusted verdict copy cannot become markup');
assert.equal(browser.requests.filter(r=>r.method==='POST').length,0, 'Browsing never opens a paper position');
await browser.click({action:'deposit'});
assert.equal(browser.elements['#confirmation'].open,true);
assert.equal(browser.requests.filter(r=>r.method==='POST').length,0, 'Review requires a separate explicit confirmation');
browser.fail('network'); await browser.confirm();
const first = browser.requests.find(r=>r.method==='POST');
assert.equal(first.path,'/api/paper/still-open'); assert.equal(first.body.confirmed,true);
assert.equal(browser.stored.size,1,'An interrupted response retains the exact request before retry');
browser.fail(null); await browser.confirm();
const posts = browser.requests.filter(r=>r.method==='POST');
assert.equal(posts.length,2); assert.deepEqual(posts[1].body,posts[0].body,'Retry reuses the same saved request instead of creating a second deposit');
assert.equal(browser.stored.size,0,'Confirmed receipt clears recovery state');

const stale = fixture(); await stale.ready(); stale.advance(11*60_000); await stale.click({action:'deposit'});
assert.equal(stale.elements['#confirmation'].open,false,'An expired pre-flight must refresh before opening confirmation');
assert.equal(stale.requests.filter(r=>r.method==='POST').length,0);

const invalid = fixture(); await invalid.ready(); await invalid.click({action:'deposit'}); invalid.fail('invalid'); await invalid.confirm();
assert.equal(invalid.stored.size,1,'A malformed success cannot erase the only recovery request');
assert.equal(invalid.elements['#confirmation'].open,true,'A malformed server response remains reviewable');
const corrupted = fixture(); await corrupted.ready(); corrupted.stored.set('still:guided:pending:v1', '{broken'); await corrupted.click({action:'deposit'});
assert.equal(corrupted.elements['#confirmation'].open,false,'Corrupt recovery state cannot be overwritten by a new deposit');
assert.equal(corrupted.requests.filter(r=>r.method==='POST').length,0);
assert.ok(corrupted.elements['#notice'].textContent.includes('Saved action cannot be read'));
const changedAmount = fixture(); await changedAmount.ready(); changedAmount.elements['#paper-amount'].value='1'; await changedAmount.click({action:'deposit'});
assert.equal(changedAmount.elements['#confirmation'].open,false,'Edited amount needs a new pre-flight before confirmation');
assert.equal(changedAmount.requests.filter(r=>r.method==='POST').length,0);
console.log('Still guided browser: escaping, position identity, explicit confirmation, stale evidence, and interrupted-response idempotency passed.');

const intro = fixture(); await intro.click({action:'start'});
assert.ok(intro.elements['#screen'].innerHTML.includes('You lend tokens to a pool. Traders pay you fees.'));
await intro.click({onboard:'next'}); assert.ok(intro.elements['#screen'].innerHTML.includes('This is paper.'));
await intro.click({onboard:'next'}); await intro.click({pace:'calm'}); await intro.click({onboard:'finish'});
assert.equal(JSON.parse(intro.stored.get('still:onboarding:v1')).preference,'calm');
await intro.click({go:'home'});await intro.click({action:'start'});
assert.ok(intro.elements['#screen'].innerHTML.includes('Run Pre-flight'),'Returning visitors go directly to pools');

const reading = fixture(); await reading.click({go:'learn'}); await reading.click({lesson:'3'});
assert.ok(reading.elements['#screen'].innerHTML.includes('Why exit cost matters on thin tokens'));
assert.deepEqual(JSON.parse(reading.stored.get('still:lessons:v1')),[3]);
await reading.click({lesson:'4'}); assert.deepEqual(JSON.parse(reading.stored.get('still:lessons:v1')),[3,4]);
assert.equal(reading.requests.filter(r=>r.method==='POST').length,0,'Reading lessons never changes paper money');

const walletBrowser=fixture();await walletBrowser.click({go:'wallet'});
assert.match(walletBrowser.elements['#screen'].innerHTML,/Connect Phantom/);
assert.match(walletBrowser.elements['#screen'].innerHTML,/Read-only. No signing./);
await walletBrowser.click({action:'wallet-connect'});
assert.match(walletBrowser.elements['#screen'].innerHTML,/Phantom isn&#39;t available here/);
assert.equal(walletBrowser.requests.filter(r=>r.method==='POST').length,0);
walletBrowser.elements['#wallet-address'].value='So11111111111111111111111111111111111111112';
await walletBrowser.elements['#screen'].dispatch('submit',{target:{id:'wallet-form'},preventDefault(){}});await flush();
assert.match(walletBrowser.elements['#screen'].innerHTML,/No open Meteora positions found/);
assert.equal(walletBrowser.stored.get('still:wallet-address:v1'),'So11111111111111111111111111111111111111112');
assert.equal(walletBrowser.requests.filter(r=>r.method==='POST').length,0,'Wallet browsing never mutates paper money or signs');
await walletBrowser.click({action:'wallet-forget'});assert.equal(walletBrowser.stored.has('still:wallet-address:v1'),false);


const walletAddress='So11111111111111111111111111111111111111112';
const livePosition={positionAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',poolAddress:walletAddress,name:'Synthetic/SOL',supported:true};
const pasteWallet=async browser=>{browser.elements['#wallet-address'].value=walletAddress;await browser.elements['#screen'].dispatch('submit',{target:{id:'wallet-form'},preventDefault(){}});await flush();};
const directWallet=fixture({initialHash:'#wallet',walletPositions:[livePosition]});await flush();await pasteWallet(directWallet);
assert.match(directWallet.elements['#screen'].innerHTML,/Practise this on paper/);
assert.equal(directWallet.requests.filter(r=>r.path==='/api/paper/still-account').length,0,'Read-only wallet browsing does not create a practice account');
assert.equal(directWallet.requests.filter(r=>r.method==='POST').length,0);
await directWallet.click({walletPractise:livePosition.positionAddress});
assert.equal(directWallet.elements['#confirmation'].open,true);
assert.equal(directWallet.requests.filter(r=>r.method==='POST').length,0,'Copying a live setup requires explicit paper confirmation');
await directWallet.confirm();
const cloneIndex=directWallet.requests.findIndex(r=>r.path==='/api/paper/still-clone');
const accountIndex=directWallet.requests.findIndex(r=>r.path==='/api/paper/still-account');
assert.ok(accountIndex>=0&&cloneIndex>accountIndex,'Direct #wallet confirmation establishes the paper cookie before cloning');
assert.equal(directWallet.requests[cloneIndex].body.positionAddress,livePosition.positionAddress);
assert.equal(directWallet.requests[cloneIndex].body.walletAddress,walletAddress);
assert.equal(directWallet.requests[cloneIndex].body.confirmed,true);
assert.equal(directWallet.elements['#confirmation'].open,false);
assert.equal(directWallet.location.hash,'#positions');
assert.deepEqual([...directWallet.stored.keys()],['still:wallet-address:v1'],'Wallet results and balances never persist locally; only the public address remains after the paper receipt');

const interruptedClone=fixture({initialHash:'#wallet',walletPositions:[livePosition]});await flush();await pasteWallet(interruptedClone);
await interruptedClone.click({walletPractise:livePosition.positionAddress});interruptedClone.fail('network');await interruptedClone.confirm();
const sentClone=interruptedClone.requests.find(r=>r.path==='/api/paper/still-clone').body;
const pendingClone=JSON.parse(interruptedClone.stored.get('still:guided:pending:v1'));
assert.deepEqual(pendingClone,{action:'still-clone',body:{requestId:sentClone.requestId},description:'Check the saved paper copy.'});
for(const identity of [walletAddress,livePosition.positionAddress])assert.ok(!JSON.stringify(pendingClone).includes(identity),'An interrupted clone never persists its source identities');
interruptedClone.fail(null);await interruptedClone.confirm();
assert.deepEqual(interruptedClone.requests.filter(r=>r.path==='/api/paper/still-clone')[1].body,sentClone,'Same-session retry may use the confirmed source request held only in memory');

const reloadedClone=fixture({initialHash:'#wallet',initialStorage:[['still:guided:pending:v1',JSON.stringify(pendingClone)]]});await flush();
await reloadedClone.click({action:'resume'});reloadedClone.fail('clone-pending');await reloadedClone.confirm();
assert.deepEqual(reloadedClone.requests.find(r=>r.path==='/api/paper/still-clone').body,{requestId:sentClone.requestId},'Reload asks only for the account-scoped receipt, without reconstructing a deposit');
assert.deepEqual(JSON.parse(reloadedClone.stored.get('still:guided:pending:v1')),pendingClone,'A 409 pending lookup retains the unknown request rather than losing its recovery ID');
reloadedClone.fail(null);await reloadedClone.confirm();
assert.deepEqual(reloadedClone.requests.filter(r=>r.path==='/api/paper/still-clone')[1].body,{requestId:sentClone.requestId});
assert.equal(reloadedClone.stored.has('still:guided:pending:v1'),false,'Only a verified receipt clears reload recovery');

const forgottenClone=fixture({initialHash:'#wallet',walletPositions:[livePosition]});await flush();await pasteWallet(forgottenClone);
await forgottenClone.click({walletPractise:livePosition.positionAddress});forgottenClone.fail('network');await forgottenClone.confirm();
const forgottenId=forgottenClone.requests.find(r=>r.path==='/api/paper/still-clone').body.requestId;
await forgottenClone.click({action:'wallet-forget'});
assert.equal(forgottenClone.stored.has('still:wallet-address:v1'),false);
assert.ok(!forgottenClone.elements['#screen'].innerHTML.includes(livePosition.positionAddress),'Forget clears the displayed position data');
await forgottenClone.click({action:'resume'});forgottenClone.fail(null);await forgottenClone.confirm();
assert.deepEqual(forgottenClone.requests.filter(r=>r.path==='/api/paper/still-clone')[1].body,{requestId:forgottenId},'Forget also discards the in-memory source payload while retaining receipt recovery');

const recoveredWallet=fixture({initialHash:'#wallet'});await flush();
const recovery={action:'still-clone',body:{requestId:'saved-clone-request',walletAddress,poolAddress:walletAddress,positionAddress:livePosition.positionAddress,amountSol:'0.5',confirmed:true},description:'Recover the confirmed paper copy.'};
const legacyHome=fixture({initialStorage:[['still:guided:pending:v1',JSON.stringify(recovery)]]});await flush();
assert.deepEqual(JSON.parse(legacyHome.stored.get('still:guided:pending:v1')).body,{requestId:recovery.body.requestId},'Opening Home immediately strips legacy wallet identities too');
recoveredWallet.stored.set('still:guided:pending:v1',JSON.stringify(recovery));await recoveredWallet.click({go:'wallet'});
const sanitizedRecovery={action:'still-clone',body:{requestId:recovery.body.requestId},description:'Check the saved paper copy.'};
assert.deepEqual(JSON.parse(recoveredWallet.stored.get('still:guided:pending:v1')),sanitizedRecovery,'Legacy persisted clone sources are stripped when read');
assert.match(recoveredWallet.elements['#screen'].innerHTML,/Check saved action/,'Recovery stays visible on the direct wallet route');
await recoveredWallet.click({action:'resume'});recoveredWallet.fail('account');await recoveredWallet.confirm();
assert.deepEqual(JSON.parse(recoveredWallet.stored.get('still:guided:pending:v1')),sanitizedRecovery,'A failed account bootstrap cannot erase the previously confirmed recovery ID');
assert.equal(recoveredWallet.requests.filter(r=>r.method==='POST').length,0,'Failed account bootstrap cannot attempt a clone');
recoveredWallet.fail(null);await recoveredWallet.confirm();
assert.deepEqual(recoveredWallet.requests.find(r=>r.method==='POST').body,sanitizedRecovery.body,'Legacy recovery after bootstrap sends only the exact original request ID');

const unavailableWallet=fixture({initialHash:'#wallet',walletStatus:'unavailable'});await flush();await pasteWallet(unavailableWallet);
assert.match(unavailableWallet.elements['#screen'].innerHTML,/Positions are unavailable right now/);
assert.ok(!unavailableWallet.elements['#screen'].innerHTML.includes('No open Meteora positions found'),'Failed reads cannot claim that a wallet is empty');
const partialWallet=fixture({initialHash:'#wallet',walletStatus:'partial'});await flush();await pasteWallet(partialWallet);
assert.match(partialWallet.elements['#screen'].innerHTML,/Positions are unavailable right now/);
assert.ok(!partialWallet.elements['#screen'].innerHTML.includes('No open Meteora positions found'),'An incomplete index cannot prove an empty wallet');
await unavailableWallet.click({action:'wallet-retry'});
assert.equal(unavailableWallet.requests.filter(r=>r.path.startsWith('/api/still/wallet?')).length,2);

const lateWallet=fixture({initialHash:'#wallet'});await flush();
let resolveConnection;let signingReads=0;
const phantom={isPhantom:true,connect:()=>new Promise(resolve=>{resolveConnection=resolve;})};
for(const method of ['signTransaction','signAllTransactions','signAndSendTransaction','signMessage','request'])Object.defineProperty(phantom,method,{get(){signingReads++;throw Error('Signing is forbidden');}});
lateWallet.window.phantom={solana:phantom};
const connecting=lateWallet.click({action:'wallet-connect'});await flush();
await lateWallet.click({go:'home'});await lateWallet.click({go:'wallet'});
resolveConnection({publicKey:{toBase58:()=>walletAddress}});await connecting;
assert.equal(lateWallet.requests.filter(r=>r.path.startsWith('/api/still/wallet?')).length,0,'A late Phantom result cannot replace a later navigation state');
assert.equal(lateWallet.stored.has('still:wallet-address:v1'),false);
assert.equal(signingReads,0,'The integrated wallet flow never even accesses signing methods');
const navigateAway=fixture({initialHash:'#wallet',walletPositions:[livePosition]});await flush();await pasteWallet(navigateAway);await navigateAway.click({walletPractise:livePosition.positionAddress});
navigateAway.location.hash='#home';await navigateAway.window.dispatch('popstate');await flush();
assert.equal(navigateAway.elements['#confirmation'].open,false,'Leaving the wallet dismisses an unsubmitted copy review');
await navigateAway.confirm();assert.equal(navigateAway.requests.filter(r=>r.method==='POST').length,0,'A dismissed review cannot be submitted by a stale button event');
console.log('Still wallet UI: direct-entry account bootstrap, explicit paper copy, recovery retention, unavailable states, navigation races and no signing passed.');


const cardAt='2026-10-09T12:00:00.000Z';
const observedReasons=[
 {label:'Fee pace',result:'Observed fee pace is 0.5% of TVL per hour.',source:'Synthetic Meteora observation',asOf:cardAt},
 {label:'Exit cost',result:'Observed paper exit estimate is 0.001 SOL.',source:'Synthetic quote + RPC base-fee model',asOf:cardAt},
 {label:'Floor distance',result:'Observed floor is beyond the complete 24-hour swing.',source:'Synthetic exact-pool candles',asOf:cardAt},
 {label:'Extra hidden reason',result:'This fourth reason must not appear.',source:'Synthetic fourth source',asOf:cardAt},
];
const cardSummary={verdict:{label:'Worth it',reason:'Observed checks pass <script>not markup</script>.'},reasons:observedReasons,sizeSol:.5,scope:'0.5 paper SOL · default range',asOf:cardAt};
const poolCards=fixture({poolFields:{cardSummary}});await poolCards.click({go:'pools'});
const cardHtml=poolCards.elements['#screen'].innerHTML;
const verdictStart=cardHtml.indexOf('class="pool-verdict pass"'),reasonStart=cardHtml.indexOf('class="pool-reasons"'),reasonEnd=cardHtml.indexOf('</ul>',reasonStart),actionStart=cardHtml.indexOf('data-pool=',reasonEnd),detailsStart=cardHtml.indexOf('class="pool-details"'),metricsStart=cardHtml.indexOf('class="metrics pool-metrics"');
assert.ok(verdictStart>=0&&verdictStart<reasonStart&&reasonEnd<actionStart&&actionStart<detailsStart&&detailsStart<metricsStart,'Pool cards lead with verdict, three reasons and one action, ahead of secondary metrics');
assert.match(cardHtml.slice(verdictStart,reasonStart),/<h4><img[^>]+alt="Worth a look"/,'The public overall verdict wording stays intact');
assert.equal((cardHtml.slice(reasonStart,reasonEnd).match(/<li>/g)||[]).length,3,'Only three observed reasons appear on the card');
for(const reason of observedReasons.slice(0,3)){assert.ok(cardHtml.includes(reason.result));assert.ok(cardHtml.includes(reason.source));}
assert.ok(!cardHtml.includes('Extra hidden reason'));
assert.ok(!cardHtml.includes('<script>not markup</script>'));assert.ok(cardHtml.includes('&lt;script&gt;not markup&lt;/script&gt;'),'Verdict copy cannot introduce markup');
assert.equal((cardHtml.match(/data-pool=/g)||[]).length,1,'One primary Pre-flight action per pool');
assert.ok(!cardHtml.includes('pool-table'),'The list does not duplicate the cards with a dense table');
assert.ok(cardHtml.includes('data-still-number="50000"'),'Motion receives the actual numeric evidence, never a manufactured animation start');

poolCards.setPool({cardSummary:{...cardSummary,verdict:{label:'Marginal',reason:'Current costs are unavailable.'},reasons:[{label:'Exit cost',result:'Unavailable. The previous quote has expired.',source:'Synthetic quote read',asOf:null},{label:'Token settings',result:'Unavailable. This mint has not been verified.',source:'Synthetic RPC read',asOf:null},{label:'Floor distance',result:'Unavailable. The complete swing is missing.',source:'Synthetic candle read',asOf:null}]}});
await poolCards.click({go:'pools'});
const refreshedCard=poolCards.elements['#screen'].innerHTML;
assert.ok(!refreshedCard.includes('alt="Worth a look"'),'A new unavailable response cannot retain an earlier passing verdict');
assert.match(refreshedCard,/<h4><span class="still-chip still-chip--caution">.*Caution<\/span>/);assert.ok(refreshedCard.includes('The previous quote has expired.'));
assert.ok(!refreshedCard.includes('Observed paper exit estimate is 0.001 SOL.'),'Earlier numeric cost evidence is replaced rather than carried forward');

const noSummary=fixture({poolFields:{cardSummary:null,tvlUsd:{value:null,source:'Synthetic market read',asOf:null}}});await noSummary.click({go:'pools'});
const missingCard=noSummary.elements['#screen'].innerHTML;
assert.match(missingCard,/<h4>Unavailable<\/h4>/);assert.ok(missingCard.includes('Costs, token settings and downside are unavailable until checked.'));
assert.ok(!missingCard.includes('data-still-number="null"'));assert.ok(!missingCard.includes('data-still-number="undefined"'));assert.ok(!missingCard.includes('data-still-number="NaN"'),'Missing metrics never become animated values');
assert.ok(!missingCard.includes('alt="Worth a look"'),'No summary cannot invent a passing verdict');
console.log('Still pool-card UI: dated observed reasons, verdict/action hierarchy, three-reason cap, source escaping, refreshed unknown evidence and finite-only motion values passed.');

const samePairPools=[];const poolIdentity=fixture({poolFields:{name:'SAME/SOL',cardSummary},additionalPools:samePairPools});
samePairPools.push({...poolIdentity.pool,address:'B'.repeat(32),id:'solana:'+'B'.repeat(32),cardSummary:{...cardSummary,verdict:{label:'Skip',reason:'A different pool has different costs.'}}});
await poolIdentity.click({go:'pools'});
const identityHtml=poolIdentity.elements['#screen'].innerHTML;
assert.equal((identityHtml.match(/class="pool-card(?: [^"]*)?"/g)||[]).length,2,'Pools sharing a pair name keep separate cards');
assert.ok(identityHtml.includes('data-pool="'+'A'.repeat(32)+'"'));assert.ok(identityHtml.includes('data-pool="'+'B'.repeat(32)+'"'));
assert.match(identityHtml,/<h4><img[^>]+alt="Worth a look"/);assert.match(identityHtml,/<h4><img[^>]+alt="Skip for now"/,'Each pool keeps its own observed summary');
await poolIdentity.click({pool:'B'.repeat(32)});
const identityRead=poolIdentity.requests.find(request=>request.path.startsWith('/api/still/preflight?'));
assert.equal(new URL('https://still.example'+identityRead.path).searchParams.get('poolAddress'),'B'.repeat(32),'Pre-flight navigation uses the selected pool address, never its shared display name');

// Costs and presentation are separate: missing net and USD inputs never become zero.
assert.equal(helpers.money(1234.56),'$1,234.56');
assert.equal(helpers.money(null),'Unavailable');
assert.equal(helpers.money(0),'$0.00');
assert.deepEqual(JSON.parse(JSON.stringify(helpers.netSummary({netReturnPct:{value:1.25},breakEvenHours:{value:2.5},breakEvenStatus:'covered'}))),{net:'+1.25%',cover:'Fees cover costs in about 2.5 hours'});
assert.equal(helpers.netSummary({breakEvenStatus:'never',breakEvenHours:{value:null}}).cover,"Fees don't cover costs");
assert.equal(helpers.netSummary({breakEvenStatus:'unavailable',breakEvenHours:{value:null}}).cover,'Fees cover costs: Unavailable');
assert.equal(helpers.netSummary({netReturnPct:{value:null}}).net,'Unavailable');
const sentence=helpers.ticketSentence({sizeSol:.5,name:'SOL/USDC',solPriceUsd:{value:100},range:{topPriceSol:1,floorPriceSol:.5}});
assert.equal(sentence.replace(/<[^>]+>/g,''),"You're adding 0.5 SOL to SOL/USDC, from $100.00 down to $50.00");
const unknownRange=helpers.ticketSentence({sizeSol:.5,name:'X/SOL',solPriceUsd:{value:null},range:{topPriceSol:1,floorPriceSol:.5}});
assert.equal((unknownRange.match(/Unavailable/g)||[]).length,2);
assert.ok(!unknownRange.includes('$0.00'));
assert.match(browser.elements['#screen'].innerHTML,/still-empty/);
console.log('Still ticket: exact real-data sentence, US money format, separate net percent/cover-time states, and explicit missing values passed.');

const noExit=fixture({preflightFields:{exitCostComplete:false,exitCostSol:{value:null},positionRentSol:{value:.05,source:'Solana RPC · 8,120-byte account schema',asOf:'2026-10-09T12:00:00.000Z',note:'Detailed rent layout disclosure'}}});await noExit.ready();
const noExitHtml=noExit.elements['#screen'].innerHTML;
assert.ok(noExitHtml.includes('Exit cost is Unavailable.'));assert.ok(!noExitHtml.includes('Exit cost is a known minimum.'));
const primaryTicket=noExitHtml.split('<details class="still-ticket__fold">')[0];
assert.ok(primaryTicket.includes('Deposit, returned on close'));assert.ok(primaryTicket.includes('0.05 SOL'));assert.ok(primaryTicket.includes('Returned on close; excluded from net.'));
assert.ok(!primaryTicket.includes('8,120-byte'));assert.ok(!primaryTicket.includes('Detailed rent layout disclosure'));
assert.ok(noExitHtml.includes('Detailed rent layout disclosure'),'Rent schema/source detail is retained inside the numbers fold');
const minimumExit=fixture({preflightFields:{exitCostComplete:false,exitCostSol:{value:.001}}});await minimumExit.ready();
assert.ok(minimumExit.elements['#screen'].innerHTML.includes('Exit cost is a known minimum.'));
console.log('Still ticket: numeric-only exit minimum and compact refundable deposit before the action passed.');
