import {normalizeWalletAddress,connectPhantomAddress} from './still-wallet-client.js';
let visualAssets=null,creatorAssets=null,visualLoading=null;
const loadVisualAssets=()=>visualLoading||(visualLoading=Promise.all([import('./still-assets.js'),import('./still-creators.js')]).then(([assets,creators])=>{visualAssets=assets;creatorAssets=creators.STILL_CREATORS;}).catch(()=>{visualLoading=null;}));
let STILL_LESSONS=[];
const loadLessons=()=>STILL_LESSONS.length?Promise.resolve():import('./still-lessons.js').then(module=>{STILL_LESSONS=module.STILL_LESSONS;});
// This page can only call read-only evidence routes and the isolated paper ledger.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, places = 4) => finite(value) ? value !== 0 && Math.abs(value) < 10 ** -places ? value.toExponential(2) : value.toLocaleString('en-GB', {maximumFractionDigits: places}) : 'Unavailable';
export const sol = value => finite(value) ? `${number(value, 6)} SOL` : 'Unavailable';
const signed = value => finite(value) ? `${value >= 0.0000005 ? '+' : ''}${sol(Math.abs(value)<0.0000005?0:value)}` : 'Unavailable';
const percent = value => finite(value) ? `${number(value * 100, Math.abs(value*100)<.01?4:2)}%` : 'Unavailable';
export const money = value => finite(value) ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value) : 'Unavailable';
export function netSummary(data) {
  const pct=data?.netReturnPct?.value;
  const net=finite(pct)?`${pct>0?'+':''}${number(pct,4)}%`:'Unavailable';
  const hours=data?.breakEvenHours?.value;
  const cover=data?.breakEvenStatus==='never'?"Fees don't cover costs":finite(hours)?hours<1/60?'Under 1 min':hours>48?'More than 2 days to cover costs':`Fees cover costs in about ${number(hours,2)} hours`:'Fees cover costs: Unavailable';
  return {net,cover};
}
export function directPoolAddress(search){const value=new URLSearchParams(search).get('pool');return value&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)?value:null;}
export function ticketSentence(data) {
  const usd=data?.solPriceUsd?.value,range=data?.range;
  const high=finite(usd)&&finite(range?.topPriceSol)?range.topPriceSol*usd:null;
  const low=finite(usd)&&finite(range?.floorPriceSol)?range.floorPriceSol*usd:null;
  return `You're adding <span class="sentence-chip">${esc(sol(data?.sizeSol))}</span> to <span class="sentence-chip">${esc(data?.name||'Unavailable')}</span>, from <span class="sentence-chip sentence-range">${esc(money(high))} down to ${esc(money(low))}</span>`;
}
const rangeGauge = (price,low,high,unit='SOL/token',config={}) => `<still-range-gauge${finite(price)?` price="${price}"`:''}${finite(low)?` low="${low}"`:''}${finite(high)?` high="${high}"`:''} unit="${esc(unit)}"${config.primary?' primary':''}${config.editable?' editable id="range-preview"':''}${config.shape?` shape="${esc(config.shape)}"`:''}${finite(config.binStep)?` bin-step="${config.binStep}" active-bin-price="${price}"`:''}${finite(config.feeRate)?` fee-rate="${config.feeRate}"`:''}></still-range-gauge>`;
export function gaugeConfig(data,editable=false){
 const range=data?.range, bins=range?.bins, native=range?.alignment==='native-active-bin';
 const shape=range?.shape==='BidAsk'?(Array.isArray(bins)&&bins.every(b=>b.token===0)?'bid-ask-sol':'bid-ask'):range?.shape==='Curve'?'curve':'spot';
 return {shape,primary:true,editable:editable&&native,binStep:native?range?.binStep:null,feeRate:finite(data?.feeRateHourly?.value)?data.feeRateHourly.value*24*365*100:null};
}
export function liveVerdict(data){
 const label=({'Worth it':'Worth a look','Skip':'Skip for now','Marginal':'Caution'}[data?.verdict?.label]||data?.verdict?.label),key={'Worth a look':'worth-a-look','Marginal':'marginal','Skip for now':'skip-for-now','Caution':'caution'}[label];
 return `<still-verdict class="live-verdict"${key?` verdict="${key}"`:''} heading="${esc(data?.name||data?.basket?.name||'Unavailable')}" kicker="Pre-flight" summary="${esc(data?.verdict?.reason||'Unavailable')}">${(data?.checks||[]).map(c=>`<still-check label="${esc(c.label)}" status="${esc(c.status)}" value="${esc(c.result||'Unavailable')}" reason="${esc(c.shortReason||c.tooltip||'Unavailable')} · ${esc(c.source||'Source unavailable')} · ${esc(date(c.asOf))}"></still-check>`).join('')}</still-verdict>`;
}
const short = address => address ? `${address.slice(0,5)}…${address.slice(-4)}` : 'Unavailable';
const date = at => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}) : 'Time unavailable';
const age = hours => finite(hours) ? hours < 24 ? `${number(hours,1)} hours` : `${number(hours / 24,1)} days` : 'Unavailable';
const source = value => `<small class="source">${esc(value?.source || 'Source unavailable')} · ${esc(date(value?.asOf))}</small>`;
const metric = (label, value, format = sol) => `<div class="metric"><span>${esc(label)}</span><strong class="${value?.value == null ? 'unavailable' : ''}"${finite(value?.value)?` data-still-number="${value.value}"`:''}>${esc(format(value?.value))}</strong>${source(value)}</div>`;
const SOL_MINT='So11111111111111111111111111111111111111112';
const tokenIcon=(mint)=>{const asset=visualAssets?.tokenAsset(mint);return asset?`<img class="token-icon" src="${esc(asset.src)}" alt="" width="28" height="28" loading="lazy">`:'<span class="token-icon token-unknown" aria-label="Token icon unavailable"></span>';};
const pairIcons=(mint)=>`<span class="pair-icons" aria-hidden="true">${tokenIcon(mint)}${tokenIcon(SOL_MINT)}</span>`;
const partnerLogo=id=>{const asset=visualAssets?.partnerAsset(id);return asset?`<img class="partner-logo partner-${esc(id)}" src="${esc(asset.src)}" alt="${esc(asset.name)}" width="132" height="40" loading="lazy">`:'<p class="source">Partner logo unavailable</p>';};
const removalLink=handle=>`<a class="source-link" href="https://github.com/xNFTpat/worlds-fair/issues/new?title=${encodeURIComponent('Strategy removal request: '+handle)}" target="_blank" rel="noopener noreferrer">Request removal</a>`;
function creatorIdentity(handle){if(!handle)return '';const person=creatorAssets&&Object.hasOwn(creatorAssets,handle)?creatorAssets[handle]:null,name=person?.displayName||'@'+handle;return `<div class="creator-identity"><a href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener noreferrer" class="creator-profile">${person?.image?`<img class="creator-avatar" data-initials="${esc(person.initials)}" src="${esc(person.image)}" alt="" width="40" height="40" loading="lazy">`:`<span class="creator-avatar creator-initials" aria-label="Profile picture unavailable">${esc(person?.initials||handle.slice(0,2).toUpperCase())}</span>`}<span><strong>${esc(name)}</strong><small>@${esc(handle)}</small></span></a><p>Inspired by public posts. Not endorsed.</p>${removalLink(handle)}</div>`;}
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
// Broken cached images keep their space and fall back without a remote request.
document.addEventListener('error',event=>{const img=event.target;if(img?.tagName!=='IMG')return;let fallback;if(img.classList.contains('creator-avatar')){fallback=document.createElement('span');fallback.className='creator-avatar creator-initials';fallback.textContent=img.dataset.initials||'?';fallback.setAttribute('aria-label','Profile picture unavailable');}else if(img.classList.contains('token-icon')){fallback=document.createElement('span');fallback.className='token-icon token-unknown';fallback.setAttribute('aria-label','Token icon unavailable');}else if(img.classList.contains('partner-logo')){fallback=document.createElement('p');fallback.className='source';fallback.textContent='Partner logo unavailable';}if(fallback)img.replaceWith(fallback);},true);

const state = {view:'home',pool:null,basket:null,preflight:null,account:null,pools:[],baskets:[],amount:'0.5',range:null,load:0,pending:null,poolData:null,positionTab:'open'};
let preferences; try {preferences=readOnboarding(localStorage);} catch {preferences={complete:false,preference:'balanced'};}
let onboardingStep=0;
const expandedGroups=new Set();
let recentPositions=new Set();
function readSaved(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{toast("Couldn't save that. Your pick still works this session.");}}
let poolPrefs=readSaved('still:pools:v2',{sort:'volume',filter:'All'});
if(!['volume','pace','fees','ratio','newest','steady'].includes(poolPrefs.sort)||!['All','Steady','Busy','Spicy'].includes(poolPrefs.filter))poolPrefs={sort:'volume',filter:'All'};
const verdictLabel=label=>label==='Skip'?'Skip for now':label==='Worth it'?'Worth a look':label==='Marginal'?'Caution':label;
const verdictVisual=label=>`<span class="verdict-label">${esc(label||'Unavailable')}</span>`;
const holdLabel=minutes=>minutes<60?`${minutes} minutes`:`${number(minutes/60,1)} hours`;
const sumKnown=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):values.length?null:0;

