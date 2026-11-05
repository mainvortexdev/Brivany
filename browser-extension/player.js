import {pairAddress,syncAddress,translationMode} from './sync-timeline.js';
import {BufferedTranslationPlayer} from './buffered-player.js';
const $=id=>document.getElementById(id);
let token=null,relay=null,engine=null,active=false,pairSocket=null,sourceLost=false,generation=0,modeChosen=false,expiresAt=0,captionTimer=null;
const AUTH_KEY='brivany_sync_authorization';
async function cacheAuthorization(ttl){
  expiresAt=Date.now()+Math.max(1,Math.min(28800,Number.isFinite(ttl)?ttl:28800))*1000;
  await chrome.storage.session.set({[AUTH_KEY]:{token,relay,expires_at:expiresAt}});
}
async function clearAuthorization(){token=null;relay=null;expiresAt=0;await chrome.storage.session.remove(AUTH_KEY);$('pair-form').hidden=false;$('toggle').disabled=true;}
async function restoreAuthorization(){
  try{
    const cached=(await chrome.storage.session.get(AUTH_KEY))[AUTH_KEY];if(!cached)return;
    if(!Number.isFinite(cached.expires_at)||cached.expires_at<=Date.now()||typeof cached.token!=='string'||cached.token.length<16||cached.token.length>4096||/[\x00-\x20]/.test(cached.token))throw Error('expired');
    const address=new URL(cached.relay);syncAddress(cached.relay,address.origin+'/pair');
    if(token||active)return;token=cached.token;relay=cached.relay;expiresAt=cached.expires_at;$('pair-form').hidden=true;$('toggle').disabled=sourceLost;note('Vinculado. Puedes iniciar la traducción.');
  }catch{await clearAuthorization();}
}
const port=chrome.runtime.connect({name:'brivany-player'});
let captureResolve=null,captureReject=null;
function note(text,error=false){$('status').textContent=text;document.body.dataset.error=String(error);}
port.onMessage.addListener(message=>{
  if(message.type==='caption-lookahead'&&active)engine?.anticipate(message);
  if(message.type==='capture-ready'){captureResolve?.(message.stream_id);captureResolve=captureReject=null;}
  if(message.type==='capture-error'){captureReject?.(Error(message.message));captureResolve=captureReject=null;}
  if(message.type==='source-ended'){sourceLost=true;stop(message.reason,true);}
});
port.onDisconnect.addListener(()=>{sourceLost=true;stop('Se perdió el enlace con la pestaña de origen.',true);});
function socketReply(socket,send,expected){return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(Error('El servicio de Brivany no respondió.')),6000);
  const finish=(error,data)=>{clearTimeout(timeout);socket.removeEventListener('message',message);socket.removeEventListener('error',failed);socket.removeEventListener('close',closed);error?reject(error):resolve(data);};
  const message=event=>{let data;try{data=JSON.parse(event.data);}catch{return finish(Error('Brivany devolvió una respuesta no válida.'));}if(data.type==='error')return finish(Error(data.message||'Brivany rechazó la conexión.'));if(data.type===expected)finish(null,data);};
  const failed=()=>finish(Error('No se pudo conectar con Brivany.'));const closed=()=>finish(Error('Brivany cerró la conexión.'));
  socket.addEventListener('message',message);socket.addEventListener('error',failed);socket.addEventListener('close',closed);
  if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(send));else socket.addEventListener('open',()=>socket.send(JSON.stringify(send)),{once:true});
});}
$('pair-form').addEventListener('submit',async event=>{
  event.preventDefault();if(active)return;
  $('pair').disabled=true;
  try{
    const address=pairAddress($('pair-link').value);pairSocket?.close();pairSocket=new WebSocket(address.url);
    const response=await socketReply(pairSocket,{type:'pair',code:address.code},'paired');
    if(typeof response.token!=='string'||response.token.length<16||response.token.length>4096||/[\x00-\x20]/.test(response.token))throw Error('Brivany devolvió una autorización no válida.');
    relay=syncAddress(response.websocket_url,address.url);token=response.token;await cacheAuthorization(response.expires_in);if(response.preferred_mode&&!modeChosen)try{$('mode').value=translationMode(response.preferred_mode).mode;}catch{}pairSocket.close();pairSocket=null;$('pair-link').value='';$('pair-form').hidden=true;$('toggle').disabled=sourceLost;note('Vinculado. Puedes iniciar la traducción.');
  }catch(error){note(error.message,true);}finally{$('pair').disabled=false;}
});
async function sourceStream(){
  const tab=await chrome.tabs.getCurrent();
  const id=await new Promise((resolve,reject)=>{
    captureResolve=resolve;captureReject=reject;
    const timer=setTimeout(()=>{if(captureReject===reject){captureResolve=captureReject=null;reject(Error('La pestaña no confirmó la captura.'));}},6000);
    const original=resolve;captureResolve=value=>{clearTimeout(timer);original(value);};
    port.postMessage({type:'capture-request',player_id:tab.id});
  });
  return navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:id}},video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:id,maxWidth:1280,maxHeight:720,maxFrameRate:24}}});
}

