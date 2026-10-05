import {paperLamports, LAMPORTS_PER_SOL} from './worldsfair-paper-math';

export const MAX_BASKET_LEGS = 12;
export const BASKET_SOL = 'So11111111111111111111111111111111111111112';
const U64_MAX = (1n << 64n) - 1n;
export function basketRaw(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= U64_MAX;
}
export function basketMint(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  for (let copy = n; copy > 0n; copy >>= 8n) bytes++;
  const zeros = value.length - value.replace(/^1+/, '').length;
  return bytes + zeros === 32;
}
export interface BasketWeight {mint: string; weight: number; symbol?: string}
export interface BasketSplit {mint: string; symbol: string; weight: number; inputLamports: number}
function decimalWeight(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError('Basket weights must be positive percentages.');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new RangeError('Basket weight precision is unsupported.');
  const decimals = (match[2] || '').length - Number(match[3] || 0);
  if (Math.abs(decimals) > 24) throw new RangeError('Basket weight precision is unsupported.');
  return {units: BigInt(match[1] + (match[2] || '')) * (decimals < 0 ? 10n ** BigInt(-decimals) : 1n), decimals: Math.max(0, decimals)};
}
/** Largest-remainder allocation conserves every input lamport exactly. */
export function splitBasketLamports(amountSol: string | number, rows: readonly BasketWeight[]) {
  const amountLamports = paperLamports(amountSol), total = BigInt(amountLamports);
  if (!rows.length || rows.length > 100) throw new RangeError('A complete bounded basket allocation is required.');
  if (rows.some(row => !basketMint(row.mint))) throw new RangeError('A basket token address could not be verified.');
  const parsed = rows.map(row => ({...row, ...decimalWeight(row.weight)}));
  const scale = Math.max(...parsed.map(row => row.decimals)), grouped = new Map<string, {mint: string; symbol: string; units: bigint}>();
  for (const row of parsed) {
    const units = row.units * 10n ** BigInt(scale - row.decimals), prior = grouped.get(row.mint);
    grouped.set(row.mint, {mint: row.mint, symbol: prior?.symbol || (typeof row.symbol === 'string' ? row.symbol.slice(0, 30) : '') || row.mint.slice(0, 6) + '…', units: (prior?.units || 0n) + units});
  }
  if (grouped.size > MAX_BASKET_LEGS) throw new RangeError(`Paper baskets support at most ${MAX_BASKET_LEGS} different tokens.`);
  const weights = [...grouped.values()].sort((a, b) => a.mint.localeCompare(b.mint)), sum = weights.reduce((n, row) => n + row.units, 0n);
  const target = 100n * 10n ** BigInt(scale), difference = sum > target ? sum - target : target - sum;
  if (difference * 100n >= 10n ** BigInt(scale)) throw new RangeError('The complete basket weights must add to 100%.');
  const shares = weights.map(row => ({...row, amount: total * row.units / sum, remainder: total * row.units % sum}));
  const remainder = total - shares.reduce((n, row) => n + row.amount, 0n);
  const ranked = [...shares].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.mint.localeCompare(b.mint));
  for (let i = 0; i < Number(remainder); i++) ranked[i].amount++;
  if (shares.some(row => row.amount === 0n)) throw new RangeError('Increase the Paper SOL amount so every basket token receives at least one lamport.');
  const legs: BasketSplit[] = shares.map(row => ({mint: row.mint, symbol: row.symbol, weight: Number(row.units) / Number(sum) * 100, inputLamports: Number(row.amount)}));
  return {amountLamports, costSol: amountLamports / LAMPORTS_PER_SOL, legs};
}
export function basketUnitValue(unitsRaw: unknown, decimals: unknown, usdPrice: unknown): number | null {
  if (!basketRaw(unitsRaw) || !Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 18 || typeof usdPrice !== 'number' || !Number.isFinite(usdPrice) || usdPrice <= 0) return null;
  const value = Number(unitsRaw) / 10 ** (decimals as number) * usdPrice;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
export function basketPerformance(costLamports: number, valueUsd: number | null, solUsd: number | null, entrySolUsd: number | null) {
  const costSol = costLamports / LAMPORTS_PER_SOL;
  const valid = Number.isSafeInteger(costLamports) && costLamports > 0 && typeof valueUsd === 'number' && Number.isFinite(valueUsd) && valueUsd >= 0 && typeof solUsd === 'number' && Number.isFinite(solUsd) && solUsd > 0;
  if (!valid) return {costSol, valueSol: null, valueUsd: null, holdSolValueUsd: null, pnlSol: null, vsHoldSolUsd: null, absolutePnlUsd: null};
  const valueSol = valueUsd! / solUsd!, holdSolValueUsd = costSol * solUsd!, pnlSol = valueSol - costSol;
  const absolutePnlUsd = typeof entrySolUsd === 'number' && Number.isFinite(entrySolUsd) && entrySolUsd > 0 ? valueUsd! - costSol * entrySolUsd : null;
  if (![valueSol, holdSolValueUsd, pnlSol, pnlSol * solUsd!, ...(absolutePnlUsd === null ? [] : [absolutePnlUsd])].every(Number.isFinite)) return {costSol, valueSol: null, valueUsd: null, holdSolValueUsd: null, pnlSol: null, vsHoldSolUsd: null, absolutePnlUsd: null};
  return {costSol, valueSol, valueUsd, holdSolValueUsd, pnlSol, vsHoldSolUsd: pnlSol * solUsd!, absolutePnlUsd};
}
