import type {Env} from './env';
import {StillPaperLedger} from './still-paper';
import {RangeInbox as LegacyRangeInbox} from './range-alerts';
import {fleetEquity, fleetRisk, fleetFresh, type FleetState, type FleetClosed} from './paper-fleet';
import {LAMPORTS_PER_SOL, MAX_ACCOUNT_SOL, paperLamports, paperProfitSplit, paperPeakAfterWithdrawal} from './worldsfair-paper-math';
import {preparePaperBasketPurchase, markPaperBaskets, PaperBasketError, type PaperBasketHolding, type PaperBasketPurchase, type PaperBasketMarks, type PaperBasketValuation} from './worldsfair-paper-baskets';
import {preparePaperVaultDeposit, accruePaperVault, PaperVaultError, type PaperVaultDeposit, type PaperVaultHolding} from './worldsfair-paper-vaults';
import {DEFAULT_PAPER_PROFIT_RULE, validateProfitRule, splitPaperProfitRule, lamportsAsSol, type PaperProfitRule} from './worldsfair-profit-rule';
import {PaperStampError, stampTarget, stampSignature, createStampReceipt, confirmDevnetStamp, type PaperStampTarget, type PaperStampReceipt} from './worldsfair-devnet';

const COOKIE = '__Host-worldsfair-paper';
const PAGE_SIZE = 30;
const MAX_HOLDINGS = 40, MAX_STATE_BYTES = 104000, MAX_OUTBOX_BYTES = 120000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
export const paperDigest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
const cookieToken = (request: Request) => request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
const keyFor = (account: string) => 'wf:account:' + account;
const eventPrefix = (account: string) => 'wf:event:' + account + ':';
const sequenceKey = (sequence: number) => String(sequence).padStart(12, '0');
const claimKey = async (id: string, closedAt: string) => 'wf:claim:' + await paperDigest('fleet:' + id + ':' + closedAt);

export interface PaperHolding {id: string; kind: 'basket' | 'vault'; [field: string]: unknown}
export interface WorldsfairPaperAccount {
  version: 1; revision: number; balanceLamports: number; seededLamports: number;
  rolledProfitLamports: number; retainedLpLamports: number; holdings: PaperHolding[];
  createdAt: string; updatedAt: string; activityWindow: {at: number; count: number};
  profitRule?: PaperProfitRule & {version: number};
}
export interface PaperAllocationSnapshot {cashSol: number; lpContributedSol: number; vaultCostSol: number; basketCostSol: number}
export interface WorldsfairPaperEvent {
  id: string; sequence: number; kind: 'seed' | 'roll' | 'basket' | 'refresh' | 'deposit' | 'rule'; at: string;
  amountSol: number; amountLamports: number; balanceSol: number;
  source?: 'fleet'; tradeId?: string; closedAt?: string; pair?: string; arm?: string;
  percent?: number; profitSol?: number; retainedSol?: number;
  holdingId?: string; slug?: string; name?: string; quoteAsOf?: string;
  holdingCount?: number; completeCount?: number; valuationAsOf?: string;
  ideaId?: string; holdingIds?: string[]; ruleApplied?: boolean; ruleVersion?: number;
  ruleAllocation?: {lpSol: number; vaultSol: number; basketSol: number};
  profitRule?: PaperProfitRule & {version: number}; allocationSnapshot?: PaperAllocationSnapshot;
}
interface Receipt {fingerprint: string; event: WorldsfairPaperEvent}
interface Claim {account: string; requestId: string; event: WorldsfairPaperEvent}
interface Outbox {state: WorldsfairPaperAccount; events: WorldsfairPaperEvent[]}
class PaperError extends Error {constructor(message: string, readonly status = 400, readonly code = 'invalid_paper_request') {super(message);}}
function initialAccount(now = Date.now()): WorldsfairPaperAccount {
  const at = new Date(now).toISOString();
  return {version: 1, revision: 0, balanceLamports: 0, seededLamports: 0, rolledProfitLamports: 0, retainedLpLamports: 0, holdings: [], createdAt: at, updatedAt: at, activityWindow: {at: now, count: 0}};
}
export function paperAccountView(account: WorldsfairPaperAccount) {
  const {activityWindow, ...view} = account;
  return {...view, profitRule: savedProfitRule(account), allocationSnapshot: allocationSnapshot(account),
    holdings: account.holdings.map(holding => holding.kind === 'vault' ? {...holding, accrual: accruePaperVault(holding as unknown as PaperVaultHolding, Date.now())} : holding),
    balanceSol: account.balanceLamports / LAMPORTS_PER_SOL, seededSol: account.seededLamports / LAMPORTS_PER_SOL,
    rolledProfitSol: account.rolledProfitLamports / LAMPORTS_PER_SOL, retainedLpSol: account.retainedLpLamports / LAMPORTS_PER_SOL};
}
const savedProfitRule = (account: WorldsfairPaperAccount) => account.profitRule || {...DEFAULT_PAPER_PROFIT_RULE, version: 0};
function allocationSnapshot(account: WorldsfairPaperAccount): PaperAllocationSnapshot {
  const cost = (kind: string) => account.holdings.filter(holding => holding.kind === kind).reduce((sum, holding) => sum + (Number.isSafeInteger(holding.amountLamports) ? holding.amountLamports as number : 0), 0) / LAMPORTS_PER_SOL;
  return {cashSol: account.balanceLamports / LAMPORTS_PER_SOL, lpContributedSol: account.retainedLpLamports / LAMPORTS_PER_SOL, vaultCostSol: cost('vault'), basketCostSol: cost('basket')};
}
function exactFields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new PaperError('This request contains an unsupported field.');
}
function boundedRecords(state: WorldsfairPaperAccount, outbox: Outbox) {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes(state) > MAX_STATE_BYTES) throw new PaperError('This Paper account has reached its saved-detail limit. No new money action was recorded.', 409, 'paper_account_full');
  if (bytes(outbox) > MAX_OUTBOX_BYTES) throw new PaperError('The Paper history copy must catch up before more details can be saved. Retry shortly.', 503, 'paper_persistence_pending');
}
function basketHolding(purchase: PaperBasketPurchase, amount: number, slug: string, id: string, at: string): PaperHolding {
  if (purchase.slug !== slug || purchase.kind !== 'basket' || purchase.paper !== true || purchase.amountLamports !== amount
      || !Number.isSafeInteger(purchase.amountLamports) || purchase.costSol !== amount / LAMPORTS_PER_SOL
      || !Number.isFinite(purchase.expiresAt) || purchase.expiresAt <= Date.now() || !Number.isFinite(Date.parse(purchase.quoteAsOf)))
    throw new PaperError('Basket quotes expired or did not match this Paper amount. Refresh and try again.', 409, 'paper_quote_expired');
  if (!Array.isArray(purchase.legs) || !purchase.legs.length || purchase.legs.length > 20
      || purchase.legs.reduce((sum, leg) => sum + leg.inputLamports, 0) !== amount
      || purchase.legs.some(leg => !Number.isSafeInteger(leg.inputLamports) || leg.inputLamports <= 0 || !/^\d+$/.test(leg.unitsRaw) || BigInt(leg.unitsRaw) <= 0n || !Number.isInteger(leg.decimals) || leg.decimals < 0 || leg.decimals > 18))
    throw new PaperError('Every basket leg needs a complete matching quote. No Paper SOL was spent.', 409, 'paper_quote_incomplete');
  return {...purchase, id, openedAt: at};
}
function vaultHolding(deposit: PaperVaultDeposit, amount: number, ideaId: string, id: string, at: string): PaperHolding {
  if (deposit.ideaId !== ideaId || deposit.kind !== 'vault' || deposit.paper !== true || deposit.amountLamports !== amount
      || !Number.isSafeInteger(deposit.amountLamports) || deposit.costSol !== amount / LAMPORTS_PER_SOL
      || !Number.isFinite(deposit.expiresAt) || deposit.expiresAt <= Date.now() || !Number.isFinite(Date.parse(deposit.quoteAsOf))
      || !Number.isFinite(Date.parse(deposit.rateReadAt)) || deposit.rateAsOf !== null && !Number.isFinite(Date.parse(deposit.rateAsOf))
      || !Number.isFinite(deposit.rate) || deposit.rate < 0
      || !['APR', 'APY'].includes(deposit.rateType) || !/^\d+$/.test(deposit.principalUnitsRaw) || BigInt(deposit.principalUnitsRaw) < 1n
      || !Number.isInteger(deposit.decimals) || deposit.decimals < 0 || deposit.decimals > 18)
    throw new PaperError('The vault amount, rate or quote could not be verified. No Paper deposit was made.', 409, 'paper_vault_quote_invalid');
  return {...deposit, id, openedAt: at};
}

