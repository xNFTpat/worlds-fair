import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {generatedVersion,deploymentVersionId} from './deploy-version.mjs';
const config='wrangler.worldsfair.toml';
const text=await readFile(config,'utf8');
if(!/^name = "lp-terminal-worldsfair"$/m.test(text)||!/^main = "src\/worldsfair.ts"$/m.test(text)||text.includes('2e61848d804a478d90a7014860e50310')||/TX_KEY|PRIVATE_KEY|PREVIEW_ORIGIN|EVM_EXECUTION|routes\s*=/.test(text))throw Error('Separate demo configuration failed the isolation check.');
// The public repository deliberately contains no personal Worker config.
try{await readFile('wrangler.toml');throw Error('The public demo must not contain a personal/default Worker config.');}catch(error){if(error.code!=='ENOENT')throw error;}
if(!text.includes('1ed8d4f36c51431c89e04cb97c178ca1'))throw Error('The demo must use its isolated cache.');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git('branch','--show-current')!=='worldsfair')throw Error('Deploy only from worldsfair.');
if(git('remote','get-url','origin')!=='https://github.com/xNFTpat/worlds-fair.git')throw Error('Deploy only from the standalone public worlds-fair repository.');
if(git('status','--porcelain'))throw Error('Commit all source changes before deploying.');
const build=spawnSync('npm',['run','build'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
const version=generatedVersion(await readFile('src/build-version.ts','utf8'));
if(version.gitSha!==git('rev-parse','HEAD')||version.branch!=='worldsfair'||version.gitDirty)throw Error('Build identity does not match clean worldsfair HEAD.');
const result=spawnSync('node_modules/.bin/wrangler',['deploy','--config',config],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'/private/tmp/worldsfair-wrangler.log'},maxBuffer:10*1024*1024});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.status!==0)process.exit(result.status||1);
const versionId=deploymentVersionId(result.stdout+'\n'+result.stderr),receipt={versionId,sourceSha:version.sourceSha,gitSha:version.gitSha,branch:version.branch,deployedAt:new Date().toISOString()};
await mkdir('validation/worldsfair',{recursive:true});const path='validation/worldsfair/deployment.json';await writeFile(path,JSON.stringify(receipt,null,2)+'\n');
const saved=spawnSync('node_modules/.bin/wrangler',['kv','key','put','deploy:version:'+versionId,'--binding','LP_CACHE','--remote','--path',path,'--config',config],{stdio:'inherit',env:{...process.env,WRANGLER_LOG_PATH:'/private/tmp/worldsfair-wrangler.log'}});if(saved.status!==0)process.exit(saved.status||1);
console.log('Separate paper demo deployed: https://lp-terminal-worldsfair.pat-862.workers.dev');
