import DLMM, {getPriceOfBinByBinId, toAmountsBothSideByStrategy, type Clock, type StrategyType} from '@meteora-ag/dlmm';
import type {Mint} from '@solana/spl-token';
import Decimal from 'decimal.js';
import BN from 'bn.js';

// Prices at this boundary are always human SOL per paired token. Native bin IDs
// use raw Y/X; when SOL is X both the price and the direction must be reversed.
const D=Decimal.clone({precision:60});
export const SINGLE_TX_MAX_BINS=69;
export type DepositMode='sol-only'|'two-sided';
export interface DlmmRangeRequest {
  depositMode:DepositMode; width:number;
  lowerPriceSol:string|null; upperPriceSol:string|null;
}
export interface DlmmRangeContext {
  activeBin:number; binStep:number; minNativeBin:number; maxNativeBin:number;
  decimalsX:number; decimalsY:number; solIsX:boolean;
}
export interface ResolvedDlmmRange extends DlmmRangeContext {
  depositMode:DepositMode; source:'prices'|'legacy-width';
  lowerBin:number; upperBin:number; minDeltaId:number; maxDeltaId:number; binCount:number;
  requestedLowerPriceSol:string|null; requestedUpperPriceSol:string|null;
  lowerPriceSol:number; upperPriceSol:number; activePriceSol:number;
  priceLowerYX:number; priceUpperYX:number; alignmentNote:string;
}
const nativeId=(value:number)=>Number.isInteger(value)&&value>=-2147483648&&value<=2147483647;
const positive=(value:number)=>Number.isFinite(value)&&value>0;
function priceInput(value:unknown,label:string):string {
  if(typeof value!=='string'||value.length>128||! /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,3})?$/i.test(value.trim()))throw Error('Enter '+label+' as a positive SOL-per-token price.');
  const parsed=new D(value.trim());
  if(!parsed.isFinite()||!parsed.isPositive()||!positive(parsed.toNumber()))throw Error('Enter '+label+' as a finite positive SOL-per-token price.');
  return parsed.toString();
}
export function parseDlmmRangeRequest(body:any):DlmmRangeRequest {
  const depositMode=body.depositMode??'two-sided';
  if(depositMode!=='sol-only'&&depositMode!=='two-sided')throw Error('Choose SOL-only or two-sided deposit.');
  const hasLower=body.lowerPriceSol!==undefined&&body.lowerPriceSol!==null,hasUpper=body.upperPriceSol!==undefined&&body.upperPriceSol!==null;
  if(hasLower!==hasUpper)throw Error('Enter both lower and upper SOL-per-token prices.');
  const width=Number(body.widthPct??10);
  if(!hasLower&&(!Number.isFinite(width)||width<1||width>50))throw Error('Choose a range width between 1% and 50%.');
  const lowerPriceSol=hasLower?priceInput(body.lowerPriceSol,'the lower bound'):null,upperPriceSol=hasUpper?priceInput(body.upperPriceSol,'the upper bound'):null;
  if(lowerPriceSol!==null&&new D(lowerPriceSol).gt(upperPriceSol!))throw Error('The lower SOL-per-token price must not exceed the upper price.');
  return {depositMode,width:Number.isFinite(width)?width:10,lowerPriceSol,upperPriceSol};
}
function validateContext(context:DlmmRangeContext){
  if(!nativeId(context.activeBin)||!nativeId(context.minNativeBin)||!nativeId(context.maxNativeBin)||context.minNativeBin>context.activeBin||context.maxNativeBin<context.activeBin)throw Error('The pool native bin limits or active bin are unavailable.');
  if(!Number.isInteger(context.binStep)||context.binStep<1||context.binStep>10000)throw Error('The pool bin step is unavailable.');
  if(typeof context.solIsX!=='boolean'||![context.decimalsX,context.decimalsY].every(d=>Number.isInteger(d)&&d>=0&&d<=18)||(context.solIsX?context.decimalsX:context.decimalsY)!==9)throw Error('Verified SOL-pair token decimals are unavailable.');
}
function decimalPrices(binId:number,context:DlmmRangeContext){
  const humanYX=new D(getPriceOfBinByBinId(binId,context.binStep).toString()).mul(new D(10).pow(context.decimalsX-context.decimalsY));
  const solPrice=context.solIsX?new D(1).div(humanYX):humanYX;
  if(!positive(humanYX.toNumber())||!positive(solPrice.toNumber()))throw Error('This bin price cannot be represented in the review.');
  return {humanYX,solPrice};
}
function snapNativePrice(rawPrice:Decimal,step:number,lower:boolean){
  // A displayed 17-digit bin price can sit one floating-point ULP to either
  // side of the SDK grid. Treat only that precision-sized neighborhood as the
  // exact grid point, avoiding accidental extra bins at copy/paste boundaries.
  const nearest=new D(rawPrice.toString()).ln().div(new D(1).add(new D(step).div(10000)).ln()).round().toNumber();
  if(nativeId(nearest)){
    const grid=new D(getPriceOfBinByBinId(nearest,step).toString());
    if(new D(rawPrice.toString()).div(grid).sub(1).abs().lte('2e-15'))return nearest;
  }
  return DLMM.getBinIdFromPrice(rawPrice.toString(),step,lower);
}
export function dlmmBinPrices(binId:number,context:DlmmRangeContext){
  validateContext(context);
  if(!nativeId(binId)||binId<context.minNativeBin||binId>context.maxNativeBin)throw Error('The bin is outside this pool’s native limits.');
  const p=decimalPrices(binId,context);
  return {priceYX:p.humanYX.toNumber(),priceSol:p.solPrice.toNumber()};
}
export function resolveDlmmRange(request:DlmmRangeRequest,context:DlmmRangeContext):ResolvedDlmmRange {
  validateContext(context);
  const parsed=parseDlmmRangeRequest({depositMode:request.depositMode,widthPct:request.width,...(request.lowerPriceSol!==null||request.upperPriceSol!==null?{lowerPriceSol:request.lowerPriceSol,upperPriceSol:request.upperPriceSol}:{})});
  const active=decimalPrices(context.activeBin,context).solPrice,r=new D(1).add(new D(context.binStep).div(10000));
  let lowerBin:number,upperBin:number,requestedLowerPriceSol=parsed.lowerPriceSol,requestedUpperPriceSol=parsed.upperPriceSol;
  let alignmentNote='Requested prices snapped outwards to the pool native bin grid. Native IDs are authoritative; price fields may round when pasted into another interface.';
  const source=parsed.lowerPriceSol!==null?'prices':'legacy-width';
  if(source==='legacy-width'&&parsed.depositMode==='two-sided'){
    // Preserve the existing API's native Y/X width behavior for old callers.
    const log=Math.log1p(context.binStep/10000);
    lowerBin=context.activeBin+Math.floor(Math.log1p(-parsed.width/100)/log);
    upperBin=context.activeBin+Math.ceil(Math.log1p(parsed.width/100)/log);
    alignmentNote='Legacy width is symmetric in native Y/X price, then snapped outwards. The displayed SOL-per-token bounds reflect the actual token orientation.';
  }else{
    if(source==='legacy-width'){
      requestedLowerPriceSol=active.mul(new D(1).sub(new D(parsed.width).div(100))).toString();
      requestedUpperPriceSol=active.div(r).toString();
    }
    const lower=new D(requestedLowerPriceSol!),upper=new D(requestedUpperPriceSol!);
    if(parsed.depositMode==='sol-only'&&!upper.lt(active))throw Error('A SOL-only range must be below the active SOL-per-token price.');
    const shift=new D(10).pow(context.decimalsY-context.decimalsX);
    const rawLower=(context.solIsX?new D(1).div(upper):lower).mul(shift);
    const rawUpper=(context.solIsX?new D(1).div(lower):upper).mul(shift);
    lowerBin=snapNativePrice(rawLower,context.binStep,true);
    upperBin=snapNativePrice(rawUpper,context.binStep,false);
    if(parsed.depositMode==='sol-only'){
      // The nearest endpoint is aligned inward when outward snapping would
      // include active. This deliberate one-bin adjustment avoids paired-token
      // funding and is disclosed alongside the aligned reviewed bounds.
      if(context.solIsX)lowerBin=Math.max(lowerBin,context.activeBin+1);
      else upperBin=Math.min(upperBin,context.activeBin-1);
      alignmentNote='Floor snapped outwards; top aligned to a SOL-only bin below active. Active bin is excluded. Native IDs are authoritative.';
      if(source==='legacy-width'){
        if(context.solIsX)lowerBin=context.activeBin+1;
        else upperBin=context.activeBin-1;
      }
    }
  }
  if(!nativeId(lowerBin)||!nativeId(upperBin)||lowerBin>upperBin)throw Error('These prices do not produce a usable native bin range.');
  if(lowerBin<context.minNativeBin||upperBin>context.maxNativeBin)throw Error('This range exceeds the pool’s native bin limits.');
  const binCount=upperBin-lowerBin+1;
  if(binCount>SINGLE_TX_MAX_BINS)throw Error('This range needs '+binCount+' bins. Narrow it to at most 69 bins for this single-transaction setup.');
  if(parsed.depositMode==='two-sided'&&!(lowerBin<context.activeBin&&upperBin>context.activeBin))throw Error('A two-sided range must extend below and above the active bin.');
  const low=decimalPrices(lowerBin,context),high=decimalPrices(upperBin,context);
  return {...context,depositMode:parsed.depositMode,source,lowerBin,upperBin,minDeltaId:lowerBin-context.activeBin,maxDeltaId:upperBin-context.activeBin,binCount,requestedLowerPriceSol,requestedUpperPriceSol,lowerPriceSol:(context.solIsX?high:low).solPrice.toNumber(),upperPriceSol:(context.solIsX?low:high).solPrice.toNumber(),activePriceSol:active.toNumber(),priceLowerYX:low.humanYX.toNumber(),priceUpperYX:high.humanYX.toNumber(),alignmentNote};
}

