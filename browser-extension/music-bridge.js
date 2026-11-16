/* Isolated extension boundary, limited to YouTube music metadata. */
(() => {
 'use strict';if(globalThis.__brivanyMusicBridge)return;globalThis.__brivanyMusicBridge=true;
 let port=null;
 window.addEventListener('message',event=>{
  const value=event.data;
  if(event.source!==window||event.origin!==location.origin||value?.__brivany!=='brivany-music'||value.type!=='music'||!/^[\w-]{11}$/.test(value.video||''))return;
  if(typeof value.title!=='string'||value.title.length>240||typeof value.artist!=='string'||value.artist.length>240)return;
  if(!['playing','muted','music'].every(name=>typeof value[name]==='boolean')||!['position','duration'].every(name=>Number.isFinite(value[name])&&value[name]>=0&&value[name]<=86400))return;
  try{
   if(!port){port=chrome.runtime.connect({name:'brivany-music'});port.onDisconnect.addListener(()=>{port=null})}
   const {__brivany,...message}=value;port.postMessage(message);
  }catch{port=null}
 });
})();
