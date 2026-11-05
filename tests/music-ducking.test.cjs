'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 let now=0,serial=0,physical=.5;const timers=new Map(),writes=[];
 const context={window:{},performance:{now:()=>now},setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync('desktop/experience/volume-ducking.js','utf8'),context);
 const control=context.window.BrivanyDuckingVolume.create({read:async()=>physical,write:async value=>{assert(Number.isFinite(value)&&value>=0&&value<=1);physical=value;writes.push(value);}});
 async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
 async function advance(ms){await flush();const end=now+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;timers.delete(next[0]);now=next[1].at;await next[1].fn();await flush();}now=end;await flush();}
 return {control,writes,advance,get physical(){return physical;},external:value=>physical=value};
}
test('fade down/up is progressive and restores the latest user volume',async()=>{
 const f=fixture();await f.control.set(.8);f.control.duck(true);await f.advance(340);assert(f.physical>.096&&f.physical<.8);await f.control.set(.6);await f.advance(500);assert(Math.abs(f.physical-.072)<.001);assert.equal(await f.control.volume(),.6);
 f.control.duck(false);await f.advance(700);assert(f.physical>.072&&f.physical<.6);await f.advance(1000);assert(Math.abs(f.physical-.6)<.001);assert(f.writes.length>12);
});
test('manual mute and external volume changes are respected while ducked',async()=>{
 const f=fixture();f.control.duck(true);await f.advance(1000);f.external(.32);assert.equal(await f.control.volume(),.32);assert(Math.abs(f.physical-.0384)<.001);f.control.duck(false);await f.advance(1800);assert(Math.abs(f.physical-.32)<.001);
 await f.control.set(0);f.control.duck(true);await f.advance(1000);f.control.duck(false);await f.advance(1800);assert.equal(f.physical,0);
});
test('rapid changes retarget from current gain; disposal stops pending fades',async()=>{
 const f=fixture();f.control.duck(true);await f.advance(300);const before=f.physical;f.control.duck(false);await f.advance(0);assert(Math.abs(f.physical-before)<.001);await f.advance(300);f.control.duck(true);await f.advance(1000);assert(Math.abs(f.physical-.06)<.001);f.control.dispose();const count=f.writes.length;await f.advance(10000);assert.equal(f.writes.length,count);
});
