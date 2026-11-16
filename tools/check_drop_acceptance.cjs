'use strict';
// Receiver errors must survive the encrypted protocol/state path; an explicit
// decline must remain distinct. Synthetic packets only, no public connections.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/experience/drop-peer.js'),'utf8'),{window,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,performance,setTimeout,clearTimeout,clearInterval,atob,RTCPeerConnection:class{constructor(){throw new Error('WebRTC unavailable in preview')}}});
const {DropPeer,failures}=window.BrivanyDropPeer,meta={id:'a'.repeat(32),name:'README.md',size:32};
(async()=>{
 const checks=[];
 for(const code of ['storage_full','storage_unavailable','storage_timeout','storage_failed','receiver_failed',null]){
  const states={phone:[],desktop:[]},errors={phone:[],desktop:[]},base={id:'a'.repeat(22),key:'A'.repeat(43)},desktop=new DropPeer({...base,role:'desktop',onstate:e=>states.desktop.push(e),onerror:e=>errors.desktop.push(e)}),phone=new DropPeer({...base,role:'phone',accept:async()=>{throw Object.assign(Error('private storage internals'),code?{code}:{declined:true})},onstate:e=>states.phone.push(e),onerror:e=>errors.phone.push(e)});
  desktop.offer(meta,()=>new Uint8Array(32));phone.send=async header=>desktop.handle(header,new Uint8Array(),'relay');phone.pending=meta;await phone.requestAcceptance(meta);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(desktop.tx,null);assert.equal(phone.pending,null);assert.equal(states.phone.at(-1).state,code?'failed':'declined');assert.equal(states.desktop.at(-1).state,code?'failed':'declined');
  if(code){assert.equal(states.desktop.at(-1).failure,code);assert.equal(errors.phone.at(-1),failures[code]);assert.equal(errors.desktop.at(-1),failures[code]);assert(!errors.desktop.join('').includes('private'))}else{assert.deepEqual(errors.phone,[]);assert.deepEqual(errors.desktop,[])}
  phone.close();desktop.close();checks.push(code||'explicit decline');
 }
 let aborted=false;const resumed=new DropPeer({id:'a'.repeat(22),key:'A'.repeat(43),role:'phone',accept:async()=>({offset:0,abort:async()=>{aborted=true}})});resumed.send=async()=>{throw Error('connection interrupted')};resumed.pending=meta;await resumed.requestAcceptance(meta);assert.equal(resumed.rx.meta.id,meta.id);assert.equal(aborted,false);resumed.close();checks.push('accepted sink survives reply interruption');
 const preview=new DropPeer({id:'a'.repeat(22),key:'A'.repeat(43),role:'phone'});await preview.handle({type:'sdp',description:{type:'offer',sdp:'synthetic SDP'}},new Uint8Array(),'relay');assert.equal(preview.rtcDisabled,true);assert.equal(preview.closed,false);preview.close();checks.push('throwing WebRTC constructor degrades to relay');
 const edges=[],packets=[],edgePeer=new DropPeer({id:'a'.repeat(22),key:'A'.repeat(43),role:'phone',onedge:value=>edges.push(value)});edgePeer.peerPresent=true;edgePeer.send=async value=>packets.push(value);
 edgePeer.preview(true,2,'right');edgePeer.preview(true,2,'right');edgePeer.preview(true,1001,'right');edgePeer.preview('true',2,'right');edgePeer.preview(false,0,'right');assert.equal(packets.length,2);assert.equal(packets[0].count,2);
 await edgePeer.handle(packets[0],new Uint8Array(),'relay');await edgePeer.handle({...packets[0],count:1001},new Uint8Array(),'relay');await edgePeer.handle({...packets[0],edge:'command'},new Uint8Array(),'relay');await edgePeer.handle(packets[0],new Uint8Array([1]),'relay');assert.equal(edges.length,1);assert.equal(edges[0].edge,'right');edgePeer.close();checks.push('bounded, deduplicated edge previews reject malformed control messages');
 const {MAX,MAX_FILES,metaOK}=window.BrivanyDropPeer;
 assert.equal(MAX,20_000_000_000);assert.equal(MAX_FILES,1000);assert(metaOK({...meta,size:MAX}));assert(!metaOK({...meta,size:MAX+1}));
 const batchPeer=new DropPeer({id:'b'.repeat(22),key:'A'.repeat(43),role:'desktop',accept:async()=>({offset:0,write:async()=>{},finish:async()=>({saved:true}),abort:async()=>{}})});batchPeer.send=async()=>{};
 const b={id:'b'.repeat(32),count:150,total:150};
 for(let index=1;index<=150;index++){
  const file={id:index.toString(16).padStart(32,'0'),name:index+'.txt',size:1,batch:{...b,index}};
  await batchPeer.handle({type:'file',file},new Uint8Array(),'relay');await new Promise(resolve=>setImmediate(resolve));assert.equal(batchPeer.rx.meta.batch.index,index);
  const bytes=new Uint8Array([index%256]),sha256=window.BrivanyDropPeer.hex(await webcrypto.subtle.digest('SHA-256',bytes));await batchPeer.handle({type:'block',id:file.id,offset:0,sha256},bytes,'relay');await batchPeer.handle({type:'finish',id:file.id},new Uint8Array(),'relay');
 }
 assert.equal(batchPeer.incomingBatch,null);assert.equal(batchPeer.completed.size,150);checks.push('150 verified encrypted-protocol files preserve batch order and exact aggregate size');
 const start={...meta,size:1,batch:{...b,index:1}};batchPeer.checkBatch(start);
 for(const batch of [{...b,index:3},{...b,index:1,total:MAX+1},{...b,index:1,count:1001},{...b,index:1,id:'c'.repeat(32)}])assert.throws(()=>{if(!metaOK({...start,batch}))throw Error('invalid');batchPeer.checkBatch({...start,batch})});
 batchPeer.incomingBatch=null;
 let observed;const offset=2**32+1024,data=new Uint8Array([7,8,9]);batchPeer.rx={meta:{...meta,size:MAX},offset,sink:{write:async position=>{observed=position},abort:async()=>{}},started:performance.now(),lastProgress:0};
 await batchPeer.handle({type:'block',id:meta.id,offset,sha256:window.BrivanyDropPeer.hex(await webcrypto.subtle.digest('SHA-256',data))},data,'relay');assert.equal(observed,offset);assert.equal(batchPeer.rx.offset,offset+3);batchPeer.close();checks.push('20 GB metadata limits; offsets above 4 GiB remain exact; modified or oversized batches rejected');
 const result={passed:true,checks,personal_files:0,external_calls:0};const folder=path.join(__dirname,'../tmp/drop-acceptance');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1});
