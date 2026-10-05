// Read-only counterfactuals: no wallet, transaction construction, signing or broadcast.
import DLMM,{getQPriceFromId,toAmountsBothSideByStrategy,StrategyType} from '@meteora-ag/dlmm';
import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import BN from 'bn.js';
import type {Pool} from '../src/schema';
import {virtualShares,markAmounts,paperDiagnostics,type PaperBin,type PaperModel} from '../src/paper-model';
import {LAB_RULES as R,LAB_ARMS,type LabPosition,type LabRead,type LabArmId,type LabMark} from '../src/paper-lab';
import {downsideBins} from '../src/paper-lab-math';
import {publicError} from '../src/health';
import {paperTokenPolicies} from './paper-token-policy';
import {paperWithdrawal} from '../src/paper-token-math';

export async function readLabPool(pool:Pool,rpc:string,existing:LabPosition[]=[],entryArms:LabArmId[]=[],cohortAt=new Date().toISOString()):Promise<LabRead[]>{
  const targets=[...existing.map(p=>({arm:p.arm,position:p})),...entryArms.map(arm=>({arm,position:undefined as LabPosition|undefined}))];
  const failure=(error:unknown)=>targets.map(t=>({poolId:pool.id,arm:t.arm,positionId:t.position?.id,error:publicError(error),diagnostics:paperDiagnostics(error)}));
  if(!targets.length)return [];
  try{
    const conn=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})});
    const dlmm=await DLMM.create(conn,new PublicKey(pool.address));
    const solX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT),solY=dlmm.lbPair.tokenYMint.equals(NATIVE_MINT);
    if(solX===solY||pool.base.address!==dlmm.lbPair.tokenXMint.toBase58()||pool.quote.address!==dlmm.lbPair.tokenYMint.toBase58())throw Error('Pool mint identities do not match the SOL-pair catalogue');
    const epoch=dlmm.clock.epoch.toNumber(),feePolicies=paperTokenPolicies([dlmm.tokenX,dlmm.tokenY],epoch,entryArms.length>0);
    const active=dlmm.lbPair.activeId,step=dlmm.lbPair.binStep,decX=dlmm.tokenX.mint.decimals,decY=dlmm.tokenY.mint.decimals;
    const results:LabRead[]=[],prepared:{arm:LabArmId;position?:LabPosition;lower:number;upper:number}[]=[];
    for(const t of targets){try{
      const a=LAB_ARMS.find(a=>a.id===t.arm);if(!a)throw Error('Unknown lab arm');
      const range=t.position?{lower:t.position.model.lowerBin,upper:t.position.model.upperBin}:downsideBins(active,step,a.down,solX,a.offset);
      if(range.upper-range.lower+1>R.maxBins)throw Error('Saved range exceeds the lab read limit');
      prepared.push({...t,...range});
    }catch(e){results.push({poolId:pool.id,arm:t.arm,positionId:t.position?.id,error:publicError(e),diagnostics:paperDiagnostics(e)});}}
    if(!prepared.length)return results;
    const lower=Math.min(...prepared.map(p=>p.lower)),upper=Math.max(...prepared.map(p=>p.upper));
    if(upper-lower+1>R.maxBins)throw Error('Combined cohort range exceeds the lab read limit');
    const read=await dlmm.getBinsBetweenLowerAndUpperBound(lower,upper);
    const bins:PaperBin[]=read.bins.map(b=>({id:b.binId,x:b.xAmount.toString(),y:b.yAmount.toString(),supply:b.supply.toString(),feeX:b.feeAmountXPerTokenStored.toString(),feeY:b.feeAmountYPerTokenStored.toString(),qPrice:getQPriceFromId(new BN(b.binId),new BN(step)).toString(),price:Number(b.pricePerToken)}));
    const current=await dlmm.getActiveBin();if(current.binId!==active)throw Error('Pool moved during the read; retry on the next scan');
    const priceYX=Number(current.pricePerToken);
    let arraysPromise:ReturnType<typeof dlmm.getBinArrayForSwap>|undefined;
    for(const t of prepared){try{
      let model=t.position?.model,dustSol=t.position?.dustSol??0;
      if(model&&(model.solX!==solX||model.mintX!==feePolicies[0].mint||model.mintY!==feePolicies[1].mint||model.decX!==decX||model.decY!==decY))throw Error('Saved model identity changed');
      if(!model){
        const budget=new BN(Math.round(R.budgetSol*1e9)),x=solX?budget:new BN(0),y=solX?new BN(0):budget;
        const arm=LAB_ARMS.find(a=>a.id===t.arm)!;
        const allocations=toAmountsBothSideByStrategy(active,step,t.lower,t.upper,x,y,current.xAmount,current.yAmount,arm.shape==='Spot'?StrategyType.Spot:StrategyType.BidAsk,dlmm.tokenX.mint,dlmm.tokenY.mint,dlmm.clock);
        const sumX=allocations.reduce((n,a)=>n.add(a.amountX),new BN(0)),sumY=allocations.reduce((n,a)=>n.add(a.amountY),new BN(0));
        if(sumX.gt(x)||sumY.gt(y)||(!solX&&!sumX.isZero())||(solX&&!sumY.isZero()))throw Error('One-sided allocation does not conserve the SOL budget');
        dustSol=Number(budget.sub(solX?sumX:sumY).toString())/1e9;
        if(dustSol<0||dustSol>.000001)throw Error('Allocation leaves material unmodelled dust');
        model={shares:virtualShares(bins,allocations.map(a=>({id:a.binId,x:a.amountX.toString(),y:a.amountY.toString()}))),solX,decX,decY,mintX:feePolicies[0].mint,mintY:feePolicies[1].mint,lowerBin:t.lower,upperBin:t.upper};
      }
      const amounts=markAmounts(model,bins,priceYX);
      const withdrawal=paperWithdrawal(model,bins,priceYX,feePolicies);
      const grossSol=amounts.principalSol+dustSol+amounts.feesSol,withdrawTaxSol=withdrawal.withdrawTaxSol;
      let liquidationSol:number|null=null,conversionCostSol:number|null=null,issue:string|undefined;
      try{
        const paired=BigInt(withdrawal.pairedRaw),native=BigInt(withdrawal.nativeRaw);let converted=0;
        if(paired>0n){
          arraysPromise??=dlmm.getBinArrayForSwap(!solX);
          const input=new BN(paired.toString()),quote=dlmm.swapQuote(input,!solX,new BN(R.slippageBps),await arraysPromise);
          if(!quote.consumedInAmount.eq(input))throw Error('Cannot quote all remaining token inventory');
          converted=Number(quote.minOutAmount.toString())/1e9;
        }
        const proceeds=Number(native)/1e9+converted+dustSol;
        liquidationSol=proceeds-R.networkSol;conversionCostSol=grossSol-proceeds;
        if(!Number.isFinite(liquidationSol)||!Number.isFinite(conversionCostSol))throw Error('Non-finite exit estimate');
      }catch(e){liquidationSol=null;conversionCostSol=null;issue=publicError(e);}
      const at=new Date().toISOString();
      const mark:LabMark={at,principalSol:amounts.principalSol+dustSol,feesSol:amounts.feesSol,grossSol,liquidationSol,conversionCostSol,networkSol:R.networkSol,inRange:active>=t.lower&&active<=t.upper,waiting:solX?active<t.lower:active>t.upper,priceSol:amounts.priceSol,withdrawTaxSol,epoch,transferFees:feePolicies,issue};
      if(t.position){results.push({poolId:pool.id,arm:t.arm,positionId:t.position.id,mark});continue;}
      if(liquidationSol==null||liquidationSol-R.networkSol<R.budgetSol*.95)throw Error('Initial exit estimate is unavailable or costs exceed 5%');
      const cohort=`${pool.address}:${cohortAt}`;
      results.push({poolId:pool.id,arm:t.arm,entry:{id:`lab:${t.arm}:${cohort}`,cohort,arm:t.arm,pool,mint:solX?pool.quote.address:pool.base.address,openedAt:at,entryReferenceSol:mark.priceSol,bidStartSol:mark.priceSol*(1+step/10000)**(-Math.min(Math.abs(t.lower-active),Math.abs(t.upper-active))),bidEndSol:mark.priceSol*(1+step/10000)**(-Math.max(Math.abs(t.lower-active),Math.abs(t.upper-active))),model,dustSol,mark,issue:null,pendingExit:null,observedInRangeMs:0}});
    }catch(e){results.push({poolId:pool.id,arm:t.arm,positionId:t.position?.id,error:publicError(e),diagnostics:paperDiagnostics(e)});}}
    return results;
  }catch(e){return failure(e);}
}
