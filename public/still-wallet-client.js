const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const invalidAddress = () => new Error('Enter a valid Solana wallet address.');

/** Public addresses only. Validate the decoded length, not just its spelling. */
export function normalizeWalletAddress(value) {
  if (typeof value !== 'string') throw invalidAddress();
  const address = value.trim();
  if (address.length < 32 || address.length > 44) throw invalidAddress();
  let decoded = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw invalidAddress();
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  for (let number = decoded; number > 0n; number >>= 8n) bytes++;
  for (const character of address) {
    if (character !== '1') break;
    bytes++;
  }
  if (bytes !== 32) throw invalidAddress();
  return address;
}

/** Connecting asks Phantom only for its public address. Nothing is persisted. */
export async function connectPhantomAddress(provider) {
  try {
    if (!provider || provider.isPhantom !== true || typeof provider.connect !== 'function') {
      throw new Error('unavailable');
    }
  } catch {
    throw new Error("Phantom isn't available here. Paste a wallet address to continue.");
  }

  let connection;
  try {
    connection = await provider.connect();
  } catch (error) {
    if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') {
      throw new Error('Connection cancelled. You can paste a wallet address instead.');
    }
    throw new Error("Phantom couldn't connect. You can paste a wallet address instead.");
  }

  try {
    const publicKey = connection?.publicKey ?? provider.publicKey;
    if (!publicKey || typeof publicKey.toBase58 !== 'function') throw invalidAddress();
    return normalizeWalletAddress(publicKey.toBase58());
  } catch {
    throw new Error("Phantom connected, but its public address couldn't be read. Paste a wallet address to continue.");
  }
}
