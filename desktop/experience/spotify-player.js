/* Official SDK in an isolated native view; no chat/module DOM or persisted tokens. */
(() => {
 'use strict';
 let player=null,volume=null,disposed=false,starting=false,timer=null,publishing=false;
 const api=()=>window.pywebview?.api;
 async function event(kind,id=''){try{if(!disposed)await api()?.event(kind,id);}catch{}}
 function dispose(){if(disposed)return;disposed=true;clearInterval(timer);volume?.dispose();player?.disconnect();player=null;window.onSpotifyWebPlaybackSDKReady=()=>{};}
 async function start(){
  if(starting||disposed||!api())return;starting=true;
  try{
   await navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{initDataTypes:['cenc'],audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'}]}]);
   window.onSpotifyWebPlaybackSDKReady=async()=>{
    if(disposed)return;
    player=new Spotify.Player({name:'Brivany',volume:.5,getOAuthToken:callback=>api().token().then(value=>{if(!disposed)callback(value.access_token);}).catch(()=>event('authentication_error'))});
    volume=window.BrivanyDuckingVolume.create({read:()=>player.getVolume(),write:value=>player.setVolume(value),fail:()=>event('playback_error')});
    player.addListener('ready',async({device_id})=>{await event('ready',device_id);try{volume.duck((await api().ducking())?.active===true);}catch{}});
    player.addListener('player_state_changed',publish);
    player.addListener('not_ready',()=>event('not_ready'));
    for(const kind of ['initialization_error','authentication_error','account_error','playback_error','autoplay_failed'])player.addListener(kind,()=>event(kind));
    await player.activateElement();
    if(!await player.connect())await event('connection_error');
    timer=setInterval(snapshot,750);
   };
   const script=document.createElement('script');script.src='https://sdk.scdn.co/spotify-player.js';script.onerror=()=>event('connection_error');document.head.append(script);
  }catch{await event('initialization_error');}
 }
 async function publish(state){
  if(disposed||publishing)return;publishing=true;
  try{await api().playback(state?{paused:state.paused,position:Math.round(state.position),duration:Math.round(state.duration),shuffle:state.shuffle,repeat_mode:state.repeat_mode,disallows:state.disallows,track:state.track_window?.current_track,context_uri:state.context?.uri,next_uris:(state.track_window?.next_tracks||[]).slice(0,50).map(t=>t.uri),volume:await volume.volume(),gain:volume.status()}:null);}catch{}finally{publishing=false;}
 }
 async function snapshot(){if(!disposed&&player)try{await publish(await player.getCurrentState());}catch{}}
 async function command(identifier,action,value){
  let ok=false;
  try{
   if(disposed||!player)throw new Error('not ready');
   if(action==='play'){await player.activateElement();await player.resume();}
   else if(action==='pause')await player.pause();
   else if(action==='next')await player.nextTrack();
   else if(action==='previous')await player.previousTrack();
   else if(action==='seek')await player.seek(value);
   else if(action==='volume')await volume.set(value/100);
   else throw new Error('invalid action');
   await snapshot();ok=true;
  }catch{await event('playback_error');}
  finally{try{await api().result(identifier,ok);}catch{}}
 }
 window.BrivanySpotifyPlayer={dispose,command,snapshot,duck:active=>volume?.duck(active===true)};window.addEventListener('pywebviewready',start);window.addEventListener('pagehide',dispose);start();
})();
