import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'exit-review-'));
await build({entryPoints:['src/executor.ts','src/exit-review.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const {units,decodeMulticall,rawPair}=await import(join(dir,'exit-review.mjs'));
const {previewCloseV3,buildCloseV3,RH}=await import(join(dir,'executor.mjs'));
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const address=a=>a.slice(2).padStart(64,'0');
const abi=parts=>{let offset=parts.length*32; const heads=parts.map(p=>{const h=word(offset);offset+=32+Math.ceil(p.length/64)*32;return h;});return '0x'+word(32)+word(parts.length)+heads.join('')+parts.map(p=>word(p.length/2)+p.padEnd(Math.ceil(p.length/64)*64,'0')).join('');};
assert.equal(units(100000000000000000000n,18),'100');
assert.equal(units(1n,18),'0.000000000000000001');
assert.equal(units(9007199254740993123456n,6),'9007199254740993.123456');
assert.equal(units(0n,18),'0');
assert.deepEqual(rawPair(decodeMulticall(abi([word(1)+word(2),'']))[0]),[1n,2n]);
assert.throws(()=>decodeMulticall('0x00'));
assert.throws(()=>decodeMulticall('0x'+word(32)+word(100)));
assert.throws(()=>rawPair('00'));
const wallet='0x'+'a'.repeat(40), token='0x'+'b'.repeat(40);
let wrongOwner=false, unsupported=false, reverse=false, failSimulation=false;
const original=globalThis.fetch;
globalThis.fetch=async (_url,options)=>{
 const {method,params}=JSON.parse(options.body);let result;
 if(method==='eth_blockNumber')result='0x123';
 else if(method==='eth_getBalance')result='0x1000000000000000';
 else if(method==='eth_getTransactionCount')result='0x0';
 else if(method==='eth_gasPrice')result='0x64';
 else if(method==='eth_estimateGas')result='0x186a0';
 else if(method==='eth_call'){
  const d=params[0].data,sel=d.slice(0,10);
  if(sel==='0x6352211e')result='0x'+address(wrongOwner?token:wallet);
  else if(sel==='0x99fbab88')result='0x'+[word(0),word(0),address(reverse?token:unsupported?wallet:RH.weth),address(reverse?RH.weth:token),word(10000),word((1n<<256n)-100n),word(100),word(1000000),word(0),word(0),word(0),word(0)].join('');
  else if(sel==='0x1698ee82')result='0x'+address(token);
  else if(sel==='0x3850c7bd')result='0x'+word(1n<<96n)+word(0);
  else if(sel==='0x313ce567')result='0x'+word(6);
  else if(sel==='0x95d89b41')result='0x'+word(32)+word(2)+'4149'.padEnd(64,'0');
  else if(sel==='0xac9650d8'){
   if(failSimulation)return new Response(JSON.stringify({error:{message:'execution reverted'}}));
   const amounts=reverse?[123456789n,1000000000000001n]:[1000000000000001n,123456789n];
   result=abi([word(5)+word(6),amounts.map(word).join(''),'','','']);
  }else throw Error('Unexpected call '+sel);
 }else throw Error('Unexpected method '+method);
 return new Response(JSON.stringify({result}));
};
try {
 for(reverse of [false,true]){
  const p=await previewCloseV3(123n,wallet);
  assert.equal(p.proceeds.eth,'0.001000000000000001');
  assert.equal(p.proceeds.token.amount,'123.456789');
  assert.equal(p.proceeds.token.address,token);
  assert.equal(p.canCoverGas,true);
  assert.equal(p.transactionCount,1);
  assert.equal(p.tx,undefined,'public preview must not expose a signable plan');
 }
 reverse=false;wrongOwner=true;
 await assert.rejects(()=>buildCloseV3(123n,wallet),/does not own/);
 wrongOwner=false;unsupported=true;
 await assert.rejects(()=>buildCloseV3(123n,wallet),/WETH-paired/);
 unsupported=false;failSimulation=true;
 await assert.rejects(()=>previewCloseV3(123n,wallet),/reverted/);
 await assert.rejects(()=>buildCloseV3(123n,wallet,NaN),/Invalid/);
}finally{globalThis.fetch=original;}
console.log('PASS: precise exit amounts, both token orientations, full simulation, malformed data, owner and pair checks, simulation failure');
