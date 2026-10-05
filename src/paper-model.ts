export const PAPER_RULES = Object.freeze({version:'active-lp-v5',seedSol:1,budgetSol:0.2,maxOpen:2,reserveSol:0.1,rentSol:0.06,networkSol:0.0001,slippageBps:100,maxEntryCostBps:500,maxTaxedEntryCostBps:800,widthPct:5,maxBins:69,maxShareBps:100,minTvl:25000,minVolume24h:50000,minVolume30m:5000,minRatio:1.5,minAgeHours:24,confirmations:3,minScanMs:240000,maxGapMs:600000,maxDailyEntries:24,maxDailyLossSol:0.05,maxDrawdown:0.1,stopLoss:-0.1,takeProfit:0.2,outMinutes:60,fadeChecks:3,minVolumeHoldMinutes:60,maxHoldHours:24,cooldownMs:86400000});
export interface PaperBin {id:number;x:string;y:string;supply:string;feeX:string;feeY:string;qPrice:string;price:number}
export interface PaperShare {id:number;share:string;feeX:string;feeY:string}
export interface PaperBinDiagnostic {id:number;code:'missing-bin'|'empty-bin'|'share-limit'|'fee-reset';supplyRaw?:string;virtualShareRaw:string;shareBpsFloor?:string}
export interface PaperDiagnostics {phase:'entry'|'mark';checkedBins:number;limitBps:number;bins:PaperBinDiagnostic[]}
export class PaperModelError extends Error {
  constructor(message:string,readonly diagnostics:PaperDiagnostics){super(message);this.name='PaperModelError';}
}
export const paperDiagnostics=(error:unknown):PaperDiagnostics|undefined=>error instanceof PaperModelError?error.diagnostics:undefined;
export interface PaperModel {shares:PaperShare[];solX:boolean;decX:number;decY:number;mintX:string;mintY:string;lowerBin:number;upperBin:number}
export interface PaperTokenPolicy {mint:string;bps:number;maximumRaw:string}
export interface PaperEntryCosts {fundingSol:number;depositTaxSol:number;initialRoundTripSol:number;epoch:number;transferFees:PaperTokenPolicy[]}
export interface PaperMark {at:string;principalSol:number;feesSol:number;grossSol:number;liquidationSol:number|null;conversionCostSol:number|null;networkSol:number;inRange:boolean;priceSol:number;issue?:string;withdrawTaxSol?:number;epoch?:number;transferFees?:PaperTokenPolicy[]}
const raw=(s:string)=>{if(!/^\d+$/.test(s))throw Error('Invalid bin accounting');return BigInt(s);};
export function virtualShares(bins:PaperBin[],amounts:{id:number;x:string;y:string}[]):PaperShare[]{
  return amounts.filter(a=>raw(a.x)>0n||raw(a.y)>0n).map(a=>{
    const b=bins.find(b=>b.id===a.id);if(!b)throw Error('Target bin is missing');
    const supply=raw(b.supply),liquidity=raw(b.qPrice)*raw(b.x)+(raw(b.y)<<64n);
    if(!supply||!liquidity)throw Error('An empty target bin cannot be modelled');
    const share=(raw(b.qPrice)*raw(a.x)+(raw(a.y)<<64n))*supply/liquidity;
    if(share<=0n)throw Error('Deposit is too small for this bin');
    if(share*10000n>supply*BigInt(PAPER_RULES.maxShareBps))throw new PaperModelError('Paper deposit would exceed 1% of a target bin',{phase:'entry',checkedBins:1,limitBps:PAPER_RULES.maxShareBps,bins:[{id:b.id,code:'share-limit',supplyRaw:b.supply,virtualShareRaw:share.toString(),shareBpsFloor:(share*10000n/supply).toString()}]});
    return {id:a.id,share:share.toString(),feeX:b.feeX,feeY:b.feeY};
  });
}
export function markAmounts(model:PaperModel,bins:PaperBin[],priceYX:number){
  if(!Number.isFinite(priceYX)||priceYX<=0||!model.shares.length)throw Error('Pool price or paper shares unavailable');
  const failures:PaperBinDiagnostic[]=[];
  for(const s of model.shares){
    const b=bins.find(b=>b.id===s.id),share=raw(s.share);
    if(!b){failures.push({id:s.id,code:'missing-bin',virtualShareRaw:s.share});continue;}
    const supply=raw(b.supply),base={id:s.id,supplyRaw:b.supply,virtualShareRaw:s.share,...(supply?{shareBpsFloor:(share*10000n/supply).toString()}:{})};
    if(!supply||share*10000n>supply*BigInt(PAPER_RULES.maxShareBps))failures.push({...base,code:supply?'share-limit':'empty-bin'});
    else if(raw(b.feeX)<raw(s.feeX)||raw(b.feeY)<raw(s.feeY))failures.push({...base,code:'fee-reset'});
  }
  if(failures.length)throw new PaperModelError(failures[0].code==='missing-bin'?'A paper bin is missing':failures[0].code==='fee-reset'?'Fee counters reset; this result needs review':'Liquidity changed beyond the small-share model',{phase:'mark',checkedBins:model.shares.length,limitBps:PAPER_RULES.maxShareBps,bins:failures});
  let x=0n,y=0n,fx=0n,fy=0n;
  for(const s of model.shares){
    const b=bins.find(b=>b.id===s.id);if(!b)throw Error('A paper bin is missing');
    const supply=raw(b.supply),share=raw(s.share),dx=raw(b.feeX)-raw(s.feeX),dy=raw(b.feeY)-raw(s.feeY);
    if(supply===0n||share*10000n>supply*BigInt(PAPER_RULES.maxShareBps))throw Error('Liquidity changed beyond the small-share model');
    if(dx<0n||dy<0n)throw Error('Fee counters reset; this result needs review');
    x+=share*raw(b.x)/supply;y+=share*raw(b.y)/supply;
    // Same Q64 share shift and fee-counter shift as the Meteora SDK.
    fx+=((share>>64n)*dx)>>64n;fy+=((share>>64n)*dy)>>64n;
  }
  const value=(a:bigint,b:bigint)=>model.solX?Number(a)/10**model.decX+Number(b)/10**model.decY/priceYX:Number(a)/10**model.decX*priceYX+Number(b)/10**model.decY;
  const principalSol=value(x,y),feesSol=value(fx,fy);
  if(![principalSol,feesSol].every(n=>Number.isFinite(n)&&n>=0))throw Error('Paper value is not finite');
  return {x:x.toString(),y:y.toString(),fx:fx.toString(),fy:fy.toString(),principalSol,feesSol,nativeRaw:(model.solX?x+fx:y+fy).toString(),pairedRaw:(model.solX?y+fy:x+fx).toString(),priceSol:model.solX?1/priceYX:priceYX};
}
