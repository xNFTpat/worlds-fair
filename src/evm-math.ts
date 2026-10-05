import Decimal from '../execution/node_modules/decimal.js';
import {keccak_256} from '../execution/node_modules/@noble/hashes/sha3';
import {secp256k1} from '../execution/node_modules/@noble/curves/secp256k1';
import type {UnsignedTx} from './executor';

const D=Decimal.clone({precision:90}),Q96=1n<<96n,MAX256=(1n<<256n)-1n;
export const EVM_CHAIN_ID=4663;
export const MIN_TICK=-887272,MAX_TICK=887272;
const address=/^0x[0-9a-fA-F]{40}$/;
export function evmAddress(value:unknown):string{if(typeof value!=='string'||!address.test(value))throw Error('Choose a valid EVM wallet or contract address.');return value.toLowerCase();}
export function parseUnits(value:unknown,decimals:number):bigint{
 if(typeof value!=='string'||value.length>100||!Number.isInteger(decimals)||decimals<0||decimals>18||!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))throw Error('Enter an exact decimal amount.');
 const [whole,fraction='']=value.split('.');if(fraction.length>decimals)throw Error('Amount exceeds the token decimal precision.');
 const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');if(result>MAX256)throw Error('Amount is too large.');return result;
}
export function formatUnits(value:bigint,decimals=18):string{const scale=10n**BigInt(decimals),fraction=(value%scale).toString().padStart(decimals,'0').replace(/0+$/,'');return (value/scale).toString()+(fraction?'.'+fraction:'');}
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
// Integer TickMath from Uniswap v3-sdk (MIT), getSqrtRatioAtTick; original:
// https://github.com/Uniswap/v3-sdk/blob/main/src/utils/tickMath.ts
// Copyright 2021 Uniswap Labs. MIT license: public/vendor/uniswap-v3-sdk-LICENSE.txt.
const multipliers=['fffcb933bd6fad37aa2d162d1a594001','fff97272373d413259a46990580e213a','fff2e50f5f656932ef12357cf3c7fdcc','ffe5caca7e10e4e61c3624eaa0941cd0','ffcb9843d60f6159c9db58835c926644','ff973b41fa98c081472e6896dfb254c0','ff2ea16466c96a3843ec78b326b52861','fe5dee046a99a2a811c461f1969c3053','fcbe86c7900a88aedcffc83b479aa3a4','f987a7253ac413176f2b074cf7815e54','f3392b0822b70005940c7a398e4b70f3','e7159475a2c29b7443b29c7fa6e889d9','d097f3bdfd2022b8845ad8f792aa5825','a9f746462d870fdf8a65dc1f90e061e5','70d869a156d2a1b890bb3df62baf32f7','31be135f97d08fd981231505542fcfa6','9aa508b5b7a84e1c677de54f3e99bc9','5d6af8dedb81196699c329225ee604','2216e584f5fa1ea926041bedfe98','48a170391f7dc42444e8fa2'].map(x=>BigInt('0x'+x));
export function sqrtRatioAtTick(tick:number):bigint{
 if(!Number.isInteger(tick)||tick<MIN_TICK||tick>MAX_TICK)throw Error('Range is outside Uniswap protocol tick bounds.');
 const abs=Math.abs(tick);let ratio=1n<<128n;for(let i=0;i<multipliers.length;i++)if(abs&(1<<i))ratio=ratio*multipliers[i]>>128n;if(tick>0)ratio=MAX256/ratio;return ceil(ratio,1n<<32n);
}
function humanPriceAtTick(tick:number,wethIs0:boolean,decimals:number):Decimal{
 const sqrt=new D(sqrtRatioAtTick(tick).toString()),raw=sqrt.mul(sqrt).div(new D(Q96.toString()).pow(2)),scale=new D(10).pow(decimals-18);
 return wethIs0?scale.div(raw):raw.mul(scale);
}
export function v3ExplicitRange(lower:string,upper:string,wethIs0:boolean,decimals:number,spacing:number){
 if(!Number.isInteger(spacing)||spacing<1||spacing>16384||[lower,upper].some(x=>typeof x!=='string'||x.length>100||!/^(0|[1-9]\d*)(\.\d+)?$/.test(x)))throw Error('Enter positive ETH per token bounds and a valid pool tick spacing.');
 const lo=new D(lower),hi=new D(upper);if(!lo.isPositive()||!hi.gt(lo))throw Error('Upper ETH per token price must exceed the positive lower price.');
 const raw=(p:Decimal)=>wethIs0?new D(10).pow(decimals-18).div(p):p.mul(new D(10).pow(18-decimals));
 const a=raw(wethIs0?hi:lo),b=raw(wethIs0?lo:hi),targetA=a.sqrt().mul(Q96.toString()),targetB=b.sqrt().mul(Q96.toString());
 if(targetA.lt(sqrtRatioAtTick(MIN_TICK).toString())||targetB.gt(sqrtRatioAtTick(MAX_TICK).toString()))throw Error('Requested range crosses native Uniswap tick bounds.');
 const tickFloor=(target:Decimal)=>{let l=MIN_TICK,r=MAX_TICK;while(l<r){const m=Math.ceil((l+r)/2);if(new D(sqrtRatioAtTick(m).toString()).lte(target))l=m;else r=m-1;}return l;};
 const tickLower=Math.floor(tickFloor(targetA)/spacing)*spacing;let tickUpper=Math.ceil(tickFloor(targetB)/spacing)*spacing;
 if(tickUpper>=MIN_TICK&&tickUpper<=MAX_TICK&&new D(sqrtRatioAtTick(tickUpper).toString()).lt(targetB))tickUpper+=spacing;
 if(tickLower<MIN_TICK||tickUpper>MAX_TICK||tickLower>=tickUpper)throw Error('Snapped range crosses native Uniswap tick bounds.');
 const nativeLow=humanPriceAtTick(wethIs0?tickUpper:tickLower,wethIs0,decimals),nativeHigh=humanPriceAtTick(wethIs0?tickLower:tickUpper,wethIs0,decimals);
 return {tickLower,tickUpper,priceLowerEth:nativeLow.toSignificantDigits(30).toString(),priceUpperEth:nativeHigh.toSignificantDigits(30).toString(),requestedLowerEth:lower,requestedUpperEth:upper,spacing};
}
export function v3Amounts(sqrtP:bigint,tickLower:number,tickUpper:number,budget0:bigint,budget1:bigint){
 const a=sqrtRatioAtTick(tickLower),b=sqrtRatioAtTick(tickUpper);if(a>=b||sqrtP<=0n||budget0<0n||budget1<0n)throw Error('Invalid liquidity allocation.');
 const liquidity0=(p:bigint)=>budget0*(p*b/Q96)/(b-p),liquidity1=(p:bigint)=>budget1*Q96/(p-a);
 const l=sqrtP<=a?liquidity0(a):sqrtP>=b?liquidity1(b):(()=>{const l0=liquidity0(sqrtP),l1=liquidity1(sqrtP);return l0<l1?l0:l1;})();
 if(l<=0n||l>(1n<<128n)-1n)throw Error('Budgets cannot fund positive liquidity in this range. Supply the required side of the pair.');
 const p=sqrtP<a?a:sqrtP>b?b:sqrtP,amount0=p<b?ceil(l*(b-p)*Q96,p*b):0n,amount1=p>a?ceil(l*(p-a),Q96):0n;
 if(amount0>budget0||amount1>budget1)throw Error('Rounded allocation exceeds the explicit token budget.');
 return {liquidity:l,amount0,amount1};
}

