import { readFetch as fetch } from "./read-fetch";
import { Position, num } from "../schema";
import type { WalletRef } from "./meteora-positions";

// Uniswap V3 positions on Robinhood Chain (chainId 4663), read straight from the chain.
// No viem/ethers: the handful of calls we need are hand-encoded, which keeps the Worker tiny.
// Addresses from https://github.com/Uniswap/contracts/blob/main/deployments/4663.md
export const RH = {
  rpc: "https://rpc.mainnet.chain.robinhood.com",   // overridden by ROBINHOOD_RPC via setRobinhoodRpc()
  chainId: 4663,
  npm: "0x73991a25c818bf1f1128deaab1492d45638de0d3",      // NonfungiblePositionManager (V3)
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  // V4 PositionManager 0x58daec3116aae6d93017baaea7749052e8a04fa7 — not read yet (different position model).
  explorer: "https://robinhoodchain.blockscout.com",
};

export function setRobinhoodRpc(url: string) { RH.rpc = url; }

const SEL = {
  balanceOf: "0x70a08231",
  tokenOfOwnerByIndex: "0x2f745c59",
  positions: "0x99fbab88",
  getPool: "0x1698ee82",
  slot0: "0x3850c7bd",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
};

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const addr = (a: string) => pad(a.toLowerCase());
const uint = (n: bigint | number) => pad(BigInt(n).toString(16));
const word = (data: string, i: number) => "0x" + data.replace(/^0x/, "").slice(i * 64, (i + 1) * 64);
const toBig = (w: string) => BigInt(w);
const toInt24 = (w: string) => { const v = BigInt(w) & ((1n << 24n) - 1n); return Number(v >= 1n << 23n ? v - (1n << 24n) : v); };
const toAddr = (w: string) => "0x" + w.slice(-40);

// Alchemy's free tier occasionally answers "Unable to complete request at this time"; one patient retry.
async function call(rpc: string, to: string, data: string, block = "latest"): Promise<string> {
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, block] }),
    });
    const j = (await res.json().catch(() => ({}))) as { result?: string; error?: { message: string } };
    if (!j.error && res.ok && j.result && /^0x[0-9a-f]+$/i.test(j.result)) return j.result;
    lastErr = j.error?.message ?? `http ${res.status}`;
    if (!/unable to complete|too many|rate|429|timeout/i.test(lastErr)) break;
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error(`rpc: ${lastErr}`);
}

function decodeString(data: string): string {
  const hex = data.replace(/^0x/, "");
  if (hex.length <= 64) return "";
  const len = Number(BigInt("0x" + hex.slice(64, 128)));
  const bytes = hex.slice(128, 128 + len * 2);
  return decodeURIComponent(bytes.replace(/(..)/g, "%$1"));
}

export interface TokenMeta { symbol: string; decimals: number }
export type TokenMetaCache = Record<string, TokenMeta>;

export async function tokenMeta(rpc: string, token: string, cache: TokenMetaCache): Promise<TokenMeta> {
  const k = token.toLowerCase();
  if (cache[k]) return cache[k];
  const [s, d] = await Promise.all([call(rpc, token, SEL.symbol), call(rpc, token, SEL.decimals)]);
  const meta = { symbol: decodeString(s) || k.slice(0, 6), decimals: Number(BigInt(d || "0x12")) };
  cache[k] = meta;
  return meta;
}

// Amounts held by a V3 position at the current price. Standard Uniswap math in floats — fine for display.
function amounts(L: number, sqrtP: number, tickLower: number, tickUpper: number) {
  const sa = Math.pow(1.0001, tickLower / 2);
  const sb = Math.pow(1.0001, tickUpper / 2);
  if (sqrtP <= sa) return { a0: (L * (sb - sa)) / (sa * sb), a1: 0 };
  if (sqrtP >= sb) return { a0: 0, a1: L * (sb - sa) };
  return { a0: (L * (sb - sqrtP)) / (sqrtP * sb), a1: L * (sqrtP - sa) };
}

