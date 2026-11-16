/* Music metadata only. No tab audio, page UI, lyrics, network or persistence. */
(() => {
 'use strict';if(globalThis.__brivanyMusicPresence)return;globalThis.__brivanyMusicPresence=true;
 const tag='brivany-music';
 function snapshot(){
  const video=document.querySelector('video'),player=document.querySelector('#movie_player');
  let response=window.ytInitialPlayerResponse;
  try{response=player?.getPlayerResponse?.()||response}catch{}
  const detail=response?.videoDetails||{},id=detail.videoId||new URL(location.href).searchParams.get('v');
  if(!video||!/^[\w-]{11}$/.test(id||''))return;
  const musicHost=location.hostname==='music.youtube.com',category=response?.microformat?.playerMicroformatRenderer?.category;
  const music=musicHost||category==='Music'||document.querySelector('meta[itemprop="genre"]')?.content==='Music';
  let title=String(detail.title||document.querySelector('meta[property="og:title"]')?.content||'').slice(0,240),artist='';
  if(musicHost){title=(document.querySelector('ytmusic-player-bar .title')?.textContent||title).trim().slice(0,240);artist=(document.querySelector('ytmusic-player-bar .byline a')?.textContent||'').trim().slice(0,240)}
  if(!artist&&String(detail.author||'').endsWith(' - Topic'))artist=detail.author.slice(0,-8).slice(0,240);
  window.postMessage({__brivany:tag,type:'music',video:id,title,artist,music,playing:!video.paused&&!video.ended,muted:video.muted||video.volume===0,position:Number.isFinite(video.currentTime)?video.currentTime:0,duration:Number.isFinite(video.duration)?video.duration:0},location.origin);
 }
 document.addEventListener('play',snapshot,true);document.addEventListener('pause',snapshot,true);document.addEventListener('ended',snapshot,true);
 window.addEventListener('yt-navigate-finish',snapshot);const timer=setInterval(snapshot,2000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});snapshot();
})();