export const hexBytes=(hex:string)=>{if(!/^0x([0-9a-fA-F]{2})*$/.test(hex))throw Error('Expected canonical hexadecimal bytes.');return Uint8Array.from(hex.slice(2).match(/../g)||[],x=>parseInt(x,16));};
export const bytesHex=(bytes:Uint8Array)=>'0x'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
type Rlp=Uint8Array|Rlp[];
const concat=(parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;};
const integer=(n:bigint)=>n===0n?new Uint8Array():hexBytes('0x'+n.toString(16).padStart(Math.ceil(n.toString(16).length/2)*2,'0'));
export function rlpEncode(value:Rlp):Uint8Array{
 const list=Array.isArray(value),data=list?concat(value.map(rlpEncode)):value as Uint8Array;if(!list&&data.length===1&&data[0]<128)return data;
 const base=list?192:128;return concat(data.length<56?[Uint8Array.of(base+data.length),data]:[Uint8Array.of(base+55+integer(BigInt(data.length)).length),integer(BigInt(data.length)),data]);
}
function rlpDecode(bytes:Uint8Array):Rlp{
 let at=0;const parse=(depth:number):Rlp=>{if(depth>4||at>=bytes.length)throw Error('Malformed transaction RLP.');const first=bytes[at++];if(first<128)return Uint8Array.of(first);const list=first>=192,base=list?192:128;let length=first-base;
  if(length>55){const n=length-55;if(n<1||n>4||at+n>bytes.length||bytes[at]===0)throw Error('Noncanonical RLP length.');length=Number(BigInt(bytesHex(bytes.slice(at,at+n))));at+=n;if(length<56)throw Error('Noncanonical RLP length.');}
  const end=at+length;if(end>bytes.length)throw Error('Truncated transaction RLP.');if(!list){const result=bytes.slice(at,end);at=end;if(result.length===1&&result[0]<128)throw Error('Noncanonical RLP byte.');return result;}
  const result:Rlp[]=[];while(at<end)result.push(parse(depth+1));if(at!==end)throw Error('Malformed RLP list.');return result;
 };const result=parse(0);if(at!==bytes.length)throw Error('Trailing transaction bytes.');return result;
}
const txInteger=(value:string|number)=>{const n=typeof value==='number'?BigInt(value):BigInt(value);if(n<0n||n>MAX256)throw Error('Transaction integer is invalid.');return integer(n);};
export function unsignedEvmFields(tx:UnsignedTx):Rlp[]{if(tx.chainId!==EVM_CHAIN_ID||tx.type!=='0x2'||!Number.isSafeInteger(tx.nonce)||tx.nonce<0)throw Error('Only Robinhood EIP-1559 transactions are supported.');return [txInteger(tx.chainId),txInteger(tx.nonce),txInteger(tx.maxPriorityFeePerGas),txInteger(tx.maxFeePerGas),txInteger(tx.gas),hexBytes(evmAddress(tx.to)),txInteger(tx.value),hexBytes(tx.data),[]];}
export function evmSigningHash(tx:UnsignedTx):Uint8Array{return keccak_256(concat([Uint8Array.of(2),rlpEncode(unsignedEvmFields(tx))]));}
export function verifySignedEvmTransaction(raw:string,tx:UnsignedTx,owner=tx.from):{signedTransactionHex:string;txHash:string}{
 if(raw.length>20000)throw Error('Signed transaction is too large.');const bytes=hexBytes(raw);if(bytes[0]!==2)throw Error('Only a reviewed EIP-1559 transaction can be sent.');const fields=rlpDecode(bytes.slice(1));
 if(!Array.isArray(fields)||fields.length!==12||!Array.isArray(fields[8])||fields[8].length)throw Error('Signed transaction has unsupported fields.');
 if(bytesHex(rlpEncode(fields.slice(0,9)))!==bytesHex(rlpEncode(unsignedEvmFields(tx))))throw Error('Signed transaction differs from the reviewed transaction.');
 const scalar=(i:number)=>{const value=fields[i];if(Array.isArray(value)||value.length>32||value.length&&value[0]===0)throw Error('Noncanonical signature scalar.');return value.length?BigInt(bytesHex(value)):0n;};
 const y=Number(scalar(9)),r=scalar(10),s=scalar(11);if(![0,1].includes(y))throw Error('Invalid signature recovery parity.');
 const signature=new secp256k1.Signature(r,s,y);if(signature.hasHighS())throw Error('Noncanonical high-S signature.');const publicKey=signature.recoverPublicKey(evmSigningHash(tx)).toRawBytes(false),recovered=bytesHex(keccak_256(publicKey.slice(1)).slice(-20));
 if(recovered!==evmAddress(owner)||recovered!==evmAddress(tx.from))throw Error('Signature belongs to a different wallet.');
 return {signedTransactionHex:bytesHex(bytes),txHash:bytesHex(keccak_256(bytes))};
}
export function signedEvmTransaction(tx:UnsignedTx,result:any,owner=tx.from){
 // A wallet-sign response must explicitly supply a signed transaction. Never
 // treat a generic signature, request ID or other hexadecimal value as a tx.
 // PayBox's official iframe v183 transaction artifact uses this exact field.
 const raw=result?.output?.value?.serializedTransaction;
 if(typeof raw!=='string')throw Error('PayBox did not return a documented signed EVM transaction artifact.');return verifySignedEvmTransaction(raw,tx,owner);
}
