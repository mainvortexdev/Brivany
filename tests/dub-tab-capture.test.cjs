'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const origin='http://127.0.0.1:8765',source=fs.readFileSync('web/dub-tab-capture.js','utf8');

function fixture({surface='browser',wrongHandle=false,handle=true,configurable=true,metadata=true,suppressed=true,delayed=false,noAudio=false,endedAudio=false,syncError=null,restrictOwnAudio=false}={}) {
  let config,release;const events=[],contexts=[],nodes=[],worklets=[],configs=[],stops=[],mediaCalls=[];
  const eventTarget=()=>{const listeners=new Map();return {
    addEventListener(type,listener){const list=listeners.get(type) || [];list.push(listener);listeners.set(type,list);},
    emit(type){for(const listener of listeners.get(type) || [])listener({type});}
  };};
  function track(kind){return {...eventTarget(),kind,readyState:'live',stop(){this.readyState='ended';stops.push(kind);}};}
  const video=track('video'),audioTrack=track('audio');if(endedAudio)audioTrack.readyState='ended';
  if(metadata){video.getSettings=()=>({displaySurface:surface,...(suppressed===null?{}:{suppressLocalAudioPlayback:suppressed})});audioTrack.getSettings=()=>({...suppressed===null?{}:{suppressLocalAudioPlayback:suppressed},restrictOwnAudio});}
  if(handle)video.getCaptureHandle=()=>({origin,handle:wrongHandle?'another-tab':config?.handle});
  const tracks=noAudio?[video]:[video,audioTrack],stream={getVideoTracks:()=>[video],getAudioTracks:()=>noAudio?[]:[audioTrack],getTracks:()=>tracks};
  const media={getDisplayMedia(options){events.push('permission');mediaCalls.push(options);if(syncError)throw syncError;return delayed?new Promise(resolve=>{release=resolve;}):Promise.resolve(stream);}};
  if(configurable)media.setCaptureHandleConfig=value=>{config=value;configs.push(value);};
  class AudioNode {
    constructor(type){this.type=type;this.connections=[];this.disconnected=false;this.gain={value:1};nodes.push(this);}
    connect(node){this.connections.push(node);return node;}
    disconnect(){this.disconnected=true;this.connections=[];}
  }
  class Audio {
    constructor(options){this.options=options;this.state='suspended';this.closed=0;this.destination={type:'destination'};contexts.push(this);events.push('context');this.audioWorklet={addModule:async url=>{events.push('worklet');this.module=url;}};}
    resume(){events.push('resume');this.state='running';return Promise.resolve();}
    close(){events.push('close');this.closed++;this.state='closed';return Promise.resolve();}
    createMediaStreamSource(value){this.inputStream=value;return new AudioNode('stream');}
    createGain(){return new AudioNode('gain');}
  }
  class Worklet extends AudioNode {
    constructor(audio,name){super('worklet');this.audio=audio;this.name=name;this.port={onmessage:null,postMessage(){}};worklets.push(this);}
  }
  class Stream {constructor(value){this.tracks=value;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}}
  const window={AudioContext:Audio,AudioWorkletNode:Worklet};
  vm.runInNewContext(source,{window,navigator:{mediaDevices:media},location:{origin},crypto:webcrypto,DOMException,Uint8Array,MediaStream:Stream,AudioWorkletNode:Worklet});
  return {...window.BrivanyTabAudio,media,video,audioTrack,stream,contexts,nodes,worklets,events,configs,stops,mediaCalls,release(){assert.equal(typeof release,'function');release(stream);}};
}

test('optional Capture Handle and settings metadata may be absent while an audio graph still delivers PCM',async()=>{
  for(const options of [{handle:false},{configurable:false,handle:false},{metadata:false,handle:false}]) {
    const f=fixture(options),pcm=[],capture=await f.openTabAudio({onPcm:value=>pcm.push(value)});
    assert.equal(capture.source,'user_selected_surface');assert.equal(capture.videoFramesTransmitted,false);
    assert.equal(capture.audio.inputStream.getAudioTracks().length,1);assert.equal(capture.audio.inputStream.getTracks().length,1);
    assert.equal(f.worklets[0].name,'brivany-dub-capture');assert.equal(capture.audio.module,'/dub-capture.js');
    const packet={buffer:new ArrayBuffer(8)};f.worklets[0].port.onmessage({data:packet});assert.equal(pcm[0],packet);
    capture.stop();f.worklets[0].port.onmessage({data:{buffer:new ArrayBuffer(2)}});assert.equal(pcm.length,1);
    assert.equal(f.stops.length,2);assert.equal(capture.audio.closed,1);assert.ok(f.nodes.every(node=>node.disconnected));
  }
});

