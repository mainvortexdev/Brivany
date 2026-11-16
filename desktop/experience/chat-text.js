/* Streaming text reveal; no artificial server work or persisted timers. */
(() => {
 const writers=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const staticMotion=()=>reduced.matches||document.body.dataset.motion==='false';
 function schedule(writer){if(!writer.frame&&!document.hidden)writer.frame=requestAnimationFrame(time=>step(writer,time))}
 function step(writer,time){writer.frame=0;if(!writer.target.isConnected||document.hidden)return;
  if(staticMotion()){writer.target.textContent=writer.chars.join('');writer.visible=writer.chars.length;return}
  const backlog=writer.chars.length-writer.visible,elapsed=Math.min(50,time-(writer.time||time-16));writer.time=time;
  writer.credit=(writer.credit||0)+elapsed*Math.max(90,Math.min(320,backlog/14))/1000;
  const count=Math.min(backlog,Math.floor(writer.credit));
  if(count>0){writer.credit-=count;const span=document.createElement('span');span.className='chat-text-reveal';span.textContent=writer.chars.slice(writer.visible,writer.visible+count).join('');writer.target.append(span);writer.visible+=count;window.BrivanyChatScroll?.changed();}
  if(writer.visible<writer.chars.length)schedule(writer);
 }
 function write(target,text,id){
  let writer=writers.get(id);if(!writer){writer={target,visible:0,chars:[],frame:0,time:0};writers.set(id,writer)}
  if(staticMotion()){cancelAnimationFrame(writer.frame);writer.frame=0;writer.target=target;writer.chars=Array.from(text);writer.visible=writer.chars.length;target.textContent=text;return}
  if(!text.startsWith(writer.chars.slice(0,writer.visible).join(''))){writer.visible=0;target.replaceChildren()}
  if(writer.target!==target){writer.target=target;target.textContent=Array.from(text).slice(0,writer.visible).join('')}
  writer.chars=Array.from(text);schedule(writer);
 }
 document.addEventListener('visibilitychange',()=>{document.body.dataset.pageHidden=String(document.hidden);for(const writer of writers.values()){if(document.hidden){cancelAnimationFrame(writer.frame);writer.frame=0}else if(writer.visible<writer.chars.length)schedule(writer)}});
 reduced.addEventListener('change',()=>{if(reduced.matches)for(const writer of writers.values()){cancelAnimationFrame(writer.frame);writer.frame=0;writer.target.textContent=writer.chars.join('');writer.visible=writer.chars.length;}});
 window.addEventListener('pagehide',()=>{for(const writer of writers.values())cancelAnimationFrame(writer.frame);writers.clear()},{once:true});
 function fade(target){const value=target.textContent;if(target.dataset.fadeText===value)return;target.dataset.fadeText=value;if(!staticMotion())target.animate([{opacity:0},{opacity:1}],{duration:260,easing:'ease-out'});}
 window.BrivanyChatText={write,fade,target:id=>writers.get(id)?.target};
})();
