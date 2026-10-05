import {readFetch} from './sources/read-fetch';
import {raydiumPoolUrl} from './pool-links';
const DLMM='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const DAMM='cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const CPMM='CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export async function lookupPool(address:string,rpc:string) {
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))throw Error('Paste a valid Solana pool address.');
  const request=async(url:string,init?:RequestInit)=>{const r=await readFetch(url,init);if(!r.ok)throw Error('Pool lookup provider unavailable. Try again shortly.');return await r.json() as any;};
  const account=await request(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getAccountInfo',params:[address,{encoding:'base64',dataSlice:{offset:0,length:0}}]})});
  if(account.error)throw Error('The chain read is unavailable. Try this pool lookup again.');
  const owner=account.result?.value?.owner;
  if(!owner)throw Error('No live account found at this address. A closed position may no longer exist.');
  if(![DLMM,DAMM,CPMM].includes(owner))throw Error('This account is not owned by a covered pool program. It may be a mint, wallet, position, or another venue. Paste the pool address from its page.');
  const fetchedAt=new Date().toISOString();
  if(owner===CPMM) {
    const d=await request('https://api-v3.raydium.io/pools/info/ids?ids='+address);
    const p=d.data?.find((p:any)=>p.id===address&&p.programId===CPMM);
    if(!p?.mintA?.address||!p?.mintB?.address)throw Error('Raydium has not indexed this as a CPMM pool. The address may belong to another account type.');
    const tokens=[p.mintA,p.mintB].map(t=>({address:t.address,symbol:t.symbol,name:t.name,transferFee:t.tags?.includes('hasTransferFee')||!!t.extensions?.feeConfig,freeze:t.tags?.includes('hasFreeze')}));
    return {address,pair:tokens.map(t=>t.symbol).join('/'),type:'Raydium CPMM',tokens,fetchedAt,url:raydiumPoolUrl(address),
      explanation:'Full-range constant-product liquidity. You receive LP tokens for your share; there are no personal price ranges or DLMM Spot, Curve and Bid-Ask presets.',
      details:'Both sides remain exposed to their own token prices. Check the pairing, transfer fees and executable swap costs; fees can be outweighed by changes in the value of your holdings.',
      caveat:'Program ownership and exact pool address checked. Token flags come from Raydium metadata, not a full token audit. This lookup does not prepare a position or verify stock backing.'};
  }
  const damm=owner===DAMM;
  const d=await request(`https://${damm?'damm-v2':'dlmm'}.datapi.meteora.ag/pools/${address}`);
  const p=d.address?d:d.data;
  if(p?.address!==address||!p.token_x?.address||!p.token_y?.address)throw Error('Meteora has not indexed this as a pool. It may be a position or another account type.');
  const config=p.pool_config;
  return {address,pair:p.token_x.symbol+'/'+p.token_y.symbol,type:damm?'Meteora DAMM v2':'Meteora DLMM',tokens:[p.token_x,p.token_y].map(t=>({address:t.address,symbol:t.symbol,name:t.name,freeze:t.freeze_authority_disabled===false})),fetchedAt,url:`https://app.meteora.ag/${damm?'dammv2':'dlmm'}/${address}`,
    explanation:damm?'DAMM v2 uses a pool-wide liquidity design, not personal DLMM bin shapes. Review its concentration, fees and locks.':'DLMM liquidity sits in price bins. Choose your price range and compare Spot, Curve and Bid-Ask distributions. Out-of-range liquidity does not earn swap fees.',
    details:damm?`${config?.concentrated_liquidity===true?'Concentrated pool range':config?.concentrated_liquidity===false?'Full-range pool':'Range type unavailable'}. ${config?.is_fee_scheduler_active===true?'Launch fee scheduler active.':config?.is_fee_scheduler_active===false?'No active launch fee scheduler reported.':'Fee-scheduler status unavailable.'}`:'Pool identity matters: the same token can trade in several pools with different fees and liquidity.',
    caveat:`${p.is_blacklisted===true?'Meteora flags this pool as blacklisted. ':''}Program ownership and exact pool address checked. Metadata is not a token audit; the lookup does not prepare a transaction.`};
}
