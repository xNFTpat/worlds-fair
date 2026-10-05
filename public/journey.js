(()=>{
 const number=n=>typeof n==='number'&&Number.isFinite(n);
 function weekSummary(history,now=Date.now()){
  const unique=new Map();for(const r of history?.closed||[])if(!r.isGroup)unique.set(`${r.wallet}:${r.positionAddress||r.poolAddress+':'+r.closedAt}`,r);
  const rows=[...unique.values()].filter(r=>Date.parse(r.closedAt)>=now-7*86400000&&Date.parse(r.closedAt)<=now);
  const sol=rows.filter(r=>r.chain==='solana');
  const sum=key=>sol.some(r=>!number(r.pnlBreakdown?.[key]))?null:sol.reduce((n,r)=>n+r.pnlBreakdown[key],0);
  return {rows,solana:sol.length,other:rows.length-sol.length,price:sum('positionPnlUsd'),fees:sum('claimedFeesUsd'),total:sum('totalPnlUsd'),unknown:sol.filter(r=>!number(r.pnlBreakdown?.totalPnlUsd)).length};
 }
 globalThis.LPJourney={weekSummary};if(typeof document==='undefined')return;
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const usd=n=>number(n)?(n<0?'−':'')+'$'+Math.abs(n).toFixed(2):'Unavailable',tone=n=>n>0?'pos':n<0?'neg':'';
 const date=t=>Number.isFinite(Date.parse(t))?new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Date unavailable';
 const tokens=t=>t?.length?t.map(x=>`${esc(x.amount)} ${esc(x.symbol)}`).join(' + '):'Unavailable';
 let data,limit=12;
 function render(){if(!data)return;
  const oldOpen=new Set([...$('#journeyList').querySelectorAll('details[open]')].map(d=>d.dataset.journeyId));
  const w=weekSummary(data),start=new Date(Date.now()-7*86400000).toLocaleDateString(undefined,{day:'numeric',month:'short'});
  $('#weeklyWrap').innerHTML=`<section class="weekly-wrap"><div class="section-heading"><div><span class="eyebrow">SEVEN-DAY WRAP / SINCE ${esc(start)}</span><h2>This part of the journey.</h2></div><button id="downloadWrap" class="outline">Save wrap ↗</button></div><div class="weekly-grid"><div><small>Closed Solana positions</small><b>${w.solana}</b></div><div><small>Price / LP P&amp;L</small><b>${usd(w.price)}</b></div><div><small>Claimed fees</small><b>${usd(w.fees)}</b></div><div><small>Total P&amp;L</small><b>${usd(w.total)}</b></div></div><p class="note">Closed records only · before network costs · fees already included in total. ${w.unknown?w.unknown+' outcomes have incomplete USD accounting. ':''}${w.other?w.other+' Robinhood records shown below in token units. ':''}${Object.values(data.historySources||{}).some(s=>s.stale)||Object.keys(data.errors||{}).length?'Coverage is partial or saved; see source status below.':''} This is not a wallet return or current open-position P&amp;L.</p></section>`;
  $('#downloadWrap').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({generatedAt:new Date().toISOString(),period:'Last seven days',units:'USD for Solana; Robinhood excluded from USD totals',basis:'Closed positions before network costs; total includes fees; no compounding',coverage:data.historySources,errors:data.errors,...w},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='still-weekly-wrap-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const wallet=$('#journeyWallet').value,search=$('#journeySearch').value.trim().toLowerCase();
  const rows=(data.closed||[]).filter(r=>!r.isGroup&&(!wallet||r.wallet===wallet)&&(!search||r.pair.toLowerCase().includes(search))).sort((a,b)=>(b.closedAt||'').localeCompare(a.closedAt||''));
  $('#journeyList').innerHTML=rows.slice(0,limit).map(r=>{const p=r.pnlBreakdown||{},id=r.wallet+':'+r.positionAddress;return `<article class="journey-card"><span class="eyebrow">${esc(r.wallet)} / ${r.chain==='solana'?'SOLANA':'ROBINHOOD'}</span><div class="section-heading"><h3>${esc(r.pair)}</h3><b class="journey-result ${tone(p.totalPnlUsd)}">${r.chain==='solana'?usd(p.totalPnlUsd):'Token record'}</b></div><small>Closed ${date(r.closedAt)}</small><dl>${r.chain==='solana'?`<div><dt>Price / LP P&amp;L</dt><dd>${usd(p.positionPnlUsd)}</dd></div><div><dt>Claimed fees</dt><dd>${usd(p.claimedFeesUsd)}</dd></div><div><dt>Added to this position</dt><dd>${usd(r.depositedUsd)}</dd></div><div><dt>Withdrawn principal</dt><dd>${usd(r.withdrawnUsd)}</dd></div>`:`<div><dt>Deposited</dt><dd>${tokens(r.depositedTokens)}</dd></div><div><dt>Withdrawn</dt><dd>${tokens(r.withdrawnTokens)}</dd></div><div><dt>Claimed fees</dt><dd>${tokens(r.claimedFeeTokens||r.feeTokens)}</dd></div>`}</dl><details data-journey-id="${esc(id)}" ${oldOpen.has(id)?'open':''}><summary>Position details</summary><p>Opened ${date(r.openedAt)}<br>${esc(r.positionAddress||'Position ID unavailable')}</p><p>${esc(p.note||'Historical USD accounting unavailable for this chain.')}</p><a href="${esc(r.url)}" target="_blank" rel="noopener">View pool ↗</a></details></article>`;}).join('')||'<div class="empty-card">No closed positions match this view.</div>';
  $('#journeyMore').hidden=rows.length<=limit;
 }
 window.renderJourney=h=>{data=h;const select=$('#journeyWallet'),value=select.value;select.innerHTML='<option value="">All wallets</option>'+[...new Set((h.closed||[]).map(r=>r.wallet))].map(w=>`<option value="${esc(w)}">${esc(w)}</option>`).join('');select.value=value;render();};
 $('#journeyWallet').onchange=()=>{limit=12;render();};$('#journeySearch').oninput=()=>{limit=12;render();};$('#journeyMore').onclick=()=>{limit+=12;render();};
})();
