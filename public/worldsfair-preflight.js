import {PREFLIGHT_THRESHOLDS as defaults} from './worldsfair-thresholds.js';

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const nonnegative=v=>finite(v)&&v>=0;
const positive=v=>finite(v)&&v>0;
const timestamp=v=>typeof v==='string'?Date.parse(v):NaN;
const fresh=(value,ttl,now)=>finite(timestamp(value))&&timestamp(value)<=now&&now-timestamp(value)<=ttl;
const fraction=v=>nonnegative(v)&&v<=1;
const pct=(v,d=1)=>finite(v)?(v*100).toFixed(d)+'%':'Unavailable';
const sol=v=>finite(v)?v.toFixed(4)+' SOL':'Unavailable';
const signed=v=>finite(v)?(v>0?'+':'')+pct(v):'Unavailable';
const date=v=>finite(timestamp(v))?new Date(v).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'date unavailable';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Pure scoring over the drawer's existing research row and range/cost model. */
export function scorePreflight(row={},m={},now=Date.now(),config=defaults){
  const c={...defaults,...config},pool=row.pool||{},rpc=row.safety?.rpc||{},sale=m.sale;
  const marketCurrent=fresh(pool.fetchedAt,c.marketMaxAgeMs,now);
  const policyCurrent=rpc.status==='available'&&fresh(rpc.asOf,c.policyMaxAgeMs,now);
  const feesCurrent=marketCurrent&&fresh(row.feeRates?.asOf,c.marketMaxAgeMs,now);
  const size=positive(m.sizeSol)?m.sizeSol:null;
  const rates=[row.feeRates?.h1,row.feeRates?.h4,row.feeRates?.h24];
  const daily=nonnegative(rates[2])?rates[2]*c.feeHorizonHours:null;
  const fullDay=finite(pool.ageHours)&&pool.ageHours>=c.feeHorizonHours;
  const validCost=size!==null&&nonnegative(m.referenceCost)&&nonnegative(m.referenceExit);
  const quoteCurrent=!!sale&&fresh(sale.asOf,c.quoteMaxAgeMs,now)&&finite(sale.expiresAt)&&sale.expiresAt>now&&!sale.retained;
  const costsCurrent=validCost&&quoteCurrent&&policyCurrent&&m.taxAssumed===false&&sale.exitFeeSource!=='assumed';
  const net=finite(daily)&&validCost?daily-m.referenceCost/size:null;
  const lines=[];
  const add=(id,label,status,value,reason)=>lines.push({id,label,status,value,reason});

  if(!finite(net))add('net','Net fee proxy · 24h','caution','Awaiting evidence','A dated 24h fee reading and complete costs are needed.');
  else if(!feesCurrent||!fullDay||!costsCurrent)add('net','Net fee proxy · 24h','caution',signed(net),'Saved, partial or assumed inputs; this cannot pass the screen.');
  else if(daily<c.minDailyFeeFraction)add('net','Net fee proxy · 24h','fail',signed(net),'Pool fees '+pct(daily)+' / day fall below the '+pct(c.minDailyFeeFraction)+' screen.');
  else if(net<=0)add('net','Net fee proxy · 24h','fail',signed(net),'Observed daily fees do not cover the reference round trip.');
  else add('net','Net fee proxy · 24h','pass',signed(net),pct(daily)+' pool fees minus '+pct(m.referenceCost/size)+' costs; exit is included once.');

  const costValue=validCost?'Round trip '+sol(m.referenceCost)+' · exit '+sol(m.referenceExit):'Awaiting a dated quote';
  if(!validCost)add('costs','Exit / round-trip cost','caution',costValue,'Jupiter quote evidence is missing; no zero-cost assumption.');
  else if(!costsCurrent)add('costs','Exit / round-trip cost','caution',costValue,'Dated fallback / incomplete policy · '+date(sale?.asOf)+'.');
  else if(m.referenceCost/size>c.cautionRoundTripFraction)add('costs','Exit / round-trip cost','caution',costValue,'Costs exceed '+pct(c.cautionRoundTripFraction)+' of size · '+date(sale.asOf)+'.');
  else add('costs','Exit / round-trip cost','pass',costValue,'Jupiter reference + withdrawal tax + network · '+date(sale.asOf)+'.');

  const floor=m.range?.selected?.atFloor;
  const scenarioValid=size!==null&&finite(floor?.returnFraction)&&finite(floor?.pnlSol)&&nonnegative(size+floor.pnlSol)&&(floor.unavailableReasons||[]).length===0;
  const scenarioCurrent=scenarioValid&&marketCurrent&&costsCurrent&&!m.saleAssumed&&!m.fundingAssumed&&!m.taxAssumed;
  const floorValue=scenarioValid?signed(floor.returnFraction)+' · '+sol(size+floor.pnlSol)+' left':'Choose a valid range';
  if(!scenarioValid)add('worst','At your chosen floor','caution',floorValue,'Complete range and cost evidence is needed for this scenario.');
  else if(!scenarioCurrent)add('worst','At your chosen floor','caution',floorValue,'Scenario includes dated or assumed costs; earned fees are excluded.');
  else if(floor.returnFraction<=-c.failFloorLossFraction)add('worst','At your chosen floor','fail',floorValue,'Loss reaches the '+pct(c.failFloorLossFraction)+' floor-loss screen; price can fall further.');
  else add('worst','At your chosen floor',floor.returnFraction<0?'caution':'pass',floorValue,'After conversion and costs, before earned fees; price can fall further.');

  const tax=rpc.transferFee,bps=tax?.bps,knownTax=Number.isInteger(bps)&&bps>=0&&bps<=10000;
  if(!policyCurrent)add('tax','Token-2022 transfer fee','caution','Awaiting current policy','Refresh the mint read to verify the rate and change authority.');
  else if(rpc.transferFeeStatus==='none')add('tax','Token-2022 transfer fee','pass','No transfer fee','Current mint read reports no transfer-fee extension.');
  else if(rpc.transferFeeStatus!=='known'||!knownTax)add('tax','Token-2022 transfer fee','caution','Rate unavailable','A verified fee schedule is needed before costs can pass.');
  else if(typeof tax.configAuthority==='string'&&tax.configAuthority.trim())add('tax','Token-2022 transfer fee','fail',pct(bps/10000,2)+' · changeable','The fee-setting authority is active and can change the tax.');
  else if(tax.configAuthority!==null)add('tax','Token-2022 transfer fee','caution',pct(bps/10000,2)+' · authority unverified','The current rate is known, but who can change it is unverified.');
  else add('tax','Token-2022 transfer fee','caution',pct(bps/10000,2)+' · fixed',validCost&&!m.taxAssumed?'Fee authority removed; withdrawal tax is included in costs.':'Fee authority removed; complete costs are still unavailable.');

  const holders=row.preflightEvidence?.holders||{},holderValid=holders.status==='available'&&fraction(holders.topFraction)&&fresh(holders.asOf,c.policyMaxAgeMs,now);
  if(!holderValid)add('holders','Top non-pool holder','caution','Awaiting verified holders','Pool, burn and known-locker exclusions need a current read.');
  else if(holders.topFraction>=c.maxTopHolderFraction)add('holders','Top non-pool holder','fail',pct(holders.topFraction)+' of supply','One observed owner meets or exceeds the '+pct(c.maxTopHolderFraction)+' limit after exclusions.');
  else if(!holders.complete)add('holders','Top non-pool holder','caution',pct(holders.topFraction)+' largest sampled','Excluded known pools, burn and lockers; incomplete supply cannot pass.');
  else add('holders','Top non-pool holder','pass',pct(holders.topFraction)+' of supply','Complete supply sample after pool, burn and known-locker exclusions.');

  const age=row.preflightEvidence?.tokenAge||{},ageValid=age.status==='available'&&nonnegative(age.minimumHours)&&fresh(age.asOf,c.marketMaxAgeMs,now);
  const structure=row.structure||{},window24=structure.windows?.find(w=>w.hours===c.feeHorizonHours);
  const spikeObserved=marketCurrent&&structure.status==='available'&&fresh(structure.asOf,c.structureMaxAgeMs,now)&&positive(window24?.low)&&positive(m.reference);
  const spikeKnown=spikeObserved&&window24.complete===true;
  const spike=spikeObserved?m.reference/window24.low:null;
  const ageText=ageValid?'At least '+age.minimumHours.toFixed(1)+'h':'Age evidence unavailable';
  if(spike>c.launchSpikeMultiple)add('age','Token age / launch spike','caution',ageText+' · '+spike.toFixed(2)+'× observed low','Launch-spike flag: above '+c.launchSpikeMultiple+'× '+(spikeKnown?'the complete 24h low.':'an observed low; partial coverage may miss a lower low.'));
  else if(!ageValid)add('age','Token age / launch spike','caution',ageText,'No verified age lower bound; a new pool does not prove a new token.');
  else if(age.minimumHours<c.minTokenAgeHours)add('age','Token age / launch spike','caution',ageText,'The lower bound does not yet prove '+c.minTokenAgeHours+'h of token age.');
  else if(!spikeKnown)add('age','Token age / launch spike','caution',ageText,'A complete, current 24h low is needed to rule out a launch spike.');
  else add('age','Token age / launch spike','pass',ageText+' · '+spike.toFixed(2)+'× low','Minimum age clears '+c.minTokenAgeHours+'h; no >'+c.launchSpikeMultiple+'× spike in the complete 24h window.');

  const lower=m.range?.bottomPriceSol,distance=positive(lower)&&positive(m.reference)?1-lower/m.reference:null;
  if(!finite(distance)||distance<0||distance>=1)add('floor','Floor distance','caution','Choose a valid floor','A current price and a lower range bound are needed.');
  else if(!marketCurrent)add('floor','Floor distance','caution',pct(distance)+' below price','The reference price is saved or undated; refresh before screening.');
  else if(distance+Number.EPSILON<c.minFloorDistanceFraction)add('floor','Floor distance','fail',pct(distance)+' below price','The overnight screen requires at least '+pct(c.minFloorDistanceFraction)+' below price.');
  else if(m.range.exceedsSetupBins)add('floor','Floor distance','fail',pct(distance)+' below price','This range exceeds the supported setup bin count.');
  else add('floor','Floor distance','pass',pct(distance)+' below price','The chosen range clears the '+pct(c.minFloorDistanceFraction)+' overnight depth screen.');

  const validTrend=rates.every(nonnegative),trendValue=validTrend?rates.map(rate=>pct(rate,3)).join(' / ')+' per hour':'Awaiting comparable fee windows';
  if(!validTrend||!feesCurrent||!fullDay)add('trend','Fee trend · 1h / 4h / 24h','caution',trendValue,'All three dated windows must be complete; rates are hourly equivalents.');
  else if(rates[0]===0||rates[1]===0||rates[2]===0)add('trend','Fee trend · 1h / 4h / 24h','caution',trendValue,'A zero-fee window cannot establish a steady earning pace.');
  else if(rates[0]<rates[1]*c.fadingRatio||rates[1]<rates[2]*c.fadingRatio)add('trend','Fee trend · 1h / 4h / 24h','caution',trendValue,'Fading: a shorter hourly pace is below '+pct(c.fadingRatio,0)+' of its longer window.');
  else add('trend','Fee trend · 1h / 4h / 24h','pass',trendValue,'Steady or rising under the '+pct(c.fadingRatio,0)+' comparison rule.');

  const status=lines.some(line=>line.status==='fail')?'fail':lines.some(line=>line.status==='caution')?'caution':'pass';
  return {status,verdict:status==='fail'?'Does not meet this screen':status==='caution'?'Review the cautions first':'Meets this paper screen',lines,netDailyFraction:net,dailyFeeFraction:daily,floorDistanceFraction:distance,spikeMultiple:spike};
}

