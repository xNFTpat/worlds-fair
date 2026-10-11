# Still: exit floor and visible verdict checkpoint

Deployed commit: `fb7574e9918a955e628ed1b3f36ee1a7d8f4ef56`.
Worker: `lp-terminal-worldsfair`; version `da737234-40a5-48ae-8451-d0ddd008fed9`.
Live: https://lp-terminal-worldsfair.pat-862.workers.dev/

Checked **11 October 2026, 23:11:03–23:13:52 BST**, at **0.5 SOL**, default SOL-only Bid-Ask, **four-hour hold**. The twelve addresses are the same comparison set as the previous checkpoint; the live picker still contains at most eight volume-ranked eligible pools including pinned SKR.

## Live results

| Pool | Entry SOL | Returnable deposit SOL | Exit SOL | Net % | Cover hours | Verdict | Deciding reason |
|---|---:|---:|---:|---:|---:|---|---|
| SOL/USDC | 0.000010 | 0.04189984 | 0.000109920 | -0.0051% | 5.09 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| CTM/SOL | 0.000010 | 0.04189984 | 0.000083472 | -0.0181% | 136.01 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| HYPE/SOL | 0.000010 | 0.04189984 | 0.000510000 | -0.0946% | 44.28 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| STONK/SOL | 0.000010 | 0.04189984 | 0.000510125 | -0.0906% | 31.01 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| JUP/SOL | 0.000010 | 0.04189984 | 0.000568541 | -0.1157% | 43,152.53 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| SKR/SOL | 0.000010 | 0.04189984 | 0.000549719 | -0.0889% | 19.45 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (BN7C) | 0.000010 | 0.04189984 | 0.002310000 | -0.1149% | 5.32 | Skip for now | Entry and exit cost: fees do not cover costs in 4 hours. |
| baton/SOL (bFsV) | 0.000010 | 0.04189984 | 0.001260000 | +0.3134% | 1.79 | Skip for now | Fee pace: Fee pace too slow |
| DOPE/SOL | 0.000010 | 0.04189984 | 0.009090898 | +4.4069% | 1.17 | Caution | Entry and exit cost: Exit cost elevated; Top holders: Top holders unavailable; Launch spike: Pool too young for 6h check; Floor distance: Pool too young for 24h check |
| UNCC/SOL | 0.000010 | 0.04189984 | 0.157592497 | -31.5205% | Never | Skip for now | Liquidity under $5k. Exit costs 31.52% of this position. Thin-pool example only. |
| SOL/USDC (HTvj) | 0.000010 | 0.04189984 | 0.000202208 | +0.0041% | 3.64 | Skip for now | Fee pace: Fee pace too slow |
| cbBTC/SOL | 0.000010 | 0.04189984 | 0.000139360 | +0.0175% | 2.52 | Skip for now | Freeze authority: active authority can freeze token accounts. |

**No pool returned Worth a look. All twelve entry, deposit, exit and net figures were available after one JUP retry.** JUP initially lacked verified mint-policy/decimal evidence; the repeat read succeeded. No network-only exit fallback was used. UNCC has observed zero fee pace, so the UI says “Fees don’t cover costs”, not zero hours or unavailable costs. JUP’s very long recovery follows its measured, extremely low conservative fee pace.

## What changed

- The exact-pool active price and Jupiter quote are fetched concurrently; their timestamps must be within ten seconds. Cached old midpoint data cannot value a new quote. Exit conversion is the greater of token mid-value minus quoted SOL proceeds and the selected pool’s observed base plus dynamic fee on that token value. Network fees and any separate LP withdrawal transfer fee are added. Quotes that beat mid retain the positive floor and show the grey “Better than mid” note; SOL/USDC (5rCf1) did so during this check.
- Cover times below one minute display “Under 1 min”. All Pre-flight check rows now have visible status chips and short reasons outside the detailed fold. Overall deciding reasons appear on both pool cards and tickets. Positive net does not override another failed check; baton bFsVz visibly names “Fee pace too slow”.
- Under-$5k eligibility stays unchanged, but readable direct-view thin examples can calculate their real paper costs and chain-read deposit without being eligible to open. UNCC is absent from the picker and cannot open a paper position.
- No thresholds, Known issuer rules, pinned SKR identity, $5,000 minimum or slower-window fee projection changed. No signing or real funds.

