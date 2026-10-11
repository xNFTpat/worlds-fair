import type {Env} from './env';

/** Server-only selection. A configured secret is never replaced after failure. */
export function stillReadRpcUrl(env: Env): string {
  if (env.STILL_RPC_URL !== undefined) {
    try {
      const url = new URL(env.STILL_RPC_URL);
      if (url.protocol !== 'https:' || url.username || url.password) throw Error();
    } catch {throw Error('Still read RPC configuration is unavailable.');}
    return env.STILL_RPC_URL;
  }
  return env.SOLANA_RPC ?? 'https://solana.api.onfinality.io/public';
}

/** Also covers inherited readers that accept SOLANA_RPC and durable alarms. */
export function stillReadEnvironment(env: Env): Env {
  return {...env, SOLANA_RPC: stillReadRpcUrl(env)};
}