// Uniswap v3-core Tick.getFeeGrowthInside + Position.update, using uint256 wraparound.
export function accruedFees(global: bigint, lowerOutside: bigint, upperOutside: bigint,
  lastInside: bigint, liquidity: bigint, owed: bigint, tick: number, lower: number, upper: number): bigint {
  const u256 = (n: bigint) => BigInt.asUintN(256, n);
  const below = tick >= lower ? lowerOutside : u256(global - lowerOutside);
  const above = tick < upper ? upperOutside : u256(global - upperOutside);
  const inside = u256(global - below - above);
  return owed + u256(inside - lastInside) * liquidity / (1n << 128n);
}

// When was this NFT minted? Transfer(0x0 → anyone, tokenId) on the position manager. Cached by the caller.
export async function mintedAt(tokenId: bigint, rpc?: string): Promise<string | null> {
  rpc = rpc ?? RH.rpc;
  try {
    const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const topics = [TRANSFER, "0x" + "0".repeat(64), null, "0x" + tokenId.toString(16).padStart(64, "0")];
    // Try the full range first (cheap when the topic filter is this narrow); fall back to the last ~2M blocks.
    let logs: { blockNumber: string }[] | null = null;
    try { logs = await rpc_(rpc, "eth_getLogs", [{ address: RH.npm, fromBlock: "0x0", toBlock: "latest", topics }]); }
    catch {
      const latest = BigInt(await rpc_<string>(rpc, "eth_blockNumber", []));
      const from = latest > 2_000_000n ? latest - 2_000_000n : 0n;
      logs = await rpc_(rpc, "eth_getLogs", [{ address: RH.npm, fromBlock: "0x" + from.toString(16), toBlock: "latest", topics }]);
    }
    if (!logs?.length) return null;
    const blk = await rpc_<{ timestamp: string }>(rpc, "eth_getBlockByNumber", [logs[0].blockNumber, false]);
    return blk?.timestamp ? new Date(Number(BigInt(blk.timestamp)) * 1000).toISOString() : null;
  } catch { return null; }
}
async function rpc_<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (!res.ok || j.error || j.result == null) throw new Error(j.error?.message ?? `rpc HTTP ${res.status}: missing result`);
  return j.result as T;
}

