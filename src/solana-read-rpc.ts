// Public mainnet reads only. PublicNode documents this unauthenticated endpoint:
// https://solana.publicnode.com/ . Custom RPC URLs never leave their own provider.
import {reservePublicRpc,notePublicRpcRateLimit,type PublicRpcBudgetEnv} from './public-rpc-budget';
export const PUBLIC_SOLANA_READ_RPC = 'https://solana-rpc.publicnode.com';
export const ONFINALITY_SOLANA_READ_RPC = 'https://solana.api.onfinality.io/public';
export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LABS = new Set(['https://api.mainnet-beta.solana.com/', 'https://api.mainnet.solana.com/']);
const READ_METHODS = new Set(['getAccountInfo','getMultipleAccounts','getEpochInfo','getTokenLargestAccounts','getBlockTime','getSlot','getBlockHeight','getGenesisHash','getProgramAccounts','getMinimumBalanceForRentExemption','getBalance','getTokenSupply','getLatestBlockhash','getFeeForMessage']);
interface RpcRead {jsonrpc: '2.0'; id: number | string; method: string; params?: unknown[]}
interface Options {deadline?: number; onRequest?: () => void; env?:PublicRpcBudgetEnv}
const json = (value: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(value), {status, headers: {'content-type':'application/json',...headers}});
const localReasons:Record<string,string>={'Shared public RPC allowance is unavailable.':'budget-unavailable','Public Solana reads are busy. Retry shortly.':'isolate-busy','Shared public RPC queue is busy.':'queue-busy','Shared public RPC allowance expired before dispatch.':'grant-expired','Solana mainnet identity could not be verified.':'mainnet-proof','Solana read response identities could not be verified.':'rpc-identity','Public Solana provider is cooling down.':'provider-cooldown','Credentials cannot be used with the fixed public RPC endpoint.':'public-auth'};
const unavailable = (reads: RpcRead[], batch: boolean, message: string, status = 503, retrySeconds?: number, diagnostic?: string, localReason=localReasons[message]) => json(batch ? reads.map(r=>({jsonrpc:'2.0',id:r.id,error:{code:-32004,message}})) : {jsonrpc:'2.0',id:reads[0]?.id??null,error:{code:-32004,message}}, status, {...(retrySeconds===undefined?{}:{'retry-after':String(Math.max(1,Math.ceil(retrySeconds)))}),...(diagnostic?{'x-still-rpc-failure':diagnostic}:{}),...(localReason?{'x-still-rpc-local':localReason}:{})});
/** Classify only the fixed public endpoint's bounded error prefix. Never retain
 * or reflect provider prose, URLs, addresses, credentials or request payloads. */
