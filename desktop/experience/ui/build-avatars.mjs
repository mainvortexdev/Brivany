import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const here=new URL('./',import.meta.url),target=new URL('../',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('node_modules/blobatar/package.json',here),'utf8'));
if(pkg.version!=='2.7.0')throw Error('Review the pinned Blobatar adapter before changing its version.');
const compiled=await build({entryPoints:[fileURLToPath(new URL('agent-avatars.js',here))],
 outfile:fileURLToPath(new URL('agent-avatars.js',target)),bundle:true,format:'iife',platform:'browser',minify:true,
 legalComments:'external',metafile:true});
const css=await readFile(new URL('node_modules/blobatar/dist/motion.css',here));
await writeFile(new URL('blobatar-motion.css',target),css);
await writeFile(new URL('agent-avatars.LICENSE.txt',target),await readFile(new URL('node_modules/blobatar/LICENSE',here)));
const js=await readFile(new URL('agent-avatars.js',target));
const adapterCss=await readFile(new URL('agent-avatars.css',target));
const lock=JSON.parse(await readFile(new URL('package-lock.json',here),'utf8'));
const manifest={package:'blobatar',version:pkg.version,license:pkg.license,source:'https://github.com/Alain00/blobatar',
 integrity:lock.packages['node_modules/blobatar'].integrity,
 javascript:{bytes:js.length,gzip_bytes:gzipSync(js).length,sha256:createHash('sha256').update(js).digest('hex')},
 stylesheet:{bytes:css.length,gzip_bytes:gzipSync(css).length,sha256:createHash('sha256').update(css).digest('hex')},
 adapter_stylesheet:{bytes:adapterCss.length,gzip_bytes:gzipSync(adapterCss).length,sha256:createHash('sha256').update(adapterCss).digest('hex')},
 runtime_frameworks:[],adapter_api:'blobatar/internal (pinned)',
 inputs:Object.keys(compiled.metafile.inputs).map(name=>name.replaceAll('\\','/')).sort()};
if(manifest.inputs.some(name=>/node_modules\/(react|vue|glisse)\//.test(name)))throw Error('Unexpected framework in the avatar bundle.');
await writeFile(new URL('agent-avatars.manifest.json',target),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version:pkg.version,javascript:manifest.javascript.bytes,gzip:manifest.javascript.gzip_bytes,css:css.length}));