/** Public session routing. The token is only an HttpOnly bearer cookie. */
export async function worldsfairPaperRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/api/paper/')) return null;
  const action = path.slice('/api/paper/'.length);
  if (!['account', 'history', 'seed', 'roll', 'basket', 'refresh', 'deposit', 'rule', 'stamp-prepare', 'stamp-confirm', 'stamps', 'still-account', 'still-open', 'still-basket', 'still-refresh', 'still-close'].includes(action)) return json({error: 'Unknown Paper action.'}, 404);
  const read = ['account', 'history', 'stamps', 'still-account'].includes(action);
  if (request.method !== (read ? 'GET' : 'POST')) return json({error: read ? 'Use a Paper account read.' : 'Use a Paper action.'}, 405);
  if (!env.RANGE_ALERTS) return json({error: 'The Paper journal is unavailable.'}, 503);
  if (!read && request.headers.get('origin') !== url.origin) return json({error: 'Open this demo to update its Paper pot.'}, 403);
  if (!read && !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({error: 'Send a JSON Paper action.'}, 415);
  let token = cookieToken(request), created = false;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!read) return json({error: 'Open your Paper pot before changing it.', code: 'paper_session_required'}, 401);
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    created = true;
  }
  let body: string | undefined;
  if (!read) {
    if (Number(request.headers.get('content-length') || 0) > 4096) return json({error: 'Paper request is too large.'}, 413);
    body = await request.text();
    if (body.length > 4096) return json({error: 'Paper request is too large.'}, 413);
  }
  const account = await paperDigest(token);
  const internal = new URL('https://worldsfair-paper/worldsfair-paper/' + action);
  if (url.searchParams.has('cursor')) internal.searchParams.set('cursor', url.searchParams.get('cursor')!);
  let response: Response;
  try {
    const inbox = env.RANGE_ALERTS.get(env.RANGE_ALERTS.idFromName('pat-four-wallets-v1'));
    response = await inbox.fetch(internal.toString(), {
      method: read ? 'GET' : 'POST', headers: {'x-worldsfair-account': account, 'content-type': 'application/json'}, body,
    });
  } catch {return json({error: 'The Paper journal is temporarily unavailable. Retry this same action.', code: 'paper_journal_unavailable'}, 503);}
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store'); headers.set('vary', 'Cookie');
  if (created) headers.set('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
  return new Response(response.body, {status: response.status, headers});
}

/** Same fleet object: source cash and each visitor's pot have one atomic writer. */
export class WorldsfairRangeInbox extends LegacyRangeInbox {
  private preparing = new Map<string, {fingerprint: string; promise: Promise<Response>}>();
  private stillPaper: StillPaperLedger;
  constructor(private paperCtx: DurableObjectState, private paperEnv: Env) {super(paperCtx); this.stillPaper = new StillPaperLedger(paperCtx, paperEnv);}

  private async serialize<T>(run: () => Promise<T>): Promise<T> {
    // Throwing through blockConcurrencyWhile resets a real Durable Object.
    // Preserve ordinary validation conflicts without invalidating its instance.
    const result = await this.paperCtx.blockConcurrencyWhile(async () => {
      try {return {ok: true as const, value: await run()};}
      catch (error) {return {ok: false as const, error};}
    });
    if (!result.ok) throw result.error;
    return result.value;
  }

