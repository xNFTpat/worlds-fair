// Address derivation only; never creates a transaction or accesses a wallet.
import {ed25519} from '@noble/curves/ed25519';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function stillAddressBytes(address:string):Uint8Array {
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))throw Error('Invalid account address');
 let n=0n;for(const c of address)n=n*58n+BigInt(alphabet.indexOf(c));
 const bytes=new Uint8Array(32);for(let i=31;i>=0;i--){bytes[i]=Number(n&255n);n>>=8n;}
 if(n||stillAddressString(bytes)!==address)throw Error('Invalid account address');return bytes;
}
export function stillAddressString(bytes:Uint8Array){let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}let zeros=0;while(zeros<bytes.length&&bytes[zeros]===0)zeros++;return '1'.repeat(zeros)+out;}
const encoder=new TextEncoder();
export async function stillProgramAddress(seeds:Uint8Array[],program:string){
 for(let bump=255;bump>=0;bump--){
  const bytes=new Uint8Array([...seeds.flatMap(s=>[...s]),bump,...stillAddressBytes(program),...encoder.encode('ProgramDerivedAddress')]);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  try{ed25519.ExtendedPoint.fromHex(digest);}catch{return stillAddressString(digest);}
 }
 throw Error('Account address unavailable');
}
export async function stillBinArrayAddress(pool:string,index:number,program:string){const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigInt64(0,BigInt(index),true);return stillProgramAddress([encoder.encode('bin_array'),stillAddressBytes(pool),bytes],program);}
export async function stillBitmapAddress(pool:string,program:string){return stillProgramAddress([encoder.encode('bitmap'),stillAddressBytes(pool)],program);}
