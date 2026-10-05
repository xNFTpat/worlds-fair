(()=>{
  const $=s=>document.querySelector(s),esc=s=>String(typeof s==='number'&&!Number.isFinite(s)?'Unavailable':s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sol=n=>Number.isFinite(n)?n.toFixed(4)+' SOL':'—',signed=n=>Number.isFinite(n)?(n>0?'+':'')+sol(n):'—',tone=n=>!Number.isFinite(n)||n===0?'':n>0?'pos':'neg';
  const when=t=>t?new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Awaiting first scan';
  const stale=t=>!t||!Number.isFinite(Date.parse(t))||Date.now()-Date.parse(t)>600000;
  let selected='active',current,loading=false,controlling=false,archive=[],cursor=null,archiveStarted=false;
  try{localStorage.removeItem('txKey');sessionStorage.removeItem('txKey');}catch{}
 const unlock=()=>{window.LPOwnerAccess?.open?.();const message='Unlock controls, then choose the paper control again.';$('#labControlStatus').textContent=message;return message;};
  const profileIds={scalp:'scalp-v4',hold:'hold-v4',pullback:'pullback-v4'};
  const armName=id=>current?.arms.find(a=>a.id===id)?.name||id;
  const duration=h=>!Number.isFinite(h)?'Unavailable':h<1?Math.round(h*60)+' min':h+' hours';
  const pct=n=>Number.isFinite(n)&&Number.isFinite(n*100)?Math.round(n*100)+'%':'Unavailable';
  const cash=n=>Number.isFinite(n)?'$'+n.toLocaleString():'Unavailable';
  function styleCopy(a){
    const r=a.policy||current.rules;
    if(['launch-scalp','scalp-v4'].includes(a.id))return 'Bid-Ask · 8–25% below entry · up to 45 min';
    if(a.id==='launch-bidask')return 'Bid-Ask · 8–80% below entry · up to 4 hours';
    if(['longer-spot','hold-v4'].includes(a.id))return 'Spot · down 25% · up to 48 hours';
    if(a.id==='pullback-v4')return 'Bid-Ask · 8–50% below entry · up to 8 hours';
    return (a.shape==='BidAsk'?'Bid-Ask':'Spot')+' · down '+pct(a.down)+' · up to '+duration(r.maxHoldHours);
  }
  function position(p){
    const unavailable=p.issue||stale(p.mark.at),net=unavailable?null:p.pnlSol;
    const state=p.issue?(/small-share|counters reset/.test(p.issue)?'Model cannot score this':'Waiting for a quote'):stale(p.mark.at)?'Saved read':p.mark.inRange?'In range':p.mark.waiting?'Waiting for a pullback':'Below bid range';
    return `<div class="lab-position"><b>${esc(p.pool.pair)}</b><span class="bot-state ${unavailable?'bot-warning':''}">${state}</span><p>Net P&L <strong class="${tone(net)}">${signed(net)}</strong></p><dl class="bot-breakdown"><div><dt>Principal mark</dt><dd>${sol(p.mark.principalSol)}</dd></div><div><dt>Fees before exit</dt><dd>${sol(p.mark.feesSol)}</dd></div><div><dt>Exit estimate</dt><dd>${unavailable?'—':sol(p.mark.liquidationSol)}</dd></div><div><dt>Withdrawal tax estimate</dt><dd>${sol(p.mark.withdrawTaxSol)}</dd></div></dl>${Number.isFinite(p.bidStartSol)&&Number.isFinite(p.bidEndSol)?'<p class="note">Bids '+p.bidEndSol.toPrecision(4)+' – '+p.bidStartSol.toPrecision(4)+' SOL / token · fixed at entry</p>':''}<p class="note">${esc([p.pendingExit,p.issue].filter(Boolean).join(' · ')||(unavailable?'Amounts above are from the saved read.':'Net P&L includes estimated fees and exit costs.'))}</p><small>Opened ${esc(when(p.openedAt))} · marked ${esc(when(p.mark.at))}</small></div>`;
  }
  function render(s,readError=false){
    current=s;
    const state={running:'Running',paused:'Entries paused',stopping:'Closing paper positions',stopped:'Stopped'}[s.runState]||s.runState;
    $('#labStatus').textContent=(readError?'Refresh failed · saved results':stale(s.lastScanAt)?(s.lastScanAt?'Scan overdue · saved results':'Waiting for the first scheduled scan'):state)+' · '+when(s.lastScanAt)+' · checks every 5 minutes';
    const liveArms=s.arms.filter(a=>a.active&&a.mode==='independent-samples'),livePositions=s.positions.filter(p=>liveArms.some(a=>a.id===p.arm));
    const entriesToday=liveArms.reduce((n,a)=>n+a.entriesToday,0);
    $('#homeLab').innerHTML=`<div><span class="eyebrow">PAPER EXPERIMENTS</span><p><strong>${livePositions.length} open</strong> · ${entriesToday} trials today</p><small>Launch scalp · longer hold · pullback bids</small></div><button class="text-button" data-open-lab>Compare styles ↗</button>`;
    $('#labStatus').textContent+=' · '+entriesToday+' new samples today';
    const rangesOpen=$('#labRangeComparisons')?.open;
    const card=a=>{
      const r=a.policy||s.rules,held=s.positions.filter(p=>p.arm===a.id),sample=a.mode==='independent-samples',net=sample?a.realizedPnlSol:Number.isFinite(a.equitySol)?a.equitySol-s.rules.seedSol:null;
      const unknown=a.unscorableCount||0,finished=a.closedCount+unknown;
      const problem=held.find(p=>p.issue),reason=problem?(/small-share|counters reset/.test(problem.issue)?'Model failure being recorded':'Waiting for fresh accounting'):held.length>=r.maxOpen?'Watching '+held.length+' open positions':a.entryReason||'Scanning for the next setup';
      return `<article class="bot-position lab-arm"><h3>${esc(a.name)}</h3><p class="lab-style-copy">${esc(styleCopy(a))}</p><p class="note">${sample?'Independent 0.2 SOL trials · not a compounded wallet':'Archived paper wallet · existing exits still monitored'}</p><div class="lab-metrics"><span><b class="${tone(net)}">${signed(net)}</b>${sample?'Closed, scored P&L':'Net wallet P&L'}</span><span><b>${held.length} / ${r.maxOpen}</b>Open</span><span><b>${a.closedCount}</b>Scored closes</span><span><b>${unknown}</b>Unscorable</span></div>${sample?`<p class="note">${finished?Math.round(a.closedCount/finished*100)+'% of ended trials scored':'No ended trials yet'}. Unscorable outcomes have unavailable P&L; scored results alone cannot establish profitability.</p>`:''}<p class="lab-status-note">${esc(reason)} · ${a.entriesToday} / ${s.rules.maxDailyEntries} entries today</p>${held.length?held.map(position).join(''):'<p class="bot-empty">'+(a.active?'Waiting for a qualifying pool and usable bin / exit checks.':'Earlier results are retained in history.')+'</p>'}</article>`;
    };
    const active=liveArms.find(a=>a.id===profileIds[selected]);
    $('#labArms').innerHTML=(active?'<div class="lab-arms">'+card(active)+'</div>':'<p class="note">New profiles will appear after the next scheduled scan.</p>')+'<details id="labRangeComparisons" class="alert-fold" '+(rangesOpen?'open':'')+'><summary>Earlier experiments · preserved results</summary><p class="note">Original balances stay separate. A failed model is unavailable, never a synthetic refund.</p><div class="lab-arms">'+s.arms.filter(a=>a.mode!=='independent-samples').map(card).join('')+'</div></details>';
    $('#labChecks').innerHTML='<h3>Shortlist</h3>'+(s.candidates.filter(c=>(c.arms||[]).includes(profileIds[selected])).map(c=>`<p class="note"><b>${esc(c.pair)}</b> · ${esc((c.arms||[]).map(armName).join(' / '))} · ${c.streak} / ${c.confirmations||s.rules.confirmations} checks · ${cash(c.fees1h)} reported pool fees (up to 1h)<br>${esc(c.reason)}</p>`).join('')||'<p class="note">No eligible pools in the latest scan.</p>')+'<h3>Latest filter counts</h3>'+Object.entries(s.skips).filter(([reason])=>reason.startsWith(liveArms.find(a=>a.id===profileIds[selected])?.group+' · ')).map(([reason,count])=>`<p class="note">${count} · ${esc(reason)}</p>`).join('')+'<h3>Recent decisions</h3>'+(s.events.filter(e=>!e.arm||e.arm===profileIds[selected]).map(e=>`<div class="bot-decision"><small>${esc(when(e.at))}${e.arm?' · '+esc(armName(e.arm)):''}</small><p>${e.pair?'<b>'+esc(e.pair)+'</b> · ':''}${esc(e.message)}</p></div>`).join('')||'<p class="note">Decisions appear when a scan completes.</p>');
    const trades=[...new Map([...s.closed,...archive].map(t=>[t.id,t])).values()].filter(t=>selected==='active'||t.arm===profileIds[selected]||!profileIds[selected]).sort((a,b)=>b.closedAt.localeCompare(a.closedAt));
    $('#labTrades').innerHTML='<p class="note">Compare the same pool and cohort across strategies. Missing arms were skipped; unmatched trades are not a fair head-to-head comparison.</p>'+(trades.map(t=>`<div class="bot-decision"><b>${esc(t.pair)}</b> · ${esc(armName(t.arm))} · <span class="${tone(t.pnlSol)}">${signed(t.pnlSol)}</span><p>${esc(t.reason)} · ${esc(when(t.closedAt))}</p><small>Estimated fees ${sol(t.feesSol)} · cohort ${esc(t.cohort)}</small></div>`).join('')||'<p class="note">No closed lab trades yet.</p>');
    $('#labTrades').innerHTML+='<h3>Unscorable outcomes</h3>'+((s.unscorable||[]).filter(t=>t.arm===profileIds[selected]).map(t=>`<div class="bot-decision"><b>${esc(t.pair)}</b> · P&L unavailable<p>${esc(t.reason)}</p><small>${esc(when(t.endedAt))} · excluded from scored P&L, included in failure count</small></div>`).join('')||'<p class="note">None recorded for this style.</p>');
    $('#labTrades').innerHTML+='<details class="alert-fold"><summary>All earlier wallet trades</summary>'+([...new Map([...s.closed,...archive].map(t=>[t.id,t])).values()].filter(t=>!String(t.arm).endsWith('-v4')).sort((a,b)=>b.closedAt.localeCompare(a.closedAt)).map(t=>`<div class="bot-decision"><b>${esc(t.pair)}</b> · ${esc(armName(t.arm))} · ${signed(t.pnlSol)}<p>${esc(t.reason)}</p><small>${esc(when(t.closedAt))}</small></div>`).join('')||'<p class="note">No earlier closes loaded.</p>')+'</details>';
    $('#labMoreTrades').hidden=archiveStarted?!cursor:s.arms.reduce((n,a)=>n+a.closedCount,0)<=s.closed.length;
    $('#labRules').innerHTML=`<p class="note"><b>${esc(s.rules.version)}</b> · Three independent 0.2 SOL sample series. Closed P&L is a sum of scored samples, not a wallet balance. Failed accounting is reported separately; no cash is recycled or fabricated. Earlier wallet experiments remain archived.</p>`+liveArms.map(a=>{
      const r=a.policy;return `<p class="note"><b>${esc(a.name)}</b> · ${esc(styleCopy(a))}. Pool age ${r.minAgeHours<1?Math.round(r.minAgeHours*60)+' min':r.minAgeHours+'h'}–${r.maxAgeHours}h, liquidity ${cash(r.minTvl)}, pool fees ${cash(r.minFees1h)} / up to 1h and volume ${cash(r.minVolume30m)} / up to 30m. ${r.confirmations} checks. Exit at ${pct(-r.stopLoss)} loss, ${pct(r.takeProfit)} gain or ${duration(r.maxHoldHours)}${r.maxWaitMinutes?'; unfilled bids expire after '+r.maxWaitMinutes+' min':''}.</p>`;
    }).join('')+`<p class="note">One new pool cohort every five minutes, shared across eligible styles. Maximum two open samples per style and 24 entries per style per UTC day. The least-sampled available style gets first look; its pools rank by reported hourly fees. More volume does not prove future demand.</p><p class="note">SOL-paired DLMM only. Supported Token-2022 transfer fees are included. Samples use real bin reserves and fee counters, a 1% slippage quote and 0.0001 SOL network allowance on each side of the trade. Empty bins, more than ${s.rules.maxBins} bins or a deposit over 1% of a bin are skipped. Actual rent, MEV, failed transactions, holder airdrops and market impact are not fully simulated.</p><p class="note">Repeated structural model failures after an exit deadline end as unscorable after three failed checks over at least ten minutes. A sample with a missing exit quote gets an hour of retries after its deadline. Unavailable outcomes remain unavailable. Stop and a 30% liquidity fall still trigger exits when accounting permits them. Old wallets do not receive synthetic refunds.</p>`;
    $('#labRules').innerHTML+=(s.ruleChanges||[]).map(c=>`<p class="note">${esc(when(c.at))}: ${esc(c.from)} → ${esc(c.to)}. ${esc(c.note||('Daily ceiling '+c.fromDailyLimit+' → '+c.toDailyLimit+'; bin read limit '+c.fromMaxBins+' → '+c.toMaxBins+'. Existing bids, balances and results retained.'))}</p>`).join('');
    document.querySelectorAll('[data-lab-action]').forEach(b=>b.disabled=controlling||b.dataset.labAction==='pause'&&s.runState!=='running'||b.dataset.labAction==='resume'&&s.runState==='running'||b.dataset.labAction==='stop'&&['stopping','stopped'].includes(s.runState));
  }
  async function load(){
    if(loading||controlling)return;loading=true;$('#refreshLab').disabled=true;
    try{const r=await fetch('/api/paper-lab',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Lab results unavailable');render(await r.json());}
    catch{if(current)render(current,true);else {$('#labStatus').textContent='Lab results unavailable. Use Refresh lab to try again.';$('#homeLab').textContent='Strategy lab · results unavailable. Open Strategies to retry.';}}
    finally{loading=false;$('#refreshLab').disabled=false;}
  }
  function choose(style){
    selected=style;$('#activeBotPanel').hidden=style!=='active';$('#paperLab').hidden=style==='active';
    document.querySelectorAll('[data-bot-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.botStyle===style)));
    if(current)render(current);
  }
  document.querySelectorAll('[data-bot-style]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.botStyle)));
  choose('active');
  globalThis.loadPaperLab=load;
  $('#refreshLab').addEventListener('click',load);
  $('#homeLab').addEventListener('click',e=>{if(e.target.closest('[data-open-lab]')){document.querySelector('[data-tab="bot"]').click();choose('scalp');}});
  document.querySelectorAll('[data-lab-action]').forEach(b=>b.addEventListener('click',async()=>{
    if(controlling||loading)return;
    controlling=true;if(current)render(current);
    try{const r=await fetch('/api/paper-lab/control',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.labAction})});const result=await r.json();if(!r.ok){if(r.status===401)throw Error(unlock());throw Error(result.error||'Lab control failed');}render(result);$('#labControlStatus').textContent='Saved. Paper balances and outcomes retained.';}
    catch(e){$('#labControlStatus').textContent=e.message;}
    finally{controlling=false;if(current)render(current);}
  }));
  $('#labMoreTrades').addEventListener('click',async()=>{
    const b=$('#labMoreTrades');b.disabled=true;
    try{const r=await fetch('/api/paper-lab/trades'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{cache:'no-store'});if(!r.ok)throw Error();const result=await r.json();archive.push(...result.records);cursor=result.cursor;archiveStarted=true;render(current);}
    catch{$('#labControlStatus').textContent='Older lab trades unavailable. Please retry.';}
    finally{b.disabled=false;}
  });
  load();setInterval(()=>{if(!document.hidden&&!$('#view-bot').hidden)load();},60000);
})();