## DOPE: why Caution remains

DOPE’s exact pool is `FpRcdzEgiHLpo4LPTWDkhq86fCuwoejFXnmoH9cSZZ6Q`. Four checks decide its Caution:

1. **Entry and exit cost:** 0.009090898 SOL exit is **1.8182%** of the position, inside the existing caution band above 1% and at most 3%.
2. **Top holders:** verified holder coverage is incomplete; concentration cannot be cleared. This is unknown evidence, not an invented concentration result.
3. **Launch spike:** the pool was about **4.46 hours old**, too young for the required six-hour candle window.
4. **Floor distance:** the same pool has insufficient history for the required 24-hour window.

These are genuine cost/evidence cautions; no threshold or flag was removed to force a pass. The labels now say young **pool**, not unverified token age. The separate “If price halves” stress row is Fail, but it is not an overall-verdict trigger under the unchanged rules.

## Hidden by the liquidity minimum

**UNCC/SOL only in this twelve-pool set:** TVL **$40.80** at this check. Exit was **31.5185%** of the 0.5 SOL position, rather than the earlier approximate 28%. Its direct view leads with “Liquidity under $5k” and actual exit cost; entry and deposit are available. Other pools may be absent from the eight-entry picker because of current volume ranking, not this minimum. SKR remains pinned.

Direct thin example: https://lp-terminal-worldsfair.pat-862.workers.dev/?pool=6qN5X8p4Li9L7b6Lg6XPeUPjaktzdq19RYbnqhgYmaS6#preflight

## Evidence and limits

Amounts are dated read-only paper estimates, not executed trades or promised earnings. Refundable position rent is excluded from net; verified non-refundable setup is included (zero across this check). Network templates and holder/token-policy evidence retain their original timestamps and up-to-ten-minute caching. Concurrent quote/mid and fee-floor reads have separate fresh source timestamps. Fee projection remains capped by the slower of hourly volume and daily volume / 24.

All **85 script tests**, **both TypeScript checks**, and **five Worker runtime suites** passed. Live browser checks verified the deployed SHA, direct UNCC view, visible check chips and positive-net baton’s visible Skip reason. Raw dated responses and screenshot are retained locally in ignored `validation/worldsfair/`; no secrets were read or logged.

## Exact pool identities

| Pool | Address |
|---|---|
| SOL/USDC | `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` |
| CTM/SOL | `JCLQiP7t1uxHiZHPotpUoVvPFFE48UxpkXHsVJJJvUrJ` |
| HYPE/SOL | `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA` |
| STONK/SOL | `zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX` |
| JUP/SOL | `C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg` |
| SKR/SOL | `BCv5Ggg5563AYfkrErdXok2hKfjgUNtQ1A4yKuNbTjQ9` |
| baton/SOL (BN7C) | `BN7CfsGm6Vq9w8NibLZXRGW2tp5y2axwXuLAs85NGakf` |
| baton/SOL (bFsV) | `bFsVzSMig72r5fBBTzXRpkvpbntKnj9VMrtA7EVwJrU` |
| DOPE/SOL | `FpRcdzEgiHLpo4LPTWDkhq86fCuwoejFXnmoH9cSZZ6Q` |
| UNCC/SOL | `6qN5X8p4Li9L7b6Lg6XPeUPjaktzdq19RYbnqhgYmaS6` |
| SOL/USDC (HTvj) | `HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR` |
| cbBTC/SOL | `HDhWhQCBrSh9xNWmNtsTi86eWj3yCoEiaRodjgNydo1b` |

Stopped at the requested checkpoint.
