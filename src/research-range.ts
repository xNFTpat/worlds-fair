/**
 * Research-only range arithmetic. Prices are always human SOL per paired token.
 * One-sided allocation follows the installed DLMM strategy's floating linear
 * weights, including native-X price adjustment. Integer allocation, active-bin
 * partial fills and actual liquidity in each bin remain unavailable.
 */
export type ResearchRangeShape = 'Spot' | 'BidAsk' | 'Curve';
export interface ResearchRangeInput {
  sizeSol?: number;
  priceSol: number;
  floorPriceSol: number;
  binStep: number;
  shape?: ResearchRangeShape;
  oneSided?: boolean;
  /** In native X/Y terms: X is SOL, so native Y/X price is inverted. */
  solIsBase?: boolean;
  activeBinId?: number;
  /** Actual human active-bin SOL/token price. Omission assumes priceSol. */
  activeBinPriceSol?: number;
  maxSetupBins?: number;
  /** Pool fees/TVL/hour, a fraction, not a measured position fee share. */
  feeRateHourly?: number | null;
  /** Sale quote loss as fraction of token value; null is unknown, never zero. */
  exitCostFraction?: number | null;
  /** Jupiter quotes already include token swap transfer fees by default. */
  exitCostIncludesTransferFee?: boolean;
  /** SOL-to-token funding quote loss for the two-sided token allocation. */
  fundingCostFraction?: number | null;
  fundingCostIncludesTransferFee?: boolean;
  /** Omission/null means the token tax policy is unknown. Explicit 0 is untaxed. */
  transferFeeBps?: number | null;
  /** Maximum fee in raw paired-token units, applied per transfer, not in SOL. */
  transferFeeMaximumRaw?: string | null;
  pairedDecimals?: number;
  /** Sunk entry+exit network-cost estimate, paid in addition to LP principal. */
  networkSol?: number;
  /** Refundable locked capital, paid in addition to principal; never a loss. */
  positionRentSol?: number;
}

export interface ResearchRangeBin {
  offset: number;
  nativeBinId: number | null;
  priceSol: number;
  weight: number;
  initialSol: number;
  initialPairedTokens: number;
  /** Entry inventory aliases for replay/manual-position consumers. */
  sol: number;
  token: number;
}
export interface ResearchRangeScenario {
  priceSol: number;
  principalSol: number;
  pairedTokens: number;
  grossValueSol: number;
  withdrawalTaxSol: number | null;
  saleCostSol: number | null;
  liquidationSol: number | null;
  pnlSol: number | null;
  returnFraction: number | null;
  vsHoldingSol: number | null;
  /** Entry funding loss + deposit tax + withdrawal/sale/network costs. */
  totalCostsSol: number | null;
  /** Entry and exit costs only: does not recover conversion/price losses. */
  feeRecoveryHours: number | null;
  /** Withdrawal and sale costs only; network input is a lifecycle allowance. */
  exitRecoveryHours: number | null;
  /** Rough hours of fees to offset the entire modeled scenario loss. */
  scenarioBreakEvenHours: number | null;
  unavailableReasons: string[];
}
export interface ResearchRangeShapeResult {
  shape: ResearchRangeShape;
  bins: ResearchRangeBin[];
  initialSol: number;
  initialPairedTokens: number;
  fundingSol: number;
  fundingCostSol: number | null;
  depositTaxSol: number | null;
  atFloor: ResearchRangeScenario;
  belowFloor: ResearchRangeScenario;
}

export const RESEARCH_RANGE_MODEL_MAX_BINS = 1400;
export interface ResearchRangeDefaultInput {
  /** Use the active-bin price when available, otherwise the observed price. */
  priceSol: number;
  binStep: number;
  oneSided?: boolean;
  maxSetupBins?: number;
  preferredDepthFraction?: number;
  /** An observed support may be suggested, but is still only a price scenario. */
  preferredFloorPriceSol?: number;
}
const positive = (v: number, name: string) => {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be finite and greater than zero`);
  return v;
};
const nonnegative = (v: number, name: string) => {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be finite and nonnegative`);
  return v;
};
const fraction = (v: number | null | undefined, name: string) => {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`${name} must be a fraction from 0 to 1, or null`);
  return v;
};
/** Suppress only floating log noise at an exact integer, not real extra bins. */
const logSteps = (v: number) => Math.max(1, Math.ceil(v - 1e-10 * Math.max(1, Math.abs(v))));

