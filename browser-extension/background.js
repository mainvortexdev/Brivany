/* Active translation requires user intent. Prefix capture uses only prior site grants. */
import {readVideoCaptions,upcomingCaptions} from './caption-probe.js';
import {connectDesktop,reply} from './desktop-connect.js';
import {WorkspaceControl} from './workspace-control.js';
const players=new Map();
const selectedTabs=new Set();
const translatingPorts=new Set();
const preparationInjections=new Map();
let prefixOwner=null,registration=Promise.resolve();
const own=chrome.runtime.getURL('player.html');
const prefixScriptId='brivany-video-prefix';
const sitePattern=url=>new URL(url).origin+'/*';
const emotions=new Set(['neutral','calm','happy','sad','angry','excited']);
const registers=new Set(['low','high']);

function preparedMetadata(value){
 const input=Array.isArray(value.turns)?value.turns.slice(0,16):[];
 const turns=[];
 for(const row of input){
  if(!row||!['speech','unknown'].includes(row.content)||!Number.isInteger(row.start_ms)||!Number.isInteger(row.end_ms)||
    row.start_ms<0||row.end_ms<=row.start_ms||row.end_ms>7000||typeof row.text!=='string'||!row.text.trim())continue;
  turns.push({start_ms:row.start_ms,end_ms:row.end_ms,text:row.text.trim().slice(0,400),
   speaker:typeof row.speaker==='string'&&/^[\w-]{1,48}$/.test(row.speaker)?row.speaker:null,
   emotion:emotions.has(row.emotion)&&Number.isFinite(row.confidence)&&row.confidence>=.7&&row.confidence<=1?row.emotion:null,
   register:registers.has(row.voice_register)&&Number.isFinite(row.register_confidence)&&row.register_confidence>=.7&&row.register_confidence<=1?row.voice_register:null,
   timbre:['masculine','feminine'].includes(row.voice_timbre)&&Number.isFinite(row.timbre_confidence)&&row.timbre_confidence>=.8&&row.timbre_confidence<=1?row.voice_timbre:null});
 }
 return {type:'prefix-ready',prefix_id:value.prefix_id,duration_ms:value.duration_ms,position_ms:value.position_ms,
  resume_from_ms:Number.isInteger(value.resume_from_ms)&&value.resume_from_ms>=0&&value.resume_from_ms<=7000?value.resume_from_ms:null,
  turns,omitted_music:input.some(row=>row&&['singing','music'].includes(row.content))};
}

export async function prepareSource(source,{retry=false}={}){
 if(!source?.active||!Number.isInteger(source.id)||!/^https?:/.test(source.url||'')||!chrome.permissions?.contains)return false;
 try{
  if(!await chrome.permissions.contains({origins:[sitePattern(source.url)]}))return false;
  const previous=preparationInjections.get(source.id);
  if(previous?.url===source.url){
   const ready=await previous.result;
   if(ready||!retry)return ready;
   const current=await chrome.tabs.get(source.id);
   return current?.url===source.url?await prepareSource(current):false;
  }
  const attempt={url:source.url,result:null};
  attempt.result=chrome.scripting.executeScript({target:{tabId:source.id},files:['video-prepare-loader.js'],injectImmediately:true})
   .then(rows=>rows.some(row=>row.frameId===0&&row.result==='ready')).catch(()=>false).then(ready=>{
    if(!ready&&preparationInjections.get(source.id)===attempt)preparationInjections.delete(source.id);
    return ready;
   });
  preparationInjections.set(source.id,attempt);
  return await attempt.result;
 }catch{return false;}
}

function refreshPreparationRegistration(){
 if(!chrome.scripting.registerContentScripts||!chrome.permissions?.getAll)return;
 registration=registration.then(async()=>{
  const {origins=[]}=await chrome.permissions.getAll();
  const matches=origins.filter(pattern=>/^https?:\/\/[^*/]+\/\*$/.test(pattern));
  const [registered]=await chrome.scripting.getRegisteredContentScripts({ids:[prefixScriptId]});
  if(!matches.length){if(registered)await chrome.scripting.unregisterContentScripts({ids:[prefixScriptId]});return;}
  if(registered&&matches.length===registered.matches.length&&matches.every(match=>registered.matches.includes(match)))return;
  const options={id:prefixScriptId,matches,js:['video-prepare-loader.js'],runAt:'document_start'};
  if(registered)await chrome.scripting.updateContentScripts([options]);else await chrome.scripting.registerContentScripts([options]);
 }).catch(()=>{});
}

