import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const dir = await mkdtemp(join(tmpdir(), 'still-costs-'));
const OriginalDate = Date, originalFetch = globalThis.fetch;
try {
  await build({entryPoints: ['src/still-costs.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'costs.mjs')});
  const {feeMessage, readStillNetwork, STILL_NETWORK_MAX_AGE_MS} = await import(pathToFileURL(join(dir, 'costs.mjs')));
  const now = Date.UTC(2026, 9, 11, 14), at = new Date(now).toISOString();
  globalThis.Date = class extends OriginalDate {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}};
  const blockhash = '11111111111111111111111111111111';
  for (const signatures of [1, 2]) {
    const bytes = Buffer.from(feeMessage(blockhash, signatures), 'base64');
    assert.deepEqual([...bytes.subarray(0, 4)], [signatures, 0, 0, signatures], 'explicit legacy message signature/account counts');
    assert.equal(bytes.length, 4 + 32 * signatures + 32 + 1);
    assert(bytes.subarray(4 + 32 * signatures, bytes.length - 1).every(v => v === 0), 'requested blockhash is serialized exactly');
    assert.equal(bytes.at(-1), 0, 'base-fee message contains no instructions');
  }
  assert.throws(() => feeMessage('0'.repeat(32), 1), /Invalid blockhash/);
  assert.throws(() => feeMessage('z'.repeat(50), 1), /Oversized blockhash/);

  let cached = null, writes = [], requests = [], httpCalls = 0, mode = 'success', cacheWriteFails = false;
  const env = {SOLANA_RPC: 'https://rpc.example.invalid', LP_CACHE: {
    async get() {return cached;},
    async put(key, value, options) {if (cacheWriteFails) throw Error('KV temporarily unavailable'); writes.push({key, value: JSON.parse(value), options});}
  }};
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), env.SOLANA_RPC, 'custom read provider remains the selected provider');
    assert.equal(init.method, 'POST');
    assert(init.signal instanceof AbortSignal, 'custom RPC calls receive an explicit abort signal');
    const body = JSON.parse(init.body), batch = Array.isArray(body), rows = batch ? body : [body]; httpCalls++;
    if (mode === 'http-error') return new Response('{}', {status: 503});
    const replies = rows.map(request => {
      requests.push(request);
      assert(['getLatestBlockhash', 'getFeeForMessage'].includes(request.method), 'no signing, simulation or transaction submission call');
      assert.equal(request.params.at(-1).commitment, 'confirmed');
      if (mode === 'rpc-error') return {jsonrpc: '2.0', id: request.id, error: {code: -32000, message: 'unavailable'}};
      if (request.method === 'getLatestBlockhash') return {jsonrpc: '2.0', id: request.id, result: {value: {blockhash: mode === 'bad-hash' ? 'invalid' : blockhash}}};
      const message = Buffer.from(request.params[0], 'base64'), signatures = message[0];
      assert([1, 2].includes(signatures)); assert.equal(message.at(-1), 0);
      const value = mode === 'null-fee' ? null : mode === 'negative-fee' ? -1 : mode === 'fractional-fee' ? 5000.5 : signatures * 5000;
      return {jsonrpc: '2.0', id: mode === 'duplicate-id' ? 1 : request.id, result: {value}};
    });
    return Response.json(batch ? replies.reverse() : replies[0]);
  };
  assert.equal(await readStillNetwork(env), null);
  assert.equal(requests.length, 0, 'cached-only path never sends an RPC request');
  const read = await readStillNetwork(env, true);
  assert.deepEqual({single: read?.singleLamports, double: read?.doubleLamports, asOf: read?.asOf}, {single: 5000, double: 10000, asOf: at});
  assert.deepEqual(requests.map(r => r.method), ['getLatestBlockhash', 'getFeeForMessage', 'getFeeForMessage']);
  assert.equal(writes.length, 1); assert.equal(writes[0].key, 'still:network-fees:v1'); assert.equal(writes[0].options.expirationTtl, 660); assert.equal(httpCalls, 2, 'both unsigned fee templates use one validated batch request');
  assert.match(read.source, /unsigned paper templates/);

  cached = read; requests = [];
  assert.deepEqual(await readStillNetwork(env, true), read);
  assert.equal(requests.length, 0, 'a fresh observed fee avoids another network call');
  cached = {...read, asOf: new Date(now - STILL_NETWORK_MAX_AGE_MS + 1).toISOString()};
  assert.deepEqual(await readStillNetwork(env, true), cached, 'ten-minute base-fee reuse retains the genuine source timestamp');
  assert.equal(requests.length, 0);
  cached = {...read, singleLamports: 0, doubleLamports: 0};
  assert.deepEqual(await readStillNetwork(env), cached, 'a genuinely observed zero is retained, not replaced by a default fee');
  for (const patch of [{asOf: new Date(now - STILL_NETWORK_MAX_AGE_MS - 1).toISOString()}, {asOf: new Date(now + 1).toISOString()}, {asOf: 'invalid'}, {singleLamports: -1}, {doubleLamports: 1.5}, {singleLamports: Number.MAX_SAFE_INTEGER + 1}]) {
    cached = {...read, ...patch}; assert.equal(await readStillNetwork(env), null, 'stale/future/invalid fee cache is not evidence');
  }
  cached = {...read, asOf: new Date(now - STILL_NETWORK_MAX_AGE_MS - 1).toISOString()}; requests = [];
  assert.equal((await readStillNetwork(env, true)).singleLamports, 5000);
  assert.equal(requests.length, 3, 'live reads replace stale fees with a fresh blockhash and message pricing');
  cached = null;
  for (const failure of ['http-error', 'rpc-error', 'bad-hash', 'null-fee', 'negative-fee', 'fractional-fee', 'duplicate-id']) {
    mode = failure; writes = [];
    assert.equal(await readStillNetwork(env, true), null, failure + ' is unavailable, never assumed fees');
    assert.equal(writes.length, 0, 'failed evidence is never cached');
  }
  mode = 'success'; cached = null; requests = []; httpCalls = 0;
  const concurrent = await Promise.all(Array.from({length: 5}, () => readStillNetwork(env, true)));
  assert.ok(concurrent.every(r => r?.singleLamports === 5000 && r?.doubleLamports === 10000));
  assert.equal(httpCalls, 2, 'concurrent pre-flights share one fee observation instead of flooding RPC');
  cacheWriteFails = true;
  assert.equal((await readStillNetwork(env, true))?.doubleLamports, 10000, 'a cache-write failure cannot erase successful RPC evidence');

  const legacyKey = 'research:v1:backoff:Solana RPC';
  const scopeKey = legacyKey + ':' + createHash('sha256').update(new URL(env.SOLANA_RPC).href).digest('hex').slice(0, 32);
  const records = new Map();
  const cooldownEnv = {...env, LP_CACHE: {
    async get(key) {return records.get(key) ?? null;},
    async put(key, value) {records.set(key, JSON.parse(value));}
  }};
  for (const key of [legacyKey, scopeKey]) {
    records.clear(); records.set(key, {until: now + 120000, attempts: 1, last429At: now});
    requests = []; httpCalls = 0;
    assert.equal(await readStillNetwork(cooldownEnv, true), null);
    assert.equal(httpCalls, 0, 'fee cache misses respect existing ' + key + ' cooldown');
    records.set('still:network-fees:v1', read);
    assert.deepEqual(await readStillNetwork(cooldownEnv, true), read, 'genuine dated fees remain usable during cooldown');
    assert.equal(httpCalls, 0);
  }
  records.clear(); httpCalls = 0;
  globalThis.fetch = async () => {httpCalls++; return new Response('{}', {status: 429, headers: {'retry-after': '120','x-still-rpc-failure':'json; rpc code -32005; rate-limit','authorization':'never-store-this'}});};
  assert.equal(await readStillNetwork(cooldownEnv, true), null);
  assert.equal(httpCalls, 1); assert.equal(records.get(scopeKey)?.until, now + 120000);
  assert.equal(records.get(scopeKey)?.diagnostic,'getLatestBlockhash','private provider headers cannot enter saved diagnostics');assert.doesNotMatch(records.get(scopeKey)?.diagnostic,/never-store-this|authorization/);
  assert.equal(await readStillNetwork({...cooldownEnv}, true), null);
  assert.equal(httpCalls, 1, 'a network 429 persists cooldown across independent fee read contexts');
  assert.equal(records.has('still:network-fees:v1'), false, 'rate limit is never stored as fee evidence');
  records.clear(); httpCalls = 0;
  globalThis.fetch = async (url, init) => {
    httpCalls++; const request = JSON.parse(init.body);
    assert.equal(request.method, 'getLatestBlockhash');
    records.set(scopeKey, {until: now + 120000, attempts: 1, last429At: now});
    return Response.json({jsonrpc: '2.0', id: request.id, result: {value: {blockhash}}});
  };
  assert.equal(await readStillNetwork(cooldownEnv, true), null);
  assert.equal(httpCalls, 1, 'a cooldown observed after blockhash suppresses the fee batch too');
  assert.equal(records.has('still:network-fees:v1'), false);
  console.log('Still costs: unsigned fee messages, read-only RPC methods, bounded custom requests, freshness, invalid provider data and best-effort caching passed');
} finally {
  globalThis.Date = OriginalDate; globalThis.fetch = originalFetch;
  await rm(dir, {recursive: true, force: true});
}
