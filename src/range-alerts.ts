import {reserveGecko,GECKO_DAILY_LIMIT,type DataBudget} from './data-budget';
import {researchJupiterBudgetRequest} from './research-quote-budget';
import {advanceFleet,controlFleet,fleetSummary,type FleetRead} from './paper-fleet';
import {loadFleet,fleetRecords,fleetScanRecords} from './paper-fleet-storage';
import {checkVolume, type VolumeState, type VolumeEvent} from './volume';
import type {Snapshot} from './schema';
import { checkRanges, type RangeState, type RangeEvent } from '../monitoring/range-engine.mjs';
import {initialPaperState,initialPaperSampleState,controlPaper,advancePaperState,paperSummary,paperEquity,type PaperState,type PaperRead} from './paper-bot';
import {paperScanRecord,scanKey,scanCutoff,SCAN_PREFIX,SCAN_RETENTION_DAYS} from './paper-journal';
import {advanceLab,controlLab,labSummary,type LabRead} from './paper-lab';
import {loadLab,labRecords} from './paper-lab-storage';

interface Inbox { state:RangeState; events:(RangeEvent & {id:string})[]; sourceAt:string }
const reply = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});

// A single durable writer serializes refreshes from tabs and the five-minute server schedule.
// The Worker authenticates paper controls. This object has no wallet signing capability.
export class RangeInbox {
  constructor(private ctx:DurableObjectState) {}
  async fetch(request:Request):Promise<Response> {
    const url=new URL(request.url);
    const jupiter=await researchJupiterBudgetRequest(this.ctx,request);if(jupiter)return jupiter;
    if(url.pathname==='/reserve'&&request.method==='POST')return this.ctx.blockConcurrencyWhile(async()=>{
      const result=reserveGecko(await this.ctx.storage.get<DataBudget>('gecko-budget'));
      if(result.allowed)await this.ctx.storage.put('gecko-budget',result.state);
      return reply({allowed:result.allowed});
    });
    if(url.pathname==='/budget'&&request.method==='GET'){
      const stored=await this.ctx.storage.get<DataBudget>('gecko-budget');const day=new Date().toISOString().slice(0,10);
      return reply({provider:'CoinGecko fallback',day,attemptsToday:stored?.day===day?stored.attempts:0,dailyLimit:GECKO_DAILY_LIMIT,accountUsageKnown:false,policy:'Free APIs first; this counter covers only this terminal.'});
    }

    if(url.pathname.startsWith('/fleet')){
      if(request.method==='GET'){
        if(url.pathname==='/fleet/trades'||url.pathname==='/fleet/scans'||url.pathname==='/fleet/unscorable'){
          const prefix=url.pathname.endsWith('/trades')?'fleet-trade:':url.pathname.endsWith('/unscorable')?'fleet-unscorable:':'fleet-scan:',cursor=url.searchParams.get('cursor');
          if(cursor&&(!cursor.startsWith(prefix)||cursor.length>300))return reply({error:'Invalid cursor'},400);
          const values=await this.ctx.storage.list({prefix,limit:51,...(cursor?{startAfter:cursor}:{})}),entries=[...values.entries()];
          const shown=await Promise.all(entries.slice(0,50).map(async([,v])=>{const scan=v as {readRefs?:string[];reads?:unknown[]};if(!scan.readRefs)return v;const reads=await Promise.all(scan.readRefs.map(ref=>this.ctx.storage.get(ref)));if(reads.some(r=>!r))throw Error('Saved scan evidence unavailable');const {readRefs,...rest}=scan;return {...rest,reads};}));
          return reply({records:shown,cursor:entries.length>50?entries[49][0]:null});
        }
        const state=await loadFleet(this.ctx.storage);return reply(url.pathname==='/fleet/raw'?state:fleetSummary(state));
      }
      if(request.method!=='POST')return reply({error:'Method not allowed'},405);
      if(url.pathname==='/fleet/control'){
        const {action}=await request.json() as {action:string};
        return this.ctx.blockConcurrencyWhile(async()=>{try{const next=controlFleet(await loadFleet(this.ctx.storage),action);await this.ctx.storage.put(fleetRecords(next));return reply(fleetSummary(next));}catch(e){return reply({error:e instanceof Error?e.message:'Fleet control failed'},400);}});
      }
      if(url.pathname!=='/fleet')return reply({error:'Not found'},404);
      const input=await request.json() as {expectedRevision:number;snapshot:Snapshot;reads:FleetRead[];mode?:'full'|'heart';readHealth?:{requests:number;rateLimits:number;failed:number;elapsedMs:number}};
      if(!input.snapshot||!Array.isArray(input.reads))return reply({error:'Invalid fleet observation'},400);
      return this.ctx.blockConcurrencyWhile(async()=>{
        const previous=await loadFleet(this.ctx.storage);
        if(previous.revision!==input.expectedRevision)return reply({error:'A newer fleet observation is saved'},409);
        const next=advanceFleet(previous,input.snapshot,input.reads,Date.now(),input.mode==='heart'?'heart':'full');if(next===previous)return reply({ok:true,unchanged:true});
        if(input.readHealth&&Object.values(input.readHealth).every(n=>Number.isFinite(n)&&n>=0))next.readHealth=input.readHealth;
        const records:Record<string,unknown>={};
        if(previous.version!==next.version)records['fleet-baseline:'+previous.version]={version:previous.version,archivedAt:next.lastScanAt,state:fleetRecords(previous).fleet};
        for(const t of next.closed)if(!previous.closed.some(p=>p.id===t.id))records['fleet-trade:'+t.closedAt+':'+t.id]=t;
        for(const u of next.unscorable||[])if(!(previous.unscorable||[]).some(p=>p.id===u.id))records['fleet-unscorable:'+u.endedAt+':'+u.id]=u;
        for(const p of next.positions)if(!previous.positions.some(old=>old.id===p.id)){const {model,...entry}=p;records['fleet-entry:'+p.id]={...entry,modelRef:'fleet-model:'+p.id};}
        Object.assign(records,fleetScanRecords(next.lastScanAt!,{at:next.lastScanAt,version:next.version,revision:next.revision,mode:next.lastObservationMode,readHealth:next.readHealth,funnel:next.funnel,rules:fleetSummary(next).rules,portfolios:fleetSummary(next).arms,candidates:next.candidates,skips:next.skips,reads:input.reads.map(({entry,...r})=>({...r,entry:entry?{id:entry.id,cohort:entry.cohort,arm:entry.arm,budgetSol:entry.budgetSol,rentSol:entry.rentSol,entryNetworkSol:entry.entryNetworkSol,entryCosts:entry.entryCosts,allocation:entry.allocation,entrySignal:next.positions.find(p=>p.id===entry.id)?.entrySignal,pool:entry.pool,modelRef:'fleet-model:'+entry.id,entryReferenceSol:entry.entryReferenceSol,bidStartSol:entry.bidStartSol,bidEndSol:entry.bidEndSol,dustSol:entry.dustSol,mark:entry.mark}:undefined}))}));
        next.closed=next.closed.slice(-90);next.unscorable=(next.unscorable||[]).slice(-40);Object.assign(records,fleetRecords(next));await this.ctx.storage.put(records);
        try{const expired=await this.ctx.storage.list({prefix:'fleet-scan:',end:'fleet-scan:'+new Date(Date.now()-8*86400000).toISOString(),limit:50});if(expired.size){const refs=[...expired.values()].flatMap(v=>(v as {readRefs?:string[]}).readRefs||[]);const keys=[...expired.keys(),...refs];for(let i=0;i<keys.length;i+=128)await this.ctx.storage.delete(keys.slice(i,i+128));}}catch{console.warn('Fleet scan cleanup deferred');}
        return reply({ok:true,revision:next.revision});
      });
    }
    if(url.pathname.startsWith('/lab')){
      if(request.method==='GET'){
        if(url.pathname==='/lab/trades'||url.pathname==='/lab/scans'||url.pathname==='/lab/unscorable'){
          const prefix=url.pathname.endsWith('/trades')?'lab-trade:':url.pathname.endsWith('/unscorable')?'lab-unscorable:':'lab-scan:',cursor=url.searchParams.get('cursor');
          if(cursor&&(!cursor.startsWith(prefix)||cursor.length>300))return reply({error:'Invalid cursor'},400);
          const values=await this.ctx.storage.list({prefix,limit:51,...(cursor?{startAfter:cursor}:{})}),entries=[...values.entries()];
          return reply({records:entries.slice(0,50).map(([,v])=>v),cursor:entries.length>50?entries[49][0]:null});
        }
        const state=await loadLab(this.ctx.storage);return reply(url.pathname==='/lab/raw'?state:labSummary(state));
      }
      if(request.method!=='POST')return reply({error:'Method not allowed'},405);
      if(url.pathname==='/lab/control'){
        const {action}=await request.json() as {action:string};
        return this.ctx.blockConcurrencyWhile(async()=>{try{const next=controlLab(await loadLab(this.ctx.storage),action);await this.ctx.storage.put(labRecords(next));return reply(labSummary(next));}catch(e){return reply({error:e instanceof Error?e.message:'Lab control failed'},400);}});
      }
      if(url.pathname!=='/lab')return reply({error:'Not found'},404);
      const input=await request.json() as {expectedRevision:number;snapshot:Snapshot;reads:LabRead[];archiveEntries?:boolean};
      if(!input.snapshot||!Array.isArray(input.reads))return reply({error:'Invalid lab observation'},400);
      return this.ctx.blockConcurrencyWhile(async()=>{
        const previous=await loadLab(this.ctx.storage);
        if(previous.revision!==input.expectedRevision)return reply({error:'A newer lab observation is saved'},409);
        const inputState=input.archiveEntries?{...previous,entryProfiles:[]}:previous;
        const next=advanceLab(inputState,input.snapshot,input.reads);if(next===previous)return reply({ok:true,unchanged:true});
        const records:Record<string,unknown>={};
        if(previous.version!==next.version)records['lab-baseline:'+previous.version]={version:previous.version,archivedAt:next.lastScanAt,state:labRecords(previous).lab};
        for(const t of next.closed)if(!previous.closed.some(p=>p.id===t.id))records['lab-trade:'+t.closedAt+':'+t.id]=t;
        for(const u of next.unscorable||[])if(!(previous.unscorable||[]).some(p=>p.id===u.id))records['lab-unscorable:'+u.endedAt+':'+u.id]=u;
        records['lab-scan:'+next.lastScanAt]={at:next.lastScanAt,version:next.version,revision:next.revision,rules:labSummary(next).rules,portfolios:labSummary(next).arms,candidates:next.candidates,skips:next.skips,reads:input.reads.map(({entry,...r})=>({...r,entry:entry?{id:entry.id,cohort:entry.cohort,arm:entry.arm,pool:entry.pool,modelRef:'lab-model:'+entry.id,entryReferenceSol:entry.entryReferenceSol,bidStartSol:entry.bidStartSol,bidEndSol:entry.bidEndSol,dustSol:entry.dustSol,mark:entry.mark}:undefined}))};
        next.closed=next.closed.slice(-90);next.unscorable=(next.unscorable||[]).slice(-40);Object.assign(records,labRecords(next));await this.ctx.storage.put(records);
        try{const expired=await this.ctx.storage.list({prefix:'lab-scan:',end:'lab-scan:'+new Date(Date.now()-8*86400000).toISOString(),limit:50});if(expired.size)await this.ctx.storage.delete([...expired.keys()]);}catch{console.warn('Lab scan cleanup deferred');}
        return reply({ok:true,revision:next.revision});
      });
    }
    if(url.pathname.startsWith('/bot')||url.pathname.startsWith('/samples')){
      const samples=url.pathname.startsWith('/samples'),path=samples?url.pathname.replace('/samples','/bot'):url.pathname;
      const initial=()=>samples?initialPaperSampleState():initialPaperState();
      if(request.method==='GET'){
        if(path==='/bot/scans'){
          const cursor=url.searchParams.get('cursor'),cutoff=scanCutoff();
          if(cursor&&(!/^paper-scan:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z:\d{12}$/.test(cursor)))return reply({error:'Invalid cursor'},400);
          const values=await this.ctx.storage.list({prefix:SCAN_PREFIX,limit:51,...(cursor&&cursor>=cutoff?{startAfter:cursor}:{start:cutoff})});
          const entries=[...values.entries()];
          return reply({retentionDays:SCAN_RETENTION_DAYS,scans:entries.slice(0,50).map(([,v])=>v),cursor:entries.length>50?entries[49][0]:null});
        }
        if(path==='/bot/unscorable'){
          const cursor=url.searchParams.get('cursor');
          if(cursor&&(!cursor.startsWith('paper-unscorable:')||cursor.length>300))return reply({error:'Invalid cursor'},400);
          const values=await this.ctx.storage.list({prefix:'paper-unscorable:',limit:51,...(cursor?{startAfter:cursor}:{})});
          const entries=[...values.entries()];return reply({unscorable:entries.slice(0,50).map(([,v])=>v),cursor:entries.length>50?entries[49][0]:null});
        }
        if(path==='/bot/trades'){
          const cursor=url.searchParams.get('cursor');
          if(cursor&&(!cursor.startsWith('paper-trade:')||cursor.length>300))return reply({error:'Invalid cursor'},400);
          const values=await this.ctx.storage.list({prefix:'paper-trade:',limit:51,...(cursor?{startAfter:cursor}:{})});
          const entries=[...values.entries()];return reply({trades:entries.slice(0,50).map(([,v])=>v),cursor:entries.length>50?entries[49][0]:null});
        }
        const state=await this.ctx.storage.get<PaperState>('paper')||initial();
        return reply(path==='/bot/raw'?state:paperSummary(state));
      }
      if(request.method==='POST'&&path==='/bot/control'){
        const {action}=await request.json() as {action:string};
        return this.ctx.blockConcurrencyWhile(async()=>{
          try{const previous=await this.ctx.storage.get<PaperState>('paper')||initial();const next=controlPaper(previous,action);await this.ctx.storage.put('paper',next);return reply(paperSummary(next));}
          catch(e){return reply({error:e instanceof Error?e.message:'Paper control unavailable'},400);}
        });
      }
      if(request.method!=='POST'||path!=='/bot')return reply({error:'Method not allowed'},405);
      const input=await request.json() as {expectedRevision:number;snapshot:Snapshot;reads:PaperRead[];archiveEntries?:boolean};
      if(!input.snapshot||!Array.isArray(input.reads))return reply({error:'Invalid paper observation'},400);
      return this.ctx.blockConcurrencyWhile(async()=>{
        const previous=await this.ctx.storage.get<PaperState>('paper')||initial();
        if(input.expectedRevision!==previous.revision)return reply({error:'A newer paper scan is already saved'},409);
        if(!!previous.mode!==samples)return reply({error:'Paper series mismatch'},409);
        const next=advancePaperState(previous,input.snapshot,input.reads,Date.now(),input.archiveEntries===true);
        if(next===previous)return reply({ok:true,unchanged:true});
        const records:Record<string,unknown>={};
        if(!previous.entriesArchivedAt&&next.entriesArchivedAt)records['paper-retained-baseline']={archivedAt:next.entriesArchivedAt,state:previous};
        if(previous.version!==next.version)records['paper-baseline:'+previous.version]={version:previous.version,archivedAt:input.snapshot.updatedAt,equitySol:paperEquity(previous),state:previous};
        for(const trade of next.closed)if(!previous.closed.some(p=>p.id===trade.id))records['paper-trade:'+trade.closedAt+':'+trade.id]=trade;
        if(samples){
          for(const p of next.positions)if(!previous.positions.some(old=>old.id===p.id))records['paper-model:'+p.id]=structuredClone(p);
          for(const u of next.unscorable||[])if(!previous.unscorable?.some(old=>old.id===u.id)){records['paper-unscorable:'+u.recordedAt+':'+u.id]=u;}
        }
        records[scanKey(next)]=paperScanRecord(previous,next,input.snapshot,input.reads);
        next.closed=next.closed.slice(-50);if(next.unscorable)next.unscorable=next.unscorable.slice(-40);records.paper=next;
        await this.ctx.storage.put(records);
        // Prune only these new research records, never trade outcomes or baselines.
        // A bounded pass prevents a long outage from causing unbounded cleanup work.
        try{
          const expired=await this.ctx.storage.list({prefix:SCAN_PREFIX,end:scanCutoff(),limit:50});
          if(expired.size)await this.ctx.storage.delete([...expired.keys()]);
        }catch{console.warn('Paper scan retention cleanup deferred');}
        return reply({ok:true,revision:next.revision});
      });
    }
    if(new URL(request.url).pathname==='/volume') {
      if(request.method==='GET'){const saved=await this.ctx.storage.get<any>('volume');if(!saved)return reply({state:null,events:[],sources:{},coverage:null});const {pools,...state}=saved.state;return reply({...saved,state});}
      if(request.method!=='POST')return reply({error:'Method not allowed'},405);
      const snapshot=await request.json() as Snapshot;
      return this.ctx.blockConcurrencyWhile(async()=>{
        const previous=await this.ctx.storage.get<{state:VolumeState;events:VolumeEvent[]}>('volume');
        const {state,events}=checkVolume(snapshot,previous?.state);
        if(state===previous?.state)return reply({ok:true,unchanged:true});
        await this.ctx.storage.put('volume',{state,events:[...(previous?.events||[]),...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-200),sources:snapshot.sources,coverage:snapshot.discoveryCoverage});
        return reply({ok:true,newEvents:events.length});
      });
    }
    if(request.method==='GET')return reply(await this.ctx.storage.get<Inbox>('inbox') || {state:null,events:[],sourceAt:null});
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    const input=await request.json() as {payload:any;wallets:string[]};
    const sample=Date.parse(input.payload?.updatedAt);
    if(!Number.isFinite(sample)||!Array.isArray(input.wallets))return reply({error:'Invalid observation'},400);
    return this.ctx.blockConcurrencyWhile(async()=>{
      const previous=await this.ctx.storage.get<Inbox>('inbox');
      if(previous && sample <= Date.parse(previous.sourceAt))return reply({ok:true,unchanged:true});
      const {state,events}=checkRanges(input.payload,previous?.state,{wallets:input.wallets,defaultGraceMinutes:60,maxDataAgeMinutes:10});
      const additions=events.map((e,i)=>({...e,id:`${input.payload.updatedAt}:${i}:${e.kind}:${e.positionId||e.wallet}`}));
      const inbox:Inbox={state,events:[...(previous?.events||[]),...additions].slice(-200),sourceAt:input.payload.updatedAt};
      await this.ctx.storage.put('inbox',inbox);
      return reply({ok:true,newEvents:additions.length});
    });
  }
}

export function rangeInbox(namespace:DurableObjectNamespace) {
  return namespace.get(namespace.idFromName('pat-range-inbox-v1'));
}

export function volumeInbox(namespace:DurableObjectNamespace) {
  return namespace.get(namespace.idFromName('pat-volume-inbox-v1'));
}
