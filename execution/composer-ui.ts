import {createComposer,decimalInput,ExecutionDraft,Family,readOperation,canResumeInPool} from './composer-state';
export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function api(path:string,body?:unknown){const r=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Request failed');return d;}
export function emit(name:string,detail:any){document.dispatchEvent(new CustomEvent(name,{detail}));}
const composers=new Map<string,ReturnType<typeof createComposer>>();
export function composerFor(pool:string,family:Family,initial:Partial<ExecutionDraft>={}){
 const id=family+':'+pool;let composer=composers.get(id);
 if(!composer){composer=createComposer(pool,family,initial,localStorage);composers.set(id,composer);composer.subscribe(state=>emit('lp:execution-draft',{pool,family,...state}));}
 else if(Object.keys(initial).length)composer.update(initial);
 return composer;
}
export function announceOperation(pool:string,family:Family,status:string,locked:boolean){emit('lp:execution-operation',{pool,family,status,locked});document.dispatchEvent(new Event('lp-operation-changed'));}
export function summaryShell(host:HTMLElement,summary:string){host.innerHTML=`<div class="execution-summary">${summary}</div><div class="execution-workflow"><p data-confirmation class="execution-status" role="status" aria-live="polite"></p><div data-signing-card class="paybox-card"></div><div data-workflow-actions class="execution-actions"></div></div>`;}
export function statusNode(host:HTMLElement){let node=host.querySelector('[data-confirmation]') as HTMLElement;if(!node){node=document.createElement('p');node.dataset.confirmation='';node.className='execution-status';host.append(node);}return node;}
export function setStatus(host:HTMLElement,message:string){statusNode(host).textContent=message;}
export function showReceipt(host:HTMLElement,url:string){const actions=host.querySelector('[data-workflow-actions]') as HTMLElement;if(!actions)return;actions.innerHTML=`<a href="${esc(url)}" target="_blank" rel="noopener">View receipt ↗</a>`;}
export function setFormLocked(host:HTMLElement,locked:boolean){host.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('[data-composer-field],[data-budget],[data-preview],[data-wallet-kind],[data-sol-position],[data-load],[data-refresh-wallet]').forEach(node=>node.disabled=locked);host.querySelectorAll<HTMLInputElement|HTMLButtonElement>('button[data-connect],button[data-setup],select[data-credential]').forEach(node=>node.disabled=locked);}
export function installExecutionApi(){
 (window as any).LPExecution={
  getDraft(pool:string){for(const c of composers.values())if(c.snapshot().draft.pool===pool)return c.snapshot().draft;return null;},
  getState(pool:string){for(const c of composers.values())if(c.snapshot().draft.pool===pool){const state=c.snapshot(),op=readOperation(localStorage,state.draft.family);return op&&canResumeInPool(op,pool)?{...state,locked:true,review:op.preview,pending:op}:state;}return null;},
  setRange(pool:string,bounds:any){const family:Family='lowerPriceEth' in bounds?'evm':'solana';const patch:any={};for(const key of family==='solana'?['lowerPriceSol','upperPriceSol']:['lowerPriceEth','upperPriceEth'])if(key in bounds)patch[key]=decimalInput(bounds[key]);for(const key of ['depositMode','source','anchorAt'])if(key in bounds)patch[key]=bounds[key];return composerFor(pool,family).update(patch);},
  setStrategy(pool:string,value:unknown){const shape=({0:'spot',1:'curve',2:'bid-ask'} as any)[String(value)]||String(value);if(!['spot','curve','bid-ask'].includes(shape))return false;for(const c of composers.values())if(c.snapshot().draft.pool===pool)return c.update({strategy:shape as any});return false;},
  restoreReturn(){try{const value=JSON.parse(localStorage.getItem('lp-execution-return')||'null');localStorage.removeItem('lp-execution-return');return value;}catch{return null;}}
 };
}
