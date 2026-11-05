const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('capture emits real-time 80 ms PCM16LE at 24 kHz from common device rates and mutes audio', () => {
  for (const rate of [24000, 44100, 48000]) {
    let Processor; const frames = [];
    const context = vm.createContext({sampleRate:rate,Int16Array,ArrayBuffer,DataView,
      AudioWorkletProcessor:class {constructor(){this.port={postMessage:b=>frames.push(b)};}},
      registerProcessor:(name,ctor)=>{Processor=ctor;}});
    vm.runInContext(fs.readFileSync('web/pcm-capture.js','utf8'),context);
    const capture = new Processor();
    const input = new Float32Array(rate * .16).fill(-1);
    capture.process([[input]]);
    assert.equal(frames.length,2);assert.equal(frames[0].byteLength,3840);
    assert.equal(new DataView(frames[0]).getInt16(0,true),-32768);
    capture.port.onmessage({data:{muted:true}});capture.process([[input]]);
    assert.ok(new Uint8Array(frames[2]).every(x=>x===0));
  }
});

test('Muse cancels a pending start, masks echo and discards late turns from speech output', async () => {
  const sockets=[],nodes=[],results=[];
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
    send(x){this.sent.push(x);}close(){this.readyState=3;this.onclose?.();}
    emit(x){this.onmessage?.({data:JSON.stringify(x)});}
  }
  class Node {constructor(){this.port={postMessage(){}};nodes.push(this);}connect(){}disconnect(){}}
  const context=vm.createContext({window:{AudioWorkletNode:Node},AudioWorkletNode:Node,WebSocket:Socket,
    setTimeout,clearTimeout,Uint8Array,AbortController,console});
  vm.runInContext(fs.readFileSync('web/live-voice.js','utf8'),context);
  const Capture=context.window.BrivanyLive.MuseCapture;
  const capture=new Capture({onTranscript:r=>results.push(r),onError:()=>{},onStatus:()=>{}});
  const audio={audioWorklet:{addModule:async()=>{}}},source={connect(){},disconnect(){}};
  const options={url:'ws://test/live',mode:'practice',language:'es-ES'};
  const pending=capture.start(audio,source,options);await new Promise(setImmediate);
  const socket=sockets[0];socket.emit({type:'ready'});await pending;
  socket.emit({type:'speech-start',id:'1'});
  socket.emit({type:'transcript',id:'1',text:'Hola',final:false});
  capture.suspend(true);
  nodes[0].port.onmessage({data:new Uint8Array([255,255,255,255]).buffer});
  assert.ok(new Uint8Array(socket.sent.at(-1)).every(x=>x===0));
  capture.suspend(false);
  socket.emit({type:'transcript',id:'1',text:'Late echo',final:true});
  socket.emit({type:'speech-start',id:'2'});
  socket.emit({type:'transcript',id:'2',text:'Next turn',final:true});
  assert.deepEqual(results.map(r=>r.text),['Hola','Next turn']);
  capture.stop();
  const next=capture.start(audio,source,options);await new Promise(setImmediate);capture.stop();
  await assert.rejects(next,/cancelada/);
});

test('PCM playback preserves signed samples split across network chunks', async () => {
  const samples=[];
  class Audio {
    constructor(){this.state='running';this.destination={};}
    get currentTime(){return performance.now()/1000;}
    async resume(){}
    createBuffer(ch,n,rate){const channel=new Float32Array(n);samples.push(channel);return{duration:n/rate,getChannelData:()=>channel};}
    createBufferSource(){return {playbackRate:{},connect(){},disconnect(){},start(){},stop(){}};}
    createGain(){return {gain:{},connect(){},disconnect(){}};}
  }
  const context=vm.createContext({window:{AudioContext:Audio},setTimeout,clearTimeout,Uint8Array,DataView,AbortController});
  vm.runInContext(fs.readFileSync('web/live-voice.js','utf8'),context);
  const player=new context.window.BrivanyLive.PCMPlayer();await player.prepare({rate:1});
  const chunks=[new Uint8Array([0]),new Uint8Array([128,255,127])];
  const response={body:{getReader:()=>({read:async()=>chunks.length?{value:chunks.shift(),done:false}:{done:true},cancel:async()=>{},releaseLock(){}})}};
  await player.stream(response,new AbortController().signal);
  assert.equal(samples[0][0],-1);assert.equal(samples[0][1],32767/32768);player.cancel();
});

test('cancelling Melodi while synthesis is pending never schedules late audio', async () => {
  let fulfill,streams=0;const states=[],errors=[];
  const context=vm.createContext({window:{},setTimeout,clearTimeout,Uint8Array,DataView,AbortController,
    fetch:()=>new Promise(resolve=>fulfill=resolve)});
  vm.runInContext(fs.readFileSync('web/live-voice.js','utf8'),context);
  const output=new context.window.BrivanyLive.MelodiOutput(s=>states.push(s),e=>errors.push(e));
  output.player={prepare:async()=>{},cancel(){},stream:async(response,signal)=>{if(!signal.aborted)streams++;}};
  output.speak([{text:'Hola'},{text:'Esto no debe hablar.'}],{});
  await new Promise(setImmediate);output.cancel();
  fulfill({ok:true,headers:{get:()=> 'audio/pcm'}});
  await new Promise(setImmediate);
  assert.equal(streams,0);assert.equal(states.at(-1),false);assert.deepEqual(errors,[]);
});

