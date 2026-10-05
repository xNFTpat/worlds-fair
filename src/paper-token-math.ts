import {markAmounts,type PaperBin,type PaperModel,type PaperTokenPolicy} from './paper-model';

// Solana fee rounding: ceil(amount*bps/10000), capped for each transfer.
export function transferNet(amount:bigint,bps:number,maximum:bigint){
  if(amount<0n||maximum<0n||!Number.isInteger(bps)||bps<0||bps>10000)throw Error('Invalid transfer-fee accounting');
  const proportional=(amount*BigInt(bps)+9999n)/10000n,fee=proportional<maximum?proportional:maximum;
  return {amount:amount-fee,fee};
}

export function paperTokenValue(model:PaperModel,priceYX:number,x:bigint,y:bigint){
  return model.solX?Number(x)/10**model.decX+Number(y)/10**model.decY/priceYX:Number(x)/10**model.decX*priceYX+Number(y)/10**model.decY;
}

// Conservative withdrawal/claim allowance. Grouping bin transfers can reduce
// caps/rounding. The later swap quote already applies its own transfer fees.
export function paperWithdrawal(model:PaperModel,bins:PaperBin[],priceYX:number,policies:PaperTokenPolicy[],feesOnly=false){
  if(policies.length!==2||policies[0].mint!==model.mintX||policies[1].mint!==model.mintY)throw Error('Transfer policy does not match the paper model');
  let netX=0n,netY=0n,taxX=0n,taxY=0n;
  for(const share of model.shares){
    const part=markAmounts({...model,shares:[share]},bins,priceYX);
    for(const [raw,index] of [[feesOnly?'0':part.x,0],[part.fx,0],[feesOnly?'0':part.y,1],[part.fy,1]] as const){
      const f=policies[index],net=transferNet(BigInt(raw),f.bps,BigInt(f.maximumRaw));
      if(index===0){netX+=net.amount;taxX+=net.fee;}else{netY+=net.amount;taxY+=net.fee;}
    }
  }
  return {nativeRaw:(model.solX?netX:netY).toString(),pairedRaw:(model.solX?netY:netX).toString(),withdrawTaxSol:paperTokenValue(model,priceYX,taxX,taxY)};
}
