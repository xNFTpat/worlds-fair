import type {Env} from './env';
import {inventoryAtPrice} from './research-range';
import {paperLamports, LAMPORTS_PER_SOL} from './worldsfair-paper-math';
import {getStillPreflight, getStillBaskets, getStillPoolMark, STILL_MAX_PRICE_AGE_MS} from './still-preflight';

export const STILL_SETTLEMENT_NOTE = 'Paper balance settles modelled inventory before fees and trading costs.';
const SEED_LAMPORTS = 10 * LAMPORTS_PER_SOL;
const MAX_POSITIONS = 40, MAX_ACCOUNT_BYTES = 600_000, MAX_FEE_INTERVAL_MS = 5 * 60_000;
const MAX_RECEIPTS = 200;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => valid(value) && value > 0;
const nonnegative = (value: unknown): value is number => valid(value) && value >= 0;
const fresh = (at: unknown, now: number) => typeof at === 'string' && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) <= STILL_MAX_PRICE_AGE_MS;
const accountKey = (account: string) => 'still:account:' + account;
const receiptKey = (account: string, id: string) => 'still:receipt:' + account + ':' + id;
class StillPaperError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'still_invalid_request') {super(message);}
}
interface Bin {priceSol: number; sol: number; token: number}
interface Observation {poolAddress: string; priceSol: number | null; fetchedAt: string | null; feeRateHourly: number | null; feeRateAsOf?: string | null; source?: string}
interface Range {shape: string; floorPriceSol: number; topPriceSol: number; bins: Bin[]; note: string}
export interface StillPaperMark {
  asOf: string | null; checkedAt: string; source: string; priceSol: number | null;
  grossValueSol: number | null; grossPnlSol: number | null; netPnlSol: number | null;
  feesSol: number | null; observedFeesSol: number; feesCoverageComplete: boolean;
  inRange: boolean | null; rangeStatus: 'above' | 'inside' | 'below' | 'unavailable';
  distanceToFloorPct: number | null; unavailableReasons: string[];
}
export interface StillPaperPosition {
  id: string; positionAddress: string; poolAddress: string; name: string; basketId: string | null; basketName: string | null;
  status: 'open' | 'closed'; openedAt: string; closedAt: string | null;
  amountLamports: number; amountSol: number; entryPriceSol: number; entryAsOf: string;
  entryCostsSol: number | null; exitCostsSol: number | null; transferFeeBps: number | null;
  range: Range; mark: StillPaperMark; lastObservationAt: string; lastFeeRateHourly: number | null; lastFeeRateAsOf: string | null;
  settledLamports: number | null; settlementNote: string;
}
interface StillBasketProof {eventId: string; basketId: string; basketName: string; amountSol: number; at: string; positionIds: string[]; stampTarget: {kind: 'still-basket'; eventId: string}}
interface StillBasketEvidence {id: string; name: string; amountLamports: number; positions: {positionAddress: string; poolAddress: string; amountLamports: number}[]}
export interface StillPaperAccount {
  version: 1; revision: number; seededLamports: number; balanceLamports: number;
  positions: StillPaperPosition[]; createdAt: string; updatedAt: string;
  latestBasket?: StillBasketProof;
  actionCount: number; activityWindow: {at: number; count: number};
}
interface Receipt {requestId: string; action: string; fingerprint: string; at: string; positionIds: string[]; amountSol: number; settledSol?: number; settlementNote: string; basket?: StillBasketEvidence}
export interface StillPaperProviders {
  preflight: typeof getStillPreflight; baskets: typeof getStillBaskets; mark: typeof getStillPoolMark;
  now: () => number; id: () => string;
}
function initial(now: number): StillPaperAccount {
  const at = new Date(now).toISOString();
  return {version: 1, revision: 0, seededLamports: SEED_LAMPORTS, balanceLamports: SEED_LAMPORTS, positions: [], createdAt: at, updatedAt: at, actionCount: 0, activityWindow: {at: now, count: 0}};
}
function rateAt(observation: Observation, now: number): number | null {
  const at = observation.feeRateAsOf === undefined ? observation.fetchedAt : observation.feeRateAsOf;
  return nonnegative(observation.feeRateHourly) && fresh(at, now) ? observation.feeRateHourly : null;
}
function statusAt(position: Pick<StillPaperPosition, 'range'>, price: number) {
  return price < position.range.floorPriceSol ? 'below' as const : price > position.range.topPriceSol ? 'above' as const : 'inside' as const;
}
/** Fees are an explicitly labelled pool-rate model over short observed intervals.
 * No fee is backfilled across a stale/missing interval, a range crossing, or an
 * overnight browser gap. Inventory marks use the shared ideal-bin model. */
