/* Independent transcription worker: no translation, player or voice imports. */
import {connectDesktop,reply} from './desktop-connect.js';
import {readVideoCaptions} from './caption-probe.js';
const grantedTabs=new Set();
// Remove only our obsolete player preparation script when upgrading/restarting.
const removeLegacy=()=>chrome.scripting.unregisterContentScripts?.({ids:['brivany-video-prefix']}).catch(()=>{});
removeLegacy();
chrome.runtime.onInstalled?.addListener(removeLegacy);
chrome.runtime.onStartup?.addListener(removeLegacy);
chrome.action.onClicked.addListener(async tab=>{
 if(!Number.isInteger(tab?.id)||!/^https?:/.test(tab.url||''))return;
 grantedTabs.add(tab.id);
 try{await chrome.scripting.executeScript({target:{tabId:tab.id},func:async url=>{const m=await import(url);await m.activateTranscription();},args:[chrome.runtime.getURL('transcription-client.js')]});}
 catch{grantedTabs.delete(tab.id);}
});
chrome.tabs.onRemoved.addListener(id=>grantedTabs.delete(id));
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading')grantedTabs.delete(id);});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='brivany-transcription'||port.sender?.id!==chrome.runtime.id||!grantedTabs.has(port.sender?.tab?.id))return;
 let socket=null,closed=false,opening=false,sequence=0,acknowledged=0;
 const post=value=>{if(!closed)try{port.postMessage(value);}catch{close();}};
 const close=()=>{if(closed)return;closed=true;socket?.close();};
 const fail=message=>{post({type:'error',message});close();};
 port.onDisconnect.addListener(close);
 port.onMessage.addListener(async message=>{
  if(closed)return;
  if(message?.type==='stop'){close();return;}
  if(message?.type==='probe-captions'){
   try{const results=await chrome.scripting.executeScript({target:{tabId:port.sender.tab.id},world:'MAIN',func:readVideoCaptions,args:[null,message.selection]});post({type:'captions-ready',snapshot:results[0]?.result||null});}
   catch{post({type:'captions-ready',snapshot:null});}return;
  }
  if(message?.type==='start-asr'&&!socket&&!opening){
   opening=true;
   try{
    if(typeof message.selection!=='string'||!/^[\w-]{8,80}$/.test(message.selection))throw Error('selection');
    const grant=await connectDesktop('ws://127.0.0.1:48218/connect');if(closed)return;
    if(grant.selected_video_protocol!==2)throw Error('protocol');
    socket=new WebSocket(grant.video_url);await reply(socket,{type:'authenticate',token:grant.token},'authenticated');if(closed){socket.close();return;}
    socket.addEventListener('message',event=>{
     let value;try{value=JSON.parse(event.data);}catch{return;}
     if(value.type==='audio-ack'){
      if(value.sequence!==acknowledged||value.sequence>=sequence)return fail('No se pudo confirmar el audio de la transcripción.');
      acknowledged++;post({type:'ack',sequence:value.sequence});
     }else if(value.type==='transcript'||value.type==='error')post(value);
    });
    socket.addEventListener('close',()=>{if(!closed)fail('La transcripción se desconectó. El video conserva su reproducción original.');});
    await reply(socket,{type:'select',selection:message.selection,source:'video:0',has_captions:false,translate:false,audio_ack:true},'selected');
    if(!closed)post({type:'asr-ready'});
   }catch{fail('No se pudo conectar la transcripción. Vuelve a pulsar la extensión.');}
   finally{opening=false;}return;
  }
  if(!socket||socket.readyState!==WebSocket.OPEN)return;
  if(message?.type==='pcm'){
   if(message.sequence!==sequence||typeof message.data!=='string'||message.data.length!==5120||socket.bufferedAmount>15360)return fail('El audio dejó de llegar a tiempo. Vuelve a iniciar la transcripción.');
   sequence++;try{socket.send(Uint8Array.from(atob(message.data),c=>c.charCodeAt(0)));}catch{fail('El audio llegó incompleto.');}
  }else if(message?.type==='media-state'&&typeof message.paused==='boolean')socket.send(JSON.stringify(message));
 });
});
