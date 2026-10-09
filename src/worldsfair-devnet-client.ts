import {Connection,PublicKey,Transaction,TransactionInstruction,ComputeBudgetProgram} from '../execution/node_modules/@solana/web3.js';
import {Buffer} from '../execution/node_modules/buffer';

export const DEVNET_RPC='https://api.devnet.solana.com';
export const DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MEMO_PROGRAM='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const STORAGE_KEY='worldsfair:devnet-stamps:v1',MAX_SAVED=128;
export type StampTarget={kind:'fleet-open';id:string}|{kind:'fleet-close';id:string;closedAt:string}|{kind:'pot-roll';eventId:string}|{kind:'still-basket';eventId:string};
type StampStatus='confirmed'|'pending'|'unavailable'|'cancelled'|'failed'|'expired';
export interface StampResult {status:StampStatus;message:string;receiptId?:string;signature?:string;explorerUrl?:string}
interface Receipt {id:string;memo:string;target:StampTarget;eventAt:string;eventHash:string;wallet:string;status:'ready'|'confirmed';signature?:string;explorerUrl?:string}
interface Pending {version:1;target:StampTarget;receiptId:string;wallet:string;memo:string;eventAt:string;eventHash:string;signature:string;wireBase64:string;blockhash:string;lastValidBlockHeight:number;createdAt:string;state:'signed'|'confirmed'|'failed'|'expired'}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
interface Phantom {isPhantom?:boolean;publicKey?:PublicKey;connect():Promise<{publicKey:PublicKey}>;signTransaction(transaction:Transaction):Promise<Transaction>}
interface Locks {request<T>(name:string,options:{ifAvailable:true},callback:(lock:unknown)=>Promise<T>):Promise<T>}
interface Rpc {getGenesisHash():Promise<string>;getLatestBlockhash(commitment:'confirmed'):Promise<{blockhash:string;lastValidBlockHeight:number}>;sendRawTransaction(bytes:Uint8Array,options:{skipPreflight:false;preflightCommitment:'confirmed';maxRetries:0}):Promise<string>;getSignatureStatuses(signatures:string[],options:{searchTransactionHistory:true}):Promise<{value:({err:unknown;confirmationStatus?:string|null}|null)[]}>;getBlockHeight(commitment:'confirmed'):Promise<number>}
interface Consent {stage:'connect'|'sign';target:StampTarget;wallet?:string;memo?:string;receiptId?:string}
type BrowserFetch=(input:string,init?:RequestInit&{credentials?:'same-origin'})=>Promise<Response>;
interface Dependencies {storage:Storage;fetch:BrowserFetch;rpc:Rpc;phantom:()=>Phantom|null;locks?:Locks;consent:(detail:Consent)=>Promise<boolean>;emit?:(detail:{target:StampTarget}&StampResult)=>void;now?:()=>number}
class StampError extends Error {}
const validText=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
function normalizeTarget(value:any):StampTarget {
 if(value?.kind==='still-basket'&&typeof value.eventId==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(value.eventId))return {kind:'still-basket',eventId:value.eventId};
 if(value?.kind==='pot-roll'&&validText(value.eventId,200))return {kind:'pot-roll',eventId:value.eventId};
 if(value?.kind==='fleet-open'&&validText(value.id,240))return {kind:'fleet-open',id:value.id};
 if(value?.kind==='fleet-close'&&validText(value.id,240)&&validText(value.closedAt,40)&&Number.isFinite(Date.parse(value.closedAt)))return {kind:'fleet-close',id:value.id,closedAt:value.closedAt};
 throw new StampError('This Paper record cannot be stamped.');
}
const targetKey=(target:StampTarget)=>JSON.stringify(normalizeTarget(target));
const explorer=(signature:string)=>'https://explorer.solana.com/tx/'+signature+'?cluster=devnet';
const equalBytes=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
function signatureText(bytes:Uint8Array){
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const byte of bytes)n=n*256n+BigInt(byte);
 let out='';while(n>0n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const byte of bytes){if(byte!==0)break;out='1'+out;}return out;
}
function publicKey(value:unknown){try{if(typeof value!=='string')throw Error();const key=new PublicKey(value);if(key.toBase58()!==value)throw Error();return key;}catch{throw new StampError('The wallet or devnet block identifier could not be verified.');}}
export function buildMemoTransaction(wallet:string,memo:string,blockhash:string,lastValidBlockHeight:number){
 const payer=publicKey(wallet);publicKey(blockhash);
 if(typeof memo!=='string'||!memo.length||Buffer.byteLength(memo,'utf8')>512||!Number.isSafeInteger(lastValidBlockHeight)||lastValidBlockHeight<=0)throw new StampError('The devnet memo could not be verified.');
 return new Transaction({feePayer:payer,blockhash,lastValidBlockHeight}).add(
  ComputeBudgetProgram.setComputeUnitLimit({units:100000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:0}),
  new TransactionInstruction({programId:new PublicKey(MEMO_PROGRAM),keys:[{pubkey:payer,isSigner:true,isWritable:false}],data:Buffer.from(memo,'utf8')}),
 );
}
function verifiedReceipt(body:any,target:StampTarget,wallet:string):Receipt {
 const receipt=body?.receipt;
 if(body?.paper!==true||body.cluster!=='devnet'||!receipt||!validText(receipt.id,200)||targetKey(receipt.target)!==targetKey(target)||receipt.wallet!==wallet||typeof receipt.eventHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.eventHash)||!validText(receipt.eventAt,40)||!Number.isFinite(Date.parse(receipt.eventAt))||receipt.memo!==`Paper record | devnet | v1 | ${target.kind} | sha256:${receipt.eventHash}`||!['ready','confirmed'].includes(receipt.status))throw new StampError('The Paper record returned an invalid devnet receipt.');
 if(receipt.status==='confirmed'&&(typeof receipt.signature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature)))throw new StampError('The confirmed devnet signature could not be verified.');
 return receipt;
}
function validatedPending(value:any,target:StampTarget):Pending {
 if(value?.version!==1||targetKey(value.target)!==targetKey(target)||!validText(value.receiptId,200)||!validText(value.wallet,44)||typeof value.memo!=='string'||!validText(value.signature,88)||typeof value.wireBase64!=='string'||value.wireBase64.length>1800||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.wireBase64)||!['signed','confirmed','failed','expired'].includes(value.state))throw new StampError('The saved devnet attempt needs review. No replacement will be signed.');
 verifiedReceipt({paper:true,cluster:'devnet',receipt:{id:value.receiptId,memo:value.memo,target:value.target,wallet:value.wallet,eventAt:value.eventAt,eventHash:value.eventHash,status:'ready'}},target,value.wallet);
 const expected=buildMemoTransaction(value.wallet,value.memo,value.blockhash,value.lastValidBlockHeight),wire=Buffer.from(value.wireBase64,'base64');
 if(wire.toString('base64')!==value.wireBase64)throw new StampError('The saved devnet attempt is unreadable. No replacement will be signed.');
 let signed:Transaction;try{signed=Transaction.from(wire);}catch{throw new StampError('The saved devnet attempt is unreadable. No replacement will be signed.');}
 if(!equalBytes(signed.serializeMessage(),expected.serializeMessage())||signed.signatures.length!==1||!signed.signature||signatureText(signed.signature)!==value.signature||!signed.verifySignatures())throw new StampError('The saved transaction is not the approved devnet memo. Nothing was sent.');
 return value;
}