function playbackHarness(fetch) {
  const sources=[],clock={time:0},states=[],errors=[];
  class Audio {
    constructor(){this.state='running';this.destination={};}
    get currentTime(){return clock.time;}
    async resume(){}
    createBuffer(ch,n,rate){const data=new Float32Array(n);return{duration:n/rate,getChannelData:()=>data};}
    createBufferSource(){
      const source={playbackRate:{},connect(){},disconnect(){},start(at){this.at=at;},stop(){this.stopped=true;}};
      sources.push(source);return source;
    }
    createGain(){return{gain:{},connect(){},disconnect(){}};}
  }
  const context=vm.createContext({window:{AudioContext:Audio},setTimeout,clearTimeout,Uint8Array,DataView,AbortController,fetch});
  vm.runInContext(fs.readFileSync('web/live-voice.js','utf8'),context);
  return{...context.window.BrivanyLive,sources,clock,states,errors};
}

function pcmResponse(seconds, onEOF=()=>{}, onCancel=()=>{}) {
  let sent=false;const data=new Uint8Array(Math.round(seconds*48000));
  for(let i=0;i<data.length;i+=2)new DataView(data.buffer).setInt16(i,1000,true);
  return{ok:true,headers:{get:()=> 'audio/pcm'},body:{getReader:()=>({
    read:async()=>{if(!sent){sent=true;return{value:data,done:false};}onEOF();return{done:true};},
    cancel:async()=>onCancel(),releaseLock(){},
  })}};
}

test('barge-in gate rejects quiet input and isolated noise; sustained input triggers after 240 ms', () => {
  const h=playbackHarness(),gate=new h.BargeInGate();
  const loud=new ArrayBuffer(3840),quiet=new ArrayBuffer(3840);
  for(let i=0;i<3840;i+=2)new DataView(loud).setInt16(i,4000,true);
  assert.equal(gate.push(loud),false);assert.equal(gate.push(quiet),false);
  assert.equal(gate.push(loud),false);assert.equal(gate.push(loud),false);assert.equal(gate.push(loud),true);
  gate.reset(.2);assert.equal(gate.push(loud),false);
});

test('echo guard recognizes a recent phrase without treating a correction or a short reply as echo', () => {
  const h=playbackHarness();
  assert.equal(h.isPlaybackEcho('Puedo ayudarte con tu presentación.','Bueno. Puedo ayudarte con tu presentación.'),true);
  assert.equal(h.isPlaybackEcho('No quiero ayuda con mi presentación.','Puedo ayudarte con tu presentación.'),false);
  assert.equal(h.isPlaybackEcho('Sí.','Sí. Te escucho.'),false);
});

test('Muse barge-in stops output, replays a bounded onset once, then accepts the user turn', async () => {
  const sockets=[],nodes=[],results=[];let interrupted=0;
  class Socket { static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}send(x){this.sent.push(x);}close(){this.readyState=3;this.onclose?.();}emit(x){this.onmessage?.({data:JSON.stringify(x)});}}
  class Node {constructor(){this.port={postMessage(){}};nodes.push(this);}connect(){}disconnect(){}}
  const context=vm.createContext({window:{AudioWorkletNode:Node},AudioWorkletNode:Node,WebSocket:Socket,setTimeout,clearTimeout,Uint8Array,DataView,ArrayBuffer,AbortController});
  vm.runInContext(fs.readFileSync('web/live-voice.js','utf8'),context);
  const capture=new context.window.BrivanyLive.MuseCapture({onTranscript:x=>results.push(x),onError:assert.fail,onStatus(){},onBargeIn(){interrupted++;}});
  const start=capture.start({audioWorklet:{addModule:async()=>{}}},{connect(){},disconnect(){}},{url:'ws://local',mode:'practice',language:'es-ES',bargeIn:true});
  await new Promise(setImmediate);sockets[0].emit({type:'ready'});await start;capture.suspend(true);
  for(let frame=0;frame<3;frame++){
    const data=new ArrayBuffer(3840);for(let i=0;i<3840;i+=2)new DataView(data).setInt16(i,4000,true);
    nodes[0].port.onmessage({data});
  }
  assert.equal(interrupted,1);assert.equal(capture.muted,false);assert.equal(capture.preRoll.length,0);
  const wire=sockets[0].sent,control=wire.findIndex(x=>typeof x==='string'&&x.includes('resumeSpeech'));
  assert.deepEqual(JSON.parse(wire[control]),{type:'resumeSpeech',replay_frames:3});
  assert.equal(wire.slice(control+1).length,3);assert.ok(wire.slice(control+1).every(x=>new DataView(x).getInt16(0,true)===4000));
  sockets[0].emit({type:'speech-start',id:'new'});sockets[0].emit({type:'transcript',id:'new',text:'My turn.',final:true});
  assert.equal(results[0].text,'My turn.');capture.stop();assert.equal(capture.preRoll.length,0);
});