export function markStillPosition(position: StillPaperPosition, observation: Observation | null, now: number): StillPaperPosition {
  if (position.status !== 'open') return position;
  const next = structuredClone(position), checkedAt = new Date(now).toISOString();
  if (!observation || observation.poolAddress !== position.poolAddress || !positive(observation.priceSol) || !fresh(observation.fetchedAt, now)) {
    next.mark = {...position.mark, checkedAt, asOf: observation?.fetchedAt ?? null, source: observation?.source || 'Meteora pool observation',
      priceSol: null, grossValueSol: null, grossPnlSol: null, netPnlSol: null, feesSol: null,
      feesCoverageComplete: false, inRange: null, rangeStatus: 'unavailable', distanceToFloorPct: null,
      unavailableReasons: ['A fresh pool price is unavailable.', 'Fees cannot be reconstructed through missing observations.', ...costGaps(position)]};
    return next;
  }
  const price = observation.priceSol, at = observation.fetchedAt!, observedAt = Date.parse(at);
  if (position.mark.asOf && observedAt < Date.parse(position.mark.asOf)) {
    next.mark = {...position.mark, checkedAt, feesSol: null, netPnlSol: null, feesCoverageComplete: false,
      unavailableReasons: [...new Set([...position.mark.unavailableReasons, 'An older provider observation was ignored; the newer saved price is retained.', 'Complete fee history is unavailable.'])]};
    return next;
  }
  const status = statusAt(position, price), inRange = status === 'inside';
  const inventory = inventoryAtPrice(position.range.bins, price);
  const rate = rateAt(observation, now);
  let observedFees = position.mark.observedFeesSol, complete = position.mark.feesCoverageComplete;
  const elapsed = observedAt - Date.parse(position.lastObservationAt);
  if (elapsed > 0) {
    const previousRateFresh = fresh(position.lastFeeRateAsOf, Date.parse(position.lastObservationAt));
    if (elapsed <= MAX_FEE_INTERVAL_MS && previousRateFresh && rate !== null && position.lastFeeRateHourly !== null && position.mark.inRange !== null) {
      if (position.mark.inRange && inRange) {
        const accrued = position.amountSol * (position.lastFeeRateHourly + rate) / 2 * elapsed / 3_600_000;
        if (nonnegative(accrued) && nonnegative(observedFees + accrued)) observedFees += accrued;
        else complete = false;
      }
      else if (position.mark.rangeStatus !== status) complete = false;
    } else complete = false;
    next.lastObservationAt = at; next.lastFeeRateHourly = rate; next.lastFeeRateAsOf = observation.feeRateAsOf === undefined ? at : observation.feeRateAsOf;
  }
  if (rate === null || now - Date.parse(position.lastObservationAt) > MAX_FEE_INTERVAL_MS && elapsed <= 0) complete = false;
  const unavailableReasons = costGaps(position);
  if (!complete) unavailableReasons.push('Complete fee history is unavailable; only short observed intervals can be modelled.');
  const costsKnown = position.entryCostsSol !== null && position.exitCostsSol !== null;
  next.mark = {asOf: at, checkedAt, source: observation.source || 'Meteora pool observation', priceSol: price,
    grossValueSol: inventory.valueSol, grossPnlSol: inventory.valueSol - position.amountSol,
    netPnlSol: costsKnown && complete ? inventory.valueSol + observedFees - position.amountSol - position.entryCostsSol! - position.exitCostsSol! : null,
    feesSol: complete ? observedFees : null, observedFeesSol: observedFees, feesCoverageComplete: complete,
    inRange, rangeStatus: status, distanceToFloorPct: (price - position.range.floorPriceSol) / price * 100, unavailableReasons};
  return next;
}
function costGaps(position: Pick<StillPaperPosition, 'entryCostsSol' | 'exitCostsSol'>) {
  return [...(position.entryCostsSol === null ? ['All-in entry costs are unavailable.'] : []), ...(position.exitCostsSol === null ? ['All-in exit costs are unavailable.'] : [])];
}
export function stillAccountView(account: StillPaperAccount, now = Date.now()) {
  const {activityWindow: _activity, actionCount: _actions, ...view} = account;
  const groups = [...new Set(account.positions.map(position => position.poolAddress))].map(poolAddress => {
    const positions = account.positions.filter(position => position.poolAddress === poolAddress);
    return {poolAddress, name: positions[0].name, positionIds: positions.map(position => position.id), openCount: positions.filter(position => position.status === 'open').length};
  });
  return {...view, latestBasket: account.latestBasket ?? null, balanceSol: account.balanceLamports / LAMPORTS_PER_SOL, seededSol: account.seededLamports / LAMPORTS_PER_SOL,
    seedNote: '10 practice SOL was supplied for this browser. It is not a deposit or earnings.', settlementNote: STILL_SETTLEMENT_NOTE,
    feeModelNote: 'Modelled fees use the observed pool fee/TVL rate over short intervals; they are not earned on-chain fees or a measured position share.',
    positions: view.positions.map(saved => {
      const current = saved.status === 'open' && !fresh(saved.mark.asOf, now) ? markStillPosition(saved, null, now) : saved;
      const {lastFeeRateHourly: _rate, lastFeeRateAsOf: _rateAt, lastObservationAt: _observation, ...position} = current;
      return position;
    }), groups};
}
function inputFields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new StillPaperError('This paper request contains an unsupported field.');
}
function amount(value: unknown) {
  let lamports: number;
  try {lamports = paperLamports(value);} catch {throw new StillPaperError('Enter a paper amount with at most 9 decimal places.');}
  if (lamports < 1_000_000 || lamports > SEED_LAMPORTS) throw new StillPaperError('Choose an amount between 0.001 and 10 practice SOL.');
  return lamports;
}
function address(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new StillPaperError('Choose a pool from the live list.');
  return value;
}
function requestId(input: Record<string, unknown>) {
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId)) throw new StillPaperError('This paper action needs a stable request ID.');
  return input.requestId;
}
function validateStored(account: StillPaperAccount) {
  if (!Number.isSafeInteger(account.balanceLamports) || account.balanceLamports < 0 || account.positions.length > MAX_POSITIONS
    || new Set(account.positions.map(position => position.id)).size !== account.positions.length
    || new TextEncoder().encode(JSON.stringify(account)).length > MAX_ACCOUNT_BYTES) throw new StillPaperError('The paper journal reached its storage limit. Existing records are retained.', 409, 'still_journal_limit');
}
function takeRate(account: StillPaperAccount, now: number) {
  const current = now >= account.activityWindow.at && now - account.activityWindow.at < 60_000 ? account.activityWindow : {at: now, count: 0};
  if (current.count >= 20) throw new StillPaperError('Wait a minute before another paper action.', 429, 'still_rate_limit');
  account.activityWindow = {at: current.at, count: current.count + 1};
}

