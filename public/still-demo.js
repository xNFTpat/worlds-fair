// This page can only call read-only evidence routes and the isolated paper ledger.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, places = 4) => finite(value) ? value !== 0 && Math.abs(value) < 10 ** -places ? value.toExponential(2) : value.toLocaleString('en-GB', {maximumFractionDigits: places}) : 'Unavailable';
export const sol = value => finite(value) ? `${number(value, 6)} SOL` : 'Unavailable';
const signed = value => finite(value) ? `${value >= 0.0000005 ? '+' : ''}${sol(Math.abs(value)<0.0000005?0:value)}` : 'Unavailable';
const percent = value => finite(value) ? `${number(value * 100, 2)}%` : 'Unavailable';
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

if (typeof document !== 'undefined') {
const $ = selector => document.querySelector(selector);
const state = {view:'home',pool:null,basket:null,preflight:null,account:null,pools:[],baskets:[],amount:'0.5',load:0,pending:null};
const screen = $('#screen'), dialog = $('#confirmation');
let dialogAction = null, submitting = false, noticeTimer;
const pendingKey = 'still:guided:pending:v1';
let pendingReadError = false;
function readPending() { try { const value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); pendingReadError = !!value && (!['still-open','still-basket','still-close'].includes(value.action) || !value.body?.requestId); return pendingReadError ? {invalid:true} : value; } catch { pendingReadError = true; return {invalid:true}; } }
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
  if (!['home','pools','preflight','positions','baskets','basket-preflight'].includes(view)) view = 'home';
  if (view === 'preflight' && !state.pool) view = 'pools';
  if (view === 'basket-preflight' && !state.basket) view = 'baskets';
  const path = view === 'home' ? location.pathname + location.search : '#' + view;
  if (location.hash !== path) history[replace ? 'replaceState':'pushState'](null,'',path);
  state.view = view;
  $('#home').hidden = view !== 'home'; $('#journey').hidden = view === 'home';
  for (const button of document.querySelectorAll('.steps button')) button.setAttribute('aria-current', button.dataset.go === (view === 'basket-preflight' ? 'baskets' : view) ? 'step':'false');
  $('#step-preflight').disabled = !state.pool;
  window.scrollTo({top:0,behavior:'instant'});
  if (view !== 'home') loadView(view); else state.load++;
}
async function loadView(view) {
  const load = ++state.load;
  loading(view === 'pools' ? 'Finding current SOL pools…' : view === 'positions' ? 'Reading your practice positions…' : view === 'baskets' ? 'Reading current basket pools…' : 'Checking the range, costs and downside…');
  try {
    if (view === 'pools') {
      const [data] = await Promise.all([api('/api/still/pools'),ensureAccount()]); if (load !== state.load) return;
      state.pools = data.pools; renderPools(data);
    } else if (view === 'preflight' || view === 'basket-preflight') {
      const basket = view === 'basket-preflight';
      const params = new URLSearchParams({amountSol:state.amount,[basket ? 'basketId':'poolAddress']:basket ? state.basket.id : state.pool.address});
      const [data] = await Promise.all([api(`/api/still/${basket ? 'basket-preflight':'preflight'}?${params}`),ensureAccount()]); if (load !== state.load) return;
      state.preflight = data; renderPreflight(data,basket);
    } else if (view === 'positions') {
      const data = await api('/api/paper/still-account'); if (load !== state.load) return;
      state.account = data.account; renderPositions();
    } else if (view === 'baskets') {
      const [data] = await Promise.all([api('/api/baskets'),ensureAccount()]); if (load !== state.load) return;
      state.baskets = data.baskets; renderBaskets(data);
    }
  } catch (error) { if (load === state.load) errorPanel(error.message, view); }
}
function renderPools(data) {
  const cards = state.pools.map(pool => `<article class="pool-card"><div class="card-title"><div><h3>${esc(pool.name)}</h3><small>Meteora DLMM · ${esc(short(pool.address))} · ${esc(number(pool.binStep.value,0))} bps bins</small></div>${tag(pool.risk)}</div><p class="reason">${esc(pool.risk.reason)}</p><div class="metrics">${metric('Pool liquidity (TVL)',pool.tvlUsd,money)}${metric('24h fees / TVL',pool.fees24hFraction,percent)}${metric('1h pace vs daily average',pool.feeTrend,value=>finite(value)?`${value>0?'+':''}${percent(value)}`:'Unavailable')}${metric('Pool age',pool.ageHours,age)}</div><button class="secondary" data-pool="${esc(pool.address)}">Check this pool <span aria-hidden="true">↗</span></button></article>`).join('');
  show(heading('Step 1 · Choose a pool','A small list. A closer look.','Live SOL-paired pools from Meteora. The tags describe liquidity and activity, not safety.', '<button class="secondary" data-go="pools">Refresh list</button>') + pendingBanner() + (cards ? `<div class="cards">${cards}</div><p class="note">Source: Meteora DLMM Data API · catalogue ${esc(date(data.updatedAt))}. At most eight pools with at least $5,000 liquidity and a price read within ten minutes. Fees are shared by active liquidity; these percentages are not your return.</p>` : `<div class="empty"><h3>No current pools to show</h3><p>The live catalogue has no eligible pools with fresh prices. It refreshes automatically every five minutes. Try the list again shortly.</p><button class="primary" data-go="pools">Check again</button></div>`));
}
function costRow(label,evidence,format=sol) { return `<div class="cost-row"><div>${esc(label)}${source(evidence)}<small class="source">${esc(evidence?.note || '')}</small></div><strong>${esc(format(evidence?.value))}</strong></div>`; }
function scenarioCards(data) { return `<section class="panel"><h3>If the paired token price in SOL falls…</h3><p class="note">Both scenarios are in SOL terms, before fees and trading costs. The price floor is not a stop-loss.${data.basket ? ' Each paired token falls by the same percentage.' : ''}</p><div class="scenario-grid">${data.scenarios.map(item=>`<article class="scenario"><h4>Price drops ${percent(item.dropFraction)}</h4><strong>${sol(item.grossValueSol.value)}</strong><small>Modelled inventory value</small>${source(item.grossValueSol)}<p class="note">${signed(item.grossPnlSol.value)} vs holding ${sol(data.sizeSol)}<br>Net proceeds: ${sol(item.netValueSol.value)}</p></article>`).join('')}</div><p class="note">Holding SOL keeps ${sol(data.sizeSol)} in either scenario. This ideal model follows a downward price path through the bins. It excludes transfer taxes, slippage and liquidity limits.</p></section>`; }
function rangePanel(data) {
  const range = data.range;
  if (!range) return `<section class="panel"><h3>Suggested range unavailable</h3><p class="note">A current price and a valid bin configuration are needed. Return to the pool list to choose another pool.</p></section>`;
  const bins = range.bins || [], maximum = Math.max(1e-12,...bins.map(bin=>bin.sol||0));
  return `<section class="panel"><p class="eyebrow">Suggested paper setup</p><h3>Bid-Ask · buy gradually if price falls</h3><p class="note">Start entirely in SOL, with more weight near the bottom of the range. You earn no fees while the price is above it.</p><div class="range-visual" role="img" aria-label="Suggested SOL allocation, heavier at lower prices">${bins.filter((_bin,i)=>i%Math.max(1,Math.ceil(bins.length/30))===0).map(bin=>`<i style="height:${Math.max(4,(bin.sol||0)/maximum*80)}px"></i>`).join('')}</div><div class="range-labels"><span>Floor ${number(range.floorPriceSol,9)} SOL/token</span><span>Top ${number(range.topPriceSol,9)} SOL/token</span></div><p class="note">Floor ${percent(range.depthFraction)} below the observed price · ${number(range.binCount,0)} bins · ${esc(range.alignment === 'native' ? 'Native grid' : 'Paper grid')}</p>${source(range)}<details class="evidence-details"><summary>How this suggestion works</summary><p>${esc(range.note)}</p><p>The floor defines the last buy level, not a maximum loss. Below it, the model holds the paired token.</p></details></section>`;
}
function poolEvidence(data) { return `<section class="panel"><h3>Fee pace & costs</h3><div class="metrics">${metric('Daily fees at the current pool pace',data.expectedFeesPerDaySol)}${metric('Observed token price',data.priceSol,value=>finite(value)?`${number(value,9)} SOL/token`:'Unavailable')}</div><p class="note">${esc(data.expectedFeesPerDaySol.note)}</p>${costRow('Token-2022 transfer fee',data.transferFeeBps,value=>finite(value)?percent(value/10000):'Unavailable')}${costRow('All-in entry cost',data.entryCostSol)}${costRow('All-in exit cost',data.exitCostSol)}<details class="evidence-details"><summary>See conversion and network evidence</summary>${costRow('Entry conversion only',data.entryConversionSol)}${costRow('Reference exit conversion only',data.exitConversionSol)}${costRow('Network & account setup',data.networkCostSol)}</details></section>`; }
function renderPreflight(data,basket) {
  const label = basket ? `${data.basket.name} basket` : data.name;
  const verdict = `<div class="verdict"><strong>${esc(data.verdict.label)}, because…</strong><p>${esc(data.verdict.reason)}</p></div>`;
  const action = `<aside class="action-card"><h3>Try it on paper.</h3><form class="amount-form" id="amount-form"><label for="paper-amount">${basket ? 'Total basket amount' : 'Position amount'}</label><div class="amount-input"><input id="paper-amount" name="amount" inputmode="decimal" type="text" value="${esc(state.amount)}" autocomplete="off" required aria-describedby="amount-note"><span>SOL</span></div><button class="secondary" type="submit">Update</button></form><p id="amount-note" class="note">${sol(state.account?.balanceSol)} practice balance. No wallet needed.</p><button class="primary" data-action="deposit" ${!data.canOpen?'disabled':''}>${basket ? 'Review paper basket' : 'Review paper deposit'} <span aria-hidden="true">↗</span></button><p class="note">You’ll confirm before ${basket ? 'any positions open' : 'the position opens'}. Modelled inventory settles before fees and trading costs.</p></aside>`;
  const main = basket ? `<section class="panel"><h3>${data.components.length ? 'Two pools. One paper allocation.' : 'This allocation is unavailable.'}</h3>${data.components.map(item=>`<div class="cost-row"><div>${esc(item.preflight.name)} <small>· ${esc(short(item.poolAddress))}</small>${source(item.preflight.priceSol)}</div><strong>${percent(item.weightBps/10000)}<br>${sol(item.sizeSol)}</strong></div>`).join('')}<div class="metrics">${metric('Combined daily fee pace',data.expectedFeesPerDaySol)}${metric('Combined entry + exit costs',data.roundTripCostSol)}</div><p class="note">Fee pace is a pool-average comparison, not earned fees. Each SOL-only range starts below the price. A basket does not remove token or liquidity risk.</p></section>${scenarioCards(data)}<section class="panel"><h3>Each pool’s pre-flight</h3>${data.components.map(item=>`<details class="component"><summary>${esc(item.preflight.name)} · ${sol(item.sizeSol)} · ${esc(short(item.poolAddress))}</summary>${rangePanel(item.preflight)}${poolEvidence(item.preflight)}</details>`).join('')}</section>` : `${rangePanel(data)}${scenarioCards(data)}${poolEvidence(data)}`;
  show(heading(basket?'Step 4 · Combined pre-flight':'Step 2 · Pre-flight',label,basket?data.basket.reason:'See the trade-offs before opening a practice position.',`<button class="secondary" data-go="${basket?'baskets':'pools'}">Choose ${basket?'another basket':'another pool'}</button>`) + pendingBanner() + verdict + `<div class="preflight-layout"><div>${main}<section class="panel"><h3>What’s still unavailable</h3><p class="note">${data.missingEvidence.length ? data.missingEvidence.map(esc).join(' · ') : 'All required observations are available.'}</p><p class="note">Missing evidence stays missing. These paper scenarios are for learning; a real deposit needs a complete cost and token-policy check.</p></section></div>${action}</div>`);
}
function markEvidence(position,value) { return {value,source:position.mark.source + ' + Still paper model',asOf:position.mark.asOf}; }
function positionCard(position) {
  const mark = position.mark, status = mark.rangeStatus === 'inside' ? 'In range' : mark.rangeStatus === 'above' ? 'Above range · waiting' : mark.rangeStatus === 'below' ? 'Below range · holding token' : 'Range status unavailable';
  return `<article class="position-card" id="position-${esc(position.id)}"><div class="card-title"><h3>${position.status === 'closed' ? 'Closed paper position' : status}</h3><span class="tag">${position.basketName ? esc(position.basketName)+' basket' : 'Paper'}</span></div><code class="position-id">${esc(position.positionAddress)}</code><div class="metrics">${metric('Inventory P&L vs holding SOL',markEvidence(position,mark.grossPnlSol),signed)}${metric('Net P&L after costs',markEvidence(position,mark.netPnlSol),signed)}${metric('Fees · modelled, not on-chain',markEvidence(position,mark.feesSol))}${metric('Distance to the floor',markEvidence(position,mark.distanceToFloorPct),value=>finite(value)?`${number(value,2)}%`:'Unavailable')}${metric('Paper inventory value',markEvidence(position,mark.grossValueSol))}<div class="metric"><span>Original paper amount</span><strong>${sol(position.amountSol)}</strong><small class="source">Your confirmed paper allocation · ${esc(date(position.openedAt))}</small></div></div><p class="note">${position.status==='closed' ? `Settled ${sol(position.settledLamports/1e9)} on ${esc(date(position.closedAt))}. ` : ''}${esc(position.settlementNote)}</p><details class="evidence-details"><summary>Range & evidence</summary><p>Floor ${number(position.range.floorPriceSol,9)} SOL/token · top ${number(position.range.topPriceSol,9)} SOL/token. Source: saved paper range at ${esc(date(position.entryAsOf))}.</p><p>${esc(position.range.note)}</p><p>${(mark.unavailableReasons || []).map(esc).join(' ')}</p><p>${esc(state.account.feeModelNote)}</p></details>${position.status==='open'?`<div class="position-actions"><small>Opened ${esc(date(position.openedAt))}</small><button class="secondary" data-close="${esc(position.id)}">Close paper position</button></div>`:''}</article>`;
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
  const account = state.account, positions = account.positions || [], groups = groupPositions(positions);
  show(heading('Step 3 · Your positions','A position you can understand.','Each paper position keeps its own address and range. Open a pool group to inspect every position.', '<button class="secondary" data-action="refresh-positions">Refresh marks</button>') + pendingBanner() + `<div class="balance"><div><span>Practice SOL available</span><strong>${sol(account.balanceSol)}</strong></div><button class="secondary" data-go="baskets">Try a basket <span aria-hidden="true">↗</span></button></div><p class="note">${esc(account.seedNote)} ${esc(account.settlementNote)}</p>` + (groups.length ? groups.map(group=>`<details class="position-group" open><summary>${esc(group.name)} <small>${group.positions.length} position${group.positions.length===1?'':'s'} · pool ${esc(short(group.poolAddress))}</small></summary>${group.positions.map(positionCard).join('')}</details>`).join('') + `<button class="text-button" data-go="pools">Try another pool ↗</button>` : `<div class="empty"><h3>Your first position starts with a pre-flight.</h3><p>Choose a pool, inspect the downside, then confirm a paper deposit. You have ${sol(account.seededSol)} to practise with.</p><button class="primary" data-go="pools">Pick a pool</button></div>`) + basketProof(account));
  mountBasketProof(account);
}
function renderBaskets(data) {
  show(heading('Step 4 · Pool baskets','Try a little variety.','Three ways to compare pool exposure. Each available preset splits your paper amount equally between two live pools.', '<button class="secondary" data-go="positions">View positions</button>') + pendingBanner() + `<div class="basket-grid">${state.baskets.map(basket=>`<article class="basket-card"><span class="tag ${esc(basket.name.toLowerCase())}">${esc(basket.status==='available'?'Two live pools':'Unavailable')}</span><h3>${esc(basket.name)}</h3><p class="reason">${esc(basket.reason)}</p>${basket.components.length?`<ul>${basket.components.map(item=>`<li><span>${esc(item.pool.name)}<br><small>${esc(short(item.pool.address))} · ${number(item.pool.binStep.value,0)} bps</small></span><b>${percent(item.weightBps/10000)}</b></li>`).join('')}</ul>`:'<p class="note">No complete allocation yet. Refresh after the next market read.</p>'}<p class="source">${esc(basket.source)} · ${esc(date(basket.asOf))}</p><button class="secondary" data-basket="${esc(basket.id)}" ${basket.status!=='available'?'disabled':''}>Check the basket <span aria-hidden="true">↗</span></button></article>`).join('')}</div><p class="note">Presets follow current liquidity, pool history and fee activity. “Steady” does not mean safe or stable-priced. Membership is checked again when you confirm.</p><button class="text-button" data-go="baskets">Refresh basket pools</button>`);
}
function confirmAction(action,body,description,title,copy,buttonLabel,pending = null) {
  dialogAction = {action,body,description,pending};
  $('#confirm-content').innerHTML = `<p class="eyebrow">Practice funds only</p><h2 id="confirm-title">${esc(title)}</h2><p>${copy}</p><p class="note">Paper balance settles modelled inventory before fees and trading costs. No wallet or real-money transaction is involved.</p>`;
  $('#confirm-error').hidden = true; $('#confirm-submit').textContent = buttonLabel; $('#confirm-submit').disabled = false; $('#confirm-cancel').disabled = false;
  dialog.showModal(); $('#confirm-cancel').focus();
}
function prepareDeposit() {
  const data = state.preflight; if (!data?.canOpen) return;
  if (!preflightIsFresh(data)) {toast('This price reading has expired. Refreshing the pre-flight before you confirm.');loadView(state.view);return;}
  const input = $('#paper-amount'); if (input && input.value !== state.amount) {toast('Update the amount to refresh this pre-flight first.'); input.focus(); return;}
  if (readPending()) {resumePending(); return;}
  const basket = state.view === 'basket-preflight', amount = String(data.sizeSol), label = basket ? `${data.basket.name} basket` : data.name;
  const body = basket ? {basketId:data.basket.id,amountSol:amount,poolAddresses:data.components.map(item=>item.poolAddress),confirmed:true} : {poolAddress:data.poolAddress,amountSol:amount,confirmed:true};
  const allocation = basket ? `<br>${data.components.map(item=>`${esc(item.preflight.name)}: ${sol(item.sizeSol)}`).join('<br>')}` : '';
  confirmAction(basket?'still-basket':'still-open',body,`Paper deposit of ${amount} SOL into ${label}.`,basket?'Open this paper basket?':'Open this paper position?',`Use <strong>${sol(data.sizeSol)}</strong> of your <strong>${sol(state.account.balanceSol)}</strong> practice balance for ${esc(label)}.${allocation}<br><br>${esc(data.verdict.label)}: ${esc(data.verdict.reason)}`,'Confirm paper deposit');
}
function prepareClose(id) {
  if (readPending()) {resumePending(); return;}
  const position = state.account?.positions.find(item=>item.id===id && item.status==='open'); if (!position) return;
  confirmAction('still-close',{positionId:id,confirmed:true},`Close the paper position ${id}.`,'Close this paper position?',`Close <strong>${esc(position.name)}</strong> (${esc(short(id))}). The latest modelled inventory value will return to your practice balance.<br><br>Last available gross value: <strong>${sol(position.mark.grossValueSol)}</strong>. The server checks a fresh price before closing.`,'Confirm paper close');
}
function resumePending() {
  const pending = readPending(); if (pendingReadError) {toast('Saved action cannot be read. Check positions and restore browser storage before another deposit.'); return;} if (!pending || !['still-open','still-basket','still-close'].includes(pending.action) || !pending.body?.requestId) {toast('No valid saved paper action was found.'); return;}
  confirmAction(pending.action,pending.body,pending.description,'Check your saved action?',`${esc(pending.description)}<br><br>The same request ID will be reused. If it already completed, the saved receipt is returned without repeating it.`,'Check saved action',pending);
}
$('#confirm-submit').addEventListener('click',async()=>{
  if (submitting || !dialogAction) return;
  if (!dialogAction.pending && dialogAction.action !== 'still-close' && !preflightIsFresh(state.preflight)) {dialog.close();toast('This reading expired while you reviewed it. Refreshing the pre-flight.');loadView(state.view);return;}
  submitting = true; $('#confirm-submit').disabled = true; $('#confirm-cancel').disabled = true; $('#confirm-error').hidden = true;
  let pending;
  try {
    pending = dialogAction.pending || {action:dialogAction.action,body:{...dialogAction.body,requestId:crypto.randomUUID()},description:dialogAction.description};
    savePending(pending);
    const data = await api('/api/paper/'+pending.action,pending.body);
    if (!data?.paper || !data.account || !Array.isArray(data.account.positions) || !finite(data.account.balanceSol) || data.receipt?.requestId !== pending.body.requestId) throw new Error('The action result could not be verified. Check the saved request to recover its receipt.');
    clearPending(); state.account = data.account; dialog.close();
    navigate('positions'); toast(pending.action==='still-close'?'Paper position closed.':'Paper position opened. Your real funds have not moved.');
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
document.addEventListener('click',async event=>{
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.go) {navigate(button.dataset.go);return;}
  if (button.dataset.pool) {state.pool=state.pools.find(pool=>pool.address===button.dataset.pool);state.amount='0.5';navigate('preflight');return;}
  if (button.dataset.basket) {state.basket=state.baskets.find(basket=>basket.id===button.dataset.basket);state.amount='0.5';navigate('basket-preflight');return;}
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
screen.addEventListener('submit',event=>{
  if (event.target.id!=='amount-form')return;event.preventDefault();
  const value=$('#paper-amount').value.trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)||Number(value)<.001||Number(value)>10){toast('Enter between 0.001 and 10 SOL, with at most 9 decimal places.');$('#paper-amount').focus();return;}
  state.amount=value;loadView(state.view);
});
window.addEventListener('popstate',()=>navigate(location.hash.slice(1)||'home',true));
window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;if(location.hash.slice(1)!==state.view)navigate(location.hash.slice(1)||'home',true);});
api('/api/version').then(version=>{const hash=version.git?.short || version.git?.sha || version.gitSha || version.sha || version.commit; if(typeof hash==='string')$('#build-version').textContent='· '+hash.slice(0,8);}).catch(()=>{});
navigate(location.hash.slice(1)||'home',true);
}
