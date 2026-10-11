import {build,transform} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
// Preserve the supplied component order, but deliver one deferred runtime so
// mobile connections don't queue seven small scripts ahead of first paint.
export const components=['still-loader','still-reveal','still-splash','still-sheet','still-range-gauge','still-wheel','still-ticket','still-empty','still-shell','still-cursor'];
await build({stdin:{contents:components.map(name=>`import './public/motion/${name}.js';`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,outfile:'public/still-app-motion.js'});
const styles=await Promise.all(['public/fonts/still-fonts.css','public/motion/still-motion.css','public/motion/still-water.css','public/still-demo.css','public/still-v6.css'].map(path=>readFile(path,'utf8')));
const css=await transform(styles.join('\n'),{loader:'css',minify:true,target:['chrome115','safari17','firefox120']});
await writeFile('public/still-app.css',css.code);
console.log('Still component runtime and styles bundled locally.');
