// Synthetic quote-only provider for real Worker ledger tests. Never used by deployment.
export class PaperBasketError extends Error {
 constructor(message,status=503,code='basket_provider_unavailable'){super(message);this.status=status;this.code=code;}
}
export async function preparePaperBasketPurchase(env,{slug,amountSol}) {
 if(slug==='provider-fails')throw new PaperBasketError('Synthetic quote provider unavailable.');
 const amountLamports=Math.round(Number(amountSol)*1e9),now=Date.now(),at=new Date(now).toISOString();
 const solLamports=Math.floor(amountLamports*.6),otherLamports=amountLamports-solLamports;
 return {paper:true,kind:'basket',slug,name:'Synthetic ledger basket',amountLamports,costSol:amountLamports/1e9,preparedAt:at,allocationReadAt:at,quoteAsOf:at,expiresAt:slug==='expired-quotes'?now-1:now+60000,
  legs:[{mint:'So11111111111111111111111111111111111111112',symbol:'SOL',weight:'60',inputLamports:solLamports,unitsRaw:String(solLamports),decimals:9,priceImpactFraction:0,quoteAsOf:at,contextSlot:123},
   {mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',symbol:'USDC',weight:'40',inputLamports:otherLamports,unitsRaw:String(Math.round(otherLamports/1e9*100*1e6)),decimals:6,priceImpactFraction:.01,quoteAsOf:at,contextSlot:123}],
  entrySolUsd:100,entryPriceAsOf:at};
}
export async function markPaperBaskets(env,holdings) {
 const at=new Date().toISOString();
 return {marks:holdings.filter(h=>h.kind==='basket').map(h=>{
  const costSol=h.amountLamports/1e9,valueUsd=costSol*160,valueSol=valueUsd/200;
  return {holdingId:h.id,status:'complete',asOf:at,readAt:at,solUsd:200,valueSol,valueUsd,costSol,holdSolValueUsd:costSol*200,pnlSol:valueSol-costSol,vsHoldSolUsd:valueUsd-costSol*200,absolutePnlUsd:valueUsd-costSol*h.entrySolUsd,
   legs:h.legs.map(l=>({mint:l.mint,symbol:l.symbol,unitsRaw:l.unitsRaw,decimals:l.decimals,usdPrice:l.symbol==='SOL'?200:1,valueUsd:Number(l.unitsRaw)/10**l.decimals*(l.symbol==='SOL'?200:1),asOf:at,blockId:123})),note:'Synthetic runtime mark'};
 }),asOf:at,quotesConfigured:true,note:'Synthetic runtime price set'};
}
