import type {Env} from './env';
import {normalizeStaking, normalizeBackyard, type YieldIdea} from './long-game';
import {BASKET_SOL, basketMint} from './worldsfair-basket-math';
import {paperLamports, LAMPORTS_PER_SOL} from './worldsfair-paper-math';
import {PaperBasketError, preparePaperTokenQuotes, readPaperTokenPrices} from './worldsfair-paper-baskets';
import {linearVaultEstimate} from './worldsfair-vault-math';

const HOUR = 3600000, QUOTE_TTL = 45000, DEADLINE = 25000;
const STAKING_IDS = new Set(['jito-liquid-staking','marinade-liquid-staking','jupiter-staked-sol']);
const fresh = (timestamp:number, ttl:number) => Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp <= ttl;
export class PaperVaultError extends Error {
  constructor(message:string, readonly status=503, readonly code='vault_provider_unavailable') {super(message);}
}
export interface PaperVaultDeposit {
  paper:true;kind:'vault';ideaId:string;name:string;asset:string;mint:string;
  principalUnitsRaw:string;decimals:number;amountLamports:number;costSol:number;
  rate:number;rateType:'APY'|'APR';rateAsOf:string|null;rateReadAt:string;
  preparedAt:string;quoteAsOf:string;expiresAt:number;
  entrySolUsd:number|null;assetPriceUsd:number|null;assetPriceAsOf:string|null;
  priceImpactFraction:number;basis:'native-sol'|'quoted-token';risk:string;exit:string;note:string;
}
export interface PaperVaultHolding extends PaperVaultDeposit {id:string;openedAt:string}
export interface PaperVaultAccrual {
  holdingId:string;status:'estimated'|'unavailable';asOf:string;asset:string;
  principalUnits:number|null;accruedUnits:number|null;estimatedUnits:number|null;elapsedYears:number|null;
  rate:number;rateType:'APY'|'APR';label:'estimate at quoted rate';note:string;
}
function sourceFor(ideaId:string) {
  if (STAKING_IDS.has(ideaId)) return {id:'Solana staking',url:'https://yields.llama.fi/pools',normalize:normalizeStaking};
  if (/^backyard:[a-zA-Z0-9-]{1,100}$/.test(ideaId)) return {id:'Backyard',url:'https://alpha.api.backyard.finance/vaults',normalize:normalizeBackyard};
  throw new PaperVaultError('Choose a supported Solana staking or vault idea.',400,'vault_invalid');
}
function metadataPresent(idea:YieldIdea) {
  return Object.hasOwn(idea,'depositEnabled') && Object.hasOwn(idea,'inputTokenMint') && Object.hasOwn(idea,'inputTokenDecimals');
}
async function selectedIdea(env:Env, ideaId:string, deadline:number):Promise<{idea:YieldIdea;readAt:string}> {
  const source = sourceFor(ideaId);
  let saved:any = null;
  try {saved = await env.LP_CACHE.get('long-game:v1:' + source.id,'json');} catch {}
  const matches = Array.isArray(saved?.items) ? saved.items.filter((idea:YieldIdea) => idea?.id === ideaId) : [];
  // Earlier catalogue caches omitted mint/decimals and enabled-state evidence.
  // A fresh timestamp cannot upgrade that old shape into verified metadata.
  if (saved?.stale !== true && fresh(Date.parse(saved?.readAt),HOUR) && matches.length === 1 && metadataPresent(matches[0])) return {idea:matches[0],readAt:saved.readAt};
  const ms = deadline - Date.now();
  if (ms <= 0) throw new PaperVaultError('The selected vault source timed out. No Paper SOL was moved.',503,'vault_provider_timeout');
  try {
    const response = await fetch(source.url,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.min(8000,ms))});
    if (!response.ok) {await response.body?.cancel();throw new PaperVaultError('The selected vault source is unavailable. No Paper SOL was moved.');}
    const items = source.normalize(await response.json()), found = items.filter(idea => idea.id === ideaId);
    if (Date.now() >= deadline) throw new PaperVaultError('The selected vault source timed out. No Paper SOL was moved.',503,'vault_provider_timeout');
    if (found.length !== 1) throw new PaperVaultError('The selected Solana vault could not be verified.',400,'vault_unavailable');
    return {idea:found[0],readAt:new Date(Date.now()).toISOString()};
  } catch(error) {
    if (error instanceof PaperVaultError) throw error;
    throw new PaperVaultError('The selected vault source timed out or returned unreadable data. No Paper SOL was moved.',503,'vault_provider_timeout');
  }
}
function verifyIdea(idea:YieldIdea, readAt:string) {
  const rateAsOf = idea.rateAsOf ?? null;
  if (idea.chain !== 'Solana' || !['staking','vault'].includes(idea.kind) || idea.disabled === true || idea.depositEnabled !== true || typeof idea.rate !== 'number' || !Number.isFinite(idea.rate) || idea.rate < 0 || !['APY','APR'].includes(idea.rateType) || !fresh(Date.parse(readAt),HOUR) || rateAsOf !== null && !fresh(Date.parse(rateAsOf),HOUR)) throw new PaperVaultError('This idea needs a fresh finite rate and an enabled Solana provider.',400,'vault_unavailable');
  if (typeof idea.name !== 'string' || !idea.name.trim() || idea.name.length > 200 || typeof idea.asset !== 'string' || !idea.asset.trim() || idea.asset.length > 60 || !basketMint(idea.inputTokenMint) || !Number.isInteger(idea.inputTokenDecimals) || idea.inputTokenDecimals! < 0 || idea.inputTokenDecimals! > 18 || idea.inputTokenMint === BASKET_SOL && idea.inputTokenDecimals !== 9) throw new PaperVaultError('This vault has incomplete deposit-asset metadata.',503,'vault_mint_unavailable');
  if (idea.kind === 'staking' && (!STAKING_IDS.has(idea.id) || idea.asset !== 'SOL' || idea.inputTokenMint !== BASKET_SOL)) throw new PaperVaultError('Only the selected provider’s underlying SOL can be modelled for staking.',400,'vault_unavailable');
}

