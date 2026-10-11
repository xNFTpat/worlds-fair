import assert from 'node:assert/strict';
import {normalizeWalletAddress, connectPhantomAddress} from '../public/still-wallet-client.js';

const ADDRESS = 'So11111111111111111111111111111111111111112';
const SECOND_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
for (const address of [ADDRESS, SECOND_ADDRESS, '1'.repeat(32)]) {
  assert.equal(normalizeWalletAddress(address), address);
  assert.equal(normalizeWalletAddress(` \n${address}\t`), address);
}
for (const value of [null, undefined, 123, {}, [], '', '1'.repeat(31), '1'.repeat(33), 'z'.repeat(32), 'z'.repeat(44), '0'.repeat(32), 'O'.repeat(32), 'I'.repeat(32), 'l'.repeat(32), `${ADDRESS}x`, `${ADDRESS.slice(0, 10)} ${ADDRESS.slice(10)}`]) {
  assert.throws(() => normalizeWalletAddress(value), /valid Solana wallet address/);
}

let calls = 0;
let forbiddenReads = 0;
const provider = {
  isPhantom: true,
  async connect() {
    calls++;
    assert.equal(this, provider, 'Phantom retains its receiver');
    assert.equal(arguments.length, 0, 'Only a plain connection request is made');
    return {publicKey: {toBase58: () => ADDRESS}};
  },
};
for (const name of ['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage', 'request']) {
  Object.defineProperty(provider, name, {get() {forbiddenReads++; throw new Error('A read-only client must not touch this method');}});
}
assert.equal(await connectPhantomAddress(provider), ADDRESS);
assert.equal(calls, 1);
assert.equal(forbiddenReads, 0, 'No signing or generic request method is even accessed');

assert.equal(await connectPhantomAddress({isPhantom: true, connect: async () => undefined, publicKey: {toBase58: () => SECOND_ADDRESS}}), SECOND_ADDRESS, 'The provider public key is the fallback when connect returns none');
assert.equal(await connectPhantomAddress({isPhantom: true, connect: async () => ({publicKey: {toBase58: () => ADDRESS}}), publicKey: {toBase58: () => SECOND_ADDRESS}}), ADDRESS, 'The newly returned address takes precedence');
for (const value of [null, undefined, {}, {isPhantom: false, connect() {throw new Error('must not connect');}}, {isPhantom: true}]) {
  await assert.rejects(() => connectPhantomAddress(value), /Phantom isn't available.*Paste a wallet address/);
}
await assert.rejects(() => connectPhantomAddress({get isPhantom() {throw new Error('inaccessible provider');}}), /Paste a wallet address/);
for (const code of [4001, 'ACTION_REJECTED']) {
  await assert.rejects(() => connectPhantomAddress({isPhantom: true, connect: async () => {throw {code};}}), /Connection cancelled.*paste a wallet address/);
}
await assert.rejects(() => connectPhantomAddress({isPhantom: true, connect: async () => {throw new Error('internal details');}}), /Phantom couldn't connect.*paste a wallet address/);
for (const publicKey of [null, 'not a public key object', {}, {toBase58: () => 'z'.repeat(32)}, {toBase58: () => {throw new Error('unreadable');}}]) {
  await assert.rejects(() => connectPhantomAddress({isPhantom: true, connect: async () => ({publicKey})}), /public address couldn't be read.*Paste a wallet address/);
}
await assert.rejects(() => connectPhantomAddress({isPhantom: true, connect: async () => ({publicKey: {toBase58: () => 'invalid'}}), publicKey: {toBase58: () => ADDRESS}}), /public address couldn't be read/, 'An invalid returned key must not silently use a potentially stale provider address');

console.log('Still wallet client: strict decoded address length, public-key-only Phantom connection, untouched signing methods and calm paste-address fallbacks passed.');
