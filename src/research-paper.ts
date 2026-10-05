import {buildResearchRange, inventoryAtPrice, type ResearchRangeBin, type ResearchRangeShape} from './research-range';

export interface ResearchObservation {
  at: string | number;
  priceSol: number;
  tvlUsd: number | null;
  fees1h: number | null;
  volume4h: number | null;
  mintAuthority?: boolean | null;
  freezeAuthority?: boolean | null;
}
export interface ResearchBotConfig {
  id: string;
  name: string;
  minTvl: number;
  minVolume4h: number;
  minFeeRateHourly: number;
  noMintAuthority: boolean;
  noFreezeAuthority: boolean;
  shape: ResearchRangeShape;
  oneSided: boolean;
  floorLookbackHours: number;
  minimumLookbackHours?: number;
  maxHoldHours: number;
  exitVolume4h: number;
  resetVolume4h: number;
  maxTvlFall: number;
  rangeDepthFraction?: number;
  maxWidth?: number;
  fixedBinCount?: number;
  maxRangeBins?: number;
  maxSourceGapMinutes?: number;
  signal: 'breakout' | 'floor' | 'chop';
  rules?: string[];
}
export interface ResearchCostAssumption {
  fundingCostFraction?: number | null;
  exitCostFraction?: number | null;
  /** Total estimated entry+exit network cost; split equally between legs. */
  networkSol?: number | null;
  /** Additional refundable capital reserved at entry and returned at exit. */
  positionRentSol?: number | null;
  fundingCostIncludesTransferFee?: boolean;
  exitCostIncludesTransferFee?: boolean;
  label?: string;
}
export interface ResearchReplayInput {
  observations: readonly ResearchObservation[];
  config: ResearchBotConfig;
  sizeSol?: number;
  binStep: number;
  seedSol?: number;
  costAssumption?: ResearchCostAssumption | null;
  transferFeeBps?: number | null;
  transferFeeMaximumRaw?: string | null;
  pairedDecimals?: number;
  solIsBase?: boolean;
  feeMode?: 'measured' | 'constant-current-conditions';
}
export interface ResearchDecision {
  at: string;
  action: 'entry' | 'exit' | 'skip' | 'hold';
  reason: string;
  numbers: {priceSol: number; tvlUsd: number | null; volume4h: number | null; feeRateHourly: number | null;
    cashSol: number | null; lowerPriceSol?: number; upperPriceSol?: number; heldHours?: number};
}

export const starterResearchBots: ResearchBotConfig[] = [
  {id:'overnight-floor',name:'Overnight Bid-Ask Floor',minTvl:25_000,minVolume4h:150_000,minFeeRateHourly:.001,
    noMintAuthority:true,noFreezeAuthority:true,shape:'BidAsk',oneSided:true,floorLookbackHours:24,maxHoldHours:12,
    exitVolume4h:80_000,resetVolume4h:150_000,maxTvlFall:.4,maxRangeBins:69,maxSourceGapMinutes:30,signal:'floor',
    rules:['Require TVL ≥ $25k, measured 4h volume ≥ $150k, hourly fees/TVL ≥ 0.1%, and known inactive mint/freeze authorities.',
      'After 24 hours of contiguous observations, bid SOL from one bin below active to one bin below the observed 24h low.',
      'Withdraw below the floor, below $80k 4h volume, after a 40% TVL fall, or after 12 hours. Above range withdraw all SOL; reset is eligible at $150k volume.']},
  {id:'breakout-chaser',name:'Breakout Chaser',minTvl:25_000,minVolume4h:150_000,minFeeRateHourly:.001,
    noMintAuthority:true,noFreezeAuthority:true,shape:'Spot',oneSided:false,floorLookbackHours:.5,maxHoldHours:1/6,
    exitVolume4h:80_000,resetVolume4h:150_000,maxTvlFall:.4,fixedBinCount:9,maxRangeBins:69,maxSourceGapMinutes:10,signal:'breakout',
    rules:['Require the same liquidity, fee and authority evidence as Overnight, and a close above the preceding 30-minute observed high.',
      'Use a 9-bin two-sided Spot range around the entry price. This monitored-session experiment holds at most 10 minutes.',
      'Withdraw below/above range, below $80k volume, after a 40% TVL fall, or at the first observed close after 10 minutes. Sampling slower than the hold limit is unsupported.']},
  {id:'chop-farmer',name:'Chop Farmer',minTvl:25_000,minVolume4h:150_000,minFeeRateHourly:.0005,
    noMintAuthority:true,noFreezeAuthority:true,shape:'Spot',oneSided:false,floorLookbackHours:4,maxHoldHours:4,
    exitVolume4h:80_000,resetVolume4h:150_000,maxTvlFall:.4,maxWidth:.1,fixedBinCount:9,maxRangeBins:69,maxSourceGapMinutes:30,signal:'chop',
    rules:['Require TVL ≥ $25k, 4h volume ≥ $150k, hourly fees/TVL ≥ 0.05%, and known inactive authorities.',
      'Require 4 hours of contiguous observed prices inside a 10% band, then deploy a 9-bin two-sided Spot range.',
      'Withdraw outside range, below $80k volume, after a 40% TVL fall, or after 4 hours.']},
];

