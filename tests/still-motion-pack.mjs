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
  animate(){return {finished:Promise.resolve(),cancel(){}};}
  showModal(){this.open=true;}
  close(value=''){this.open=false;this.returnValue=value;}
  getAnimations(){return [];}
}
class Event {constructor(type,detail={}){this.type=type;Object.assign(this,detail);}preventDefault(){this.defaultPrevented=true;}}
const media=new Element();media.matches=false;
const definitions=new Map();let observations=0;
runInNewContext(await readFile('public/motion/still-range-gauge.js','utf8'),{
  window:{},customElements:{get:key=>definitions.get(key),define:(key,value)=>definitions.set(key,value)},HTMLElement:Element,matchMedia:()=>media,performance:{now:()=>0},ResizeObserver:class {observe(){observations++;}disconnect(){}},CustomEvent:Event,
});
const Gauge=definitions.get('still-range-gauge'),gauge=new Gauge();
for(const [key,value] of Object.entries({price:100,low:50,high:100,unit:'SOL/token'}))gauge.setAttribute(key,value);
gauge.connectedCallback();assert.equal(gauge.dataset.range,'in','Inclusive upper edge must keep a new Bid-Ask position in range');
assert.match(gauge.getAttribute('aria-label'),/In range\. Price 100/);
gauge.setAttribute('price',49);gauge.attributeChangedCallback();assert.equal(gauge.dataset.range,'below');assert.equal(gauge.querySelector('.g-state').textContent,'Price below range');
gauge.setAttribute('price',' ');gauge.attributeChangedCallback();assert.equal(gauge.dataset.range,'unavailable','Whitespace is not a zero price');
assert.equal(gauge.getAttribute('aria-label'),'Range gauge: Unavailable');assert.equal(gauge.querySelector('.g-drop').style.display,'none');
gauge.setAttribute('price',75);gauge.setAttribute('decimals',999999);assert.doesNotThrow(()=>gauge.attributeChangedCallback(),'Out-of-range precision cannot break the panel');
media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(gauge.dataset.state,'reduced-motion');
gauge.disconnectedCallback();gauge.connectedCallback();assert.equal(observations,2,'A reinserted gauge resumes size observations');

const css=await readFile('public/motion/still-motion.css','utf8');
assert.match(css,/\[data-range="below"\] \.g-ring\{ stroke:var\(--still-caution-ink\)/);
const luminance=hex=>{const c=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
assert.ok((luminance('F3F0E5')+.05)/(luminance('7E5A12')+.05)>=3,'Below-range ring clears 3:1 against cream');

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
assert.ok(html.includes('href="/still-app.css"'));
assert.ok(builder.includes("['still-loader','still-reveal','still-splash','still-sheet','still-range-gauge','still-empty','still-shell']"),'Bundled components retain their dependency order');
assert.ok(app.includes('See the numbers'));assert.ok(!app.includes("module.initStillMotion()"),'No duplicate legacy load ripple or custom cursor');
console.log('Still motion pack: inclusive/missing/contrast gauge states, reconnect/reduced motion, native-sheet in-flight cancellation safety, and ordered runtime wiring passed.');
