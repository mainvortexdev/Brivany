import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceCoverageReached} from './trial-coverage.mjs';

test('two complete short voices do not satisfy twelve source seconds',()=>{
  const completed=[{completed:true,audio_peak:.8,source_end:1.94},{completed:true,audio_peak:.7,source_end:3.75}];
  assert.equal(sourceCoverageReached(completed,12),false);
  assert.equal(sourceCoverageReached(completed,0),true);
  assert.equal(sourceCoverageReached([...completed,{completed:true,audio_peak:.6,source_end:12.1}],12),true);
});

test('a signaled future or unfinished voice cannot extend the completed source span',()=>{
  for(const cue of [{completed:false,audio_peak:.8,source_end:16},{completed:true,audio_peak:0,source_end:16},
                   {completed:true,audio_peak:.8,source_end:NaN},{completed:true,audio_peak:true,source_end:16}]){
    assert.equal(sourceCoverageReached([cue],12),false);
  }
  assert.throws(()=>sourceCoverageReached([],NaN));
  assert.throws(()=>sourceCoverageReached([],-1));
});
