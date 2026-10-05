import {basketRaw} from './worldsfair-basket-math';

export const VAULT_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export interface LinearVaultEstimate {principalUnits:number;accruedUnits:number;estimatedUnits:number;elapsedYears:number}
/** An estimate in the deposit asset, always linear on the original principal.
 * APY labels are retained as source evidence, never used to compound the model.
 */
export function linearVaultEstimate(principalUnitsRaw:unknown, decimals:unknown, annualPercent:unknown, openedAt:unknown, now:unknown):LinearVaultEstimate|null {
  if (!basketRaw(principalUnitsRaw) || BigInt(principalUnitsRaw) <= 0n || !Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 18 || typeof annualPercent !== 'number' || !Number.isFinite(annualPercent) || annualPercent < 0 || typeof openedAt !== 'string' || typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return null;
  const start = Date.parse(openedAt);
  if (!Number.isFinite(start)) return null;
  const principalUnits = Number(principalUnitsRaw) / 10 ** (decimals as number), elapsedYears = Math.max(0, now - start) / VAULT_YEAR_MS;
  const accruedUnits = principalUnits * (annualPercent / 100) * elapsedYears, estimatedUnits = principalUnits + accruedUnits;
  if (![principalUnits, elapsedYears, accruedUnits, estimatedUnits].every(value => Number.isFinite(value) && value >= 0)) return null;
  return {principalUnits, accruedUnits, estimatedUnits, elapsedYears};
}
