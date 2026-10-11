/** Example screening thresholds selected for the paper demo, not advice.
 * Floor bands are disjoint: <1× swing fails, 1–1.2× cautions, >=1.2× passes.
 * Spike requires six complete hourly candles; the one-hour move uses the last
 * completed candle. A missing window cannot inherit a shorter window's label.
 */
export const STILL_PREFLIGHT_THRESHOLDS = Object.freeze({
  feePace: {pass: .005, caution: .0015},
  exitCost: {pass: .01, caution: .03},
  transferTax: {pass: 0, caution: .02},
  holders: {pass: .30, caution: .50, singleWalletFail: .15},
  spike: {pass: .15, caution: .40},
  floor: {failBelowSwing: 1, passAtSwing: 1.2},
  defaultHoldMinutes: 240,
  minimumResultTrades: 5,
});
export type StillRangeOptions = {shape:'Spot'|'BidAsk'|'Curve';floorPct:number;ceilingPct:number;holdMinutes:number};
export function parseStillRangeOptions(value: unknown): StillRangeOptions | undefined {
  if(value == null)return undefined;
  if(typeof value!=='object'||Array.isArray(value))throw Error('Choose a valid paper range.');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['shape','floorPct','ceilingPct','holdMinutes'].includes(k))||!['Spot','BidAsk','Curve'].includes(String(v.shape))||
    typeof v.floorPct!=='number'||!Number.isFinite(v.floorPct)||v.floorPct<.1||v.floorPct>90||
    typeof v.ceilingPct!=='number'||!Number.isFinite(v.ceilingPct)||v.ceilingPct< -89||v.ceilingPct>100||v.ceilingPct<=-v.floorPct||
    typeof v.holdMinutes!=='number'||!Number.isInteger(v.holdMinutes)||v.holdMinutes<1||v.holdMinutes>2880)throw Error('Choose a shape, floor from 0.1–90%, ceiling above the floor and a hold from 1 minute to 48 hours.');
  return v as StillRangeOptions;
}
