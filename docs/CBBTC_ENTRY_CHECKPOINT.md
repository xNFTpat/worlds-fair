# Still: Coinbase issuer and exact entry funding checkpoint

Deployed commit: `fd1d040bf5533b056bad730a7de3fc69e227780a`.
Worker: `lp-terminal-worldsfair`; version `f5c2e2be-e5ec-489b-9733-5fb9efda06e7`.
Live: https://lp-terminal-worldsfair.pat-862.workers.dev/

Checked **11 October 2026, 23:52:18–23:55:07 BST**, at **0.5 SOL** and a **four-hour hold**. No signing or real funds.

## Changes and comparison

- cbBTC is matched only by `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`, verified against [Coinbase’s official cbBTC page](https://www.coinbase.com/cbbtc). Its freeze row is Caution and says “Freeze authority: known issuer (Coinbase)”. Another mint using the same ticker still fails an active freeze-authority check.
- The previous flat entry column was the default SOL-only Bid-Ask setup, which buys no paired token. That setup correctly remains 0.000010 SOL. The existing two-sided calculation already quoted funding; this pass additionally requires an explicit entry direction and exact raw SOL input matching the actual range allocation, and rejects zero token output. No missing or mismatched quote becomes a network-only entry.
- The cost fold now shows SOL exchanged, quoted entry swap cost and network fees separately. Two-sided entry is max(0, SOL input minus received-token value at the concurrent pool midpoint), plus network fees and any separate deposit transfer fee. Jupiter proceeds already include swap fees and price impact. A favourable valid quote can give zero conversion loss; it is not a quote failure or invented zero.
- All twelve default entry amounts and returnable deposits are unchanged. cbBTC’s freeze check changed Fail → Caution; its overall Skip now names Fee pace, rather than freeze authority. Its independent concentration and floor failures remain. Other live exit/net/recovery changes reflect new prices, quotes and observed fee pace.
- Thresholds, the $5,000 minimum, pinned SKR, slower-volume-window projection, exit-cost floor and DOPE Caution logic are unchanged. All twelve default verdict labels stayed the same; no pool returned Worth a look.

## Comparable default table: SOL-only Bid-Ask

Checked 23:52:18–23:53:40 BST. Costs and deposit are SOL; returnable deposit is excluded from net.

| Pool | Entry | Deposit | Exit | Net % | Cover hours | Verdict | Deciding reason |
|---|---:|---:|---:|---:|---:|---|---|
| SOL/USDC | 0.000010000 | 0.04189984 | 0.000111045 | -0.0073% | 5.71 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| CTM/SOL | 0.000010000 | 0.04189984 | 0.000048548 | -0.0111% | 78.76 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| HYPE/SOL | 0.000010000 | 0.04189984 | 0.000510000 | -0.1018% | 190.11 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| STONK/SOL | 0.000010000 | 0.04189984 | 0.000510001 | -0.0969% | 58.56 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| JUP/SOL | 0.000010000 | 0.04189984 | 0.001027544 | -0.2075% | 46,248.23 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| SKR/SOL | 0.000010000 | 0.04189984 | 0.000383061 | -0.0588% | 15.88 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (BN7C) | 0.000010000 | 0.04189984 | 0.002058000 | -0.0582% | 4.66 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (bFsV) | 0.000010000 | 0.04189984 | 0.001266251 | 0.3161% | 1.79 | Skip for now | Fee pace: Fee pace too slow |
| DOPE/SOL | 0.000010000 | 0.04189984 | 0.009210659 | 5.1186% | 1.06 | Caution | Entry and exit cost: Exit cost elevated; Top holders: Top holders unavailable; Launch spike: Pool too young for 6h check; Floor distance: Pool too young for 24h check |
| UNCC/SOL | 0.000010000 | 0.04189984 | 0.142723223 | -28.5466% | Never | Skip for now | Liquidity under $5k. Exit costs 28.54% of this position. Thin-pool example only. |
| SOL/USDC (HTvj) | 0.000010000 | 0.04189984 | 0.000039493 | 0.0226% | 1.22 | Skip for now | Fee pace: Fee pace too slow |
| cbBTC/SOL | 0.000010000 | 0.04189984 | 0.000085040 | 0.0242% | 1.76 | Skip for now | Fee pace: Fee pace too slow |

## Explicit two-sided Spot table

Checked 23:53:41–23:54:54 BST. Same twelve exact pools, 0.5 SOL and four-hour hold. Requested range ±10%, subject to the unchanged 69-bin grid cap; actual range may be narrower. This is a separate funding scenario, not a silent change to the default.

| Pool | Entry | Deposit | Exit | Net % | Cover hours | Verdict | Deciding reason |
|---|---:|---:|---:|---:|---:|---|---|
| SOL/USDC | 0.000060705 | 0.04189984 | 0.000110534 | -0.0173% | 8.07 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| CTM/SOL | 0.000037157 | 0.04189984 | 0.000035048 | -0.0138% | 93.98 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| HYPE/SOL | 0.000526560 | 0.04189984 | 0.000510000 | -0.2044% | 287.28 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| STONK/SOL | 0.000389851 | 0.04189984 | 0.000512067 | -0.1724% | 90.81 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| JUP/SOL | 0.000015000 | 0.04189984 | 0.001053403 | -0.2137% | 47,623.77 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| SKR/SOL | 0.000015000 | 0.04189984 | 0.000625627 | -0.1063% | 23.45 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (BN7C) | 0.001153892 | 0.04189984 | 0.002022000 | -0.2811% | 7.18 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (bFsV) | 0.001181518 | 0.04189984 | 0.001266251 | 0.1049% | 3.29 | Skip for now | Fee pace: Fee pace too slow |
| DOPE/SOL | 0.000015000 | 0.04189984 | 0.005210000 | 6.1670% | 0.58 | Caution | Entry and exit cost: Exit cost elevated; Top holders: Top holders unavailable; Launch spike: Pool too young for 6h check; Floor distance: Pool too young for 24h check |
| UNCC/SOL | 0.000015000 | 0.04189984 | 0.142873499 | -28.5777% | Never | Skip for now | Liquidity under $5k. Exit costs 28.57% of this position. Thin-pool example only. |
| SOL/USDC (HTvj) | 0.000015000 | 0.04189984 | 0.000038423 | 0.0217% | 1.32 | Skip for now | Fee pace: Fee pace too slow |
| cbBTC/SOL | 0.000024063 | 0.04189984 | 0.000085040 | 0.0214% | 2.02 | Skip for now | Fee pace: Fee pace too slow |

All twelve two-sided entries exceed the default 0.000010 SOL, because the funding swap adds one network fee plus its observed conversion loss where positive. JUP, SKR, DOPE, UNCC and HTvj had favourable exact-size quote proceeds, so their conversion loss was floored at zero; their total entry was still 0.000015 SOL.

## Exact two-sided funding evidence

| Pool / shape | SOL exchanged | Swap loss SOL | Entry network SOL | Total entry SOL |
|---|---:|---:|---:|---:|
| SOL/USDC / spot | 0.250000000 | 0.000045705 | 0.000015000 | 0.000060705 |
| CTM/SOL / spot | 0.221153846 | 0.000022157 | 0.000015000 | 0.000037157 |
| HYPE/SOL / spot | 0.250000000 | 0.000511560 | 0.000015000 | 0.000526560 |
| STONK/SOL / spot | 0.250000000 | 0.000374851 | 0.000015000 | 0.000389851 |
| JUP/SOL / spot | 0.221153846 | 0.000000000 | 0.000015000 | 0.000015000 |
| SKR/SOL / spot | 0.250000000 | 0.000000000 | 0.000015000 | 0.000015000 |
| baton/SOL (BN7C) / spot | 0.221153846 | 0.001138892 | 0.000015000 | 0.001153892 |
| baton/SOL (bFsV) / spot | 0.232142857 | 0.001166518 | 0.000015000 | 0.001181518 |
| DOPE/SOL / spot | 0.221153846 | 0.000000000 | 0.000015000 | 0.000015000 |
| UNCC/SOL / spot | 0.226190476 | 0.000000000 | 0.000015000 | 0.000015000 |
| SOL/USDC (HTvj) / spot | 0.250000000 | 0.000000000 | 0.000015000 | 0.000015000 |
| cbBTC/SOL / spot | 0.250000000 | 0.000009063 | 0.000015000 | 0.000024063 |
| cbBTC/SOL / curve | 0.250000000 | 0.000024112 | 0.000015000 | 0.000039112 |
| cbBTC/SOL / bidask | 0.250000000 | 0.000046685 | 0.000015000 | 0.000061685 |

## Availability and unchanged safeguards

All 26 checks (12 default, 12 Spot, cbBTC Curve and two-sided Bid-Ask) returned entry, deposit, exit and net figures. No cost/net rows were Unavailable. UNCC has zero observed fee pace: “Never” means the UI says “Fees don’t cover costs”, not a missing cost. It remains excluded from Pick a pool by the $5,000 minimum and available only as a direct thin example. SKR remains pinned.

DOPE remains Caution under the same logic: exit cost elevated, holder coverage unavailable, pool history too short for six-hour launch-spike and 24-hour floor checks. No flag was removed. The default DOPE exit cost was 1.8421% of the position.

All 85 script tests, both TypeScript checks and all five Worker runtime suites passed in one complete verification run. Regression coverage exercises all three shapes with two-sided and SOL-only inventory; absent, stale, mismatched-amount, wrong-direction and zero-output funding quotes remain unavailable. Live UI verified the Coinbase row and a two-sided cbBTC funding swap with separate swap/network evidence.

Raw source timestamps, public responses, deployment receipt and screenshot are retained locally under ignored `validation/worldsfair/`. Network templates retain their original timestamps and ten-minute cache limit. Quotes and comparison midpoints are concurrent. These are dated paper estimates, not executed transactions or guaranteed earnings. No secret was read, printed or logged.

## Exact identities

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
