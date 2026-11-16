import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {automaticVideo,chooseAt,visibleVideos} from '../video-selection.js';
import {reply} from '../desktop-connect.js';
import {openingVideo,prefixSource,youtubeAdPlaying} from '../prefix-preparation.js';
test('one visible YouTube video is automatic, several videos require an explicit choice',()=>{
 const one={},two={};assert.equal(automaticVideo([one],'https://www.youtube.com/watch?v=abcdefghijk'),one);
 assert.equal(automaticVideo([one,two],'https://www.youtube.com/watch?v=abcdefghijk'),null);
 assert.equal(automaticVideo([one],'https://owned.example/'),null);assert.equal(automaticVideo([one],'https://youtube.com.evil.example/'),null);
});
test('pin chooses only the video underneath its coordinates and ignores hidden/offscreen videos',()=>{
 const a={getBoundingClientRect:()=>({left:0,top:0,right:300,bottom:200,width:300,height:200})},b={getBoundingClientRect:()=>({left:400,top:0,right:700,bottom:200,width:300,height:200})};
 assert.equal(chooseAt([a,b],450,100),b);assert.equal(chooseAt([a,b],350,100),null);
 const old={innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight,getComputedStyle:globalThis.getComputedStyle};
 globalThis.innerWidth=800;globalThis.innerHeight=600;globalThis.getComputedStyle=v=>({display:v.hidden?'none':'block',visibility:'visible'});
 try{const hidden={...a,hidden:true},off={getBoundingClientRect:()=>({left:900,top:0,right:1200,bottom:200,width:300,height:200})};assert.deepEqual(visibleVideos({querySelectorAll:()=>[a,b,hidden,off]}),[a,b]);}finally{Object.assign(globalThis,old);}
});
test('a cancelled or timed-out connection cannot send a late request on opening',async()=>{
 class Socket extends EventTarget{readyState=0;sent=[];send(raw){this.sent.push(raw);}}
 const socket=new Socket();await assert.rejects(reply(socket,{type:'connect',protocol:1},'connected',5));socket.dispatchEvent(new Event('open'));assert.equal(socket.sent.length,0);
});

test('preparation identifies a stable opening and leaves deep, live or ambiguous media alone',()=>{
 const opening={isConnected:true,paused:false,seeking:false,ended:false,muted:false,volume:1,readyState:3,playbackRate:1,duration:60,currentTime:.2,seekable:{length:1,start:()=>0},currentSrc:'https://owned.example/movie.mp4'};
 assert.equal(openingVideo(opening),true);
 for(const fields of [{currentTime:3},{duration:Infinity},{muted:true},{playbackRate:1.5},{seekable:{length:0}},{paused:true}])assert.equal(openingVideo({...opening,...fields}),false);
 assert.equal(prefixSource(opening,'https://www.youtube.com/watch?v=abcdefghijk'),'youtube:abcdefghijk');
 assert.equal(prefixSource(opening,'https://www.youtube.com/'),null);
 assert.match(prefixSource(opening,'https://owned.example/'),/^video:[0-9a-f]{1,8}$/);
 assert.equal(prefixSource({...opening,currentSrc:'blob:https://owned.example/key'},'https://owned.example/'),null);
});

test('a YouTube ad cannot be treated as the selected opening even when it uses the same element and video ID',()=>{
 const href='https://www.youtube.com/watch?v=abcdefghijk';let playerClass='ad-showing';
 const video={currentSrc:'blob:https://www.youtube.com/same-source',closest:selector=>selector.includes('.'+playerClass)?{}:null};
 for(const state of ['ad-showing','ad-interrupting']){
  playerClass=state;assert.equal(youtubeAdPlaying(video,href),true);assert.equal(prefixSource(video,href),null);
 }
 playerClass='actual-content';assert.equal(youtubeAdPlaying(video,href),false);assert.equal(prefixSource(video,href),'youtube:abcdefghijk');
});

