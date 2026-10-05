import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/worldsfair-paper.js';

const {createClient,tokenUnits,basketLegsHtml,basketValuation,basketHoldingHtml,basketReceiptHtml,basketFailureMessage,recoveryLabel}=globalThis.WorldsFairPaper;
const now=Date.UTC(2026,9,5,14),iso=delta=>new Date(now+delta).toISOString();
const leg={mint:'mint',symbol:'TOKEN',weight:40,inputLamports:400000000,unitsRaw:'1234567890123456789',decimals:9,priceImpactFraction:.0125,quoteAsOf:iso(0),contextSlot:123};
assert.equal(tokenUnits(leg),'1234567890.123456789','Quoted raw units do not pass through an imprecise Number conversion');
assert.equal(tokenUnits({...leg,unitsRaw:'1000000000'}),'1');assert.equal(tokenUnits({...leg,unitsRaw:'0'}),'0');
assert.equal(tokenUnits({...leg,unitsRaw:'1',decimals:18}),'0.000000000000000001');
for(const altered of [{unitsRaw:'bad'},{unitsRaw:123},{decimals:19},{decimals:-1},{decimals:1.5}])assert.equal(tokenUnits({...leg,...altered}),'Units unavailable');
const legsHtml=basketLegsHtml([leg]);assert.match(legsHtml,/40\.00%/);assert.match(legsHtml,/0\.4000 SOL allocated/);assert.match(legsHtml,/impact 1\.25%/);assert.match(legsHtml,/Quoted/);
assert.doesNotMatch(basketLegsHtml([{...leg,unitsRaw:'bad',priceImpactFraction:NaN}]),/NaN|undefined|Unknown/);
assert.match(basketLegsHtml([{...leg,symbol:'<img onerror="bad">'}]),/&lt;img/);assert.doesNotMatch(basketLegsHtml([{...leg,symbol:'<img onerror="bad">'}]),/<img/);

const complete={holdingId:'paper-holding',status:'complete',asOf:iso(0),readAt:iso(0),solUsd:100,valueSol:1.1,valueUsd:110,costSol:1,holdSolValueUsd:100,pnlSol:.1,vsHoldSolUsd:10,absolutePnlUsd:-10,legs:[]};
const holding={id:'paper-holding',paper:true,kind:'basket',name:'A basket',slug:'a-basket',costSol:1,openedAt:iso(-3600000),legs:[leg],valuation:complete};
assert.equal(basketValuation(holding,now).current,complete);
const markup=basketHoldingHtml(holding,now);
assert.match(markup,/1\.1000 SOL/);assert.match(markup,/\$110\.00/);assert.match(markup,/\+0\.1000 SOL/);assert.match(markup,/\+\$10\.00/);assert.match(markup,/-\$10\.00/);
assert.match(markup,/Change vs keeping SOL/);assert.match(markup,/Change since purchase · USD/,'Relative performance and absolute dollar result have distinct labels');
assert.equal(basketValuation(holding,now+300000).current,complete);
const expired=basketValuation(holding,now+300001);assert.equal(expired.current,null);assert.equal(expired.saved,complete);
const expiredHtml=basketHoldingHtml(holding,now+300001);assert.match(expiredHtml,/Valuation unavailable/);assert.match(expiredHtml,/Last complete reading/);assert.match(expiredHtml,/Saved values are not current prices/);
for(const status of ['partial','unavailable']){
  const unavailable={...holding,valuation:{...complete,status,valueSol:null,valueUsd:null,pnlSol:null,vsHoldSolUsd:null,absolutePnlUsd:null},lastCompleteValuation:complete};
  assert.equal(basketValuation(unavailable,now).current,null);assert.equal(basketValuation(unavailable,now).saved,complete);
  const html=basketHoldingHtml(unavailable,now);assert.match(html,/Current value · SOL<\/span><b>Unavailable/);assert.doesNotMatch(html,/Current value · SOL<\/span><b>0/);
}
assert.equal(basketValuation({...holding,valuation:{...complete,asOf:iso(1)}},now).current,null,'Future timestamps do not establish a current reading');
assert.equal(basketValuation({...holding,valuation:{...complete,asOf:null,readAt:iso(0)}},now).current,null,'Fetch time is not a price timestamp');
assert.equal(basketValuation({...holding,valuation:{...complete,valueSol:NaN}},now).current,null);
const noEntryUsd=basketHoldingHtml({...holding,valuation:{...complete,absolutePnlUsd:null}},now);assert.match(noEntryUsd,/Change since purchase · USD<\/span><b>Unavailable/);assert.match(noEntryUsd,/Current value · USD<\/span><b>\$110/);
const zero=basketHoldingHtml({...holding,valuation:{...complete,pnlSol:0,vsHoldSolUsd:0,absolutePnlUsd:0}},now);assert.match(zero,/0\.0000 SOL/);assert.match(zero,/Change since purchase · USD<\/span><b>\$0\.00/);

