'use strict';
// Safari before 16.4 used asynchronous access-handle methods. Estimate is
// optional even when the origin file system is available.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../workers/file-transfer/client/drop-storage-worker.js'),'utf8');
async function fixture({estimate,legacy=false}={}){
 let reply,bytes=new Uint8Array(),closed=false;const steps=[],method=(name,fn)=>legacy?async(...args)=>{await new Promise(resolve=>setTimeout(resolve,1));steps.push(name);return fn(...args)}:(...args)=>{steps.push(name);return fn(...args)};
 const writer={truncate:method('truncate',size=>{bytes=new Uint8Array(size)}),write:method('write',(value,{at})=>{const next=new Uint8Array(at+value.length);next.set(bytes);next.set(value,at);bytes=next;return value.length}),flush:method('flush',()=>{}),close:method('close',()=>{closed=true})},handle={createSyncAccessHandle:async()=>writer,getFile:async()=>({size:bytes.length,bytes:Array.from(bytes)})},directory={entries:async function*(){},getFileHandle:async()=>handle,removeEntry:async()=>{}};
 const self={postMessage:value=>{reply=value}},storage={getDirectory:async()=>({getDirectoryHandle:async()=>directory}),...(estimate?{estimate}:{})};vm.runInNewContext(code,{self,navigator:{storage},Uint8Array,Map,Date,Error,Number});
 let request=0;const send=async(op,extra={})=>{await self.onmessage({data:{request:++request,op,id:'a'.repeat(32),...extra}});assert.equal(reply.request,request);return reply};return {send,steps,closed:()=>closed};
}
(async()=>{const checks=[];for(const legacy of [false,true]){const test=await fixture({legacy});assert.equal((await test.send('open',{size:3})).value.offset,0);assert.equal((await test.send('write',{offset:0,data:new Uint8Array([1,2,3]).buffer})).value.offset,3);const result=await test.send('finish');assert.equal(result.value.file.size,3);assert.equal(result.value.storage,'opfs');assert.deepEqual(Array.from(result.value.file.bytes),[1,2,3]);assert.deepEqual(test.steps,['truncate','write','flush','close']);assert(test.closed());checks.push(legacy?'legacy asynchronous Safari handle without estimate':'synchronous handle without estimate')}
 const deniedEstimate=await fixture({estimate:async()=>{throw Error('Estimate restricted')}});assert.equal((await deniedEstimate.send('open',{size:3})).value.offset,0);await deniedEstimate.send('abort');checks.push('rejected advisory estimate does not block writes');
 const full=await fixture({estimate:async()=>({quota:1024,usage:0})});assert.equal((await full.send('open',{size:3})).code,'storage_full');assert.equal(full.steps.length,0);checks.push('insufficient quota has typed failure before writing');
 const result={passed:true,checks,external_calls:0};const folder=path.join(__dirname,'../tmp/drop-storage');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1});
