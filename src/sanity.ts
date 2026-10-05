import { Pool } from "./schema";

// Swap sanity: cheap, read-only checks that catch the tokens that fail a $10 buy on the UI
// with "try adjusting slippage". Nothing here signs or sends.

export type Severity = "ok" | "warn" | "bad" | "info";
export interface Finding { severity: Severity; title: string; detail: string }
export interface Sanity { pool: string; chain: string; token: string; findings: Finding[]; verdict: Severity; ranAt: string }

// ───────────────────────────── Robinhood Chain (EVM) ─────────────────────────────
import { RH as RHV } from "./sources/uniswap-positions";
const RPC = () => RHV.rpc;
const QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"; // V4 holds all pool tokens here
const QUOTES = new Set(["USDG", "WETH", "ETH", "USDC", "USDT"]);

const SEL = { transfer: "0xa9059cbb", balanceOf: "0x70a08231", decimals: "0x313ce567", quote: "0xc6a5026a" };
const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
const addr = (a: string) => pad(a.toLowerCase());
const uint = (n: bigint) => pad(n.toString(16));

// Function selectors that tax / honeypot / restricted tokens tend to expose. Presence in bytecode
// is a signal, not proof — but a plain ERC-20 has none of these.
const SIGNATURES: Record<string, [string, string][]> = {
  tax: [["buyTax()","4f7041a5"],["sellTax()","cc1776d3"],["_buyTax()","42a11095"],["_sellTax()","ca9ec199"],["taxFee()","a071dcf4"],["_taxFee()","3b124fe7"],["setTaxes(uint256,uint256)","c647b20e"],["setFees(uint256,uint256)","0b78f9c0"],["setBuyFee(uint256)","0cc835a3"],["setSellFee(uint256)","8b4cee08"],["updateBuyFees(...)","8095d564"],["updateSellFees(...)","c17b5b8c"],["totalFees()","13114a9d"],["buyTotalFees()","d85ba063"],["sellTotalFees()","6a486a8e"],["transferTax()","8124f7ac"],["setTransferTax(uint256)","8b525903"],["marketingFee()","6b67c4df"],["liquidityFee()","98118cb4"],["excludeFromFees(address,bool)","c0246668"],["excludeFromFee(address)","437823ec"],["isExcludedFromFee(address)","5342acb4"],["isExcludedFromFees(address)","4fbee193"],["feeExempt(address)","398daa85"]],
  limits: [["maxWallet()","f8b45b05"],["_maxWalletSize()","8f9a55c0"],["maxTransactionAmount()","c8c8ebe4"],["_maxTxAmount()","7d1db4a5"],["maxTxAmount()","8c0b5e22"],["setMaxWallet(uint256)","5d0044ca"],["removeLimits()","751039fc"],["limitsInEffect()","4a62bb65"]],
  blacklist: [["blacklist(address)","f9f92be4"],["isBlacklisted(address)","fe575a87"],["_isBlacklisted(address)","1cdd3be3"],["blacklisted(address)","dbac26e9"],["setBlacklist(address,bool)","153b0d1e"],["blockAccount(address)","7c0a893d"],["isBot(address)","3bbac579"],["bots(address)","bfd79284"],["setBots(address[])","b515566a"]],
  trading: [["tradingEnabled()","4ada218b"],["tradingActive()","bbc0c742"],["enableTrading()","8a8c523c"],["openTrading()","c9567bf9"],["tradingOpen()","ffb54a99"]],
  pause: [["paused()","5c975abb"],["pause()","8456cb59"]],
  mint: [["mint(address,uint256)","40c10f19"]],
};

