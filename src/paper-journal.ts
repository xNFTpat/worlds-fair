import type {Pool,Snapshot} from './schema';
import {paperSummary,type PaperState,type PaperRead} from './paper-bot';
import {volumeSignal} from './volume';

export const SCAN_RETENTION_DAYS=8;
export const SCAN_PREFIX='paper-scan:';
export const scanCutoff=(now=Date.now())=>SCAN_PREFIX+new Date(now-SCAN_RETENTION_DAYS*86400000).toISOString();
export const scanKey=(s:PaperState)=>SCAN_PREFIX+s.lastScanAt+':'+String(s.revision).padStart(12,'0');
const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n:null;

// Research observations only. Reuses the current catalogue and the reads already
// paid for by the runner; cannot select positions or initiate additional RPCs.
export function paperScanRecord(previous:PaperState,next:PaperState,snapshot:Snapshot,reads:PaperRead[],now=Date.now()){
  const summary=paperSummary(next,now);
  const pools=snapshot.pools.filter(p=>p.chain==='solana'&&p.venue==='meteora-dlmm');
  const leaders=(value:(p:Pool)=>number|null)=>pools.filter(p=>value(p)!=null)
    .slice().sort((a,b)=>(value(b)!-value(a)!)||a.id.localeCompare(b.id)).slice(0,12);
  const recent=leaders(p=>number(p.activity?.volume30m)),daily=leaders(p=>number(p.volume24hUsd));
  const samples=[...new Map([...recent,...daily].map(p=>[p.id,p])).values()];
  return {
    schemaVersion:1,at:next.lastScanAt,revision:next.revision,experiment:next.version,rules:summary.rules,
    runState:next.runState,entryGate:summary.entryGate,daily:summary.daily,
    equitySol:summary.equitySol,pnlSol:summary.pnlSol,cashSol:summary.cashSol,
    realizedPnlSol:next.realizedPnlSol,closedCount:next.closedCount,maxDrawdown:summary.maxDrawdown,
    sampleMode:summary.sampleMode,attemptCount:summary.attemptCount,unscorableCount:summary.unscorableCount,unavailableScans:next.unavailableScans,
    positions:summary.positions.map(p=>({id:p.id,poolId:p.pool.id,pair:p.pool.pair,mint:p.mint,
      experiment:p.experiment||next.version,openedAt:p.openedAt,investmentSol:p.investmentSol,entryCosts:p.entryCosts,
      pnlSol:p.pnlSol,mark:p.mark,issue:p.issue,diagnostics:p.diagnostics,pendingExit:p.pendingExit})),
    candidates:next.candidates,skips:next.lastSkips,
    checks:reads.map(r=>({poolId:r.poolId,positionId:r.positionId||null,
      result:r.error?'failed':r.entry?'entry-quoted':r.mark?.liquidationSol!=null?'marked':'exit-quote-unavailable',
      reason:r.error||r.mark?.issue||null,diagnostics:r.diagnostics})),
    events:next.events.filter(e=>!previous.events.some(p=>p.id===e.id)),
    coverage:{cataloguePools:snapshot.pools.length,solanaDlmmPools:pools.length,sampledPools:samples.length,
      selection:'Union of top 12 by 30m volume and top 12 by 24h volume; not the full market or a trading recommendation',
      sourceAt:snapshot.updatedAt,unavailableSources:Object.keys(snapshot.errors||{})},
    markets:samples.map(p=>({id:p.id,pair:p.pair,base:p.base.address,quote:p.quote.address,
      fetchedAt:p.fetchedAt,tvlUsd:number(p.tvlUsd),volume24hUsd:number(p.volume24hUsd),
      volume30mUsd:number(p.activity?.volume30m),volume1hUsd:number(p.activity?.volume1h),
      fees30mUsd:number(p.activity?.fees30m),fees24hUsd:number(p.fees24hUsd),
      priceUsd:number(p.priceUsd),quotePriceUsd:number(p.quotePriceUsd),ageHours:number(p.ageHours),
      acceleration:volumeSignal(p,now).ratio,
      sample:recent.some(x=>x.id===p.id)?daily.some(x=>x.id===p.id)?'both':'30m':'24h'})),
  };
}