test('document-start and committed injection share one bounded bootstrap before the root exists',async()=>{
 const source=await readFile(new URL('../video-prepare-loader.js',import.meta.url),'utf8');
 let notify,disconnected=0,initialized=0;
 const document={documentElement:null};
 const realm=vm.createContext({document,MutationObserver:class{constructor(callback){notify=callback;}observe(){}disconnect(){disconnected++;}},
  setTimeout,clearTimeout,loadModule:async()=>({observeVideoPreparation:()=>initialized++})});
 const script=source.replace("import(chrome.runtime.getURL('video-selection.js'))",'loadModule()');
 const registered=vm.runInContext(script,realm),injected=vm.runInContext(script,realm);
 assert.equal(registered,injected);assert.equal(initialized,0);
 document.documentElement={dataset:{}};notify();
 assert.equal(await injected,'ready');assert.equal(initialized,1);assert.equal(disconnected,1);
 assert.equal(document.documentElement.dataset.brivanyPrefixLoader,'ready');
});

test('a broken passive module reports a bounded safe code rather than success',async()=>{
 const source=await readFile(new URL('../video-prepare-loader.js',import.meta.url),'utf8');
 const document={documentElement:{dataset:{}}};
 const realm=vm.createContext({document,loadModule:async()=>{throw Error('private path');}});
 const result=await vm.runInContext(source.replace("import(chrome.runtime.getURL('video-selection.js'))",'loadModule()'),realm);
 assert.equal(result,'module-error');assert.deepEqual(document.documentElement.dataset,{brivanyPrefixLoader:'module-error'});
});

async function prefixLifecycle({tracksInitially=true}={}){
 const source=await readFile(new URL('../prefix-preparation.js',import.meta.url),'utf8');
 const callbacks=new Map(),videoCallbacks=new Map(),ports=[],worklets=[],contexts=[];
 let hasTracks=tracksInitially;
 const document={documentElement:{dataset:{}},visibilityState:'visible',addEventListener:(name,fn)=>{
  const rows=callbacks.get(name)||[];rows.push(fn);callbacks.set(name,rows);
 }};
 const node=()=>({connect(){},disconnect(){},gain:{value:1}});
 const video={isConnected:true,paused:false,seeking:false,ended:false,muted:false,volume:1,readyState:4,
  playbackRate:1,duration:60,currentTime:0,seekable:{length:1,start:()=>0},currentSrc:'blob:https://www.youtube.com/owned',
  closest:selector=>selector==='#movie_player'?{}:null,
  addEventListener:(name,fn)=>{const rows=videoCallbacks.get(name)||[];rows.push(fn);videoCallbacks.set(name,rows);},
  removeEventListener:(name,fn)=>videoCallbacks.set(name,(videoCallbacks.get(name)||[]).filter(row=>row!==fn)),
  captureStream:()=>({getVideoTracks:()=>[],getAudioTracks:()=>hasTracks?[{stop(){}}]:[],getTracks:()=>[]})};
 const emit=(name)=>{for(const fn of callbacks.get(name)||[])fn({type:name,target:video});for(const fn of [...(videoCallbacks.get(name)||[])])fn({type:name,target:video});};
 const windowCallbacks=new Map();
 const realm=vm.createContext({document,location:{href:'https://www.youtube.com/watch?v=abcdefghijk',hostname:'www.youtube.com'},
  window:{addEventListener:(name,fn)=>windowCallbacks.set(name,fn)},URL,setTimeout,clearTimeout,Date,WeakMap,
  crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},btoa,Uint8Array,
  MutationObserver:class{observe(){}disconnect(){}},
  MediaStream:class{},
  AudioContext:class{constructor(){this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};contexts.push(this);}resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}createMediaStreamSource(){return node();}createGain(){return node();}},
  AudioWorkletNode:class{constructor(){Object.assign(this,node());this.port={postMessage(){}};worklets.push(this);}},
  chrome:{runtime:{getURL:name=>'chrome-extension://owned/'+name,connect:()=>{
   const port={sent:[],closed:false,onMessage:{addListener:fn=>port.receive=fn},onDisconnect:{addListener:fn=>port.onClosed=fn},
    postMessage:value=>port.sent.push(value),disconnect:()=>{if(!port.closed){port.closed=true;port.onClosed?.();}}};ports.push(port);return port;
  }}}
 });
 const api=vm.runInContext(source.replace(/^export /gm,'')+'\n({observeVideoPrefix,takeVideoPrefix})',realm);
 api.observeVideoPrefix(()=>video);await new Promise(setImmediate);
 return {api,document,video,ports,contexts,emit,tracks:value=>hasTracks=value,
  flush:()=>new Promise(setImmediate),
  capture:()=>{ports.at(-1).receive({type:'prefix-capture'});for(let i=0;i<125;i++)worklets.at(-1).port.onmessage({data:{buffer:new ArrayBuffer(3840)}});},
  ready:()=>ports.at(-1).receive({type:'prefix-ready',prefix_id:'p'.repeat(32),position_ms:0,duration_ms:10000,resume_from_ms:10000,turns:[]}),
  cleanup:()=>windowCallbacks.get('pagehide')?.()};
}

