(() => {
 const times = new Map();
 const labels = new Map();
 const stamp = (node, at, note='') => {
  const parsed = Date.parse(at || '');
  const text = Number.isFinite(parsed) ? 'Data as of ' + new Date(parsed).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : 'Data as of — · ' + (note || 'awaiting a successful read');
  let mark = Array.from(node.children).find(child => child.classList.contains('panel-data-asof'));
  if (!mark) {mark=document.createElement('p');mark.className='panel-data-asof';const heading=node.querySelector(':scope > .section-heading');if(heading)heading.after(mark);else node.append(mark);}
  mark.textContent=text;mark.title=at || note;return text;
 };
 const sourceDate = data => {
  const sources=Object.values(data.sources || data.historySources || {});
  const dates=sources.map(s=>s.lastSuccessAt || s.readAt).filter(t=>Number.isFinite(Date.parse(t)));
  if(dates.length)return new Date(Math.min(...dates.map(Date.parse))).toISOString();
  return data.dataAsOf || data.asOf || data.updatedAt || data.fetchedAt || data.scannedAt || null;
 };
 const record = (url, data) => {
  const path=new URL(url,location.origin).pathname,at=sourceDate(data);
  const sections=path==='/api/positions'?['view-home','view-positions']:path==='/api/history'?['view-history']:path==='/api/pools'?[document.getElementById('legacyPoolCatalogue')?'legacyPoolCatalogue':'view-pools']:path==='/api/pool-chart'?['drawer']:[];
  for(const id of sections){const node=document.getElementById(id);if(node){times.set(id,at);labels.set(id,'awaiting a successful read');stamp(node,at);for(const panel of node.querySelectorAll('.card,.tile,.portfolio-overview,.decision-brief'))stamp(panel,at);}}
 };
 const observer=new MutationObserver(records=>{const ids=new Set();for(const change of records){const section=change.target.closest?.('[id^="view-"],#legacyPoolCatalogue');if(section && times.has(section.id))ids.add(section.id);}for(const id of ids){const section=document.getElementById(id);const at=times.get(id);for(const panel of section.querySelectorAll('.card,.tile,.portfolio-overview,.decision-brief')){if(!panel.querySelector(':scope > .panel-data-asof'))stamp(panel,at,labels.get(id));}}});
 observer.observe(document.querySelector('main'),{childList:true,subtree:true});
 window.LPPanelDates={record,stamp};
})();
