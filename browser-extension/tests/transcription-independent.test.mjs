import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function clientFixture({paused=true,live=false}={}){
 const events={},sent=[],elements={},intervals=new Map(),timeouts=new Map();let serial=0,stopped=0,now=0;
 const element=()=>({style:{},dataset:{},hidden:false,textContent:'',append(){},remove(){this.removed=true;}});
 const root={querySelector:key=>elements[key]??=element()};
 const host=element();host.attachShadow=()=>root;root.host=host;
 const video={paused,readyState:2,isConnected:true,currentTime:3,dataset:{},getBoundingClientRect:()=>({width:900,height:500,top:100,bottom:600,left:0}),closest:()=>null,addEventListener(){},removeEventListener(){},
  captureStream:()=>({getAudioTracks:()=>[{}],getTracks:()=>[{stop:()=>stopped++}]})};
 if(live)video.srcObject={getAudioTracks:()=>[{readyState:'live',muted:false,clone:()=>({stop:()=>stopped++})}]};
 for(const key of ['volume','muted','currentTime','playbackRate']){const value=video[key];Object.defineProperty(video,key,{get:()=>value,set:()=>assert.fail('player write: '+key)});}
 video.play=video.pause=()=>assert.fail('must never control source playback');
 const port={postMessage:m=>sent.push(m),disconnect:()=>events.disconnect?.(),onMessage:{addListener:f=>events.message=f},onDisconnect:{addListener:f=>events.disconnect=f}};
 class Overlay{constructor(){this.started=0;this.first=null;}receive(m){this.last=m;}close(){}}
 class Sender{enqueue(){}acknowledge(){}pause(){}close(){}}
 class Context{constructor(){this.audioWorklet={addModule:async()=>{}};}async resume(){}async close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createGain(){return {gain:{},connect(){},disconnect(){}};}}
 class Worklet{constructor(){this.port={postMessage(){}};}connect(){}disconnect(){}}
 class Stream{constructor(tracks){this.tracks=tracks;}getAudioTracks(){return this.tracks;}getTracks(){return this.tracks;}}
 const source=await readFile(new URL('../transcription-client.js',import.meta.url),'utf8');
 const api=vm.runInNewContext(source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+'\n({activateTranscription,audioAvailable})',{
  TranscriptOverlay:Overlay,PCMSender:Sender,AudioContext:Context,AudioWorkletNode:Worklet,MediaStream:Stream,
  crypto:{randomUUID:()=> '12345678-1234-4000-8000-123456789abc'},performance:{now:()=>now},innerHeight:900,
  document:{querySelectorAll:()=>[video],createElement:tag=>tag==='div'?host:element(),documentElement:{append(){}}},window:{addEventListener(){},removeEventListener(){}},chrome:{runtime:{connect:()=>port,getURL:p=>p}},
  setInterval:f=>{const id=++serial;intervals.set(id,f);return id;},clearInterval:id=>intervals.delete(id),setTimeout:f=>{const id=++serial;timeouts.set(id,f);return id;},clearTimeout:id=>timeouts.delete(id)
 });
 await api.activateTranscription();
 return {api,video,sent,events,elements,host,advance:ms=>now+=ms,stopped:()=>stopped,check:()=>[...intervals.values()].forEach(f=>f()),expire:()=>[...timeouts.values()].forEach(f=>f()),stop:()=>elements['.stop'].onclick()};
}

test('paused video prepares existing captions without ASR or player control',async()=>{
 const f=await clientFixture();
 assert.equal(f.sent[0].type,'probe-captions');
 f.events.message({type:'captions-ready',snapshot:{cues:[{start:0,end:6,text:'Available before play.'}]}});
 f.check();assert.equal(f.sent.some(m=>m.type==='start-asr'),false);
 assert.match(f.elements['.state'].textContent,/subtítulos del video/);
 assert.equal(f.elements['.full'].textContent,'Available before play.');
 f.advance(20000);f.check();assert.equal(f.sent.at(-1).type,'ping');assert.equal(f.sent.some(m=>m.type==='start-asr'),false);
 f.stop();assert.equal(f.host.removed,true);
});

test('without captions it waits for Play, starts once, and stopping leaves source playing',async()=>{
 const f=await clientFixture();
 f.events.message({type:'captions-ready',snapshot:null});f.check();
 assert.equal(f.sent.some(m=>m.type==='start-asr'),false);
 assert.match(f.elements['.state'].textContent,/Esperando audio/);
 f.video.paused=false;f.check();f.check();
 assert.equal(f.sent.filter(m=>m.type==='start-asr').length,1);
 f.events.message({type:'asr-ready'});await new Promise(setImmediate);
 assert.match(f.elements['.state'].textContent,/reconocimiento de voz/);
 f.stop();assert.equal(f.stopped(),1);assert.equal(f.video.paused,false);
});

