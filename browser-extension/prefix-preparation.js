/* Ten seconds of the selected element only. No image, playback or volume change. */
const FRAMES=125,PREFIX_MS=10000,FRAME_BYTES=3840,MAX_START=.8,PREFIX_TTL_MS=600000;
const attempted=new WeakMap();
const setupAttempts=new WeakMap();
let watching=false,pending=null,prepared=null;
const youtube=host=>/(^|\.)youtube\.com$/.test(host);
const mediaSource=video=>video.currentSrc||video.src||'';

export function youtubeAdPlaying(video,href=location.href){
 return youtube(new URL(href).hostname)&&Boolean(video.closest?.('#movie_player.ad-showing, #movie_player.ad-interrupting'));
}

export function prefixSource(video,href=location.href){
 const page=new URL(href);
 if(youtube(page.hostname)){
  if(youtubeAdPlaying(video,href))return null;
  const id=page.pathname==='/watch'?page.searchParams.get('v'):page.pathname.match(/^\/shorts\/([\w-]{11})$/)?.[1];
  return id&&/^[\w-]{11}$/.test(id)?'youtube:'+id:null;
 }
 const url=mediaSource(video);
 if(!/^https?:\/\//.test(url||''))return null;
 let hash=2166136261;
 for(const char of url)hash=Math.imul(hash^char.charCodeAt(0),16777619);
 return 'video:'+(hash>>>0).toString(16);
}

export function openingVideo(video){
 return video.isConnected&&!video.paused&&!video.seeking&&!video.ended&&!video.muted&&video.volume>0&&
  video.readyState>=2&&video.playbackRate===1&&Number.isFinite(video.duration)&&
  video.currentTime>=0&&video.currentTime<=MAX_START&&video.duration-video.currentTime>=FRAMES*.08&&
  video.seekable.length>0&&video.seekable.start(0)<=MAX_START;
}

function begin(video,source){
 document.documentElement.dataset.brivanyPrefixState='capturing';
 delete document.documentElement.dataset.brivanyPrefixError;
 const generation=crypto.randomUUID(),media=mediaSource(video);
 const sameSource=()=>prefixSource(video)===source&&mediaSource(video)===media;
 const audio=new AudioContext({sampleRate:24000});
 let port;
 try{port=chrome.runtime.connect({name:'brivany-prepare'});}catch{attempted.delete(video);document.documentElement.dataset.brivanyPrefixState='unavailable';document.documentElement.dataset.brivanyPrefixError='connection_pending';audio.close().catch(()=>{});return;}
 let stream,input,tap,silent,count=0,position=null,captureReady=false,closed=false,finishSent=false,requestSent=false;
 let phase='audio_setup';
 const frames=[];
 let settled;
 const done=new Promise(resolve=>{settled=resolve;});
 const releaseAudio=()=>{
  try{tap?.port.postMessage({active:false});}catch{}
  for(const node of [tap,input,silent])try{node?.disconnect();}catch{}
  for(const track of stream?.getTracks()||[])track.stop();
  tap=input=silent=stream=null;
  if(audio.state!=='closed')audio.close().catch(()=>{});
 };
 // A completed PCM prefix is independent of the current playback position.
 // Seeking/pausing after capture must not waste an already running analysis.
 const canceledByVideo=event=>{if(count<FRAMES||['emptied','loadstart'].includes(event.type)){phase='source_changed';close();}};
 const events=['pause','seeking','ratechange','emptied','loadstart','ended'];
 const close=()=>{
  if(closed)return;
  closed=true;clearTimeout(timeout);releaseAudio();frames.length=0;
  for(const event of events)video.removeEventListener(event,canceledByVideo);
  if(pending?.done===done)pending=null;
  if(!requestSent)attempted.delete(video);
  if(document.documentElement.dataset.brivanyPrefixState==='capturing'){
   document.documentElement.dataset.brivanyPrefixState='unavailable';
   document.documentElement.dataset.brivanyPrefixError=phase;
  }
  try{port.disconnect();}catch{}
  settled();
 };
 const timeout=setTimeout(close,25000);
 pending={video,source,media,done,close,complete:()=>count===FRAMES};
 for(const event of events)video.addEventListener(event,canceledByVideo);
 port.onDisconnect.addListener(close);
 const send=()=>{
  if(!captureReady||closed)return;
  while(frames.length){
   const frame=frames.shift();
   port.postMessage({type:'prefix-pcm',data:btoa(String.fromCharCode(...new Uint8Array(frame)))});
  }
  if(count===FRAMES&&!finishSent){finishSent=true;port.postMessage({type:'prefix-finish'});}
 };
 port.onMessage.addListener(message=>{
  if(closed)return;
  if(message.type==='prefix-capture'){captureReady=true;try{send();}catch{close();}return;}
  if(message.type==='prefix-ready'&&position!==null&&message.duration_ms===PREFIX_MS&&sameSource()&&
    typeof message.prefix_id==='string'&&/^[\w-]{16,128}$/.test(message.prefix_id)){
   const anchor=Number.isInteger(message.position_ms)&&message.position_ms>=0&&message.position_ms<=MAX_START*1000?message.position_ms:position;
   prepared={video,source,media,position:anchor,prefixId:message.prefix_id,expires:Date.now()+PREFIX_TTL_MS,
    resume:message.resume_from_ms,turns:message.turns,omittedMusic:message.omitted_music===true};
   document.documentElement.dataset.brivanyPrefixState='ready';
   delete document.documentElement.dataset.brivanyPrefixError;
  }
  close();
 });
 (async()=>{
  await Promise.all([audio.resume(),audio.audioWorklet.addModule(chrome.runtime.getURL('pcm-capture.js'))]);
  if(closed)return;
  if(!openingVideo(video)||!sameSource()){phase='opening_changed';close();return;}
  stream=video.captureStream();
  for(const track of stream.getVideoTracks())track.stop();
  const tracks=stream.getAudioTracks();
  if(!tracks.length){phase='audio_track_missing';close();return;}
  input=audio.createMediaStreamSource(new MediaStream(tracks));tap=new AudioWorkletNode(audio,'brivany-tab-pcm');
  silent=audio.createGain();silent.gain.value=0;input.connect(tap);tap.connect(silent);silent.connect(audio.destination);
  tap.port.onmessage=event=>{
   if(closed||count>=FRAMES||event.data?.buffer?.byteLength!==FRAME_BYTES)return;
   if(!sameSource()){close();return;}
   frames.push(event.data.buffer);count++;
   if(count===FRAMES){phase='analysis_pending';releaseAudio();}
   try{send();}catch{close();}
  };
  position=Math.round(video.currentTime*1000);
  tap.port.postMessage({active:true});
  phase='connection_pending';requestSent=true;
  port.postMessage({type:'prefix-start',source,position_ms:position,generation});
 })().catch(close);
}

export function observeVideoPrefix(candidate){
 if(watching)return;
 watching=true;
 let player=null;
 const observer=new MutationObserver(()=>inspect());
 const invalidate=video=>{
  if(prepared?.video===video){prepared=null;document.documentElement.dataset.brivanyPrefixState='unavailable';}
  if(pending?.video===video)pending.close();
 };
 const inspect=()=>{
  const video=document.visibilityState==='visible'?candidate():null;
  const nextPlayer=video&&youtube(location.hostname)?video.closest('#movie_player'):null;
  if(nextPlayer!==player){observer.disconnect();player=nextPlayer;if(player)observer.observe(player,{attributes:true,attributeFilter:['class']});}
  if(video&&youtubeAdPlaying(video)){invalidate(video);attempted.delete(video);setupAttempts.delete(video);return;}
  const source=video?prefixSource(video):null;
  if(pending&&(!pending.video.isConnected||pending.source!==prefixSource(pending.video)||pending.media!==mediaSource(pending.video)||
    !pending.complete()&&pending.video!==video))pending.close();
  if(prepared&&prepared.video===video&&(prepared.source!==source||prepared.media!==mediaSource(video)))prepared=null;
  if(!source||!openingVideo(video)||pending||attempted.get(video)===source)return;
  const prior=setupAttempts.get(video),same=prior?.source===source&&prior.media===mediaSource(video);
  if(same&&prior.count>=2)return;
  setupAttempts.set(video,{source,media:mediaSource(video),count:same?prior.count+1:1});
  attempted.set(video,source);
  try{begin(video,source);}catch{attempted.delete(video);document.documentElement.dataset.brivanyPrefixState='unavailable';document.documentElement.dataset.brivanyPrefixError='audio_setup';}
 };
 for(const event of ['playing','loadeddata','canplay','durationchange','visibilitychange'])document.addEventListener(event,inspect,true);
 for(const event of ['seeking','ratechange','emptied','loadstart'])document.addEventListener(event,value=>{
  if(event==='emptied'||event==='loadstart'){
   invalidate(value.target);attempted.delete(value.target);setupAttempts.delete(value.target);
  }else if(pending?.video===value.target&&!pending.complete())pending.close();
 },true);
 window.addEventListener('pagehide',()=>{observer.disconnect();pending?.close();prepared=null;},{once:true});
 inspect();
}

export async function takeVideoPrefix(video){
 if(pending?.video===video){
  const preparation=pending;
  await Promise.race([preparation.done,new Promise(resolve=>setTimeout(resolve,350))]);
 }
 pending?.close();
 const value=prepared;prepared=null;
 if(value?.video!==video||value.source!==prefixSource(video)||value.media!==mediaSource(video)||value.expires<=Date.now()||video.playbackRate!==1)return null;
 const {source,position,prefixId,resume,turns,omittedMusic}=value;
 return {source,position,prefixId,resume,turns,omittedMusic};
}
