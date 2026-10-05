# Still · World's Fair technical guide

**Clarity before capital.** Still helps people inspect Solana LP costs, downside and evidence, then practise with a paper portfolio. The [public README](README.md) is the short introduction and quick start.

- Demo: [lp-terminal-worldsfair.pat-862.workers.dev](https://lp-terminal-worldsfair.pat-862.workers.dev)
- Public repository: [xNFTpat/worlds-fair](https://github.com/xNFTpat/worlds-fair)
- Entry point: `src/worldsfair.ts`; deployment configuration: `wrangler.worldsfair.toml`
- Storage: a dedicated `LP_CACHE` KV namespace and the demo's `RangeInbox` / `BackgroundScanner` Durable Objects
- Publication: sanitized source snapshot with fresh Git history; the original LP Terminal repository remains private

## Boundary and deployment

The Worker permits an explicit set of market-read endpoints and the paper-account API. Mainnet transaction and signing routes and legacy signing assets are denied before provider or storage work. Robinhood reference data is hidden by default and can be shown through the read-only toggle. Personal archive assets are excluded and blocked. The environment passed to inherited code omits execution bindings and owner credentials; `WALLETS` is empty in the demo configuration.

Solana mainnet RPC is used for **market reads**, including mint metadata and block times. The optional Memo flow is pinned separately to **devnet**. External provider links are not in-app deposits or transaction integrations.

Use `npm run deploy`, which invokes `scripts/deploy-worldsfair.mjs`. The guard requires a clean `worldsfair` branch and the exact public repository origin, checks the dedicated demo configuration and isolated cache, verifies a real Git build identity and deploys using the explicit demo configuration. It records the deployment receipt in isolated KV. The original deployment configuration is not included in this public repository. Never substitute an unqualified Wrangler deployment.

The demo is the `lp-terminal-worldsfair` Worker. This release path does not deploy the original `lp-agg` Worker. Current live version checks belong in the release record; this document does not substitute an old version identifier for a fresh check. A source change is not live merely because tests pass.

## Architecture

```text
Browser: research views / paper controls
    │ same-origin HTTPS + anonymous HttpOnly cookie
    ▼
Demo Worker: route allowlist + bounded JSON
    ├── market reads and dated KV caches
    ├── shared Jupiter request-budget Durable Object
    └── shared fleet Durable Object
          ├── private per-browser account, history and request receipts
          ├── shared strategy cash and globally claimed close records
          └── atomic durable writes + retryable KV outbox

Explicit stamp consent → Phantom signs fixed Memo → devnet only
    └── Worker verifies confirmed devnet transaction → separate receipt journal
```

The stack is Cloudflare Workers, SQLite-backed Durable Objects, Workers KV, TypeScript, esbuild and browser HTML/CSS/JavaScript. Inherited Meteora/Solana SDKs support market and range calculations. There is no new custom Anchor program.

## Pre-flight and range exploration

The drawer presents an overall Pass/Caution/Fail verdict and eight explainable checks: fee proxy after costs, exit/round-trip cost, floor scenario, Token-2022 transfer-fee policy, sampled non-pool concentration, age/launch spike, floor distance and fee trend. Thresholds live in `public/worldsfair-thresholds.js`; scoring lives in `public/worldsfair-preflight.js`.

Suggested Bid-Ask ranges target roughly 45–50% depth with at most 69 native bins. If a pool's bin step cannot satisfy both, the interface explains the limit. Missing, stale, partial or assumed inputs cannot silently become verified passing evidence. The illustrated floor is a scenario, not a maximum-loss guarantee.

The last-ten Skipped log is local browser research history with reason chips. It is separate from the server-owned paper ledger.

## Anonymous paper accounts

The first account/history/stamp read creates a random 256-bit `__Host-worldsfair-paper` cookie with Secure, HttpOnly and SameSite=Strict flags. The server hashes it to select the account; the raw token and internal account key are not sent in JSON. Mutation routes require the same origin, JSON input and a bounded body. Callers cannot select another account with a header.

There is no cross-device identity, login or account recovery. Clearing the cookie loses access to its pot. The browser keeps retry identifiers for paper actions, not authoritative balances or holdings. A reused request ID with a different action fingerprint returns a conflict; a valid replay returns the committed receipt.

SOL accounting uses integer lamports. Seed and purchase inputs permit at most nine decimal places and 1,000 SOL per action; account seed/balance caps are 1,000,000 SOL. Accounts hold at most 40 holdings, with additional 104,000-byte state and 120,000-byte outbox caps. History is paginated in groups of 30. Reaching a limit rejects the new operation before its money mutation.

The per-browser pot and shared strategy ledger use the same Durable Object. A transfer commits the source cash debit, destination state, timestamped event, global close claim, idempotency receipt and KV outbox together. Provider reads run outside the serialization guard; the final commit rechecks all assumptions. A KV outage cannot double a transfer: the durable journal is authoritative and the outbox retries its copy.

## Profit rolls and allocation rules

Only immutable, scored, profitable closes from the funded **paper** fleet qualify. Independent research samples cannot mint pot credit. Fresh, available source cash must cover the withdrawal; a stale or reinvested source rejects the move. Each close can be claimed once across all visitors because the strategy bankroll is shared.

With the rule disabled, the slider defaults to 50%: that portion enters idle pot cash and the remainder stays in the strategy. With an enabled rule, the entire verified profit is split between LP, one selected yield idea and one basket. Percentages are integers summing to 100; largest-remainder allocation conserves exact lamports. Every positive destination must succeed before any source debit or claim. A 100% LP rule needs no quotes and retains the whole profit.

Withdrawals are separate from trading P&L. Performance equity and the peak/drawdown calculation account for the transfer, so moving profit does not fabricate a loss or reset the risk guard. Capital history shows idle SOL and contributed principal; retained LP contributions remain in the shared fleet and are not current personally owned LP equity.

## Basket and vault evidence

Paper basket purchases verify a complete, active Cesto allocation and split SOL by weight. Every non-SOL leg needs an exact-input Jupiter quote and independently checked mint decimals; SOL legs stay in SOL. Up to 12 unique legs are supported. Quote context slots must resolve to blocks no older than 45 seconds, and the earliest verified quote determines expiry. The commit rechecks expiry. Holdings represent quoted token units, not Cesto wrapper shares. Quote-reported fees are included; network costs, later slippage, wrapper fees and automatic rebalancing are excluded.

Jupiter Price v3 marks use verified block times, not token metadata creation dates. A mark older than five minutes or lacking matching units stays unavailable. Missing legs never become zero-valued assets. SOL P&L compares against original SOL principal. USD outperformance versus holding SOL uses the same current SOL price; absolute USD P&L additionally needs the saved entry SOL price.

Paper yield deposits use a current provider rate and an explicitly supported deposit asset. Native SOL staking models underlying SOL without fabricated liquid-staking-token units. Non-SOL vault assets require verified conversion quotes. The record retains the APY/APR label, annual percentage and read time; source publication time stays null when unavailable. Accrual is a **linear estimate at the saved rate** from original principal over a 365-day year, even for an APY-labelled source. It does not predict compounding, future rates, withdrawal liquidity, asset prices or provider losses.

## Public data and request limits

Jupiter documents keyless `api.jup.ag` access at 30 requests in a rolling 60-second window, shared by Swap and Price. Quote and Price endpoints were checked without a key. A dedicated `JUPITER_API_KEY` is optional for additional provider capacity; the application retains its conservative shared cap unless deliberately changed. See the official [plans](https://developers.jup.ag/docs/portal/plans) and [rate limits](https://developers.jup.ag/docs/portal/rate-limits).

One durable singleton controls new Jupiter research/paper reads across isolates and visitors. It stores recent reservations, rejects excess requests and honors cooldowns. Upgrades from the earlier token-bucket format conservatively reserve a window because remaining tokens cannot reconstruct prior usage. Missing budget bindings or storage failures fail closed.

Paper-source caches last 15 seconds for quotes and 30 seconds for prices. Hits still verify original block evidence and never renew its age. Research has a separate 45-second quote lifetime, ten-minute dated economic estimates and labelled retention up to one hour. Retained estimates are not executable quotes. Provider requests and concurrency are bounded; exhaustion means unavailable data or a retry, not invented prices.

Optional local credentials belong only in ignored `.dev.vars`. The safe `.dev.vars.example` has no owner credential. A dedicated read-only `SOLANA_RPC` may improve reliability. Do not copy another Worker's credentials or supply wallet private keys. Configure an optional demo-only Jupiter key with `npx wrangler secret put JUPITER_API_KEY --config wrangler.worldsfair.toml`.

`src/solana-read-rpc.ts` provides one fixed, documented [PublicNode mainnet fallback](https://solana.publicnode.com/) for the exact public Solana Labs URLs. Custom URLs, query credentials and authentication headers never cross providers. A strict method allowlist excludes all signing and transaction submission. The public adapter verifies the mainnet genesis hash, limits concurrent reads and HTTP attempts, retains caller deadlines, and observes failure/429 cooldowns. A 429 does not trigger provider hopping. Its bounded 60-second cache stores only positive immutable block timestamps, preserving their original values; account balances, authorities and pool anchors are not cached there. Existing 45-second quote and five-minute valuation limits remain unchanged.

Shared PublicNode holder enumeration is deliberately unavailable after probe rejection; independent mint/epoch reads can still succeed and holder checks stay cautious. Public services offer no availability guarantee. On 5 October 2026, local Worker probes verified SOL/USDC mint units and a block timestamp, but a real Cesto basket preparation was safely rejected by an HTTP 403 during its multi-mint read. No purchase, ledger debit or transaction resulted. This is provider-read evidence, not a claim that the full live basket journey has passed.

## Optional devnet Memo receipts

Stamp controls apply to authoritative saved shared-strategy opens/closes and this browser's saved profit rolls. Shared strategy stamps explicitly describe an observation. Preparing or confirming a stamp does not change paper cash, holdings, claims or revisions, and a failed stamp does not undo the paper action.

The browser separately asks to connect Phantom and sign the reviewed Memo. The transaction contains only a fixed 100,000-unit compute limit, zero priority-fee instruction and Memo signed by the fee payer. The Memo includes the paper/devnet label, event kind and SHA-256 evidence hash, without the account token or raw trade identifier. Devnet SOL pays the network fee.

The browser verifies Phantom returned the reviewed message, saves signed bytes before sending, checks the devnet genesis hash and broadcasts only to the fixed devnet endpoint. A Web Lock prevents competing tabs from signing or overwriting recovery state. Pending, failed and expired attempts retain their bytes; retries check or resend that same transaction and never automatically request another signature.

The server never submits a transaction. It reads devnet genesis and the confirmed transaction, verifies the exact instruction/signature/account shape and fee-only balance change, then journals the receipt separately and mirrors it to KV. Explorer links select devnet. A local stored status is not confirmation evidence.

Limits are 200 prepared receipts per browser account, eight new preparations per minute and 30 confirmation checks per minute. The client retains at most 128 signed recovery records. Compatible Phantom, Web Locks and persistent browser storage are required. Automated tests use synthetic signing/RPC fixtures; **a real Phantom approval and devnet confirmation remain a manual validation item**. The optional SPL receipt token was cut.

## Testing and release evidence

Run `npm ci`, `npm ci --prefix execution`, `npm run build`, then `npm run dev` for local use. Run `npm run verify` for the complete suite, both TypeScript checks and real local Worker runtime exercises. Runtime tests require a local listening port and use synthetic providers; they do not sign with a real wallet or submit transactions.

Coverage includes scoring/range bounds, unknown/stale evidence, exact lamport conservation, idempotent concurrent transfers, whole-basket/rule rollback, global close claims, session isolation, KV recovery, provider quotas, devnet receipts and denial of mainnet routes. Personal receipt and validation archives are excluded from this public export; test fixtures are synthetic replacements rather than anonymized live financial claims.

`node tests/worldsfair-ui-preview.mjs` starts an optional local-only fixture on port 8790, with production paper routing, synthetic providers and an explicit fixture banner. Restarting clears its synthetic account state. Local validation artifacts remain ignored. Do not present fixture values as real performance or live product-demo evidence.

The earlier Task 6 mobile/desktop checks are recorded against their private development commit. The redesigned Still release requires a final 390 × 844 pass; earlier screenshots do not establish a later build's result. Record the final public commit, deployment receipt and fresh `/api/version` check before publishing a demo recording.

## Prior-work disclosure and fresh public history

The owner authorized a new public repository named **worlds-fair** while keeping the original LP Terminal repository private. This repository therefore starts with a sanitized source snapshot and fresh Git history. It does not mirror private history or claim that the entire initial public snapshot is newly authored hackathon work.

In the private source repository, `worldsfair-baseline` and `pre-worldsfair-fork` both resolve to `bccf1bb049dc58381a60b87356bde729a6b8fd06`, dated **4 September 2026, 19:56 UK**. No later commit before the requested **14 September 2026, 14:00 UK** cutoff is present in the available history. These tags remain private; no equivalent public historical tags have been fabricated.

The supplied later source lacked matching Git history. Private import commit `37a4a71441b1679cea4f59fe90560614d0ed9d71` preserved that snapshot on 5 October. It includes existing research screens, market integrations, range mathematics and strategy/fleet logic. Those foundations are **inherited**, not claimed as newly authored on the import date. The available evidence cannot establish their exact before/after-cutoff authorship.

The dated **5 October 2026** task commits identify the clearly new paper boundary, pre-flight, persistent pot, funded profit rolls, paper baskets, yield/rules, responsive changes and suggested-range work. Subsequent Still, devnet and UX changes must be attributed to their reviewed commits. [WORLDSFAIR_CHANGELOG.md](WORLDSFAIR_CHANGELOG.md) records per-task SHA, UK time, scope and checks; earlier SHAs identify private development records, while commits after export belong to this public repository. A source import date is not evidence of original authorship.

The submission should disclose both the prior project and this history gap. Additional original history may improve attribution, but missing commits have not been reconstructed or invented. [WORLDSFAIR_TODO.md](WORLDSFAIR_TODO.md) records the remaining manual validation, logo/video work and final review/submission steps.
