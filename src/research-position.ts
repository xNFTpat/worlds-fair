// A manual research check. These rules never create or submit a transaction.
export interface ManualPosition {
  lowerPriceSol:number; upperPriceSol:number; sizeSol:number; entryAt:string;
  entryTvlUsd?:number|null; entryPriceSol?:number|null;
}
export interface PositionObservation {
  at:string; priceSol:number|null; tvlUsd:number|null; volume4h:number|null;
  feeRateHourly:number|null;
}
export interface PositionCheckRules {
  minVolume4h:number; resetVolume4h:number; maxTvlFall:number; maxHoldHours:number;
}
export const DEFAULT_POSITION_RULES:PositionCheckRules={minVolume4h:80000,resetVolume4h:150000,maxTvlFall:.4,maxHoldHours:24};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const nonnegative=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function checkManualPosition(p:ManualPosition,o:PositionObservation,r:PositionCheckRules=DEFAULT_POSITION_RULES,now=Date.now()) {
  if(!positive(p.lowerPriceSol)||!positive(p.upperPriceSol)||p.upperPriceSol<p.lowerPriceSol||!positive(p.sizeSol)||p.sizeSol>10000)throw Error('Enter a positive size and ordered SOL-per-token bounds.');
  const entered=Date.parse(p.entryAt),read=Date.parse(o.at);
  if(!Number.isFinite(entered)||entered>now)throw Error('Entry time must be a valid past time.');
  if(!nonnegative(r.minVolume4h)||!nonnegative(r.resetVolume4h)||!positive(r.maxHoldHours)||!positive(r.maxTvlFall)||r.maxTvlFall>1)throw Error('Check the volume, liquidity-fall and hold rules.');
  const holdHours=(now-entered)/3600000;
  const fresh=Number.isFinite(read)&&read<=now+60000&&now-read<=600000;
  const tvlChange=positive(p.entryTvlUsd)&&nonnegative(o.tvlUsd)?o.tvlUsd/p.entryTvlUsd-1:null;
  const tests=[
    {rule:'Below the range floor',triggered:fresh&&positive(o.priceSol)&&o.priceSol<p.lowerPriceSol,value:o.priceSol,threshold:p.lowerPriceSol},
    {rule:'Four-hour volume below the exit rule',triggered:fresh&&nonnegative(o.volume4h)&&o.volume4h<r.minVolume4h,value:o.volume4h,threshold:r.minVolume4h},
    {rule:'Liquidity fell from the entry reading',triggered:fresh&&tvlChange!=null&&tvlChange<=-r.maxTvlFall,value:tvlChange,threshold:-r.maxTvlFall},
    {rule:'Maximum hold time reached',triggered:holdHours>=r.maxHoldHours,value:holdHours,threshold:r.maxHoldHours},
  ];
  let call:'KEEP'|'RESET'|'WITHDRAW'|'UNAVAILABLE'='KEEP',reason='No configured exit or reset rule is currently triggered.';
  const triggered=tests.find(t=>t.triggered);
  if(triggered){call='WITHDRAW';reason=triggered.rule;}
  else if(!fresh||!positive(o.priceSol)){call='UNAVAILABLE';reason='A fresh price observation is needed for this check.';}
  else if(o.priceSol>p.upperPriceSol){
    if(!nonnegative(o.volume4h)){call='UNAVAILABLE';reason='Price is above the range; current four-hour volume is missing.';}
    else if(o.volume4h>=r.resetVolume4h){call='RESET';reason='Price is above the range and four-hour volume meets the reset rule.';}
    else{call='WITHDRAW';reason='Price is above the range; activity does not meet the reset rule.';}
  }
  const missing:string[]=[];
  if(!fresh)missing.push('Current data is stale or missing.');
  if(!nonnegative(o.volume4h))missing.push('Four-hour volume is unavailable.');
  if(tvlChange==null)missing.push('Entry/current TVL is missing; the liquidity-fall rule cannot be checked.');
  if((call==='KEEP'||call==='RESET')&&missing.length){call='UNAVAILABLE';reason='Some required checks are unavailable; a keep or reset decision cannot be confirmed.';}
  return {call,reason,asOf:o.at,holdHours,rangeState:positive(o.priceSol)?o.priceSol<p.lowerPriceSol?'below':o.priceSol>p.upperPriceSol?'above':'inside':'unknown',tvlChange,tests,missing,
    estimatedFeesSol:fresh&&nonnegative(o.feeRateHourly)?p.sizeSol*o.feeRateHourly*holdHours:null,
    feeNote:'Scenario estimate at the current average pool fee rate for the whole holding time; historical fees and actual position liquidity are not measured.',
    splitNote:'Bounds and size alone do not identify actual bin balances. A range scenario can estimate the split; this check does not claim to read a real position.'};
}
