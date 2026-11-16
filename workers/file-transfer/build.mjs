import {readFile,writeFile} from 'node:fs/promises';
const files={HTML:'client/index.html',CSS:'client/phone.css',JS:'client/phone.js',DROP_HTML:'client/drop.html',DROP_CSS:'client/drop.css',DROP_JS:'client/drop.js',DROP_EDGE:'client/drop-edge.js',DROP_LOCALE:'client/drop-locales.js',DROP_STORAGE:'client/drop-storage-worker.js',DROP_PEER:'../../desktop/experience/drop-peer.js'};
let out='// Generated from the adjacent client source; no private data.\n';
for(const [name,path]of Object.entries(files))out+='export const '+name+'='+JSON.stringify(await readFile(new URL(path,import.meta.url),'utf8'))+';\n';
await writeFile(new URL('src/assets.mjs',import.meta.url),out);