function number(v: number, name: string, minimum = 0, maximum = Infinity) {
  if (!Number.isFinite(v) || v < minimum || v > maximum) throw new RangeError(`${name} must be finite between ${minimum} and ${maximum}`);
  return v;
}
function nullable(v: number | null | undefined, name: string, maximum = Infinity) {
  return v == null ? null : number(v,name,0,maximum);
}
function monetaryTolerance(a:number,b:number,operations=8){
  // Bound arithmetic noise by the operations and SOL scale, then cap below one
  // tenth of a lamport so an actual one-lamport outcome is never rounded away.
  return Math.min(1e-10,Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*operations);
}
function tax(amount: number, bps: number | null, maximumRaw: string | null | undefined, decimals: number | undefined) {
  if (amount === 0 || bps === 0) return {net:amount,fee:0,known:true};
  if (bps === null) return {net:amount,fee:0,known:false};
  if (decimals === undefined) {
    const fee=amount*bps/10000;
    return {net:amount-fee,fee,known:true};
  }
  // BigInt(Number) would first lose raw-unit precision; parse the decimal
  // representation before applying SPL ceiling and the per-transfer cap.
  const [mantissa,exp='0']=amount.toString().toLowerCase().split('e');
  const [whole,fraction='']=mantissa.split('.');
  const shift=Number(exp)+decimals-fraction.length,digits=BigInt(whole+fraction);
  const raw=shift>=0?digits*10n**BigInt(shift):digits/10n**BigInt(-shift);
  const proportional=(raw*BigInt(bps)+9999n)/10000n;
  const cap=maximumRaw==null?null:BigInt(maximumRaw);
  const feeRaw=cap!==null&&cap<proportional?cap:proportional;
  return {net:Number(raw-feeRaw)/10**decimals,fee:Number(feeRaw)/10**decimals,known:true};
}

