(()=>{
 function describe(s,a,health,now){
  if(s.runState!=='running')return {text:s.runState==='stopping'?'Closing positions':'Entries paused',tone:'warn'};
  if(a.active===false)return {text:'Archived',tone:'muted'};
  if(a.halted)return {text:'Entries stopped · risk guard',tone:'warn'};
  if(a.riskDataHold||a.entryReason?.includes('values are incomplete')){
   const historical=(a.unresolvedSol>0||a.unscorableCount>0)&&(s.positions||[]).filter(p=>p.arm===a.id).length===0;
   return {text:historical?'Accounting hold · earlier outcomes':'Waiting for position values',tone:'warn',detail:a.activity?.detail};
  }
  const at=Date.parse(s.lastFullScanAt||s.lastScanAt);
  if(!Number.isFinite(at)||now-at>600000||!health||health.status!=='running')return {text:'Scan status needs attention',tone:'warn'};
  if(!a.entryAllowed)return {text:a.entryReason?.includes('open-position')?'Managing · at capacity':'New entries on hold',tone:'muted'};
  if(a.activity?.label)return {text:a.activity.label,tone:a.activity.tone,detail:a.activity.detail};
  if(s.discoveryHealth?.freshPools===0)return {text:'Waiting for fresh pool sources',tone:'warn'};
  const f=s.funnel?.[a.id];
  if(f){
   if(f.checked>0&&!f.entered&&(f.providerBlocked>0||f.modelRejected>0))return {text:f.providerBlocked&&!f.modelRejected?'Entry quote provider blocked':f.modelRejected&&!f.providerBlocked?'Entry model / cost rejected':'Entry checks blocked',tone:'warn'};
   if(f.ready>0&&!f.entered)return {text:'Setup ready · awaiting entry check',tone:'ok'};
   if(!f.screened)return {text:'No pools pass activity filters',tone:'muted'};
   if(!f.ready&&f.warming)return {text:'Building setup history',tone:'muted'};
   if(!f.ready)return {text:'No qualifying price setup',tone:'muted'};
  }
  return {text:'Scanning for entries',tone:'ok'};
 }
 window.lpFleetActivity=(s,a,health,now=Date.now())=>{
  const result=describe(s,a,health,now);
  return s.readError?{...result,text:'Saved / read failed · '+result.text,tone:'warn'}:result;
 };
})();
