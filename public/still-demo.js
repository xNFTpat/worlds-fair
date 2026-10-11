// This page can only call read-only evidence routes and the isolated paper ledger.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, places = 4) => finite(value) ? value !== 0 && Math.abs(value) < 10 ** -places ? value.toExponential(2) : value.toLocaleString('en-GB', {maximumFractionDigits: places}) : 'Unavailable';
export const sol = value => finite(value) ? `${number(value, 6)} SOL` : 'Unavailable';
const signed = value => finite(value) ? `${value >= 0.0000005 ? '+' : ''}${sol(Math.abs(value)<0.0000005?0:value)}` : 'Unavailable';
const percent = value => finite(value) ? `${number(value * 100, Math.abs(value*100)<.01?4:2)}%` : 'Unavailable';
const money = value => finite(value) ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value) : 'Unavailable';
const short = address => address ? `${address.slice(0,5)}…${address.slice(-4)}` : 'Unavailable';
const date = at => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}) : 'Time unavailable';
const age = hours => finite(hours) ? hours < 24 ? `${number(hours,1)} hours` : `${number(hours / 24,1)} days` : 'Unavailable';
const source = value => `<small class="source">${esc(value?.source || 'Source unavailable')} · ${esc(date(value?.asOf))}</small>`;
const metric = (label, value, format = sol) => `<div class="metric"><span>${esc(label)}</span><strong class="${value?.value == null ? 'unavailable' : ''}">${esc(format(value?.value))}</strong>${source(value)}</div>`;
const tag = risk => `<span class="tag ${esc((risk?.label || '').toLowerCase())}">${esc(risk?.label || 'Unavailable')}</span>`;
const heading = (eyebrow, title, copy, action = '') => `<div class="screen-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2 tabindex="-1">${esc(title)}</h2><p>${esc(copy)}</p></div>${action}</div>`;
export function groupPositions(positions) {
  const groups = new Map();
  for (const position of positions || []) {
    if (!groups.has(position.poolAddress)) groups.set(position.poolAddress, {poolAddress:position.poolAddress,name:position.name,positions:[]});
    groups.get(position.poolAddress).positions.push(position);
  }
  return [...groups.values()];
}
export function preflightIsFresh(data, now = Date.now()) {
  const prices = data?.components ? data.components.map(item=>item.preflight.priceSol) : [data?.priceSol];
  return prices.length > 0 && prices.every(item=>item?.asOf && finite(item.value) && Number.isFinite(Date.parse(item.asOf)) && Date.parse(item.asOf)<=now && now-Date.parse(item.asOf)<=600000);
}
export function requestFingerprint(action, body) { return JSON.stringify([action, body]); }

export function readOnboarding(storage) {
  try { const saved=JSON.parse(storage.getItem('still:onboarding:v1')||'null'); return {complete:saved?.complete===true, preference:['calm','balanced','quick'].includes(saved?.preference)?saved.preference:'balanced'}; }
  catch { return {complete:false,preference:'balanced'}; }
}
export function sortForPreference(pools,preference) {
  const order={calm:['Steady','Busy','Spicy'],balanced:['Busy','Steady','Spicy'],quick:['Spicy','Busy','Steady']}[preference]||['Busy','Steady','Spicy'];
  return [...pools].sort((a,b)=>order.indexOf(a.risk.label)-order.indexOf(b.risk.label));
}
if (typeof document !== 'undefined') {
const $ = selector => document.querySelector(selector);
const state = {view:'home',pool:null,basket:null,preflight:null,account:null,pools:[],baskets:[],amount:'0.5',range:null,load:0,pending:null,poolData:null,positionTab:'open'};
let preferences; try {preferences=readOnboarding(localStorage);} catch {preferences={complete:false,preference:'balanced'};}
let onboardingStep=0;
const expandedGroups=new Set();
function readSaved(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{toast("Couldn't save that. Your pick still works this session.");}}
let poolPrefs=readSaved('still:pools:v1',{sort:'pace',filter:'All'});
if(!['pace','fees','ratio','newest','steady'].includes(poolPrefs.sort)||!['All','Steady','Busy','Spicy'].includes(poolPrefs.filter))poolPrefs={sort:'pace',filter:'All'};
const verdictLabel=label=>label==='Skip'?'Skip for now':label==='Worth it'?'Worth a look':label;
const holdLabel=minutes=>minutes<60?`${minutes} minutes`:`${number(minutes/60,1)} hours`;
const sumKnown=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):values.length?null:0;

