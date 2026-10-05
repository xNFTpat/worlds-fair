export interface Env {
  LP_CACHE: KVNamespace;
  ASSETS?: Fetcher;
  RANGE_ALERTS?: DurableObjectNamespace;
  BACKGROUND_SCANNER?: DurableObjectNamespace;
  EVM_EXECUTION?: DurableObjectNamespace;
  MIN_TVL_USD: string;
  ROBINHOOD_RPC: string;
  ROBINHOOD_CHAIN_ID: string;
  WALLETS: string; // "name:address,name:address"
  SOLANA_RPC?: string;
  JUPITER_API_KEY?: string;
  PREVIEW_ORIGIN?: string;
  TX_KEY?: string; // Owner key for signing and controls; accepted by login or explicit auth headers.
  CF_VERSION_METADATA?: {id:string;tag?:string;timestamp:string};
  GECKO_KEY?: string; // CoinGecko Demo key: per-key quota instead of GeckoTerminal's per-IP one
}