test('unconfirmed or false suppression permits capture and keeps browser and native original audio low',async()=>{
  for(const suppressed of [false,null]) {
    const f=fixture({suppressed}),capture=await f.openTabAudio();assert.equal(capture.originalPlaybackSuppressed,suppressed);
    const mix=capture.configureOriginal(.15);
    assert.ok(mix.playerVolume>0 && mix.playerVolume<=15);assert.ok(mix.nativeOriginalGain>=0 && mix.nativeOriginalGain<=.075);
    assert.ok(mix.playerVolume/100+mix.nativeOriginalGain<=.16,'unknown suppression must not duplicate loud original playback');
    assert.ok(Math.abs(mix.playerVolume/100*mix.inputGain-1)<1e-10,'quiet local playback is compensated only on the capture input');
    assert.equal(f.nodes.find(node=>node.type==='gain').gain.value,mix.inputGain);
    assert.throws(()=>capture.configureOriginal(Infinity),/Volumen/);capture.stop();
  }
});

test('confirmed suppression preserves capture strength and delegates the requested original level',async()=>{
  const f=fixture(),capture=await f.openTabAudio(),mix=capture.configureOriginal(.15);
  assert.equal(capture.source,'own_browser_tab');assert.equal(capture.originalPlaybackSuppressed,true);
  assert.equal(mix.playerVolume,100);assert.equal(mix.inputGain,1);assert.equal(mix.nativeOriginalGain,.15);
  capture.stop();capture.stop();assert.equal(f.stops.length,2);assert.equal(capture.audio.closed,1);
  assert.equal(f.configs.at(-1).exposeOrigin,false);assert.equal(f.configs.at(-1).handle,'');
});

test('known monitor/window surfaces and mismatched Capture Handle reject before processing',async()=>{
  for(const options of [{surface:'monitor'},{surface:'window'},{wrongHandle:true}]) {
    const f=fixture(options);await assert.rejects(f.openTabAudio(),/esta pestaña/);
    assert.equal(f.mediaCalls.length,1);assert.equal(f.worklets.length,0);assert.equal(f.stops.length,2);assert.equal(f.contexts[0].closed,1);
  }
});

test('missing or ended shared audio explains the audio toggle and releases the stream',async()=>{
  for(const options of [{noAudio:true},{endedAudio:true}]) {
    const f=fixture(options);await assert.rejects(f.openTabAudio(),/Permitir también audio de las pestañas/);
    assert.equal(f.worklets.length,0);assert.equal(f.stops.length,options.noAudio?1:2);assert.equal(f.contexts[0].closed,1);
  }
});

test('permission arriving after cancellation releases all late tracks without a processing graph',async()=>{
  const f=fixture({delayed:true}),controller=new AbortController(),pending=f.openTabAudio({signal:controller.signal});
  assert.deepEqual(f.events.slice(0,3),['context','resume','permission']);controller.abort();f.release();
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(f.stops.length,2);assert.equal(f.contexts[0].closed,1);assert.equal(f.worklets.length,0);
});

test('AudioContext resumes before permission; a synchronous getDisplayMedia failure cleans it',async()=>{
  const f=fixture({syncError:new DOMException('Denied','NotAllowedError')});
  await assert.rejects(f.openTabAudio(),/permite el audio de esta pestaña/);
  assert.deepEqual(f.events,['context','resume','permission','close']);assert.equal(f.contexts[0].closed,1);assert.equal(f.worklets.length,0);
  assert.equal(f.configs.at(-1).exposeOrigin,false);
});

test('ended tracks and changed known tab identity close exactly once and notify the caller',async()=>{
  for(const reason of ['ended','identity']) {
    const f=fixture(),ended=[],capture=await f.openTabAudio({onEnded:()=>ended.push(reason)});
    if(reason==='identity'){f.video.getCaptureHandle=()=>({origin:'https://other.invalid',handle:'wrong'});f.video.emit('capturehandlechange');}else f.audioTrack.emit('ended');
    f.video.emit('ended');capture.stop();assert.deepEqual(ended,[reason]);assert.equal(f.stops.length,2);assert.equal(capture.audio.closed,1);
  }
});

test('own-audio exclusion, unsupported capture and pre-cancelled requests never start processing',async()=>{
  const restricted=fixture({restrictOwnAudio:true});await assert.rejects(restricted.openTabAudio(),/excluyó el audio/);assert.equal(restricted.worklets.length,0);assert.equal(restricted.stops.length,2);
  const unsupported=fixture();delete unsupported.media.getDisplayMedia;await assert.rejects(unsupported.openTabAudio(),/Chrome o Edge/);assert.equal(unsupported.contexts.length,0);
  const cancelled=fixture(),controller=new AbortController();controller.abort();await assert.rejects(cancelled.openTabAudio({signal:controller.signal}),error=>error.name==='AbortError');assert.equal(cancelled.mediaCalls.length,0);assert.equal(cancelled.contexts.length,0);
});