refreshPreparationRegistration();
chrome.tabs.query?.({active:true,lastFocusedWindow:true}).then(([tab])=>prepareSource(tab)).catch(()=>{});
chrome.permissions?.onAdded?.addListener(refreshPreparationRegistration);
chrome.permissions?.onRemoved?.addListener(()=>{preparationInjections.clear();prefixOwner?.close();refreshPreparationRegistration();});
chrome.runtime.onInstalled?.addListener(refreshPreparationRegistration);
chrome.tabs.onActivated?.addListener(({tabId})=>chrome.tabs.get(tabId).then(prepareSource).catch(()=>{}));
export async function activateSource(source){
  if(!Number.isInteger(source?.id)||!/^https?:/.test(source.url||''))return false;
  try{
    selectedTabs.add(source.id);
    if(chrome.scripting.insertCSS)await chrome.scripting.insertCSS({target:{tabId:source.id},files:['video-selection.css']});
    // An injected loader can finish before its dynamic import does. Await
    // activation in the isolated world so WorkSpace receives its real result.
    // Waiting for the user to play a paused video is valid selection state;
    // this acknowledges the module/UI, not ASR or audible translation.
    const results=await chrome.scripting.executeScript({target:{tabId:source.id},
      func:async moduleURL=>{
        try{
          const module=await import(moduleURL);
          await module.activateVideoSelection();
          return true;
        }catch{return false;}
      },args:[chrome.runtime.getURL('video-selection.js')]});
    if(!results.some(result=>result.frameId===0&&result.result===true))throw Error('selection_failed');
    return true;
  }catch(error){selectedTabs.delete(source.id);console.warn('Brivany no pudo seleccionar un video de esta página.');return false;}
}
const workspaceControl=typeof WorkspaceControl==='undefined'?null:new WorkspaceControl({activate:activateSource});
chrome.action.onClicked.addListener(async source=>{
 let permission;try{if(chrome.permissions?.request&&/^https?:/.test(source.url||''))permission=chrome.permissions.request({origins:[new URL(source.url).origin+'/*']});}catch{}
 await permission?.catch(()=>false);workspaceControl?.start();return activateSource(source);
});
if(workspaceControl){workspaceControl.start();chrome.runtime.onStartup?.addListener(()=>workspaceControl.start());chrome.runtime.onInstalled?.addListener(()=>workspaceControl.start());chrome.alarms?.create('brivany-workspace',{periodInMinutes:1});chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='brivany-workspace')workspaceControl.start();});}
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='brivany-prepare'||port.sender?.id!==chrome.runtime.id||port.sender.frameId!==0)return;
 const tab=port.sender.tab;
 let socket=null,closed=false,connecting=false,capture=false,delivered=false,frames=0;
 const close=()=>{
  if(closed)return;
  closed=true;if(prefixOwner?.port===port)prefixOwner=null;
  socket?.close();try{port.disconnect();}catch{}
 };
 port.onDisconnect.addListener(close);
 port.onMessage.addListener(async message=>{
  if(closed)return;
  if(message?.type==='prefix-start'&&!connecting&&!socket){
   if(prefixOwner||translatingPorts.size||!tab?.active||!/^https?:/.test(port.sender.url||'')||!chrome.permissions?.contains||
     !/^(?:youtube:[\w-]{11}|video:[0-9a-f]{1,8})$/.test(message.source)||!Number.isInteger(message.position_ms)||message.position_ms<0||message.position_ms>800||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(message.generation))return close();
   prefixOwner={port,close};connecting=true;
   try{
    const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(active?.id!==tab.id||!await chrome.permissions.contains({origins:[sitePattern(port.sender.url)]}))return close();
    const grant=await connectDesktop();if(closed)return;
    if(!grant.prefix_url)return close();
    socket=new WebSocket(grant.prefix_url);
    await reply(socket,{type:'authenticate',token:grant.token},'authenticated');if(closed)return;
    socket.addEventListener('close',()=>{if(!delivered)close();});
    socket.addEventListener('error',close);
    socket.addEventListener('message',event=>{
     let value;try{value=JSON.parse(event.data);}catch{return close();}
     if(closed)return;
     if(value.type==='prefix-capture'&&!capture&&value.sample_rate===24000&&value.input_frame_ms===80&&value.duration_ms===7000){
      capture=true;port.postMessage({type:'prefix-capture'});return;
     }
     if(value.type==='prefix-ready'){delivered=true;port.postMessage(preparedMetadata(value));return;}
     if(value.type==='error')close();
    });
    socket.send(JSON.stringify({type:'prepare-video',source:message.source,position_ms:message.position_ms,generation:message.generation}));
   }catch{close();}finally{connecting=false;}
   return;
  }
  if(!capture||socket?.readyState!==1)return;
  try{
   if(message?.type==='prefix-pcm'){
    if(frames>=88||typeof message.data!=='string'||message.data.length!==5120||socket.bufferedAmount>352000)return close();
    const bytes=Uint8Array.from(atob(message.data),char=>char.charCodeAt(0));if(bytes.length!==3840)return close();
    frames++;socket.send(bytes);
   }else if(message?.type==='prefix-finish'){
    if(frames!==88)return close();
    capture=false;socket.send(JSON.stringify({type:'finish'}));
   }
  }catch{close();}
 });
});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='brivany-video'||port.sender?.id!==chrome.runtime.id||!selectedTabs.has(port.sender?.tab?.id))return;
 let socket=null,closed=false,connecting=false,selected=false,sequence=0,acknowledged=0,inline=false;
 const fail=message=>{if(closed)return;closed=true;translatingPorts.delete(port);port.postMessage({type:'error',message});socket?.close();};
 port.onMessage.addListener(async message=>{
  if(closed)return;
  if(message?.type==='connect-video'&&!connecting&&!socket){
   connecting=true;translatingPorts.add(port);
   prefixOwner?.close();
   try{const grant=await connectDesktop();if(closed)return;
    if(grant.selected_video_protocol!==2||grant.progressive_translation_available!==true)throw Error('desktop_version');
    if(typeof message.selection!=='string'||! /^[\w-]{8,80}$/.test(message.selection))throw Error();
    inline=Boolean(grant.inline_video_sync);
    const captions=chrome.scripting.executeScript({target:{tabId:port.sender.tab.id},world:'MAIN',func:readVideoCaptions,args:[null,message.selection]}).then(results=>results[0]?.result||null).catch(()=>null);
    socket=new WebSocket(inline?grant.websocket_url:grant.video_url);await reply(socket,{type:'authenticate',token:grant.token},'authenticated');if(closed){socket.close();return;}
    socket.addEventListener('message',event=>{let value;try{value=JSON.parse(event.data);}catch{return;}if(closed)return;
     if(value.type==='error')return fail(value.message||'No se pudo traducir este video.');
     if(inline){if(['ready','prefix-used','source-turn','source-progress','source-skipped','dub-cue','transcript','preferences','done'].includes(value.type))port.postMessage(value);return;}
     if(value.type==='audio-ack'){
      if(!Number.isInteger(value.sequence)||value.sequence!==acknowledged||value.sequence>=sequence)return fail('Brivany no confirmó correctamente el audio. Vuelve a seleccionar el video.');
      acknowledged++;port.postMessage({type:'ack',sequence:value.sequence});return;
     }
     if(['original-gain','caption-ack','transcript','translation-state','preferences'].includes(value.type))port.postMessage(value);
    });
    socket.addEventListener('close',event=>{if(!closed){if(inline)port.postMessage({type:event.code===1000&&event.reason==='workspace-stop'?'workspace-stop':'sync-ended'});else fail('Se perdió la conexión con Brivany.');}});
    port.postMessage({type:'video-ready',snapshot:inline?null:await captions,sync:grant.inline_video_sync||null});
    if(inline)captions.then(snapshot=>{if(!closed&&snapshot)port.postMessage({type:'sync-captions',snapshot});});
   }catch(error){fail(error.message==='desktop_version'?'Reinicia Brivany para aplicar la actualización de traducción y vuelve a pulsar la extensión.':'Abre Brivany y vuelve a pulsar la extensión.');}finally{connecting=false;}return;
  }
  if(message?.type==='stop'){closed=true;translatingPorts.delete(port);socket?.close();return;}
  if(!socket||socket.readyState!==1)return;
  if(inline&&message?.type==='sync-control'){
   const value=message.control;
   if(value?.type==='start'&&!selected){selected=true;socket.send(JSON.stringify({...value,inline_video:true}));}
   else if(selected&&['caption-lookahead','finish'].includes(value?.type)){const raw=JSON.stringify(value);if(raw.length<=12000)socket.send(raw);}
   return;
  }
  if(inline&&message?.type==='sync-pcm'&&selected){
   if(typeof message.data!=='string'||message.data.length!==5120||socket.bufferedAmount>15360)return fail('El audio no pudo enviarse a tiempo.');
   try{socket.send(Uint8Array.from(atob(message.data),c=>c.charCodeAt(0)));}catch{fail('El audio del video llegó incompleto.');}
   return;
  }
  if(message?.type==='select'&&!selected){selected=true;socket.send(JSON.stringify(message));return;}
  if(message?.type==='captions'&&selected){const raw=JSON.stringify(message);if(raw.length<=13000)socket.send(raw);return;}
  if(message?.type==='media-state'&&selected&&typeof message.paused==='boolean'){socket.send(JSON.stringify(message));return;}
  if(message?.type==='position'&&selected&&Number.isFinite(message.position)){socket.send(JSON.stringify(message));return;}
  if(message?.type==='pcm'&&selected){
   if(message.sequence!==sequence++||typeof message.data!=='string'||message.data.length!==5120||socket.bufferedAmount>15360)return fail('El audio no pudo enviarse a tiempo.');
   try{const bytes=Uint8Array.from(atob(message.data),c=>c.charCodeAt(0));if(bytes.length!==3840)throw Error();socket.send(bytes);}catch{fail('El audio del video llegó incompleto.');}
  }
 });
 port.onDisconnect.addListener(()=>{closed=true;translatingPorts.delete(port);socket?.close();});
});
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='brivany-player'||!port.sender?.url?.startsWith(own))return;
  let playerId=null;
  port.onMessage.addListener(async message=>{
    if(message?.type==='caption-request'&&playerId!==null){
      const entry=players.get(playerId);if(!entry||entry.port!==port||!entry.capturing||entry.probing||!chrome.scripting)return;
      entry.probing=true;
      try{
        const source=await chrome.tabs.get(entry.source);if(source.url!==entry.url)return sourceEnded(entry.source,'La pestaña cambió.');
        const result=await chrome.scripting.executeScript({target:{tabId:entry.source},world:'MAIN',func:readVideoCaptions,args:[entry.captionCache||null]});
        if(players.get(playerId)!==entry||entry.port!==port)return;
        entry.captionCache=result[0]?.result||null;const snapshot=upcomingCaptions(entry.captionCache);
        if(snapshot)port.postMessage({type:'caption-lookahead',...snapshot});
      }catch{}finally{entry.probing=false;}
      return;
    }
    if(message?.type!=='capture-request'||!Number.isInteger(message.player_id)||(playerId!==null&&playerId!==message.player_id))return;
    try{
      const player=await chrome.tabs.get(message.player_id);
      if(!player.url?.startsWith(own))throw Error('player');
      let entry=players.get(player.id);
      if(!entry){
        // The worker may have slept while the player opened. activeTab still
        // makes Chrome enforce the original user grant for the target tab.
        const sourceId=Number(new URL(player.url).searchParams.get('source'));
        if(!Number.isInteger(sourceId)||sourceId<0)throw Error('source');
        const source=await chrome.tabs.get(sourceId);entry={source:sourceId,url:source.url,port:null};players.set(player.id,entry);
      }
      const source=await chrome.tabs.get(entry.source);
      if(source.url!==entry.url)throw Error('navigation');
      playerId=player.id;entry.port=port;
      const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:entry.source,consumerTabId:player.id});
      if(players.get(player.id)!==entry||entry.port!==port)return;
      entry.capturing=true;
      port.postMessage({type:'capture-ready',stream_id:streamId});
    }catch(error){port.postMessage({type:'capture-error',message:'No se pudo capturar la pestaña. Vuelve a pulsar la extensión en la pestaña del video.'});}
  });
  port.onDisconnect.addListener(()=>{if(playerId!==null)players.delete(playerId);});
});
function sourceEnded(tabId,reason){for(const [player,entry] of players)if(entry.source===tabId){try{entry.port?.postMessage({type:'source-ended',reason});}catch{}players.delete(player);}}
chrome.tabs.onRemoved.addListener(tabId=>{preparationInjections.delete(tabId);selectedTabs.delete(tabId);sourceEnded(tabId,'La pestaña de origen se cerró.');players.delete(tabId);});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
 if(change.status==='loading'){preparationInjections.delete(tabId);}
 if(change.status==='loading'||change.url){selectedTabs.delete(tabId);sourceEnded(tabId,'La pestaña de origen cambió. Inicia una sesión nueva.');}
 if(change.status==='complete'||(change.url&&change.url===tab?.url))prepareSource(tab,{retry:change.status==='complete'});
});
