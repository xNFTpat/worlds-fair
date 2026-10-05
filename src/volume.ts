import type {Pool, Snapshot} from './schema';

export interface VolumeSignal {
  latest30m:number|null; previous30m:number|null; ratio:number|null; hourlyRatio:number|null;
  kind:'surge'|'resumed'|'new-pool'|'steady'|'unavailable'; label:string; note:string;
}
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const amount=(n:unknown)=>valid(n)?n:null;
const dollars=(n:number)=>'$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
export function volumeSignal(p:Pool,now=Date.now()):VolumeSignal {
  const a=p.activity, latest=amount(a?.volume30m), hour=amount(a?.volume1h), four=amount(a?.volume4h);
  const age=p.ageHours, read=Date.parse(p.fetchedAt);
  const fresh=Number.isFinite(read)&&now-read<=600000&&read<=now+60000;
  const previous=latest!=null&&hour!=null&&hour>=latest?hour-latest:null;
  const comparable=valid(age)&&age>=1&&previous!=null;
  // Tiny/zero baselines are shown as resumed activity, never infinite acceleration.
  const ratio=comparable&&previous!=null&&previous>=100?latest!/previous:null;
  const priorThree=valid(age)&&age>=4&&four!=null&&hour!=null&&four>=hour?(four-hour)/3:null;
  const hourlyRatio=priorThree!=null&&priorThree>=100?hour!/priorThree:null;
  let kind:VolumeSignal['kind']='unavailable',label='Volume pace unavailable';
  let note='A complete hour of matching volume windows is needed for a 30-minute comparison.';
  if(latest!=null) {
    if(valid(age)&&age<1){kind=latest>=500?'new-pool':'steady';label='New pool · short history';note=`${dollars(latest)} volume reported in the last 30m window. Pool age is under one hour; this is not an acceleration signal.`;}
    else if(comparable){
      kind=latest>=500?(ratio!=null&&ratio>=2?'surge':previous!<100?'resumed':'steady'):'steady';
      label=kind==='surge'?`${ratio!.toFixed(1)}× volume · 30m`:kind==='resumed'?'Volume resumed':ratio!=null?`${ratio.toFixed(1)}× volume · 30m`:'Low volume baseline';
      note=`Latest 30m: ${dollars(latest)}; preceding 30m: ${dollars(previous!)}. Volume includes buys and sells.`;
    }
  }
  if(!fresh){kind='unavailable';label='Saved · volume unconfirmed';note='This pool read is older than ten minutes or has an invalid timestamp.';}
  return {latest30m:latest,previous30m:comparable?previous:null,ratio:fresh?ratio:null,hourlyRatio:fresh?hourlyRatio:null,kind,label,note};
}

export interface VolumeMemory { lastSampleAt:string; lastAlertAt?:string; lastAlertKind?:string; kind:string; priceUsd:number|null; tvlUsd:number|null }
export interface VolumeState { lastCheckedAt:string; pools:Record<string,VolumeMemory>; freshPools:number; comparablePools:number; unavailablePools:number }
export interface VolumeEvent {
  id:string; at:string; kind:string; poolId:string; pair:string; venue:string; address:string; base:string; quote:string;
  signal:VolumeSignal; tvlUsd:number|null; feeApr:number|null; fees1h:number|null; ageHours:number|null;
  priceChange:number|null; tvlChange:number|null; comparedAt:string|null; firstObservation:boolean;
}
export function checkVolume(snapshot:Snapshot,previous?:VolumeState|null,now=Date.now()):{state:VolumeState;events:VolumeEvent[]} {
  const sample=Date.parse(snapshot.updatedAt);
  if(!Number.isFinite(sample)||sample>now+60000||now-sample>600000)throw Error('Volume scan timestamp is invalid or stale');
  if(previous&&sample<=Date.parse(previous.lastCheckedAt))return {state:previous,events:[]};
  const pools:Record<string,VolumeMemory>={...previous?.pools},events:VolumeEvent[]=[];
  let freshPools=0,comparablePools=0,unavailablePools=0;
  for(const p of snapshot.pools.filter(p=>['meteora-dlmm','meteora-damm-v2'].includes(p.venue))) {
    const read=Date.parse(p.fetchedAt),old=pools[p.id],s=volumeSignal(p,now);
    if(!Number.isFinite(read)||now-read>600000||read>now+60000){unavailablePools++;continue;}
    freshPools++;if(s.previous30m!=null)comparablePools++;
    if(old&&read<=Date.parse(old.lastSampleAt))continue;
    const context=old&&read-Date.parse(old.lastSampleAt)<=15*60000;
    const change=(a:number|null,b:number|null)=>valid(a)&&valid(b)&&b>0?(a-b)/b:null;
    const entry:VolumeMemory={lastSampleAt:p.fetchedAt,lastAlertAt:old?.lastAlertAt,lastAlertKind:old?.lastAlertKind,kind:s.kind,priceUsd:p.priceUsd,tvlUsd:p.tvlUsd};
    const actionable=['surge','resumed','new-pool'].includes(s.kind);
    // One reminder per pool per 45 minutes; ongoing bursts don't flood every five-minute scan.
    if(actionable&&(!old?.lastAlertAt||read-Date.parse(old.lastAlertAt)>=45*60000)) {
      events.push({id:`${p.id}:${p.fetchedAt}:${s.kind}`,at:p.fetchedAt,kind:s.kind,poolId:p.id,pair:p.pair,venue:p.venue,address:p.address,base:p.base.address,quote:p.quote.address,signal:s,tvlUsd:p.tvlUsd,feeApr:p.feeApr,fees1h:p.activity?.fees1h??null,ageHours:p.ageHours,priceChange:context?change(p.priceUsd,old.priceUsd):null,tvlChange:context?change(p.tvlUsd,old.tvlUsd):null,comparedAt:context?old.lastSampleAt:null,firstObservation:!old});
      entry.lastAlertAt=p.fetchedAt;entry.lastAlertKind=s.kind;
    }
    pools[p.id]=entry;
  }
  // Bounded seven-day dedup history; dropping from a sample is not evidence that a pool closed.
  const retained=Object.fromEntries(Object.entries(pools).filter(([,p])=>now-Date.parse(p.lastSampleAt)<7*86400000).sort((a,b)=>Date.parse(b[1].lastSampleAt)-Date.parse(a[1].lastSampleAt)).slice(0,6000));
  return {state:{lastCheckedAt:snapshot.updatedAt,pools:retained,freshPools,comparablePools,unavailablePools},events};
}
