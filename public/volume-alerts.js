(() => {
  const valid=n=>typeof n==='number'&&Number.isFinite(n);
  const presets={highlights:{minTvl:100,minVolume:5000,minRatio:3,newPools:false,resumed:false},explore:{minTvl:100,minVolume:500,minRatio:2,newPools:true,resumed:true}};
  const preferences=p=>({minTvl:valid(p?.minTvl)&&p.minTvl>=0?p.minTvl:100,minVolume:valid(p?.minVolume)&&p.minVolume>=500?p.minVolume:5000,minRatio:valid(p?.minRatio)&&p.minRatio>=2?p.minRatio:3,newPools:p?.newPools===true,resumed:p?.resumed===true});
  const visible=(events,p)=>events.filter(e=>(!p.minTvl||(valid(e.tvlUsd)&&e.tvlUsd>=p.minTvl))&&(e.signal?.latest30m??0)>=p.minVolume&&(e.kind==='surge'?(e.signal?.ratio??0)>=p.minRatio:e.kind==='new-pool'?p.newPools:e.kind==='resumed'?p.resumed:false)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const quotes=new Set(['So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
  function tokenKey(e){
    if(!e.base||!e.quote)return 'pool:'+e.poolId;
    if(quotes.has(e.base)&&!quotes.has(e.quote))return 'mint:'+e.quote;
    if(quotes.has(e.quote)&&!quotes.has(e.base))return 'mint:'+e.base;
    return 'pair:'+JSON.stringify([e.base,e.quote].sort());
  }
  function groupEvents(events,p,{now=Date.now(),hidden={},maxAgeMs=2*3600000}={}){
    const newest=new Map();
    for(const e of events){const at=Date.parse(e.at);if(!Number.isFinite(at)||at>now+60000||now-at>maxAgeMs)continue;const prior=newest.get(e.poolId);if(!prior||at>Date.parse(prior.at))newest.set(e.poolId,e);}
    const groups=new Map();
    for(const e of visible([...newest.values()],p)){
      const key=tokenKey(e);if(valid(hidden[key])&&hidden[key]>now)continue;
      if(!groups.has(key))groups.set(key,{key,pools:[]});groups.get(key).pools.push(e);
    }
    const order=(a,b)=>(b.signal?.latest30m??0)-(a.signal?.latest30m??0)||Date.parse(b.at)-Date.parse(a.at)||String(a.poolId).localeCompare(String(b.poolId));
    return [...groups.values()].map(g=>{g.pools.sort(order);return {...g,best:g.pools[0]};}).sort((a,b)=>order(a.best,b.best));
  }
  globalThis.LPVolumeAlerts={preferences,visible,tokenKey,groupEvents,presets};
  if(typeof document==='undefined')return;
  const $=s=>document.querySelector(s),esc=v=>String(typeof v==='number'&&!Number.isFinite(v)?'Unavailable':v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp=t=>Number.isFinite(Date.parse(t))?new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Unavailable';
  const time=t=>new Date(t).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  const usd=v=>valid(v)?v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}):'Unavailable';
  const pct=v=>valid(v)?(v*100).toLocaleString('en-US',{maximumFractionDigits:1})+'%':'Unavailable';
  const get=k=>{try{const v=JSON.parse(localStorage.getItem(k)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
  // New presentation defaults, keeping old broad-scan preferences and all server history intact.
  const key='lp-volume-settings-v2',hiddenKey='lp-volume-hidden-v1',saved=get(key);
  let prefs=preferences(saved),mode=['highlights','explore','custom'].includes(saved.mode)?saved.mode:'highlights',hideMarket=saved.hidden===true,hidden=get(hiddenKey),data=null,pending=null,failure='',storageFailure=false,archiveLimit=20;
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{storageFailure=true;}};
  const savePrefs=()=>save(key,{...prefs,mode,hidden:hideMarket});
  function syncForm(){const f=$('#volumeAlertPreferences');for(const k of ['minTvl','minVolume','minRatio'])f.elements[k].value=prefs[k];for(const k of ['newPools','resumed'])f.elements[k].checked=prefs[k];$('#hideVolumeShortlist').checked=hideMarket;document.querySelectorAll('[data-volume-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.volumeMode===mode)));}
  function groupHtml(g,open){const e=g.best,multiple=valid(e.signal?.ratio)?e.signal.ratio.toLocaleString('en-US',{maximumFractionDigits:1})+'×':e.kind==='new-pool'?'New pool':'Resumed';return `<details class="digest-item" data-digest-key="${esc(g.key)}" ${open.has(g.key)?'open':''}><summary><span class="digest-name"><b>${esc(e.pair)}</b><small>${usd(e.signal.latest30m)} volume / 30m${g.pools.length>1?' · '+g.pools.length+' pools':''}</small></span><span class="digest-signal"><b>${esc(multiple)}</b><small>Seen ${esc(time(e.at))}</small></span></summary><div class="digest-body"><p>${esc(e.signal.note)}</p><p class="note">${esc(e.venue.replace('meteora-','').toUpperCase())} · ${usd(e.tvlUsd)} pool balance · Fee APR ${pct(e.feeApr)} annualised. This is a saved observation, not a forecast.${e.firstObservation?' Already active when first seen.':''}</p>${e.comparedAt?`<p class="note">Price ${valid(e.priceChange)?(e.priceChange>0?'+':'')+pct(e.priceChange):'unavailable'} since ${esc(time(e.comparedAt))}.</p>`:''}<div class="digest-actions"><button class="outline" data-volume-pool="${esc(e.address)}">Review pool ↗</button><button class="text-button" data-volume-hide="${esc(g.key)}">Hide token for 24h</button></div>${g.pools.length>1?`<div class="digest-other-pools"><span class="note">Other pools for the same token · amounts kept separate</span>${g.pools.slice(1).map(p=>`<button class="text-button" data-volume-pool="${esc(p.address)}">${esc(p.pair)} · ${esc(p.venue.replace('meteora-',''))} · ${esc(p.address.slice(0,5)+'…'+p.address.slice(-4))} · ${usd(p.signal.latest30m)} / 30m ↗</button>`).join('')}</div>`:''}</div></details>`;}
  function renderList(host,groups){if(host.contains(document.activeElement))return;const open=new Set([...host.querySelectorAll('details[open]')].map(d=>d.dataset.digestKey));host.innerHTML=groups.map(g=>groupHtml(g,open)).join('');}
  function render(){
    // Market activity is a browseable shortlist, never an unread task count.
    window.setAlertCount('volume',0);
    const groups=groupEvents(data?.events||[],prefs,{hidden}),all=groupEvents(data?.events||[],prefs,{hidden,maxAgeMs:Infinity}),last=data?.state?.lastCheckedAt;
    const delayed=!last||Date.now()-Date.parse(last)>600000;
    const gaps=Object.values(data?.sources||{}).some(s=>/Meteora/.test(s.label)&&s.status!=='fresh');
    $('#volumeDigestHint').textContent=hideMarket?'Market activity is hidden. Your position alerts stay on.':`Up to five tokens · past two hours${mode==='highlights'?' · at least 3× volume and $5,000 traded in 30m':mode==='explore'?' · includes new and resumed activity':' · custom filters'}.`;
    $('#volumeMonitorStatus').textContent=failure||(!last?'Waiting for the first scan.':`${delayed?'Scan delayed':'Updated'} ${stamp(last)}${gaps?' · Some data is missing.':''}`);
    $('#volumeStorageStatus').textContent=storageFailure?' Settings could not be saved on this device.':'';
    $('#volumeAlertInbox').hidden=hideMarket;$('#volumeArchive').hidden=hideMarket;$('#volumeOptions').hidden=hideMarket;
    if(!hideMarket){renderList($('#volumeAlertInbox'),groups.slice(0,5));if(!groups.length)$('#volumeAlertInbox').innerHTML='<p class="digest-empty">Nothing stands out in this view right now. Try Explore more when you want a wider scan.</p>';renderList($('#volumeArchiveRows'),all.slice(0,archiveLimit));$('#volumeAlertCount').textContent=`· ${all.length} tokens`;$('#moreVolumeActivity').hidden=all.length<=archiveLimit;}
    $('#resetHiddenVolume').hidden=!Object.values(hidden).some(until=>until>Date.now());
  }
  async function request(url,options){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(90000),...options});const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'Volume scan unavailable');return d;}
  window.loadVolumeAlerts=async(fresh=false)=>{
    if(pending)return pending;$('#refreshVolumeAlerts').disabled=true;
    pending=(async()=>{try{if(fresh){$('#volumeMonitorStatus').textContent='Checking activity…';await request('/api/refresh',{method:'POST'});}const next=await request('/api/volume-alerts');if(!Array.isArray(next.events))throw Error('Incomplete volume response');data=next;failure='';}catch(e){failure='Couldn’t refresh. Saved observations remain available.';}finally{pending=null;$('#refreshVolumeAlerts').disabled=false;render();}})();return pending;
  };
  $('#refreshVolumeAlerts').onclick=()=>window.loadVolumeAlerts(true);
  document.querySelectorAll('[data-volume-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.volumeMode;prefs=preferences(presets[mode]);archiveLimit=20;savePrefs();syncForm();render();});
  $('#hideVolumeShortlist').onchange=e=>{hideMarket=e.target.checked;savePrefs();render();};
  $('#volumeAlertPreferences').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;prefs=preferences({minTvl:Number(f.elements.minTvl.value),minVolume:Number(f.elements.minVolume.value),minRatio:Number(f.elements.minRatio.value),newPools:f.elements.newPools.checked,resumed:f.elements.resumed.checked});mode='custom';archiveLimit=20;savePrefs();syncForm();render();};
  $('#moreVolumeActivity').onclick=()=>{archiveLimit+=20;render();};
  $('#resetHiddenVolume').onclick=()=>{hidden={};save(hiddenKey,hidden);render();};
  $('#volumeAlerts').addEventListener('click',e=>{const p=e.target.closest('[data-volume-pool]'),h=e.target.closest('[data-volume-hide]');if(p)document.dispatchEvent(new CustomEvent('lp:review-volume',{detail:p.dataset.volumePool}));if(h){hidden=Object.fromEntries(Object.entries(hidden).filter(([,until])=>until>Date.now()));hidden[h.dataset.volumeHide]=Date.now()+86400000;save(hiddenKey,hidden);h.blur();render();}});
  $('#poolLookup').onsubmit=async e=>{
    e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),out=$('#poolLookupResult');if(!f.reportValidity())return;b.disabled=true;out.textContent='Identifying pool…';
    try{const d=await request('/api/pool-lookup?address='+encodeURIComponent(f.elements.address.value.trim()));out.innerHTML=`<h4>${esc(d.pair)} · ${esc(d.type)}</h4><p>${esc(d.explanation)}</p><p class="note">${esc(d.details)}</p>${d.tokens.map(t=>`<p><b>${esc(t.name||t.symbol)}</b> · ${esc(t.symbol)}<br><code>${esc(t.address)}</code>${t.transferFee?' · Transfer-fee token':''}${t.freeze?' · Freeze capability flagged':''}<br><button class="text-button" data-lookup-token="${esc(t.address)}">Find Meteora pools for ${esc(t.symbol)} ↗</button></p>`).join('')}<p class="note">${esc(d.caveat)} · Read ${stamp(d.fetchedAt)}</p><a href="${esc(d.url)}" target="_blank" rel="noopener">View pool ↗</a>`;}catch(err){out.textContent=err.message;}finally{b.disabled=false;}
  };
  $('#poolLookupResult').onclick=e=>{const b=e.target.closest('[data-lookup-token]');if(b)document.dispatchEvent(new CustomEvent('lp:find-token-pools',{detail:b.dataset.lookupToken}));};
  window.addEventListener('storage',e=>{if(e.key===key){const v=get(key);prefs=preferences(v);mode=v.mode||'highlights';hideMarket=v.hidden===true;syncForm();render();}if(e.key===hiddenKey){hidden=get(hiddenKey);render();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.loadVolumeAlerts();});
  setInterval(()=>{if(!document.hidden)window.loadVolumeAlerts();},60000);
  syncForm();render();window.loadVolumeAlerts();
})();