export interface RawAllocationBin {binId:number;amountXRaw:string;amountYRaw:string;positionShareRaw?:string;supplyRaw?:string}
export interface DlmmAllocation {
  status:'simulated'|'expected'; source:string; assumption:string; reviewPriceSol:number;
  bins:(RawAllocationBin&{priceSol:number;priceYX:number;solRaw:string;pairedRaw:string;valueSolAtReview:number})[];
  totalXRaw:string;totalYRaw:string;solRaw:string;pairedRaw:string;valueSolAtReview:number;
}
// Only absence of returned per-bin RPC evidence permits an expected fallback.
// Present but malformed identities, shares or reserves must fail the review.
export class IncompleteDlmmAllocationEvidence extends Error {}
export function allocationFromSimulationEvidence(expected:DlmmAllocation,derive:()=>DlmmAllocation):DlmmAllocation {
  try{
    const actual=derive();
    if(actual.totalXRaw==='0'&&actual.totalYRaw==='0')throw Error('The simulated position contains no principal.');
    return actual;
  }catch(error){
    if(!(error instanceof IncompleteDlmmAllocationEvidence))throw error;
    return {...expected,assumption:expected.assumption+' Per-bin simulation accounts were not returned; the chart uses expected SDK amounts.'};
  }
}
function rawAmount(value:string,label:string):bigint {
  if(typeof value!=='string'||!/^\d+$/.test(value)||value.length>80)throw Error(label+' must be a non-negative raw integer amount.');
  return BigInt(value);
}
export function formatDlmmAllocation(bins:RawAllocationBin[],range:ResolvedDlmmRange,status:DlmmAllocation['status'],assumption:string,reviewPriceSol=range.activePriceSol):DlmmAllocation {
  if(!positive(reviewPriceSol)||bins.length!==range.binCount)throw Error('Per-bin allocation is incomplete.');
  const seen=new Set<number>();let totalX=0n,totalY=0n;
  const priced=bins.map(bin=>{
    if(!nativeId(bin.binId)||bin.binId<range.lowerBin||bin.binId>range.upperBin||seen.has(bin.binId))throw Error('Per-bin allocation does not match the reviewed range.');
    seen.add(bin.binId);
    const x=rawAmount(bin.amountXRaw,'Token X'),y=rawAmount(bin.amountYRaw,'Token Y');totalX+=x;totalY+=y;
    const native=range.solIsX?x:y,paired=range.solIsX?y:x,pairedDecimals=range.solIsX?range.decimalsY:range.decimalsX;
    const value=new D(native.toString()).div(1e9).add(new D(paired.toString()).div(new D(10).pow(pairedDecimals)).mul(reviewPriceSol)).toNumber();
    if(!Number.isFinite(value)||value<0)throw Error('Per-bin value cannot be represented in the review.');
    return {...bin,...dlmmBinPrices(bin.binId,range),solRaw:native.toString(),pairedRaw:paired.toString(),valueSolAtReview:value};
  }).sort((a,b)=>a.priceSol-b.priceSol);
  return {status,source:status==='simulated'?'Simulated position shares and bin reserves':'Meteora SDK expected allocation',assumption,reviewPriceSol,bins:priced,totalXRaw:totalX.toString(),totalYRaw:totalY.toString(),solRaw:(range.solIsX?totalX:totalY).toString(),pairedRaw:(range.solIsX?totalY:totalX).toString(),valueSolAtReview:priced.reduce((sum,bin)=>sum+bin.valueSolAtReview,0)};
}
export function expectedDlmmAllocation(input:{range:ResolvedDlmmRange;strategy:StrategyType;amountXRaw:string;amountYRaw:string;activeXRaw:string;activeYRaw:string;mintX:Mint;mintY:Mint;clock:Clock}):DlmmAllocation {
  const {range}=input,x=rawAmount(input.amountXRaw,'Token X'),y=rawAmount(input.amountYRaw,'Token Y');
  if(![0,1,2].includes(input.strategy))throw Error('Unknown DLMM strategy.');
  if(range.depositMode==='sol-only'&&(range.solIsX?y:x)!==0n)throw Error('A SOL-only allocation cannot fund paired tokens.');
  const raw=toAmountsBothSideByStrategy(range.activeBin,range.binStep,range.lowerBin,range.upperBin,new BN(x.toString()),new BN(y.toString()),new BN(rawAmount(input.activeXRaw,'Active X').toString()),new BN(rawAmount(input.activeYRaw,'Active Y').toString()),input.strategy,input.mintX,input.mintY,input.clock);
  const result=formatDlmmAllocation(raw.map(bin=>({binId:bin.binId,amountXRaw:bin.amountX.toString(),amountYRaw:bin.amountY.toString()})),range,'expected','SDK allocation at the initially read active bin, after current-epoch deposit transfer fees and integer rounding. A funding swap can move the active bin; these are expected amounts, not measured simulated principal. Capital values use the initial active-bin price. Excludes fees, rent and unspent wallet tokens.');
  if(BigInt(result.totalXRaw)>x||BigInt(result.totalYRaw)>y)throw Error('Expected allocation exceeds its supplied raw token amounts.');
  if(result.totalXRaw==='0'&&result.totalYRaw==='0')throw Error('The budget is too small to allocate principal across this range.');
  return result;
}
export function simulatedDlmmAllocation(input:{range:ResolvedDlmmRange;sharesRaw:string[];bins:{binId:number;amountXRaw:string;amountYRaw:string;supplyRaw:string}[];reviewPriceSol?:number}):DlmmAllocation {
  if(input.sharesRaw.length<input.range.binCount||input.bins.length!==input.range.binCount)throw Error('Simulated per-bin shares or reserves are incomplete.');
  const byId=new Map(input.bins.map(bin=>[bin.binId,bin]));
  if(byId.size!==input.range.binCount)throw Error('Simulated bin reserves contain duplicate IDs.');
  const amounts:RawAllocationBin[]=[];
  for(let i=0;i<input.range.binCount;i++){
    const binId=input.range.lowerBin+i,bin=byId.get(binId);if(!bin)throw Error('Simulated reserves do not cover the reviewed range.');
    const share=rawAmount(input.sharesRaw[i],'Position share'),supply=rawAmount(bin.supplyRaw,'Bin supply'),x=rawAmount(bin.amountXRaw,'Bin X'),y=rawAmount(bin.amountYRaw,'Bin Y');
    if(share>supply)throw Error('Simulated position share exceeds bin supply.');
    amounts.push({binId,amountXRaw:(supply===0n?0n:share*x/supply).toString(),amountYRaw:(supply===0n?0n:share*y/supply).toString(),positionShareRaw:share.toString(),supplyRaw:supply.toString()});
  }
  return formatDlmmAllocation(amounts,input.range,'simulated','Principal derived from the returned simulated position shares and bin reserves, rounded down to raw units. Capital values use the simulated active-bin price. Excludes accrued fees, rent and unspent wallet tokens; execution state and future fills may change.',input.reviewPriceSol);
}
