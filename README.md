# Still

**Clarity before capital.**

Liquidity-pool screens show plenty of numbers without making the decision clear. Still gives a first-time visitor one path: choose a Solana pool, see its fee pace, costs and downside, then practise with a paper position before committing capital.

[Open Still](https://lp-terminal-worldsfair.pat-862.workers.dev) · [Public GitHub repository](https://github.com/xNFTpat/worlds-fair) · [Technical guide and prior research](WORLDSFAIR_README.md)

The guided demo starts each browser with **10 practice SOL**. No login, wallet or real funds are needed. Market observations are real; positions, balances and settlement are paper models. Mainnet signing and money movement are disabled.

## Demo path

The intended first-visit path is Home → pool → pre-flight → position → basket. Current data must be available; the app does not substitute invented prices if a provider fails.

1. On Home, click **Try a pool on paper**.
2. Choose one of the eight or fewer pools and click **Check this pool**.
3. Keep the default **0.5 SOL**. Read the suggested Bid-Ask range, the **20% / 50%** downside scenarios, fee pace, costs and verdict. Missing evidence says **Unavailable**.
4. Click **Review paper deposit**, then **Confirm paper deposit**. The position opens and the Positions view appears.
5. Read the position's inventory value and gross P&L versus holding SOL, modelled fees, range status and floor distance. Expand its pool group to see each separate position. **Refresh marks** requests the latest available observation.
6. Click **Try a basket**, choose **Steady**, **Busy** or **Spicy**, then **Check the basket**. Review the combined pre-flight and the two component pools.
7. Click **Review paper basket**, then **Confirm paper deposit**. Two separate positions appear, with the total paper amount split equally.

Optional devnet proof: after the basket opens, scroll to **Record your basket choice** and click **Record basket on devnet**. Connect Phantom, review the exact Memo, then approve it yourself on Solana devnet. The signature and devnet Explorer link appear after submission. The paper balance never changes.

Optional close: on a position, click **Close paper position**, then **Confirm paper close**. A fresh mark is required. Settlement returns the modelled inventory value **before fees and trading costs** to the practice balance; it is not net profit.

The collapsed **Advanced** section opens the separate research workspace. Strategy trials, earlier trials, wallet settings and other-chain reference material are outside the guided path. Its earlier paper portfolios remain separate from the new 10-SOL practice account.

## What the demo measures

| Display | Evidence and limits |
| --- | --- |
| Pool shortlist | Current SOL-paired Meteora DLMM pools with at least $5,000 TVL, a usable price/bin step and a source read no older than ten minutes. Maximum eight; not a complete market index. |
| 24h fees / TVL | Reported trailing-day pool fees divided by current TVL. A pool younger than 24 hours has no complete daily comparison. |
| 1h fee trend | Last-hour fee pace compared with the hourly average of the trailing 24 hours, not with the preceding hour. |
| Fee pace per day | Paper amount × last-hour pool fees/TVL × 24. A comparison at the observed pool pace, not expected position earnings or a forecast. |
| Suggested range | SOL-only Bid-Ask below the observed price, with more allocation near the bottom. The model uses up to 69 bins and states the actual attainable depth. Native alignment is labelled unverified when unavailable. |
| Downside scenarios | The **paired token's price in SOL** falls 20% or 50%. Fixed-price bins model a monotonic downward path. Gross inventory excludes fees, transfer taxes, slippage, network costs and liquidity limits. The floor is not a stop-loss. |
| Transfer fee | A dated, exact-mint Solana RPC policy read. Unknown or stale policy stays unavailable; it never becomes zero. |
| Entry / exit costs | Complete transaction evidence is required. A size-matched Jupiter conversion quote is shown separately when available; it does not establish all-in LP costs. No default network allowance is presented as observed data. |
| Position result | Every paper position has a unique address. Pool rows group positions for display without merging their balances, ranges or history. Gross P&L is separate from net P&L; missing costs keep net P&L unavailable. |

**Steady / Busy / Spicy** are comparison tags, not safety ratings. Steady requires at least a week of pool history, $100,000 TVL and a recent fee pace between half and twice the daily average. A pool younger than a day, below $25,000 TVL, with unknown age or a twofold fee burst is Spicy. Remaining eligible pools are Busy; the card explains the observed reason.

Each basket uses two current pools in its band at a **50/50** split. Selection prefers different paired-token mints. If only separate pools for the same token are available, the overlap is disclosed; if fewer than two eligible pools exist, that preset is unavailable. Membership is checked again at confirmation. These are paper LP allocations, not tokens representing a basket or a claim to stable prices.

Each numeric evidence field carries its source and time. The fast guided flow uses the current pool snapshot and existing policy/quote caches; it does not wait for a burst of external quote requests. Missing costs currently produce **Marginal**, or **Skip** when an observed concern is sufficient. They cannot produce **Worth it**.

## Paper and devnet boundaries

The browser receives a random, Secure, HttpOnly, SameSite=Strict account cookie. The server derives its account key; it does not trust balances from browser storage. Clearing the cookie loses access to that practice account. There is no login or recovery service.

Paper deposits and closes require a confirmation dialog. The Durable Object serializes balance changes and saves each request's receipt atomically. Repeating the same request returns its saved result. Basket opening is all-or-nothing: an unavailable component cannot leave a partial debit or one position behind.

Position fees are explicitly **modelled**, not earned on-chain. The model uses short intervals between dated pool observations, does not backfill missing periods and cannot establish actual concentrated-position fee share. Net results stay unavailable when costs or fee coverage are missing. A newly suggested range starts below the active price and earns no modelled fees while price remains above it.

The optional guided **devnet Memo** records a hash of the saved basket choice, exact allocations and individual position addresses. Its target survives reloads; closing a position cannot rewrite it. Connecting Phantom and signing require separate explicit reviews. The client pins Solana devnet, checks the exact Memo and fixed compute budget, preserves signed bytes for retries, and displays the signature with a devnet Explorer link. Pat still needs to complete a real wallet signing session; automated fixtures do not replace that check. The optional SPL receipt token is cut.

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

Open the local URL printed by Wrangler. Development uses `wrangler.worldsfair.toml` and emulated storage. The separate `execution/` dependency folder supplies inherited SDKs and the devnet client; installing it does not enable mainnet routes. A local catalogue needs a successful market-data refresh before live pools appear.

```sh
npm test
npm run check
npm run verify
```

`verify` also runs scanner, paper-ledger and devnet-receipt tests in the local Worker runtime. Runtime tests need permission to bind a localhost port. Provider and signing fixtures are synthetic; they do not submit transactions.

## Architecture and data sources

The HTML/CSS/JavaScript guided app calls the Cloudflare Worker for evidence and the isolated paper ledger. Durable Objects serialize accounting; the dedicated Workers KV stores market caches and earlier research records. The guided evidence routes are `/api/still/pools`, `/api/still/preflight`, `/api/baskets` and `/api/still/basket-preflight`.

[Meteora's DLMM Data API](https://docs.meteora.ag/api-reference/dlmm/pools/pools) supplies pool prices, liquidity, fee windows, age and bin configuration. Read-only Solana RPC supplies mint policy and native grid evidence when available. Jupiter supplies dated conversion evidence under the application's shared request allowance. See the [data-provider limits](https://developers.jup.ag/docs/portal/rate-limits) and [technical guide](WORLDSFAIR_README.md) for the inherited research integrations and bounded fallback behavior.

Optional local credentials belong in ignored `.dev.vars`, using `.dev.vars.example`. A dedicated demo-only `SOLANA_RPC` or `JUPITER_API_KEY` may improve provider availability; neither is required to browse existing observations. Never copy another deployment's secrets. No wallet private key is needed.

## Deploy this demo safely

```sh
npm run verify
# Commit the reviewed source and generated browser assets.
npm run deploy
```

The guarded command requires a clean **`worldsfair`** branch with **`xNFTpat/worlds-fair`** as its public origin. It checks publication exclusions and the dedicated configuration, builds a real Git version stamp and deploys **only** with `--config wrangler.worldsfair.toml` to **`lp-terminal-worldsfair`**. It records a receipt in the isolated demo KV namespace. Do not replace it with an unqualified Wrangler deployment.

The original Worker configuration is excluded from this public repository. Do not modify or deploy `lp-agg` or the personal terminal. `/api/version` and the footer identify the actual deployed build; uncommitted local work is not a release.

## What's next

- Complete transaction-specific entry/exit evidence so net comparisons can become available without assumptions.
- Pat's manual Phantom devnet signing and explorer check; automated tests do not replace this check.
- Vaults and alerts after the guided demo; they are outside this feature-freeze scope.
- Product demo recording, separate founder pitch, final logo and chosen X profile. See [the submission checklist](WORLDSFAIR_TODO.md).

## Prior work and public history

Still builds on the owner's existing **private LP Terminal**. This public repository starts with a sanitized source snapshot and fresh Git history; its first commit is not a claim that every included component was written for this event. Personal wallet records, private archives, credentials and the original deployment configuration are excluded.

In the private source repository, both provenance tags point to `bccf1bb049dc58381a60b87356bde729a6b8fd06` (4 September 2026). Later working source lacked matching Git history. Its research, range mathematics, market integrations and strategy foundation are disclosed as **inherited**, and the available history cannot establish their exact relationship to the **14 September 2026, 14:00 UK** cutoff.

New work is identified by the **5 October** task records and **9 October guided-demo changes** in [WORLDSFAIR_CHANGELOG.md](WORLDSFAIR_CHANGELOG.md). Earlier task SHAs refer to the private development repository, not public commits in this fresh export. No historical commits or public baseline tags have been fabricated.
