// Read-only Cesto integration. No basket purchase or wallet ownership is inferred here.
const API='https://backend.cesto.co';
type Cache={data:any;readAt:number};
async function cached(kv:KVNamespace,path:string,refresh=false){
 const key='cesto:v1:'+path, saved=await kv.get<Cache>(key,'json');
 if(saved&&Date.now()-saved.readAt<300000&&!refresh)return {...saved,stale:false};
 try{
  const response=await fetch(API+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Cesto could not return this data.');
  const data:any=await response.json();if(data?.code&&data?.message)throw Error('Cesto has no chart available for this basket.');
  const result={data,readAt:Date.now()};await kv.put(key,JSON.stringify(result),{expirationTtl:604800});return {...result,stale:false};
 }catch(e){if(saved)return {...saved,stale:true};throw e;}
}
export function basketArtwork(value:unknown):string|null {try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function performance(d:any){return {sevenDay:finite(d?.tokenPerformance7d?.return??d?.tokenPerformance7d?.netPnL),thirtyDay:finite(d?.tokenPerformance30d?.return??d?.tokenPerformance30d?.netPnL),days:d?.tokenPerformance30d?.daysAvailable??null,end:d?.tokenPerformance30d?.endDate??null};}
export function allocations(d:any,tokens:any[]){
 const nodes=d.definition?.bucket?.nodes;
 if(!Array.isArray(nodes))return {rows:[],complete:false};
 // Only top-level parallel token swaps have directly comparable portfolio weights.
 if(d.definition.bucket.mode!=='parallel')return {rows:[],complete:false};
 const rows=nodes.filter((n:any)=>n.nodeType==='swap.token'&&finite(n.amount?.percentage)!==null&&typeof n.parameters?.toToken==='string').map((n:any)=>{
  const mint=n.parameters.toToken,t=tokens.find(t=>t.mint===mint);return {mint,weight:n.amount.percentage,symbol:t?.symbol||mint.slice(0,6)+'…',name:t?.name||'Token name unavailable',issuer:t?.issuer||null};
 });
 const sum=rows.reduce((n:number,r:any)=>n+r.weight,0);
 return {rows,complete:rows.length===nodes.length&&rows.every((r:any)=>r.weight>0&&r.weight<=100)&&Math.abs(sum-100)<0.01};
}
export async function cestoData(kv:KVNamespace,slug:string|null,refresh=false){
 if(slug&&!/^[a-z0-9-]{1,90}$/.test(slug))throw Error('Invalid basket.');
 if(!slug){
  const [catalog,analytics]=await Promise.all([cached(kv,'/products',refresh),cached(kv,'/products/analytics',refresh).catch(()=>null)]);
  if(!Array.isArray(catalog.data))throw Error('Cesto catalog format changed.');
  return {readAt:catalog.readAt,stale:catalog.stale||analytics?.stale,performanceUnavailable:!analytics,performanceReadAt:analytics?.readAt||null,baskets:catalog.data.filter((p:any)=>p.isActive&&p.isPublished&&p.geoStatus?.canView!==false).map((p:any)=>({id:p.id,slug:p.slug,name:p.name,image:basketArtwork(p.logoUrl),categories:p.categories||[],...performance(analytics?.data?.[p.id])})).sort((a:any,b:any)=>a.name.localeCompare(b.name))};
 }
 const [detail,tokens]=await Promise.all([cached(kv,'/products/'+slug,refresh),cached(kv,'/tokens').catch(()=>null)]);
 const d=detail.data;if(d.geoStatus?.canView===false)throw Error('This basket is not available to view in your region.');
 const graph=await cached(kv,'/products/'+encodeURIComponent(d.id)+'/graph?timeRange=1y',refresh).catch(()=>null);
 const allocation=allocations(d,tokens?.data||[]);
 return {readAt:detail.readAt,stale:detail.stale||tokens?.stale,graphReadAt:graph?.readAt||null,graphStale:graph?.stale||false,name:d.name,slug:d.slug,image:basketArtwork(d.logoUrl),description:d.description,categories:d.categories||[],...performance(d),minimum:Number(d.minimumInvestment)/10**Number(d.inputTokenDecimals),inputToken:d.inputTokenMint,inputSymbol:tokens?.data?.find((t:any)=>t.mint===d.inputTokenMint)?.symbol||null,allocation,graph:graph?.data||null};
}
