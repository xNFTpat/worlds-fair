(function(root){
 root.lpScannerStatus=function(fleet,health,now=Date.now()){
  const age=t=>t&&Number.isFinite(Date.parse(t))?Math.max(0,now-Date.parse(t)):Infinity;
  const full=fleet.lastFullScanAt||fleet.lastScanAt;
  if(!health)return {tone:'warn',text:'Background status unavailable · last saved scan',at:full};
  if(!health.enabled)return {tone:'warn',text:'Background scanner stopped · last saved scan',at:full};
  if(health.failures||age(full)>7*60000||age(health.lastSuccessAt)>3*60000){
   if(!health.lastSuccessAt&&age(health.lastAttemptAt)<2*60000)return {tone:'warn',text:'Starting background checks · last saved scan',at:full};
   return {tone:'warn',text:'Background scan delayed · position values may be stale · last saved scan',at:full};
  }
  return {tone:'ok',text:(fleet.runState==='running'?'Background checks running':fleet.runState==='paused'?'Entries paused · exit checks running':'Exit checks running')+' · last pool scan',at:full};
 };
})(typeof window==='undefined'?globalThis:window);
