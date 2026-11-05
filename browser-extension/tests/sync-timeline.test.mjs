import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncTimeline,pairAddress,syncAddress,translationMode} from '../sync-timeline.js';
const start=(timeline,id,at,end=null)=>timeline.event({type:'source-turn',epoch:1,cue_id:id,source_start_ms:at*1000,source_end_ms:end===null?null:end*1000});
test('a filtered song advances without waiting for translated lyrics or audio',()=>{
 const timeline=new SyncTimeline();timeline.event({type:'source-progress',epoch:1,processed_ms:8000});start(timeline,'song',1,3);
 assert.equal(timeline.decide({capture:8,media:1,available:8}).reason,'translation');
 timeline.event({type:'source-skipped',epoch:1,cue_id:'song',source_start_ms:1000,source_end_ms:3000});
 assert.equal(timeline.decide({capture:8,media:1,available:8}).play,true);assert.equal(timeline.firstReady(4),true);
 assert.equal(timeline.event({type:'source-skipped',epoch:0,cue_id:'old',source_start_ms:0,source_end_ms:3000}),false);
});
const cue=(timeline,id,at,end,duration=end-at)=>timeline.cue({epoch:1,cue_id:id,source_start_ms:at*1000,source_end_ms:end*1000},duration);
const progress=(timeline,at)=>timeline.event({type:'source-progress',epoch:1,processed_ms:at*1000});
const decide=(timeline,overrides={})=>timeline.decide({capture:8,media:1,available:7,...overrides});

test('pairing accepts only a loopback WebSocket with a six digit code and binds sync origin',()=>{
  assert.deepEqual(pairAddress(' ws://127.0.0.1:48217/pair#123456 '),{url:'ws://127.0.0.1:48217/pair',code:'123456'});
  for(const value of ['https://127.0.0.1/pair#123456','ws://localhost:48217/pair#123456','ws://example.org/pair#123456','ws://a:b@127.0.0.1/pair#123456','ws://127.0.0.1/pair?q=a#123456','ws://127.0.0.1/pair#12345'])assert.throws(()=>pairAddress(value));
  assert.equal(syncAddress('ws://127.0.0.1:48217/sync','ws://127.0.0.1:48217/pair'),'ws://127.0.0.1:48217/sync');
  for(const value of ['ws://127.0.0.1:99/sync','ws://example.org/sync','ws://127.0.0.1:48217/else'])assert.throws(()=>syncAddress(value,'ws://127.0.0.1:48217/pair'));
});
test('four seconds alone cannot start a picture before real ASR progress',()=>{
  const timeline=new SyncTimeline();assert.equal(decide(timeline,{capture:3,media:0}).play,false);
  assert.equal(decide(timeline,{capture:5,media:0}).reason,'recognition');
  progress(timeline,3);assert.equal(decide(timeline,{capture:5,media:0}).play,true);
  assert.equal(decide(timeline,{capture:5,media:1}).reason,'lookahead');
});
test('a late provider holds the matching picture before the speech and resumes with its cue',()=>{
  const timeline=new SyncTimeline();progress(timeline,7);start(timeline,'one',1,2);
  assert.equal(decide(timeline).reason,'translation');
  assert.equal(decide(timeline,{capture:10}).reason,'translation');
  cue(timeline,'one',1,2);assert.deepEqual(decide(timeline).startCue,'one');
  timeline.started('one');assert.equal(decide(timeline,{media:1.5,activeCue:'one'}).play,true);
  assert.equal(decide(timeline,{media:2,activeCue:'one'}).reason,'voice-tail');
  timeline.finished('one');assert.equal(decide(timeline,{media:2}).play,true);
});
test('late audio is rejected rather than played over an unrelated picture',()=>{
  const timeline=new SyncTimeline();progress(timeline,8);start(timeline,'one',1,2);cue(timeline,'one',1,2);
  assert.throws(()=>decide(timeline,{media:1.3}),/desincronización/);
});
test('old epochs never enter the new session and transcript-only markers cannot be cues',()=>{
  const timeline=new SyncTimeline();assert.equal(timeline.event({type:'source-progress',epoch:0,processed_ms:50000}),false);
  assert.equal(timeline.cue({epoch:0,cue_id:'old'},1),false);assert.equal(timeline.turns.size,0);
  assert.throws(()=>start(timeline,'bad',-1));assert.throws(()=>cue(timeline,'one',0,1,31));
});
test('buffer has a hard thirty second horizon even while paused',()=>{
  const timeline=new SyncTimeline();progress(timeline,10);
  assert.equal(decide(timeline,{capture:30,media:0,paused:true}).reason,'paused');
  assert.throws(()=>decide(timeline,{capture:31,media:0,paused:true}),/treinta/);
});

