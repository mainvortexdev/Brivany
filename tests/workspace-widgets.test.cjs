'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate,preferences,timer,remaining,transition,format}=require('../desktop/experience/workspace-widgets.js');
test('calculator handles precedence, decimal comma, signed values and nested parentheses',()=>{
 assert.equal(calculate('(120 + 80) × 0,15'),30);assert.equal(calculate('2+3*4'),14);assert.equal(calculate('-2 * (3 + -4)'),2);assert.equal(calculate('(.5 + .25) ÷ 3'),.25);
});
test('calculator rejects executable text, symbols, invalid divisions and extreme input',()=>{
 for(const value of ['alert(1)','1;process.exit()','2**3','1/0','(2+3','2 3','1e6','9999999999999999','1+'.repeat(100)])assert.throws(()=>calculate(value));
 assert.throws(()=>calculate('('.repeat(30)+'1'+')'.repeat(30)));
});
test('timer uses deadline across pauses, resumes and time spent in background',()=>{
 let t=transition(timer(),'start',1000,10000);assert.equal(remaining(t,3000),8000);
 t=transition(t,'pause',4000);assert.equal(t.state,'paused');assert.equal(remaining(t,60000),7000);
 t=transition(t,'resume',80000);assert.equal(t.deadline,87000);assert.equal(remaining(t,90000),0);
 t=transition(t,'finish',90000);assert.equal(t.state,'finished');assert.equal(t.remaining,0);
 t=transition(t,'reset',90000);assert.equal(t.state,'idle');assert.equal(t.remaining,10000);
});
test('timer rejects zero, fractional and excessive duration and formats total minutes',()=>{
 for(const duration of [0,1,1000.5,10800001,Infinity,NaN])assert.throws(()=>transition(timer(),'start',0,duration));
 assert.equal(format(1),'00:01');assert.equal(format(60000),'01:00');assert.equal(format(10800000),'180:00');
});
test('stored preferences are allowlisted and default to low consumption',()=>{
 assert.deepEqual(preferences({theme:'url()',accent:'<script>',size:'giant',economy:null,motion:false}),{theme:'dark',accent:'blue',size:'normal',economy:true,motion:false});
 assert.equal(preferences({size:'compact'}).size,'compact');assert.equal(preferences({economy:false}).economy,false);
});
