export interface PriceBin {price:number; baseAmount:number; quoteAmount:number}
export interface PositionModel {
  bins:PriceBin[]; baseFees:number; quoteFees:number; quoteUsd:number;
  netCostUsd:number; currentPrice:number;
}

// At each bin's fixed price p, q + p*b is conserved as liquidity changes sides.
// Below that bin the position holds base; above it the position holds quote.
// Fees already accrued stay separate and are marked at the scenario price.
export function valueAtPrice(m:PositionModel, price:number):number {
  const principal=m.bins.reduce((sum,b)=>sum+(b.quoteAmount+b.price*b.baseAmount)*Math.min(price/b.price,1),0);
  return (principal+m.baseFees*price+m.quoteFees)*m.quoteUsd-m.netCostUsd;
}
export function estimateBreakEven(m:PositionModel) {
  if(!m.bins.length || !m.bins.every(b=>Number.isFinite(b.price)&&b.price>0&&[b.baseAmount,b.quoteAmount].every(v=>Number.isFinite(v)&&v>=0))
    || ![m.baseFees,m.quoteFees].every(v=>Number.isFinite(v)&&v>=0)
    || ![m.quoteUsd,m.currentPrice].every(v=>Number.isFinite(v)&&v>0) || !Number.isFinite(m.netCostUsd))throw new Error('Position amounts or prices are incomplete.');
  const currentPnlUsd=valueAtPrice(m,m.currentPrice);
  if(!Number.isFinite(currentPnlUsd))throw new Error('Position valuation is unavailable.');
  if(valueAtPrice(m,0)>=0)return {status:'no-loss-crossing' as const,price:null,currentPnlUsd,changePct:null};
  let low=0,high=Math.max(m.currentPrice,...m.bins.map(b=>b.price));
  // With no base-token fees, value plateaus once all liquidity is in quote.
  if(m.baseFees===0 && valueAtPrice(m,high)<0)return {status:'unreachable' as const,price:null,currentPnlUsd,changePct:null};
  for(let i=0;i<100 && valueAtPrice(m,high)<0;i++)high*=2;
  if(!Number.isFinite(high)||valueAtPrice(m,high)<0)throw new Error('Break-even price could not be bounded.');
  for(let i=0;i<100;i++){const mid=(low+high)/2;if(valueAtPrice(m,mid)<0)low=mid;else high=mid;}
  const price=(low+high)/2;
  return {status:'estimated' as const,price,currentPnlUsd,changePct:(price/m.currentPrice-1)*100};
}