function stop(message='Traducción detenida.',error=false){
  clearInterval(captionTimer);captionTimer=null;
  generation++;engine?.close();active=false;$('stop').disabled=true;$('toggle').textContent='Iniciar traducción';$('toggle').disabled=!token||sourceLost;$('target').disabled=false;$('mode').disabled=false;$('cover').hidden=false;$('cover-message').textContent=message;$('caption').textContent='';note(message,error);
}
$('toggle').addEventListener('click',async()=>{
  if(active){try{if(engine.waitingForPlayback){engine.beginPrepared();$('toggle').textContent='Pausar';}else{await engine.pause(!engine.userPaused);$('toggle').textContent=engine.userPaused?'Continuar':'Pausar';}}catch{stop('No se pudo cambiar la reproducción.',true);}return;}
  if(!token||sourceLost)return;
  if(expiresAt<=Date.now()){await clearAuthorization();note('La vinculación caducó. Copia un enlace nuevo de Brivany.');return;}
  const attempt=++generation;active=true;$('toggle').disabled=true;$('stop').disabled=false;$('target').disabled=true;$('mode').disabled=true;note('Preparando la captura…');
  const audio=new AudioContext({sampleRate:24000});audio.resume().catch(()=>{});let stream,socket;
  try{
    socket=new WebSocket(relay);let authenticated;
    try{authenticated=await socketReply(socket,{type:'authenticate',token},'authenticated');}
    catch(error){await clearAuthorization();throw error;}
    if(attempt!==generation)throw Error('Inicio cancelado.');if(authenticated.preferred_mode&&!modeChosen)try{$('mode').value=translationMode(authenticated.preferred_mode).mode;}catch{}
    await BufferedTranslationPlayer.prepare(socket,{target:$('target').value});if(attempt!==generation)throw Error('Inicio cancelado.');
    stream=await sourceStream();if(attempt!==generation)throw Error('Inicio cancelado.');
    engine=new BufferedTranslationPlayer({video:$('replay'),mode:$('mode').value,status:text=>{note(text);if(text==='Traduciendo')$('cover').hidden=true;},caption:text=>$('caption').textContent=text,failure:message=>stop(message,true),buffer:state=>$('buffer').textContent=Math.max(engine.policy.delay,state.lag).toFixed(1)+' s',prepared:()=>{$('toggle').disabled=false;$('toggle').textContent='Reproducir desde el principio';}});
    await engine.start({stream,audio,socket,target:$('target').value,providerReady:true});if(attempt!==generation){engine.close();return;}
    const captions=()=>port.postMessage({type:'caption-request'});captions();captionTimer=setInterval(captions,4000);
    if(engine.policy.autoplay){$('toggle').disabled=false;$('toggle').textContent='Pausar';}else $('toggle').textContent='Preparando…';
  }catch(error){for(const track of stream?.getTracks()||[])track.stop();socket?.close();audio.close().catch(()=>{});if(attempt===generation)stop(error.message||'No se pudo iniciar la traducción.',true);}
});
$('stop').addEventListener('click',()=>stop());window.addEventListener('pagehide',()=>{clearInterval(captionTimer);engine?.close();pairSocket?.close();});
note('Pega el enlace de vinculación de Brivany.');
try{const mode=new URL(location.href).searchParams.get('mode');if(mode){$('mode').value=translationMode(mode).mode;modeChosen=true;}}catch{}
$('mode').addEventListener('change',()=>{modeChosen=true;});
restoreAuthorization();