test('the live tab returns to source for an open turn and ignores its later dub',()=>{
 const timeline=new SyncTimeline();
 start(timeline,'open',0);start(timeline,'next',14,16);
 timeline.releaseLateTurns(11.9,0);assert.equal(timeline.originalAt(0),false);
 timeline.releaseLateTurns(12,0);assert.equal(timeline.originalAt(1),true);
 assert.equal(timeline.cue({epoch:1,cue_id:'open',source_start_ms:0,source_end_ms:13000},1),false);
 timeline.event({type:'source-turn',epoch:1,cue_id:'open',source_start_ms:0,source_end_ms:13000});
 timeline.prune(14);assert.equal(timeline.turns.has('open'),false);
 assert.equal(timeline.cue({epoch:1,cue_id:'open',source_start_ms:0,source_end_ms:13000},1),false);
 assert.equal(timeline.originalAt(14),false);
});
test('preproduction requires five prepared seconds and explicit playback',()=>{
  const policy=translationMode('preproduction');assert.equal(policy.delay,5);assert.equal(policy.autoplay,false);
  const timeline=new SyncTimeline({delay:policy.delay});start(timeline,'one',0,2);progress(timeline,5);
  assert.equal(timeline.prepared(5),false);cue(timeline,'one',0,2);assert.equal(timeline.prepared(5),true);
  assert.equal(decide(timeline,{capture:6,media:0,paused:true}).play,false);
  assert.equal(decide(timeline,{capture:6,media:0,paused:false}).startCue,'one');
  assert.equal(translationMode('synchronized').autoplay,true);assert.throws(()=>translationMode('remote'));
});
test('cue IDs are unique and completed intervals can be released from memory',()=>{
  const timeline=new SyncTimeline();start(timeline,'one',0,1);cue(timeline,'one',0,1);
  assert.throws(()=>cue(timeline,'one',0,1),/Duplicate/);timeline.finished('one');timeline.prune(2);assert.equal(timeline.turns.size,0);
});
test('an eight second utterance with seven seconds provider work holds at its source onset instead of dropping content',()=>{
  const timeline=new SyncTimeline();progress(timeline,9);start(timeline,'long',0,8);
  assert.equal(decide(timeline,{capture:4,media:0}).play,false);
  assert.equal(decide(timeline,{capture:12,media:0}).reason,'translation');
  assert.equal(decide(timeline,{capture:15,media:0}).reason,'translation');
  cue(timeline,'long',0,8,10);assert.equal(decide(timeline,{capture:15,media:0}).startCue,'long');
  timeline.started('long');assert.equal(decide(timeline,{capture:20,media:8,available:19,activeCue:'long'}).reason,'voice-tail');
  timeline.finished('long');assert.equal(decide(timeline,{capture:20,media:8,available:19}).play,true);
  assert.equal(timeline.stats().max_observed_delay_seconds,15);
});
test('preproduction can start with the first cue while a second utterance crossing five seconds is still being translated',()=>{
  const timeline=new SyncTimeline({delay:5});start(timeline,'first',.3,2.8);start(timeline,'second',3.5,6.7);progress(timeline,5.2);cue(timeline,'first',.3,2.8);
  assert.equal(timeline.prepared(5),false,'The historical whole-window predicate would keep waiting for the second utterance');
  assert.equal(timeline.firstReady(5),true);
  assert.deepEqual(timeline.preparation({capture:5.2,available:5.1}),{ready:true,budget_exceeded:false,needs_more_time:false});
  timeline.started('first');timeline.finished('first');
  assert.equal(decide(timeline,{capture:9,media:3.5,available:8}).reason,'translation','Later missing cues still hold their own image interval');
});
test('six seconds without the first cue signals a missed budget without dropping audio or silently extending a promise',()=>{
  const timeline=new SyncTimeline({delay:5});start(timeline,'first',.3,2.8);progress(timeline,6);
  assert.deepEqual(timeline.preparation({capture:5.9,available:5.8}),{ready:false,budget_exceeded:false,needs_more_time:false});
  assert.deepEqual(timeline.preparation({capture:6,available:5.9}),{ready:false,budget_exceeded:true,needs_more_time:true});
  assert.equal(timeline.turns.get('first').ready,false);assert.equal(timeline.turns.size,1);
  cue(timeline,'first',.3,2.8);assert.equal(timeline.preparation({capture:7,available:6.8}).ready,true);
});

