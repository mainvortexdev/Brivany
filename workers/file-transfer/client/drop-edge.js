/* Selected files stay local until a deliberate edge drop or Send press. */
(() => {
 'use strict';
 const t=value=>window.BrivanyDropText?.(value)||value;
 class EdgeSelection {
  constructor({send,preview,canSend,error}){
   Object.assign(this,{sendFile:send,preview,canSend,error});this.selected=[];this.queue=[];this.running=false;this.enabled=false;this.listeners=[];
   this.panel=document.getElementById('edge-selection');this.stack=document.getElementById('edge-stack');this.aura=document.getElementById('edge-aura');this.label=document.getElementById('edge-aura-label');
   this.panel.setAttribute('aria-label',t('Archivos seleccionados'));this.stack.setAttribute('aria-label',t('Arrastra los archivos al borde'));
   const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);this.listeners.push(()=>node.removeEventListener(type,fn,options))};
   listen(this.stack,'pointerdown',event=>this.down(event));listen(this.stack,'pointermove',event=>this.move(event));
   listen(this.stack,'pointerup',event=>this.up(event));listen(this.stack,'pointercancel',()=>this.reset());listen(this.stack,'lostpointercapture',()=>this.reset());
   listen(document,'keydown',event=>{if(event.key==='Escape')this.reset()});
   listen(document,'visibilitychange',()=>{if(document.hidden)this.reset()});listen(window,'blur',()=>this.reset());
   listen(document.getElementById('send-selected'),'click',()=>this.send());
   listen(document.getElementById('clear-selected'),'click',()=>{this.reset();this.selected=[];this.render()});
   this.render();
  }
  setEnabled(value){this.enabled=!!value;if(!value)this.reset();this.render()}
  stage(files,{append=false}={}){
   const {MAX,MAX_FILES,MAX_TOTAL,nameOK}=window.BrivanyDropPeer;
   if(!this.enabled||this.running||!this.canSend())throw Error(t('Termina o cancela el archivo actual.'));
   if(!files.length)return;
   const next=append?[...this.selected,...files]:[...files];
   if(next.length>MAX_FILES||next.reduce((sum,file)=>sum+file.size,0)>MAX_TOTAL)throw Error(t('Elige hasta 1.000 archivos; 20 GB en total.'));
   if(next.some(file=>!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX||!nameOK(file.name)))throw Error(t('Elige un archivo válido de hasta 20 GB.'));
   this.reset();this.selected=next;this.render();
  }
  render(){
   this.panel.hidden=!this.selected.length;this.stack.disabled=!this.enabled||this.running||!this.canSend();
   document.getElementById('send-selected').disabled=this.stack.disabled;
   document.getElementById('selection-count').textContent=t(this.selected.length===1?'{count} archivo seleccionado':'{count} archivos seleccionados').replace('{count}',String(this.selected.length));
   const list=document.getElementById('edge-files');list.replaceChildren();
   for(const file of this.selected){const item=document.createElement('li');item.textContent=file.name;list.append(item)}
   const status=document.getElementById('edge-queue');status.hidden=!this.running;
   const remaining=this.queue.length+Number(this.running);status.textContent=t(remaining===1?'{count} archivo en cola':'{count} archivos en cola').replace('{count}',String(remaining));
   document.getElementById('send-label').setAttribute('aria-disabled',String(!this.enabled||this.running||!this.canSend()));
   document.getElementById('send-file').disabled=!this.enabled||this.running||!this.canSend();
  }
  down(event){
   if(event.button!==0||!this.selected.length||this.stack.disabled)return;
   clearTimeout(this.remoteTimer);
   this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,edge:null};this.stack.setPointerCapture(event.pointerId);
  }
  move(event){
   const drag=this.drag;if(!drag||drag.id!==event.pointerId)return;
   const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
   if(!drag.moved&&Math.hypot(dx,dy)<8)return;
   drag.moved=true;this.stack.dataset.dragging='true';
   this.stack.style.transform=`translate3d(${dx}px,${dy}px,0) scale(.97)`;
   const distances={left:event.clientX,right:innerWidth-event.clientX,top:event.clientY,bottom:innerHeight-event.clientY};
   const edge=Object.keys(distances).reduce((a,b)=>distances[a]<distances[b]?a:b);
   drag.edge=distances[edge]>=0&&distances[edge]<=56?edge:null;
   this.show(drag.edge,t('Suelta para enviar'));
   this.preview(!!drag.edge,drag.edge?this.selected.length:0,drag.edge||edge);
   if(drag.edge&&!this.heartbeat)this.heartbeat=setInterval(()=>{if(this.drag?.edge)this.preview(true,this.selected.length,this.drag.edge)},1000);
   if(!drag.edge){clearInterval(this.heartbeat);this.heartbeat=null}
  }
  up(event){
   if(!this.drag||event.pointerId!==this.drag.id)return;
   const commit=this.drag.moved&&!!this.drag.edge;this.reset();if(commit)this.send();
  }
  reset(){
   const drag=this.drag;this.drag=null;
   if(drag&&this.stack.hasPointerCapture(drag.id))this.stack.releasePointerCapture(drag.id);
   this.stack.style.transform='';delete this.stack.dataset.dragging;
   clearInterval(this.heartbeat);this.heartbeat=null;
   if(drag)this.preview(false,0,drag.edge||'right');this.show(null);
  }
  show(edge,message=''){
   this.aura.dataset.edge=edge||'right';this.aura.dataset.active=String(!!edge);this.label.textContent=message;
  }
  remote(value){
   if(this.drag?.moved)return;
   clearTimeout(this.remoteTimer);
   this.show(value.active?({left:'right',right:'left',top:'bottom',bottom:'top'})[value.edge]:null,t('Archivos listos para recibir.'));
   if(value.active)this.remoteTimer=setTimeout(()=>this.show(null),2800);
  }
  async send(){
   if(!this.selected.length||this.running||!this.enabled||!this.canSend())return;
   this.batch={id:crypto.randomUUID().replaceAll('-',''),count:this.selected.length,total:this.selected.reduce((sum,file)=>sum+file.size,0),index:0};
   this.queue=this.selected;this.selected=[];this.reset();await this.next();
  }
  async next(){
   this.running=false;
   if(!this.queue.length){this.batch=null;this.render();return}
   const file=this.queue.shift();this.running=true;this.render();
   try{await this.sendFile(file,{...this.batch,index:++this.batch.index})}catch(error){this.stop();this.error(error.message)}
  }
  stop(){this.queue=[];this.batch=null;this.running=false;this.reset();this.render()}
  dispose(){this.stop();clearTimeout(this.remoteTimer);for(const remove of this.listeners)remove();this.listeners=[]}
 }
 window.BrivanyEdgeSelection=EdgeSelection;
})();
