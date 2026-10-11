import {readFile} from 'node:fs/promises';
const css=await readFile('public/motion/still-motion.css','utf8');
const rgb=s=>s.startsWith('#')?s.slice(1).match(/../g).map(v=>parseInt(v,16)):s.match(/[\d.]+/g).map(Number);
const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
let failed=0;
for(const theme of ['dawn','noon','dusk','midnight']){const block=css.match(new RegExp('\\[data-still-theme="'+theme+'"\\]\\{([^}]+)'))[1],tokens=Object.fromEntries([...block.matchAll(/--still-([\w-]+):([^;]+);/g)].map(m=>[m[1],m[2]]));const pages=[...tokens.bg.matchAll(/#[\da-f]{6}/gi)].map(m=>rgb(m[0]));let min=99,who='';
 for(const page of pages){const backgrounds=[page,blend(rgb(tokens.glass),page),rgb(tokens['glass-solid']),blend(rgb(tokens.sheet),page)];for(const bg of backgrounds){for(const key of ['text','text-2','live','pass','caution','fail']){const ink=rgb(tokens[key]),bases=[bg];if(['pass','caution','fail'].includes(key))bases.push(blend([...ink,.1],bg));for(const base of bases){const score=contrast(ink,base);if(score<min){min=score;who=key;}if(score<4.5)failed++;}}}}
 const button=contrast(rgb(tokens.btn),rgb(tokens['btn-text']));console.log(theme,{worst:min.toFixed(2),token:who,button:button.toFixed(2)});
}
process.exitCode=failed?1:0;
