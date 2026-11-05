import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('../public/assets/',import.meta.url),{recursive:true});
await build({entryPoints:['src/app.js','src/audio-worker.js'],bundle:true,format:'esm',target:'es2022',minify:true,sourcemap:false,outdir:'public/assets',legalComments:'linked'});
console.log('Brivany: recursos de presentación compilados.');
