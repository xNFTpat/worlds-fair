# Still

**Clarity before capital.**

See a pool's fees, costs and downside before you deposit. Practise on paper. Then put your profits somewhere sensible.

[Live Still](https://lp-terminal-worldsfair.pat-862.workers.dev) · [Public source](https://github.com/xNFTpat/worlds-fair) · [Submission copy](SUBMISSION.md) · [Technical guide](WORLDSFAIR_README.md)

Still is a paper tool for Meteora liquidity providers. It combines dated pool data, a size-matched exit conversion quote, token policy, holder checks and downside scenarios. Missing evidence says **Unavailable**. Each browser receives **10 practice SOL**; no login or wallet is needed. No mainnet signing or real money movement is enabled.

## The problem

Small Solana LPs often lose money to costs, not bad calls: the exit swap on a thin token, Token-2022 transfer taxes, a few wallets holding most of the supply, a floor set too tight, entering mid-spike. Checking means five tabs and a Discord, and nothing adds it into one answer: what do I net, and what's my worst case? I learned each of these by losing money. One trade I thought had worked came out flat after the exit swap.

## Demo path — the clicks that work today

1. **Home → Pick a pool.** The primary button goes directly to live pools. Optional **How it works** explains the paper model; Settings lets you change pace.
2. **Run Pre-flight** on a pool. Read the ticket sentence, net percentage, cost recovery time and verdict. Open **See the numbers** for the eight checks, raw SOL costs and dated evidence. **Change range** opens size, shape, floor, ceiling and planned hold; **Run Pre-flight** checks the chosen settings again.
3. **Open on paper → Open on paper** in the confirmation. If the verdict is Skip for now, use **Open on paper anyway** only to demonstrate that risk on paper. A fresh price is required. The new position's pool expands in **Positions**; every position keeps its own address and history.
4. **Follow → Narrow Spot → See rules → Follow on paper → Follow on paper** in the confirmation. The run starts now and waits for fresh qualifying data. It does not invent an immediate trade.
5. In **Make your own paper bot**, change the controls and name, then **Start paper bot → Start paper bot** in the confirmation. The server runs the saved rules against the same practice balance.
6. **Grow → Try a 1 SOL example → Backyard only → Park on paper → Park on paper** in the confirmation. Keep a current SOL staking option, such as JitoSOL, when available. This separately labelled example is not earned trading profit. A saved summary appears in Grow and Positions. Cesto splits require every mint and quote to verify; unavailable destinations must have 0%.
7. **Home → Learn → Read** a lesson, then **Next lesson** or **Try it**. Pre-flight's **Learn more** links open the matching lesson. All eight lessons are included.

Optional starter mix: **Pools → Try this mix on paper → Open on paper → Open on paper**. Calm start has two Steady pools, Learn the busy ones has one Steady and one Busy, and See a bad day uses one Spicy pool at a small default size. These are LP practice sets. **Baskets** in Grow means Cesto token baskets.

Optional close: expand a pool, **Close on paper → Close** (or **Keep**). The server requires a fresh price and returns gross modelled inventory to the practice balance, before fees and costs; this is not realised net profit.

Wallet reading: **Positions → View a live wallet · read-only → Connect Phantom (Read-only. No signing.)** or paste an address and **View wallet**. Open a position’s **Run Pre-flight**, then **Practise this on paper → Open on paper** to copy its observed bin allocation with 0.5 paper SOL. Missing or unrepresentable bin data keeps copying unavailable. No default range is substituted.

### Recording caveats

- **Live motion/cost checkpoint (11 October, 20:43 UK):** deployed `4552b516b89ea5aec6eead94bf10c84a34354ba1`. All six fixed pools at 0.5 SOL returned dated entry, refundable deposit, exit, four-hour net and recovery estimates. Mobile Home Lighthouse: **98 performance / 100 accessibility**. The exact SKR/SOL thin example screens as **Skip for now** because exit costs exceed four-hour fees. This checkpoint predates the subsequent half-position fee-floor correction. Top-holder classification remains incomplete for the first four pools. Estimates can become unavailable when providers fail; no secret value was read or logged. See [remaining work](WORLDSFAIR_TODO.md).
- A **Worth a look** verdict is not guaranteed. Still quotes approximately half the position for the exit reference (0.25 SOL of tokens for a 0.5 SOL plan). The cost is verified route fees plus reported adverse Jupiter price impact, retaining any larger loss versus the dated pool mark, then adding observed network fees and separate withdrawal tax. This conservative paper estimate cannot fall back to network-only or an assumed fee. A failed, expired or incomplete quote makes the total exit/net **Unavailable** and the verdict **Caution**. SOL-only Bid-Ask entry needs no token purchase; two-sided funding requires its own exact-size quote.
- Holder concentration can remain unavailable because a largest-account sample cannot prove the complete owner distribution. Missing or stale readings are never zero.
- Strategy results say **Too early to judge** until five closed paper trades. Entries wait for their conditions, and stale evidence can delay a planned close. Five trades do not make missing costs known.
- Park currently demonstrates the separate **1 SOL example allowance**. Earned-profit routing cannot be shown until complete net profit is measurable. No profitable trade is fabricated to fund it.
- The default 40/30/30 split cannot confirm when a destination is unavailable. **Backyard only** is the current practical route if SOL staking rates are fresh. If no rates are available, show the unavailable state rather than claiming a deposit.
- Cesto needs verified token mints, decimals and timely quotes for every leg. One failed leg rejects the whole allocation. Refreshing or recording a clip does not override provider limits.
- Checks load together after their bounded reads and then appear with a brief stagger; they are not a streaming feed. Do not narrate each animation as a separate arriving RPC result.

## What's paper, devnet and live

| Area | What happens |
| --- | --- |
| Live data | Meteora pool observations/candles; Jupiter quote-only conversions; read-only Solana mint, grid and largest-account evidence; Cesto allocations; Backyard and indexed staking rates. Each value is dated. |
| Pre-flight | Example screening thresholds in `src/still-preflight-config.ts`. Gross 20%/50% token-in-SOL scenarios use a downward bin-fill model. They exclude unmeasured costs and are not predictions. The floor is not a stop-loss. |
| Manual positions | Confirmed paper inventory, separate address per position, modelled fee observations and gross settlement. Fees are not actual LP earnings. Missing intervals are not backfilled. |
| Follow / custom bots | Durable forward-only paper runs. No mainnet transaction is built or sent. Net/win/loss results remain unknown when costs are missing. |
| Grow | Atomic example split. Cesto records quoted raw token units. Backyard accrues linearly at the saved quoted rate on original deposit units, even if that rate is labelled APY; no compounding, acquired vault shares, LST tokens or actual yield. Non-SOL model value needs current price evidence. |
| Wallet | Public-key-only Phantom connection or pasted address. Real positions are labelled Live, read-only. Only the address is saved in browser local state. No signing routes or devnet controls are exposed in this pass. |

The browser's random Secure, HttpOnly, SameSite=Strict cookie identifies its isolated account. Clearing it loses access; there is no account recovery. Balances and action receipts are server-owned. Confirmed changes are serialized and atomic; replaying a request returns the saved result. Research's earlier paper accounts remain separate.

**Steady / Busy / Spicy** describe observed age, liquidity and fee activity, not safety. The shortlist contains at most eight SOL-paired pools: the highest reported one-hour volume among eligible pools, plus the exact SKR thin example. Loading the list refreshes the two SOL-side Meteora catalogues through a five-minute KV cache; a failed refresh is visibly unavailable, never silently replaced with the old catalogue. Listing does not fan out into quote/RPC reads. Fee trend compares the last-hour pace with the trailing-day hourly average, not the previous hour. Daily pace is size × hourly pool fees/TVL × 24, not a promise of concentrated-position earnings. Custom ranges can be narrower than requested because the paper setup is capped at 69 bins; the displayed bounds are the actual modelled range.

## Cost story and the thin-pool example

Pre-flight separates the **entry transaction fee**, **Deposit, returned on close**, **one-off setup cost**, and **exit cost**. Position rent is read with Solana `getMinimumBalanceForRentExemption` for the full 8,120-byte PositionV2 allocation, including its Anchor discriminator; no fixed SOL rent is supplied. Existing bin-array/bitmap accounts are verified by program, discriminator, pool and index. Missing required arrays use current chain rent plus the declared setup transaction fee and count toward net. Returned position rent is excluded from net. This remains an unsigned paper plan: wallet-specific token-account setup, priority bids and future execution changes are not simulated.

A verified Token-2022 withdrawal fee is rounded up in raw token units and capped at the on-chain maximum. It is separate from swap fees already embedded in Jupiter proceeds. Without a complete quote, a known positive fee is shown as an **at least** exit-cost component; full net and recovery time remain **Unavailable**. Missing is never assumed to be zero. The exact existing STONK demo mint `6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx` is legacy SPL, with no transfer-fee extension; a ticker alone is not tax evidence.

Net percentage is `(estimated fees over the selected hold − entry − exit − non-refundable setup) / paper SOL amount × 100`. Recovery hours use complete costs divided by current projected hourly fees. “Fees don't cover costs” requires an observed zero fee pace with positive costs; missing data says Unavailable. All inputs preserve source times.

The additional thin learning example is **SKR/SOL**, pool `BCv5Ggg5563AYfkrErdXok2hKfjgUNtQ1A4yKuNbTjQ9`, with mint X `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` and mint Y `So11111111111111111111111111111111111111112`. The shortlist pins this exact identity only when fresh and eligible; returns and verdicts remain live calculations. Its observed exit quote exceeded four-hour fee income at 0.5 SOL when selected. This illustrates an unfavorable cost check, not a recommendation.

The supplied Still app motion pack is served locally from `public/motion`: status loader, ticket reveal/fold, range gauge, confirmation sheet/splash, empty-state art, header, card texture, page wipe and favicon. Reduced motion and reduced transparency remove movement/blur as appropriate. The below-range ring uses caution ink with 5.48:1 contrast on cream. No external animation service is loaded.

## Data sources and architecture

Static HTML, CSS and JavaScript call a Cloudflare Worker. Durable Objects serialize paper accounts, schedule strategy observations and enforce shared quote and public-RPC budgets. The isolated Workers KV namespace stores source caches and earlier research journals. This build uses **branch `worldsfair`**, **Worker `lp-terminal-worldsfair`**, and the standalone **xNFTpat/worlds-fair** repository only.

- **Meteora DLMM Data API:** pools, liquidity, fees, timestamps, bin configuration and exact-pool hourly candles. Existing bounded candle fallback can use GeckoTerminal when its pair identity verifies.
- **Jupiter:** size-matched quote-only token conversions and dated marks, under the shared allowance. Still's exit conversion quote makes no supplemental RPC fee request; network base fees and mint policy are separate checks. No swaps are submitted.
- **Solana read RPC:** mint extensions, native active-bin evidence, largest accounts and owners. The server-only Worker secret **`STILL_RPC_URL` takes priority** for HTTP readers, inherited research, background work and paper-ledger alarms. Only a missing secret uses the configured `SOLANA_RPC` public fallback, currently [OnFinality](https://www.onfinality.io/en/networks/solana). Failed or invalid private configuration never rotates to a public provider. Mint/Token-2022 policy and holder reads are cached in KV for ten minutes with their original source dates; private cache scopes use a hash rather than the endpoint. Observed network base fees also retain their original timestamp for at most ten minutes. The public fallback retains its shared two-method allowance and cooldown. Incomplete coverage stays unavailable; existing RugCheck evidence supplies verified exclusion addresses.
- **Cesto:** public basket catalogue and allocation weights. Paper units require verified Solana mints and fresh Jupiter quotes.
- **Backyard:** public vault directory, asset metadata and rate quotes. **DefiLlama** indexes the JitoSOL, mSOL and JupSOL rates used by the inherited staking reader. These are provider quotes, not live accrued balances.
- **LP Army / creator public posts:** strategy inspiration and attribution, never a source of Still performance.

Main routes: `/api/still/pools`, `/api/still/preflight`, `/api/baskets`, `/api/still/basket-preflight`, `/api/still/park`, `/api/paper/still-account`. Mutation routes are isolated confirmed paper actions. Owner execution, payment and mainnet send routes are unavailable. **Research** is retained only via the footer; it is outside the first-visit path.

## Run and test

Use Node 24 and the lockfiles:

```sh
git clone --branch worldsfair https://github.com/xNFTpat/worlds-fair.git
cd worlds-fair
npm ci
npm ci --prefix execution
npm run build
npm run dev
```

Open Wrangler's local URL. Local storage starts empty; a successful public market refresh is needed before pools appear. Configure the production Still RPC only as the Worker secret `STILL_RPC_URL`, using Wrangler's masked prompt or the Cloudflare dashboard. Never place its value in repository configuration, environment files, logs or test fixtures. Do not copy another deployment's secrets. No private wallet key is needed. The inherited `execution` dependencies support range mathematics and the public wallet reader; installation does not expose any signing.

```sh
npm test
npm run check
npm run verify
```

`verify` runs 85 test scripts, TypeScript checks and five local Worker runtime suites, including secret selection/privacy, independent same-pool positions, recovery/idempotency, strategy parsing/scheduling, unavailable evidence and atomic Park rounding/quote failures. Runtime tests bind localhost; signing/provider fixtures are synthetic and submit no transactions. [Accessibility checks](docs/ACCESSIBILITY.md) record Home's Lighthouse 100/100 result and responsive/keyboard coverage.

To deploy after tests, commit and push the reviewed work, then run `npm run deploy`. The guard requires a clean worldsfair branch and the exact public origin, runs the publication audit, uses `wrangler.worldsfair.toml`, stamps the real Git SHA and writes a receipt to the isolated demo KV. Verify `/api/version` matches the commit. Never use an unqualified deployment command or touch `lp-agg` / the personal terminal.

## Prior work disclosure

Cutoff requested for disclosure: **14 September 2026, 14:00 UK**. This public repository starts from a sanitised snapshot on **5 October**. An import date is not an authorship date.

| Group | First → last verifiable SHA | What can be claimed |
| --- | --- | --- |
| Known private pre-cutoff baseline | `bccf1bb049dc58381a60b87356bde729a6b8fd06` → same, 4 September | Existing private LP Terminal. Private provenance tags identify this commit; full later pre-cutoff history is unavailable here. |
| Inherited later source | Exact before/after-cutoff endpoints **unavailable** | Research screens, market integrations, range mathematics and strategy/fleet foundations are inherited. They are not newly authored merely because imported on 5 October. |
| Initial public snapshot | `1916c029ba9cfad87ccf64aa02af1d2756006dbc` → same, 5 October | Sanitised export excluding personal records, private archives/history, credentials and original deployment configuration. |
| Public 5 October changes | `d2ed57d2e64b291c071c8378a79d7cdc2286c2bb` → `bd097a52ee97ecfe3233a1787c9d55f3b89e4a58` | Public provenance, simpler paper flows, data-read and contrast fixes. |
| Guided 9 October demo | `f4d92de06f2e950943f26a0f72f795d749206fec` → `1333a58c0f5c2cf0da57ad10d76bc32ea24880f0` | Guided pools/Pre-flight, address-keyed groups, isolated ledger and retained devnet choice receipt. |
| Claude UI/copy implementation, 11 October | `1b144077eab693d12d59eab29cfe83a1086dd167` → `8f2935378782fa2a9dc5df4558722d3cd9457c16` | Home/onboarding, live checks and editable ranges, seven strategies and custom bots, atomic Park examples, eight lessons and accessibility fixes. Subsequent documentation/release commits are visible in Git. |

The public **`worldsfair-baseline`** tag identifies the **5 October public snapshot**, not the September cutoff. Its annotation records that limitation. It is deliberately not a claim that unavailable private history is public or verified. The private tag with the same name is described in the technical guide and points to the older private baseline; these are different repositories. [WORLDSFAIR_CHANGELOG.md](WORLDSFAIR_CHANGELOG.md) retains earlier task records, whose private SHAs must not be confused with this fresh public history.

## Strategy attribution and permission to-dos


Seven new paper strategies are declared in `src/still-strategies.ts`. They use the same isolated guided paper ledger and range model as manual positions, with a Durable Object alarm, not the old research fleet’s history. Following explicitly authorises future paper entries and planned closes from the same 10-SOL practice balance. Each run has its own start time; no historical trades are copied or backfilled. Custom bots run on the same engine. Each run has at most one open position; the demo retains at most 40 positions and ten runs per browser. The shared runner processes eight active journals per minute, with a 128-journal capacity; checks can be delayed. A planned hold is checked against observations, not guaranteed execution time. Missing fee intervals remain unavailable. Paper net uses the saved entry-time cost model, not a freshly executed exit.

Source posts were located through the [LP Army strategy library](https://www.lparmy.com/strategies) on 11 October 2026. Exact thresholds and hold settings are Still examples supplied for this build, not a claim to reproduce the creators’ current trading. No creator return is a Still result.

- TODO(permission): [@molusol — Heart attack inspiration](https://x.com/molusol/status/2107563392084873543).
- TODO(permission): [@razzaer — Spot-range inspiration](https://x.com/razzaer/status/2107576780391387512).
- TODO(permission): [@Eyyyys — public DLMM article](https://x.com/Eyyyys/status/2099817371372560521). Article title and source indexed by LP Army; full X article retrieval was unavailable.
- TODO(permission): [@Jaypee_Sol — Bid-Ask explainer](https://x.com/Jaypee_Sol/status/2107017949215383786).
- TODO(permission): [@VladimirKovacs — beginner LP checklist](https://x.com/VladimirKovacs/status/2099778321298890892).

Every creator card discloses the inspiration and non-affiliation, and links a removal-request issue. Pat’s Overnight and Steady Drip are house examples. No permission request has been sent on the user’s behalf.


## Third-party code and licences

The public source is inspectable, but this repository currently has **no project-wide licence file**. Pat must choose/confirm a licence before describing reuse rights as granted. This is logged in the TODO; no third-party rights have been relicensed.

- Vendored Lightweight Charts: Apache-2.0, with [licence](public/vendor/lightweight-charts-LICENSE.txt) and [notice](public/vendor/lightweight-charts-NOTICE.txt).
- Vendored Uniswap v3 SDK: [MIT licence](public/vendor/uniswap-v3-sdk-LICENSE.txt).
- Installed direct-package metadata: Solana web3.js, bn.js, MCP SDK/ext-apps and esbuild — MIT; SPL Token and TypeScript — Apache-2.0; Wrangler and Workers types — MIT OR Apache-2.0.
- Meteora zap-sdk 1.3.2 is pinned in the execution lockfile, but its installed package declares no licence and contains no licence file. Licence review remains open; do not infer permission from availability on npm.
- Instrument fonts are served locally with their [source record](public/fonts/SOURCES.md), [Instrument Sans OFL](public/fonts/instrumentsans-OFL.txt) and [Instrument Serif OFL](public/fonts/instrumentserif-OFL.txt). Third-party packages retain their own notices; lockfiles identify the full transitive inventory.

## Business model and what's next

Still is paper today and earns nothing. **0.3% (example rate, not live)** illustrates a flat disclosed fee for future routed deposits; no fee is currently charged. **Still Plus: planned**, with no price. Any future execution requires a separate reviewed implementation and explicit signing.

Next: measured transaction costs and complete holder coverage; earned-profit routing once net results can be established; live execution with upfront fees; alerts; a strategy marketplace; and broader devnet/mainnet stamped records. Current Backyard is an estimate, not a vault-execution product. Custom bots and all eight lessons are implemented; they were not cut. Optional SPL receipt tokens and custom on-chain vaults remain cut.

The supplied logo pack is applied and ready for Colosseum upload. That upload, the separate two-minute founder pitch, three-minute product demo, chosen X profile, licence/attribution review and final Colosseum submission are still human tasks in [WORLDSFAIR_TODO.md](WORLDSFAIR_TODO.md). This build did not publish videos, claim handles or submit the entry.

**Not financial advice.** Paper models do not establish achievable returns, and real LP positions can lose capital.

## Paper cost model (11 October final pass)

The declared plan prices one unsigned two-signature open, one close and one exit swap, plus an entry funding swap for a two-sided range. Base fees are observed through [Solana getFeeForMessage](https://solana.com/docs/rpc/http/getfeeformessage); the priority bid is explicitly zero by choice. Refundable rent, extra setup transactions and execution changes are excluded. No message is signed or submitted. Nonzero or unreadable transfer taxes keep this model unavailable until exact transfer amounts are supported.

The planned-hold net figure is pool-average fee pace × size × hold, minus that dated plan, conditional on staying in range and unchanged pace. A SOL-only range above current trading earns nothing until price enters. Positions retain the source, time and scope of their entry-time cost model; their paper net does not claim a current executable exit. Future stressed withdrawals are not priced using today's quote.

Heart Attack accepts measured five-minute volume or an observed cumulative-volume increase of at least $1M within five minutes. It starts collecting after following, never scales a longer window or backfills a signal, and resets on counter regressions or stale observations.

## Read-only wallet scope

Wallet positions are read separately by position address, even within one pool. Actual balances, native bins and ownership come from read-only Solana RPC; pool fee pace comes from Meteora. The exit swap uses that position’s observed paired-token raw balance, excludes unclaimed fees and is not an LP withdrawal quote. Unsupported pairs and missing reads remain visible as Unavailable.

Paper copies are independently funded from the browser's practice balance and retain the observed absolute bin range and relative SOL/token allocation. They do not move or manage the live position. Copies wider than the 69-bin demo limit, stale data, foreign ownership or unsupported token behaviour are rejected. The backend re-reads before confirming; a failed read spends nothing. Historical devnet code remains in the repository for provenance, but its public routes and signing bundle are blocked for this release.

The public Still scheduler refreshes the pool catalogue and dated observations. Archived research trial loops are paused to reserve read capacity for Pre-flight and wallet checks; their stored journals remain accessible under Research. Guided Follow strategies keep their independent durable alarms.

## Final visual pass

The supplied Still logo, favicons, social preview and verdict artwork are used unchanged. Instrument fonts are served locally. The first screen stays static and usable while lessons, visual metadata and the small motion module load only when needed. Reduced-motion settings disable the cursor, ripples and settling effects.

Creator pictures are cached from the public X image CDN; matching profile metadata came through FxTwitter because direct X pages were unavailable. Attribution and removal links remain beside every picture. Partner logos come from the official Meteora brand kit, Cesto site and Backyard site; token icons are keyed by verified mint addresses. Unknown or unreadable images use a neutral circle or initials. Source URLs, dates and file hashes are in `public/creators/provenance.json` and `public/partners/asset-provenance.json`. The application never hotlinks these images.

Grow previews at most two real Cesto allocations from its public API, with source times. Missing or stale allocations remain unavailable. Logos belong to their owners. Still is not affiliated.

Known-issuer freeze warnings use the exact canonical USDC and USDT mints from [Solana payments documentation](https://solana.com/docs/payments/how-payments-work): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`. Their active freeze authority is a **Known issuer / Caution** check, not a pass. Symbols and lookalike mints never qualify. Screening thresholds are unchanged.
