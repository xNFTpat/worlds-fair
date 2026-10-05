import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/main-pools.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-05T10:00:00Z'),iso=ms=>new Date(ms).toISOString();
const context={Intl,Date,URLSearchParams};
vm.runInNewContext(source.replace(/^import .*?;\n/,'').replace(/\bexport /g,'')+'\nthis.ui={renderDiscoveryCards,freshnessKey};',context);
const {renderDiscoveryCards:render,freshnessKey}=context.ui;
const row={pool:{id:'solana:test',pair:'TEST / SOL',ageHours:24,tvlUsd:50000,fetchedAt:iso(now)},feeRates:{h1:.5,h4:.4,h24:.001,asOf:iso(now)},trend:{volume24h:12000,asOf:iso(now)}};
const visible=html=>html.replace(/<[^>]*>/g,' ');
let html=render([row],1,'best',now);
assert.match(html,/class="mp-discovery-cards"/);
assert.equal((html.match(/data-main-pool=/g)||[]).length,1,'one primary pool action per overview card');
assert.match(html,/Open pre-flight/);
assert.match(html,/<dd>2.4%<\/dd>/,'daily display restores reported 24h fraction from hourly h24');
assert.doesNotMatch(html,/1h window|4h window|Net\/h|APR|mp-positive|mp-negative|Pass|Fail|Caution/,'overview cannot imply a pre-flight verdict or show parallel quant panels');
assert.match(html,/Past pool activity, before costs/);
assert.match(html,/Needs a cost check/);
assert.match(html,/Read 5 Oct/,'source date includes a day, not only a clock time');
assert.match(html,/Pool 24.0h old/);
for(const ageHours of [0,1,23.999]){
 html=render([{...row,pool:{...row.pool,ageHours}}],1,'best',now);
 assert.match(html,/New pool/);assert.match(html,/Not yet a full day/);assert.doesNotMatch(html,/2.4%/,'a partial day is never annualised or presented as a measured full day');
}
for(const value of [null,undefined,NaN,Infinity,-1]){
 html=render([{...row,feeRates:{h1:.5,h4:.4,h24:value,asOf:iso(now)}}],1,'best',now);
 assert.match(html,/24h history pending/);assert.doesNotMatch(html,/2.4%|1200%|960%|NaN|Infinity/,'missing 24h fees must not be extrapolated from shorter windows');
}
html=render([{...row,feeRates:{...row.feeRates,h24:0},pool:{...row.pool,tvlUsd:0},trend:{...row.trend,volume24h:0}}],1,'best',now);
assert.match(html,/<dd>0%<\/dd>/);assert.equal((html.match(/<dd>(?:US)?\$0(?:\.0+)?<\/dd>/g)||[]).length,2,'observed zero money remains a real zero');
html=render([row],1,'best',now+600001);
assert.match(html,/Saved fees \/ day/);assert.match(html,/Saved liquidity/);assert.match(html,/Saved 24h traded/);assert.match(html,/Read 5 Oct/,'older readings retain their original dates');
assert.notEqual(freshnessKey({...row,pool:{...row.pool,fetchedAt:iso(now-700000)},feeRates:{...row.feeRates,asOf:iso(now-700000)}},1,'best',now),freshnessKey({...row,pool:{...row.pool,fetchedAt:iso(now-700000)},feeRates:{...row.feeRates,asOf:iso(now-700000)}},1,'best',now+600001),'trading-date expiry also rerenders labels');
html=render([{pool:{id:'none',pair:'NO DATA',ageHours:-1,tvlUsd:null},feeRates:{},trend:{}}],1,'best',now);
assert.match(html,/Pool age not verified/);assert.match(html,/Pool source date not verified/);assert.doesNotMatch(visible(html),/NaN|Infinity|Unavailable|\$0|0%/,'missing values stay distinct from measured zero without a giant unavailable headline');
html=render([{...row,pool:{...row.pool,fetchedAt:null},feeRates:{...row.feeRates,asOf:null},trend:{...row.trend,asOf:null}}],1,'best',now);
assert.match(html,/Fee date not verified/);assert.match(html,/Trading date not verified/);
html=render([{...row,pool:{...row.pool,id:'x" onclick="bad',pair:'<img src=x onerror=evil()>"'}}],1,'best',now);
assert.doesNotMatch(html,/<img| onclick="bad/);assert.match(html,/&lt;img/);assert.match(html,/&quot;/);
const form=source.match(/<form class="mp-filters"[^]*?<\/form>/)?.[0];
assert(form);assert(form.indexOf('name="search"')<form.indexOf('<details class="mp-advanced-filters"'));
assert.doesNotMatch(form,/<details[^>]*\sopen(?:[\s>])/,'advanced controls are closed by default');
for(const name of ['size','mode','sort','minTvl','minVolume4h','maxAge','hideFlagged'])assert(form.indexOf('name="'+name+'"')>form.indexOf('<details class="mp-advanced-filters"'),'existing '+name+' filter stays inside advanced controls');
console.log('Discovery cards passed: measured 24h fees, partial/missing/zero data, dated stale states, neutral cost copy, single CTA, source escaping and collapsed filters.');
