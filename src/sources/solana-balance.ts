import { readFetch as fetch } from "./read-fetch";
// SOL and USDC balances. Read-only, no key. api.mainnet-beta.solana.com blocks Cloudflare's
// egress IPs, so we walk a list of keyless public endpoints; set SOLANA_RPC to pin your own.
const DEFAULT_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function rpc<T>(rpcs: string[], method: string, params: unknown[]): Promise<T> {
  let lastErr = "";
  for (const url of rpcs) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!r.ok) { lastErr = `${url}: ${r.status}`; continue; }
      const j = (await r.json()) as { result?: T; error?: { message: string } };
      if (j.result == null && !j.error) { lastErr = "Provider returned no result"; continue; }
      if (j.error) { lastErr = `${url}: ${j.error.message}`; continue; }
      return j.result as T;
    } catch (e: any) { lastErr = `${url}: ${e?.message ?? e}`; }
  }
  throw new Error(`solana rpc: ${lastErr}`);
}

export async function solanaBalances(address: string, preferred?: string): Promise<{ sol: number; usdc: number }> {
  const rpcs = preferred ? [preferred, ...DEFAULT_RPCS.filter((u) => u !== preferred)] : DEFAULT_RPCS;
  const [bal, tok] = await Promise.all([
    rpc<{ value: number }>(rpcs, "getBalance", [address]),
    rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }>(
      rpcs, "getTokenAccountsByOwner", [address, { mint: USDC }, { encoding: "jsonParsed" }]),
  ]);
  if (!Number.isFinite(bal.value) || !Array.isArray(tok.value)) throw new Error("Incomplete Solana balance response");
  const usdc = tok.value.reduce((a, x) => a + (x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  return { sol: bal.value / 1e9, usdc };
}
