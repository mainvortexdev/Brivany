import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceControl} from '../workspace-control.js';
const command=()=>({type:'select-active-video',request_id:'a'.repeat(32),expires_at_ms:Date.now()+5000});
function fixture({permitted=true,tab={id:7,url:'https://www.youtube.com/watch?v=abcdefghijk'}}={}){
 const calls=[],sent=[],socket={readyState:1,send:v=>sent.push(JSON.parse(v))};
 const control=new WorkspaceControl({activate:async value=>{calls.push(value);return true;},chromeAPI:{tabs:{query:async filter=>{assert.deepEqual(filter,{active:true,lastFocusedWindow:true});return tab?[tab]:[];}},permissions:{contains:async value=>{assert.deepEqual(value,{origins:['https://www.youtube.com/*']});return permitted;}}}});
 return {control,calls,sent,socket};
}
test('native intent activates only the active tab on a previously granted site',async()=>{
 const {control,calls,sent,socket}=fixture();await control.select(command(),socket);assert.equal(calls.length,1);assert.equal(calls[0].id,7);assert.equal(sent[0].ok,true);assert.deepEqual(Object.keys(sent[0]).sort(),['ok','reason','request_id','type']);
});
test('native intent cannot grant permissions or run on a missing or restricted tab',async()=>{
 for(const [options,reason] of [[{permitted:false},'site_permission'],[{tab:null},'no_video_tab'],[{tab:{id:7,url:'chrome://settings'}},'no_video_tab']]){
  const {control,calls,sent,socket}=fixture(options);await control.select(command(),socket);assert.equal(calls.length,0);assert.equal(sent[0].ok,false);assert.equal(sent[0].reason,reason);
 }
});
test('expired and malformed commands cannot start a capture',async()=>{
 const {control,calls,sent,socket}=fixture();await control.select({...command(),expires_at_ms:Date.now()-1},socket);await control.select({...command(),request_id:'untrusted URL or code'},socket);assert.equal(calls.length,0);assert.equal(sent.length,1);assert.equal(sent[0].reason,'expired');
});

test('the authenticated workspace reports the loaded build once only when the desktop advertises it',async()=>{
 for(const advertisement of [undefined,1,2]){
  const sent=[];
  class Socket extends EventTarget{readyState=1;send(value){sent.push(JSON.parse(value));}}
  const control=new WorkspaceControl({chromeAPI:{runtime:{getManifest:()=>({version:'0.4.9'})}},Socket,
   connect:async()=>({selected_video_protocol:2,workspace_url:'ws://127.0.0.1:48217/workspace',token:'owned'}),
   authenticate:async(_,request)=>{assert.deepEqual(request,{type:'authenticate',token:'owned'});return {type:'authenticated',client_info_protocol:advertisement};}});
  try{
   await control.start();await control.start();
   assert.deepEqual(sent,advertisement===1?[{type:'client-info',manifest_version:'0.4.9',worker_build:'0.4.9-prefix-nav-070'}]:[]);
  }finally{clearInterval(control.timer);}
 }
});
