'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PcmEnergyClock,summarize,SegmentLatencyTracker}=require('../web/dub-timing.js');
const rate=24000;
const pcm=(seconds,value=0)=>new Float32Array(Math.round(seconds*rate)).fill(value);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('long source silence cannot be mistaken for a low dubbing onset delay',()=>{
  const source=new PcmEnergyClock(),translated=new PcmEnergyClock();
  source.observe(pcm(.12),rate,0).observe(pcm(1.48,.2),rate,.12).observe(pcm(.744208333333),rate,1.6).finish();
  translated.observe(pcm(.06),rate,2.55).observe(pcm(2,.2),rate,2.61).finish();
  const snapshot=source.snapshot(),metrics=summarize(snapshot,translated.snapshot());
  near(snapshot.first_energy_context,.12); near(snapshot.last_energy_context,1.6);
  near(snapshot.record_end_context,56261/rate);
  near(metrics.onset_to_onset_ms,2490);
  near(metrics.first_translation_after_last_source_energy_ms,1010);
  near(metrics.first_translation_after_source_file_end_ms,265.7916666666667);
  near(metrics.tail_to_tail_ms,3010);
  assert.equal(Object.keys(metrics).length,4);
});

test('RMS windows continue across differently sized packets',()=>{
  const samples=new Float32Array(2400);
  samples.fill(.05,350,1020);
  const whole=new PcmEnergyClock().observe(samples,rate,1).finish();
  const sliced=new PcmEnergyClock(); let offset=0;
  for(const length of [17,463,1,220,899,800]) {
    sliced.observe(samples.subarray(offset,offset+length),rate,1+offset/rate); offset+=length;
  }
  sliced.finish();
  const actual=sliced.snapshot(),expected=whole.snapshot();
  for(const key of ['first_energy_context','last_energy_context','record_start_context','record_end_context']) near(actual[key],expected[key]);
  assert.equal(actual.frames,expected.frames);
});

test('gaps discard an incomplete window instead of merging separate fragments',()=>{
  const clock=new PcmEnergyClock();
  clock.observe(pcm(.01,.02),rate,0);
  clock.observe(pcm(.02),rate,.1).finish();
  assert.equal(clock.snapshot().first_energy_context,null);
  assert.equal(clock.snapshot().frames,720);
  near(clock.snapshot().record_end_context,.12);
});

test('one-frame timestamp jitter preserves a continuous RMS window',()=>{
  const clock=new PcmEnergyClock();
  clock.observe(pcm(.01,.02),rate,0).observe(pcm(.01,.02),rate,.01+1/rate).finish();
  near(clock.snapshot().first_energy_context,0); near(clock.snapshot().last_energy_context,.02);
});

test('sample-rate changes reset a partial RMS window',()=>{
  const clock=new PcmEnergyClock();
  clock.observe(pcm(.01,.02),rate,0).observe(new Float32Array(960),48000,.01).finish();
  assert.equal(clock.snapshot().first_energy_context,null);
  near(clock.snapshot().record_end_context,.03);
});

test('finish can evaluate a final partial window and is idempotent',()=>{
  const clock=new PcmEnergyClock().observe(pcm(.005,.1),rate,3);
  assert.equal(clock.snapshot().first_energy_context,null);
  clock.finish(); const first=clock.snapshot(); clock.finish();
  assert.deepEqual(clock.snapshot(),first);
  near(first.first_energy_context,3); near(first.last_energy_context,3.005);
});

test('silence and empty clocks leave energy metrics unknown',()=>{
  const empty=new PcmEnergyClock(),silent=new PcmEnergyClock().observe(pcm(.5),rate,2).finish();
  assert.equal(silent.snapshot().first_energy_context,null);
  assert.deepEqual(summarize(empty.snapshot(),silent.snapshot()),{
    onset_to_onset_ms:null,first_translation_after_last_source_energy_ms:null,
    tail_to_tail_ms:null,first_translation_after_source_file_end_ms:null
  });
  assert.deepEqual(summarize({},{}),summarize(empty.snapshot(),silent.snapshot()));
});

test('invalid PCM and timing inputs fail before altering state',()=>{
  const clock=new PcmEnergyClock().observe(pcm(.02,.1),rate,0),before=clock.snapshot();
  for(const [samples,sampleRate,start] of [
    [new Float32Array([.2,NaN]),rate,.02],[new Float32Array([Infinity]),rate,.02],
    [new Float32Array([1.01]),rate,.02],[new Int16Array([1]),rate,.02],
    [pcm(.02),0,.02],[pcm(.02),rate,Infinity],[pcm(.02),rate,-1]
  ]) { assert.throws(()=>clock.observe(samples,sampleRate,start),TypeError); assert.deepEqual(clock.snapshot(),before); }
  assert.throws(()=>new PcmEnergyClock({windowMs:0}),TypeError);
  assert.throws(()=>new PcmEnergyClock({rmsThreshold:NaN}),TypeError);
});

