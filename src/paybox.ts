// OAuth tokens remain server-side. Signing keys belong only to PayBox's isolated UI.
interface PayboxEnv { LP_CACHE:KVNamespace; PREVIEW_ORIGIN?:string; EVM_EXECUTION?:DurableObjectNamespace }
const API='https://api.paybox.sh';
const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const cookie=(r:Request,n:string)=>r.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(n+'='))?.slice(n.length+1);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const cookieValue=(name:string,value:string,age:number,origin:string)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`;
function mcpFrames(text:string):any[]{return text.startsWith('data:')||text.includes('\ndata:')?text.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(text)];}
export async function verifiedPayboxCredential(req:Request,env:PayboxEnv,credentialId:string,owner:string){
 const sid=cookie(req,'lp_paybox'),session=sid&&/^[\w-]{43}$/.test(sid)?await env.LP_CACHE.get<{token:string;expiresAt:number}>('paybox:session:'+sid,'json'):null;
 if(!session||session.expiresAt<=Date.now())throw Error('Connect PayBox before reviewing this wallet.');
 if(typeof credentialId!=='string'||credentialId.length<1||credentialId.length>200||!/^0x[0-9a-fA-F]{40}$/.test(owner))throw Error('Choose a granted EVM PayBox wallet.');
 const headers:Record<string,string>={authorization:'Bearer '+session.token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'};
 const deadline=Date.now()+15000,send=(body:unknown)=>fetch(API+'/mcp',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
 const initialized=await send({jsonrpc:'2.0',id:crypto.randomUUID(),method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'lp-terminal-server',version:'1'}}});
 if(!initialized.ok)throw Error('PayBox wallet grants could not be verified.');const initFrames=mcpFrames(await initialized.text());if(!initFrames.some(f=>f.result?.protocolVersion)||initFrames.some(f=>f.error))throw Error('PayBox initialization failed.');
 const mcpSession=initialized.headers.get('mcp-session-id');if(mcpSession)headers['mcp-session-id']=mcpSession;
 const notification=await send({jsonrpc:'2.0',method:'notifications/initialized'});if(!notification.ok)throw Error('PayBox initialization failed.');
 const response=await send({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:'list_credentials',arguments:{}}});
 if(!response.ok)throw Error('PayBox wallet grants could not be verified.');
 let credentials:any[]=[];for(const frame of mcpFrames(await response.text())){if(frame.result?.isError||frame.error)throw Error('PayBox wallet grants could not be verified.');const item=frame.result?.content?.find((c:any)=>c.type==='text');if(item){const data=JSON.parse(item.text);if(Array.isArray(data.credentials))credentials=data.credentials;}}
 const credential=credentials.find(c=>c.credential_id===credentialId&&c.kind==='wallet'&&typeof c.metadata?.address==='string'&&c.metadata.address.toLowerCase()===owner.toLowerCase());
 if(!credential)throw Error('This selected wallet is not granted to this PayBox connection.');
 return {sessionId:sid!,credentialId,owner:owner.toLowerCase(),name:String(credential.name||'PayBox wallet').slice(0,100)};
}
export async function payboxEvmJournal(env:PayboxEnv,owner:string,path:string,input:unknown){
 if(!env.EVM_EXECUTION)throw Error('Robinhood execution journal is not configured.');
 const id=env.EVM_EXECUTION.idFromName('evm-wallet:4663:'+owner.toLowerCase()),response=await env.EVM_EXECUTION.get(id).fetch('https://evm-journal'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const result:any=await response.json();if(!response.ok)throw Error(result.error||'Execution journal is unavailable.');return result;
}
export async function payboxRoute(req:Request,env:PayboxEnv):Promise<Response|null>{
  const url=new URL(req.url);
  if(!url.pathname.startsWith('/api/paybox/'))return null;
  const origin=env.PREVIEW_ORIGIN||url.origin;
  const sid=cookie(req,'lp_paybox');
  const session=sid&&/^[\w-]{43}$/.test(sid)?await env.LP_CACHE.get<{token:string;expiresAt:number}>(`paybox:session:${sid}`,'json'):null;
  const connected=!!session&&session.expiresAt>Date.now();
  if(url.pathname==='/api/paybox/status')return json({connected});
  if(url.pathname==='/api/paybox/recover'&&req.method==='GET'){
    if(!connected)return json({error:'Connect PayBox first.'},401);
    return json(await env.LP_CACHE.get('paybox:request:'+sid+':'+url.searchParams.get('previewId'),'json')||{});
  }
  if(req.method==='POST'&&req.headers.get('origin')!==origin)return json({error:'Open the terminal to connect PayBox.'},403);
  if(url.pathname==='/api/paybox/connect'&&req.method==='POST'){
    const redirect=origin+'/api/paybox/callback';
    const clientKey='paybox:client:'+origin;
    let client=await env.LP_CACHE.get<{client_id:string}>(clientKey,'json');
    if(!client){
      const registered=await fetch(API+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Pat’s LP Terminal',redirect_uris:[redirect],token_endpoint_auth_method:'none'})});
      if(!registered.ok)return json({error:'PayBox registration is unavailable. Try again later.'},502);
      client=await registered.json() as {client_id:string};
      if(!client.client_id)return json({error:'PayBox returned an incomplete registration.'},502);
      await env.LP_CACHE.put(clientKey,JSON.stringify(client));
    }
    const state=random(),verifier=random(),challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    await env.LP_CACHE.put('paybox:auth:'+state,JSON.stringify({clientId:client.client_id,verifier,redirect}),{expirationTtl:600});
    const target=new URL(API+'/oauth/authorize');
    target.search=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'mcp',resource:API+'/mcp',state}).toString();
    return new Response(JSON.stringify({url:target.href}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':cookieValue('lp_paybox_state',state,600,origin)}});
  }
  if(url.pathname==='/api/paybox/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state');
    if(!state||cookie(req,'lp_paybox_state')!==state)return json({error:'Connection expired or state did not match. Start again from the terminal.'},400);
    const auth=await env.LP_CACHE.get<{clientId:string;verifier:string;redirect:string}>('paybox:auth:'+state,'json');
    if(!auth||!url.searchParams.get('code'))return json({error:'PayBox connection was cancelled or expired.'},400);
    await env.LP_CACHE.delete('paybox:auth:'+state);
    const response=await fetch(API+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:auth.clientId,redirect_uri:auth.redirect,code_verifier:auth.verifier,code:url.searchParams.get('code')!})});
    if(!response.ok)return json({error:'PayBox could not complete the connection. Return to the terminal to connect again.'},400);
    const token=await response.json() as {access_token:string;expires_in:number};
    if(!token.access_token)return json({error:'PayBox did not return a session.'},502);
    const id=random(),ttl=Math.min(3600,Math.max(60,token.expires_in||3600));
    await env.LP_CACHE.put('paybox:session:'+id,JSON.stringify({token:token.access_token,expiresAt:Date.now()+ttl*1000}),{expirationTtl:ttl});
    const headers=new Headers({'location':origin+'/?paybox=connected','cache-control':'no-store','referrer-policy':'no-referrer'});
    headers.append('set-cookie',cookieValue('lp_paybox',id,ttl,origin));headers.append('set-cookie',cookieValue('lp_paybox_state','',0,origin));
    return new Response(null,{status:303,headers});
  }
  if(url.pathname==='/api/paybox/disconnect'&&req.method==='POST'){
    if(sid)await env.LP_CACHE.delete('paybox:session:'+sid);
    return new Response('{}',{headers:{'content-type':'application/json','set-cookie':cookieValue('lp_paybox','',0,origin),'cache-control':'no-store'}});
  }
  if(url.pathname==='/api/paybox/mcp'&&req.method==='POST'){
    if(!connected)return json({error:'Connect PayBox first.'},401);
    const body=await req.text();if(body.length>100000)return json({error:'Request too large.'},413);
    let message:any;try{message=JSON.parse(body);}catch{return json({error:'Invalid request.'},400);}
    const methods=['initialize','notifications/initialized','tools/list','tools/call','resources/list','resources/read','ping'];
    if(!methods.includes(message.method))return json({error:'Unsupported request.'},400);
    let previewId:string|undefined,evmSigning:any;
    if(message.method==='tools/call'){
      // PayBox's isolated UI completes signing through these three server tools.
      // They never receive the signing key; the UI supplies a signed proof/artifact.
      const signingTools=['moonx_resolve_binding','moonx_sign','submit_signature'];
      if(!['list_credentials','get_request','request_wallet_sign','reopen_signing_window',...signingTools].includes(message.params?.name))return json({error:'This terminal supports wallet connection and signing only.'},403);
      if(signingTools.includes(message.params.name)){
        const id=message.params.arguments?.request_id;
        if(typeof id!=='string'||!await env.LP_CACHE.get('paybox:signing:'+sid+':'+id))return json({error:'Reopen the existing signing card from the terminal, then approve it again. Keep your key.'},403);
      }
      if(message.params.name==='request_wallet_sign') {
        const args=message.params.arguments, intent=args?.intent;
        if(intent?.op==='raw') {
          const preview=await env.LP_CACHE.get<{messageHex:string;expiresAt:number}>('solana:preview:'+String(args._previewId),'json');
          if(!preview||preview.expiresAt<Date.now()||preview.messageHex!==intent.rawSigningPayloadHex)return json({error:'Review this transaction again before signing.'},400);
          previewId=String(args._previewId);
          delete args._previewId;
        } else if(intent?.op==='transaction') {
          try{
            if(typeof intent.transaction!=='string'||intent.transaction.length>16000)throw Error('Review an exact EVM transaction before signing.');
            const tx=JSON.parse(intent.transaction),wallet=await verifiedPayboxCredential(req,env,args.credential_id,tx.from);
            const reservation=await payboxEvmJournal(env,wallet.owner,'/prepare-sign',{...wallet,previewId:args._evmPreviewId,transactionJson:intent.transaction});
            evmSigning={...wallet,...reservation};delete args._evmPreviewId;
          }catch(e){return json({error:e instanceof Error?e.message:'Review this transaction again.'},400);}
        } else if(intent?.op!=='solanaMessage'||intent.message!=='Connect Pat’s LP Terminal. This message does not authorize a transaction.')return json({error:'Only the setup message or a current simulated transaction can be signed here.'},400);
      }
    }
    const upstreamHeaders:Record<string,string>={'authorization':'Bearer '+session!.token,'content-type':'application/json','accept':'application/json, text/event-stream'};
    for(const name of ['mcp-session-id','mcp-protocol-version']){const value=req.headers.get(name);if(value)upstreamHeaders[name]=value;}
    const response=await fetch(API+'/mcp',{method:'POST',headers:upstreamHeaders,body:JSON.stringify(message),signal:AbortSignal.timeout(55000)});
    const headers=new Headers({'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
    const mcpSession=response.headers.get('mcp-session-id');if(mcpSession)headers.set('mcp-session-id',mcpSession);
    if(response.ok&&message.method==='tools/call'&&['request_wallet_sign','reopen_signing_window'].includes(message.params?.name)){
      const text=await response.text();
      try{
        const frames=text.startsWith('data:')||text.includes('\ndata:')?text.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(text)];
        for(const frame of frames){
          if(frame.result?.isError)continue;
          const item=frame.result?.content?.find((c:any)=>c.type==='text');
          if(item){const result=JSON.parse(item.text);if(result.request_id){
            await env.LP_CACHE.put('paybox:signing:'+sid+':'+result.request_id,JSON.stringify({requestId:result.request_id}),{expirationTtl:3600});
            if(previewId)await env.LP_CACHE.put('paybox:request:'+sid+':'+previewId,JSON.stringify({requestId:result.request_id}),{expirationTtl:600});
            if(evmSigning){
              // Preserve the returned request before binding it; status can retry
              // this same reservation after a transient journal write failure.
              await env.LP_CACHE.put('paybox:request:'+sid+':'+evmSigning.previewId,JSON.stringify({requestId:result.request_id}),{expirationTtl:600});
              await payboxEvmJournal(env,evmSigning.owner,'/bind-request',{...evmSigning,requestId:result.request_id});
            }
          }}
        }
      }catch{/* The original response is still returned; an uncertain request is never retried. */}
      return new Response(text,{status:response.status,headers});
    }
    return new Response(response.body,{status:response.status,headers});
  }
  if(url.pathname==='/api/paybox/mcp')return new Response(null,{status:405,headers:{allow:'POST'}});
  return json({error:'Not found.'},404);
}
