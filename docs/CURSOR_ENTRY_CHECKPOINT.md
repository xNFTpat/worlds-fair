# Still: issuer, entry quote and full cursor checkpoint

Deployed `c82998748ffec0236b557a5e757017cd1d0ff143` to **lp-terminal-worldsfair only**. Worker version `1f4716cc-cb15-43d5-8c52-705fd158770d`.
Live: https://lp-terminal-worldsfair.pat-862.workers.dev/

Checked **12 October 2026, 00:01:35 BST–12 October 2026, 00:05:29 BST**, including one cbBTC retry. Every row uses **0.5 SOL**, **four-hour hold**.

## Changes

- Exact cbBTC mint `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`, verified against [Coinbase](https://www.coinbase.com/cbbtc), receives a Caution freeze row: “Freeze authority: known issuer (Coinbase)”. Ticker impostors still fail.
- Two-sided funding requires an explicit Jupiter entry quote with exact raw SOL input matching the modelled token allocation. Entry = network + max(0, SOL input minus returned-token mid-value) + any separate LP deposit transfer fee. The quote already includes swap fees/impact. Missing, stale, wrong-direction, wrong-amount or zero-output quotes stay Unavailable. The actual swap principal and loss are visible separately in the fold.
- Cursor and each click ring live in one fixed, pointer-events:none, overflow:visible overlay, promoted to the browser top layer. The cursor stays circular. Each primary mouse click creates exactly one full 350 ms expanding/fading ring; it is removed on completion, with a 400 ms cleanup fallback. Reduced motion cancels/suppresses rings. Coarse pointers create no overlay and retain native behavior.
- All thresholds, $5,000 minimum, pinned SKR, slower-volume-window fee projection, exit floor and DOPE logic are unchanged. No signing or real funds.

## Default comparison: SOL-only Bid-Ask

Same twelve exact pools as the earlier checkpoint. Entry remains 0.000010 SOL because the default inventory is SOL-only. All costs and deposit below are SOL; the returnable deposit is excluded from net.

| Pool | Entry | Deposit | Exit | Net % | Cover hours | Verdict | Deciding reason |
|---|---:|---:|---:|---:|---:|---|---|
| SOL/USDC | 0.000010000 | 0.04189984 | 0.000351851 | -0.0555% | 17.13 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| CTM/SOL | 0.000010000 | 0.04189984 | 0.000048547 | -0.0112% | 87.88 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| HYPE/SOL | 0.000010000 | 0.04189984 | 0.000510018 | -0.1015% | 169.51 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| STONK/SOL | 0.000010000 | 0.04189984 | 0.000510035 | -0.0932% | 38.62 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| JUP/SOL | 0.000010000 | 0.04189984 | 0.000982641 | -0.1985% | 44,044.11 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| SKR/SOL | 0.000010000 | 0.04189984 | 0.000779452 | -0.1382% | 32.12 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (BN7C) | 0.000010000 | 0.04189984 | 0.002022000 | -0.1457% | 6.24 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (bFsV) | 0.000010000 | 0.04189984 | 0.001253781 | 0.2441% | 2.03 | Skip for now | Fee pace: Fee pace too slow |
| DOPE/SOL | 0.000010000 | 0.04189984 | 0.005210000 | 5.9068% | 0.60 | Caution | Entry and exit cost: Exit cost elevated; Top holders: Top holders unavailable; Launch spike: Price moving sharply; Floor distance: Pool too young for 24h check |
| UNCC/SOL | 0.000010000 | 0.04189984 | 0.120191022 | -24.0402% | Never | Skip for now | Liquidity under $5k. Exit costs 24.04% of this position. Thin-pool example only. |
| SOL/USDC (HTvj) | 0.000010000 | 0.04189984 | 0.000096068 | 0.0014% | 3.76 | Skip for now | Fee pace: Fee pace too slow |
| cbBTC/SOL | 0.000010000 | 0.04189984 | 0.000085060 | 0.0243% | 1.76 | Skip for now | Fee pace: Fee pace too slow |

## Two-sided entry verification: Spot

Checked **12 October 2026, 00:02:56 BST–12 October 2026, 00:04:19 BST**. Same size and hold, requested ±10% range subject to the unchanged 69-bin cap. These are separate quote observations and funding scenarios, not new default settings.

| Pool | Entry | Deposit | Exit | Net % | Cover hours | Verdict | Deciding reason |
|---|---:|---:|---:|---:|---:|---|---|
| SOL/USDC | 0.000056186 | 0.04189984 | 0.000111961 | -0.0166% | 7.92 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| CTM/SOL | 0.000037157 | 0.04189984 | 0.000035048 | -0.0139% | 105.70 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| HYPE/SOL | 0.000291804 | 0.04189984 | 0.000510001 | -0.1579% | 260.99 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| STONK/SOL | 0.000249847 | 0.04189984 | 0.000518541 | -0.1420% | 52.53 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| JUP/SOL | 0.000015000 | 0.04189984 | 0.000397000 | -0.0822% | 1,759.61 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| SKR/SOL | 0.000389767 | 0.04189984 | 0.000273188 | -0.1119% | 25.58 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (BN7C) | 0.000939555 | 0.04189984 | 0.002058000 | -0.3195% | 8.56 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (bFsV) | 0.000961719 | 0.04189984 | 0.002516251 | -0.2027% | 5.65 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| DOPE/SOL | 0.008038722 | 0.04189984 | 0.005127788 | 4.4242% | 1.49 | Caution | Entry and exit cost: Exit cost elevated; Top holders: Top holders unavailable; Launch spike: Price moving sharply; Floor distance: Pool too young for 24h check |
| UNCC/SOL | 0.000015000 | 0.04189984 | 0.119177174 | -23.8384% | Never | Skip for now | Liquidity under $5k. Exit costs 23.84% of this position. Thin-pool example only. |
| SOL/USDC (HTvj) | 0.000015000 | 0.04189984 | 0.000056765 | 0.0091% | 2.45 | Skip for now | Fee pace: Fee pace too slow |
| cbBTC/SOL | 0.000015000 | 0.04189984 | 0.000086235 | 0.0230% | 1.87 | Skip for now | Fee pace: Fee pace too slow |

## Which rows changed and why

- **cbBTC:** freeze row changed Fail → Known issuer/Caution by exact mint. Overall default verdict remains Skip, now decided by Fee pace rather than freeze authority. Its independent concentration/floor checks remain.
- **All twelve default entries and deposits:** unchanged. No paired token is bought at entry in the default SOL-only setup. Fresh exit/net/cover figures changed with observed market data, not tuned thresholds.
- **All twelve two-sided entries:** above the 0.000010 SOL one-sided fee. SOL/USDC, CTM, HYPE, STONK, SKR, both baton pools and DOPE include positive measured swap losses; JUP, UNCC, HTvj and cbBTC quotes beat the concurrent midpoint, so their conversion loss is floored at zero while 0.000015 SOL network cost remains. This is valid quote evidence, never a missing-quote fallback.
- **baton bFsVz:** default stays positive-net Skip for slow fee pace; the separately checked Spot scenario is negative-net Skip because its current entry/exit costs exceed four-hour fees.
- **DOPE:** remains Caution with unchanged logic. At this check the reasons are elevated exit cost, unavailable verified holder coverage, sharp price movement from the now-available candle check, and insufficient 24-hour floor history. The launch row now has a real Caution observation rather than an unavailable history row; no rule changed.
- **UNCC:** remains excluded from Pick a pool, TVL $231.81. Direct thin example shows real costs/deposit. Default exit is 24.0382% of the selected size. Observed fee pace is zero; “Never” means “Fees don’t cover costs”, not unavailable fees or zero hours. SKR remains pinned.

**None returned Worth a look. All 24 entry/deposit/exit/net rows are available after one cbBTC default retry.** The first cbBTC default read could not verify a concurrent exact-pool active price (or a quote/price gap within ten seconds); it correctly showed Unavailable/Caution. A single repeat succeeded. Both reads remain in local evidence.

## Validation and capture

**86 test scripts, both TypeScript checks and all five Worker runtime suites passed.** Regression coverage includes exact-mint issuer matching, all three two-sided shapes, absent/mismatched funding quotes, one ring per click, independent expiry, idempotent install, reduced motion and coarse-pointer native behavior.

Live browser verification: one fixed top-layer overlay, pointer-events:none, overflow:visible; one circular cursor; primary clicks inside a pool card and directly across its top edge. DOM samples showed exactly one ring with 0.35s duration and equal width/height, then zero remaining rings. The 2.8-second real browser capture visibly shows the whole ring across the card boundary. No animation was synthesized or slowed for this proof.

Local screen capture: `validation/worldsfair/cursor-card-edge.mp4` and single-play GIF `validation/worldsfair/cursor-card-edge.gif`. Raw frames, observed timing and DOM samples are retained locally under ignored `validation/worldsfair/cursor-edge-frames/`. The earlier cbBTC cost-fold screenshot is also retained.

These are dated paper estimates, not executed transactions or guaranteed earnings. Returnable rent is excluded from net; verified sunk setup is included. Cached RPC evidence retains source timestamps; quotes and midpoints are concurrent. No secret was read, printed or logged.

## Exact pool identities

| Pool | Address | Paired mint |
|---|---|---|
| SOL/USDC | `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| CTM/SOL | `JCLQiP7t1uxHiZHPotpUoVvPFFE48UxpkXHsVJJJvUrJ` | `C8fU5GdfAt5mnw2RK7HE6XJGFNxHpaskZMkXxdm88888` |
| HYPE/SOL | `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA` | `98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g` |
| STONK/SOL | `zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX` | `6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx` |
| JUP/SOL | `C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg` | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` |
| SKR/SOL | `BCv5Ggg5563AYfkrErdXok2hKfjgUNtQ1A4yKuNbTjQ9` | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |
| baton/SOL (BN7C) | `BN7CfsGm6Vq9w8NibLZXRGW2tp5y2axwXuLAs85NGakf` | `Hg5Ja55T5wESq4vyFoiVCMeHXtGyVA69X2UHq8hgpump` |
| baton/SOL (bFsV) | `bFsVzSMig72r5fBBTzXRpkvpbntKnj9VMrtA7EVwJrU` | `Hg5Ja55T5wESq4vyFoiVCMeHXtGyVA69X2UHq8hgpump` |
| DOPE/SOL | `FpRcdzEgiHLpo4LPTWDkhq86fCuwoejFXnmoH9cSZZ6Q` | `33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump` |
| UNCC/SOL | `6qN5X8p4Li9L7b6Lg6XPeUPjaktzdq19RYbnqhgYmaS6` | `6TTES6PoLh4rsLTPetfssWycYbxPvMv6Vnm2Nqb7pump` |
| SOL/USDC (HTvj) | `HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| cbBTC/SOL | `HDhWhQCBrSh9xNWmNtsTi86eWj3yCoEiaRodjgNydo1b` | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij` |

Stopped at the requested checkpoint.
