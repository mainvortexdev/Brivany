import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readVideoCaptions,upcomingCaptions} from '../caption-probe.js';
async function load(chrome,extra={}){const source=await readFile(new URL('../background.js',import.meta.url),'utf8');return vm.runInNewContext(source.replace(/const TRANSCRIPTION_ONLY=(true|false);/,'const TRANSCRIPTION_ONLY='+String(extra.transcriptionOnly??true)+';').replace(/const SILENT_TIMELINE=(true|false);/,'const SILENT_TIMELINE='+String(extra.silent??false)+';').replace(/^import .*$/gm,'').replace(/^export /gm,'')+'\n({prepareSource,activateSource})',{chrome,console,URL,Map,Set,Uint8Array,atob,readVideoCaptions,upcomingCaptions,...extra});}
test('browser action captures its granted source into a separate consumer and navigation stops it',async()=>{
  const handlers={},own='chrome-extension://test/player.html',sent=[],requests=[],injections=[];
  const sources=new Map([[11,{id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}],[22,{id:22,url:own+'?source=11'}]]);
  const listener=name=>({addListener:value=>handlers[name]=value});
  const chrome={action:{onClicked:listener('action')},runtime:{getURL:path=>'chrome-extension://test/'+path,onConnect:listener('connect')},windows:{create:async()=>assert.fail('the action must not open a player')},scripting:{executeScript:async options=>{injections.push(options);return [{frameId:0,result:true}];}},tabs:{get:async id=>sources.get(id),onRemoved:listener('removed'),onUpdated:listener('updated')},tabCapture:{getMediaStreamId:async options=>{requests.push(options);return 'owned-stream-id';}}};
  await load(chrome);
  await handlers.action(sources.get(11));
  assert.equal(injections.length,1);assert.equal(typeof injections[0].func,'function');assert.equal(injections[0].args[0],'chrome-extension://test/video-selection.js');assert.equal(injections[0].target.tabId,11);
  assert.equal(injections[0].args[1],true,'the extension action selects transcription without translation');
  const portHandlers={},port={name:'brivany-player',sender:{url:own+'?source=11'},onMessage:{addListener:value=>portHandlers.message=value},onDisconnect:{addListener:value=>portHandlers.disconnect=value},postMessage:value=>sent.push(value)};
  handlers.connect(port);await portHandlers.message({type:'capture-request',player_id:22});
  assert.equal(requests.length,1);assert.equal(requests[0].targetTabId,11);assert.equal(requests[0].consumerTabId,22);assert.equal(sent[0].type,'capture-ready');
  handlers.updated(11,{url:'https://www.youtube.com/watch?v=new-video'});assert.equal(sent[1].type,'source-ended');
});

