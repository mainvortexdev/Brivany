import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../src/wav.js';
test('PCM header, stereo interleaving and full sample count',()=>{
 const data=encodeWav([new Float32Array([-1,0,1]),new Float32Array([.5,-.5,0])],24000),v=new DataView(data),text=(a,n)=>new TextDecoder().decode(data.slice(a,a+n));
 assert.equal(data.byteLength,56);assert.equal(text(0,4),'RIFF');assert.equal(text(8,4),'WAVE');assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),24000);assert.equal(v.getUint32(40,true),12);
 assert.deepEqual(Array.from({length:6},(_,i)=>v.getInt16(44+i*2,true)),[-32768,16384,0,-16384,32767,0]);
});
test('malformed channels, excess duration and non-finite samples',()=>{
 assert.throws(()=>encodeWav([],24000));assert.throws(()=>encodeWav([new Float32Array(2),new Float32Array(1)],24000));assert.throws(()=>encodeWav([new Float32Array(1)],NaN));
 const v=new DataView(encodeWav([new Float32Array([NaN,Infinity,2,-2])],24000));assert.deepEqual(Array.from({length:4},(_,i)=>v.getInt16(44+i*2,true)),[0,0,32767,-32768]);
});
