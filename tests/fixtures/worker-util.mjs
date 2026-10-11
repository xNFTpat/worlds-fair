// Anchor’s UTF-8 reader uses Node util only to obtain these standard globals.
// Miniflare provides both; Wrangler supplies the production nodejs_compat shim.
export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;
