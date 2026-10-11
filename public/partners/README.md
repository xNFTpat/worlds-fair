# Official Still identification assets

Logos belong to their owners. Still is not affiliated.

These are downloaded original files, with no recolouring or redrawing. `asset-provenance.json` records each official site or mint-matched metadata endpoint, original image URL, retrieval time, file size and SHA-256 digest. The browser registry is `../still-assets.js`; its lookup helpers only return local assets and never fetch a remote fallback.

- Meteora: the **full logo on white** SVG from the official MeteoraAg brand-kit repository linked by Meteora’s documentation. The source is pinned to the retrieved Git commit.
- Cesto: the green official favicon from its own website, plus the original white-and-green wordmark. The wordmark requires a dark background; do not recolour it for the cream interface.
- Backyard: the original metallic leaf SVG referenced by the official backyard.finance site bundle. Keep its original gradients.
- Tokens: identity is the full Solana mint address, never a ticker. Sources are Cesto’s public token catalogue or Jupiter’s public mint-matched token metadata. Inclusion is identification, not verification of safety or issuer rights.

Coverage: current eight Still pool cards (seven distinct paired mints), common Cesto/staking tokens, and tokens in the first three alphabetical Cesto basket allocations plus Solana Maxi. USELESS metadata was found but both public IPFS gateways returned HTTP 403; its local image is deliberately absent. Display the same neutral circle used for any unknown or newly listed mint. The optional TRUMP image preserves the original 1.53 MB file; load it lazily and only when its basket is shown.

To refresh, read the current public metadata, require an exact mint match, download the image into `public/tokens/<mint>.<format>`, inspect it, reject active or externally referencing SVGs, and update the registry and provenance together. Preserve original bytes and genuine colours. Do not use logos or source claims from ticker search alone.
