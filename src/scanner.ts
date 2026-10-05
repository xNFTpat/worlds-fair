export type ScanMode = 'full' | 'heart';
export interface ScanResult { status:'committed'|'unchanged'; at:string|null; revision:number }
export interface ScannerWorkResult { fleet:ScanResult; warnings:string[] }
type Trigger = 'cron'|'alarm'|'start'|'refresh';
interface Attempt { id:string; at:string; trigger:Trigger; mode:ScanMode; stage:string; finishedAt?:string; status:'running'|'complete'|'failed'|'interrupted'; error?:string; revision?:number; warnings?:string[] }
interface ScannerState { enabled:boolean; lastAttemptAt?:string; lastSuccessAt?:string; lastFullSuccessAt?:string; lastFleetAt?:string; nextAttemptAt?:number; nextFullAt?:number; failures:number; attempts:Attempt[]; active?:Attempt }
const KEY='scanner:v1',MINUTE=60_000;
export function scannerInbox(ns:DurableObjectNamespace){return ns.get(ns.idFromName('pat-background-scanner-v1'));}
const initial=():ScannerState=>({enabled:false,failures:0,attempts:[]});
const iso=(n:number)=>new Date(n).toISOString();

// The lock and timer share one durable object. Only short storage operations run
// inside blockConcurrencyWhile; provider calls never hold its 30-second gate.
export class ScannerCoordinator {
  private busy=false;
  constructor(private ctx:DurableObjectState,private work:(mode:ScanMode,stage:(s:string)=>Promise<void>)=>Promise<ScannerWorkResult>,private now=Date.now){}
  async health(){
    const s=await this.ctx.storage.get<ScannerState>(KEY)||initial(),now=this.now();
    const age=s.lastFullSuccessAt?now-Date.parse(s.lastFullSuccessAt):Infinity;
    return {...s,active:s.active||null,checkedAt:iso(now),nextWakeAt:await this.ctx.storage.getAlarm(),
      status:!s.enabled?'stopped':!s.lastSuccessAt?'starting':s.failures||age>7*MINUTE?'delayed':'running'};
  }
  async stop(){return this.ctx.blockConcurrencyWhile(async()=>{
    const s=await this.ctx.storage.get<ScannerState>(KEY)||initial();s.enabled=false;
    await this.ctx.storage.put(KEY,s);await this.ctx.storage.deleteAlarm();return {ok:true};
  });}
  async tick(trigger:Trigger){
    const attempt=await this.ctx.blockConcurrencyWhile(async()=>{
      const now=this.now(),stored=await this.ctx.storage.get<ScannerState>(KEY),s=stored||initial();
      // Existing refresh/cron entry points bootstrap it once; an explicit stop
      // survives later page refreshes and cron ticks.
      if(trigger==='start'||(!stored&&(trigger==='cron'||trigger==='refresh')))s.enabled=true;
      if(!s.enabled)return null;
      // Set the next wake before any network work. A terminated invocation cannot
      // silently remove the only future attempt. Concurrent cron calls reuse it.
      await this.ctx.storage.put(KEY,s);
      if(this.busy||now<(s.nextAttemptAt||0)){
        const target=Math.max(now+1000,this.busy?now+MINUTE:s.nextAttemptAt!);
        const alarm=await this.ctx.storage.getAlarm();
        if(alarm==null||alarm>target)await this.ctx.storage.setAlarm(target);
        return null;
      }
      if(s.active){s.attempts=[{...s.active,status:'interrupted' as const,finishedAt:iso(now),error:'The previous background run did not finish.'},...s.attempts].slice(0,40);}
      const a:Attempt={id:crypto.randomUUID(),at:iso(now),trigger,mode:now>=(s.nextFullAt||0)?'full':'heart',stage:'starting',status:'running'};
      s.active=a;s.lastAttemptAt=a.at;s.nextAttemptAt=now+MINUTE;
      await this.ctx.storage.setAlarm(s.nextAttemptAt);
      await this.ctx.storage.put(KEY,s);this.busy=true;return a;
    });
    if(!attempt)return {ok:true,skipped:true};
    let result:ScannerWorkResult|undefined,error:string|undefined;
    try{
      result=await this.work(attempt.mode,async stage=>{await this.ctx.blockConcurrencyWhile(async()=>{
        const s=await this.ctx.storage.get<ScannerState>(KEY);if(s?.active?.id!==attempt.id)return;
        s.active.stage=stage;await this.ctx.storage.put(KEY,s);
      });});
      if(!result.fleet.at)throw Error('No completed paper observation is available.');
    }catch(e){
      // Only public, bounded messages may be stored. Work errors are translated
      // before crossing this boundary; unknown runtime errors use a fixed label.
      error=e instanceof ScannerError?e.message:'Background scan failed before completion.';
      console.warn('Background scan incomplete',attempt.mode,attempt.id);
    }finally{
      try{await this.ctx.blockConcurrencyWhile(async()=>{
        const now=this.now(),s=await this.ctx.storage.get<ScannerState>(KEY)||initial();
        if(s.active?.id!==attempt.id)return;
        const finished:Attempt={...s.active,status:error?'failed':'complete',finishedAt:iso(now),...(error?{error}:{}),...(result?{revision:result.fleet.revision,warnings:result.warnings}: {})};
        s.attempts=[finished,...s.attempts].slice(0,40);delete s.active;
        if(error){s.failures++;s.nextAttemptAt=now+Math.min(5*MINUTE,MINUTE*2**Math.min(s.failures-1,3));}
        else{
          s.failures=0;s.lastSuccessAt=iso(now);s.lastFleetAt=result!.fleet.at!;
          if(attempt.mode==='full'){s.lastFullSuccessAt=result!.fleet.at!;s.nextFullAt=Date.parse(attempt.at)+5*MINUTE;}
          s.nextAttemptAt=Math.max(now+1000,Date.parse(attempt.at)+MINUTE);
        }
        await this.ctx.storage.put(KEY,s);
        if(s.enabled)await this.ctx.storage.setAlarm(s.nextAttemptAt!);
      });}finally{this.busy=false;}
    }
    return {ok:!error,...(error?{error}:{}),mode:attempt.mode,revision:result?.fleet.revision};
  }
}
export class ScannerError extends Error {}
