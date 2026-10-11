import {withStillDemoObservation} from './still-demo-pools';
import {stillParkData} from './still-park';
import {parseStillRangeOptions} from './still-preflight-config';
import type {Env} from './env';
import {getSnapshot} from './refresh';
import {listStillPoolsWithSummaries, buildStillBaskets, getStillPreflight, getStillBasketPreflight} from './still-preflight';
const paths = new Set(['/api/still/wallet','/api/still/wallet-position','/api/still/park', '/api/still/pools', '/api/still/preflight', '/api/baskets', '/api/still/basket-preflight']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
export async function stillDemoRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!paths.has(url.pathname)) return null;
  if (!['GET', 'HEAD'].includes(req.method)) return json({error: 'This evidence endpoint is read-only.'}, 405);
  try {
    if(url.pathname==='/api/still/wallet'||url.pathname==='/api/still/wallet-position'){
      const address=url.searchParams.get('address')||'',pool=url.searchParams.get('poolAddress')||'',position=url.searchParams.get('positionAddress')||'';
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)||(url.pathname.endsWith('wallet-position')&&[pool,position].some(v=>!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))))return json({error:'Paste a valid Solana public address.'},400);
      const {readStillWallet,readStillWalletPosition}=await import('./still-wallet');
      return json(url.pathname.endsWith('wallet-position')?await readStillWalletPosition(env,address,pool,position):await readStillWallet(env,address));
    }
    if(url.pathname==='/api/still/park')return json(await stillParkData(env));
    if (url.pathname === '/api/still/pools' || url.pathname === '/api/baskets') {
      const snapshot = await withStillDemoObservation(await getSnapshot(env),env);
      return json({paper: true, updatedAt: snapshot.updatedAt, ...(url.pathname === '/api/baskets'
        ? {baskets: buildStillBaskets(snapshot)} : {pools: await listStillPoolsWithSummaries(snapshot,env),baskets:buildStillBaskets(snapshot)})});
    }
    const raw = url.searchParams.get('amountSol') ?? '0.5';
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(raw) || Number(raw) < 0.001 || Number(raw) > 10)
      return json({error: 'Choose between 0.001 and 10 practice SOL, with at most 9 decimal places.'}, 400);
    let result;
    if (url.pathname === '/api/still/preflight') {
      const address = url.searchParams.get('poolAddress') || '';
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json({error: 'Choose a pool from the live list.'}, 400);
      let options;try{options=parseStillRangeOptions(url.searchParams.has('range')?JSON.parse(url.searchParams.get('range')!):undefined);}catch{return json({error:'Choose a valid paper range and hold time.'},400);}
      result = await getStillPreflight(env, address, Number(raw), options, true);
    } else {
      const id = url.searchParams.get('basketId') || '';
      if (!['steady', 'busy', 'spicy'].includes(id)) return json({error: 'Choose a current basket.'}, 400);
      result = await getStillBasketPreflight(env, id, Number(raw),true);
    }
    return result ? json(result) : json({error: 'This pool or basket is unavailable. Return to the list and choose a current one.'}, 404);
  } catch {
    return json({error: 'Market evidence is unavailable right now. Try again shortly.'}, 503);
  }
}
