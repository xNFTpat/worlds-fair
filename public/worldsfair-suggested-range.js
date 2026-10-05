import {PREFLIGHT_THRESHOLDS as defaults} from './worldsfair-thresholds.js';

const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const ceilStep=value=>Math.ceil(value-1e-10*Math.max(1,Math.abs(value)));
const floorStep=value=>Math.floor(value+1e-10*Math.max(1,Math.abs(value)));
const percent=value=>(value*100).toFixed(1)+'%';

/** Pure whole-bin SOL-only suggestion. The reference is the active grid price,
 * or an explicitly estimated grid when native alignment is unavailable.
 * A one-sided ladder uses offsets -N..-1, exactly N inclusive bins.
 */
export function suggestOvernightRange(input={},config=defaults){
 const c={...defaults,...config},min=c.minFloorDistanceFraction,max=c.maxSuggestedDepthFraction,target=c.suggestedDepthFraction,limit=c.maxSuggestedBins;
 const unavailable=reason=>({status:'unavailable',reason,floorPriceSol:null,topPriceSol:null,binCount:null,alignment:'unavailable'});
 if(input.solIsBase!==undefined&&typeof input.solIsBase!=='boolean')return unavailable('The pool token orientation is unavailable. Refresh the pool before choosing a range.');
 if(!positive(input.priceSol)||!Number.isInteger(input.binStep)||input.binStep<1||input.binStep>10000)return unavailable('A current price and valid bin step are needed. Refresh the pool to get a suggestion.');
 if(!positive(min)||!positive(max)||!positive(target)||min>target||target>max||max>=1||!Number.isInteger(limit)||limit<1||limit>69)return unavailable('The overnight range settings are unavailable. Use the manual range controls.');
 const nativeFields=[input.activeBinId,input.minNativeBinId,input.maxNativeBinId],hasNative=nativeFields.some(value=>value!==undefined&&value!==null);
 if(hasNative&&(!nativeFields.every(Number.isSafeInteger)||input.minNativeBinId>input.activeBinId||input.maxNativeBinId<input.activeBinId))return unavailable('The native bin limits could not be verified. Refresh the pool or use an estimated manual range.');
 const logRatio=Math.log1p(input.binStep/10000),depth=bins=>-Math.expm1(-bins*logRatio);
 const requiredBins=Math.max(1,ceilStep(-Math.log1p(-min)/logRatio)),bandMaximumBins=floorStep(-Math.log1p(-max)/logRatio);
 const targetBins=Math.max(1,ceilStep(-Math.log1p(-target)/logRatio));
 const nativeCapacity=hasNative?(input.solIsBase?input.maxNativeBinId-input.activeBinId:input.activeBinId-input.minNativeBinId):limit;
 const maximumBins=Math.min(limit,nativeCapacity),attainableDepthFraction=depth(maximumBins),alignment=hasNative?'verified':'estimated';
 const common={shape:'BidAsk',oneSided:true,alignment,requiredBins,maximumBins,attainableDepthFraction,requestedDepthFraction:target,minimumDepthFraction:min,maximumDepthFraction:max,floorPriceSol:null,topPriceSol:null,binCount:null};
 if(maximumBins<requiredBins)return {...common,status:'infeasible',reason:'This pool needs '+requiredBins+' bins to reach '+percent(min)+' below the reference price. '+maximumBins+' available bins reach only '+percent(attainableDepthFraction)+(nativeCapacity<limit?' because of its native bin limit.':'.')+' This does not meet the overnight screen. Choose a manual range or another pool.'};
 if(bandMaximumBins<requiredBins)return {...common,status:'infeasible',reason:'This bin grid jumps from '+percent(depth(requiredBins-1))+' to '+percent(depth(requiredBins))+' below the reference price, so no whole-bin floor fits the '+percent(min)+'–'+percent(max)+' target. Choose a manual range or another pool.'};
 const binCount=Math.min(Math.max(requiredBins,targetBins),maximumBins,bandMaximumBins);
 const floorPriceSol=input.priceSol*Math.exp(-binCount*logRatio),topPriceSol=input.priceSol*Math.exp(-logRatio),actualDepthFraction=1-floorPriceSol/input.priceSol;
 if(![floorPriceSol,topPriceSol,1/floorPriceSol,1/topPriceSol].every(positive)||floorPriceSol>topPriceSol||actualDepthFraction<min-1e-12||actualDepthFraction>max+1e-12)return unavailable('A reliable range cannot be represented for this price. Use the manual range controls.');
 const nativeFloor=hasNative?input.activeBinId+(input.solIsBase?binCount:-binCount):null,nativeTop=hasNative?input.activeBinId+(input.solIsBase?1:-1):null;
 return {...common,status:'ready',binCount,floorPriceSol,topPriceSol,actualDepthFraction,lowerNativeBin:hasNative?Math.min(nativeFloor,nativeTop):null,upperNativeBin:hasNative?Math.max(nativeFloor,nativeTop):null,
  reason:'Bid-Ask · SOL only · '+binCount+' bins · floor '+percent(actualDepthFraction)+' below the reference price. Top is one bin below the reference. '+(hasNative?'Current native bin alignment.':'Estimated grid; native bin alignment is not verified.')+' This fills a paper scenario; safety checks still apply.'};
}
