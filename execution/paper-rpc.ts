// One bounded read queue per fleet scan. URLs, request bodies and keys never enter telemetry.
import {solanaReadFetch} from '../src/solana-read-rpc';
export function paperRpcTransport(options:{fetcher?:typeof fetch;now?:()=>number;sleep?:(ms:number)=>Promise<void>;intervalMs?:number;maxRequests?:number;maxDurationMs?:number}={}){
 const now=options.now||Date.now,sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
 const start=now(),stats={requests:0,rateLimits:0,failed:0,elapsedMs:0};let tail=Promise.resolve(),next=0;
 const transport:typeof fetch=(url,init)=>{
  const result=tail.then(async()=>{
   if(stats.requests>=(options.maxRequests??120)||now()-start>(options.maxDurationMs??55000))throw Error('Paper read budget reached; retained for next observation');
   const wait=Math.max(0,next-now());if(now()-start+wait>(options.maxDurationMs??55000))throw Error('Provider cooldown; retained for next observation');
   if(wait)await sleep(wait);next=now()+(options.intervalMs??350);
   try{
    const remaining=Math.max(1,(options.maxDurationMs??55000)-(now()-start));
    const request={...init,signal:AbortSignal.timeout(Math.min(12000,remaining))};
    const countRequest=()=>{if(stats.requests>=(options.maxRequests??120))throw Error('Paper read budget reached; retained for next observation');stats.requests++;};
    const response=options.fetcher?await (countRequest(),options.fetcher(url,request)):await solanaReadFetch(url,request,{deadline:Date.now()+remaining,onRequest:countRequest});
    if(response.status===429){stats.rateLimits++;const header=response.headers.get('retry-after');let delay=Number(header);if(!Number.isFinite(delay))delay=(Date.parse(header||'')-now())/1000;next=Math.max(next,now()+Math.min(60000,Math.max(2000,Number.isFinite(delay)?delay*1000:2000)));}
    if(!response.ok)stats.failed++;return response;
   }catch(e){stats.failed++;throw e;}finally{stats.elapsedMs=now()-start;}
  });tail=result.then(()=>undefined,()=>undefined);return result;
 };
 return {fetch:transport,stats};
}
