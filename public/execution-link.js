(function(root){
  const poolId=value=>typeof value==='string'&&/^(solana:[1-9A-HJ-NP-Za-km-z]{32,44}|robinhood:0x[0-9a-fA-F]{40})$/.test(value);
  const positive=value=>typeof value==='string'&&value.length<=64&&/^\d*\.?\d+(?:e[+-]?\d+)?$/i.test(value)&&Number.isFinite(Number(value))&&Number(value)>0;
  function read(search){
    const q=new URLSearchParams(search),pool=q.get('compose');if(!poolId(pool))return null;
    const out={pool,draft:null},floor=q.get('floor'),ceiling=q.get('ceiling'),size=q.get('size');
    if(!floor&&!ceiling&&!size)return out;
    if(!positive(floor)||!positive(ceiling)||Number(ceiling)<=Number(floor)||!positive(size)||Number(size)>100)return null;
    const shape=q.get('shape');if(!['spot','curve','bid-ask'].includes(shape))return null;
    const mix=q.get('mix');if(!['sol-only','two-sided'].includes(mix)||!pool.startsWith('solana:'))return null;
    out.draft={lowerPriceSol:floor,upperPriceSol:ceiling,amountSol:size,strategy:shape,depositMode:mix};return out;
  }
  function build(pool,range){
    if(!poolId(pool))return null;
    const q=new URLSearchParams({compose:pool,floor:String(range.lowerPriceSol),ceiling:String(range.upperPriceSol),size:String(range.amountSol),shape:range.strategy,mix:range.depositMode});
    if(!read(q.toString())?.draft)return null;
    return '/?'+q.toString()+'#alpha';
  }
  function chartBounds(meta,native,range,family){
    if(!Number.isFinite(range.lower)||!Number.isFinite(range.upper)||range.lower<=0||range.upper<=range.lower)return null;
    const equal=(a,b)=>family==='solana'?a===b:typeof a==='string'&&a.toLowerCase()===String(b).toLowerCase();
    if(equal(meta.quoteAddress,native))return {...range};
    if(equal(meta.baseAddress,native)){const result={lower:1/range.upper,upper:1/range.lower};return [result.lower,result.upper].every(v=>Number.isFinite(v)&&v>0)?result:null;}
    return null;
  }
  root.LPExecutionLink={read,build,chartBounds};
})(globalThis);
