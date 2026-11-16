import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

function fixture() {
  const catalog={'/windows/Brivany.zip':{name:'Brivany.zip',size:6,sha256:'abcd',parts:['/parts/a','/parts/b']}};
  const assets={'/catalog.json':JSON.stringify(catalog),'/windows/stable.json':'{"signed":true}','/parts/a':'abc','/parts/b':'def'};
  const calls=[];
  return {calls,env:{ASSETS:{async fetch(request){const path=new URL(request.url).pathname;calls.push(path);return Object.hasOwn(assets,path)?new Response(assets[path]):new Response(null,{status:404});}}}};
}
test('streams package parts in order without exposing internal assets',async()=>{
  const {env,calls}=fixture();const response=await worker.fetch(new Request('https://brivany.vetsa.es/windows/Brivany.zip'),env);
  assert.equal(response.status,200);assert.equal(await response.text(),'abcdef');assert.equal(response.headers.get('Content-Length'),'6');
  assert.deepEqual(calls,['/catalog.json','/parts/a','/parts/b']);
  assert.equal((await worker.fetch(new Request('https://brivany.vetsa.es/parts/a'),env)).status,404);
});
test('HEAD does not fetch large package parts',async()=>{
  const {env,calls}=fixture();const response=await worker.fetch(new Request('https://brivany.vetsa.es/windows/Brivany.zip',{method:'HEAD'}),env);
  assert.equal(response.headers.get('Content-Length'),'6');assert.equal(await response.text(),'');assert.deepEqual(calls,['/catalog.json']);
});
test('manifest bypasses cache and forbids mutations',async()=>{
  const {env}=fixture();const response=await worker.fetch(new Request('https://brivany.vetsa.es/windows/stable.json'),env);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{signed:true});
  assert.equal((await worker.fetch(new Request('https://brivany.vetsa.es/windows/stable.json',{method:'POST'}),env)).status,405);
});