/** Independent visitor ledger. All final writes are serialized and atomically
 * include the idempotency receipt. Provider reads never hold the object lock. */
export class StillPaperLedger {
  private deps: StillPaperProviders;
  private preparing = new Map<string, {fingerprint: string; promise: Promise<Response>}>();
  constructor(private ctx: DurableObjectState, private env: Env, deps: Partial<StillPaperProviders> = {}) {
    this.deps = {preflight: getStillPreflight, baskets: getStillBaskets, mark: getStillPoolMark, now: Date.now, id: () => crypto.randomUUID(), ...deps};
  }
  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.ctx.blockConcurrencyWhile(async () => {
      try {return {ok: true as const, value: await fn()};} catch (error) {return {ok: false as const, error};}
    });
    if (!result.ok) throw result.error;
    return result.value;
  }
  private async read(account: string) {
    return await this.ctx.storage.get<StillPaperAccount>(accountKey(account)) || initial(this.deps.now());
  }
  private result(account: StillPaperAccount, receipt?: Receipt) {return json({paper: true, account: stillAccountView(account, this.deps.now()), ...(receipt ? {receipt} : {})});}
  private async saved(account: string, id: string, fingerprint: string) {
    const receipt = await this.ctx.storage.get<Receipt>(receiptKey(account, id));
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw new StillPaperError('That request ID is already used for a different paper action.', 409, 'still_request_conflict');
    return this.result(await this.read(account), receipt);
  }
  async handle(account: string, action: string, input: Record<string, unknown> = {}): Promise<Response> {
    try {
      if (!/^[a-f0-9]{64}$/.test(account)) throw new StillPaperError('Invalid paper session.', 401);
      if (action === 'still-account') return this.lock(async () => {
        const state = await this.read(account);
        if (!await this.ctx.storage.get(accountKey(account))) await this.ctx.storage.put(accountKey(account), state);
        return this.result(state);
      });
      if (!['still-open', 'still-basket', 'still-close', 'still-refresh'].includes(action)) throw new StillPaperError('Unknown paper action.', 404);
      const id = requestId(input);
      let normalized: Record<string, unknown>;
      if (action === 'still-refresh') {
        inputFields(input, ['requestId']); normalized = {};
      } else {
        if (input.confirmed !== true) throw new StillPaperError('Review and confirm this paper action first.', 400, 'still_confirmation_required');
        if (action === 'still-close') {
          inputFields(input, ['requestId', 'confirmed', 'positionId']);
          if (typeof input.positionId !== 'string' || !/^paper:[a-zA-Z0-9-]{8,80}$/.test(input.positionId)) throw new StillPaperError('Choose a saved paper position.');
          normalized = {positionId: input.positionId};
        } else if (action === 'still-open') {
          inputFields(input, ['requestId', 'confirmed', 'poolAddress', 'amountSol']);
          normalized = {poolAddress: address(input.poolAddress), amountLamports: amount(input.amountSol)};
        } else {
          inputFields(input, ['requestId', 'confirmed', 'basketId', 'poolAddresses', 'amountSol']);
          if (typeof input.basketId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(input.basketId) || !Array.isArray(input.poolAddresses) || input.poolAddresses.length < 2 || input.poolAddresses.length > 3)
            throw new StillPaperError('Review a complete basket before opening it.');
          normalized = {basketId: input.basketId, poolAddresses: input.poolAddresses.map(address), amountLamports: amount(input.amountSol)};
        }
      }
      const fingerprint = JSON.stringify({action, ...normalized}), key = account + ':' + id;
      const existing = this.preparing.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new StillPaperError('That paper action is already preparing different details.', 409, 'still_request_conflict');
        return (await existing.promise).clone();
      }
      const promise = this.action(account, action, id, fingerprint, normalized);
      this.preparing.set(key, {fingerprint, promise});
      try {return (await promise).clone();} finally {if (this.preparing.get(key)?.promise === promise) this.preparing.delete(key);}
    } catch (error) {
      if (error instanceof StillPaperError) return json({error: error.message, code: error.code, paper: true}, error.status);
      return json({error: 'The paper journal could not complete this action. Your saved balance is unchanged; retry the same action.', code: 'still_journal_unavailable', paper: true}, 503);
    }
  }
  private async action(account: string, action: string, id: string, fingerprint: string, input: Record<string, unknown>) {
    const snapshot = await this.lock(async () => {
      const saved = await this.saved(account, id, fingerprint); if (saved) return saved;
      const current = await this.read(account);
      if (current.actionCount >= MAX_RECEIPTS && action !== 'still-close') throw new StillPaperError('This browser has reached its demo action limit. Saved positions are retained.', 409, 'still_journal_limit');
      if ((action === 'still-open' || action === 'still-basket') && Number(input.amountLamports) > current.balanceLamports) throw new StillPaperError('There is not enough practice SOL for this amount.', 409, 'still_insufficient_balance');
      if (action === 'still-close') {
        const position = current.positions.find(position => position.id === input.positionId);
        if (!position) throw new StillPaperError('This paper position is not in this browser journal.', 404, 'still_position_missing');
        if (position.status === 'closed') throw new StillPaperError('This paper position is already closed.', 409, 'still_already_closed');
      }
      return current;
    });
    if (snapshot instanceof Response) return snapshot;
    const prepared = action === 'still-open' || action === 'still-basket' ? await this.prepare(action, input) : null;
    const marking = action === 'still-close' ? snapshot.positions.filter(position => position.id === input.positionId) : action === 'still-refresh' ? snapshot.positions.filter(position => position.status === 'open') : [];
    // Read each pool once, but mark and settle each distinct position independently.
    const observations = new Map<string, Awaited<ReturnType<typeof getStillPoolMark>>>();
    await Promise.all([...new Set(marking.map(position => position.poolAddress))].map(async pool => {
      try {observations.set(pool, await this.deps.mark(this.env, pool));} catch {observations.set(pool, null);}
    }));
    return this.lock(async () => {
      const saved = await this.saved(account, id, fingerprint); if (saved) return saved;
      const current = await this.read(account);
      if (current.revision !== snapshot.revision) throw new StillPaperError('Your paper journal changed while this action was checked. Retry the same action.', 409, 'still_revision_changed');
      const now = this.deps.now(), at = new Date(now).toISOString(); takeRate(current, now);
      const receipt: Receipt = {requestId: id, action, fingerprint, at, positionIds: [], amountSol: 0, settlementNote: STILL_SETTLEMENT_NOTE};
      if (prepared) {
        if (current.positions.length + prepared.length > MAX_POSITIONS) throw new StillPaperError('This demo journal holds up to 40 positions, including closed positions.', 409, 'still_position_limit');
        const spend = prepared.reduce((sum, position) => sum + position.amountLamports, 0);
        if (spend !== input.amountLamports || spend > current.balanceLamports || prepared.some(position => !fresh(position.entryAsOf, now)))
          throw new StillPaperError('The pool evidence changed or the practice balance is too low. Review again; nothing was spent.', 409, 'still_open_unavailable');
        current.balanceLamports -= spend; current.positions.push(...prepared); receipt.positionIds = prepared.map(position => position.id); receipt.amountSol = spend / LAMPORTS_PER_SOL;
        if (action === 'still-basket') {
          receipt.basket = {id: prepared[0].basketId!, name: prepared[0].basketName!, amountLamports: spend,
            positions: prepared.map(position => ({positionAddress: position.positionAddress, poolAddress: position.poolAddress, amountLamports: position.amountLamports}))};
          current.latestBasket = {eventId: id, basketId: receipt.basket.id, basketName: receipt.basket.name, amountSol: receipt.amountSol, at,
            positionIds: [...receipt.positionIds], stampTarget: {kind: 'still-basket', eventId: id}};
        }
      } else {
        const selected = new Set(marking.map(position => position.id));
        current.positions = current.positions.map(position => selected.has(position.id) ? markStillPosition(position, observations.get(position.poolAddress) ?? null, now) : position);
        receipt.positionIds = [...selected];
        if (action === 'still-close') {
          const position = current.positions.find(position => position.id === input.positionId)!;
          if (position.mark.grossValueSol === null || !fresh(position.mark.asOf, now)) throw new StillPaperError('A fresh price is unavailable. The position remains open and no practice SOL changed.', 409, 'still_close_unavailable');
          const settlement = Math.floor(position.mark.grossValueSol * LAMPORTS_PER_SOL);
          if (!Number.isSafeInteger(settlement) || settlement < 0 || !Number.isSafeInteger(current.balanceLamports + settlement)) throw new StillPaperError('The modelled position value cannot be settled safely.', 409, 'still_close_unavailable');
          position.status = 'closed'; position.closedAt = at; position.settledLamports = settlement;
          current.balanceLamports += settlement; receipt.settledSol = settlement / LAMPORTS_PER_SOL; receipt.amountSol = position.amountSol;
        }
      }
      current.revision++; current.actionCount++; current.updatedAt = at; validateStored(current);
      await this.ctx.storage.put({[accountKey(account)]: current, [receiptKey(account, id)]: receipt});
      return this.result(current, receipt);
    });
  }
  private async prepare(action: string, input: Record<string, unknown>): Promise<StillPaperPosition[]> {
    let legs: {poolAddress: string; weightBps: number}[], basketId: string | null = null, basketName: string | null = null;
    if (action === 'still-open') legs = [{poolAddress: input.poolAddress as string, weightBps: 10000}];
    else {
      const basket = (await this.deps.baskets(this.env)).find(basket => basket.id === input.basketId);
      if (!basket || !Array.isArray(basket.legs) || basket.legs.length < 2 || basket.legs.length > 3) throw new StillPaperError('This basket does not yet have enough live pools. No positions were opened.', 409, 'still_basket_unavailable');
      legs = basket.legs; basketId = basket.id; basketName = basket.name;
      if (JSON.stringify(legs.map(leg => leg.poolAddress)) !== JSON.stringify(input.poolAddresses)) throw new StillPaperError('The basket pools changed. Review its current pre-flight before confirming.', 409, 'still_basket_changed');
    }
    if (new Set(legs.map(leg => leg.poolAddress)).size !== legs.length || legs.some(leg => !Number.isSafeInteger(leg.weightBps) || leg.weightBps < 1) || legs.reduce((sum, leg) => sum + leg.weightBps, 0) !== 10000)
      throw new StillPaperError('The basket split is unavailable. No positions were opened.', 409, 'still_basket_unavailable');
    const total = input.amountLamports as number; let remaining = total;
    const sizes = legs.map((leg, index) => {const size = index === legs.length - 1 ? remaining : Math.floor(total * leg.weightBps / 10000); remaining -= size; return size;});
    if (sizes.some(size => size < 1)) throw new StillPaperError('The paper amount is too small for this split.');
    const results = await Promise.all(legs.map((leg, index) => this.deps.preflight(this.env, leg.poolAddress, sizes[index] / LAMPORTS_PER_SOL)));
    const now = this.deps.now(), at = new Date(now).toISOString();
    return results.map((result, index) => {
      const leg = legs[index], size = sizes[index], ledger = result?.ledger;
      if (!result || result.poolAddress !== leg.poolAddress || result.canOpen !== true || !ledger || !positive(ledger.priceSol) || !fresh(result.fetchedAt, now) || !result.range || !ledger.bins?.length || ledger.bins.length > 69)
        throw new StillPaperError('A fresh price and usable range are required for every pool. No practice SOL was spent.', 409, 'still_open_unavailable');
      const bins = ledger.bins.map(bin => ({priceSol: bin.priceSol, sol: bin.sol, token: bin.token}));
      if (bins.some(bin => !positive(bin.priceSol) || !nonnegative(bin.sol) || !nonnegative(bin.token))) throw new StillPaperError('Range inventory is unavailable.', 409, 'still_open_unavailable');
      // The prepared inventory must be funded by precisely this leg's principal.
      const funded = bins.reduce((sum, bin) => sum + bin.sol + bin.token * ledger.priceSol!, 0);
      if (Math.abs(funded - size / LAMPORTS_PER_SOL) > 1e-8) throw new StillPaperError('Range funding does not match this paper amount.', 409, 'still_open_unavailable');
      const floor = Math.min(...bins.map(bin => bin.priceSol)), top = Math.max(...bins.map(bin => bin.priceSol));
      const positionId = 'paper:' + this.deps.id();
      const position: StillPaperPosition = {id: positionId, positionAddress: positionId, poolAddress: leg.poolAddress, name: result.name, basketId, basketName,
        status: 'open', openedAt: at, closedAt: null, amountLamports: size, amountSol: size / LAMPORTS_PER_SOL,
        entryPriceSol: ledger.priceSol, entryAsOf: result.fetchedAt!, entryCostsSol: nonnegative(ledger.entryCostsSol) ? ledger.entryCostsSol : null,
        exitCostsSol: nonnegative(ledger.exitCostsSol) ? ledger.exitCostsSol : null, transferFeeBps: nonnegative(ledger.transferFeeBps) ? ledger.transferFeeBps : null,
        range: {shape: result.range.shape, floorPriceSol: floor, topPriceSol: top, bins, note: result.range.note},
        lastObservationAt: at, lastFeeRateHourly: nonnegative(ledger.feeRateHourly) ? ledger.feeRateHourly : null, lastFeeRateAsOf: result.feeRateHourly.asOf,
        settledLamports: null, settlementNote: STILL_SETTLEMENT_NOTE,
        mark: {asOf: result.fetchedAt!, checkedAt: at, source: result.priceSol.source, priceSol: ledger.priceSol,
          grossValueSol: size / LAMPORTS_PER_SOL, grossPnlSol: 0, netPnlSol: null, feesSol: ledger.feeRateHourly === null ? null : 0, observedFeesSol: 0,
          feesCoverageComplete: ledger.feeRateHourly !== null, inRange: null, rangeStatus: 'unavailable', distanceToFloorPct: null, unavailableReasons: []}};
      return markStillPosition(position, {poolAddress: leg.poolAddress, priceSol: ledger.priceSol, fetchedAt: result.fetchedAt, feeRateHourly: ledger.feeRateHourly,
        feeRateAsOf: result.feeRateHourly.asOf, source: result.priceSol.source}, now);
    });
  }
}
