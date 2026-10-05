export const LAMPORTS_PER_SOL = 1_000_000_000;
export const MAX_SEED_SOL = 1_000;
export const MAX_ACCOUNT_SOL = 1_000_000;

/** Parse human decimal SOL without rounding fractional lamports into credit. */
export function paperLamports(value: unknown, maximumSol = MAX_SEED_SOL): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new RangeError('Enter a decimal Paper SOL amount.');
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,9})?$/.test(text)) throw new RangeError('Use a positive SOL amount with at most nine decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(fraction.padEnd(9, '0'));
  if (amount <= 0n || amount > BigInt(maximumSol) * BigInt(LAMPORTS_PER_SOL)) throw new RangeError(`Enter more than zero and no more than ${maximumSol} Paper SOL.`);
  return Number(amount);
}

export function paperProfitSplit(profitSol: number, percent: unknown) {
  if (!Number.isFinite(profitSol) || profitSol <= 0 || profitSol > MAX_ACCOUNT_SOL) throw new RangeError('This close has no transferable scored profit.');
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100) throw new RangeError('Choose a whole percentage between 1 and 100.');
  // Observed paper results use floating point; round DOWN to whole lamports.
  const profitLamports = Math.floor(profitSol * LAMPORTS_PER_SOL);
  const amountLamports = Number(BigInt(profitLamports) * BigInt(percent) / 100n);
  if (amountLamports < 1) throw new RangeError('The selected share is less than one lamport.');
  return {profitLamports, amountLamports, retainedLamports: profitLamports - amountLamports};
}

/** Remove a cash flow without changing the strategy's current drawdown ratio. */
export function paperPeakAfterWithdrawal(peakSol: number, equitySol: number, withdrawalSol: number): number {
  if (![peakSol, equitySol, withdrawalSol].every(Number.isFinite) || peakSol <= 0 || equitySol <= 0 || withdrawalSol <= 0 || withdrawalSol >= equitySol)
    throw new RangeError('Fresh positive retained LP equity is required for this transfer.');
  return peakSol * (equitySol - withdrawalSol) / equitySol;
}
