// Execution layer, v0.4 step 1: swaps on Robinhood Chain through the Uniswap V3 pool directly.
//
// Contract, agreed with Pat:
//   1. Nothing here signs. The Worker builds an exact, fully-specified transaction (to, data,
//      value, nonce, gas, fees, chainId) and shows it. Paybox signs it in the chat window with
//      Pat's passkey. The Worker only ever broadcasts bytes that were signed elsewhere.
//   2. Every build is quoted first, with a minimum-out baked in, so a bad fill reverts on-chain.
//   3. Amounts are small by design while we learn the plumbing.

import { Pool } from "./schema";
import { decodeMulticall, rawPair, units } from "./exit-review";

import { RH as RHV } from "./sources/uniswap-positions";
export const RH = {
  get rpc() { return RHV.rpc; },
  chainId: 4663,
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  explorer: "https://robinhoodchain.blockscout.com",
};
const SEL = {
  exactInputSingle: "0x04e45aaf",   // (tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96)
  quote: "0xc6a5026a",              // quoteExactInputSingle((tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96))
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  decimals: "0x313ce567",
  balanceOf: "0x70a08231",
};
const QUOTES = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);
const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
const addr = (a: string) => pad(a.toLowerCase());
const uint = (n: bigint) => pad(n.toString(16));
const hex = (n: bigint) => "0x" + n.toString(16);

async function rpc<T = string>(method: string, params: unknown[], url?: string): Promise<T> {
  url = url ?? RH.rpc;
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string; data?: string } };
  if (j.error) throw new Error(j.error.message + (j.error.data ? ` ${String(j.error.data).slice(0, 100)}` : ""));
  if (!r.ok || j.result == null) throw new Error("Provider did not return a valid transaction read");
  return j.result as T;
}
const call = (to: string, data: string, from?: string, value?: bigint) =>
  rpc<string>("eth_call", [{ to, data, ...(from ? { from } : {}), ...(value ? { value: hex(value) } : {}) }, "latest"]);

export interface UnsignedTx {
  chainId: number; from: string; to: string; data: string; value: string;
  nonce: number;   // number, not hex: Paybox encoded "0x0" as a non-canonical zero byte
  gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; type: "0x2";
}
export interface SwapPlan {
  kind: "swap";
  chain: "robinhood";
  pool: string; pair: string; venue: string;
  side: "buy" | "sell";
  tokenIn: { address: string; symbol: string; amount: string; amountRaw: string };
  tokenOut: { address: string; symbol: string; expected: string; minimum: string; expectedRaw: string; minimumRaw: string };
  feeTier: number; slippageBps: number;
  priceImpactNote: string;
  needsApproval?: { token: string; spender: string; tx: UnsignedTx } | null;
  tx: UnsignedTx;
  humanSummary: string;
  builtAt: string;
}

// Fill in nonce, gas, and fees for a call so the signer has nothing to guess.
async function finalize(from: string, to: string, data: string, value: bigint): Promise<UnsignedTx> {
  const [nonce, gasPrice, est] = await Promise.all([
    rpc<string>("eth_getTransactionCount", [from, "pending"]),
    rpc<string>("eth_gasPrice", []),
    rpc<string>("eth_estimateGas", [{ from, to, data, value: hex(value) }]),
  ]);
  const gp = BigInt(gasPrice);
  const gas = (BigInt(est) * 13n) / 10n;                 // 30% headroom; Orbit chains bill by actual use
  const maxFee = gp * 2n;                                 // Robinhood gas is fractions of a cent; be generous
  return {
    chainId: RH.chainId, from, to, data, value: hex(value),
    nonce: Number(BigInt(nonce)), gas: hex(gas), maxFeePerGas: hex(maxFee), maxPriorityFeePerGas: hex(gp / 10n || 1n), type: "0x2",
  };
}

