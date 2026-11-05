const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
globalThis.crypto=webcrypto;
const source=fs.readFileSync('web/spatial-load.js','utf8'),modulePromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('bounded reader counts actual chunks with or without a length header',async()=>{
 const {readBoundedAsset}=await modulePromise;for(const headers of [{},{'content-length':'4'}]){let counted=0;const raw=await readBoundedAsset(new Response(new Uint8Array([1,2,3,4]),{headers}),{maxBytes:4,onChunk:n=>counted+=n});assert.equal(raw.byteLength,4);assert.equal(counted,4);}
});
test('false small length and actual oversized chunks cannot bypass the bound',async()=>{
 const {readBoundedAsset}=await modulePromise;
 await assert.rejects(readBoundedAsset(new Response(new Uint8Array(8),{headers:{'content-length':'2'}}),{maxBytes:4}),/límite/);
 await assert.rejects(readBoundedAsset(new Response(new Uint8Array(2),{headers:{'content-length':'3'}}),{maxBytes:4}),/tamaño/);
 await assert.rejects(readBoundedAsset(new Response(new Uint8Array(2),{headers:{'content-length':'8'}}),{maxBytes:4}),/límite/);
});
test('abort while waiting cancels the reader and never returns a partial file',async()=>{
 const {readBoundedAsset}=await modulePromise,controller=new AbortController();let cancelled=false;
 const body=new ReadableStream({start(stream){stream.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
 const pending=readBoundedAsset(new Response(body),{signal:controller.signal,maxBytes:10});controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(cancelled,true);assert.equal(body.locked,false);
});
test('local artifact SHA must match and environment assets load first',async()=>{
 const {verifyAssetHash,orderedAssets}=await modulePromise,bytes=new Uint8Array([1,2,3]);
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');await verifyAssetHash(bytes,hash);
 await assert.rejects(verifyAssetHash(bytes,'0'.repeat(64)),/cambió/);
 const manifest={assets:[{id:'chair'},{id:'floor'},{id:'unused'}],objects:[{asset_id:'chair',role:'object'},{asset_id:'floor',role:'environment'}]};
 assert.deepEqual(orderedAssets(manifest).map(item=>item.id),['floor','chair']);
});
