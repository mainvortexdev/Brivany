import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferedTranslationPlayer} from '../buffered-player.js';

test('synthesized signal is measured once per active voice and never from a paused cue',()=>{
  const engine=new BufferedTranslationPlayer({video:{},naturalRate:true});
  const cue={voice:{paused:true}};engine.cues.set('test-voice',cue);engine.activeCue='test-voice';
  engine.voiceMeterData=new Float32Array(256);engine.signaledVoiceCount=0;engine.firstSignalAfterCaptureMs=null;
  engine.startedAt=performance.now();let energy=0;
  engine.voiceMeter={getFloatTimeDomainData:data=>data.fill(energy)};
  energy=.2;engine.measureVoiceSignal();assert.equal(engine.signaledVoiceCount,0);
  cue.voice.paused=false;energy=0;engine.measureVoiceSignal();assert.equal(engine.signaledVoiceCount,0);
  energy=.2;engine.measureVoiceSignal();engine.measureVoiceSignal();
  assert.equal(engine.signaledVoiceCount,1);assert.equal(cue.signalObserved,true);
  assert.ok(engine.firstSignalAfterCaptureMs>=0);assert.ok(cue.audioPeak>.19);
  engine.activeCue=null;energy=.8;engine.measureVoiceSignal();assert.equal(engine.signaledVoiceCount,1);
});

class Socket extends EventTarget{
  sent=[];
  send(raw){this.sent.push(JSON.parse(raw));}
  event(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}

test('inline duration correction stays between natural speed and 1.25 without altering the advanced rate',async()=>{
 for(const [naturalRate,duration,slot,expected] of [[true,4.16,2.16,1.25],[true,1,2,1],[true,1.2,1,1.2],[true,1,.08,1],[false,4,2,1.18],[false,1,2,.85]]){
  const engine=new BufferedTranslationPlayer({video:{},naturalRate});
  const voice={addEventListener(){},play(){return Promise.resolve();}};
  engine.cues.set('owned',{voice,duration,event:{}});
  engine.timeline.cue({epoch:1,cue_id:'owned',source_start_ms:0,source_end_ms:slot*1000},duration);
  await engine.startVoice('owned');
  assert.equal(voice.playbackRate,expected);
 }
});
test('provider preparation waits for ready before the capture phase and creates one session',async()=>{
 const socket=new Socket(),pending=BufferedTranslationPlayer.prepare(socket,{target:'fr',epoch:7});let ready=false;pending.then(()=>ready=true);
 await Promise.resolve();assert.equal(ready,false);assert.equal(socket.sent.length,1);assert.equal(socket.sent[0].target_language,'fr');assert.equal(socket.sent[0].epoch,7);
 socket.event({type:'authenticated'});await Promise.resolve();assert.equal(ready,false);
 socket.event({type:'ready',epoch:7});assert.equal((await pending).type,'ready');assert.equal(socket.sent.length,1);
});

test('only the claimed opening prefix is attached to the active synchronized start',async()=>{
 const socket=new Socket();
 const prefix={prefix_id:'owned-opening-token',prefix_source:'youtube:abcdefghijk',prefix_position_ms:140};
 const pending=BufferedTranslationPlayer.prepare(socket,{prefix});
 for(const [key,value] of Object.entries(prefix))assert.equal(socket.sent[0][key],value);
 socket.event({type:'ready'});await pending;
});

test('prepared source timing sent immediately after ready survives slow local audio setup',async()=>{
 const previous={MediaSource:globalThis.MediaSource,MediaRecorder:globalThis.MediaRecorder,createObjectURL:URL.createObjectURL};
 class Media extends EventTarget{static isTypeSupported(){return true;}constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('sourceopen')));}}
 globalThis.MediaSource=Media;globalThis.MediaRecorder=Media;URL.createObjectURL=()=> 'blob:owned-test';
 let rejectWorklet;
 const audio={resume:async()=>{},audioWorklet:{addModule:()=>new Promise((_,reject)=>{rejectWorklet=reject;})}};
 const socket=new Socket(),engine=new BufferedTranslationPlayer({video:{}});
 try{
  const pending=engine.start({stream:{},audio,socket});
  socket.event({type:'ready'});
  socket.event({type:'source-turn',epoch:1,cue_id:'opening',source_start_ms:220,source_end_ms:2620});
  socket.event({type:'source-progress',epoch:1,processed_ms:7000});
  assert.equal(engine.timeline.processed,7);
  assert.equal(engine.timeline.turns.get('opening').start,.22);
  rejectWorklet(Error('test worklet stopped'));
  await assert.rejects(pending,/test worklet stopped/);
 }finally{globalThis.MediaSource=previous.MediaSource;globalThis.MediaRecorder=previous.MediaRecorder;URL.createObjectURL=previous.createObjectURL;}
});
test('cancellation during provider preparation rejects instead of activating later capture',async()=>{
 const socket=new Socket(),pending=BufferedTranslationPlayer.prepare(socket);socket.dispatchEvent(new Event('close'));
 await assert.rejects(pending,/cerró/);socket.event({type:'ready'});assert.equal(socket.sent.length,1);
});
test('provider rejection is surfaced without a second start request',async()=>{
 const socket=new Socket(),pending=BufferedTranslationPlayer.prepare(socket);socket.event({type:'error',message:'Synthetic access rejected'});
 await assert.rejects(pending,/Synthetic access rejected/);assert.equal(socket.sent.length,1);
});

