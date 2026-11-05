import test from 'node:test';
import assert from 'node:assert/strict';
import {PCMSender} from '../pcm-sender.js';
test('slow setup and a burst of worklet frames wait for acknowledgements instead of cancelling',()=>{
 let now=0;const sent=[],errors=[];const sender=new PCMSender({clock:()=>now,schedule:false,send:m=>sent.push({...m,at:now}),fail:m=>errors.push(m)});
 now=3100;for(let i=0;i<12;i++){const raw=new ArrayBuffer(3840);new DataView(raw).setInt16(0,i,true);sender.enqueue(raw);}
 assert.equal(sent.length,1);assert.equal(errors.length,0,'startup time must not count as unacknowledged audio');
 for(let i=0;i<25;i++){now+=80;for(const m of sent.filter(m=>now-m.at>=320))sender.acknowledge(m.sequence);sender.pump();}
 assert.equal(sent.length,12);assert.equal(errors.length,0);assert.equal(sender.queue.length,0);
 assert.deepEqual(sent.map(m=>new DataView(Uint8Array.from(atob(m.data),c=>c.charCodeAt(0)).buffer).getInt16(0,true)),Array.from({length:12},(_,i)=>i));
 assert(sent.every((m,i)=>!i||m.at-sent[i-1].at>=80));sender.close();
});
test('a renderer stall does not flush the accumulated queue faster than real time',()=>{
 let now=0;const times=[],sender=new PCMSender({clock:()=>now,schedule:false,send:m=>times.push([m.sequence,now]),fail:assert.fail});
 now=2000;for(let i=0;i<8;i++)sender.enqueue(new ArrayBuffer(3840));sender.acknowledge(0);sender.pump();assert.equal(times.length,1);
 now+=450;sender.pump();assert.equal(times.length,2);sender.acknowledge(1);sender.pump();assert.equal(times.length,2);sender.close();
});
test('a genuinely missing acknowledgement and an excessive queue still stop explicitly',()=>{
 let now=0;const errors=[],sender=new PCMSender({clock:()=>now,schedule:false,send:()=>{},fail:m=>errors.push(m)});sender.enqueue(new ArrayBuffer(3840));now=4001;sender.pump();assert.equal(errors.length,1);assert.equal(sender.closed,true);assert.equal(sender.pending.size,0);
 const over=[],second=new PCMSender({clock:()=>0,schedule:false,maxQueued:2,send:()=>{},fail:m=>over.push(m)});for(let i=0;i<4;i++)second.enqueue(new ArrayBuffer(3840));assert.equal(over.length,1);assert.equal(second.closed,true);
});
test('an explicit media pause discards unsent pre-pause frames before resuming',()=>{
 let now=0;const sent=[],sender=new PCMSender({clock:()=>now,schedule:false,send:m=>sent.push(m),fail:assert.fail});
 sender.enqueue(new ArrayBuffer(3840));sender.enqueue(new ArrayBuffer(3840));assert.equal(sender.queue.length,1);sender.pause();assert.equal(sender.queue.length,0);sender.acknowledge(0);
 now=1000;const resumed=new ArrayBuffer(3840);new DataView(resumed).setInt16(0,42,true);sender.enqueue(resumed);assert.equal(sent.length,2);assert.equal(new DataView(Uint8Array.from(atob(sent[1].data),c=>c.charCodeAt(0)).buffer).getInt16(0,true),42);sender.close();
});
