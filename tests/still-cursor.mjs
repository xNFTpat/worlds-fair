import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile('public/motion/still-cursor.js','utf8');
class Element {
  children=[];listeners=new Map();style={};attributes={};hidden=false;
  classList={values:new Set(),add(name){this.values.add(name);},remove(name){this.values.delete(name);}};
  setAttribute(k,v){this.attributes[k]=v;}
  appendChild(el){el.parent=this;this.children.push(el);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(el=>el!==this);}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);}
  fire(k,e={}){for(const fn of this.listeners.get(k)||[])fn(e);}
  showPopover(){this.open=true;}
  hidePopover(){this.open=false;}
}
function setup({fine=true,coarse=false,reduced=false}={}) {
 const document=new Element(),window=new Element();document.body=new Element();document.documentElement=new Element();document.createElement=()=>new Element();
 const medias=[fine,coarse,reduced].map(matches=>Object.assign(new Element(),{matches}));
 let serial=0;const timers=new Map();const env={document,window,matchMedia:q=>medias[q.includes('reduced')?2:q.includes('coarse')?1:0],setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)};
 runInNewContext(source,env);
 const click=(extra={})=>document.fire('click',{button:0,detail:1,pointerType:'mouse',clientX:100,clientY:200,target:{closest:()=>null},...extra});
 return {document,window,medias,timers,env,click,overlay:()=>document.body.children[0],rings:()=>document.body.children[0]?.children.filter(el=>el.className==='still-cursor__ring')||[]};
}
const f=setup();assert.equal(f.document.body.children.length,1);assert.equal(f.overlay().attributes.popover,'manual');assert(f.overlay().open);
runInNewContext(source,f.env);assert.equal(f.document.listeners.get('click').size,1,'No duplicate click handlers on repeated install');
f.click();assert.equal(f.rings().length,1,'Exactly one ring per click, not per pointer down/up');assert.equal(f.rings()[0].style.left,'100px');
assert.equal(f.rings()[0].parent,f.overlay(),'A card cannot clip a sibling in the fixed overlay');
const first=f.rings()[0];f.document.fire('pointermove',{pointerType:'mouse',clientX:500,clientY:300,target:{closest:()=>null}});
assert.equal(first.style.left,'100px','Ripple stays at its click, never follows the cursor');assert.equal(f.overlay().children[0].style.left,'500px');
f.click({clientX:500});assert.equal(f.rings().length,2,'Two clicks create exactly two independent, finite rings');
first.fire('animationend');assert.equal(f.rings().length,1);for(const {fn,ms} of [...f.timers.values()]){assert.equal(ms,400);fn();}assert.equal(f.rings().length,0);assert.equal(f.timers.size,0);
f.click({detail:0});f.click({pointerType:'touch'});f.click({button:2});assert.equal(f.rings().length,0,'Keyboard, touch and secondary clicks do not create primary mouse ripples');
f.click();f.medias[2].matches=true;f.medias[2].fire('change');assert.equal(f.rings().length,0);f.click();assert.equal(f.rings().length,0,'Reduced motion immediately removes and suppresses rings');
f.medias[1].matches=true;f.medias[1].fire('change');assert.equal(f.overlay(),undefined);assert(!f.document.documentElement.classList.values.has('has-still-cursor'));
assert.equal(setup({coarse:true}).overlay(),undefined,'Even a hybrid fine/coarse match creates no overlay');assert.equal(setup({fine:false}).overlay(),undefined);
const reduced=setup({reduced:true});reduced.click();assert.equal(reduced.rings().length,0);
const css=await readFile('public/still-v6.css','utf8');
assert.match(css,/\.still-cursor\{[^}]*position:fixed;[^}]*overflow:visible;[^}]*pointer-events:none;[^}]*z-index:2147483647/);
assert.match(css,/\.still-cursor__dot,\.still-cursor__ring\{[^}]*border-radius:50%/);
assert.match(css,/animation:still-cursor-click 350ms ease-out 1 both/);
assert(!css.match(/still-pointer[^}]*border-bottom:0/));
console.log('PASS single unclipped cursor overlay, exact one-shot rings, fixed click origin, expiry, duplicate install, reduced motion and coarse-pointer native behavior');
