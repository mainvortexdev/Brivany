(() => {
 const $=selector=>document.querySelector(selector),api=()=>window.pywebview?.api;
 async function ready(){if(api())return;await new Promise(resolve=>window.addEventListener('pywebviewready',resolve,{once:true}));}
 const status=text=>($('#work-status')||$('#region-status')).textContent=text;
 async function call(method,...args){try{await ready();return await api()[method](...args);}catch(error){status(error.message||'No se pudo completar la acción.');return null;}}
 if(location.pathname==='/work-capture'){
  let start=null,selection=null;
  const image=$('#region-image'),box=$('#region-selection');
  ready().then(async()=>{const value=await call('work_region_preview');if(value)image.src=value.preview;});
  $('#region-stage').onpointerdown=event=>{const rect=image.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;start={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);};
  $('#region-stage').onpointermove=event=>{if(!start)return;const rect=image.getBoundingClientRect(),x=Math.max(rect.left,Math.min(rect.right,event.clientX)),y=Math.max(rect.top,Math.min(rect.bottom,event.clientY));selection={x:Math.min(start.x,x),y:Math.min(start.y,y),w:Math.abs(start.x-x),h:Math.abs(start.y-y)};box.hidden=false;Object.assign(box.style,{left:selection.x+'px',top:selection.y+'px',width:selection.w+'px',height:selection.h+'px'});};
  $('#region-stage').onpointerup=()=>{start=null;const enabled=selection&&selection.w>=12&&selection.h>=12;$('#region-translate').disabled=!enabled;};
  window.addEventListener('resize',()=>{start=null;selection=null;box.hidden=true;$('#region-translate').disabled=true;});
  async function use(action){if(!selection)return;const rect=image.getBoundingClientRect();await call('use_work_region',(selection.x-rect.left)/rect.width,(selection.y-rect.top)/rect.height,selection.w/rect.width,selection.h/rect.height,action);}
  $('#region-translate').onclick=()=>use('translate');$('#region-cancel').onclick=()=>call('cancel_work_region');document.addEventListener('keydown',event=>{if(event.key==='Escape')call('cancel_work_region');});return;
 }
})();
