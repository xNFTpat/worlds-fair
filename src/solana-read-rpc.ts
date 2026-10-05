// Public mainnet reads only. PublicNode documents this unauthenticated endpoint:
// https://solana.publicnode.com/ . Custom RPC URLs never leave their own provider.
export const PUBLIC_SOLANA_READ_RPC = 'https://solana-rpc.publicnode.com';
export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LABS = new Set(['https://api.mainnet-beta.solana.com/', 'https://api.mainnet.solana.com/']);
const READ_METHODS = new Set(['getAccountInfo','getMultipleAccounts','getEpochInfo','getTokenLargestAccounts','getBlockTime','getSlot','getBlockHeight','getGenesisHash','getProgramAccounts','getMinimumBalanceForRentExemption','getBalance','getTokenSupply']);
interface RpcRead {jsonrpc: '2.0'; id: number | string; method: string; params?: unknown[]}
interface Options {deadline?: number; onRequest?: () => void}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type':'application/json'}});
const unavailable = (reads: RpcRead[], batch: boolean, message: string, status = 503) => json(batch ? reads.map(r=>({jsonrpc:'2.0',id:r.id,error:{code:-32004,message}})) : {jsonrpc:'2.0',id:reads[0]?.id??null,error:{code:-32004,message}}, status);

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
  const publicMode=cleanHeaders&&!url.username&&!url.password&&(LABS.has(url.href)||url.href===PUBLIC_SOLANA_READ_RPC+'/');
  const fetcher=deps.fetcher||globalThis.fetch;
  // Preserve private/keyed/custom provider selection, headers and response shape.
  if(!publicMode){options.onRequest?.();return fetcher(input,init);}
  const deadline=options.deadline??now()+8000;
  const assertTime=()=>{if(init.signal?.aborted||now()>=deadline)throw Error('Solana read deadline reached.');};
  assertTime();
  const endpoints=LABS.has(url.href)?[url.href,PUBLIC_SOLANA_READ_RPC]:[PUBLIC_SOLANA_READ_RPC];
  const cacheKey=JSON.stringify(reads.map(r=>[r.method,r.params||[]]));
  const blockOnly=reads.every(r=>r.method==='getBlockTime'&&Number.isSafeInteger(r.params?.[0])&&Number(r.params![0])>0);
  const saved=blockOnly?blocks.get(cacheKey):undefined;
  if(saved&&now()>=saved.at&&now()-saved.at<60000){const rows=saved.body.map((r:any,i:number)=>({...r,id:reads[i].id}));return json(batch?rows:rows[0]);}
  if(active>=3)return unavailable(reads,batch,'Public Solana reads are busy. Retry shortly.');
  active++;
  try {
   for(const endpoint of endpoints){
    assertTime();
    const cooling=circuits.get(endpoint);
    if(cooling&&cooling.until>now()){
     if(cooling.status===429)return unavailable(reads,batch,'Public Solana provider is cooling down.',429);
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
    const outgoing=proof?[...supported,{jsonrpc:'2.0',id:proofId,method:'getGenesisHash',params:[]}]:supported;
    const signal=AbortSignal.timeout(Math.max(1,Math.min(4000,deadline-now())));
    let response:Response;
    options.onRequest?.();
    try {
     // Workers implement manual/follow redirects. Inspect a manual 3xx as an
     // error instead of forwarding even a read to an unreviewed destination.
     response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(batch||proof?outgoing:outgoing[0]),signal:init.signal?AbortSignal.any([init.signal,signal]):signal,redirect:'manual'});
    } catch {
     assertTime();circuits.set(endpoint,{until:now()+30000,status:503});continue;
    }
    assertTime();
    if(!response.ok){
     const status=response.status, retry=response.headers.get('retry-after'), seconds=Number(retry), retryAt=Number.isFinite(seconds)&&seconds>0?now()+seconds*1000:Date.parse(retry||'');
     await response.body?.cancel();
     if([401,403,429,500,502,503,504].includes(status))circuits.set(endpoint,{until:now()+Math.min(900000,Math.max(status===403||status===401?300000:30000,Number.isFinite(retryAt)?retryAt-now():0)),status});
     if(status===429)return unavailable(reads,batch,'Public Solana provider is rate limited.',429);
     if(![401,403,500,502,503,504].includes(status))return unavailable(reads,batch,'Public Solana provider rejected this read.',status);
     continue;
    }
    let parsed:any;
    try {const text=await response.text();if(text.length>4000000)throw Error();parsed=JSON.parse(text);}catch {circuits.set(endpoint,{until:now()+30000,status:503});continue;}
    assertTime();
    const rows=Array.isArray(parsed)?parsed:[parsed];
    if(rows.length!==outgoing.length||outgoing.some(r=>rows.filter(x=>x?.jsonrpc==='2.0'&&x.id===r.id).length!==1))return unavailable(reads,batch,'Solana read response identities could not be verified.');
    if(proof){if(rows.find(r=>r.id===proofId)?.result!==SOLANA_MAINNET_GENESIS)return unavailable(reads,batch,'Solana mainnet identity could not be verified.');genesis.set(endpoint,now());}
    const result=reads.map(r=>rows.find(x=>x.id===r.id)||omitted.find(x=>x.id===r.id));
    if(blockOnly&&result.every(r=>!r.error&&Number.isSafeInteger(r.result)&&r.result>0&&r.result*1000<=now())){
     if(blocks.size>=128)blocks.delete(blocks.keys().next().value!);blocks.set(cacheKey,{at:now(),body:result});
    }
    return json(batch?result:result[0]);
   }
   return unavailable(reads,batch,'Public Solana reads are temporarily unavailable.');
  } finally {active--;}
 };
}
export const solanaReadFetch = createSolanaReadRpc();
