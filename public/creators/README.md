# Public creator profile assets

Retrieved 11 October 2026. These are the creators' real public profile avatars, not generated portraits. Each JPEG is the unchanged 48 × 48 `normal` image from X's `pbs.twimg.com` image CDN, intended to display as a round 40 × 40 image. All five images together are 10,631 bytes.

The current X profile pages returned HTTP 403 in this environment. Official X follow-button syndication returned an empty response and the tweet syndication probe returned an empty object. Public FxTwitter profile metadata then returned each exact matching `screen_name`, `https://x.com/…` profile URL, display name and X-CDN avatar URL. Display names were also consistent with public indexed profile records. This is public metadata retrieved through a third-party proxy, not a claim that direct X metadata was available. No sign-in, cookies, private profile access or outreach was used.

`provenance.json` records each original X image URL, metadata endpoint, retrieval time, byte count and SHA-256 hash. `../still-creators.js` is the UI manifest. Display names are preserved as observed: **molu**, **Razzaer**, **Eys**, **Jaypee**, **vladimir**. The manifest keys retain the supplied handle casing.

## UI contract

- Render each image at 40 × 40 with a round crop. Keep the display name and linked handle next to it.
- Always show “Inspired by public posts. Not endorsed.” and “Request removal” beside the attribution. These images do not mean partnership, verification or endorsement.
- If an image is missing or fails to load, show the manifest's plain initials on the Shallows background. Keep the same name, handle and attribution. Do not invent or generate a replacement face.
- Names and avatars are a dated snapshot. To refresh them, confirm the exact handle and source, update the static bytes and provenance together, and keep the same fallback behavior.
- A removal request should remove the portrait and use the neutral initials fallback while the request is reviewed. Do not replace the public-source attribution with a claim of endorsement.

Public profile links: [molu](https://x.com/molusol), [Razzaer](https://x.com/razzaer), [Eys](https://x.com/Eyyyys), [Jaypee](https://x.com/Jaypee_Sol), [vladimir](https://x.com/VladimirKovacs).
