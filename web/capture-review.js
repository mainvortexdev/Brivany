/* Manual local capture review. No model, microphone or remote request. */
export class CaptureReview {
  constructor(dialog,{request,post,onNotice}){
    this.dialog=dialog;this.request=request;this.post=post;this.onNotice=onNotice;this.generation=0;
    this.$=id=>dialog.querySelector('#'+id);this.busy=false;
    this.$('close-review').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{this.generation++;this.drag=null;});
    dialog.addEventListener('input',()=>this.markDirty());
    this.$('review-frame').addEventListener('change',()=>{this.commit();this.frameId=this.$('review-frame').value;this.selected=null;this.render();});
    this.$('review-object').addEventListener('change',()=>{this.commit();this.selected=this.$('review-object').value || null;const object=this.objects.find(item=>item.id===this.selected);if(object)this.frameId=object.frame_id;this.render();});
    this.$('add-review-object').addEventListener('click',()=>{
      this.commit();if(this.objects.length>=3)return;const id=['object-1','object-2','object-3'].find(value=>!this.objects.some(item=>item.id===value));
      const frame=this.frame();this.objects.push({id,label:'Objeto '+id.slice(-1),frame_id:frame.id,frame_sha256:frame.sha256,rectangle:{x:.2,y:.2,width:.6,height:.6},mask_reviewed:false});this.selected=id;this.markDirty();this.render();
    });
    this.$('remove-review-object').addEventListener('click',()=>{this.objects=this.objects.filter(item=>item.id!==this.selected);this.selected=null;this.markDirty();this.render();});
    for(const key of ['x','y','width','height'])this.$('review-'+key).addEventListener('input',()=>{this.$('review-checked').checked=false;this.paintRectangle();});
    this.$('save-review').addEventListener('click',()=>this.save());
    this.$('prepare-object').addEventListener('click',()=>this.prepare());
    const surface=this.$('review-image-box');
    surface.addEventListener('pointerdown',event=>{if(!this.selected || this.busy || event.button!==0)return;event.preventDefault();this.drag=this.point(event);surface.setPointerCapture(event.pointerId);});
    surface.addEventListener('pointermove',event=>{if(!this.drag)return;this.draw(this.drag,this.point(event));});
    surface.addEventListener('pointerup',event=>{if(!this.drag)return;this.draw(this.drag,this.point(event));this.drag=null;if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);});
    surface.addEventListener('pointercancel',()=>{this.drag=null;});
  }
  frame(){return this.frames.find(item=>item.id===this.frameId) || this.frames[0];}
  point(event){const box=this.$('review-image-box').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-box.x)/box.width)),y:Math.max(0,Math.min(1,(event.clientY-box.y)/box.height))};}
  draw(a,b){for(const [key,value] of Object.entries({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}))this.$('review-'+key).value=(value*100).toFixed(2);this.$('review-checked').checked=false;this.markDirty();this.paintRectangle();}
  markDirty(){if(!this.busy){this.$('review-download').hidden=true;this.$('review-result').textContent='Hay cambios por guardar.';}}
  error(message=''){this.$('review-error').hidden=!message;this.$('review-error').textContent=message;}
  setBusy(value){this.busy=value;for(const control of this.dialog.querySelectorAll('input,select,button:not(#close-review)'))control.disabled=value;if(!value)this.render();}
  rectangle(){return Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(this.$('review-'+key).value)/100]));}
  commit(){const object=this.objects?.find(item=>item.id===this.selected);if(!object)return;object.label=this.$('review-label').value.trim();object.rectangle=this.rectangle();object.mask_reviewed=this.$('review-checked').checked;}
  paintRectangle(){const rectangle=this.rectangle(),box=this.$('review-rectangle');box.hidden=!this.selected;box.style.left=rectangle.x*100+'%';box.style.top=rectangle.y*100+'%';box.style.width=rectangle.width*100+'%';box.style.height=rectangle.height*100+'%';}
  render(){
    if(!this.frames?.length)return;const frame=this.frame();this.$('review-frame').value=frame.id;
    const url=new URL(frame.url,location.origin);if(url.origin!==location.origin || !url.pathname.startsWith('/api/spatial/'))throw Error('El fotograma no es local.');
    this.$('review-image').src=url.href;this.$('review-image').alt='Fotograma '+frame.id;this.$('review-image-box').style.aspectRatio=frame.width+'/'+frame.height;
    const select=this.$('review-object');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Selecciona un objeto';select.append(empty);
    for(const object of this.objects){const option=document.createElement('option');option.value=object.id;option.textContent=object.label;select.append(option);}select.value=this.selected || '';
    const object=this.objects.find(item=>item.id===this.selected);this.$('review-editor').hidden=!object;
    this.$('add-review-object').disabled=this.busy || this.objects.length>=3;this.$('remove-review-object').disabled=this.busy || !object;
    this.$('prepare-object').disabled=this.busy || !object;this.$('review-frame').disabled=this.busy;
    if(object){this.$('review-label').value=object.label;this.$('review-checked').checked=object.mask_reviewed;
      for(const key of ['x','y','width','height'])this.$('review-'+key).value=String(Math.round(object.rectangle[key]*10000)/100);}
    this.paintRectangle();
    const signal=this.review?.quality?.frames?.find(item=>item.frame_id===frame.id),metrics=signal?.metrics;
    this.$('review-quality').textContent=metrics?`Luz ${Math.round(metrics.luma_mean)}/255 · detalle ${Math.round(metrics.laplacian_variance)} · ${signal.review_flags.length?'revisar exposición o contraste':'revisión visual pendiente'}`:'Señales visuales no disponibles. Revisa el fotograma.';
  }
  async open(space){
    const generation=++this.generation;this.captureId=space.capture_id;this.frames=space.frames || [];this.frameId=this.frames[0]?.id;this.selected=null;this.objects=[];this.review=null;
    this.error();this.$('review-result').textContent='';this.$('review-download').hidden=true;this.dialog.showModal();this.setBusy(true);
    try{const review=await this.request('/api/spatial/captures/'+this.captureId+'/review');if(generation!==this.generation)return;
      this.review=review;this.objects=review.objects.map(({id,label,frame_id,frame_sha256,rectangle,mask_reviewed})=>({id,label,frame_id,frame_sha256,rectangle,mask_reviewed}));
      this.$('review-frame').replaceChildren();for(const [index,frame] of this.frames.entries()){const option=document.createElement('option');option.value=frame.id;option.textContent='Vista '+(index+1);this.$('review-frame').append(option);}
      this.$('reference-description').value=review.length_reference?.description || '';this.$('reference-length').value=review.length_reference?.length_m || '';
    }catch(exception){if(generation===this.generation)this.error(exception.message);}finally{if(generation===this.generation)this.setBusy(false);}
  }
  async save(){
    if(this.busy || !this.review)return null;this.commit();this.error();const generation=this.generation,captureId=this.captureId;
    const description=this.$('reference-description').value.trim(),length=this.$('reference-length').value;
    if((description && !length) || (length && !description)){this.error('La referencia necesita una descripción y una longitud.');return null;}
    const reference=description?{description,length_m:Number(length)}:null;this.setBusy(true);
    try{const result=await this.post('/api/spatial/captures/'+captureId+'/review',{expected_revision:this.review.revision,objects:this.objects,length_reference:reference});
      if(generation!==this.generation)return null;this.review=result;this.$('review-result').textContent='Revisión guardada en este equipo.';this.$('review-download').hidden=true;return result;
    }catch(exception){if(generation===this.generation)this.error(exception.status===409?'La revisión cambió o su fuente no coincide. Cierra y vuelve a abrir la captura.':exception.message);return null;}
    finally{if(generation===this.generation)this.setBusy(false);}
  }
  async prepare(){
    if(this.busy)return;const generation=this.generation,objectId=this.selected,result=await this.save();if(!result || generation!==this.generation || !objectId)return;
    this.setBusy(true);this.$('review-result').textContent='Preparando imagen y máscara local…';
    try{const prepared=await this.post('/api/spatial/captures/'+this.captureId+'/prepare',{expected_revision:result.revision,object_id:objectId});if(generation!==this.generation)return;
      this.$('review-result').textContent='Entrada de un objeto preparada. Reconstrucción remota pendiente.';const link=this.$('review-download'),url=new URL(prepared.download_url,location.origin);
      if(url.origin===location.origin && url.pathname.startsWith('/api/spatial/packages/')){link.href=url.href;link.hidden=false;link.download='brivany-objeto.zip';}
      this.onNotice('Paquete local preparado; no se ha ejecutado un modelo.');
    }catch(exception){if(generation===this.generation){this.error(exception.message);this.$('review-result').textContent='No se ejecutó ninguna reconstrucción.';}}
    finally{if(generation===this.generation)this.setBusy(false);}
  }
}
