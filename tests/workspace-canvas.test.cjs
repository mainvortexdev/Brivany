'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),core=require('../desktop/experience/canvas-core.js');
const pen=()=>({tool:'pen',color:'#123456',size:4,points:[5,5,1,20,20,.5]});
test('Undo/redo preserves dimensions, points and output identity; a new branch drops redo',()=>{
 const d=new core.Document();d.add(pen());const stamp=d.stamp();d.add({tool:'resize',width:800,height:600});d.add({tool:'clear'});assert.equal(d.hasDrawing(),false);
 d.undo();assert.equal(d.hasDrawing(),true);d.undo();assert.deepEqual(d.size(),{width:1600,height:1000});assert.equal(d.stamp(),stamp);d.redo();assert.equal(d.size().width,800);d.undo();d.add(pen());assert.equal(d.redo(),false);assert.notEqual(d.stamp(),stamp);assert.equal(d.points(),4);
});
test('History owns its points and rejects unbounded/invalid work',()=>{
 const d=new core.Document(),p=pen();d.add(p);p.points[0]=900;assert.equal(d.active()[0].points[0],5);
 for(const value of [{...pen(),size:Infinity},{...pen(),points:[0,0,NaN]},{...pen(),color:'red'}, {tool:'resize',width:4096,height:4096},{...pen(),points:new Array(150003).fill(0)}])assert.throws(()=>d.add(value));
 for(let i=1;i<core.MAX_COMMANDS;i++)d.add({tool:'clear'});assert.throws(()=>d.add(pen()));d.undo();assert.doesNotThrow(()=>d.add(pen()));
});