async function rpc<T = string>(method: string, params: unknown[], url = RPC()): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string; data?: string } };
  if (j.error) throw new Error(j.error.message + (j.error.data ? ` ${String(j.error.data).slice(0, 80)}` : ""));
  return j.result as T;
}
const call = (to: string, data: string, from?: string) =>
  rpc<string>("eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]);

async function evmSanity(pool: Pool, wallet: string): Promise<Sanity> {
  const f: Finding[] = [];
  // The token we're buying is whichever side isn't the quote asset.
  const tokenSide = QUOTES.has(pool.base.symbol.toUpperCase()) && !QUOTES.has(pool.quote.symbol.toUpperCase()) ? pool.quote : pool.base;
  const quoteSide = tokenSide === pool.base ? pool.quote : pool.base;
  const token = tokenSide.address;
  const isV4 = pool.venue === "uniswap-v4";
  const holder = isV4 ? POOL_MANAGER : pool.address;

  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) {
    return { pool: pool.id, chain: pool.chain, token, findings: [{ severity: "info", title: "No token address", detail: "Source didn't give a resolvable token address." }], verdict: "info", ranAt: new Date().toISOString() };
  }

  // 1. Bytecode scan
  let code = "";
  try { code = (await rpc<string>("eth_getCode", [token, "latest"])).toLowerCase(); } catch (e: any) { f.push({ severity: "info", title: "Couldn't read contract", detail: String(e?.message ?? e) }); }
  if (code && code !== "0x") {
    for (const [cat, sigs] of Object.entries(SIGNATURES)) {
      const hits = sigs.filter(([, sel]) => code.includes(sel)).map(([name]) => name);
      if (!hits.length) continue;
      const sev: Severity = cat === "tax" || cat === "blacklist" ? "bad" : cat === "limits" || cat === "trading" || cat === "pause" ? "warn" : "info";
      const title = { tax: "Tax / fee logic in the token", blacklist: "Blacklist / bot-block functions", limits: "Wallet or transaction limits", trading: "Owner can toggle trading", pause: "Pausable token", mint: "Mintable — supply can grow" }[cat]!;
      f.push({ severity: sev, title, detail: hits.slice(0, 5).join(", ") + (hits.length > 5 ? ` +${hits.length - 5}` : "") });
    }
    if (!f.some((x) => x.severity !== "info")) f.push({ severity: "ok", title: "Plain ERC-20 surface", detail: "No tax, limit, blacklist, or trading-toggle functions found in bytecode." });
  }

  // 2. Transfer test: can the pool's tokens move to your wallet at all?
  let decimals = 18;
  try { decimals = Number(BigInt(await call(token, SEL.decimals))); } catch { /* assume 18 */ }
  try {
    const amt = 10n ** BigInt(Math.max(0, decimals - 3)); // 0.001 token
    const res = await call(token, SEL.transfer + addr(wallet) + uint(amt), holder);
    if (res === "0x" || BigInt(res) === 1n) f.push({ severity: "ok", title: "Transfer to your wallet succeeds", detail: `Simulated 0.001 ${tokenSide.symbol} from the pool to ${wallet.slice(0, 6)}…` });
    else f.push({ severity: "bad", title: "Transfer returned false", detail: "The token's transfer() returned false without reverting — transfers to you are blocked." });
  } catch (e: any) {
    f.push({ severity: "bad", title: "Transfer to your wallet reverts", detail: `Simulated transfer failed: ${String(e?.message ?? e).slice(0, 120)}` });
  }

  // 3. Round-trip quote through the V3 pool: buy $10, sell it straight back.
  if (isV4) {
    f.push({ severity: "warn", title: "Uniswap V4 pool — hook fees not measurable here", detail: "V4 pools can charge extra via hooks (creator fees, dynamic fees). Round-trip quote skipped; check the project's own docs for where fees go." });
  } else if (pool.feeTier != null) {
    try {
      const qPrice = QUOTES.has(quoteSide.symbol.toUpperCase()) && /USD/i.test(quoteSide.symbol) ? 1 : (pool.quotePriceUsd ?? null);
      let qDec = 18; try { qDec = Number(BigInt(await call(quoteSide.address, SEL.decimals))); } catch { /* */ }
      if (qPrice) {
        const feeU24 = Math.round(pool.feeTier * 1e6);
        const amountIn = BigInt(Math.floor((10 / qPrice) * 10 ** qDec));
        const enc = (tIn: string, tOut: string, amt: bigint) => SEL.quote + addr(tIn) + addr(tOut) + uint(amt) + uint(BigInt(feeU24)) + uint(0n);
        const out1 = BigInt("0x" + (await call(QUOTER_V2, enc(quoteSide.address, token, amountIn))).slice(2, 66));
        const out2 = BigInt("0x" + (await call(QUOTER_V2, enc(token, quoteSide.address, out1))).slice(2, 66));
        const lost = 1 - Number(out2) / Number(amountIn);
        const expected = 2 * pool.feeTier;
        const detail = `$10 in → ${(Number(out1) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSide.symbol} → $${(10 * (1 - lost)).toFixed(2)} back. Cost ${(lost * 100).toFixed(2)}% vs ${(expected * 100).toFixed(2)}% for two fee tiers.`;
        if (lost > expected + 0.02) f.push({ severity: "bad", title: "Round trip loses far more than fees", detail: detail + " Something beyond the fee tier is eating the trade (thin liquidity, tax, or hook)." });
        else if (lost > expected + 0.005) f.push({ severity: "warn", title: "Round trip a bit expensive", detail });
        else f.push({ severity: "ok", title: "Round trip costs only the fees", detail });
      } else {
        f.push({ severity: "info", title: "Round trip skipped", detail: "No USD price for the quote token." });
      }
    } catch (e: any) {
      f.push({ severity: "bad", title: "Quoter reverted on this pool", detail: `A $10 swap can't even be quoted: ${String(e?.message ?? e).slice(0, 120)}` });
    }
  }

  const verdict: Severity = f.some((x) => x.severity === "bad") ? "bad" : f.some((x) => x.severity === "warn") ? "warn" : "ok";
  return { pool: pool.id, chain: pool.chain, token, findings: f, verdict, ranAt: new Date().toISOString() };
}

// ───────────────────────────── Solana ─────────────────────────────
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP = "https://lite-api.jup.ag/swap/v1/quote";