const screen = $('#screen'), dialog = $('#confirmation');
let dialogAction = null, submitting = false, noticeTimer;
const pendingKey = 'still:guided:pending:v1';
let pendingReadError = false;
const cloneRecovery = pending => ({action:'still-clone',body:{requestId:typeof pending.body?.requestId==='string'?pending.body.requestId:null},description:'Check the saved paper copy.'});
function readPending() {
  try {
    let value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    if(value?.action==='still-clone'){
      const recovery=cloneRecovery(value);
      // Also scrub legacy saved payloads. Reload recovery never needs identities.
      if(JSON.stringify(value)!==JSON.stringify(recovery))sessionStorage.setItem(pendingKey,JSON.stringify(recovery));
      value=state.pending?.action==='still-clone'&&state.pending.body?.requestId===recovery.body.requestId?state.pending:recovery;
    }
    pendingReadError = !!value && (!['still-open','still-clone','still-basket','still-close','still-follow','still-unfollow','still-bot','still-park'].includes(value.action) || !value.body?.requestId);
    return pendingReadError ? {invalid:true} : value;
  } catch { pendingReadError = true; return {invalid:true}; }
}
function savePending(pending) { sessionStorage.setItem(pendingKey, JSON.stringify(pending.action==='still-clone'?cloneRecovery(pending):pending)); state.pending = pending; }
function clearPending() { sessionStorage.removeItem(pendingKey); state.pending = null; }
function forgetCloneSources(){
  if(state.pending?.action==='still-clone')state.pending=cloneRecovery(state.pending);
  if(dialogAction?.action==='still-clone'){
    const pending=dialogAction.pending?cloneRecovery(dialogAction.pending):state.pending?.action==='still-clone'?state.pending:null;
    dialogAction=pending?{action:pending.action,body:pending.body,description:pending.description,pending}:null;
    $('#confirm-content').innerHTML='';
    if(!submitting)dialog.close();
  }
}
readPending(); // Strip legacy clone identities even when reopening on Home.
async function api(path, body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, {method:body ? 'POST':'GET', credentials:'same-origin', cache:'no-store', headers:body ? {'content-type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {}), signal:controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error('The server response could not be read. Try again.'); }
    if (!response.ok) {const error = new Error(data.error || 'This request could not be completed.'); error.status = response.status; error.code = data.code; throw error;}
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('The request is taking too long. Retry to check the same paper action.'); throw error; }
  finally { clearTimeout(timeout); }
}
function toast(message) { clearTimeout(noticeTimer); $('#notice').dataset.opened=String(message.startsWith('Paper position opened.')); $('#notice').textContent = message; $('#notice').hidden = false; noticeTimer = setTimeout(() => $('#notice').hidden = true, 6000); }
function loading(message, count = 2) {
  screen.setAttribute('aria-busy','true');
  const preflight=['preflight','basket-preflight'].includes(state.view);
  window.StillFavicon?.stop();
  if(preflight){screen.innerHTML=`<still-reveal id="preflight-reveal" label="Running Pre-flight" autoplay style="--still-reveal-min:640px"><div class="preflight-loading-space" aria-hidden="true"></div></still-reveal>`;window.StillFavicon?.start();}
  else screen.innerHTML=`<div class="motion-loading"><still-loader class="still-intro still-intro--late" label="${esc(message)}" statuses="${esc(message)}" autoplay></still-loader></div><div class="cards loading-skeletons">${Array.from({length:count},()=>'<div class="skeleton" aria-hidden="true"></div>').join('')}</div>`;
}
let afterStillRender=()=>{};
function show(html) {
  screen.setAttribute('aria-busy','false');window.StillFavicon?.stop();
  const reveal=screen.querySelector?.('#preflight-reveal');
  if(reveal?.reveal&&reveal.querySelector('.sr-content')){
    reveal.querySelector('.sr-content').innerHTML=html;
    reveal.reveal().catch(()=>{reveal.dataset.state='done';reveal.querySelector('.sr-stage').hidden=true;reveal.querySelector('.sr-content').removeAttribute('aria-hidden');});
  }else screen.innerHTML = html;
  afterStillRender(screen);
}
function errorPanel(message, retry = state.view) { show(`<div class="empty error"><h3>This reading is unavailable</h3><p>${esc(message)}</p><button class="primary" data-go="${esc(retry)}">Try again</button> <button class="text-button" data-go="pools">Choose a pool</button></div>`); }
function pendingBanner() { const pending = readPending(); if (pendingReadError) return `<div class="panel error"><h3>Saved action unavailable</h3><p class="note">Browser storage could not be read. Check your positions before trying another deposit. Restore storage access and reload to recover the saved request.</p><button class="secondary" data-go="positions">Check positions</button></div>`; return pending ? `<div class="panel"><h3>A paper action needs checking</h3><p class="note">${esc(pending.description || 'The last response was interrupted.')} Retry the saved request to check its result without opening or closing twice.</p><button class="secondary" data-action="resume">Check saved action</button></div>` : ''; }
async function ensureAccount() { if (!state.account) { const data = await api('/api/paper/still-account'); if(!data?.paper||!data.account||!Array.isArray(data.account.positions)||!finite(data.account.balanceSol))throw new Error('Your paper account could not be read. Try again before opening a position.'); state.account = data.account; } return state.account; }
function navigate(view, replace = false) {
  if (!['home','pools','preflight','positions','baskets','basket-preflight','onboarding','follow','park','learn','wallet'].includes(view)) view = 'home';
  if(view==='preflight'&&!state.pool){const address=directPoolAddress(location.search);if(address)state.pool={address};else view='pools';}
  if (view === 'basket-preflight' && !state.basket) view = 'baskets';
  if(view!==state.view&&dialog.open&&!submitting){dialog.close();dialogAction=null;}
  const path = view === 'home' ? location.pathname + location.search : '#' + view;
  if (location.hash !== path) history[replace ? 'replaceState':'pushState'](null,'',path);
  if(state.view==='wallet'&&view!=='wallet'){walletGeneration++;walletBusy=false;walletReading.clear();}
  const previous=state.view;state.view = view;
  const updatePage=()=>{if(state.view!==view)return;$('#home').hidden = view !== 'home'; if($('#pillars'))$('#pillars').hidden=view!=='home'; $('#journey').hidden = view === 'home';};
  if(previous!==view&&window.StillWipe)window.StillWipe.run(updatePage).catch(updatePage);else updatePage();
  if(view==='home')window.StillFavicon?.stop();
  for (const button of document.querySelectorAll('.steps button')) button.setAttribute('aria-current', button.dataset.go === (view === 'basket-preflight' ? 'baskets' : view) ? 'step':'false');
  for(const button of document.querySelectorAll('.primary-nav button,.mobile-nav button'))button.setAttribute('aria-current',button.dataset.go===(view==='preflight'||view==='basket-preflight'||view==='baskets'?'pools':view==='wallet'?'positions':view)?'page':'false');
  $('#step-preflight').disabled = !state.pool;
  window.scrollTo({top:0,behavior:'instant'});
  if (view !== 'home') loadView(view); else {state.load++;onboardingStep=0;}
}
async function loadView(view) {
  const load = ++state.load;
  loading({pools:'Loading pools from Meteora…',positions:'Marking positions to live prices…',baskets:'Loading pools from Meteora…',preflight:'Running checks…','basket-preflight':'Running checks…',follow:'Loading strategies…',park:'Getting live vault and basket rates…',learn:'Loading lesson…'}[view]||'Getting live pool data…');
  try {
    await loadVisualAssets();if(load!==state.load)return;
    if(view==='wallet'){renderWallet();return;}
    if(view==='onboarding'){renderOnboarding();ensureAccount().then(()=>{if(load===state.load)renderOnboarding();}).catch(()=>{});return;}
    if(view==='follow'){const data=await api('/api/paper/still-account');if(load!==state.load)return;state.account=data.account;state.strategies=data.strategies||[];renderFollow();return;}
    if(view==='park'){const [account,rates]=await Promise.all([api('/api/paper/still-account'),api('/api/still/park').catch(()=>null)]);if(load!==state.load)return;state.account=account.account;parkData=rates;renderPark();return;}
    if(view==='learn'){await loadLessons();if(load!==state.load)return;renderLearn();return;}
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
    const copy={follow:"Couldn't load paper results.",pools:`Couldn't reach Meteora. Last update ${date(state.poolData?.updatedAt)}.`,preflight:"Couldn't run Pre-flight for this pool.",positions:`Prices are stale since ${date(state.account?.updatedAt)}. Net may be out of date.`}[view]||error.message;
    show(`<div class="empty error"><h3>${esc(copy)}</h3><p>${esc(error.message)}</p><button class="primary" data-go="${view==='preflight'?'pools':esc(view)}">${view==='preflight'?'Back to pools':view==='positions'?'Refresh':'Try again'}</button></div>`);
  }}
}
function renderOnboarding() {
  const steps=[['You lend tokens to a pool. Traders pay you fees.', 'On Meteora you pick a price range. While the price trades inside it, you earn a share of every swap. If the price leaves your range, you stop earning, and you may end up holding more of the token that fell.'],['This is paper.', 'Nothing here touches your wallet. Positions use live prices and fees, but the money is pretend. Use it to see what a trade would cost you before it does.'],['How calm do you want to be?', 'This sets your defaults. Change it any time in Settings.']];
  const [title,copy]=steps[onboardingStep];
  show(`<div class="onboarding"><div class="intro-top"><div class="step-dots" aria-label="Step ${onboardingStep+1} of 3">${[0,1,2].map(n=>`<i class="${n===onboardingStep?'selected':''}"></i>`).join('')}</div><button class="text-button" data-onboard="skip">Skip intro</button></div><h2>${title}</h2>${onboardingStep!==2?`<p>${copy}</p>`:''}${onboardingStep===0?'<div class="lesson-range" role="img" aria-label="Illustration: inside your range, trades use your liquidity; below it you hold the paired token, above it SOL"><span>Paired token</span><b>Your range<i class="price-dot"></i></b><span>SOL</span></div>':onboardingStep===1?`<div class="balance"><div><span>Your practice balance</span><strong>${sol(state.account?.balanceSol)}</strong><small class="source">Still paper ledger · ${esc(date(state.account?.updatedAt))}</small></div></div>`:`<div class="pace-options" role="group" aria-label="Your preferred pace">${['calm','balanced','quick'].map(key=>`<button class="secondary" data-pace="${key}" aria-pressed="${preferences.preference===key}"><strong>${key[0].toUpperCase()+key.slice(1)}</strong><span>${{calm:'Wider ranges, established pools, fewer prompts.',balanced:'A mix. Some busy pools, sensible floors.',quick:'Narrow, short positions on busy pools. More checks, more attention.'}[key]}</span></button>`).join('')}</div><p class="note">${copy}</p>`}<div class="onboarding-actions"><button class="primary" data-onboard="${onboardingStep===2?'finish':'next'}">${['Next','Got it','Show me pools'][onboardingStep]}</button>${onboardingStep?'<button class="text-button" data-onboard="back">Back</button>':''}</div></div>`);
}
function finishOnboarding(){preferences.complete=true;try{localStorage.setItem('still:onboarding:v1',JSON.stringify(preferences));}catch{show(`<div class="empty"><h3>Couldn't save that. Your pick still works this session.</h3><button class="primary" data-go="pools">Continue</button></div>`);return;}navigate('pools');}
let selectedLesson=0;
const savedLessons=readSaved('still:lessons:v1',[]);
const readLessons=new Set(Array.isArray(savedLessons)?savedLessons.filter(n=>Number.isInteger(n)&&n>=1&&n<=8):[]);
async function openLesson(id){const viewLoad=state.load;try{await loadLessons();}catch{toast('This lesson is unavailable right now. Try again shortly.');return;}if(viewLoad!==state.load)return;selectedLesson=Number(id);if(!STILL_LESSONS.some(l=>l.id===selectedLesson)){selectedLesson=0;}else{readLessons.add(selectedLesson);saveLocal('still:lessons:v1',[...readLessons]);}if(state.view==='learn')renderLearn();else navigate('learn');}
function renderLearn(){
 const lesson=STILL_LESSONS.find(l=>l.id===selectedLesson);
 const list=`<ol class="lesson-list" aria-label="Lessons">${STILL_LESSONS.map(l=>`<li class="${l.id===selectedLesson?'selected':''}"><span class="lesson-number" aria-hidden="true">${l.id}</span><span>${esc(l.title)}${readLessons.has(l.id)?'<small class="read-tick">✓ Read</small>':''}</span><button class="text-button" data-lesson="${l.id}" aria-label="Read: ${esc(l.title)}" ${l.id===selectedLesson?'aria-current="true"':''}>Read</button></li>`).join('')}</ol>`;
 const illustration=lesson?.diagram==='range'?'<div class="lesson-range" aria-hidden="true"><span>Token</span><b>Your range<i class="price-dot"></i></b><span>SOL</span></div>':lesson?.diagram==='shapes'?'<div class="shape-examples" aria-hidden="true"><span>Spot<i>▅▅▅▅▅</i></span><span>Curve<i>▂▅█▅▂</i></span><span>Bid-Ask<i>█▅▂▅█</i></span></div>':'<div class="concept-line" aria-hidden="true"><i></i><i></i><i></i></div>';
 const detail=lesson?`<article class="lesson-body panel"><button class="text-button lesson-back" data-action="lesson-list">Back to lessons</button><p class="eyebrow">Lesson ${lesson.id} · About a minute</p><h3 id="lesson-title" tabindex="-1">${esc(lesson.title)}</h3><p>${esc(lesson.body)}</p><figure class="lesson-example">${illustration}<figcaption>${esc(lesson.example)}</figcaption><small class="source">Conceptual example · not live market data</small></figure><div class="lesson-actions">${lesson.id<8?`<button class="primary" data-lesson="${lesson.id+1}">Next lesson</button>`:'<button class="primary" data-action="lesson-list">Back to lessons</button>'}<button class="text-button" data-go="${lesson.id===8?'park':state.pool?'preflight':'pools'}">Try it</button></div></article>`:'<div class="lesson-welcome panel"><h3>A little clarity goes a long way.</h3><p>Pick a lesson. Try the idea on paper.</p><button class="primary" data-lesson="1">Read the first lesson</button></div>';
 show(heading('Learn','Learn','Eight short lessons. Each takes about a minute.')+`<div class="learn-layout ${lesson?'reading':''}">${list}${detail}</div>`);
 if(selectedLesson)$('#lesson-title')?.focus();
}
function mixCards(){return `<section class="starter-mixes"><h3>Starter mixes</h3><p class="note">Not sure where to begin? Three ready-made paper sets.</p><div class="mix-grid">${state.baskets.map(b=>`<article class="panel"><h3>${esc(b.name)}</h3><div class="basket-pair-icons">${(b.components||[]).map(c=>pairIcons(c.pool?.pairedMint)).join('')}</div><p>${esc(b.reason)}</p><small class="source">${esc(b.source)} · ${esc(date(b.asOf))}</small><button class="text-button" data-basket="${esc(b.id)}" ${b.status!=='available'?'disabled':''}>Try this mix on paper</button>${b.status!=='available'?'<small class="source">Unavailable. Waiting for enough eligible live pools.</small>':''}</article>`).join('')}</div></section>`;}
function renderPools(data) {
  let pools=state.pools.filter(p=>poolPrefs.filter==='All'||p.risk.label===poolPrefs.filter);
  const rank={Steady:0,Busy:1,Spicy:2},value=(p,key)=>finite(p[key]?.value)?p[key].value:null;
  if(poolPrefs.sort!=='pace')pools=[...pools].sort((a,b)=>{
    if(a.thinExample!==b.thinExample)return a.thinExample?1:-1;
    const key={volume:'volume1hUsd',fees:'fees24hUsd',ratio:'fees24hFraction',newest:'ageHours'}[poolPrefs.sort];
    if(!key)return rank[a.risk.label]-rank[b.risk.label];
    const av=key==='fees24hUsd'?finite(a.tvlUsd.value)&&finite(a.fees24hFraction.value)?a.tvlUsd.value*a.fees24hFraction.value:null:value(a,key),bv=key==='fees24hUsd'?finite(b.tvlUsd.value)&&finite(b.fees24hFraction.value)?b.tvlUsd.value*b.fees24hFraction.value:null:value(b,key);
    return av===null?bv===null?0:1:bv===null?-1:poolPrefs.sort==='newest'?av-bv:bv-av;
  });
  const cards=pools.map(pool=>{
    const summary=pool.cardSummary, label=summary?.verdict?.label?verdictLabel(summary.verdict.label):'Unavailable';
    const status=label==='Worth a look'?'pass':label==='Caution'?'caution':label==='Skip for now'?'fail':'unavailable';
    const reasons=Array.isArray(summary?.reasons)?summary.reasons.slice(0,3):[];
    return `<article class="pool-card still-texture"><div class="card-title"><div><h3 class="token-title">${pairIcons(pool.pairedMint)}${esc(pool.name)}</h3><small>${esc(short(pool.address))}</small></div><span title="Tags describe how a pool behaves, not whether it's a good idea.">${tag(pool.risk)}${pool.thinExample?'<span class="tag">Thin pool example</span>':''}</span></div><div class="pool-verdict ${status}"><p class="eyebrow">Pre-flight · 0.5 paper SOL</p><h4>${verdictVisual(label)}</h4><p>${esc(summary?.verdict?.reason||'Run Pre-flight to read the current costs and risks.')}</p></div><ul class="pool-reasons">${reasons.length?reasons.map(reason=>`<li><strong>${esc(reason.label)}</strong><span>${esc(reason.shortReason||reason.result)}</span>${checkChip(reason)}${source(reason)}</li>`).join(''):'<li>Costs, token settings and downside are unavailable until checked.</li>'}</ul><button class="primary" data-pool="${esc(pool.address)}">Run Pre-flight ↗</button><small class="source">${esc(summary?.scope||'Default paper setup. A fresh check runs when you open the pool.')}</small><details class="pool-details"><summary>Pool data & behaviour</summary><p class="reason">${esc(pool.risk.reason)}</p><div class="metrics pool-metrics">${metric('Fees 24h',{...pool.fees24hFraction,value:finite(pool.fees24hFraction.value)&&finite(pool.tvlUsd.value)?pool.fees24hFraction.value*pool.tvlUsd.value:null},money)}${metric('TVL',pool.tvlUsd,money)}${metric('Volume 1h',pool.volume1hUsd,money)}${metric('Fees/TVL',pool.fees24hFraction,percent)}${metric('Bin step',pool.binStep,v=>finite(v)?number(v,0)+' bps':'Unavailable')}${metric('Age',pool.ageHours,age)}${metric('1h fee trend',pool.feeTrend,v=>finite(v)?`${v>0?'+':''}${percent(v)}`:'Unavailable')}</div></details></article>`;
  }).join('');
  show(heading('Practise','Pick a pool','Top eligible SOL-paired pools by one-hour volume, plus the thin-pool example. Tap one to run a Pre-flight check.','<button class="secondary" data-go="pools">Refresh</button>')+`<p class="note">Nothing is deposited. Meteora one-hour volume · cached for five minutes · ${esc(date(data.updatedAt))}.${data.unavailable?' Live hot-pool list Unavailable.':''}</p>`+pendingBanner()+`<div class="pool-controls"><label>Sort <select id="pool-sort">${[['volume','One-hour volume'],['pace','Your pace'],['fees','Most fees'],['ratio','Fees/TVL'],['newest','Newest'],['steady','Steadiest']].map(([v,l])=>`<option value="${v}" ${poolPrefs.sort===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="filter-chips" aria-label="Pool tags">${['All','Steady','Busy','Spicy'].map(f=>`<button class="secondary" data-filter="${f}" aria-pressed="${poolPrefs.filter===f}">${f}</button>`).join('')}</div></div><p class="note">Tags describe how a pool behaves, not whether it's a good idea. <button class="text-button" data-action="preferences">Change pace</button></p>`+(cards?`<div class="cards pool-list">${cards}</div>`:`<div class="empty"><h3>No pools match these filters.</h3><button class="primary" data-filter="All">Clear filters</button></div>`)+mixCards());
}
function costRow(label,evidence,format=sol) { return `<div class="cost-row"><div>${esc(label)}${source(evidence)}<small class="source">${esc(evidence?.note || '')}</small></div><strong>${esc(format(evidence?.value))}</strong></div>`; }
function scenarioCards(data) { return `<section class="panel"><h3>If the paired token price in SOL falls…</h3><p class="note">Both scenarios are in SOL terms, before fees and trading costs. The price floor is not a stop-loss.${data.basket ? ' Each paired token falls by the same percentage.' : ''}</p><div class="scenario-grid">${data.scenarios.map(item=>`<article class="scenario"><h4>Price drops ${percent(item.dropFraction)}</h4><strong>${sol(item.grossValueSol.value)}</strong><small>Paper inventory value</small>${source(item.grossValueSol)}<p class="note">${signed(item.grossPnlSol.value)} vs holding ${sol(data.sizeSol)}<br>Net proceeds: ${sol(item.netValueSol.value)}</p></article>`).join('')}</div><p class="note">Holding SOL keeps ${sol(data.sizeSol)} in either scenario. This ideal model follows a downward price path through the bins. It excludes transfer taxes, slippage and liquidity limits.</p></section>`; }
function rangePanel(data) {
  const range = data.range;
  if (!range) return `<section class="panel"><h3>Suggested range unavailable</h3><p class="note">A current price and a valid bin configuration are needed. Return to the pool list to choose another pool.</p></section>`;
  const bins = range.bins; if(!Array.isArray(bins)||!bins.length||!finite(data.priceSol?.value)||data.priceSol.value<=0||bins.some(b=>!finite(b.sol)||b.sol<0||!finite(b.token)||b.token<0||!finite(b.priceSol)||b.priceSol<=0))return '<section class="panel"><h3>Paper range</h3><p>Unavailable. A current price and complete bin amounts are required.</p></section>'; const allocation=bin=>bin.sol+bin.token*data.priceSol.value, maximum = Math.max(1e-12,...bins.map(allocation));
  const shape=range.shape==='BidAsk'?'Bid-Ask':range.shape, twoSided=bins.some(bin=>bin.token>0);
  const explanation=twoSided?'Start with SOL and the paired token, spread across your selected range. You earn modelled fees only while price is in range.':'Start entirely in SOL. Your range buys the paired token as price falls. You earn no fees while the price is above it.';
  return `<section class="panel"><p class="eyebrow">Suggested paper setup</p><h3>${esc(shape)} · ${twoSided?'provide on both sides of price':'buy gradually if price falls'}</h3><p class="note">${explanation}</p><div class="range-visual" role="img" aria-label="Paper allocation by price, measured in SOL at entry">${bins.filter((_bin,i)=>i%Math.max(1,Math.ceil(bins.length/30))===0).map(bin=>`<i style="height:${Math.max(4,allocation(bin)/maximum*80)}px"></i>`).join('')}</div><div class="range-labels"><span>Floor ${number(range.floorPriceSol,9)} SOL/token</span><span>Top ${number(range.topPriceSol,9)} SOL/token</span></div><p class="note">Floor ${percent(range.depthFraction)} below the observed price · ${number(range.binCount,0)} bins · ${esc(range.alignment === 'native-active-bin' ? 'Native grid' : 'Paper grid')}</p>${source(range)}<details class="evidence-details"><summary>How this suggestion works</summary><p>${esc(range.note)}</p><p>The floor defines the last buy level, not a maximum loss. Below it, the model holds the paired token.</p></details></section>`;
}
function poolEvidence(data) {
  const exitLabel=data.exitCostComplete===false?'Paper exit cost · known minimum':'Paper exit cost';
  const exitFormat=value=>finite(value)?`${data.exitCostComplete===false?'At least ':''}${sol(value)}`:'Unavailable';
  return `<section class="cost-evidence"><h3>Fee pace & costs</h3><div class="metrics">${metric('Paper daily fee pace',data.expectedFeesPerDaySol)}${metric('Observed token price',data.priceSol,value=>finite(value)?`${number(value,9)} SOL/token`:'Unavailable')}</div><p class="note">${esc(data.expectedFeesPerDaySol?.note||'Fee pace unavailable.')}</p>${costRow('Entry transaction fee',data.entryTransactionFeeSol)}${costRow('SOL exchanged into paired token · not a fee',data.entrySwapAmountSol)}${costRow('Entry swap cost · fees and price impact',data.entryConversionSol)}${costRow('Deposit, returned on close',data.positionRentSol)}<p class="note">The returnable position deposit is excluded from net costs. It is a chain-priced rent requirement, not a fee.</p>${costRow('One-off setup cost · not returned',data.setupCostSol)}${costRow('Token-2022 transfer fee rate',data.transferFeeBps,value=>finite(value)?percent(value/10000):'Unavailable')}${costRow('Token-2022 exit transfer fee',data.exitTransferFeeSol)}${costRow('Minimum exit pool fee',data.exitPoolFeeSol)}${costRow('Paper entry cost',data.entryCostSol)}${costRow(exitLabel,data.exitCostSol,exitFormat)}${data.betterThanMid?'<small class="source better-than-mid">Better than mid</small>':''}${costRow('Paper round-trip cost',data.roundTripCostSol)}${costRow('Paper net at planned hold',data.paperCostModel?.netAfterHoldSol,signed)}<details class="evidence-details"><summary>See conversion and network evidence</summary>${costRow('Entry conversion only',data.entryConversionSol)}${costRow('Reference exit conversion only',data.exitConversionSol)}${costRow('Paper network base fees',data.networkCostSol)}</details></section>`;
}
function renderPreflight(data,basket) {
  const label=verdictLabel(data.verdict.label),skip=data.verdict.label==='Skip',range=data.range,hold=holdLabel(data.options?.holdMinutes||240);
  const verdictKey=label==='Worth a look'?'worth-a-look':label==='Skip for now'?'skip-for-now':'marginal';
  const amount=`<form class="amount-form" id="amount-form"><label for="paper-amount">${basket?'Total mix amount':'Position size'}</label><div class="amount-input"><input id="paper-amount" inputmode="decimal" value="${esc(state.amount)}" autocomplete="off" required><span>SOL</span></div><button class="secondary" type="submit">Update</button></form>`;
  const summary=netSummary(data);
  const checks=basket?data.components.map(item=>`<details class="component"><summary>${esc(item.preflight.name)} · ${sol(item.sizeSol)}</summary>${checkRows(item.preflight)}</details>`).join(''):checkRows(data);
  const missing=basket?data.components.reduce((n,c)=>n+(c.preflight.checks||[]).filter(r=>r.status==='unavailable').length,0):(data.checks||[]).filter(c=>c.status==='unavailable').length;
  const sentence=basket?`You're adding <span class="sentence-chip">${esc(sol(data.sizeSol))}</span> to <span class="sentence-chip">${esc(data.basket.name)}</span>`:ticketSentence(data);
  const strategy=range?.shape==='BidAsk'?'Bid-Ask':range?.shape||'Unavailable';
  const actions=`<div class="preflight-actions">${skip?'<button class="primary" data-go="pools">Back to pools</button>':''}<button class="${skip?'text-button':'primary'}" data-action="deposit" data-ripple ${!data.canOpen?'disabled':''}>${skip?'Open on paper anyway':'Open on paper'}</button>${!skip?'<button class="text-button" data-go="pools">Back to pools</button>':''}</div>`;
  show(heading('Practise',basket?'Pre-flight: '+data.basket.name:'Pre-flight: '+data.name,'A clearer view before you put anything in.',basket?'':'<button class="text-button" data-action="change-range">Change range</button>')+pendingBanner()+`<article class="still-ticket preflight-ticket"><div class="still-ticket__top still-glass">${data.thinExampleOnly?`<p class="verdict-reason thin-example-warning">Liquidity under $5k · Thin-pool example only</p><p class="thin-exit">Exit cost ${esc(sol(data.exitCostSol?.value))} · ${esc(finite(data.exitCostSol?.value)?percent(data.exitCostSol.value/data.sizeSol):'Unavailable')} of this position</p>`:''}<p class="ticket-sentence">${sentence}</p><p class="ticket-settings"><span class="sentence-chip strategy-chip">${esc(basket?'Basket':strategy)}</span><span>Planned hold ${esc(hold)}</span></p>${basket?'':source(data.solPriceUsd)}${!basket?`<div class="ticket-gauge">${rangeGauge(data.priceSol?.value,range?.floorPriceSol,range?.topPriceSol,'SOL/token',gaugeConfig(data))}${source(data.priceSol)}</div>`:''}<div class="ticket-overview"><section><p class="still-kicker">Verdict</p><h3 class="still-verdict" data-verdict="${verdictKey}">${esc(label)}</h3><p class="verdict-reason">${esc(data.verdict.reason)}</p>${data.betterThanMid?'<small class="source better-than-mid">Better than mid</small>':''}<div class="ticket-net"><span>Paper net after ${esc(hold)} · of ${esc(sol(data.sizeSol))}</span><strong ${summary.net==='Unavailable'?'data-missing class="unavailable"':`data-still-number="${data.netReturnPct?.value}"`}>${esc(summary.net)}</strong>${source(data.netReturnPct)}<p class="cover-time">${esc(summary.cover)}</p>${source(data.breakEvenHours)}</div><p class="note">At the current fee pace, assuming the price stays in range. Not a prediction.</p>${!basket&&data.exitCostComplete===false?`<p class="note">${finite(data.exitCostSol?.value)?'Exit cost is a known minimum. The swap quote is unavailable, so complete costs and net remain Unavailable.':'Exit cost is Unavailable. A complete exit quote could not be verified, so net remains Unavailable.'}</p>`:''}</section><aside class="ticket-action">${amount}${!basket?`<div class="ticket-deposit"><span>Deposit, returned on close</span><strong${finite(data.positionRentSol?.value)?'':' class="unavailable"'}>${esc(sol(data.positionRentSol?.value))}</strong>${source({source:'Solana RPC · position rent',asOf:data.positionRentSol?.asOf})}<p class="note">Returned on close; excluded from net.</p></div>`:''}${actions}<p class="note">${sol(state.account?.balanceSol)} practice balance${source({source:'Still paper ledger',asOf:state.account?.updatedAt})}</p><p class="note">Paper only. This is a cost check, not advice.</p></aside></div><p class="note">${missing} checks unavailable. The verdict uses what we could read. <button class="text-button" data-go="${basket?'basket-preflight':'preflight'}">Retry missing</button></p></div>${basket?data.components.map(c=>liveVerdict(c.preflight)).join(''):liveVerdict(data)}<details class="still-ticket__fold"><summary>See the numbers</summary><section class="check-card" aria-label="Detailed check evidence">${checks}</section>${basket?data.components.map(c=>poolEvidence(c.preflight)).join('')+scenarioCards(data):poolEvidence(data)+rangePanel(data)}<p class="note">${esc(data.paperCostModel?.note||'Complete cost evidence is unavailable.')} ${esc(data.paperCostModel?.netAfterHoldSol?.note||'')}</p><p class="note">Example screening thresholds. Paper costs use dated quotes and an RPC-priced message plan. They are not an executed LP result. Paper fees are modelled observations, not actual LP earnings.</p></details></article>`);
}
function checkChip(c){const status=['pass','fail'].includes(c.status)?c.status:'caution';return `<span class="check-chip still-chip still-chip--${status}"><svg viewBox="0 0 24 24" aria-hidden="true">${status==='pass'?'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>':status==='caution'?'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>':'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>'}</svg>${c.id==='freeze'&&c.status==='caution'?'Known issuer · Caution':status[0].toUpperCase()+status.slice(1)}</span>`;}
function checkRows(data){return (data.checks||[]).map((c,i)=>`<details class="check-row ${esc(c.status)}" style="--row:${i}"><summary><span class="status-dot" aria-label="${esc(c.status)}"></span><span><strong>${esc(c.label)}</strong><span class="check-result">${['half','drop20'].includes(c.id)?'Paper · ':''}${esc(c.shortReason||c.result)}</span></span><span class="check-status">${checkChip(c)}</span></summary><p>${esc(c.result)}</p>${source(c)}<p>${esc(c.tooltip)} <a href="#learn" data-lesson="${c.lesson}">Learn more</a></p></details>`).join('')||`<p class="note">Unavailable. Couldn't read the screening checks. Treat this as unknown.</p>`;}

function changeRange(){
 const r=state.range||{shape:'BidAsk',floorPct:47.5,ceilingPct:0,holdMinutes:240},data=state.preflight,range=data?.range;
 const config=gaugeConfig(data,true),selected=config.shape;
 $('#range-content').innerHTML=`<h2 id="range-title">Change range</h2><p>Paper settings. Drag an edge or use arrow keys to move one real bin at a time. The paper model still caps setup at 69 bins.</p><div class="range-shapes" role="group" aria-label="Liquidity shape">${[['spot','Spot','Even depth'],['bid-ask-sol','SOL-only Bid-Ask','Deepest at the low end'],['bid-ask','Two-sided Bid-Ask','Deepest at both edges']].map(([v,label,copy])=>`<button type="button" class="still-tile" data-range-shape="${v}" aria-pressed="${v===selected}"><still-mini-chart shape="${v}"></still-mini-chart><strong>${label}</strong><small>${copy}</small></button>`).join('')}</div><div class="range-preview">${rangeGauge(data?.priceSol?.value,range?.floorPriceSol,range?.topPriceSol,'SOL/token',config)}${source(data?.priceSol)}<p class="note">${config.binStep?`Bin step ${number(config.binStep)} bps. Edges snap to the confirmed active-bin grid.`:'Bin step unavailable. Dragging is disabled until a native grid is verified.'}</p></div><div class="range-fields"><label>Position size (SOL)<input name="amountSol" inputmode="decimal" value="${esc(state.amount)}" required></label><label>Shape<select name="shape">${['Spot','BidAsk','Curve'].map(v=>`<option value="${v}" ${r.shape===v?'selected':''}>${v==='BidAsk'?'Bid-Ask':v}</option>`).join('')}</select></label><label>Floor below price (%)<input name="floorPct" type="number" min="0.1" max="90" step="any" value="${r.floorPct}" required></label><label>Ceiling relative to price (%)<input name="ceilingPct" type="number" min="-89" max="100" step="any" value="${r.ceilingPct}" required></label><label>Planned hold (minutes)<input name="holdMinutes" type="number" min="1" max="2880" step="1" value="${r.holdMinutes}" required></label></div><button class="primary" type="submit">Run Pre-flight</button><button class="text-button" type="button" data-action="cancel-range">Cancel</button>`;
 window.StillSheet.open($('#range-dialog'));
}
function syncRangePreview(){
 const form=$('#range-form'),g=$('#range-preview'),price=state.preflight?.priceSol?.value;if(!g||!finite(price))return;
 const shape=form.elements.shape.value,ceiling=Number(form.elements.ceilingPct.value);
 g.setAttribute('shape',shape==='Spot'?'spot':shape==='Curve'?'curve':ceiling<=0?'bid-ask-sol':'bid-ask');
 g.setAttribute('low',price*(1-Number(form.elements.floorPct.value)/100));g.setAttribute('high',price*(1+ceiling/100));
 for(const b of form.querySelectorAll('[data-range-shape]'))b.setAttribute('aria-pressed',String(b.dataset.rangeShape===g.getAttribute('shape')));
}
document.addEventListener('still:range',event=>{
 if(event.target.id!=='range-preview')return;const price=state.preflight?.priceSol?.value;if(!finite(price)||price<=0)return;
 const form=$('#range-form');form.elements.floorPct.value=String((1-event.detail.low/price)*100);form.elements.ceilingPct.value=String((event.detail.high/price-1)*100);
});
document.addEventListener('click',event=>{
 const b=event.target.closest?.('[data-range-shape]');if(!b?.dataset?.rangeShape)return;const form=$('#range-form'),shape=b.dataset.rangeShape;
 form.elements.shape.value=shape==='spot'?'Spot':'BidAsk';
 if(shape==='bid-ask-sol')form.elements.ceilingPct.value='0';else if(Number(form.elements.ceilingPct.value)<=0)form.elements.ceilingPct.value=String(Math.min(100,Number(form.elements.floorPct.value)));
 syncRangePreview();
});
document.addEventListener('input',event=>{if(event.target.closest?.('#range-form')&&['shape','floorPct','ceilingPct'].includes(event.target.name))syncRangePreview();});

function markEvidence(position,value) { return {value,source:position.mark.source + ' + Still paper model'+(!position.mark.asOf?' · unavailable; last checked':''),asOf:position.mark.asOf||position.mark.checkedAt}; }
function positionCard(position) {
  const reminderAt=readSaved('still:reminders:v1',{})[position.id];
  const reminder=position.status==='open'&&finite(reminderAt)&&Date.now()>=reminderAt?'<p class="note" role="status">Your planned hold has ended. Review this position before closing.</p>':'';
  const mark = position.mark, status = mark.rangeStatus === 'inside' ? 'In range' : mark.rangeStatus === 'above' ? 'Above range · waiting' : mark.rangeStatus === 'below' ? 'Below range · holding token' : 'Range status unavailable';
  const closed=position.status==='closed', held=closed?holdLabel(Math.max(0,Math.round((Date.parse(position.closedAt)-Date.parse(position.openedAt))/60000))):null;
  return `<article class="position-card still-texture ${recentPositions.has(position.id)?'new-position':''}" id="position-${esc(position.id)}">${closed?`<p>${esc(position.name)} · held ${held}</p><p>Paper fees ${sol(mark.feesSol)} · Paper costs ${sol(finite(position.entryCostsSol)&&finite(position.exitCostsSol)?position.entryCostsSol+position.exitCostsSol:null)} · Paper net ${signed(mark.netPnlSol)}</p><small class="source">Paper net on the saved entry-cost basis, not an executed exit. ${esc(mark.source)} · ${esc(date(mark.asOf))}</small>`:''}<div class="card-title"><h3>${position.status === 'closed' ? 'Closed paper position' : status}</h3><span class="tag">${position.basketName ? esc(position.basketName)+' mix' : 'Paper'}</span></div><code class="position-id">${esc(position.positionAddress)}</code>${rangeGauge(mark.priceSol,position.range?.floorPriceSol,position.range?.topPriceSol,'SOL/token',{...gaugeConfig(position),primary:false})}${reminder}${position.examplePark?'<p class="note">Separate Park example. Closing does not credit the practice balance.</p>':''}${position.strategyName?`<p class="note">Paper strategy: ${esc(position.strategyName)}</p>`:''}<div class="metrics">${metric('Paper inventory P&L vs holding SOL',markEvidence(position,mark.grossPnlSol),signed)}${metric('Paper net · entry-cost basis',{value:mark.netPnlSol,source:'Paper inventory and fees minus saved entry cost model',asOf:position.costModel?.asOf||mark.asOf},signed)}${metric('Paper exit estimate at entry',{value:position.exitCostsSol,source:position.costModel?.source||'Entry cost evidence unavailable',asOf:position.costModel?.asOf||null})}${metric('Paper fees · modelled',markEvidence(position,mark.feesSol))}${metric('Paper distance to floor',markEvidence(position,mark.distanceToFloorPct),value=>finite(value)?`${number(value,2)}%`:'Unavailable')}${metric('Paper inventory value',markEvidence(position,mark.grossValueSol))}<div class="metric"><span>Original paper amount</span><strong>${sol(position.amountSol)}</strong><small class="source">Your confirmed paper allocation · ${esc(date(position.openedAt))}</small></div></div><p class="note">${position.status==='closed' ? `Settled ${sol(position.settledLamports/1e9)} on ${esc(date(position.closedAt))}. ` : ''}${esc(position.settlementNote)}</p><details class="evidence-details"><summary>Range & evidence</summary><p>Floor ${number(position.range.floorPriceSol,9)} SOL/token · top ${number(position.range.topPriceSol,9)} SOL/token. Source: saved paper range at ${esc(date(position.entryAsOf))}.</p><p>${esc(position.range.note)}</p>${position.costModel?`<p>${esc(position.costModel.note)} ${source(position.costModel)}</p>`:''}<p>${(mark.unavailableReasons || []).map(esc).join(' ')}</p><p>${esc(state.account.feeModelNote)}</p></details>${position.status==='open'?`<div class="position-actions"><small>Opened ${esc(date(position.openedAt))}</small><button class="secondary" data-close="${esc(position.id)}">Close on paper</button><button class="text-button" data-recheck="${esc(position.poolAddress)}">Re-run Pre-flight</button></div>`:''}</article>`;
}
function renderPositions() {
 const account=state.account,all=account.positions||[],positions=all.filter(p=>p.status===state.positionTab),groups=groupPositions(positions),open=all.filter(p=>p.status==='open');
 const total=key=>sumKnown(open.map(p=>key==='exit'?p.exitCostsSol:p.mark[key])),evidence=value=>({value,source:'Still paper ledger + saved market observations',asOf:open.length?open.map(p=>p.mark.asOf||p.mark.checkedAt).filter(Boolean).sort()[0]||account.updatedAt:account.updatedAt});
 const groupHtml=groups.map(g=>`<details class="position-group" data-group="${esc(g.poolAddress)}" ${expandedGroups.has(g.poolAddress)?'open':''}><summary><span class="token-title">${pairIcons(g.positions[0]?.pairedMint)}${esc(g.name)}</span> <small>${g.positions.length} positions · ${g.positions.every(p=>p.mark.inRange!==null)?g.positions.filter(p=>p.mark.inRange===true).length:'Unavailable'} in range · Paper net ${sol(sumKnown(g.positions.map(p=>p.mark.netPnlSol)))}</small>${source({source:'Still paper ledger + saved observations',asOf:g.positions.map(p=>p.mark.asOf||p.mark.checkedAt).filter(Boolean).sort()[0]||account.updatedAt})}</summary>${g.positions.map(positionCard).join('')}</details>`).join('');
 show(heading('Practise','Positions','Your paper positions, marked to live prices.','<div class="actions"><button class="secondary" data-go="wallet">View a live wallet · read-only</button><button class="secondary" data-action="refresh-positions">Refresh paper</button></div>')+pendingBanner()+`<div class="summary-strip">${metric('Paper open positions',{value:open.length,source:'Still paper ledger',asOf:account.updatedAt},v=>number(v,0))}${metric('Paper fees',evidence(total('feesSol')))}${metric('Paper exit estimate at entry',evidence(total('exit')))}${metric('Paper net',evidence(total('netPnlSol')),signed)}</div><p class="note">Paper net uses the saved entry cost model and modelled fee observations. It is not an executed LP result. Missing costs or fee coverage stay Unavailable; check the source times.</p><div class="filter-chips" aria-label="Position status"><button class="secondary" data-position-tab="open" aria-pressed="${state.positionTab==='open'}">Open</button><button class="secondary" data-position-tab="closed" aria-pressed="${state.positionTab==='closed'}">Closed</button></div><p class="note">Practice balance: ${sol(account.balanceSol)}${source({source:'Still paper ledger',asOf:account.updatedAt})}</p>`+(groupHtml||`<div class="empty"><still-empty kind="closed" animate><h3>${state.positionTab==='open'?'No paper positions yet.':'Nothing closed yet.'}</h3><p>${state.positionTab==='open'?'Pick a pool and see the trade-offs before you practise.':'Positions you close on paper land here.'}</p><button class="primary" ${state.positionTab==='open'?'data-go="pools"':'data-position-tab="open"'}>${state.positionTab==='open'?'Pick a pool':'See open positions'}</button></still-empty></div>`)+`<button class="text-button" data-go="pools">Pick a pool</button>`+(account.park?.records||[]).map(parkRecord).join(''));

}
let walletAddress='';try{walletAddress=normalizeWalletAddress(localStorage.getItem('still:wallet-address:v1')||'');}catch{}
let walletData=null,walletError='',walletBusy=false,walletGeneration=0;
const walletDetails=new Map(),walletReading=new Set();
function walletEvidence(value,read){return {value,source:read.source||'Meteora DLMM read-only position data',asOf:read.asOf};}
function walletDetailCard(p){
 const d=walletDetails.get(p.positionAddress);
 if(walletReading.has(p.positionAddress))return '<div class="skeleton" aria-label="Reading live position checks"></div>';
 if(!d)return `<p class="note">Run Pre-flight on this position's observed inventory.</p><button class="secondary" data-wallet-check="${esc(p.positionAddress)}">Run Pre-flight</button>`;
 if(d.error)return `<p class="error-text">${esc(d.error)}</p><button class="secondary" data-wallet-check="${esc(p.positionAddress)}">Retry Pre-flight</button>`;
 const q=d.exitQuote||{};
 return `${d.checks?.length?`<section class="check-card">${checkRows(d)}</section>`:''}<div class="metrics">${metric('Live inventory value',walletEvidence(d.valueSol,d))}${metric('Live unclaimed trading fees',walletEvidence(d.feesSol,d))}${metric('Pool hourly fee pace',{value:d.feeRateHourly,source:'Meteora DLMM pool observation',asOf:d.feeAsOf},percent)}${metric('Live exit swap drag',{value:q.costSol,source:q.source,asOf:q.asOf})}${metric('Live distance to floor',walletEvidence(d.distanceToFloorPct,d),v=>finite(v)?number(v,2)+'%':'Unavailable')}${metric('Live range',walletEvidence(typeof d.inRange==='boolean'?(d.inRange?1:0):null,d),v=>v===null?'Unavailable':v===1?'In range':'Out of range')}</div><p class="note">${esc(q.note||'Exit quote unavailable.')} ${esc(d.note||'')}</p><p class="source">Observed floor ${number(d.floorPriceSol,9)} · top ${number(d.topPriceSol,9)} SOL/token · ${esc(date(d.asOf))}</p><div class="actions"><button class="primary" data-wallet-practise="${esc(p.positionAddress)}" ${d.canPractise?'':'disabled'}>Practise this on paper</button><button class="text-button" data-wallet-check="${esc(p.positionAddress)}">Refresh Pre-flight</button></div>${!d.canPractise?'<p class="note">This setup cannot be copied yet. Its exact bin allocation must be available. You can still <button class="text-button" data-go="pools">pick a pool</button>.</p>':''}`;
}
function renderWallet(){
 const positions=walletData?.positions||[],groups=groupPositions(positions);
 show(heading('Your wallet','Live positions','Read public Meteora positions, then practise a setup on paper.','<button class="secondary" data-go="positions">Paper positions</button>')+pendingBanner()+`<section class="panel wallet-access"><p class="eyebrow">Live, read-only</p><div class="wallet-choices"><button class="primary" data-action="wallet-connect" ${walletBusy?'disabled':''}>Connect Phantom <small>Read-only. No signing.</small></button><form id="wallet-form"><label for="wallet-address">Or paste a wallet address</label><div class="wallet-address-row"><input id="wallet-address" name="address" value="${esc(walletAddress)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Solana public address" required><button class="secondary" type="submit" ${walletBusy?'disabled':''}>View wallet</button></div></form></div><p class="note">Only your public address is saved in this browser. Public position reads go to Meteora, Solana RPC and Jupiter. No signature, token approval or transaction is requested.</p>${walletError?`<p class="error-text" role="alert">${esc(walletError)}</p>`:''}${walletAddress?'<button class="text-button" data-action="wallet-forget">Forget address</button>':''}</section>`+(walletBusy?'<p role="status">Reading public positions…</p><div class="skeleton" aria-hidden="true"></div>':walletData?`<p class="note">${esc(walletData.note||'Each position keeps its own address and range.')} ${source(walletData)}</p>${groups.length?groups.map(g=>`<section class="wallet-pool"><h3>${esc(g.name)}</h3>${g.positions.map(p=>`<article class="panel live-position"><div class="card-title"><h4 class="token-title">${walletDetails.get(p.positionAddress)?.pairedMint?pairIcons(walletDetails.get(p.positionAddress).pairedMint):tokenIcon(null)}${esc(p.name)}</h4><span class="tag live">Live, read-only</span></div><code class="position-id">${esc(p.positionAddress)}</code>${walletDetailCard(p)}</article>`).join('')}</section>`).join(''):walletData.status!=='available'?'<div class="empty"><h3>Positions are unavailable right now.</h3><p>Try the wallet read again or paste another address. A failed read cannot tell us whether this wallet has open positions.</p><button class="secondary" data-action="wallet-retry">Retry wallet read</button></div>':'<div class="empty"><h3>No open Meteora positions found.</h3><p>You can paste another address or start with a live pool on paper.</p><button class="primary" data-go="pools">Pick a pool</button></div>'}`:'<div class="empty"><h3>Your wallet, with a little perspective.</h3><p>Connect Phantom or paste a public address above. Your funds stay where they are.</p></div>'));
}
async function loadWallet(value){
 if(state.view!=='wallet')return;
 try{walletAddress=normalizeWalletAddress(value);}catch(error){walletError=error.message;renderWallet();return;}
 const generation=++walletGeneration;walletData=null;walletDetails.clear();walletReading.clear();walletError='';walletBusy=true;
 try{localStorage.setItem('still:wallet-address:v1',walletAddress);}catch{}
 renderWallet();
 try{const data=await api('/api/still/wallet?'+new URLSearchParams({address:walletAddress}));if(generation!==walletGeneration)return;walletData=data;if(data.status==='unavailable')walletError=data.note||'Position reads are unavailable. Try again or paste another address.';}
 catch(error){if(generation===walletGeneration)walletError='Position reads are unavailable. '+error.message+' You can paste another address.';}
 finally{if(generation===walletGeneration){walletBusy=false;if(state.view==='wallet'){renderWallet();const first=walletData?.positions?.find(p=>p.supported!==false);if(first)checkWalletPosition(first.positionAddress);}}}
}
async function checkWalletPosition(id){
 const p=walletData?.positions?.find(p=>p.positionAddress===id);if(state.view!=='wallet'||!p||walletReading.has(id))return;
 const generation=walletGeneration;walletReading.add(id);renderWallet();
 try{const d=await api('/api/still/wallet-position?'+new URLSearchParams({address:walletAddress,poolAddress:p.poolAddress,positionAddress:id}));if(generation===walletGeneration)walletDetails.set(id,d);}
 catch(error){if(generation===walletGeneration)walletDetails.set(id,{error:error.message});}
 finally{if(generation===walletGeneration){walletReading.delete(id);if(state.view==='wallet')renderWallet();}}
}
function practiseWallet(id){
 const p=walletData?.positions?.find(p=>p.positionAddress===id),d=walletDetails.get(id);if(state.view!=='wallet'||!p||!d?.canPractise)return;if(readPending()){resumePending();return;}
 confirmAction('still-clone',{walletAddress,poolAddress:p.poolAddress,positionAddress:id,amountSol:'0.5',confirmed:true},`Practise the observed ${p.name} setup with 0.5 paper SOL.`,'Practise this setup?',`Use <strong>0.5 paper SOL</strong> to copy the observed bin allocation of ${esc(p.name)}.<br>Source position: ${esc(short(id))}. Exact range and relative SOL/token allocation are re-read before opening. Your live position is unchanged. Costs for the copied allocation may be Unavailable.`,'Open on paper');
}
function renderBaskets(data) {
  show(heading('Practise','Starter mixes','Not sure where to begin? Three ready-made paper sets.', '<button class="secondary" data-go="positions">View positions</button>') + pendingBanner() + `<div class="basket-grid">${state.baskets.map(basket=>`<article class="basket-card still-texture"><span class="tag ${esc(basket.name.toLowerCase())}">${esc(basket.status==='available'?'Paper mix':'Unavailable')}</span><h3>${esc(basket.name)}</h3><p class="reason">${esc(basket.reason)}</p>${basket.components.length?`<ul>${basket.components.map(item=>`<li><span class="basket-token-name">${pairIcons(item.pool.pairedMint)}${esc(item.pool.name)}<br><small>${esc(short(item.pool.address))} · ${number(item.pool.binStep.value,0)} bps</small></span><b>${percent(item.weightBps/10000)}</b></li>`).join('')}</ul>`:'<p class="note">No complete allocation yet. Refresh after the next market read.</p>'}<p class="source">${esc(basket.source)} · ${esc(date(basket.asOf))}</p><button class="secondary" data-basket="${esc(basket.id)}" ${basket.status!=='available'?'disabled':''}>Try this mix on paper <span aria-hidden="true">↗</span></button></article>`).join('')}</div><p class="note">Presets follow current liquidity, pool history and fee activity. “Steady” does not mean safe or stable-priced. Membership is checked again when you confirm.</p><button class="text-button" data-go="baskets">Refresh mix pools</button>`);
}
function confirmAction(action,body,description,title,copy,buttonLabel,pending = null) {
  dialogAction = {action,body,description,pending};
  $('#confirm-content').innerHTML = `<p class="eyebrow">Practice funds only</p><h2 id="confirm-title">${esc(title)}</h2><p>${copy}</p><p class="note">Paper only. Nothing leaves your wallet.</p>`;
  $('#confirm-cancel').textContent=action==='still-close'?'Keep':'Cancel';
  $('#confirm-submit').toggleAttribute?.('data-ripple',['Open on paper','Follow on paper','Start paper bot','Park on paper'].includes(buttonLabel));
  $('#confirm-error').hidden = true; $('#confirm-submit').textContent = buttonLabel; $('#confirm-submit').disabled = false; $('#confirm-cancel').disabled = false;
  if(window.StillSheet)window.StillSheet.open(dialog,{from:document.activeElement,canCancel:()=>!submitting});else dialog.showModal(); $('#confirm-cancel').focus();
}
function prepareDeposit() {
  const data = state.preflight; if (!data?.canOpen) return;
  if (!preflightIsFresh(data)) {toast('This price reading has expired. Refreshing the Pre-flight before you confirm.');loadView(state.view);return;}
  const input = $('#paper-amount'); if (input && input.value !== state.amount) {toast('Update the amount to refresh this Pre-flight first.'); input.focus(); return;}
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
  const pending = readPending(); if (pendingReadError) {toast('Saved action cannot be read. Check positions and restore browser storage before another deposit.'); return;} if (!pending || !['still-open','still-clone','still-basket','still-close','still-follow','still-unfollow','still-bot','still-park'].includes(pending.action) || !pending.body?.requestId) {toast('No valid saved paper action was found.'); return;}
  confirmAction(pending.action,pending.body,pending.description,'Check your saved action?',`${esc(pending.description)}<br><br>The same request ID will be reused. If it already completed, the saved receipt is returned without repeating it.`,'Check saved action',pending);
}
$('#confirm-submit').addEventListener('click',async()=>{
  if (submitting || !dialogAction) return;
  if (!dialogAction.pending && ['still-open','still-basket'].includes(dialogAction.action) && !preflightIsFresh(state.preflight)) {dialog.close();toast('This reading expired while you reviewed it. Refreshing the Pre-flight.');loadView(state.view);return;}
  submitting = true; $('#confirm-submit').disabled = true; $('#confirm-cancel').disabled = true; $('#confirm-error').hidden = true;
  let pending,postAttempted=false;
  try {
    // Direct wallet entry has not visited any paper route yet. Establish its cookie first.
    await ensureAccount();
    pending = dialogAction.pending || {action:dialogAction.action,body:{...dialogAction.body,requestId:crypto.randomUUID()},description:dialogAction.description};
    savePending(pending);
    postAttempted=true;
    const data = await api('/api/paper/'+pending.action,pending.body);
    if (!data?.paper || !data.account || !Array.isArray(data.account.positions) || !finite(data.account.balanceSol) || data.receipt?.requestId !== pending.body.requestId) throw new Error('The action result could not be verified. Check the saved request to recover its receipt.');
    if(pending.action==='still-open'&&$('#close-reminder')?.checked){const reminders=readSaved('still:reminders:v1',{});for(const id of data.receipt.positionIds||[])reminders[id]=Date.now()+(state.preflight?.options?.holdMinutes||240)*60000;saveLocal('still:reminders:v1',reminders);}
    clearPending(); state.account = data.account; dialog.close();
    recentPositions=new Set(data.receipt.positionIds||[]);for(const p of data.account.positions)if(recentPositions.has(p.id))expandedGroups.add(p.poolAddress);
    const followAction=['still-follow','still-unfollow','still-bot'].includes(pending.action);
    navigate(pending.action==='still-park'?'park':followAction?'follow':'positions'); toast(pending.action==='still-park'?'Example allocation saved. No earned profits or real funds were moved.':followAction?'Paper strategy updated. Your real funds have not moved.':pending.action==='still-close'?'Paper position closed.':'Paper position opened. Your real funds have not moved.');
  } catch(error) {
    // A receipt lookup cannot prove an interrupted copy never committed. Keep
    // its ID on every uncertain result; only a verified receipt clears it.
    const receiptOnly=pending?.action==='still-clone'&&!pending.body?.walletAddress;
    if (postAttempted && !receiptOnly && error.code!=='still_clone_pending' && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {try {clearPending();} catch {}}
    $('#confirm-error').textContent = error.message + (readPending() ? ' Use Check saved action to recover this same request.' : ' Keep reviewing to refresh the Pre-flight.'); $('#confirm-error').hidden = false;
    if (readPending()) {dialogAction.pending = readPending(); $('#confirm-submit').textContent = 'Check saved action';}
  } finally {submitting = false; $('#confirm-submit').disabled = false; $('#confirm-cancel').disabled = false;}
});
$('#confirm-cancel').addEventListener('click',()=>{if(!submitting)dialog.close();});
dialog.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});
for(const modal of [dialog,$('#range-dialog')])modal?.addEventListener('keydown',event=>{
 if(event.key!=='Tab')return;
 const controls=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
 const first=controls[0],last=controls[controls.length-1];if(!first){event.preventDefault();return;}
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
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
 return `<p class="result-line">${n<5?`Too early to judge. ${n} paper trades so far. Results show after 5 trades.`:`${n} paper trades · Wins ${closed.every(p=>finite(p.mark.netPnlSol))?closed.filter(p=>p.mark.netPnlSol>0).length:'Unavailable'} / losses ${closed.every(p=>finite(p.mark.netPnlSol))?closed.filter(p=>p.mark.netPnlSol<0).length:'Unavailable'} · Fees ${sol(sum('feesSol'))} · Costs ${sol(closed.every(p=>finite(p.entryCostsSol)&&finite(p.exitCostsSol))?closed.reduce((a,p)=>a+p.entryCostsSol+p.exitCostsSol,0):null)} · Net ${signed(sum('netPnlSol'))}`}</p><small class="source">Still paper journal · Started ${esc(date(run.startedAt))}<br>Last check ${esc(date(run.lastCheckAt))}</small><p class="note">${esc(run.note)}</p>${closed.length?`<details><summary>Trade reviews</summary>${closed.map(p=>`<p>${esc(p.name)} · ${esc(date(p.closedAt))}<br>${esc(p.review||'Closed manually on paper.')}<br>Inventory P&amp;L ${signed(p.mark.grossPnlSol)} · Net ${signed(p.mark.netPnlSol)}${source(p.mark)}</p>`).join('')}</details>`:''}`;
}
function renderFollow(){
 const runs=state.account.runs||[],suggested=preferences.preference==='calm'?'overnight':preferences.preference==='quick'?'narrow':'drip';
 show(heading('Follow','Follow a strategy','Paper versions of how some LPs say they trade. Follow one, or build your own.','<button class="secondary" data-go="follow">Refresh results</button>')+pendingBanner()+`<p class="note">Inspired by public posts. Not endorsed by, or affiliated with, anyone named. Rules are our paraphrase.</p>${!runs.some(r=>r.active)?`<still-empty kind="follow" animate><h3>Not following a strategy</h3><p>Pick one and practise it on paper first.</p><a href="#strategy-cards">See strategies</a></still-empty>`:''}<p class="note">Following permits future paper entries and planned closes from your ${sol(state.account.balanceSol)} practice balance. No real funds move. Checks normally run about once a minute; demand and missing data can delay them. Results begin when you confirm, with no backfilled trades.</p>${source({source:'Still paper ledger',asOf:state.account.updatedAt})}<div class="strategy-grid" id="strategy-cards">${state.strategies.map(s=>{const run=[...runs].reverse().find(r=>r.strategyId===s.id);return `<article class="panel strategy-card still-texture">${s.id===suggested?'<span class="tag">Suggested for your pace</span>':''}${creatorIdentity(s.handle)}<h3>${esc(s.name)}</h3><p>${esc(s.style)}</p><p class="attribution">${s.handle?`Inspired by public posts from @${esc(s.handle)}. Not endorsed or affiliated. Paper only.`:esc(s.attribution)}</p>${s.sourceUrl?`<a class="source-link" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source post ↗</a>`:''}${runResult(run)}<details><summary>See rules</summary><p>${esc(s.rules)}</p><p>${esc(s.behaviour)}</p><p class="note">Still's example run: ${esc(botSentence(s.bot))} ${s.mode==='steady'?'This house run closes only on an observed range exit.':s.mode==='narrow'?'Its range is 20–30% below price; the example hold is 30 minutes.':s.mode==='heart'?'Requires measured five-minute volume or a cumulative-volume increase observed within five minutes; longer windows are never extrapolated.':''}</p><p class="note">${esc(s.sourceNote||'The source explains the inspiration. Exact trigger thresholds, sizes and holds are Still example settings, not a claim about the creator’s current trades.')} Ranges use at most 69 bins and may be narrower than requested.</p><small class="source">Example paper rules · 11 October 2026</small></details><div class="actions">${run?.active?`<span class="tag">Following ✓</span><button class="text-button" data-unfollow="${esc(run.id)}">Unfollow</button>`:`<button class="primary" data-follow="${esc(s.id)}" data-ripple>Follow on paper</button>`}</div></article>`;}).join('')}</div>${runs.some(r=>!r.strategyId||!r.active)?`<section class="panel"><h3>Your paper runs</h3>${runs.filter(r=>!r.strategyId||!r.active).map(r=>`<article><h4>${esc(r.bot.name)}</h4><p>${esc(botSentence(r.bot))}</p>${runResult(r)}${r.active?`<button class="text-button" data-unfollow="${esc(r.id)}">Stop new entries</button>`:'<span class="tag">Stopped</span>'}</article>`).join('')}</section>`:''}${botForm()}`);
}
function readBotForm(form){const v=new FormData(form);return {name:String(v.get('name')||''),shape:String(v.get('shape')),width:Number(v.get('width')),holdMinutes:Number(v.get('holdMinutes')),trigger:String(v.get('trigger')),sizeSol:Number(v.get('sizeSol'))};}
function prepareFollow(id){const s=state.strategies.find(s=>s.id===id);if(!s)return;if(readPending()){resumePending();return;}confirmAction('still-follow',{strategyId:id,confirmed:true},`Follow ${s.name} on paper.`,'Follow this strategy on paper?',`${esc(s.name)}. ${esc(s.rules)}<br><br>Permit future paper entries from your practice balance, up to ${sol(s.bot.sizeSol)} per position, and closes under these rules. Existing trade history is not copied. You can stop new entries at any time.`,'Follow on paper');}

let parkData=null,parkExample=false;
const parkDefaults={split:[40,30,30],poolAddress:'',basketSlug:'',vaultId:''};
let parkPrefs=readSaved('still:park:v1',parkDefaults);
if(!parkPrefs||!Array.isArray(parkPrefs.split)||parkPrefs.split.length!==3||parkPrefs.split.some(n=>!Number.isInteger(n)||n<0||n>100||n%5)||parkPrefs.split.reduce((a,n)=>a+n,0)!==100)parkPrefs={...parkDefaults};
function parkRecord(record){
 const amounts=record.split.map(v=>record.amountLamports/1e9*v/100),b=record.basket,v=record.vault,a=record.vaultAccrual;
 const current=b&&record.basketMark&&Date.now()-Date.parse(record.basketMark.asOf)<300000?record.basketMark:null;
 return `<section class="panel parked-summary"><p class="eyebrow">Saved example · not earned profits</p><h3>Parked on paper</h3><div class="park-rings" aria-hidden="true">${record.split.map(n=>`<i style="width:${12+n/2}px;height:${12+n/2}px"></i>`).join('')}</div><p>Parked on paper: ${sol(amounts[0])} in pools, ${sol(amounts[1])} in baskets, ${sol(amounts[2])} in Backyard.</p>${source({source:'Confirmed example split',asOf:record.at})}${b?`<h4>${esc(b.name)}</h4><p>${b.legs.map(l=>`${tokenIcon(l.mint)} ${esc(l.symbol)} ${number(Number(l.unitsRaw)/10**l.decimals,6)} units`).join(' · ')}</p>${source({source:'Cesto allocation + verified Jupiter quotes',asOf:b.quoteAsOf})}<p>Paper value now ${sol(current?.valueSol)} · vs holding SOL ${signed(current?.pnlSol)}</p>${source({source:'Jupiter block-dated token marks',asOf:current?.asOf})}<p class="note">${esc(b.note)}</p>`:''}${v?`<h4>${tokenIcon(v.mint)} ${esc(v.name)}</h4><p>${number(a?.estimatedUnits,6)} ${esc(v.asset)} · estimate at quoted rate</p>${source({source:'Linear paper estimate at saved '+number(v.rate,2)+'% '+v.rateType,asOf:a?.asOf})}<p>Quoted rate ${number(v.rate,2)}% ${esc(v.rateType)}</p>${source({source:v.name+' rate read',asOf:v.rateAsOf||v.rateReadAt})}<p>Paper model value ${v.basis==='native-sol'?sol(a?.estimatedUnits):'Unavailable'} · vs holding SOL ${v.basis==='native-sol'&&finite(a?.estimatedUnits)?signed(a.estimatedUnits-v.costSol):'Unavailable'}</p>${source({source:'Linear model on original deposit asset; exit costs excluded',asOf:a?.asOf})}<p class="note">${esc(v.note)}</p>`:''}<p class="note">These are paper inventory values or estimates, before unmeasured exit costs and taxes. No earned profit has been credited to your practice balance.</p><button class="text-button" data-go="positions">See Positions</button><button class="text-button" data-action="refresh-park">Refresh basket marks</button></section>`;
}
function parkAmount(){return (state.account?.park?.exampleRemainingLamports??1e9)/1e9;}
function parkCanSubmit(){return parkExample&&parkAmount()>0&&(!parkPrefs.split[0]||parkData?.pools.some(p=>p.address===parkPrefs.poolAddress))&&(!parkPrefs.split[1]||parkData?.baskets.some(b=>b.slug===parkPrefs.basketSlug))&&(!parkPrefs.split[2]||parkData?.vaults.some(v=>v.id===parkPrefs.vaultId));}
function splitLabels(){return `Pools ${parkPrefs.split[0]}% · Baskets ${parkPrefs.split[1]}% · Backyard ${parkPrefs.split[2]}%`;}
function basketPreviews(data){const previews=data.basketPreviews||[];return `<div class="basket-previews">${previews.length?previews.map(b=>`<article class="basket-mini"><h4>${esc(b.name)}</h4><div class="basket-mini-tokens">${b.allocation?.complete?b.allocation.rows.map(row=>`<span>${tokenIcon(row.mint)}${esc(row.symbol)}<small>${number(row.weight,2)}%</small></span>`).join(''):'<p class="note">Token allocation unavailable</p>'}</div>${source({source:'Cesto public API',asOf:b.asOf})}<small class="source">Observed basket allocation, not a paper result.</small></article>`).join(''):'<p class="note">Basket preview unavailable. Refresh rates to try again.</p>'}</div>`;}
function renderPark(){
 const d=parkData||{pools:[],baskets:[],vaults:[],errors:['Rates unavailable.'],checkedAt:null};
 if(!d.baskets.some(b=>b.slug===parkPrefs.basketSlug))parkPrefs.basketSlug=d.baskets[0]?.slug||'';
 if(!d.vaults.some(v=>v.id===parkPrefs.vaultId))parkPrefs.vaultId=d.vaults.find(v=>v.kind==='staking')?.id||d.vaults[0]?.id||'';
 if(!d.pools.some(p=>p.address===parkPrefs.poolAddress))parkPrefs.poolAddress=d.pools[0]?.address||'';
 const v=d.vaults.find(v=>v.id===parkPrefs.vaultId),b=d.baskets.find(b=>b.slug===parkPrefs.basketSlug),closed=state.account.positions.filter(p=>p.status==='closed'&&!p.examplePark);
 const profits=closed.length&&closed.some(p=>!finite(p.mark.netPnlSol))?'Unavailable':'0 SOL';
 const options=(items,selected,key)=>items.length?items.map(i=>`<option value="${esc(i[key])}" ${i[key]===selected?'selected':''}>${esc(i.name)}</option>`).join(''):'<option value="">Unavailable</option>';
 show(heading('Grow','Park your profits','Decide where profits go before the next trade decides for you.','<button class="secondary" data-go="park">Refresh rates</button>')+pendingBanner()+`${profits==='0 SOL'?'<still-empty kind="grow" animate><h3>Nothing to grow at 0 SOL</h3><p>Park your profits here once a paper position pays out.</p></still-empty>':''}<p class="balance-line">Paper profits available: ${profits}</p>${source({source:'Closed paper positions · complete net costs required',asOf:state.account.updatedAt})}<p class="note">No paper profits to park yet. Net costs are not fully measured. <button class="text-button" data-go="positions">See Positions</button></p>${!parkExample&&parkAmount()>0?'<button class="primary" data-action="park-example">Try a 1 SOL example</button>':''}${parkExample&&parkAmount()>0?`<p class="example-banner">Example allocation: ${sol(parkAmount())}. This is a separate practice example, not money earned from your positions.</p>${source({source:'Still example allowance',asOf:state.account.createdAt})}`:''}${d.errors.length?`<p class="note" role="status">Rates unavailable. You can still choose a split. <button class="text-button" data-action="continue-park">Continue</button></p>`:''}<div class="park-destinations"><article class="panel partner-card">${partnerLogo("meteora")}<h3>Back into pools</h3><p>Re-deploy into a pool you've Pre-flighted.</p><label for="park-pool">Pool</label><select id="park-pool" ${!d.pools.length?'disabled':''}>${options(d.pools,parkPrefs.poolAddress,'address')}</select><p class="note">${esc(d.poolNote||'Only complete “Worth a look” Pre-flights qualify.')}</p>${source({source:'Still Pre-flight',asOf:d.checkedAt})}<button class="text-button" data-go="pools">Pick a pool</button></article><article class="panel partner-card">${partnerLogo("cesto")}<h3>Baskets</h3><p>A Cesto token basket. Several tokens instead of one.</p><label for="park-basket">Basket</label><select id="park-basket" ${!d.baskets.length?'disabled':''}>${options(d.baskets,parkPrefs.basketSlug,'slug')}</select>${source({source:'Cesto public catalogue',asOf:d.basketAsOf})}${basketPreviews(d)}<p class="note">Each token needs a verified mint and a current quote. Basket prices can fall together. No swap is sent.</p><div id="park-allocation"><button class="text-button" data-action="basket-allocation" ${!b?'disabled':''}>See allocation</button></div></article><article class="panel partner-card backyard-card">${partnerLogo("backyard")}<h3>Backyard</h3><p>Yield vaults and liquid staking from Kamino, Jupiter and Meteora. Slower, steadier.</p><label for="park-vault">Vault or staking</label><select id="park-vault" ${!d.vaults.length?'disabled':''}>${options(d.vaults.map(v=>({...v,name:v.name+(v.provider&&v.provider!==v.name?' · '+v.provider:'')})),parkPrefs.vaultId,'id')}</select><p>${v?`${number(v.rate,2)}% ${esc(v.rateType)}`:'Unavailable'}</p>${source({source:v?.provider||'Backyard / staking catalogue',asOf:v?.rateAsOf||v?.readAt})}<p class="note">${esc(v?.risk||'A current rate and deposit asset could not be verified.')}</p></article></div><section class="panel split-panel"><h3>Your split</h3><div class="split-track" style="--first:${parkPrefs.split[0]}%;--second:${parkPrefs.split[0]+parkPrefs.split[1]}%"><label class="sr-only" for="park-first">Pools allocation percentage</label><input id="park-first" type="range" min="0" max="100" step="5" value="${parkPrefs.split[0]}"><label class="sr-only" for="park-second">Pools and baskets combined percentage</label><input id="park-second" type="range" min="0" max="100" step="5" value="${parkPrefs.split[0]+parkPrefs.split[1]}"></div><p id="split-labels" aria-live="polite">${splitLabels()}</p><small class="source">Your example split · changes saved in this browser</small><p class="note">Drag to split. Nothing moves. This is paper.</p><div class="filter-chips"><button data-park-preset="all">All back in</button><button data-park-preset="half">Half and half</button><button data-park-preset="mostly">Mostly Backyard</button><button data-park-preset="backyard">Backyard only</button></div><p class="note">Set unavailable destinations to 0%. Nothing is saved unless every selected destination can be verified.</p></section><p class="note">When Still goes live, a flat fee of 0.3% (example rate, not live) is shown before you sign. It's the same wherever the money goes. Still Plus: planned.</p>${parkExample&&parkAmount()>0?`<button id="park-submit" class="primary" data-action="park-review" data-ripple ${!parkCanSubmit()?'disabled':''}>Park on paper</button>`:''}${(state.account.park?.records||[]).map(parkRecord).join('')}`);
}
function preparePark(){if(!parkCanSubmit())return;if(readPending()){resumePending();return;}const [p,b,v]=parkPrefs.split.map(n=>parkAmount()*n/100),basket=parkData.baskets.find(b=>b.slug===parkPrefs.basketSlug),vault=parkData.vaults.find(v=>v.id===parkPrefs.vaultId);confirmAction('still-park',{mode:'example',split:parkPrefs.split,poolAddress:p?parkPrefs.poolAddress:null,basketSlug:b?parkPrefs.basketSlug:null,vaultId:v?parkPrefs.vaultId:null,confirmed:true},`Park the separate ${sol(parkAmount())} example.` ,`Park ${sol(parkAmount())} on paper?`,`${sol(p)} to pools, ${sol(b)} to ${esc(basket?.name||'baskets')}, ${sol(v)} to ${esc(vault?.name||'Backyard')}.<br><br>Example only, not earned profits. Quotes and rates are checked again before the whole split is saved. No real funds move.`,'Park on paper');}

document.addEventListener('click',async event=>{
  const lessonLink=event.target.closest('[data-lesson]');if(lessonLink){event.preventDefault();openLesson(lessonLink.dataset.lesson);return;}
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if(button.dataset.action==='lesson-list'){selectedLesson=0;renderLearn();screen.querySelector('h2')?.focus();return;}
  if(button.dataset.action==='park-example'){parkExample=true;renderPark();return;}
  if(button.dataset.action==='continue-park'){parkExample=true;renderPark();$('#park-first')?.focus();return;}
  if(button.dataset.action==='park-review'){preparePark();return;}
  if(button.dataset.action==='wallet-connect'){
   if(state.view!=='wallet'||walletBusy)return;
   const generation=++walletGeneration;walletError='';walletBusy=true;renderWallet();
   try{const address=await connectPhantomAddress(window.phantom?.solana);if(generation!==walletGeneration||state.view!=='wallet')return;walletBusy=false;await loadWallet(address);}
   catch(error){if(generation===walletGeneration&&state.view==='wallet'){walletBusy=false;walletError=error.message;renderWallet();$('#wallet-address')?.focus();}}return;
  }
  if(button.dataset.action==='wallet-retry'){if(walletAddress)loadWallet(walletAddress);return;}
  if(button.dataset.action==='wallet-forget'){walletGeneration++;walletAddress='';walletData=null;walletDetails.clear();walletReading.clear();walletError='';walletBusy=false;forgetCloneSources();try{localStorage.removeItem('still:wallet-address:v1');}catch{}renderWallet();return;}
  if(button.dataset.walletCheck){checkWalletPosition(button.dataset.walletCheck);return;}
  if(button.dataset.walletPractise){practiseWallet(button.dataset.walletPractise);return;}
  if(button.dataset.parkPreset){parkPrefs.split=({all:[100,0,0],half:[50,50,0],mostly:[20,20,60],backyard:[0,0,100]})[button.dataset.parkPreset];saveLocal('still:park:v1',parkPrefs);renderPark();return;}
  if(button.dataset.action==='basket-allocation'){button.disabled=true;try{const d=await api('/api/cesto?slug='+encodeURIComponent(parkPrefs.basketSlug));$('#park-allocation').innerHTML=d.allocation?.complete?`<p>${d.allocation.rows.map(r=>tokenIcon(r.mint)+esc(r.symbol)+': '+number(r.weight,2)+'%').join(' · ')}</p>${source({source:'Cesto allocation',asOf:new Date(d.readAt).toISOString()})}`:'<p>Allocation unavailable. This basket cannot be parked without complete quotes.</p>';}catch{$('#park-allocation').innerHTML='<p>Allocation unavailable. Try another basket or refresh rates.</p>';}return;}
  if(button.dataset.action==='refresh-park'){button.disabled=true;try{const data=await api('/api/paper/still-park-refresh',{requestId:crypto.randomUUID()});state.account=data.account;if(state.view==='park')renderPark();else renderPositions();}catch(error){toast(error.message);button.disabled=false;}return;}
  if(button.dataset.follow){prepareFollow(button.dataset.follow);return;}
  if(button.dataset.unfollow){if(readPending()){resumePending();return;}confirmAction('still-unfollow',{runId:button.dataset.unfollow,confirmed:true},'Stop new entries for this paper run.','Stop following?', 'No new positions will open. Existing paper positions keep their planned close; you can also close them in Positions.','Unfollow');return;}
  if(button.dataset.action==='start'){onboardingStep=0;navigate(preferences.complete?'pools':'onboarding');return;}
  if(button.dataset.action==='preferences'){onboardingStep=2;navigate('onboarding');return;}
  if(button.dataset.pace){preferences.preference=button.dataset.pace;renderOnboarding();return;}
  if(button.dataset.onboard){if(['skip','finish'].includes(button.dataset.onboard))finishOnboarding();else{onboardingStep+=button.dataset.onboard==='back'?-1:1;renderOnboarding();}return;}
  if(button.dataset.action==='change-range'){changeRange();return;}
  if(button.dataset.action==='cancel-range'){$('#range-dialog').close();return;}
  if(button.dataset.filter){poolPrefs.filter=button.dataset.filter;saveLocal('still:pools:v2',poolPrefs);renderPools(state.poolData);return;}
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
screen.addEventListener('input',event=>{if(['park-first','park-second'].includes(event.target.id)){const a=Number($('#park-first').value),b=Number($('#park-second').value),first=event.target.id==='park-first'?Math.min(a,b):a,second=event.target.id==='park-second'?Math.max(a,b):b;parkPrefs.split=[first,second-first,100-second];$('#park-first').value=first;$('#park-second').value=second;$('#split-labels').textContent=splitLabels();const track=screen.querySelector('.split-track');track.style.setProperty('--first',first+'%');track.style.setProperty('--second',second+'%');saveLocal('still:park:v1',parkPrefs);if($('#park-submit'))$('#park-submit').disabled=!parkCanSubmit();}if(event.target.id==='paper-amount'){const button=screen.querySelector('[data-action="deposit"]');if(button)button.disabled=event.target.value!==state.amount || !state.preflight?.canOpen;}});
screen.addEventListener('input',event=>{if(event.target.closest?.('#bot-form')){const b=readBotForm(event.target.closest('#bot-form'));saveLocal('still:bot:v1',b);$('#bot-sentence').textContent=botSentence(b);$('#bot-width').textContent=b.width+'%';$('#bot-hold').textContent=holdLabel(b.holdMinutes);$('#bot-size').textContent=sol(b.sizeSol);}});
screen.addEventListener('submit',event=>{
  if(event.target.id==='wallet-form'){event.preventDefault();loadWallet($('#wallet-address').value);return;}
  if(event.target.id==='bot-form'){event.preventDefault();const b=readBotForm(event.target);if(!b.name.trim()||!finite(b.width)||!finite(b.sizeSol)||b.sizeSol<=0){$('#bot-error').hidden=false;return;}if(readPending()){resumePending();return;}saveLocal('still:bot:v1',b);confirmAction('still-bot',{bot:b,confirmed:true},'Start '+b.name+' on paper.','Start this paper bot?',esc(botSentence(b))+'<br><br>Permit future paper entries and closes from your practice balance. No real funds move.','Start paper bot');return;}
  if (event.target.id!=='amount-form')return;event.preventDefault();
  const value=$('#paper-amount').value.trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)||Number(value)<.001||Number(value)>10){toast('Enter between 0.001 and 10 SOL, with at most 9 decimal places.');$('#paper-amount').focus();return;}
  state.amount=value;loadView(state.view);
});
document.addEventListener('change',event=>{if(['park-pool','park-basket','park-vault'].includes(event.target.id)){parkPrefs[{'park-pool':'poolAddress','park-basket':'basketSlug','park-vault':'vaultId'}[event.target.id]]=event.target.value;saveLocal('still:park:v1',parkPrefs);renderPark();}if(event.target.id==='pool-sort'){poolPrefs.sort=event.target.value;saveLocal('still:pools:v2',poolPrefs);renderPools(state.poolData);}});
document.addEventListener('toggle',event=>{const group=event.target.dataset?.group;if(group){if(event.target.open)expandedGroups.add(group);else expandedGroups.delete(group);}},true);
document.addEventListener('submit',event=>{if(event.target.id!=='range-form')return;event.preventDefault();const form=new FormData(event.target),amount=String(form.get('amountSol')||'').trim(),range={shape:form.get('shape'),floorPct:Number(form.get('floorPct')),ceilingPct:Number(form.get('ceilingPct')),holdMinutes:Number(form.get('holdMinutes'))};if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(amount)||Number(amount)<.001||Number(amount)>10){toast('Enter between 0.001 and 10 SOL, with at most 9 decimal places.');return;}if(range.ceilingPct<=-range.floorPct){toast('The ceiling must be above the floor.');return;}state.amount=amount;state.range=range;$('#range-dialog').close();loadView(state.view);});
window.addEventListener('popstate' ,()=>navigate(location.hash.slice(1)||'home',true));
window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;if(location.hash.slice(1)!==state.view)navigate(location.hash.slice(1)||'home',true);});
api('/api/version').then(version=>{const hash=version.git?.short || version.git?.sha || version.gitSha || version.sha || version.commit; if(typeof hash==='string')$('#build-version').textContent='· '+hash.slice(0,8);}).catch(()=>{});
navigate(location.hash.slice(1)||'home',true);
// Supplied motion components own the intro, loading and navigation transitions.
// The bundled shell owns the sole cursor overlay; no legacy initializer runs.
}