test('Melodi prepares the next sentence after EOF while audio plays, preserving pauses and order', async () => {
  let active=0,maxActive=0,calls=0;const events=[];
  const h=playbackHarness(async()=>{
    const call=++calls;active++;maxActive=Math.max(maxActive,active);events.push(`fetch-${call}`);
    return pcmResponse(.5,()=>{active--;events.push(`eof-${call}`);});
  });
  const output=new h.MelodiOutput(s=>h.states.push(s),e=>h.errors.push(e));
  output.speak([{text:'Primera frase.',pauseAfter:90},{text:'Segunda frase.'}],{});
  await new Promise(setImmediate);
  assert.deepEqual(events,['fetch-1','eof-1','fetch-2','eof-2']);
  assert.equal(maxActive,1);assert.equal(h.clock.time,0);assert.equal(h.states.at(-1),true);
  const firstEnd=h.sources[4].at+h.sources[4].buffer.duration;
  assert.ok(Math.abs(h.sources[5].at-firstEnd-.09)<1e-9);
  for(let i=1;i<h.sources.length;i++)assert.ok(h.sources[i].at>=h.sources[i-1].at+h.sources[i-1].buffer.duration-1e-9);
  h.clock.time=2;await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(h.states.at(-1),false);assert.deepEqual(h.errors,[]);output.cancel();
});

test('Melodi forwards English to the server and defaults to Spanish without exposing a voice override', async () => {
  const bodies=[];
  const h=playbackHarness(async(url,options)=>{bodies.push(JSON.parse(options.body));return pcmResponse(.1);});
  const output=new h.MelodiOutput(s=>h.states.push(s),e=>h.errors.push(e));
  output.speak([{text:'Hello.'}],{language:'en'});await new Promise(setImmediate);output.cancel();
  output.speak([{text:'Hola.'}],{});await new Promise(setImmediate);output.cancel();
  assert.equal(bodies[0].language,'en');assert.equal(bodies[1].language,'es');
  assert.equal(bodies[0].consent,true);assert.equal('voice' in bodies[0],false);
});

test('requested pace is synthesized once by Cartesia while PCM playback stays at native rate', async () => {
  const bodies=[];
  const h=playbackHarness(async(url,options)=>{bodies.push(JSON.parse(options.body));return pcmResponse(.5);});
  const output=new h.MelodiOutput(s=>h.states.push(s),e=>h.errors.push(e));
  output.speak([{text:'Una frase con ritmo.'}],{language:'es',rate:1.05});
  await new Promise(setImmediate);
  assert.equal(bodies.length,1);assert.equal(bodies[0].speed,1.05);
  assert.ok(h.sources.length>0);assert.ok(h.sources.every(source=>source.playbackRate.value===1));
  const first=h.sources[0],last=h.sources.at(-1);
  assert.ok(Math.abs(last.at+last.buffer.duration-first.at-.5)<1e-9);
  output.cancel();assert.ok(h.sources.every(source=>source.stopped));assert.deepEqual(h.errors,[]);
});

test('cancelling a prefetched sentence stops queued speech and discards late audio', async () => {
  let calls=0,fulfill,cancelled=0;
  const h=playbackHarness(async()=>++calls===1?pcmResponse(.5):new Promise(resolve=>fulfill=resolve));
  const output=new h.MelodiOutput(s=>h.states.push(s),e=>h.errors.push(e));
  output.speak([{text:'Primera frase.'},{text:'Frase pendiente.'}],{});
  await new Promise(setImmediate);assert.equal(calls,2);
  const scheduled=h.sources.length;output.cancel();
  assert.ok(h.sources.every(source=>source.stopped));
  fulfill(pcmResponse(.5,()=>{},()=>cancelled++));await new Promise(setImmediate);
  assert.equal(h.sources.length,scheduled);assert.equal(cancelled,1);
  assert.equal(h.states.at(-1),false);assert.deepEqual(h.errors,[]);
});

test('coalesced PCM is bounded to two seconds of scheduled audio and cancels promptly', async () => {
  const h=playbackHarness();const player=new h.PCMPlayer();await player.prepare({});
  const controller=new AbortController();const pending=player.stream(pcmResponse(5),controller.signal,{drain:false});
  await new Promise(setImmediate);
  assert.ok(h.sources.length>0);
  assert.ok(h.sources.every(source=>source.at+source.buffer.duration<=2+1e-9));
  const scheduled=h.sources.length;controller.abort();player.cancel();await pending;
  assert.equal(h.sources.length,scheduled);assert.ok(h.sources.every(source=>source.stopped));
});
