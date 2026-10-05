import {openPoolDrawer} from './main-pool-drawer.js';

// Catalogue and bounded detail reads only. No signing or transaction requests.
const MINUTE=60000;
export const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export const esc=value=>String(typeof value==='number'&&!Number.isFinite(value)?'Unavailable':value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=value=>finite(value)==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD',currencyDisplay:'narrowSymbol',notation:Math.abs(value)>=1000?'compact':'standard',maximumFractionDigits:1}).format(value);
export const percent=value=>finite(value)==null?'Unavailable':(value*100).toLocaleString('en-GB',{maximumFractionDigits:3})+'%';
export const hours=value=>finite(value)==null?'Unavailable':value<.05?'<0.1h':value.toLocaleString('en-GB',{maximumFractionDigits:1})+'h';
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'Time unavailable';
export const dataStamp=value=>value&&Number.isFinite(Date.parse(value))?'Data as of '+new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Source date unavailable';
export function groupStamp(rows){const timestamps=rows.map(r=>Date.parse(r.pool?.fetchedAt||'')),known=timestamps.filter(Number.isFinite);return {asOf:known.length?new Date(Math.min(...known)).toISOString():null,undated:timestamps.length-known.length};}
const fresh=(at,ttl,now=Date.now())=>{const n=Date.parse(at||'');return Number.isFinite(n)&&n<=now&&now-n<=ttl;};
const age=value=>finite(value)==null?'Age unavailable':value<1?Math.round(value*60)+'m old':value<48?value.toFixed(1)+'h old':(value/24).toFixed(1)+'d old';
const tone=value=>finite(value)==null?'mp-unknown':value>0?'mp-positive':value<0?'mp-negative':'mp-neutral';
const qFor=(row,size,mode)=>(row.quotes||[]).find(q=>Number(q.sizeSol)===size&&q.mode===mode);
const displayOrder=rows=>rows.filter(r=>finite(r.pool?.ageHours)==null||r.pool.ageHours<0||r.pool.ageHours>=24).concat(rows.filter(r=>finite(r.pool?.ageHours)!=null&&r.pool.ageHours>=0&&r.pool.ageHours<24));
export function currentQuote(q,now=Date.now()){
 const dates=[q?.asOf,q?.buyAsOf,q?.sellAsOf].map(v=>Date.parse(v||'')),oldest=Math.min(dates[1],dates[2]);
 return q?.status==='quoted'&&dates.every(n=>Number.isFinite(n)&&n<=now&&now-n<=45000)&&dates[0]===oldest&&finite(q.expiresAt)!=null&&q.expiresAt>now&&q.expiresAt<=oldest+45000&&finite(q.roundTripCostSol)!=null&&q.roundTripCostSol>=0;
}
export function economicQuote(q,now=Date.now()){
 const e=q?.economicEstimate,legs=[q?.buyAsOf,q?.sellAsOf].map(v=>Date.parse(v||'')),oldest=Math.min(...legs),at=Date.parse(e?.asOf||'');
 return ['available','stale'].includes(e?.status)&&e.costModelVersion===3&&legs.every(n=>Number.isFinite(n)&&n<=now&&now-n<=60*MINUTE)&&at===oldest&&fresh(e.dataAsOf,60*MINUTE,now)&&fresh(e.markAsOf,60*MINUTE,now)&&finite(e.expiresAt)!=null&&e.expiresAt<=oldest+10*MINUTE&&finite(e.retainedUntil)!=null&&e.retainedUntil>now&&e.retainedUntil<=oldest+60*MINUTE&&finite(e.roundTripCostSol)!=null&&e.roundTripCostSol>=0;
}
export function economicQuoteFresh(q,now=Date.now()){return economicQuote(q,now)&&q.economicEstimate.status==='available'&&q.economicEstimate.expiresAt>now&&fresh(q.economicEstimate.dataAsOf,10*MINUTE,now)&&fresh(q.economicEstimate.markAsOf,10*MINUTE,now);}
export function netFor(row,size=1,mode='best',window=4,now=Date.now()){
 const matches=n=>n&&Number(n.sizeSol)===size&&(n.mode||n.quoteMode)===mode&&n.horizonHours===window&&n.feeWindowHours===window;
 const n=(row.nets||[]).find(matches)||(matches(row.net)?row.net:null),q=qFor(row,size,mode),current=currentQuote(q,now)&&q?.economicEstimate?.costModelVersion===3,cached=economicQuote(q,now);
 const usable=n?.status==='estimated'&&finite(n.netFraction)!=null&&(current||cached)&&fresh(row.feeRates?.asOf,10*MINUTE,now)&&fresh(row.pool?.fetchedAt,10*MINUTE,now)&&fresh(n.dataAsOf,60*MINUTE,now)&&fresh(n.economicPolicyAsOf,60*MINUTE,now)&&finite(n.expiresAt)!=null&&n.expiresAt>now;
 return {model:n,quote:q,usable,net:usable?n.netFraction:null,netHourly:usable?(finite(n.netHourlyRate)??n.netFraction/window):null,exitHours:usable?finite(n.feesCoverExitHours??n.exitRecoveryHours):null,roundTripHours:usable?finite(n.feesCoverCostHours??n.roundTripRecoveryHours):null,kind:!usable?'unknown':current&&n.estimateCached!==true?'current':economicQuoteFresh(q,now)?'cached':'retained',asOf:usable?n.dataAsOf:null,expiresAt:usable?n.expiresAt:null,note:n?.note||q?.note||'No complete dated cost comparison is saved.'};
}
export function knownFlags(row,now=Date.now()){
 return (row.safety?.flags||[]).filter(f=>{
  const read=f.source==='RPC'?row.safety?.rpc:f.source==='RugCheck'?row.safety?.rugcheck:f.source==='DexScreener'?row.safety?.dexscreener:null;
  return read?.status==='available'&&fresh(read.asOf,f.source==='RugCheck'?10*MINUTE:5*MINUTE,now)&&fresh(f.asOf,f.source==='RugCheck'?10*MINUTE:5*MINUTE,now);
 });
}
export function safetyChips(row,now=Date.now()){
 const rpc=row.safety?.rpc,available=rpc?.status==='available'&&fresh(rpc.asOf,5*MINUTE,now),flags=knownFlags(row,now),chip=(text,kind='neutral',title='')=>'<span class="mp-chip mp-'+kind+'"'+(title?' title="'+esc(title)+'"':'')+'>'+esc(text)+'</span>';
 if(!available)return flags.slice(0,2).map(f=>chip(f.label,f.severity==='attention'?'flag':'neutral',f.source+' · '+date(f.asOf))).join('')+chip('Mint checks not verified','unknown',rpc?.note||'Open for dated mint checks.');
 const authority=(label,value)=>value===null?chip(label+' off'):typeof value==='string'&&value?chip(label+' active','flag'):chip(label+' not verified','unknown');
 const delegateFlag=flags.some(f=>f.code==='permanent-delegate'),extension=(rpc.extensions||[]).some(v=>/permanentDelegate/i.test(v));
 const extensionKnown=rpc.tokenProgram==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'||rpc.tokenProgram==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'&&['none','known'].includes(rpc.transferFeeStatus);
 const delegate=delegateFlag?chip('Delegate active','flag'):extension||!extensionKnown?chip('Delegate not verified','unknown'):chip('No delegate extension');
 const holders=rpc.concentration?.holders,accounts=rpc.concentration,ownerKnown=holders?.status==='available'&&fresh(holders.asOf,5*MINUTE,now),concentration=ownerKnown&&finite(holders.top10Fraction)!=null?chip('Top 10 sampled owners ≥'+percent(holders.top10Fraction),'neutral',holders.label):accounts&&finite(accounts.top10Fraction)!=null?chip('Top 10 accounts '+percent(accounts.top10Fraction),'neutral',accounts.label+' Owner grouping unavailable.'):chip('Concentration unavailable','unknown');
 const largest=ownerKnown&&finite(holders.top1Fraction)!=null?chip('Largest sampled owner ≥'+percent(holders.top1Fraction),'neutral',holders.label):accounts&&finite(accounts.top1Fraction)!=null?chip('Largest account '+percent(accounts.top1Fraction),'neutral',accounts.label+' Owner grouping unavailable.'):chip('Largest holder unavailable','unknown');
 const extra=flags.filter(f=>!['mint-authority','freeze-authority','permanent-delegate'].includes(f.code)).slice(0,2).map(f=>chip(f.label,f.severity==='attention'?'flag':'neutral',f.source+' · '+date(f.asOf))).join('');
 return authority('Mint',rpc.mintAuthority)+authority('Freeze',rpc.freezeAuthority)+delegate+largest+concentration+extra;
}
export function volumeDirection(row,now=Date.now()){
 const t=row.trend||{},current=finite(t.volume4h),previous=finite(t.previous4h);
 const gap=Date.parse(t.asOf||'')-Date.parse(t.previous4hAsOf||'');
 if(!fresh(t.asOf,10*MINUTE,now)||t.historyStatus!=='available'||!Number.isFinite(gap)||gap<4*60*MINUTE||gap>4*60*MINUTE+10*MINUTE||current==null||previous==null)return {text:'Prior 4h unavailable',kind:'mp-unknown',note:t.note||'A dated prior source window is required.'};
 if(previous===0)return {text:current===0?'→ No volume in either window':'↑ Activity resumed from zero',kind:'mp-neutral',note:'Current '+money(current)+'; prior '+money(previous)+' at '+date(t.previous4hAsOf)+'.'};
 const delta=current/previous-1;
 return {text:(delta>0?'↑ ':delta<0?'↓ ':'→ ')+percent(Math.abs(delta))+' vs prior 4h',kind:delta<0?'mp-decay':'mp-neutral',note:'Prior four-hour source window '+money(previous)+' at '+date(t.previous4hAsOf)+'. '+(t.note||'')};
}
export function rowModel(row,size=1,mode='best',now=Date.now()){
 const p=row.pool||{},nets=Object.fromEntries([1,4,12].map(h=>[h,netFor(row,size,mode,h,now)]));
 return {row,p,nets,feeFresh:fresh(row.feeRates?.asOf,10*MINUTE,now),sourceFresh:fresh(p.fetchedAt,10*MINUTE,now),freshPool:finite(p.ageHours)!=null&&p.ageHours>=0&&p.ageHours<24,direction:volumeDirection(row,now)};
}
export function freshnessKey(row,size=1,mode='best',now=Date.now()){
 return JSON.stringify([row.pool?.id,[1,4,12].map(h=>{const n=netFor(row,size,mode,h,now);return [n.kind,n.usable,n.netHourly];}),fresh(row.pool?.fetchedAt,10*MINUTE,now),fresh(row.feeRates?.asOf,10*MINUTE,now),fresh(row.trend?.asOf,10*MINUTE,now),fresh(row.safety?.rpc?.asOf,5*MINUTE,now),fresh(row.safety?.rpc?.concentration?.holders?.asOf,5*MINUTE,now),knownFlags(row,now).map(f=>f.code)]);
}
const costLabel=n=>n.kind==='current'?'Current estimate':n.kind==='cached'?'Cached · ≤10m':n.kind==='retained'?'Last good · ≤60m':'Cost unavailable';
const nameCell=m=>'<button type="button" class="mp-pool-open" data-main-pool="'+esc(m.p.id)+'">'+esc(m.p.pair||'Unnamed pool')+' <span aria-hidden="true">↗</span></button>'+(m.freshPool?'<span class="mp-chip mp-neutral" title="Pool is under 24 hours old">Fresh</span>':'')+'<span class="mp-sub">'+esc(age(m.p.ageHours))+' · '+(m.sourceFresh?'Source current':'Saved / undated source')+'</span><span class="mp-date">'+esc(date(m.p.fetchedAt))+'</span>';
const feeCell=(m,h)=>'<b class="mp-neutral">'+percent(m.row.feeRates?.['h'+h])+'</b><span class="mp-sub">'+(!m.feeFresh?'Saved · ':'')+h+'h window / hour</span><span class="mp-sub '+tone(m.nets[h].netHourly)+'">Net/h '+percent(m.nets[h].netHourly)+'</span>';
const netCell=m=>'<strong class="'+tone(m.nets[4].netHourly)+'">'+percent(m.nets[4].netHourly)+'</strong><span class="mp-sub">4h hold · full cost ÷ 4</span><span class="mp-chip mp-'+(['cached','retained'].includes(m.nets[4].kind)?'cached':m.nets[4].kind==='unknown'?'unknown':'neutral')+'" title="'+esc(m.nets[4].note)+'">'+costLabel(m.nets[4])+'</span><span class="mp-date">'+esc(date(m.nets[4].asOf))+'</span>';
const exitCell=m=>'<strong>'+hours(m.nets[4].exitHours)+'</strong><span class="mp-sub">Round trip '+hours(m.nets[4].roundTripHours)+'</span><span class="mp-sub">At observed 4h fee pace</span>';
const volumeCell=m=>'<span class="mp-volume-values">'+[1,4,24].map(h=>'<span>'+money(m.row.trend?.['volume'+h+'h'])+'<small>'+h+'h'+(finite(m.p.ageHours)!=null&&m.p.ageHours<h?' · partial':'')+'</small></span>').join('')+'</span><span class="mp-sub '+m.direction.kind+'" title="'+esc(m.direction.note)+'">'+esc(m.direction.text)+'</span>'+(m.direction.kind==='mp-decay'?'<span class="mp-chip mp-decay" title="Reported four-hour volume declined versus the dated prior four-hour window">Decay</span>':'')+'<span class="mp-date">'+esc(date(m.row.trend?.asOf))+'</span>';
const liquidityCell=m=>'<b>'+money(m.p.tvlUsd)+'</b><span class="mp-sub '+tone(m.row.trend?.tvlChange4h)+'">4h '+percent(m.row.trend?.tvlChange4h)+'</span>';
const configCell=m=>'<span>Bin step '+(finite(m.row.config?.binStep)==null?'Unavailable':esc(m.row.config.binStep))+'</span><span class="mp-sub">Base '+percent(m.row.config?.baseFee)+'</span><span class="mp-sub">Dynamic '+percent(m.row.config?.dynamicFee)+'</span>';
export function renderTable(rows,size=1,mode='best',now=Date.now()){
 const headers=[['Pool','Exact native-SOL Meteora pool; source time and pool age are displayed below its name.'],['Fees cover exit','Hours at the observed 4h pool fee pace needed to cover exit conversion, withdrawal tax and the declared exit network allowance.'],['Fees · 1h','Reported 1h fees divided by current pool TVL and one hour; net/h subtracts the full reference cost over a 1h hold.'],['Fees · 4h','Reported 4h fees divided by current pool TVL and four hours; this is a pool average, not a position yield.'],['Fees · 12h','Reported 12h fees divided by current pool TVL and twelve hours; windows longer than pool age remain unavailable.'],['4h net / hour','Four-hour gross pool fee proxy minus the full round-trip reference cost, withdrawal tax and network allowance, divided by four.'],['Volume · 1 / 4 / 24h','Actual reported source windows. Direction compares a stored four-hour window from four hours earlier, never overlapping-window subtraction.'],['Liquidity','Current source TVL and its change from an actual stored reading four hours earlier. Unavailable prior TVL stays unavailable.'],['Configuration','Bin step is the native price-grid step in basis points. Base and dynamic fees are pool source observations.'],['Token checks','Dated mint checks expire after five minutes. Sampled owners are grouped from the largest twenty token accounts and are lower bounds, including vaults/custodians.'],['Fee APR','Annualised past fee / TVL comparison. It does not predict future fees, price changes or LP profit.']];
 return '<div class="mp-table-wrap"><table class="mp-table"><caption class="mp-sr-only">Meteora native-SOL pools. Fees use measured source windows; net fee estimates subtract dated costs for '+size+' SOL.</caption><thead><tr>'+headers.map(([label,note])=>'<th scope="col" title="'+esc(note)+'">'+label+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>{const m=rowModel(row,size,mode,now);return '<tr><td>'+nameCell(m)+'</td><td>'+exitCell(m)+'</td><td>'+feeCell(m,1)+'</td><td>'+feeCell(m,4)+'</td><td>'+feeCell(m,12)+'</td><td>'+netCell(m)+'</td><td>'+volumeCell(m)+'</td><td>'+liquidityCell(m)+'</td><td>'+configCell(m)+'</td><td><div class="mp-checks">'+safetyChips(row,now)+'</div><span class="mp-date">RPC '+esc(date(row.safety?.rpc?.asOf))+'</span></td><td class="mp-neutral" title="Annualised source fee / TVL comparison; not a forecast or a position yield">'+percent(m.p.feeApr)+'</td></tr>';}).join('')+'</tbody></table></div>';
}
export function renderCards(rows,size=1,mode='best',now=Date.now()){
 return '<div class="mp-cards">'+rows.map(row=>{const m=rowModel(row,size,mode,now);return '<article class="mp-card" data-main-pool="'+esc(m.p.id)+'"><header>'+nameCell(m)+'</header><div class="mp-card-headline"><div><small>4h net / hour · '+size+' SOL</small>'+netCell(m)+'</div><div><small>Hours fees cover exit</small>'+exitCell(m)+'</div></div><div class="mp-card-fees" aria-label="Pool fee density per hour">'+[1,4,12].map(h=>'<div>'+feeCell(m,h)+'</div>').join('')+'</div><div class="mp-card-volume">'+volumeCell(m)+'</div><div class="mp-card-bottom"><div>'+liquidityCell(m)+'</div><div>'+configCell(m)+'</div><div><span class="mp-sub">Fee APR</span><span class="mp-neutral">'+percent(m.p.feeApr)+'</span></div></div><div class="mp-checks">'+safetyChips(row,now)+'</div><p class="mp-date">Mint checks '+esc(date(row.safety?.rpc?.asOf))+' · fee source '+esc(date(row.feeRates?.asOf))+'</p><button type="button" class="mp-card-open" data-main-pool="'+esc(m.p.id)+'">Open pool research <span aria-hidden="true">↗</span></button></article>';}).join('')+'</div>';
}
// Public overview: observed activity only. Cost and safety verdicts belong in pre-flight.
export function renderDiscoveryCards(rows,size=1,mode='best',now=Date.now()){
 const metric=(label,value,note='')=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>'+(note?'<small>'+esc(note)+'</small>':'')+'</div>';
 return '<div class="mp-discovery-cards">'+rows.map(row=>{
  const p=row.pool||{},poolFresh=fresh(p.fetchedAt,10*MINUTE,now),feeFresh=fresh(row.feeRates?.asOf,10*MINUTE,now),volumeFresh=fresh(row.trend?.asOf,10*MINUTE,now),knownAge=finite(p.ageHours)!=null&&p.ageHours>=0,young=knownAge&&p.ageHours<24;
  const daily=finite(row.feeRates?.h24),measured=daily!=null&&daily>=0&&!young,feeValue=measured?percent(daily*24):'—',feeNote=young?'Not yet a full day':measured?'Past 24h fees ÷ liquidity':'24h history pending';
  const liquidity=finite(p.tvlUsd),volume=finite(row.trend?.volume24h),cost=netFor(row,size,mode,4,now),costText=cost.usable?(cost.kind==='current'?'Cost estimate ready':'Saved cost estimate'):'Needs a cost check';
  return '<article class="mp-discovery-card"><header class="mp-discovery-card-header"><div><h3>'+esc(p.pair||'Unnamed pool')+'</h3><span>'+esc(knownAge?'Pool '+age(p.ageHours):'Pool age not verified')+'</span></div>'+(young?'<span class="mp-chip mp-neutral">New pool</span>':'')+'</header><dl class="mp-discovery-metrics">'+metric(feeFresh||!measured?'Fees / day':'Saved fees / day',feeValue,feeNote)+metric(poolFresh?'Liquidity':'Saved liquidity',liquidity!=null&&liquidity>=0?money(liquidity):'—',liquidity==null?'Reading needed':'')+metric(volumeFresh?'24h traded':'Saved 24h traded',volume!=null&&volume>=0?money(volume):'—',young?'Partial day':volume==null?'Reading needed':'')+'</dl><p class="mp-discovery-fee-note">Past pool activity, before costs. Your LP result will differ.</p><p class="mp-discovery-cost">'+esc(costText)+(cost.usable?' · '+esc(date(cost.asOf)):'')+'</p><p class="mp-discovery-date">'+esc(p.fetchedAt&&Number.isFinite(Date.parse(p.fetchedAt))?'Read '+date(p.fetchedAt):'Pool source date not verified')+(measured&&!row.feeRates?.asOf?' · Fee date not verified':row.feeRates?.asOf!==p.fetchedAt&&row.feeRates?.asOf?' · Fees '+esc(date(row.feeRates.asOf)):'')+(volume!=null&&!row.trend?.asOf?' · Trading date not verified':row.trend?.asOf!==p.fetchedAt&&row.trend?.asOf?' · Trading '+esc(date(row.trend.asOf)):'')+'</p><button type="button" class="mp-discovery-open" data-main-pool="'+esc(p.id)+'">Open pre-flight <span aria-hidden="true">↗</span></button></article>';
 }).join('')+'</div>';
}
export function queryFor(values){
 const params=new URLSearchParams({size:String(values.size)==='0.5'?'0.5':'1',mode:values.mode==='dlmm'?'dlmm':'best',sort:['net1','net4','net12','fees','volume'].includes(values.sort)?values.sort:'net4',hideFlagged:values.hideFlagged?'1':'0',limit:'100'}),window=values.sort==='net1'?1:values.sort==='net12'?12:4;
 params.set('horizon',String(window));params.set('feeWindow',String(window));
 for(const k of ['minTvl','minVolume4h','maxAge'])if(values[k]!==''&&values[k]!=null&&Number.isFinite(Number(values[k]))&&Number(values[k])>=0)params.set(k,String(values[k]));
 if(String(values.search||'').trim())params.set('search',String(values.search).trim());return params;
}
export function rankRows(rows,values,now=Date.now()){
 const h=values.sort==='net1'?1:values.sort==='net12'?12:4;
 return rows.filter(row=>!values.hideFlagged||!knownFlags(row,now).some(f=>f.severity==='attention')).slice().sort((a,b)=>{
  if(values.sort==='volume')return (finite(b.trend?.volume4h)??-Infinity)-(finite(a.trend?.volume4h)??-Infinity);
  if(values.sort==='fees')return (finite(b.feeRates?.h1)??-Infinity)-(finite(a.feeRates?.h1)??-Infinity);
  const an=netFor(a,Number(values.size),values.mode,h,now),bn=netFor(b,Number(values.size),values.mode,h,now);
  return Number(bn.usable)-Number(an.usable)||(bn.netHourly??-Infinity)-(an.netHourly??-Infinity)||(finite(b.feeRates?.h4)??finite(b.feeRates?.h1)??-Infinity)-(finite(a.feeRates?.h4)??finite(a.feeRates?.h1)??-Infinity)||String(a.pool?.id).localeCompare(String(b.pool?.id));
 });
}

export function mountMainPools(mount){
 mount.classList.add('mp-research');
 mount.dataset.publicLayout='cards';
 mount.innerHTML='<header class="mp-heading"><div><h2>Find a pool</h2></div><button type="button" data-mp-refresh>Refresh ↻</button></header><form class="mp-filters" data-mp-filters><label class="mp-search">Search pools<input name="search" type="search" placeholder="Token name or address" autocomplete="off"></label><details class="mp-advanced-filters"><summary>Advanced filters</summary><div class="mp-primary-controls"><label>Compare with<select name="size" aria-label="Pool comparison size"><option value="0.5">0.5 SOL</option><option value="1" selected>1 SOL</option></select></label><label>Conversion route<select name="mode" aria-label="Pool comparison route"><option value="best">Best route</option><option value="dlmm">DLMM only</option></select></label><label>Order by<select name="sort" aria-label="Pool research order"><option value="net4">Estimated net fees · 4h</option><option value="net1">Estimated net fees · 1h</option><option value="net12">Estimated net fees · 12h</option><option value="fees">Recent fees</option><option value="volume">Recent trading</option></select></label></div><div class="mp-secondary-controls"><label>Minimum liquidity · USD<input name="minTvl" type="number" min="0" step="any" value="5000" inputmode="numeric"></label><label>Minimum 4h trading · USD<input name="minVolume4h" type="number" min="0" step="any" placeholder="Any" inputmode="numeric"></label><label>Maximum pool age · hours<input name="maxAge" type="number" min="0" step="any" placeholder="Any" inputmode="numeric"></label><label class="mp-checkbox"><input name="hideFlagged" type="checkbox">Hide pools with known flags</label><button type="submit">Apply filters</button></div></details></form><div class="mp-discovery-toolbar"><p class="mp-status" data-mp-status role="status">Loading pools…</p><div class="mp-layout-switch" role="group" aria-label="Pool display"><button type="button" data-mp-layout="cards" aria-pressed="true">Cards</button><button type="button" data-mp-layout="table" aria-pressed="false">Detailed table</button></div></div><p class="mp-date" data-mp-asof>Checking source dates…</p><div data-mp-results aria-live="polite" aria-busy="true"></div><details class="mp-method"><summary>What do these numbers mean?</summary><p>Fees per day use the past 24 hours of reported pool fees divided by current liquidity. A newer pool needs a full day of history first. This is past activity before costs, not your expected profit. Your range, time in the pool and token prices change your result.</p><p>Open pre-flight for a dated cost estimate, token checks and the downside at your selected floor. Missing or older evidence stays clearly labelled. Paper actions do not move real funds.</p><p>The detailed table also compares shorter fee windows. Cost estimates refresh after ten minutes; saved estimates keep their original dates for up to sixty minutes. Hiding known flags only changes this list and does not establish safety.</p></details>';
 const form=mount.querySelector('[data-mp-filters]'),status=mount.querySelector('[data-mp-status]'),results=mount.querySelector('[data-mp-results]'),refresh=mount.querySelector('[data-mp-refresh]');
 let displayLimit=12,publicLayout='cards',catalogue=null,sequence=0,listController=null,warmController=null,warmActive=false,cooldownUntil=0,warmAttempts=0,warmWindowStartedAt=null,searchTimer=null,pollTimer=null,freshnessTimer=null;
 const warmed=new Map(),values=()=>Object.fromEntries([...new FormData(form),['hideFlagged',form.elements.hideFlagged.checked]]);
 const visible=()=>!document.hidden&&!mount.closest('[hidden]');
 const normalizedValues=()=>{const v=values();return {...v,size:form.elements.size.value,mode:form.elements.mode.value,sort:form.elements.sort.value,hideFlagged:form.elements.hideFlagged.checked};};
 const listRows=()=>rankRows(catalogue?.pools||[],normalizedValues());
 function render(){if(!catalogue)return;const v=normalizedValues(),rows=listRows(),shown=displayOrder(rows).slice(0,displayLimit);
  const tableSection=(title,items,freshGroup)=>{const stamp=groupStamp(items);return items.length?'<section class="mp-group'+(freshGroup?' mp-fresh-group':'')+'"><div class="mp-group-heading"><h3>'+title+'</h3><span>'+items.length+' pools · '+esc(dataStamp(stamp.asOf))+'</span></div>'+renderTable(items,Number(v.size),v.mode)+'</section>':'';};
  const content=publicLayout==='cards'?renderDiscoveryCards(shown,Number(v.size),v.mode):tableSection('Established pools & unverified ages',shown.filter(r=>finite(r.pool?.ageHours)==null||r.pool.ageHours<0||r.pool.ageHours>=24),false)+tableSection('Fresh pools · under 24h',shown.filter(r=>finite(r.pool?.ageHours)!=null&&r.pool.ageHours>=0&&r.pool.ageHours<24),true);
  results.innerHTML=rows.length?content+'<div class="mp-discovery-pagination"><p>Showing '+shown.length+' of '+rows.length+' pools</p>'+(shown.length<rows.length?'<button type="button" data-mp-more>Show '+Math.min(12,rows.length-shown.length)+' more</button>':'')+'</div>':'<p class="mp-empty">No pools found. Try another token or adjust the filters.</p>';
  mount.dataset.publicLayout=publicLayout;
  for(const button of mount.querySelectorAll('[data-mp-layout]'))button.setAttribute('aria-pressed',String(button.dataset.mpLayout===publicLayout));
  mount.querySelector('[data-mp-asof]').textContent=dataStamp(catalogue.updatedAt)+' · Solana / Meteora';
  results.dataset.freshness=rows.map(r=>freshnessKey(r,Number(v.size),v.mode)).join('|');
 }
 async function getJson(url,controller,timeout){const timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{method:'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal}),data=await response.json();if(!response.ok){const error=Error(data.error||'Pool research is unavailable.');error.status=response.status;error.retryAfter=response.headers.get('retry-after');throw error;}return data;}finally{clearTimeout(timer);}}
 const backoff=error=>{const seconds=Number(error.retryAfter),dateWait=Number.isFinite(seconds)?0:Date.parse(error.retryAfter||'')-Date.now();cooldownUntil=Date.now()+Math.max(MINUTE,Number.isFinite(seconds)?seconds*1000:0,Number.isFinite(dateWait)?dateWait:0,finite(error.retryAt)!=null?error.retryAt-Date.now():0);};
 const stagger=controller=>new Promise(resolve=>{const stop=()=>{clearTimeout(timer);resolve(false);},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve(visible()&&!controller.signal.aborted);},20000);controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();});
 function mergeDetail(detail){const i=catalogue?.pools.findIndex(row=>row.pool?.id===detail.pool?.id);if(i>=0){const old=catalogue.pools[i];catalogue.pools[i]={...old,...detail,pool:{...old.pool,...detail.pool}};render();}}
 // Public keyless capacity is shared with deliberate pre-flight and Paper
 // purchases. Catalogue refresh/search/pagination never spends it in background.
 async function warm(seq,rows,v){if(!visible()||seq!==sequence||Date.now()<cooldownUntil||!catalogue?.quotesConfigured||catalogue.quotaMode!=='keyed')return;
  const now=Date.now();if(warmWindowStartedAt!=null&&now-warmWindowStartedAt>=10*MINUTE){warmAttempts=0;warmWindowStartedAt=null;}for(const [id,at] of warmed)if(now-at>=10*MINUTE)warmed.delete(id);
  const address=String(v.search||'').trim().replace(/^solana:/,''),addressSearch=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address),exact=rows.find(r=>r.pool?.address===address||r.pool?.base?.address===address||r.pool?.quote?.address===address),selected=addressSearch?[exact||{pool:{id:'solana:'+address}}]:displayOrder(rows).slice(0,30).filter(r=>!economicQuoteFresh(qFor(r,Number(v.size),v.mode))).slice(0,Math.max(0,30-warmAttempts));
  const controller=new AbortController();warmController=controller;warmActive=true;let checked=0;
  try{for(const row of selected){const id=row.pool?.id;if(!visible()||seq!==sequence||Date.now()<cooldownUntil||controller.signal.aborted)break;if(!id||warmed.has(id))continue;
   if(!addressSearch&&warmAttempts>=30)break;if(checked&&!(await stagger(controller)))break;if(seq!==sequence||controller.signal.aborted)break;
   warmed.set(id,Date.now());if(!addressSearch){if(warmWindowStartedAt==null)warmWindowStartedAt=Date.now();warmAttempts++;}checked++;
   status.textContent='Updating costs for '+(row.pool.pair||'the searched pool')+'…';
   try{const detail=await getJson('/api/research/pool?'+new URLSearchParams({id,size:v.size,mode:v.mode}),controller,45000);if(seq!==sequence||controller.signal.aborted||!visible())return;if(detail.pool)mergeDetail(detail);
    if((detail.quotes||[]).some(q=>q.status==='rate-limited')){const retryAt=finite(detail.readHealth?.jupiterRetryAt);backoff({retryAt});status.textContent='Cost provider cooling down. Saved estimates keep their dates.';break;}
   }catch(error){if(seq!==sequence||controller.signal.aborted)return;if(error.status===429){backoff(error);status.textContent='Cost provider cooling down. You can still browse pools.';break;}}
  }
  if(seq===sequence&&Date.now()>=cooldownUntil)status.textContent=(catalogue?.pools?.length||0)+' pools to explore';
  }finally{if(warmController===controller)warmActive=false;}
 }
 async function load(allowWarm=true){const seq=++sequence;listController?.abort();warmController?.abort();listController=new AbortController();const v=normalizedValues();refresh.disabled=true;results.setAttribute('aria-busy','true');status.textContent=catalogue?'Refreshing pools…':'Loading pools…';
  try{const data=await getJson('/api/research/pools?'+queryFor(v),listController,25000);if(seq!==sequence)return;const rows=data.pools||data.rows;if(!Array.isArray(rows))throw Error('The saved catalogue has no pool list.');catalogue={...data,pools:rows,quotesConfigured:data.quotesConfigured??data.coverage?.jupiterConfigured??false};render();status.textContent=rows.length+' pools to explore'+(catalogue.quotesConfigured?(catalogue.quotaMode==='public'?'. Open a pool to check costs.':''):'. Cost checks are currently unavailable.');
   if(Date.now()<cooldownUntil)status.textContent+=' Provider checks paused until '+date(new Date(cooldownUntil).toISOString())+'.';
   if(allowWarm)queueMicrotask(()=>warm(seq,listRows(),v));
  }catch(error){if(seq!==sequence)return;if(error.status===429)backoff(error);if(catalogue)render();else results.innerHTML='<p class="mp-empty">Pools could not load. Use Refresh to try again.</p>';status.textContent='Refresh failed'+(catalogue?' · saved catalogue retained':'')+'. '+error.message;
  }finally{if(seq===sequence){refresh.disabled=false;results.setAttribute('aria-busy','false');}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();displayLimit=12;load();});form.addEventListener('change',event=>{if(event.target.name!=='search'){displayLimit=12;load();}});form.elements.search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{displayLimit=12;load();},400);});refresh.onclick=()=>load();
 mount.addEventListener('click',event=>{const layout=event.target.closest('[data-mp-layout]');if(layout?.dataset.mpLayout&&mount.contains(layout)){publicLayout=layout.dataset.mpLayout==='table'?'table':'cards';render();return;}const more=event.target.closest('[data-mp-more]');if(more&&'mpMore' in more.dataset&&mount.contains(more)){displayLimit+=12;render();return;}const button=event.target.closest('[data-main-pool]');if(!button||!mount.contains(button))return;const row=catalogue?.pools.find(r=>r.pool?.id===button.dataset.mainPool);if(row){const v=normalizedValues();openPoolDrawer(row,{sizeSol:Number(v.size),mode:v.mode});}});
 document.addEventListener('lp:main-pool-data',event=>{const row=event.detail?.row||event.detail;if(!catalogue||!row?.pool?.id)return;const i=catalogue.pools.findIndex(r=>r.pool.id===row.pool.id);if(i>=0){catalogue.pools[i]=row;render();}});
 freshnessTimer=setInterval(()=>{if(!visible()||!catalogue)return;const rows=listRows(),v=normalizedValues(),key=rows.map(r=>freshnessKey(r,Number(v.size),v.mode)).join('|');if(key!==results.dataset.freshness)render();},1000);
 pollTimer=setInterval(()=>{if(visible()&&!warmActive)load(true);},60000);
 document.addEventListener('visibilitychange',()=>{if(!visible())warmController?.abort();else load();});
 const observer=typeof MutationObserver==='function'?new MutationObserver(()=>{if(visible())load();else warmController?.abort();}):null,section=mount.closest('section');if(section)observer?.observe(section,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('pagehide',()=>{sequence++;listController?.abort();warmController?.abort();observer?.disconnect();clearTimeout(searchTimer);clearInterval(pollTimer);clearInterval(freshnessTimer);},{once:true});load();
 return {load,rows:listRows};
}
const mount=typeof document==='undefined'?null:document.getElementById('mainResearchMount');if(mount)mountMainPools(mount);
