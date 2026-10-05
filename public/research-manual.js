import {checkManualPosition,DEFAULT_POSITION_RULES} from './research-position.js';
import {inventoryAtPrice} from './research-range.js';

const byId=id=>document.getElementById(id);
const esc=v=>String(typeof v==='number'&&!Number.isFinite(v)?'Unavailable':v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const measured=v=>finite(v)&&v>=0?v:null;
const amount=v=>finite(v)?v.toLocaleString('en-GB',{maximumFractionDigits:6}):'Unavailable';
const sol=v=>finite(v)?amount(v)+' SOL':'Unavailable';
const price=v=>finite(v)&&v>0?v.toPrecision(10):'Unavailable';
const pct=v=>finite(v)?(v*100).toFixed(2)+'%':'Unavailable';
const usd=v=>finite(v)?new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v):'Unavailable';
const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-GB'):'Unavailable';
const fresh=at=>{const t=Date.parse(at);return Number.isFinite(t)&&t<=Date.now()+60000&&Date.now()-t<=600000;};
const number=(form,key)=>{const v=new FormData(form).get(key);return v==null||String(v).trim()===''?null:Number(v);};
const localDate=date=>{const pad=n=>String(n).padStart(2,'0');return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());};
const storageKey=row=>'lp:research:manual:v1:'+String(row.pool?.id||row.pool?.address||'unknown');
let activeRow=null;

/** Bounds-only scenario; no actual position/bin balances are read. */
export function estimateManualInventory({lowerPriceSol,upperPriceSol,entryPriceSol,sizeSol,binStep,shape='Spot',oneSided=true,currentPriceSol}){
 for(const [name,value]of Object.entries({lowerPriceSol,upperPriceSol,entryPriceSol,sizeSol,binStep,currentPriceSol}))if(!finite(value)||value<=0)throw Error(name+' is required and must be positive.');
 if(upperPriceSol<lowerPriceSol)throw Error('Upper price must be at least the lower price. Equal bounds describe one bin.');
 if(!['Spot','BidAsk','Curve'].includes(shape))throw Error('Choose Spot, Bid-Ask or Curve.');
 if(typeof oneSided!=='boolean'||binStep>10000)throw Error('Check sides and bin step.');
 if(oneSided&&upperPriceSol>=entryPriceSol)throw Error('SOL-only split estimate needs the whole entered range below its entry price. Actual active-bin fills are unavailable.');
 if(!oneSided&&(entryPriceSol<lowerPriceSol||entryPriceSol>upperPriceSol))throw Error('Two-sided split estimate needs entry price inside the entered range. Actual initial asset allocation is unavailable.');
 const ratio=1+binStep/10000,logRatio=Math.log1p(binStep/10000);
 const rawSteps=Math.log(upperPriceSol/lowerPriceSol)/logRatio;
 const intervals=Math.ceil(rawSteps-1e-10*Math.max(1,Math.abs(rawSteps)));
 const binCount=intervals+1;
 if(!Number.isSafeInteger(binCount)||binCount>1400)throw Error('The inventory approximation supports at most 1,400 bins; the entered-range rules can still be checked.');
 const bottom=upperPriceSol/ratio**intervals;
 const mean=oneSided?intervals:Math.max(0,Math.min(intervals,Math.log(entryPriceSol/bottom)/logRatio));
 const variance=Math.max((intervals/4)**2,1);
 const prices=Array.from({length:binCount},(_,i)=>upperPriceSol/ratio**(intervals-i));
 const weights=prices.map((_,i)=>shape==='Spot'?1:Math.exp((shape==='BidAsk'?1:-1)*(i-mean)**2/(2*variance)));
 const allocation=prices.map(p=>Math.abs(p-entryPriceSol)<=entryPriceSol*1e-10?.5:p<entryPriceSol?1:0);
 const solTotal=weights.reduce((s,w,i)=>s+w*(oneSided?1:allocation[i]),0);
 const tokenTotal=oneSided?0:weights.reduce((s,w,i)=>s+w*(1-allocation[i]),0);
 const totalWeight=weights.reduce((a,b)=>a+b,0);
 if(solTotal<=0||(!oneSided&&tokenTotal<=0))throw Error('The entered range cannot support the chosen initial mix in this approximation.');
 const bins=prices.map((p,i)=>({priceSol:p,weight:weights[i]/totalWeight,
  sol:sizeSol*(oneSided?1:.5)*weights[i]*(oneSided?1:allocation[i])/solTotal,
  token:oneSided?0:sizeSol*.5/entryPriceSol*weights[i]*(1-allocation[i])/tokenTotal}));
 const inventory=inventoryAtPrice(bins,currentPriceSol);
 return {...inventory,bins,binCount,modelLowerPriceSol:bottom,modelUpperPriceSol:upperPriceSol,
  initialSol:oneSided?sizeSol:sizeSol*.5,initialTokens:oneSided?0:sizeSol*.5/entryPriceSol,
  solValueFraction:inventory.valueSol>0?inventory.sol/inventory.valueSol:null,
  note:'Bounds-only '+shape+' allocation scenario, funded at the entered entry price. '+(oneSided?'Initial deposit assumed all SOL.':'Initial deposit assumed half SOL and half paired token by SOL value, distributed separately across each side.')+' Grid uses the entered upper bound and rounds the lower bound outward by up to one bin. Actual bin IDs, deposit weights and partial active-bin fills are unavailable. Value excludes fees, taxes and exit/network costs.'};
}

