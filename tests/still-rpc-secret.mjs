import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'still-rpc-secret-'));
const originalFetch = globalThis.fetch;
const privateRpc = 'https://private-rpc.example.invalid';
const publicRpc = 'https://solana.api.onfinality.io/public';
let ledgerEnv;
globalThis.__stillSecretLedger = env => {ledgerEnv = env;};
try {
  await build({stdin: {contents: `export {paperEnvironment, RangeInbox} from './src/worldsfair';
export {stillReadRpcUrl, stillReadEnvironment} from './src/still-rpc-env';
export {solanaBalances} from './src/sources/solana-balance';`, resolveDir: process.cwd()},
    outfile: join(dir, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', mainFields: ['main'],
    banner: {js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},
    plugins: [{name: 'observe-ledger-environment', setup(b) {
      b.onResolve({filter: /\/still-paper$/}, () => ({path: 'ledger', namespace: 'fixture'}));
      b.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: `export class StillPaperLedger {
constructor(ctx, env) {globalThis.__stillSecretLedger(env);} async alarm() {} }`, loader: 'js'}));
    }}]});
  const {paperEnvironment, RangeInbox, stillReadRpcUrl, stillReadEnvironment, solanaBalances} = await import(join(dir, 'test.mjs'));
  const env = {SOLANA_RPC: publicRpc, STILL_RPC_URL: privateRpc, LP_CACHE: {}, WALLETS: '', MIN_TVL_USD: '5000'};
  assert(stillReadRpcUrl(env) === privateRpc, 'Secret wins over configured public fallback');
  assert(stillReadRpcUrl({SOLANA_RPC: publicRpc}) === publicRpc, 'Missing secret preserves public selection');
  for (const invalid of ['', 'not-a-url', 'http://rpc.example.invalid'])
    assert.throws(() => stillReadRpcUrl({STILL_RPC_URL: invalid, SOLANA_RPC: publicRpc}), /Still read RPC configuration is unavailable/, 'Invalid present secret never selects public fallback');
  const safe = paperEnvironment(env);
  assert(safe.SOLANA_RPC === privateRpc && safe.STILL_RPC_URL === privateRpc, 'HTTP and scheduled environment preserve server-only selection');
  assert(env.SOLANA_RPC === publicRpc, 'Input environment remains unchanged');
  new RangeInbox({}, env);
  assert(ledgerEnv.SOLANA_RPC === privateRpc, 'Raw Durable Object binding selects the secret for alarms and paper actions');

  const targets = [];
  globalThis.fetch = async (url, init) => {
    targets.push(String(url));
    assert(String(url) === privateRpc, 'Still balance read uses only the configured private provider');
    assert.equal(init.redirect, 'manual');
    const req = JSON.parse(init.body);
    const result = req.method === 'getBalance' ? {value: 500000000} : {value: []};
    return Response.json({jsonrpc: '2.0', id: req.id, result});
  };
  const balances = await solanaBalances('11111111111111111111111111111111', publicRpc, stillReadEnvironment(env));
  assert.deepEqual(balances, {sol: .5, usdc: 0});
  assert.equal(targets.length, 2);
  targets.length = 0;
  globalThis.fetch = async url => {targets.push(String(url)); throw Error('Synthetic provider failure');};
  await assert.rejects(solanaBalances('11111111111111111111111111111111', publicRpc, stillReadEnvironment(env)), /Solana balance read unavailable/);
  assert(targets.length === 2 && targets.every(url => url === privateRpc), 'A failed private read never falls back to a public endpoint');
  console.log('PASS Still secret: HTTP, scheduler and Durable Object selection; missing-only fallback; private balance success and failure without endpoint disclosure');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__stillSecretLedger;
  await rm(dir, {recursive: true, force: true});
}
