import {Keypair,VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {mountPaybox,payboxWallet,requestPayboxSignature,payboxResult,applyPayboxSignature,reopenPaybox,payboxReady,signingCard,mountWalletPicker,PayboxWallet} from './paybox-browser';
import {ExecutionDraft,readOperation,writeOperation,removeOperation,canResumeInPool,interruptedAction,rangeError} from './composer-state';
import {esc,api,sleep,emit,composerFor,installExecutionApi,summaryShell,setStatus,showReceipt,setFormLocked,announceOperation} from './composer-ui';
import {mountEvm} from './evm-browser';
const sol=(n:number)=>(n/1e9).toFixed(6);
function pending(){return readOperation(localStorage,'solana');}
function save(op:any){writeOperation(localStorage,'solana',op);announceOperation(op.pool||op.preview.pool,'solana',op.status,true);}
function clearPending(op:any){removeOperation(localStorage,'solana',op);announceOperation(op.pool||op.preview.pool,'solana',op.status,false);}
export function solanaSummary(p:any,context:{pair?:string;pool?:string}={}){
 const exit=p.action==='exit',allocation=p.allocation;
 const bins=Array.isArray(allocation?.bins)?allocation.bins:[];
 const largest=Math.max(0,...bins.map((b:any)=>Number(b.valueSolAtReview)||0));
 const allocations=bins.length?`<details class="execution-allocation" open><summary>${esc(allocation.status==='simulated'?'Simulated allocation':'Expected allocation')} · ${bins.length} bins</summary><p class="note">${esc(allocation.assumption||'Allocation valued at the reviewed price. Token amounts can change before execution.')} ${allocation.asOf?'As of '+esc(allocation.asOf):''}</p><div class="execution-bin-bars">${bins.map((b:any)=>`<div title="Bin ${esc(b.binId)} · ${esc(b.priceSol)} SOL per token"><span>${esc(b.binId)}</span><i style="width:${largest?Math.max(2,Math.min(100,Number(b.valueSolAtReview)/largest*100)):0}%"></i><b>${Number.isFinite(Number(b.valueSolAtReview))?Number(b.valueSolAtReview).toPrecision(4):'Unknown'} SOL</b></div>`).join('')}</div></details>`:'';
 return `<h4>${exit?'Close to SOL':'Reviewed LP position'}${context.pair?' · '+esc(context.pair):''}</h4><div class="kv">${exit?'':`<div><span>LP budget · SOL</span><b>${esc(p.amountSol)}</b></div>`}<div><span>Network fee · SOL</span><b>${sol(p.networkFeeLamports)}</b></div><div><span>Account deposits · SOL</span><b>${sol(p.rentDepositedLamports||0)}</b></div><div><span>Account refunds · SOL</span><b>${sol(p.rentReturnedLamports||0)}</b></div><div><span>Wallet after · SOL</span><b>${sol(p.postBalanceLamports)}</b></div><div><span>Net wallet change · SOL</span><b>${sol(p.netChangeLamports)}</b></div></div><p>${exit?'Position proceeds convert to SOL; existing wallet tokens stay separate.':p.depositMode==='sol-only'?'SOL-only deposit. No paired token purchase.':`Swap minimum: ${(Number(p.swapMinimumRaw)/10**p.pairedTokenDecimals).toLocaleString(undefined,{maximumFractionDigits:8})} paired tokens. Unused paired tokens stay in your wallet.`}</p>${p.lowerPriceSol&&p.upperPriceSol?`<p class="execution-range"><b>${esc(p.lowerPriceSol)} – ${esc(p.upperPriceSol)}</b> SOL per paired token</p>`:''}<p>Native bins ${esc(p.lowerBin)} – ${esc(p.upperBin)}${p.strategy?' · '+esc(p.strategy):''}${p.depositMode?' · '+esc(p.depositMode):''}</p>${allocations}<p class="note">Account deposits are separate from the LP budget; some rent is refundable when accounts close.</p><p class="note">Solana mainnet · wallet ${esc(p.owner)}<br>Pool ${esc(context.pool||p.pool)}<br>Position ${esc(p.position)}<br>Simulation slot ${esc(p.simulationSlot)} · reviewed ${esc(new Date(p.expiresAt-75000).toLocaleTimeString())}</p>`;
}
function restoreSummary(host:HTMLElement,op:any){summaryShell(host,solanaSummary(op.preview,{pair:op.pair,pool:op.pool}));}
function receipt(host:HTMLElement,signature:string){setStatus(host,'Submitted. Checking confirmation…');showReceipt(host,'https://solscan.io/tx/'+encodeURIComponent(signature));}
async function confirm(host:HTMLElement,op:any){
 for(let i=0;i<25&&host.isConnected;i++){
  const d=await api('/api/solana/status?signature='+encodeURIComponent(op.signature));if(!host.isConnected)return;
  if(d.status?.err){clearPending(op);setStatus(host,'Failed on-chain. State changes rolled back; the network fee was charged.');return;}
  if(['confirmed','finalized'].includes(d.status?.confirmationStatus)){localStorage.setItem('lp-solana-last-receipt',JSON.stringify({...op,status:'confirmed'}));clearPending(op);setStatus(host,'Confirmed on Solana. Positions can now be refreshed.');emit('lp:positions-refreshed',null);return;}
  if(d.blockHeight>op.preview.lastValidBlockHeight&&!d.status){clearPending(op);setStatus(host,'Expired without confirmation. Review again for a fresh transaction.');return;}
  await sleep(2000);
 }
 if(host.isConnected)setStatus(host,'Still awaiting confirmation. Resume the same operation; do not submit a replacement.');
}
async function finishPaybox(host:HTMLElement,op:any,created?:any){
 const card=host.querySelector('[data-signing-card]') as HTMLElement,actions=host.querySelector('[data-workflow-actions]') as HTMLElement;
 actions.innerHTML='<button data-reopen>Reopen signing card</button>';
 (actions.querySelector('[data-reopen]') as HTMLButtonElement).onclick=()=>reopenPaybox(card,op.requestId).catch(e=>setStatus(host,e.message));
 if(created)await signingCard(card,created.input,created.result);
 else if((await payboxResult(op.requestId)).status!=='success')await reopenPaybox(card,op.requestId);
 for(let i=0;i<60&&host.isConnected;i++){
  const result=await payboxResult(op.requestId);if(!host.isConnected)return;
  if(['error','denied'].includes(result.status)){clearPending(op);setStatus(host,'PayBox '+result.status+'. This terminal submitted no transaction. Your signing setup is retained.');return;}
  if(result.status==='success'){
   if(Date.now()>=op.preview.expiresAt){clearPending(op);setStatus(host,'Review expired before submission. Review again; your signing setup is retained.');return;}
   const tx=VersionedTransaction.deserialize(Buffer.from(op.partialTransaction,'base64'));
   const signed=applyPayboxSignature(tx,result,op.preview.owner);
   op.signature=bs58.encode(tx.signatures[0]);op.status='submitting';save(op);
   try{await api('/api/solana/send',{previewId:op.preview.previewId,signedTransactionBase64:signed});}
   catch(e:any){receipt(host,op.signature);setStatus(host,'Submission needs checking: '+e.message);return;}
   receipt(host,op.signature);await confirm(host,op);return;
  }
  setStatus(host,result.status==='pending_approval'?'Approve in PayBox, then complete its signing card.':'Waiting for your PayBox signature…');
  if(result.approval_url){const url=new URL(result.approval_url);if(url.protocol==='https:'&&url.hostname==='app.paybox.sh'&&!actions.querySelector('a'))actions.insertAdjacentHTML('beforeend',`<a href="${esc(url.href)}" target="_blank" rel="noopener">Open PayBox approval ↗</a>`);}
  await sleep(2000);
 }
 if(host.isConnected)setStatus(host,'Signing is pending. Resume this operation to reopen the same request.');
}
export function mountSolana(host:HTMLElement,pool:string,exit=false,ownerHint='',options:{poolMeta?:any;draft?:Partial<ExecutionDraft>}={}){
 let key:Keypair|null=null,busy=false,selected:PayboxWallet|null=null;
 const composer=composerFor(pool,'solana',{...(options.draft||{}),action:exit?'exit':'open'}),initial=composer.snapshot().draft;
 const pair=options.poolMeta?.pair||'';
 host.classList.add('execution-composer');
 host.innerHTML=`<h3>${exit?'Close to SOL':'Compose LP position'}</h3><p>${exit?'Select one position to withdraw, collect fees and convert the proceeds to SOL.':'Use the chart or exact prices below. Review snaps your range to native bins and simulates the transaction.'}</p><div class="execution-grid"><div class="execution-form"><label>Approve with <select data-wallet-kind data-composer-field="walletKind"><option value="paybox">PayBox · desktop and phone</option><option value="phantom">Phantom</option></select></label><div data-wallet-picker></div>${exit?'<label>Position <select data-sol-position><option value="">Load positions first</option></select></label><button data-load>Load positions</button>':`<label>LP budget · SOL <input data-composer-field="amountSol" inputmode="decimal" value="${esc(initial.amountSol)}"></label><div class="execution-actions"><button data-budget="0.5">0.5 SOL</button><button data-budget="1">1 SOL</button></div><label>Funding <select data-composer-field="depositMode"><option value="two-sided">Two-sided · swap and deposit</option><option value="sol-only">SOL only · one-sided</option></select></label><label>Shape <select data-composer-field="strategy"><option value="spot">Spot · even</option><option value="curve">Curve · centre</option><option value="bid-ask">Bid-Ask · edges</option></select></label><div class="execution-range-inputs"><label>Floor · SOL per token <input data-composer-field="lowerPriceSol" inputmode="decimal" placeholder="Choose on chart"></label><label>Top · SOL per token <input data-composer-field="upperPriceSol" inputmode="decimal" placeholder="Choose on chart"></label></div><p class="note">For SOL-only, choose Below price on the chart or enter both bounds below the active price. Review verifies the current bins.</p>`}<label>Swap slippage <select data-composer-field="slippageBps"><option value="50">0.5%</option><option value="100">1%</option><option value="200">2%</option><option value="300">3%</option></select></label><div class="execution-actions"><button data-preview>Review ${exit?'exit':'position'}</button><button data-recovery>Resume pending operation</button></div></div><div data-review class="execution-review" aria-live="polite"></div></div>`;
 const find=(s:string)=>host.querySelector(s) as HTMLInputElement,review=find('[data-review]');
 function sync(){const state=composer.snapshot();host.querySelectorAll<HTMLInputElement>('[data-composer-field]').forEach(node=>{const field=node.dataset.composerField!;const value=String((state.draft as any)[field]);if(node.value!==value)node.value=value;});const bidAsk=host.querySelector('[data-composer-field="strategy"] option[value="bid-ask"]');if(bidAsk)bidAsk.textContent=state.draft.depositMode==='sol-only'?'Bid-Ask · weighted toward floor':'Bid-Ask · edges';find('[data-wallet-picker]').hidden=state.draft.walletKind!=='paybox';setFormLocked(host,state.locked);}
 let lastRevision=composer.snapshot().revision;const unsubscribe=composer.subscribe(state=>{if(!host.isConnected){unsubscribe();return;}sync();if(state.revision!==lastRevision){lastRevision=state.revision;key=null;review.innerHTML='';}});sync();
 host.querySelectorAll<HTMLInputElement>('[data-composer-field]').forEach(node=>node.addEventListener(node.tagName==='SELECT'?'change':'input',()=>{const field=node.dataset.composerField!,value=field==='slippageBps'?Number(node.value):node.value;composer.update({[field]:value});key=null;}));
 host.querySelectorAll<HTMLButtonElement>('[data-budget]').forEach(button=>button.onclick=()=>composer.update({amountSol:button.dataset.budget}));
 void mountWalletPicker(find('[data-wallet-picker]'),'solana',wallet=>{selected=wallet;if(wallet?.id!==composer.snapshot().draft.credentialId)composer.update({credentialId:wallet?.id||''});sync();},{pool:'solana:'+pool,selectedId:initial.credentialId});
 async function selectedWallet(connect=false){const draft=composer.snapshot().draft;if(draft.walletKind==='paybox'){const w=await payboxWallet({id:selected?.id||draft.credentialId});return w?{...w,kind:'paybox'}:ownerHint&&!connect?{address:ownerHint,id:'',kind:'paybox'}:null;}const p=(window as any).phantom?.solana;if(connect&&p?.isPhantom&&!p.publicKey)await p.connect();return p?.publicKey?{address:p.publicKey.toBase58(),id:'',kind:'phantom'}:ownerHint&&!connect?{address:ownerHint,id:'',kind:'phantom'}:null;}
 if(exit)find('[data-load]').onclick=async()=>{try{const w=await selectedWallet();if(!w)throw new Error('Connect a wallet first.');const d=await api('/api/solana/owned?owner='+encodeURIComponent(w.address)+'&pool='+encodeURIComponent(pool));find('[data-sol-position]').innerHTML=d.positions.length?d.positions.map((p:any)=>`<option value="${esc(p.address)}">${esc(p.address.slice(0,7)+'…'+p.address.slice(-5))} · bins ${p.lowerBin}–${p.upperBin}</option>`).join(''):'<option value="">No open positions</option>';setStatus(review,'Positions read for '+w.address);}catch(e:any){setStatus(review,e.message);}};
 if(exit)find('[data-sol-position]').onchange=()=>composer.update({});
 function lock(value:boolean,status='review'){composer.lock(value);setFormLocked(host,value);announceOperation(pool,'solana',status,value);}
 async function resume(){if(busy)return;const op=pending();if(!op){setStatus(review,'No pending Solana transaction on this device.');return;}if(!canResumeInPool(op,pool)){setStatus(review,'A pending transaction belongs to another pool: '+(op.pool||op.preview.pool)+'. Open that pool to resume it.');return;}busy=true;lock(true,op.status);restoreSummary(review,op);try{const action=interruptedAction(op);if(action==='status'){receipt(review,op.signature);await confirm(review,op);}else if(action==='request')await finishPaybox(review,op);else if(action==='expired'){clearPending(op);setStatus(review,'Unsigned review expired. Review again when ready.');}else if(action==='recover'){const recovered=await api('/api/paybox/recover?previewId='+encodeURIComponent(op.preview.previewId));if(recovered.requestId){op.requestId=recovered.requestId;save(op);await finishPaybox(review,op);}else setStatus(review,'The request response was interrupted. Resume after this review expires; do not create another signing request.');}else setStatus(review,'Check Phantom activity before trying again. Its response was interrupted.');}catch(e:any){setStatus(review,e.message);}finally{busy=false;lock(!!pending()&&canResumeInPool(pending(),pool),pending()?.status||'idle');}}
 find('[data-recovery]').onclick=resume;
 find('[data-preview]').onclick=async()=>{
  if(busy)return;if(pending()){setStatus(review,'Resume the pending Solana operation before reviewing another.');return;}
  const state=composer.snapshot(),draft=state.draft;
  if(!exit){const error=rangeError(draft.lowerPriceSol,draft.upperPriceSol);if(error){setStatus(review,error);return;}}
  busy=true;find('[data-preview]').disabled=true;setStatus(review,'Reading current pool state and simulating…');
  try{const w=await selectedWallet(true);if(!w)throw new Error('Connect and select your wallet above.');if(w.kind==='paybox'&&!(await payboxReady(w.id)))throw new Error('Use Set up signing above once, then review again.');key=exit?null:Keypair.generate();
   const d=await api('/api/solana/preview',{action:exit?'exit':'enter',owner:w.address,pool,position:exit?find('[data-sol-position]').value:key!.publicKey.toBase58(),amountSol:exit?undefined:draft.amountSol,strategy:({spot:0,curve:1,'bid-ask':2})[draft.strategy],lowerPriceSol:exit?undefined:draft.lowerPriceSol,upperPriceSol:exit?undefined:draft.upperPriceSol,depositMode:exit?undefined:draft.depositMode,slippageBps:draft.slippageBps});
   if(!host.isConnected||!composer.acceptPreview({...d,walletKind:w.kind,credentialId:w.id,action:exit?'exit':'enter'},state.revision)){key=null;return;}
   host.dispatchEvent(new CustomEvent('solana-preview',{detail:d,bubbles:true}));emit('lp:execution-review',{pool,family:'solana',preview:d});
   summaryShell(review,solanaSummary({...d,action:exit?'exit':'enter'},{pair,pool}));setStatus(review,'Review is ready. Approval submits this exact transaction.');(review.querySelector('[data-workflow-actions]') as HTMLElement).innerHTML=`<p data-expiry class="note"></p><button data-sign>Approve ${exit?'exit':'position'} in ${w.kind==='paybox'?'PayBox':'Phantom'}</button>`;find('[data-sign]').onclick=submit;
  }catch(e:any){setStatus(review,e.message);composer.clearReview();key=null;}finally{busy=false;find('[data-preview]').disabled=composer.snapshot().locked;}
 };
 async function submit(){
  const state=composer.snapshot(),p=state.review;if(busy||!p)return;if(!composer.usable()){setStatus(review,'Review expired. Review again for current prices.');composer.clearReview();return;}if(pending()){setStatus(review,'Resume the pending operation first.');return;}
  busy=true;lock(true,'awaiting-wallet');find('[data-sign]').disabled=true;
  try{const w=await selectedWallet(true);if(w?.address!==p.owner||w.kind!==p.walletKind||(w.kind==='paybox'&&w.id!==p.credentialId))throw new Error('Wallet changed. Review again.');const tx=VersionedTransaction.deserialize(Buffer.from(p.transactionBase64,'base64'));if(key)tx.sign([key]);const op:any={pool,pair,preview:p,partialTransaction:Buffer.from(tx.serialize()).toString('base64'),status:'awaiting-wallet'};save(op);composer.clearReview();key=null;
   if(w.kind==='paybox'){setStatus(review,'Creating the PayBox signing request…');const created=await requestPayboxSignature({credential_id:w.id,_previewId:p.previewId,intent:{op:'raw',rawSigningPayloadHex:p.messageHex}},id=>{op.requestId=id;save(op);});await finishPaybox(review,op,created);}
   else{setStatus(review,'Approve in Phantom…');const result=await (window as any).phantom.solana.signAndSendTransaction(tx);op.signature=result.signature;op.status='submitted';save(op);receipt(review,op.signature);await confirm(review,op);}
  }catch(e:any){if(e.code===4001)clearPending(p);setStatus(review,e.message);}finally{busy=false;lock(!!pending()&&canResumeInPool(pending(),pool),pending()?.status||'idle');}
 }
 const op=pending();if(op&&canResumeInPool(op,pool)){lock(true,op.status);restoreSummary(review,op);setStatus(review,'Saved operation. Resume to check its existing request or transaction.');}
 const timer=setInterval(()=>{if(!host.isConnected){clearInterval(timer);unsubscribe();return;}const state=composer.snapshot(),expiry=review.querySelector('[data-expiry]') as HTMLElement;if(expiry&&state.review){const seconds=Math.max(0,Math.ceil((state.review.expiresAt-Date.now())/1000));expiry.textContent=seconds?'Review expires in '+seconds+' seconds.':'Review expired. Review again before approval.';const sign=review.querySelector('[data-sign]') as HTMLButtonElement;if(sign)sign.disabled=!composer.usable()||busy;}},1000);
 emit('lp:execution-draft',{pool,family:'solana',...composer.snapshot()});
}
installExecutionApi();(window as any).mountSolana=mountSolana;(window as any).mountEvm=mountEvm;
function operationNotice(){const h=document.querySelector('#operationNotice') as HTMLElement;if(!h)return;const solOp=pending(),evmOp=readOperation(localStorage,'evm'),op=solOp||evmOp;h.hidden=!op;if(op){const id=solOp?'solana:'+(op.pool||op.preview.pool):op.pool||op.preview.review?.pool;h.innerHTML=`Saved ${solOp?'Solana':'Robinhood'} operation · ${esc(op.pair||id)} · ${esc(op.status)}. <a href="/?compose=${encodeURIComponent(id)}#alpha">Open and resume ↗</a>`;}}
operationNotice();document.addEventListener('lp-operation-changed',operationNotice);window.addEventListener('storage',operationNotice);setInterval(operationNotice,5000);
const payboxHost=document.querySelector('#payboxConnection') as HTMLElement;if(payboxHost)void mountPaybox(payboxHost);