// Buy the pool's non-quote token with ETH, through this exact V3 pool. Router wraps ETH itself.
export async function buildBuyWithEth(pool: Pool, wallet: string, amountEth: number, slippageBps = 100): Promise<SwapPlan> {
  if (pool.chain !== "robinhood" || pool.venue !== "uniswap-v3") throw new Error("swap builder covers Uniswap V3 pools on Robinhood Chain for now");
  if (pool.feeTier == null) throw new Error("pool fee tier unknown; refresh and retry");
  const isQuote = (s: string) => QUOTES.has(s.toUpperCase());
  const tokenOut = isQuote(pool.base.symbol) && !isQuote(pool.quote.symbol) ? pool.quote : pool.base;
  const other = tokenOut === pool.base ? pool.quote : pool.base;
  if (other.address.toLowerCase() !== RH.weth.toLowerCase()) throw new Error(`this pool is ${pool.pair}; buying with ETH needs a WETH pool. Use the USDG builder (next).`);

  const fee = BigInt(Math.round(pool.feeTier * 1e6));
  const amountIn = BigInt(Math.round(amountEth * 1e18));
  const balance = BigInt(await rpc<string>("eth_getBalance", [wallet, "latest"]));
  if (balance < amountIn + 2_000_000_000_000_000n) throw new Error(`pateth holds ${Number(balance) / 1e18} ETH; need ${amountEth} plus a gas reserve`);

  // Quote through the exact pool, then set a floor.
  const q = await call(RH.quoterV2, SEL.quote + addr(RH.weth) + addr(tokenOut.address) + uint(amountIn) + uint(fee) + uint(0n));
  const expected = BigInt("0x" + q.slice(2, 66));
  const minimum = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
  let dec = 18; try { dec = Number(BigInt(await call(tokenOut.address, SEL.decimals))); } catch { /* */ }

  const data = SEL.exactInputSingle + addr(RH.weth) + addr(tokenOut.address) + uint(fee) + addr(wallet) + uint(amountIn) + uint(minimum) + uint(0n);
  const tx = await finalize(wallet, RH.swapRouter02, data, amountIn);

  const fmt = (n: bigint, d: number) => (Number(n) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return {
    kind: "swap", chain: "robinhood", pool: pool.id, pair: pool.pair, venue: pool.venue, side: "buy",
    tokenIn: { address: RH.weth, symbol: "ETH", amount: amountEth.toString(), amountRaw: amountIn.toString() },
    tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, expected: fmt(expected, dec), minimum: fmt(minimum, dec), expectedRaw: expected.toString(), minimumRaw: minimum.toString() },
    feeTier: pool.feeTier, slippageBps,
    priceImpactNote: `Quoted through the ${pool.pair} ${(pool.feeTier * 100).toFixed(2)}% pool only — no router path, no other pools touched.`,
    needsApproval: null,
    tx,
    humanSummary: `Swap ${amountEth} ETH → at least ${fmt(minimum, dec)} ${tokenOut.symbol} (expected ${fmt(expected, dec)}) via Uniswap V3 ${pool.pair} ${(pool.feeTier * 100).toFixed(2)}% on Robinhood Chain. Reverts if the fill is worse than ${slippageBps / 100}% from quote.`,
    builtAt: new Date().toISOString(),
  };
}

export async function broadcast(rawSigned: string): Promise<{ hash: string; explorer: string; status: "pending" | "success" | "reverted" }> {
  const hash = await rpc<string>("eth_sendRawTransaction", [rawSigned]);
  // Robinhood blocks are ~100ms; give it a few seconds for a receipt.
  let status: "pending" | "success" | "reverted" = "pending";
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const rc = await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]);
    if (rc) { status = rc.status === "0x1" ? "success" : "reverted"; break; }
  }
  return { hash, explorer: `${RH.explorer}/tx/${hash}`, status };
}

// Kept for the read-only proposal endpoint.
export interface Proposal { pool: Pool; side: "open" | "close" | "rebalance"; amountUsd: number; range?: { lower: number; upper: number }; expectedFees24hUsd: number | null; rationale: string }
export function propose(pool: Pool, amountUsd: number, rangePct = 0.1): Proposal {
  const px = pool.priceUsd ?? 0;
  const share = pool.tvlUsd ? amountUsd / (pool.tvlUsd + amountUsd) : null;
  return {
    pool, side: "open", amountUsd,
    range: px ? { lower: px * (1 - rangePct), upper: px * (1 + rangePct) } : undefined,
    expectedFees24hUsd: share != null && pool.fees24hUsd != null ? share * pool.fees24hUsd : null,
    rationale: `Naive: ${((share ?? 0) * 100).toFixed(3)}% of pool at current 24h fee run-rate.`,
  };
}

