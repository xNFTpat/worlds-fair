// Synthetic source for the real Worker devnet receipt test. No external reads.
export const STILL_MAX_PRICE_AGE_MS = 600000;
const pools = ['11111111111111111111111111111111', 'So11111111111111111111111111111111111111112'];
export async function getStillBaskets() {return [{id:'steady',name:'Steady',status:'available',legs:pools.map(poolAddress=>({poolAddress,weightBps:5000}))}];}
export async function getStillPreflight(_env,poolAddress,sizeSol) {
 if(!pools.includes(poolAddress))return null;
 const asOf=new Date().toISOString(),bins=[.75,.9].map(priceSol=>({priceSol,sol:sizeSol/2,token:0}));
 return {poolAddress,name:'SYNTHETIC/SOL',fetchedAt:asOf,sizeSol,canOpen:true,priceSol:{value:1,source:'Synthetic runtime fixture',asOf},feeRateHourly:{value:.001,source:'Synthetic runtime fixture',asOf},
  range:{shape:'BidAsk',floorPriceSol:.75,topPriceSol:.9,bins,note:'Synthetic ideal-bin model'},
  ledger:{priceSol:1,feeRateHourly:.001,entryCostsSol:null,exitCostsSol:null,transferFeeBps:null,bins}};
}
export async function getStillPoolMark(_env,poolAddress) {
 return pools.includes(poolAddress)?{poolAddress,name:'SYNTHETIC/SOL',priceSol:1,fetchedAt:new Date().toISOString(),feeRateHourly:.001,feeRateAsOf:new Date().toISOString(),source:'Synthetic runtime fixture'}:null;
}
