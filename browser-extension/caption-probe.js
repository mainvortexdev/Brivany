/* Runs only in the video tab granted by the user's extension action. */
export async function readVideoCaptions(cached=null,selection=null){
 const videos=[...document.querySelectorAll('video')].filter(v=>v.readyState>0&&!v.ended);
 const video=selection?videos.find(v=>v.dataset?.brivanySelection===selection):videos.find(v=>!v.paused)||videos[0];if(!video)return null;
 const youtube=/(^|\.)youtube\.com$/.test(location.hostname),id=youtube?new URL(location.href).searchParams.get('v'):null;
 let hash=2166136261;for(const c of String(video.currentSrc||video.src||''))hash=Math.imul(hash^c.charCodeAt(0),16777619);
 const source=id&&/^[\w-]{11}$/.test(id)?'youtube:'+id:'video:'+(hash>>>0).toString(16);
 const clean=text=>String(text||'').replace(/<[^>]{0,200}>/g,'').replace(/\s+/g,' ').trim().slice(0,400);
 let cues=[],language='',kind='none';
 const tracks=[...video.textTracks].filter(t=>['subtitles','captions'].includes(t.kind));
 const track=tracks.find(t=>t.mode==='showing')||tracks.find(t=>t.mode==='hidden');
 if(track?.cues?.length){
  language=track.language||'';kind='text-track';
  cues=[...track.cues].slice(0,2000).map(c=>{const voice=String(c.text).match(/<v(?:\.[^ >]+)?\s+([^>]{1,60})>/);return {start:c.startTime,end:c.endTime,text:clean(c.text),speaker:voice?clean(voice[1]):null};});
 }else if(youtube&&id){
  if(cached?.source===source&&cached.expires>Date.now()&&Array.isArray(cached.cues)){cues=cached.cues;language=cached.language;kind=cached.kind;}
  else{
   // Read only the caption track already exposed by the normal player. No
   // owner API, cookie extraction, media download, tokens or access bypass.
   let response;try{response=document.querySelector('#movie_player')?.getPlayerResponse?.()||globalThis.ytInitialPlayerResponse;}catch{}
   const list=response?.videoDetails?.videoId===id?response.captions?.playerCaptionsTracklistRenderer?.captionTracks:null;
   const selected=Array.isArray(list)?list.find(t=>t.kind==='asr')||list[0]:null;
   if(selected?.baseUrl){
    const address=new URL(selected.baseUrl,location.origin),timer=new AbortController(),timeout=setTimeout(()=>timer.abort(),1400);
    try{
     if(address.protocol!=='https:'||address.origin!==location.origin||address.pathname!=='/api/timedtext'||address.searchParams.get('v')!==id)throw Error('caption source');
     address.searchParams.set('fmt','json3');
     const reply=await fetch(address.href,{credentials:'same-origin',redirect:'error',signal:timer.signal});if(!reply.ok||!reply.body)throw Error('caption unavailable');
     const reader=reply.body.getReader(),parts=[];let size=0;
     while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1048576){await reader.cancel();throw Error('caption size');}parts.push(chunk.value);}
     const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
     const data=JSON.parse(new TextDecoder().decode(raw));
     cues=(Array.isArray(data.events)?data.events:[]).slice(0,2000).filter(e=>Array.isArray(e.segs)&&Number.isFinite(e.tStartMs)&&Number.isFinite(e.dDurationMs)).map(e=>({start:e.tStartMs/1000,end:(e.tStartMs+e.dDurationMs)/1000,text:clean(e.segs.map(s=>s.utf8||'').join('')),speaker:null}));
     language=String(selected.languageCode||'').slice(0,12);kind='youtube-captions';
    }catch{}finally{clearTimeout(timeout);}
   }
  }
 }
 cues=cues.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start&&c.end-c.start<=30&&c.text&&!/^[\s♪♫♬]+$|^\[(?:music|música|applause|aplausos)\]$/i.test(c.text));
 return {source,position:video.currentTime,rate:video.playbackRate,paused:video.paused,language,kind,cues,expires:Date.now()+300000};
}

export function upcomingCaptions(snapshot){
 if(!snapshot||snapshot.paused||!Number.isFinite(snapshot.position)||snapshot.rate!==1||!Array.isArray(snapshot.cues))return null;
 const cues=snapshot.cues.filter(c=>c.end>snapshot.position&&c.start<snapshot.position+16).slice(0,6).map(c=>({start:c.start,end:c.end,text:c.text,speaker:c.speaker||null}));
 return {source:snapshot.source,position:snapshot.position,language:snapshot.language,kind:snapshot.kind,cues};
}