const screen = $('#screen'), dialog = $('#confirmation');
let dialogAction = null, submitting = false, noticeTimer;
const pendingKey = 'still:guided:pending:v1';
let pendingReadError = false;
function readPending() { try { const value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); pendingReadError = !!value && (!['still-open','still-basket','still-close','still-follow','still-unfollow','still-bot'].includes(value.action) || !value.body?.requestId); return pendingReadError ? {invalid:true} : value; } catch { pendingReadError = true; return {invalid:true}; } }
function savePending(pending) { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); state.pending = pending; }
function clearPending() { sessionStorage.removeItem(pendingKey); state.pending = null; }
async function api(path, body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, {method:body ? 'POST':'GET', credentials:'same-origin', cache:'no-store', headers:body ? {'content-type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {}), signal:controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error('The server response could not be read. Try again.'); }
    if (!response.ok) {const error = new Error(data.error || 'This request could not be completed.'); error.status = response.status; throw error;}
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('The request is taking too long. Retry to check the same paper action.'); throw error; }
  finally { clearTimeout(timeout); }
}
function toast(message) { clearTimeout(noticeTimer); $('#notice').textContent = message; $('#notice').hidden = false; noticeTimer = setTimeout(() => $('#notice').hidden = true, 6000); }
function loading(message, count = 2) { screen.setAttribute('aria-busy','true'); screen.innerHTML = `<p class="loading-label" role="status">${esc(message)}</p><div class="cards">${Array.from({length:count},()=>'<div class="skeleton" aria-hidden="true"></div>').join('')}</div>`; }
function show(html) { screen.setAttribute('aria-busy','false'); screen.innerHTML = html; }
function errorPanel(message, retry = state.view) { show(`<div class="empty error"><h3>This reading is unavailable</h3><p>${esc(message)}</p><button class="primary" data-go="${esc(retry)}">Try again</button> <button class="text-button" data-go="pools">Choose a pool</button></div>`); }
function pendingBanner() { const pending = readPending(); if (pendingReadError) return `<div class="panel error"><h3>Saved action unavailable</h3><p class="note">Browser storage could not be read. Check your positions before trying another deposit. Restore storage access and reload to recover the saved request.</p><button class="secondary" data-go="positions">Check positions</button></div>`; return pending ? `<div class="panel"><h3>A paper action needs checking</h3><p class="note">${esc(pending.description || 'The last response was interrupted.')} Retry the saved request to check its result without opening or closing twice.</p><button class="secondary" data-action="resume">Check saved action</button></div>` : ''; }
async function ensureAccount() { if (!state.account) { const data = await api('/api/paper/still-account'); state.account = data.account; } return state.account; }
function navigate(view, replace = false) {
  if (!['home','pools','preflight','positions','baskets','basket-preflight','onboarding','follow','park','learn'].includes(view)) view = 'home';
  if (view === 'preflight' && !state.pool) view = 'pools';
  if (view === 'basket-preflight' && !state.basket) view = 'baskets';
  const path = view === 'home' ? location.pathname + location.search : '#' + view;
  if (location.hash !== path) history[replace ? 'replaceState':'pushState'](null,'',path);
  state.view = view;
  $('#home').hidden = view !== 'home'; if($('#pillars'))$('#pillars').hidden=view!=='home'; $('#journey').hidden = view === 'home';
  for (const button of document.querySelectorAll('.steps button')) button.setAttribute('aria-current', button.dataset.go === (view === 'basket-preflight' ? 'baskets' : view) ? 'step':'false');
  for(const button of document.querySelectorAll('.primary-nav button,.mobile-nav button'))button.setAttribute('aria-current',button.dataset.go===(view==='preflight'||view==='basket-preflight'||view==='baskets'?'pools':view)?'page':'false');
  $('#step-preflight').disabled = !state.pool;
  window.scrollTo({top:0,behavior:'instant'});
  if (view !== 'home') loadView(view); else {state.load++;onboardingStep=0;}
}
async function loadView(view) {
  const load = ++state.load;
  loading({pools:'Loading pools from Meteora…',positions:'Marking positions to live prices…',baskets:'Loading pools from Meteora…',preflight:'Running checks…','basket-preflight':'Running checks…',follow:'Loading strategies…',park:'Getting live vault and basket rates…',learn:'Loading lesson…'}[view]||'Getting live pool data…');
  try {
    if(view==='onboarding'){renderOnboarding();ensureAccount().then(()=>{if(load===state.load)renderOnboarding();}).catch(()=>{});return;}
    if(view==='follow'){const data=await api('/api/paper/still-account');if(load!==state.load)return;state.account=data.account;state.strategies=data.strategies||[];renderFollow();return;}
    if(['park','learn'].includes(view)){renderPreview(view);return;}
    if (view === 'pools') {
      const [data] = await Promise.all([api('/api/still/pools'),ensureAccount()]); if (load !== state.load) return;
      state.pools = sortForPreference(data.pools,preferences.preference); state.poolData=data;state.baskets=data.baskets||[]; renderPools(data);
    } else if (view === 'preflight' || view === 'basket-preflight') {
      const basket = view === 'basket-preflight';
      const params = new URLSearchParams({amountSol:state.amount,[basket ? 'basketId':'poolAddress']:basket ? state.basket.id : state.pool.address});
      if(!basket&&state.range)params.set('range',JSON.stringify(state.range));
      const [data] = await Promise.all([api(`/api/still/${basket ? 'basket-preflight':'preflight'}?${params}`),ensureAccount()]); if (load !== state.load) return;
      state.preflight = data; renderPreflight(data,basket);
    } else if (view === 'positions') {
      const data = await api('/api/paper/still-account'); if (load !== state.load) return;
      state.account = data.account; renderPositions();
    } else if (view === 'baskets') {
      const [data] = await Promise.all([api('/api/baskets'),ensureAccount()]); if (load !== state.load) return;
      state.baskets = data.baskets; renderBaskets(data);
    }
  } catch (error) { if (load === state.load){
    const copy={follow:"Couldn't load paper results.",pools:`Couldn't reach Meteora. Last update ${date(state.poolData?.updatedAt)}.`,preflight:"Couldn't run pre-flight for this pool.",positions:`Prices are stale since ${date(state.account?.updatedAt)}. Net may be out of date.`}[view]||error.message;
    show(`<div class="empty error"><h3>${esc(copy)}</h3><p>${esc(error.message)}</p><button class="primary" data-go="${view==='preflight'?'pools':esc(view)}">${view==='preflight'?'Back to pools':view==='positions'?'Refresh':'Try again'}</button></div>`);
  }}
}
function renderOnboarding() {
  const steps=[['You lend tokens to a pool. Traders pay you fees.', 'On Meteora you pick a price range. While the price trades inside it, you earn a share of every swap. If the price leaves your range, you stop earning, and you may end up holding more of the token that fell.'],['This is paper.', 'Nothing here touches your wallet. Positions use live prices and fees, but the money is pretend. Use it to see what a trade would cost you before it does.'],['How calm do you want to be?', 'This sets your defaults. Change it any time in Settings.']];
  const [title,copy]=steps[onboardingStep];
  show(`<div class="onboarding"><div class="intro-top"><div class="step-dots" aria-label="Step ${onboardingStep+1} of 3">${[0,1,2].map(n=>`<i class="${n===onboardingStep?'selected':''}"></i>`).join('')}</div><button class="text-button" data-onboard="skip">Skip intro</button></div><h2>${title}</h2>${onboardingStep!==2?`<p>${copy}</p>`:''}${onboardingStep===0?'<div class="lesson-range" role="img" aria-label="Illustration: inside your range, trades use your liquidity; below it you hold the paired token, above it SOL"><span>Paired token</span><b>Your range<i class="price-dot"></i></b><span>SOL</span></div>':onboardingStep===1?`<div class="balance"><div><span>Your practice balance</span><strong>${sol(state.account?.balanceSol)}</strong><small class="source">Still paper ledger · ${esc(date(state.account?.updatedAt))}</small></div></div>`:`<div class="pace-options" role="group" aria-label="Your preferred pace">${['calm','balanced','quick'].map(key=>`<button class="secondary" data-pace="${key}" aria-pressed="${preferences.preference===key}"><strong>${key[0].toUpperCase()+key.slice(1)}</strong><span>${{calm:'Wider ranges, established pools, fewer prompts.',balanced:'A mix. Some busy pools, sensible floors.',quick:'Narrow, short positions on busy pools. More checks, more attention.'}[key]}</span></button>`).join('')}</div><p class="note">${copy}</p>`}<div class="onboarding-actions"><button class="primary" data-onboard="${onboardingStep===2?'finish':'next'}">${['Next','Got it','Show me pools'][onboardingStep]}</button>${onboardingStep?'<button class="text-button" data-onboard="back">Back</button>':''}</div></div>`);
}
function finishOnboarding(){preferences.complete=true;try{localStorage.setItem('still:onboarding:v1',JSON.stringify(preferences));}catch{show(`<div class="empty"><h3>Couldn't save that. Your pick still works this session.</h3><button class="primary" data-go="pools">Continue</button></div>`);return;}navigate('pools');}
function renderPreview(view){
  const details={follow:['Follow a strategy','Choose a pace you can understand.','The new strategy cards are being prepared. Existing paper trials are available in Advanced.','/advanced#bot','Explore paper trials'],park:['Park your profits','A purpose for your next step.','The new profit allocation flow is being prepared. You can keep practising with pools while it is completed.','#pools','Explore pools'],learn:['Learn','A little clarity goes a long way.','An LP range defines where your liquidity can trade. Outside the range, you hold one side and stop earning swap fees. Price moves and exit costs can outweigh the fees you earn.','/advanced#learn','Read the existing guide']}[view];
  show(heading(details[0],details[1],details[2])+`<div class="panel"><a class="secondary" href="${details[3]}">${details[4]} ↗</a></div>`);
}
function mixCards(){return `<section class="starter-mixes"><h3>Starter mixes</h3><p class="note">Not sure where to begin? Three ready-made paper sets.</p><div class="mix-grid">${state.baskets.map(b=>`<article class="panel"><h3>${esc(b.name)}</h3><p>${esc(b.reason)}</p><small class="source">${esc(b.source)} · ${esc(date(b.asOf))}</small><button class="text-button" data-basket="${esc(b.id)}" ${b.status!=='available'?'disabled':''}>Try this mix on paper</button>${b.status!=='available'?'<small class="source">Unavailable. Waiting for enough eligible live pools.</small>':''}</article>`).join('')}</div></section>`;}
function renderPools(data) {
  let pools=state.pools.filter(p=>poolPrefs.filter==='All'||p.risk.label===poolPrefs.filter);
  const rank={Steady:0,Busy:1,Spicy:2},value=(p,key)=>finite(p[key]?.value)?p[key].value:null;
  if(poolPrefs.sort!=='pace')pools=[...pools].sort((a,b)=>{
    const key={fees:'fees24hUsd',ratio:'fees24hFraction',newest:'ageHours'}[poolPrefs.sort];
    if(!key)return rank[a.risk.label]-rank[b.risk.label];
    const av=key==='fees24hUsd'?finite(a.tvlUsd.value)&&finite(a.fees24hFraction.value)?a.tvlUsd.value*a.fees24hFraction.value:null:value(a,key),bv=key==='fees24hUsd'?finite(b.tvlUsd.value)&&finite(b.fees24hFraction.value)?b.tvlUsd.value*b.fees24hFraction.value:null:value(b,key);
    return av===null?bv===null?0:1:bv===null?-1:poolPrefs.sort==='newest'?av-bv:bv-av;
  });
  const cards=pools.map(pool=>`<article class="pool-card"><div class="card-title"><div><h3>${esc(pool.name)}</h3><small>${esc(short(pool.address))}</small></div><span title="Tags describe how a pool behaves, not whether it's a good idea.">${tag(pool.risk)}</span></div><p class="reason">${esc(pool.risk.reason)}</p><div class="metrics pool-metrics">${metric('Fees 24h',{...pool.fees24hFraction,value:finite(pool.fees24hFraction.value)&&finite(pool.tvlUsd.value)?pool.fees24hFraction.value*pool.tvlUsd.value:null},money)}${metric('TVL',pool.tvlUsd,money)}${metric('Fees/TVL',pool.fees24hFraction,percent)}${metric('Bin step',pool.binStep,v=>finite(v)?number(v,0)+' bps':'Unavailable')}${metric('Age',pool.ageHours,age)}${metric('1h fee trend',pool.feeTrend,v=>finite(v)?`${v>0?'+':''}${percent(v)}`:'Unavailable')}</div><button class="secondary" data-pool="${esc(pool.address)}">Run pre-flight ↗</button></article>`).join('');
  const cell=(v,format)=>`<td>${esc(format(v?.value))}${source(v)}</td>`;
  const table=`<table class="pool-table"><caption class="sr-only">Live SOL-paired Meteora pools</caption><thead><tr>${['Pool','Fees 24h','TVL','Fees/TVL','Bin step','Age','Tag'].map(l=>`<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${pools.map(p=>`<tr><th scope="row"><button class="text-button" data-pool="${esc(p.address)}">${esc(p.name)}</button><small class="source">${esc(short(p.address))}</small><small class="source">${esc(p.risk.reason)}</small></th>${cell({...p.fees24hFraction,value:finite(p.fees24hFraction.value)&&finite(p.tvlUsd.value)?p.fees24hFraction.value*p.tvlUsd.value:null},money)}${cell(p.tvlUsd,money)}${cell(p.fees24hFraction,percent)}${cell(p.binStep,v=>number(v,0)+' bps')}${cell(p.ageHours,age)}<td>${tag(p.risk)}<small class="source">1h fee trend: ${finite(p.feeTrend.value)?percent(p.feeTrend.value):'Unavailable'}</small>${source(p.feeTrend)}</td></tr>`).join('')}</tbody></table>`;
  show(heading('Practise','Pick a pool','Live Meteora DLMM pools. Tap one to run a pre-flight check.','<button class="secondary" data-go="pools">Refresh</button>')+`<p class="note">Nothing is deposited. Data from Meteora, updated ${esc(date(data.updatedAt))}.</p>`+pendingBanner()+mixCards()+`<div class="pool-controls"><label>Sort <select id="pool-sort">${[['pace','Your pace'],['fees','Most fees'],['ratio','Fees/TVL'],['newest','Newest'],['steady','Steadiest']].map(([v,l])=>`<option value="${v}" ${poolPrefs.sort===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="filter-chips" aria-label="Pool tags">${['All','Steady','Busy','Spicy'].map(f=>`<button class="secondary" data-filter="${f}" aria-pressed="${poolPrefs.filter===f}">${f}</button>`).join('')}</div></div><p class="note">Tags describe how a pool behaves, not whether it's a good idea. <button class="text-button" data-action="preferences">Change pace</button></p>`+(cards?`${table}<div class="cards pool-list">${cards}</div>`:`<div class="empty"><h3>No pools match these filters.</h3><button class="primary" data-filter="All">Clear filters</button></div>`));
}
function costRow(label,evidence,format=sol) { return `<div class="cost-row"><div>${esc(label)}${source(evidence)}<small class="source">${esc(evidence?.note || '')}</small></div><strong>${esc(format(evidence?.value))}</strong></div>`; }
function scenarioCards(data) { return `<section class="panel"><h3>If the paired token price in SOL falls…</h3><p class="note">Both scenarios are in SOL terms, before fees and trading costs. The price floor is not a stop-loss.${data.basket ? ' Each paired token falls by the same percentage.' : ''}</p><div class="scenario-grid">${data.scenarios.map(item=>`<article class="scenario"><h4>Price drops ${percent(item.dropFraction)}</h4><strong>${sol(item.grossValueSol.value)}</strong><small>Modelled inventory value</small>${source(item.grossValueSol)}<p class="note">${signed(item.grossPnlSol.value)} vs holding ${sol(data.sizeSol)}<br>Net proceeds: ${sol(item.netValueSol.value)}</p></article>`).join('')}</div><p class="note">Holding SOL keeps ${sol(data.sizeSol)} in either scenario. This ideal model follows a downward price path through the bins. It excludes transfer taxes, slippage and liquidity limits.</p></section>`; }
function rangePanel(data) {
  const range = data.range;
  if (!range) return `<section class="panel"><h3>Suggested range unavailable</h3><p class="note">A current price and a valid bin configuration are needed. Return to the pool list to choose another pool.</p></section>`;
  const bins = range.bins || [], allocation=bin=>(bin.sol||0)+(bin.token||0)*(data.priceSol.value||0), maximum = Math.max(1e-12,...bins.map(allocation));
  const shape=range.shape==='BidAsk'?'Bid-Ask':range.shape, twoSided=bins.some(bin=>bin.token>0);
  const explanation=twoSided?'Start with SOL and the paired token, spread across your selected range. You earn modelled fees only while price is in range.':'Start entirely in SOL. Your range buys the paired token as price falls. You earn no fees while the price is above it.';
  return `<section class="panel"><p class="eyebrow">Suggested paper setup</p><h3>${esc(shape)} · ${twoSided?'provide on both sides of price':'buy gradually if price falls'}</h3><p class="note">${explanation}</p><div class="range-visual" role="img" aria-label="Paper allocation by price, measured in SOL at entry">${bins.filter((_bin,i)=>i%Math.max(1,Math.ceil(bins.length/30))===0).map(bin=>`<i style="height:${Math.max(4,allocation(bin)/maximum*80)}px"></i>`).join('')}</div><div class="range-labels"><span>Floor ${number(range.floorPriceSol,9)} SOL/token</span><span>Top ${number(range.topPriceSol,9)} SOL/token</span></div><p class="note">Floor ${percent(range.depthFraction)} below the observed price · ${number(range.binCount,0)} bins · ${esc(range.alignment === 'native' ? 'Native grid' : 'Paper grid')}</p>${source(range)}<details class="evidence-details"><summary>How this suggestion works</summary><p>${esc(range.note)}</p><p>The floor defines the last buy level, not a maximum loss. Below it, the model holds the paired token.</p></details></section>`;
}
function poolEvidence(data) { return `<section class="panel"><h3>Fee pace & costs</h3><div class="metrics">${metric('Daily fees at the current pool pace',data.expectedFeesPerDaySol)}${metric('Observed token price',data.priceSol,value=>finite(value)?`${number(value,9)} SOL/token`:'Unavailable')}</div><p class="note">${esc(data.expectedFeesPerDaySol.note)}</p>${costRow('Token-2022 transfer fee',data.transferFeeBps,value=>finite(value)?percent(value/10000):'Unavailable')}${costRow('All-in entry cost',data.entryCostSol)}${costRow('All-in exit cost',data.exitCostSol)}<details class="evidence-details"><summary>See conversion and network evidence</summary>${costRow('Entry conversion only',data.entryConversionSol)}${costRow('Reference exit conversion only',data.exitConversionSol)}${costRow('Network & account setup',data.networkCostSol)}</details></section>`; }
function renderPreflight(data,basket) {
  const label=verdictLabel(data.verdict.label),skip=data.verdict.label==='Skip',range=data.range,hold=holdLabel(data.options?.holdMinutes||240);
  const amount=`<form class="amount-form" id="amount-form"><label for="paper-amount">${basket?'Total mix amount':'Position size'}</label><div class="amount-input"><input id="paper-amount" inputmode="decimal" value="${esc(state.amount)}" autocomplete="off" required><span>SOL</span></div><button class="secondary" type="submit">Update</button></form>`;
  const checks=basket?data.components.map(item=>`<details class="component"><summary>${esc(item.preflight.name)} · ${sol(item.sizeSol)}</summary>${checkRows(item.preflight)}</details>`).join(''):checkRows(data);
  const action=`<aside class="action-card">${amount}<div class="verdict ${skip?'fail':'caution'}"><h3>${esc(label)}</h3><p>${esc(label)}, because ${esc(data.verdict.reason.charAt(0).toLowerCase()+data.verdict.reason.slice(1))}</p></div><p class="note">This is a cost check, not advice. You decide.</p><div class="preflight-actions">${skip?'<button class="primary" data-go="pools">Back to pools</button>':''}<button class="${skip?'text-button':'primary'}" data-action="deposit" data-ripple ${!data.canOpen?'disabled':''}>${skip?'Open on paper anyway':'Open on paper'}</button>${!skip?'<button class="text-button" data-go="pools">Back to pools</button>':''}</div><p class="note">${sol(state.account?.balanceSol)} practice balance${source({source:'Still paper ledger',asOf:state.account?.updatedAt})}</p></aside>`;
  const sub=basket?data.basket.reason:`${sol(data.sizeSol)} · ${range?.shape==='BidAsk'?'Bid-Ask':range?.shape||'Unavailable'} · ${number(range?.floorPriceSol,9)} to ${number(range?.topPriceSol,9)} SOL/token · planned hold ${hold}`;
  show(heading('Practise',basket?'Pre-flight: '+data.basket.name:'Pre-flight: '+data.name,sub,basket?'':'<button class="text-button" data-action="change-range">Change range</button>')+pendingBanner()+`<p class="source">${basket?esc(data.basket.source):esc(range?.source||'Meteora + paper range')} · ${esc(date(basket?data.basket.asOf:range?.asOf))}. Size and hold: your paper settings.</p><div class="preflight-layout"><div><section class="panel check-card">${checks}</section>${basket?scenarioCards(data):''}<p class="note">${basket?data.components.reduce((n,c)=>n+(c.preflight.checks||[]).filter(r=>r.status==='unavailable').length,0):(data.checks||[]).filter(c=>c.status==='unavailable').length} checks unavailable. The verdict uses what we could read. <button class="text-button" data-go="${basket?'basket-preflight':'preflight'}">Retry missing</button></p><details class="panel"><summary>Model and cost details</summary>${basket?data.components.map(c=>poolEvidence(c.preflight)).join(''):rangePanel(data)+poolEvidence(data)}<p class="note">Example screening thresholds. All-in costs and net proceeds stay unavailable without measured transaction costs. Paper fees are modelled observations, not actual LP earnings.</p></details></div>${action}</div>`);
}
function checkRows(data){return (data.checks||[]).map((c,i)=>`<details class="check-row ${esc(c.status)}" style="--row:${i}"><summary><span class="status-dot" aria-label="${esc(c.status)}"></span><span><strong>${esc(c.label)}</strong><span class="check-result">${esc(c.result)}</span>${source(c)}</span><span class="check-status">${esc(c.status)}</span></summary><p>${esc(c.tooltip)} <a href="#learn" data-lesson="${c.lesson}">Learn more</a></p></details>`).join('')||`<p class="note">Unavailable. Couldn't read the screening checks. Treat this as unknown.</p>`;}
function changeRange(){
 const r=state.range||{shape:'BidAsk',floorPct:47.5,ceilingPct:0,holdMinutes:240};
 $('#range-content').innerHTML=`<h2 id="range-title">Change range</h2><p>Example paper settings. The actual range is aligned to the pool's bin grid, with at most 69 bins.</p><label>Shape<select name="shape">${['Spot','BidAsk','Curve'].map(v=>`<option value="${v}" ${r.shape===v?'selected':''}>${v==='BidAsk'?'Bid-Ask':v}</option>`).join('')}</select></label><label>Floor below price (%)<input name="floorPct" type="number" min="0.1" max="90" step="0.1" value="${r.floorPct}" required></label><label>Ceiling relative to price (%)<input name="ceilingPct" type="number" min="-89" max="100" step="0.1" value="${r.ceilingPct}" required></label><label>Planned hold (minutes)<input name="holdMinutes" type="number" min="1" max="2880" step="1" value="${r.holdMinutes}" required></label><button class="primary" type="submit">Run pre-flight</button><button class="text-button" type="button" data-action="cancel-range">Cancel</button>`;
 $('#range-dialog').showModal();
}
function markEvidence(position,value) { return {value,source:position.mark.source + ' + Still paper model',asOf:position.mark.asOf}; }
function positionCard(position) {
  const reminderAt=readSaved('still:reminders:v1',{})[position.id];
  const reminder=position.status==='open'&&finite(reminderAt)&&Date.now()>=reminderAt?'<p class="note" role="status">Your planned hold has ended. Review this position before closing.</p>':'';
  const mark = position.mark, status = mark.rangeStatus === 'inside' ? 'In range' : mark.rangeStatus === 'above' ? 'Above range · waiting' : mark.rangeStatus === 'below' ? 'Below range · holding token' : 'Range status unavailable';
  const closed=position.status==='closed', held=closed?holdLabel(Math.max(0,Math.round((Date.parse(position.closedAt)-Date.parse(position.openedAt))/60000))):null;
  return `<article class="position-card" id="position-${esc(position.id)}">${closed?`<p>${esc(position.name)} · held ${held}</p><p>Fees ${sol(mark.feesSol)} · Costs ${sol(finite(position.entryCostsSol)&&finite(position.exitCostsSol)?position.entryCostsSol+position.exitCostsSol:null)} · Netted ${signed(mark.netPnlSol)}</p><small class="source">What you'd have netted after the exit swap and tax. ${esc(mark.source)} · ${esc(date(mark.asOf))}</small>`:''}<div class="card-title"><h3>${position.status === 'closed' ? 'Closed paper position' : status}</h3><span class="tag">${position.basketName ? esc(position.basketName)+' mix' : 'Paper'}</span></div><code class="position-id">${esc(position.positionAddress)}</code>${reminder}${position.strategyName?`<p class="note">Paper strategy: ${esc(position.strategyName)}</p>`:''}<div class="metrics">${metric('Inventory P&L vs holding SOL',markEvidence(position,mark.grossPnlSol),signed)}${metric('Net',markEvidence(position,mark.netPnlSol),signed)}${metric('Exit cost now',markEvidence(position,position.exitCostsSol))}${metric('Fees · modelled, not on-chain',markEvidence(position,mark.feesSol))}${metric('Distance to the floor',markEvidence(position,mark.distanceToFloorPct),value=>finite(value)?`${number(value,2)}%`:'Unavailable')}${metric('Paper inventory value',markEvidence(position,mark.grossValueSol))}<div class="metric"><span>Original paper amount</span><strong>${sol(position.amountSol)}</strong><small class="source">Your confirmed paper allocation · ${esc(date(position.openedAt))}</small></div></div><p class="note">${position.status==='closed' ? `Settled ${sol(position.settledLamports/1e9)} on ${esc(date(position.closedAt))}. ` : ''}${esc(position.settlementNote)}</p><details class="evidence-details"><summary>Range & evidence</summary><p>Floor ${number(position.range.floorPriceSol,9)} SOL/token · top ${number(position.range.topPriceSol,9)} SOL/token. Source: saved paper range at ${esc(date(position.entryAsOf))}.</p><p>${esc(position.range.note)}</p><p>${(mark.unavailableReasons || []).map(esc).join(' ')}</p><p>${esc(state.account.feeModelNote)}</p></details>${position.status==='open'?`<div class="position-actions"><small>Opened ${esc(date(position.openedAt))}</small><button class="secondary" data-close="${esc(position.id)}">Close on paper</button><button class="text-button" data-recheck="${esc(position.poolAddress)}">Re-run pre-flight</button></div>`:''}</article>`;
}
function basketProof(account) {
  return account.latestBasket?.stampTarget ? `<section class="panel"><p class="eyebrow">Optional · Solana devnet</p><h3>Record your basket choice.</h3><p class="note">${esc(account.latestBasket.basketName)} · ${sol(account.latestBasket.amountSol)} · ${esc(date(account.latestBasket.at))}. Connect Phantom and review a Memo to record this saved choice. Your wallet signs only after you approve; devnet SOL pays the fee.</p><div id="basket-proof"><p class="note" role="status">Loading the optional receipt controls…</p></div><p class="note">The receipt records the basket allocation. It does not deposit tokens or prove investment performance.</p></section>` : '';
}
let devnetModule;
async function mountBasketProof(account) {
  const host = $('#basket-proof'); if (!host || !account.latestBasket?.stampTarget) return;
  try {
    devnetModule ||= import('/worldsfair-devnet.js'); await devnetModule;
    if (!host.isConnected) return;
    if (!window.WorldsfairDevnet?.renderButton) throw new Error('Receipt controls are unavailable.');
    host.replaceChildren(window.WorldsfairDevnet.renderButton(account.latestBasket.stampTarget,'Record basket on devnet'));
  } catch {devnetModule=null;if(host.isConnected)host.innerHTML='<p class="error-text">Devnet controls are unavailable. Your paper positions are saved. Reload Positions to try again.</p>';}
}
function renderPositions() {
 const account=state.account,all=account.positions||[],positions=all.filter(p=>p.status===state.positionTab),groups=groupPositions(positions),open=all.filter(p=>p.status==='open');
 const total=key=>sumKnown(open.map(p=>key==='exit'?p.exitCostsSol:p.mark[key])),evidence=value=>({value,source:'Still paper ledger + saved market observations',asOf:open.length?open.map(p=>p.mark.asOf).sort()[0]:account.updatedAt});
 const groupHtml=groups.map(g=>`<details class="position-group" data-group="${esc(g.poolAddress)}" ${expandedGroups.has(g.poolAddress)?'open':''}><summary>${esc(g.name)} <small>${g.positions.length} positions · ${g.positions.filter(p=>p.mark.inRange===true).length} in range · Net ${sol(sumKnown(g.positions.map(p=>p.mark.netPnlSol)))}</small>${source({source:'Still paper ledger + saved observations',asOf:g.positions.map(p=>p.mark.asOf).filter(Boolean).sort()[0]})}</summary>${g.positions.map(positionCard).join('')}</details>`).join('');
 show(heading('Practise','Positions','Your paper positions, marked to live prices.','<button class="secondary" data-action="refresh-positions">Refresh</button>')+pendingBanner()+`<div class="summary-strip">${metric('Open',evidence(open.length),v=>number(v,0))}${metric('Fees earned',evidence(total('feesSol')))}${metric('Exit cost now',evidence(total('exit')))}${metric('Net',evidence(total('netPnlSol')),signed)}</div><p class="note">Net is after the estimated exit swap and any transfer tax. All-in net is unavailable until costs can be measured. Fees are modelled paper observations.</p><div class="filter-chips" aria-label="Position status"><button class="secondary" data-position-tab="open" aria-pressed="${state.positionTab==='open'}">Open</button><button class="secondary" data-position-tab="closed" aria-pressed="${state.positionTab==='closed'}">Closed</button></div><p class="note">Practice balance: ${sol(account.balanceSol)}${source({source:'Still paper ledger',asOf:account.updatedAt})}</p>`+(groupHtml||`<div class="empty"><h3>${state.positionTab==='open'?'No paper positions yet.':'Nothing closed yet.'}</h3><button class="primary" ${state.positionTab==='open'?'data-go="pools"':'data-position-tab="open"'}>${state.positionTab==='open'?'Pick a pool':'See open positions'}</button></div>`)+`<button class="text-button" data-go="pools">Pick a pool</button>`+basketProof(account));
 mountBasketProof(account);
}
function renderBaskets(data) {
  show(heading('Practise','Starter mixes','Not sure where to begin? Three ready-made paper sets.', '<button class="secondary" data-go="positions">View positions</button>') + pendingBanner() + `<div class="basket-grid">${state.baskets.map(basket=>`<article class="basket-card"><span class="tag ${esc(basket.name.toLowerCase())}">${esc(basket.status==='available'?'Paper mix':'Unavailable')}</span><h3>${esc(basket.name)}</h3><p class="reason">${esc(basket.reason)}</p>${basket.components.length?`<ul>${basket.components.map(item=>`<li><span>${esc(item.pool.name)}<br><small>${esc(short(item.pool.address))} · ${number(item.pool.binStep.value,0)} bps</small></span><b>${percent(item.weightBps/10000)}</b></li>`).join('')}</ul>`:'<p class="note">No complete allocation yet. Refresh after the next market read.</p>'}<p class="source">${esc(basket.source)} · ${esc(date(basket.asOf))}</p><button class="secondary" data-basket="${esc(basket.id)}" ${basket.status!=='available'?'disabled':''}>Try this mix on paper <span aria-hidden="true">↗</span></button></article>`).join('')}</div><p class="note">Presets follow current liquidity, pool history and fee activity. “Steady” does not mean safe or stable-priced. Membership is checked again when you confirm.</p><button class="text-button" data-go="baskets">Refresh mix pools</button>`);
}
function confirmAction(action,body,description,title,copy,buttonLabel,pending = null) {
  dialogAction = {action,body,description,pending};
  $('#confirm-content').innerHTML = `<p class="eyebrow">Practice funds only</p><h2 id="confirm-title">${esc(title)}</h2><p>${copy}</p><p class="note">Paper only. Nothing leaves your wallet.</p>`;
  $('#confirm-cancel').textContent=action==='still-close'?'Keep':'Cancel';
  $('#confirm-submit').toggleAttribute?.('data-ripple',['Open on paper','Follow on paper','Start paper bot','Park on paper'].includes(buttonLabel));
  $('#confirm-error').hidden = true; $('#confirm-submit').textContent = buttonLabel; $('#confirm-submit').disabled = false; $('#confirm-cancel').disabled = false;
  dialog.showModal(); $('#confirm-cancel').focus();
}
function prepareDeposit() {
  const data = state.preflight; if (!data?.canOpen) return;
  if (!preflightIsFresh(data)) {toast('This price reading has expired. Refreshing the pre-flight before you confirm.');loadView(state.view);return;}
  const input = $('#paper-amount'); if (input && input.value !== state.amount) {toast('Update the amount to refresh this pre-flight first.'); input.focus(); return;}
  if (readPending()) {resumePending(); return;}
  const basket = state.view === 'basket-preflight', amount = String(data.sizeSol), label = basket ? `${data.basket.name} mix` : data.name;
  const body = basket ? {basketId:data.basket.id,amountSol:amount,poolAddresses:data.components.map(item=>item.poolAddress),confirmed:true} : {poolAddress:data.poolAddress,amountSol:amount,confirmed:true,...(state.range?{range:state.range}:{})};
  const allocation = basket ? `<br>${data.components.map(item=>`${esc(item.preflight.name)}: ${sol(item.sizeSol)}`).join('<br>')}` : '';
  const hold=holdLabel(data.options?.holdMinutes||240),r=data.range;
  confirmAction(basket?'still-basket':'still-open',body,`Paper deposit of ${amount} SOL into ${label}.`,basket?'Open a paper mix?':'Open a paper position?',basket?`${sol(data.sizeSol)} in ${esc(label)}.${allocation}<br>Pre-flight said: ${esc(verdictLabel(data.verdict.label))}.`:`${sol(data.sizeSol)} in ${esc(label)}. ${r?.shape==='BidAsk'?'Bid-Ask':esc(r?.shape)} range from ${number(r?.floorPriceSol,9)} to ${number(r?.topPriceSol,9)} SOL/token. Pre-flight said: ${esc(verdictLabel(data.verdict.label))}. Planned hold: ${hold}.<label class="reminder"><input type="checkbox" id="close-reminder">Remind me to close after ${hold}</label><small class="source">Reminder shown in this browser when you visit Positions.</small>`,'Open on paper');

}
function prepareClose(id) {
  if (readPending()) {resumePending(); return;}
  const position = state.account?.positions.find(item=>item.id===id && item.status==='open'); if (!position) return;
  confirmAction('still-close',{positionId:id,confirmed:true},`Close the paper position ${id}.`,'Close on paper?',`Net ${sol(position.mark.netPnlSol)}.<br><br>Close <strong>${esc(position.name)}</strong> (${esc(short(id))}). The latest modelled inventory value will return to your practice balance.<br><br>Last available gross value: <strong>${sol(position.mark.grossValueSol)}</strong>. The server checks a fresh price before closing.`,'Close');
}
function resumePending() {
  const pending = readPending(); if (pendingReadError) {toast('Saved action cannot be read. Check positions and restore browser storage before another deposit.'); return;} if (!pending || !['still-open','still-basket','still-close','still-follow','still-unfollow','still-bot'].includes(pending.action) || !pending.body?.requestId) {toast('No valid saved paper action was found.'); return;}
  confirmAction(pending.action,pending.body,pending.description,'Check your saved action?',`${esc(pending.description)}<br><br>The same request ID will be reused. If it already completed, the saved receipt is returned without repeating it.`,'Check saved action',pending);
}
$('#confirm-submit').addEventListener('click',async()=>{
  if (submitting || !dialogAction) return;
  if (!dialogAction.pending && ['still-open','still-basket'].includes(dialogAction.action) && !preflightIsFresh(state.preflight)) {dialog.close();toast('This reading expired while you reviewed it. Refreshing the pre-flight.');loadView(state.view);return;}
  submitting = true; $('#confirm-submit').disabled = true; $('#confirm-cancel').disabled = true; $('#confirm-error').hidden = true;
  let pending;
  try {
    pending = dialogAction.pending || {action:dialogAction.action,body:{...dialogAction.body,requestId:crypto.randomUUID()},description:dialogAction.description};
    savePending(pending);
    const data = await api('/api/paper/'+pending.action,pending.body);
    if (!data?.paper || !data.account || !Array.isArray(data.account.positions) || !finite(data.account.balanceSol) || data.receipt?.requestId !== pending.body.requestId) throw new Error('The action result could not be verified. Check the saved request to recover its receipt.');
    if(pending.action==='still-open'&&$('#close-reminder')?.checked){const reminders=readSaved('still:reminders:v1',{});for(const id of data.receipt.positionIds||[])reminders[id]=Date.now()+(state.preflight?.options?.holdMinutes||240)*60000;saveLocal('still:reminders:v1',reminders);}
    clearPending(); state.account = data.account; dialog.close();
    const followAction=['still-follow','still-unfollow','still-bot'].includes(pending.action);
    navigate(followAction?'follow':'positions'); toast(followAction?'Paper strategy updated. Your real funds have not moved.':pending.action==='still-close'?'Paper position closed.':'Paper position opened. Your real funds have not moved.');
  } catch(error) {
    // A known rejection cannot have committed. Unknown/network outcomes keep the exact request for recovery.
    if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {try {clearPending();} catch {}}
    $('#confirm-error').textContent = error.message + (readPending() ? ' Use Check saved action to recover this same request.' : ' Keep reviewing to refresh the pre-flight.'); $('#confirm-error').hidden = false;
    if (readPending()) {dialogAction.pending = readPending(); $('#confirm-submit').textContent = 'Check saved action';}
  } finally {submitting = false; $('#confirm-submit').disabled = false; $('#confirm-cancel').disabled = false;}
});
$('#confirm-cancel').addEventListener('click',()=>{if(!submitting)dialog.close();});
dialog.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});
dialog.querySelector('form').addEventListener('submit',event=>{if(submitting)event.preventDefault();});
function botSettings(){
 const defaults={name:'My paper bot',shape:'Spot',width:25,holdMinutes:30,trigger:'volume',sizeSol:.5},saved=readSaved('still:bot:v1',defaults);
 return saved&&typeof saved==='object'?{...defaults,...saved}:defaults;
}
function botSentence(b){const closest=b.trigger==='evening'?'Overnight patience':b.shape==='BidAsk'?'SOL-only Bid-Ask catch':b.trigger==='pullback'?'Heart attack':b.width<=12?'Steady drip':'Narrow and quick';return `Your bot opens a ${b.shape==='BidAsk'?'Bid-Ask':b.shape} range ${b.width}% ${b.shape==='BidAsk'?'below':'around'} price ${{any:'at any time',volume:'after a volume burst',pullback:'after a pullback',evening:'in the evening'}[b.trigger]}, holds for up to ${holdLabel(b.holdMinutes)}, using ${b.sizeSol} SOL each time. Closest to: ${closest}.`;}
function botForm(){const b=botSettings();return `<section class="panel bot-builder"><div><h3>Make your own paper bot</h3><p>Five settings. Change one and see what it means.</p><form id="bot-form"><label for="bot-width-input">Range width <output id="bot-width">${esc(b.width)}%</output><input id="bot-width-input" name="width" type="range" min="1" max="80" step="1" value="${esc(b.width)}"></label><p class="note">How far from price you provide. Narrower earns more per trade and drops out sooner.</p><label>Shape<select name="shape">${['Spot','BidAsk','Curve'].map(s=>`<option value="${s}" ${s===b.shape?'selected':''}>${s==='BidAsk'?'Bid-Ask':s}</option>`).join('')}</select></label><p class="note">Spot spreads evenly. Curve bunches near price. Bid-Ask puts more at the edges.</p><label for="bot-holdMinutes-input">Hold time <output id="bot-hold">${holdLabel(b.holdMinutes)}</output><input id="bot-holdMinutes-input" name="holdMinutes" type="range" min="1" max="2880" step="1" value="${esc(b.holdMinutes)}"></label><p class="note">How long before the bot closes on paper.</p><label>Entry trigger<select name="trigger">${[['any','Any time'],['volume','Volume burst'],['pullback','After a pullback'],['evening','Evening']].map(([v,n])=>`<option value="${v}" ${v===b.trigger?'selected':''}>${n}</option>`).join('')}</select></label><p class="note">What has to happen before the bot opens a position.</p><label for="bot-sizeSol-input">Size <output id="bot-size">${sol(b.sizeSol)}</output><input id="bot-sizeSol-input" name="sizeSol" type="range" min="0.1" max="3" step="0.1" value="${esc(b.sizeSol)}"></label><p class="note">Paper SOL per position.</p><label>Name your bot<input name="name" maxlength="60" value="${esc(b.name)}" required></label><p id="bot-error" class="error" role="alert" hidden>Pick a range and a size to start.</p><button class="primary" type="submit" data-ripple>Start paper bot</button></form></div><aside class="bot-summary"><h3>Your paper rules</h3><p id="bot-sentence" aria-live="polite">${esc(botSentence(b))}</p><small class="source">Example settings · saved in this browser</small><p class="note">Runs on the server after confirmation. One position per strategy, funded from your practice balance. A volume burst means the last 30 minutes doubled the preceding 30. Pullback means a 5% fall from an observed burst peak. Evening means 18:00–23:00 UK. Closes happen on the next available check; stale prices can delay them.</p><small class="source">Still example runner rules · 11 October 2026</small></aside></section>`;}
function runResult(run){
 if(!run)return `<p class="result-line">Too early to judge. 0 paper trades so far. Results show after 5 trades.</p><small class="source">This run has not started. Counts come from your paper journal.</small>`;
 const positions=state.account.positions.filter(p=>p.runId===run.id),closed=positions.filter(p=>p.status==='closed'),n=closed.length;
 const sum=key=>closed.length&&closed.every(p=>finite(p.mark[key]))?closed.reduce((a,p)=>a+p.mark[key],0):null;
 return `<p class="result-line">${n<5?`Too early to judge. ${n} paper trades so far. Results show after 5 trades.`:`${n} paper trades · Fees ${sol(sum('feesSol'))} · Costs ${sol(closed.every(p=>finite(p.entryCostsSol)&&finite(p.exitCostsSol))?closed.reduce((a,p)=>a+p.entryCostsSol+p.exitCostsSol,0):null)} · Net ${signed(sum('netPnlSol'))}`}</p><small class="source">Still paper journal · Started ${esc(date(run.startedAt))}<br>Last check ${esc(date(run.lastCheckAt))}</small><p class="note">${esc(run.note)}</p>${closed.length?`<details><summary>Trade reviews</summary>${closed.map(p=>`<p>${esc(p.name)} · ${esc(date(p.closedAt))}<br>${esc(p.review||'Closed manually on paper.')}<br>Inventory P&amp;L ${signed(p.mark.grossPnlSol)} · Net ${signed(p.mark.netPnlSol)}${source(p.mark)}</p>`).join('')}</details>`:''}`;
}
function renderFollow(){
 const runs=state.account.runs||[],suggested=preferences.preference==='calm'?'overnight':preferences.preference==='quick'?'narrow':'drip';
 show(heading('Follow','Follow a strategy','Paper versions of how some LPs say they trade. Follow one, or build your own.','<button class="secondary" data-go="follow">Refresh results</button>')+pendingBanner()+`<p class="note">Inspired by public posts. Not endorsed by, or affiliated with, anyone named. Rules are our paraphrase.</p>${!runs.some(r=>r.active)?`<p class="empty-inline">You're not following anything yet. <a href="#strategy-cards">See strategies</a></p>`:''}<p class="note">Following permits future paper entries and planned closes from your ${sol(state.account.balanceSol)} practice balance. No real funds move. Checks normally run about once a minute; demand and missing data can delay them. Results begin when you confirm, with no backfilled trades.</p>${source({source:'Still paper ledger',asOf:state.account.updatedAt})}<div class="strategy-grid" id="strategy-cards">${state.strategies.map(s=>{const run=[...runs].reverse().find(r=>r.strategyId===s.id);return `<article class="panel strategy-card">${s.id===suggested?'<span class="tag">Suggested for your pace</span>':''}<h3>${esc(s.name)}</h3><p>${esc(s.style)}</p><p class="attribution">${s.handle?`Inspired by public posts from @${esc(s.handle)}. Not endorsed or affiliated.`:esc(s.attribution)}</p>${s.sourceUrl?`<a class="source-link" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source post ↗</a> · <a class="source-link" href="https://github.com/xNFTpat/worlds-fair/issues/new?title=${encodeURIComponent('Strategy removal request: '+s.handle)}" target="_blank" rel="noopener noreferrer">Request removal</a>`:''}${runResult(run)}<details><summary>See rules</summary><p>${esc(s.rules)}</p><p>${esc(s.behaviour)}</p><p class="note">Still's example run: ${esc(botSentence(s.bot))} ${s.mode==='steady'?'This house run closes only on an observed range exit.':s.mode==='narrow'?'Its range is below price; the example hold is 30 minutes.':s.mode==='heart'?'Requires actual 30-minute fee data; no hourly extrapolation.':''}</p><p class="note">${esc(s.sourceNote||'The source explains the inspiration. Exact trigger thresholds, sizes and holds are Still example settings, not a claim about the creator’s current trades.')} Ranges use at most 69 bins and may be narrower than requested.</p><small class="source">Example paper rules · 11 October 2026</small></details><div class="actions">${run?.active?`<span class="tag">Following ✓</span><button class="text-button" data-unfollow="${esc(run.id)}">Unfollow</button>`:`<button class="primary" data-follow="${esc(s.id)}" data-ripple>Follow on paper</button>`}</div></article>`;}).join('')}</div>${runs.some(r=>!r.strategyId||!r.active)?`<section class="panel"><h3>Your paper runs</h3>${runs.filter(r=>!r.strategyId||!r.active).map(r=>`<article><h4>${esc(r.bot.name)}</h4><p>${esc(botSentence(r.bot))}</p>${runResult(r)}${r.active?`<button class="text-button" data-unfollow="${esc(r.id)}">Stop new entries</button>`:'<span class="tag">Stopped</span>'}</article>`).join('')}</section>`:''}${botForm()}`);
}
function readBotForm(form){const v=new FormData(form);return {name:String(v.get('name')||''),shape:String(v.get('shape')),width:Number(v.get('width')),holdMinutes:Number(v.get('holdMinutes')),trigger:String(v.get('trigger')),sizeSol:Number(v.get('sizeSol'))};}
function prepareFollow(id){const s=state.strategies.find(s=>s.id===id);if(!s)return;if(readPending()){resumePending();return;}confirmAction('still-follow',{strategyId:id,confirmed:true},`Follow ${s.name} on paper.`,'Follow this strategy on paper?',`${esc(s.name)}. ${esc(s.rules)}<br><br>Permit future paper entries from your practice balance, up to ${sol(s.bot.sizeSol)} per position, and closes under these rules. Existing trade history is not copied. You can stop new entries at any time.`,'Follow on paper');}

