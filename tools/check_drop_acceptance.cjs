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
 edgePeer.preview(true,2,'right');edgePeer.preview(true,2,'right');edgePeer.preview(true,9,'right');edgePeer.preview('true',2,'right');edgePeer.preview(false,0,'right');assert.equal(packets.length,2);assert.equal(packets[0].count,2);
 await edgePeer.handle(packets[0],new Uint8Array(),'relay');await edgePeer.handle({...packets[0],count:500},new Uint8Array(),'relay');await edgePeer.handle({...packets[0],edge:'command'},new Uint8Array(),'relay');await edgePeer.handle(packets[0],new Uint8Array([1]),'relay');assert.equal(edges.length,1);assert.equal(edges[0].edge,'right');edgePeer.close();checks.push('bounded, deduplicated edge previews reject malformed control messages');
 const result={passed:true,checks,personal_files:0,external_calls:0};const folder=path.join(__dirname,'../tmp/drop-acceptance');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1});
