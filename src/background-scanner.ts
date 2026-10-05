import type {Env} from './env';
import {ScannerCoordinator} from './scanner';
import {runBackground} from './background';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});

// Separate coordinator storage leaves the existing paper journals untouched.
export class BackgroundScanner {
  private coordinator:ScannerCoordinator;
  constructor(ctx:DurableObjectState,env:Env){this.coordinator=new ScannerCoordinator(ctx,(mode,stage)=>runBackground(env,mode,stage));}
  async alarm(){await this.coordinator.tick('alarm');}
  async fetch(request:Request){
    const path=new URL(request.url).pathname;
    if(path==='/scanner/health'&&request.method==='GET')return reply(await this.coordinator.health());
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    if(path==='/scanner/stop')return reply(await this.coordinator.stop());
    if(path==='/scanner/start')return reply(await this.coordinator.tick('start'));
    if(path==='/scanner/tick'){
      const result=await this.coordinator.tick(request.headers.get('x-trigger')==='refresh'?'refresh':'cron');return reply(result,result.ok?200:503);
    }
    return reply({error:'Not found'},404);
  }
}
