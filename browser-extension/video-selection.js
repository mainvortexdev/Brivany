import {readVideoCaptions} from './caption-probe.js';
import {PCMSender} from './pcm-sender.js';
import {inlineTranslation} from './inline-translation.js';
import {observeVideoPrefix,takeVideoPrefix,youtubeAdPlaying} from './prefix-preparation.js';

export function visibleVideos(doc=document){
 return [...doc.querySelectorAll('video')].filter(video=>{const rect=video.getBoundingClientRect(),style=getComputedStyle(video);return rect.width>=120&&rect.height>=68&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight&&style.display!=='none'&&style.visibility!=='hidden';});
}
export function chooseAt(videos,x,y){return videos.map(video=>({video,rect:video.getBoundingClientRect()})).filter(({rect:r})=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom).sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height)[0]?.video||null;}
export function automaticVideo(videos,href=location.href){const url=new URL(href);return /(^|\.)youtube\.com$/.test(url.hostname)&&videos.length===1?videos[0]:null;}

let session=null,picker=null;
export function observeVideoPreparation(){
 document.documentElement.dataset.brivanyPrefixBuild='0.4.9-prefix-reuse-080';
 observeVideoPrefix(()=>{
  if(session||picker)return null;
  const videos=visibleVideos();
  return videos.length===1?videos[0]:null;
 });
}
function clearOldIndicators(){
 for(const host of document.querySelectorAll('[id="brivany-video-marker"]'))if(host!==session?.host)host.remove();
 if(!picker&&document.documentElement.hasAttribute('data-brivany-picking')){delete document.documentElement.dataset.brivanyPicking;document.documentElement.style.removeProperty('cursor');}
}
function surface(){
 const host=document.createElement('div');host.id='brivany-video-marker';host.style.cssText='position:fixed;inset:0;z-index:2147483646;pointer-events:none';
 const root=host.attachShadow({mode:'closed'});root.innerHTML='<style>:host{all:initial}[hidden]{display:none!important}.mark{position:fixed;border:2px solid #6aa6ff;border-radius:12px;box-shadow:0 0 0 1px #0007;pointer-events:none;transition:opacity .15s}.pin{position:fixed;width:25px;height:31px;filter:drop-shadow(0 2px 3px #0008);pointer-events:none}.status{position:fixed;right:20px;top:58px;display:flex;align-items:center;gap:12px;max-width:340px;padding:10px 14px;background:#181b20ee;color:#f5f7fc;border:1px solid #ffffff26;border-radius:22px;font:13px Segoe UI,sans-serif;box-shadow:0 6px 24px #0003;pointer-events:auto;backdrop-filter:blur(16px)}.live{margin:4px 0 0;color:#cbd2dd;font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}button{color:inherit;background:none;border:0;font:inherit;cursor:pointer;padding:2px 5px;border-radius:12px}button:hover{background:#ffffff14}</style><div class="mark" hidden></div><svg class="pin" hidden viewBox="0 0 24 30"><path fill="#77adff" stroke="#fff" stroke-width="1.5" d="M12 29S2 16 2 10a10 10 0 0 1 20 0c0 6-10 19-10 19Z"/><circle cx="12" cy="10" r="3.5" fill="#13223c"/></svg><div class="status"><div><span></span><p class="live" hidden></p></div><button type="button" aria-label="Cancelar selección de video">Cancelar</button></div>';
 document.documentElement.append(host);return {host,root,mark:root.querySelector('.mark'),pin:root.querySelector('.pin'),text:root.querySelector('span'),caption:root.querySelector('.live'),button:root.querySelector('button')};
}
export async function activateVideoSelection(){
 if(session||picker)return;
 clearOldIndicators();const videos=visibleVideos(),automatic=automaticVideo(videos);
 if(automatic){await selectVideo(automatic);return;}
 const ui=surface(),oldCursor=document.documentElement.style.cursor;ui.text.textContent=videos.length?'Marca el video':'No hay un video visible en esta página.';
 document.documentElement.style.setProperty('cursor','none','important');
 document.documentElement.dataset.brivanyPicking='';
 const move=event=>{ui.pin.hidden=false;ui.pin.style.left=event.clientX-5+'px';ui.pin.style.top=event.clientY-3+'px';const video=chooseAt(visibleVideos(),event.clientX,event.clientY);ui.mark.hidden=!video;if(video){const r=video.getBoundingClientRect();Object.assign(ui.mark.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}};
 const stop=()=>{document.removeEventListener('pointermove',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);document.documentElement.style.cursor=oldCursor;delete document.documentElement.dataset.brivanyPicking;ui.host.remove();if(picker?.stop===stop)picker=null;};
 const click=event=>{if(event.composedPath().includes(ui.host))return;const video=chooseAt(visibleVideos(),event.clientX,event.clientY);if(!video)return;event.preventDefault();event.stopImmediatePropagation();stop();selectVideo(video);};
 const key=event=>{if(event.key==='Escape'){event.preventDefault();stop();}};
 ui.button.onclick=stop;picker={stop};document.addEventListener('pointermove',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true);
}
const waitingForPlayback=video=>video.paused||video.seeking||video.readyState<2||youtubeAdPlaying(video);
const seekableAt=(video,position)=>Array.from({length:video.seekable.length},(_,i)=>i).some(i=>position>=video.seekable.start(i)&&position<=video.seekable.end(i));
const emotionNames={neutral:'neutra',calm:'tranquila',happy:'alegre',sad:'triste',angry:'enfadada',excited:'entusiasmada'};
const registerNames={low:'grave',high:'agudo'};
const timbreNames={masculine:'masculino',feminine:'femenino'};
function updateOpeningTranscript(details,prefix,resume,visible){
 details.replaceChildren();
 details.hidden=!visible||!prefix||!Number.isInteger(resume);
 if(details.hidden)return;
 const summary=document.createElement('summary');summary.textContent='Transcripción inicial · 7 s';details.append(summary);
 const list=document.createElement('ol');list.style.cssText='padding-inline-start:18px;margin:6px 0;max-height:135px;overflow:auto';
 const speakers=new Map();
 for(const turn of prefix.turns||[]){
  if(turn.speaker&&!speakers.has(turn.speaker))speakers.set(turn.speaker,speakers.size+1);
  const item=document.createElement('li'),label=document.createElement('strong');
  const speaker=turn.speaker?`Hablante ${speakers.get(turn.speaker)}`:'Hablante sin confirmar';
  const emotion=emotionNames[turn.emotion]?`Emoción ${emotionNames[turn.emotion]}`:'Emoción sin estimar';
  const register=registerNames[turn.register]?`Registro ${registerNames[turn.register]}`:'Registro sin estimar';
  const timbre=timbreNames[turn.timbre]?`Timbre ${timbreNames[turn.timbre]}`:'Timbre sin estimar';
  label.textContent=`${speaker} · ${emotion} · ${register} · ${timbre}`;
  item.append(label,document.createElement('br'),document.createTextNode(turn.text));list.append(item);
 }
 if(list.childElementCount)details.append(list);
 const note=document.createElement('p');note.style.margin='4px 0 0';
 note.textContent=`${prefix.omittedMusic?'Música omitida. ':''}Reconocimiento en vivo desde ${(resume/1000).toLocaleString('es')} s.`;details.append(note);
}
function seekForPrefix(video,position){
 return new Promise(resolve=>{
  const finish=()=>{clearTimeout(timer);video.removeEventListener('seeked',finish);resolve(!video.seeking&&Math.abs(video.currentTime-position)<=.12);};
  const timer=setTimeout(finish,1500);
  video.addEventListener('seeked',finish,{once:true});
  try{video.currentTime=position;}catch{finish();return;}
  if(!video.seeking)finish();
 });
}
function waitForPlayback(video){
 const ui=surface();ui.button.textContent='Cancelar';
 let awaitingAd=youtubeAdPlaying(video);
 const start=()=>{
  if(!waitingForPlayback(video)){stop();selectVideo(video);return;}
  awaitingAd=awaitingAd||youtubeAdPlaying(video);
  const text=awaitingAd?'La traducción empezará cuando termine el anuncio.':'Pulsa reproducir para empezar la traducción.';
  if(ui.text.textContent!==text)ui.text.textContent=text;
 };
 const emptied=()=>{if(!awaitingAd)stop();};
 const stop=()=>{clearInterval(check);video.removeEventListener('playing',start);video.removeEventListener('emptied',emptied);window.removeEventListener('pagehide',stop);ui.host.remove();if(session?.stop===stop)session=null;};
 const check=setInterval(()=>{if(!video.isConnected)stop();else start();},250);
 session={stop,host:ui.host};ui.button.onclick=stop;
 video.addEventListener('playing',start);video.addEventListener('emptied',emptied);window.addEventListener('pagehide',stop,{once:true});
 start();
}
async function selectVideo(video){
 if(session)return;
 clearOldIndicators();if(waitingForPlayback(video)){waitForPlayback(video);return;}
 const ui=surface();ui.text.textContent='Conectando con Brivany…';ui.button.textContent='Detener';ui.button.setAttribute('aria-label','Detener transcripción y traducción');
 const opening=document.createElement('details');opening.hidden=true;opening.style.cssText='margin-top:5px;color:#cbd2dd;font-size:12px;line-height:1.4';ui.caption.after(opening);
 const selection=crypto.randomUUID();video.dataset.brivanySelection=selection;
 const port=chrome.runtime.connect({name:'brivany-video'}),audio=new AudioContext({sampleRate:24000});audio.resume().catch(()=>{});
 let closed=false,stream,node,input,silent,timer,sourceStall,sender,replay,syncSnapshot,original=video.volume,ownVolume=false,captions=[],captionIndex=0,showTranscript=true,preferencesKnown=false,prefix=null,prefixResume=null,resumeOriginal=null;
 const caption=text=>{ui.caption.textContent=text;ui.caption.hidden=!showTranscript||!text;};
 const nextCaptions=()=>{if(closed||captionIndex>=captions.length)return;const cues=captions.slice(captionIndex,captionIndex+8);captionIndex+=cues.length;port.postMessage({type:'captions',cues,done:captionIndex>=captions.length});};
 const restore=()=>{if(ownVolume){video.volume=original;ownVolume=false;}};
 const restoreOpening=async()=>{
  if(resumeOriginal===null)return;
  const position=resumeOriginal;resumeOriginal=null;
  if(seekableAt(video,position))await seekForPrefix(video,position);
  if(video.isConnected)await video.play().catch(()=>{});
 };
 const mediaState=()=>{if(closed||!node)return;if(video.paused)sender?.pause();node.port.postMessage({active:!video.paused});port.postMessage({type:'media-state',paused:video.paused});};
 const sourceEnded=()=>{if(replay)replay.finish();else stop();};
 const sourceEmptied=()=>{if(replay)replay.finish({sourceInterrupted:true});else stop();};
 const sourcePaused=()=>{if(video.ended)sourceEnded();else stopAndRestorePosition();};
 const sourcePlaying=()=>clearTimeout(sourceStall);
 const sourceWaiting=()=>{
  sourcePlaying();sourceStall=setTimeout(()=>{
   if(!video.ended&&video.readyState<3)fail('El video se quedó sin datos. La traducción se detuvo y el audio original está activo.');
  },1500);
 };
 const stop=()=>{if(closed)return;closed=true;if(session?.stop===stop)session=null;sender?.close();replay?.close();clearInterval(timer);sourcePlaying();try{node?.port.postMessage({active:false});node?.disconnect();input?.disconnect();silent?.disconnect();port.postMessage({type:'stop'});port.disconnect();}catch{}for(const track of stream?.getTracks()||[])track.stop();audio.close().catch(()=>{});restore();delete video.dataset.brivanySelection;ui.host.remove();video.removeEventListener('ended',sourceEnded);video.removeEventListener('pause',mediaState);video.removeEventListener('play',mediaState);video.removeEventListener('emptied',stop);video.removeEventListener('emptied',sourceEmptied);video.removeEventListener('seeking',stop);video.removeEventListener('pause',sourcePaused);video.removeEventListener('ratechange',stopAndRestorePosition);video.removeEventListener('waiting',sourceWaiting);video.removeEventListener('playing',sourcePlaying);window.removeEventListener('pagehide',stop);restoreOpening();};
 const stopAndRestorePosition=()=>{const position=resumeOriginal===null?replay?.currentSourceTime():null;stop();if(Number.isFinite(position)&&seekableAt(video,position))video.currentTime=position;};
 session={stop,host:ui.host};ui.button.onclick=stopAndRestorePosition;video.addEventListener('ended',sourceEnded,{once:true});window.addEventListener('pagehide',stop,{once:true});
 const fail=message=>{if(closed)return;stopAndRestorePosition();const error=surface();error.text.textContent=message;error.button.textContent='Cerrar';error.button.onclick=()=>error.host.remove();};
 port.onDisconnect.addListener(()=>{if(!closed)fail('Se perdió la conexión con Brivany. Vuelve a marcar el video.');});
 port.onMessage.addListener(async message=>{
  if(closed)return;
  if(message.type==='error'){fail(message.message||'No se pudo transcribir este video.');return;}
  if(message.type==='workspace-stop'){stopAndRestorePosition();return;}
  if(message.type==='ack'){sender?.acknowledge(message.sequence);return;}
  if(message.type==='preferences'){preferencesKnown=true;showTranscript=message.show_transcript!==false;ui.caption.hidden=!showTranscript||!ui.caption.textContent;updateOpeningTranscript(opening,prefix,prefixResume,showTranscript);return;}
  if(message.type==='prefix-used'){
   const resume=message.resume_from_ms;
   prefixResume=Number.isInteger(resume)&&resume>=0&&resume<=7000?resume:prefix?.resume;
   updateOpeningTranscript(opening,prefix,prefixResume,preferencesKnown&&showTranscript);return;
  }
  if(message.type==='sync-captions'){syncSnapshot=message.snapshot;replay?.setCaptions(syncSnapshot);return;}
  if(message.type==='transcript'){if(!replay){ui.text.textContent='Traduciendo';if(message.source==='original')caption(String(message.text||''));}return;}
  if(replay){replay.receive(message);return;}
  if(message.type==='translation-state'){if(message.state==='stopped'){stop();return;}ui.text.textContent=message.state==='paused'?'En pausa':message.state==='starting'?'Preparando traducción…':'Traduciendo';return;}
  if(message.type==='caption-ack'){nextCaptions();return;}
  if(message.type==='original-gain'){
   const target=Math.max(0,Math.min(1,message.value));if(target<1&&!ownVolume){original=video.volume;ownVolume=true;}const from=video.volume,to=target===1?original:original*target,at=performance.now();
   const fade=now=>{if(closed)return;const t=Math.min(1,(now-at)/300);video.volume=from+(to-from)*t;if(t<1)requestAnimationFrame(fade);else if(target===1)ownVolume=false;};requestAnimationFrame(fade);return;
  }
  if(message.type!=='video-ready')return;
  try{
   const snapshot=message.sync?syncSnapshot:message.snapshot||await readVideoCaptions(null,selection);if(closed)return;
   const cues=snapshot?.cues||[];captions=cues;
   if(waitingForPlayback(video)){stop();waitForPlayback(video);return;}
   let prepared=null;
   if(message.sync&&prefix&&seekableAt(video,prefix.position/1000)){
    resumeOriginal=video.currentTime;video.pause();
    const found=await seekForPrefix(video,prefix.position/1000);if(closed)return;
    if(found)prepared={prefix_id:prefix.prefixId,prefix_source:prefix.source,prefix_position_ms:Math.round(video.currentTime*1000)};
    else{await restoreOpening();if(closed)return;if(waitingForPlayback(video))throw Error('No se pudo volver al video original. Pulsa reproducir e inténtalo otra vez.');}
   }
   stream=video.captureStream();if(!stream.getAudioTracks().length){for(const track of stream.getTracks())track.stop();stream=null;throw Error('Este video no permite obtener su audio. Abre el reproductor original.');}
   if(message.sync){
    const sourceGain=video.muted?0:video.volume;
    replay=inlineTranslation({port,source:video,root:ui.root,snapshot,settings:message.sync,audio,stream,sourceGain,originalGain:sourceGain*.12,prefix:prepared,
     status:text=>{ui.text.textContent=text;},caption,failure:fail,finished:stop,capture:async()=>{
      if(youtubeAdPlaying(video))throw Error('Empezó un anuncio antes de la captura. Vuelve a iniciar la traducción cuando termine.');
      if(video.seeking||video.readyState<2||!prepared&&video.paused)throw Error('El video se detuvo antes de empezar la captura. Pulsa reproducir y vuelve a iniciar la traducción.');
      original=video.volume;ownVolume=true;video.volume=0;
      if(prepared){await video.play();if(closed)throw Error('Inicio cancelado.');}
     }});
    video.addEventListener('seeking',stop,{once:true});video.addEventListener('pause',sourcePaused,{once:true});video.addEventListener('emptied',sourceEmptied,{once:true});
    video.addEventListener('ratechange',stopAndRestorePosition,{once:true});
    video.addEventListener('waiting',sourceWaiting);video.addEventListener('playing',sourcePlaying);
    await replay.start();resumeOriginal=null;return;
   }
   await audio.audioWorklet.addModule(chrome.runtime.getURL('pcm-capture.js'));if(closed)return;
   input=audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));node=new AudioWorkletNode(audio,'brivany-tab-pcm');silent=audio.createGain();silent.gain.value=0;input.connect(node);node.connect(silent);silent.connect(audio.destination);
   sender=new PCMSender({send:message=>port.postMessage(message),fail});node.port.onmessage=event=>{if(!closed&&event.data?.buffer)sender.enqueue(event.data.buffer);};
   port.postMessage({type:'select',selection,source:snapshot?.source||'video:0',has_captions:cues.length>0,translate:true,audio_ack:true});port.postMessage({type:'position',position:video.currentTime});nextCaptions();
   video.addEventListener('pause',mediaState);video.addEventListener('play',mediaState);video.addEventListener('emptied',stop,{once:true});mediaState();ui.text.textContent='Preparando traducción…';timer=setInterval(()=>{if(!video.isConnected)stop();else port.postMessage({type:'position',position:video.currentTime});},1000);
  }catch(error){
   const message=error.name==='OverconstrainedError'?'El navegador no pudo limitar la captura. El video sigue con su audio original.':error.message;
   fail(replay&&error.name==='Error'||message?.startsWith('Este video no permite')||error.name==='OverconstrainedError'?message:'No se pudo obtener el audio de este video. Reprodúcelo y vuelve a marcarlo.');
  }
 });
 prefix=await takeVideoPrefix(video);if(!closed)port.postMessage({type:'connect-video',selection});
}