  private stampKey(account:string,id:string) {return 'wf:stamp:'+account+':'+id;}
  private async stampSource(account:string,target:PaperStampTarget) {
    const key=target.kind==='still-basket'?'still:receipt:'+account+':'+target.eventId:target.kind==='pot-roll'?'wf:receipt:'+account+':'+target.eventId:target.kind==='fleet-open'?'fleet-entry:'+target.id:'fleet-trade:'+target.closedAt+':'+target.id;
    return this.paperCtx.storage.get(key);
  }
  private async stampRate(account:string,action:string,limit:number) {
    const key='wf:stamp-rate:'+action+':'+account,now=Date.now(),prior=await this.paperCtx.storage.get<{at:number;count:number}>(key);
    const count=prior&&now-prior.at<60000?prior.count:0;
    if(count>=limit)throw new PaperStampError('Wait a minute before checking more Devnet stamps. Your Paper actions remain saved.',429,'paper_stamp_rate_limit');
    await this.paperCtx.storage.put(key,{at:count?prior!.at:now,count:count+1});
  }
  private async mirrorStamp(account:string,receipt:PaperStampReceipt) {
    const outbox='wf:stamp-outbox:'+account+':'+receipt.id;
    if(!await this.paperCtx.storage.get(outbox))return true;
    try {await this.paperEnv.LP_CACHE.put(this.stampKey(account,receipt.id),JSON.stringify(receipt));await this.paperCtx.storage.delete(outbox);return true;}
    catch {return false;}
  }
  private stampResponse(receipt:PaperStampReceipt,saved:boolean,status=200) {
    return json({paper:true,cluster:'devnet',receipt,persistence:saved?'saved':'retrying',...(status===202?{status:'pending'}:{})},status);
  }
  private async stampPrepare(account:string,input:Record<string,unknown>) {
    exactFields(input,['target','wallet']);
    const target=stampTarget(input.target);
    return this.serialize(async()=>{
      const receipt=await createStampReceipt(account,target,await this.stampSource(account,target),input.wallet),key=this.stampKey(account,receipt.id);
      const prior=await this.paperCtx.storage.get<PaperStampReceipt>(key);
      if(prior){
        if(prior.wallet!==receipt.wallet)throw new PaperStampError('This Paper record already has a stamp prepared for another Phantom address. Use that address to check its stamp.',409,'paper_stamp_wallet_changed');
        return this.stampResponse(prior,await this.mirrorStamp(account,prior));
      }
      const existing=await this.paperCtx.storage.list({prefix:'wf:stamp:'+account+':',limit:200});
      if(existing.size>=200)throw new PaperStampError('This browser has reached the 200-record Devnet stamp limit. Paper actions are still available.',409,'paper_stamps_full');
      await this.stampRate(account,'prepare',8);
      await this.paperCtx.storage.put({[key]:receipt,['wf:stamp-outbox:'+account+':'+receipt.id]:true});
      return this.stampResponse(receipt,await this.mirrorStamp(account,receipt));
    });
  }
  private async stampConfirm(account:string,input:Record<string,unknown>) {
    exactFields(input,['receiptId','signature']);
    if(typeof input.receiptId!=='string'||!/^[a-f0-9]{64}$/.test(input.receiptId)||!stampSignature(input.signature))throw new PaperStampError('Choose a saved Devnet stamp and its signature.');
    const id=input.receiptId,signature=input.signature,key=this.stampKey(account,id);
    const prepared=await this.serialize(async()=>{
      const receipt=await this.paperCtx.storage.get<PaperStampReceipt>(key);
      if(!receipt)throw new PaperStampError('This browser has no prepared stamp for that Paper event.',404,'paper_stamp_missing');
      if(receipt.status==='confirmed'){
        if(receipt.signature!==signature)throw new PaperStampError('This Paper record already has a different confirmed Devnet stamp.',409,'paper_stamp_already_confirmed');
        return this.stampResponse(receipt,await this.mirrorStamp(account,receipt));
      }
      await this.stampRate(account,'confirm',30);
      return receipt;
    });
    if(prepared instanceof Response)return prepared;
    // Devnet reads never hold the fleet's money writer lock or alter its revision.
    const confirmed=await confirmDevnetStamp(prepared,signature);
    if(!confirmed)return this.serialize(async()=>{
      const current=await this.paperCtx.storage.get<PaperStampReceipt>(key);
      if(!current)throw new PaperStampError('The prepared Devnet stamp is unavailable.',404,'paper_stamp_missing');
      if(current.status==='confirmed'&&current.signature!==signature)throw new PaperStampError('Another Devnet stamp has already been confirmed for this Paper record.',409,'paper_stamp_already_confirmed');
      return this.stampResponse(current,await this.mirrorStamp(account,current),current.status==='confirmed'?200:202);
    });
    return this.serialize(async()=>{
      const current=await this.paperCtx.storage.get<PaperStampReceipt>(key);
      if(!current)throw new PaperStampError('The prepared Devnet stamp is unavailable.',404,'paper_stamp_missing');
      if(current.status==='confirmed'){
        if(current.signature!==signature)throw new PaperStampError('Another Devnet stamp has already been confirmed for this Paper record.',409,'paper_stamp_already_confirmed');
        return this.stampResponse(current,await this.mirrorStamp(account,current));
      }
      const checked=await createStampReceipt(account,current.target,await this.stampSource(account,current.target),current.wallet);
      if(checked.id!==current.id||checked.eventHash!==current.eventHash||checked.memo!==current.memo)throw new PaperStampError('The saved Paper evidence no longer matches this stamp.',409,'paper_stamp_event_changed');
      const receipt:PaperStampReceipt={...current,...confirmed,status:'confirmed'};
      await this.paperCtx.storage.put({[key]:receipt,['wf:stamp-outbox:'+account+':'+id]:true});
      return this.stampResponse(receipt,await this.mirrorStamp(account,receipt));
    });
  }
  private async stampList(account:string) {
    const pending=await this.paperCtx.storage.list({prefix:'wf:stamp-outbox:'+account+':',limit:5});
    for(const key of pending.keys()){
      const id=key.slice(('wf:stamp-outbox:'+account+':').length),receipt=await this.paperCtx.storage.get<PaperStampReceipt>(this.stampKey(account,id));
      if(receipt)await this.mirrorStamp(account,receipt);
    }
    const rows=await this.paperCtx.storage.list<PaperStampReceipt>({prefix:'wf:stamp:'+account+':',limit:200});
    const receipts=[...rows.values()].sort((a,b)=>(b.confirmedAt||b.createdAt).localeCompare(a.confirmedAt||a.createdAt)).slice(0,50);
    return json({paper:true,cluster:'devnet',receipts});
  }

  private async mirror(account: string): Promise<boolean> {
    const key = 'wf:outbox:' + account, pending = await this.paperCtx.storage.get<Outbox>(key);
    if (!pending) return true;
    try {
      await Promise.all(pending.events.map(event => this.paperEnv.LP_CACHE.put(eventPrefix(account) + sequenceKey(event.sequence), JSON.stringify(event))));
      await this.paperEnv.LP_CACHE.put(keyFor(account), JSON.stringify(pending.state));
      await this.paperCtx.storage.delete(key);
      return true;
    } catch { return false; }
  }

