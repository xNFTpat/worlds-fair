import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, sep} from 'node:path';
import {runInNewContext} from 'node:vm';
import * as assets from '../public/still-assets.js';
import {STILL_CREATORS} from '../public/still-creators.js';

const publicRoot=resolve('public');
let staticBytes=0;
async function checkStaticAsset(record) {
  const src=record.src ?? record.image;
  assert.match(src,/^\/(?:tokens|partners|creators)\/[A-Za-z0-9_.-]+\.(?:svg|png|jpg|webp)$/,'Rendered assets must have local static paths');
  const path=resolve(publicRoot,'.'+src);
  assert.ok(path.startsWith(publicRoot+sep));
  const bytes=await readFile(path);
  // Preserve the original optional image bytes; loading is deferred below.
  assert.ok(bytes.length>0&&bytes.length<2*1024*1024,'An original static icon must be nonempty and bounded');
  staticBytes+=bytes.length;
  assert.equal(bytes.length,record.bytes,src+' matches its provenance length');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,src+' matches its provenance hash');
  assert.ok(Number.isFinite(Date.parse(record.retrievedAt)),'Every asset has a retrieval date');
  if(src.endsWith('.svg')) {
    const svg=bytes.toString('utf8');
    assert.match(svg,/<svg\b/i);
    assert.doesNotMatch(svg,/<script\b|<foreignObject\b|\bon[a-z]+\s*=/i,'Static SVG icons contain no active content');
    assert.doesNotMatch(svg,/(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)/i,'SVG icons cannot load remote resources');
  }
}

const provenance=JSON.parse(await readFile('public/partners/asset-provenance.json','utf8'));
assert.equal(assets.ASSET_NOTICE,'Logos belong to their owners. Still is not affiliated.');
assert.deepEqual(Object.keys(assets.PARTNER_ASSETS).sort(),['backyard','cesto','meteora']);
for (const [id,record] of Object.entries(assets.PARTNER_ASSETS)) {
  assert.equal(assets.partnerAsset(id),record);
  assert.equal(provenance.partners[id].src,record.src);
  await checkStaticAsset(record);
  if(record.wordmark) await checkStaticAsset(record.wordmark);
}
assert.ok(Object.keys(assets.TOKEN_ASSETS).length>0);
for (const [mint,record] of Object.entries(assets.TOKEN_ASSETS)) {
  assert.equal(record.mint,mint,'Each token image is keyed by its exact mint, never by a shared ticker');
  assert.equal(assets.tokenAsset(mint),record);
  assert.equal(provenance.tokens[mint].sha256,record.sha256);
  await checkStaticAsset(record);
}
for(const key of [null,undefined,{},42,'SOL','USDC','unknown','__proto__','constructor','toString']) {
  assert.equal(assets.tokenAsset(key),null,'Unknown or prototype token keys cannot borrow a known logo');
  assert.equal(assets.partnerAsset(key),null);
}
for(const mint of Object.keys(provenance.missing||{})) assert.equal(assets.tokenAsset(mint),null,'Unavailable source image stays a neutral fallback');

