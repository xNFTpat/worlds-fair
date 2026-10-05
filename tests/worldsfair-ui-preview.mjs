// Local-only synthetic fixture for responsive browser verification. Never deploy.
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const publicDir=resolve('public');
const bundle=await build({stdin:{contents:String.raw`
 import {WorldsfairRangeInbox,worldsfairPaperRoute} from './src/worldsfair-paper';
 import {initialFleetState} from './src/paper-fleet';
 const now=()=>new Date().toISOString();
 const basket={id:'synthetic-basket',slug:'synthetic-basket',name:'Local fixture basket',image:null,categories:['crypto'],sevenDay:1.2,thirtyDay:3.5,days:30,end:now(),minimum:1,inputSymbol:'SOL',description:'Synthetic quotes for browser verification only.',allocation:{complete:true,rows:[{mint:'So11111111111111111111111111111111111111112',symbol:'SOL',name:'Solana',weight:60},{mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',symbol:'USDC',name:'USD Coin',weight:40}]},graph:null,readAt:Date.now(),stale:false};
 const ideas=[{id:'synthetic-staking',name:'Local fixture SOL staking',kind:'staking',chain:'Solana',asset:'SOL',provider:'Local fixture',rate:5,rateType:'APY',basis:'Synthetic rate for layout verification.',tvlUsd:1000000,url:'https://example.invalid',source:'https://example.invalid',docs:'https://example.invalid',risk:'Synthetic SOL price and provider risk.',exit:'Synthetic delayed withdrawal.',readAt:now(),rateAsOf:null,stale:false,depositEnabled:true},{id:'synthetic-vault',name:'Local fixture vault',kind:'vault',chain:'Solana',asset:'SOL',provider:'Local fixture',rate:5,rateType:'APY',basis:'Synthetic rate for layout verification.',tvlUsd:1000000,url:'https://example.invalid',source:'https://example.invalid',docs:'https://example.invalid',risk:'Synthetic contract and liquidity risk.',exit:'Synthetic withdrawal queue.',readAt:now(),rateAsOf:null,stale:false,depositEnabled:true}];
 export class TestInbox extends WorldsfairRangeInbox {
  constructor(ctx,env){super(ctx,env);this.ready=ctx.blockConcurrencyWhile(async()=>{if(await ctx.storage.get('ui-fixture'))return;const state=initialFleetState(),at=now();state.lastScanAt=at;state.lastFullScanAt=at;state.portfolios.farmer.cashSol+=.4;state.portfolios.farmer.peakSol=state.portfolios.farmer.cashSol;state.portfolios.farmer.realizedPnlSol=.4;const trade={id:'fleet:farmer:ui-fixture',arm:'farmer',cohort:'fixture',experiment:state.version,pair:'LOCAL FIXTURE/SOL',poolAddress:'fixture',openedAt:new Date(Date.now()-3600000).toISOString(),closedAt:at,pnlSol:.4,exitSol:1.4,feesSol:.4,withdrawTaxSol:0,reason:'Synthetic browser fixture',observedInRangeMs:3600000,budgetSol:1,rentSol:.1,entryNetworkSol:0};state.closed=[trade];await ctx.storage.put({'fleet':state,['fleet-trade:'+at+':'+trade.id]:trade,'ui-fixture':true});});}
  async fetch(req){await this.ready;return super.fetch(req);}
 }
 export default {async fetch(req,env){const url=new URL(req.url),path=url.pathname;const paper=await worldsfairPaperRoute(req,env);if(paper)return paper;
  if(path==='/api/cesto'){const fresh={...basket,end:now(),readAt:Date.now()};return Response.json(url.searchParams.has('basket')?fresh:{baskets:[fresh],readAt:Date.now(),stale:false});}
  if(path==='/api/long-game')return Response.json({items:ideas.map(idea=>({...idea,readAt:now()})),errors:[],checkedAt:now(),refreshMinutes:60});
  if(path.startsWith('/api/paper-fleet'))return env.RANGE_ALERTS.get(env.RANGE_ALERTS.idFromName('pat-four-wallets-v1')).fetch('https://internal/fleet'+path.slice('/api/paper-fleet'.length)+url.search);
  if(path==='/api/version')return Response.json({gitSha:'0000000000000000000000000000000000000000',branch:'local-fixture',buildAt:now()});
  if(path.startsWith('/api/'))return Response.json({error:'Local fixture: this data is outside this layout test.'},{status:404});
  if(req.method!=='GET'&&req.method!=='HEAD'||/\/(?:solana|phantom|owner-access)\.js$|\/signing-frame\//i.test(path))return new Response('Paper fixture only',{status:403});
  return env.ASSETS.fetch(req);
 }};
`,loader:'js',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'synthetic-paper-providers',setup(b){
 for(const kind of ['basket','vault']){
  const module=kind==='basket'?'worldsfair-paper-baskets':'worldsfair-paper-vaults';
  b.onResolve({filter:new RegExp('^\\./'+module+'$')},()=>({path:kind,namespace:'ui-fixture'}));
 }
 b.onLoad({filter:/.*/,namespace:'ui-fixture'},async({path})=>({contents:await readFile('tests/fixtures/worldsfair-'+path+'-provider.fixture.mjs','utf8'),loader:'js'}));
}}]});
const contentTypes={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:8790,workers:[{name:'worldsfair-local-fixture',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',kvNamespaces:['LP_CACHE'],durableObjects:{RANGE_ALERTS:{className:'TestInbox',useSQLite:true}},serviceBindings:{ASSETS:async req=>{
 const path=resolve(publicDir,'.'+decodeURIComponent(new URL(req.url).pathname==='/'?'/index.html':new URL(req.url).pathname));
 if(!path.startsWith(publicDir+sep))return new Response('Not found',{status:404});
 try{let data=await readFile(path);if(extname(path)==='.html')data=Buffer.from(data.toString().replace('Paper demo · Solana','Local test fixture · Paper Solana'));return new Response(data,{headers:{'content-type':contentTypes[extname(path)]||'application/octet-stream','cache-control':'no-store'}});}catch{return new Response('Not found',{status:404});}
 }}}]}));
await mf.ready;
console.log('Local synthetic UI fixture: http://127.0.0.1:8790/#baskets (no external quotes, no deployment)');
await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
await mf.dispose();