test('lookahead uses the active epoch and stops when playback closes or transport is congested',()=>{
 const previous=globalThis.WebSocket;globalThis.WebSocket={OPEN:1};
 try{
  const socket=new Socket();socket.readyState=1;socket.bufferedAmount=0;
  const engine=new BufferedTranslationPlayer({video:{}});engine.streaming=true;engine.socket=socket;engine.epoch=7;
  const snapshot={source:'youtube:abcdefghijk',position:5,cues:[{start:6,end:8,text:'Hello.',speaker:null}]};
  engine.anticipate(snapshot);assert.equal(socket.sent.length,1);assert.equal(socket.sent[0].epoch,7);
  socket.bufferedAmount=20000;engine.anticipate(snapshot);assert.equal(socket.sent.length,1);
  socket.bufferedAmount=0;engine.closed=true;engine.anticipate(snapshot);assert.equal(socket.sent.length,1);
 }finally{globalThis.WebSocket=previous;}
});

test('the recorder gap waits for speech and resumes on the next decoded frame',()=>{
  const video={currentTime:.42,buffered:{length:2,start:i=>i?.58:0,end:i=>i?10:.44},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});engine.mediaOrigin=0;engine.timeline.processed=2;
  const cue={type:'source-turn',epoch:1,cue_id:'in-gap',source_start_ms:500,source_end_ms:1500};engine.timeline.event(cue);
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.42);assert.equal(video.paused,true);
  assert.equal(engine.stats().recorder_gap_recoveries,0,'Waiting for a cue does not prove a recovered gap');
  engine.timeline.cue(cue,1);
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.595);
  assert.equal(engine.stats().recorder_gap_recoveries,1);
  assert.equal(engine.timeline.decide({capture:5,media:video.currentTime,available:8}).startCue,'in-gap');
  assert.equal(engine.resumeAcrossRecorderGap(),false);
  assert.equal(engine.stats().recorder_gap_recoveries,1,'A recovered gap is counted once');
});

test('a completed provider releases the final delay without losing a pending cue',()=>{
  const engine=new BufferedTranslationPlayer({video:{}});engine.timeline.processed=12;
  const cue={type:'source-turn',epoch:1,cue_id:'tail',source_start_ms:11000,source_end_ms:11800};engine.timeline.event(cue);
  assert.equal(engine.timeline.decide({capture:12,media:11,available:12,tail:true}).reason,'translation');
  engine.timeline.cue(cue,.8);
  assert.equal(engine.timeline.decide({capture:12,media:11,available:12,tail:true}).startCue,'tail');
});

test('an undecodable opening frame before a 393 ms recorder gap retains the first dub',()=>{
  const video={currentTime:0,paused:false,readyState:1,buffered:{length:2,start:i=>i?.539:0,end:i=>i?12:.146},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});engine.mediaOrigin=0;engine.timeline.processed=9;
  const cue={type:'source-turn',epoch:1,cue_id:'opening',source_start_ms:220,source_end_ms:5020};engine.timeline.event(cue);
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,0);
  engine.timeline.cue(cue,5);
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.554);
  assert.equal(engine.timeline.decide({capture:10,media:video.currentTime,available:12,recorderGap:engine.recorderGap}).startCue,'opening');
});

function leadingSilencePlayer({mode='synchronized',processed=2,start=.38,capture=5}={}){
  const video={currentTime:0,paused:true,buffered:{length:1,start:()=>0,end:()=>5},
    play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,mode,failure:error=>assert.fail(error)});
  engine.running=engine.streaming=true;engine.captureTime=capture;engine.startedAt=performance.now();engine.mediaOrigin=0;
  engine.timeline.event({type:'source-turn',epoch:1,cue_id:'first',source_start_ms:start*1000,source_end_ms:2000});
  engine.timeline.event({type:'source-progress',epoch:1,processed_ms:processed*1000});
  return {engine,video};
}