test('caption probing requires a captured source and drops a reply after navigation',async()=>{
 const handlers={},sent=[],own='chrome-extension://test/player.html';let probes=0,release;
 const source={id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'},player={id:22,url:own+'?source=11'};
 const listener=name=>({addListener:value=>handlers[name]=value});
 const chrome={action:{onClicked:listener('action')},runtime:{getURL:()=>own,onConnect:listener('connect')},windows:{create:async()=>assert.fail('unexpected window')},tabs:{get:async id=>id===11?source:player,onRemoved:listener('removed'),onUpdated:listener('updated')},tabCapture:{getMediaStreamId:async()=> 'stream'},scripting:{executeScript:async options=>{if(options.world!=='MAIN')return [{frameId:0,result:true}];probes++;assert.equal(options.target.tabId,11);assert.equal(options.world,'MAIN');await new Promise(resolve=>release=resolve);return [{result:{source:'youtube:abcdefghijk',position:5,rate:1,paused:false,cues:[{start:6,end:8,text:'Hello.',speaker:null}]}}];}}};
 await load(chrome);await handlers.action(source);
 const callbacks={},port={name:'brivany-player',sender:{url:player.url},onMessage:{addListener:f=>callbacks.message=f},onDisconnect:{addListener:f=>callbacks.disconnect=f},postMessage:m=>sent.push(m)};handlers.connect(port);
 await callbacks.message({type:'caption-request'});assert.equal(probes,0);
 await callbacks.message({type:'capture-request',player_id:22});const pending=callbacks.message({type:'caption-request'});await new Promise(setImmediate);assert.equal(probes,1);
 await callbacks.message({type:'caption-request'});assert.equal(probes,1,'only one in-flight page probe');
 handlers.updated(11,{status:'loading'});release();await pending;
 assert.equal(sent.filter(m=>m.type==='caption-lookahead').length,0);
});

async function selectedFixture(grant={selected_video_protocol:2,progressive_translation_available:true,video_url:'ws://127.0.0.1:1/video',token:'owned'}){
 const listeners=[],sent=[],callbacks={},sockets=[];let action;
 const chrome={action:{onClicked:{addListener:f=>action=f}},runtime:{id:'owned-extension',getURL:()=> 'chrome-extension://owned/player.html',onConnect:{addListener:f=>listeners.push(f)}},scripting:{executeScript:async()=>[{frameId:0,result:true}]},tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}};
 class Socket{constructor(){this.readyState=1;this.listeners={};this.sent=[];sockets.push(this);}addEventListener(k,f){this.listeners[k]=f;}send(v){this.sent.push(v);}close(){this.listeners.close?.();}}
 await load(chrome,{WebSocket:Socket,connectDesktop:async()=>grant,reply:async()=>({type:'authenticated'})});await action({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'});
 const port={name:'brivany-video',sender:{id:chrome.runtime.id,tab:{id:11}},onMessage:{addListener:f=>callbacks.message=f},onDisconnect:{addListener:f=>callbacks.disconnect=f},postMessage:m=>sent.push(m)};
 for(const listener of listeners)listener(port);await callbacks.message({type:'connect-video',selection:'owned-selection-1'});return {sent,callbacks,sockets};
}

test('PCM is confirmed only after native receipt, and the first failure is preserved',async()=>{
 const {sent,callbacks,sockets}=await selectedFixture(),socket=sockets[0];
 await callbacks.message({type:'select',selection:'owned-selection-1',source:'video:1',has_captions:false,translate:true,audio_ack:true});
 await callbacks.message({type:'pcm',sequence:0,data:Buffer.alloc(3840).toString('base64')});assert.equal(socket.sent.length,2);assert.equal(sent.filter(m=>m.type==='ack').length,0);
 socket.listeners.message({data:JSON.stringify({type:'audio-ack',sequence:0})});assert.equal(sent.filter(m=>m.type==='ack').length,1);
 socket.listeners.message({data:JSON.stringify({type:'error',message:'Owned safe reason'})});socket.listeners.close();
 assert.equal(sent.filter(m=>m.type==='error').length,1);assert.equal(sent.at(-1).message,'Owned safe reason');
});

test('an old running desktop is rejected before capture with restart instructions',async()=>{
 const {sent,sockets}=await selectedFixture({video_url:'ws://127.0.0.1:1/video',token:'owned'});
 assert.equal(sockets.length,0);assert.equal(sent.filter(m=>m.type==='video-ready').length,0);assert.match(sent.at(-1).message,/Reinicia Brivany/);
});

test('opening preparation requires a granted active tab and sends only the bounded PCM prefix',async()=>{
 const listeners=[],sent=[],injections=[],sockets=[],callbacks={};let granted=false,disconnected=false;
 const tab={id:11,active:true,url:'https://www.youtube.com/watch?v=abcdefghijk'};
 const chrome={action:{onClicked:{addListener(){}}},runtime:{id:'owned-extension',getURL:()=> 'chrome-extension://owned/player.html',onConnect:{addListener:f=>listeners.push(f)}},
  permissions:{contains:async()=>granted},scripting:{executeScript:async options=>{injections.push(options);return [{frameId:0,result:'ready'}];}},tabs:{query:async()=>[tab],onRemoved:{addListener(){}},onUpdated:{addListener(){}}}};
 class Socket{constructor(url){this.url=url;this.readyState=1;this.listeners={};this.sent=[];sockets.push(this);}addEventListener(k,f){this.listeners[k]=f;}send(v){this.sent.push(v);}close(){this.listeners.close?.();}}
 const {prepareSource}=await load(chrome,{transcriptionOnly:false,WebSocket:Socket,connectDesktop:async()=>({prefix_url:'ws://127.0.0.1:1/prefix',token:'owned'}),reply:async()=>({type:'authenticated'})});
 assert.equal(await prepareSource(tab),false);assert.equal(injections.length,0);
 granted=true;assert.equal(await prepareSource({...tab,active:false}),false);assert.equal(await prepareSource(tab),true);
 assert.equal(injections.at(-1).files[0],'video-prepare-loader.js');
 const port={name:'brivany-prepare',sender:{id:chrome.runtime.id,tab,frameId:0,url:tab.url},onMessage:{addListener:f=>callbacks.message=f},onDisconnect:{addListener:f=>callbacks.disconnect=f},postMessage:m=>sent.push(m),disconnect:()=>{disconnected=true;}};
 for(const listener of listeners)listener(port);
 const generation='00000000-0000-4000-8000-000000000001';
 await callbacks.message({type:'prefix-start',source:'youtube:abcdefghijk',position_ms:180,generation});
 const socket=sockets[0];assert.equal(socket.url,'ws://127.0.0.1:1/prefix');
 assert.deepEqual(JSON.parse(socket.sent[0]),{type:'prepare-video',source:'youtube:abcdefghijk',position_ms:180,generation});
 const data=Buffer.alloc(3840).toString('base64');
 await callbacks.message({type:'prefix-pcm',data});assert.equal(socket.sent.length,1,'audio waits for authorized capture');
 socket.listeners.message({data:JSON.stringify({type:'prefix-capture',sample_rate:24000,input_frame_ms:80,duration_ms:10000})});
 for(let i=0;i<125;i++)await callbacks.message({type:'prefix-pcm',data});
 await callbacks.message({type:'prefix-finish'});await callbacks.message({type:'prefix-pcm',data});
 assert.equal(socket.sent.length,127);assert.equal(JSON.parse(socket.sent.at(-1)).type,'finish');
 socket.listeners.message({data:JSON.stringify({type:'prefix-ready',prefix_id:'prefix-example-token',duration_ms:10000,position_ms:180,resume_from_ms:10000,turns:[
  {content:'speech',start_ms:0,end_ms:3000,text:'Owned phrase',speaker:'person-a',emotion:'calm',confidence:.9,voice_register:'high',register_confidence:.8,voice_timbre:'masculine',timbre_confidence:.9},
  {content:'music',start_ms:3100,end_ms:6500,text:'Do not forward lyrics'},
  {content:'speech',start_ms:0,end_ms:11000,text:'Invalid span'}]})});
 const ready=JSON.parse(JSON.stringify(sent.at(-1)));
 assert.equal(ready.prefix_id,'prefix-example-token');assert.equal(ready.position_ms,180);assert.equal(ready.resume_from_ms,10000);
 assert.deepEqual(ready.turns,[{start_ms:0,end_ms:3000,text:'Owned phrase',speaker:'person-a',emotion:'calm',register:'high',timbre:'masculine'}]);
 assert.equal(ready.omitted_music,true);assert.equal(disconnected,false);
});

test('an authorized committed navigation recovers a missed activation without broad registration or duplicate injection',async()=>{
 const handlers={},injections=[],registrations=[];let grant=true;
 const hook=name=>({addListener:fn=>handlers[name]=fn});
 const tab={id:11,active:true,url:'https://www.youtube.com/watch?v=abcdefghijk'};
 const chrome={action:{onClicked:hook('action')},runtime:{getURL:()=>'',onConnect:{addListener(){}}},
  permissions:{getAll:async()=>({origins:['https://*.youtube.com/*']}),contains:async({origins})=>grant&&origins[0]==='https://www.youtube.com/*'},
  scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async scripts=>registrations.push(scripts),
   executeScript:async options=>{injections.push(options);return [{frameId:0,result:'ready'}];}},
  tabs:{get:async()=>({...tab,url:'about:blank'}),onActivated:hook('activated'),onRemoved:hook('removed'),onUpdated:hook('updated')}};
 await load(chrome,{transcriptionOnly:false});
 await handlers.activated({tabId:tab.id});assert.equal(injections.length,0);
 handlers.updated(tab.id,{status:'loading'},tab);
 handlers.updated(tab.id,{url:tab.url},tab);
 handlers.updated(tab.id,{status:'complete'},tab);
 await new Promise(setImmediate);
 assert.equal(injections.length,1);assert.equal(injections[0].injectImmediately,true);assert.equal(registrations.length,0);
 handlers.updated(tab.id,{status:'loading'},tab);
 handlers.updated(tab.id,{status:'complete'},tab);
 await new Promise(setImmediate);assert.equal(injections.length,2,'same URL in a new document is eligible');
 grant=false;
 handlers.updated(tab.id,{status:'loading'},tab);
 handlers.updated(tab.id,{status:'complete'},tab);
 await new Promise(setImmediate);assert.equal(injections.length,2,'no injection after site permission is absent');
});

test('completed navigation can retry a failed early injection without a polling loop',async()=>{
 const tab={id:11,active:true,url:'https://www.youtube.com/watch?v=abcdefghijk'};
 let updated,attempts=0,rejectEarly;
 const chrome={action:{onClicked:{addListener(){}}},runtime:{getURL:()=>'',onConnect:{addListener(){}}},
  permissions:{contains:async()=>true},scripting:{executeScript:()=>++attempts===1?new Promise((_,reject)=>{rejectEarly=reject;}):Promise.resolve([{frameId:0,result:'ready'}])},
  tabs:{get:async()=>tab,onRemoved:{addListener(){}},onUpdated:{addListener:callback=>updated=callback}}};
 await load(chrome,{transcriptionOnly:false});
 updated(tab.id,{url:tab.url},tab);await new Promise(setImmediate);
 assert.equal(attempts,1);
 updated(tab.id,{status:'complete'},tab);await new Promise(setImmediate);
 rejectEarly(Error('document not yet committed'));await new Promise(setImmediate);
 assert.equal(attempts,2);
 updated(tab.id,{status:'complete'},tab);await new Promise(setImmediate);
 assert.equal(attempts,2);
});

async function activationFixture(executeScript,moduleURL='chrome-extension://owned/video-selection.js'){
 const listeners=[];
 const chrome={action:{onClicked:{addListener(){}}},runtime:{id:'owned-extension',getURL:()=>moduleURL,onConnect:{addListener:f=>listeners.push(f)}},
  scripting:{executeScript},tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}};
 const api=await load(chrome,{console:{warn(){}}});
 return {...api,listeners,chrome};
}

