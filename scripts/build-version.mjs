import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export async function sourceVersion(root=process.cwd(),now=new Date()){
 const files=[];
 async function walk(dir){let entries;try{entries=await readdir(join(root,dir),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries){if(e.name.startsWith('.')||e.name==='node_modules')continue;const file=join(dir,e.name).replaceAll('\\','/');if(file==='src/build-version.ts'||file==='public/build-version.json')continue;if(e.isDirectory())await walk(file);else if(e.isFile()&&(dir!=='execution'||e.name.endsWith('.ts')))files.push(file);}
 }
 for(const dir of ['src','public','scripts','monitoring'])await walk(dir);
 // Only execution source, never nested dependencies or signing secrets.
 const execution=await readdir(join(root,'execution'),{withFileTypes:true}).catch(()=>[]);for(const e of execution)if(e.isFile()&&e.name.endsWith('.ts'))files.push('execution/'+e.name);
 for(const file of ['package.json','package-lock.json','execution/package.json','execution/package-lock.json','wrangler.toml','wrangler.worldsfair.toml']){try{await readFile(join(root,file));files.push(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const hash=createHash('sha256');for(const file of files.sort()){const bytes=await readFile(join(root,file));hash.update(file+'\0'+bytes.length+'\0');hash.update(bytes);}
 let gitSha=null,gitDirty=null;try{const candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:root,stdio:['ignore','pipe','ignore'],encoding:'utf8'}).trim();if(/^[a-f0-9]{40,64}$/.test(candidate)){gitSha=candidate;gitDirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,stdio:['ignore','pipe','ignore'],encoding:'utf8'}).trim();}}catch{/* No repository means no commit claim. */}
 let branch=null;try{branch=execFileSync('git',['branch','--show-current'],{cwd:root,stdio:['ignore','pipe','ignore'],encoding:'utf8'}).trim()||null;}catch{}
 return {gitSha,branch,gitDirty,sourceSha:hash.digest('hex'),buildAt:now.toISOString(),hashAlgorithm:'sha256',sourceFiles:files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const version=await sourceVersion(),target=resolve('src/build-version.ts');
 await writeFile(target,'// Generated after asset build. No secrets or invented Git commit.\nexport const BUILD_VERSION = '+JSON.stringify(version)+' as const;\n');
 console.log('Build version: '+(version.gitSha?'git '+version.gitSha.slice(0,12):'source '+version.sourceSha.slice(0,12))+' · '+version.buildAt);
}
