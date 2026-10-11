import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

class Element {
  dataset={}; attributes=new Map(); nodes=new Map(); listeners=new Map(); style={setProperty(){}}; textContent=''; clientWidth=340; open=false; returnValue='';
  getAttribute(key){return this.attributes.get(key)??null;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  hasAttribute(key){return this.attributes.has(key);}
  querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);}
  querySelectorAll(){return [];}
  animate(){return {finished:Promise.resolve(),cancel(){}};}
  showModal(){this.open=true;}
  close(value=''){this.open=false;this.returnValue=value;}
  getAnimations(){return [];}
}
class Event {constructor(type,detail={}){this.type=type;Object.assign(this,detail);}preventDefault(){this.defaultPrevented=true;}}
const media=new Element();media.matches=false;
const definitions=new Map();let observations=0;
runInNewContext(await readFile('public/motion/still-range-gauge.js','utf8'),{
  window:{},customElements:{get:key=>definitions.get(key),define:(key,value)=>definitions.set(key,value)},HTMLElement:Element,matchMedia:()=>media,performance:{now:()=>0},cancelAnimationFrame(){},clearTimeout(){},ResizeObserver:class {observe(){observations++;}disconnect(){}},CustomEvent:Event,
});
const Gauge=definitions.get('still-range-gauge'),gauge=new Gauge();
for(const [key,value] of Object.entries({price:100,low:50,high:100,unit:'SOL/token'}))gauge.setAttribute(key,value);
gauge.connectedCallback();assert.equal(gauge.dataset.range,'in','Inclusive upper edge must keep a new Bid-Ask position in range');
assert.match(gauge.getAttribute('aria-label'),/In range\. Price 100/);
gauge.setAttribute('price',49);gauge.attributeChangedCallback();assert.equal(gauge.dataset.range,'below');assert.equal(gauge.querySelector('.g-state').textContent,'Price below range');
gauge.setAttribute('price',' ');gauge.attributeChangedCallback();assert.equal(gauge.dataset.range,'unavailable','Whitespace is not a zero price');
assert.equal(gauge.getAttribute('aria-label'),'Pool: Unavailable');assert.equal(gauge.querySelector('.g-drop').style.display,'none');
gauge.setAttribute('price',75);gauge.setAttribute('decimals',999999);assert.doesNotThrow(()=>gauge.attributeChangedCallback(),'Out-of-range precision cannot break the panel');
media.matches=true;gauge.attributeChangedCallback();assert.equal(gauge.dataset.state,'reduced-motion');
gauge.disconnectedCallback();gauge.connectedCallback();assert.equal(observations,2,'A reinserted gauge resumes size observations');

const water=await readFile('public/motion/still-water.css','utf8');
assert.match(water,/\[data-range="below"\] \.g-state\{ color:var\(--still-caution\)/);
assert.match(water,/\.g-floor\{fill:none;stroke:none\}/,'No old contour outline');

const window={StillSplash:{at:()=>Promise.resolve()}};
runInNewContext(await readFile('public/motion/still-sheet.js','utf8'),{window,matchMedia:()=>media,CustomEvent:Event});
const dialog=new Element();let submitting=true;
const result=window.StillSheet.open(dialog,{canCancel:()=>!submitting});
assert.ok(dialog.open);
dialog.dispatchEvent(new Event('cancel'));await Promise.resolve();assert.ok(dialog.open,'Esc cannot close a submitted paper request in flight');
dialog.dispatchEvent(new Event('submit',{target:{method:'dialog'},submitter:{value:'cancel'}}));await Promise.resolve();assert.ok(dialog.open,'Close-button form cannot hide an in-flight request');
submitting=false;dialog.dispatchEvent(new Event('cancel'));assert.equal(await result,'cancel');assert.equal(dialog.open,false);
const again=window.StillSheet.open(dialog,{canCancel:()=>true});dialog.close('confirmed');assert.equal(await again,'confirmed');
assert.equal(dialog.listeners.get('cancel').size,0);assert.equal(dialog.listeners.get('submit').size,0,'Opening and closing the sheet never leaks cancel listeners');

const html=await readFile('public/still-demo.html','utf8');
const app=await readFile('public/still-demo.js','utf8');
const builder=await readFile('scripts/build-still-motion.mjs','utf8');
assert.ok(html.includes('src="/still-app-motion.js" defer'));
assert.ok(html.includes('<style data-still-styles>'));
assert.ok(builder.includes("['still-loader','still-reveal','still-splash','still-sheet','still-range-gauge','still-wheel','still-ticket','still-empty','still-shell','still-cursor']"),'Bundled components retain their dependency order');
assert.ok(app.includes('See the numbers'));assert.ok(!app.includes("module.initStillMotion()"),'No duplicate legacy load ripple or custom cursor');
console.log('Still motion pack: inclusive/missing/contrast gauge states, reconnect/reduced motion, native-sheet in-flight cancellation safety, and ordered runtime wiring passed.');
// Drag and keyboard edits use the same multiplicative active-bin grid.
gauge.setAttribute('price',100);gauge.setAttribute('low',80);gauge.setAttribute('high',100);gauge.setAttribute('editable','');gauge.setAttribute('bin-step',100);gauge.setAttribute('active-bin-price',100);gauge.setAttribute('shape','bid-ask-sol');gauge.attributeChangedCallback();
let edited;gauge.addEventListener('still:range',e=>edited=e.detail);gauge._setEdge('low',83.1,true);assert.equal(edited.lowBin,-19);assert(Math.abs(edited.low-100*Math.pow(1.01,-19))<1e-9);gauge._setEdge('high',110,true);assert.equal(edited.high,100,'SOL-only ceiling stops at price');
gauge.setAttribute('shape','bid-ask');gauge._setEdge('high',110,true);assert(edited.high>100);assert.equal(edited.highBin,10);
const raw=await readFile('public/still-demo.js','utf8');const helpers=runInNewContext(raw.split("if (typeof document !== 'undefined') {")[0].replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\n({gaugeConfig,liveVerdict})',{Intl,URLSearchParams});
assert.equal(helpers.gaugeConfig({range:{alignment:'native-active-bin',binStep:10,shape:'BidAsk',bins:[{token:0}]}},true).editable,true);
assert.equal(helpers.gaugeConfig({range:{alignment:'assumed-active-price',binStep:10}},true).editable,false);
assert.match(helpers.liveVerdict({name:'TEST/SOL',verdict:{label:'Marginal',reason:'Token check unavailable'},checks:[{label:'Authority',status:'unavailable'}]}),/verdict="caution"/);
assert.match(helpers.liveVerdict({checks:[{label:'Fees',status:'unavailable'}]}),/value="Unavailable"/);
console.log('PASS native bin snapping, SOL-only upper stop, two-sided edges and unchanged Caution/missing-data verdict adapters');