test('autoplay replays only a confirmed silent prefix while the first translated cue is pending',async()=>{
  const {engine,video}=leadingSilencePlayer();
  assert.equal(engine.timeline.preparation({capture:5,available:5}).ready,false);
  engine.tick();assert.equal(video.paused,false,'The already-confirmed leading interval can play during translation');
  video.currentTime=.325;engine.tick();assert.equal(video.paused,true,'Pending speech still holds its own picture before the real onset');
  assert.equal(engine.timeline.turns.get('first').started,false);
  engine.timeline.cue({epoch:1,cue_id:'first',source_start_ms:380,source_end_ms:2000},1.62);
  const onsets=[];engine.startVoice=async id=>{onsets.push({id,media:video.currentTime});engine.timeline.started(id);};
  video.currentTime=.355;engine.tick();await Promise.resolve();assert.deepEqual(onsets,[{id:'first',media:.355}]);
});

test('unknown silence, insufficient ASR progress or less than the minimum buffer never bypass preparation',()=>{
  for(const options of [{processed:.2},{capture:4.1},{start:0}]){
    const {engine,video}=leadingSilencePlayer(options);engine.tick();assert.equal(video.paused,true,JSON.stringify(options));
  }
  const {engine,video}=leadingSilencePlayer();engine.timeline.turns.clear();engine.tick();assert.equal(video.paused,true);
});

test('preproduction and an explicit user pause retain their playback requirement for a confirmed prefix',()=>{
  const prepared=leadingSilencePlayer({mode:'preproduction',capture:6,processed:6});prepared.engine.tick();assert.equal(prepared.video.paused,true);
  assert.equal(prepared.engine.timeline.playbackStarted,false);
  const paused=leadingSilencePlayer();paused.engine.userPaused=true;paused.engine.tick();assert.equal(paused.video.paused,true);
});

test('a decoder that is waiting has only one pending play request',async()=>{
  let pending,requests=0;
  const video={paused:true,play(){requests++;return new Promise(resolve=>{pending=resolve;});}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});
  engine.playVideo();engine.playVideo();engine.playVideo();
  assert.equal(requests,1);
  pending();await engine.pendingPlay;
  assert.equal(engine.pendingPlay,null);
});

test('a slow voice start holds the inline picture on the next tick and resumes after it starts',async()=>{
 for(const naturalRate of [true,false]){
  let pauses=0,plays=0,starts=0,release;
  const voiceReady=new Promise(resolve=>{release=resolve;});
  const video={currentTime:1,paused:false,readyState:4,buffered:{length:1,start:()=>0,end:()=>7},
   pause(){pauses++;this.paused=true;},play(){plays++;this.paused=false;return Promise.resolve();}};
  const engine=new BufferedTranslationPlayer({video,naturalRate,failure:error=>assert.fail(error)});
  engine.running=engine.streaming=true;engine.captureTime=6;engine.mediaOrigin=0;engine.startedAt=performance.now();
  engine.timeline.processed=6;
  engine.timeline.cue({epoch:1,cue_id:'first',source_start_ms:1000,source_end_ms:2500},1);
  engine.startVoice=async id=>{starts++;engine.activeCue=id;engine.timeline.started(id);await voiceReady;};

  engine.tick();
  assert.equal(video.paused,!naturalRate,'the advanced player retains its immediate pause');
  engine.tick();engine.tick();
  assert.equal(video.paused,true);assert.equal(pauses,1);assert.equal(starts,1);assert.equal(plays,0);

  release();await new Promise(setImmediate);
  engine.tick();
  assert.equal(video.paused,false);assert.equal(plays,1);assert.equal(starts,1);
  video.currentTime=1.1;engine.tick();
  assert.equal(video.paused,false);assert.equal(pauses,1);assert.equal(plays,1);
 }
});