test('overlapping translation can produce a negative end-to-first metric without a pass badge',()=>{
  const metrics=summarize({first_energy_context:1,last_energy_context:4,record_end_context:5},
    {first_energy_context:2,last_energy_context:6});
  assert.deepEqual(metrics,{onset_to_onset_ms:1000,first_translation_after_last_source_energy_ms:-2000,
    tail_to_tail_ms:2000,first_translation_after_source_file_end_ms:-3000});
  assert.deepEqual(summarize({first_energy_context:NaN},{first_energy_context:2}),{
    onset_to_onset_ms:null,first_translation_after_last_source_energy_ms:null,
    tail_to_tail_ms:null,first_translation_after_source_file_end_ms:null
  });
});

test('two correlated segments preserve a slower second onset instead of using the first audio for all',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(3*rate,rate,100);
  const first={segment_id:'first',audio_segment_final:true};
  tracker.observeAudio(first,pcm(.04,.1),rate,100.45);
  // Captions can arrive after the corresponding audio.
  tracker.observeTranscript({source:'translation',segment_id:'first',source_start_seconds:.1,source_end_seconds:.4});
  tracker.observeTranscript({source:'translation',segment_id:'second',source_start_seconds:1.5,source_end_seconds:2});
  tracker.observeAudio({segment_id:'second',audio_segment_final:true},pcm(.04,.1),rate,102.2);
  const measured=tracker.snapshot();assert.equal(measured.correlated_segment_count,2);
  near(measured.segments[0].onset_delay_ms,350);near(measured.segments[0].response_after_source_end_ms,50);
  near(measured.segments[1].onset_delay_ms,700);near(measured.max_observed_onset_delay_ms,700);
  assert.equal(measured.audible_delay_verified,false);assert.equal(measured.physical_playback_measured,false);
  assert.equal('segment_id' in measured.segments[0],false);
});

test('turn timestamps and absent IDs cannot be borrowed to fabricate part alignment',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  tracker.observeTranscript({source:'original',turn_id:'turn',source_start_seconds:0,source_end_seconds:.3});
  tracker.observeAudio({segment_id:'part-without-its-own-timestamps'},pcm(.04,.1),rate,.4);
  tracker.observeAudio({},pcm(.04,.1),rate,.5);
  const result=tracker.snapshot();assert.equal(result.correlated_segment_count,0);
  assert.equal(result.uncorrelated_audio_segments,1);assert.equal(result.unattributed_audio_chunks,1);
  assert.equal(result.max_observed_onset_delay_ms,null);
});

test('provisional timestamps remain provisional and stale revisions cannot replace final timing',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  const event={source:'translation',segment_id:'part',source_start_seconds:.1,source_end_seconds:.3};
  tracker.observeTranscript({...event,revision:1,provisional:true});
  tracker.observeAudio({segment_id:'part',audio_segment_final:true},pcm(.04,.1),rate,.5);
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  tracker.observeTranscript({...event,revision:2,provisional:false});
  tracker.observeTranscript({...event,revision:1,provisional:false,source_start_seconds:0});
  tracker.observeTranscript({...event,revision:3,provisional:true,source_start_seconds:0});
  near(tracker.snapshot().segments[0].onset_delay_ms,400);
});

test('source offsets beyond received input and discontinuous clocks stay unknown',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,4);
  tracker.observeTranscript({source:'translation',segment_id:'p',source_start_seconds:.8,source_end_seconds:1.2});
  tracker.observeAudio({segment_id:'p'},pcm(.04,.1),rate,5.3);
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  assert.equal(tracker.snapshot().uncorrelated[0].reason,'source_range_exceeds_received_input');
  tracker.observeInput(rate,rate,5);assert.equal(tracker.snapshot().correlated_segment_count,1);
  tracker.observeInput(rate,rate,7);assert.equal(tracker.snapshot().input_clock_continuous,false);
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  assert.equal(tracker.snapshot().uncorrelated[0].reason,'input_clock_discontinuity');
});

