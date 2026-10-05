import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile('public/index.html','utf8');
const goSource=html.match(/  function go\(tab, searchOverride\) \{[^]*?\n  \}(?=\n  \$\("#tabs"\))/)?.[0];assert(goSource,'test the actual shell routing function');
const hashSource=html.match(/  window.addEventListener\('hashchange',[^]*?\n/)[0];
const initialSource=html.match(/  const initialTab=[^]*?\n/)[0]+html.match(/  if\(\['home','positions','top','alpha','pools'[^]*?DOMContentLoaded[^]*?\n/)[0];
const mainNav=html.match(/<nav[^>]*id="tabs"[^]*?<\/nav>/)?.[0]||html.match(/<div[^>]*id="tabs"[^]*?<\/div>/)?.[0];assert(mainNav);
assert.deepEqual([...mainNav.matchAll(/data-tab="([^"]+)"/g)].map(match=>match[1]),['alpha','baskets','bot'],'public navigation has three focused destinations');
assert.match(html,/data-go="learn">How it works/);
function fixture(hash='',other=false){
 const calls=[],events={},nodes=new Map(),location={hash,search:''},state={tab:'alpha',chain:'solana',sort:'feeApr',alphaMode:'depth'},poolViews={};
 const node=extra=>({hidden:false,value:'',href:'',textContent:'',classList:{toggle(){}},setAttribute(name,value){this[name]=value;},getAttribute(name){return this[name];},...extra});
 const buttons=['alpha','baskets','bot'].map(tab=>node({dataset:{tab}}));
 const form=node({elements:Object.fromEntries(['minTvl','maxTvl','minVol','maxAgeH','venue'].map(name=>[name,{value:''}]))});nodes.set('#filters',form);
 nodes.set('#tabs',node({scrollWidth:0,clientWidth:100,querySelector:()=>buttons.find(button=>button['aria-selected']==='true')}));
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,node({}));return nodes.get(selector);};
 const document={body:{dataset:{}},querySelectorAll:selector=>selector.startsWith('#tabs')?buttons:[]};
 const window={WorldsFair:{showRobinhood:other},addEventListener:(name,callback)=>events[name]=callback,scrollTo(){},loadBaskets:()=>calls.push('baskets'),loadPaperFleet:()=>calls.push('strategies'),loadRangeAlerts:()=>calls.push('alerts'),loadVolumeAlerts:()=>calls.push('volume'),loadWalletIntel:()=>calls.push('wallets')};
 class FormData{constructor(form){this.rows=Object.entries(form.elements).map(([key,value])=>[key,value.value]);}*[Symbol.iterator](){yield*this.rows;}}
 const context={state,poolViews,$,document,window,location,FormData,URLSearchParams,history:{replaceState(_state,_title,path){location.hash=path;}},requestAnimationFrame:fn=>fn(),loadPools:()=>calls.push('pools'),renderPositions:()=>calls.push('positions'),loadHistory:()=>calls.push('history'),renderHome:()=>calls.push('home'),closeDrawer:()=>calls.push('drawer-close')};
 vm.runInNewContext(goSource+'\nthis.route=go;\n'+hashSource+'\n'+initialSource,context);
 return {state,location,nodes,calls,events,route:context.route,buttons,$};
}
for(const [alias,destination] of [['alpha','alpha'],['pools','alpha'],['top','alpha'],['stock','alpha'],['home','alpha'],['wallets','alpha'],['settings','alpha'],['alerts','alpha'],['positions','baskets'],['history','baskets'],['baskets','baskets'],['bot','bot'],['learn','learn']]){
 const app=fixture('#'+alias);app.events.DOMContentLoaded();assert.equal(app.state.tab,destination,'initial #'+alias);assert.equal(app.location.hash,'#'+destination);assert.equal(app.$('.skip-link').href,'#view-'+(destination==='alpha'?'pools':destination));
 assert.equal(app.$('#view-'+(destination==='alpha'?'pools':destination)).hidden,false);
 assert(!app.calls.includes('positions')&&!app.calls.includes('history')&&!app.calls.includes('wallets')&&!app.calls.includes('alerts'),'default public aliases do not open personal or other-chain readers');
 if(destination!=='learn')assert.equal(app.buttons.find(button=>button.dataset.tab===destination).tabIndex,0);
}
const guide=fixture('#learn');guide.events.DOMContentLoaded();assert.equal(guide.$('#view-learn').hidden,false);assert.equal(guide.$('#view-pools').hidden,true,'guide deep link cannot leave pools layered underneath');assert.equal(guide.$('#view-baskets').hidden,true);
guide.location.hash='#pools';guide.events.hashchange();assert.equal(guide.state.tab,'alpha');assert.equal(guide.$('#view-learn').hidden,true,'leaving guide hides the old page');
guide.location.hash='#learn';guide.events.hashchange();assert.equal(guide.state.tab,'learn');
const before=guide.calls.length;guide.location.hash='#/api/solana/send';guide.events.hashchange();assert.equal(guide.state.tab,'learn');assert.equal(guide.calls.length,before,'unlisted fragment cannot invoke a data or signing route');
const empty=fixture();empty.events.DOMContentLoaded();assert.equal(empty.location.hash,'#alpha','empty URL enters pool discovery');
const changed=fixture('#learn');changed.location.hash='#baskets';changed.events.DOMContentLoaded();assert.equal(changed.state.tab,'alpha','late initial handler cannot overwrite a changed fragment');changed.events.hashchange();assert.equal(changed.state.tab,'baskets');
console.log('Public routing passed: three navigation choices, pool aliases, personal-view redirects, guide deep links/back changes, initial-route race and unlisted-fragment boundary.');
