// Public account reads only. This module has no wallet or transaction builder.
import DLMM, {wrapPosition, getPriceOfBinByBinId} from '@meteora-ag/dlmm';
import {Connection, PublicKey} from '@solana/web3.js';
import {NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getExtensionTypes, ExtensionType, getTransferFeeConfig} from '@solana/spl-token';
import {paperRpcTransport} from './paper-rpc';
import type {PublicRpcBudgetEnv} from '../src/public-rpc-budget';

export interface WalletBin {nativeBinId:number;priceSol:number;sol:number;token:number}
export interface WalletBinRead {
  address:string;poolAddress:string;positionAddress:string;asOf:string;source:string;
  mintX:string;mintY:string;pairedMint:string;solX:boolean;decimals:number;
  priceSol:number;floorPriceSol:number;topPriceSol:number;binStep:number;
  lowerBinId:number;upperBinId:number;rangeBinCount:number;bins:WalletBin[];
  valueSol:number;feesSol:number|null;pairedRaw:string;pairedWithdrawableRaw:string;solRaw:string;
  transferFeeBps:number|null;transferFeeChangeable:boolean|null;modelSupported:boolean;policyNote:string;
}
const uint=(v:unknown):string=>{const s=typeof v==='string'?v:typeof v==='object'&&v!==null?String(v):'';if(!/^\d{1,78}$/.test(s))throw Error('Position token amounts are unavailable.');return s;};
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function walletPublicKey(value:string):string {
  if(typeof value!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))throw Error('Enter a valid Solana wallet address.');
  const key=new PublicKey(value);if(key.toBase58()!==value)throw Error('Enter a valid Solana wallet address.');return value;
}
/** Separate pure decoding boundary makes orientation and identity testable. */
export function normaliseWalletBins(input:{address:string;poolAddress:string;positionAddress:string;owner:string;positionPool:string;mintX:string;mintY:string;decX:number;decY:number;binStep:number;activeId:number;priceYX:number;lowerBinId:number;upperBinId:number;totalXRaw:string;totalYRaw:string;withdrawableXRaw:string;withdrawableYRaw:string;feeXRaw:string;feeYRaw:string;feesOwned:boolean;bins:{binId:number;pricePerToken:string;positionXAmount:string;positionYAmount:string}[];asOf:string;modelSupported:boolean;policyNote:string;transferFeeBps:number|null;transferFeeChangeable:boolean|null},now=Date.now()):WalletBinRead {
  if(input.owner!==input.address||input.positionPool!==input.poolAddress)throw Error('The selected position does not belong to this wallet and pool.');
  const solX=input.mintX===NATIVE_MINT.toBase58(),solY=input.mintY===NATIVE_MINT.toBase58();
  if(solX===solY)throw Error('This Pre-flight currently supports SOL-paired Meteora DLMM positions.');
  if(![input.decX,input.decY].every(n=>Number.isInteger(n)&&n>=0&&n<=18)||(solX?input.decX:input.decY)!==9||!positive(input.priceYX)||!Number.isInteger(input.binStep)||input.binStep<1||input.binStep>10000)throw Error('Verified token decimals and pool price are unavailable.');
  const at=Date.parse(input.asOf);if(!Number.isFinite(at)||at>now||now-at>60000)throw Error('This position read has expired. Run Pre-flight again.');
  const count=input.upperBinId-input.lowerBinId+1;
  if(![input.lowerBinId,input.upperBinId,input.activeId].every(Number.isSafeInteger)||count<1||count>1400||input.bins.length!==count)throw Error('The complete position range is unavailable.');
  const seen=new Set<number>(),scaleX=10**input.decX,scaleY=10**input.decY;
  let rawX=0n,rawY=0n;
  const bins=input.bins.map(b=>{
    const px=Number(b.pricePerToken),x=BigInt(uint(b.positionXAmount)),y=BigInt(uint(b.positionYAmount));
    if(!Number.isSafeInteger(b.binId)||b.binId<input.lowerBinId||b.binId>input.upperBinId||seen.has(b.binId)||!positive(px))throw Error('Position bin data is incomplete.');
    seen.add(b.binId);rawX+=x;rawY+=y;
    const expected=Number(getPriceOfBinByBinId(b.binId,input.binStep).toString())*10**(input.decX-input.decY);
    if(!positive(expected)||Math.abs(px/expected-1)>1e-9)throw Error('The position bin prices do not match this pool grid.');
    return {nativeBinId:b.binId,priceSol:solX?1/px:px,sol:solX?Number(x)/scaleX:Number(y)/scaleY,token:solX?Number(y)/scaleY:Number(x)/scaleX};
  }).sort((a,b)=>a.priceSol-b.priceSol);
  const x=BigInt(uint(input.totalXRaw)),y=BigInt(uint(input.totalYRaw)),wx=BigInt(uint(input.withdrawableXRaw)),wy=BigInt(uint(input.withdrawableYRaw));
  if(rawX!==x||rawY!==y||wx>x||wy>y)throw Error('Position totals do not match its individual bins. Refresh the read.');
  const priceSol=solX?1/input.priceYX:input.priceYX,activeExpected=Number(getPriceOfBinByBinId(input.activeId,input.binStep).toString())*10**(input.decX-input.decY);
  if(!positive(activeExpected)||Math.abs(input.priceYX/activeExpected-1)>1e-9)throw Error('The active price does not match the observed bin.');
  const valueSol=bins.reduce((sum,b)=>sum+b.sol+b.token*priceSol,0);
  if(!Number.isFinite(valueSol)||valueSol<0||bins.some(b=>!Number.isFinite(b.sol)||!Number.isFinite(b.token)))throw Error('Position balances cannot be represented.');
  const feeX=Number(uint(input.feeXRaw))/scaleX,feeY=Number(uint(input.feeYRaw))/scaleY,feeValue=solX?feeX+feeY*priceSol:feeY+feeX*priceSol;
  return {address:input.address,poolAddress:input.poolAddress,positionAddress:input.positionAddress,asOf:input.asOf,source:'Confirmed Solana RPC · Meteora DLMM position bins',
    mintX:input.mintX,mintY:input.mintY,pairedMint:solX?input.mintY:input.mintX,solX,decimals:solX?input.decY:input.decX,
    priceSol,floorPriceSol:bins[0].priceSol,topPriceSol:bins[bins.length-1].priceSol,binStep:input.binStep,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,rangeBinCount:count,bins,valueSol,
    feesSol:input.feesOwned&&Number.isFinite(feeValue)?feeValue:null,pairedRaw:(solX?y:x).toString(),pairedWithdrawableRaw:(solX?wy:wx).toString(),solRaw:(solX?x:y).toString(),
    transferFeeBps:input.transferFeeBps,transferFeeChangeable:input.transferFeeChangeable,modelSupported:input.modelSupported,policyNote:input.policyNote};
}
export async function readWalletBins(rpc:string,address:string,poolAddress:string,positionAddress:string,env?:PublicRpcBudgetEnv):Promise<WalletBinRead> {
  [address,poolAddress,positionAddress].forEach(walletPublicKey);
  const transport=paperRpcTransport({env,maxRequests:22,maxDurationMs:16000,intervalMs:60});
  const conn=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:transport.fetch as any}),owner=new PublicKey(address),pool=new PublicKey(poolAddress),position=new PublicKey(positionAddress);
  const [dlmm,account]=await Promise.all([DLMM.create(conn,pool),conn.getAccountInfo(position,'confirmed')]);
  if(!account||!account.owner.equals(dlmm.program.programId))throw Error('This position is no longer open.');
  const wrapped=wrapPosition(dlmm.program,position,account);
  if(!wrapped.owner().equals(owner)||!wrapped.lbPair().equals(pool))throw Error('This wallet does not own the selected position in this pool.');
  const width=wrapped.upperBinId().sub(wrapped.lowerBinId()).toNumber()+1;
  if(width<1||width>1400)throw Error('This position is wider than the read-only demo can inspect.');
  const solX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT),solY=dlmm.lbPair.tokenYMint.equals(NATIVE_MINT);
  if(solX===solY)throw Error('This Pre-flight currently supports SOL-paired Meteora DLMM positions.');
  const record=await dlmm.getPosition(position),p=record.positionData,active=await dlmm.getActiveBin();
  if(!record.publicKey.equals(position)||!p.owner.equals(owner)||p.lowerBinId!==wrapped.lowerBinId().toNumber()||p.upperBinId!==wrapped.upperBinId().toNumber()||active.binId!==dlmm.lbPair.activeId)throw Error('The position changed during the read. Refresh Pre-flight.');
  const [lastPosition,lastPool]=await conn.getMultipleAccountsInfo([position,pool],'confirmed');
  if(!lastPosition||!lastPool||!lastPosition.owner.equals(dlmm.program.programId)||!lastPool.owner.equals(dlmm.program.programId))throw Error('The position or pool is no longer available.');
  const finalPosition=wrapPosition(dlmm.program,position,lastPosition),finalPool=dlmm.program.coder.accounts.decode('lbPair',lastPool.data);
  if(!finalPosition.owner().equals(owner)||!finalPosition.lbPair().equals(pool)||finalPosition.lowerBinId().toNumber()!==p.lowerBinId||finalPosition.upperBinId().toNumber()!==p.upperBinId||lastPosition.data.length!==account.data.length||lastPosition.data.some((byte,index)=>byte!==account.data[index])||finalPool.activeId!==active.binId||finalPool.binStep!==dlmm.lbPair.binStep||!finalPool.tokenXMint.equals(dlmm.lbPair.tokenXMint)||!finalPool.tokenYMint.equals(dlmm.lbPair.tokenYMint))throw Error('Position ownership, allocation or price changed during the read. Run Pre-flight again.');
  const token=solX?dlmm.tokenY:dlmm.tokenX,epoch=BigInt(dlmm.clock.epoch.toString());
  const supported=[ExtensionType.TransferFeeConfig,ExtensionType.MetadataPointer,ExtensionType.TokenMetadata,ExtensionType.MintCloseAuthority,ExtensionType.GroupPointer,ExtensionType.GroupMemberPointer,ExtensionType.TokenGroup,ExtensionType.TokenGroupMember];
  const spl=token.owner.equals(TOKEN_PROGRAM_ID),token2022=token.owner.equals(TOKEN_2022_PROGRAM_ID),extensions=token2022?getExtensionTypes(token.mint.tlvData):[];
  const modelSupported=spl||token2022&&extensions.every(type=>supported.includes(type));
  const config=token2022?getTransferFeeConfig(token.mint):null,fee=config?(epoch>=config.newerTransferFee.epoch?config.newerTransferFee:config.olderTransferFee):null;
  return normaliseWalletBins({address,poolAddress,positionAddress,owner:p.owner.toBase58(),positionPool:wrapped.lbPair().toBase58(),mintX:dlmm.lbPair.tokenXMint.toBase58(),mintY:dlmm.lbPair.tokenYMint.toBase58(),decX:dlmm.tokenX.mint.decimals,decY:dlmm.tokenY.mint.decimals,binStep:dlmm.lbPair.binStep,activeId:active.binId,priceYX:Number(active.pricePerToken),lowerBinId:p.lowerBinId,upperBinId:p.upperBinId,totalXRaw:p.totalXAmount,totalYRaw:p.totalYAmount,withdrawableXRaw:p.totalXAmountExcludeTransferFee.toString(),withdrawableYRaw:p.totalYAmountExcludeTransferFee.toString(),feeXRaw:p.feeX.toString(),feeYRaw:p.feeY.toString(),feesOwned:p.feeOwner.equals(PublicKey.default)||p.feeOwner.equals(owner),bins:p.positionBinData,asOf:new Date().toISOString(),modelSupported,policyNote:modelSupported?'Observed token units. The paper model does not reproduce liquidity share, rebalancing or execution.':'Additional token extensions need a different model; paper copying and exit quoting are unavailable.',transferFeeBps:spl?0:token2022?fee?.transferFeeBasisPoints??0:null,transferFeeChangeable:spl?false:token2022?!!config?.transferFeeConfigAuthority&&!config.transferFeeConfigAuthority.equals(PublicKey.default):null});
}