test('an early missing audio track can recover on canplay without repeating a provider request',async()=>{
 const run=await prefixLifecycle({tracksInitially:false});
 try{
  assert.equal(run.document.documentElement.dataset.brivanyPrefixError,'audio_track_missing');
  assert.equal(run.ports[0].sent.length,0);assert.equal(run.contexts[0].state,'closed');
  run.tracks(true);run.emit('canplay');await run.flush();
  assert.equal(run.ports.length,2);assert.equal(run.ports[1].sent.filter(row=>row.type==='prefix-start').length,1);
  run.emit('playing');run.emit('canplay');await run.flush();assert.equal(run.ports.length,2);
  run.capture();run.ready();
  assert.equal(run.ports[1].sent.filter(row=>row.type==='prefix-pcm').length,125);
  assert.equal(run.ports[1].sent.filter(row=>row.type==='prefix-finish').length,1);
  assert.equal(run.document.documentElement.dataset.brivanyPrefixState,'ready');
 }finally{run.cleanup();}
});

test('completed prefix analysis survives seeking, rate changes and a hidden tab, then reuses once',async()=>{
 const run=await prefixLifecycle();
 try{
  run.capture();run.video.currentTime=0;run.emit('seeking');run.video.playbackRate=1.25;run.emit('ratechange');
  run.document.visibilityState='hidden';run.emit('visibilitychange');run.emit('pause');
  assert.equal(run.ports[0].closed,false,'All PCM was captured before these playback changes');
  run.ready();assert.equal(run.document.documentElement.dataset.brivanyPrefixState,'ready');
  run.video.playbackRate=1;run.document.visibilityState='visible';run.emit('visibilitychange');run.emit('playing');await run.flush();
  assert.equal(run.ports.length,1,'Reuse must not open a second provider request');
  const prefix=await run.api.takeVideoPrefix(run.video);
  assert.equal(prefix.prefixId,'p'.repeat(32));assert.equal(prefix.resume,10000);assert.equal(prefix.position,0);
  assert.equal(await run.api.takeVideoPrefix(run.video),null);
 }finally{run.cleanup();}
});

test('a partial prefix is cancelled by seeking and cannot silently start another paid attempt',async()=>{
 const run=await prefixLifecycle();
 try{
  run.emit('seeking');assert.equal(run.ports[0].closed,true);
  run.emit('canplay');run.emit('playing');await run.flush();
  assert.equal(run.ports.length,1);assert.equal(await run.api.takeVideoPrefix(run.video),null);
 }finally{run.cleanup();}
});

test('repeated startup events cannot loop audio setup while a stalled video has no track',async()=>{
 const run=await prefixLifecycle({tracksInitially:false});
 try{
  for(let i=0;i<6;i++){run.emit('canplay');run.emit('durationchange');await run.flush();}
  assert.equal(run.ports.length,2);assert.equal(run.ports.flatMap(port=>port.sent).length,0);
  run.video.currentSrc='blob:https://www.youtube.com/new-media';run.emit('emptied');run.tracks(true);run.emit('canplay');await run.flush();
  assert.equal(run.ports.length,3);assert.equal(run.ports[2].sent.filter(row=>row.type==='prefix-start').length,1);
 }finally{run.cleanup();}
});

test('a changed media source invalidates a ready prefix before reuse',async()=>{
 const run=await prefixLifecycle();
 try{
  run.capture();run.ready();run.video.currentSrc='blob:https://www.youtube.com/replaced';run.emit('emptied');
  assert.equal(await run.api.takeVideoPrefix(run.video),null);
  assert.equal(run.document.documentElement.dataset.brivanyPrefixState,'unavailable');
 }finally{run.cleanup();}
});