const creatorProvenance=JSON.parse(await readFile('public/creators/provenance.json','utf8'));
const identities={molusol:'molu',razzaer:'Razzaer',Eyyyys:'Eys',Jaypee_Sol:'Jaypee',VladimirKovacs:'vladimir'};
assert.deepEqual(Object.keys(STILL_CREATORS),Object.keys(identities));
for (const [handle,person] of Object.entries(STILL_CREATORS)) {
  assert.equal(person.displayName,identities[handle]);
  assert.equal(person.handle,handle);
  assert.equal(person.profileUrl,'https://x.com/'+handle);
  assert.match(person.initials,/^[A-Z]{1,2}$/);
  const evidence=creatorProvenance.find(row=>row.handle===handle);
  assert.equal(evidence.displayName,person.displayName);
  assert.equal(evidence.image,person.image);
  assert.match(evidence.imageSource,/^https:\/\/pbs\.twimg\.com\/profile_images\//);
  await checkStaticAsset(evidence);
}
assert.ok(staticBytes<2.5*1024*1024,'All original partner, token and creator assets stay below 2.5MiB combined');

const source=await readFile('public/still-demo.js','utf8');
const helperSource=source.split("if (typeof document !== 'undefined') {")[0].replace(/^import .*;$/gm,'').replace(/^export /gm,'');
function helpers(fixtureAssets=assets,fixtureCreators=STILL_CREATORS) {
  return runInNewContext(helperSource+'\nvisualAssets=fixtureAssets;creatorAssets=fixtureCreators;({tokenIcon,pairIcons,partnerLogo,creatorIdentity});',{fixtureAssets,fixtureCreators,Intl});
}
const ui=helpers();
const localImagesOnly=html=>{
  for(const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) assert.match(match[1],/^\/(?:creators|tokens|partners)\//,'UI renders cached bytes, never attribution/source URLs');
  for(const match of html.matchAll(/<img\b[^>]*>/g)) assert.match(match[0],/loading="lazy"/,'Optional creator, partner and token images load only when needed');
};
for(const [handle,person] of Object.entries(STILL_CREATORS)) {
  const html=ui.creatorIdentity(handle);
  assert.ok(html.includes(`<strong>${person.displayName}</strong>`));
  assert.ok(html.includes(`<small>@${handle}</small>`));
  assert.ok(html.includes(`href="${person.profileUrl}"`));
  assert.match(html,/class="creator-avatar"[^>]*width="40" height="40"/);
  assert.ok(html.includes('Inspired by public posts. Not endorsed.'));
  assert.ok(html.includes('Request removal'));
  assert.ok(!html.includes('<details'),'Creator guardrails are visible without expanding a disclosure');
  localImagesOnly(html);
}
for(const mint of Object.keys(assets.TOKEN_ASSETS)) localImagesOnly(ui.tokenIcon(mint));
for(const id of Object.keys(assets.PARTNER_ASSETS)) localImagesOnly(ui.partnerLogo(id));
assert.match(ui.tokenIcon('SOL'),/token-unknown/);
assert.doesNotMatch(ui.tokenIcon('SOL'),/<img/);
const unloaded=helpers(null,null);
assert.match(unloaded.creatorIdentity('molusol'),/creator-initials/);
assert.match(unloaded.creatorIdentity('molusol'),/Profile picture unavailable/);
assert.ok(unloaded.creatorIdentity('molusol').includes('Inspired by public posts. Not endorsed.'));
assert.match(unloaded.tokenIcon('anything'),/token-unknown/);
assert.match(unloaded.partnerLogo('meteora'),/Partner logo unavailable/);
assert.doesNotMatch(ui.creatorIdentity('<img onerror="run()">'),/<img onerror/,'Unknown handles are escaped');

// Exercise the actual delegated error listener. A broken image keeps a useful,
// accessible fallback in place; it never retries a remote avatar or token URL.
const errorRegistration=source.split('\n').find(line=>line.startsWith("document.addEventListener('error',"));
assert.ok(errorRegistration,'Cached images need an error fallback');
let onError;
const document={
  addEventListener(type,callback,capture){assert.equal(type,'error');assert.equal(capture,true,'Image errors do not bubble');onError=callback;},
  createElement(tagName){return {tagName:tagName.toUpperCase(),attributes:{},setAttribute(name,value){this.attributes[name]=value;}};},
};
runInNewContext(errorRegistration,{document});
for(const [className,expectedClass,expectedText,label] of [
  ['creator-avatar','creator-avatar creator-initials','M','Profile picture unavailable'],
  ['token-icon','token-icon token-unknown',undefined,'Token icon unavailable'],
  ['partner-logo','source','Partner logo unavailable',undefined],
]) {
  let replacement;
  onError({target:{tagName:'IMG',dataset:{initials:'M'},classList:{contains:name=>name===className},replaceWith:node=>{replacement=node;}}});
  assert.equal(replacement.className,expectedClass);
  assert.equal(replacement.textContent,expectedText);
  assert.equal(replacement.attributes['aria-label'],label);
  assert.notEqual(replacement.tagName,'IMG','A failed static image never starts another image request');
}
onError({target:{tagName:'VIDEO'}});
assert.ok((await readFile('public/still-demo.html','utf8')).includes(assets.ASSET_NOTICE),'Ownership notice is visible in the main footer');
console.log('Still assets: exact mint/profile identities, all static files and hashes, visible creator guardrails, local image rendering and failed-image fallbacks passed.');
