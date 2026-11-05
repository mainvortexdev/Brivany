import {build} from '../../../official-site/node_modules/esbuild/lib/main.js';
import {readFile,writeFile} from 'node:fs/promises';
await build({entryPoints:[new URL('./results.jsx',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],outfile:new URL('../workspace-results.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),bundle:true,format:'iife',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'external',jsx:'automatic'});
const licenses=await Promise.all(['glisse','react','react-dom'].map(async name=>'\n\n'+name+'\n'+await readFile(new URL('./node_modules/'+name+'/LICENSE',import.meta.url),'utf8')));
// The native UI disallows inline stylesheet injection. Serve Glisse's own
// stylesheet locally and reserve its id so the runtime does not insert it.
await writeFile(new URL('../glisse.css',import.meta.url),await readFile(new URL('./node_modules/glisse/dist/styles.css',import.meta.url),'utf8'),'utf8');
await writeFile(new URL('../workspace-results.LICENSE.txt',import.meta.url),'Brivany result viewer dependencies'+licenses.join(''),'utf8');
console.log('Glisse result viewer compiled locally.');
