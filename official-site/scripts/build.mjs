import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../public/assets/',import.meta.url),{recursive:true});
await mkdir(new URL('../public/assets/fonts/',import.meta.url),{recursive:true});
for(const name of ['BrivanyEditorial-Light.woff2','BrivanyEditorial-Regular.woff2','BrivanyEditorial-Medium.woff2','LICENSE-AND-ATTRIBUTION.txt'])await copyFile(new URL('../../web/fonts/'+name,import.meta.url),new URL('../public/assets/fonts/'+name,import.meta.url));
await build({entryPoints:['src/app.js','src/audio-worker.js'],bundle:true,format:'esm',target:'es2022',minify:true,sourcemap:false,outdir:'public/assets',legalComments:'linked'});
console.log('Brivany: recursos de presentación compilados.');
