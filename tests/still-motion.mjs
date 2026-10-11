import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = (await readFile('public/still-motion.js','utf8')).replace(/^export /gm,'');
class Classes {
  values = new Set();
  add(...values) {for(const value of values)this.values.add(value);}
  remove(...values) {for(const value of values)this.values.delete(value);}
  contains(value) {return this.values.has(value);}
  toggle(value,on) {const yes=on??!this.contains(value);if(yes)this.add(value);else this.remove(value);return yes;}
}
class Element {
  classList = new Classes();style = {};attributes = new Map();children = [];listeners = new Map();textContent = '';hidden = false;
  set className(value) {this.classList = new Classes();this.classList.add(...value.split(' '));}
  setAttribute(key,value) {this.attributes.set(key,String(value));}
  getAttribute(key) {return this.attributes.get(key)??null;}
  append(value) {value.parent=this;this.children.push(value);}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  addEventListener(type,callback) {if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback) {this.listeners.get(type)?.delete(callback);}
  fire(type,event={}) {for(const callback of this.listeners.get(type)||[])callback(event);}
}
function fixture({reduced=false,fine=true}={}) {
  const document = new Element(),window = new Element(),home = new Element();
  document.documentElement=new Element();document.body=new Element();document.createElement=()=>new Element();document.getElementById=id=>id==='home'?home:null;
  const chip=new Element(),valid=new Element(),zero=new Element(),missing=new Element(),invalid=new Element();
  chip.className='check-chip';valid.textContent='0.5 SOL';valid.setAttribute('data-still-number','0.5');zero.textContent='0 SOL';zero.setAttribute('data-still-number','0');missing.textContent='Unavailable';missing.className='unavailable';invalid.textContent='Unavailable';invalid.setAttribute('data-still-number','NaN');
  const numbers=[valid,zero,missing,invalid];
  document.querySelectorAll=selector=>selector==='[data-still-number]'?numbers:selector==='.check-chip,.overall-chip'?[chip]:[chip,...numbers].filter(element=>element.classList.contains('still-chip-settle')||element.classList.contains('still-number-settle'));
  const reduceMedia=Object.assign(new Element(),{matches:reduced}),fineMedia=Object.assign(new Element(),{matches:fine});
  window.matchMedia=query=>query.includes('reduced-motion')?reduceMedia:fineMedia;
  let id=0;const frames=new Map(),timers=new Map();window.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};window.cancelAnimationFrame=key=>frames.delete(key);window.setTimeout=(callback)=>{timers.set(++id,callback);return id;};window.clearTimeout=key=>timers.delete(key);
  const module=runInNewContext(source+'\n({initStillMotion,afterStillRender})',{document,window});
  const frame=()=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback();};
  return {document,window,home,chip,valid,zero,missing,invalid,frames,timers,reduceMedia,fineMedia,frame,...module,cursor:()=>document.body.children.find(child=>child.classList.contains('still-cursor'))};
}

const active=fixture();const cleanup=active.initStillMotion();
assert.equal(active.initStillMotion(),cleanup,'Initialisation is idempotent');
assert.equal(active.home.children.length,1,'Exactly one initial ripple is created');
assert.ok(active.chip.classList.contains('still-chip-settle'));
assert.ok(active.valid.classList.contains('still-number-settle'));assert.ok(active.zero.classList.contains('still-number-settle'),'A supplied actual zero is valid data');
assert.equal(active.valid.textContent,'0.5 SOL','The real number remains unchanged; no invented zero or interpolated values');
assert.equal(active.zero.textContent,'0 SOL');
assert.ok(!active.missing.classList.contains('still-number-settle'));assert.ok(!active.invalid.classList.contains('still-number-settle'),'Unavailable and malformed values never animate');
const plain={closest:()=>null},clickable={closest:selector=>selector.includes('a[href]')?{}:null},input={closest:selector=>selector.startsWith('input,')?{}:null};
active.document.fire('pointermove',{pointerType:'mouse',clientX:10,clientY:20,target:clickable});active.frame();
assert.ok(active.document.documentElement.classList.contains('still-cursor-enabled'));assert.ok(active.cursor().classList.contains('is-action'));
assert.equal(active.cursor().style.transform,'translate3d(10px,20px,0)');
active.document.fire('pointerdown',{pointerType:'mouse',button:0,target:clickable});assert.ok(active.cursor().classList.contains('is-pulsing'));
active.document.fire('pointermove',{pointerType:'mouse',clientX:10,clientY:20,target:input});active.frame();
assert.ok(!active.document.documentElement.classList.contains('still-cursor-enabled'),'Text fields keep the native cursor');assert.ok(!active.cursor().classList.contains('is-visible'));
active.document.fire('pointermove',{pointerType:'mouse',clientX:15,clientY:25,target:plain});active.frame();
active.document.fire('pointermove',{pointerType:'touch',clientX:15,clientY:25,target:plain});assert.ok(!active.document.documentElement.classList.contains('still-cursor-enabled'),'Touch on a hybrid device disables the custom cursor');
active.reduceMedia.matches=true;active.reduceMedia.fire('change');
assert.equal(active.cursor(),undefined);assert.equal(active.home.children.length,0);assert.ok(!active.valid.classList.contains('still-number-settle'));
assert.equal(active.frames.size,0,'Reduced motion cancels pending cursor paint');
active.reduceMedia.matches=false;active.reduceMedia.fire('change');assert.ok(active.cursor());assert.equal(active.home.children.length,0,'Changing a preference never replays the load splash');
cleanup();assert.equal(active.cursor(),undefined);assert.equal(active.document.listeners.get('pointermove').size,0);

const quiet=fixture({reduced:true});const stopQuiet=quiet.initStillMotion();assert.equal(quiet.cursor(),undefined);assert.equal(quiet.home.children.length,0);assert.ok(!quiet.chip.classList.contains('still-chip-settle'));quiet.reduceMedia.matches=false;quiet.reduceMedia.fire('change');assert.equal(quiet.home.children.length,0,'Starting with reduced motion never defers a splash until later');stopQuiet();
const touch=fixture({fine:false});const stopTouch=touch.initStillMotion();assert.equal(touch.cursor(),undefined,'Coarse pointers never get a custom cursor');stopTouch();
console.log('Still motion: real values unchanged, unknown values static, native text/touch cursors, one load ripple, reduced-motion cleanup and idempotent setup passed.');
