import type {Env} from './env';

const COOKIE='lp_owner',TTL=12*60*60;
const json=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
const cookie=(req:Request)=>req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
async function sameSecret(candidate:string,expected:string){const [a,b]=await Promise.all([digest(candidate),digest(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const origin=(req:Request,env:Env)=>env.PREVIEW_ORIGIN||new URL(req.url).origin;
const sessionCookie=(req:Request,env:Env,value:string,age:number)=>`${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin(req,env).startsWith('https:')?'; Secure':''}`;
interface Session {expiresAt:number;keyFingerprint:string}

// Portfolio viewing is public while the terminal is being built. Signing,
// journal recovery and administrative controls still require owner auth.
export function ownerRouteProtected(path:string,method='GET'):boolean{
 try{for(let i=0;i<3&&path.includes('%');i++)path=decodeURIComponent(path);}catch{return true;}
 const portfolio=path==='/paper-research.json'||path==='/media/pat-lp-replay-v2.mp4'||path==='/media/replay-poster.png'||/^\/api\/(?:positions|history|wallet-intelligence|position-chart|position-break-even|exit-preview|check|range-alerts|volume-alerts|data-budget)(?:\/|$)/.test(path);
 if(portfolio)return !['GET','HEAD'].includes(method);
 if(path==='/api/refresh')return method!=='POST';
 return /^\/api\/(?:paybox|solana|evm|tx|x|debug)(?:\/|$)/.test(path)
  ||/^\/api\/(?:paper-fleet|paper-lab|bot|active-lp)\/control$/.test(path)
  ||path==='/api/scanner/control';
}
export async function ownerAuthenticated(req:Request,env:Env):Promise<boolean>{
 if(!env.TX_KEY)return false;
 const header=req.headers.get('x-terminal-key')||(/^Bearer /i.test(req.headers.get('authorization')||'')?req.headers.get('authorization')!.slice(7):null);
 if(header!==null)return header.length<=4096&&sameSecret(header,env.TX_KEY);
 const id=cookie(req);if(!id||!/^\w{64}$/.test(id))return false;
 const stored=await env.LP_CACHE.get<Session>('owner:session:'+await digest(id),'json');
 return !!stored&&Number.isFinite(stored.expiresAt)&&stored.expiresAt>Date.now()&&stored.keyFingerprint===await digest(env.TX_KEY);
}
export async function ownerAuthRoute(req:Request,env:Env):Promise<Response|null>{
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/auth/'))return null;
 if(path==='/api/auth/status'&&req.method==='GET')return json({authenticated:await ownerAuthenticated(req,env)});
 if(!['/api/auth/login','/api/auth/logout'].includes(path))return json({error:'Unknown authentication route.'},404);
 if(req.method!=='POST')return json({error:'Use a same-origin POST.'},405);
 if(req.headers.get('origin')!==origin(req,env))return json({error:'Open the terminal to unlock owner access.'},403);
 if(path==='/api/auth/logout'){
  const id=cookie(req);if(id&&/^\w{64}$/.test(id))await env.LP_CACHE.delete('owner:session:'+await digest(id));
  return json({authenticated:false},200,{'set-cookie':sessionCookie(req,env,'',0)});
 }
 if(!env.TX_KEY)return json({error:'Owner authentication is not configured.'},401);
 if(Number(req.headers.get('content-length')||0)>8192)return json({error:'Request too large.'},413);
 const raw=await req.text();if(raw.length>8192)return json({error:'Request too large.'},413);
 let input:any;try{input=JSON.parse(raw);}catch{return json({error:'Invalid login request.'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'Invalid login request.'},400);
 // Hash the provider-set client address before persisting the bounded throttle.
 const client=req.headers.get('cf-connecting-ip')||'local',bucket='owner:login:'+await digest(client),now=Date.now();
 const recent=await env.LP_CACHE.get<{at:number;attempts:number}>(bucket,'json'),attempts=recent&&now-recent.at<60000?recent.attempts:0;
 if(attempts>=10)return json({error:'Too many attempts. Wait one minute before trying again.'},429,{'retry-after':'60'});
 await env.LP_CACHE.put(bucket,JSON.stringify({at:recent&&now-recent.at<60000?recent.at:now,attempts:attempts+1}),{expirationTtl:60});
 if(typeof input.key!=='string'||input.key.length>4096||!await sameSecret(input.key,env.TX_KEY))return json({error:'Owner key did not match.'},401);
 const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''),old=cookie(req);
 if(old&&/^\w{64}$/.test(old))await env.LP_CACHE.delete('owner:session:'+await digest(old));
 await env.LP_CACHE.put('owner:session:'+await digest(id),JSON.stringify({expiresAt:now+TTL*1000,keyFingerprint:await digest(env.TX_KEY)}),{expirationTtl:TTL});
 return json({authenticated:true,expiresAt:now+TTL*1000},200,{'set-cookie':sessionCookie(req,env,id,TTL)});
}
export async function ownerGuard(req:Request,env:Env):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 // The normal Refresh button updates read-only data, without unlocking controls.
 if(path==='/api/refresh'&&req.method==='POST'&&req.headers.get('origin')!==origin(req,env))return json({error:'Open the terminal to refresh its data.'},403);
 if(!ownerRouteProtected(path,req.method))return null;
 if(!await ownerAuthenticated(req,env))return json({error:'Owner authentication required.',code:'owner_auth_required'},401,{'www-authenticate':'Bearer realm="LP Terminal"'});
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')!==origin(req,env))return json({error:'Open the terminal to change owner state.'},403);
 return null;
}
