/* Pointer-driven drawing. Frames exist only while a pointer/view change is pending. */
(() => {
 'use strict';
 const core=window.BrivanyCanvasCore,$=id=>document.getElementById(id),viewport=$('viewport'),board=$('board'),canvas=$('drawing'),preview=$('preview');
 const ctx=canvas.getContext('2d',{alpha:false}),over=preview.getContext('2d');
 let doc=new core.Document(),tool='pen',color='#1d1d1f',fill=false,active=null,frame=0,disposed=false,busy=false,space=false,revision=0,outputStamp='empty',closeMode='close',toastTimer=0,maximized=false,closing=false;
 const widths={pen:4,marker:22,eraser:26,line:4,rect:4,ellipse:4},view={x:0,y:0,scale:1,fitted:true},pointers=new Map();let pinch=null,transformPending=false,rpc=Promise.resolve(),pendingClose=null;
 const labels={pen:'Lápiz',marker:'Marcador',eraser:'Borrador',line:'Línea',rect:'Rectángulo',ellipse:'Elipse'};
 function toast(text){$('toast').textContent=text;$('toast').hidden=!text;clearTimeout(toastTimer);if(text)toastTimer=setTimeout(()=>$('toast').hidden=true,2600)}
 async function native(method,...args){const api=window.pywebview?.api;if(typeof api?.[method]!=='function')throw Error('Abre el lienzo desde Brivany Desktop.');return api[method](...args)}
 function enqueue(method,...args){const request=rpc.catch(()=>{}).then(()=>native(method,...args));rpc=request;return request}
 function dirty(){return doc.hasDrawing()&&doc.stamp()!==outputStamp}
 function changed(){revision++;$('undo').disabled=!doc.cursor;$('redo').disabled=doc.cursor===doc.history.length;if(window.pywebview?.api?.canvas_changed)enqueue('canvas_changed',revision,dirty()).catch(()=>{});}
 function transform(){board.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;transformPending=false}
 function queue(){if(!frame&&!disposed&&!document.hidden)frame=requestAnimationFrame(paint)}
 function fit(){const size=doc.size(),w=viewport.clientWidth,h=viewport.clientHeight;view.scale=Math.max(.05,Math.min((w-80)/size.width,(h-120)/size.height));view.x=(w-size.width*view.scale)/2;view.y=(h-size.height*view.scale)/2+20;view.fitted=true;transformPending=true;queue()}
 function point(event){const rect=viewport.getBoundingClientRect(),size=doc.size();return {x:Math.max(0,Math.min(size.width,(event.clientX-rect.left-view.x)/view.scale)),y:Math.max(0,Math.min(size.height,(event.clientY-rect.top-view.y)/view.scale))}}
 function inside(event){const r=board.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom}
 function replay(){core.replay(ctx,doc,preview);preview.style.opacity='1';if(view.fitted)fit();else{transformPending=true;queue()}}
 function closePopovers(){for(const el of document.querySelectorAll('[popover]:popover-open'))el.hidePopover()}
 function choose(value){if(!core.TOOLS.includes(value))return;finish();tool=value;for(const b of document.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b.dataset.tool===tool));$('width').value=String(widths[tool]);$('width-value').textContent=String(widths[tool]);closePopovers()}
 function addPoint(event){
  if(!active?.command.points)return;const p=point(event),points=active.command.points;
  const pressure=active.command.variable?Math.max(.05,Math.min(1,event.pressure||.5)):1;
  const x=Math.round(p.x*100)/100,y=Math.round(p.y*100)/100;
  if(points.length&&Math.hypot(points[points.length-3]-x,points[points.length-2]-y)<.35)return;
  if(points.length/3>=active.limit){finish();toast('Suelta el trazo para continuar.');return}
  points.push(x,y,Math.round(pressure*1000)/1000);
 }
 function paint(){
  frame=0;if(disposed)return;if(transformPending)transform();
  if(!active||active.mode!=='draw')return;const c=active.command;
  if(c.points){core.ink(over,c,active.drawn);active.drawn=c.points.length}else{over.clearRect(0,0,preview.width,preview.height);core.draw(over,c,preview)}
 }
 function finish(cancel=false){
  if(!active)return;const current=active;cancelAnimationFrame(frame);paint();active=null;delete document.body.dataset.panning;
  if(current.mode==='draw'){
   if(!cancel){try{doc.add(current.command);ctx.save();ctx.globalAlpha=current.command.tool==='marker'?.28:1;ctx.drawImage(preview,0,0);ctx.restore();changed()}catch(error){toast(error.message)}}
   over.clearRect(0,0,preview.width,preview.height);preview.style.opacity='1';
  }
  try{if(viewport.hasPointerCapture(current.id))viewport.releasePointerCapture(current.id)}catch{}
 }
 function startPinch(){
  const values=[...pointers.values()];if(values.length!==2)return;finish(true);
  const [a,b]=values,rect=viewport.getBoundingClientRect(),x=(a.x+b.x)/2-rect.left,y=(a.y+b.y)/2-rect.top;
  pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale:view.scale,docX:(x-view.x)/view.scale,docY:(y-view.y)/view.scale};
 }
 viewport.addEventListener('pointerdown',event=>{
  if(busy||event.button>1)return;event.preventDefault();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===2){startPinch();return}if(pointers.size>2)return;
  if(active)return;
  if(space||event.button===1){active={mode:'pan',id:event.pointerId,x:event.clientX,y:event.clientY,startX:view.x,startY:view.y};document.body.dataset.panning='true'}
  else{if(!inside(event))return;if(doc.points()>=core.MAX_POINTS||doc.cursor>=core.MAX_COMMANDS){toast('Exporta el dibujo y abre un lienzo nuevo.');return}const p=point(event),free=['pen','marker','eraser'].includes(tool);
   const command={tool,color,size:widths[tool],fill,variable:event.pointerType==='pen'&&tool!=='marker',...(free?{points:[]}:{x1:p.x,y1:p.y,x2:p.x,y2:p.y})};
   active={mode:'draw',id:event.pointerId,command,drawn:0,limit:Math.min(50000,core.MAX_POINTS-doc.points())};preview.style.opacity=tool==='marker'?'.28':'1';if(free)addPoint(event);
  }
  viewport.setPointerCapture(event.pointerId);queue();
 });
 viewport.addEventListener('pointermove',event=>{
  if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()],rect=viewport.getBoundingClientRect();view.scale=Math.max(.05,Math.min(4,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));view.x=(a.x+b.x)/2-rect.left-pinch.docX*view.scale;view.y=(a.y+b.y)/2-rect.top-pinch.docY*view.scale;view.fitted=false;transformPending=true;queue();return}
  if(!active||active.id!==event.pointerId)return;
  if(active.mode==='pan'){view.x=active.startX+event.clientX-active.x;view.y=active.startY+event.clientY-active.y;view.fitted=false;transformPending=true}
  else if(active.command.points){for(const sample of event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event]){if(!active)break;addPoint(sample)}}
  else{const p=point(event),c=active.command;if(event.shiftKey&&c.tool!=='line'){const d=Math.max(Math.abs(p.x-c.x1),Math.abs(p.y-c.y1)),size=doc.size();p.x=Math.max(0,Math.min(size.width,c.x1+Math.sign(p.x-c.x1||1)*d));p.y=Math.max(0,Math.min(size.height,c.y1+Math.sign(p.y-c.y1||1)*d))}c.x2=p.x;c.y2=p.y}
  queue();
 });
 function end(event,cancel=false){pointers.delete(event.pointerId);if(pinch){if(pointers.size<2)pinch=null;return}if(active?.id===event.pointerId){if(active.command?.points&&!cancel)addPoint(event);finish(cancel)}}
 viewport.addEventListener('pointerup',event=>end(event));viewport.addEventListener('pointercancel',event=>end(event,true));viewport.addEventListener('lostpointercapture',event=>{if(active?.id===event.pointerId)finish()});
 viewport.addEventListener('contextmenu',event=>event.preventDefault());
 viewport.addEventListener('wheel',event=>{event.preventDefault();finish();const rect=viewport.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,old=view.scale;view.scale=Math.max(.05,Math.min(4,old*Math.exp(-event.deltaY*.0015)));view.x=x-(x-view.x)*view.scale/old;view.y=y-(y-view.y)*view.scale/old;view.fitted=false;transformPending=true;queue()},{passive:false});
 function undo(){if(busy)return;finish();if(doc.undo()){replay();changed()}}
 function redo(){if(busy)return;finish();if(doc.redo()){replay();changed()}}
 async function png(){finish();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo preparar el PNG.')),'image/png'))}
 async function dataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('No se pudo leer el dibujo.'));reader.readAsDataURL(blob)})}
 async function output(kind){
  if(busy)return false;finish();busy=true;$('toolbar').inert=true;document.body.dataset.busy='true';const stamp=doc.stamp(),at=revision;
  try{const value=await dataURL(await png());if(value.length>23000000)throw Error('El PNG es demasiado grande. Reduce el tamaño del lienzo.');const result=await enqueue(kind==='copy'?'canvas_copy':'canvas_export',value,at);
   if(result.copied||result.saved){outputStamp=stamp;toast(kind==='copy'?'PNG copiado':'PNG guardado');return true}return false;
  }catch(error){toast(error.message||'No se pudo preparar el PNG.');return false}
  finally{busy=false;$('toolbar').inert=false;document.body.dataset.busy='false';if(pendingClose){const mode=pendingClose;pendingClose=null;setTimeout(()=>requestClose(mode),0)}}
 }
 function reset(){doc=new core.Document();outputStamp='empty';replay();fit();changed()}
 function cancelClose(){if($('close-dialog').open)$('close-dialog').close();enqueue('canvas_close_decision','cancel').catch(()=>{})}
 async function resolveClose(discard=false){
  if(closeMode==='new'){if($('close-dialog').open)$('close-dialog').close();reset();return}
  closing=true;try{await enqueue('canvas_close_decision',discard?'discard':'close')}catch(error){closing=false;toast(error.message)}
 }
 async function requestClose(mode='close'){
  if(disposed)return;if(busy){pendingClose=mode;return}
  finish();closePopovers();closeMode=mode;
  if(dirty()){$('close-question').textContent=mode==='new'?'¿Guardar el dibujo antes de empezar otro?':'¿Guardar el dibujo antes de cerrar?';if(!$('close-dialog').open)$('close-dialog').showModal()}
  else await resolveClose();
 }
 for(const button of document.querySelectorAll('[data-tool]'))button.onclick=()=>{if(!busy)choose(button.dataset.tool)};
 for(const value of ['#1d1d1f','#387bed','#44a970','#ffbb48','#eb6786','#8267d5','#44b5c7','#a67651','#b6bac4','#ffffff']){const button=document.createElement('button');button.type='button';button.style.setProperty('--ink',value);button.setAttribute('aria-label','Color '+value);button.onclick=()=>{color=value;$('color-swatch').style.background=color;$('custom-color').value=color;closePopovers()};$('colors').append(button)}
 $('custom-color').oninput=event=>{color=event.target.value;$('color-swatch').style.background=color};$('width').oninput=event=>{widths[tool]=Number(event.target.value);$('width-value').textContent=String(widths[tool])};$('fill').onchange=event=>{fill=event.target.checked};
 $('undo').onclick=undo;$('redo').onclick=redo;$('copy').onclick=()=>output('copy');$('export').onclick=()=>output('export');
 $('fit').onclick=()=>{finish();fit();closePopovers()};$('clear').onclick=()=>{if(busy)return;finish();try{doc.add({tool:'clear'});replay();changed()}catch(error){toast(error.message)}closePopovers()};$('new').onclick=()=>requestClose('new');
 $('size-button').onclick=()=>{const size=doc.size();$('canvas-width').value=size.width;$('canvas-height').value=size.height;$('size-error').textContent='';closePopovers();$('size-dialog').showModal()};$('size-cancel').onclick=()=>$('size-dialog').close();
 $('size-form').onsubmit=event=>{event.preventDefault();try{finish();doc.add({tool:'resize',width:Number($('canvas-width').value),height:Number($('canvas-height').value)});$('size-dialog').close();replay();fit();changed()}catch(error){$('size-error').textContent=error.message}};
 $('discard').onclick=()=>resolveClose(true);$('close-cancel').onclick=cancelClose;$('close-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelClose()});$('save-close').onclick=async()=>{if(await output('export')){if($('close-dialog').open)$('close-dialog').close();await resolveClose()}};
 $('window-close').onclick=()=>requestClose();$('window-min').onclick=()=>native('canvas_window','minimize').catch(error=>toast(error.message));$('window-max').onclick=()=>{native('canvas_window',maximized?'restore':'maximize').then(()=>{maximized=!maximized}).catch(error=>toast(error.message))};
 document.addEventListener('keydown',event=>{
  if($('close-dialog').open||$('size-dialog').open||event.target.closest('input,textarea,[contenteditable]'))return;
  if(event.code==='Space'){event.preventDefault();space=true;document.body.dataset.hand='true';return}
  const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
  if(mod&&['z','y','c','s','w'].includes(key)){event.preventDefault();if(key==='z')event.shiftKey?redo():undo();else if(key==='y')redo();else if(key==='c')output('copy');else if(key==='s')output('export');else requestClose();return}
  if(event.key==='Escape'){finish(true);closePopovers();return}if(busy)return;const keys={p:'pen',m:'marker',e:'eraser',l:'line',r:'rect',o:'ellipse'};if(keys[key]){event.preventDefault();choose(keys[key])}if(key==='0')fit();
 });
 document.addEventListener('keyup',event=>{if(event.code==='Space'){space=false;delete document.body.dataset.hand}});window.addEventListener('blur',()=>{space=false;delete document.body.dataset.hand;finish();pointers.clear();pinch=null});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){finish();cancelAnimationFrame(frame);frame=0}else if(view.fitted)fit()});
 document.addEventListener('dragover',event=>event.preventDefault());document.addEventListener('drop',event=>event.preventDefault());window.addEventListener('beforeunload',event=>{if(!closing&&dirty()){event.preventDefault();event.returnValue=''}});
 const observer=new ResizeObserver(()=>{if(view.fitted)fit();const focused=document.activeElement;if($('toolbar').contains(focused))focused.scrollIntoView({block:'nearest',inline:'nearest'})});observer.observe(viewport);
 for(const button of $('toolbar').querySelectorAll('button'))button.addEventListener('focus',()=>button.scrollIntoView({block:'nearest',inline:'nearest'}));
 async function nativeReady(){if(window.pywebview?.api?.canvas_ready){try{await native('canvas_ready')}catch{}}}
 function dispose(){disposed=true;cancelAnimationFrame(frame);clearTimeout(toastTimer);observer.disconnect();canvas.width=preview.width=1;canvas.height=preview.height=1;pointers.clear()}
 window.addEventListener('pywebviewready',nativeReady);window.addEventListener('pagehide',dispose,{once:true});
 window.BrivanyCanvas={requestClose,nativeReady,png,state:()=>({tool,color,size:widths[tool],fill,...doc.size(),history:doc.cursor,redo:doc.history.length-doc.cursor,revision,dirty:dirty(),framePending:!!frame,points:doc.points()}),clientPoint:(x,y)=>{const r=viewport.getBoundingClientRect();return {x:r.left+view.x+x*view.scale,y:r.top+view.y+y*view.scale}},dispose};
 replay();fit();nativeReady();
})();
