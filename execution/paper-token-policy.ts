import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getExtensionTypes,ExtensionType,getTransferFeeConfig,getEpochFee,type Mint} from '@solana/spl-token';
import type {PublicKey} from '@solana/web3.js';
import type {PaperTokenPolicy} from '../src/paper-model';

// Shared by all four paper styles. Never constructs a transaction or signer.
export function paperTokenPolicies(tokens:readonly {owner:PublicKey;mint:Mint}[],epoch:number,entry:boolean):PaperTokenPolicy[]{
  if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('Token fee epoch unavailable');
  return tokens.map(t=>{
    if(!t.owner.equals(TOKEN_PROGRAM_ID)&&!t.owner.equals(TOKEN_2022_PROGRAM_ID))throw Error('Unsupported token program');
    if(entry&&(t.mint.mintAuthority||t.mint.freezeAuthority))throw Error('Mint or freeze authority is active; paper entry excluded');
    if(t.owner.equals(TOKEN_2022_PROGRAM_ID)){
      const allowed=[ExtensionType.TransferFeeConfig,ExtensionType.MetadataPointer,ExtensionType.TokenMetadata];
      if(getExtensionTypes(t.mint.tlvData).some(e=>!allowed.includes(e)))throw Error('Token extension outside the paper accounting model');
    }
    const config=getTransferFeeConfig(t.mint),fee=config?getEpochFee(config,BigInt(epoch)):null;
    return {mint:t.mint.address.toBase58(),bps:fee?.transferFeeBasisPoints??0,maximumRaw:fee?.maximumFee.toString()??'0'};
  });
}
