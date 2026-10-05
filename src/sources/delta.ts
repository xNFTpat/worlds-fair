import { Pool } from "../schema";

// deltaliquidity.app — Meteora-style LP frontend on Robinhood Chain (stakes + shaped positions).
// No public API found in their docs as of Sep 2026. Ask in their Discord.
// Until then the Uniswap pools from DexPaprika are the same underlying liquidity, and
// Delta pool pages are reachable at https://deltaliquidity.app/pools/<token-address>.
export async function fetchDelta(): Promise<Pool[]> {
  return [];
}


