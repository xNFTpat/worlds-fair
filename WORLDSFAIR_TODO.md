# Still · remaining work

Product: **Still — Clarity before capital.** Public repository: [xNFTpat/worlds-fair](https://github.com/xNFTpat/worlds-fair). The original LP Terminal repository remains private.

## Release checks

- [ ] Finish the final Still mobile pass at **390 × 844** and desktop pass on the release build. Check empty, loading, unavailable, filled paper portfolio and confirmation-dialog states; retain dated evidence.
- [ ] Run the complete verification suite in the sanitized public repository, commit and push, deploy only through the guarded demo script, and verify public `/api/version` and the footer match the intended real SHA.
- [ ] Confirm the original `lp-agg` Worker remains unchanged with a fresh release check. An earlier recorded version is not current evidence.
- [ ] Manually exercise one optional **Phantom devnet Memo**: enable testnet mode, use devnet SOL, review both consent steps, confirm the exact Memo and open its devnet Explorer link. Check rejection and same-transaction retry too. This needs the user's wallet interaction; automated fixtures do not count as a real signing session.
- [ ] Check a real public-provider basket purchase, valuation refresh and eligible profit roll on the final demo. Distinguish live provider output from local synthetic fixtures; use labelled manual Paper SOL if no shared-strategy close is eligible.

There is **no missing Jupiter key blocker**. Public quote and Price reads are supported with the shared keyless allowance. A dedicated `JUPITER_API_KEY` or read-only `SOLANA_RPC` is an optional reliability/capacity improvement for the separate demo. No wallet private key or owner credential is required.

## Submission assets — bank for the final pass

- [ ] Polish the chosen Still logo and export the upload-ready asset; upload it to the Colosseum project when ready.
- [ ] Record a **product demo of at most three minutes**, preferably with Loom, using the actual product. Show pre-flight, a range scenario, paper portfolio flow and honest devnet status. Do not present a synthetic fixture as live activity or a completed real signing flow.
- [ ] Record a **separate founder pitch of at most two minutes**. Keep it distinct from the product walkthrough.
- [ ] Confirm the X profile to use in the submission. Do not infer it from inherited project branding.
- X handle shortlist: `@easylp` and `@stilllp`. On 5 October 2026, the user reported that neither appeared to exist on X; verify availability before choosing or reserving one. Product name remains Still.
- [ ] Add final video links, logo, public repository and demo URL to the submission fields; check reviewer access without unexpected permission requests.
- [ ] Review the complete Colosseum entry, prior-work disclosure and links with the user before submitting. **Final review and submission have not been performed.**

The supplied brief targets **22:00 UK Monday 12 October 2026**, with a stated hard close of **07:59 UK Tuesday 13 October**, and a feature freeze at midday Saturday 10 October. Recheck the current submission form's deadline before the final send.

## Provenance and publication

- [ ] If another private repository or backup has the missing September Git history, reconcile it before making more precise before/after-cutoff claims. Missing history is not permission to fabricate it.
- [ ] Confirm the public export contains only sanitized source and synthetic test fixtures, without private history, personal wallet data, archives, credentials or original deployment settings.

In the private development repository, `worldsfair-baseline` and `pre-worldsfair-fork` both point to `bccf1bb049dc58381a60b87356bde729a6b8fd06` (4 September 2026). The later supplied working source had no matching history and was imported on 5 October. Existing research, range maths, market integrations and strategy foundations are inherited; their exact relationship to the **14 September 2026, 14:00 UK** cutoff cannot be proved from the available commits. Task SHAs in the changelog identify private development work; the public repository starts a fresh, disclosed snapshot history.

## Deliberately cut

- Optional devnet SPL receipt token, custom Anchor vault, Squads integration and live Cesto deposits.
- Mainnet money actions remain outside this paper/devnet demo.

Keep user-dependent checks and remaining product decisions here while implementation continues.
