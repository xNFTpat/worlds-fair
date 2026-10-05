// Read-only counterfactuals: no wallet, transaction construction, signing or broadcast.
import DLMM,{getQPriceFromId,toAmountsBothSideByStrategy,StrategyType,calculateTransferFeeExcludedAmount} from '@meteora-ag/dlmm';
import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import BN from 'bn.js';
import type {Pool} from '../src/schema';
import {virtualShares,markAmounts,paperDiagnostics,type PaperBin,type PaperModel} from '../src/paper-model';
import {FLEET_RULES as R,FLEET_ARMS,fleetPolicy,type FleetPosition,type FleetRead,type FleetArmId,type FleetMark,type FleetHarvest} from '../src/paper-fleet';
import {ALLOCATION_LIMITS,floorSol,type AllocationRequest,type AllocationEvidence} from '../src/fleet-allocation';
import {downsideBins} from '../src/paper-lab-math';
import {publicError} from '../src/health';
import {paperTokenPolicies} from './paper-token-policy';
import {paperWithdrawal} from '../src/paper-token-math';

export async function readFleetPool(pool:Pool,rpc:string,existing:FleetPosition[]=[],entryArms:FleetArmId[]=[],cohortAt=new Date().toISOString(),rpcFetch:typeof fetch=fetch,requests:Partial<Record<FleetArmId,AllocationRequest>>={}):Promise<FleetRead[]>{
  const targets=[...existing.map(p=>({arm:p.arm,position:p})),...entryArms.map(arm=>({arm,position:undefined as FleetPosition|undefined}))];
  const failure=(error:unknown)=>targets.map(t=>({poolId:pool.id,arm:t.arm,positionId:t.position?.id,error:publicError(error),diagnostics:paperDiagnostics(error)}));
  if(!targets.length)return [];
  try{
    const conn=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:rpcFetch});
    const dlmm=await DLMM.create(conn,new PublicKey(pool.address));
    const solX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT),solY=dlmm.lbPair.tokenYMint.equals(NATIVE_MINT);
    if(solX===solY||pool.base.address!==dlmm.lbPair.tokenXMint.toBase58()||pool.quote.address!==dlmm.lbPair.tokenYMint.toBase58())throw Error('Pool mint identities do not match the SOL-pair catalogue');
    const epoch=dlmm.clock.epoch.toNumber(),feePolicies=paperTokenPolicies([dlmm.tokenX,dlmm.tokenY],epoch,entryArms.length>0);
    const active=dlmm.lbPair.activeId,step=dlmm.lbPair.binStep,decX=dlmm.tokenX.mint.decimals,decY=dlmm.tokenY.mint.decimals;
    const results:FleetRead[]=[],prepared:{arm:FleetArmId;position?:FleetPosition;lower:number;upper:number}[]=[];
    for(const t of targets){try{
      const a=FLEET_ARMS.find(a=>a.id===t.arm);if(!a)throw Error('Unknown fleet arm');
      const settings=requests[t.arm]||fleetPolicy(t.arm);
      const range=t.position?{lower:t.position.model.lowerBin,upper:t.position.model.upperBin}:settings.rangeBins?{lower:active-4,upper:active+4}:a.twoSided?{lower:active+Math.floor((requests[t.arm]&&solX?-Math.log(1+settings.down):Math.log(1-settings.down))/Math.log(1+step/10000)),upper:active+Math.ceil((requests[t.arm]&&solX?-Math.log(1-settings.down):Math.log(1+settings.down))/Math.log(1+step/10000))}:downsideBins(active,step,settings.down,solX,settings.offset);
      if(range.upper-range.lower+1>R.maxBins)throw Error('Saved range exceeds the fleet read limit');
      prepared.push({...t,...range});
    }catch(e){results.push({poolId:pool.id,arm:t.arm,positionId:t.position?.id,error:publicError(e),diagnostics:paperDiagnostics(e)});}}
    if(!prepared.length)return results;
    // Fetch overlapping ranges once per pool; split disjoint wide ranges instead of failing every arm.
    const ranges=prepared.map(t=>({lower:t.lower,upper:t.upper})).sort((a,b)=>a.lower-b.lower);
    const merged:{lower:number;upper:number}[]=[];
    for(const r of ranges){const last=merged.at(-1);if(last&&r.upper-last.lower+1<=R.maxBins)last.upper=Math.max(last.upper,r.upper);else merged.push({...r});}
    const binMap=new Map<number,PaperBin>();
    for(const range of merged){const read=await dlmm.getBinsBetweenLowerAndUpperBound(range.lower,range.upper);
      for(const b of read.bins)binMap.set(b.binId,{id:b.binId,x:b.xAmount.toString(),y:b.yAmount.toString(),supply:b.supply.toString(),feeX:b.feeAmountXPerTokenStored.toString(),feeY:b.feeAmountYPerTokenStored.toString(),qPrice:getQPriceFromId(new BN(b.binId),new BN(step)).toString(),price:Number(b.pricePerToken)});
    }
    const bins=[...binMap.values()];
    const current=await dlmm.getActiveBin();if(current.binId!==active)throw Error('Pool moved during the read; retry on the next scan');
    const priceYX=Number(current.pricePerToken);
    const arrays=new Map<boolean,ReturnType<typeof dlmm.getBinArrayForSwap>>();
    const swapArrays=async(direction:boolean)=>{if(!arrays.has(direction))arrays.set(direction,dlmm.getBinArrayForSwap(direction));const value=await arrays.get(direction)!;if(dlmm.lbPair.activeId!==active||dlmm.clock.epoch.toNumber()!==epoch)throw Error('Pool moved during the read; retry on the next scan');return value;};
    for(const t of prepared){
      const market=t.position?{at:new Date().toISOString(),inRange:active>=t.lower&&active<=t.upper,priceSol:solX?1/priceYX:priceYX}:undefined;
      const request=requests[t.arm];let budgetSol=request?.targetSol??R.budgetSol;
      const attempts:AllocationEvidence['attempts']=[];
      for(let attempt=0;attempt<(request&&!t.position?ALLOCATION_LIMITS.maxAttempts:1);attempt++){try{
      let model=t.position?.model,dustSol=t.position?.dustSol??0,fundingSol=0,depositTaxSol=0;
      if(model&&(model.solX!==solX||model.mintX!==feePolicies[0].mint||model.mintY!==feePolicies[1].mint||model.decX!==decX||model.decY!==decY))throw Error('Saved model identity changed');
      if(!model){
        if(!Number.isFinite(budgetSol)||budgetSol<(request?.minSol??R.budgetSol))throw Error('Available paper size is below the minimum');
        const budget=new BN(Math.round(budgetSol*1e9));
        const arm=FLEET_ARMS.find(a=>a.id===t.arm)!;
        let x=solX?budget:new BN(0),y=solX?new BN(0):budget;
        if(arm.twoSided){
          const half=budget.divn(2),buy=dlmm.swapQuote(half,solX,new BN(R.slippageBps),await swapArrays(solX));
          if(!buy.consumedInAmount.eq(half)||buy.minOutAmount.isZero())throw Error('Funding swap cannot be fully quoted');
          x=solX?half:buy.minOutAmount;y=solX?buy.minOutAmount:half;
        }
        const value=(x:BN,y:BN)=>solX?Number(x.toString())/10**decX+Number(y.toString())/10**decY/priceYX:Number(x.toString())/10**decX*priceYX+Number(y.toString())/10**decY;
        fundingSol=budgetSol-value(x,y);
        const strategy=arm.shape==='Spot'?StrategyType.Spot:arm.shape==='Curve'?StrategyType.Curve:StrategyType.BidAsk;
        const allocations=toAmountsBothSideByStrategy(active,step,t.lower,t.upper,x,y,current.xAmount,current.yAmount,strategy,dlmm.tokenX.mint,dlmm.tokenY.mint,dlmm.clock);
        const netX=calculateTransferFeeExcludedAmount(x,dlmm.tokenX.mint,epoch).amount,netY=calculateTransferFeeExcludedAmount(y,dlmm.tokenY.mint,epoch).amount;
        depositTaxSol=value(x.sub(netX),y.sub(netY));
        const sumX=allocations.reduce((n,a)=>n.add(a.amountX),new BN(0)),sumY=allocations.reduce((n,a)=>n.add(a.amountY),new BN(0));
        if(sumX.gt(netX)||sumY.gt(netY))throw Error('Allocation exceeds the net deposit budget');
        const unusedX=Number(netX.sub(sumX).toString())/10**decX,unusedY=Number(netY.sub(sumY).toString())/10**decY;
        const unusedSol=solX?unusedX+unusedY/priceYX:unusedX*priceYX+unusedY;
        if(unusedSol<0||unusedSol>.000001)throw Error('Allocation leaves material unmodelled dust');
        // Only native dust is refundable SOL. Sub-lamport token rounding is not invented cash.
        dustSol=solX?unusedX:unusedY;
        model={shares:virtualShares(bins,allocations.map(a=>({id:a.binId,x:a.amountX.toString(),y:a.amountY.toString()}))),solX,decX,decY,mintX:feePolicies[0].mint,mintY:feePolicies[1].mint,lowerBin:t.lower,upperBin:t.upper};
      }
      let harvest=t.position?.harvest;
      let feeModel=harvest?{...model,shares:model.shares.map(s=>({...s,...harvest!.counters.find(c=>c.id===s.id)}))}:model;
      let amounts=markAmounts(feeModel,bins,priceYX);
      const inRange=active>=t.lower&&active<=t.upper;
      // Harvest into a reserved virtual SOL balance, never the real wallet.
      // Original model remains immutable; checkpoints prevent counting claimed growth twice.
      if(['four-wallets-v4','four-wallets-v5','four-wallets-v6'].includes(t.position?.policy?.version||'')&&t.position?.policy?.harvestFees&&inRange&&amounts.feesSol>R.networkSol*3){
        const fees=paperWithdrawal(feeModel,bins,priceYX,feePolicies,true);
        let feeProceeds=Number(fees.nativeRaw)/1e9;
        if(BigInt(fees.pairedRaw)>0n){const input=new BN(fees.pairedRaw),quote=dlmm.swapQuote(input,!solX,new BN(R.slippageBps),await swapArrays(!solX));if(!quote.consumedInAmount.eq(input))throw Error('Fee harvest cannot quote all token fees');feeProceeds+=Number(quote.minOutAmount.toString())/1e9;}
        if(feeProceeds>R.networkSol*2){
          harvest={counters:model.shares.map(s=>{const b=bins.find(b=>b.id===s.id)!;return {id:s.id,feeX:b.feeX,feeY:b.feeY};}),bankedSol:(harvest?.bankedSol||0)+feeProceeds-R.networkSol,grossSol:(harvest?.grossSol||0)+amounts.feesSol,taxSol:(harvest?.taxSol||0)+fees.withdrawTaxSol,count:(harvest?.count||0)+1,at:new Date().toISOString()};
          feeModel={...model,shares:model.shares.map(s=>({...s,...harvest!.counters.find(c=>c.id===s.id)}))};amounts=markAmounts(feeModel,bins,priceYX);
        }
      }
      const withdrawal=paperWithdrawal(feeModel,bins,priceYX,feePolicies);
      const totalFees=amounts.feesSol+(harvest?.grossSol||0),grossSol=amounts.principalSol+dustSol+totalFees,withdrawTaxSol=withdrawal.withdrawTaxSol+(harvest?.taxSol||0);
      let liquidationSol:number|null=null,conversionCostSol:number|null=null,issue:string|undefined;
      try{
        const paired=BigInt(withdrawal.pairedRaw),native=BigInt(withdrawal.nativeRaw);let converted=0;
        if(paired>0n){
          
          const input=new BN(paired.toString()),quote=dlmm.swapQuote(input,!solX,new BN(R.slippageBps),await swapArrays(!solX));
          if(!quote.consumedInAmount.eq(input))throw Error('Cannot quote all remaining token inventory');
          converted=Number(quote.minOutAmount.toString())/1e9;
        }
        const proceeds=Number(native)/1e9+converted+dustSol+(harvest?.bankedSol||0);
        liquidationSol=proceeds-R.networkSol;conversionCostSol=grossSol-proceeds;
        if(!Number.isFinite(liquidationSol)||!Number.isFinite(conversionCostSol))throw Error('Non-finite exit estimate');
      }catch(e){liquidationSol=null;conversionCostSol=null;issue=publicError(e);}
      const at=new Date().toISOString();
      const mark:FleetMark={at,principalSol:amounts.principalSol+dustSol,feesSol:totalFees,grossSol,liquidationSol,conversionCostSol,networkSol:R.networkSol,inRange:active>=t.lower&&active<=t.upper,waiting:solX?active<t.lower:active>t.upper,priceSol:amounts.priceSol,withdrawTaxSol,epoch,transferFees:feePolicies,issue};
      if(t.position){results.push({poolId:pool.id,arm:t.arm,positionId:t.position.id,mark,harvest});break;}
      if(issue)throw Error(issue);
      if(liquidationSol==null||liquidationSol-R.networkSol<budgetSol*(1-fleetPolicy(t.arm).maxInitialCost))throw Error('Initial exit estimate is unavailable or round-trip costs exceed '+Number((fleetPolicy(t.arm).maxInitialCost*100).toFixed(2))+'%');
      const cohort=`${pool.address}:${cohortAt}`;
      attempts.push({budgetSol,reason:'Quoted and within bin capacity and cost limits'});
      const allocation=request?{...request,acceptedSol:budgetSol,attempts,limitedBy:budgetSol<request.targetSol?'Reduced to fit pool capacity / quoted costs':'Requested allocation fits the measured pool'}:undefined;
      results.push({poolId:pool.id,arm:t.arm,entry:{allocation,experiment:R.version,entryCosts:{fundingSol,depositTaxSol,initialRoundTripSol:budgetSol+R.networkSol-liquidationSol,epoch,transferFees:feePolicies},id:`fleet:${t.arm}:${cohort}`,cohort,arm:t.arm,budgetSol,rentSol:R.rentSol,entryNetworkSol:R.networkSol,pool,mint:solX?pool.quote.address:pool.base.address,openedAt:at,entryReferenceSol:mark.priceSol,bidStartSol:mark.priceSol*(1+step/10000)**(solX?active-t.lower:t.upper-active),bidEndSol:mark.priceSol*(1+step/10000)**(solX?active-t.upper:t.lower-active),model,dustSol,mark,issue:null,pendingExit:null,observedInRangeMs:0}});
      break;
    }catch(e){
      const error=publicError(e),diagnostics=paperDiagnostics(e);attempts.push({budgetSol,reason:error});
      // Resize only size-sensitive failures, using the same fetched pool/bin state.
      // Taxes/authorities, empty bins and provider failures cannot be repaired by inventing depth.
      const resize=request&&!t.position&&/exceed 1%|Funding swap cannot|Cannot quote all remaining|round-trip costs exceed|insufficient liquidity|swap amount exceeds/i.test(error);
      const offending=diagnostics?.bins.find(b=>b.code==='share-limit'&&b.supplyRaw&&BigInt(b.virtualShareRaw)>0n);
      const factor=offending?Math.min(.5,Number(BigInt(offending.supplyRaw!)*1000000n/BigInt(offending.virtualShareRaw))/1e6*.008):.5;
      const next=floorSol(Math.max(request?.minSol||0,budgetSol*factor));
      if(resize&&attempt+1<ALLOCATION_LIMITS.maxAttempts&&next>=request.minSol&&next<budgetSol){budgetSol=next;continue;}
      results.push({poolId:pool.id,arm:t.arm,positionId:t.position?.id,market,error,diagnostics,allocation:request?{...request,acceptedSol:0,attempts,limitedBy:error}:undefined});break;
    }}}
    return results;
  }catch(e){return failure(e);}
}
