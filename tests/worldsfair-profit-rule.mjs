import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'worldsfair-rule-'));
await build({entryPoints: ['src/worldsfair-profit-rule.ts'], outfile: join(dir, 'rule.mjs'), bundle: true, platform: 'node', format: 'esm'});
const {DEFAULT_PAPER_PROFIT_RULE: defaults, validateProfitRule, splitPaperProfitRule, lamportsAsSol} = await import(join(dir, 'rule.mjs'));
assert.deepEqual(validateProfitRule(defaults), defaults);
const rule = {enabled: true, lpPercent: 50, vaultPercent: 25, basketPercent: 25, vaultId: 'jito-liquid-staking', basketSlug: 'blue-chip'};
assert.deepEqual(validateProfitRule(rule), rule);
for (const invalid of [{...rule, enabled: 'yes'}, {...rule, lpPercent: 49}, {...rule, lpPercent: 50.1, vaultPercent: 24.9}, {...rule, vaultId: null}, {...rule, basketSlug: null}, {...rule, vaultId: 'https://evil.test'}, {...rule, lpPercent: NaN}]) assert.throws(() => validateProfitRule(invalid));
assert.deepEqual(splitPaperProfitRule(1, rule), {profitLamports: 1, lpLamports: 1, vaultLamports: 0, basketLamports: 0});
assert.deepEqual(splitPaperProfitRule(2, rule), {profitLamports: 2, lpLamports: 1, vaultLamports: 1, basketLamports: 0});
assert.deepEqual(splitPaperProfitRule(3, rule), {profitLamports: 3, lpLamports: 1, vaultLamports: 1, basketLamports: 1});
assert.deepEqual(splitPaperProfitRule(1000000001, rule), {profitLamports: 1000000001, lpLamports: 500000001, vaultLamports: 250000000, basketLamports: 250000000});
for (let lp = 0; lp <= 100; lp++) for (let vault = 0; vault <= 100 - lp; vault++) for (const amount of [1, 2, 7, 101, 1000000001, Number.MAX_SAFE_INTEGER]) {
  const out = splitPaperProfitRule(amount, {lpPercent: lp, vaultPercent: vault, basketPercent: 100 - lp - vault});
  assert.equal(out.lpLamports + out.vaultLamports + out.basketLamports, amount);
  for (const value of [out.lpLamports, out.vaultLamports, out.basketLamports]) assert.ok(Number.isSafeInteger(value) && value >= 0);
  if (!lp) assert.equal(out.lpLamports, 0); if (!vault) assert.equal(out.vaultLamports, 0); if (lp + vault === 100) assert.equal(out.basketLamports, 0);
}
for (const amount of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => splitPaperProfitRule(amount, rule));
assert.equal(lamportsAsSol(1), '0.000000001'); assert.equal(lamportsAsSol(250000000), '0.250000000'); assert.equal(lamportsAsSol(1000000001), '1.000000001');
console.log('PASS: profit rule validation, chosen targets, exact largest-remainder lamport conservation across every integer percentage split, zero allocations and decimal conversion.');
