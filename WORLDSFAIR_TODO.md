# Still · remaining work

Product: **Still — Clarity before capital.** Public repository: [xNFTpat/worlds-fair](https://github.com/xNFTpat/worlds-fair). The original LP Terminal repository remains private.

## 11 October — Claude copy and UI pass

Current freeze: **Monday 12 October 2026 at 15:00 UK**, replacing the earlier deadline below. Scope remains the standalone public `worldsfair` branch and `lp-terminal-worldsfair` Worker, paper only.

- [x] Stage (a): Claude Home and onboarding copy, Still ring, exact palette, Home/Pools/Positions/Follow/Grow navigation, footer-only Research, persisted pace preferences with blocked-storage fallback. Browser checked at 375px and 1280px.
- [x] Stage (b): live Meteora/Jupiter/RPC pre-flight checks, one threshold config, editable ranges, renamed starter mixes and individual positions. Full 67-script suite, TypeScript and three Worker runtimes passed; mobile custom Spot open/close confirmed without horizontal overflow.
- [ ] Camera caveat: all-in transaction costs, net proceeds and fully classified holder concentration can remain unavailable. Do not script a guaranteed “Worth a look” or imply a Jupiter conversion quote is an all-in execution cost. Gross paper inventory settles separately.
- [x] Stage (c): seven creator/house cards, source-post and removal links, confirmed follow/unfollow, a working custom bot builder, and durable forward-only paper runs on the guided position engine. No backfill or reuse of old fleet outcomes.
- [ ] TODO(permission): Pat to review attribution with @molusol, @razzaer, @Eyyyys, @Jaypee_Sol and @VladimirKovacs. No messages sent. Exact run parameters are labelled Still examples; the public sources establish the inspiration rather than endorsement.
- [ ] Follow camera caveat: new runs show “Too early to judge” until five closed paper trades. The runner waits for fresh qualifying market evidence, so following need not open a position immediately. Checks are normally minute-based; capacity, source outages and stale marks may delay a close.
- [x] Stage (d): atomic Park example allocations with verified Cesto quotes and Backyard estimates. A separate one-time 1 SOL example is used because complete earned net profit is unavailable.
- [x] Stage (e): all eight supplied lessons, conceptual illustrations, contextual links and persisted read ticks.
- [x] Stage (f): mobile/desktop and keyboard review; Home Lighthouse accessibility 100/100. See docs/ACCESSIBILITY.md for scope and untested assistive-technology limits.
- [x] Stage (g): current README and submission access instructions, SHA-based prior-work disclosure, public snapshot baseline and explicit licence gaps. Release identity is checked after deployment.

- [ ] Pat: choose/confirm a project-wide source licence. No root licence exists; public visibility alone does not grant reuse rights. Review Meteora zap-sdk package licensing before claiming full dependency clearance.
- [ ] Camera caveat: use Grow → Try a 1 SOL example → Backyard only when current SOL staking rates are available. Do not call the example earned profits. Cesto can fail closed on any unverified mint or quote.

## 9 October — guided demo before feature freeze

Scope: branch **worldsfair**, public repository **xNFTpat/worlds-fair**, Worker **lp-terminal-worldsfair** only. Feature freeze: **Saturday 10 October 2026 at 12:00 UK**. The personal terminal and `lp-agg` are excluded.

- [x] Implement the source-checked shortlist (maximum eight SOL-paired Meteora DLMM pools), attainable SOL-only Bid-Ask range, 20% / 50% gross downside scenarios and three current 50/50 pool-basket presets. Focused pre-flight tests passed; this alone does not mark the release deployed.
- [x] Replace the README's earlier research-tour instructions with the exact guided demo clicks, the 10-practice-SOL account, separate positions within pool groups and explicit paper-model limits.
- [x] Verified the complete live first-visitor flow on 9 October in **41.546 seconds** of browser interaction: **Try a pool on paper → Check this pool → Review paper deposit → Confirm paper deposit → Positions → Try a basket → Check the basket → Review paper basket → Confirm paper deposit**. It started with 10 practice SOL, opened CTM/SOL for 0.5 SOL, then a 0.5-SOL Steady basket split between CTM/SOL and HYPE/SOL. Final balance: 9 practice SOL; three distinct position addresses, including two in the CTM pool group. This measures the click path, not a human’s time to read every disclosure.
- [x] Local browser review covered desktop and mobile (390 × 844) Home, loading, empty, unavailable, filled and confirmation states. A single 0.5-SOL deposit plus a 0.5-SOL basket created three distinct addresses, including two STONK/SOL positions in one group. Closing only the first returned 0.5 gross practice SOL and left both basket positions open. Mobile document width remained 390px. Malformed local market data produced a clear retry state.
- [x] Run all 66 test scripts, both TypeScript checks and the three real local Worker runtime suites. Basket receipt runtime coverage includes opening, one-leg closing, reload, same-session recovery and cross-session rejection with synthetic providers; no wallet was signed.
- [x] Pushed `worldsfair` to the standalone public repository and deployed only `lp-terminal-worldsfair`. Live verification at 11:19 UK on 9 October matched `f0ca91dc29bae4d43805a029958e8012712876a6`, clean branch, Worker version `8650a82f-b576-4737-ba79-44a510d57d0d`. `/api/baskets` returned three available two-pool presets. Later documentation-only releases retain the verified source hash; `/api/version` identifies the currently deployed commit.
- [ ] All-in entry/exit transaction costs remain unavailable where actual simulation evidence is missing. Gross inventory, conversion-only quotes and pool fee pace must remain distinct. Net P&L and net downside proceeds cannot be demonstrated as known yet; do not substitute a fixed network allowance or a guessed fee.
- [x] Implement the optional guided **basket-choice devnet Memo** using an immutable receipt for the browser session’s exact saved allocation and position addresses. The button survives reloads; signature and devnet Explorer link are shown after submission. The unavailable-Phantom state was checked without connecting a wallet.
- [ ] Pat: click **Record basket on devnet**, connect Phantom, review the exact Memo, sign it yourself and verify the devnet Explorer receipt. This human signing check is still outstanding; automated fixtures do not count as a completed wallet session.

Cuts for this pass: vaults, profit-roll rules, live basket-token execution and strategy trials are outside the guided demo. Earlier research tools remain behind **Advanced** with their separate paper accounts. Mainnet transactions, the optional SPL receipt token and custom on-chain vault work are excluded.

## Earlier release checks and research backlog

These dated records describe the earlier research build. They do not establish validation of the 9 October guided demo. Cesto purchase and shared-strategy profit-roll work below are retained as an Advanced backlog, not a requirement to add them back to the new first-visit path.

- [x] Verify the next flow/reliability change (`03017a4da964dc8950f15e32c1bd56cef092d29c`): 62 test scripts, both TypeScript checks, and three runtime suites passed. Local mobile checks covered basket form placement, balance/holdings navigation, an unchosen then manually chosen range, and cancelling a paper staking review without changing its balance. Deployment evidence is recorded separately.

- [x] Verify the first sanitized public release: all **60 test scripts**, both TypeScript checks and **three runtime suites** passed. The clean branch was committed and pushed, the separate demo deployed, and public access checked. Recorded release: **5 October 2026, 13:42 UTC**, public commit `d2ed57d2e64b291c071c8378a79d7cdc2286c2bb`. This records that release, not subsequent unverified changes.
- [x] Check the released layout at **390 × 844** and desktop **1280 × 900**; mobile document width was 390px. A local filled paper account and native staking estimate were exercised without a wallet signature.
- [ ] Finish the remaining final-release visual states: empty, loading, unavailable and confirmation dialogs, plus the live filled basket portfolio. Retain dated evidence and repeat version/footer checks after the next deployment.
- [x] Check isolation: this work deployed only `lp-terminal-worldsfair`, and the original deployment configuration checksum stayed unchanged. The personal Worker's live version changed separately during the session; no personal deployment or rollback was performed here. Do not describe its initial and final versions as equal.
- [ ] Manually exercise one optional **Phantom devnet Memo**: enable testnet mode, use devnet SOL, review both consent steps, confirm the exact Memo and open its devnet Explorer link. Check rejection and same-transaction retry too. This needs the user's wallet interaction; automated fixtures do not count as a real signing session.
- [ ] Complete a real public-provider basket purchase and valuation refresh. The deployed 5 October flow pass added 1 labelled Paper SOL, then attempted a 0.1 SOL Solana Infrastructure basket. The request could not verify every asset/quote, saved no holding and left the balance at 1 SOL. The clear unavailable/retry state was verified on desktop and mobile. An authenticated demo-only read RPC may improve reliability; never borrow private deployment credentials.
- [ ] Demonstrate an eligible profit roll once a genuine funded paper close exists; manual Paper SOL cannot stand in for earned profit.
  - Local workerd public-RPC probes on 5 October verified SOL/USDC mint units and block time. A real Cesto `solana-infrastructure` preparation at 14:02 UTC was blocked by the public fallback's HTTP 403 during multi-mint verification; no purchase or debit was saved. Recheck the deployed demo after the bounded fallback release. A dedicated demo-only read RPC remains an optional reliability remedy; do not relax mint or quote-age checks.

Release evidence is retained locally in `validation/worldsfair/FINAL_REPORT.md`; validation records are deliberately excluded from the public repository. Two read-only demo checks on **5 October 2026 at 13:52 UTC** found a fresh shared-strategy scan but **no closed trades and no history cursor**. There is therefore no genuine profitable-close ID available for a roll demonstration yet. Wait for a real funded paper close; manual Paper SOL can demonstrate basket purchases but cannot stand in for earned profit.

There is **no missing Jupiter key blocker**. Public quote and Price reads are supported with the shared keyless allowance. A dedicated `JUPITER_API_KEY` or read-only `SOLANA_RPC` is an optional reliability/capacity improvement for the separate demo. No wallet private key or owner credential is required.

## Submission assets — bank for the final pass

Banked at the user’s request; the reminder was delivered in this chat on **Tuesday 6 October 2026**. No completed upload, recording or claimed profile has been recorded here, so the four assets remain open.

- [ ] Polish the chosen Still logo and export the upload-ready asset; upload it to the Colosseum project when ready.
- [ ] Record a **product demo of at most three minutes**, preferably with Loom, using the actual product. Use the README’s new guided clicks: one pool, its pre-flight, a confirmed paper position and a combined basket. Show costs/net figures as unavailable where needed and state the actual devnet status. Do not present a synthetic fixture as live activity or a completed real signing flow.
- [ ] Record a **separate founder pitch of at most two minutes**. Keep it distinct from the product walkthrough.
- [ ] Confirm the X profile to use in the submission. Do not infer it from inherited project branding.
- X handle shortlist: `@easylp` and `@stilllp`. On 5 October 2026, the user reported that neither appeared to exist on X; verify availability before choosing or reserving one. Product name remains Still.
- [ ] Add final video links, logo, public repository and demo URL to the submission fields; check reviewer access without unexpected permission requests.
- [ ] Review the complete Colosseum entry, prior-work disclosure and links with the user before submitting. **Final review and submission have not been performed.**

The supplied brief targets **22:00 UK Monday 12 October 2026**, with a stated hard close of **07:59 UK Tuesday 13 October**, and a feature freeze at midday Saturday 10 October. Recheck the current submission form's deadline before the final send.

## Provenance and publication

- [ ] If another private repository or backup has the missing September Git history, reconcile it before making more precise before/after-cutoff claims. Missing history is not permission to fabricate it.
- [x] Audit the public snapshot: sanitized source and synthetic test fixtures only; private history, personal wallet data, archives, credentials and original deployment settings were excluded. Anonymous GitHub access was checked, and the original repository remained private. Repeat the publication guard before every later release.

In the private development repository, `worldsfair-baseline` and `pre-worldsfair-fork` both point to `bccf1bb049dc58381a60b87356bde729a6b8fd06` (4 September 2026). The later supplied working source had no matching history and was imported on 5 October. Existing research, range maths, market integrations and strategy foundations are inherited; their exact relationship to the **14 September 2026, 14:00 UK** cutoff cannot be proved from the available commits. Task SHAs in the changelog identify private development work; the public repository starts a fresh, disclosed snapshot history.

## Deliberately cut

- Optional devnet SPL receipt token, custom Anchor vault, Squads integration and live Cesto deposits.
- Mainnet money actions remain outside this paper/devnet demo.

Keep user-dependent checks and remaining product decisions here while implementation continues.

## Park example (11 October 2026)

Park supports an atomic, confirmed split into qualified pools, quoted Cesto token units and Backyard estimates. Because complete net LP costs remain unavailable, earned profits cannot honestly be established. The demonstration therefore uses a separately labelled, one-time 1 SOL example allowance, never the user's practice balance or invented trading profit. Only complete Worth-a-look pools qualify; unavailable destinations must have a zero split. Backyard only provides a working path when no pool qualifies. Rates are saved at entry and accrued linearly on the underlying deposit asset; no vault shares, LST tokens or real yield are acquired. Cesto values require fresh Jupiter marks. Retries are idempotent and any failed destination leaves the entire allowance unchanged.

## Final MVP pass — phase 1

- [x] Apply supplied Still lockup, favicon set, absolute OG/Twitter share tags and robots.txt.
- [x] Direct Home → Pick a pool; exact launch wording; visible check chips and Paper labels; missing range data does not draw zero.
- [x] Replace unconditional cost gaps with dated quote drag plus an explicit unsigned RPC-priced paper fee plan; preserve hard safety verdicts and cost evidence on positions. This does not complete actual LP transaction simulation or make future stressed net proceeds known.
- [x] Update all seven Follow strategies and public source links; use only observed five-minute volume or bounded cumulative deltas.
- [ ] Read-only Phantom/paste wallet, visual pass, then real faces and logos.