const explainers={
  net:{label:'Fees after costs · 24h',why:'Past pool fees are compared with one complete entry-and-exit cost. This is a fee comparison, not your expected LP profit.'},
  costs:{label:'Cost to enter and leave',why:'Round trip includes the exit. These estimates include conversion, known token tax and the stated network allowance.'},
  worst:{label:'If price reaches your floor',why:'This estimates what remains after conversion and costs, without earned fees. The floor is not a stop-loss; price can fall further.'},
  tax:{label:'Token transfer fee',why:'Some tokens charge a fee when moved. An active fee-setting authority can change that cost after entry.'},
  holders:{label:'Largest holder outside pools',why:'One large holder can move the market by selling. Known pool, burn and locker accounts are excluded; an incomplete sample cannot clear this check.'},
  age:{label:'Token age & sharp price rises',why:'The age is a verified minimum, not a birth date. A price above '+defaults.launchSpikeMultiple+' times an observed '+defaults.feeHorizonHours+'h low is flagged for review.'},
  floor:{label:'Room below today’s price',why:'The overnight screen asks for a floor at least '+pct(defaults.minFloorDistanceFraction,0)+' below the reference price within the supported '+defaults.maxSuggestedBins+'-bin range.'},
  trend:{label:'Are fees slowing?',why:'The 1h, 4h and 24h windows are compared at an hourly pace. Falling activity may make earlier fees a poor guide.'}
};
function readableTrend(line){
  if(line.status==='pass')return 'Steady or rising';
  if(line.reason.startsWith('Fading:'))return 'Recent fee activity is slowing';
  if(line.reason.startsWith('A zero-fee'))return 'A recent window earned no fees';
  return 'Needs complete, current fee history';
}
export function preflightHtml(row,m,now=m?.now??Date.now()){
  const result=scorePreflight(row,m,now),label=status=>status[0].toUpperCase()+status.slice(1);
  const suggestion=m?.overnightSuggested,ready=suggestion?.status==='ready',suggestionNote=suggestion?.reason||'Refresh the pool for a dated price and bin step. Manual range controls are below.';
  const action='<div class="wf-suggested-range"><button type="button" class="wf-suggested-range-button" data-mpd-suggested aria-describedby="wfSuggestedRangeNote"'+(ready?'':' disabled')+'>Use suggested range</button><p id="wfSuggestedRangeNote" class="wf-suggested-range-note">'+esc(suggestionNote)+'</p></div>';
  return '<div class="wf-preflight-heading"><div><span class="eyebrow">PAPER PRE-FLIGHT</span><h3>Pre-flight</h3></div><span class="wf-preflight-status wf-'+result.status+'">'+label(result.status)+'</span></div><p class="wf-preflight-verdict">'+esc(result.verdict)+'</p>'+action+'<div class="wf-preflight-lines">'+result.lines.map(line=>{const text=explainers[line.id];return '<div class="wf-preflight-line" data-preflight="'+line.id+'"><div><b>'+esc(text.label)+'</b><span class="wf-preflight-status wf-'+line.status+'">'+label(line.status)+'</span></div><strong>'+esc(line.id==='trend'?readableTrend(line):line.value)+'</strong><details class="wf-preflight-why" data-preflight-why="'+line.id+'"><summary aria-label="Why: '+esc(text.label)+'">Why?</summary><p>'+esc(text.why)+'</p>'+(line.id==='trend'?'<p class="wf-preflight-evidence">1h / 4h / 24h: '+esc(line.value)+'.</p>':'')+'<p class="wf-preflight-evidence">'+esc(line.reason)+'</p></details></div>';}).join('')+'</div><p class="wf-preflight-note">These checks support a decision; they do not guarantee a return or cap your loss.</p><details class="wf-preflight-thresholds"><summary>Screen thresholds</summary><p>Daily pool fees must reach '+pct(defaults.minDailyFeeFraction,0)+' and cover the modelled round trip. A floor must be at least '+pct(defaults.minFloorDistanceFraction,0)+' below price; suggestions use at most '+defaults.maxSuggestedBins+' native bins. The largest classified holder must be below '+pct(defaults.maxTopHolderFraction,0)+'. Tokens need at least '+defaults.minTokenAgeHours+' hours of evidence. Missing or older evidence cannot pass.</p></details>';
}
