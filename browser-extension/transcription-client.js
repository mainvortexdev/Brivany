import {TranscriptOverlay} from './transcript-overlay.js';
import {PCMSender} from './pcm-sender.js';
let session=null;
export const captionAt=(cues,time)=>cues.find(c=>c.start<=time&&c.end>time)||cues.find(c=>c.start>time)||null;
export const audioAvailable=video=>!!video.srcObject?.getAudioTracks?.().some(t=>t.readyState==='live'&&!t.muted)||(!video.paused&&video.readyState>=2);
const adPlaying=video=>!!video.closest?.('.ad-showing,.ad-interrupting');

export async function activateTranscription(){
 if(session){session.stop();return;}
 const videos=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>=120&&r.height>=68&&r.bottom>0&&r.top<innerHeight;}).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;});
 if(!videos.length)return;
 const video=videos[0],selection=crypto.randomUUID();video.dataset.brivanySelection=selection;
 const host=document.createElement('div');host.id='brivany-transcription';host.dataset.brivanyMode='transcription-only';host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 const root=host.attachShadow({mode:'closed'});root.innerHTML='<style>:host{all:initial}[hidden]{display:none!important}.status{position:fixed;right:20px;top:58px;max-width:400px;padding:10px 14px;border:1px solid #ffffff26;border-radius:18px;background:#181b20f5;color:#f5f7fc;font:13px/1.4 Segoe UI,sans-serif;pointer-events:auto;box-shadow:0 6px 24px #0003}.row{display:flex;align-items:center;gap:12px}button{border:0;border-radius:9px;padding:3px 6px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:hover{background:#ffffff16}small{display:block;color:#cbd2dd;font-size:11px}details{margin-top:6px}summary{cursor:pointer}.full{max-height:180px;overflow:auto;white-space:pre-wrap;color:#dce1e9}</style><section class="status"><div class="row"><span class="state">Preparando transcripción…</span><button class="stop">Detener</button></div><small class="timing" hidden></small><details hidden><summary>Ver transcripción</summary><p class="full"></p><button class="recognize">Reconocer audio</button></details></section>';
 document.documentElement.append(host);
 const status=root.querySelector('.state'),timing=root.querySelector('.timing'),details=root.querySelector('details');
 let closed=false,probing=true,cues=[],captionMode=false,opening=false,capturing=false,stream,audio,node,input,silent,sender,wasPaused=null,timer,fallback,inputStarted=false,lastPulse=performance.now();
 const port=chrome.runtime.connect({name:'brivany-transcription'});
 const overlay=new TranscriptOverlay({root,video,onFirst:ms=>{timing.textContent=(captionMode?'Texto disponible':'Primer texto')+' · '+(ms/1000).toLocaleString('es',{maximumFractionDigits:1})+' s';timing.hidden=false;}});
 const stop=()=>{
  if(closed)return;closed=true;clearInterval(timer);clearTimeout(fallback);session=null;overlay.close();sender?.close();
  try{node?.disconnect();input?.disconnect();silent?.disconnect();port.postMessage({type:'stop'});port.disconnect();}catch{}
  for(const track of stream?.getTracks()||[])track.stop();audio?.close().catch(()=>{});
  video.removeEventListener('timeupdate',paintCaption);window.removeEventListener('pagehide',stop);delete video.dataset.brivanySelection;host.remove();
 };
 const fail=message=>{if(closed)return;stop();const notice=document.createElement('div');notice.style.cssText='position:fixed;right:20px;top:58px;z-index:2147483647;max-width:390px;background:#181b20;color:white;padding:12px;border-radius:14px;font:13px Segoe UI;';notice.textContent=message;const close=document.createElement('button');close.textContent='Cerrar';close.onclick=()=>notice.remove();notice.append(close);document.documentElement.append(notice);};
 function paintCaption(){if(!captionMode||closed)return;const cue=captionAt(cues,video.currentTime);if(cue)overlay.receive({type:'transcript',source:'original',text:cue.text,final:true});}
 async function beginCapture(){
  if(closed||capturing||opening||probing||captionMode)return;
  if(adPlaying(video)){status.textContent='Esperando a que termine el anuncio…';return;}
  if(!audioAvailable(video)){status.textContent='Esperando audio · pulsa reproducir';return;}
  opening=true;status.textContent='Conectando transcripción…';port.postMessage({type:'start-asr',selection});
 }
 async function capture(){
  try{
   stream=video.srcObject?.getAudioTracks?.().length?new MediaStream(video.srcObject.getAudioTracks().map(t=>t.clone())):video.captureStream();
   if(!stream.getAudioTracks().length)throw Error('Este reproductor todavía no entrega audio. Reproduce el video y vuelve a iniciar la transcripción.');
   audio=new AudioContext({sampleRate:24000});await audio.resume();await audio.audioWorklet.addModule(chrome.runtime.getURL('pcm-capture.js'));if(closed)return;
   input=audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));node=new AudioWorkletNode(audio,'brivany-tab-pcm');silent=audio.createGain();silent.gain.value=0;input.connect(node);node.connect(silent);silent.connect(audio.destination);
   sender=new PCMSender({send:value=>{if(!inputStarted){inputStarted=true;overlay.started=performance.now();}port.postMessage(value);},fail});node.port.onmessage=event=>{if(!closed&&event.data?.buffer)sender.enqueue(event.data.buffer);};
   capturing=true;opening=false;wasPaused=null;status.textContent='Transcribiendo · reconocimiento de voz';check();
  }catch(error){fail(error.message||'No se pudo capturar el audio de este video.');}
 }
 function check(){
  if(closed)return;if(!video.isConnected){stop();return;}
  // Messages keep the MV3 worker alive while waiting for Play or showing captions.
  if(performance.now()-lastPulse>=20000){lastPulse=performance.now();port.postMessage({type:'ping'});}
  if(captionMode){paintCaption();return;}
  if(!capturing){beginCapture();return;}
  const paused=!audioAvailable(video)||adPlaying(video);
  if(paused!==wasPaused){wasPaused=paused;if(paused)sender.pause();node.port.postMessage({active:!paused});port.postMessage({type:'media-state',paused});status.textContent=paused?'Esperando audio · pulsa reproducir':'Transcribiendo · reconocimiento de voz';}
 }
 port.onMessage.addListener(message=>{
  if(closed)return;
  if(message.type==='captions-ready'){
   if(!probing||opening||capturing)return;
   probing=false;clearTimeout(fallback);cues=(message.snapshot?.cues||[]).slice(0,2000).filter(c=>typeof c.text==='string'&&c.text.length<=400&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start);
   if(cues.length){captionMode=true;details.hidden=false;root.querySelector('.full').textContent=cues.map(c=>c.text).join('\n');status.textContent='Transcripción preparada · subtítulos del video';paintCaption();}
   else check();
  }else if(message.type==='asr-ready')capture();
  else if(message.type==='ack')sender?.acknowledge(message.sequence);
  else if(message.type==='transcript')overlay.receive(message);
  else if(message.type==='error')fail(message.message||'La transcripción se interrumpió.');
 });
 port.onDisconnect.addListener(()=>{if(!closed)fail('La conexión de transcripción se cerró.');});
 root.querySelector('.stop').onclick=stop;
 root.querySelector('.recognize').onclick=()=>{captionMode=false;details.hidden=true;timing.hidden=true;overlay.first=null;overlay.started=performance.now();check();};
 timer=setInterval(check,200);session={stop};video.addEventListener('timeupdate',paintCaption);window.addEventListener('pagehide',stop,{once:true});
 port.postMessage({type:'probe-captions',selection});
 fallback=setTimeout(()=>{if(!closed&&probing){probing=false;check();}},2000);
}