function loadSaved(row){
 let text;try{text=localStorage.getItem(storageKey(row));}catch{return {value:null,note:'Device storage is unavailable. This check still works; inputs will not persist.'};}
 if(!text)return {value:null,note:'Inputs stay on this device after a valid check.'};
 try{const saved=JSON.parse(text);return saved?.version===1&&saved?.values&&typeof saved.values==='object'?{value:saved.values,note:'Loaded this pool’s inputs from this device.'}:{value:null,note:'Saved inputs were unreadable; enter the position again.'};}
 catch{return {value:null,note:'Saved inputs were unreadable; enter the position again.'};}
}
function saveInputs(row,form){
 const values={};for(const key of ['lower','upper','size','entryAt','entryPrice','entryTvl','shape','sided','minVolume','resetVolume','tvlFall','maxHold'])values[key]=String(new FormData(form).get(key)??'');
 try{localStorage.setItem(storageKey(row),JSON.stringify({version:1,values,savedAt:new Date().toISOString()}));return 'Saved only on this device for '+String(row.pool?.pair||'this pool')+'.';}
 catch{return 'Device storage is unavailable. Results are usable, but these inputs were not saved.';}
}
function field(label,name,value,tip='',attributes=''){
 return '<label title="'+esc(tip)+'">'+esc(label)+'<input name="'+name+'" type="'+(name==='entryAt'?'datetime-local':'number')+'" '+(name==='entryAt'?'':'step="any"')+' value="'+esc(value??'')+'" '+attributes+'></label>';
}
export function renderManual(row){
 const host=byId('researchManualCheck');if(!host)return;
 activeRow=row;
 const saved=loadSaved(row),v=saved.value||{},p=finite(row.priceSol)&&row.priceSol>0?row.priceSol:null;
 const orientation=row.pool?.base?.address==='So11111111111111111111111111111111111111112'?'<p class="sub">SOL is the base token here. Convert Meteora prices before entering: lower SOL/token = 1 ÷ Meteora top; upper SOL/token = 1 ÷ Meteora bottom.</p>':'';
 host.innerHTML='<div class="detail-panel"><div class="panel-heading"><h3>Check a real position</h3><span class="sub">Data as of '+esc(date(row.pool?.fetchedAt))+'</span></div><p>Enter the position yourself. All bounds use SOL per paired token, including pools whose Meteora quote is inverted. Exact balances and claimed fees are not read.</p><form id="researchManualForm" class="tools-form">'+field('Lower bound · SOL per token','lower',v.lower??(p===null?'':p*.8),'Your actual lower price, converted to SOL per paired token.','required min="0"')+field('Upper bound · SOL per token','upper',v.upper??(p===null?'':p*.99),'Your actual upper price; rules use these entered bounds directly.','required min="0"')+field('Position size · SOL','size',v.size??.5,'SOL initially deposited; excludes separately paid network costs and refundable rent.','required min="0.000001" max="10000"')+field('Entry time · device local time','entryAt',v.entryAt??localDate(new Date()),'Local time on this device; converted to an ISO timestamp for the holding rule.','required')+field('Entry price · SOL per token','entryPrice',v.entryPrice??'','The actual entry reference is needed for the inventory scenario. Leaving it blank keeps split unavailable.','min="0"')+field('Entry TVL · USD','entryTvl',v.entryTvl??'','TVL recorded when you entered; current TVL is not substituted for missing entry evidence.','min="0"')+'<label title="Approximate your deposit shape for the split scenario. Actual weights are unavailable.">Deposit shape<select name="shape">'+['Spot','BidAsk','Curve'].map(s=>'<option value="'+s+'"'+((v.shape??'Spot')===s?' selected':'')+'>'+({Spot:'Spot',BidAsk:'Bid-Ask',Curve:'Curve'})[s]+'</option>').join('')+'</select></label><label title="Inventory is an assumption. Two-sided uses a half-SOL, half-token entry by SOL value.">Entry mix<select name="sided"><option value="one"'+((v.sided??'one')==='one'?' selected':'')+'>SOL only</option><option value="two"'+(v.sided==='two'?' selected':'')+'>Two sided · assumed 50/50</option></select></label>'+field('Withdraw below 4h volume · USD','minVolume',v.minVolume??DEFAULT_POSITION_RULES.minVolume4h,'Observed zero volume is a valid reading and triggers this rule.','required min="0"')+field('Reset above range if 4h volume ≥ USD','resetVolume',v.resetVolume??DEFAULT_POSITION_RULES.resetVolume4h,'Healthy activity needed to suggest a reset once above the range.','required min="0"')+field('Withdraw if entry TVL falls · %','tvlFall',v.tvlFall??DEFAULT_POSITION_RULES.maxTvlFall*100,'A fall from your entered TVL reading, not the latest pool high.','required min="0.001" max="100"')+field('Maximum hold · hours','maxHold',v.maxHold??DEFAULT_POSITION_RULES.maxHoldHours,'Clock deadline remains checkable even if market data is missing.','required min="0.001"')+'<button type="submit">Check position</button></form><button type="button" id="researchManualForget">Forget saved inputs</button><p id="researchManualStorage" class="sub">'+esc(saved.note)+'</p><div id="researchManualResult" aria-live="polite"><p>Check your entered position to see which rule applies.</p></div></div>';
 if(orientation)host.innerHTML=host.innerHTML.replace('<form id="researchManualForm"',orientation+'<form id="researchManualForm"');
 const form=byId('researchManualForm');form.onsubmit=e=>{e.preventDefault();calculateManual(row,form);};
 const forget=byId("researchManualForget");if(forget)forget.onclick=()=>{try{localStorage.removeItem(storageKey(row));renderManual(row);}catch{byId("researchManualStorage").textContent="Device storage could not be cleared.";}};
 if(saved.value)calculateManual(row,form);
}

