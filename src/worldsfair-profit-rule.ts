export interface PaperProfitRule {
  enabled: boolean; lpPercent: number; vaultPercent: number; basketPercent: number;
  vaultId: string | null; basketSlug: string | null;
}
export const DEFAULT_PAPER_PROFIT_RULE: Readonly<PaperProfitRule> = Object.freeze({enabled: false, lpPercent: 50, vaultPercent: 25, basketPercent: 25, vaultId: null, basketSlug: null});
export function validateProfitRule(input: Record<string, unknown>): PaperProfitRule {
  if (typeof input.enabled !== 'boolean') throw new RangeError('Choose whether the profit rule is enabled.');
  const percentages = [input.lpPercent, input.vaultPercent, input.basketPercent];
  if (percentages.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) throw new RangeError('Profit percentages must be whole numbers from zero to 100.');
  if (percentages.reduce<number>((sum, value) => sum + (value as number), 0) !== 100) throw new RangeError('LP, vault and basket percentages must total 100.');
  const vaultId = input.vaultId ?? null, basketSlug = input.basketSlug ?? null;
  if (vaultId !== null && (typeof vaultId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/.test(vaultId))) throw new RangeError('Choose a valid vault or liquid-staking idea.');
  if (basketSlug !== null && (typeof basketSlug !== 'string' || !/^[a-z0-9-]{1,90}$/.test(basketSlug))) throw new RangeError('Choose a valid basket.');
  if (input.enabled && (input.vaultPercent as number) > 0 && !vaultId) throw new RangeError('Choose a vault for the vault share.');
  if (input.enabled && (input.basketPercent as number) > 0 && !basketSlug) throw new RangeError('Choose a basket for the basket share.');
  return {enabled: input.enabled, lpPercent: input.lpPercent as number, vaultPercent: input.vaultPercent as number, basketPercent: input.basketPercent as number, vaultId, basketSlug};
}

/** Largest remainders receive spare lamports; ties prefer LP, then vault, then basket. */
export function splitPaperProfitRule(profitLamports: number, rule: Pick<PaperProfitRule, 'lpPercent' | 'vaultPercent' | 'basketPercent'>) {
  if (!Number.isSafeInteger(profitLamports) || profitLamports < 1) throw new RangeError('Profit must contain a positive whole number of lamports.');
  const weights = [rule.lpPercent, rule.vaultPercent, rule.basketPercent];
  if (weights.some(value => !Number.isInteger(value) || value < 0 || value > 100) || weights.reduce((sum, value) => sum + value, 0) !== 100) throw new RangeError('Profit percentages must total 100.');
  const product = weights.map(value => BigInt(profitLamports) * BigInt(value));
  const units = product.map(value => value / 100n);
  const order = product.map((value, index) => ({index, remainder: value % 100n})).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  let spare = BigInt(profitLamports) - units.reduce((sum, value) => sum + value, 0n);
  for (const row of order) {if (!spare) break; units[row.index]++; spare--;}
  return {profitLamports, lpLamports: Number(units[0]), vaultLamports: Number(units[1]), basketLamports: Number(units[2])};
}

export function lamportsAsSol(lamports: number): string {
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new RangeError('Invalid Paper lamports.');
  const units = BigInt(lamports);
  return `${units / 1_000_000_000n}.${String(units % 1_000_000_000n).padStart(9, '0')}`;
}
