/* Local result publication only. This view cannot dispatch or poll a GPU job. */
export class ReconstructionResults {
  constructor(container,{request,post,onOpen,onNotice}) {
    this.container=container;this.request=request;this.post=post;this.onOpen=onOpen;this.onNotice=onNotice;
    this.button=container.querySelector('button');this.list=container.querySelector('[data-results]');this.status=container.querySelector('[role=status]');this.generation=0;
    this.button.addEventListener('click',()=>this.refresh());
  }
  setCapture(captureId) {
    if(this.captureId===captureId)return;
    this.captureId=captureId;++this.generation;this.list.replaceChildren();this.status.textContent='';this.button.disabled=false;this.container.hidden=!captureId;
  }
  async refresh() {
    if(!this.captureId || this.button.disabled)return;
    const generation=this.generation;this.button.disabled=true;this.status.textContent='Consultando resultados locales…';
    try {
      const base='/api/spatial/captures/'+this.captureId;
      // A missing or invalid result in one pipeline must not hide the other.
      // These reads only consult saved local receipts; they never dispatch work.
      const results=await Promise.allSettled([this.request(base+'/results'),this.request(base+'/room-results')]);
      if(generation!==this.generation)return;
      const items=results.flatMap((result,index)=>result.status==='fulfilled'?(result.value.items || []).map(item=>({...item,kind:index===1?'room':'object'})):[]);
      const unavailable=results.filter(result=>result.status==='rejected').length;
      this.list.replaceChildren();
      for(const item of items) {
        const row=document.createElement('div'),label=document.createElement('p');row.className='reconstruction-result';
        const room=item.kind==='room';row.dataset.resultKind=item.kind;
        label.textContent=item.title || (room?'Superficie multivista':'Objeto reconstruido');row.append(label);
        const detail=document.createElement('small');detail.textContent=item.eligible_for_import!==true?'Resultado pendiente de verificación local.':room?'Superficie parcial · escala, cobertura y objetos sin verificar':'Objeto único · escala y fidelidad sin verificar';row.append(detail);
        if(item.eligible_for_import===true && /^[0-9a-f-]{36}$/.test(item.job_id)) {
          const action=document.createElement('button');action.className='secondary';action.type='button';action.textContent=item.imported?(room?'Abrir superficie ↗':'Abrir objeto ↗'):'Añadir al visor →';
          action.addEventListener('click',()=>this.importItem(item,action,generation));row.append(action);
        }
        this.list.append(row);
      }
      this.status.textContent=unavailable?'Una consulta no está disponible. Puedes usar los resultados mostrados.':items.length?'Resultados guardados en este equipo.':'Aún no hay resultados de reconstrucción.';
    } catch(error) {if(generation===this.generation)this.status.textContent=error.message;}
    finally {if(generation===this.generation)this.button.disabled=false;}
  }
  async importItem(item,button,generation) {
    if(generation!==this.generation || button.disabled)return;button.disabled=true;
    try {
      // Re-import validates the durable receipt and source again, including for
      // already published objects, without overwriting their saved edits.
      const room=item.kind==='room',payload={expected_source_sha256:item.source_sha256,expected_artifact_sha256:item.artifact_sha256};
      if(room)payload.expected_surface_sha256=item.surface_sha256;
      const result=await this.post('/api/spatial/'+(room?'room-dispatch/':'dispatch/')+item.job_id+'/import',payload);
      if(generation!==this.generation)return;
      this.onNotice(room?'Superficie disponible. Revisa cámaras, huecos y escala frente a la captura.':'Objeto disponible. Revisa su orientación y fidelidad frente a la captura.');
      await this.onOpen(result.space.id);
    } catch(error) {if(generation===this.generation)this.status.textContent=error.message;}
    finally {if(generation===this.generation)button.disabled=false;}
  }
}