test('inline replay waits for a reserve instead of playing and pausing for each PCM packet',()=>{
  const timeline=new SyncTimeline();progress(timeline,8);
  const tick=capture=>decide(timeline,{capture,media:2,available:6,smooth:true});
  assert.equal(tick(6.28).play,true);
  assert.equal(tick(6).reason,'lookahead');
  for(const capture of [6.08,6.16,6.24])assert.equal(tick(capture).reason,'lookahead');
  assert.equal(tick(6.32).play,true);
  assert.equal(tick(6.16).play,true);
});

test('the inline first cue can play after four buffered seconds with ASR still catching up',()=>{
  const timeline=new SyncTimeline();start(timeline,'first',.2,2);progress(timeline,2);
  const clocks={capture:4.4,available:4.3};
  assert.equal(timeline.preparation({...clocks,smooth:true}).ready,false);
  cue(timeline,'first',.2,2);
  assert.equal(timeline.preparation(clocks).ready,false);
  assert.equal(timeline.preparation({...clocks,smooth:true}).ready,true);
  assert.equal(decide(timeline,{capture:4.6,media:.2,available:4.3,smooth:true}).startCue,'first');
});

test('a finalized inline turn has time to receive a late dub while an open turn still falls back',()=>{
  const waiting={maxAge:7,finalGrace:7,finalMaxAge:9.5};
  const timeline=new SyncTimeline();start(timeline,'closed',0,3);
  timeline.releaseLateTurns(9.16,0,waiting);
  assert.equal(timeline.originalAt(0),false);
  assert.equal(cue(timeline,'closed',0,3),true);

  const open=new SyncTimeline();start(open,'open',0);
  open.releaseLateTurns(7.1,0,waiting);
  assert.equal(open.originalAt(0),true);

  const expired=new SyncTimeline();start(expired,'expired',0,5);
  expired.releaseLateTurns(9.5,0,waiting);
  assert.equal(expired.originalAt(0),true);
  assert.equal(cue(expired,'expired',0,5),false);
});

test('the inline voice tail uses at most .4 seconds of confirmed silence and stops before another turn',()=>{
  const timeline=new SyncTimeline();start(timeline,'dub',1,2);cue(timeline,'dub',1,2,1.6);timeline.started('dub');progress(timeline,8);
  const tick=media=>decide(timeline,{capture:10,media,available:9,activeCue:'dub',smooth:true});
  assert.equal(tick(2.25).play,true);
  assert.equal(tick(2.38).reason,'voice-tail');
  start(timeline,'next',2.2,3);
  assert.equal(tick(2.1).play,true);
  assert.equal(tick(2.16).reason,'voice-tail');
  timeline.turns.delete('next');timeline.processed=2.04;
  assert.equal(tick(2).reason,'voice-tail');
});

test('contiguous ASR windows wait for the earliest dub and play one at a time',()=>{
  const timeline=new SyncTimeline();start(timeline,'original',1);
  const window=(id,start,end)=>({epoch:1,type:'source-turn',cue_id:id,source_start_ms:start*1000,source_end_ms:end*1000,timing_quality:'asr_partial_window'});
  timeline.event(window('original',1,2));timeline.event(window('remainder',2,3));progress(timeline,8);
  timeline.cue(window('remainder',2,3),1);
  const tick=(media,activeCue=null)=>decide(timeline,{capture:9,media,available:8,activeCue,smooth:true});
  assert.equal(tick(1).reason,'translation');
  timeline.cue(window('original',1,2),1.2);
  assert.equal(tick(1).startCue,'original');timeline.started('original');
  assert.equal(tick(1.99,'original').reason,'voice-tail');
  timeline.finished('original');assert.equal(tick(1.99).startCue,'remainder');
});
