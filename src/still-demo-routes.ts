import type {Env} from './env';
import {getSnapshot} from './refresh';
import {listStillPools, buildStillBaskets, getStillPreflight, getStillBasketPreflight} from './still-preflight';
const paths = new Set(['/api/still/pools', '/api/still/preflight', '/api/baskets', '/api/still/basket-preflight']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
export async function stillDemoRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!paths.has(url.pathname)) return null;
  if (!['GET', 'HEAD'].includes(req.method)) return json({error: 'This evidence endpoint is read-only.'}, 405);
  try {
    if (url.pathname === '/api/still/pools' || url.pathname === '/api/baskets') {
      const snapshot = await getSnapshot(env);
      return json({paper: true, updatedAt: snapshot.updatedAt, ...(url.pathname === '/api/baskets'
        ? {baskets: buildStillBaskets(snapshot)} : {pools: listStillPools(snapshot)})});
    }
    const raw = url.searchParams.get('amountSol') ?? '0.5';
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(raw) || Number(raw) < 0.001 || Number(raw) > 10)
      return json({error: 'Choose between 0.001 and 10 practice SOL, with at most 9 decimal places.'}, 400);
    let result;
    if (url.pathname === '/api/still/preflight') {
      const address = url.searchParams.get('poolAddress') || '';
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json({error: 'Choose a pool from the live list.'}, 400);
      result = await getStillPreflight(env, address, Number(raw));
    } else {
      const id = url.searchParams.get('basketId') || '';
      if (!['steady', 'busy', 'spicy'].includes(id)) return json({error: 'Choose a current basket.'}, 400);
      result = await getStillBasketPreflight(env, id, Number(raw));
    }
    return result ? json(result) : json({error: 'This pool or basket is unavailable. Return to the list and choose a current one.'}, 404);
  } catch {
    return json({error: 'Market evidence is unavailable right now. Try again shortly.'}, 503);
  }
}
