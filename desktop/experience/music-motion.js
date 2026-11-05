/* Music expression is an estimate from public metadata/timed text, not audio BPM.
 * No network, recording, model, persistence or interpretation of provider HTML.
 */
(() => {
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const words=text=>String(text||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
 function estimate(track={},lyrics=null,position=0){
  const tags=new Set(words([track.title,track.album].join(' ')));
  const calm=['acoustic','acustico','piano','ambient','lullaby','balada','ballad','sleep','meditation','nocturne'].some(x=>tags.has(x));
  const festive=['dance','fiesta','party','celebrate','celebration','happy','alegria','funk','disco'].some(x=>tags.has(x));
  const lines=lyrics?.synced?lyrics.lines||[]:[];let index=0;
  while(index+1<lines.length&&lines[index+1].ms<=position)index++;
  const window=lines.slice(Math.max(0,index-2),index+6),rates=[];
  for(let i=0;i+1<window.length;i++){
   const gap=(window[i+1].ms-window[i].ms)/1000,count=words(window[i].text).length;
   if(gap>=.6&&gap<=14&&count)rates.push(clamp(count/gap,0,7));
  }
  rates.sort((a,b)=>a-b);const density=rates.length?rates[Math.floor(rates.length/2)]:null;
  const mood=calm?'gentle':festive||density!==null&&density>=2.8?'lively':density!==null&&density<1.25?'gentle':'groove';
  let seed=0;for(const char of String(track.id||'melodi'))seed=(seed*31+char.charCodeAt(0))>>>0;
  const period={gentle:2.1,groove:1.3,lively:.9}[mood]+(seed%5)*.035;
  return {mood,period:Number(period.toFixed(3)),variant:seed%2?'bounce':'sway',source:calm||festive?'metadata-estimate':density!==null?'timed-text-estimate':'neutral-fallback'};
 }
 const rgb=value=>/^#[a-f\d]{6}$/i.test(value)?value.slice(1).match(/../g).map(x=>parseInt(x,16)):null;
 function paletteTransition(root,allowMotion){
  let frame=0,target=null;
  const current=name=>{const value=root.style.getPropertyValue('--music-'+name)||getComputedStyle(root).getPropertyValue('--music-'+name);const parts=value.trim().split(',').map(Number);return parts.length===3&&parts.every(Number.isFinite)?parts:[126,146,170];};
  const apply=value=>{for(const name of ['primary','secondary'])root.style.setProperty('--music-'+name,value[name].map(x=>Math.round(x)).join(','));};
  function to(value){
   const next={primary:rgb(value.primary),secondary:rgb(value.secondary)};if(!next.primary||!next.secondary)return false;
   cancelAnimationFrame(frame);target=next;
   if(!allowMotion()){apply(next);return true;}
   const from={primary:current('primary'),secondary:current('secondary')},began=performance.now();
   function step(now){const t=clamp((now-began)/1800,0,1),ease=t*t*(3-2*t);const blended={};
    for(const name of ['primary','secondary'])blended[name]=from[name].map((v,i)=>v+(next[name][i]-v)*ease);
    apply(blended);frame=t<1&&allowMotion()?requestAnimationFrame(step):0;if(!frame)apply(next);
   }frame=requestAnimationFrame(step);return true;
  }
  function settle(){cancelAnimationFrame(frame);frame=0;if(target)apply(target);}
  function dispose(){cancelAnimationFrame(frame);frame=0;target=null;}
  return {to,settle,dispose};
 }
 function lyricTransition(container,rows,allowMotion){
  const old=[...container.children].map(el=>({index:el.dataset.lineIndex,top:el.getBoundingClientRect().top,opacity:getComputedStyle(el).opacity,filter:getComputedStyle(el).filter}));
  container.getAnimations({subtree:true}).forEach(a=>a.cancel());container.replaceChildren(...rows);
  if(!allowMotion())return;
  for(const row of rows){
   const previous=old.find(x=>x.index!==undefined&&x.index===row.dataset.lineIndex),top=row.getBoundingClientRect().top;
   const delta=previous?clamp(previous.top-top,-24,24):9;
   row.animate([{transform:`translateY(${delta}px)`,opacity:previous?previous.opacity:0,filter:previous?.filter||'blur(1px)'},{transform:'translateY(0)',opacity:getComputedStyle(row).opacity,filter:getComputedStyle(row).filter}],{duration:360,easing:'cubic-bezier(.22,.7,.25,1)'});
  }
 }
 window.BrivanyMusicMotion={estimate,paletteTransition,lyricTransition};
})();
