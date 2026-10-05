export type Family='solana'|'evm';
export type Shape='spot'|'curve'|'bid-ask';
export interface ExecutionDraft {
 pool:string;family:Family;action:string;amountSol:string;amountEth:string;amountToken:string;
 lowerPriceSol:string;upperPriceSol:string;lowerPriceEth:string;upperPriceEth:string;
 depositMode:'sol-only'|'two-sided';strategy:Shape;slippageBps:number;walletKind:string;credentialId:string;
 source?:string;anchorAt?:string;updatedAt:number;
}
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const DRAFTS='lp-execution-drafts:v1';
export function decimalInput(value:unknown):string {
 const input=String(value??'').trim();if(!input)return '';
 const match=input.match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!match)return input;
 if(!match[3])return input;
 const exponent=Number(match[3]);if(!Number.isInteger(exponent)||Math.abs(exponent)>100)return input;
 const digits=match[1]+(match[2]||''),point=match[1].length+exponent;
 return point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
}
export function rangeError(lower:string,upper:string):string|null {
 if(!lower||!upper)return 'Set both range prices on the chart or enter them here.';
 const valid=(s:string)=>/^\d+(?:\.\d+)?$/.test(s)&&Number.isFinite(Number(s))&&Number(s)>0;
 if(!valid(lower)||!valid(upper))return 'Range prices must be positive decimal numbers.';
 if(Number(lower)>=Number(upper))return 'The floor must be below the top price.';
 return null;
}
export function initialDraft(pool:string,family:Family,initial:Partial<ExecutionDraft>={}):ExecutionDraft {
 return {...{pool,family,action:'open',amountSol:'0.5',amountEth:'0.006',amountToken:'0',lowerPriceSol:'',upperPriceSol:'',lowerPriceEth:'',upperPriceEth:'',depositMode:'two-sided' as const,strategy:'spot' as const,slippageBps:100,walletKind:'paybox',credentialId:'',updatedAt:Date.now()},...initial,pool,family};
}
export function loadDraft(storage:StorageLike,pool:string,family:Family):Partial<ExecutionDraft>|null {
 try{const saved=JSON.parse(storage.getItem(DRAFTS)||'{}')[family+':'+pool];return saved?.pool===pool&&saved?.family===family?saved:null;}catch{return null;}
}
export function persistDraft(storage:StorageLike,draft:ExecutionDraft){
 let saved:any={};try{saved=JSON.parse(storage.getItem(DRAFTS)||'{}');}catch{}
 saved[draft.family+':'+draft.pool]=draft;
 const entries=Object.entries(saved).sort((a:any,b:any)=>(b[1]?.updatedAt||0)-(a[1]?.updatedAt||0)).slice(0,24);
 storage.setItem(DRAFTS,JSON.stringify(Object.fromEntries(entries)));
}
export function createComposer(pool:string,family:Family,initial:Partial<ExecutionDraft>={},storage?:StorageLike){
 let draft=initialDraft(pool,family,{...(storage?loadDraft(storage,pool,family):{}),...initial}),revision=0,review:any=null,locked=false;
 const listeners=new Set<(state:any)=>void>();
 const snapshot=()=>({draft:{...draft},revision,review,locked});
 const notify=()=>{const state=snapshot();listeners.forEach(fn=>fn(state));};
 const save=()=>{if(storage)persistDraft(storage,draft);};save();
 return {
  snapshot,subscribe(fn:(state:any)=>void){listeners.add(fn);return()=>listeners.delete(fn);},
  update(patch:Partial<ExecutionDraft>){if(locked)return false;draft={...draft,...patch,pool,family,updatedAt:Date.now()};revision++;review=null;save();notify();return true;},
  acceptPreview(value:any,requestedRevision:number){if(locked||revision!==requestedRevision)return false;review=JSON.parse(JSON.stringify(value));notify();return true;},
  usable(now=Date.now()){return !!review&&Number.isFinite(review.expiresAt)&&now<review.expiresAt;},
  clearReview(){review=null;notify();},
  lock(value:boolean){locked=value;notify();}
 };
}
const KEYS:Record<Family,string>={solana:'lp-solana-operation',evm:'lp-evm-operation'};
export function readOperation(storage:StorageLike,family:Family){try{return JSON.parse(storage.getItem(KEYS[family])||'null');}catch{return null;}}
export function writeOperation(storage:StorageLike,family:Family,operation:any){storage.setItem(KEYS[family],JSON.stringify(operation));}
export function removeOperation(storage:StorageLike,family:Family,operation:any){const current=readOperation(storage,family);if(current?.preview?.previewId===(operation.preview?.previewId||operation.previewId))storage.removeItem(KEYS[family]);}
export function canResumeInPool(operation:any,pool:string){return !operation||operation.pool===pool||operation.preview?.pool===pool||operation.preview?.review?.pool===pool;}
export function interruptedAction(operation:any,now=Date.now()):'status'|'request'|'recover'|'expired'|'wallet-unknown' {
 if(operation.signature||operation.txHash)return 'status';
 if(operation.requestId)return 'request';
 if(now>=operation.preview.expiresAt)return 'expired';
 return operation.preview.walletKind==='phantom'?'wallet-unknown':'recover';
}