export async function fetchUniswapPositions(
  w: WalletRef,
  metaCache: TokenMetaCache,
  usdPrice: (token: string) => number | null,
  rpc?: string,
  openedCache: Record<string, string> = {},
): Promise<Position[]> {
  rpc = rpc ?? RH.rpc;
  const now = new Date().toISOString();
  const block = await rpc_<string>(rpc, "eth_blockNumber", []);
  const atBlock = (to: string, data: string) => call(rpc!, to, data, block);
  const count = Number(toBig(await atBlock(RH.npm, SEL.balanceOf + addr(w.address))));
  if (count > 25) throw new Error("Wallet exceeds the current 25-NFT read limit; retaining saved positions.");
  const out: Position[] = [];

  for (let i = 0; i < Math.min(count, 25); i++) {
    const idHex = await atBlock(RH.npm, SEL.tokenOfOwnerByIndex + addr(w.address) + uint(i));
    const tokenId = toBig(idHex);
    const p = await atBlock(RH.npm, SEL.positions + uint(tokenId));
    const token0 = toAddr(word(p, 2));
    const token1 = toAddr(word(p, 3));
    const fee = Number(toBig(word(p, 4)));
    const tickLower = toInt24(word(p, 5));
    const tickUpper = toInt24(word(p, 6));
    const liquidity = toBig(word(p, 7));
    const owed0 = toBig(word(p, 10));
    const owed1 = toBig(word(p, 11));
    if (liquidity === 0n && owed0 === 0n && owed1 === 0n) continue; // closed, NFT not burned

    const pool = toAddr(await atBlock(RH.v3Factory, SEL.getPool + addr(token0) + addr(token1) + uint(fee)));
    const slot0 = await atBlock(pool, SEL.slot0);
    const sqrtPriceX96 = toBig(word(slot0, 0));
    const tick = toInt24(word(slot0, 1));

    const [m0, m1] = await Promise.all([tokenMeta(rpc, token0, metaCache), tokenMeta(rpc, token1, metaCache)]);
    const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
    const { a0, a1 } = amounts(Number(liquidity), sqrtP, tickLower, tickUpper);
    const amt0 = a0 / 10 ** m0.decimals, amt1 = a1 / 10 ** m1.decimals;
    const signedTick = (t: number) => uint(BigInt.asUintN(256, BigInt(t)));
    const [global0, global1, lowerData, upperData] = liquidity > 0n ? await Promise.all([
      atBlock(pool, "0xf3058399"), atBlock(pool, "0x46141319"),
      atBlock(pool, "0xf30dba93" + signedTick(tickLower)), atBlock(pool, "0xf30dba93" + signedTick(tickUpper)),
    ]) : ["0x0", "0x0", "0x" + "0".repeat(256), "0x" + "0".repeat(256)];
    const pending = (i: number, global: string, owed: bigint) => liquidity === 0n ? owed : accruedFees(
      BigInt(global), toBig(word(lowerData, 2+i)), toBig(word(upperData, 2+i)),
      toBig(word(p, 8+i)), liquidity, owed, tick, tickLower, tickUpper);
    const fee0 = Number(pending(0, global0, owed0)) / 10 ** m0.decimals, fee1 = Number(pending(1, global1, owed1)) / 10 ** m1.decimals;

    // Price of token0 in token1, then USD via whichever side we can price.
    const scale = 10 ** (m0.decimals - m1.decimals);
    const price = sqrtP * sqrtP * scale;
    const lower = Math.pow(1.0001, tickLower) * scale;
    const upper = Math.pow(1.0001, tickUpper) * scale;
    const p1 = usdPrice(token1) ?? (usdPrice(token0) != null ? usdPrice(token0)! / price : null);
    const p0 = usdPrice(token0) ?? (p1 != null ? p1 * price : null);
    const value = p0 != null && p1 != null ? amt0 * p0 + amt1 * p1 : null;
    const feesUsd = p0 != null && p1 != null ? fee0 * p0 + fee1 * p1 : null;

    const oc = openedCache[tokenId.toString()] ?? (await mintedAt(tokenId, rpc));
    if (oc) openedCache[tokenId.toString()] = oc;

    out.push({
      baseAddress: token0, quoteAddress: token1,
      openedAt: oc ?? null,
      id: `robinhood:${pool}:${tokenId}`,
      chain: "robinhood",
      venue: "uniswap-v3",
      poolAddress: pool,
      pair: `${m0.symbol}/${m1.symbol}`,
      wallet: w.name,
      walletAddress: w.address,
      depositedUsd: null,
      valueUsd: value,
      feesEarnedUsd: feesUsd,
      pnlUsd: null,
      inRange: tick >= tickLower && tick < tickUpper,
      lower, upper, current: price,
      note: `NFT #${tokenId}, ${fee / 1e4}% tier. Unclaimed amounts include accrued fees and stored tokens owed (which can include uncollected withdrawals). Read at block ${BigInt(block)}. ${fee0.toPrecision(6)} ${m0.symbol} + ${fee1.toPrecision(6)} ${m1.symbol}. No deposit history yet, so no PnL.`,
      url: `https://deltaliquidity.app/pools/${token0.toLowerCase() === RH.usdg.toLowerCase() || token0.toLowerCase() === RH.weth.toLowerCase() ? token1 : token0}`,
      fetchedAt: now,
    });
  }
  return out;
}

export async function ethBalance(address: string, rpc?: string): Promise<number> {
  rpc = rpc ?? RH.rpc;
  const res = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!res.ok || j.error || !j.result || !/^0x[0-9a-f]+$/i.test(j.result)) {
    throw new Error(j.error?.message ?? `Balance provider returned HTTP ${res.status} without a valid balance`);
  }
  return Number(BigInt(j.result)) / 1e18;
}
