import {execFileSync} from 'node:child_process';
import {readdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// These are the private export exclusions, not a heuristic secret scanner.
export function excludedPublicationPath(path){
 const name=path.toLowerCase();
 if(name==='.dev.vars.example')return path!=='.dev.vars.example';
 return /(^|\/)(?:node_modules|\.git|\.wrangler|validation|signing-frame)(?:\/|$)/.test(name)
  || /(^|\/)\.(?:dev\.vars|env)(?:[.\/-]|$)/.test(name)
  || /(^|\/)(?:id_rsa|id_ed25519|[^/]*keypair\.json)$/.test(name)
  || /\.(?:pem|key|p12|pfx)$/.test(name)
  || /^wrangler(?:\.[^/]*)?\.(?:toml|json|jsonc)$/.test(name)&&name!=='wrangler.worldsfair.toml'
  || /^public\/(?:media(?:\/|$)|monke\.png$|pat-coast\.png$|bot-review[^/]*\.json$|paper-research\.json$)/.test(name)
  || /^tests\/fixtures\/robinhood-(?:open|close)-\d+\.json$/.test(name);
}

export function assertPublicManifest(entries){
 for(const {path,mode,stage=0} of entries){
  if(!['100644','100755'].includes(mode)||stage!==0)throw Error('Public export requires regular resolved files: '+path);
  if(excludedPublicationPath(path))throw Error('Private or local-only file cannot be published: '+path);
 }
}

export function assertPublicContent(path,text){
 if(path==='.dev.vars.example'){
  const allowed={SOLANA_RPC:'https://api.mainnet-beta.solana.com',JUPITER_API_KEY:'YOUR_DEMO_ONLY_API_KEY'};
  for(const line of text.split(/\r?\n/)){
   const match=line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
   if(match&&allowed[match[1]]!==match[2])throw Error('Public environment example must contain only approved placeholders.');
   if(line.trim()&&!line.trim().startsWith('#')&&!match)throw Error('Unexpected content in public environment example.');
  }
 }
 if(path==='src/private-paper-research.ts'&&!/^\s*export const PRIVATE_PAPER_RESEARCH\s*=\s*\{\s*personal:\s*\{\s*\},\s*watchlist:\s*\{\s*wallets:\s*\[\s*\],\s*observations:\s*\[\s*\]\s*\}\s*\};?\s*$/.test(text.replace(/^\s*\/\/.*$/gm,'')))throw Error('Personal research and owner watchlists must stay empty in the public export.');
 if(path==='src/paper-fleet.ts'&&!/const REVIEWED_DATA_STOPS:[^\n=]+?=\s*\{\s*\};/.test(text))throw Error('Private production risk-review records must stay empty in the public export.');
 if(/^tests\/fixtures\/.*\.json$/.test(path)){
  let fixture;try{fixture=JSON.parse(text);}catch{throw Error('Public JSON fixture must be valid JSON: '+path);}
  if(!path.endsWith('-synthetic.json')||!/^Synthetic receipt /.test(fixture._fixture??''))throw Error('Saved financial JSON must be replaced by explicitly synthetic fixtures: '+path);
  const kind=path.includes('/robinhood-open-')?'5':path.includes('/robinhood-close-')?'6':null;
  if(!kind||fixture.result?.from!=='0x'+'a'.repeat(40)||fixture.result?.transactionHash!=='0x'+kind.repeat(64))throw Error('Synthetic receipt identity changed; review the public fixture before publication: '+path);
 }
}

export async function auditPublicRepository(root=process.cwd()){
 const cwd=resolve(root),git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});
 const entries=git('ls-files','--stage','-z').split('\0').filter(Boolean).map(row=>{
  const match=row.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
  if(!match)throw Error('Cannot read the publication manifest.');
  return {mode:match[1],oid:match[2],stage:Number(match[3]),path:match[4]};
 });
 assertPublicManifest(entries);
 for(const entry of entries){
  if(['.dev.vars.example','src/private-paper-research.ts','src/paper-fleet.ts'].includes(entry.path)||/^tests\/fixtures\/.*\.json$/.test(entry.path))assertPublicContent(entry.path,git('cat-file','blob',entry.oid));
 }
 // Wrangler publishes the working asset directory, including ignored files.
 // Inspect it without following links, as well as checking the Git snapshot.
 async function assets(path){
  for(const entry of await readdir(join(cwd,path),{withFileTypes:true})){
   const relative=path+'/'+entry.name;
   if(entry.isSymbolicLink()||excludedPublicationPath(relative))throw Error('Private file or symlink in public assets: '+relative);
   if(entry.isDirectory())await assets(relative);
   else if(!entry.isFile())throw Error('Public assets must be regular files: '+relative);
  }
 }
 const publicPath=join(cwd,'public');
 try{if(!(await lstat(publicPath)).isDirectory())throw Error('Public asset root must be a directory, not a symlink.');await assets('public');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 return {files:entries.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 auditPublicRepository().then(result=>console.log('Public export checks passed: '+result.files+' regular files.')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