export function calculateManual(row,form){
 const result=byId('researchManualResult');
 try{
  const data=new FormData(form),localTime=String(data.get('entryAt')??''),entered=new Date(localTime);
  if(!localTime||!Number.isFinite(entered.getTime()))throw Error('Enter a valid local entry time.');
  const p={lowerPriceSol:number(form,'lower'),upperPriceSol:number(form,'upper'),sizeSol:number(form,'size'),entryAt:entered.toISOString(),entryPriceSol:number(form,'entryPrice'),entryTvlUsd:number(form,'entryTvl')};
  for(const key of ['entryPriceSol','entryTvlUsd'])if(p[key]!==null&&(!finite(p[key])||p[key]<=0))throw Error('Entry '+(key==='entryPriceSol'?'price':'TVL')+' must be positive, or blank if unavailable.');
  const rules={minVolume4h:number(form,'minVolume'),resetVolume4h:number(form,'resetVolume'),maxTvlFall:number(form,'tvlFall')===null?null:number(form,'tvlFall')/100,maxHoldHours:number(form,'maxHold')};
  const poolFresh=fresh(row.pool?.fetchedAt),volumeFresh=fresh(row.trend?.asOf),feesFresh=fresh(row.feeRates?.asOf)&&poolFresh;
  const o={at:row.pool?.fetchedAt??'',priceSol:poolFresh&&finite(row.priceSol)&&row.priceSol>0?row.priceSol:null,tvlUsd:poolFresh?measured(row.pool?.tvlUsd):null,volume4h:volumeFresh?measured(row.trend?.volume4h):null,feeRateHourly:feesFresh?measured(row.feeRates?.h1):null};
  const checked=checkManualPosition(p,o,rules,Date.now());
  let split=null,splitError='';
  if(!poolFresh)splitError='A fresh current price is needed for the split scenario.';
  else try{split=estimateManualInventory({...p,binStep:row.config?.binStep,shape:String(data.get('shape')),oneSided:data.get('sided')==='one',currentPriceSol:o.priceSol});}catch(error){splitError=error.message;}
  const tone=checked.call==='WITHDRAW'?'negative':checked.call==='KEEP'?'positive':'unknown';
  const ruleRows=checked.tests.map((t,i)=>{const observed=i===3||poolFresh&&(i===0?finite(o.priceSol):i===1?finite(o.volume4h):finite(checked.tvlChange));return '<tr><td>'+esc(t.rule)+'</td><td>'+(t.triggered?'Triggered':observed?'Not triggered':'Unavailable')+'</td><td>'+(i===0?price(t.value):i===1?usd(t.value):i===2?pct(t.value):amount(t.value)+'h')+'</td><td>'+(i===0?price(t.threshold):i===1?usd(t.threshold):i===2?pct(t.threshold):amount(t.threshold)+'h')+'</td></tr>';}).join('');
  result.innerHTML='<div class="detail-metrics"><div title="Rules applied to manual inputs and dated current readings; no action is executed."><small>Rules-based check</small><strong class="'+tone+'">'+checked.call+'</strong></div><div title="Current source price relative to the exact range you entered."><small>Price vs entered range</small><strong>'+esc(checked.rangeState==='unknown'?'Not verified':checked.rangeState)+'</strong><span class="sub">'+price(o.priceSol)+' SOL / token</span></div><div title="Time elapsed since your entered local entry time."><small>Held</small><strong>'+amount(checked.holdHours)+'h</strong></div></div><p><b>'+esc(checked.reason)+'</b></p><p>Entered range '+price(p.lowerPriceSol)+' → '+price(p.upperPriceSol)+' SOL per token. Source as of '+esc(date(checked.asOf))+'.</p><div class="detail-metrics"><div title="Current pool TVL; original entry TVL is manually entered."><small>Current TVL</small><strong>'+usd(o.tvlUsd)+'</strong><span class="sub">From entry '+pct(checked.tvlChange)+'</span></div><div title="Actual dated four-hour pool volume; a stale reading stays unavailable."><small>Current 4h volume</small><strong>'+usd(o.volume4h)+'</strong><span class="sub">As of '+esc(date(row.trend?.asOf))+'</span></div><div title="Whole holding time multiplied by the current 1h fee/TVL pace. Actual fees and time in range are unavailable."><small>Fees · current-pace scenario</small><strong>'+sol(checked.estimatedFeesSol)+'</strong><span class="sub">Actual position fees: unavailable</span></div></div><p class="sub">'+esc(checked.feeNote)+' Fee source as of '+esc(date(row.feeRates?.asOf))+'.</p>'+(split?'<div class="detail-metrics"><div><small>SOL · allocation scenario</small><strong>'+sol(split.sol)+'</strong></div><div><small>Paired tokens · allocation scenario</small><strong>'+amount(split.tokens)+'</strong></div><div title="Scenario inventory value before fees, taxes and exit costs; not a liquidation quote."><small>Inventory value · before costs</small><strong>'+sol(split.valueSol)+'</strong></div></div><p class="sub">'+esc(split.note)+' '+split.binCount+' estimated bins cover '+price(split.modelLowerPriceSol)+' → '+price(split.modelUpperPriceSol)+' SOL per token. Actual SOL/token balance: unavailable.</p>':'<p class="unknown">Inventory split unavailable: '+esc(splitError)+' Actual SOL/token balance is unavailable.</p>')+'<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Exit rule</th><th>Status</th><th>Observed value</th><th>Trigger</th></tr></thead><tbody>'+ruleRows+'</tbody></table></div>'+(checked.missing.length?'<p class="unknown">Checks unavailable: '+esc(checked.missing.join(' '))+'</p>':'')+'<p class="sub">'+esc(checked.splitNote)+' KEEP is a result of these chosen rules, not a guarantee about the pool. RESET and WITHDRAW are research prompts; no transaction is prepared.</p>';
  const storage=byId('researchManualStorage');if(storage)storage.textContent=saveInputs(row,form);
  return {position:p,observation:o,rules,checked,split,splitError};
 }catch(error){result.innerHTML='<p class="negative">'+esc(error.message)+'</p>';return null;}
}

document.addEventListener('lp:research-pool',e=>{if(e.detail)renderManual(e.detail);});
if(window.LPResearch?.current?.())renderManual(window.LPResearch.current());
