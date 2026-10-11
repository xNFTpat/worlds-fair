# Still quote and fee-projection checkpoint

Checked **11/10/2026, 22:42:57 BST – 11/10/2026, 22:44:05 BST**.

Deployed code: `1e12f7eb53ab9b1d8d4859dd6d1cc09771beb484`. Worker: `lp-terminal-worldsfair` only. Live: https://lp-terminal-worldsfair.pat-862.workers.dev/

Same twelve pool addresses as the previous checkpoint, 0.5 SOL each, default SOL-only Bid-Ask range and four-hour hold. Entry, deposit and exit columns are SOL. Refundable deposit excluded from net; verified sunk setup included. All available setup observations were zero.

| Pool | Entry | Deposit | Exit | Net after 4h | Hours to cover | Verdict |
|---|---:|---:|---:|---:|---:|---|
| SOL/USDC | 0.00001000 | 0.04189984 | -0.000063747 | 0.0293% | 0.00 | Skip for now |
| CTM/SOL | 0.00001000 | 0.04189984 | 0.000035019 | -0.0085% | 69.65 | Skip for now |
| HYPE/SOL | 0.00001000 | 0.04189984 | -0.000039225 | 0.0172% | 0.00 | Skip for now |
| STONK/SOL | 0.00001000 | 0.04189984 | -0.000107169 | 0.0300% | 0.00 | Skip for now |
| JUP/SOL | 0.00001000 | 0.04189984 | 0.001209571 | -0.2363% | 127.64 | Skip for now |
| SKR/SOL | 0.00001000 | 0.04189984 | 0.000570356 | -0.0933% | 20.40 | Skip for now |
| baton/SOL (BN7C) | 0.00001000 | 0.04189984 | 0.002022001 | -0.0890% | 5.12 | Skip for now |
| baton/SOL (bFsV) | 0.00001000 | 0.04189984 | 0.001566251 | 0.1748% | 2.57 | Skip for now |
| DOPE/SOL | 0.00001000 | 0.04189984 | 0.005210001 | 3.2070% | 0.98 | Caution |
| UNCC/SOL | Unavailable | Unavailable | 0.141015899 | Unavailable | Unavailable | Skip for now |
| SOL/USDC (HTvj) | 0.00001000 | 0.04189984 | 0.000025319 | 0.0419% | 0.58 | Skip for now |
| cbBTC/SOL | 0.00001000 | 0.04189984 | 0.000060574 | 0.0316% | 1.23 | Skip for now |

**0/12 exit quotes unavailable; 1/12 rows has incomplete entry/deposit/net/recovery: UNCC/SOL.** Meteora reported UNCC TVL of $566.21 at 11/10/2026, 22:43:12 BST, below the unchanged $5,000 eligibility floor. A quote can still price a token sale, but no valid eligible paper range or setup can be built; entry, deposit and net remain Unavailable. The Worker logs bounded quote and incomplete-preflight reasons, never credentials.

**None returned Worth a look.** DOPE returned Caution with missing holder/candle evidence; other rows returned Skip for now. Unavailable safety checks are distinct from complete cost figures.

Negative exit values reflect Jupiter returning more SOL than the token input's dated pool mid-value, after the declared network and withdrawal charges. They are signed execution differences, not negative protocol fees or guaranteed profits. Already-covered signed costs display zero recovery hours. A fresh quote can change these figures.

## Baton recheck

`bFsVzSMig72r5fBBTzXRpkvpbntKnj9VMrtA7EVwJrU` returned 0.1748% net over four hours, 2.57 hours to cover costs, and Skip for now. Its capped hourly fee/TVL pace was 0.1225%, below the unchanged screening pass/caution bands. A nearby Meteora observation had $208271.74 one-hour volume versus $45408.84 hourly daily-average volume; the slower daily-average pace therefore capped the model. These live observations differ in time from the earlier +7.08% estimate.

## Validation and scope

85 test scripts, both TypeScript checks and five real local Worker runtime suites passed. The final cache-age correction also passed targeted quote/preflight regressions and both type checks. Browser check confirmed numeric SOL/USDC net/costs, capped-fee source wording, and the Known issuer caution.

Direct single-leg Jupiter quotes accept valid amounts without optional per-hop fee/impact/route-plan fields; entry and exit use signed mid-value differences. Tests cover missing optional fields, stale/malformed data, fee projection cap, favourable execution, fee recovery, exact two-sided funding, refundable rent and separately capped Token-2022 transfers. Existing thresholds, Known issuer identity, SKR pin, motion and wallet scope are unchanged.

## Pool identities and verdict reasons

- **SOL/USDC** — `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`: Fees are 0.0046% of TVL an hour. Cost recovery at this pace: 0 hours. Planned hold: 4 hours.
- **CTM/SOL** — `JCLQiP7t1uxHiZHPotpUoVvPFFE48UxpkXHsVJJJvUrJ`: The estimated entry, exit and setup costs eat the fees for this planned hold at the current pool pace.
- **HYPE/SOL** — `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA`: Fees are 0.0028% of TVL an hour. Cost recovery at this pace: 0 hours. Planned hold: 4 hours.
- **STONK/SOL** — `zxTpi4BtaWX3mgdAPoezkMD1hxx8CdeCfrqXMWvSCLX`: Fees are 0.0026% of TVL an hour. Cost recovery at this pace: 0 hours. Planned hold: 4 hours.
- **JUP/SOL** — `C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg`: The estimated entry, exit and setup costs eat the fees for this planned hold at the current pool pace.
- **SKR/SOL** — `BCv5Ggg5563AYfkrErdXok2hKfjgUNtQ1A4yKuNbTjQ9`: The estimated entry, exit and setup costs eat the fees for this planned hold at the current pool pace.
- **baton/SOL (BN7C)** — `BN7CfsGm6Vq9w8NibLZXRGW2tp5y2axwXuLAs85NGakf`: The estimated entry, exit and setup costs eat the fees for this planned hold at the current pool pace.
- **baton/SOL (bFsV)** — `bFsVzSMig72r5fBBTzXRpkvpbntKnj9VMrtA7EVwJrU`: Fees are 0.1225% of TVL an hour. Cost recovery at this pace: 2.5733 hours. Planned hold: 4 hours.
- **DOPE/SOL** — `FpRcdzEgiHLpo4LPTWDkhq86fCuwoejFXnmoH9cSZZ6Q`: Paper costs are estimated; review the caution or unavailable checks before practising.
- **UNCC/SOL** — `6qN5X8p4Li9L7b6Lg6XPeUPjaktzdq19RYbnqhgYmaS6`: A current price and a valid range are needed before this paper position can be modelled.
- **SOL/USDC (HTvj)** — `HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR`: Fees are 0.0122% of TVL an hour. Cost recovery at this pace: 0.5771 hours. Planned hold: 4 hours.
- **cbBTC/SOL** — `HDhWhQCBrSh9xNWmNtsTi86eWj3yCoEiaRodjgNydo1b`: The token has an active freeze authority. Practice is available, but this screen does not support a real deposit.

Stopped at the requested checkpoint.