  private async history(account: string, cursor: string | null = null) {
    if (cursor !== null && !/^\d{12}$/.test(cursor)) throw new PaperError('Invalid Paper history cursor.');
    const prefix = eventPrefix(account);
    const records = await this.paperCtx.storage.list<WorldsfairPaperEvent>({prefix, reverse: true, limit: PAGE_SIZE + 1, ...(cursor ? {end: prefix + cursor} : {})});
    const events = [...records.values()], shown = events.slice(0, PAGE_SIZE);
    return {history: shown, cursor: events.length > PAGE_SIZE ? sequenceKey(shown[shown.length - 1].sequence) : null};
  }

  private async response(account: string, state: WorldsfairPaperAccount, saved: boolean, receipt?: WorldsfairPaperEvent, cursor: string | null = null) {
    const holding = receipt?.kind === 'basket' ? state.holdings.find(row => row.id === receipt.holdingId) : null;
    const publicReceipt = receipt && holding ? {...receipt, legs: holding.legs} : receipt;
    return json({paper: true, account: paperAccountView(state), ...await this.history(account, cursor), persistence: saved ? 'saved' : 'retrying', ...(publicReceipt ? {receipt: publicReceipt} : {})});
  }

  private mutationCount(state: WorldsfairPaperAccount, now = Date.now()) {
    const count = now - state.activityWindow.at < 60000 ? state.activityWindow.count : 0;
    if (count >= 20) throw new PaperError('Wait a minute before adding more Paper actions.', 429, 'paper_rate_limit');
    return count;
  }

  private async reserveProviderRead(account: string) {
    const rateKey = 'wf:provider-rate:' + account, rate = await this.paperCtx.storage.get<{at: number; count: number}>(rateKey), now = Date.now();
    const count = rate && now - rate.at < 60000 ? rate.count : 0;
    if (count >= 8) throw new PaperError('Wait a minute before requesting more Paper price checks.', 429, 'paper_provider_rate_limit');
    await this.paperCtx.storage.put(rateKey, {at: count ? rate!.at : now, count: count + 1});
  }