async function solanaSanity(pool: Pool, solRpc: string): Promise<Sanity> {
  const f: Finding[] = [];
  // Symbols are not identity: e.g. Upside Down Cat also uses USDC.
  const isQuote = (address: string) => [SOL_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"].includes(address);
  const tokenSide = isQuote(pool.base.address) && !isQuote(pool.quote.address) ? pool.quote : pool.base;
  const mint = tokenSide.address;
  let decimals: number | null = null;

  // 1. Mint program + extensions + authorities
  try {
    const info = await rpc<any>("getAccountInfo", [mint, { encoding: "jsonParsed" }], solRpc);
    const owner: string = info?.value?.owner ?? "";
    const parsed = info?.value?.data?.parsed?.info ?? {};
    const is2022 = owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    if ((!is2022 && owner !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') || !Number.isInteger(parsed.decimals)) throw new Error('Mint account was not returned by the provider.');
    decimals = parsed.decimals;
    if (is2022) {
      const exts: any[] = parsed.extensions ?? [];
      const fee = exts.find((e) => e.extension === "transferFeeConfig");
      if (fee) {
        const epoch = await rpc<{epoch: number}>('getEpochInfo', [], solRpc);
        const newer = fee.state?.newerTransferFee, older = fee.state?.olderTransferFee;
        const current = newer && Number(newer.epoch) <= epoch.epoch ? newer : older;
        const bps = current?.transferFeeBasisPoints;
        f.push({ severity: "warn", title: "Token-2022 transfer fee", detail: `Current configured transfer rate: ${bps != null ? (bps / 100).toFixed(2) + "%" : "unavailable"}, subject to the token’s fee cap. Transfers into and out of an LP can add costs. Check the complete zap simulation.` });
      }
      if (exts.some((e) => e.extension === "permanentDelegate")) f.push({ severity: "bad", title: "Permanent delegate", detail: "Someone can move or burn your tokens without your signature." });
      if (exts.some((e) => e.extension === "transferHook")) f.push({ severity: "warn", title: "Transfer hook", detail: "Custom logic runs on every transfer; can restrict or tax." });
      if (exts.some((e) => e.extension === "nonTransferable")) f.push({ severity: "bad", title: "Non-transferable", detail: "Soulbound token — you can't sell it." });
      if (!f.length) f.push({ severity: "ok", title: "Listed extensions checked", detail: "No transfer fee, hook, permanent delegate or non-transferable extension found. This is not a full token audit." });
    } else {
      f.push({ severity: "ok", title: "Standard SPL token", detail: "No Token-2022 extensions possible." });
    }
    if (parsed.freezeAuthority) f.push({ severity: "warn", title: "Freeze authority set", detail: `${String(parsed.freezeAuthority).slice(0, 8)}… can freeze token accounts, including yours.` });
    if (parsed.mintAuthority) f.push({ severity: "warn", title: "Mint authority set", detail: "Supply can still be inflated." });
  } catch (e: any) {
    f.push({ severity: "info", title: "Couldn't read mint", detail: String(e?.message ?? e).slice(0, 120) });
  }

  // 2. Jupiter quotes, 0.05 SOL → token → SOL. Routes may use other pools.
  try {
    const amountIn = 50_000_000; // 0.05 SOL in lamports
    const quote = async (url: string) => {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`Quote provider returned ${r.status}`);
      const q: any = await r.json();
      if (!/^\d+$/.test(String(q.outAmount)) || Number(q.outAmount) <= 0) throw new Error('No usable quote returned');
      return q;
    };
    const q1 = await quote(`${JUP}?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amountIn}&slippageBps=100`);
    const q2 = await quote(`${JUP}?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${q1.outAmount}&slippageBps=100`);
    const lost = 1 - Number(q2.outAmount) / amountIn;
    const tokenAmount = decimals != null ? (Number(q1.outAmount) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 4 }) : 'quoted amount of';
    const detail = `0.05 SOL → ${tokenAmount} ${tokenSide.symbol} → ${(Number(q2.outAmount) / 1e9).toFixed(6)} SOL. Quoted difference ${(lost * 100).toFixed(2)}%, before network fees and later price moves. Jupiter may route through other pools; this does not test the selected LP exit.`;
    f.push({ severity: lost > .01 ? 'warn' : 'ok', title: 'Round-trip quote available', detail });
  } catch (e: any) {
    f.push({ severity: "info", title: "Round-trip quote unavailable", detail: String(e?.message ?? e).slice(0, 120) + '. Sellability is unconfirmed; a provider failure is not proof that the token cannot be sold.' });
  }

  const verdict: Severity = f.some((x) => x.severity === "bad") ? "bad" : f.some((x) => x.severity === "warn") ? "warn" : f.some(x => x.severity === 'info') ? 'info' : "ok";
  return { pool: pool.id, chain: pool.chain, token: mint, findings: f, verdict, ranAt: new Date().toISOString() };
}

export async function sanityCheck(pool: Pool, evmWallet: string, solRpc: string): Promise<Sanity> {
  return pool.chain === "solana" ? solanaSanity(pool, solRpc) : evmSanity(pool, evmWallet);
}
