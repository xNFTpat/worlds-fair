(() => {
  const poolKey = p => `${p.chain}:${p.poolAddress}`;
  function ruleFor(p, preferences = {}) {
    const rule = preferences[poolKey(p)] || {};
    return { graceMinutes: Number.isInteger(rule.graceMinutes) && rule.graceMinutes >= 0 && rule.graceMinutes <= 10080 ? rule.graceMinutes : 60, enabled: rule.enabled !== false };
  }
  // Derive personal review reminders only from saved, fresh out-of-range observations.
  // Episodes survive closure and recovery so a reminder can still be found on returning.
  function inboxEvents(data, preferences = {}) {
    const events = (data?.events || []).filter(e => e.kind !== 'grace-expired' && (!e.positionId || ruleFor(e, preferences).enabled));
    for (const episode of Object.values(data?.state?.episodes || {})) {
      const rule = ruleFor(episode, preferences);
      const due = Date.parse(episode.firstObservedOutAt) + rule.graceMinutes * 60000;
      if (!rule.enabled || !Number.isFinite(due) || Date.parse(episode.lastObservedOutAt) < due) continue;
      events.push({ ...episode, id: `${episode.id}:review:${rule.graceMinutes}`, kind: 'review-due', at: new Date(due).toISOString(), graceMinutes: rule.graceMinutes,
        message: `Your ${rule.graceMinutes}-minute review point was reached. This pool was still observed out of range at the confirmation below. Review its current state before deciding what to do.` });
    }
    return events.sort((a,b) => Date.parse(b.at)-Date.parse(a.at) || String(a.id).localeCompare(String(b.id)));
  }
  function latestEvents(events) {
    const latest=new Map();
    for(const e of events){const key=e.positionId||'wallet:'+e.wallet;if(!latest.has(key)||Date.parse(e.at)>Date.parse(latest.get(key).at))latest.set(key,e);}
    return [...latest.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  }
  function actionablePositions(data, preferences = {}, now = Date.now()) {
    if (!Number.isFinite(Date.parse(data?.state?.lastCheckedAt)) || now-Date.parse(data.state.lastCheckedAt)>600000) return [];
    return Object.values(data?.state?.positions || {}).filter(p => ruleFor(p,preferences).enabled && p.inRange===false && !p.interrupted && !p.rangeUnknown && Number.isFinite(Date.parse(p.lastSampleAt)) && now-Date.parse(p.lastSampleAt)<=600000);
  }
  const episodeKey = p => `episode:${p.id}:${p.outSince || p.firstObservedOutAt || ''}`;
  function rangeView(position, data, now=Date.now()) {
    const p=Object.values(data?.state?.positions||{}).find(p=>typeof position.id==='string' && p.id===position.id);
    const stamp=Date.parse(p?.lastSampleAt), out=Date.parse(p?.outSince);
    const newerPosition=Number.isFinite(Date.parse(position.fetchedAt))&&Date.parse(position.fetchedAt)>stamp&&position.inRange!==p?.inRange;
    if(newerPosition)return {state:position.inRange===false?'out':position.inRange===true?'in':'unknown',label:position.inRange==null?'Range unavailable':position.inRange?'In range':'Out of range',detail:'New position reading · timer awaiting confirmation'};
    const fresh=!!p && !p.interrupted && !p.rangeUnknown && Number.isFinite(stamp) && stamp<=now+60000 && now-stamp<=600000;
    if(!fresh) return {state:position.inRange===false?'out':position.inRange===true?'in':'unknown',label:position.inRange==null?'Range unavailable':position.inRange?'In range':'Out of range',detail:'Saved reading · duration unconfirmed'};
    if(p.inRange!==false)return {state:'in',label:'In range',detail:'Confirmed at '+new Date(stamp).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
    const mins=Math.max(0,Math.floor((stamp-out)/60000));
    const duration=mins<1?'under a minute':mins<60?mins+' min':Math.floor(mins/60)+'h '+mins%60+'m';
    return {state:'out',label:p.rangeStatus?.total>1?`${p.rangeStatus.out} of ${p.rangeStatus.total} out of range`:'Out of range',detail:Number.isFinite(out)&&out<=stamp?'Observed out for '+duration:'Out time unavailable'};
  }
  function visibleAlerts(data, preferences={}, cleared={}, now=Date.now()) {
    return actionablePositions(data,preferences,now).filter(p=>!cleared[episodeKey(p)]);
  }
  globalThis.LPRangeAlerts = { ruleFor, inboxEvents, latestEvents, actionablePositions, episodeKey, rangeView, visibleAlerts };
  if (typeof document === 'undefined') return;
  const $ = s => document.querySelector(s);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = t => Number.isFinite(Date.parse(t)) ? new Date(t).toLocaleString(undefined, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Unavailable';
  const readSaved = key => { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const prefKey = 'lp-range-preferences-v1', readKey = 'lp-range-read-v1';
  let preferences = readSaved(prefKey), read = readSaved(readKey), data = null, pending = null, failure = '', storageFailure = false, historyLimit = 20, undoRead = null;
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { storageFailure = true; } };
  const titles = { 'range-exit':'Out of range', 'range-return':'Back in range', 'range-unknown':'Range unavailable', 'range-confirmed':'Range confirmed', 'data-unavailable':'Data unavailable', 'data-restored':'Data restored', 'grace-restarted':'Review timer restarted', 'range-count-changed':'Range update', 'review-due':'Time to review' };
  const isPaused = p => p.interrupted || p.rangeUnknown || !Number.isFinite(Date.parse(p.lastSampleAt)) || Date.now()-Date.parse(p.lastSampleAt)>10*60000;
  function render(forceWatches = false) {
    const events = inboxEvents(data, preferences).filter(e=>!read[e.id]), active = failure ? [] : visibleAlerts(data,preferences,read), unread = active.length;
    window.setAlertCount('range',unread);
    const last = data?.state?.lastCheckedAt;
    const monitorOld = !Number.isFinite(Date.parse(last)) || Date.now()-Date.parse(last)>10*60000;
    const badWallets = Object.entries(data?.state?.wallets || {}).filter(([,w])=>w.unavailableSince).map(([name])=>name);
    $('#alertMonitorStatus').textContent = failure || (!last ? 'Waiting for the first position check. Use Check now to start.' : monitorOld ? `Monitoring delayed · last check ${stamp(last)}. Current range status cannot be confirmed.` : `Last check ${stamp(last)}${badWallets.length ? ' · Data unavailable for '+badWallets.join(', ') : ' · Monitor running'}.`);
    if (storageFailure) $('#alertMonitorStatus').textContent += ' This browser could not save your preferences; they will reset when the page closes.';
    const positions = active;
    // Leave a focused control intact during a background read.
    const openSettings=new Set([...$('#alertSettings').querySelectorAll('details[open]')].map(d=>d.dataset.settingsPool));
    if (forceWatches || !$('#alertWatches').contains(document.activeElement)) $('#alertWatches').innerHTML = positions.map(p => {
      const rule = ruleFor(p, preferences), paused = !!failure || monitorOld || isPaused(p);
      const status = paused ? 'Range unconfirmed' : p.inRange ? 'In range' : p.rangeStatus?.total>1 ? `${p.rangeStatus.out} of ${p.rangeStatus.total} out of range` : 'Out of range';
      const due = Date.parse(p.outSince)+rule.graceMinutes*60000;
      let timer = 'Within your range at the last check.';
      if (!rule.enabled) timer = 'Alerts muted on this device.';
      else if (paused) timer = 'Waiting for a fresh range reading.';
      else if (!p.inRange) timer = Date.parse(p.lastSampleAt)>=due ? 'Review due · still out of range.' : `Review at ${stamp(new Date(due).toISOString())} if still out of range.`;
      return `<article class="alert-watch"><div class="alert-card-top"><div><span class="eyebrow">${esc(p.wallet)}</span><h3>${esc(p.pair)}</h3></div><span class="alert-state ${paused?'':p.inRange?'range-ok':'range-out'}">${esc(status)}</span></div><p><b>${esc(rangeView(p,data).detail)}</b></p><p>${esc(timer)}</p><div class="watch-bottom"><button class="text-button" data-alert-position="${esc(p.id)}">Review position ↗</button><button class="text-button" data-alert-dismiss="${esc(episodeKey(p))}">Clear reminder</button></div></article>`;
    }).join('') || '<p class="empty-card calm-card">'+(failure||monitorOld||badWallets.length?'Waiting for fresh readings. No new range conclusions until monitoring recovers.':'All clear. Range status remains visible on your portfolio.')+'</p>';
    if (!$('#alertSettings').contains(document.activeElement)) $('#alertSettings').innerHTML = Object.values(data?.state?.positions || {}).map(p => {
      const rule=ruleFor(p,preferences);
      return `<details data-settings-pool="${esc(poolKey(p))}" ${openSettings.has(poolKey(p))?'open':''}><summary>${esc(p.wallet)} · ${esc(p.pair)} · ${rule.enabled?rule.graceMinutes+' min':'Muted'}</summary><form class="alert-controls" data-alert-rule="${esc(poolKey(p))}"><label>Review after <input name="grace" required type="number" min="0" max="10080" step="1" value="${rule.graceMinutes}" aria-label="Grace minutes for ${esc(p.pair)}"> minutes</label><label><input name="enabled" type="checkbox" ${rule.enabled?'checked':''}> Alerts on</label><button type="submit">Save</button></form></details>`;
    }).join('') || '<p class="note">Settings appear when positions have been read.</p>';
    $('#positionActivityCount').textContent=`· ${events.length} saved`;
    $('#morePositionActivity').hidden=events.length<=historyLimit;
    $('#alertInbox').innerHTML = events.slice(0,historyLimit).map(e => `<article class="range-event is-read"><div class="alert-card-top"><div><span class="eyebrow">${esc(e.wallet)}${e.pair?' · '+esc(e.pair):''}</span><h3>${esc(titles[e.kind]||'Range update')}</h3></div><time datetime="${esc(e.at)}">${stamp(e.at)}</time></div><p>${esc(e.message)}</p>${e.kind==='review-due'?`<p class="note">Latest out-of-range confirmation for this episode: ${stamp(e.lastObservedOutAt)}.</p>`:''}<div class="actions">${e.positionId?`<button class="text-button" data-alert-position="${esc(e.positionId)}">Review position ↗</button>`:''}</div></article>`).join('') || '<p class="empty-card">All quiet. Range changes and review reminders will be saved here.</p>';
    $('#readAllAlerts').disabled = !events.length && !active.length;
    $('#undoAlerts').hidden = !undoRead;
  }
  async function getJSON(url) {
    const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(90000)});
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Range monitor is unavailable.');
    return result;
  }
  window.loadRangeAlerts = async (fresh = false) => {
    if (pending) return pending;
    $('#refreshAlerts').disabled = true;
    pending = (async () => {
      try {
        if (fresh) { $('#alertMonitorStatus').textContent='Checking wallets and ranges…'; await getJSON('/api/positions?refresh=1'); document.dispatchEvent(new Event('lp:positions-refreshed')); }
        const next = await getJSON('/api/range-alerts');
        if (!Array.isArray(next.events)) throw Error('Range monitor returned an incomplete response.');
        data = next; failure = ''; document.dispatchEvent(new Event('lp:ranges-updated'));
      } catch(e) { failure = `Couldn’t check the monitor. ${e.message} Any saved alerts remain below.`; }
      finally { pending = null; $('#refreshAlerts').disabled = false; render(); }
    })();
    return pending;
  };
  $('#morePositionActivity').onclick=()=>{historyLimit+=20;render();};
  $('#refreshAlerts').onclick = () => window.loadRangeAlerts(true);
  function commitClear(next){undoRead={...read};read=next;save(readKey,read);render();document.dispatchEvent(new Event('lp:ranges-updated'));}
  $('#readAllAlerts').onclick = () => { const next={...read};for(const e of inboxEvents(data,preferences))next[e.id]=true;for(const p of actionablePositions(data,preferences))next[episodeKey(p)]=true;commitClear(next); };
  $('#undoAlerts').onclick=()=>{if(!undoRead)return;read=undoRead;undoRead=null;save(readKey,read);render();document.dispatchEvent(new Event('lp:ranges-updated'));};
  window.rangeBadge=p=>{const v=rangeView({...p,poolAddress:p.poolAddress||p.pool?.address||p.poolAddress},data);return `<span class="range-chip range-${v.state}">${esc(v.label)}</span><small class="range-duration">${esc(v.detail)}</small>`;};
  window.isRangeAcknowledged=p=>{const monitor=Object.values(data?.state?.positions||{}).find(r=>r.id===p.id);return monitor&&read[episodeKey(monitor)];};
  $('#view-alerts').addEventListener('click', e => {
    const dismissed=e.target.closest('[data-alert-dismiss]');if(dismissed)commitClear({...read,[dismissed.dataset.alertDismiss]:true});
    const marked = e.target.closest('[data-alert-read]'), position = e.target.closest('[data-alert-position]');
    if (marked) { read[marked.dataset.alertRead]=true; save(readKey,read); render(); }
    if (position) document.dispatchEvent(new CustomEvent('lp:review-alert',{detail:position.dataset.alertPosition}));
  });
  $('#alertSettings').addEventListener('submit', e => {
    e.preventDefault();
    const form=e.target, input=form.elements.grace, pool=form.dataset.alertRule;
    if (!pool || !input.checkValidity() || input.value==='') { input.reportValidity(); return; }
    preferences[pool] = {graceMinutes:Number(input.value), enabled:form.elements.enabled.checked};
    save(prefKey,preferences); render(true);
  });
  window.addEventListener('storage',e=>{if([prefKey,readKey].includes(e.key)){preferences=readSaved(prefKey);read=readSaved(readKey);render();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.loadRangeAlerts();});
  setInterval(()=>{if(!document.hidden)window.loadRangeAlerts();else render();},60000);
  window.loadRangeAlerts();
})();