  private async trustedProfit(input: Record<string, unknown>) {
    if (input.source !== 'fleet' || typeof input.id !== 'string' || input.id.length > 240 || !/^fleet:(?:farmer|scalp|wide|steady):/.test(input.id)
        || typeof input.closedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.closedAt))
      throw new PaperError('Choose a scored close from a funded Paper fleet wallet.');
    const globalClaimKey = await claimKey(input.id, input.closedAt);
    if (await this.paperCtx.storage.get(globalClaimKey)) throw new PaperError('This Paper close has already been rolled. Its remaining profit stays as LP capital.', 409, 'paper_profit_claimed');
    const trade = await this.paperCtx.storage.get<FleetClosed>('fleet-trade:' + input.closedAt + ':' + input.id);
    if (!trade || trade.id !== input.id || trade.closedAt !== input.closedAt || !trade.id.startsWith('fleet:' + trade.arm + ':') || !['farmer', 'scalp', 'wide', 'steady'].includes(trade.arm)
        || !Number.isFinite(trade.exitSol) || trade.exitSol <= 0 || !Number.isFinite(trade.pnlSol) || trade.pnlSol <= 0)
      throw new PaperError('That profitable funded Paper close could not be verified.', 404, 'paper_close_unavailable');
    const fleet = await this.paperCtx.storage.get<FleetState>('fleet');
    if (!fleet || !fleet.portfolios[trade.arm] || !fleetFresh(fleet.lastScanAt, Date.now())) throw new PaperError('Wait for a fresh Paper fleet scan before moving its cash.', 409, 'paper_source_stale');
    const equity = fleetEquity(fleet, trade.arm), risk = fleetRisk(fleet, trade.arm);
    if (equity === null || risk.incomplete || !Number.isFinite(equity)) throw new PaperError('Complete fresh Paper position values are needed before moving profit.', 409, 'paper_source_incomplete');
    return {trade, fleet, equity, globalClaimKey};
  }

  private async rollAction(account: string, input: Record<string, unknown>): Promise<Response> {
    const requestId = input.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new PaperError('A stable Paper request ID is required.');
    exactFields(input, ['source', 'id', 'closedAt', 'percent', 'requestId']);
    const fingerprint = await paperDigest(JSON.stringify({action: 'roll', source: input.source, id: input.id, closedAt: input.closedAt, percent: input.percent ?? 50}));
    const key = account + ':' + requestId, underway = this.preparing.get(key);
    if (underway) {
      if (underway.fingerprint !== fingerprint) throw new PaperError('That Paper request ID already belongs to another action.', 409, 'paper_request_conflict');
      return (await underway.promise).clone();
    }
    const promise = this.runRuleRoll(account, input, requestId, fingerprint);
    this.preparing.set(key, {fingerprint, promise});
    try {return (await promise).clone();} finally {this.preparing.delete(key);}
  }

  private async runRuleRoll(account: string, input: Record<string, unknown>, requestId: string, fingerprint: string) {
    const receiptKey = 'wf:receipt:' + account + ':' + requestId;
    const replay = async (state: WorldsfairPaperAccount) => {
      const prior = await this.paperCtx.storage.get<Receipt>(receiptKey);
      if (!prior) return null;
      if (prior.fingerprint !== fingerprint) throw new PaperError('That Paper request ID already belongs to another action.', 409, 'paper_request_conflict');
      return this.response(account, state, await this.mirror(account), prior.event);
    };
    const prepared = await this.serialize(async () => {
      const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount();
      const existing = await replay(state); if (existing) return existing;
      const rule = savedProfitRule(state);
      if (!rule.enabled) return this.mutate(account, 'roll', input);
      validateProfitRule({...rule});
      this.mutationCount(state);
      const source = await this.trustedProfit(input), profit = paperProfitSplit(source.trade.pnlSol, 100).profitLamports;
      const split = splitPaperProfitRule(profit, rule), withdrawal = (split.vaultLamports + split.basketLamports) / LAMPORTS_PER_SOL;
      if (state.holdings.length + Number(split.vaultLamports > 0) + Number(split.basketLamports > 0) > MAX_HOLDINGS) throw new PaperError('This rule would exceed the 40-holding Paper account limit.', 409, 'paper_holdings_full');
      if (!Number.isFinite(source.fleet.portfolios[source.trade.arm].cashSol) || source.fleet.portfolios[source.trade.arm].cashSol < withdrawal)
        throw new PaperError('The Paper strategy has already committed this cash. Wait for available LP cash.', 409, 'paper_cash_unavailable');
      const pending = await this.paperCtx.storage.get<Outbox>('wf:outbox:' + account);
      if ((pending?.events.length || 0) >= 30) throw new PaperError('The Paper history copy is catching up. Retry shortly.', 503, 'paper_persistence_pending');
      if (withdrawal > 0) await this.reserveProviderRead(account);
      return {rule, split, trade: source.trade};
    });
    if (prepared instanceof Response) return prepared;
    const {rule, split} = prepared;
    // Both reads settle before commitment. A failed leg cannot reserve a close
    // or leave a half-funded rule allocation behind.
    const results = await Promise.allSettled([
      split.vaultLamports ? preparePaperVaultDeposit(this.paperEnv, {ideaId: rule.vaultId!, amountSol: lamportsAsSol(split.vaultLamports)}) : Promise.resolve(null),
      split.basketLamports ? preparePaperBasketPurchase(this.paperEnv, {slug: rule.basketSlug!, amountSol: lamportsAsSol(split.basketLamports)}) : Promise.resolve(null),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const vault = (results[0] as PromiseFulfilledResult<PaperVaultDeposit | null>).value;
    const basket = (results[1] as PromiseFulfilledResult<PaperBasketPurchase | null>).value;
    if (split.vaultLamports > 0 && !vault || split.basketLamports > 0 && !basket)
      throw new PaperError('Every allocated share needs a verified Paper holding. No profit was moved.', 503, 'paper_allocation_incomplete');
    return this.serialize(async () => {
      const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount();
      const existing = await replay(state); if (existing) return existing;
      if (JSON.stringify(savedProfitRule(state)) !== JSON.stringify(rule)) throw new PaperError('Your profit rule changed while quotes loaded. Review the saved rule and retry.', 409, 'paper_rule_changed');
      const source = await this.trustedProfit(input);
      if (JSON.stringify(source.trade) !== JSON.stringify(prepared.trade)) throw new PaperError('The saved close changed while quotes loaded. No Paper allocation was made.', 409, 'paper_close_changed');
      const withdrawalLamports = split.vaultLamports + split.basketLamports, amountSol = withdrawalLamports / LAMPORTS_PER_SOL;
      const now = Date.now(), at = new Date(now).toISOString(), count = this.mutationCount(state), next = structuredClone(state);
      if (next.holdings.length + Number(vault !== null) + Number(basket !== null) > MAX_HOLDINGS) throw new PaperError('This rule would exceed the 40-holding Paper account limit.', 409, 'paper_holdings_full');
      const holdingIds: string[] = [];
      if (vault) {const id = 'vault:' + requestId; next.holdings.push(vaultHolding(vault, split.vaultLamports, rule.vaultId!, id, at)); holdingIds.push(id);}
      if (basket) {const id = 'basket:' + requestId; next.holdings.push(basketHolding(basket, split.basketLamports, rule.basketSlug!, id, at)); holdingIds.push(id);}
      const wallet = source.fleet.portfolios[source.trade.arm];
      if (!Number.isFinite(wallet.cashSol) || wallet.cashSol < amountSol) throw new PaperError('The Paper strategy committed this cash while quotes loaded. Retry when LP cash is available.', 409, 'paper_cash_unavailable');
      if (amountSol > 0) {
        wallet.peakSol = paperPeakAfterWithdrawal(wallet.peakSol, source.equity, amountSol);
        wallet.cashSol -= amountSol; wallet.withdrawnSol = (wallet.withdrawnSol || 0) + amountSol;
      }
      source.fleet.revision++;
      source.fleet.events = [...source.fleet.events, {at, arm: source.trade.arm, pair: source.trade.pair, message: `Applied a Paper profit rule: ${split.lpLamports / LAMPORTS_PER_SOL} SOL stays as LP capital; ${amountSol} SOL allocated to Paper holdings.`}].slice(-100);
      next.revision++; next.updatedAt = at; next.activityWindow = {at: count ? state.activityWindow.at : now, count: count + 1};
      next.rolledProfitLamports += withdrawalLamports; next.retainedLpLamports += split.lpLamports;
      if (![next.rolledProfitLamports, next.retainedLpLamports].every(Number.isSafeInteger)) throw new PaperError('This Paper account has reached its ledger limit.');
      const event: WorldsfairPaperEvent = {id: requestId, sequence: next.revision, kind: 'roll', at, amountLamports: withdrawalLamports, amountSol,
        balanceSol: next.balanceLamports / LAMPORTS_PER_SOL, source: 'fleet', tradeId: source.trade.id, closedAt: source.trade.closedAt, pair: source.trade.pair, arm: source.trade.arm,
        profitSol: source.trade.pnlSol, retainedSol: split.lpLamports / LAMPORTS_PER_SOL, holdingIds, ruleApplied: true, ruleVersion: rule.version,
        ruleAllocation: {lpSol: split.lpLamports / LAMPORTS_PER_SOL, vaultSol: split.vaultLamports / LAMPORTS_PER_SOL, basketSol: split.basketLamports / LAMPORTS_PER_SOL}, allocationSnapshot: allocationSnapshot(next)};
      await this.mirror(account);
      const pending = await this.paperCtx.storage.get<Outbox>('wf:outbox:' + account);
      if ((pending?.events.length || 0) >= 30) throw new PaperError('The Paper history copy is catching up. Retry shortly.', 503, 'paper_persistence_pending');
      const outbox: Outbox = {state: next, events: [...(pending?.events || []), event]}; boundedRecords(next, outbox);
      await this.paperCtx.storage.put({fleet: source.fleet, [keyFor(account)]: next, [eventPrefix(account) + sequenceKey(event.sequence)]: event,
        [receiptKey]: {fingerprint, event} satisfies Receipt, [source.globalClaimKey]: {account, requestId, event} satisfies Claim, ['wf:outbox:' + account]: outbox});
      return this.response(account, next, await this.mirror(account), event);
    });
  }

  private async providerAction(account: string, action: 'basket' | 'refresh' | 'deposit', input: Record<string, unknown>): Promise<Response> {
    const requestId = input.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new PaperError('A stable Paper request ID is required.');
    exactFields(input, action === 'basket' ? ['slug', 'amountSol', 'requestId'] : action === 'deposit' ? ['ideaId', 'amountSol', 'requestId'] : ['requestId']);
    if (action === 'basket' && (typeof input.slug !== 'string' || !/^[a-z0-9-]{1,90}$/.test(input.slug))) throw new PaperError('Choose a published basket.');
    if (action === 'deposit' && (typeof input.ideaId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/.test(input.ideaId))) throw new PaperError('Choose an available Solana vault or liquid-staking idea.');
    const amount = action === 'refresh' ? 0 : paperLamports(input.amountSol);
    const fingerprint = await paperDigest(JSON.stringify(action === 'basket' ? {action, slug: input.slug, amountSol: String(input.amountSol)} : action === 'deposit' ? {action, ideaId: input.ideaId, amountSol: String(input.amountSol)} : {action}));
    const flightKey = account + ':' + requestId, underway = this.preparing.get(flightKey);
    if (underway) {
      if (underway.fingerprint !== fingerprint) throw new PaperError('That Paper request ID already belongs to another action.', 409, 'paper_request_conflict');
      return (await underway.promise).clone();
    }
    const promise = this.runProviderAction(account, action, input, requestId, fingerprint, amount);
    this.preparing.set(flightKey, {fingerprint, promise});
    try {return (await promise).clone();}
    finally {this.preparing.delete(flightKey);}
  }

  private async runProviderAction(account: string, action: 'basket' | 'refresh' | 'deposit', input: Record<string, unknown>, requestId: string, fingerprint: string, amount: number) {
    const receiptKey = 'wf:receipt:' + account + ':' + requestId;
    const checkReplay = async (state: WorldsfairPaperAccount) => {
      const prior = await this.paperCtx.storage.get<Receipt>(receiptKey);
      if (!prior) return null;
      if (prior.fingerprint !== fingerprint) throw new PaperError('That Paper request ID already belongs to another action.', 409, 'paper_request_conflict');
      return this.response(account, state, await this.mirror(account), prior.event);
    };
    const checkCapacity = (state: WorldsfairPaperAccount) => {
      this.mutationCount(state);
      if (action !== 'refresh' && state.holdings.length >= MAX_HOLDINGS) throw new PaperError('This Paper account already has 40 holdings.', 409, 'paper_holdings_full');
      if (action !== 'refresh' && state.balanceLamports < amount) throw new PaperError('Add enough Paper SOL to the Long Game pot before making this Paper allocation.', 409, 'paper_cash_unavailable');
    };
    // Only local journal checks run under this guard. Jupiter's shared budget
    // can call this same Durable Object during the unlocked provider phase.
    const prepared = await this.serialize(async () => {
      const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount();
      const replay = await checkReplay(state); if (replay) return replay;
      checkCapacity(state);
      const pending = await this.paperCtx.storage.get<Outbox>('wf:outbox:' + account);
      if ((pending?.events.length || 0) >= 30) throw new PaperError('The Paper history copy is catching up. Retry shortly.', 503, 'paper_persistence_pending');
      await this.reserveProviderRead(account);
      return state;
    });
    if (prepared instanceof Response) return prepared;
    const baskets = prepared.holdings.filter(row => row.kind === 'basket') as unknown as PaperBasketHolding[];
    const purchase: PaperBasketPurchase | null = action === 'basket'
      ? await preparePaperBasketPurchase(this.paperEnv, {slug: input.slug as string, amountSol: input.amountSol as string | number}) : null;
    const deposit: PaperVaultDeposit | null = action === 'deposit'
      ? await preparePaperVaultDeposit(this.paperEnv, {ideaId: input.ideaId as string, amountSol: input.amountSol as string | number}) : null;
    const marks: PaperBasketMarks | null = action === 'refresh'
      ? await markPaperBaskets(this.paperEnv, baskets) : null;

    return this.serialize(async () => {
      const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount();
      const replay = await checkReplay(state); if (replay) return replay;
      checkCapacity(state);
      await this.mirror(account);
      const pending = await this.paperCtx.storage.get<Outbox>('wf:outbox:' + account);
      if ((pending?.events.length || 0) >= 30) throw new PaperError('The Paper history copy is catching up. Retry shortly.', 503, 'paper_persistence_pending');
      const now = Date.now(), at = new Date(now).toISOString(), count = this.mutationCount(state), next = structuredClone(state);
      next.revision++; next.updatedAt = at; next.activityWindow = {at: count ? state.activityWindow.at : now, count: count + 1};
      let event: WorldsfairPaperEvent;
      if (purchase) {
        const holdingId = 'basket:' + requestId;
        const holding = basketHolding(purchase, amount, input.slug as string, holdingId, at);
        next.balanceLamports -= amount;
        next.holdings.push(holding);
        event = {id: requestId, sequence: next.revision, kind: 'basket', at, amountLamports: amount, amountSol: amount / LAMPORTS_PER_SOL,
          balanceSol: next.balanceLamports / LAMPORTS_PER_SOL, holdingId, slug: purchase.slug, name: purchase.name, quoteAsOf: purchase.quoteAsOf};
      } else if (deposit) {
        const holdingId = 'vault:' + requestId;
        next.holdings.push(vaultHolding(deposit, amount, input.ideaId as string, holdingId, at));
        next.balanceLamports -= amount;
        event = {id: requestId, sequence: next.revision, kind: 'deposit', at, amountLamports: amount, amountSol: amount / LAMPORTS_PER_SOL,
          balanceSol: next.balanceLamports / LAMPORTS_PER_SOL, holdingId, ideaId: deposit.ideaId, name: deposit.name, quoteAsOf: deposit.quoteAsOf};
      } else {
        if (!marks || !Array.isArray(marks.marks)) throw new PaperError('Basket prices could not be read. Saved holdings remain intact.', 503, 'paper_marks_unavailable');
        const eligible = new Set(baskets.map(row => row.id));
        if (marks.marks.length !== baskets.length || new Set(marks.marks.map(mark => mark.holdingId)).size !== marks.marks.length
            || marks.marks.some(mark => !eligible.has(mark.holdingId) || !['complete', 'partial', 'unavailable'].includes(mark.status)
              || !Number.isFinite(Date.parse(mark.readAt)) || [mark.valueSol, mark.valueUsd, mark.pnlSol, mark.vsHoldSolUsd, mark.absolutePnlUsd].some(value => value !== null && !Number.isFinite(value))))
          throw new PaperError('The basket valuation response was incomplete. Earlier dated values remain saved.', 503, 'paper_marks_unavailable');
        const byId = new Map(marks.marks.map(mark => [mark.holdingId, mark]));
        let completeCount = 0;
        next.holdings = next.holdings.map(holding => {
          const valuation = byId.get(holding.id);
          if (!valuation || holding.kind !== 'basket') return holding;
          const old = holding.valuation as PaperBasketValuation | undefined;
          if (!Number.isFinite(Date.parse(valuation.readAt)) || old && Date.parse(old.readAt) > Date.parse(valuation.readAt)) return holding;
          if (valuation.status === 'complete') {
            completeCount++;
            const {lastCompleteValuation, ...rest} = holding;
            return {...rest, valuation};
          }
          return {...holding, valuation, ...(old?.status === 'complete' ? {lastCompleteValuation: old} : {})};
        });
        event = {id: requestId, sequence: next.revision, kind: 'refresh', at, amountLamports: 0, amountSol: 0,
          balanceSol: next.balanceLamports / LAMPORTS_PER_SOL, holdingCount: byId.size, completeCount, valuationAsOf: marks.asOf};
      }
      event.allocationSnapshot = allocationSnapshot(next);
      const outbox: Outbox = {state: next, events: [...(pending?.events || []), event]};
      boundedRecords(next, outbox);
      await this.paperCtx.storage.put({[keyFor(account)]: next, [eventPrefix(account) + sequenceKey(event.sequence)]: event,
        [receiptKey]: {fingerprint, event} satisfies Receipt, ['wf:outbox:' + account]: outbox});
      return this.response(account, next, await this.mirror(account), event);
    });
  }

  private async mutate(account: string, action: string, input: Record<string, unknown>) {
    const now = Date.now(), at = new Date(now).toISOString();
    const requestId = input.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new PaperError('A stable Paper request ID is required.');
    exactFields(input, action === 'seed' ? ['amountSol', 'requestId'] : action === 'rule' ? ['enabled', 'lpPercent', 'vaultPercent', 'basketPercent', 'vaultId', 'basketSlug', 'requestId'] : ['source', 'id', 'closedAt', 'percent', 'requestId']);
    const chosenRule = action === 'rule' ? validateProfitRule(input) : null;
    const fingerprint = await paperDigest(JSON.stringify(action === 'seed' ? {action, amountSol: String(input.amountSol)} : chosenRule ? {action, ...chosenRule} : {action, source: input.source, id: input.id, closedAt: input.closedAt, percent: input.percent ?? 50}));
    const receiptKey = 'wf:receipt:' + account + ':' + requestId;
    const prior = await this.paperCtx.storage.get<Receipt>(receiptKey);
    const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount(now);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new PaperError('That Paper request ID already belongs to another action.', 409, 'paper_request_conflict');
      return this.response(account, state, await this.mirror(account), prior.event);
    }
    await this.mirror(account);
    const pending = await this.paperCtx.storage.get<Outbox>('wf:outbox:' + account);
    if ((pending?.events.length || 0) >= 30) throw new PaperError('The Paper history copy is catching up. Retry this action shortly.', 503, 'paper_persistence_pending');
    const count = now - state.activityWindow.at < 60000 ? state.activityWindow.count : 0;
    if (count >= 20) throw new PaperError('Wait a minute before adding more Paper actions.', 429, 'paper_rate_limit');
    const next = structuredClone(state);
    next.revision++; next.updatedAt = at; next.activityWindow = {at: count ? state.activityWindow.at : now, count: count + 1};
    const records: Record<string, unknown> = {};
    let event: WorldsfairPaperEvent;
    if (chosenRule) {
      next.profitRule = {...chosenRule, version: savedProfitRule(state).version + 1};
      event = {id: requestId, sequence: next.revision, kind: 'rule', at, amountLamports: 0, amountSol: 0, balanceSol: next.balanceLamports / LAMPORTS_PER_SOL, profitRule: next.profitRule};
    } else if (action === 'seed') {
      const amount = paperLamports(input.amountSol);
      if (next.seededLamports + amount > MAX_ACCOUNT_SOL * LAMPORTS_PER_SOL) throw new PaperError('This Paper account has reached its demo seed limit.');
      next.balanceLamports += amount; next.seededLamports += amount;
      event = {id: requestId, sequence: next.revision, kind: 'seed', at, amountLamports: amount, amountSol: amount / LAMPORTS_PER_SOL, balanceSol: next.balanceLamports / LAMPORTS_PER_SOL};
    } else {
      if (input.source !== 'fleet' || typeof input.id !== 'string' || input.id.length > 240 || !/^fleet:(?:farmer|scalp|wide|steady):/.test(input.id)
          || typeof input.closedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.closedAt))
        throw new PaperError('Choose a scored close from a funded Paper fleet wallet.');
      const globalClaimKey = await claimKey(input.id, input.closedAt);
      if (await this.paperCtx.storage.get(globalClaimKey)) throw new PaperError('This Paper close has already been rolled. Its remaining profit stays as LP capital.', 409, 'paper_profit_claimed');
      const trade = await this.paperCtx.storage.get<FleetClosed>('fleet-trade:' + input.closedAt + ':' + input.id);
      if (!trade || trade.id !== input.id || trade.closedAt !== input.closedAt || !trade.id.startsWith('fleet:' + trade.arm + ':') || !['farmer', 'scalp', 'wide', 'steady'].includes(trade.arm)
          || !Number.isFinite(trade.exitSol) || trade.exitSol <= 0 || !Number.isFinite(trade.pnlSol) || trade.pnlSol <= 0)
        throw new PaperError('That profitable funded Paper close could not be verified.', 404, 'paper_close_unavailable');
      const fleet = await this.paperCtx.storage.get<FleetState>('fleet');
      if (!fleet || !fleet.portfolios[trade.arm] || !fleetFresh(fleet.lastScanAt, now)) throw new PaperError('Wait for a fresh Paper fleet scan before moving its cash.', 409, 'paper_source_stale');
      const equity = fleetEquity(fleet, trade.arm, now), risk = fleetRisk(fleet, trade.arm, now);
      if (equity === null || risk.incomplete || !Number.isFinite(equity)) throw new PaperError('Complete fresh Paper position values are needed before moving profit.', 409, 'paper_source_incomplete');
      const split = paperProfitSplit(trade.pnlSol, input.percent ?? 50), amountSol = split.amountLamports / LAMPORTS_PER_SOL;
      const wallet = fleet.portfolios[trade.arm];
      if (!Number.isFinite(wallet.cashSol) || wallet.cashSol < amountSol) throw new PaperError('The Paper strategy has already committed this cash. Wait for more available LP cash.', 409, 'paper_cash_unavailable');
      wallet.peakSol = paperPeakAfterWithdrawal(wallet.peakSol, equity, amountSol);
      wallet.cashSol -= amountSol; wallet.withdrawnSol = (wallet.withdrawnSol || 0) + amountSol;
      fleet.revision++;
      fleet.events = [...fleet.events, {at, arm: trade.arm, pair: trade.pair, message: `Rolled ${amountSol} Paper SOL into a Long Game pot; this is a capital transfer, not a trading loss.`}].slice(-100);
      next.balanceLamports += split.amountLamports; next.rolledProfitLamports += split.amountLamports; next.retainedLpLamports += split.retainedLamports;
      event = {id: requestId, sequence: next.revision, kind: 'roll', at, amountLamports: split.amountLamports, amountSol, balanceSol: next.balanceLamports / LAMPORTS_PER_SOL,
        source: 'fleet', tradeId: trade.id, closedAt: trade.closedAt, pair: trade.pair, arm: trade.arm, percent: (input.percent ?? 50) as number, profitSol: trade.pnlSol, retainedSol: split.retainedLamports / LAMPORTS_PER_SOL};
      records.fleet = fleet;
      records[globalClaimKey] = {account, requestId, event} satisfies Claim;
    }
    if (![next.balanceLamports, next.seededLamports, next.rolledProfitLamports, next.retainedLpLamports].every(Number.isSafeInteger)
        || next.balanceLamports > MAX_ACCOUNT_SOL * LAMPORTS_PER_SOL) throw new PaperError('This Paper pot has reached its balance limit.');
    event.allocationSnapshot = allocationSnapshot(next);
    records[keyFor(account)] = next;
    records[eventPrefix(account) + sequenceKey(event.sequence)] = event;
    records[receiptKey] = {fingerprint, event} satisfies Receipt;
    records['wf:outbox:' + account] = {state: next, events: [...(pending?.events || []), event]} satisfies Outbox;
    boundedRecords(next, records['wf:outbox:' + account] as Outbox);
    // Multi-key durable put is atomic: the same commit debits LP cash, credits
    // the pot and claims the closed result. A scan with the old revision fails.
    await this.paperCtx.storage.put(records);
    return this.response(account, next, await this.mirror(account), event);
  }

  private async annotateCloses(response: Response, path: string) {
    if (!response.ok) return response;
    const body = await response.json() as {closed?: FleetClosed[]; records?: FleetClosed[]};
    const rows = path === '/fleet/trades' ? body.records : body.closed;
    if (rows) {
      const enriched = await Promise.all(rows.map(async row => {
        const claim = await this.paperCtx.storage.get<Claim>(await claimKey(row.id, row.closedAt));
        return {...row, profitRoll: {eligible: !claim && Number.isFinite(row.pnlSol) && row.pnlSol > 0 && ['farmer', 'scalp', 'wide', 'steady'].includes(row.arm),
          claimed: !!claim, rolledAt: claim?.event.at ?? null, amountSol: claim?.event.amountSol ?? null}};
      }));
      if (path === '/fleet/trades') body.records = enriched; else body.closed = enriched;
    }
    return json(body);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/worldsfair-paper/')) {
      const response = await super.fetch(request);
      return request.method === 'GET' && ['/fleet', '/fleet/trades'].includes(path) ? this.annotateCloses(response, path) : response;
    }
    const account = request.headers.get('x-worldsfair-account');
    if (!account || !/^[a-f0-9]{64}$/.test(account)) return json({error: 'Invalid Paper session.'}, 401);
    const action = path.slice('/worldsfair-paper/'.length), read = ['account', 'history', 'stamps', 'still-account'].includes(action);
    if (!['account', 'history', 'seed', 'roll', 'basket', 'refresh', 'deposit', 'rule', 'stamp-prepare', 'stamp-confirm', 'stamps', 'still-account', 'still-open', 'still-basket', 'still-refresh', 'still-close'].includes(action)) return json({error: 'Unknown Paper action.'}, 404);
    if (request.method !== (read ? 'GET' : 'POST')) return json({error: 'Invalid Paper method.'}, 405);
    let input: Record<string, unknown> = {};
    if (!read) {
      const text = await request.text();
      if (text.length > 4096) return json({error: 'Paper request is too large.'}, 413);
      try { input = JSON.parse(text); if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(); }
      catch { return json({error: 'Invalid Paper action JSON.'}, 400); }
    }
    if (action.startsWith('still-')) return this.stillPaper.handle(account, action, input);
    const errorResponse = (error: unknown) => {
      if (error instanceof PaperError || error instanceof PaperBasketError || error instanceof PaperVaultError || error instanceof PaperStampError) return json({error: error.message, code: error.code}, error.status);
      if (error instanceof RangeError) return json({error: error.message, code: 'invalid_paper_amount'}, 400);
      return json({error: 'The Paper journal could not finish this request. Retry the same action; existing balances are retained.', code: 'paper_journal_unavailable'}, 503);
    };
    if(action==='stamp-prepare'||action==='stamp-confirm'){
      try{return action==='stamp-prepare'?await this.stampPrepare(account,input):await this.stampConfirm(account,input);}
      catch(error){return errorResponse(error);}
    }
    if (action === 'roll') {
      try {return await this.rollAction(account, input);}
      catch (error) {return errorResponse(error);}
    }
    if (action === 'basket' || action === 'refresh' || action === 'deposit') {
      try {return await this.providerAction(account, action, input);}
      catch (error) {return errorResponse(error);}
    }
    return this.paperCtx.blockConcurrencyWhile(async () => {
      try {
        if(action==='stamps')return await this.stampList(account);
        if (!read) return await this.mutate(account, action, input);
        const state = await this.paperCtx.storage.get<WorldsfairPaperAccount>(keyFor(account)) || initialAccount();
        return await this.response(account, state, await this.mirror(account), undefined, url.searchParams.get('cursor'));
      } catch (error) {return errorResponse(error);}
    });
  }
}