async function classifyPublicFailure(response:Response):Promise<string>{
 let text='',truncated=false;const reader=response.body?.getReader();
 try{if(reader){const chunks:Uint8Array[]=[];let length=0;while(length<2048){const part=await reader.read();if(part.done)break;const kept=part.value.subarray(0,2048-length);chunks.push(kept);length+=kept.length;if(kept.length<part.value.length||length===2048){truncated=true;break;}}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}text=new TextDecoder().decode(bytes);}}catch{return 'unreadable';}finally{try{await reader?.cancel();}catch{}}
 const trimmed=text.trim(),labels=[!trimmed?'empty':/^[\[{]/.test(trimmed)?'json':/^\s*</.test(trimmed)?'html':'text'];
 if(labels[0]==='json'&&!truncated)try{const data=JSON.parse(trimmed),rows=Array.isArray(data)?data:[data];for(const row of rows){const code=row?.error?.code;if(Number.isSafeInteger(code)&&Math.abs(code)<=9999999){labels.push('rpc code '+code);break;}}}catch{}
 for(const [label,pattern]of [['rate-limit',/rate.?limit|too many|quota/i],['batch-mentioned',/batch/i],['method-mentioned',/method|getAccountInfo|getEpochInfo/i],['ip-mentioned',/\bip\b|ip.?address/i],['cloudflare-mentioned',/cloudflare|cf-ray|challenge-platform/i],['authentication-mentioned',/unauthori[sz]ed|api.?key|authentication/i],['capacity-mentioned',/capacity|overload|try again/i]] as const)if(pattern.test(text))labels.push(label);
 if(truncated)labels.push('truncated');return labels.join('; ').slice(0,256);
}

/** A small, isolate-local circuit and immutable block-time cache. No account data
 * is cached here: mutable mint authorities, pool anchors and balances retain the
 * caller's existing source-dated cache policy. Neither failures nor nulls cache. */
export function createSolanaReadRpc(deps: {fetcher?: typeof fetch; now?: () => number} = {}) {
 const now = deps.now || Date.now;
 const circuits = new Map<string,{until:number;status:number}>(), genesis = new Map<string,number>();
 const blocks = new Map<string,{at:number;body:any}>();
 let active = 0;
 return async function readRpc(input: RequestInfo | URL, init: RequestInit = {}, options: Options = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  let body: unknown;
  try {if(init.method?.toUpperCase()!=='POST'||typeof init.body!=='string'||init.body.length>100000)throw Error();body=JSON.parse(init.body);} catch {throw Error('Only bounded JSON-RPC reads are supported.');}
  const batch=Array.isArray(body), reads=(batch?body:[body]) as RpcRead[];
  if(!reads.length||reads.length>50||reads.some(r=>!r||r.jsonrpc!=='2.0'||!READ_METHODS.has(r.method)||!['number','string'].includes(typeof r.id)||(r.params!==undefined&&!Array.isArray(r.params)))||new Set(reads.map(r=>r.id)).size!==reads.length)throw Error('Only bounded, identified Solana read methods are supported.');
  const headers = new Headers(init.headers), cleanHeaders=[...headers.keys()].every(k=>['content-type','accept'].includes(k)||(k==='solana-client'&&/^js\/[a-zA-Z0-9.+-]{1,64}$/.test(headers.get(k)||'')));
  const onfinality=url.href===ONFINALITY_SOLANA_READ_RPC;
  // The fixed public URL must never escape its shared budget just because an
  // SDK added a diagnostic header. An authenticated caller needs its explicit
  // private endpoint; do not forward or silently discard credentials here.
  if(onfinality&&[...headers.keys()].some(k=>/auth|api[-_]?key|token|cookie|secret/i.test(k)))return unavailable(reads,batch,'Credentials cannot be used with the fixed public RPC endpoint.');
  const publicMode=onfinality||cleanHeaders&&!url.username&&!url.password&&(LABS.has(url.href)||url.href===PUBLIC_SOLANA_READ_RPC+'/');
  const fetcher=deps.fetcher||globalThis.fetch;
  // Preserve private/keyed/custom provider selection, headers and response shape.
  if(!publicMode){options.onRequest?.();return fetcher(input,init);}
  if(onfinality&&!options.env?.RANGE_ALERTS)return unavailable(reads,batch,'Shared public RPC allowance is unavailable.',503,undefined,undefined,'budget-unbound');
  const deadline=options.deadline??now()+8000;
  const assertTime=()=>{if(init.signal?.aborted||now()>=deadline)throw Error('Solana read deadline reached.');};
  assertTime();
  const endpoints=LABS.has(url.href)?[url.href,PUBLIC_SOLANA_READ_RPC]:[onfinality?ONFINALITY_SOLANA_READ_RPC:PUBLIC_SOLANA_READ_RPC];
  const cacheKey=JSON.stringify(reads.map(r=>[r.method,r.params||[]]));
  const blockOnly=reads.every(r=>r.method==='getBlockTime'&&Number.isSafeInteger(r.params?.[0])&&Number(r.params![0])>0);
  const saved=blockOnly?blocks.get(cacheKey):undefined;
  if(saved&&now()>=saved.at&&now()-saved.at<60000){const rows=saved.body.map((r:any,i:number)=>({...r,id:reads[i].id}));return json(batch?rows:rows[0]);}
  if(active>=3)return unavailable(reads,batch,'Public Solana reads are busy. Retry shortly.');
  active++;
  try {
   let lastDiagnostic:string|undefined,lastReason:string|undefined;
   endpointLoop: for(const endpoint of endpoints){
    assertTime();
    const cooling=circuits.get(endpoint);
    if(cooling&&cooling.until>now()){
     if(cooling.status===429)return unavailable(reads,batch,'Public Solana provider is cooling down.',429,(cooling.until-now())/1000);
     continue;
    }
    const publicNode=endpoint===PUBLIC_SOLANA_READ_RPC;
    // This public service rejects largest-account queries. Preserve an explicit
    // missing holder result instead of letting it poison independent mint data.
    const supported=publicNode?reads.filter(r=>r.method!=='getTokenLargestAccounts'):reads;
    const omitted=reads.filter(r=>!supported.includes(r)).map(r=>({jsonrpc:'2.0',id:r.id,error:{code:-32004,message:'Holder-account enumeration is unavailable from this public provider.'}}));
    if(!supported.length)return json(batch?omitted:omitted[0]);
    const checkedAt=genesis.get(endpoint), proof=checkedAt===undefined||now()<checkedAt||now()-checkedAt>=3600000;
    let proofId='still-mainnet-proof';while(reads.some(r=>r.id===proofId))proofId+='-';
    const outgoing:RpcRead[]=proof?[...supported,{jsonrpc:'2.0',id:proofId,method:'getGenesisHash',params:[]}]:supported;
    // The proof consumes allowance too. Put it first so a larger request cannot
    // progress through further chunks before chain identity is established.
    if(onfinality&&proof)outgoing.unshift(outgoing.pop()!);
    const chunks:RpcRead[][]=onfinality?Array.from({length:Math.ceil(outgoing.length/4)},(_,i)=>outgoing.slice(i*4,i*4+4)):[outgoing];
    const rows:any[]=[];
    for(const chunk of chunks){
    let dispatchUntil:number|null=null;
    if(onfinality){
     let accepted=false;
     for(let waits=0;waits<10;waits++){
      assertTime();const reservation=await reservePublicRpc(options.env!,chunk.length,deadline);assertTime();
      if(reservation.allowed){accepted=true;dispatchUntil=reservation.dispatchUntil;break;}
      if(reservation.reason!=='budget'||!reservation.retryAt||reservation.retryAt>=deadline)return unavailable(reads,batch,reservation.reason==='cooldown'?'Public Solana provider is cooling down.':'Shared public RPC allowance is unavailable.',reservation.reason==='cooldown'?429:503,reservation.retryAt?(reservation.retryAt-now())/1000:undefined,undefined,reservation.detail||(reservation.reason==='budget'?'budget-deadline':reservation.reason==='cooldown'?'provider-cooldown':'budget-unavailable'));
      const wait=Math.max(1,reservation.retryAt-now());if(wait>1500)return unavailable(reads,batch,'Shared public RPC queue is busy.');
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,wait);function done(){init.signal?.removeEventListener('abort',aborted);resolve();}function aborted(){clearTimeout(timer);init.signal?.removeEventListener('abort',aborted);reject(Error('Solana read aborted.'));}init.signal?.addEventListener('abort',aborted,{once:true});if(init.signal?.aborted)aborted();});
     }
     if(!accepted)return unavailable(reads,batch,'Shared public RPC queue is busy.');
    }
    const signal=AbortSignal.timeout(Math.max(1,Math.min(4000,deadline-now())));
    let response:Response;
    options.onRequest?.();
    try {
     // Workers implement manual/follow redirects. Inspect a manual 3xx as an
     // error instead of forwarding even a read to an unreviewed destination.
     assertTime();if(onfinality&&(!dispatchUntil||now()>=dispatchUntil))return unavailable(reads,batch,'Shared public RPC allowance expired before dispatch.');
     response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(batch||chunk.length>1?chunk:chunk[0]),signal:init.signal?AbortSignal.any([init.signal,signal]):signal,redirect:'manual'});
    } catch {
     assertTime();circuits.set(endpoint,{until:now()+30000,status:503});lastReason='provider-transport';continue endpointLoop;
    }
    assertTime();
    if(!response.ok){
     const status=response.status, retry=response.headers.get('retry-after'), seconds=Number(retry), retryAt=Number.isFinite(seconds)&&seconds>0?now()+seconds*1000:Date.parse(retry||'');
     const diagnostic=await classifyPublicFailure(response);
     lastDiagnostic=diagnostic;lastReason='provider-http';
     let until=now()+(onfinality?Math.max(30000,Number.isFinite(retryAt)?retryAt-now():0):Math.min(900000,Math.max(status===403||status===401?300000:30000,Number.isFinite(retryAt)?retryAt-now():0)));
     if(onfinality&&status===429){const shared=await notePublicRpcRateLimit(options.env!,response.headers);if(shared.retryAt)until=Math.max(until,shared.retryAt);}
     if([401,403,429,500,502,503,504].includes(status))circuits.set(endpoint,{until,status});
     // Keep the remaining provider cooldown visible to callers that persist it
     // across Worker isolates. A synthetic response must not shorten that wait.
     if(status===429)return unavailable(reads,batch,'Public Solana provider is rate limited.',429,(circuits.get(endpoint)!.until-now())/1000,diagnostic);
     if(![401,403,500,502,503,504].includes(status))return unavailable(reads,batch,'Public Solana provider rejected this read.',status,undefined,diagnostic);
     continue endpointLoop;
    }
    let parsed:any;
    try {const text=await response.text();if(text.length>4000000)throw Error();parsed=JSON.parse(text);}catch {circuits.set(endpoint,{until:now()+30000,status:503});lastReason='provider-unreadable';continue endpointLoop;}
    assertTime();
    const values=Array.isArray(parsed)?parsed:[parsed];
    if(values.length!==chunk.length||chunk.some(r=>values.filter(x=>x?.jsonrpc==='2.0'&&x.id===r.id).length!==1))return unavailable(reads,batch,'Solana read response identities could not be verified.');
    if(proof&&chunk.some(r=>r.id===proofId)){if(values.find(r=>r.id===proofId)?.result!==SOLANA_MAINNET_GENESIS)return unavailable(reads,batch,'Solana mainnet identity could not be verified.');genesis.set(endpoint,now());}
    rows.push(...values);
    }
    const result=reads.map(r=>rows.find(x=>x.id===r.id)||omitted.find(x=>x.id===r.id));
    if(blockOnly&&result.every(r=>!r.error&&Number.isSafeInteger(r.result)&&r.result>0&&r.result*1000<=now())){
     if(blocks.size>=128)blocks.delete(blocks.keys().next().value!);blocks.set(cacheKey,{at:now(),body:result});
    }
    return json(batch?result:result[0]);
   }
   return unavailable(reads,batch,'Public Solana reads are temporarily unavailable.',503,undefined,lastDiagnostic,lastReason||'provider-circuit');
  } finally {active--;}
 };
}
export const solanaReadFetch = createSolanaReadRpc();
