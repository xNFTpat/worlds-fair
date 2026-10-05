import type {Env} from './env';
import type {Snapshot} from './schema';
import {ScannerError,type ScanMode,type ScannerWorkResult} from './scanner';
import {SNAPSHOT_KEY,pickRobinhoodRpc,refreshPoolsImpl,refreshPositionsImpl} from './refresh';
import {setRobinhoodRpc} from './sources/uniswap-positions';
import {setGeckoKey} from './sources/geckoterminal';
import {runPaperFleet} from './paper-fleet-runner';
import {runPaperTrials} from './paper-runner';
import {runPaperLab} from './paper-lab-runner';
import {recordResearchObservation} from './lp-research';

export async function runBackground(env:Env,mode:ScanMode,stage:(s:string)=>Promise<void>):Promise<ScannerWorkResult>{
  if(!env?.RANGE_ALERTS)throw new ScannerError('Paper journal is unavailable.');
  let snap:Snapshot|null=null;const warnings:string[]=[];
  setGeckoKey(env.GECKO_KEY,env.LP_CACHE,env.RANGE_ALERTS);
  if(mode==='full'){
    await stage('Refreshing pool data');
    // A failing personal-wallet RPC must not block Solana paper exits.
    try{setRobinhoodRpc((await pickRobinhoodRpc(env)).rpc);}catch{warnings.push('Robinhood provider check unavailable.');}
    try{snap=await refreshPoolsImpl(env);}catch{warnings.push('Pool refresh unavailable; checking holdings with saved discovery data.');}
  }
  if(!snap)snap=await env.LP_CACHE.get<Snapshot>(SNAPSHOT_KEY,'json');
  if(!snap)throw new ScannerError('No pool snapshot is available for a paper scan.');
  // Fresh observation time does not change any pool's source timestamp.
  snap={...snap,updatedAt:new Date().toISOString()};
  await stage('Checking paper positions');
  let fleet;
  try{fleet=await runPaperFleet(env.RANGE_ALERTS,snap,env.SOLANA_RPC||'https://api.mainnet-beta.solana.com',mode);}
  catch{throw new ScannerError('The paper position scan could not be saved.');}
  if(mode==='full'){
    // Reuse source-dated catalogue readings; no added market/provider requests.
    try{const history=await recordResearchObservation(snap,env);if(history?.status==='unavailable')warnings.push('Research history could not be updated.');}catch{warnings.push('Research history could not be updated.');}
    await stage('Refreshing personal wallets');
    try{await refreshPositionsImpl(env);}catch{warnings.push('Personal-wallet refresh incomplete.');}
    await stage('Checking older paper trials');
    for(const run of [runPaperTrials,runPaperLab])try{await run(env.RANGE_ALERTS,snap,env.SOLANA_RPC||'https://api.mainnet-beta.solana.com');}catch{warnings.push('An older paper trial could not refresh.');}
  }
  return {fleet,warnings};
}