/**
 * Pick a usable initial scenario without narrowing an explicitly entered range.
 * Mirrored two-sided ranges need active plus both tails, so a 69-bin setup has
 * 34 intervals on each side. A deeper support is preserved as the preferred
 * floor in the result and must not be described as the chosen floor.
 */
export function defaultResearchFloor(input: ResearchRangeDefaultInput) {
  const priceSol = positive(input.priceSol, 'priceSol');
  const binStep = positive(input.binStep, 'binStep');
  if (!Number.isInteger(binStep) || binStep > 10_000) throw new RangeError('binStep must be an integer between 1 and 10,000 basis points');
  if (input.oneSided !== undefined && typeof input.oneSided !== 'boolean') throw new RangeError('oneSided must be boolean');
  const oneSided = input.oneSided ?? true;
  const maxSetupBins = input.maxSetupBins ?? 69;
  if (!Number.isInteger(maxSetupBins) || maxSetupBins < (oneSided ? 1 : 3) || maxSetupBins > RESEARCH_RANGE_MODEL_MAX_BINS) throw new RangeError('maxSetupBins cannot fund the chosen one-sided or mirrored two-sided setup');
  const preferredDepthFraction = input.preferredDepthFraction ?? 0.2;
  if (!Number.isFinite(preferredDepthFraction) || preferredDepthFraction <= 0 || preferredDepthFraction >= 1) throw new RangeError('preferredDepthFraction must be greater than zero and less than one');
  const preferredFloorPriceSol = positive(input.preferredFloorPriceSol ?? priceSol * (1 - preferredDepthFraction), 'preferredFloorPriceSol');
  if (preferredFloorPriceSol >= priceSol) throw new RangeError('preferredFloorPriceSol must be below priceSol');
  const ratio = 1 + binStep / 10000;
  const preferredIntervals = logSteps(Math.log(priceSol / preferredFloorPriceSol) / Math.log1p(binStep / 10000));
  const allowedIntervals = oneSided ? maxSetupBins : Math.floor((maxSetupBins - 1) / 2);
  const downsideIntervalCount = Math.min(preferredIntervals, allowedIntervals);
  const capped = preferredIntervals > allowedIntervals;
  const floorPriceSol = capped ? priceSol * ratio ** -downsideIntervalCount : preferredFloorPriceSol;
  if (!Number.isFinite(floorPriceSol) || floorPriceSol <= 0) throw new RangeError('Default range floor is not representable');
  return {floorPriceSol, preferredFloorPriceSol, capped, oneSided, maxSetupBins,
    downsideIntervalCount, binCount: oneSided ? downsideIntervalCount : 2 * downsideIntervalCount + 1,
    rangeDepthFraction: 1 - ratio ** -downsideIntervalCount,
    note: capped ? `Initial range narrowed to fit ${maxSetupBins} bins. The suggested deeper floor remains a separate scenario.` : 'Initial range fits the chosen setup; a price floor does not guarantee support.'};
}

// Decimal-string conversion avoids rounding a cap through a Number first.
// Quantities themselves remain research floating estimates, rounded down to
// mint precision before SPL's exact integer ceiling/cap fee calculation.
function tokenRaw(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Token amount is not representable');
  const [mantissa, exponentText = '0'] = amount.toString().toLowerCase().split('e');
  const [whole, fractional = ''] = mantissa.split('.');
  const shift = Number(exponentText) + decimals - fractional.length;
  const digits = BigInt(whole + fractional);
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}

function transfer(amount: number, bps: number | null, maxRaw: bigint | null, decimals: number | undefined) {
  if (amount === 0 || bps === 0) return { net: amount, fee: 0, known: true };
  if (bps === null) return { net: amount, fee: 0, known: false };
  if (decimals === undefined) {
    // No cap can be supplied without decimals. An uncapped proportional fee is
    // an explicit conservative approximation; raw-unit ceiling is unavailable.
    const fee = amount * bps / 10000;
    return { net: amount - fee, fee, known: true };
  }
  const raw = tokenRaw(amount, decimals);
  const proportional = (raw * BigInt(bps) + 9999n) / 10000n;
  const feeRaw = maxRaw !== null && maxRaw < proportional ? maxRaw : proportional;
  const fee = Number(feeRaw) / 10 ** decimals;
  return { net: Number(raw - feeRaw) / 10 ** decimals, fee, known: true };
}

