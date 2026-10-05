(()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'Unavailable':n!==0&&Math.abs(n)<1e-7?'<0.0000001':n.toLocaleString(undefined,{maximumFractionDigits:7});
const date=s=>s?new Date(s).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Unavailable';
const tokens=ts=>ts?.map(t=>`<span class="history-token">${esc(fmt(t.amount))} ${esc(t.symbol)}</span>`).join('')||'Unavailable';
let active='',sequence=0;
async function load(force=false){
 const entered=$('#intelAddress').value.trim(),address=entered.toLowerCase()==='pateth'?'':entered;
 if(address&&!/^0x[0-9a-fA-F]{40}$/.test(address)){$('#intelStatus').textContent='Enter a valid 0x wallet address, or leave blank for pateth.';return;}
 const seq=++sequence;$('#intelTitle').textContent=address?address.slice(0,6)+'…'+address.slice(-4)+' activity':'pateth activity';
 $('#intelStatus').textContent='Reading Robinhood LP activity…';$('#refreshIntel').disabled=true;
 if(active!==address){$('#intelOverview').replaceChildren();$('#intelRecords').replaceChildren();}
 try{
  const q=new URLSearchParams();if(address)q.set('address',address);if(force)q.set('refresh','1');
  const r=await fetch('/api/wallet-intelligence?'+q,{signal:AbortSignal.timeout(90000)}),d=await r.json();
  if(seq!==sequence)return;if(!r.ok||d.error)throw new Error(d.error||'Wallet activity unavailable.');active=address;
  const o=d.overview,partial=!d.complete?' · partial':'';
  $('#intelStatus').textContent=`${d.wallet} · ${d.address} · ${d.status==='stale'?'Saved':'Checked'} ${date(d.updatedAt)}${partial}. ${d.errors.join(' ')}`;
  const metric=(label,value)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
  $('#intelOverview').innerHTML=`<div class="intel-metrics">${metric('Open positions'+partial,o.open)}${metric('Closed positions'+partial,o.closed)}${metric('Pools used'+partial,o.pools)}${metric('Typical hold',o.medianHeldHours==null?'—':o.medianHeldHours<48?o.medianHeldHours.toFixed(1)+'h':(o.medianHeldHours/24).toFixed(1)+'d')}</div><div class="intel-holdings">${d.holdings.map(t=>`<span><b>${esc(fmt(t.amount))}</b> ${esc(t.symbol)}</span>`).join('')}</div><details class="note"><summary>Coverage &amp; sources</summary><p>${esc(d.coverage)} Balances checked ${date(d.balancesAt)}. <a href="${esc(d.explorer)}" target="_blank" rel="noopener">Explorer ↗</a></p></details>`;
  $('#intelRecords').innerHTML=d.records.length?d.records.slice().reverse().map(p=>{
   const t0=p.depositedTokens[0],t1=p.depositedTokens[1],scale=10**(t0.decimals-t1.decimals);
   const lower=Math.pow(1.0001,p.tickLower)*scale,upper=Math.pow(1.0001,p.tickUpper)*scale;
   return `<article class="intel-record"><header><div><span class="eyebrow">UNISWAP V3 · #${esc(p.tokenId)}</span><h2>${esc(p.pair)}</h2><span class="range-label">${esc(p.status)} · ${(p.feeTier*100).toLocaleString()}% fee tier</span></div><a href="${esc(p.url)}" target="_blank" rel="noopener">Position ↗</a></header><div class="kv"><div><span>Deposited${p.actions.filter(a=>a.kind==='Deposit').length>1?' · includes top-ups':''}</span><b>${tokens(p.depositedTokens)}</b></div><div><span>Withdrawn principal</span><b>${tokens(p.withdrawnTokens)}</b></div><div><span>Fees collected</span><b class="pos">${tokens(p.feeTokens)}</b></div><div><span>USD P&amp;L</span><b>Unavailable</b></div><div><span>Opened</span><b>${date(p.openedAt)}</b></div><div><span>Closed</span><b>${p.closedAt?date(p.closedAt):'—'}</b></div></div><div class="intel-range"><span>Price range<br><small>${esc(t1.symbol)} per ${esc(t0.symbol)}</small></span><b>${esc(fmt(lower))} – ${esc(fmt(upper))}</b></div><p class="note">${esc(p.note)}</p><details><summary>Activity · ${p.actions.length} events</summary><p class="note">A collection pays out withdrawn principal plus fees. It is not an additional withdrawal.</p>${p.actions.map(a=>`<div class="intel-event"><div><b>${esc(a.kind)}</b><small>${date(a.at)}</small></div><div>${tokens(a.tokens)}</div><a href="${esc(a.url)}" target="_blank" rel="noopener">Transaction ↗</a></div>`).join('')}</details></article>`;
  }).join(''):`<div class="empty-card">${d.complete?'No Uniswap V3 positions found for this wallet.':'Position records are incomplete. Refresh to retry.'}</div>`;
 }catch(e){if(seq===sequence)$('#intelStatus').textContent=(active===address&&$('#intelRecords').children.length?'Showing the previous view. ':'')+e.message;}
 finally{if(seq===sequence)$('#refreshIntel').disabled=false;}
}
window.loadWalletIntel=load;$('#walletResearch').onsubmit=e=>{e.preventDefault();load(true);};$('#refreshIntel').onclick=()=>load(true);
})();
