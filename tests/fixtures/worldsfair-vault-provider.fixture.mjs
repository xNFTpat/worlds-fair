// Synthetic yield source for isolated Worker ledger/runtime checks only.
export class PaperVaultError extends Error {
 constructor(message,status=503,code='vault_provider_unavailable'){super(message);this.status=status;this.code=code;}
}
export async function preparePaperVaultDeposit(env,{ideaId,amountSol}) {
 if(ideaId==='provider-fails-vault')throw new PaperVaultError('Synthetic vault source unavailable.');
 const now=Date.now(),at=new Date(now).toISOString(),amountLamports=Math.round(Number(amountSol)*1e9);
 return {paper:true,kind:'vault',ideaId,name:'Synthetic SOL stake',asset:'SOL',mint:'So11111111111111111111111111111111111111112',principalUnitsRaw:String(amountLamports),decimals:9,amountLamports,costSol:amountLamports/1e9,
  rate:5,rateType:'APY',rateReadAt:at,rateAsOf:null,preparedAt:at,quoteAsOf:at,expiresAt:ideaId==='expired-vault'?now-1:now+45000,entrySolUsd:null,assetPriceUsd:null,assetPriceAsOf:null,priceImpactFraction:0,basis:'native-sol',risk:'Synthetic SOL exposure.',exit:'Synthetic delayed exit.',note:'Synthetic estimate at quoted rate'};
}
export function accruePaperVault(holding,now=Date.now()) {
 const principalUnits=Number(holding.principalUnitsRaw)/10**holding.decimals,elapsedYears=Math.max(0,now-Date.parse(holding.openedAt))/(365*86400000),accruedUnits=principalUnits*holding.rate/100*elapsedYears;
 return {holdingId:holding.id,status:'estimated',asOf:new Date(now).toISOString(),asset:holding.asset,principalUnits,accruedUnits,estimatedUnits:principalUnits+accruedUnits,elapsedYears,rate:holding.rate,rateType:holding.rateType,label:'estimate at quoted rate',note:'Synthetic runtime accrual'};
}
