// Decode only the ABI shapes returned by NPM multicall; amounts stay integers.
export function decodeMulticall(result: string): string[] {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) throw new Error('Invalid simulation response');
  const data = result.slice(2);
  const word = (byte: number): bigint => {
    if (!Number.isSafeInteger(byte) || byte < 0 || (byte + 32) * 2 > data.length) throw new Error('Truncated simulation response');
    return BigInt('0x' + data.slice(byte * 2, (byte + 32) * 2));
  };
  const start = Number(word(0));
  const count = Number(word(start));
  if (!Number.isSafeInteger(count) || count > 16) throw new Error('Unexpected simulation result count');
  return Array.from({length: count}, (_, i) => {
    const at = start + 32 + Number(word(start + 32 + i * 32));
    const length = Number(word(at));
    if (!Number.isSafeInteger(length) || length < 0 || (at + 32 + length) * 2 > data.length) throw new Error('Truncated simulation result');
    return data.slice((at + 32) * 2, (at + 32 + length) * 2);
  });
}
export function rawPair(data: string): [bigint, bigint] {
  if (!/^[0-9a-fA-F]{128}$/.test(data)) throw new Error('Unexpected withdrawal result');
  return [BigInt('0x' + data.slice(0,64)), BigInt('0x' + data.slice(64))];
}
export function units(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || raw < 0n) throw new Error('Invalid token amount');
  if (!decimals) return raw.toString();
  const s = raw.toString().padStart(decimals + 1,'0');
  return (s.slice(0,-decimals) + '.' + s.slice(-decimals)).replace(/\.?0+$/, '') || '0';
}
