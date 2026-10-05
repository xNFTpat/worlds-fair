import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'lp-discovery-'));
for(const [name,entry] of [['filters','src/discovery.ts'],['source','src/sources/meteora.ts'],['sanity','src/sanity.ts']]) await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:join(dir,name+'.mjs')});
const {selectPools}=await import(pathToFileURL(join(dir,'filters.mjs')));
await import(pathToFileURL(join(process.cwd(),'public/discovery.js')));
const {evidence}=globalThis.LPDiscovery;
const base={id:'small',chain:'solana',pair:'USDC/SOL',address:'smallAddress',base:{address:'catMint',symbol:'USDC',name:'Upside Down Cat'},quote:{address:'SOL',symbol:'SOL'},tags:[],tvlUsd:1200,volume24hUsd:7000,ageHours:30,fetchedAt:new Date().toISOString(),activity:{fees30m:5,fees1h:100,fees4h:160,volume1h:5000}};
const pools=[base,{...base,id:'large',tvlUsd:25000},{...base,id:'unknown',tvlUsd:null}];
assert.deepEqual(selectPools(pools,new URLSearchParams('maxTvl=25000')).pools.map(x=>x.id),['small']);
assert.deepEqual(selectPools(pools,new URLSearchParams('minTvl=25000')).pools.map(x=>x.id),['large']);
assert.equal(selectPools(pools,new URLSearchParams()).pools.length,3);
assert.equal(selectPools(pools,new URLSearchParams('maxAgeH=24')).pools.length,0);
assert.throws(()=>selectPools(pools,new URLSearchParams('minTvl=NaN')));
assert.throws(()=>selectPools(pools,new URLSearchParams('minTvl=100&maxTvl=10')));
const crowded=Array.from({length:350},(_,i)=>({...base,id:'other'+i,address:'other'+i,base:{address:'differentMint',symbol:'OTHER'},pair:'OTHER/SOL'}));
assert.equal(selectPools([...crowded,base],new URLSearchParams('search=catMint')).pools[0].id,'small');
assert.equal(selectPools([...crowded,base],new URLSearchParams('search=Upside+Down')).matched,1);
const ranked=selectPools([base,{...base,id:'busy',activity:{fees1h:200}}],new URLSearchParams('sort=fees1hUsd'));
assert.equal(ranked.pools[0].id,'busy');
const alphaInputs={minTvl:'0',maxTvl:'0',minVol:'0',sort:'feeApr'};
const alphaDepth=globalThis.LPDiscovery.queryFilters('alpha','depth',alphaInputs);
const alphaDegen=globalThis.LPDiscovery.queryFilters('alpha','degen',alphaInputs);
const alphaFixtures=[
  {...base,id:'empty-high-apr',address:'empty-high-apr',tvlUsd:99,volume24hUsd:1e7,feeApr:1e9},
  {...base,id:'below-degen',tvlUsd:2499.99,volume24hUsd:1e7,feeApr:1e8},
  {...base,id:'degen-boundary',tvlUsd:2500,volume24hUsd:25000,feeApr:100},
  {...base,id:'thin-high-volume',tvlUsd:10000,volume24hUsd:3.3e6,feeApr:200},
  {...base,id:'depth-boundary',tvlUsd:25000,volume24hUsd:50000,feeApr:10},
  {...base,id:'depth-active',tvlUsd:100000,volume24hUsd:1e6,feeApr:20},
  {...base,id:'depth-low-volume',tvlUsd:100000,volume24hUsd:49999,feeApr:1000},
  {...base,id:'degen-low-volume',tvlUsd:10000,volume24hUsd:24999,feeApr:1000},
  {...base,id:'unknown-liquidity',tvlUsd:null,volume24hUsd:1e7,feeApr:1e8},
];
assert.deepEqual(selectPools(alphaFixtures,new URLSearchParams(alphaDepth)).pools.map(p=>p.id),['depth-active','depth-boundary']);
assert.deepEqual(selectPools(alphaFixtures,new URLSearchParams(alphaDegen)).pools.map(p=>p.id),['thin-high-volume','degen-boundary']);
assert.equal(alphaInputs.minTvl,'0','Alpha presets do not mutate another view’s filters');
assert.deepEqual(globalThis.LPDiscovery.queryFilters('top','degen',alphaInputs),alphaInputs,'Discover keeps its separate filters');
assert.deepEqual(globalThis.LPDiscovery.queryFilters('alpha','unknown',alphaInputs),alphaDepth,'unknown modes fall back to More depth');
assert.equal(selectPools(alphaFixtures,new URLSearchParams({...alphaDegen,search:'empty-high-apr'})).matched,0,'search cannot bypass Alpha liquidity floors');
const cooling=evidence(base);
assert.match(cooling.signal,/Cooling/); assert.equal(cooling.hourlyRatio,5);
assert.match(cooling.reason,/previous 30 minutes: \$95/);
assert.equal(evidence({...base,ageHours:.5}).shortRatio,null);
assert.equal(evidence({...base,ageHours:2}).hourlyRatio,null);
assert.equal(evidence({...base,ageHours:null}).shortRatio,null);
assert.equal(evidence({...base,activity:undefined}).shortRatio,null);
assert.match(evidence({...base,activity:{fees1h:0,fees30m:0,fees4h:0}}).signal,/No fees/);
assert.equal(evidence({...base,fetchedAt:'invalid'}).stale,true);
const original=globalThis.fetch;
const respond=(d,status=200)=>new Response(JSON.stringify(d),{status});
try {
  const {fetchMeteora}=await import(pathToFileURL(join(dir,'source.mjs')));
  const raw={address:'tiny',name:'Cat-SOL',token_x:{address:'catMint',symbol:'CAT',name:'Cat',price:2},token_y:{address:'SOL',symbol:'SOL',price:100},tvl:1200,is_blacklisted:false,created_at:Date.now()-5*36e5,fees:{'1h':100,'30m':5,'4h':160,'24h':200},volume:{'1h':5000,'24h':7000},current_price:.02};
  const urls=[];
  globalThis.fetch=async url=>{urls.push(new URL(url));return respond({data:[raw]});};
  const result=await fetchMeteora();
  assert.equal(result.pools.length,1);assert.equal(result.partial,false);
  assert.equal(result.pools[0].tvlUsd,1200);assert.equal(result.pools[0].priceUsd,2,'quote price must not masquerade as USD');
  assert.equal(result.pools[0].activity.fees1h,100);
  assert.ok(urls.some(u=>u.searchParams.get('filter_by').includes('tvl<25000')));
  assert.ok(urls.every(u=>!u.searchParams.get('filter_by').includes('tvl>=5000')));
  globalThis.fetch=async url=>new URL(url).searchParams.get('sort_by')==='volume_24h:desc'?respond({},400):respond({data:[raw]});
  assert.equal((await fetchMeteora()).partial,true);
  globalThis.fetch=async()=>respond({},400);
  await assert.rejects(()=>fetchMeteora());
  const {sanityCheck}=await import(pathToFileURL(join(dir,'sanity.mjs')));
  let mintRead='';
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes('jup.ag'))return respond({outAmount:String(url).includes('inputMint=So111')?'5000000000':'49500000'});
    mintRead=JSON.parse(opts.body).params[0];return respond({result:{value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{info:{decimals:9,mintAuthority:null,freezeAuthority:null}}}}}});
  };
  const checked=await sanityCheck({...base,quote:{address:'So11111111111111111111111111111111111111112',symbol:'SOL'}},'','https://rpc');
  assert.equal(mintRead,'catMint');assert.ok(checked.findings.some(f=>f.detail.includes('→ 5 USDC')),'use actual nine-decimal mint, not a guess');
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes('jup.ag'))return respond({outAmount:String(url).includes('inputMint=So111')?'5000000000':'49000000'});
    const method=JSON.parse(opts.body).method;
    if(method==='getEpochInfo')return respond({result:{epoch:10}});
    return respond({result:{value:{owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:{parsed:{info:{decimals:9,extensions:[{extension:'transferFeeConfig',state:{olderTransferFee:{epoch:1,transferFeeBasisPoints:100},newerTransferFee:{epoch:11,transferFeeBasisPoints:300}}}]}}}}}});
  };
  const futureFee=await sanityCheck(base,'','https://rpc');
  assert.match(futureFee.findings.find(f=>f.title==='Token-2022 transfer fee').detail,/1.00%/,'future fee schedule must not be reported as current');
  globalThis.fetch=async url=>String(url).includes('jup.ag')?respond({},429):respond({result:{value:null}});
  const missing=await sanityCheck(base,'','https://rpc');
  assert.equal(missing.verdict,'info');assert.ok(!missing.findings.some(f=>f.severity==='ok'));
} finally {globalThis.fetch=original;}
console.log('PASS: tiny pools, honest filters, catalogue-wide address search, fee bursts, young pools, source coverage and quote uncertainty');
assert.equal(globalThis.LPDiscovery.queryFilters('alpha','depth',{search:'42JnUXw5N9ftMkbM1tMzJw2tnzqs1U9RxWBk5LzNv4gD'}).minTvl,0,'exact pool address lookup is not hidden by size presets');
assert.equal(globalThis.LPDiscovery.queryFilters('alpha','depth',{search:'LEVERCAT'}).minTvl,25000,'ordinary text search retains its visible preset');