// ───────────────────────────── Open a V3 position (Robinhood) ─────────────────────────────
// Two transactions: approve the token to the position manager (if needed), then mint. ETH side is
// paid as msg.value and wrapped by the position manager; leftover ETH is refunded in the same call.
const NPM = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const SEL2 = {
  mint: "0x88316456", refundETH: "0x12210e8a", multicall: "0xac9650d8",
  slot0: "0x3850c7bd", tickSpacing: "0xd0c93a7c",
};
const int24 = (n: number) => { const v = BigInt.asUintN(256, BigInt(n)); return pad(v.toString(16)); };
const toInt24 = (w: string) => { const v = BigInt(w) & ((1n << 24n) - 1n); return Number(v >= 1n << 23n ? v - (1n << 24n) : v); };
const word = (data: string, i: number) => "0x" + data.replace(/^0x/, "").slice(i * 64, (i + 1) * 64);

export interface OpenPlan {
  kind: "open-v3"; chain: "robinhood"; pool: string; pair: string;
  token: { address: string; symbol: string; amount: string; amountRaw: string };
  eth: { amount: string; amountRaw: string };
  range: { lower: number; upper: number; current: number; rangePct: number; tickLower: number; tickUpper: number };
  approvalTx: UnsignedTx | null;   // null if allowance already covers it
  mintTx: UnsignedTx;
  humanSummary: string; builtAt: string;
}

