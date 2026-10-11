# Still accessibility and responsive checks

Checked 11 October 2026 against the local isolated worldsfair Worker. Scope: the guided Still interface, not the retained Research workspace.

## Automated result

Lighthouse 13.5.0, mobile Home audit at 13:00:29 UTC: **accessibility 100/100**, no failed automated accessibility audits. Raw local report: `/tmp/still-lighthouse-home.json`. Automated checks are not a claim of full WCAG conformance.

## Findings resolved

| Finding | Change | Evidence |
| --- | --- | --- |
| Tab could leave a modal from its last button | Cycle focus inside both native dialogs; retain Escape | Browser check: last button → Cancel in confirmation; Escape closed it |
| Amber small text lacks normal-text contrast | Ink text, original amber border/status dot | Caution token retained for large verdicts and non-text states |
| Green on tint lacks normal-text contrast | Ink risk-label/read-tick text, original pass indicator | Pass/tint ratio is 3.90; ink supplies the text contrast |
| Range sheet omitted size | Added labelled SOL field and validation | Changed to 0.1 SOL Spot ±10%; live pre-flight reran with those settings |
| Missing position marks looked like zero positions in range | Explicit Unavailable count, dated ledger count separately | Browser checked against missing market observations |
| Paper open result was easy to lose in grouped rows | Expand that pool and briefly tint its new position | Unique saved address shown after confirmation |

## Contrast

| Text | Background | Ratio |
| --- | --- | --- |
| Slate #5D6B6E | Cream #F3F0E5 | 4.85:1 |
| White | Teal #2F6F73 | 5.77:1 |
| Fail #B04A3A | Paper #FBF9F3 | 5.13:1 |
| Caution #B7862B, large verdict only | Paper #FBF9F3 | 3.09:1 |

## Manual browser checks

- Home, onboarding, pools, pre-flight, Positions, Follow, Park and Learn checked at 375px and 1280px across this staged release. No document-level horizontal overflow observed.
- Home and Follow visible interactive controls measured at least 44px in both dimensions on desktop; mobile controls, range handles, dialog inputs and links use minimum target sizes.
- Confirmation reviewed separately from the initiating click; Escape cancels. Source data are escaped before rendering.
- Navigation and inputs have accessible names. Native disclosure rows expose expanded state. Focus outlines remain visible.
- Lessons remember progress after reload; all eight are readable without account/network requests.
- Paper opening, range editing, grouped positions, Follow/custom bot, and a Backyard Park example exercised against local real public data. No real signing or funds.
- Reduced-motion CSS disables shimmer, ripple, new-position highlighting and disclosure transitions. Status includes words as well as colour.

## Limits

VoiceOver/NVDA speech output and a browser zoom-to-200% session were not separately verified. Live provider availability is variable: missing holders or complete transaction costs must stay Unavailable. Lighthouse covered Home; it did not certify the whole application.