/**
 * Mark fixed-price bins without reconstructing an intrabin path. Below/equal a
 * bin's price its conserved inventory is fully tokens, above it fully SOL.
 * This is an ideal fill model and cannot identify partial fills at active price.
 */
export function inventoryAtPrice(bins: readonly { priceSol: number; sol: number; token: number }[], priceSol: number) {
  positive(priceSol, 'priceSol');
  let sol = 0, tokens = 0;
  const perBin = bins.map(bin => {
    positive(bin.priceSol, 'bin.priceSol');
    nonnegative(bin.sol, 'bin.sol');
    nonnegative(bin.token, 'bin.token');
    const fixedSolValue = bin.sol + bin.token * bin.priceSol;
    if (!Number.isFinite(fixedSolValue)) throw new RangeError('Bin inventory is not representable');
    const marked = priceSol <= bin.priceSol ? { sol: 0, tokens: fixedSolValue / bin.priceSol } : { sol: fixedSolValue, tokens: 0 };
    sol += marked.sol;
    tokens += marked.tokens;
    return { priceSol: bin.priceSol, ...marked };
  });
  const valueSol = sol + tokens * priceSol;
  if (![sol, tokens, valueSol].every(Number.isFinite)) throw new RangeError('Marked inventory is not representable');
  return { sol, tokens, valueSol, perBin };
}

/**
 * Build a downside SOL ladder or a mirrored two-sided range. Bin conversion is
 * a monotonic price-path scenario: lower bids buy tokens at each fixed bin price;
 * upper offers start as tokens funded at entry. At the bottom, all bids are
 * assumed filled. No fees, stochastic worst loss, or intrabin fill is invented.
 */
