import {RESEARCH_READ_LIMITS} from './sources/research-reads';
import {STILL_PREFLIGHT_THRESHOLDS as T} from './still-preflight-config';
import type {StillPreflight,StillPreflightInput} from './still-preflight';
// Exact canonical mints, never names or ticker symbols. Source: Solana payments docs.
export const STILL_KNOWN_ISSUERS=new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
export const isStillKnownIssuer=(mint:string|null|undefined)=>!!mint&&STILL_KNOWN_ISSUERS.has(mint);
export type StillCheckStatus='pass'|'caution'|'fail'|'unavailable';
export interface StillCheck {id:string;label:string;status:StillCheckStatus;result:string;source:string;asOf:string|null;tooltip:string;lesson:number}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const n=(v:number)=>v!==0&&Math.abs(v)<.0001?v.toExponential(2):v.toLocaleString('en-GB',{maximumFractionDigits:4});
const pct=(v:number)=>n(v*100),sol=(v:number)=>n(v)+' SOL';
const fresh=(at:string|null|undefined,now:number,ttl=300000)=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=ttl;
export function stillChecks(p:StillPreflight,d:StillPreflightInput,now:number):StillCheck[]{
 const hold=(p.options?.holdMinutes||T.defaultHoldMinutes)/60,holdText=hold<1?`${n(hold*60)} minutes`:`${n(hold)} hours`,checks:StillCheck[]=[];
 const add=(id:string,label:string,status:StillCheckStatus,result:string,source:string,asOf:string|null,tooltip:string,lesson:number)=>checks.push({id,label,status,result,source,asOf,tooltip,lesson});
 const unknown=(id:string,label:string,source:string,tooltip:string,lesson:number)=>add(id,label,'unavailable',`Unavailable. Couldn't read ${source} at ${new Date(now).toISOString()}. Treat this as unknown.`,source,null,tooltip,lesson);
 const policy=d.safety?.rpc;
 if(policy?.status==='available'&&policy.mint===p.pool.pairedMint&&fresh(policy.asOf,now,RESEARCH_READ_LIMITS.mintTtlMs)&&policy.freezeAuthority)add('freeze','Freeze authority',isStillKnownIssuer(policy.mint)?'caution':'fail',isStillKnownIssuer(policy.mint)?'Known issuer':'The token has an active freeze authority.','Confirmed Solana RPC mint policy',policy.asOf,'An active authority can freeze token accounts. Exact canonical issuer identity changes the warning, not that capability.',4);
 const fee=p.feeRateHourly.value,cost=p.exitCostSol.value,day=p.expectedFeesPerDaySol.value;
 if(finite(fee)){
  const status=fee>=T.feePace.pass?'pass':fee>=T.feePace.caution?'caution':'fail';
  const t=finite(p.breakEvenHours.value)?`${n(p.breakEvenHours.value)} hours`:'unavailable';
  add('fees','Fee pace',status,t==='unavailable'?`Fees are ${pct(fee)}% of TVL an hour. Cost recovery is unavailable.`:status==='pass'?`Fees are running at ${pct(fee)}% of TVL an hour. Costs earned back in about ${t}.`:status==='caution'?`Fees are ${pct(fee)}% of TVL an hour. Costs take about ${t} to earn back.`:`Fees are ${pct(fee)}% of TVL an hour. ${finite(p.roundTripCostSol.value)?`Cost recovery at this pace: ${t}. Planned hold: ${holdText}.`:'Cost recovery is unavailable.'}`,p.feeRateHourly.source,p.feeRateHourly.asOf,`Fee projection uses the slower of one-hour volume and 24-hour volume / 24, at the observed fee per dollar traded, applied to your size. ${finite(day)?'Daily pace: '+sol(day)+'. ':''}Pool-average model, not position earnings. Example threshold bands; costs and future fees may be unavailable.`,7);
 }else unknown('fees','Fee pace',p.feeRateHourly.source,'Fee projection uses the slower of one-hour volume and 24-hour volume / 24, at the observed fee per dollar traded, applied to your size.',7);
 for(const scenario of p.scenarios){
  const half=scenario.dropFraction===.5,id=half?'half':'drop20',label=half?'If price halves':'If price falls 20%',value=scenario.grossValueSol.value,change=scenario.grossPnlSol.value;
  if(!finite(value)||!finite(change)||!p.range||!finite(scenario.priceSol.value)){unknown(id,label,'Still paper range model','Ideal downward bin-fill scenario before fees, tax and trading costs.',1);continue;}
  const inside=scenario.priceSol.value>=p.range.floorPriceSol&&scenario.priceSol.value<=p.range.topPriceSol,near=inside&&scenario.priceSol.value/p.range.floorPriceSol<1.1,status=inside?near?'caution':'pass':'fail';
  const amount=sol(value),delta=(change>0?'+':'')+sol(change),token=p.pool.name.split('/').find(s=>s!=='SOL')||'the paired token';
  const above=scenario.priceSol.value>p.range.topPriceSol;
  const result=above?`About ${amount} (${delta}). Above your range, holding SOL.`:half?(inside?`About ${amount} (${delta}). Your floor still covers it.`:`About ${amount} (${delta}). Most of your position would be ${token}.`):(inside?near?`About ${amount} (${delta}). Close to the edge of your range.`:`Your position would be worth about ${amount} (${delta}). Still in range.`:`About ${amount} (${delta}). Out of range, holding mostly ${token}.`);
  add(id,label,above?'caution':status,result,scenario.grossValueSol.source,scenario.grossValueSol.asOf,'Gross inventory only, before fees and costs. A fixed downward price scenario, not a forecast. The floor is not a stop-loss.',1);
 }
 if(finite(cost)){
  const fraction=cost/p.sizeSol,expected=finite(fee)?fee*p.sizeSol*hold:null,status=fraction>T.exitCost.caution||finite(expected)&&(p.roundTripCostSol.value??cost)>expected?'fail':fraction<=T.exitCost.pass?'pass':'caution';
  // A full-size token sale is a reference, not the unknown future LP withdrawal.
  const modeled=finite(p.roundTripCostSol.value),partial=p.exitCostComplete===false&&finite(p.exitCostSol.value);
  add('cost','Entry and exit cost',modeled?status:status==='fail'?'fail':'unavailable',modeled?`Paper exit estimate: ${pct(fraction)}% (${sol(cost)}). Paper entry + exit + setup: ${sol(p.roundTripCostSol.value!)}.`:partial?`Exit costs at least ${pct(fraction)}% (${sol(cost)}), including the verified transfer fee. Swap quote or remaining costs: Unavailable.`:`Exit swap reference: ${pct(fraction)}% (${sol(cost)}). Paper entry and exit estimate: Unavailable.`,modeled||partial?p.exitCostSol.source:p.exitConversionSol.source,modeled||partial?p.exitCostSol.asOf:p.exitConversionSol.asOf,p.paperCostModel?.note||'Current full-size token-to-SOL reference. It is not an LP withdrawal simulation or a future exit guarantee.',3);
 }else unknown('cost','Entry and exit cost','Jupiter size-matched quote','Swap cost to get in and out at your size, from a live Jupiter quote. Network and LP withdrawal costs are separate.',3);
 const tax=p.transferFeeBps.value,mutable=p.transferFeeChangeable?.value;
 if(finite(tax)){
  const rate=tax/10000,status=mutable===true||rate>T.transferTax.caution?'fail':rate===0?'pass':'caution';
  add('tax','Transfer tax',status,mutable===true?`${pct(rate)}% transfer tax. The tax is changeable.`:rate===0?'No transfer tax on this token.':status==='caution'?`${pct(rate)}% transfer tax, charged on every move in and out.`:`${pct(rate)}% transfer tax. A round trip costs ${pct(1-(1-rate)**2)}% before you earn a fee.`,p.transferFeeBps.source,p.transferFeeBps.asOf,'Token-2022 tokens can charge a fee on every transfer. Percentage is the nominal rate; the on-chain per-transfer cap can reduce the actual charge. Additional swaps can add transfers.',4);
 }else unknown('tax','Transfer tax','Solana RPC mint extensions','Token-2022 tokens can charge a fee on every transfer.',4);
 const rpc=d.safety?.rpc,sample=rpc?.holderSample,rug=d.rug,exclusions=rug?.holderExclusions;
 let holderAdded=false;
 if(rpc?.mint===p.pool.pairedMint&&rpc.status==='available'&&fresh(rpc.asOf,now,RESEARCH_READ_LIMITS.mintTtlMs)&&sample?.status==='available'&&sample.mint===p.pool.pairedMint&&fresh(sample.asOf,now,RESEARCH_READ_LIMITS.mintTtlMs)&&/^\d{1,78}$/.test(sample.supplyRaw||'')&&exclusions?.status==='available'&&exclusions.mint===sample.mint&&fresh(exclusions.asOf,now,600000)){
  const supply=BigInt(sample.supplyRaw!),excluded=new Set([...exclusions.addresses,p.poolAddress,'11111111111111111111111111111111','1nc1nerator11111111111111111111111111111111']),owners=new Map<string,bigint>(),seen=new Set<string>();let sum=0n,valid=supply>0n;
  for(const a of sample.accounts){if(!a.owner||!a.address||seen.has(a.address)||!/^\d{1,78}$/.test(a.amountRaw)){valid=false;break;}seen.add(a.address);const v=BigInt(a.amountRaw);sum+=v;if(!excluded.has(a.owner)&&!excluded.has(a.address))owners.set(a.owner,(owners.get(a.owner)||0n)+v);}
  if(valid&&sum<=supply){const ranked=[...owners.values()].sort((a,b)=>a>b?-1:a<b?1:0),fraction=(v:bigint)=>Number(v*1000000000n/supply)/1e9,top=fraction(ranked[0]||0n),ten=fraction(ranked.slice(0,10).reduce((a,b)=>a+b,0n)),complete=sample.complete&&sum===supply;
   if(top>T.holders.singleWalletFail||ten>T.holders.caution||complete){const status=top>T.holders.singleWalletFail||ten>T.holders.caution?'fail':ten<T.holders.pass?'pass':'caution';
    add('holders','Top holders',status,top>T.holders.singleWalletFail?`One wallet holds ${pct(top)}%. A single sale could push you out of range.`:status==='fail'?`Top 10 wallets hold ${pct(ten)}%. A few sellers could move the price.`:status==='pass'?`Top 10 wallets hold ${pct(ten)}%. Spread out.`:`Top 10 wallets hold ${pct(ten)}%. A few sellers could move the price.`,'Solana RPC largest accounts + RugCheck exclusions',sample.asOf,`Largest wallets, excluding the pool and burn addresses. ${complete?'Sample covers observed supply.':'These shares are observed lower bounds. Missing smaller accounts prevent a passing concentration verdict.'}`,4);holderAdded=true;}
  }
 }
 if(!holderAdded)unknown('holders','Top holders','Solana RPC holders and verified exclusions','Largest wallets, excluding the pool and burn addresses. A sample cannot prove dispersed ownership; unavailable until coverage or a failing lower bound is established.',4);
 const candles=d.candles,end=Math.floor(now/3600000)*3600,byTime=new Map((candles?.candles||[]).map(c=>[c.t,c]));
 const window=(hours:number)=>Array.from({length:hours},(_,i)=>byTime.get(end-(hours-i)*3600));
 const six=window(6),dayWindow=window(24),candleCurrent=candles?.status==='available'&&fresh(candles.asOf,now);
 if(candleCurrent&&six.every(c=>c&&finite(c.c)&&c.c>0)&&finite(p.priceSol.value)){
  const avg=six.reduce((sum,c)=>sum+c!.c,0)/6,deviation=p.priceSol.value/avg-1,last=six[5]!,move=last.c/last.o-1;
  const status=deviation>T.spike.caution||move>T.spike.caution?'fail':Math.abs(deviation)<=T.spike.pass&&move<=T.spike.pass?'pass':'caution';
  add('spike','Launch spike',status,status==='pass'?`Price is within ${pct(Math.abs(deviation))}% of its 6-hour average. Not mid-spike.`:status==='fail'?`Price is up ${pct(Math.max(deviation,move))}% in ${deviation>=move?'comparison with its 6-hour average':'the last completed hour'}. Entering mid-spike is how ranges get left behind.`:move>=T.spike.pass?`Price is up ${pct(move)}% in the last hour. A pullback may be coming.`:`Price differs ${pct(Math.abs(deviation))}% from its 6-hour average.`,candles!.note.includes('Gecko')?'GeckoTerminal exact-pool hourly candles':'Meteora exact-pool hourly candles',candles!.asOf,'Six complete hourly closes form the average. One-hour change uses the last complete candle, not a fabricated rolling window.',5);
 }else unknown('spike','Launch spike','Exact-pool 6-hour candle window','A complete recent six-hour window is required.',5);
 if(candleCurrent&&dayWindow.every(c=>c&&finite(c.h)&&finite(c.l)&&c.h>=c.l)&&finite(p.priceSol.value)&&p.range){
  const swing=(Math.max(...dayWindow.map(c=>c!.h))-Math.min(...dayWindow.map(c=>c!.l)))/p.priceSol.value,depth=p.range.depthFraction,status=depth<swing?'fail':depth<swing*T.floor.passAtSwing?'caution':'pass';
  add('floor','Floor distance',status,status==='pass'?`Your floor is ${pct(depth)}% below price. Room for a normal pullback.`:status==='caution'?`Your floor is ${pct(depth)}% below price. A routine dip could take you out.`:`Your floor is ${pct(depth)}% below price, inside today's usual swing of ${pct(swing)}%.`,candles!.note.includes('Gecko')?'GeckoTerminal exact-pool hourly candles + paper range':'Meteora hourly candles + paper range',candles!.asOf,'Example thresholds: below the observed 24h high–low span fails; 1–1.2× cautions; at least 1.2× passes. Past movement is not a prediction.',1);
 }else unknown('floor','Floor distance','Exact-pool 24-hour candle window','Requires all 24 complete hourly candles and a valid range.',1);
 return checks;
}
