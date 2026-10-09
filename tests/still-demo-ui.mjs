import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile('public/still-demo.js', 'utf8');
const browserSource = source.replace(/^export /gm, '');
const helpers = runInNewContext(browserSource + '\n({esc,number,sol,groupPositions,requestFingerprint})', {Intl});
assert.equal(helpers.sol(null), 'Unavailable');
assert.equal(helpers.sol(0), '0 SOL');
assert.equal(helpers.sol(Infinity), 'Unavailable');
assert.equal(helpers.esc('<img src=x onerror="run()">'), '&lt;img src=x onerror=&quot;run()&quot;&gt;');
const individual = [{id:'paper:one',positionAddress:'paper:one',poolAddress:'same',name:'One'}, {id:'paper:two',positionAddress:'paper:two',poolAddress:'same',name:'One'}];
const groups = helpers.groupPositions(individual);
assert.equal(groups.length, 1); assert.equal(groups[0].positions.length, 2);
assert.equal(groups[0].positions[0], individual[0]); assert.equal(groups[0].positions[1], individual[1], 'Grouping preserves each distinct position record');

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
function fixture() {
  let clock = Date.parse('2026-10-09T12:00:00.000Z'), serial = 0;
  const address = 'A'.repeat(32), requests = [], stored = new Map(), steps = ['pools','preflight','positions','baskets'].map(go => Object.assign(new Element(),{dataset:{go}}));
  const ids = ['screen','confirmation','notice','home','journey','step-preflight','build-version','confirm-submit','confirm-cancel','confirm-error','confirm-content','paper-amount'];
  const elements = Object.fromEntries(ids.map(id => ['#'+id,new Element()]));
  elements['#confirmation'].form = new Element(); elements['#screen'].deposit = new Element();
  const document = new Element(); document.querySelector = selector => elements[selector]; document.querySelectorAll = () => steps;
  const window = new Element(); window.scrollTo = () => {};
  const location = {hash:''}; const history = {pushState(_state,_unused,hash){location.hash=hash;},replaceState(_state,_unused,hash){location.hash=hash;}};
  const evidence = value => ({value,status:value === null?'unavailable':'available',asOf:new Date(clock).toISOString(),source:'Synthetic observed source',note:'Synthetic note'});
  const pool = {address,id:'solana:'+address,name:'<img src=x onerror="run()">/SOL',binStep:evidence(100),risk:{label:'Busy',reason:'<script>not code</script>'},tvlUsd:evidence(50000),fees24hFraction:evidence(.01),feeTrend:evidence(.2),ageHours:evidence(100),priceSol:evidence(1)};
  const account = {balanceSol:10,seededSol:10,seedNote:'Practice seed',settlementNote:'Gross model only',feeModelNote:'Modelled fees only',positions:[]};
  const preflight = () => ({poolAddress:address,name:pool.name,sizeSol:.5,fetchedAt:new Date(clock).toISOString(),canOpen:true,priceSol:evidence(1),range:{bins:[{sol:.5}],floorPriceSol:.6,topPriceSol:.95,depthFraction:.4,binCount:3,alignment:'estimated',source:'Synthetic model',asOf:new Date(clock).toISOString(),note:'No live execution'},expectedFeesPerDaySol:evidence(.001),transferFeeBps:evidence(null),entryCostSol:evidence(null),exitCostSol:evidence(null),entryConversionSol:evidence(0),exitConversionSol:evidence(null),networkCostSol:evidence(null),missingEvidence:['Costs'],verdict:{label:'Marginal',reason:'<script>unknown costs</script>'},scenarios:[.2,.5].map(dropFraction=>({dropFraction,grossValueSol:evidence(.4),grossPnlSol:evidence(-.1),netValueSol:evidence(null)}))});
  let failMode = null;
  const fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; requests.push({path,method:options.method,body});
    if(path === '/api/version')return new Response(JSON.stringify({gitSha:'abcdef0123'}));
    if(path === '/api/still/pools')return new Response(JSON.stringify({pools:[pool],updatedAt:new Date(clock).toISOString()}));
    if(path.startsWith('/api/still/preflight?'))return new Response(JSON.stringify(preflight()));
    if(path === '/api/paper/still-account')return new Response(JSON.stringify({paper:true,account}));
    if(path === '/api/paper/still-open'){
      if(failMode === 'network')throw new Error('Synthetic interrupted response');
      if(failMode === 'invalid')return new Response('{}');
      return new Response(JSON.stringify({paper:true,account,receipt:{requestId:body.requestId,action:'still-open',positionIds:['paper:fixture-1'],amountSol:.5}}));
    }
    throw Error('Unexpected browser request: '+path);
  };
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const sessionStorage = {getItem:key=>stored.get(key) ?? null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  runInNewContext(browserSource, {document,window,location,history,sessionStorage,fetch,Date:TestDate,URLSearchParams,AbortController,Intl,crypto:{randomUUID:()=>`request-${++serial}`},setTimeout:()=>1,clearTimeout:()=>{}});
  const click = async dataset => {await document.dispatch('click',{target:{closest:()=>({dataset,disabled:false})}}); await flush();};
  const confirm = async () => {await elements['#confirm-submit'].dispatch('click'); await flush();};
  return {elements,requests,stored,click,confirm,address,async ready(){await flush();await click({go:'pools'});await click({pool:address});},advance(ms){clock+=ms;},fail(value){failMode=value;}};
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
