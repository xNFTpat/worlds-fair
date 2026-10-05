import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import {VersionedTransaction,PublicKey} from '@solana/web3.js';
import {ed25519} from '@noble/curves/ed25519';
import {Buffer} from 'buffer';
import {Family} from './composer-state';
import {esc} from './composer-ui';
// Retained legacy tests only; the public demo has no signing-frame deployment.
const FRAME='https://example.invalid/disabled-signing/';
const SETUP='Connect Legacy LP client. This message does not authorize a transaction.';
let client:Client|undefined,wallet:any;
let closeCard:(()=>Promise<void>)|undefined;
const setupKey=(id:string)=>'lp-paybox-setup:'+id;
function data(result:any){const item=result.content?.find((c:any)=>c.type==='text');if(!item)throw new Error('PayBox returned no result.');const value=JSON.parse(item.text);if(result.isError)throw new Error(value.error?.message||value.error||'PayBox request failed.');return value;}
async function rpcClient(){
 if(client)return client;
 const c=new Client({name:'Legacy LP client',version:'1.0.0'},{capabilities:{extensions:{'io.modelcontextprotocol/ui':{mimeTypes:['text/html;profile=mcp-app']}}} as any});
 await c.connect(new StreamableHTTPClientTransport(new URL('/api/paybox/mcp',location.origin)));
 client=c;return c;
}
export interface PayboxWallet {id:string;address:string;name:string;family:Family;}
export function walletsFromCredentials(credentials:any[],family:Family):PayboxWallet[]{return credentials.filter((x:any)=>{const address=x.metadata?.address;if(x.kind!=='wallet'||typeof address!=='string')return false;if(family==='evm')return /^0x[\da-f]{40}$/i.test(address);try{return new PublicKey(address).toBase58()===address;}catch{return false;}}).map((w:any)=>({id:w.credential_id,address:w.metadata.address,name:w.name||'Wallet',family}));}
export async function payboxWallets(family:Family='solana'):Promise<PayboxWallet[]>{
 const status=await (await fetch('/api/paybox/status')).json();if(!status.connected){client=undefined;return [];}
 const c=await rpcClient();const d=data(await c.callTool({name:'list_credentials',arguments:{}}));
 return walletsFromCredentials(d.credentials||[],family);
}
export async function payboxWallet(options:{family?:Family;id?:string}={}):Promise<PayboxWallet|null>{
 const family=options.family||'solana',wallets=await payboxWallets(family);
 const id=options.id||localStorage.getItem('lp-paybox-wallet:'+family)||(family==='solana'?localStorage.getItem('lp-paybox-wallet'):null);
 wallet=wallets?.find(w=>w.id===id)||(!options.id?wallets?.[0]:null);
 return wallet||null;
}
export async function connectPaybox(context?:{pool:string;family:Family}){
 if(context)localStorage.setItem('lp-execution-return',JSON.stringify({...context,at:Date.now()}));
 const d=await (await fetch('/api/paybox/connect',{method:'POST'})).json();if(d.error)throw new Error(d.error);location.assign(d.url);
}
export async function signingCard(host:HTMLElement,input:any,result:any){
 await closeCard?.();
 const c=await rpcClient();
 const frame=document.createElement('iframe');frame.title='PayBox secure signing';frame.className='paybox-signing-frame';frame.style.cssText=`width:100%;height:${Math.min(620,Math.max(360,window.innerHeight-180))}px;border:0;background:transparent`;frame.sandbox.add('allow-scripts','allow-same-origin','allow-forms','allow-popups');
 host.replaceChildren(frame);
 const bridge=new AppBridge(c,{name:'Legacy LP client',version:'1.0.0'},{openLinks:{},serverTools:c.getServerCapabilities()?.tools,serverResources:c.getServerCapabilities()?.resources},{hostContext:{theme:'dark',platform:'web',displayMode:'inline',availableDisplayModes:['inline'],containerDimensions:{width:host.clientWidth,maxHeight:1000}}});
 bridge.onopenlink=async({url})=>{const target=new URL(url);if(target.protocol!=='https:'||!['app.paybox.sh','api.paybox.sh'].includes(target.hostname))throw new Error('Unrecognized PayBox link.');let link=host.querySelector('[data-paybox-link]') as HTMLAnchorElement;if(!link){link=document.createElement('a');link.dataset.payboxLink='';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open PayBox approval ↗';host.prepend(link);}link.href=target.href;window.open(target.href,'_blank','noopener,noreferrer');return {};};
 bridge.onsizechange=({height})=>{if(height)frame.style.height=Math.min(1200,Math.max(400,height))+'px';};
 bridge.onloggingmessage=()=>{};
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Signing card did not load. Use Reopen signing card; do not create a new request.')),20000);bridge.oninitialized=()=>{clearTimeout(timeout);resolve();};});
 await bridge.connect(new PostMessageTransport(frame.contentWindow!,frame.contentWindow!));
 frame.src=FRAME;await ready;
 bridge.sendToolInput({arguments:input});bridge.sendToolResult(result);
 closeCard=()=>bridge.close();
 return closeCard;
}
export async function requestPayboxSignature(input:any,onRequest:(id:string)=>void){
 const c=await rpcClient();
 const result=await c.callTool({name:'request_wallet_sign',arguments:input});
 const d=data(result);if(!d.request_id)throw new Error('PayBox did not return a request identifier.');
 onRequest(d.request_id);
 return {id:d.request_id,result,input};
}
export async function reopenPaybox(host:HTMLElement,id:string){const c=await rpcClient();const result=await c.callTool({name:'reopen_signing_window',arguments:{request_id:id}});await signingCard(host,{request_id:id},result);}
export async function payboxResult(id:string){return data(await (await rpcClient()).callTool({name:'get_request',arguments:{request_id:id}}));}
export function applyPayboxSignature(tx:VersionedTransaction,result:any,owner:string){
 const artifact=result.output?.value;
 if(artifact?.scheme!=='eddsa_ed25519'||typeof artifact.signature?.signature!=='string')throw new Error('PayBox did not return a Solana signature.');
 const signature=Buffer.from(artifact.signature.signature.replace(/^0x/,''),'hex');
 const pubkey=new PublicKey(owner);
 if(signature.length!==64||!ed25519.verify(signature,tx.message.serialize(),pubkey.toBytes()))throw new Error('The signature did not match this transaction and wallet.');
 tx.addSignature(pubkey,signature);
 return Buffer.from(tx.serialize()).toString('base64');
}
export async function payboxReady(id:string){
 const request=localStorage.getItem(setupKey(id));
 return !!request&&(await payboxResult(request)).status==='success';
}
export async function setupPaybox(host:HTMLElement,w:PayboxWallet,status:HTMLElement){
 if(w.family!=='solana')throw new Error('Review the Robinhood transaction to open its signing card.');
 let id=localStorage.getItem(setupKey(w.id));
 if(id){const existing=await payboxResult(id);if(existing.status==='success'){status.textContent='Signing setup complete. Review your transaction when ready.';return;}if(['error','denied'].includes(existing.status)){localStorage.removeItem(setupKey(w.id));id=null;}else await reopenPaybox(host,id);}
 if(!id){const created=await requestPayboxSignature({credential_id:w.id,intent:{op:'solanaMessage',address:w.address,message:SETUP}},newId=>localStorage.setItem(setupKey(w.id),newId));id=created.id;await signingCard(host,created.input,created.result);}
 status.textContent='Complete this setup message in PayBox. It cannot move funds.';
 for(let i=0;i<90&&host.isConnected;i++){
  const result=await payboxResult(id!);
  if(result.status==='success'){status.textContent='Signing setup complete. Review your transaction when ready.';return;}
  if(['error','denied'].includes(result.status)){status.textContent='Setup '+result.status+'. No transaction was created. Your signing key stays configured.';return;}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 status.textContent='Setup is still pending. Set up signing reopens the same message.';
}
export async function mountWalletPicker(host:HTMLElement,family:Family,onChange:(w:PayboxWallet|null)=>void,options:{pool?:string;selectedId?:string}={}){
 host.classList.add('execution-wallet');
 host.innerHTML=`<label>PayBox wallet <select data-credential aria-label="${family==='evm'?'Robinhood EVM':'Solana'} PayBox wallet"><option value="">Reading wallets…</option></select></label><div class="execution-actions"><button data-connect>Connect PayBox</button><button data-refresh-wallet>Refresh wallets</button>${family==='solana'?'<button data-setup hidden>Set up signing</button>':''}</div><p data-wallet-status class="execution-status" role="status"></p><div data-wallet-card class="paybox-card"></div>`;
 const find=(s:string)=>host.querySelector(s) as HTMLInputElement,status=find('[data-wallet-status]'),select=find('[data-credential]');let wallets:PayboxWallet[]=[];
 const changed=()=>{const chosen=wallets.find(w=>w.id===select.value)||null;if(chosen)localStorage.setItem('lp-paybox-wallet:'+family,chosen.id);status.textContent=chosen?`${family==='evm'?'Robinhood · chain 4663':'Solana mainnet'} · ${chosen.address}`:`No ${family==='evm'?'EVM':'Solana'} wallet granted. Connect PayBox and grant the wallet you want to use.`;const setup=find('[data-setup]');if(setup)setup.hidden=!chosen;onChange(chosen);};
 async function refresh(){try{wallets=await payboxWallets(family)||[];if(!host.isConnected)return;const selected=options.selectedId||localStorage.getItem('lp-paybox-wallet:'+family);select.innerHTML=wallets.length?wallets.map(w=>`<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.address.slice(0,8)+'…'+w.address.slice(-6))}</option>`).join(''):'<option value="">No granted wallet</option>';if(wallets.some(w=>w.id===selected))select.value=selected!;find('[data-connect]').hidden=wallets.length>0;changed();}catch(e:any){status.textContent=e.message;select.innerHTML='<option value="">Wallets unavailable</option>';}}
 select.onchange=changed;find('[data-connect]').onclick=async()=>{try{await connectPaybox(options.pool?{pool:options.pool,family}:undefined);}catch(e:any){status.textContent=e.message;}};
 find('[data-refresh-wallet]').onclick=refresh;
 const setup=find('[data-setup]');if(setup)setup.onclick=async()=>{const chosen=wallets.find(w=>w.id===select.value);if(!chosen)return;setup.disabled=true;try{await setupPaybox(find('[data-wallet-card]'),chosen,status);}catch(e:any){status.textContent=e.message;}finally{setup.disabled=false;}};
 await refresh();return {selected:()=>wallets.find(w=>w.id===select.value)||null,refresh};
}
export async function mountPaybox(host:HTMLElement){
 host.innerHTML='<div class="actions"><button data-connect>Connect PayBox</button><button data-setup hidden>Set up signing</button><button data-disconnect hidden>Disconnect PayBox</button></div><p data-status role="status">PayBox lets you approve from this browser. Connecting does not submit a transaction.</p><div data-card></div>';
 const button=(s:string)=>host.querySelector(s) as HTMLButtonElement,status=host.querySelector('[data-status]')!,card=host.querySelector('[data-card]') as HTMLElement;
 button('[data-connect]').onclick=async()=>{button('[data-connect]').disabled=true;try{await connectPaybox();}catch(e:any){status.textContent=e.message;button('[data-connect]').disabled=false;}};
 button('[data-disconnect]').onclick=async()=>{await fetch('/api/paybox/disconnect',{method:'POST'});await closeCard?.();await client?.close();client=undefined;wallet=null;await mountPaybox(host);};
 button('[data-setup]').onclick=async()=>{
  button('[data-setup]').disabled=true;
  try{
    const w=await payboxWallet();if(!w)throw new Error('Grant a Solana wallet in PayBox first.');
    await setupPaybox(card,w,status as HTMLElement);
  }catch(e:any){status.textContent=e.message;}finally{button('[data-setup]').disabled=false;}
 };
 try{const w=await payboxWallet();if(w){button('[data-connect]').hidden=true;button('[data-setup]').hidden=false;button('[data-disconnect]').hidden=false;status.textContent=`PayBox connected · ${w.name} · ${w.address}. `+((await payboxReady(w.id))?'Signing setup complete.':'Set up signing once before reviewing a transaction.');}}catch(e:any){status.textContent=e.message;}
}
