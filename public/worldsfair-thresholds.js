// All World's Fair pre-flight thresholds. Fractions are 0–1, not percentages.
// These are demo screening rules, not forecasts of position returns.
export const PREFLIGHT_THRESHOLDS = Object.freeze({
  feeHorizonHours:24,
  minDailyFeeFraction:0.02,
  minFloorDistanceFraction:0.45,
  suggestedDepthFraction:0.475,
  maxSuggestedDepthFraction:0.50,
  maxSuggestedBins:69,
  maxTopHolderFraction:0.10, // The passing test is strictly less than this.
  minTokenAgeHours:24,
  launchSpikeMultiple:3, // Flag strictly above 3× the complete 24h low.
  fadingRatio:0.75,
  failFloorLossFraction:0.50,
  cautionRoundTripFraction:0.02,
  marketMaxAgeMs:10*60*1000,
  policyMaxAgeMs:5*60*1000,
  structureMaxAgeMs:10*60*1000,
  quoteMaxAgeMs:10*60*1000,
});
