// Market/account reads only. No wallet, signing, transaction construction or broadcast.
import DLMM,{getQPriceFromId,toAmountsBothSideByStrategy,StrategyType,calculateTransferFeeExcludedAmount} from '@meteora-ag/dlmm';
import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import BN from 'bn.js';
import type {Pool} from '../src/schema';
import {PAPER_RULES as R,virtualShares,markAmounts,paperDiagnostics,type PaperBin,type PaperModel,type PaperMark} from '../src/paper-model';
import type {PaperPosition,PaperRead} from '../src/paper-bot';
import {publicError} from '../src/health';
import {paperTokenPolicies} from './paper-token-policy';
import {paperWithdrawal} from '../src/paper-token-math';

export async function readPaperPool(pool:Pool,rpc:string,existing?:PaperPosition):Promise<PaperRead>{
  try{
    const conn=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})});
    const dlmm=await DLMM.create(conn,new PublicKey(pool.address));
    const solX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT),solY=dlmm.lbPair.tokenYMint.equals(NATIVE_MINT);
    if(solX===solY)throw Error('Trial supports native-SOL pairs only');
    if(pool.base.address!==dlmm.lbPair.tokenXMint.toBase58()||pool.quote.address!==dlmm.lbPair.tokenYMint.toBase58())throw Error('Pool mint identities do not match the catalogue');
    const epoch=dlmm.clock.epoch.toNumber(),feePolicies=paperTokenPolicies([dlmm.tokenX,dlmm.tokenY],epoch,!existing);
    const active=dlmm.lbPair.activeId,step=dlmm.lbPair.binStep;
    let lower=existing?.model.lowerBin??active+Math.floor(Math.log(1-R.widthPct/100)/Math.log(1+step/10000));
    let upper=existing?.model.upperBin??active+Math.ceil(Math.log(1+R.widthPct/100)/Math.log(1+step/10000));
    if(upper-lower+1>R.maxBins||upper<lower)throw Error('The 5% range needs more than 69 bins');
    const read=await dlmm.getBinsBetweenLowerAndUpperBound(lower,upper);
    const bins:PaperBin[]=read.bins.map(b=>({id:b.binId,x:b.xAmount.toString(),y:b.yAmount.toString(),supply:b.supply.toString(),feeX:b.feeAmountXPerTokenStored.toString(),feeY:b.feeAmountYPerTokenStored.toString(),qPrice:getQPriceFromId(new BN(b.binId),new BN(step)).toString(),price:Number(b.pricePerToken)}));
    const current=await dlmm.getActiveBin();
    if(current.binId!==active)throw Error('Pool moved during the read; retry on the next scan');
    const priceYX=Number(current.pricePerToken),decX=dlmm.tokenX.mint.decimals,decY=dlmm.tokenY.mint.decimals;
    let model:PaperModel,fundingSol=0,depositTaxSol=0;
    if(existing){
      model=existing.model;
      if(model.mintX!==dlmm.lbPair.tokenXMint.toBase58()||model.mintY!==dlmm.lbPair.tokenYMint.toBase58()||model.decX!==decX||model.decY!==decY||model.solX!==solX)throw Error('Paper model identity changed');
    }else{
      const input=new BN(Math.round(R.budgetSol/2*1e9)),arrays=await dlmm.getBinArrayForSwap(solX);
      const buy=dlmm.swapQuote(input,solX,new BN(R.slippageBps),arrays);
      if(!buy.consumedInAmount.eq(input)||buy.minOutAmount.isZero())throw Error('The funding swap cannot be fully quoted');
      const x=solX?input:buy.minOutAmount,y=solX?buy.minOutAmount:input;
      const value=(x:BN,y:BN)=>solX?Number(x.toString())/10**decX+Number(y.toString())/10**decY/priceYX:Number(x.toString())/10**decX*priceYX+Number(y.toString())/10**decY;
      fundingSol=R.budgetSol-value(x,y);
      // SDK allocations ALREADY deduct the deposit fee. Compare with the net
      // budget to avoid treating that tax as dust, or deducting it a second time.
      const netX=calculateTransferFeeExcludedAmount(x,dlmm.tokenX.mint,epoch).amount,netY=calculateTransferFeeExcludedAmount(y,dlmm.tokenY.mint,epoch).amount;
      depositTaxSol=value(x.sub(netX),y.sub(netY));
      const amounts=toAmountsBothSideByStrategy(active,step,lower,upper,x,y,current.xAmount,current.yAmount,StrategyType.Spot,dlmm.tokenX.mint,dlmm.tokenY.mint,dlmm.clock);
      // Check allocation rounding rather than silently discarding material token leftovers.
      const totalX=amounts.reduce((n,b)=>n.add(b.amountX),new BN(0)),totalY=amounts.reduce((n,b)=>n.add(b.amountY),new BN(0));
      if(totalX.gt(netX)||totalY.gt(netY))throw Error('Spot allocation exceeds its net deposit budget');
      // Sub-lamport allocation rounding is negligible; larger leftovers need an explicit dust ledger.
      const unusedSol=value(netX.sub(totalX),netY.sub(totalY));
      if(unusedSol>0.000001)throw Error('Spot allocation leaves tokens needing a separate dust model');
      model={shares:virtualShares(bins,amounts.map(b=>({id:b.binId,x:b.amountX.toString(),y:b.amountY.toString()}))),solX,decX,decY,mintX:dlmm.lbPair.tokenXMint.toBase58(),mintY:dlmm.lbPair.tokenYMint.toBase58(),lowerBin:lower,upperBin:upper};
    }
    const amounts=markAmounts(model,bins,priceYX),grossSol=amounts.principalSol+amounts.feesSol;
    const withdrawal=paperWithdrawal(model,bins,priceYX,feePolicies);
    let liquidationSol:number|null=null,conversionCostSol:number|null=null,quoteIssue:string|undefined;
    try{
      const paired=new BN(withdrawal.pairedRaw);let converted=0;
      if(!paired.isZero()){
        const arrays=await dlmm.getBinArrayForSwap(!solX),quote=dlmm.swapQuote(paired,!solX,new BN(R.slippageBps),arrays);
        if(!quote.consumedInAmount.eq(paired))throw Error('Cannot quote conversion of all paper proceeds');
        converted=Number(quote.minOutAmount.toString())/1e9;
      }
      const quoted=Number(withdrawal.nativeRaw)/1e9+converted;
      liquidationSol=quoted-R.networkSol;conversionCostSol=grossSol-quoted;
      if(!Number.isFinite(liquidationSol)||!Number.isFinite(conversionCostSol))throw Error('Exit quote is not finite');
    }catch(e){liquidationSol=null;conversionCostSol=null;quoteIssue=publicError(e);}
    const at=new Date().toISOString();
    const mark:PaperMark={at,principalSol:amounts.principalSol,feesSol:amounts.feesSol,grossSol,liquidationSol,conversionCostSol,networkSol:R.networkSol,inRange:active>=lower&&active<=upper,priceSol:amounts.priceSol,withdrawTaxSol:withdrawal.withdrawTaxSol,epoch,transferFees:feePolicies,issue:quoteIssue};
    if(existing)return {poolId:pool.id,positionId:existing.id,mark};
    if(liquidationSol==null)throw Error(quoteIssue||'Exit quote unavailable');
    const initialRoundTripSol=R.budgetSol+R.networkSol-liquidationSol;
    const taxed=feePolicies.some(f=>f.bps>0&&BigInt(f.maximumRaw)>0n),costLimit=taxed?R.maxTaxedEntryCostBps:R.maxEntryCostBps;
    if(initialRoundTripSol>R.budgetSol*costLimit/10000)throw Error(`Quoted round-trip costs ${(initialRoundTripSol/R.budgetSol*100).toFixed(2)}% exceed the ${costLimit/100}% ${taxed?'transfer-taxed':'untaxed'} paper limit`);
    const mint=solX?pool.quote.address:pool.base.address;
    return {poolId:pool.id,entry:{id:`paper:${pool.address}:${at}`,pool,mint,openedAt:at,model,mark,entryCosts:{fundingSol,depositTaxSol,initialRoundTripSol,epoch,transferFees:feePolicies},investmentSol:R.budgetSol,rentSol:R.rentSol,entryNetworkSol:R.networkSol,entryVolume30m:pool.activity!.volume30m!,entryTvl:pool.tvlUsd!,outSince:null,fadeCount:0,pendingExit:null,issue:null}};
  }catch(e){return {poolId:pool.id,positionId:existing?.id,error:publicError(e),diagnostics:paperDiagnostics(e)};}
}