export function buildResearchRange(input: ResearchRangeInput) {
  const sizeSol = positive(input.sizeSol ?? 0.5, 'sizeSol');
  if (sizeSol > 1_000_000) throw new RangeError('sizeSol exceeds the research limit of 1,000,000 SOL');
  const priceSol = positive(input.priceSol, 'priceSol');
  const floorPriceSol = positive(input.floorPriceSol, 'floorPriceSol');
  const anchor = positive(input.activeBinPriceSol ?? priceSol, 'activeBinPriceSol');
  if (floorPriceSol >= priceSol || floorPriceSol >= anchor) throw new RangeError('floorPriceSol must be below both current price and the active-bin price');
  const binStep = positive(input.binStep, 'binStep');
  if (!Number.isInteger(binStep) || binStep > 10_000) throw new RangeError('binStep must be an integer between 1 and 10,000 basis points');
  const shape = input.shape ?? 'BidAsk';
  if (!(['Spot', 'BidAsk', 'Curve'] as unknown[]).includes(shape)) throw new RangeError('shape must be Spot, BidAsk or Curve');
  if (input.oneSided !== undefined && typeof input.oneSided !== 'boolean') throw new RangeError('oneSided must be boolean');
  if (input.solIsBase !== undefined && typeof input.solIsBase !== 'boolean') throw new RangeError('solIsBase must be boolean');
  const oneSided = input.oneSided ?? true;
  const solIsBase = input.solIsBase ?? false;
  if (input.activeBinId !== undefined && !Number.isSafeInteger(input.activeBinId)) throw new RangeError('activeBinId must be a safe integer');
  const maxSetupBins = input.maxSetupBins ?? 69;
  if (!Number.isInteger(maxSetupBins) || maxSetupBins < 1 || maxSetupBins > RESEARCH_RANGE_MODEL_MAX_BINS) throw new RangeError('maxSetupBins must be an integer between 1 and 1,400');
  const feeRateHourly = fraction(input.feeRateHourly, 'feeRateHourly');
  const exitCostFraction = fraction(input.exitCostFraction, 'exitCostFraction');
  const fundingCostFraction = fraction(input.fundingCostFraction, 'fundingCostFraction');
  const networkSol = nonnegative(input.networkSol ?? 0.0001, 'networkSol');
  const positionRentSol = nonnegative(input.positionRentSol ?? 0, 'positionRentSol');
  const bps = input.transferFeeBps ?? null;
  if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > 10000)) throw new RangeError('transferFeeBps must be an integer between 0 and 10,000, or null');
  const decimals = input.pairedDecimals;
  if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)) throw new RangeError('pairedDecimals must be an integer between 0 and 18');
  let maxRaw: bigint | null = null;
  if (input.transferFeeMaximumRaw != null) {
    if (typeof input.transferFeeMaximumRaw !== 'string' || !/^\d{1,78}$/.test(input.transferFeeMaximumRaw)) throw new RangeError('transferFeeMaximumRaw must be a nonnegative integer string');
    if (decimals === undefined) throw new RangeError('pairedDecimals is required to value a raw transfer-fee cap');
    maxRaw = BigInt(input.transferFeeMaximumRaw);
  }
  const ratio = 1 + binStep / 10000;
  const logRatio = Math.log1p(binStep / 10000);
  const logIntervalCount = logSteps(Math.log(priceSol / floorPriceSol) / logRatio);
  const downsideIntervalCount = logSteps(Math.log(anchor / floorPriceSol) / logRatio);
  const minOffset = -downsideIntervalCount;
  const maxOffset = oneSided ? -1 : downsideIntervalCount;
  const binCount = maxOffset - minOffset + 1;
  if (!Number.isSafeInteger(binCount) || binCount > RESEARCH_RANGE_MODEL_MAX_BINS) throw new RangeError(`Range needs ${binCount} inclusive bins; this research model supports at most 1,400`);
  const bottomPriceSol = anchor * ratio ** minOffset;
  const topPriceSol = anchor * ratio ** maxOffset;
  if (![bottomPriceSol, topPriceSol, 1 / bottomPriceSol, 1 / topPriceSol].every(v => Number.isFinite(v) && v > 0)) throw new RangeError('Range prices are not representable');
  const nativeId = (offset: number) => input.activeBinId === undefined ? null : input.activeBinId + (solIsBase ? -offset : offset);
  const lowerNativeBin = nativeId(solIsBase ? maxOffset : minOffset);
  const upperNativeBin = nativeId(solIsBase ? minOffset : maxOffset);
  if (lowerNativeBin !== null && (!Number.isSafeInteger(lowerNativeBin) || !Number.isSafeInteger(upperNativeBin))) throw new RangeError('Native bin bounds are not safe integers');
  const warnings: string[] = [];
  if (binCount > maxSetupBins) warnings.push(`${binCount} bins exceed the chosen ${maxSetupBins}-bin setup. Extended positions may support more bins; 69 is not a protocol maximum.`);
  if (input.activeBinPriceSol === undefined || input.activeBinId === undefined) warnings.push('Range alignment assumes the observed price is an active-bin anchor. Confirm the pool active-bin price/ID before copying prices to Meteora.');
  if (bps === null) warnings.push('Paired-token transfer fees are unavailable. Net liquidation remains unavailable where token transfers are required.');
  if (bps !== null && bps > 0 && maxRaw === null) warnings.push('Transfer-fee cap unavailable: tax uses an uncapped proportional upper estimate.');
  if (bps !== null && bps > 0 && decimals === undefined) warnings.push('Token decimals unavailable: transfer-tax rounding is approximate.');
  if (!oneSided && fundingCostFraction === null) warnings.push('Two-sided funding quote unavailable. Inventory is indicative before funding costs; net scenario is unavailable.');
  const assumptions = [
    'Fee recovery uses pool-wide fees/TVL times your deposited SOL, with no per-bin liquidity or position fee-share data. Fees and future time in range are not guaranteed.',
    oneSided ? 'One-sided Spot uses equal native quote-value weights; Bid-Ask uses linear weights toward the floor; Curve uses linear weights toward the active endpoint. Native SOL-X amounts divide weights by native price, so SOL per bin is price-adjusted. This follows the SDK strategy without integer allocation rounding.' : 'Two-sided Spot uses uniform weights; Bid-Ask uses linear endpoint-heavy weights; Curve uses linear center-heavy weights. This is a 50/50 SOL/token template with half of the active-bin weight on each side, not the SDK allocation from measured active-bin reserves.',
    oneSided ? 'SOL-only bids start one full bin below the active price; no paired-token funding swap or deposit tax is charged on entry.' : 'Two-sided range mirrors the downside bin distance above active. Entry value is half SOL and half paired token, with half of the active-bin allocation on each side.',
    'Scenarios assume a monotonic fall and full fixed-price bin conversion by the aligned bottom, excluding earned fees. A further 10% fall is a stress scenario, not a maximum possible loss.',
    'Withdrawal tax assumes one aggregated paired-token transfer. Actual transfer grouping/fee caps and fee claims can change costs.',
    'Sale/funding quote loss includes swap transfer fees by default; withdrawal and LP deposit taxes are added separately. Current quote cost fractions are held constant in stress scenarios.',
    'Network cost is a sunk estimate paid beyond position size. Refundable position rent is locked capital beyond size and is returned, so it is not subtracted from P&L.',
  ];

  function resultFor(selectedShape: ResearchRangeShape): ResearchRangeShapeResult {
    const offsets = Array.from({ length: binCount }, (_, i) => minOffset + i);
    const allocations = offsets.map(offset => {
      const weight = selectedShape === 'Spot' ? 1 : selectedShape === 'BidAsk'
        ? oneSided ? maxOffset - offset + 1 : Math.abs(offset) + 1
        : oneSided ? offset - minOffset + 1 : downsideIntervalCount - Math.abs(offset) + 1;
      // SDK ask-side native-X allocation is weight / raw Y/X price. Native
      // SOL-X human SOL/token is inverse Y/X, so the shared scale cancels and
      // the SOL allocation is weight * the relative human bin price.
      return oneSided && solIsBase ? weight * ratio ** offset : weight;
    });
    const total = allocations.reduce((a, b) => a + b, 0);
    const bins: ResearchRangeBin[] = offsets.map((offset, i) => {
      const weight = allocations[i] / total;
      const sol = sizeSol * weight * (offset < 0 ? 1 : offset === 0 ? 0.5 : 0);
      const token = sizeSol * weight / priceSol * (offset > 0 ? 1 : offset === 0 ? 0.5 : 0);
      if (!Number.isFinite(token)) throw new RangeError('Token allocation is not representable');
      return { offset, nativeBinId: nativeId(offset), priceSol: anchor * ratio ** offset, weight,
        initialSol: sol, initialPairedTokens: token, sol, token };
    });
    const idealPairedTokens = bins.reduce((a, b) => a + b.initialPairedTokens, 0);
    const fundingSol = idealPairedTokens * priceSol;
    const fundingKnown = fundingSol === 0 || fundingCostFraction !== null;
    const quotedTokens = idealPairedTokens * (1 - (fundingCostFraction ?? 0));
    const swapTransfer = input.fundingCostIncludesTransferFee === false ? transfer(quotedTokens, bps, maxRaw, decimals) : { net: quotedTokens, fee: 0, known: true };
    const deposit = transfer(swapTransfer.net, bps, maxRaw, decimals);
    const tokenScale = idealPairedTokens === 0 ? 1 : deposit.net / idealPairedTokens;
    for (const bin of bins) { bin.initialPairedTokens *= tokenScale; bin.token = bin.initialPairedTokens; }
    const initialSol = bins.reduce((a, b) => a + b.initialSol, 0);
    const initialPairedTokens = bins.reduce((a, b) => a + b.initialPairedTokens, 0);
    const fundingCostSol = fundingKnown && swapTransfer.known ? fundingSol - quotedTokens * priceSol + swapTransfer.fee * priceSol : null;
    const depositTaxSol = deposit.known ? deposit.fee * priceSol : null;

    function scenario(scenarioPriceSol: number): ResearchRangeScenario {
      // Lower/active SOL bids fully buy at their own fixed prices; upper offers
      // remain the original tokens along the assumed downward path.
      const inventory = inventoryAtPrice(bins, scenarioPriceSol);
      const pairedTokens = inventory.tokens;
      const principalSol = inventory.sol;
      const grossValueSol = inventory.valueSol;
      const withdrawal = transfer(pairedTokens, bps, maxRaw, decimals);
      const saleTransfer = input.exitCostIncludesTransferFee === false ? transfer(withdrawal.net, bps, maxRaw, decimals) : { net: withdrawal.net, fee: 0, known: true };
      const reasons: string[] = [];
      if (!fundingKnown) reasons.push('Two-sided funding quote unavailable');
      if (!deposit.known || !swapTransfer.known || !withdrawal.known || !saleTransfer.known) reasons.push('Paired-token transfer fee unavailable');
      if (exitCostFraction === null && saleTransfer.net > 0) reasons.push('Token-to-SOL exit quote unavailable');
      const quoteCostSol = saleTransfer.net === 0 ? 0 : exitCostFraction === null ? null : saleTransfer.net * scenarioPriceSol * exitCostFraction;
      const withdrawalTaxSol = withdrawal.known ? withdrawal.fee * scenarioPriceSol : null;
      const saleCostSol = quoteCostSol !== null && saleTransfer.known ? quoteCostSol + saleTransfer.fee * scenarioPriceSol : null;
      const liquidationSol = reasons.length === 0 ? principalSol + saleTransfer.net * scenarioPriceSol * (1 - (exitCostFraction ?? 0)) : null;
      const pnlSol = liquidationSol === null ? null : liquidationSol - sizeSol - networkSol;
      const totalCostsSol = fundingCostSol !== null && depositTaxSol !== null && withdrawalTaxSol !== null && saleCostSol !== null ? fundingCostSol + depositTaxSol + withdrawalTaxSol + saleCostSol + networkSol : null;
      const hours = (amount: number | null) => amount === null ? null : amount === 0 ? 0 : feeRateHourly === null || feeRateHourly === 0 ? null : amount / (sizeSol * feeRateHourly);
      const feeRecoveryHours = hours(totalCostsSol);
      const exitRecoveryHours = hours(withdrawalTaxSol !== null && saleCostSol !== null ? withdrawalTaxSol + saleCostSol : null);
      const scenarioBreakEvenHours = hours(pnlSol === null ? null : Math.max(0, -pnlSol));
      return { priceSol: scenarioPriceSol, principalSol, pairedTokens, grossValueSol, withdrawalTaxSol, saleCostSol, liquidationSol, pnlSol,
        returnFraction: pnlSol === null ? null : pnlSol / sizeSol, vsHoldingSol: pnlSol, totalCostsSol, feeRecoveryHours, exitRecoveryHours, scenarioBreakEvenHours, unavailableReasons: reasons };
    }
    return { shape: selectedShape, bins, initialSol, initialPairedTokens, fundingSol, fundingCostSol, depositTaxSol,
      atFloor: scenario(bottomPriceSol), belowFloor: scenario(bottomPriceSol * 0.9) };
  }
  const selected = resultFor(shape);
  const comparison = (['Spot', 'BidAsk'] as const).map(name => name === shape ? selected : resultFor(name));
  return {
    priceConvention: 'SOL per paired token' as const, sizeSol, priceSol, requestedFloorPriceSol: floorPriceSol,
    shape, oneSided, solIsBase, binStep, ratio, logIntervalCount, downsideIntervalCount, binCount, maxSetupBins,
    allocationModel: oneSided ? 'sdk-strategy-floating' as const : 'research-50-50-template' as const,
    exceedsSetupBins: binCount > maxSetupBins, modelMaxBins: RESEARCH_RANGE_MODEL_MAX_BINS,
    alignment: input.activeBinPriceSol !== undefined && input.activeBinId !== undefined ? 'native-active-bin' : 'assumed-active-price',
    activeBinPriceSol: anchor, activeBinId: input.activeBinId ?? null, lowerNativeBin, upperNativeBin,
    bottomPriceSol, topPriceSol, rangeDepthFraction: 1 - bottomPriceSol / priceSol,
    copyPrices: { convention: solIsBase ? 'paired token per SOL (Y/X)' : 'SOL per paired token (Y/X)',
      top: solIsBase ? 1 / bottomPriceSol : topPriceSol, bottom: solIsBase ? 1 / topPriceSol : bottomPriceSol },
    feeRateHourly, feeRecoveryStatus: feeRateHourly === null ? 'unknown-rate' : feeRateHourly === 0 ? 'no-fees-at-current-rate' : 'rough-pool-density',
    roughFeeSolPerHour: feeRateHourly === null ? null : sizeSol * feeRateHourly,
    networkSol, positionRentSol, totalCashRequiredSol: sizeSol + networkSol + positionRentSol, holdingBenchmarkSol: sizeSol,
    selected, comparison, warnings, assumptions,
  };
}
