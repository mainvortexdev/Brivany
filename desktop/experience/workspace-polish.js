/* Short, interruptible interface motion. No permanent animation loop. */
(() => {
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),body=document.body;
 const content=document.querySelector('#island-content'),dialog=document.querySelector('#app-settings');
 const enabled=()=>!reduced.matches&&body.dataset.motion!=='false'&&!document.hidden;
 let animations=[],particles=null,lastPanel='',wasOpen=false,lastBurst=-Infinity,disposed=false;
 let toolAnimation=null, activeTool=null;
 function cancel(){animations.forEach(a=>a.cancel());animations=[];particles?.remove();particles=null;toolAnimation=null;activeTool=null;}
 function animate(element,frames,options){
  if(!element||!enabled())return;
  const animation=element.animate(frames,{duration:220,easing:'cubic-bezier(.16,1,.3,1)',...options});
  animations.push(animation);animation.finished.catch(()=>{}).finally(()=>{animations=animations.filter(a=>a!==animation);});
  return animation;
 }
 function burst(target,count=9){
  if(!enabled()||!target||performance.now()-lastBurst<550)return;
  if(body.dataset.economy==='true')count=Math.min(count,6);
  lastBurst=performance.now();particles?.remove();
  const layer=document.createElement('span');layer.className='workspace-sparks';layer.setAttribute('aria-hidden','true');target.append(layer);particles=layer;
  for(let i=0;i<Math.min(12,count);i++){
   const dot=document.createElement('i'),angle=(i/count)*Math.PI*2;
   dot.style.left=(50+Math.cos(angle)*22)+'%';dot.style.top='26%';layer.append(dot);
   const a=animate(dot,[{opacity:0,transform:'translate(0, 4px) scale(.3)'},{opacity:.85,offset:.2},{opacity:0,transform:`translate(${Math.cos(angle)*38}px, ${-18-Math.abs(Math.sin(angle))*32}px) scale(.2)`}],{duration:620,delay:i*17});
   if(i===Math.min(12,count)-1)a?.finished.catch(()=>{}).finally(()=>{layer.remove();if(particles===layer)particles=null;});
  }
 }
 function layout(){
  if(disposed||!content)return;
  const open=body.dataset.expanded==='true',panel=body.dataset.panel;
  if(open&&(!wasOpen||panel!==lastPanel)){
   cancel();content.style.transformOrigin='50% 0';
   if(!wasOpen)animate(content,[{opacity:0,transform:'translateY(-8px) scale(.975)'},{opacity:1,transform:'translateY(0) scale(1)'}]);
   const view=content.querySelector(`[data-view="${panel}"]`);
   animate(view,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:180});
  }else if(!open)cancel();
  wasOpen=open;lastPanel=panel;
 }
 function enterTool(){
  if(disposed||body.dataset.panel!=='widgets'||body.dataset.expanded!=='true')return;
  const next=content.querySelector('[data-widget-pane]:not([hidden])');
  if(!next||next===activeTool)return;
  toolAnimation?.cancel();
  activeTool=next;
  next.closest('[data-view="widgets"]')?.scrollTo({top:0,behavior:'instant'});
  toolAnimation=animate(next,[
   {opacity:.65,transform:'translateY(5px)'},
   {opacity:1,transform:'translateY(0)'}
  ],{duration:160});
 }
 function accepted(){
  burst(content,11);
  const mascot=document.querySelector('.melodi-character');
  animate(mascot,[{transform:'scale(1)'},{transform:'translateY(3px) scale(1.12,.86)',offset:.35},{transform:'translateY(-2px) scale(.96,1.04)',offset:.65},{transform:'scale(1)'}],{duration:420});
 }
 function finished(){
  const glance=document.querySelector('#workspace-timer-glance');
  burst(content&&body.dataset.expanded==='true'?content:document.querySelector('.toolstrip'));
  animate(glance,[{transform:'scale(1)'},{transform:'scale(1.08)',offset:.5},{transform:'scale(1)'}],{duration:360});
 }
 window.addEventListener('brivany-island-layout',layout);
 window.addEventListener('brivany-widget-tab',enterTool);
 window.addEventListener('brivany-files-added',accepted);
 window.addEventListener('brivany-timer-finished',finished);
 function preferences(){if(!enabled())cancel();}
 reduced.addEventListener('change',preferences);
 window.addEventListener('brivany-workspace-preferences',preferences);
 document.addEventListener('visibilitychange',preferences);
 // Native <dialog> keeps its own focus trap, Escape and focus restoration.
 const observer=dialog?new MutationObserver(()=>{
  cancel();if(dialog.open)animate(dialog,[{opacity:0,transform:'translateY(12px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}]);
 }):null;
 observer?.observe(dialog,{attributes:true,attributeFilter:['open']});
 function dispose(){disposed=true;cancel();observer?.disconnect();reduced.removeEventListener('change',preferences);window.removeEventListener('brivany-island-layout',layout);window.removeEventListener('brivany-widget-tab',enterTool);window.removeEventListener('brivany-files-added',accepted);window.removeEventListener('brivany-timer-finished',finished);window.removeEventListener('brivany-workspace-preferences',preferences);document.removeEventListener('visibilitychange',preferences);}
 window.addEventListener('pagehide',dispose,{once:true});
 window.BrivanyWorkspacePolish={burst,dispose};
})();
