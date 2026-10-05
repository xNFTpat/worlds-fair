# Still

**Clarity before capital.**

Still is a pre-flight check for Solana liquidity pools: understand net fee estimates, exit costs and downside before trying a range, then practise moving paper profits into baskets and yield estimates.

[Open the paper demo](https://lp-terminal-worldsfair.pat-862.workers.dev) · [Public GitHub repository](https://github.com/xNFTpat/worlds-fair) · [Technical guide and disclosure](WORLDSFAIR_README.md)

Paper money, real market observations, optional Solana **devnet** receipts. No mainnet transactions. Not financial advice.

## Try it

1. Open a pool and read its overall pre-flight verdict. Expand **Why?** for the evidence behind each check.
2. Use the suggested Bid-Ask range, or choose a floor and inspect the downside scenario. A suggestion appears only when its depth fits the 69-bin limit.
3. Add labelled **Paper SOL** to the Paper portfolio. Paper-buy a basket or save a paper staking/vault deposit.
4. Inspect the shared strategies. An eligible, profitable close can roll into your paper portfolio; a saved profit rule can split it between LP, a vault and a basket.
5. Optionally stamp a saved strategy open/close or your profit roll with Phantom on devnet. Each signature needs an explicit approval.

Missing quotes, stale prices and unscorable outcomes stay unavailable. A failed quote cannot spend paper funds.

## What runs where

| Component | Responsibility |
| --- | --- |
| HTML, CSS, JavaScript/TypeScript | Cream interface, pre-flight, range scenarios and paper controls |
| Cloudflare Worker | Read-only market APIs, strict demo boundary and anonymous paper sessions |
| Durable Objects | Serialized paper accounting, shared strategy journal, scanner and quote allowance |
| Dedicated Workers KV | Market caches and retryable copies of paper accounts, events and receipts |
| Meteora/Solana reads, Jupiter, Cesto, yield providers | Dated market, allocation and rate evidence |
| Phantom + Solana devnet | Optional Memo receipt; no token transfer |

The account cookie is random, Secure, HttpOnly and SameSite=Strict. The server derives its account key; balances are never accepted from browser storage. Clearing the cookie loses access to that browser's paper account. There is no login or recovery service.

Profit rolls debit the shared paper strategy and record the destination in one durable commit. A close can be claimed once across visitors. Retries reuse the same request ID. Provider calls finish before the commit, which rechecks balance, source state, quote expiry and the saved rule. Failed KV copies use an outbox rather than repeating a money move.

## Run locally

Use a current Node.js release, npm and the checked-in lockfiles. Validation uses Node 24.

```sh
git clone --branch worldsfair https://github.com/xNFTpat/worlds-fair.git
cd worlds-fair
npm ci
npm ci --prefix execution
npm run build
npm run dev
```

Open the local URL printed by Wrangler. Development uses `wrangler.worldsfair.toml` and emulated storage. The separate `execution/` dependency folder supplies inherited SDKs and the devnet client; installing it does not enable mainnet routes.

```sh
npm test
npm run check
npm run verify
```

`verify` also runs scanner, paper-ledger and devnet-receipt tests in the real local Worker runtime. Runtime tests need permission to bind a localhost port. Provider and signing fixtures are synthetic; they do not submit transactions.

## Data access

Jupiter quote and Price reads work without a key under a shared 30-request rolling-minute allowance. A dedicated `JUPITER_API_KEY` is optional for additional provider capacity; the application's conservative allowance still applies. Cached values retain their original dates. See [Jupiter's documented limits](https://developers.jup.ag/docs/portal/rate-limits).

`SOLANA_RPC` is a read-only market-data endpoint. A dedicated endpoint may improve availability. Keep optional local credentials in ignored `.dev.vars`, using the safe `.dev.vars.example`; never copy another deployment's secrets or commit them. No wallet private key is needed.

For the standard public Solana mainnet URL, bounded market reads can fall back to the documented [PublicNode endpoint](https://solana.publicnode.com/). Public responses must prove the mainnet genesis identity; existing mint-program, account and quote-age checks still apply. The adapter caches only immutable block timestamps, observes provider cooldowns, and never sends transactions. Custom/keyed RPC endpoints stay with their configured provider. Holder enumeration is unavailable on the shared fallback, and public services can still reject reads; missing evidence remains unavailable rather than passing a safety check.

## Deploy this demo safely

```sh
npm run verify
# Commit the reviewed source and generated browser assets.
npm run deploy
```

The guarded deployment script requires a clean `worldsfair` branch with the public repository as its origin, checks the dedicated demo configuration, builds a real Git version stamp, and deploys **only** with `--config wrangler.worldsfair.toml`. It records a deployment receipt in the demo's isolated KV namespace. Use the guarded command; do not substitute an unqualified Wrangler deployment.

This public repository excludes the original Worker's deployment configuration. The demo's `/api/version` and footer identify its deployed build. A demo link is not a claim that an uncommitted local change is already deployed.

## Honest limits

- A pre-flight pass is a screen against dated evidence, not a token audit or prediction. Fees and range scenarios are estimates; losses can exceed the illustrated floor case.
- Paper baskets record quoted token units, not Cesto wrapper ownership. Market marks exclude exit costs; absent prices never become zero.
- Vault/staking accrual is a linear estimate from original principal at the saved annual rate, even when the source labels it APY. Native SOL staking does not invent liquid-staking-token shares.
- Shared strategy capital is simulated. Seeded SOL is demo funding; retained LP contributions are not personal wallet equity.
- Devnet stamps preserve signed bytes for retries and verify the confirmed Memo. **A real Phantom signing session has not yet been manually exercised.** Web Locks, persistent browser storage and compatible Phantom support are required.
- The optional devnet SPL receipt token was cut. No custom on-chain vault, live basket deposit or mainnet money flow is included.

## Prior work and public history

Still builds on the owner's existing **private LP Terminal**. This public repository starts with a sanitized source snapshot and fresh Git history; its first commit is not a claim that every included component was written for this event. Personal wallet records, private archives, credentials and the original deployment configuration are excluded.

In the private source repository, both provenance tags point to `bccf1bb049dc58381a60b87356bde729a6b8fd06` (4 September 2026). Later working source lacked matching Git history. Its research, range mathematics, market integrations and strategy foundation are disclosed as **inherited**, and the available history cannot establish their exact relationship to the **14 September 2026, 14:00 UK** cutoff.

Clearly new work is identified by the **5 October 2026** task records in [WORLDSFAIR_CHANGELOG.md](WORLDSFAIR_CHANGELOG.md). Earlier task SHAs refer to the private development repository, not public commits in this fresh export. No historical commits or public baseline tags have been fabricated.

See [WORLDSFAIR_TODO.md](WORLDSFAIR_TODO.md) for the manual wallet check, recordings and submission work still outstanding.