/** Dependencies are injected only by tests; the public browser API always uses
 * the constant devnet Connection below. There is no wallet send fallback.
 */
export function createDevnetClient(deps:Dependencies){
 const now=deps.now||Date.now,busy=new Set<string>();
 const emit=(target:StampTarget,result:StampResult)=>{deps.emit?.({target,...result});return result;};
 const records=():Pending[]=>{let raw:string|null;try{raw=deps.storage.getItem(STORAGE_KEY);}catch{throw new StampError('Browser recovery storage is unavailable. No memo will be signed or sent.');}if(raw===null)return [];try{const list=JSON.parse(raw);if(!Array.isArray(list)||list.length>MAX_SAVED)throw Error();return list;}catch{throw new StampError('Saved devnet recovery data is unreadable. No replacement will be signed.');}};
 const pending=(target:StampTarget)=>{const matches=records().filter(row=>targetKey(row.target)===targetKey(target));if(matches.length>1)throw new StampError('More than one saved attempt needs review. No replacement will be signed.');return matches.length?validatedPending(matches[0],target):null;};
 const save=(record:Pending)=>{const list=records().filter(row=>targetKey(row.target)!==targetKey(record.target));if(list.length>=MAX_SAVED)throw new StampError('This browser has reached its devnet recovery limit. No new memo was sent.');list.push(record);const raw=JSON.stringify(list);try{deps.storage.setItem(STORAGE_KEY,raw);if(deps.storage.getItem(STORAGE_KEY)!==raw)throw Error();}catch{throw new StampError('The signed memo could not be saved for recovery. It was not sent.');}};
 const storageAvailable=()=>{const key=STORAGE_KEY+':check';try{deps.storage.setItem(key,'ready');if(deps.storage.getItem(key)!=='ready')throw Error();deps.storage.removeItem(key);}catch{throw new StampError('Browser recovery storage is unavailable. No memo will be signed or sent.');}};
 const post=async(path:string,body:unknown)=>{const response=await deps.fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});let data:any;try{data=await response.json();}catch{throw new StampError('The Paper receipt service is unavailable. Your Paper record is unchanged.');}if(!response.ok)throw new StampError(typeof data?.error==='string'?data.error.slice(0,180):'The devnet receipt could not be checked.');return data;};
 const ensureSession=async()=>{const response=await deps.fetch('/api/paper/stamps',{method:'GET',credentials:'same-origin',signal:AbortSignal.timeout(20000)});let data:any;try{data=await response.json();}catch{throw new StampError('The Paper session could not be opened. Nothing was signed or sent.');}if(!response.ok||data?.paper!==true||data.cluster!=='devnet'||!Array.isArray(data.receipts))throw new StampError('The Paper session could not be opened. Nothing was signed or sent.');};
 const assertDevnet=async()=>{if(await deps.rpc.getGenesisHash()!==DEVNET_GENESIS)throw new StampError('The RPC did not identify Solana devnet. Nothing was signed or sent.');};
 async function confirm(record:Pending):Promise<StampResult>{
  const data=await post('/api/paper/stamp-confirm',{receiptId:record.receiptId,signature:record.signature});
  const receipt=verifiedReceipt(data,record.target,record.wallet);
  if(receipt.id!==record.receiptId||receipt.memo!==record.memo||receipt.eventHash!==record.eventHash)throw new StampError('The saved receipt no longer matches this memo.');
  if(receipt.status==='confirmed'){
   if(receipt.signature!==record.signature)throw new StampError('The receipt returned a different signature.');
   save({...record,state:'confirmed'});return {status:'confirmed',message:'Devnet memo confirmed. Your Paper record is unchanged.',receiptId:record.receiptId,signature:record.signature,explorerUrl:explorer(record.signature)};
  }
  return {status:'pending',message:'Devnet confirmation is pending. Check this saved attempt; no new signature is needed.',receiptId:record.receiptId,signature:record.signature,explorerUrl:explorer(record.signature)};
 }
 const savedResult=(record:Pending,status:StampStatus,message:string):StampResult=>({status,message,receiptId:record.receiptId,signature:record.signature,explorerUrl:explorer(record.signature)});
 async function check(record:Pending):Promise<StampResult>{
  try{
   await ensureSession();
   if(record.target.kind==='still-basket') {
    // A cleared session cookie must not authorize a recovery broadcast for an
    // event owned by the prior session. Revalidate the immutable receipt first.
    const owned=verifiedReceipt(await post('/api/paper/stamp-prepare',{target:record.target,wallet:record.wallet}),record.target,record.wallet);
    if(owned.id!==record.receiptId||owned.memo!==record.memo||owned.eventHash!==record.eventHash)throw new StampError('This browser session no longer matches the saved basket receipt. Nothing was sent.');
   }
   // Browser storage is a recovery aid, never evidence of on-chain confirmation.
   if(record.state==='confirmed')return await confirm(record);
   await assertDevnet();const statuses=await deps.rpc.getSignatureStatuses([record.signature],{searchTransactionHistory:true});
   if(!Array.isArray(statuses.value)||statuses.value.length!==1)throw new StampError('Devnet status is unavailable.');
   const status=statuses.value[0],settled=status&&['confirmed','finalized'].includes(status.confirmationStatus||'');
   if(settled&&status.err){save({...record,state:'failed'});return savedResult(record,'failed','This devnet memo failed. Your Paper record is unchanged; no replacement is signed.');}
   if(settled)return await confirm(record);
   if(status)return savedResult(record,'pending','This saved memo is still being processed. Check again; no new signature is needed.');
   if(record.state==='failed')return savedResult(record,'failed','The saved memo failed. No replacement will be signed.');
   if(record.state==='expired'){try{const result=await confirm(record);if(result.status==='confirmed')return result;}catch{}return savedResult(record,'expired','The saved memo’s sending window expired. Check its Explorer record; no replacement will be signed automatically.');}
   const height=await deps.rpc.getBlockHeight('confirmed');if(!Number.isSafeInteger(height)||height<0)throw new StampError('Devnet block height is unavailable.');
   if(height>record.lastValidBlockHeight){
    // A missing history result is not proof that a memo never landed. Retain
    // its signature and never re-sign an ambiguous or expired attempt.
    try{const result=await confirm(record);if(result.status==='confirmed')return result;}catch{}
    save({...record,state:'expired'});return savedResult(record,'expired','The saved memo’s sending window expired. Check its Explorer record; no replacement will be signed automatically.');
   }
   const sent=await deps.rpc.sendRawTransaction(Buffer.from(record.wireBase64,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});
   if(sent!==record.signature)throw new StampError('Devnet returned a different signature.');
   return await confirm(record);
  }catch(error){return savedResult(record,'pending',(error instanceof StampError?error.message:'Devnet could not confirm this attempt.')+' The signed memo is saved; check it again without signing a replacement.');}
 }
 async function locked(target:StampTarget,work:()=>Promise<StampResult>):Promise<StampResult>{
  const key=targetKey(target);if(busy.has(key))return emit(target,{status:'pending',message:'This devnet stamp is already being checked.'});
  busy.add(key);
  try{
   if(!deps.locks)throw new StampError('This browser cannot reserve a stamp across tabs. Use a browser with Web Locks; no memo was signed.');
   // A single origin-wide lock also protects the shared recovery array when
   // two tabs act on different targets. Per-target locks can lose saved bytes.
   return emit(target,await deps.locks.request('worldsfair:devnet:stamp',{ifAvailable:true},async lock=>lock?work():({status:'pending',message:'Another devnet stamp is open in a tab. Finish it there, then check this record again.'})));
  }catch(error){return emit(target,{status:'unavailable',message:error instanceof StampError?error.message:'The devnet stamp is unavailable. Your Paper record is unchanged.'});}
  finally{busy.delete(key);}
 }
 async function stamp(value:StampTarget):Promise<StampResult>{
  let target:StampTarget;try{target=normalizeTarget(value);}catch(error){return {status:'unavailable',message:(error as Error).message};}
  return locked(target,async()=>{
   const saved=pending(target);if(saved)return check(saved);
   storageAvailable();const provider=deps.phantom();
   if(!provider?.isPhantom||typeof provider.connect!=='function'||typeof provider.signTransaction!=='function')return {status:'unavailable',message:'Phantom with signTransaction support is needed. No wallet was connected.'};
   if(!await deps.consent({stage:'connect',target}))return {status:'cancelled',message:'Devnet stamp cancelled. Your Paper record is unchanged.'};
   try{
    await ensureSession();await assertDevnet();emit(target,{status:'pending',message:'Connecting Phantom to review a devnet-only memo…'});
    const connection=await provider.connect(),wallet=connection?.publicKey?.toBase58();publicKey(wallet);
    const receipt=verifiedReceipt(await post('/api/paper/stamp-prepare',{target,wallet}),target,wallet);
    if(receipt.status==='confirmed')return {status:'confirmed',message:'This Paper record already has a confirmed devnet memo.',receiptId:receipt.id,signature:receipt.signature,explorerUrl:explorer(receipt.signature!)};
    if(!await deps.consent({stage:'sign',target,wallet,memo:receipt.memo,receiptId:receipt.id}))return {status:'cancelled',message:'Devnet stamp cancelled. Nothing was signed or sent.'};
    await assertDevnet();
    const latest=await deps.rpc.getLatestBlockhash('confirmed'),transaction=buildMemoTransaction(wallet,receipt.memo,latest.blockhash,latest.lastValidBlockHeight),unsignedMessage=Uint8Array.from(transaction.serializeMessage());
    emit(target,{status:'pending',message:'Approve the devnet memo in Phantom. It contains no token transfer.'});
    const signed=await provider.signTransaction(transaction);
    if(!signed||typeof signed.serializeMessage!=='function'||!equalBytes(signed.serializeMessage(),unsignedMessage)||typeof signed.serialize!=='function')throw new StampError('Phantom changed the reviewed memo message. Nothing was sent.');
    const wire=signed.serialize({requireAllSignatures:true,verifySignatures:true}),decoded=Transaction.from(wire);
    if(!equalBytes(decoded.serializeMessage(),unsignedMessage)||decoded.signatures.length!==1||!decoded.signature||!decoded.verifySignatures())throw new StampError('The signed memo failed its signature or message checks. Nothing was sent.');
    const record:Pending={version:1,target,receiptId:receipt.id,wallet,memo:receipt.memo,eventAt:receipt.eventAt,eventHash:receipt.eventHash,signature:signatureText(decoded.signature),wireBase64:Buffer.from(wire).toString('base64'),blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,createdAt:new Date(now()).toISOString(),state:'signed'};
    save(record); // Must succeed before the first possible broadcast.
    await assertDevnet();
    try{const sent=await deps.rpc.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});if(sent!==record.signature)throw Error('Signature mismatch');return await confirm(record);}
    catch{return savedResult(record,'pending','The signed devnet memo is saved. Confirmation needs checking; retry checks the same transaction without another signature.');}
   }catch(error){const saved=pending(target);if(saved)return savedResult(saved,'pending','The signed devnet memo is saved. Check its status without another signature.');if((error as any)?.code===4001)return {status:'cancelled',message:'Phantom approval was declined. Your Paper record is unchanged.'};throw error;}
  });
 }
 async function checkPending(value:StampTarget):Promise<StampResult>{
  let target:StampTarget;try{target=normalizeTarget(value);}catch(error){return {status:'unavailable',message:(error as Error).message};}
  return locked(target,async()=>{const saved=pending(target);return saved?check(saved):{status:'unavailable',message:'No signed devnet attempt is saved in this browser. Choose Stamp to review a new memo.'};});
 }
 const savedAttempt=(target:StampTarget):StampResult|null=>{try{const record=pending(target);return record?savedResult(record,'pending','A signed devnet memo is saved. Check its confirmation without signing again.'):null;}catch{return null;}};
 return {stamp,checkPending,savedAttempt,hasPending:(target:StampTarget)=>{try{return !!pending(target);}catch{return true;}}};
}

