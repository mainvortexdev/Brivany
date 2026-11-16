import test from 'node:test';
import assert from 'node:assert/strict';
import {TranscriptOverlay} from '../transcript-overlay.js';
test('source partials display immediately without waiting for translated audio; stop removes text',()=>{
 const saved={document:globalThis.document,window:globalThis.window,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
 const listeners=new Map();let removed=false,at=1000,measurement=null;
 const node={style:{},textContent:'',setAttribute(){},remove(){removed=true;}};
 globalThis.document={createElement:()=>node,addEventListener(){},removeEventListener(){},documentElement:{append(){}}};
 globalThis.window={addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 globalThis.innerWidth=1280;globalThis.innerHeight=900;
 const root={host:{dataset:{}},append(){}};
 try{
  const overlay=new TranscriptOverlay({root,video:{getBoundingClientRect:()=>({left:100,width:900,bottom:750})},now:()=>at,onFirst:ms=>measurement=ms});
  at=2250;assert.equal(overlay.receive({type:'transcript',source:'original',text:'First partial',final:false}),true);
  assert.equal(node.textContent,'First partial');assert.equal(node.hidden,false);assert.equal(measurement,1250);
  assert.equal(overlay.receive({type:'transcript',source:'translation',text:'Voice translation'}),false);assert.equal(node.textContent,'First partial');
  overlay.setVisible(false);overlay.receive({type:'transcript',source:'original',text:'Final phrase.',final:true});assert.equal(node.hidden,true);assert.equal(measurement,1250);
  overlay.close();assert.equal(node.textContent,'');assert.equal(removed,true);assert.equal(listeners.size,0);
 }finally{Object.assign(globalThis,saved);}
});