const receipt={kind:'basket',holdingId:holding.id,slug:holding.slug,name:holding.name,amountSol:1,legs:[leg],quoteAsOf:iso(0)};
assert.match(basketReceiptHtml(receipt),/PAPER QUOTE RECEIPT/);assert.match(basketReceiptHtml(receipt),/Quotes only; no swaps were sent/);
assert.equal(basketReceiptHtml({kind:'seed'}),'');
assert.equal(basketFailureMessage(Object.assign(Error('Paper-buy needs an API key on this demo. No Paper SOL was moved.'),{code:'basket_quotes_unconfigured'})),'Live quotes are unavailable on this demo right now. No paper SOL was debited. Try another option or come back later.','Credential errors have one clear explanation without repeating the provider message');
for(const code of ['basket_provider_timeout','vault_provider_timeout','basket_quote_expired'])assert.match(basketFailureMessage({code,message:'Technical upstream timeout'}),/Fresh quotes did not arrive in time.*No paper SOL was debited.*Retry the same amount/);
for(const code of ['basket_quote_rate_limited','vault_quote_budget'])assert.match(basketFailureMessage({code}),/Wait a minute, then retry/);
assert.match(basketFailureMessage({code:'paper_cash_unavailable'}),/Return to your paper balance/);
assert.doesNotMatch(basketFailureMessage(Error('RPC stack trace or API key not configured')),/RPC|API key|No paper SOL was debited/,'Unknown provider text cannot prove whether a purchase was saved');
assert.doesNotMatch(basketFailureMessage(Error('Connection lost')),/No paper SOL was debited/,'An ambiguous response must not claim a known balance outcome');
assert.match(basketFailureMessage(Error('Connection lost')),/Retry the same amount.*without making a second purchase/);
assert.match(recoveryLabel({action:'basket',payload:{slug:'a-basket',amountSol:'1'}}),/basket purchase · 1 SOL/);
assert.equal(recoveryLabel({action:'refresh',payload:{}}),'holding price refresh');

const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)},calls=[],processed=new Map();let nextId=0,balance=2,lost=true;
const snapshot=()=>({paper:true,account:{balanceSol:balance,revision:processed.size,holdings:processed.size?[holding]:[]},history:[],cursor:null,persistence:'saved'});
const fetcher=async(path,init)=>{
  calls.push({path,init});assert.equal(init.credentials,'same-origin');
  if(path==='/api/paper/account')return Response.json(snapshot());
  const body=JSON.parse(init.body);
  if(path==='/api/paper/basket'){
    assert.deepEqual(Object.keys(body).sort(),['slug','amountSol','requestId'].sort(),'The browser never supplies allocation weights, units or quote prices');
    if(!processed.has(body.requestId)){balance-=Number(body.amountSol);processed.set(body.requestId,{...snapshot(),receipt});}
    if(lost){lost=false;throw Error('Receipt response lost');}return Response.json(processed.get(body.requestId));
  }
  if(path==='/api/paper/refresh'){assert.deepEqual(Object.keys(body),['requestId']);return Response.json({...snapshot(),receipt:{kind:'refresh',amountSol:0}});}
  throw Error('Unexpected route');
};
const client=()=>createClient({storage,fetch:fetcher,uuid:()=>`basket-${++nextId}`});
await assert.rejects(client().write('basket',{slug:'a-basket',amountSol:'1'}),/response lost/);assert.equal(balance,1);assert.equal(calls[0].path,'/api/paper/account');
const confirmed=await client().write('basket',{slug:'a-basket',amountSol:'1'});assert.equal(balance,1);assert.equal(nextId,1,'Basket retry survives a reload without another debit');assert.equal(confirmed.receipt.kind,'basket');
await client().write('refresh',{});assert.equal(calls.at(-1).path,'/api/paper/refresh');assert.equal(balance,1,'Price refresh never changes available paper SOL');

const [paper,baskets]=await Promise.all(['public/worldsfair-paper.js','public/baskets.js'].map(path=>readFile(path,'utf8')));
assert.match(baskets,/WorldsFairPaper\?\.mountBasket/);assert.match(baskets,/data-paper-basket/);
assert.match(paper,/markHoldings&&accountData\?\.account\?\.holdings\?\.length/,'Only an explicit pot refresh with holdings triggers price refresh');
assert.match(paper,/Paper-buy this basket/);assert.match(paper,/Every traded leg needs a Jupiter quote; SOL allocations stay as paper SOL/);
assert.doesNotMatch(paper,/\/api\/(?:solana|evm|tx|paybox)\//);
console.log('PASS: paper basket quote receipt, exact units/impact, missing and stale valuations, SOL benchmark vs absolute USD P&L, persisted retry, and quote-only route contract');
