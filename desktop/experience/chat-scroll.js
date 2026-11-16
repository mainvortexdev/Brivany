/* Follow the latest message until the reader deliberately scrolls away. */
(() => {
 const log=document.querySelector('#chat-messages'),button=document.querySelector('#chat-latest'),bottom=document.querySelector('.chat-bottom');if(!log||!button)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let following=true,frame=0,programmatic=0,closed=false;
 const distance=()=>Math.max(0,log.scrollHeight-log.clientHeight-log.scrollTop);
 function sync(){button.hidden=log.hidden||distance()<24;button.setAttribute('aria-hidden',String(button.hidden))}
 function changed(){if(closed||frame)return;frame=requestAnimationFrame(()=>{frame=0;if(following&&!log.hidden){programmatic=performance.now()+100;log.scrollTop=log.scrollHeight}sync()})}
 function toLatest(smooth=true){following=true;programmatic=performance.now()+700;log.scrollTo({top:log.scrollHeight,behavior:smooth&&!reduced.matches?'smooth':'instant'});sync();if(!smooth)changed()}
 function scroll(){if(performance.now()>programmatic)following=distance()<8;sync()}
 function intent(event){if(event.type==='wheel'&&event.deltaY>=0)return;if(event.type==='keydown'&&!['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(event.key))return;programmatic=0;following=false}
 const resize=new ResizeObserver(changed),composer=new ResizeObserver(()=>{log.parentElement.style.setProperty('--chat-bottom-height',bottom.offsetHeight+'px');changed()});
 const observe=()=>{resize.disconnect();resize.observe(log);for(const child of log.children)resize.observe(child);changed()};
 const mutations=new MutationObserver(records=>{if(records.some(record=>record.target===log&&record.type==='childList'))observe();else changed()});mutations.observe(log,{childList:true,subtree:true,characterData:true});observe();if(bottom)composer.observe(bottom);
 log.addEventListener('scroll',scroll,{passive:true});for(const type of ['wheel','touchstart','pointerdown','keydown'])log.addEventListener(type,intent,{passive:true});
 log.addEventListener('load',changed,true);button.onclick=()=>toLatest();document.fonts?.ready.then(changed);
 try{history.scrollRestoration='manual'}catch{}
 window.BrivanyChatScroll={changed,toLatest,following:()=>following};
 window.addEventListener('pagehide',()=>{closed=true;cancelAnimationFrame(frame);resize.disconnect();composer.disconnect();mutations.disconnect();log.removeEventListener('scroll',scroll);for(const type of ['wheel','touchstart','pointerdown','keydown'])log.removeEventListener(type,intent);log.removeEventListener('load',changed,true)},{once:true});
})();
