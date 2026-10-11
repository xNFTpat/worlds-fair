import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const dir = await mkdtemp(join(tmpdir(), 'still-cesto-preview-'));
const originalFetch = globalThis.fetch, originalNow = Date.now;
const now = Date.parse('2026-10-11T14:45:00Z');
Date.now = () => now;
const tokens = [
  {mint:'So11111111111111111111111111111111111111112', symbol:'SOL', name:'Solana'},
  {mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol:'USDC', name:'USD Coin'},
];
const catalogue = ['alpha', 'beta', 'third'].map(slug => ({slug, name:`Synthetic ${slug}`}));
const detail = slug => ({slug, definition:{bucket:{mode:'parallel', nodes:tokens.map((token, index) => ({nodeType:'swap.token', amount:{percentage:index ? 40 : 60}, parameters:{toToken:token.mint}}))}}});
function fixture(patches={}) {
  const saved = new Map([
    ['cesto:v1:/tokens', {data:tokens, readAt:now-5000}],
    ...catalogue.map(basket => ['cesto:v1:/products/'+basket.slug, {data:detail(basket.slug), readAt:now-1000}]),
  ]);
  for (const [path, value] of Object.entries(patches)) {
    if (value === null) saved.delete('cesto:v1:'+path);
    else saved.set('cesto:v1:'+path, value);
  }
  const reads=[], writes=[], requests=[];
  globalThis.fetch = async (url, options) => {requests.push({url, options}); throw Error('Synthetic provider unavailable; no network performed');};
  return {
    reads, writes, requests,
    kv:{
      async get(key, type) {assert.equal(type,'json'); reads.push(key); return structuredClone(saved.get(key) ?? null);},
      async put(key, value, options) {writes.push({key,value,options}); saved.set(key,JSON.parse(value));},
    },
  };
}

try {
  await build({entryPoints:['src/cesto.ts'], outfile:join(dir,'cesto.mjs'), bundle:true, platform:'node', format:'esm'});
  const {cestoPreviews} = await import(join(dir,'cesto.mjs'));

  const empty=fixture(); assert.deepEqual(await cestoPreviews(empty.kv,[]),[]);
  assert.equal(empty.reads.length,0); assert.equal(empty.requests.length,0,'No catalogue means no provider requests');

  const fresh=fixture(), previews=await cestoPreviews(fresh.kv,catalogue);
  assert.deepEqual(previews.map(row=>row.slug),['alpha','beta'],'Only two catalogue baskets are previewed');
  assert.equal(fresh.requests.length,0,'Fresh observed cache is enough; no chart, quote or network request');
  assert.equal(fresh.writes.length,0);
  assert.ok(fresh.reads.every(path=>!path.includes('graph')&&!path.includes('third')));
  for (const preview of previews) {
    assert.equal(preview.name,`Synthetic ${preview.slug}`);
    assert.equal(preview.asOf,new Date(now-5000).toISOString(),'Label with the oldest required read');
    assert.equal(preview.allocation.complete,true);
    assert.deepEqual(preview.allocation.rows.map(row=>[row.mint,row.symbol,row.weight]), tokens.map((token,index)=>[token.mint,token.symbol,index?40:60]));
  }

  for (const [label, patches] of [
    ['missing basket detail', {'/products/alpha':null}],
    ['stale basket detail', {'/products/alpha':{data:detail('alpha'),readAt:now-300001}}],
    ['foreign basket slug', {'/products/alpha':{data:detail('other-basket'),readAt:now-1000}}],
    ['region-unavailable basket', {'/products/alpha':{data:{...detail('alpha'),geoStatus:{canView:false}},readAt:now-1000}}],
    ['future basket detail', {'/products/alpha':{data:detail('alpha'),readAt:now+60000}}],
  ]) {
    const env=fixture(patches), result=await cestoPreviews(env.kv,catalogue);
    assert.equal(result[0].slug,'alpha',label+' preserves the catalogue identity');
    assert.equal(result[0].asOf,null,label+' cannot label missing evidence as current');
    assert.deepEqual(result[0].allocation,{rows:[],complete:false},label+' must not show a known allocation');
    assert.equal(result[1].allocation.complete,true,label+' does not blank a different valid basket');
  }

  for (const [label, value] of [
    ['missing token metadata',null],
    ['stale token metadata',{data:tokens,readAt:now-300001}],
    ['future token metadata',{data:tokens,readAt:now+60000}],
    ['unreadable token metadata',{data:{unexpected:'shape'},readAt:now-1000}],
  ]) {
    const env=fixture({'/tokens':value}), result=await cestoPreviews(env.kv,catalogue);
    assert.ok(result.every(row=>row.asOf===null&&!row.allocation.complete&&row.allocation.rows.length===0),label+' cannot become guessed symbols or allocations');
  }

  for (const broken of [
    {...detail('alpha'),definition:{bucket:{mode:'sequential',nodes:detail('alpha').definition.bucket.nodes}}},
    {...detail('alpha'),definition:{bucket:{mode:'parallel',nodes:[{nodeType:'swap.token',amount:{percentage:75},parameters:{toToken:tokens[0].mint}}]}}},
  ]) {
    const result=await cestoPreviews(fixture({'/products/alpha':{data:broken,readAt:now-1000}}).kv,catalogue);
    assert.equal(result[0].allocation.complete,false,'Uncomparable or incomplete weights cannot present as a complete allocation');
  }
  console.log('Still Cesto previews: bounded two-basket reads, exact identities, real dated weights, and missing/stale/future/foreign evidence fail-closed passed.');
} finally {
  globalThis.fetch=originalFetch; Date.now=originalNow;
  await rm(dir,{recursive:true,force:true});
}
