import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {identity,profile,BLOBATAR_VERSION} from '../desktop/experience/ui/agent-avatars.js';
import {_parts} from '../desktop/experience/ui/node_modules/blobatar/dist/internal.js';

test('a specialist retains its identity across retries and title/state changes',()=>{
 const original={id:'one',agent_key:'team:writer',kind:'document',state:'running',title:'Private draft'};
 const revised={...original,id:'two',title:'New title',state:'succeeded',attempt:2};
 assert.equal(identity(original),identity(revised));assert.deepEqual(profile(original),profile(revised));
});
test('each function has a distinct fixed face even across parallel tasks',()=>{
 const jobs=['document','image','research','model','motion','document'].map((kind,index)=>({kind,id:'job-'+index,agent_key:'team:'+index}));
 const faces=jobs.map(job=>{const {seed,hue}=profile(job);return _parts(seed,{hue,background:false,animate:'always',normalize:false}).inner});
 assert.equal(new Set(jobs.map(identity)).size,5);assert.equal(new Set(faces).size,5);assert.equal(faces[0],faces[5]);
 assert.equal(identity(jobs[0]),identity({...jobs[0],id:'another-conversation',agent_key:'another-team'}));
});
test('identity never depends on an instruction, label or current phase',()=>{
 assert.deepEqual(profile({id:'same',kind:'image',title:'A',phase:'run'}),profile({id:'same',kind:'image',title:'B',phase:'done'}));
 assert.notEqual(identity({id:'same',kind:'image'}),identity({id:'same',kind:'research'}));
 assert.doesNotThrow(()=>profile({kind:'__proto__',agent_key:{untrusted:true}}));
});
test('untrusted names are hashed rather than inserted as SVG markup',()=>{
 const hostile='<script>alert(1)</script><image href="https://example.invalid/leak"/>';
 const {seed,hue}=profile({id:hostile,kind:'image'});
 const result=_parts(seed,{hue,background:false,animate:'always',normalize:false});
 assert.doesNotMatch(result.inner,/<script|https:|href=|alert\(/i);
 assert.ok(result.vars['--mo-blink']);assert.ok(result.cls.includes('mo-root'));
});
test('the installed release, license and integrity are pinned',()=>{
 const base=new URL('../desktop/experience/',import.meta.url);
 const pkg=JSON.parse(readFileSync(new URL('ui/node_modules/blobatar/package.json',base)));
 const lock=JSON.parse(readFileSync(new URL('ui/package-lock.json',base)));
 const manifest=JSON.parse(readFileSync(new URL('agent-avatars.manifest.json',base)));
 assert.equal(pkg.version,BLOBATAR_VERSION);assert.equal(manifest.version,pkg.version);assert.equal(pkg.license,'MIT');
 assert.equal(manifest.integrity,lock.packages['node_modules/blobatar'].integrity);
 assert.match(readFileSync(new URL('agent-avatars.LICENSE.txt',base),'utf8'),/Copyright.*Alain/);
});
test('the shipped bundle has no framework and stays within the avatar budget',()=>{
 const base=new URL('../desktop/experience/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('agent-avatars.manifest.json',base)));
 for(const [name,key] of [['agent-avatars.js','javascript'],['blobatar-motion.css','stylesheet'],['agent-avatars.css','adapter_stylesheet']]){
  const bytes=readFileSync(new URL(name,base));assert.equal(bytes.length,manifest[key].bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest[key].sha256);
  assert.equal(gzipSync(bytes).length,manifest[key].gzip_bytes);
 }
 assert.ok(manifest.javascript.bytes<20*1024);assert.ok(manifest.stylesheet.bytes+manifest.adapter_stylesheet.bytes<12*1024);
 assert.deepEqual(manifest.runtime_frameworks,[]);assert.ok(manifest.inputs.every(name=>!/(react|vue|glisse)\//.test(name)));
});
