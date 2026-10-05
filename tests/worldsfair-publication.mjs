import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,symlink,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPublicManifest,assertPublicContent,auditPublicRepository} from '../scripts/publication-audit.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),base=await mkdtemp(join(tmpdir(),'still-publication-'));
const config=await readFile(join(root,'wrangler.worldsfair.toml'),'utf8');
const publicOrigin='https://github.com/xNFTpat/worlds-fair.git';
const emptyResearch='export const PRIVATE_PAPER_RESEARCH = {personal: {}, watchlist: {wallets: [], observations: []}};';
const emptyRisk='const REVIEWED_DATA_STOPS:Partial<Record<string,unknown>>={};';
const blocked=['wrangler.toml','wrangler.jsonc','.dev.vars','.dev.vars.production','.DEV.VARS.EXAMPLE','.env','.env.local','execution/.env','validation/paper-positions.json','.wrangler/state/v3/ledger.sqlite','signing-frame/index.html','node_modules/package/index.js','public/media/avatar.png','public/monke.png','public/pat-coast.png','public/bot-review-saved.json','public/paper-research.json','tests/fixtures/robinhood-open-123456.json','wallet-keypair.json','wallet.pem'];
for(const path of blocked)assert.throws(()=>assertPublicManifest([{path,mode:'100644'}]),/cannot be published/,path);
for(const mode of ['120000','160000'])assert.throws(()=>assertPublicManifest([{path:'public/innocent.js',mode}]),/regular resolved/);
assert.throws(()=>assertPublicManifest([{path:'src/conflict.ts',mode:'100644',stage:2}]),/regular resolved/);
assertPublicManifest([{path:'.dev.vars.example',mode:'100644'},{path:'public/brand/still-mark.svg',mode:'100644'},{path:'scripts/build.mjs',mode:'100755'}]);
assertPublicContent('src/private-paper-research.ts',emptyResearch);
assertPublicContent('src/paper-fleet.ts',emptyRisk);
assert.throws(()=>assertPublicContent('src/private-paper-research.ts',emptyResearch.replace('personal: {}','personal: {history: [1]}')),/must stay empty/);
assert.throws(()=>assertPublicContent('src/paper-fleet.ts',emptyRisk.replace('={};','={synthetic:{}};')),/must stay empty/);
assert.throws(()=>assertPublicContent('.dev.vars.example','JUPITER_API_KEY=synthetic-unapproved-value'),/approved placeholders/);
assert.throws(()=>assertPublicContent('.dev.vars.example','# TX_KEY=synthetic-unapproved-value'),/approved placeholders/);
assert.throws(()=>assertPublicContent('tests/fixtures/saved-financial-data.json','{"history":[]}'),/explicitly synthetic/);

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=cwd=>git(cwd,'-c','user.name=Publication fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Synthetic publication fixture');
const bin=join(base,'bin');await mkdir(bin);
await writeFile(join(bin,'npm'),`#!${process.execPath}\nimport{appendFileSync,writeFileSync,symlinkSync}from'node:fs';import{execFileSync}from'node:child_process';appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(['npm',...process.argv.slice(2)])+'\\n');const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();writeFileSync('src/build-version.ts','export const BUILD_VERSION = '+JSON.stringify({sourceSha:'a'.repeat(64),gitSha:process.env.FIXTURE_BAD_STAMP?'b'.repeat(40):sha,buildAt:'2026-01-01T00:00:00.000Z',hashAlgorithm:'sha256',branch:'worldsfair',gitDirty:false})+' as const;\\n');if(process.env.FIXTURE_BAD_ASSET)symlinkSync('index.html','public/generated-link.html');\n`);
await chmod(join(bin,'npm'),0o755);
let sequence=0;
async function fixture(){
 const cwd=join(base,String(++sequence));await mkdir(join(cwd,'scripts'),{recursive:true});await mkdir(join(cwd,'src'));await mkdir(join(cwd,'public'));await mkdir(join(cwd,'node_modules/.bin'),{recursive:true});
 for(const file of ['deploy-worldsfair.mjs','deploy-version.mjs','publication-audit.mjs'])await copyFile(join(root,'scripts',file),join(cwd,'scripts',file));
 await writeFile(join(cwd,'wrangler.worldsfair.toml'),config);
 await writeFile(join(cwd,'src/private-paper-research.ts'),emptyResearch);await writeFile(join(cwd,'src/paper-fleet.ts'),emptyRisk);await writeFile(join(cwd,'public/index.html'),'<p>Synthetic demo</p>');
 await writeFile(join(cwd,'.gitignore'),'node_modules\nsrc/build-version.ts\nvalidation/\npublic/ignored/\n');
 await writeFile(join(cwd,'node_modules/.bin/wrangler'),`#!${process.execPath}\nimport{appendFileSync}from'node:fs';appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(['wrangler',...process.argv.slice(2)])+'\\n');console.log('Current Version ID: 13d7a5b0-a254-416b-9f42-cad5b263e247');\n`);await chmod(join(cwd,'node_modules/.bin/wrangler'),0o755);
 git(cwd,'init','-q','-b','worldsfair');git(cwd,'remote','add','origin',publicOrigin);git(cwd,'add','.');commit(cwd);return cwd;
}
async function run(cwd,extra={}){
 const callsFile=join(base,'calls-'+sequence);await writeFile(callsFile,'');
 const result=spawnSync(process.execPath,['scripts/deploy-worldsfair.mjs'],{cwd,encoding:'utf8',env:{PATH:bin+':'+dirname(process.execPath)+':/usr/bin:/bin',FIXTURE_CALLS:callsFile,...extra},timeout:15000});
 return {...result,output:(result.stdout??'')+(result.stderr??''),calls:(await readFile(callsFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)};
}
async function reject(name,change,expected,{committed=true}={}){
 const cwd=await fixture();await change(cwd);if(committed&&git(cwd,'status','--porcelain')){git(cwd,'add','-A');commit(cwd);}
 const result=await run(cwd);assert.notEqual(result.status,0,name);assert.match(result.output,expected,name);assert.deepEqual(result.calls,[],name+' must stop before build and Wrangler');
}
try{
 await auditPublicRepository(root);
 const good=await fixture(),result=await run(good);assert.equal(result.status,0,result.output);
 assert.deepEqual(result.calls[0],['npm','run','build']);
 assert.deepEqual(result.calls[1],['wrangler','deploy','--config','wrangler.worldsfair.toml']);
 assert.deepEqual(result.calls[2].slice(0,7),['wrangler','kv','key','put','deploy:version:13d7a5b0-a254-416b-9f42-cad5b263e247','--binding','LP_CACHE']);
 assert.deepEqual(result.calls[2].slice(-2),['--config','wrangler.worldsfair.toml']);
 const receipt=JSON.parse(await readFile(join(good,'validation/worldsfair/deployment.json'),'utf8'));assert.equal(receipt.gitSha,git(good,'rev-parse','HEAD'));
 await reject('private/default config',cwd=>writeFile(join(cwd,'wrangler.toml'),'name="synthetic-other-worker"'),/must not contain a personal\/default/);
 await reject('wrong public origin',cwd=>git(cwd,'remote','set-url','origin','https://example.invalid/private.git'),/standalone public/);
 await reject('wrong branch',cwd=>git(cwd,'checkout','-qb','other'),/only from worldsfair/);
 await reject('uncommitted source',cwd=>writeFile(join(cwd,'public/index.html'),'changed'),/Commit all source changes/,{committed:false});
 for(const [name,text] of [
  ['personal Worker',config.replace('name = "lp-terminal-worldsfair"','name = "lp-agg"')],
  ['mainnet-capable entrypoint',config.replace('main = "src/worldsfair.ts"','main = "src/index.ts"')],
  ['other KV',config.replace('1ed8d4f36c51431c89e04cb97c178ca1','0'.repeat(32))],
  ['production KV',config+'\n# 2e61848d804a478d90a7014860e50310\n'],
  ['custom route',config+'\nroutes = ["synthetic.invalid/*"]\n'],
  ['execution credentials',config+'\nTX_KEY = "synthetic-placeholder"\n'],
 ])await reject(name,cwd=>writeFile(join(cwd,'wrangler.worldsfair.toml'),text),/isolation check|isolated cache/);
 await reject('staged owner ledger',async cwd=>{await mkdir(join(cwd,'validation'));await writeFile(join(cwd,'validation/saved-ledger.json'),'{}');git(cwd,'add','-f','validation/saved-ledger.json');},/cannot be published/);
 await reject('staged symlink',cwd=>symlink('index.html',join(cwd,'public/link.html')),/regular resolved/);
 await reject('personal research returned',cwd=>writeFile(join(cwd,'src/private-paper-research.ts'),emptyResearch.replace('wallets: []','wallets: ["synthetic-private-owner"]')),/must stay empty/);
 await reject('production audit map returned',cwd=>writeFile(join(cwd,'src/paper-fleet.ts'),emptyRisk.replace('={};','={synthetic:{}};')),/must stay empty/);
 await reject('ignored asset symlink',async cwd=>{await mkdir(join(cwd,'public/ignored'));await symlink('../index.html',join(cwd,'public/ignored/link.html'));},/symlink in public assets/);
 await reject('ignored asset credential file',async cwd=>{await mkdir(join(cwd,'public/ignored'));await writeFile(join(cwd,'public/ignored/.env'),'SYNTHETIC=placeholder');},/Private file or symlink in public assets/);
 const badAsset=await run(await fixture(),{FIXTURE_BAD_ASSET:'1'});assert.notEqual(badAsset.status,0);assert.match(badAsset.output,/symlink in public assets/);assert.deepEqual(badAsset.calls,[['npm','run','build']],'New assets are rechecked after the build and before Wrangler');
 const badStamp=await run(await fixture(),{FIXTURE_BAD_STAMP:'1'});assert.notEqual(badStamp.status,0);assert.match(badStamp.output,/Build identity/);assert.deepEqual(badStamp.calls,[['npm','run','build']],'An incorrect build SHA never reaches Wrangler');
 console.log('PASS: sanitized tracked files, synthetic receipts, empty private maps, staged and ignored asset symlink/secret exclusions, exact public origin/branch/config/KV, dirty or mismatched builds denied. Every deployment/build command was a temporary fixture; no network or real deployment.');
}finally{await rm(base,{recursive:true,force:true});}