document.addEventListener('click',async event=>{
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if(button.hasAttribute?.('data-ripple') && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){button.classList.remove('ripple');void button.offsetWidth;button.classList.add('ripple');setTimeout(()=>button.classList.remove('ripple'),600);}
  if(button.dataset.follow){prepareFollow(button.dataset.follow);return;}
  if(button.dataset.unfollow){if(readPending()){resumePending();return;}confirmAction('still-unfollow',{runId:button.dataset.unfollow,confirmed:true},'Stop new entries for this paper run.','Stop following?', 'No new positions will open. Existing paper positions keep their planned close; you can also close them in Positions.','Unfollow');return;}
  if(button.dataset.action==='start'){onboardingStep=0;navigate(preferences.complete?'pools':'onboarding');return;}
  if(button.dataset.action==='preferences'){onboardingStep=2;navigate('onboarding');return;}
  if(button.dataset.pace){preferences.preference=button.dataset.pace;renderOnboarding();return;}
  if(button.dataset.onboard){if(['skip','finish'].includes(button.dataset.onboard))finishOnboarding();else{onboardingStep+=button.dataset.onboard==='back'?-1:1;renderOnboarding();}return;}
  if(button.dataset.action==='change-range'){changeRange();return;}
  if(button.dataset.action==='cancel-range'){$('#range-dialog').close();return;}
  if(button.dataset.filter){poolPrefs.filter=button.dataset.filter;saveLocal('still:pools:v1',poolPrefs);renderPools(state.poolData);return;}
  if(button.dataset.positionTab){state.positionTab=button.dataset.positionTab;renderPositions();return;}
  if(button.dataset.recheck){const data=await api('/api/still/pools');state.pools=data.pools;state.pool=data.pools.find(p=>p.address===button.dataset.recheck);if(!state.pool){toast('This pool is unavailable in the current shortlist.');navigate('pools');return;}state.range=null;navigate('preflight');return;}
  if (button.dataset.go) {navigate(button.dataset.go);return;}
  if (button.dataset.pool) {state.pool=state.pools.find(pool=>pool.address===button.dataset.pool);state.amount='0.5';state.range=null;navigate('preflight');return;}
  if (button.dataset.basket) {state.basket=state.baskets.find(basket=>basket.id===button.dataset.basket);state.amount=state.basket.id==='spicy'?'0.1':'0.5';state.range=null;navigate('basket-preflight');return;}
  if (button.dataset.close) {prepareClose(button.dataset.close);return;}
  if (button.dataset.action==='deposit') prepareDeposit();
  if (button.dataset.action==='resume') resumePending();
  if (button.dataset.action==='refresh-positions') {
    button.disabled=true; button.textContent='Refreshing…';
    try {const data=await api('/api/paper/still-refresh',{requestId:crypto.randomUUID()});state.account=data.account;if(state.view==='positions')renderPositions();toast('Latest available marks checked.');}
    catch(error){toast(error.message);button.disabled=false;button.textContent='Refresh marks';}
  }
});
screen.addEventListener('input',event=>{if(event.target.id==='paper-amount'){const button=screen.querySelector('[data-action="deposit"]');if(button)button.disabled=event.target.value!==state.amount || !state.preflight?.canOpen;}});
screen.addEventListener('input',event=>{if(event.target.closest?.('#bot-form')){const b=readBotForm(event.target.closest('#bot-form'));saveLocal('still:bot:v1',b);$('#bot-sentence').textContent=botSentence(b);$('#bot-width').textContent=b.width+'%';$('#bot-hold').textContent=holdLabel(b.holdMinutes);$('#bot-size').textContent=sol(b.sizeSol);}});
screen.addEventListener('submit',event=>{
  if(event.target.id==='bot-form'){event.preventDefault();const b=readBotForm(event.target);if(!b.name.trim()||!finite(b.width)||!finite(b.sizeSol)||b.sizeSol<=0){$('#bot-error').hidden=false;return;}if(readPending()){resumePending();return;}saveLocal('still:bot:v1',b);confirmAction('still-bot',{bot:b,confirmed:true},'Start '+b.name+' on paper.','Start this paper bot?',esc(botSentence(b))+'<br><br>Permit future paper entries and closes from your practice balance. No real funds move.','Start paper bot');return;}
  if (event.target.id!=='amount-form')return;event.preventDefault();
  const value=$('#paper-amount').value.trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)||Number(value)<.001||Number(value)>10){toast('Enter between 0.001 and 10 SOL, with at most 9 decimal places.');$('#paper-amount').focus();return;}
  state.amount=value;loadView(state.view);
});
document.addEventListener('change',event=>{if(event.target.id==='pool-sort'){poolPrefs.sort=event.target.value;saveLocal('still:pools:v1',poolPrefs);renderPools(state.poolData);}});
document.addEventListener('toggle',event=>{const group=event.target.dataset?.group;if(group){if(event.target.open)expandedGroups.add(group);else expandedGroups.delete(group);}},true);
document.addEventListener('submit',event=>{if(event.target.id!=='range-form')return;event.preventDefault();const form=new FormData(event.target),range={shape:form.get('shape'),floorPct:Number(form.get('floorPct')),ceilingPct:Number(form.get('ceilingPct')),holdMinutes:Number(form.get('holdMinutes'))};if(range.ceilingPct<=-range.floorPct){toast('The ceiling must be above the floor.');return;}state.range=range;$('#range-dialog').close();loadView(state.view);});
window.addEventListener('popstate' ,()=>navigate(location.hash.slice(1)||'home',true));
window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;if(location.hash.slice(1)!==state.view)navigate(location.hash.slice(1)||'home',true);});
api('/api/version').then(version=>{const hash=version.git?.short || version.git?.sha || version.gitSha || version.sha || version.commit; if(typeof hash==='string')$('#build-version').textContent='· '+hash.slice(0,8);}).catch(()=>{});
navigate(location.hash.slice(1)||'home',true);
}