test('a pending play can recover a recorder gap even when Chromium reports readyState four',()=>{
  const failures=[],video={currentTime:.212372,paused:true,readyState:4,seeking:false,
    buffered:{length:3,start:index=>[0,.419,1.62][index],end:index=>[.263,1.431,7.559][index]},
    play(){this.paused=false;return new Promise(()=>{});},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true,failure:error=>failures.push(error)});
  engine.running=engine.streaming=true;engine.captureTime=7.6;engine.mediaOrigin=0;
  engine.timeline.event({type:'source-progress',epoch:1,processed_ms:6080});
  const first={type:'source-turn',epoch:1,cue_id:'opening',source_start_ms:60,source_end_ms:2482};
  engine.timeline.cue(first,2.32);engine.timeline.started('opening');engine.activeCue='opening';
  engine.cues.set('opening',{voice:{currentTime:1.685333}});
  engine.playVideo();
  engine.lastDecoderPosition=video.currentTime;engine.decoderWaitSince=performance.now()-1600;
  engine.tick();
  assert.equal(video.currentTime,.434,'Recovery must happen before the decoder watchdog truncates the active voice');
  assert.equal(engine.activeCue,'opening');assert.equal(engine.timeline.turns.get('opening').finished,false);
  assert.deepEqual(failures,[]);
});

test('a healthy decoder does not skip remaining frames before a small recorder gap',()=>{
  const video={currentTime:.212372,paused:false,readyState:4,
    buffered:{length:2,start:index=>index?.419:0,end:index=>index?7.559:.263},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});engine.mediaOrigin=0;engine.timeline.processed=6;
  assert.equal(engine.resumeAcrossRecorderGap(),false);
  assert.equal(video.currentTime,.212372);
  engine.pendingPlay=Promise.resolve();engine.lastDecoderPosition=.18;engine.decoderWaitSince=performance.now()-1000;
  assert.equal(engine.resumeAcrossRecorderGap(),false,'A still-pending play request cannot skip frames while its media clock advances');
  engine.lastDecoderPosition=video.currentTime;engine.decoderWaitSince=performance.now();
  assert.equal(engine.resumeAcrossRecorderGap(),false,'A new play request gets a chance to decode before skipping a gap');
});

test('pending decoder recovery still waits for the next speech cue and ASR progress',()=>{
  const video={currentTime:.212372,paused:false,readyState:4,
    buffered:{length:2,start:index=>index?.419:0,end:index=>index?7.559:.263},pause(){this.paused=true;}};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});engine.mediaOrigin=0;engine.pendingPlay=Promise.resolve();
  engine.lastDecoderPosition=video.currentTime;engine.decoderWaitSince=performance.now()-200;
  const next={type:'source-turn',epoch:1,cue_id:'in-gap',source_start_ms:300,source_end_ms:1800};
  engine.timeline.event(next);engine.timeline.processed=6;
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.212372);
  engine.timeline.cue(next,1.5);engine.timeline.processed=.4;
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.212372);
  engine.timeline.processed=6;
  assert.equal(engine.resumeAcrossRecorderGap(),true);assert.equal(video.currentTime,.434);
  assert.equal(engine.timeline.decide({capture:8,media:.434,available:7.559,recorderGap:engine.recorderGap}).startCue,'in-gap');
});

test('decoder progress and an intentional cue wait do not hide a persistent undecodable stall',()=>{
  const video={currentTime:.212372,paused:false,readyState:4,seeking:false};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});engine.pendingPlay=Promise.resolve();
  assert.equal(engine.stalledDecoder(1000),false);
  assert.equal(engine.stalledDecoder(2501),true);
  video.currentTime=.434;
  assert.equal(engine.stalledDecoder(2502),false,'A successful seek starts a fresh bounded decoder observation');
  assert.equal(engine.stalledDecoder(4003),true);
  video.paused=true;
  assert.equal(engine.stalledDecoder(8000),false,'Waiting for a missing voice is not a decoder hang');
  video.paused=false;
  assert.equal(engine.stalledDecoder(8001),false);
  assert.equal(engine.stalledDecoder(9502),true,'An unchanged decoder still fails after 1.5 seconds');
});

test('a single frame drop window is tolerated but sustained loss releases the inline copy',()=>{
  let quality={totalVideoFrames:24,droppedVideoFrames:12};
  const video={paused:false,getVideoPlaybackQuality:()=>quality};
  const engine=new BufferedTranslationPlayer({video,naturalRate:true});
  assert.equal(engine.overloadedDecoder(1000),false);
  assert.equal(engine.overloadedDecoder(1500),false);
  quality={totalVideoFrames:48,droppedVideoFrames:13};
  assert.equal(engine.overloadedDecoder(2000),false);
  quality={totalVideoFrames:72,droppedVideoFrames:25};
  assert.equal(engine.overloadedDecoder(3000),false);
  quality={totalVideoFrames:96,droppedVideoFrames:37};
  assert.equal(engine.overloadedDecoder(4000),true);
});