// Execute the serialized injected function in a fresh local JS function realm,
// matching Chrome's lack of access to the service worker's closure. The modules
// below are owned data URLs; these tests neither load a site nor use a provider.
const localInjection=async options=>{
 const inPage=Function('return ('+options.func.toString()+')')();
 return [{frameId:0,result:await inPage(...options.args)}];
};

test('activation result waits for the module and its asynchronous selection UI',async()=>{
 let release,settled=false;
 globalThis.__brivanySelectionWait=new Promise(resolve=>release=resolve);
 const moduleURL='data:text/javascript,'+encodeURIComponent('export async function activateVideoSelection(){await globalThis.__brivanySelectionWait;}');
 try{
  const {activateSource}=await activationFixture(localInjection,moduleURL);
  const result=activateSource({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}).then(value=>{settled=true;return value;});
  await new Promise(setImmediate);assert.equal(settled,false,'Import/selection must finish before the result is sent');
  release();assert.equal(await result,true,'A void result, including a paused-video wait UI, is a successful activation');
 }finally{release();delete globalThis.__brivanySelectionWait;}
});

test('module import and selection failures reject activation instead of acknowledging injection',async()=>{
 const failures=[
  'throw Error("Owned import failure");',
  'export async function activateVideoSelection(){throw Error("Owned activation failure");}',
  'export const unrelated=1;'
 ];
 for(const source of failures){
  const {activateSource,listeners,chrome}=await activationFixture(localInjection,'data:text/javascript,'+encodeURIComponent(source));
  assert.equal(await activateSource({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}),false);
  let accepted=false;
  const port={name:'brivany-video',sender:{id:chrome.runtime.id,tab:{id:11}},onMessage:{addListener(){accepted=true;}},onDisconnect:{addListener(){}}};
  for(const listener of listeners)listener(port);
  assert.equal(accepted,false,'A failed activation must remove the tab selection grant');
 }
});

test('only an explicit successful main-frame result acknowledges a public page activation',async()=>{
 for(const results of [[],[{frameId:0,result:false}],[{frameId:0}],[{frameId:1,result:true}]]){
  const {activateSource}=await activationFixture(async()=>results);
  assert.equal(await activateSource({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}),false);
 }
 const {activateSource}=await activationFixture(async()=>{throw Error('Owned injection failure');});
 assert.equal(await activateSource({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}),false);
 let injections=0;
 const valid=await activationFixture(async()=>{injections++;return [{frameId:0,result:true}];});
 for(const source of [null,{id:11,url:'chrome://settings'},{id:11,url:'chrome-extension://owned/player.html'},{id:'11',url:'https://example.com'}])assert.equal(await valid.activateSource(source),false);
 assert.equal(injections,0);
 assert.equal(await valid.activateSource({id:11,url:'https://www.youtube.com/watch?v=abcdefghijk'}),true);
 assert.equal(injections,1);
});
