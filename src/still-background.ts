import type {Env} from './env';
import type {Snapshot} from './schema';
import {ScannerCoordinator, ScannerError, type ScanMode, type ScannerWorkResult} from './scanner';
import {SNAPSHOT_KEY, refreshPoolsImpl} from './refresh';
import {recordResearchObservation} from './lp-research';
import {setGeckoKey} from './sources/geckoterminal';

/** The public demo schedules catalogue observations, not the archived private
 * research experiments. Guided Follow runs retain their own durable alarms. */
export async function runStillBackground(env:Env,mode:ScanMode,stage:(s:string)=>Promise<void>):Promise<ScannerWorkResult>{
  setGeckoKey(env.GECKO_KEY,env.LP_CACHE,env.RANGE_ALERTS);
  let snapshot:Snapshot|null=null;const warnings:string[]=[];
  if(mode==='full'){
    await stage('Refreshing Still pool data');
    try{snapshot=await refreshPoolsImpl(env);}catch{warnings.push('Pool refresh unavailable; source dates are retained.');}
  }
  if(!snapshot)snapshot=await env.LP_CACHE.get<Snapshot>(SNAPSHOT_KEY,'json');
  if(!snapshot)throw new ScannerError('Still pool data is unavailable.');
  if(mode==='full'){
    await stage('Saving dated pool observations');
    try{await recordResearchObservation(snapshot,env);}catch{warnings.push('Pool observation history could not be updated.');}
  }
  // Do not label the archived fleet as freshly marked. Its saved journals are
  // unchanged; these results describe only catalogue/history maintenance.
  return {fleet:{status:'unchanged',at:null,revision:0},warnings};
}
export class StillBackgroundScanner {
  private coordinator:ScannerCoordinator;
  constructor(ctx:DurableObjectState,env:Env){this.coordinator=new ScannerCoordinator(ctx,(mode,stage)=>runStillBackground(env,mode,stage));}
  async alarm(){await this.coordinator.tick('alarm');}
  async fetch(request:Request){
    const path=new URL(request.url).pathname;
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
    if(path==='/scanner/health'&&request.method==='GET')return reply({...await this.coordinator.health(),scope:'Still catalogue and dated observations. Archived research trials are paused; guided Follow has independent alarms.'});
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    if(path==='/scanner/stop')return reply(await this.coordinator.stop());
    if(path==='/scanner/start')return reply(await this.coordinator.tick('start'));
    if(path==='/scanner/tick'){const result=await this.coordinator.tick(request.headers.get('x-trigger')==='refresh'?'refresh':'cron');return reply(result,result.ok?200:503);}
    return reply({error:'Not found'},404);
  }
}
