// Entirely invented test data. No owner wallets, transaction history, provider
// captures, or saved financial records are used. Canonical public mint/program
// constants below exist only to exercise identity and unit handling.
export const SOL='So11111111111111111111111111111111111111112';
export const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SYNTHETIC_MINT='11111111111111111111111111111112';
export const backyardVaults=Array.from({length:4},(_,i)=>({id:'synthetic-vault-'+i,name:'Synthetic vault '+i,inputTokenSymbol:'TEST',inputTokenMint:SYNTHETIC_MINT,inputTokenDecimals:6,assetPrice:1.02,apy:5.25+i,protocolTvlUsd:100000+i*1000,backyardTvlUsd:1000+i*100,isDepositDisabled:false,platformLabel:'Synthetic provider'}));
export const lidoRate={data:{smaApr:3.25,aprs:[{timeUnix:1767225600,apr:3.25}]}};
export const stakingRates={data:[{project:'jito-liquid-staking',chain:'Solana',symbol:'JITOSOL',apy:5.5,tvlUsd:100000},{project:'marinade-liquid-staking',chain:'Solana',symbol:'MSOL',apy:5.25,tvlUsd:200000},{project:'jupiter-staked-sol',chain:'Solana',symbol:'JUPSOL',apy:5.75,tvlUsd:150000}]};
export const pnlPositions=[
 {positionAddress:'synthetic-position-one',isClosed:false,allTimeDeposits:{total:{usd:'100'}},allTimeWithdrawals:{total:{usd:'10'}},allTimeFees:{total:{usd:'0'}},unrealizedPnl:{balances:92,unclaimedFeeTokenX:{usd:'1'},unclaimedFeeTokenY:{usd:'2'},unclaimedRewardTokenX:{usd:'0'},unclaimedRewardTokenY:{usd:'0'}},pnlUsd:'5'},
 {positionAddress:'synthetic-position-two',isClosed:false,allTimeDeposits:{total:{usd:'250'}},allTimeWithdrawals:{total:{usd:'30'}},allTimeFees:{total:{usd:'0'}},unrealizedPnl:{balances:210,unclaimedFeeTokenX:{usd:'3'},unclaimedFeeTokenY:{usd:'1'},unclaimedRewardTokenX:{usd:'0'},unclaimedRewardTokenY:{usd:'0'}},pnlUsd:'-6'},
];
const CPMM='CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const syntheticRay={id:'11111111111111111111111111111113',programId:CPMM,type:'Standard',mintA:{address:SOL,symbol:'SOL',name:'Wrapped SOL'},mintB:{address:USDC,symbol:'USDC',name:'USD Coin'},tvl:100000,day:{volume:200000,volumeFee:500},price:100,feeRate:.0025,openTime:1767225600};
export const raydiumCatalogue={data:{data:[syntheticRay]}};
export const orcaCatalogue={data:[{address:'11111111111111111111111111111114',tokenA:syntheticRay.mintA,tokenB:syntheticRay.mintB,tvlUsdc:200000,stats:{'24h':{volume:300000,fees:750,priceDelta:.01},'1h':{volume:10000,fees:25},'4h':{volume:40000,fees:100}},price:100,feeRate:2500,updatedAt:'2026-01-01T00:00:00Z'}]};
export const raydiumLookup={data:[{...syntheticRay,mintB:{address:SYNTHETIC_MINT,symbol:'TEST',name:'Synthetic fee token',tags:['hasTransferFee']}}]};
export const dammCatalogue={data:[{address:'11111111111111111111111111111115',token_x:{address:SYNTHETIC_MINT,symbol:'TEST',name:'Synthetic token',price:1,is_verified:false},token_y:{address:SOL,symbol:'SOL',name:'Wrapped SOL',price:100,is_verified:true},tvl:50000,current_price:.01,created_at:1767225600,volume:{'30m':1000,'1h':1800,'4h':6000,'12h':15000,'24h':30000},fees:{'30m':3,'1h':5.4,'4h':18,'12h':45,'24h':90},fee_tvl_ratio:{'1h':.0108,'4h':.036,'24h':.18},pool_config:{bin_step:0,base_fee_pct:.3,max_fee_pct:1,concentrated_liquidity:false,is_fee_scheduler_active:false,compounding_fee_pct:0},dynamic_fee_pct:0,is_blacklisted:false,tags:[]}],total:1,pages:1,current_page:1,page_size:100};
const wave={address:'SyntheticWaveMint',symbol:'WAVE',name:'Synthetic Wave'},gold={address:'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re',symbol:'GLDx',name:'Gold xStock'},sol={address:SOL,symbol:'SOL'},usdc={address:USDC,symbol:'USDC'};
const contextPool=(id,base,quote,tvlUsd,fetchedAt='2026-09-21T00:25:00Z')=>({id:'solana:'+id,address:id,chain:'solana',venue:'meteora-dlmm',pair:base.symbol+'/'+quote.symbol,base,quote,tvlUsd,volume24hUsd:100000,fees24hUsd:300,feeApr:1,feeTier:.003,priceUsd:1,priceQuote:.01,ageHours:48,fetchedAt,tags:[],activity:{volume30m:1000,volume1h:1500,fees1h:3}});
export const poolContextSnapshot={updatedAt:'2026-09-21T00:25:00Z',errors:{},pools:[contextPool('synthetic-wave-sol',wave,sol,50000),contextPool('synthetic-gold-wave',gold,wave,80000,'2026-09-21T00:00:00Z'),contextPool('synthetic-wave-usdc',wave,usdc,30000),contextPool('synthetic-copycat-sol',{address:'SyntheticCopycatMint',symbol:'LIKEWAVE'},sol,90000)]};
