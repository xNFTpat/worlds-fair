import DLMM, {wrapPosition} from '@meteora-ag/dlmm';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getExtensionTypes, ExtensionType} from '@solana/spl-token';
import {connection} from './solana';
import {money} from '../src/pnl';
import {estimateBreakEven, valueAtPrice, type PositionModel, type PriceBin} from '../src/break-even';
import {readFetch} from '../src/sources/read-fetch';
import type {Position} from '../src/schema';

function required(v:unknown, positive=false):number {
  const n=money(v);if(n==null || n<0 || (positive&&n===0))throw new Error('Position cash flows or prices are incomplete.');return n;
}
export function checkModelToken(token:any) {
  if(token.owner.equals(TOKEN_PROGRAM_ID))return;
  if(!token.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('The token program is not supported by this price model.');
  // This estimates marked LP value before exit costs, as in the P&L panel.
  // Transfer fees do not change raw token units or the bin invariant; they do
  // change exit proceeds, so the response explicitly excludes those costs.
  const supported=[ExtensionType.TransferFeeConfig,ExtensionType.MetadataPointer,ExtensionType.TokenMetadata,ExtensionType.MintCloseAuthority,ExtensionType.GroupPointer,ExtensionType.GroupMemberPointer,ExtensionType.TokenGroup,ExtensionType.TokenGroupMember];
  const unsupported=getExtensionTypes(token.mint.tlvData).filter(type=>!supported.includes(type));
  if(unsupported.length)throw new Error(`Token extensions need additional modelling: ${unsupported.map(type=>ExtensionType[type]||String(type)).join(', ')}.`);
}
export function modelFromRecords(history:any, records:any[], config:{solX:boolean;decX:number;decY:number;priceYX:number}) {
  const {solX,decX,decY,priceYX}=config;
  const entries=history.positions;
  if(history.hasNext!==false || !Array.isArray(entries) || !entries.length || entries.length!==records.length
    || new Set(entries.map((p:any)=>p.positionAddress)).size!==entries.length
    || entries.some((p:any)=>p.isClosed!==false))throw new Error('Full open-position history is needed for a break-even estimate.');
  const bins:PriceBin[]=[];
  let netCostUsd=0,baseFees=0,quoteFees=0,currentBase=0,currentQuote=0;
  for(const record of records){
    const p=record.positionData, entry=entries.find((e:any)=>e.positionAddress===record.publicKey.toBase58());
    if(!entry)throw new Error('The indexed position IDs do not match the on-chain read.');
    if(!p.rewardOne.isZero()||!p.rewardTwo.isZero())throw new Error('Additional reward tokens need pricing before this position can have a break-even line.');
    const x=(v:any)=>required(v.toString())/10**decX,y=(v:any)=>required(v.toString())/10**decY;
    const claimedX=required(entry.allTimeFees?.tokenX?.amount),claimedY=required(entry.allTimeFees?.tokenY?.amount);
    if(Math.abs(x(p.totalClaimedFeeXAmount)-claimedX)>Math.max(3/10**decX,claimedX*1e-8)
      ||Math.abs(y(p.totalClaimedFeeYAmount)-claimedY)>Math.max(3/10**decY,claimedY*1e-8))throw new Error('Fee-claim history is still catching up. Refresh before using a break-even price.');
    netCostUsd+=required(entry.allTimeDeposits?.total?.usd)-required(entry.allTimeWithdrawals?.total?.usd)-required(entry.allTimeFees?.total?.usd);
    baseFees+=solX?y(p.feeY):x(p.feeX);quoteFees+=solX?x(p.feeX):y(p.feeY);
    currentBase+=solX?y(p.totalYAmount):x(p.totalXAmount);currentQuote+=solX?x(p.totalXAmount):y(p.totalYAmount);
    if(!Array.isArray(p.positionBinData)||!p.positionBinData.length)throw new Error('Position bin balances are unavailable.');
    for(const bin of p.positionBinData){
      const px=required(bin.pricePerToken,true),bx=x(bin.positionXAmount),by=y(bin.positionYAmount);
      if(bx>0||by>0)bins.push({price:solX?1/px:px,baseAmount:solX?by:bx,quoteAmount:solX?bx:by});
    }
  }
  const quoteUsd=required(solX?history.tokenXPrice:history.tokenYPrice,true);
  const currentPrice=solX?1/required(priceYX,true):required(priceYX,true);
  const m:PositionModel={bins,netCostUsd,baseFees,quoteFees,quoteUsd,currentPrice};
  const actual=(currentBase*currentPrice+currentQuote+baseFees*currentPrice+quoteFees)*quoteUsd-netCostUsd;
  if(Math.abs(valueAtPrice(m,currentPrice)-actual)>0.01)throw new Error('Pool price moved during the bin read. Refresh for a consistent estimate.');
  return m;
}

export async function readPositionBreakEven(pos:Position,rpc:string) {
  const owner=new PublicKey(pos.walletAddress),pool=new PublicKey(pos.poolAddress),conn=connection(rpc);
  const qs=new URLSearchParams({user:pos.walletAddress,status:'open',page:'1',page_size:'20'});
  const [response,dlmm]=await Promise.all([
    readFetch(`https://dlmm.datapi.meteora.ag/positions/${pos.poolAddress}/pnl?${qs}`,{headers:{accept:'application/json'}}),
    DLMM.create(conn,pool),
  ]);
  if(!response.ok)throw new Error('Position accounting is temporarily unavailable.');
  const history:any=await response.json();
  if(history.tokenX!==dlmm.lbPair.tokenXMint.toBase58()||history.tokenY!==dlmm.lbPair.tokenYMint.toBase58())throw new Error('Indexed token prices do not match the on-chain pool.');
  const entries=history.positions;
  if(history.hasNext!==false||!Array.isArray(entries)||!entries.length||entries.length>10||entries.some((p:any)=>!p.positionAddress||p.isClosed!==false))throw new Error('A complete group of up to ten open positions is required.');
  const solX=dlmm.lbPair.tokenXMint.equals(NATIVE_MINT);
  if(!solX&&!dlmm.lbPair.tokenYMint.equals(NATIVE_MINT))throw new Error('Break-even price modelling currently covers token/SOL DLMM positions.');
  // Rebasing and custom transfer hooks require a different valuation model.
  checkModelToken(dlmm.tokenX);checkModelToken(dlmm.tokenY);
  const ids=entries.map((p:any)=>new PublicKey(p.positionAddress));
  const accounts=await conn.getMultipleAccountsInfo(ids);
  for(let i=0;i<ids.length;i++){
    const a=accounts[i];if(!a||!a.owner.equals(dlmm.program.programId))throw new Error('An indexed position is no longer open. Refresh positions.');
    const wrapped=wrapPosition(dlmm.program,ids[i],a);
    if(!wrapped.owner().equals(owner)||!wrapped.lbPair().equals(pool))throw new Error('Position ownership changed. Refresh positions.');
  }
  const records=await Promise.all(ids.map((id:PublicKey)=>dlmm.getPosition(id)));
  for(const r of records){
    if(!r.positionData.owner.equals(owner))throw new Error('Position ownership changed during the read.');
    const f=r.positionData.feeOwner;
    if(!f.equals(PublicKey.default)&&!f.equals(owner))throw new Error('This position pays fees to a different owner.');
  }
  const active=await dlmm.getActiveBin();
  const model=modelFromRecords(history,records,{solX,decX:dlmm.tokenX.mint.decimals,decY:dlmm.tokenY.mint.decimals,priceYX:Number(active.pricePerToken)});
  const estimate=estimateBreakEven(model);
  return {...estimate,currentPrice:model.currentPrice,quoteUsd:model.quoteUsd,
    baseAddress:(solX?dlmm.lbPair.tokenYMint:dlmm.lbPair.tokenXMint).toBase58(),quoteAddress:NATIVE_MINT.toBase58(),
    lower:Math.min(...model.bins.map(b=>b.price)),upper:Math.max(...model.bins.map(b=>b.price)),
    fetchedAt:new Date().toISOString(),positionCount:records.length,
    note:'Estimate of total P&L before exit costs, using current bin balances and indexed deposits, withdrawals and claimed fees. Includes unclaimed fees repriced with the token. Holds SOL/USD fixed; excludes future fees, gas, withdrawal/transfer fees, swap costs and rebalancing. This is today’s threshold, not historical P&L, an exit quote or a stop-loss.'};
}