export async function preparePaperVaultDeposit(env:Env, input:{ideaId:string;amountSol:string|number}):Promise<PaperVaultDeposit> {
  if (typeof input.ideaId !== 'string' || input.ideaId.length > 120) throw new PaperVaultError('Choose a valid Solana staking or vault idea.',400,'vault_invalid');
  let amountLamports:number;
  try {amountLamports = paperLamports(input.amountSol);} catch(error) {throw new PaperVaultError(error instanceof Error ? error.message : 'Invalid Paper SOL amount.',400,'vault_invalid');}
  const deadline = Date.now() + DEADLINE, {idea,readAt} = await selectedIdea(env,input.ideaId,deadline);
  verifyIdea(idea,readAt);
  const mint = idea.inputTokenMint!, decimals = idea.inputTokenDecimals!, nativeSol = mint === BASKET_SOL;
  let principalUnitsRaw = String(amountLamports), quoteAsOf = new Date(Date.now()).toISOString(), priceImpactFraction = 0;
  if (!nativeSol) {
    try {
      const [quote] = await preparePaperTokenQuotes(env,[{mint,symbol:idea.asset,weight:100,inputLamports:amountLamports}],deadline);
      if (quote.decimals !== decimals) throw new PaperVaultError('The vault’s deposit decimals disagree with the verified mint. No Paper SOL was moved.',503,'vault_mint_mismatch');
      principalUnitsRaw = quote.unitsRaw;quoteAsOf = quote.quoteAsOf;priceImpactFraction = quote.priceImpactFraction;
    } catch(error) {
      if (error instanceof PaperVaultError) throw error;
      if (error instanceof PaperBasketError) throw new PaperVaultError(error.message.replaceAll('basket','vault').replaceAll('purchase','deposit'),error.status,error.code.replace(/^basket_/,'vault_'));
      throw new PaperVaultError('A matching fresh vault deposit quote is unavailable. No Paper SOL was moved.');
    }
  }
  if (Date.now() >= deadline) throw new PaperVaultError('The vault evidence took too long. No Paper SOL was moved.',503,'vault_provider_timeout');
  // Dollar values are optional block-dated marks, never assumed stablecoin pegs.
  let entrySolUsd:number|null = null, assetPriceUsd:number|null = null, assetPriceAsOf:string|null = null;
  if (env.SOLANA_RPC) {
    try {
      const prices = await readPaperTokenPrices(env,[mint],deadline), sol = prices.get(BASKET_SOL), asset = prices.get(mint);
      if (sol?.decimals === 9) entrySolUsd = sol.usdPrice;
      if (asset?.decimals === decimals) {assetPriceUsd = asset.usdPrice;assetPriceAsOf = asset.asOf;}
    } catch {}
  }
  const expiresAt = Math.min(Date.parse(quoteAsOf) + QUOTE_TTL,Date.parse(readAt) + HOUR,idea.rateAsOf ? Date.parse(idea.rateAsOf) + HOUR : Infinity);
  if (Date.now() >= expiresAt || !fresh(Date.parse(readAt),HOUR)) throw new PaperVaultError('The vault quote or rate source expired. Retry; no Paper SOL was moved.',503,'vault_quote_expired');
  return {paper:true,kind:'vault',ideaId:idea.id,name:idea.name,asset:idea.asset,mint,principalUnitsRaw,decimals,amountLamports,costSol:amountLamports / LAMPORTS_PER_SOL,rate:idea.rate!,rateType:idea.rateType,rateAsOf:idea.rateAsOf ?? null,rateReadAt:readAt,preparedAt:new Date(Date.now()).toISOString(),quoteAsOf,expiresAt,entrySolUsd,assetPriceUsd,assetPriceAsOf,priceImpactFraction,basis:nativeSol?'native-sol':'quoted-token',risk:idea.risk,exit:idea.exit,note:'Paper estimate at quoted rate, linear on the original deposit asset principal with a 365-day year; no compounding even when the source labels its rate APY. ' + (nativeSol ? 'Staking models underlying SOL only; no LST or vault-share tokens are acquired. ' : 'Underlying deposit-asset units use a verified Jupiter quote; no vault-share tokens are acquired. ') + 'Rates can change. Vault fees, incentives, losses, exit costs and later price changes are not projected. No wallet transaction is built or sent.'};
}

export function accruePaperVault(holding:PaperVaultHolding, now:number=Date.now()):PaperVaultAccrual {
  const estimate = linearVaultEstimate(holding.principalUnitsRaw,holding.decimals,holding.rate,holding.openedAt,now);
  return {holdingId:holding.id,status:estimate?'estimated':'unavailable',asOf:Number.isFinite(now)&&Number.isFinite(new Date(now).getTime())?new Date(now).toISOString():new Date(Date.now()).toISOString(),asset:holding.asset,principalUnits:estimate?.principalUnits ?? null,accruedUnits:estimate?.accruedUnits ?? null,estimatedUnits:estimate?.estimatedUnits ?? null,elapsedYears:estimate?.elapsedYears ?? null,rate:holding.rate,rateType:holding.rateType,label:'estimate at quoted rate',note:estimate?'Linear estimate in the original deposit asset at the saved annual rate; it is not observed earnings, a current exit value or compound APY.':'The saved principal, annual rate or time is invalid. No earnings or value are invented.'};
}