test('live stream audio can start while visual playback is paused; late caption reply cannot change mode',async()=>{
 const f=await clientFixture({live:true});f.expire();f.check();
 assert.equal(f.sent.filter(m=>m.type==='start-asr').length,1);
 f.events.message({type:'captions-ready',snapshot:{cues:[{start:0,end:6,text:'Late captions'}]}});
 assert.notEqual(f.elements['.full']?.textContent,'Late captions');f.stop();
});

async function workerFixture(){
 const handlers={},injections=[],removed=[],sent=[],sockets=[],endpoints=[];
 const hook=k=>({addListener:f=>handlers[k]=f});
 const chrome={action:{onClicked:hook('action')},runtime:{id:'owned-extension',getURL:p=>'chrome-extension://owned/'+p,onConnect:hook('connect'),onInstalled:hook('installed'),onStartup:hook('startup')},
  scripting:{unregisterContentScripts:async value=>removed.push(value),executeScript:async opts=>{injections.push(opts);return [{result:opts.world==='MAIN'?{cues:[]}:true}];}},tabs:{onRemoved:hook('removed'),onUpdated:hook('updated')}};
 class Socket{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;this.listeners={};this.sent=[];sockets.push(this);}addEventListener(k,f){this.listeners[k]=f;}send(m){this.sent.push(m);}close(){this.listeners.close?.();}}
 const source=await readFile(new URL('../transcription-background.js',import.meta.url),'utf8');
 vm.runInNewContext(source.replace(/^import .*$/gm,''),{chrome,WebSocket:Socket,readVideoCaptions(){},Uint8Array,atob,
  connectDesktop:async endpoint=>{endpoints.push(endpoint);return {selected_video_protocol:2,video_url:'ws://127.0.0.1:48218/video',token:'synthetic'};},reply:async(socket,message)=>{socket.send(JSON.stringify(message));return {};}});
 const callbacks={},port={name:'brivany-transcription',sender:{id:'owned-extension',tab:{id:11}},postMessage:m=>sent.push(m),onMessage:{addListener:f=>callbacks.message=f},onDisconnect:{addListener:f=>callbacks.disconnect=f}};
 return {handlers,injections,removed,sent,sockets,endpoints,callbacks,port};
}

test('standalone worker retires prefix script and rejects a port without action grant',async()=>{
 const f=await workerFixture();f.handlers.connect(f.port);assert.equal(f.callbacks.message,undefined);
 assert.equal(f.removed[0].ids[0],'brivany-video-prefix');
 await f.handlers.action({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'});
 assert.match(f.injections[0].args[0],/transcription-client\.js$/);
 f.handlers.connect(f.port);await f.callbacks.message({type:'probe-captions',selection:'owned-selection-1'});
 assert.equal(f.endpoints.length,0,'caption probe does not open ASR');
 assert.equal(f.sent.at(-1).type,'captions-ready');
});

test('standalone ASR connects separate service, forces translation off, and forwards receipt acknowledgments',async()=>{
 const f=await workerFixture();await f.handlers.action({id:11,url:'https://example.test/video'});f.handlers.connect(f.port);
 await f.callbacks.message({type:'start-asr',selection:'owned-selection-1',translate:true});
 assert.equal(f.endpoints[0],'ws://127.0.0.1:48218/connect');
 const select=JSON.parse(f.sockets[0].sent[1]);assert.equal(select.type,'select');assert.equal(select.translate,false);assert.match(select.source,/^video:[0-9a-f]{1,8}$/);
 assert.equal(f.sent.at(-1).type,'asr-ready');
 await f.callbacks.message({type:'pcm',sequence:0,data:Buffer.alloc(3840).toString('base64')});
 assert.equal(f.sent.some(m=>m.type==='ack'),false);
 f.sockets[0].listeners.message({data:JSON.stringify({type:'audio-ack',sequence:0})});assert.equal(f.sent.at(-1).type,'ack');
 f.callbacks.disconnect();
});

test('0.5.0 manifest runs the translation worker; the transcription test worker stays unloaded',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.background.service_worker,'background.js');
 const worker=await readFile(new URL('../background.js',import.meta.url),'utf8');
 assert.match(worker,/const TRANSCRIPTION_ONLY=false;/);
 const resources=manifest.web_accessible_resources.flatMap(r=>r.resources);
 for(const module of ['buffered-player.js','inline-translation.js','video-selection.js','prefix-preparation.js'])assert.equal(resources.includes(module),true);
 assert.equal(resources.includes('transcription-client.js'),false);
 // A web-accessible module whose import is not accessible fails to load in the
 // page (found in Brave: video-selection.js -> transcript-overlay.js).
 for(const module of resources){
  const source=await readFile(new URL('../'+module,import.meta.url),'utf8');
  for(const [,dependency] of source.matchAll(/from\s+'\.\/([\w.-]+\.js)'/g))assert.ok(resources.includes(dependency),module+' imports '+dependency);
 }
});
