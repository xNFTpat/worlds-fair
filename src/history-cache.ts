import type {HistoryTotals,ClosedPosition} from './sources/meteora-history';
export interface HistoryRead {closed:ClosedPosition[];totals?:HistoryTotals|null;errors:string[];[key:string]:any}
interface SavedHistory {readAt:string;attemptAt:string;data:HistoryRead}
const flights=new Map<string,Promise<SavedHistory>>();
// Preserve prior per-position facts during a partial read; never promote them to fresh data.
export function mergeHistory(previous:HistoryRead|undefined,next:HistoryRead):HistoryRead{
 if(!previous||!next.errors?.length)return next;
 const id=(r:ClosedPosition)=>`${r.wallet}:${r.isGroup?'pool':r.positionAddress||r.groupKey||r.poolAddress}:${r.isGroup?r.poolAddress:''}`;
 const rows=new Map(previous.closed.map(r=>[id(r),r]));for(const r of next.closed)rows.set(id(r),r);
 return {...next,closed:[...rows.values()],totals:next.totals??previous.totals,retained:true};
}
export async function cachedHistory(kv:KVNamespace,key:string,read:()=>Promise<HistoryRead>,ctx:ExecutionContext|undefined,force=false):Promise<HistoryRead & {readAt:string;refreshing:boolean;stale:boolean}>{
 const cacheKey='journey:v1:'+key,saved=await kv.get<SavedHistory>(cacheKey,'json'),now=Date.now();
 const age=saved?now-Date.parse(saved.attemptAt):Infinity;
 const ttl=saved?.data.errors?.length?60000:300000;
 const update=()=>{
  let running=flights.get(cacheKey);if(running)return running;
  running=(async()=>{try{const next=await read(),at=new Date().toISOString();const entry={readAt:next.errors.length&&saved?saved.readAt:at,attemptAt:at,data:mergeHistory(saved?.data,next)};await kv.put(cacheKey,JSON.stringify(entry),{expirationTtl:604800});return entry;}catch(e){if(!saved)throw e;const entry={...saved,attemptAt:new Date().toISOString(),data:{...saved.data,errors:['History source unavailable; showing the last saved records.']}};await kv.put(cacheKey,JSON.stringify(entry),{expirationTtl:604800});return entry;}})().finally(()=>flights.delete(cacheKey));flights.set(cacheKey,running);return running;
 };
 if(saved){const refresh=(force&&age>30000)||age>ttl;if(refresh){const work=update();if(ctx)ctx.waitUntil(work);else await work;}return {...saved.data,readAt:saved.readAt,refreshing:refresh,stale:age>ttl||!!saved.data.errors?.length};}
 const fresh=await update();return {...fresh.data,readAt:fresh.readAt,refreshing:false,stale:!!fresh.data.errors?.length};
}
