import {build} from 'esbuild';
// This separate browser bundle contains only the fixed devnet Memo flow.
// The existing mainnet execution bundle remains excluded from the Paper demo.
await build({entryPoints:['src/worldsfair-devnet-client.ts'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:'public/worldsfair-devnet.js',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
