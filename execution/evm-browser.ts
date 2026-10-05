import {signedEvmTransaction} from '../src/evm-math';
import {mountWalletPicker,payboxWallet,requestPayboxSignature,payboxResult,reopenPaybox,signingCard,PayboxWallet} from './paybox-browser';
import {ExecutionDraft,readOperation,writeOperation,removeOperation,canResumeInPool,interruptedAction,rangeError} from './composer-state';
import {esc,api,sleep,emit,composerFor,summaryShell,setStatus,showReceipt,setFormLocked,announceOperation} from './composer-ui';
const pending=()=>readOperation(localStorage,'evm');
function save(op:any){writeOperation(localStorage,'evm',op);announceOperation(op.pool,'evm',op.status,true);}
function clear(op:any){removeOperation(localStorage,'evm',op);announceOperation(op.pool,'evm',op.status,false);}
function contextKey(pool:string){return 'lp-evm-context:'+pool;}
function context(pool:string){try{return JSON.parse(localStorage.getItem(contextKey(pool))||'null');}catch{return null;}}
function remember(op:any){localStorage.setItem(contextKey(op.pool),JSON.stringify({operationId:op.preview.operationId,owner:op.preview.owner||op.preview.review?.owner,credentialId:op.preview.credentialId||op.credentialId,action:op.preview.action||op.action}));}
export function normalizeEvmPreview(preview:any){const range=preview.review?.range||{};return {...preview,lowerPriceEth:preview.lowerPriceEth??range.priceLowerEth??range.lowerPriceEth,upperPriceEth:preview.upperPriceEth??range.priceUpperEth??range.upperPriceEth};}
export function evmSummary(p:any){
 const r=p.review||{},range=r.range||{},budget=r.budgets||{},allocation=r.allocations||{};
 const amountEth=budget.amountEth??budget.maxEth??r.amountEth,amountToken=budget.amountToken??r.amountToken;
 const pairs=[['ETH budget',amountEth],['Token budget',amountToken],['Maximum gas · ETH',r.maximumGasEth],['ETH allocated',r.simulated?.eth??r.expectedEth??allocation.amountEth??allocation.eth],['Tokens allocated',r.simulated?.token??r.expectedToken??allocation.amountToken??allocation.token],['Unused ETH',r.unusedEth],['Unused tokens',r.unusedToken],['Minimum tokens received',r.minimumToken]];
 const low=p.lowerPriceEth??range.priceLowerEth,high=p.upperPriceEth??range.priceUpperEth;
 return `<h4>${p.stage==='approval'?'Review token approval':p.stage==='buy'?'Review token purchase':'Review LP position'}${r.pair?' · '+esc(r.pair):''}</h4>${p.humanSummary?'<p>'+esc(p.humanSummary)+'</p>':''}<div class="kv">${pairs.filter(([,value])=>value!==undefined&&value!==null).map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>${low&&high?`<p class="execution-range"><b>${esc(low)} – ${esc(high)}</b> ETH per paired token</p><p>Native ticks ${esc(range.tickLower)} – ${esc(range.tickUpper)} · Spot</p>`:''}${p.stage==='approval'?'<p>Approve the reviewed token allowance first. After confirmation, review the mint again against current pool state.</p>':''}<p class="note">Robinhood · chain ${esc(p.chainId)}<br>Wallet ${esc(p.owner||r.owner||p.transaction?.from)}<br>Pool ${esc(r.pool)}${r.simulationBlock?'<br>Simulation block '+esc(r.simulationBlock):''}</p>`;
}
function statusPath(op:any){return '/api/evm/status?'+new URLSearchParams({operationId:op.preview.operationId,credentialId:op.credentialId||op.preview.credentialId,owner:op.preview.owner||op.preview.review?.owner||op.preview.transaction?.from});}
function receipt(host:HTMLElement,op:any){setStatus(host,'Submitted. Checking Robinhood confirmation…');showReceipt(host,'https://explorer.robinhood.com/tx/'+encodeURIComponent(op.txHash));}
export function canRetrySame(op:any,state:any,now=Date.now()){
 return !!op.signedTransactionHex&&op.preview.expiresAt>now&&state.preview?.expiresAt>now&&state.operationId===op.preview.operationId&&state.preview?.previewId===op.preview.previewId&&state.owner?.toLowerCase()===op.preview.owner?.toLowerCase()&&state.credentialId===op.credentialId&&state.requestId===op.requestId&&(state.txHash===op.txHash&&state.retrySameAvailable===true||!state.txHash&&state.status==='awaiting-signature');
}
function offerRetry(host:HTMLElement,op:any,state:any){
 const actions=host.querySelector('[data-workflow-actions]') as HTMLElement;if(!actions||!canRetrySame(op,state)||actions.querySelector('[data-retry-same]'))return;
 const button=document.createElement('button');button.dataset.retrySame='';button.setAttribute('data-retry-same','');button.textContent='Retry the same signed transaction';actions.append(button);
 button.onclick=async()=>{button.disabled=true;try{const current=await api(statusPath(op));if(!canRetrySame(op,current))throw Error('This transaction cannot retry now. Resume to reconcile its existing hash.');const result=await api('/api/evm/send',{operationId:op.preview.operationId,previewId:op.preview.previewId,credentialId:op.credentialId,owner:op.preview.owner,signedTransactionHex:op.signedTransactionHex,retrySame:true});if(result.txHash&&result.txHash!==op.txHash)throw Error('The returned hash differs from this saved transaction.');receipt(host,op);await confirm(host,op);}catch(e:any){setStatus(host,e.message);}finally{if(button.isConnected)button.disabled=Date.now()>=op.preview.expiresAt;}};
}
async function confirm(host:HTMLElement,op:any){
 let last:any=null;
 for(let i=0;i<25&&host.isConnected;i++){
  const d=await api(statusPath(op));last=d;if(!host.isConnected)return;
  if(d.status==='confirmed'||d.receipt?.status==='success'||d.nextReviewRequired){localStorage.setItem('lp-evm-last-receipt',JSON.stringify({...op,status:'confirmed',receipt:d.receipt}));clear(op);setStatus(host,d.nextReviewRequired?'Token approval confirmed. Review the LP mint now; it needs its own approval.':'Confirmed on Robinhood. Positions can now be refreshed.');emit('lp:positions-refreshed',null);return;}
  if(['reverted','failed'].includes(d.status)||d.receipt?.status==='reverted'){clear(op);setStatus(host,'Transaction reverted. The chain charged its gas fee. Review again before another attempt.');return;}
  if(d.status==='expired'&&!d.txHash){clear(op);setStatus(host,'The unsigned review expired. Review again when ready.');return;}
  await sleep(2000);
 }
 if(host.isConnected){setStatus(host,'Confirmation is unresolved. Resume this saved operation; do not create a replacement.');offerRetry(host,op,last);}
}
async function finishPaybox(host:HTMLElement,op:any,created?:any){
 const card=host.querySelector('[data-signing-card]') as HTMLElement,actions=host.querySelector('[data-workflow-actions]') as HTMLElement;
 actions.innerHTML='<button data-reopen>Reopen signing card</button>';(actions.querySelector('[data-reopen]') as HTMLButtonElement).onclick=()=>reopenPaybox(card,op.requestId).catch(e=>setStatus(host,e.message));
 if(created)await signingCard(card,created.input,created.result);else if((await payboxResult(op.requestId)).status!=='success')await reopenPaybox(card,op.requestId);
 for(let i=0;i<60&&host.isConnected;i++){
  const result=await payboxResult(op.requestId);if(!host.isConnected)return;
  if(['error','denied'].includes(result.status)){clear(op);setStatus(host,'PayBox '+result.status+'. This terminal submitted no transaction. Your signing setup is retained.');return;}
  if(result.status==='success'){
   if(Date.now()>=op.preview.expiresAt){clear(op);setStatus(host,'Review expired before submission. Review again for a fresh transaction.');return;}
   const signed=signedEvmTransaction(op.preview.transaction||op.preview.tx,result,op.preview.owner||op.preview.transaction.from);
   op.txHash=signed.txHash;op.signedTransactionHex=signed.signedTransactionHex;op.status='submitting';save(op);
   try{await api('/api/evm/send',{operationId:op.preview.operationId,previewId:op.preview.previewId,credentialId:op.credentialId,owner:op.preview.owner,signedTransactionHex:signed.signedTransactionHex});}catch(e:any){receipt(host,op);setStatus(host,'Submission needs checking: '+e.message);try{offerRetry(host,op,await api(statusPath(op)));}catch{}return;}
   receipt(host,op);await confirm(host,op);return;
  }
  setStatus(host,result.status==='pending_approval'?'Approve this transaction in PayBox, then complete its signing card.':'Waiting for your PayBox signature…');
  if(result.approval_url){const url=new URL(result.approval_url);if(url.protocol==='https:'&&url.hostname==='app.paybox.sh'&&!actions.querySelector('a'))actions.insertAdjacentHTML('beforeend',`<a href="${esc(url.href)}" target="_blank" rel="noopener">Open PayBox approval ↗</a>`);}
  await sleep(2000);
 }
 if(host.isConnected)setStatus(host,'Signing is pending. Resume to reopen this same request.');
}
export function mountEvm(host:HTMLElement,pool:any,mode:'open'|'buy'|'exit'='open',options:{draft?:Partial<ExecutionDraft>}={}){
 const id=typeof pool==='string'?pool:pool.id;let busy=false,selected:PayboxWallet|null=null;
 if(mode==='exit'){host.innerHTML='<p>Robinhood withdrawal remains read-only here. Open the position on its venue to manage it.</p>';return;}
 const composer=composerFor(id,'evm',{...(options.draft||{}),action:mode}),initial=composer.snapshot().draft;
 host.classList.add('execution-composer');host.innerHTML=`<h3>${mode==='buy'?'Buy paired token':'Compose Robinhood LP'}</h3><p>${mode==='buy'?'Review a token purchase from this pool.':'Use exact ETH per token prices from the chart. Spot provides one continuous Uniswap V3 position.'}</p><div class="execution-grid"><div class="execution-form"><div data-wallet-picker></div><label>${mode==='buy'?'Spend':'Maximum LP budget'} · ETH <input data-composer-field="amountEth" inputmode="decimal"></label>${mode==='open'?'<label>Maximum paired-token budget <input data-composer-field="amountToken" inputmode="decimal"></label><p class="note">Enter the token amount you already hold. Zero means no tokens allocated; the range must accept ETH only.</p><div class="execution-range-inputs"><label>Floor · ETH per token <input data-composer-field="lowerPriceEth" inputmode="decimal" placeholder="Choose on chart"></label><label>Top · ETH per token <input data-composer-field="upperPriceEth" inputmode="decimal" placeholder="Choose on chart"></label></div><label>Shape <select data-composer-field="strategy"><option value="spot">Spot · one V3 range</option></select></label>':''}<label>Slippage <select data-composer-field="slippageBps"><option value="50">0.5%</option><option value="100">1%</option><option value="200">2%</option><option value="300">3%</option></select></label><div class="execution-actions"><button data-preview>Review ${mode==='buy'?'purchase':'position'}</button><button data-recovery>Resume pending operation</button></div></div><div data-review class="execution-review" aria-live="polite"></div></div>`;
 const find=(s:string)=>host.querySelector(s) as HTMLInputElement,review=find('[data-review]');let lastRevision=composer.snapshot().revision;
 function sync(){const state=composer.snapshot();host.querySelectorAll<HTMLInputElement>('[data-composer-field]').forEach(node=>{const value=String((state.draft as any)[node.dataset.composerField!]);if(node.value!==value)node.value=value;});setFormLocked(host,state.locked);}
 const unsubscribe=composer.subscribe(state=>{if(!host.isConnected){unsubscribe();return;}sync();if(state.revision!==lastRevision){lastRevision=state.revision;review.innerHTML='';}});sync();
 host.querySelectorAll<HTMLInputElement>('[data-composer-field]').forEach(node=>node.addEventListener(node.tagName==='SELECT'?'change':'input',()=>composer.update({[node.dataset.composerField!]:node.dataset.composerField==='slippageBps'?Number(node.value):node.value})));
 void mountWalletPicker(find('[data-wallet-picker]'),'evm',wallet=>{selected=wallet;if(wallet?.id!==composer.snapshot().draft.credentialId)composer.update({credentialId:wallet?.id||''});sync();},{pool:id,selectedId:initial.credentialId});
 function lock(value:boolean,status='review'){composer.lock(value);setFormLocked(host,value);announceOperation(id,'evm',status,value);}
 async function wallet(){const w=await payboxWallet({family:'evm',id:selected?.id||composer.snapshot().draft.credentialId});if(!w)throw new Error('Connect and select your EVM wallet above.');return w;}
 async function discover(w:PayboxWallet){return api('/api/evm/status?'+new URLSearchParams({credentialId:w.id,owner:w.address}));}
 async function resume(){
  if(busy)return;let op=pending();const saved=context(id);
  if(!op){try{const w=await wallet(),state=await discover(w);if(state.preview&&state.preview.review?.pool!==id){setStatus(review,'The saved Robinhood operation belongs to '+state.preview.review?.pool+'. Open that pool to resume.');return;}if(state.preview&&(state.txHash||state.requestId)){op={pool:id,action:state.action,preview:normalizeEvmPreview(state.preview),credentialId:w.id,requestId:state.requestId,txHash:state.txHash,status:state.status};save(op);remember(op);}else{setStatus(review,state.nextReviewRequired?'Approval confirmed. Review a fresh mint.':'No submitted or signing operation found. Review when ready.');return;}}catch(e:any){setStatus(review,e.message);return;}}
  if(!op){setStatus(review,'No pending Robinhood operation on this device.');return;}if(!canResumeInPool(op,id)){setStatus(review,'The pending Robinhood operation belongs to '+op.pool+'. Open that pool to resume.');return;}
  busy=true;lock(true,op.status);summaryShell(review,evmSummary(op.preview));
  try{const action=interruptedAction(op);if(action==='status'){receipt(review,op);await confirm(review,op);}else if(action==='request')await finishPaybox(review,op);else if(action==='expired'){clear(op);setStatus(review,'Unsigned review expired. Review again when ready.');}else{const state=await api(statusPath(op));if(state.requestId){op.requestId=state.requestId;save(op);await finishPaybox(review,op);}else if(state.txHash){op.txHash=state.txHash;save(op);receipt(review,op);await confirm(review,op);}else setStatus(review,'The signing response was interrupted. Resume after review expiry; do not create another request.');}}
  catch(e:any){setStatus(review,e.message);}finally{busy=false;lock(!!pending()&&canResumeInPool(pending(),id),pending()?.status||'idle');}
 }
 find('[data-recovery]').onclick=resume;
 find('[data-preview]').onclick=async()=>{
  if(busy)return;if(pending()){setStatus(review,'Resume the pending Robinhood operation before reviewing another.');return;}
  const state=composer.snapshot(),draft=state.draft;if(mode==='open'){const error=rangeError(draft.lowerPriceEth,draft.upperPriceEth);if(error){setStatus(review,error);return;}if(draft.strategy!=='spot'){setStatus(review,'Robinhood V3 supports Spot here. Select Spot for this review.');return;}}
  busy=true;find('[data-preview]').disabled=true;setStatus(review,'Reading the pool and simulating the current transaction…');
  try{const w=await wallet(),server=await discover(w);if(['awaiting-signature','submitting','pending'].includes(server.status)&&!(server.status==='awaiting-signature'&&!server.txHash&&server.preview?.expiresAt<=Date.now()))throw new Error('Resume the saved Robinhood operation before reviewing another.');const operationId=server.status==='confirmed'&&server.stage==='approval'&&server.action===mode&&server.preview?.review?.pool===id?server.operationId:undefined;
   const d=normalizeEvmPreview(await api('/api/evm/preview',{action:mode,pool:id,owner:w.address,credentialId:w.id,amountEth:draft.amountEth,amountToken:mode==='open'?draft.amountToken:undefined,priceLowerEth:mode==='open'?draft.lowerPriceEth:undefined,priceUpperEth:mode==='open'?draft.upperPriceEth:undefined,strategy:'spot',slippageBps:draft.slippageBps,operationId}));
   const p={...d,owner:w.address,credentialId:w.id,walletKind:'paybox',action:mode};if(!host.isConnected||!composer.acceptPreview(p,state.revision))return;remember({pool:id,preview:p,credentialId:w.id,action:mode});emit('lp:execution-review',{pool:id,family:'evm',preview:p});summaryShell(review,evmSummary(p));setStatus(review,'Review ready. Approve this exact '+p.stage+' transaction.');(review.querySelector('[data-workflow-actions]') as HTMLElement).innerHTML='<p data-expiry class="note"></p><button data-sign>Approve in PayBox</button>';find('[data-sign]').onclick=submit;
  }catch(e:any){setStatus(review,e.message);composer.clearReview();}finally{busy=false;find('[data-preview]').disabled=composer.snapshot().locked;}
 };
 async function submit(){
  const p=composer.snapshot().review;if(busy||!p)return;if(!composer.usable()){setStatus(review,'Review expired. Review again for current state.');composer.clearReview();return;}if(pending()){setStatus(review,'Resume your pending operation first.');return;}
  busy=true;lock(true,'awaiting-wallet');find('[data-sign]').disabled=true;
  try{const w=await wallet();if(w.address.toLowerCase()!==p.owner.toLowerCase()||w.id!==p.credentialId)throw new Error('Wallet changed. Review again.');const op:any={pool:id,pair:typeof pool==='object'?pool.pair:'',action:mode,credentialId:w.id,preview:p,status:'awaiting-wallet'};save(op);remember(op);composer.clearReview();setStatus(review,'Creating the PayBox signing request…');const created=await requestPayboxSignature({credential_id:w.id,_evmPreviewId:p.previewId,intent:{op:'transaction',transaction:p.transactionJson}},requestId=>{op.requestId=requestId;save(op);});await finishPaybox(review,op,created);
  }catch(e:any){setStatus(review,e.message);}finally{busy=false;lock(!!pending()&&canResumeInPool(pending(),id),pending()?.status||'idle');}
 }
 const op=pending();if(op&&canResumeInPool(op,id)){lock(true,op.status);summaryShell(review,evmSummary(op.preview));setStatus(review,'Saved operation. Resume to check its existing request or transaction.');}
 const timer=setInterval(()=>{if(!host.isConnected){clearInterval(timer);unsubscribe();return;}const state=composer.snapshot(),expiry=review.querySelector('[data-expiry]') as HTMLElement;if(expiry&&state.review){const seconds=Math.max(0,Math.ceil((state.review.expiresAt-Date.now())/1000));expiry.textContent=seconds?'Review expires in '+seconds+' seconds.':'Review expired. Review again before approval.';const sign=review.querySelector('[data-sign]') as HTMLButtonElement;if(sign)sign.disabled=!composer.usable()||busy;}},1000);
 emit('lp:execution-draft',{pool:id,family:'evm',...composer.snapshot()});
}
