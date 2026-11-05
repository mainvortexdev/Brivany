import test from 'node:test';
import assert from 'node:assert/strict';
import {continuityQuality} from './continuity-quality.mjs';
import {makeRequestDiagnostics} from './request-diagnostics.mjs';

test('parallel request stages share bounded numeric indices without exposing their identifiers',()=>{
 const read=makeRequestDiagnostics();
 const events=[['one','mt_start'],['two','mt_start'],['two','mt_first'],['one','mt_skipped'],['two','mt_done']]
  .map(([segment_id,stage])=>read({segment_id,stage,phase:'sse',partial:false,request_ms:6505,attempts:1,transcript:'fixture text'}));
 assert.deepEqual(events.map(row=>row.segment_index),[1,2,2,1,2]);
 assert.deepEqual(events[3],{segment_index:1,phase:'sse',partial:false,request_ms:6505,attempts:1});
 for(let i=2;i<128;i++)assert.equal(read({segment_id:'segment-'+i}).segment_index,i+1);
 assert.equal(read({segment_id:'one-more'}).segment_index,undefined);
 assert.equal(read({segment_id:'one'}).segment_index,1);
});

test('serialized probe diagnostics reject invalid fields and never invent missing partial evidence',()=>{
 const read=Function('return ('+makeRequestDiagnostics.toString()+')()')();
 assert.deepEqual(read({segment_id:'bad id',phase:'untrusted',partial:'false',request_ms:Infinity,attempts:513}),{});
 assert.deepEqual(read({segment_id:'safe',request_ms:-1,total_attempts:1.5}),{segment_index:1});
 assert.deepEqual(read({segment_id:'safe',phase:'headers',request_to_first_ms:235,partial:true,recoveries:0}),
  {segment_index:1,phase:'headers',partial:true,request_to_first_ms:235,recoveries:0});
 assert.deepEqual(read({request_to_last_chunk_ms:900,last_chunk_to_done_ms:12,pcm_base64:'ignored'}),
  {request_to_last_chunk_ms:900,last_chunk_to_done_ms:12});
 assert.deepEqual(read({request_to_last_chunk_ms:180001,last_chunk_to_done_ms:-1}),{});
 assert.deepEqual(read({stage:'cue_ready',published_ahead:true}),{published_ahead:true});
 assert.deepEqual(read({stage:'tts_done',published_ahead:true}),{});
 assert.deepEqual(read({stage:'cue_ready',leading_padding_ms:70.125,trailing_padding_ms:0}),{leading_padding_ms:70.125,trailing_padding_ms:0});
 assert.deepEqual(read({stage:'cue_ready',leading_padding_ms:171,trailing_padding_ms:true}),{});
 assert.deepEqual(read({type:'error',provider_status:402,message:'ignored',request_id:'ignored'}),{provider_status:402});
 assert.deepEqual(read({type:'error',provider_status:true}),{});
});

const cue=(start,end)=>({source:start,source_end:end,completed:true,audio_peak:.8});
const published=(start,end)=>({start:start*1000,end:end*1000,timing_quality:'asr_partial_estimate'});
const input={cues:[cue(0,2),cue(2,4)],published:[published(0,2),published(2,4)],
 fallback:{other_seconds:0},lag:{maximum_seconds:5,maximum_growth_seconds:.5}};

test('signal without a completed voice never proves continuity',()=>{
 const actual=continuityQuality({...input,cues:[{...cue(.06,2.482),completed:false,played:1.685}]});
 assert.equal(actual.verified_source_end_ms,0);assert.equal(actual.passed,false);
 assert.equal(continuityQuality({...input,cues:[]}).passed,false);
});

test('completed ordered span can pass, but a missing published voice within it fails',()=>{
 assert.equal(continuityQuality(input).passed,true);
 const missing=continuityQuality({...input,cues:[cue(2,4)]});
 assert.equal(missing.passed,false);assert.equal(missing.unplayed_published_cues,1);
 assert.deepEqual(missing.missing_intervals,[{start_ms:0,end_ms:2000,timing_quality:'asr_partial_estimate'}]);
});

test('future prefetched voices do not extend the claimed completed span',()=>{
 const result=continuityQuality({...input,published:[...input.published,published(4,6)]});
 assert.equal(result.passed,true);assert.equal(result.verified_source_end_ms,4000);
});

test('excess delay, growth, recovered original and unmeasured clocks reject quality',()=>{
 for(const changes of [{lag:{maximum_seconds:8.01,maximum_growth_seconds:.5}},
  {lag:{maximum_seconds:7,maximum_growth_seconds:3.01}},
  {fallback:{other_seconds:1.01}}, {fallback:null},
  {lag:{maximum_seconds:5,maximum_growth_seconds:undefined}}]){
  assert.equal(continuityQuality({...input,...changes}).passed,false);
 }
});
