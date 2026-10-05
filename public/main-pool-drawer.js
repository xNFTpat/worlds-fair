import {buildResearchRange,defaultResearchFloor} from './research-range.js';
import {preflightHtml,scorePreflight} from './worldsfair-preflight.js';
import {suggestOvernightRange} from './worldsfair-suggested-range.js';
import {PREFLIGHT_THRESHOLDS} from './worldsfair-thresholds.js';

const SOL='So11111111111111111111111111111111111111112';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const positive=v=>finite(v)&&v>0;
const esc=v=>String(typeof v==='number'&&!Number.isFinite(v)?'Unavailable':v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const at=v=>typeof v==='string'?Date.parse(v):NaN;
const fresh=(value,ttl,now)=>Number.isFinite(at(value))&&at(value)<=now&&now-at(value)<=ttl;
const pct=v=>finite(v)?(v*100).toFixed(1)+'%':'Unavailable';
const sol=v=>finite(v)?v.toFixed(4)+' SOL':'Unavailable';
const price=v=>positive(v)?v.toPrecision(6):'Unavailable';
const exact=v=>positive(v)?v.toPrecision(17):'Unavailable';
const usd=v=>finite(v)?'$'+v.toLocaleString('en-GB',{maximumFractionDigits:0}):'Unavailable';
const hours=v=>finite(v)?v.toFixed(1)+'h':'Unavailable';
const stamp=value=>Number.isFinite(at(value))?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Unavailable';
const scenarioHours=(value,rate)=>finite(value)?hours(value):rate>0?'—':'∞';
const dated=value=>'<span class="mpd-stamp" title="'+esc(value||'Source timestamp unavailable')+'">Data as of '+esc(stamp(value))+'</span>';
const tone=v=>finite(v)?v>0?'mpd-good':v<0?'mpd-bad':'':'mpd-unknown';
let active=null;

const SKIPPED_KEY='still.skipped-pools.v1';
export const SKIP_REASONS=Object.freeze({costs:'Costs too high',downside:'Too much downside',token:'Token concerns',evidence:'Missing evidence',fit:'Not for me'});
const skipStorage=()=>{try{return typeof window!=='undefined'?window.localStorage:null;}catch{return null;}};
export function readSkippedPools(storage=skipStorage()){
 try{const raw=storage?.getItem(SKIPPED_KEY);if(!raw||raw.length>20000)return [];const rows=JSON.parse(raw);if(!Array.isArray(rows))return [];return rows.filter(r=>r&&typeof r.poolId==='string'&&/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.poolId)&&typeof r.pair==='string'&&r.pair.length<=80&&typeof r.reasonId==='string'&&Object.hasOwn(SKIP_REASONS,r.reasonId)&&Number.isFinite(at(r.at))).slice(0,10).map(r=>({poolId:r.poolId,pair:r.pair,reasonId:r.reasonId,at:r.at}));}catch{return [];}
}
export function recordSkippedPool(pool,reasonId,storage=skipStorage(),now=Date.now()){
 const address=pool?.address||String(pool?.id||'').replace(/^solana:/,''),poolId='solana:'+address;
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address||'')||typeof reasonId!=='string'||!Object.hasOwn(SKIP_REASONS,reasonId)||!finite(now)||!Number.isFinite(new Date(now).getTime()))return {ok:false,error:'Choose a reason before saving this pool.'};
 if(!storage)return {ok:false,error:'Browser storage is unavailable. This skip was not saved.'};
 const entry={poolId,pair:String(pool.pair||'SOL pool').slice(0,80),reasonId,at:new Date(now).toISOString()},entries=[entry,...readSkippedPools(storage).filter(r=>r.poolId!==poolId)].slice(0,10);
 try{storage.setItem(SKIPPED_KEY,JSON.stringify(entries));return {ok:true,entries};}catch{return {ok:false,error:'Browser storage is unavailable. This skip was not saved.'};}
}
export function skippedLogHtml(entries){
 if(!entries.length)return '<p class="mpd-micro">No skipped pools yet. Save one only when you decide to pass.</p>';
 return '<ol class="mpd-skipped-list">'+entries.map(entry=>'<li><div><b>'+esc(entry.pair)+'</b><span class="mpd-skip-chip">'+esc(SKIP_REASONS[entry.reasonId])+'</span></div><time datetime="'+esc(entry.at)+'">'+esc(new Date(entry.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+'</time></li>').join('')+'</ol>';
}
function skippedHtml(){return '<details class="mpd-skip"><summary>Skip this pool / recent skips</summary><p class="mpd-micro">Your choice, saved only in this browser. No funds or paper balance changes.</p><fieldset class="mpd-skip-reasons"><legend>Why are you passing?</legend>'+Object.entries(SKIP_REASONS).map(([id,label])=>'<label class="mpd-skip-reason"><input type="radio" name="mpdSkipReason" value="'+id+'">'+esc(label)+'</label>').join('')+'</fieldset><button type="button" data-mpd-save-skip>Save skipped pool</button><p data-mpd-skip-status role="status" class="mpd-micro"></p><h3>Last 10 skipped pools</h3><div data-mpd-skipped-log>'+skippedLogHtml(readSkippedPools())+'</div></details>';}

function anchorFor(row,now){
 const a=row.rangeAnchor,step=row.config?.binStep;
 return a?.status==='available'&&fresh(a.asOf,60000,now)&&Number.isSafeInteger(a.activeBinId)&&positive(a.activeBinPriceSol)&&Number.isInteger(a.binStep)&&a.binStep>0&&a.binStep<=10000&&(!positive(step)||step===a.binStep)&&Number.isSafeInteger(a.minNativeBinId)&&Number.isSafeInteger(a.maxNativeBinId)&&a.minNativeBinId<=a.activeBinId&&a.maxNativeBinId>=a.activeBinId?a:null;
}
function quoteFor(row,size,mode,now){
 const matches=(row.quotes||[]).filter(q=>q.sizeSol===size&&q.mode===mode).sort((a,b)=>at(b.asOf)-at(a.asOf));
 for(const q of matches){
  const buy=at(q.buyAsOf),sell=at(q.sellAsOf),oldest=Math.min(buy,sell),datedLegs=Number.isFinite(oldest)&&buy<=now&&sell<=now;
  const e=q.economicEstimate;
  if(e?.costModelVersion===3&&['available','stale'].includes(e?.status)&&datedLegs&&fresh(e.asOf,3600000,now)&&now<oldest+3600000&&at(e.asOf)===oldest&&finite(e.expiresAt)&&e.expiresAt>oldest&&e.expiresAt<=oldest+600000&&(e.retainedUntil===undefined||(finite(e.retainedUntil)&&e.retainedUntil>now&&e.retainedUntil<=oldest+3600000))&&Number.isFinite(at(e.dataAsOf))&&at(e.dataAsOf)<=now&&finite(e.roundTripCostSol)&&e.roundTripCostSol>=0){
   const mark=fresh(e.markAsOf,3600000,now)?positive(e.markPriceSol)?e.markPriceSol:e.markAsOf===row.pool?.fetchedAt?row.priceSol:null:null;
   const retained=e.status==='stale'||now>=e.expiresAt;
   return {quote:q,roundTripCostSol:e.roundTripCostSol,exitCostSol:e.exitCostSol,exitFeeFloorSol:e.exitFeeFloorSol,exitFeeSource:e.exitFeeSource,markPriceSol:mark,decimals:e.tokenDecimals??row.safety?.rpc?.decimals,asOf:e.asOf,dataAsOf:e.dataAsOf,cached:true,retained,label:'Dated economic estimate · '+(retained?'last good · ':'')+stamp(e.asOf),expiresAt:e.expiresAt,retainedUntil:e.retainedUntil??oldest+3600000};
  }
  if(e?.costModelVersion===3&&positive(e.markPriceSol)&&fresh(e.markAsOf,60000,now)&&q.status==='quoted'&&datedLegs&&fresh(q.asOf,45000,now)&&at(q.asOf)===oldest&&finite(q.expiresAt)&&q.expiresAt>now&&q.expiresAt<=oldest+45000&&finite(q.roundTripCostSol)&&q.roundTripCostSol>=0&&fresh(row.pool?.fetchedAt,600000,now))return {quote:q,roundTripCostSol:q.roundTripCostSol,exitCostSol:q.exitCostSol,exitFeeFloorSol:q.exitFeeFloorSol??e.exitFeeFloorSol,exitFeeSource:q.exitFeeSource??e.exitFeeSource,markPriceSol:e.markPriceSol,decimals:e.tokenDecimals??row.safety?.rpc?.decimals,asOf:q.asOf,dataAsOf:q.asOf,cached:false,retained:false,label:'Current cost estimate · '+stamp(q.asOf),expiresAt:q.expiresAt};
 }
 return null;
}
function quoteValue(q){
 if(!q||!positive(q.markPriceSol)||!Number.isInteger(q.decimals)||q.decimals<0||q.decimals>18||typeof q.quote.tokenRaw!=='string'||!/^\d+$/.test(q.quote.tokenRaw))return null;
 const value=Number(q.quote.tokenRaw)/10**q.decimals*q.markPriceSol;return positive(value)?value:null;
}
function taxFor(row,now){
 const m=row.safety?.rpc,known=m?.status==='available'&&fresh(m.asOf,300000,now);
 return {transferFeeBps:known?m.transferFeeStatus==='none'?0:m.transferFeeStatus==='known'?m.transferFee?.bps??null:null:null,
  transferFeeMaximumRaw:known&&m.transferFeeStatus==='known'?m.transferFee?.maximumRaw??null:null,
  pairedDecimals:Number.isInteger(m?.decimals)&&m.decimals>=0&&m.decimals<=18?m.decimals:undefined};
}
function referenceWithdrawalTax(q,tax){
 if(!q||tax.transferFeeBps===null)return null;if(tax.transferFeeBps===0)return 0;
 const raw=q.quote.tokenRaw,decimals=q.decimals;if(typeof raw!=='string'||!/^\d+$/.test(raw)||!positive(q.markPriceSol)||!Number.isInteger(decimals))return null;
 const fee=(BigInt(raw)*BigInt(tax.transferFeeBps)+9999n)/10000n,cap=typeof tax.transferFeeMaximumRaw==='string'&&/^\d+$/.test(tax.transferFeeMaximumRaw)?BigInt(tax.transferFeeMaximumRaw):null;
 return Number(cap!==null&&cap<fee?cap:fee)/10**decimals*q.markPriceSol;
}

/** Pure display model. Cached costs are research assumptions, never executable quotes. */
export function poolDrawerModel(row,input={},now=Date.now()){
 const pool=row.pool||row,anchor=anchorFor(row,now),reference=anchor?.activeBinPriceSol??row.priceSol,binStep=anchor?.binStep??row.config?.binStep??pool.poolConfig?.binStep;
 const sizeSol=input.sizeSol===undefined?.5:input.sizeSol,oneSided=input.oneSided??true,shape=input.shape??'BidAsk',mode=input.mode??'best';
 const supports=[...new Set((row.structure?.supportLevels||[]).map(v=>typeof v==='number'?v:v?.priceSol).filter(v=>positive(v)&&v<reference))].sort((a,b)=>b-a);
 let suggested=null;if(positive(reference)&&Number.isInteger(binStep)&&binStep>0&&binStep<=10000)suggested=defaultResearchFloor({priceSol:reference,binStep,oneSided,preferredFloorPriceSol:supports[0]});
 const overnightSuggested=anchor||fresh(pool.fetchedAt,PREFLIGHT_THRESHOLDS.marketMaxAgeMs,now)?suggestOvernightRange({priceSol:reference,binStep,solIsBase:pool.base?.address===SOL,...(anchor?{activeBinId:anchor.activeBinId,minNativeBinId:anchor.minNativeBinId,maxNativeBinId:anchor.maxNativeBinId}:{})}):{status:'unavailable',reason:'The reference price is saved or undated. Refresh the pool before choosing a suggested range.'};
 const floorPriceSol=input.floorPriceSol===undefined?suggested?.floorPriceSol:input.floorPriceSol;
 const sale=quoteFor(row,sizeSol,mode,now),fund=oneSided?null:quoteFor(row,sizeSol/2,mode,now),saleValue=quoteValue(sale),fundValue=quoteValue(fund),tax=taxFor(row,now);
 const quotedSale= sale&&positive(saleValue)&&finite(sale.exitCostSol)&&sale.exitCostSol>=0?Math.max(sale.exitCostSol,finite(sale.exitFeeFloorSol)?sale.exitFeeFloorSol:0)/saleValue:null;
 const exitFraction=input.saleCostFraction??(finite(quotedSale)&&quotedSale<=1?quotedSale:.005),saleAssumed=input.saleCostFraction!=null||!finite(quotedSale)||quotedSale>1;
 const quotedFunding=fund&&positive(fundValue)&&sizeSol>0?Math.max(0,(sizeSol/2-fundValue)/(sizeSol/2)):null;
 const fundingFraction=input.fundingCostFraction??(finite(quotedFunding)&&quotedFunding<=1?quotedFunding:oneSided?null:.005),fundingAssumed=!oneSided&&(input.fundingCostFraction!=null||!finite(quotedFunding)||quotedFunding>1);
 const networkSol=input.networkSol===undefined?.0001:input.networkSol,rentSol=input.positionRentSol===undefined?0:input.positionRentSol;
 const feeCurrent=fresh(row.feeRates?.asOf,600000,now)&&fresh(pool.fetchedAt,600000,now),validRate=finite(row.feeRates?.h4)&&row.feeRates.h4>=0&&row.feeRates.h4<=1;
 const rate=feeCurrent&&validRate?row.feeRates.h4:null,scenarioRate=validRate&&fresh(row.feeRates.asOf,3600000,now)?row.feeRates.h4:0;
 const mint=row.safety?.rpc,datedPolicy=['available','stale','rate-limited','unavailable'].includes(mint?.status)&&Number.isInteger(mint.decimals)&&mint.decimals>=0&&mint.decimals<=18&&fresh(mint.asOf,3600000,now),taxBps=datedPolicy?(mint.transferFeeStatus==='none'?0:mint.transferFeeStatus==='known'?mint.transferFee?.bps:null):null;
 const taxAssumed=!Number.isInteger(taxBps)||taxBps<0||taxBps>10000;
 const scenarioTax={...tax,transferFeeBps:taxAssumed?0:taxBps,transferFeeMaximumRaw:!taxAssumed&&taxBps>0&&typeof mint.transferFee?.maximumRaw==='string'&&/^\d{1,78}$/.test(mint.transferFee.maximumRaw)&&Number.isInteger(tax.pairedDecimals)?mint.transferFee.maximumRaw:null};
 const saleLabel=saleAssumed?'Exit: '+pct(exitFraction)+' assumed':'Exit: '+stamp(sale.asOf)+' · '+pct(exitFraction)+(sale.retained?' · last good':'')+(sale.exitFeeSource==='assumed'?' · fee floor assumed':'');
 const scenarioCostLabel=saleLabel+(taxAssumed?' · unverified token tax excluded':taxBps>0?' · dated token tax '+(taxBps/100).toFixed(2)+'%':'')+(fundingAssumed?' · funding '+pct(fundingFraction)+' assumed':'');
 const scenarioFeeLabel=scenarioRate>0?'4h fee pace '+stamp(row.feeRates.asOf)+(feeCurrent?'':' · dated'):'No dated positive 4h fee pace; ∞ means no fee recovery assumed';
 const withdrawalTax=referenceWithdrawalTax(sale,scenarioTax),referenceCost=sale&&withdrawalTax!==null?sale.roundTripCostSol+withdrawalTax+networkSol:null;
 const referenceExit=sale&&positive(saleValue)&&finite(sale.exitCostSol)&&sale.exitCostSol>=0&&withdrawalTax!==null?sale.exitCostSol+withdrawalTax+networkSol/2:null;
 const validAmounts=positive(sizeSol)&&sizeSol<=1000000&&finite(networkSol)&&networkSol>=0&&finite(rentSol)&&rentSol>=0;
 const net4h=validAmounts&&referenceCost!==null&&rate!==null?rate*4-referenceCost/sizeSol:null;
 const exitHours=validAmounts&&referenceExit!==null&&rate>0?referenceExit/(sizeSol*rate):validAmounts&&referenceExit===0?0:null;
 let range=null,error=null;
 try{if(!validAmounts)throw Error('Enter a positive size and nonnegative network/rent assumptions.');range=buildResearchRange({sizeSol,priceSol:reference,floorPriceSol,binStep,shape,oneSided,solIsBase:pool.base?.address===SOL,...(anchor?{activeBinId:anchor.activeBinId,activeBinPriceSol:anchor.activeBinPriceSol}:{}),feeRateHourly:scenarioRate,exitCostFraction:exitFraction,fundingCostFraction:fundingFraction,networkSol,positionRentSol:rentSol,...scenarioTax});
  if(anchor&&(range.lowerNativeBin<anchor.minNativeBinId||range.upperNativeBin>anchor.maxNativeBinId))throw Error('This range crosses the pool native bin limits. Choose a nearer floor.');
 }catch(e){range=null;error=e.message;}
 return {pool,anchor,reference,binStep,sizeSol,oneSided,shape,mode,supports,suggested,overnightSuggested,range,error,rate,feeWindowHours:4,feeCurrent,rpcCurrent:row.safety?.rpc?.status==='available'&&fresh(row.safety.rpc.asOf,300000,now),now,sale,fund,exitFraction,fundingFraction,saleAssumed,fundingAssumed,scenarioTax,taxAssumed,scenarioRate,scenarioCostLabel,scenarioFeeLabel,tax,net4h,exitHours,referenceCost,referenceExit,networkSol};
}

function sectionHeading(title,asOf,tip=''){return '<div class="mpd-panel-head"><h3'+(tip?' title="'+esc(tip)+'" tabindex="0"':'')+'>'+esc(title)+'</h3>'+dated(asOf)+'</div>';}
function worthHtml(row,m){
 const flags=(row.safety?.flags||[]).filter(f=>f.severity==='attention');
 const status=m.net4h===null?'Cost or fee evidence is missing':m.net4h>0?'Fee pace covers reference costs in 4h':'Reference costs exceed the 4h fee pace';
 return sectionHeading('Is the fee pace worth it?',m.sale?.dataAsOf??row.feeRates?.asOf,'4h-window pool fees/TVL per hour, held constant for four hours, minus size-specific buy/sell reference costs, withdrawal tax and the declared network allowance. This is not a forecast of position profit.')+'<div class="mpd-worth-grid"><div><small>4h fees − reference costs</small><strong class="'+tone(m.net4h)+'">'+pct(m.net4h)+'</strong></div><div title="Size-specific sale reference, one LP withdrawal tax, and half the network allowance divided by the 4h-window pool fee/TVL per hour. Actual range fee share is unavailable." tabindex="0"><small>Fees to cover exit cost</small><strong>'+((m.rate===0&&m.referenceExit>0)?'No fee pace':hours(m.exitHours))+'</strong></div></div><p class="mpd-one-line '+(m.net4h===null?'mpd-unknown':'')+'">'+esc(status)+'.'+(flags.length?' <span class="mpd-warn">'+flags.length+' safety flag'+(flags.length===1?'':'s')+'</span>':'')+'</p>';
}
function structureHtml(row,m){
 const s=row.structure||{},trend=({rising:'↗ Hourly highs rising',falling:'↘ Hourly highs falling',mixed:'↔ Hourly highs mixed',unknown:'Hourly trend unavailable'})[s.hourlyHighTrend]||'Hourly trend unavailable';
 return sectionHeading('Price structure',s.asOf,'Observed hourly swing highs/lows. Partial windows only describe the available candles; past support is not guaranteed.')+'<div class="mpd-swings">'+[4,24,48].map(h=>{const w=s.windows?.find(w=>w.hours===h);return '<div title="'+esc(w?.complete?'Complete dated hourly window':(finite(w?.observations)?w.observations:0)+' observed hours; full window unavailable')+'"><b>'+h+'h'+(w?.complete?'':' · partial')+'</b><span>H '+price(w?.high)+'</span><span>L '+price(w?.low)+'</span></div>';}).join('')+'</div><div class="mpd-structure-foot"><span>'+esc(trend)+'</span>'+(m.supports.length?'<button type="button" data-mpd-support="'+m.supports[0]+'" title="Use the nearest observed support as your floor. It may exceed 69 bins.">Support '+price(m.supports[0])+' ↓</button>':'<span class="mpd-unknown">Support unavailable</span>')+'</div>';
}
function rangeHtml(row,m){
 const r=m.range;if(!r)return sectionHeading('Range scenario',m.anchor?.asOf??row.pool?.fetchedAt)+'<p class="mpd-bad" role="status">'+esc(m.error||'Choose a price and bin step with available data.')+'</p>';
 const status=m.anchor?'RPC bin alignment':'Estimated grid',recovery=scenarioHours(r.selected.atFloor.exitRecoveryHours,m.scenarioRate);
 const tip='Human SOL per paired token. Native IDs are authoritative when RPC alignment is verified; pasted prices can snap to a neighbouring bin. '+(m.suggested?.capped?m.suggested.note+' ':'')+'Exit-fee hours cover withdrawal tax plus sale cost at the 4h-window pool fees/TVL per hour. This rough fee share excludes network allowance and conversion losses.';
 return sectionHeading('Range · '+r.binCount+' bins · '+pct(r.rangeDepthFraction)+' deep',m.anchor?.asOf??row.pool?.fetchedAt,tip)+'<div class="mpd-bounds"><label>Bottom · SOL/token<input readonly aria-label="Bottom SOL per token" value="'+exact(r.bottomPriceSol)+'"></label><label>Top · SOL/token<input readonly aria-label="Top SOL per token" value="'+exact(r.topPriceSol)+'"></label><button type="button" data-mpd-copy aria-label="'+(m.anchor?'Copy native bin bounds':'Copy estimated range bounds')+'" title="'+status+'">Copy</button></div>'+(r.exceedsSetupBins?'<p class="mpd-bad">Over 69 bins. Choose a nearer floor for this setup.</p>':'')+'<p class="mpd-micro mpd-range-recovery" title="'+esc(tip)+'">Exit fees: <b>'+recovery+'</b> · rough fee share · '+(m.anchor?'RPC bins '+r.lowerNativeBin+' → '+r.upperNativeBin:'estimated grid')+'</p>';
}
function scenariosHtml(row,m){
 const r=m.range,rows=r?[...r.comparison,...(r.shape==='Curve'?[r.selected]:[])]:[{shape:'Spot'},{shape:'BidAsk'}],value=s=>finite(s?.pnlSol)?m.sizeSol+s.pnlSol:null;
 const assumption=m.scenarioCostLabel+'. '+m.scenarioFeeLabel+'. Earned fees are excluded; the same assumed sale fraction is held constant at the floor and 10% below it. Missing token-tax evidence is explicitly excluded, so additional tax can worsen the result.';
 const cell=s=>'<td title="'+esc(s?('Conversion before exit costs '+sol(s.grossValueSol)+' ('+pct((s.grossValueSol-m.sizeSol)/m.sizeSol)+'); sale '+sol(s.saleCostSol)+'; withdrawal tax '+sol(s.withdrawalTaxSol)+'. '+assumption):'Choose a valid range to calculate this scenario')+'" tabindex="0"><b>'+(!s?'—':sol(value(s)))+'</b><small class="'+tone(s?.returnFraction)+'">'+(!s?'—':pct(s.returnFraction))+'</small></td>';
 return sectionHeading('After conversion & costs · vs SOL',m.sale?.asOf??row.pool?.fetchedAt,assumption)+'<table class="mpd-comparison mpd-downside"><thead><tr><th>Shape</th><th>At floor</th><th>10% lower</th><th title="Rough fee hours needed before exit to offset the entire scenario loss. Actual time in range and fee share are unmeasured.">Fee h*</th></tr></thead><tbody>'+rows.map(c=>'<tr'+(c.shape===m.shape?' class="mpd-selected"':'')+'><td>'+({Spot:'Spot',BidAsk:'Bid-Ask',Curve:'Curve'})[c.shape]+'</td>'+cell(c.atFloor)+cell(c.belowFloor)+'<td title="'+esc(m.scenarioFeeLabel)+'" tabindex="0">'+(c.atFloor?scenarioHours(c.atFloor.scenarioBreakEvenHours,m.scenarioRate):'—')+'</td></tr>').join('')+'</tbody></table><p class="mpd-micro" title="'+esc(assumption)+'" tabindex="0">'+esc(m.scenarioCostLabel)+' · rough fee pace*</p>';
}
export function downsideSummaryHtml(row,m){
 const r=m.range,valid=r?.selected?.atFloor,scenario=(label,value)=>'<div><span>'+esc(label)+'</span><strong>'+esc(value&&finite(value.pnlSol)?sol(m.sizeSol+value.pnlSol)+' left':'Choose a valid range')+'</strong><small>'+esc(value&&finite(value.returnFraction)?pct(value.returnFraction)+' versus keeping SOL':'A dated price and valid floor are needed')+'</small></div>';
 const assumed=m.saleAssumed||m.fundingAssumed||m.taxAssumed,datedCost=m.sale?.retained;
 return '<div class="mpd-panel-head"><h3>Your downside scenario</h3></div><div class="mpd-downside-summary">'+scenario('At your floor',valid)+scenario('If price falls 10% below it',r?.selected?.belowFloor)+'</div><p class="mpd-micro">After conversion and modelled costs, before earned fees. '+(assumed?'Some costs are assumed; unverified token tax is excluded. ':datedCost?'Uses saved cost estimates. ':'')+'Price can fall further; the floor does not stop a loss.</p>';
}
function comparisonHtml(row,m){
 return sectionHeading('Fees to cover this range exit',row.feeRates?.asOf,'Withdrawal tax plus sale cost in the floor scenario, divided by position size times the 4h-window pool fee/TVL per hour. Network is a separate lifecycle allowance; fee share is rough.')+'<p><b>'+scenarioHours(m.range?.selected.atFloor.exitRecoveryHours,m.scenarioRate)+'</b> · '+esc(m.shape==='BidAsk'?'Bid-Ask':m.shape)+' · 4h window / hour · rough fee share</p>';
}
function ruleHtml(row,m){return sectionHeading('When to get out',row.trend?.asOf??row.pool?.fetchedAt,'A proposed rule for this range, not a recommendation based on a connected position. TVL decline requires your recorded entry TVL.')+'<p>Withdraw below the floor, at 4h volume &lt; $80k, or TVL −40% from entry. Above the top: reset only at 4h volume ≥ $150k.</p><p class="mpd-micro">Now: 4h volume '+usd(row.trend?.volume4h??m.pool.activity?.volume4h)+' · TVL '+usd(m.pool.tvlUsd)+'.'+(m.oneSided?' SOL-only waits for a dip; fees require trading inside the range.':'')+'</p>';}
function moreHtml(row,m){
 const p=m.pool,tax=row.safety?.rpc||{},flags=row.safety?.flags||[],holders=tax.concentration?.holders;
 const authority=v=>!m.rpcCurrent?'not verified':v===null?'off':typeof v==='string'&&v?'active':'not verified';
 const holderCurrent=m.rpcCurrent&&holders?.status==='available'&&fresh(holders.asOf,300000,m.now);
 return '<details class="mpd-more"><summary>Costs, safety &amp; assumptions</summary><div class="mpd-more-grid"><section>'+sectionHeading('Source & costs',m.sale?.dataAsOf??row.pool?.fetchedAt)+'<p data-mpd-cost-note>'+esc(m.sale?.label||m.scenarioCostLabel)+'. '+esc(m.mode==='dlmm'?'DLMM routes can use other Meteora pools.':'Best available route, possibly through another pool.')+' Selected pool: '+(m.sale?.quote.selectedPoolMatched===true?'matched':m.sale?.quote.selectedPoolMatched===false?'not matched':'not verified')+'.</p><p>Sale fraction '+pct(m.exitFraction)+' · funding '+(m.oneSided?'none for SOL-only':pct(m.fundingFraction))+'. Dated estimates or explicit assumptions stay fixed in stress scenarios; eventual exit size and liquidity can differ.</p><div class="mpd-extra-inputs"><label>Sale-cost assumption · %<input data-mpd-field="sale" type="number" min="0" max="100" step="any" placeholder="Use quote"></label><label>Funding-cost assumption · %<input data-mpd-field="funding" type="number" min="0" max="100" step="any" placeholder="Use quote"></label><label>Network allowance · SOL<input data-mpd-field="network" type="number" min="0" step="any" value="0.0001"></label><label>Refundable rent · SOL<input data-mpd-field="rent" type="number" min="0" step="any" value="0"></label></div><p>Network and rent are scenario assumptions. Rent is locked capital, not a loss. Safety checks require RPC policy within five minutes. Stress scenarios reuse dated costs and token policy for up to 60 minutes; absent sale costs use an assumed 0.5%, and unverified additional token tax is excluded. Two-sided funding also uses an assumed 0.5% if unavailable. Positive fee pace is reused only when dated within 60 minutes; otherwise recovery is ∞. Quotes refresh after ten minutes; none of these estimates can authorize a transaction.</p></section><section>'+sectionHeading('Pool & safety',tax.asOf??p.fetchedAt)+'<p>Step '+esc(m.binStep??'Unavailable')+' bps · base fee '+pct(row.config?.baseFee)+' · dynamic '+pct(row.config?.dynamicFee)+' · '+(finite(p.ageHours)?p.ageHours.toFixed(1)+'h old':'age unavailable')+'</p><p>Volume 1h / 4h / 24h: '+usd(row.trend?.volume1h)+' / '+usd(row.trend?.volume4h)+' / '+usd(row.trend?.volume24h)+' · 4h TVL change '+pct(row.trend?.tvlChange4h)+'.</p><p>Mint authority '+authority(tax.mintAuthority)+' · freeze '+authority(tax.freezeAuthority)+'. Transfer tax '+(m.tax.transferFeeBps===null?'not verified':(m.tax.transferFeeBps/100).toFixed(2)+'%')+'. Sampled holder top 10 '+pct(holderCurrent?holders.top10Fraction:null)+' · largest '+pct(holderCurrent?holders.top1Fraction:null)+'.</p>'+(flags.length?'<ul>'+flags.map(f=>'<li class="'+(f.severity==='attention'?'mpd-warn':'')+'">'+esc(f.label)+' · '+esc(f.source)+' '+esc(stamp(f.asOf))+'</li>').join('')+'</ul>':'<p>Checks '+esc(row.safety?.status&&row.safety.status!=='unknown'?row.safety.status:'incomplete')+'; no listed flags is not proof of safety.</p>')+'<p>'+esc(holders?.label||'Holder coverage unavailable.')+'</p></section><section>'+sectionHeading('Math & fee share',row.feeRates?.asOf)+'<p>Hourly pool fee density: 1h '+pct(row.feeRates?.h1)+' · 4h '+pct(row.feeRates?.h4)+' · 12h '+pct(row.feeRates?.h12)+'. Position fees are not measured. A tighter range does not automatically earn a known multiplier.</p><ul>'+(m.range?.assumptions||[]).map(a=>'<li>'+esc(a)+'</li>').join('')+'</ul></section></div></details>';
}

function readInput(controller){
 const field=name=>controller.dialog.querySelector('[data-mpd-field="'+name+'"]'),number=name=>{const v=field(name)?.value;return v===undefined||v.trim()===''?null:Number(v);};
 return {sizeSol:number('size'),shape:field('shape').value,oneSided:field('mix').value==='one',floorPriceSol:number('floor'),mode:controller.mode,saleCostFraction:number('sale')===null?null:number('sale')/100,fundingCostFraction:number('funding')===null?null:number('funding')/100,networkSol:field('network')?number('network'): .0001,positionRentSol:field('rent')?number('rent'):0};
}
function update(controller){
 if(!controller.row||!controller.dialog.open)return;
 const input=readInput(controller),m=poolDrawerModel(controller.row,input);controller.model=m;
 const preflight=controller.dialog.querySelector('[data-mpd-panel="preflight"]');if(preflight){const opened=[...(preflight.querySelectorAll?.('[data-preflight-why][open]')||[])].map(node=>node.dataset.preflightWhy);preflight.innerHTML=preflightHtml(controller.row,m);for(const id of opened)preflight.querySelector?.('[data-preflight-why="'+id+'"]')?.setAttribute('open','');}
 const downside=controller.dialog.querySelector('[data-mpd-panel="downside"]');if(downside)downside.innerHTML=downsideSummaryHtml(controller.row,m);
 const depth=controller.dialog.querySelector('[data-mpd-field="depth"]');if(depth&&(typeof document==='undefined'||document.activeElement!==depth))depth.value=positive(input.floorPriceSol)&&positive(m.reference)?((1-input.floorPriceSol/m.reference)*100).toFixed(2):'';
 for(const [name,html] of [['worth',worthHtml(controller.row,m)],['structure',structureHtml(controller.row,m)],['range',rangeHtml(controller.row,m)],['scenarios',scenariosHtml(controller.row,m)],['rule',ruleHtml(controller.row,m)]])controller.dialog.querySelector('[data-mpd-panel="'+name+'"]').innerHTML=html;
 const notes=controller.dialog.querySelector('[data-mpd-cost-note]');if(notes)notes.textContent=(m.sale?.label||m.scenarioCostLabel)+'. '+(m.mode==='dlmm'?'DLMM routes can use other pools.':'Best available route. ')+'Selected pool '+(m.sale?.quote.selectedPoolMatched===true?'matched':m.sale?.quote.selectedPoolMatched===false?'not matched':'not verified')+'. '+(m.oneSided?'No entry funding swap.':m.fund?'Half-size funding estimate '+stamp(m.fund.dataAsOf)+'.':'Half-size funding: '+pct(m.fundingFraction)+' assumed.');
 const more=controller.dialog.querySelector('.mpd-more-grid');
 if(more){const replacement=document.createElement('div');replacement.innerHTML=moreHtml(controller.row,m);const sections=replacement.querySelectorAll('.mpd-more-grid>section'),existing=more.querySelectorAll(':scope>section');for(const i of [1,2])if(existing[i]&&sections[i])existing[i].innerHTML=sections[i].innerHTML;if(existing[0]&&sections[0]){existing[0].querySelector('.mpd-panel-head').innerHTML=sections[0].querySelector('.mpd-panel-head').innerHTML;existing[0].querySelectorAll(':scope>p')[1].textContent='Sale fraction '+pct(m.exitFraction)+' · funding '+(m.oneSided?'none for SOL-only':pct(m.fundingFraction))+'. Fractions stay fixed in stress scenarios; eventual exit size and liquidity can differ.';}}
 controller.dialog.querySelector('.mpd-input-panel .mpd-panel-head').innerHTML=sectionHeading('Try a range',m.anchor?.asOf??controller.row.pool?.fetchedAt).replace(/^<div class="mpd-panel-head">|<\/div>$/g,'');
 controller.dialog.querySelector('[data-mpd-reference]').textContent='Reference '+price(m.reference)+' SOL/token · step '+(m.binStep??'Unavailable')+' bps';
 controller.signature=modelSignature(m,controller.row);
}
function modelSignature(m,row={}){return [!!m.anchor,!!m.sale,!!m.fund,m.feeCurrent,m.tax.transferFeeBps,m.sale?.markPriceSol,m.fund?.markPriceSol,m.exitFraction,m.fundingFraction,m.sale?.retained,m.scenarioRate,m.scenarioTax.transferFeeBps,m.taxAssumed,m.saleAssumed,m.overnightSuggested?.status,m.overnightSuggested?.floorPriceSol,m.overnightSuggested?.reason,...scorePreflight(row,m,m.now).lines.map(line=>line.status+':'+line.value+':'+line.reason)].join('|');}
function refreshAgedSources(controller){
 const m=poolDrawerModel(controller.row||{},readInput(controller)),signature=modelSignature(m,controller.row||{});
 if(signature!==controller.signature){if(controller.autoFloor)setDefault(controller);update(controller);}
}
function setDefault(controller){
 if(!controller.autoFloor)return;
 const mix=controller.dialog.querySelector('[data-mpd-field="mix"]').value==='one';
 const m=poolDrawerModel(controller.row,{sizeSol:controller.sizeSol,oneSided:mix,mode:controller.mode});
 if(m.suggested)controller.dialog.querySelector('[data-mpd-field="floor"]').value=String(m.suggested.floorPriceSol);
 controller.defaultNote=m.suggested?.capped?m.suggested.note:'';
 const note=controller.dialog.querySelector('[data-mpd-default]');if(note){note.textContent=controller.defaultNote;note.hidden=!controller.defaultNote;}
 controller.dialog.querySelector('[data-mpd-field="floor"]').title=controller.defaultNote||'Choose your actual floor. Explicit floors are preserved even when they exceed the 69-bin setup.';
}
export function applyFloorDepth(controller,value){
 const text=String(value),depth=Number(text),reference=poolDrawerModel(controller.row,readInput(controller)).reference;
 controller.autoFloor=false;
 controller.dialog.querySelector('[data-mpd-field="floor"]').value=text.trim()!==''&&finite(depth)&&depth>0&&depth<100&&positive(reference)?String(reference*(1-depth/100)):'';
 const note=controller.dialog.querySelector('[data-mpd-default]');note.textContent='Your floor is fixed at the price chosen now. Review the updated checks.';note.hidden=false;
 update(controller);
}
export function applySuggestedRange(controller){
 const current=poolDrawerModel(controller.row||{},readInput(controller)),suggestion=current.overnightSuggested;
 if(suggestion?.status!=='ready'){update(controller);message(controller,suggestion?.reason||'A range suggestion is not available.');return false;}
 controller.autoFloor=false;
 controller.dialog.querySelector('[data-mpd-field="shape"]').value='BidAsk';
 controller.dialog.querySelector('[data-mpd-field="mix"]').value='one';
 controller.dialog.querySelector('[data-mpd-field="floor"]').value=String(suggestion.floorPriceSol);
 controller.defaultNote='Suggested floor applied. Your chosen floor stays fixed when sources refresh; top and native alignment are recalculated below.';
 controller.dialog.querySelector('[data-mpd-field="floor"]').title=controller.defaultNote;
 const note=controller.dialog.querySelector('[data-mpd-default]');if(note){note.textContent=controller.defaultNote;note.hidden=false;}
 update(controller);
 message(controller,'Suggested range applied: Bid-Ask, SOL only, '+suggestion.binCount+' bins. Review the updated pre-flight and floor scenario.');
 controller.dialog.querySelector('[data-mpd-suggested]')?.focus?.({preventScroll:true});
 return true;
}
function fill(controller,row){
 controller.row=row;
 const m=poolDrawerModel(row,{sizeSol:controller.sizeSol,mode:controller.mode});
 controller.dialog.querySelector('[data-mpd-title]').textContent=m.pool.pair||'SOL pool';
 controller.dialog.querySelector('[data-mpd-source]').innerHTML=dated(m.pool.fetchedAt);
 if(!controller.initialized){controller.dialog.querySelector('[data-mpd-field="floor"]').value=m.suggested?String(m.suggested.floorPriceSol):'';controller.dialog.querySelector('[data-mpd-more]').innerHTML=moreHtml(row,m);controller.initialized=true;}
 setDefault(controller);update(controller);
 document.dispatchEvent(new CustomEvent('lp:main-pool-data',{detail:row}));
}
function message(controller,text){controller.dialog.querySelector('[data-mpd-status]').textContent=text;}
async function load(controller){
 const sequence=++controller.sequence;controller.abort?.abort();const abort=new AbortController();controller.abort=abort;
 const refresh=controller.dialog.querySelector('[data-mpd-refresh]');refresh.disabled=true;message(controller,controller.row?'Refreshing pool evidence…':'Reading pool, costs and price history…');
 const timeout=setTimeout(()=>abort.abort(),35000);
 try{const response=await fetch('/api/research/pool?'+new URLSearchParams({id:controller.id}),{method:'GET',cache:'no-store',signal:abort.signal}),row=await response.json();if(!response.ok||!row.pool)throw Error(row.error||'Pool detail is unavailable.');if(active!==controller||!controller.dialog.open||sequence!==controller.sequence)return;fill(controller,row);message(controller,'');document.dispatchEvent(new CustomEvent('lp:main-pool-refresh',{detail:{pool:controller.id,row}}));}
 catch(e){if(active!==controller||!controller.dialog.open||sequence!==controller.sequence)return;message(controller,(controller.row?'Saved sources shown; refresh failed. ':'Pool detail unavailable. ')+(e.name==='AbortError'?'The read timed out. Please try Refresh.':e.message));}
 finally{clearTimeout(timeout);if(active===controller&&sequence===controller.sequence)refresh.disabled=false;}
}
export function closePoolDrawer(){
 if(!active)return;const c=active;active=null;c.sequence++;c.abort?.abort();clearInterval(c.timer);document.body.style.overflow=c.previousOverflow;if(c.dialog.open)c.dialog.close();c.dialog.remove();if(c.returnFocus?.isConnected)c.returnFocus.focus({preventScroll:true});document.dispatchEvent(new CustomEvent('lp:main-pool-close',{detail:{pool:c.id}}));
}
export async function openPoolDrawer(row,options={}){
 closePoolDrawer();const pool=row?.pool||row||{},address=pool.address||String(pool.id||'').split(':').at(-1),id='solana:'+address;
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address||''))throw Error('Choose a valid catalogued Solana pool.');
 const dialog=document.createElement('dialog');dialog.id='mainPoolDrawer';dialog.className='mpd';dialog.setAttribute('aria-labelledby','mpdTitle');
 dialog.innerHTML='<header class="mpd-header"><div><h2 id="mpdTitle" data-mpd-title>'+esc(pool.pair||'SOL pool')+'</h2><div data-mpd-source>'+dated(pool.fetchedAt)+'</div></div><button type="button" data-mpd-refresh aria-label="Refresh pool sources" title="Refresh pool evidence">↻</button><button type="button" data-mpd-close aria-label="Close pool detail">×</button></header><div class="mpd-body"><section data-mpd-panel="preflight" aria-label="Paper pre-flight summary"><h3>Pre-flight</h3><p role="status">Reading dated pool evidence…</p></section><section class="mpd-input-panel">'+sectionHeading('Try a range',pool.fetchedAt)+'<form class="mpd-form mpd-essential-controls"><label>Paper size · SOL<input data-mpd-field="size" type="number" min="0.000001" max="1000000" step="any" value="'+esc(options.sizeSol??.5)+'"></label><label>Floor below current price · %<input data-mpd-field="depth" type="number" min="0.01" max="99.99" step="any" placeholder="Use suggested range"></label></form><p class="mpd-micro">Paper scenario only. Changing these values does not open a position.</p><p data-mpd-default class="mpd-micro" hidden></p></section><section data-mpd-panel="downside"></section><details class="mpd-advanced"><summary>Advanced: range, costs &amp; evidence</summary><div class="mpd-advanced-body"><div class="mpd-form mpd-technical-controls"><label>Range shape<select data-mpd-field="shape"><option value="Spot">Spot</option><option value="BidAsk" selected>Bid-Ask</option><option value="Curve">Curve</option></select></label><label>Entry mix<select data-mpd-field="mix"><option value="one">SOL only</option><option value="two">Two-sided</option></select></label><label class="mpd-floor">Exact floor · SOL per token<input data-mpd-field="floor" type="number" min="0" step="any" placeholder="Choose a floor"></label><span data-mpd-reference class="mpd-reference"></span></div><section data-mpd-panel="range"></section><section data-mpd-panel="worth"></section><section data-mpd-panel="structure"></section><section data-mpd-panel="scenarios"></section><section data-mpd-panel="rule"></section><div data-mpd-more></div></div></details>'+skippedHtml()+'<p data-mpd-status class="mpd-status" role="status" aria-live="polite"></p></div>';
 const c={dialog,id,row:null,model:null,sizeSol:options.sizeSol??.5,mode:options.mode==='dlmm'?'dlmm':'best',autoFloor:true,initialized:false,sequence:0,abort:null,returnFocus:document.activeElement,previousOverflow:document.body.style.overflow,signature:''};active=c;
 document.body.append(dialog);document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector('[data-mpd-close]').focus();
 dialog.addEventListener('cancel',e=>{e.preventDefault();closePoolDrawer();});dialog.addEventListener('close',()=>{if(active===c)closePoolDrawer();});
 dialog.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-mpd-suggested'))return applySuggestedRange(c);
  if(button.hasAttribute('data-mpd-save-skip')){const reason=dialog.querySelector('input[name="mpdSkipReason"]:checked')?.value,result=recordSkippedPool(c.row?.pool||pool,reason);dialog.querySelector('[data-mpd-skip-status]').textContent=result.ok?'Saved to your recent skips.':result.error;if(result.ok)dialog.querySelector('[data-mpd-skipped-log]').innerHTML=skippedLogHtml(result.entries);return;}
  if(button.hasAttribute('data-mpd-close'))return closePoolDrawer();if(button.hasAttribute('data-mpd-refresh'))return load(c);
  if(button.hasAttribute('data-mpd-support')){c.autoFloor=false;dialog.querySelector('[data-mpd-field="floor"]').value=button.dataset.mpdSupport;dialog.querySelector('[data-mpd-default]').textContent='Observed support selected; check bin count.';dialog.querySelector('[data-mpd-default]').hidden=false;update(c);return;}
  if(button.hasAttribute('data-mpd-copy')){const prior=c.model,current=poolDrawerModel(c.row,readInput(c));if(prior?.anchor&&!current.anchor){button.textContent='Refresh data to copy';return;}const r=current.range;if(!r)return;if(r.exceedsSetupBins){button.textContent='Narrow to 69 bins';return;}
   const text='Bottom '+exact(r.copyPrices.bottom)+'\nTop '+exact(r.copyPrices.top)+'\n'+r.copyPrices.convention+'\nSOL/token bounds '+exact(r.bottomPriceSol)+' to '+exact(r.topPriceSol)+(current.anchor?'\nNative bins '+r.lowerNativeBin+' to '+r.upperNativeBin+'; active '+current.anchor.activeBinId+'; as of '+current.anchor.asOf+'\nConfirm these native bin IDs after pasting prices into Meteora.':'\nEstimated grid: confirm the pool active bin and bounds in Meteora.');
   try{await navigator.clipboard.writeText(text);if(button.isConnected)button.textContent='Copied';message(c,'Copied range prices'+(current.anchor?' and native bin IDs.':'; alignment is an estimate.'));}catch{message(c,'Clipboard unavailable. Select the displayed bound fields to copy.');}
  }
 });
 dialog.querySelector('form').addEventListener('submit',e=>e.preventDefault());
 dialog.addEventListener('input',e=>{if(!e.target.matches('[data-mpd-field]'))return;if(e.target.dataset.mpdField==='depth')return applyFloorDepth(c,e.target.value);if(e.target.dataset.mpdField==='floor'){c.autoFloor=false;const note=dialog.querySelector('[data-mpd-default]');note.textContent='Custom floor selected; review its bin count and pre-flight checks.';note.hidden=false;}if(e.target.dataset.mpdField==='size')c.sizeSol=Number(e.target.value);update(c);});
 dialog.addEventListener('change',e=>{if(!e.target.matches('select[data-mpd-field]'))return;if(e.target.dataset.mpdField==='mix')setDefault(c);update(c);});
 if(row?.pool&&positive(row.priceSol))fill(c,row);
 document.dispatchEvent(new CustomEvent('lp:main-pool-open',{detail:{pool:id,sizeSol:c.sizeSol,mode:c.mode}}));
 c.timer=setInterval(()=>{if(active!==c||!dialog.open)return;refreshAgedSources(c);},1000);
 await load(c);return {close:()=>{if(active===c)closePoolDrawer();},refresh:()=>active===c?load(c):Promise.resolve(),element:dialog};
}