test('invalid replacement ranges revoke a previous measurement without deleting audio',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  const event={source:'translation',segment_id:'p',source_start_seconds:.1,source_end_seconds:.3};
  tracker.observeTranscript(event);tracker.observeAudio({segment_id:'p'},pcm(.04,.1),rate,.5);
  assert.equal(tracker.snapshot().correlated_segment_count,1);
  for(const range of [{source_start_seconds:NaN,source_end_seconds:.3},{source_start_seconds:.4,source_end_seconds:.3},{source_start_seconds:-1,source_end_seconds:.3},{source_start_seconds:0,source_end_seconds:Infinity},{}]) {
    tracker.observeTranscript({...event,...range,...(Object.keys(range).length?{}:{source_start_seconds:undefined})});
    assert.equal(tracker.snapshot().correlated_segment_count,0);
    assert.equal(tracker.snapshot().identified_audio_segments,1);
  }
});

test('silent PCM and audio after declared final cannot verify a segment onset',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  const event={source:'translation',segment_id:'p',source_start_seconds:.1,source_end_seconds:.3};
  tracker.observeTranscript(event);tracker.observeAudio({segment_id:'p',audio_segment_final:true},pcm(.04),rate,.5);
  assert.equal(tracker.snapshot().silent_audio_segments,1);
  tracker.observeAudio({segment_id:'p'},pcm(.04,.1),rate,.54);
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  assert.equal(tracker.snapshot().uncorrelated_audio_segments,1);
});

test('segment tracking is bounded and snapshots never expose provider identifiers or transcript text',()=>{
  const tracker=new SegmentLatencyTracker({maxSegments:1});tracker.observeInput(rate,rate,0);
  tracker.observeTranscript({source:'translation',segment_id:'private-provider-id',text:'private-caption',source_start_seconds:0,source_end_seconds:.1});
  tracker.observeAudio({segment_id:'private-provider-id'},pcm(.04,.1),rate,.2);
  tracker.observeAudio({segment_id:'another'},pcm(.04,.1),rate,.3);
  const result=tracker.snapshot();assert.equal(result.tracking_limited,true);
  assert.equal(result.identified_audio_segments,1);assert.equal(result.unattributed_audio_chunks,1);
  assert.equal(JSON.stringify(result).includes('private-'),false);
  assert.throws(()=>new SegmentLatencyTracker({maxSegments:0}),TypeError);
  assert.throws(()=>tracker.observeInput(0,rate,0),TypeError);
  assert.throws(()=>tracker.observeInput(20,rate,-1),TypeError);
});

test('zero-duration source marks and translated energy before the source are not correlated samples',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  tracker.observeAudio({segment_id:'p'},pcm(.04,.1),rate,.4);
  tracker.observeTranscript({source:'translation',segment_id:'p',source_start_seconds:.3,source_end_seconds:.3});
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  tracker.observeTranscript({source:'translation',segment_id:'p',source_start_seconds:.8,source_end_seconds:.9});
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  assert.equal(tracker.snapshot().uncorrelated[0].reason,'translation_precedes_source_interval');
  tracker.observeTranscript({source:'translation',segment_id:'p',source_start_seconds:.41,source_end_seconds:.5});
  assert.equal(tracker.snapshot().correlated_segment_count,1); // Within one RMS window; keep the raw estimate.
  near(tracker.snapshot().segments[0].onset_delay_ms,-10);
});

test('a reused segment ID with conflicting turn identity cannot merge caption and audio clocks',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  tracker.observeAudio({segment_id:'same-part',turn_id:'turn-a'},pcm(.04,.1),rate,.4);
  tracker.observeTranscript({source:'translation',segment_id:'same-part',turn_id:'turn-b',source_start_seconds:.1,source_end_seconds:.2});
  const result=tracker.snapshot();assert.equal(result.correlated_segment_count,0);
  assert.equal(result.uncorrelated[0].reason,'conflicting_turn_identity');
});

test('known captions without PCM count as pending and an open audio segment has no final tail latency',()=>{
  const tracker=new SegmentLatencyTracker();tracker.observeInput(rate,rate,0);
  const event={source:'translation',segment_id:'p',source_start_seconds:.1,source_end_seconds:.2};
  tracker.observeTranscript({...event,final:false});
  assert.equal(tracker.snapshot().pending_audio_segments,1);
  tracker.observeAudio({segment_id:'p',audio_segment_final:false},pcm(.04,.1),rate,.4);
  assert.equal(tracker.snapshot().correlated_segment_count,0);
  tracker.observeTranscript({...event,final:true});
  assert.equal(tracker.snapshot().pending_audio_segments,0);
  assert.equal(tracker.snapshot().correlated_segment_count,1);
  assert.equal(tracker.snapshot().segments[0].tail_delay_ms,null);
  tracker.observeAudio({segment_id:'p',audio_segment_final:true},pcm(.04,.1),rate,.44);
  near(tracker.snapshot().segments[0].tail_delay_ms,280);
});