/** Independently funded, observation-close research replay; no fleet mutation. */
export function runResearchReplay(input: ResearchReplayInput) {
  const config={...input.config};
  if (!config.name || !config.id) throw new RangeError('Config id and name are required');
  for (const k of ['minTvl','minVolume4h','minFeeRateHourly','exitVolume4h','resetVolume4h'] as const) number(config[k],`config.${k}`);
  for (const k of ['floorLookbackHours','maxHoldHours'] as const) number(config[k],`config.${k}`,Number.EPSILON,720);
  number(config.maxTvlFall,'config.maxTvlFall',0,1);
  const minimumLookbackHours=number(config.minimumLookbackHours??config.floorLookbackHours,'config.minimumLookbackHours',Number.EPSILON,config.floorLookbackHours);
  const maxGapMs=number(config.maxSourceGapMinutes??30,'config.maxSourceGapMinutes',Number.EPSILON,1440)*60_000;
  const maxRangeBins=number(config.maxRangeBins??69,'config.maxRangeBins',1,1400);
  if (!Number.isInteger(maxRangeBins)) throw new RangeError('config.maxRangeBins must be an integer');
  if (!['floor','breakout','chop'].includes(config.signal)) throw new RangeError('Unsupported entry signal');
  if (!['Spot','BidAsk','Curve'].includes(config.shape)) throw new RangeError('Unsupported range shape');
  if (typeof config.oneSided!=='boolean'||typeof config.noMintAuthority!=='boolean'||typeof config.noFreezeAuthority!=='boolean') throw new RangeError('Config sides and authority rules must be boolean');
  if(config.rangeDepthFraction!==undefined)number(config.rangeDepthFraction,'config.rangeDepthFraction',Number.EPSILON,.99);
  if(config.maxWidth!==undefined)number(config.maxWidth,'config.maxWidth',Number.EPSILON,1);
  if(config.fixedBinCount!==undefined&&(!Number.isInteger(config.fixedBinCount)||config.fixedBinCount<1||config.fixedBinCount>1400||(!config.oneSided&&(config.fixedBinCount<3||config.fixedBinCount%2!==1))))throw new RangeError('fixedBinCount must be an integer; two-sided requires an odd count of at least 3');
  const sizeSol=number(input.sizeSol??.5,'sizeSol',Number.EPSILON,1_000_000);
  const seedSol=number(input.seedSol??10,'seedSol',Number.EPSILON,1_000_000);
  const binStep=number(input.binStep,'binStep',Number.EPSILON,10_000);
  const feeMode=input.feeMode??'measured';
  if(feeMode!=='measured'&&feeMode!=='constant-current-conditions')throw new RangeError('Unsupported fee mode');
  if(input.observations.length>20_000)throw new RangeError('Replay is bounded to 20,000 observations');
  const observations=input.observations.map(o=>{
    const time=typeof o.at==='number'?o.at:Date.parse(o.at);
    if(!Number.isFinite(time)||!Number.isFinite(new Date(time).getTime()))throw new RangeError('Observation at must be an ISO date or epoch milliseconds');
    number(o.priceSol,'observation.priceSol',Number.EPSILON);
    nullable(o.tvlUsd,'observation.tvlUsd');nullable(o.fees1h,'observation.fees1h');nullable(o.volume4h,'observation.volume4h');
    for(const k of ['mintAuthority','freezeAuthority'] as const)if(o[k]!=null&&typeof o[k]!=='boolean')throw new RangeError(`observation.${k} must be boolean or null`);
    return {...o,tvlUsd:o.tvlUsd??null,fees1h:o.fees1h??null,volume4h:o.volume4h??null,time,at:new Date(time).toISOString()};
  });
  for(let i=1;i<observations.length;i++)if(observations[i].time<=observations[i-1].time)throw new RangeError('Observations must be strictly chronological with no duplicate dates');
  const costs=input.costAssumption;
  const fundingCostFraction=nullable(costs?.fundingCostFraction,'fundingCostFraction',1);
  const exitCostFraction=nullable(costs?.exitCostFraction,'exitCostFraction',1);
  const networkSol=nullable(costs?.networkSol,'networkSol',1_000_000);
  const positionRentSol=nullable(costs?.positionRentSol,'positionRentSol',1_000_000);
  const bps=input.transferFeeBps??null;
  if(bps!==null&&(!Number.isInteger(bps)||bps<0||bps>10000))throw new RangeError('transferFeeBps must be an integer between 0 and 10,000');
  if(input.pairedDecimals!==undefined&&(!Number.isInteger(input.pairedDecimals)||input.pairedDecimals<0||input.pairedDecimals>18))throw new RangeError('pairedDecimals must be an integer from 0 to 18');
  if(input.transferFeeMaximumRaw!=null&&(typeof input.transferFeeMaximumRaw!=='string'||!/^\d{1,78}$/.test(input.transferFeeMaximumRaw)||input.pairedDecimals===undefined))throw new RangeError('A raw transfer-fee cap requires an integer string and pairedDecimals');
  const decisions:ResearchDecision[]=[];
  const trades:ReturnType<typeof closeTrade>[]=[];
  const equityCurve:{at:string;equitySol:number|null;grossEquitySol:number;cashSol:number|null}[]=[];
  const warnings:string[]=[];
  const label=feeMode==='measured'?'Measured observation-close research replay':'Constant current conditions scenario on observed closes';
  const assumptions=[
    'This is an independently funded replay, not a restart of existing bots or a reconciliation of their wallets.',
    'Fills use observed closing prices and conserved fixed-price bin inventory. Intrabar highs/lows, partial active-bin fills, and the timing of unobserved crossings are unavailable.',
    'Fees use the preceding observed hourly fees/TVL rate times deployed SOL. Accrual requires both endpoint prices in range and an interval within the configured source gap. No concentrated fee uplift is assumed.',
    'Rolling one-hour fee snapshots approximate interval fee density; they are not bin-level historical fee records. No fees from before entry are credited.',
    'Costs and transfer policies are explicit current/user assumptions held constant through history, not historical executable quotes. Fee earnings are assumed SOL and taxed token fee claims are not modelled separately.',
    'Rent is additional locked capital returned on withdrawal. Network estimates are split equally between entry and exit; capital with unresolved liquidation is not reused.',
    feeMode==='measured'?'Entry filters use only their dated observation and earlier contiguous observations.':'Fee, volume and TVL inputs are scenario conditions, not reconstructed historical evidence. Results must not be described as measured strategy performance.',
  ];
  if(!costs)warnings.push('No explicit cost assumption: net results are unavailable.');
  if(bps===null)warnings.push('Paired-token tax policy unavailable: token liquidation cannot be scored net.');
  if(bps!==null&&bps>0&&input.transferFeeMaximumRaw==null)warnings.push('Missing transfer-fee cap uses an uncapped proportional upper estimate.');
  type Position={entryAt:string;entryTime:number;entryPriceSol:number;entryTvlUsd:number;entryVolume4h:number;entryFeeRateHourly:number;
    lowerPriceSol:number;upperPriceSol:number;bins:ResearchRangeBin[];fundingCostSol:number|null;depositTaxSol:number|null;
    entryNetworkSol:number|null;rentSol:number|null;cashBeforeEntrySol:number|null;feeBasisSol:number;feesSol:number;inRangeHours:number;uncreditedHours:number;observations:number};
  let position:Position|null=null;
  let cashSol:number|null=seedSol;
  let grossCashSol=seedSol;
  const rate=(o:typeof observations[number])=>o.tvlUsd!==null&&o.tvlUsd>0&&o.fees1h!==null?o.fees1h/o.tvlUsd:null;
  const inRange=(p:Position,price:number)=>price>=p.lowerPriceSol&&price<=p.upperPriceSol;
  const decision=(o:typeof observations[number],action:ResearchDecision['action'],reason:string,p:Position|null=position)=>decisions.push({at:o.at,action,reason,numbers:{priceSol:o.priceSol,tvlUsd:o.tvlUsd,volume4h:o.volume4h,feeRateHourly:rate(o),cashSol,
    ...(p?{lowerPriceSol:p.lowerPriceSol,upperPriceSol:p.upperPriceSol,heldHours:(o.time-p.entryTime)/3_600_000}:{})}});
  function mark(p:Position,o:typeof observations[number]){
    const inventory=inventoryAtPrice(p.bins,o.priceSol);
    const withdrawal=tax(inventory.tokens,bps,input.transferFeeMaximumRaw,input.pairedDecimals);
    const saleTax=costs?.exitCostIncludesTransferFee===false?tax(withdrawal.net,bps,input.transferFeeMaximumRaw,input.pairedDecimals):{net:withdrawal.net,fee:0,known:true};
    const reasons:string[]=[];
    if(p.fundingCostSol===null)reasons.push('Entry funding cost unavailable');
    if(bps===null||p.depositTaxSol===null||!withdrawal.known||!saleTax.known)reasons.push('Token transfer tax unavailable');
    if(exitCostFraction===null&&saleTax.net>0)reasons.push('Exit quote cost unavailable');
    if(networkSol===null)reasons.push('Network cost unavailable');
    if(positionRentSol===null)reasons.push('Refundable rent requirement unavailable');
    const quoteLossSol=saleTax.net===0?0:exitCostFraction===null?null:saleTax.net*o.priceSol*exitCostFraction;
    const netLiquidationSol=reasons.length===0?inventory.sol+saleTax.net*o.priceSol*(1-(exitCostFraction??0))+p.feesSol:null;
    const grossLiquidationSol=inventory.valueSol+p.feesSol;
    return {inventory,withdrawalTaxSol:withdrawal.known?withdrawal.fee*o.priceSol:null,saleTaxSol:saleTax.known?saleTax.fee*o.priceSol:null,
      quoteLossSol,netLiquidationSol,grossLiquidationSol,unavailableReasons:reasons};
  }
  function closeTrade(p:Position,o:typeof observations[number],reason:string){
    const m=mark(p,o),exitNetworkSol=networkSol===null?null:networkSol/2;
    const rawPrincipalChange=m.inventory.valueSol-sizeSol;
    const principalChange=p.fundingCostSol===0&&p.depositTaxSol===0&&Math.abs(rawPrincipalChange)<=monetaryTolerance(m.inventory.valueSol,sizeSol,p.bins.length+8)?0:rawPrincipalChange;
    // Normalize only conserved principal arithmetic. Add actual fees and charge
    // each known cost separately, so even a small declared flow remains real.
    const pnlSol=m.netLiquidationSol===null||networkSol===null?null:principalChange+p.feesSol-m.withdrawalTaxSol!-m.saleTaxSol!-m.quoteLossSol!-networkSol;
    const result={entryAt:p.entryAt,exitAt:o.at,entryPriceSol:p.entryPriceSol,exitPriceSol:o.priceSol,entryTvlUsd:p.entryTvlUsd,
      lowerPriceSol:p.lowerPriceSol,upperPriceSol:p.upperPriceSol,sizeSol,reason,holdHours:(o.time-p.entryTime)/3_600_000,
      observedInRangeHours:p.inRangeHours,uncreditedHours:p.uncreditedHours,feesSol:p.feesSol,fundingCostSol:p.fundingCostSol,
      depositTaxSol:p.depositTaxSol,withdrawalTaxSol:m.withdrawalTaxSol,saleTaxSol:m.saleTaxSol,quoteLossSol:m.quoteLossSol,
      networkSol,rentReturnedSol:p.rentSol,exitNetworkSol,principalSol:m.inventory.sol,pairedTokens:m.inventory.tokens,
      grossLiquidationSol:m.grossLiquidationSol,netLiquidationSol:m.netLiquidationSol,pnlSol,vsHoldingSol:pnlSol,
      unavailableReasons:m.unavailableReasons};
    grossCashSol+=m.grossLiquidationSol+(p.rentSol??0)-(exitNetworkSol??0);
    // Reconcile a valued close to the same P&L used for scoring, rather than
    // accumulating cancellation noise through separate rent/cash operations.
    if(cashSol!==null&&p.cashBeforeEntrySol!==null&&pnlSol!==null&&exitNetworkSol!==null&&p.rentSol!==null)cashSol=p.cashBeforeEntrySol+pnlSol;
    else cashSol=null;
    return result;
  }
  function score(){
    const scored=trades.filter(t=>t.pnlSol!==null),unresolved=trades.filter(t=>t.pnlSol===null);
    const scoredClosedPnlSol=scored.reduce((s,t)=>s+t.pnlSol!,0);
    let peak=seedSol,worstDrawdown=0,worstDrawdownSol=0;
    for(const e of equityCurve)if(e.equitySol!==null){peak=Math.max(peak,e.equitySol);worstDrawdown=Math.max(worstDrawdown,(peak-e.equitySol)/peak);worstDrawdownSol=Math.max(worstDrawdownSol,peak-e.equitySol);}
    const unknownEquity=equityCurve.some(e=>e.equitySol===null);
    return {netPnlSol:unresolved.length?null:scoredClosedPnlSol,vsHoldingSol:unresolved.length?null:scoredClosedPnlSol,
      scoredClosedPnlSol,tradeCount:trades.length,scoredTrades:scored.length,unresolvedTrades:unresolved.length,
      winRate:scored.length?scored.filter(t=>t.pnlSol!>0).length/scored.length:null,
      averageObservedInRangeHours:trades.length?trades.reduce((s,t)=>s+t.observedInRangeHours,0)/trades.length:null,
      worstDrawdown:unresolved.length||cashSol===null||unknownEquity?null:worstDrawdown,worstDrawdownSol:unresolved.length||cashSol===null||unknownEquity?null:worstDrawdownSol,
      seedSol,cashSol,grossCashSol,openPositions:position?1:0};
  }
  const intervals=observations.slice(1).map((o,i)=>o.time-observations[i].time).sort((a,b)=>a-b);
  const medianCadenceMs=intervals.length?intervals[Math.floor(intervals.length/2)]:null;
  if(medianCadenceMs!==null&&medianCadenceMs>config.maxHoldHours*3_600_000+1){
    warnings.push(`Observed cadence ${(medianCadenceMs/60_000).toFixed(1)} minutes exceeds ${config.name}'s ${config.maxHoldHours*60} minute maximum hold; this replay is unavailable.`);
    return {status:'unavailable' as const,label,config,feeMode,scoreboard:{...score(),netPnlSol:null,vsHoldingSol:null,worstDrawdown:null,worstDrawdownSol:null},trades,openPosition:null,unresolved:[],decisions,equityCurve,assumptions,warnings,medianCadenceMinutes:medianCadenceMs/60_000};
  }
  for(let i=0;i<observations.length;i++){
    const o=observations[i],previous=observations[i-1];
    if(position){
      if(previous){
        const hours=(o.time-previous.time)/3_600_000,priorRate=rate(previous);
        if(o.time-previous.time<=maxGapMs&&inRange(position,previous.priceSol)&&inRange(position,o.priceSol)&&priorRate!==null){
          position.inRangeHours+=hours;position.feesSol+=position.feeBasisSol*priorRate*hours;
        }else position.uncreditedHours+=hours;
      }
      position.observations++;
      let exitReason:string|null=null;
      if(o.priceSol<position.lowerPriceSol)exitReason='Price below range floor';
      else if(o.tvlUsd!==null&&o.tvlUsd<=position.entryTvlUsd*(1-config.maxTvlFall))exitReason=`TVL fell at least ${(config.maxTvlFall*100).toFixed(0)}% from entry`;
      else if(o.volume4h!==null&&o.volume4h<config.exitVolume4h)exitReason=`4h volume below $${config.exitVolume4h}`;
      else if(o.priceSol>position.upperPriceSol)exitReason=o.volume4h!==null&&o.volume4h>=config.resetVolume4h?'Price above range: all SOL; reset eligible':'Price above range: all SOL; withdraw';
      else if(o.time-position.entryTime>=config.maxHoldHours*3_600_000-1)exitReason='Maximum hold time reached at observed close';
      if(exitReason){decision(o,'exit',exitReason);trades.push(closeTrade(position,o,exitReason));position=null;}
      else decision(o,'hold',o.tvlUsd===null||o.volume4h===null?'No observed price exit; volume/TVL exit evidence incomplete':'Within range and observed exit rules not triggered');
    }else{
      const reasons:string[]=[];
      const currentRate=rate(o);
      if(cashSol===null)reasons.push('Unresolved capital cannot fund another position');
      else {const required=sizeSol+(networkSol??0)/2+(positionRentSol??0);if(cashSol<required&&required-cashSol>monetaryTolerance(cashSol,required))reasons.push('Insufficient independently funded cash including rent/network reserve');}
      if(o.tvlUsd===null)reasons.push('TVL unavailable');else if(o.tvlUsd<config.minTvl)reasons.push(`TVL below $${config.minTvl}`);
      if(o.volume4h===null)reasons.push('4h volume unavailable');else if(o.volume4h<config.minVolume4h)reasons.push(`4h volume below $${config.minVolume4h}`);
      if(currentRate===null)reasons.push('Hourly fee density unavailable');else if(currentRate<config.minFeeRateHourly)reasons.push(`Hourly fee density below ${config.minFeeRateHourly}`);
      if(config.noMintAuthority&&o.mintAuthority!==false)reasons.push(o.mintAuthority===true?'Mint authority active':'Mint authority evidence unavailable');
      if(config.noFreezeAuthority&&o.freezeAuthority!==false)reasons.push(o.freezeAuthority===true?'Freeze authority active':'Freeze authority evidence unavailable');
      const cutoff=o.time-config.floorLookbackHours*3_600_000;
      const prior=observations.slice(0,i);
      const beforeCutoff=prior.filter(p=>p.time<cutoff).at(-1);
      const past=prior.filter(p=>p.time>=cutoff);
      if(beforeCutoff&&cutoff-beforeCutoff.time<=maxGapMs)past.unshift(beforeCutoff);
      const requiredCutoff=o.time-minimumLookbackHours*3_600_000;
      const warm=past.length>0&&past[0].time<=requiredCutoff+1&&previous!==undefined&&o.time-previous.time<=maxGapMs&&past.every((p,j)=>j===0||p.time-past[j-1].time<=maxGapMs);
      if(!warm)reasons.push(`Waiting for ${minimumLookbackHours}h of contiguous prior observations`);
      if(warm&&config.signal==='breakout'&&o.priceSol<=Math.max(...past.map(p=>p.priceSol)))reasons.push('No close above prior observed high');
      if(warm&&config.signal==='chop'){
        const prices=[...past.map(p=>p.priceSol),o.priceSol];
        if(Math.max(...prices)/Math.min(...prices)-1>(config.maxWidth??.1))reasons.push('Observed lookback price band too wide for Chop');
      }
      if(reasons.length){decision(o,'skip',reasons.join('; '));}
      else{
        const r=1+binStep/10000;
        const steps=config.fixedBinCount!==undefined?(config.oneSided?config.fixedBinCount:(config.fixedBinCount-1)/2):null;
        let floor=config.signal==='floor'?Math.min(o.priceSol,...past.map(p=>p.priceSol))/r:o.priceSol*(1-(config.rangeDepthFraction??.02));
        if(steps!==null)floor=o.priceSol/r**Math.max(1,steps);
        try{
          const built=buildResearchRange({sizeSol,priceSol:o.priceSol,floorPriceSol:floor,binStep,shape:config.shape,oneSided:config.oneSided,
            solIsBase:input.solIsBase,feeRateHourly:currentRate,exitCostFraction,fundingCostFraction,
            exitCostIncludesTransferFee:costs?.exitCostIncludesTransferFee,fundingCostIncludesTransferFee:costs?.fundingCostIncludesTransferFee,
            transferFeeBps:bps,transferFeeMaximumRaw:input.transferFeeMaximumRaw,pairedDecimals:input.pairedDecimals,networkSol:networkSol??0,positionRentSol:positionRentSol??0,maxSetupBins:maxRangeBins});
          if(built.binCount>maxRangeBins){decision(o,'skip',`Range needs ${built.binCount} bins, exceeding configured ${maxRangeBins}`);}
          else{
            const entryNetworkSol=networkSol===null?null:networkSol/2;
            position={entryAt:o.at,entryTime:o.time,entryPriceSol:o.priceSol,entryTvlUsd:o.tvlUsd!,entryVolume4h:o.volume4h!,entryFeeRateHourly:currentRate!,
              lowerPriceSol:built.bottomPriceSol,upperPriceSol:built.topPriceSol,bins:built.selected.bins,fundingCostSol:built.selected.fundingCostSol,
              depositTaxSol:built.selected.depositTaxSol,entryNetworkSol,rentSol:positionRentSol,
              cashBeforeEntrySol:cashSol,feeBasisSol:built.selected.initialSol+built.selected.initialPairedTokens*o.priceSol,feesSol:0,inRangeHours:0,uncreditedHours:0,observations:1};
            if(cashSol!==null)cashSol=entryNetworkSol===null||positionRentSol===null?null:cashSol-sizeSol-entryNetworkSol-positionRentSol;
            grossCashSol-=sizeSol+(entryNetworkSol??0)+(positionRentSol??0);
            decision(o,'entry',`${config.signal} rules passed; ${built.binCount} observed-price anchored bins; costs are assumptions`);
          }
        }catch(error){decision(o,'skip',`Range unavailable: ${error instanceof Error?error.message:String(error)}`);}
      }
    }
    const m=position?mark(position,o):null;
    equityCurve.push({at:o.at,cashSol,equitySol:cashSol===null?null:position?m!.netLiquidationSol===null||position.rentSol===null||networkSol===null?null:cashSol+m!.netLiquidationSol+position.rentSol-networkSol/2:cashSol,
      grossEquitySol:grossCashSol+(position?m!.grossLiquidationSol+(position.rentSol??0)-(networkSol??0)/2:0)});
  }
  const last=observations.at(-1);
  const openPosition=position&&last?{...position,...mark(position,last),lastObservedAt:last.at,heldHours:(last.time-position.entryTime)/3_600_000}:null;
  const unresolved=trades.filter(t=>t.pnlSol===null);
  const scoreboard=score();
  // No trades is an absence of outcomes, rather than a demonstrated zero P&L.
  if(trades.length===0){scoreboard.netPnlSol=null;scoreboard.vsHoldingSol=null;scoreboard.worstDrawdown=null;scoreboard.worstDrawdownSol=null;}
  const status=observations.length<2?'warming':unresolved.length?'unresolved':trades.length||position?'complete':'waiting';
  return {status,label,config,feeMode,scoreboard,trades,openPosition,unresolved,decisions,equityCurve,assumptions,warnings,
    medianCadenceMinutes:medianCadenceMs===null?null:medianCadenceMs/60_000};
}
