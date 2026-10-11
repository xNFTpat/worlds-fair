import type {Env} from './env';

// Non-routable marker: the read transport rejects it before making a request.
export const INVALID_STILL_RPC = 'https://still-rpc-unavailable.invalid/';
export function stillReadRpcState(env: Env): 'secret' | 'public-fallback' | 'invalid-secret' {
  if (env.STILL_RPC_URL === undefined) return 'public-fallback';
  try {
    const url = new URL(env.STILL_RPC_URL);
    if (url.protocol === 'https:' && !url.username && !url.password) return 'secret';
  } catch {}
  return 'invalid-secret';
}

/** A malformed secret fails closed at the reader, without breaking Home. */
export function stillReadRpcUrl(env: Env): string {
  const state = stillReadRpcState(env);
  return state === 'invalid-secret' ? INVALID_STILL_RPC : state === 'secret' ? env.STILL_RPC_URL! : env.SOLANA_RPC ?? 'https://solana.api.onfinality.io/public';
}

/** Also covers inherited readers that accept SOLANA_RPC and durable alarms. */
export function stillReadEnvironment(env: Env): Env {
  return {...env, SOLANA_RPC: stillReadRpcUrl(env)};
}