export async function buildOpenV3(pool: Pool, wallet: string, tokenAmount: number | null, rangePct: number, maxEth: number): Promise<OpenPlan> {
  if (pool.chain !== "robinhood" || pool.venue !== "uniswap-v3") throw new Error("position opener covers Uniswap V3 pools on Robinhood Chain");
  if (pool.feeTier == null) throw new Error("pool fee tier unknown");
  const isQuote = (s: string) => QUOTES.has(s.toUpperCase());
  const tok = isQuote(pool.base.symbol) && !isQuote(pool.quote.symbol) ? pool.quote : pool.base;
  const other = tok === pool.base ? pool.quote : pool.base;
  if (other.address.toLowerCase() !== RH.weth.toLowerCase()) throw new Error(`${pool.pair} isn't a WETH pair; ETH-paired pools only for now`);

  // Pool state
  const [slot0, spacingHex, decHex, balHex, allowHex, ethHex] = await Promise.all([
    call(pool.address, SEL2.slot0), call(pool.address, SEL2.tickSpacing), call(tok.address, SEL.decimals),
    call(tok.address, SEL.balanceOf + addr(wallet)), call(tok.address, SEL.allowance + addr(wallet) + addr(NPM)),
    rpc<string>("eth_getBalance", [wallet, "latest"]),
  ]);
  const tick = toInt24(word(slot0, 1));
  const spacing = Number(BigInt(spacingHex));
  const dec = Number(BigInt(decHex));
  const tokBal = BigInt(balHex), allowance = BigInt(allowHex), ethBal = BigInt(ethHex);

  const wethIs0 = RH.weth.toLowerCase() < tok.address.toLowerCase();
  const [token0, token1] = wethIs0 ? [RH.weth, tok.address] : [tok.address, RH.weth];
  const fee = Math.round(pool.feeTier * 1e6);

  // Symmetric range around the current tick, snapped to tick spacing.
  const width = Math.round(Math.log(1 + rangePct) / Math.log(1.0001));
  const snap = (t: number) => Math.floor(t / spacing) * spacing;
  const tickLower = snap(tick - width), tickUpper = snap(tick + width) + spacing;
  const sqrtP = Math.pow(1.0001, tick / 2), sa = Math.pow(1.0001, tickLower / 2), sb = Math.pow(1.0001, tickUpper / 2);

  // Amount of the token to deposit: what they asked, else the whole balance.
  const wantTok = tokenAmount != null ? BigInt(Math.floor(tokenAmount * 10 ** dec)) : tokBal;
  if (wantTok <= 0n) throw new Error(`pateth holds no ${tok.symbol}`);
  if (wantTok > tokBal) throw new Error(`asked for ${tokenAmount} ${tok.symbol}, wallet holds ${Number(tokBal) / 10 ** dec}`);

  // Liquidity implied by the token side, then the ETH that pairs with it at the current price.
  // token amounts in raw units; price in raw token1/token0.
  const tokAmt = Number(wantTok);
  let L: number, ethAmt: number;
  if (wethIs0) { // token is token1: amount1 = L(sqrtP - sa); amount0 = L(sb - sqrtP)/(sqrtP*sb)
    L = tokAmt / (sqrtP - sa); ethAmt = (L * (sb - sqrtP)) / (sqrtP * sb);
  } else {       // token is token0
    L = (tokAmt * sqrtP * sb) / (sb - sqrtP); ethAmt = L * (sqrtP - sa);
  }
  const ethRaw = BigInt(Math.ceil(ethAmt * 1.01)); // 1% headroom; leftover is refunded
  const maxEthRaw = BigInt(Math.floor(maxEth * 1e18));
  if (ethRaw > maxEthRaw) throw new Error(`needs ${Number(ethRaw) / 1e18} ETH to pair with ${Number(wantTok) / 10 ** dec} ${tok.symbol}; cap is ${maxEth}. Lower the token amount or raise the cap.`);
  if (ethRaw + 2_000_000_000_000_000n > ethBal) throw new Error(`not enough ETH: needs ${Number(ethRaw) / 1e18} plus gas reserve, wallet has ${Number(ethBal) / 1e18}`);

  const amount0 = wethIs0 ? ethRaw : wantTok, amount1 = wethIs0 ? wantTok : ethRaw;
  const min = (x: bigint) => (x * 95n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const mintData = SEL2.mint + addr(token0) + addr(token1) + uint(BigInt(fee)) + int24(tickLower) + int24(tickUpper)
    + uint(amount0) + uint(amount1) + uint(min(amount0)) + uint(min(amount1)) + addr(wallet) + uint(deadline);
  // multicall([mint, refundETH])
  const enc = (d: string) => { const b = d.replace(/^0x/, ""); return uint(BigInt(b.length / 2)) + b.padEnd(Math.ceil(b.length / 64) * 64, "0"); };
  const m = enc(mintData), r = enc(SEL2.refundETH);
  const calldata = SEL2.multicall + uint(0x20n) + uint(2n) + uint(0x40n) + uint(BigInt(0x40 + m.length / 2)) + m + r;

  const approvalTx = allowance >= wantTok ? null
    : await finalize(wallet, tok.address, SEL.approve + addr(NPM) + uint(wantTok), 0n);
  // The mint's nonce must follow the approval's.
  const mintTx = approvalTx
    ? { ...(await finalizeAfter(wallet, NPM, calldata, ethRaw, approvalTx.nonce + 1)) }
    : await finalize(wallet, NPM, calldata, ethRaw);

  const priceRaw = (t: number) => Math.pow(1.0001, t);
  const tokPerEth = (t: number) => (wethIs0 ? priceRaw(t) : 1 / priceRaw(t)) * 10 ** (18 - dec);
  const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  return {
    kind: "open-v3", chain: "robinhood", pool: pool.id, pair: pool.pair,
    token: { address: tok.address, symbol: tok.symbol, amount: fmt(Number(wantTok) / 10 ** dec), amountRaw: wantTok.toString() },
    eth: { amount: fmt(Number(ethRaw) / 1e18, 6), amountRaw: ethRaw.toString() },
    range: { lower: tokPerEth(wethIs0 ? tickLower : tickUpper), upper: tokPerEth(wethIs0 ? tickUpper : tickLower), current: tokPerEth(tick), rangePct, tickLower, tickUpper },
    approvalTx, mintTx,
    humanSummary: `Open ${pool.pair} ${(pool.feeTier * 100).toFixed(2)}% position: ${fmt(Number(wantTok) / 10 ** dec)} ${tok.symbol} + up to ${fmt(Number(ethRaw) / 1e18, 5)} ETH, range ±${Math.round(rangePct * 100)}% (ticks ${tickLower}…${tickUpper}), min 95% of each. ${approvalTx ? "Two signatures: approve, then mint." : "One signature: mint."}`,
    builtAt: new Date().toISOString(),
  };
}

// Like finalize() but with an explicit nonce (for the second tx in a pair). Gas is estimated as if
// the approval had already landed by simulating with a state that assumes allowance — not possible
// via plain eth_call, so we use a generous fixed gas for mint instead.
async function finalizeAfter(from: string, to: string, data: string, value: bigint, nonce: number): Promise<UnsignedTx> {
  const gasPrice = BigInt(await rpc<string>("eth_gasPrice", []));
  return {
    chainId: RH.chainId, from, to, data, value: hex(value),
    nonce, gas: hex(900_000n), maxFeePerGas: hex(gasPrice * 2n), maxPriorityFeePerGas: hex(gasPrice / 10n || 1n), type: "0x2",
  };
}

// ───────────────────────────── Close a V3 position, sell a token for ETH ─────────────────────────────
const SEL3 = {
  decrease: "0x0c49ccbe", collect: "0xfc6f7865", unwrap: "0x49404b7c", sweep: "0xdf2ab5bb", burn: "0x42966c68",
  multicall: "0xac9650d8", positions: "0x99fbab88", slot0: "0x3850c7bd",
};
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002"; // SwapRouter02: "send output to the router itself"
const encBytes = (d: string) => { const b = d.replace(/^0x/, ""); return uint(BigInt(b.length / 2)) + b.padEnd(Math.ceil(b.length / 64) * 64, "0"); };
function multicall(sel: string, calls: string[]): string {
  const encs = calls.map(encBytes);
  let off = 32 * calls.length, offs = "";
  for (const e of encs) { offs += uint(BigInt(off)); off += e.length / 2; }
  return sel + uint(0x20n) + uint(BigInt(calls.length)) + offs + encs.join("");
}
const MAX128 = (1n << 128n) - 1n;

export interface ClosePlan {
  kind: "close-v3"; chain: "robinhood"; tokenId: string; pair: string;
  expected: { token: { symbol: string; amount: string }; eth: string; feesToken: string; feesEth: string };
  withdrawalMinimum: { eth: string; token: string };
  tx: UnsignedTx; humanSummary: string; builtAt: string;
}

export async function buildCloseV3(tokenId: bigint, wallet: string, slippageBps = 300): Promise<ClosePlan> {
  if (tokenId <= 0n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 2000) throw new Error("Invalid position or slippage");
  const owner = await call(NPM, "0x6352211e" + uint(tokenId));
  if (owner.slice(-40).toLowerCase() !== wallet.slice(2).toLowerCase()) throw new Error("This wallet does not own the position");
  const p = await call(NPM, SEL3.positions + uint(tokenId));
  const token0 = "0x" + p.slice(2).slice(2 * 64 + 24, 3 * 64), token1 = "0x" + p.slice(2).slice(3 * 64 + 24, 4 * 64);
  const fee = Number(BigInt("0x" + p.slice(2).slice(4 * 64, 5 * 64)));
  const tickLower = toInt24("0x" + p.slice(2).slice(5 * 64, 6 * 64)), tickUpper = toInt24("0x" + p.slice(2).slice(6 * 64, 7 * 64));
  const liquidity = BigInt("0x" + p.slice(2).slice(7 * 64, 8 * 64));
  const owed0 = BigInt("0x" + p.slice(2).slice(10 * 64, 11 * 64)), owed1 = BigInt("0x" + p.slice(2).slice(11 * 64, 12 * 64));
  if (liquidity === 0n && owed0 === 0n && owed1 === 0n) throw new Error(`position #${tokenId} is already empty`);

  // Current price → expected amounts out for this liquidity.
  const poolAddress = await poolAddr(token0, token1, fee);
  const slot0 = await call(poolAddress, SEL3.slot0);
  const sqrtP = Number(BigInt("0x" + slot0.slice(2).slice(0, 64))) / 2 ** 96;
  const sa = Math.pow(1.0001, tickLower / 2), sb = Math.pow(1.0001, tickUpper / 2), L = Number(liquidity);
  let a0 = 0, a1 = 0;
  if (sqrtP <= sa) a0 = (L * (sb - sa)) / (sa * sb); else if (sqrtP >= sb) a1 = L * (sb - sa); else { a0 = (L * (sb - sqrtP)) / (sqrtP * sb); a1 = L * (sqrtP - sa); }
  const min0 = BigInt(Math.floor(a0 * (1 - slippageBps / 10_000))), min1 = BigInt(Math.floor(a1 * (1 - slippageBps / 10_000)));

  const wethIs0 = token0.toLowerCase() === RH.weth.toLowerCase();
  if (!wethIs0 && token1.toLowerCase() !== RH.weth.toLowerCase()) throw new Error("Close to native ETH requires a WETH-paired position");
  const tok = wethIs0 ? token1 : token0;
  let dec = 18, sym = tok.slice(0, 6);
  try { dec = Number(BigInt(await call(tok, SEL.decimals))); } catch { /* */ }
  try { const s = await call(tok, "0x95d89b41"); const len = Number(BigInt("0x" + s.slice(2).slice(64, 128))); sym = decodeURIComponent(s.slice(2).slice(128, 128 + len * 2).replace(/(..)/g, "%$1")); } catch { /* */ }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const calls: string[] = [];
  if (liquidity > 0n) calls.push(SEL3.decrease + uint(tokenId) + uint(liquidity) + uint(min0) + uint(min1) + uint(deadline));
  calls.push(SEL3.collect + uint(tokenId) + addr("0x0000000000000000000000000000000000000000") + uint(MAX128) + uint(MAX128)); // recipient 0 = keep in NPM for unwrap/sweep
  calls.push(SEL3.unwrap + uint(wethIs0 ? min0 : min1) + addr(wallet));
  calls.push(SEL3.sweep + addr(tok) + uint(wethIs0 ? min1 : min0) + addr(wallet));
  calls.push(SEL3.burn + uint(tokenId));
  const data = multicall(SEL3.multicall, calls);
  const tx = await finalize(wallet, NPM, data, 0n);

  const fmt = (n: number, d = 5) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  const ethOut = (wethIs0 ? a0 : a1) / 1e18, tokOut = (wethIs0 ? a1 : a0) / 10 ** dec;
  const feesEth = Number(wethIs0 ? owed0 : owed1) / 1e18, feesTok = Number(wethIs0 ? owed1 : owed0) / 10 ** dec;
  return {
    kind: "close-v3", chain: "robinhood", tokenId: tokenId.toString(), pair: `${wethIs0 ? "WETH" : sym}/${wethIs0 ? sym : "WETH"}`,
    expected: { token: { symbol: sym, amount: fmt(tokOut) }, eth: fmt(ethOut, 6), feesToken: fmt(feesTok), feesEth: fmt(feesEth, 6) },
    withdrawalMinimum: {eth: units(wethIs0 ? min0 : min1,18), token: units(wethIs0 ? min1 : min0,dec)},
    tx,
    humanSummary: `Close position #${tokenId}: withdraw ≈${fmt(ethOut, 5)} ETH + ${fmt(tokOut)} ${sym} (plus claimable fees ${fmt(feesEth, 6)} ETH / ${fmt(feesTok)} ${sym}), unwrap to ETH, send everything to pateth, burn the NFT. Min out ${slippageBps / 100}% below current.`,
    builtAt: new Date().toISOString(),
  };
}

// Read-only preview: eth_call executes the full close against temporary state.
// Collect includes accrued fees and any earlier uncollected withdrawals.
export async function previewCloseV3(tokenId: bigint, wallet: string) {
  const plan = await buildCloseV3(tokenId, wallet, 100);
  const block = await rpc<string>("eth_blockNumber", []);
  const [simulation, position, balance] = await Promise.all([
    rpc<string>("eth_call", [{from: wallet, to: plan.tx.to, data: plan.tx.data, value: "0x0"}, block]),
    rpc<string>("eth_call", [{to: NPM, data: SEL3.positions + uint(tokenId)}, block]),
    rpc<string>("eth_getBalance", [wallet, block]),
  ]);
  const results = decodeMulticall(simulation);
  if (results.length !== 4 && results.length !== 5) throw new Error("Unexpected close simulation");
  const collected = rawPair(results[results.length === 5 ? 1 : 0]);
  const token0 = "0x" + position.slice(2 + 2 * 64 + 24, 2 + 3 * 64);
  const token1 = "0x" + position.slice(2 + 3 * 64 + 24, 2 + 4 * 64);
  const wethIs0 = token0.toLowerCase() === RH.weth.toLowerCase();
  const token = wethIs0 ? token1 : token0;
  const decimals = Number(BigInt(await call(token, SEL.decimals)));
  const gasBudget = BigInt(plan.tx.gas) * BigInt(plan.tx.maxFeePerGas);
  return {
    kind: "withdraw-both", chain: "robinhood", chainId: RH.chainId,
    wallet, tokenId: tokenId.toString(), block: BigInt(block).toString(),
    builtAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    proceeds: {eth: units(collected[wethIs0 ? 0 : 1], 18), token: {address: token, symbol: plan.expected.token.symbol, amount: units(collected[wethIs0 ? 1 : 0], decimals)}},
    withdrawalMinimum: plan.withdrawalMinimum,
    gasBudgetEth: units(gasBudget,18), nativeBalanceEth: units(BigInt(balance),18),
    canCoverGas: BigInt(balance) >= gasBudget, transactionCount: 1, slippageBps: 100,
    note: "Includes accrued fees and any uncollected withdrawals. WETH returns as ETH. The other token stays as a token; converting it to ETH needs a separate quote. Gas budget uses the gas limit and maximum fee, not the final charge. Preview only; refresh before signing.",
  };
}

async function poolAddr(token0: string, token1: string, fee: number): Promise<string> {
  const r = await call("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA", "0x1698ee82" + addr(token0) + addr(token1) + uint(BigInt(fee)));
  return "0x" + r.slice(-40);
}

export interface SellPlan {
  kind: "sell"; chain: "robinhood"; pool: string; pair: string;
  tokenIn: { address: string; symbol: string; amount: string; amountRaw: string };
  ethOut: { expected: string; minimum: string };
  approvalTx: UnsignedTx | null; tx: UnsignedTx; humanSummary: string; builtAt: string;
}

// Sell the pool's non-quote token for ETH through this V3 pool: exactInputSingle → router, then unwrapWETH9 → wallet.
export async function buildSellForEth(pool: Pool, wallet: string, tokenAmount: number | null, slippageBps = 100): Promise<SellPlan> {
  if (pool.chain !== "robinhood" || pool.venue !== "uniswap-v3" || pool.feeTier == null) throw new Error("sell covers Uniswap V3 WETH pairs on Robinhood");
  const isQuote = (s: string) => QUOTES.has(s.toUpperCase());
  const tok = isQuote(pool.base.symbol) && !isQuote(pool.quote.symbol) ? pool.quote : pool.base;
  const other = tok === pool.base ? pool.quote : pool.base;
  if (other.address.toLowerCase() !== RH.weth.toLowerCase()) throw new Error(`${pool.pair} isn't a WETH pair`);
  let dec = 18; try { dec = Number(BigInt(await call(tok.address, SEL.decimals))); } catch { /* */ }
  const bal = BigInt(await call(tok.address, SEL.balanceOf + addr(wallet)));
  const amountIn = tokenAmount != null ? BigInt(Math.floor(tokenAmount * 10 ** dec)) : bal;
  if (amountIn <= 0n) throw new Error(`pateth holds no ${tok.symbol}`);
  if (amountIn > bal) throw new Error(`asked for ${tokenAmount} ${tok.symbol}, wallet holds ${Number(bal) / 10 ** dec}`);
  const fee = BigInt(Math.round(pool.feeTier * 1e6));

  const q = await call(RH.quoterV2, SEL.quote + addr(tok.address) + addr(RH.weth) + uint(amountIn) + uint(fee) + uint(0n));
  const expected = BigInt("0x" + q.slice(2, 66));
  const minimum = (expected * BigInt(10_000 - slippageBps)) / 10_000n;

  const allowance = BigInt(await call(tok.address, SEL.allowance + addr(wallet) + addr(RH.swapRouter02)));
  const approvalTx = allowance >= amountIn ? null : await finalize(wallet, tok.address, SEL.approve + addr(RH.swapRouter02) + uint(amountIn), 0n);

  const swap = SEL.exactInputSingle + addr(tok.address) + addr(RH.weth) + uint(fee) + addr(ADDRESS_THIS) + uint(amountIn) + uint(minimum) + uint(0n);
  const unwrap = SEL3.unwrap + uint(minimum) + addr(wallet);
  const data = multicall(SEL3.multicall, [swap, unwrap]);
  const tx = approvalTx ? await finalizeAfter(wallet, RH.swapRouter02, data, 0n, approvalTx.nonce + 1) : await finalize(wallet, RH.swapRouter02, data, 0n);

  const fmt = (n: bigint, d: number) => (Number(n) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return {
    kind: "sell", chain: "robinhood", pool: pool.id, pair: pool.pair,
    tokenIn: { address: tok.address, symbol: tok.symbol, amount: fmt(amountIn, dec), amountRaw: amountIn.toString() },
    ethOut: { expected: fmt(expected, 18), minimum: fmt(minimum, 18) },
    approvalTx, tx,
    humanSummary: `Sell ${fmt(amountIn, dec)} ${tok.symbol} → at least ${fmt(minimum, 18)} ETH (expected ${fmt(expected, 18)}) via ${pool.pair} ${(pool.feeTier * 100).toFixed(2)}%, unwrapped to ETH in pateth. ${approvalTx ? "Two signatures: approve, then sell." : "One signature."}`,
    builtAt: new Date().toISOString(),
  };
}
