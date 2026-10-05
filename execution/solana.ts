import {Connection, PublicKey, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram} from '@solana/web3.js';
import DLMM, {ALT_ADDRESS, POSITION_MIN_SIZE, MAX_BIN_ARRAY_SIZE, getTokenProgramId, wrapPosition} from '@meteora-ag/dlmm';
import {Zap, estimateDlmmDirectSwap} from '@meteora-ag/zap-sdk';
import {NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createCloseAccountInstruction} from '@solana/spl-token';
import BN from 'bn.js';
import {Buffer} from 'buffer';
import {parseDlmmRangeRequest, resolveDlmmRange, expectedDlmmAllocation, simulatedDlmmAllocation, allocationFromSimulationEvidence, IncompleteDlmmAllocationEvidence, dlmmBinPrices, type ResolvedDlmmRange, type DlmmAllocation} from './dlmm-range';

export function solAmount(value: unknown): bigint {
  if(typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) throw new Error('Enter a SOL amount with up to nine decimals.');
  const [whole,fraction='']=value.split('.');
  const amount=BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));
  if(amount<=0n || amount>100000000000n) throw new Error('Total budget must be between 0 and 100 SOL.');
  return amount;
}
export function validSettings(body: any) {
  const slippage=Number(body.slippageBps ?? 100);
  if(!Number.isInteger(slippage)||slippage<10||slippage>300)throw new Error('Choose slippage between 0.1% and 3%.');
  const strategy=Number(body.strategy ?? 0);
  if(![0,1,2].includes(strategy))throw new Error('Choose Spot, Curve or Bid-Ask.');
  const range=parseDlmmRangeRequest(body.action==='exit'?{widthPct:body.widthPct}:body);
  return {slippage,strategy,width:range.width,range};
}
export function connection(rpc: string) {
  return new Connection(rpc, {commitment:'confirmed', disableRetryOnRateLimit:true, fetch: (input,init)=>fetch(input, {...init,signal:AbortSignal.timeout(20000)})});
}
export async function buildSolanaPreview(body: any, rpc: string, jupiterKey?: string) {
  if(!['enter','exit'].includes(body.action))throw new Error('Choose enter or exit.');
  const {slippage,strategy,range:rangeRequest}=validSettings(body);
  const owner=new PublicKey(body.owner), pool=new PublicKey(body.pool);
  const conn=connection(rpc);
  const dlmm=await DLMM.create(conn,pool);
  const isSolX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT);
  if(!isSolX&&!dlmm.lbPair.tokenYMint.equals(NATIVE_MINT))throw new Error('This first zap release supports SOL-paired pools.');
  const nativeAta=getAssociatedTokenAddressSync(NATIVE_MINT,owner);
  const nativeAccount=await conn.getAccountInfo(nativeAta);
  if(nativeAccount && new DataView(nativeAccount.data.buffer,nativeAccount.data.byteOffset,nativeAccount.data.byteLength).getBigUint64(64,true)>0n)throw new Error('This wallet already holds wrapped SOL. Unwrap that balance first, so this flow can keep your existing holdings separate.');
  const balance=await conn.getBalance(owner);
  const transactions:Transaction[]=[];
  let details:any;
  let position:PublicKey;
  let entryRange:ResolvedDlmmRange|null=null,expectedAllocation:DlmmAllocation|null=null;
  if(body.action==='enter') {
    const amount=solAmount(body.amountSol);
    if(amount+2000000n>BigInt(balance))throw new Error('Leave SOL available for fees and account rent. Lower the total budget.');
    const positionRent=await conn.getMinimumBalanceForRentExemption(POSITION_MIN_SIZE);
    if(amount+BigInt(positionRent)+2000000n>BigInt(balance))throw new Error('Not enough free SOL. Allow an estimated '+(positionRent/1e9).toFixed(6)+' SOL for the position account, in addition to your '+body.amountSol+' SOL budget and fees.');
    position=new PublicKey(body.position);
    if(position.equals(owner)||await conn.getAccountInfo(position))throw new Error('Use a fresh position address.');
    entryRange=resolveDlmmRange(rangeRequest,{activeBin:dlmm.lbPair.activeId,binStep:dlmm.lbPair.binStep,minNativeBin:dlmm.lbPair.parameters.minBinId,maxNativeBin:dlmm.lbPair.parameters.maxBinId,decimalsX:dlmm.tokenX.mint.decimals,decimalsY:dlmm.tokenY.mint.decimals,solIsX:isSolX});
    const active=await dlmm.getActiveBin();
    if(active.binId!==entryRange.activeBin)throw new Error('The active bin moved while reading the pool. Review a fresh range.');
    const budget=new BN(amount.toString());
    let swapAmount=new BN(0),swapMinimum=new BN(0),swapExpected=new BN(0),xAmount=isSolX?budget:new BN(0),yAmount=isSolX?new BN(0):budget;
    if(entryRange.depositMode==='two-sided'){
      const config=jupiterKey?{jupiterApiKey:jupiterKey}:{};
      const estimate=await estimateDlmmDirectSwap({amountIn:budget,inputTokenMint:NATIVE_MINT,lbPair:pool,connection:conn,swapSlippageBps:slippage,minDeltaId:entryRange.minDeltaId,maxDeltaId:entryRange.maxDeltaId,strategy,config});
      // Absolute reviewed IDs remain fixed even if the estimator models a range
      // relative to its post-swap active bin. Final simulation is authoritative.
      swapAmount=estimate.result.swapAmount;
      if(swapAmount.lten(0)||swapAmount.gte(budget))throw new Error('This funding estimate does not produce both assets. Change the range or choose SOL-only.');
      const remaining=budget.sub(swapAmount),swapForY=isSolX,arrays=await dlmm.getBinArrayForSwap(swapForY);
      const quote=dlmm.swapQuote(swapAmount,swapForY,new BN(slippage),arrays);
      if(!quote.consumedInAmount.eq(swapAmount)||quote.minOutAmount.lten(0))throw new Error('The pool cannot swap the full funding amount into paired tokens.');
      swapMinimum=quote.minOutAmount;swapExpected=quote.outAmount;
      const swap=await dlmm.swap({inToken:NATIVE_MINT,outToken:isSolX?dlmm.lbPair.tokenYMint:dlmm.lbPair.tokenXMint,inAmount:swapAmount,minOutAmount:swapMinimum,lbPair:pool,user:owner,binArraysPubkey:quote.binArraysPubkey});
      // Keep entry atomic using the direct swap and deposit. The same wrapped
      // SOL account stays open until deposit and is unwrapped only at the end.
      swap.instructions=swap.instructions.filter(ix=>!(ix.programId.equals(TOKEN_PROGRAM_ID)&&ix.data[0]===9&&ix.keys[0].pubkey.equals(nativeAta)));
      transactions.push(swap);
      xAmount=isSolX?remaining:swapMinimum;yAmount=isSolX?swapMinimum:remaining;
    }
    // SOL-only never requests a quote or funding swap and supplies zero paired
    // tokens. Existing wallet tokens stay outside this newly created position.
    expectedAllocation=expectedDlmmAllocation({range:entryRange,strategy,amountXRaw:xAmount.toString(),amountYRaw:yAmount.toString(),activeXRaw:active.xAmount.toString(),activeYRaw:active.yAmount.toString(),mintX:dlmm.tokenX.mint,mintY:dlmm.tokenY.mint,clock:dlmm.clock});
    transactions.push(await dlmm.initializePositionAndAddLiquidityByStrategy({positionPubKey:position,totalXAmount:xAmount,totalYAmount:yAmount,strategy:{minBinId:entryRange.lowerBin,maxBinId:entryRange.upperBin,strategyType:strategy},user:owner,slippage:slippage/100}));
    details={action:'enter',amountSol:body.amountSol,strategy:['Spot','Curve','Bid-Ask'][strategy],route:entryRange.depositMode==='sol-only'?'Meteora SOL-only deposit; no funding swap':'Meteora direct pool',swapInputLamports:swapAmount.toString(),swapMinimumRaw:swapMinimum.toString(),swapExpectedRaw:swapExpected.toString(),lowerBin:entryRange.lowerBin,upperBin:entryRange.upperBin,lowerPriceSol:entryRange.lowerPriceSol,upperPriceSol:entryRange.upperPriceSol,requestedLowerPriceSol:entryRange.requestedLowerPriceSol,requestedUpperPriceSol:entryRange.requestedUpperPriceSol,binCount:entryRange.binCount,activeBin:entryRange.activeBin,initialActiveBin:entryRange.activeBin,activePriceSol:entryRange.activePriceSol,depositMode:entryRange.depositMode,binStep:entryRange.binStep,rangeSource:entryRange.source,rangeAlignmentNote:entryRange.alignmentNote,tokenX:dlmm.lbPair.tokenXMint.toBase58(),tokenY:dlmm.lbPair.tokenYMint.toBase58(),expectedX:xAmount.toString(),expectedY:yAmount.toString(),decimalsX:dlmm.tokenX.mint.decimals,decimalsY:dlmm.tokenY.mint.decimals};
  } else if(body.action==='exit') {
    position=new PublicKey(body.position);
    const account=await conn.getAccountInfo(position);
    if(!account||!account.owner.equals(dlmm.program.programId))throw new Error('This position is no longer open.');
    const owned=wrapPosition(dlmm.program,position,account);
    if(!owned.owner().equals(owner)||!owned.lbPair().equals(pool))throw new Error('This wallet does not own that position in this pool.');
    const p=(await dlmm.getPosition(position)).positionData;
    if(!p.rewardOne.isZero()||!p.rewardTwo.isZero())throw new Error('This position has additional reward tokens. The first close-to-SOL release handles the pair and trading fees only; manage this exit on Meteora.');
    const removes=await dlmm.removeLiquidity({position,user:owner,fromBinId:p.lowerBinId,toBinId:p.upperBinId,bps:new BN(10000),shouldClaimAndClose:true,skipUnwrapSOL:true});
    transactions.push(...removes);
    // Include accrued fees in the conversion estimate; the zap program measures the actual
    // balance delta, so unrelated tokens already in this wallet are not sold.
    let inputAmount=new BN(isSolX?p.totalYAmount:p.totalXAmount).add(isSolX?p.feeY:p.feeX);
    if(!inputAmount.isZero()) {
      const {tokenXProgram,tokenYProgram}=getTokenProgramId(dlmm.lbPair);
      const inputAta=getAssociatedTokenAddressSync(isSolX?dlmm.lbPair.tokenYMint:dlmm.lbPair.tokenXMint,owner,false,isSolX?tokenYProgram:tokenXProgram);
      const preInput=await conn.getAccountInfo(inputAta);
      const rawTokenAmount=(data:Uint8Array)=>new DataView(data.buffer,data.byteOffset,data.byteLength).getBigUint64(64,true);
      const preInputAmount=preInput?rawTokenAmount(preInput.data):0n;
      const swapForY=!isSolX;
      const arrays=await dlmm.getBinArrayForSwap(swapForY);
      // A withdrawal changes the liquidity available to its own exit swap. Quote from
      // simulated post-removal bin arrays, rather than from the pre-removal pool.
      const removalBlock=await conn.getLatestBlockhash();
      const removalLookup=(await conn.getAddressLookupTable(new PublicKey(ALT_ADDRESS['mainnet-beta']))).value;
      const removalInstructions=removes.flatMap(t=>t.instructions).filter(ix=>!ix.programId.equals(ComputeBudgetProgram.programId)&&!(ix.programId.equals(TOKEN_PROGRAM_ID)&&ix.data[0]===9&&ix.keys[0].pubkey.equals(nativeAta)));
      const removalMessage=new TransactionMessage({payerKey:owner,recentBlockhash:removalBlock.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:1400000}),...removalInstructions]}).compileToV0Message(removalLookup?[removalLookup]:[]);
      const removed=await conn.simulateTransaction(new VersionedTransaction(removalMessage),{sigVerify:false,accounts:{encoding:'base64',addresses:[...arrays.map(a=>a.publicKey.toBase58()),inputAta.toBase58()]}});
      if(removed.value.err)throw new Error('Withdrawal simulation failed. No transaction was sent.');
      const postArrays=arrays.map((array,index)=>{
        const account=removed.value.accounts?.[index];
        if(!account?.data)throw new Error('Post-withdrawal liquidity data is incomplete.');
        return {...array,account:dlmm.program.coder.accounts.decode('binArray',Buffer.from(account.data[0],'base64'))};
      });
      const removedInput=removed.value.accounts?.[arrays.length];
      if(!removedInput)throw new Error('Withdrawal did not return its token balance.');
      const actualInput=rawTokenAmount(Buffer.from(removedInput.data[0],'base64'))-preInputAmount;
      inputAmount=new BN(actualInput.toString());
      if(inputAmount.lten(0))throw new Error('No token proceeds available for conversion.');
      const quote=dlmm.swapQuote(inputAmount,swapForY,new BN(slippage),postArrays);
      const zap=new Zap(conn);
      transactions.push(await zap.zapOutThroughDlmm({user:owner,lbPairAddress:pool,inputMint:isSolX?dlmm.lbPair.tokenYMint:dlmm.lbPair.tokenXMint,outputMint:NATIVE_MINT,inputTokenProgram:isSolX?tokenYProgram:tokenXProgram,outputTokenProgram:isSolX?tokenXProgram:tokenYProgram,amountIn:inputAmount,minimumSwapAmountOut:quote.minOutAmount,maxSwapAmount:inputAmount.muln(103).divn(100),percentageToZapOut:100}));
    } else {
      // removeLiquidity left SOL wrapped for composition. Explicitly close that account.
      const {getAssociatedTokenAddressSync,createCloseAccountInstruction}=await import('@solana/spl-token');
      transactions.push(new Transaction().add(createCloseAccountInstruction(getAssociatedTokenAddressSync(NATIVE_MINT,owner),owner,owner)));
    }
    details={action:'exit',lowerBin:p.lowerBinId,upperBin:p.upperBinId};
  } else throw new Error('Choose enter or exit.');
  const latest=await conn.getLatestBlockhash();
  const lookup=(await conn.getAddressLookupTable(new PublicKey(ALT_ADDRESS['mainnet-beta']))).value;
  const seenAta=new Set<string>();
  const instructions=transactions.flatMap(t=>t.instructions).filter(ix=>{
    if(ix.programId.equals(ComputeBudgetProgram.programId))return false;
    if(ix.programId.equals(TOKEN_PROGRAM_ID)&&ix.data[0]===9&&ix.keys[0].pubkey.equals(nativeAta))return false;
    if(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)&&[0,1,undefined].includes(ix.data[0])){
      const address=ix.keys[1].pubkey.toBase58();
      if(seenAta.has(address))return false;
      seenAta.add(address);
    }
    return true;
  });
  instructions.push(createCloseAccountInstruction(nativeAta,owner,owner));
  const message=new TransactionMessage({payerKey:owner,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:1400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),...instructions]}).compileToV0Message(lookup?[lookup]:[]);
  const tx=new VersionedTransaction(message);
  let bytes:Uint8Array;
  try{bytes=tx.serialize();}catch{throw new Error('This zap does not fit one transaction. Try a narrower range. No transaction was sent.');}
  if(bytes.length>1232)throw new Error('This zap exceeds Solana’s transaction size ('+bytes.length+' bytes; '+instructions.length+' instructions). No transaction was sent.');
  const keys=message.getAccountKeys({addressLookupTableAccounts:lookup?[lookup]:[]});
  const inspected=[owner,...Array.from({length:keys.length},(_,i)=>({key:keys.get(i)!,writable:message.isAccountWritable(i)})).filter(x=>x.writable&&!x.key.equals(owner)).map(x=>x.key)];
  const before=await conn.getMultipleAccountsInfo(inspected);
  const simulation=await conn.simulateTransaction(tx,{sigVerify:false,accounts:{encoding:'base64',addresses:inspected.map(k=>k.toBase58())}});
  if(simulation.value.err)throw new Error('Simulation failed: '+JSON.stringify(simulation.value.err)+' · '+(simulation.value.logs||[]).filter(l=>/insufficient|Error Code/.test(l)).slice(-3).join(' · ')+'. No transaction was sent.');
  const fee=(await conn.getFeeForMessage(message)).value;
  const postBalance=simulation.value.accounts?.[0]?.lamports;
  const after=simulation.value.accounts;
  let rentDepositedLamports=0,rentReturnedLamports=0;
  before.forEach((account,i)=>{if(i===0)return;if(!account&&after?.[i]?.lamports)rentDepositedLamports+=after[i]!.lamports;if(account&&!after?.[i]?.lamports)rentReturnedLamports+=account.lamports;});
  if(fee===null||postBalance==null)throw new Error('The RPC did not return a complete fee and balance preview.');
  if(postBalance<2000000)throw new Error('This would leave less than 0.002 SOL for subsequent fees. Lower the budget.');
  const balanceBefore=before[0]?.lamports??balance;
  const {tokenXProgram,tokenYProgram}=getTokenProgramId(dlmm.lbPair);
  const pairedAta=getAssociatedTokenAddressSync(isSolX?dlmm.lbPair.tokenYMint:dlmm.lbPair.tokenXMint,owner,false,isSolX?tokenYProgram:tokenXProgram);
  const tokenIndex=inspected.findIndex(k=>k.equals(pairedAta));
  const tokenAmount=(data:Uint8Array)=>new DataView(data.buffer,data.byteOffset,data.byteLength).getBigUint64(64,true);
  const preTokens=tokenIndex>=0&&before[tokenIndex]?tokenAmount(before[tokenIndex]!.data):0n;
  const postTokenAccount=tokenIndex>=0&&after?.[tokenIndex]?.lamports?after[tokenIndex]:null;
  const postTokens=postTokenAccount?tokenAmount(Buffer.from(postTokenAccount.data[0],'base64')):0n;
  const positionIndex=inspected.findIndex(k=>k.equals(position));
  if(body.action==='exit'&&(positionIndex<0||after?.[positionIndex]?.lamports))throw new Error('The simulation did not close the complete position. No transaction was sent.');
  if(body.action==='exit'&&postTokens!==preTokens)throw new Error('The simulation did not convert exactly this position’s token proceeds. No transaction was sent.');
  if(body.action==='enter'&&postTokens<preTokens)throw new Error('This deposit would consume tokens already in the wallet. No transaction was sent.');
  if(body.action==='enter'&&entryRange){
    const postPosition=after?.[positionIndex];
    if(!postPosition?.data||postPosition.owner!==dlmm.program.programId.toBase58())throw new Error('The simulation did not return the newly opened DLMM position. No transaction was sent.');
    const opened=wrapPosition(dlmm.program,position,{...postPosition,data:Buffer.from(postPosition.data[0],'base64'),owner:new PublicKey(postPosition.owner)});
    if(!opened.owner().equals(owner)||!opened.lbPair().equals(pool)||opened.lowerBinId().toNumber()!==entryRange.lowerBin||opened.upperBinId().toNumber()!==entryRange.upperBin)throw new Error('The simulated position does not match the exact reviewed owner, pool and bin bounds. No transaction was sent.');
    if(!opened.liquidityShares().some(share=>share.gtn(0)))throw new Error('The simulated position contains no liquidity. No transaction was sent.');
    const poolIndex=inspected.findIndex(k=>k.equals(pool)),postPool=after?.[poolIndex];
    if(!postPool?.data||postPool.owner!==dlmm.program.programId.toBase58())throw new Error('The simulation did not return the pool active-bin state. No transaction was sent.');
    const simulatedPool=dlmm.program.coder.accounts.decode('lbPair',Buffer.from(postPool.data[0],'base64'));
    if(simulatedPool.binStep!==entryRange.binStep||!simulatedPool.tokenXMint.equals(dlmm.lbPair.tokenXMint)||!simulatedPool.tokenYMint.equals(dlmm.lbPair.tokenYMint))throw new Error('The simulated pool identity or bin step differs from the review. No transaction was sent.');
    const simulatedActive=simulatedPool.activeId,activePrice=dlmmBinPrices(simulatedActive,entryRange).priceSol;
    if(entryRange.depositMode==='sol-only'&&(isSolX?simulatedActive>=entryRange.lowerBin:simulatedActive<=entryRange.upperBin))throw new Error('The pool moved into or below the chosen SOL-only range. Refresh the range before approval.');
    if(entryRange.depositMode==='two-sided'&&(simulatedActive<entryRange.lowerBin||simulatedActive>entryRange.upperBin))throw new Error('Funding moved the pool outside the chosen absolute range. Widen the range or review again.');
    details.activeBin=simulatedActive;details.activePriceSol=activePrice;
    const allocation=allocationFromSimulationEvidence(expectedAllocation!,()=>{
      const bins:{binId:number;amountXRaw:string;amountYRaw:string;supplyRaw:string}[]=[],arraySize=MAX_BIN_ARRAY_SIZE.toNumber(),shares=opened.liquidityShares(),seenBins=new Set<number>();
      let missingAccount=false;
      for(const arrayKey of opened.getBinArrayKeysCoverage(dlmm.program.programId)){
        const index=inspected.findIndex(k=>k.equals(arrayKey)),account=after?.[index];
        if(!account?.data){missingAccount=true;continue;}
        if(account.owner!==dlmm.program.programId.toBase58())throw new Error('A simulated range bin array has the wrong program owner.');
        const array=dlmm.program.coder.accounts.decode('binArray',Buffer.from(account.data[0],'base64'));
        if(!array.lbPair.equals(pool))throw new Error('A simulated bin array belongs to another pool.');
        const first=array.index.toNumber()*arraySize;
        for(let i=0;i<arraySize;i++){
          const binId=first+i;if(binId<entryRange.lowerBin||binId>entryRange.upperBin)continue;
          const bin=array.bins[i];
          if(seenBins.has(binId))throw new Error('Simulated range bin arrays contain duplicate IDs.');
          seenBins.add(binId);
          const share=shares[binId-entryRange.lowerBin];
          if(!share||share.gt(bin.liquiditySupply))throw new Error('Simulated position share exceeds or does not match bin supply.');
          bins.push({binId,amountXRaw:bin.amountX.toString(),amountYRaw:bin.amountY.toString(),supplyRaw:bin.liquiditySupply.toString()});
        }
      }
      // Validate every present account before allowing an incomplete-evidence
      // fallback; a missing earlier array cannot hide a malformed later one.
      if(missingAccount)throw new IncompleteDlmmAllocationEvidence('A simulated range bin array was not returned.');
      return simulatedDlmmAllocation({range:entryRange!,sharesRaw:shares.map(share=>share.toString()),bins,reviewPriceSol:activePrice});
    });
    details.allocation={...allocation,asOf:new Date().toISOString(),simulationSlot:simulation.context.slot};
  }
  return {...details,priceLowerYX:entryRange?.priceLowerYX??Math.pow(1+dlmm.lbPair.binStep/10000,details.lowerBin)*10**(dlmm.tokenX.mint.decimals-dlmm.tokenY.mint.decimals),priceUpperYX:entryRange?.priceUpperYX??Math.pow(1+dlmm.lbPair.binStep/10000,details.upperBin)*10**(dlmm.tokenX.mint.decimals-dlmm.tokenY.mint.decimals),owner:owner.toBase58(),pool:pool.toBase58(),position:position.toBase58(),slippageBps:slippage,pairedTokenRemainderRaw:(postTokens-preTokens).toString(),pairedTokenDecimals:isSolX?dlmm.tokenY.mint.decimals:dlmm.tokenX.mint.decimals,rentDepositedLamports,rentReturnedLamports,networkFeeLamports:fee,balanceLamports:balanceBefore,postBalanceLamports:postBalance,netChangeLamports:postBalance-balanceBefore,messageHex:Buffer.from(message.serialize()).toString('hex'),transactionBase64:Buffer.from(bytes).toString('base64'),blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,builtAt:Date.now(),expiresAt:Date.now()+75000,atomic:true,simulationSlot:simulation.context.slot};
}

