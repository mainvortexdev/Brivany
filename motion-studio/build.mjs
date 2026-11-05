import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
for(const [source,globalName,file] of [['vendor.js','BrivanyMotionLibraries','vendor.min.js'],['runtime.js','BrivanyMotion','runtime.js']]){
 await build({entryPoints:[new URL('./src/'+source,import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,format:'iife',globalName,target:'chrome120',minify:true,legalComments:'eof',outfile:new URL('./dist/'+file,import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
}