// The Worker project has no DOM library. Browser-only objects stay isolated
// behind this small adapter; importing the module never connects a wallet.
const browser=globalThis as unknown as {document?:any;phantom?:{solana?:Phantom};localStorage?:Storage;navigator?:{locks?:Locks};CustomEvent?:new(type:string,init:{detail:unknown})=>unknown;WorldsfairDevnet?:unknown};
function consentDialog(detail:Consent):Promise<boolean>{
 const doc=browser.document;if(!doc)return Promise.resolve(false);
 return new Promise(resolve=>{
  const dialog=doc.createElement('dialog');dialog.className='wf-devnet-dialog';dialog.setAttribute('aria-label','Review devnet memo');
  const title=doc.createElement('h3');title.textContent=detail.stage==='connect'?'Stamp this Paper record on devnet':'Review the devnet memo';
  const note=doc.createElement('p');note.textContent='Optional public record on Solana devnet. Phantom signs only a Memo and a fixed compute budget. Devnet SOL pays the network fee. Your paper balances and holdings do not change.';
  const scope=doc.createElement('p');scope.textContent=detail.target.kind==='still-basket'?'This records a hash of your saved basket choice and allocation. It does not deposit tokens or prove investment performance.':detail.target.kind==='pot-roll'?'This stamps your saved paper profit roll.':'This stamps an observation of a shared paper strategy.';
  const setup=doc.createElement('a');setup.href='https://docs.phantom.com/developer-powertools/testnet-mode';setup.target='_blank';setup.rel='noopener';setup.textContent='Set up Phantom testnet mode ↗';
  dialog.append(title,note,scope,setup);
  if(detail.stage==='sign'){
   const wallet=doc.createElement('p');wallet.textContent='Signing wallet: '+detail.wallet;
   const memo=doc.createElement('pre');memo.textContent=detail.memo;memo.setAttribute('aria-label','Exact memo text');dialog.append(wallet,memo);
  }
  const confirm=doc.createElement('button');confirm.type='button';confirm.textContent=detail.stage==='connect'?'Connect Phantom to review':'Sign devnet memo';
  const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const actions=doc.createElement('div');actions.className='wf-devnet-actions';actions.append(confirm,cancel);dialog.append(actions);
  let settled=false;const finish=(value:boolean)=>{if(settled)return;settled=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);};
  confirm.addEventListener('click',()=>finish(true));cancel.addEventListener('click',()=>finish(false));dialog.addEventListener('cancel',(event:any)=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));doc.body.append(dialog);dialog.showModal();cancel.focus();
 });
}
function mountBrowser(){
 if(!browser.document)return;
 const listeners=new Map<string,Set<{element:any;paint:(result:StampResult)=>void}>>();
 const pruneListeners=()=>{for(const [key,rows]of listeners){for(const row of rows)if(!row.element.isConnected)rows.delete(row);if(!rows.size)listeners.delete(key);}};
 const unavailableStorage:Storage={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
 let storage=unavailableStorage;try{storage=browser.localStorage||unavailableStorage;}catch{}
 const client=createDevnetClient({storage,fetch:globalThis.fetch.bind(globalThis),rpc:new Connection(DEVNET_RPC,{commitment:'confirmed',disableRetryOnRateLimit:true}),phantom:()=>browser.phantom?.solana||null,locks:browser.navigator?.locks,consent:consentDialog,emit:detail=>{pruneListeners();listeners.get(targetKey(detail.target))?.forEach(row=>row.paint(detail));if(browser.CustomEvent)browser.document.dispatchEvent(new browser.CustomEvent('worldsfair:stamp-status',{detail}));}});
 const renderButton=(value:StampTarget,label='Stamp Paper record on devnet')=>{
  const target=normalizeTarget(value),doc=browser.document,wrapper=doc.createElement('div'),button=doc.createElement('button'),status=doc.createElement('span'),signature=doc.createElement('code'),link=doc.createElement('a');wrapper.className='wf-devnet-stamp';button.type='button';button.textContent=client.hasPending(target)?'Check saved devnet stamp':label;status.className='wf-devnet-status';status.setAttribute('role','status');link.textContent='View devnet memo ↗';link.target='_blank';link.rel='noopener';link.hidden=true;signature.className='wf-devnet-signature';signature.setAttribute('aria-label','Devnet transaction signature');signature.hidden=true;wrapper.append(button,status,signature,link);
  const paint=(result:StampResult)=>{status.textContent=result.message;wrapper.dataset.stampStatus=result.status;if(result.signature){signature.textContent=result.signature;signature.hidden=false;}if(result.explorerUrl){link.href=result.explorerUrl;link.hidden=false;}button.textContent=result.status==='confirmed'?'Devnet memo confirmed':client.hasPending(target)?'Check saved devnet stamp':label;button.disabled=result.status==='confirmed';};
  const saved=client.savedAttempt(target);if(saved)paint(saved);
  const key=targetKey(target);if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key)!.add({element:wrapper,paint});
  button.addEventListener('click',async()=>{button.disabled=true;try{paint(await client.stamp(target));}finally{if(wrapper.dataset.stampStatus!=='confirmed')button.disabled=false;}});return wrapper;
 };
 const mount=(root:any=browser.document)=>{pruneListeners();for(const host of root?.querySelectorAll('span[data-paper-stamp]')||[]){if(host.dataset.stampMounted==='1')continue;try{host.append(renderButton(JSON.parse(host.dataset.paperStamp)));host.dataset.stampMounted='1';}catch{host.textContent='Devnet stamp unavailable for this record.';}}};
 browser.WorldsfairDevnet={stamp:client.stamp,checkPending:client.checkPending,renderButton,mount};mount();if(browser.CustomEvent)browser.document.dispatchEvent(new browser.CustomEvent('worldsfair:devnet-ready',{detail:{cluster:'devnet'}}));
}
mountBrowser();
