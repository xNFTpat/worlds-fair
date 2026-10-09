/* Paper-only browser client. The server owns balances, claims and history. */
(() => {
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sol=value=>finite(value)?value.toLocaleString('en-GB',{minimumFractionDigits:4,maximumFractionDigits:9})+' SOL':'Awaiting balance';
  const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}):'Date unavailable';
  const usd=value=>finite(value)?new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD',currencyDisplay:'narrowSymbol',maximumFractionDigits:2}).format(value):'Unavailable';
  const signedSol=value=>finite(value)?(value>0?'+':'')+sol(value):'Unavailable';
  const signedUsd=value=>finite(value)?(value>0?'+':'')+usd(value):'Unavailable';
  const ratePublicationText=value=>Number.isFinite(Date.parse(value))?'Provider rate dated '+stamp(value):'Provider publication time unavailable';
  const paperActions=['seed','roll','basket','refresh','deposit','rule'];
  // These ledger/provider rejections occur before a new commit, after any
  // matching saved receipt is checked. An unknown HTTP error is not proof:
  // an earlier attempt may have committed before its response was lost.
  const definitivePaperRejections=new Set([
    'paper_cash_unavailable','paper_holdings_full','paper_account_full',
    'paper_quote_expired','paper_quote_incomplete','paper_vault_quote_invalid',
    'paper_rate_limit','paper_provider_rate_limit','paper_rule_changed',
    'paper_close_changed','paper_profit_claimed','paper_close_unavailable',
    'paper_source_stale','paper_source_incomplete',
    'basket_invalid','basket_unavailable','basket_allocation_incomplete','vault_invalid','vault_unavailable',
  ]);
  const valuationMaxAgeMs=5*60*1000;
  const fundedArms=new Set(['farmer','scalp','wide','steady']);
  function previewProfit(pnlSol,percent){
    if(!finite(pnlSol)||pnlSol<=0||!Number.isInteger(percent)||percent<1||percent>100)return null;
    const lamports=Math.floor(pnlSol*1e9);
    if(!Number.isSafeInteger(lamports))return null;
    return Number(BigInt(lamports)*BigInt(percent)/100n)/1e9;
  }
  function performanceNet(arm){
    const equity=Object.hasOwn(arm,'performanceEquitySol')?arm.performanceEquitySol:arm.equitySol;
    return finite(equity)&&finite(arm.seedSol??10)?equity-(arm.seedSol??10):null;
  }
  function rollEligible(trade){
    return !!trade&&fundedArms.has(trade.arm)&&finite(trade.pnlSol)&&trade.pnlSol>0&&typeof trade.id==='string'&&Number.isFinite(Date.parse(trade.closedAt))&&trade.profitRoll?.eligible===true&&!trade.profitRoll.claimed;
  }
  function mergeSnapshot(current,data,append=false){
    const priorRevision=current.accountData?.account?.revision,nextRevision=data.account?.revision;
    if(data.account&&finite(priorRevision)&&(!finite(nextRevision)||nextRevision<priorRevision))return current;
    const incoming=data.history||[];
    return {accountData:data.account?data:current.accountData,
      events:append?[...new Map([...current.events,...incoming].map(event=>[event.id||JSON.stringify(event),event])).values()]:incoming,
      cursor:data.cursor||null};
  }
  function tokenUnits(leg){
    if(typeof leg?.unitsRaw!=='string'||!/^\d+$/.test(leg.unitsRaw)||!Number.isInteger(leg.decimals)||leg.decimals<0||leg.decimals>18)return 'Units unavailable';
    const digits=leg.unitsRaw.replace(/^0+(?=\d)/,'').padStart(leg.decimals+1,'0');
    if(!leg.decimals)return digits;
    const decimal=digits.slice(-leg.decimals).replace(/0+$/,'');
    return digits.slice(0,-leg.decimals)+(decimal?'.'+decimal:'');
  }
  function basketLegsHtml(legs=[]){
    return '<div class="wf-basket-legs">'+legs.map(leg=>'<div class="wf-basket-leg"><div><b>'+esc(leg.symbol||'Token')+'</b><span>'+esc(finite(leg.weight)?leg.weight.toFixed(2)+'%':'Weight unavailable')+'</span></div><strong>'+esc(tokenUnits(leg))+' units</strong><p>'+esc(Number.isSafeInteger(leg.inputLamports)?sol(leg.inputLamports/1e9):'Input unavailable')+' allocated · impact '+esc(finite(leg.priceImpactFraction)?(leg.priceImpactFraction*100).toFixed(2)+'%':'unavailable')+'</p><small>Quoted '+esc(stamp(leg.quoteAsOf))+'</small></div>').join('')+'</div>';
  }
  function basketValuation(holding,now=Date.now()){
    const value=holding.valuation,at=Date.parse(value?.asOf||'');
    const current=value?.status==='complete'&&Number.isFinite(at)&&at<=now&&now-at<=valuationMaxAgeMs&&finite(value.valueSol)&&finite(value.valueUsd);
    const prior=holding.lastCompleteValuation||value,priorAt=Date.parse(prior?.asOf||'');
    const saved=!current&&prior?.status==='complete'&&Number.isFinite(priorAt)&&priorAt<=now?prior:null;
    return {current:current?value:null,saved,note:current?'Priced '+stamp(value.asOf):value?.status==='partial'?'Some token prices are missing. Refresh for a complete valuation.':value?.status==='unavailable'?'Current prices are unavailable. Your paper units remain saved.':value?'The last complete price reading has expired. Refresh your paper portfolio.':'Refresh your paper portfolio to value these quoted units.'};
  }
  function basketHoldingHtml(holding,now=Date.now()){
    const view=basketValuation(holding,now),value=view.current;
    return '<article class="wf-paper-holding"><div class="section-heading"><div><span class="eyebrow">PAPER BASKET</span><h3>'+esc(holding.name||holding.slug||'Basket')+'</h3></div><span class="wf-holding-state">'+(value?'Current reading':'Valuation unavailable')+'</span></div><p class="note">Paper cost '+esc(sol(holding.costSol))+' · '+esc(stamp(holding.openedAt))+'</p><div class="wf-holding-metrics"><div><span>Current value · SOL</span><b>'+esc(value?sol(value.valueSol):'Unavailable')+'</b></div><div><span>Current value · USD</span><b>'+esc(value?usd(value.valueUsd):'Unavailable')+'</b></div><div><span>Change vs keeping SOL</span><b>'+esc(signedSol(value?.pnlSol))+'</b><small>'+esc(signedUsd(value?.vsHoldSolUsd))+'</small></div><div><span>Change since purchase · USD</span><b>'+esc(signedUsd(value?.absolutePnlUsd))+'</b><small>Compared with the entry USD cost</small></div></div><p class="note">'+esc(view.note)+'</p>'+(view.saved?'<p class="wf-saved-valuation">Last complete reading: '+esc(sol(view.saved.valueSol))+' / '+esc(usd(view.saved.valueUsd))+' · '+esc(stamp(view.saved.asOf))+'. Saved values are not current prices.</p>':'')+'<details data-paper-holding="'+esc(holding.id)+'"><summary>Paper units &amp; entry quote per leg</summary>'+basketLegsHtml(holding.legs)+'</details></article>';
  }
  function recoveryLabel(item){
    if(item.action==='seed')return 'add SOL · '+item.payload.amountSol+' SOL';
    if(item.action==='roll')return finite(item.payload.percent)?'profit roll · '+item.payload.percent+'%':'whole-profit rule';
    if(item.action==='basket')return 'basket purchase · '+item.payload.amountSol+' SOL';
    if(item.action==='deposit')return 'deposit · '+item.payload.amountSol+' SOL';
    if(item.action==='rule')return 'profit rule · '+(item.payload.enabled?'on':'off');
    return 'holding price refresh';
  }
  function ruleProblem(rule){
    if(!rule||typeof rule.enabled!=='boolean')return 'Choose whether the profit rule is on.';
    const values=[rule.lpPercent,rule.vaultPercent,rule.basketPercent];
    if(values.some(value=>!Number.isInteger(value)||value<0||value>100)||values.reduce((sum,value)=>sum+value,0)!==100)return 'Use whole percentages that add up to 100%.';
    if(rule.enabled&&rule.vaultPercent>0&&!['jito-liquid-staking','marinade-liquid-staking','jupiter-staked-sol'].includes(rule.vaultId))return 'Choose a Solana staking option for its share.';
    if(rule.enabled&&rule.basketPercent>0&&!rule.basketSlug)return 'Choose a basket for its share.';
    return null;
  }
  function ruleSummary(rule){
    return rule?.enabled?rule.lpPercent+'% shared LP capital · '+rule.vaultPercent+'% '+(rule.vaultName||'selected staking option')+' · '+rule.basketPercent+'% '+(rule.basketName||'selected basket'):'Off · choose how much to move each time you transfer paper profit.';
  }
  function ruleWithLabels(rule,ideas=[],baskets=[]){
    return {...rule,vaultName:ideas.find(idea=>idea.id===rule?.vaultId)?.name||null,basketName:baskets.find(basket=>basket.slug===rule?.basketSlug)?.name||null};
  }
  function depositAvailable(idea,now=Date.now()){
    const at=Date.parse(idea?.readAt||'');
    const rateAt=idea?.rateAsOf==null?null:Date.parse(idea.rateAsOf),rateDateReady=rateAt===null||Number.isFinite(rateAt)&&rateAt<=now&&now-rateAt<=3600000;
    const assetReady=idea?.kind==='staking'?idea.asset==='SOL'&&idea.depositEnabled===true:idea?.depositEnabled===true&&typeof idea.inputTokenMint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(idea.inputTokenMint)&&Number.isInteger(idea.inputTokenDecimals)&&idea.inputTokenDecimals>=0&&idea.inputTokenDecimals<=18;
    return !!idea&&idea.chain==='Solana'&&idea.kind==='staking'&&assetReady&&!idea.disabled&&!idea.stale&&finite(idea.rate)&&idea.rate>=0&&['APR','APY'].includes(idea.rateType)&&rateDateReady&&Number.isFinite(at)&&at<=now&&now-at<=3600000;
  }
  function assetUnits(value,asset){return finite(value)&&value>=0?value.toLocaleString('en-GB',{maximumFractionDigits:9})+' '+asset:'Unavailable';}
  function vaultHoldingHtml(holding){
    const a=holding.accrual||{},asset=holding.asset||'asset',rate=finite(holding.rate)?holding.rate:finite(a.rate)?a.rate:null;
    return '<article class="wf-paper-holding"><span class="eyebrow">PAPER '+(['jito-liquid-staking','marinade-liquid-staking','jupiter-staked-sol'].includes(holding.ideaId)?'STAKING':'SAVED YIELD')+'</span><h3>'+esc(holding.name||'Saved deposit')+'</h3><p class="note">Paper entry cost '+esc(sol(holding.costSol))+' · '+esc(stamp(holding.openedAt))+'</p><div class="wf-holding-metrics"><div><span>Starting asset units</span><b>'+esc(assetUnits(a.principalUnits,asset))+'</b></div><div><span>Estimated rewards</span><b>'+esc(assetUnits(a.accruedUnits,asset))+'</b></div><div><span>Estimated total units</span><b>'+esc(assetUnits(a.estimatedUnits,asset))+'</b></div><div><span>Quoted rate</span><b>'+esc(rate===null?'Unavailable':rate.toFixed(2)+'% '+(holding.rateType||a.rateType||''))+'</b></div></div><p class="note"><b>estimate at quoted rate</b> · linear, without compounding. Underlying '+esc(asset)+' units; no liquid staking receipt-token units or dollar value are assumed.</p><p class="note">Rate read '+esc(stamp(holding.rateReadAt||holding.readAt))+' · '+esc(ratePublicationText(holding.rateAsOf))+' · estimate read '+esc(stamp(a.asOf))+'.</p><div class="wf-deposit-exposure"><div><b>What you’re exposed to</b><p>'+esc(holding.risk||'Exposure details unavailable.')+'</p></div><div><b>Getting out</b><p>'+esc(holding.exit||'Withdrawal details unavailable.')+'</p></div></div></article>';
  }
  const allocationKeys=['cashSol','lpContributedSol','vaultCostSol','basketCostSol'];
  const allocationLabels=['Available paper SOL','Left in shared demo LPs','Yield entry cost','Basket entry cost'];
  const allocationColors=['#d9d5bd','#969d76','#62764e','#b39465'];
  function allocationSeries(history){
    return history.filter(event=>Number.isFinite(Date.parse(event.at))&&allocationKeys.every(key=>finite(event.allocationSnapshot?.[key])&&event.allocationSnapshot[key]>=0)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.sequence||0)-(b.sequence||0)).slice(-30).map(event=>({at:event.at,...event.allocationSnapshot}));
  }
  function allocationChartHtml(history){
    const rows=allocationSeries(history),last=rows.at(-1),max=Math.max(0,...rows.map(row=>allocationKeys.reduce((sum,key)=>sum+row[key],0)));
    const heading='<h3>Capital placed over time (SOL at entry)</h3><p class="note">The LP amount records profit left in shared demo strategies; it is not part of your available balance or owned current equity. Saved yield deposits and baskets show entry cost. Unspent paper SOL stays separate.</p>';
    if(!rows.length)return heading+'<p class="note">New paper moves will start this chart. Older moves without allocation records are not reconstructed.</p>';
    const width=620,height=160,gap=Math.min(6,width/rows.length/4),bar=width/rows.length;
    const bars=rows.map((row,i)=>{let y=height;return allocationKeys.map((key,k)=>{const h=max>0?row[key]/max*height:0;y-=h;return '<rect x="'+(40+i*bar+gap/2).toFixed(2)+'" y="'+(20+y).toFixed(2)+'" width="'+Math.max(1,bar-gap).toFixed(2)+'" height="'+h.toFixed(2)+'" fill="'+allocationColors[k]+'"><title>'+esc(stamp(row.at)+' · '+allocationLabels[k]+': '+sol(row[key]))+'</title></rect>';}).join('');}).join('');
    return heading+'<div class="wf-allocation-legend">'+allocationKeys.map((key,i)=>'<span><i style="background:'+allocationColors[i]+'"></i>'+esc(allocationLabels[i])+': <b>'+esc(sol(last[key]))+'</b></span>').join('')+'</div><svg class="wf-allocation-chart" viewBox="0 0 690 224" role="img" aria-label="Paper SOL available or placed in shared demo LPs, saved yield deposits and baskets at recorded moves. Values are SOL at entry, not current market values."><line x1="40" x2="660" y1="180" y2="180" stroke="var(--line)"/><text x="2" y="23">'+esc(max.toLocaleString('en-GB',{maximumFractionDigits:3}))+'</text>'+bars+'<text x="40" y="205">'+esc(stamp(rows[0].at))+'</text><text x="660" y="205" text-anchor="end">'+esc(stamp(last.at))+'</text></svg><p class="note">'+rows.length+' recorded move'+(rows.length===1?'':'s')+' shown · latest 30 available allocation records. Bars follow move order.</p>';
  }
  function basketReceiptHtml(receipt){
    if(receipt?.kind!=='basket'||!Array.isArray(receipt.legs))return '';
    return '<div class="wf-basket-receipt"><button type="button" class="text-button wf-paper-return" data-paper-show-holdings>View my paper holdings ↓</button><span class="eyebrow">PAPER QUOTE RECEIPT</span><h4>'+esc(receipt.name||receipt.slug||'Basket')+'</h4><p>'+esc(sol(receipt.amountSol))+' paper SOL allocated · '+esc(stamp(receipt.quoteAsOf))+'. Quotes only; no swaps were sent.</p>'+basketLegsHtml(receipt.legs)+'</div>';
  }
  function basketFailureMessage(error){
    const code=error?.code||'',provider=code.replace(/^vault_/,'basket_');
    if(provider==='basket_quotes_unconfigured')return 'Live quotes are unavailable on this demo right now. No paper SOL was debited. Try another option or come back later.';
    if(['basket_quote_budget','basket_quote_rate_limited','paper_provider_rate_limit','paper_rate_limit'].includes(provider))return 'Live quote requests are busy. Wait a minute, then retry the same paper amount. No paper SOL was debited.';
    if(['basket_provider_timeout','basket_quote_expired','paper_quote_expired'].includes(provider))return 'Fresh quotes did not arrive in time. No paper SOL was debited. Retry the same amount.';
    if(['basket_provider_unavailable','basket_quote_unavailable','basket_quote_invalid','basket_mint_unavailable','basket_mint_mismatch','paper_quote_incomplete','paper_vault_quote_invalid'].includes(provider))return 'We could not verify every asset and quote. No paper SOL was debited. Try again later or choose another option.';
    if(['basket_unavailable','basket_allocation_incomplete','basket_allocation_unavailable','basket_identity_mismatch'].includes(provider))return 'This option cannot be verified for a paper purchase right now. No paper SOL was debited. Choose another option.';
    if(code==='paper_cash_unavailable')return 'There is not enough available paper SOL. Return to your paper balance to add more, or choose a smaller amount.';
    if(code==='paper_holdings_full')return 'This paper portfolio has reached its 40-holding limit. Existing holdings are still saved.';
    if(['basket_invalid','vault_invalid','invalid_paper_amount'].includes(code))return 'Enter a valid paper SOL amount within your available balance, then retry.';
    return 'We could not confirm the paper request. Retry the same amount to check it safely without making a second purchase.';
  }
  function createClient(options={}){
    const fetcher=options.fetch||globalThis.fetch.bind(globalThis),uuid=options.uuid||(()=>crypto.randomUUID());
    const pendingKey='worldsfair:paper-pending:v1',pendingLimit=32;
    const pending=new Map();let storage=null,storageReadable=false;
    try{
      storage=options.storage===undefined?globalThis.sessionStorage:options.storage;
      const saved=storage?.getItem(pendingKey);storageReadable=!!storage;
      if(saved){
        const entries=JSON.parse(saved);
        if(!Array.isArray(entries)||entries.length>pendingLimit)throw Error('Invalid pending metadata');
        for(const item of entries){
          if(!paperActions.includes(item?.action)||typeof item.requestId!=='string'||item.requestId.length>128||!item.payload||typeof item.payload!=='object')throw Error('Invalid pending request');
          const fingerprint=item.action+JSON.stringify(item.payload);
          if(fingerprint.length>4096)throw Error('Pending request is too large');
          pending.set(fingerprint,{action:item.action,payload:item.payload,requestId:item.requestId});
        }
      }
    }catch{storageReadable=false;}
    function persist(){
      if(!storageReadable)throw Error('This tab cannot save a safe paper retry ID. Enable session storage and reload before trying a paper move.');
      try{storage.setItem(pendingKey,JSON.stringify([...pending.values()]));}
      catch{throw Error('The paper retry ID could not be saved. No new paper request was sent.');}
    }
    // Only unresolved request metadata is stored in this tab. Balances and
    // history always come from the cookie-bound server account.
    let initialized=false,initializing=null,mutation=null;
    async function request(path,init={}){
      const response=await fetcher(path,{credentials:'same-origin',cache:'no-store',...init,signal:AbortSignal.timeout(['/api/paper/basket','/api/paper/refresh','/api/paper/deposit','/api/paper/roll'].includes(path)?90000:30000)});
      let data;try{data=await response.json();}catch{const error=Error('The paper response could not be read.');error.status=response.status;throw error;}
      if(!response.ok){const error=Error(data.error||'The paper action could not be saved.');error.status=response.status;error.code=data.code;throw error;}
      return data;
    }
    async function account(){
      if(initializing)return initializing;
      initializing=request('/api/paper/account').then(data=>{initialized=true;return data;}).finally(()=>{initializing=null;});
      return initializing;
    }
    async function write(action,payload){
      if(!paperActions.includes(action))throw Error('This paper action is unavailable.');
      if(mutation)throw Error('A paper action is already being saved.');
      const fingerprint=action+JSON.stringify(payload);
      if(fingerprint.length>4096)throw Error('This paper request is too large.');
      if(!pending.has(fingerprint)){
        if(pending.size>=pendingLimit)throw Error('Check an earlier pending paper request before starting another.');
        pending.set(fingerprint,{action,payload:JSON.parse(JSON.stringify(payload)),requestId:uuid()});
      }
      persist(); // Persist before dispatch; never evict an unresolved request.
      const requestId=pending.get(fingerprint).requestId;
      mutation=(async()=>{
        if(!initialized)await account();
        const result=await request('/api/paper/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,requestId})});
        pending.delete(fingerprint);try{persist();}catch{/* A retained ID is safe to replay; the server returns its receipt. */}return result;
      })();
      try{return await mutation;}catch(error){if(error.status>=400&&error.status<500&&definitivePaperRejections.has(error.code)){pending.delete(fingerprint);try{persist();}catch{}}throw error;}finally{mutation=null;}
    }
    return {account,write,history:cursor=>request('/api/paper/history'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),get pending(){return [...pending.values()].map(item=>({...item,payload:{...item.payload}}));},get busy(){return mutation!==null;}};
  }
  const api={createClient,previewProfit,performanceNet,rollEligible,mergeSnapshot,tokenUnits,basketLegsHtml,basketValuation,basketHoldingHtml,recoveryLabel,basketReceiptHtml,basketFailureMessage,ruleProblem,ruleSummary,ruleWithLabels,depositAvailable,vaultHoldingHtml,allocationSeries,allocationChartHtml,ratePublicationText};
  globalThis.WorldsFairPaper=api;
  if(typeof document==='undefined')return;
  const host=document.querySelector('#worldsfairPaperPot');if(!host)return;
  const client=createClient(),trades=new Map(),claimed=new Set(),basketMounts=new Map();
  document.addEventListener('worldsfair:devnet-ready',()=>globalThis.WorldsfairDevnet?.mount(host));
  let accountData=null,events=[],cursor=null,loading=false,dialog=null,returnFocus=null,ruleDirty=false,ruleSourcesBusy=false,yieldIdeas=[],ruleBaskets=[];
  const actionStatus=()=>host.querySelector('[data-paper-status]');
  const say=(message,error=false)=>{const node=actionStatus();if(node){node.textContent=message+(accountData?.persistence==='retrying'?' Backup saving is retrying; the paper ledger has accepted the move.':'');node.dataset.error=String(error);}};
  function eventHtml(event){
    const amount=finite(event.amountSol)?event.amountSol:finite(event.amountLamports)?event.amountLamports/1e9:null;
    const label=event.kind==='seed'?'Paper SOL added':event.kind==='roll'?event.ruleApplied?'Paper profit rule applied':'Paper profit transferred in':event.kind==='basket'?'Paper basket bought':event.kind==='deposit'?'Paper deposit saved':event.kind==='rule'?'Paper profit rule saved':event.kind==='refresh'?'Paper prices refreshed':'Paper balance move';
    return '<li><div><b>'+esc(label)+'</b><time>'+esc(stamp(event.at))+'</time></div><strong>'+esc(event.kind==='refresh'?'Price check':event.kind==='rule'?'Setting updated':(['basket','deposit'].includes(event.kind)?'−':'')+sol(amount))+'</strong>'+(event.pair||event.name?'<small>'+esc(event.pair||event.name)+'</small>':'')+(event.ruleApplied&&event.ruleAllocation?'<small>LP '+esc(sol(event.ruleAllocation.lpSol))+' · yield '+esc(sol(event.ruleAllocation.vaultSol))+' · basket '+esc(sol(event.ruleAllocation.basketSol))+'</small>':'')+(event.kind==='roll'?'<span data-paper-stamp="'+esc(JSON.stringify({kind:'pot-roll',eventId:event.id}))+'"></span>':'')+'</li>';
  }
  function renderPending(){
    const node=host.querySelector('[data-paper-pending]');if(!node)return;
    const pending=client.pending;node.hidden=!pending.length;
    node.innerHTML=pending.length?'<p>An earlier paper action needs checking. Retry it here without making the same move twice.</p>'+pending.map(item=>'<button type="button" class="text-button" data-paper-recover="'+esc(item.requestId)+'"'+(client.busy?' disabled':'')+'>Check paper '+esc(recoveryLabel(item))+'</button>').join(''):'';
  }
  function render(){
    if(!accountData)return;
    const account=accountData.account||{};
    host.querySelector('[data-paper-balance]').textContent=sol(account.balanceSol);
    host.querySelector('[data-paper-seeded]').textContent=sol(account.seededSol);
    host.querySelector('[data-paper-rolled]').textContent=sol(account.rolledProfitSol);
    host.querySelector('[data-paper-updated]').textContent=account.updatedAt?'Saved '+stamp(account.updatedAt):'Your paper portfolio is ready.';
    const holdings=account.holdings||[];
    const openHoldings=new Set([...host.querySelectorAll('[data-paper-holding][open]')].map(node=>node.dataset.paperHolding));
    host.querySelector('[data-paper-holdings]').innerHTML=holdings.length?holdings.map(holding=>holding.kind==='basket'?basketHoldingHtml(holding):holding.kind==='vault'?vaultHoldingHtml(holding):'<p class="note">Saved paper holding · '+esc(holding.name||holding.kind)+'</p>').join(''):'<p class="note">No paper holdings yet. Choose a basket or staking option to get started.</p>';
    for(const node of host.querySelectorAll('[data-paper-holding]'))if(openHoldings.has(node.dataset.paperHolding))node.open=true;
    host.querySelector('[data-paper-history]').innerHTML=events.length?events.map(eventHtml).join(''):'<li class="wf-paper-empty">No paper moves yet. Add paper SOL to try your first holding.</li>';
    globalThis.WorldsfairDevnet?.mount(host.querySelector('[data-paper-history]'));
    host.querySelector('[data-paper-more]').hidden=!cursor;
    host.querySelector('[data-paper-seed-submit]').disabled=client.busy;
    host.querySelector('[data-paper-overview]').innerHTML=allocationChartHtml(events);
    host.querySelector('[data-paper-allocation-detail]').hidden=allocationSeries(events).length===0;
    renderRule();
    renderPending();
    for(const node of basketMounts.keys()){if(node.isConnected)updateBasket(node);else basketMounts.delete(node);}
  }
  function accept(data,append=false){
    const previous={accountData,events,cursor},next=mergeSnapshot(previous,data,append);
    if(next===previous)return false;
    ({accountData,events,cursor}=next);render();return true;
  }
  function savedRule(){return accountData?.account?.profitRule||{enabled:false,lpPercent:50,vaultPercent:25,basketPercent:25,vaultId:null,basketSlug:null};}
  function ruleValue(){
    const form=host.querySelector('[data-paper-rule-form]'),fields=form.elements;
    return {enabled:fields.enabled.checked,lpPercent:Number(fields.lpPercent.value),vaultPercent:Number(fields.vaultPercent.value),basketPercent:Number(fields.basketPercent.value),vaultId:fields.vaultId.value||null,basketSlug:fields.basketSlug.value||null};
  }
  function ruleChoices(){
    const fields=host.querySelector('[data-paper-rule-form]').elements,current=ruleDirty?ruleValue():savedRule();
    const fill=(node,rows,value,placeholder)=>{
      node.innerHTML='<option value="">'+esc(placeholder)+'</option>'+rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join('')+(value&&!rows.some(row=>row.id===value)?'<option value="'+esc(value)+'">Saved choice · availability not verified</option>':'');node.value=value||'';
    };
    fill(fields.vaultId,yieldIdeas.filter(idea=>depositAvailable(idea)).map(idea=>({id:idea.id,name:idea.name+' · '+idea.asset+' · '+idea.rate.toFixed(2)+'% '+idea.rateType})),current.vaultId,'Choose Solana staking');
    fill(fields.basketSlug,ruleBaskets.map(basket=>({id:basket.slug,name:basket.name})),current.basketSlug,'Choose a basket');
  }
  function renderRule(){
    const form=host.querySelector('[data-paper-rule-form]');if(!form)return;
    const rule=savedRule();host.querySelector('[data-paper-rule-summary]').textContent=ruleSummary(ruleWithLabels(rule,yieldIdeas,ruleBaskets));
    if(!ruleDirty){for(const key of ['lpPercent','vaultPercent','basketPercent'])form.elements[key].value=rule[key];form.elements.enabled.checked=rule.enabled;ruleChoices();}
    form.querySelector('button[type="submit"]').disabled=client.busy||!accountData;
    const current=ruleValue();host.querySelector('[data-paper-rule-total]').textContent='Total '+(current.lpPercent+current.vaultPercent+current.basketPercent)+'% · '+(current.enabled?'applies to the whole profit on your next Roll':'rule is off');
  }
  async function loadRuleSources(){
    if(ruleSourcesBusy)return;ruleSourcesBusy=true;const status=host.querySelector('[data-paper-rule-status]');status.textContent='Reading available Solana destinations…';
    const read=async path=>{const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(25000)}),body=await response.json();if(!response.ok)throw Error(body.error||'Destinations could not be read.');return body;};
    const results=await Promise.allSettled([yieldIdeas.length?Promise.resolve({items:yieldIdeas}):read('/api/long-game'),ruleBaskets.length?Promise.resolve({baskets:ruleBaskets}):read('/api/cesto')]);
    if(results[0].status==='fulfilled')yieldIdeas=(results[0].value.items||[]).filter(idea=>idea.kind==='staking');
    if(results[1].status==='fulfilled')ruleBaskets=results[1].value.baskets||[];
    ruleChoices();renderRule();status.textContent=results.some(result=>result.status==='rejected')?'Some destinations could not be read. Reopen this setting to retry; saved choices are preserved.':'Destination availability and quotes are checked again when you roll profit.';ruleSourcesBusy=false;
  }
  api.setYieldIdeas=ideas=>{yieldIdeas=Array.isArray(ideas)?ideas.filter(idea=>idea.kind==='staking'):[];if(host.querySelector('[data-paper-rule-form]')){ruleChoices();renderRule();}};
  async function load(markHoldings=false){
    if(loading)return;loading=true;
    const button=host.querySelector('[data-paper-refresh]');button.disabled=true;say(accountData?'Refreshing your paper portfolio…':'Loading your paper balance…');
    try{accept(await client.account());if(markHoldings&&accountData?.account?.holdings?.length){say('Refreshing current prices for your paper holdings…');accept(await client.write('refresh',{}));}say('Your paper portfolio is up to date.');}
    catch(error){
      if(!accountData){
        for(const key of ['balance','seeded','rolled'])host.querySelector('[data-paper-'+key+']').textContent='Unavailable';
        host.querySelector('[data-paper-holdings]').innerHTML='<p class="note">Paper holdings could not be read. Refresh your paper portfolio to retry.</p>';
        host.querySelector('[data-paper-history]').innerHTML='<li class="wf-paper-empty">Paper history could not be read. Refresh your paper portfolio to retry.</li>';
        host.querySelector('[data-paper-overview]').innerHTML='<h3>Capital placed over time (SOL at entry)</h3><p class="note">Allocation history is unavailable. Refresh your paper portfolio to retry.</p>';
        host.querySelector('[data-paper-rule-summary]').textContent='The saved profit rule is unavailable. Refresh your paper portfolio to retry.';
      }
      say((accountData?'Showing the last paper balance. ':'')+error.message,true);
    }
    finally{loading=false;button.disabled=false;renderPending();}
  }
  host.setAttribute('aria-label','Your paper portfolio');
  host.innerHTML='<div class="wf-paper-start" tabindex="-1"><div class="section-heading"><div><span class="eyebrow">PAPER PRACTICE</span><h2>Your paper portfolio</h2></div><button type="button" class="outline" data-paper-refresh aria-label="Refresh paper balance">↻</button></div><p class="note">Try a holding with practice SOL. No real funds move.</p><div class="wf-paper-balances"><div><span>Available paper SOL</span><strong data-paper-balance>Loading…</strong></div></div><form class="wf-paper-seed" data-paper-seed><label>Amount to add · paper SOL<input name="amountSol" type="number" min="0.000000001" max="1000" step="any" inputmode="decimal" value="1" required></label><button type="submit" class="primary" data-paper-seed-submit disabled>Add paper SOL</button></form><p class="wf-paper-status" role="status" aria-live="polite" data-paper-status>Loading your paper balance…</p><div class="wf-paper-pending" data-paper-pending hidden></div></div><section class="wf-paper-choices" data-paper-choices><h3>Choose what to try</h3><button type="button" class="text-button wf-paper-return" data-paper-show-holdings>View my paper holdings ↓</button></section><div class="wf-paper-explore" data-paper-explore></div><section class="wf-paper-holdings" tabindex="-1"><h3>Your paper holdings</h3><div data-paper-holdings><p class="note">Reading paper holdings…</p></div></section><details class="wf-paper-account-details"><summary>Where this paper balance came from</summary><div class="wf-paper-balances"><div><span>Paper SOL added</span><b data-paper-seeded>Loading…</b></div><div><span>Paper profit transferred in</span><b data-paper-rolled>Loading…</b></div></div><p class="note">This browser has its own paper balance. Strategy profits come from a shared demo balance. Each closed position can fund one profit transfer across the whole demo.</p><p class="note" data-paper-updated></p></details><details class="wf-paper-journal"><summary>Paper activity</summary><ol data-paper-history><li>Reading saved paper moves…</li></ol><button type="button" class="text-button" data-paper-more hidden>Show older paper moves</button></details><details class="wf-paper-allocation-detail" data-paper-allocation-detail hidden><summary>Where paper SOL has been placed</summary><section class="wf-paper-overview" data-paper-overview><p class="note">Reading saved allocation records…</p></section></details><details class="wf-profit-rule" data-paper-rule><summary>How to split future paper profit</summary><p class="note" data-paper-rule-summary>Reading your saved rule…</p><form data-paper-rule-form><label class="wf-rule-enable"><input name="enabled" type="checkbox"> Apply a rule when I roll paper profit</label><p class="note">Choose a split for the whole verified profit when you transfer it. The LP share stays in shared demo strategies; other shares become your paper holdings. Your available balance is unchanged.</p><div class="wf-rule-grid"><label>Stays as LP capital · %<input name="lpPercent" type="number" min="0" max="100" step="1" value="50" required></label><label>Staking · %<input name="vaultPercent" type="number" min="0" max="100" step="1" value="25" required></label><label>Basket · %<input name="basketPercent" type="number" min="0" max="100" step="1" value="25" required></label></div><div class="wf-rule-destinations"><label for="wfProfitVault">Solana staking<select id="wfProfitVault" name="vaultId" aria-label="Solana staking"><option value="">Reading options…</option></select></label><label for="wfProfitBasket">Basket<select id="wfProfitBasket" name="basketSlug" aria-label="Basket"><option value="">Reading options…</option></select></label></div><p class="note" data-paper-rule-total>Total 100% · rule is off</p><button type="submit" class="outline" disabled>Save paper profit rule</button><p class="wf-paper-status" role="status" aria-live="polite" data-paper-rule-status></p></form></details>';
  document.dispatchEvent(new CustomEvent('worldsfair:paper-ready'));
  host.querySelector('[data-paper-refresh]').onclick=()=>load(true);
  host.querySelector('[data-paper-rule]').ontoggle=event=>{if(event.currentTarget.open)loadRuleSources();};
  host.querySelector('[data-paper-rule-form]').oninput=()=>{ruleDirty=true;renderRule();};
  host.querySelector('[data-paper-rule-form]').onsubmit=async event=>{
    event.preventDefault();if(client.busy)return;
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=host.querySelector('[data-paper-rule-status]');
    if(!form.reportValidity())return;
    const value=ruleValue(),problem=ruleProblem(value);if(problem){status.textContent=problem;status.dataset.error='true';return;}
    button.disabled=true;status.textContent='Saving your paper profit rule…';status.dataset.error='false';
    try{const data=await client.write('rule',value);ruleDirty=false;accept(data);status.textContent=value.enabled?'Paper profit rule saved. It applies when you next tap Roll profit.':'Paper profit rule is off. The next Roll uses your chosen slider share.';document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));}
    catch(error){status.textContent=error.message+' Retry the same settings to check this request safely.';status.dataset.error='true';}
    finally{button.disabled=false;renderPending();}
  };
  host.querySelector('[data-paper-seed]').onsubmit=async event=>{
    event.preventDefault();if(client.busy)return;
    const form=event.currentTarget,input=form.elements.amountSol,button=host.querySelector('[data-paper-seed-submit]');
    if(!form.reportValidity())return;
    button.disabled=true;button.textContent='Saving paper SOL…';say('Adding paper SOL…');
    try{accept(await client.write('seed',{amountSol:input.value}));say('Paper SOL added. Added SOL is kept separate from profit.');document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));}
    catch(error){say(error.message+' Retry the same amount to safely check this request.',true);}
    finally{button.disabled=false;button.textContent='Add paper SOL';renderPending();}
  };
  host.querySelector('[data-paper-more]').onclick=async()=>{
    const button=host.querySelector('[data-paper-more]');if(button.disabled)return;button.disabled=true;
    try{accept(await client.history(cursor),true);}catch(error){say(error.message,true);}finally{button.disabled=false;}
  };
  function updateBasket(node){
    const mounted=basketMounts.get(node);if(!mounted)return;
    const balance=accountData?.account?.balanceSol,form=node.querySelector('form'),input=form.elements.amountSol,submit=form.querySelector('button');
    node.querySelector('[data-basket-pot-balance]').textContent=finite(balance)?sol(balance)+' available':'Loading your paper balance…';
    input.max=String(finite(balance)?Math.min(1000,Math.max(0,balance)):1000);
    submit.disabled=mounted.busy||client.busy||!mounted.basket.allocation?.complete||!finite(balance)||balance<=0;
    const status=node.querySelector('[data-paper-basket-status]');
    if(!mounted.busy&&mounted.basket.allocation?.complete&&finite(balance)&&balance<=0&&!node.querySelector('[data-paper-basket-receipt]').textContent){status.textContent='Add paper SOL to your balance to try this basket.';status.dataset.emptyBalance='true';}
    else if(status.dataset.emptyBalance==='true'&&balance>0){status.textContent='';delete status.dataset.emptyBalance;}
  }
  api.mountBasket=(node,basket)=>{
    if(!node)return;
    basketMounts.set(node,{basket,busy:false});
    node.innerHTML='<span class="eyebrow">PAPER PRACTICE</span><h3>Paper-buy this basket</h3><p class="note">Your SOL is split by the verified allocation. Every traded leg needs a Jupiter quote; SOL allocations stay as paper SOL. No swaps or signing.</p><p class="note" data-basket-pot-balance>Loading your paper balance…</p><form class="wf-paper-basket-form"><label>Paper SOL to allocate<input name="amountSol" type="number" min="0.000000001" max="1000" step="any" inputmode="decimal" value="0.1" required></label><button type="submit" class="primary" disabled>Paper-buy this basket</button></form><p class="wf-paper-status" role="status" aria-live="polite" data-paper-basket-status>'+(basket.allocation?.complete?'': 'The complete allocation is unavailable; this basket cannot be paper-bought.')+'</p><div data-paper-basket-receipt></div>';
    updateBasket(node);
    const form=node.querySelector('form');
    form.onsubmit=async event=>{
      event.preventDefault();const mounted=basketMounts.get(node),submit=form.querySelector('button'),status=node.querySelector('[data-paper-basket-status]');
      if(!mounted||mounted.busy||client.busy||submit.disabled||!form.reportValidity())return;
      mounted.busy=true;submit.disabled=true;submit.textContent='Checking paper purchase…';status.dataset.error='false';delete status.dataset.emptyBalance;status.textContent='Getting live quotes for this basket. This may take a minute. Keep this tab open; there is no need to submit again.';
      try{
        const data=await client.write('basket',{slug:basket.slug,amountSol:form.elements.amountSol.value});accept(data);
        if(node.isConnected){node.querySelector('[data-paper-basket-receipt]').innerHTML=basketReceiptHtml(data.receipt);status.textContent='Paper basket saved. Refresh your paper portfolio to value it at current prices.';}
        say('Paper basket saved. Refresh your paper portfolio for current token prices.');
        document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));
      }catch(error){if(node.isConnected){status.textContent=basketFailureMessage(error);status.dataset.error='true';}}
      finally{mounted.busy=false;if(node.isConnected){submit.textContent='Paper-buy this basket';updateBasket(node);}renderPending();}
    };
  };
  api.openDeposit=async idea=>{
    if(idea?.kind!=='staking'||dialog||client.busy)return;
    returnFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='wf-paper-dialog';dialog.setAttribute('aria-labelledby','wfPaperDepositTitle');const currentDialog=dialog;
    dialog.innerHTML='<div class="wf-paper-dialog-heading"><div><span class="eyebrow">PAPER '+(idea.kind==='staking'?'STAKING':'SAVED YIELD')+'</span><h2 id="wfPaperDepositTitle">Paper-deposit</h2></div><button type="button" data-paper-cancel aria-label="Close paper deposit">×</button></div><p><b>'+esc(idea.name)+'</b> · underlying '+esc(idea.asset)+'</p><div class="wf-deposit-exposure"><div><b>What you’re exposed to</b><p>'+esc(idea.risk||'Exposure details unavailable.')+'</p></div><div><b>Getting out</b><p>'+esc(idea.exit||'Withdrawal details unavailable.')+'</p></div></div><p class="note">Quoted '+esc(finite(idea.rate)?idea.rate.toFixed(2)+'% '+idea.rateType:'rate unavailable')+' in '+esc(idea.asset)+' · read '+esc(stamp(idea.readAt))+' · '+esc(ratePublicationText(idea.rateAsOf))+'.</p><p class="note"><b>estimate at quoted rate</b> · linear, without compounding. '+(idea.kind==='staking'&&idea.asset==='SOL'?'Principal is underlying paper SOL, not invented liquid staking token units.':'SOL is converted to underlying paper asset units only after a dated Jupiter quote.')+' No real deposit or signing.</p><form class="wf-paper-deposit-form"><label>Paper SOL to deposit<input name="amountSol" type="number" min="0.000000001" max="1000" step="any" inputmode="decimal" value="0.1" required></label><p class="note" data-paper-deposit-balance>Reading your paper balance…</p><button type="submit" class="primary" data-paper-confirm disabled>Paper-deposit</button><p role="status" aria-live="polite" data-paper-deposit-status>Reading your paper balance…</p></form>';
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-paper-cancel]').focus();dialog.querySelector('[data-paper-cancel]').onclick=closeRoll;dialog.addEventListener('cancel',event=>{event.preventDefault();closeRoll();});
    const form=dialog.querySelector('form'),submit=form.querySelector('button'),status=dialog.querySelector('[data-paper-deposit-status]');
    try{accept(await client.account());if(dialog!==currentDialog)return;const balance=accountData?.account?.balanceSol;form.elements.amountSol.max=String(finite(balance)?Math.min(1000,balance):0);dialog.querySelector('[data-paper-deposit-balance]').textContent=finite(balance)?sol(balance)+' available':'Paper balance unavailable';submit.disabled=!depositAvailable(idea)||!finite(balance)||balance<=0;status.textContent=!depositAvailable(idea)?'Fresh rate and supported deposit-asset evidence are needed. Refresh these ideas before depositing.':balance<=0?'Add paper SOL to your portfolio before depositing.':'Ready for a paper estimate. Rate and asset evidence are checked again before saving.';}
    catch(error){if(dialog===currentDialog)status.textContent=error.message;}
    form.onsubmit=async event=>{
      event.preventDefault();if(submit.disabled||client.busy||!form.reportValidity())return;submit.disabled=true;submit.textContent='Preparing paper deposit…';status.textContent='Checking the rate and any required asset quote…';
      try{const data=await client.write('deposit',{ideaId:idea.id,amountSol:form.elements.amountSol.value});accept(data);const balance=accountData?.account?.balanceSol;currentDialog.querySelector('[data-paper-deposit-balance]').textContent=finite(balance)?sol(balance)+' available':'Paper balance unavailable';status.textContent='Paper deposit saved. Estimated earnings are shown in underlying '+idea.asset+' units in your paper holdings.';submit.textContent='Paper deposit saved';form.elements.amountSol.disabled=true;say('Paper deposit saved at the quoted rate. Refresh your portfolio to update the estimate.');document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));}
      catch(error){status.textContent=basketFailureMessage(error);submit.disabled=false;submit.textContent='Retry paper deposit';}
      finally{renderPending();}
    };
  };
  function closeRoll(){
    if(!dialog||client.busy)return;
    dialog.close();dialog.remove();dialog=null;
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  async function openRoll(trade){
    if(dialog||client.busy||!rollEligible(trade))return;
    returnFocus=document.activeElement;
    dialog=document.createElement('dialog');dialog.className='wf-paper-dialog';dialog.setAttribute('aria-labelledby','wfPaperRollTitle');
    const currentDialog=dialog;
    dialog.innerHTML='<div class="wf-paper-dialog-heading"><h2 id="wfPaperRollTitle">Move paper profit to your portfolio</h2><button type="button" data-paper-cancel aria-label="Close paper profit transfer">×</button></div><p role="status">Reading your saved paper profit rule…</p>';
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-paper-cancel]').focus();dialog.querySelector('[data-paper-cancel]').onclick=closeRoll;dialog.addEventListener('cancel',event=>{event.preventDefault();closeRoll();});
    try{accept(await client.account());}catch(error){if(dialog===currentDialog)dialog.querySelector('[role="status"]').textContent=error.message+' Close and retry to read the saved rule.';return;}
    if(dialog!==currentDialog)return;
    const rule=ruleWithLabels(savedRule(),yieldIdeas,ruleBaskets),enabled=rule.enabled===true;
    dialog.innerHTML='<div class="wf-paper-dialog-heading"><div><span class="eyebrow">PAPER PROFIT ONLY</span><h2 id="wfPaperRollTitle">Move paper profit to your portfolio</h2></div><button type="button" data-paper-cancel aria-label="Close paper profit transfer">×</button></div><p><b>'+esc(trade.pair||'Closed demo position')+'</b> · closed '+esc(stamp(trade.closedAt))+'</p><p class="note">'+(enabled?'Your saved rule divides the whole verified profit into shared LP capital and paper holdings. The available paper balance is unchanged.':'This moves a share of the verified profit from the shared demo balance to your paper portfolio. The rest stays as LP capital.')+' A close can be rolled once across the demo.</p>'+(enabled?'<div class="wf-rule-roll"><b>Profit rule on</b><p>'+esc(ruleSummary(rule))+'</p><small>Percentages apply to the whole profit; the slider is disabled.</small></div>':'')+'<form data-paper-roll-form><label class="wf-paper-slider">'+(enabled?'Whole profit':'Share of profit')+' · <output data-paper-percent>'+(enabled?'100':'50')+'%</output><input name="percent" type="range" min="1" max="100" step="1" value="'+(enabled?'100':'50')+'"'+(enabled?' disabled':'')+'></label><div class="wf-paper-roll-preview"><span>'+(enabled?'Whole paper profit allocated by the rule':'Estimated paper SOL to your pot')+'</span><strong data-paper-preview></strong></div><p class="note">Only verified profit can be moved, once per closed demo position. '+(enabled?'Every required deposit and basket quote must succeed before the rule is applied.':'')+'</p><button type="submit" class="primary" data-paper-confirm>'+(enabled?'Apply paper profit rule':'Roll paper profit')+'</button><p role="status" aria-live="polite" data-paper-roll-status></p></form>';
    dialog.querySelector('[data-paper-cancel]').focus();
    const form=dialog.querySelector('form'),slider=form.elements.percent,submit=dialog.querySelector('[data-paper-confirm]');
    const preview=()=>{dialog.querySelector('[data-paper-percent]').textContent=slider.value+'%';const amount=previewProfit(trade.pnlSol,Number(slider.value));dialog.querySelector('[data-paper-preview]').textContent=sol(amount);submit.disabled=amount===null||amount<=0||client.busy||!!ruleProblem(rule);};
    slider.oninput=preview;preview();if(ruleProblem(rule))dialog.querySelector('[data-paper-roll-status]').textContent=ruleProblem(rule)+' Update or turn off the saved profit rule before transferring.';
    dialog.querySelector('[data-paper-cancel]').onclick=closeRoll;
    form.onsubmit=async event=>{
      event.preventDefault();if(client.busy||submit.disabled)return;
      const status=dialog.querySelector('[data-paper-roll-status]');submit.disabled=true;slider.disabled=true;submit.textContent='Saving paper transfer…';status.textContent='Checking the funded close and saving once…';
      try{
        const data=await client.write('roll',{source:'fleet',id:trade.id,closedAt:trade.closedAt,...(enabled?{}:{percent:Number(slider.value)})});accept(data);
        const key=JSON.stringify([trade.id,trade.closedAt]);claimed.add(key);trade.profitRoll={...trade.profitRoll,claimed:true,eligible:false};
        document.querySelectorAll('[data-paper-roll]').forEach(button=>{if(button.dataset.paperRoll===key){button.disabled=true;button.textContent='Paper profit already transferred';}});
        status.textContent=data.receipt?.ruleApplied?'Paper profit rule applied. The LP share stayed in the shared demo strategies; staking and basket shares are saved as paper holdings.':'Paper profit saved in your paper portfolio.';submit.textContent='Paper profit rolled';
        document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));
      }catch(error){
        if(error.status===409){status.textContent=error.message+' Demo results are refreshing; close this panel to review the latest availability.';submit.disabled=true;submit.textContent='Paper transfer unavailable';document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));load();}
        else{status.textContent=error.message+' Retry to safely check the same paper transfer.';submit.disabled=false;slider.disabled=enabled;submit.textContent='Retry paper transfer';}
      }finally{renderPending();}
    };
  }
  api.rollButton=trade=>{
    const key=JSON.stringify([trade.id,trade.closedAt]);trades.set(key,trade);
    if(claimed.has(key)||trade.profitRoll?.claimed)return '<span class="wf-paper-roll-done">Paper profit already transferred</span>';
    if(!rollEligible(trade))return '';
    return '<button type="button" class="text-button wf-paper-roll-button" data-paper-roll="'+esc(key)+'">Move paper profit to your portfolio <small>Paper</small></button>';
  };
  api.refresh=()=>load(true);
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-paper-recover]');if(!button||client.busy)return;
    const item=client.pending.find(item=>item.requestId===button.dataset.paperRecover);if(!item)return;
    button.disabled=true;say('Checking the earlier paper request…');
    try{const data=await client.write(item.action,item.payload);accept(data);if(data.receipt?.kind==='basket')for(const [node,mounted]of basketMounts)if(node.isConnected&&mounted.basket.slug===data.receipt.slug)node.querySelector('[data-paper-basket-receipt]').innerHTML=basketReceiptHtml(data.receipt);say('The earlier paper request is confirmed. Its original request ID prevented a second move.');document.dispatchEvent(new CustomEvent('worldsfair:paper-change'));}
    catch(error){say(error.message,true);}finally{renderPending();}
  });
  document.addEventListener('click',event=>{
    const destination=event.target.closest('[data-paper-home]')?'.wf-paper-start':event.target.closest('[data-paper-show-holdings]')?'.wf-paper-holdings':null;
    if(destination){
      const section=host.querySelector(destination);
      section.scrollIntoView({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
      section.focus({preventScroll:true});return;
    }
    const button=event.target.closest('[data-paper-roll]');if(button&&!button.disabled)openRoll(trades.get(button.dataset.paperRoll));
  });
  setInterval(()=>{if(!document.hidden&&accountData?.account?.holdings?.length)render();},60000);
  load();
})();