export async function verifiedTransaction(signed:string,preview:{messageHex:string;expiresAt:number}){
  if(preview.expiresAt<Date.now())throw new Error('Preview expired. Review again before submitting.');
  const tx=VersionedTransaction.deserialize(Buffer.from(signed,'base64'));
  if(Buffer.from(tx.message.serialize()).toString('hex')!==preview.messageHex)throw new Error('Signed transaction differs from the reviewed transaction.');
  const {ed25519}=await import('@noble/curves/ed25519');
  for(let i=0;i<tx.message.header.numRequiredSignatures;i++){
    if(!ed25519.verify(tx.signatures[i],tx.message.serialize(),tx.message.staticAccountKeys[i].toBytes()))throw new Error('A required signature is missing or invalid.');
  }
  return tx;
}
export async function verifyAndSubmit(rpc:string,signed:string,preview:{messageHex:string;expiresAt:number}){
  const tx=await verifiedTransaction(signed,preview);
  return connection(rpc).sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:0});
}

export async function ownedSolanaPositions(rpc:string,owner:string,pool:string){
  const ownerKey=new PublicKey(owner),poolKey=new PublicKey(pool),conn=connection(rpc);
  const dlmm=await DLMM.create(conn,poolKey);
  const addresses:string[]=[];
  for(let page=1;page<=5;page++){
    const url='https://dlmm.datapi.meteora.ag/positions/'+pool+'/pnl?'+new URLSearchParams({user:owner,status:'open',page:String(page),page_size:'20'});
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Meteora position discovery is unavailable. Try again later.');
    const data:any=await response.json();
    if(!Array.isArray(data.positions))throw new Error('Position discovery returned incomplete data.');
    for(const p of data.positions){const address=p.positionAddress??p.position??p.address;if(typeof address!=='string')throw new Error('Position address unavailable.');addresses.push(address);}
    if(!data.hasNext)break;
    if(page===5)throw new Error('More than 100 positions need checking; narrow the position list on Meteora.');
  }
  const keys=[...new Set(addresses)].map(a=>new PublicKey(a));
  if(!keys.length)return [];
  const accounts=await conn.getMultipleAccountsInfo(keys);
  return accounts.flatMap((a,i)=>{
    if(!a||!a.owner.equals(dlmm.program.programId))return [];
    const p=wrapPosition(dlmm.program,keys[i],a);
    if(!p.owner().equals(ownerKey)||!p.lbPair().equals(poolKey))return [];
    return [{address:keys[i].toBase58(),lowerBin:p.lowerBinId().toNumber(),upperBin:p.upperBinId().toNumber()}];
  });
}
