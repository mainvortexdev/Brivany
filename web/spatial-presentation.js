/** Private authored camera route. It changes views and selection, never geometry. */
export function mountPresentation(container,{api,sceneSnapshot,getCamera,setCamera,onSelect=()=>{}}={}){
  if(!container || [api,sceneSnapshot,getCamera,setCamera].some(value=>typeof value!=='function'))throw Error('Faltan los controles del recorrido.');
  const node=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
  const button=(text,action,primary=false)=>{const item=node('button',text);item.type='button';item.className=primary?'presentation-primary':'presentation-text';item.addEventListener('click',()=>run(action));return item;};
  const field=(parent,label,type,maximum)=>{const wrapper=node('label',label),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.maxLength=maximum;wrapper.append(input);parent.append(wrapper);return input;};
  const heading=node('h3','Cuenta el espacio.'),description=node('p','Guarda vistas y puntos de interés para una visita en este equipo.');description.className='presentation-quiet';
  const notice=node('p');notice.className='presentation-quiet';notice.dataset.presentationNotice='true';notice.setAttribute('role','status');
  const error=node('p');error.className='presentation-error';error.hidden=true;error.setAttribute('role','alert');error.dataset.presentationError='true';
  const controls=node('div');controls.className='presentation-toolbar';
  const start=button('Presentar',()=>enter(),true),save=button('Guardar recorrido',()=>persist()),reload=button('Recargar guardado',()=>refresh({discard:true}));start.dataset.presentationStart='true';save.dataset.presentationSave='true';reload.dataset.presentationReload='true';controls.append(start,save,reload);
  const routeForm=node('form');routeForm.dataset.presentationForm='true';const title=field(routeForm,'Nombre del recorrido','text',120);title.dataset.presentationTitle='true';title.required=true;
  const editor=node('fieldset');editor.className='presentation-point-editor';const legend=node('legend','Punto de interés');editor.append(legend);routeForm.append(editor);
  const label=field(editor,'Nombre de la vista','text',120);label.dataset.presentationLabel='true';label.required=true;
  const note=field(editor,'Qué quieres destacar','textarea',1000);note.dataset.presentationNote='true';
  const association=node('label','Objeto relacionado'),object=node('select');object.dataset.presentationObject='true';association.append(object);editor.append(association);
  const editorActions=node('div');editorActions.className='presentation-toolbar';const add=node('button','Añadir vista actual');add.type='submit';add.className='presentation-secondary';add.dataset.presentationAdd='true';const cancelEdit=button('Nueva vista',()=>resetEditor());cancelEdit.hidden=true;cancelEdit.dataset.presentationNew='true';editorActions.append(add,cancelEdit);editor.append(editorActions);
  const points=node('ol');points.className='presentation-points';points.dataset.presentationPoints='true';
  const stage=node('div');stage.className='presentation-stage';stage.hidden=true;stage.dataset.presentationStage='true';
  const stageCounter=node('p');stageCounter.className='presentation-quiet';stageCounter.dataset.presentationCounter='true';const stageTitle=node('h3');stageTitle.dataset.presentationStageTitle='true';const stageNote=node('p');stageNote.dataset.presentationStageNote='true';
  const navigation=node('div');navigation.className='presentation-toolbar';const previous=button('Anterior',()=>step(-1)),next=button('Siguiente',()=>step(1)),exit=button('Salir de presentación',()=>leave());previous.dataset.presentationPrevious='true';next.dataset.presentationNext='true';exit.dataset.presentationExit='true';navigation.append(previous,next,exit);stage.append(stageCounter,stageTitle,stageNote,navigation);
  container.classList.add('spatial-presentation');container.replaceChildren(heading,description,notice,error,controls,routeForm,points,stage);
  let current=null,config={title:'Recorrido del espacio',points:[]},revision=0,boundRevision=null,editing=null,dirty=false,busy=false,active=false,index=0,disposed=false,generation=0;
  const message=text=>{notice.textContent=text;};
  const snapshot=()=>{const value=sceneSnapshot(),id=value?.scene?.scene_id || value?.scene?.id,revision=value?.source==='portable_project'?value.scene_revision:value?.revision;return id && Number.isInteger(revision)?{id,revision,objects:value.scene.objects || []}:null;};
  const clone=value=>JSON.parse(JSON.stringify(value));
  function mark(){dirty=true;save.disabled=false;container.dataset.presentationDirty='true';message('Cambios sin guardar.');}
  async function run(action){if(busy || disposed)return;busy=true;error.hidden=true;try{await action();}catch(exception){error.textContent=exception.message || 'No se pudo cambiar el recorrido.';error.hidden=false;}finally{busy=false;}}
  function resetEditor(){editing=null;label.value='';note.value='';object.value='';add.textContent='Añadir vista actual';add.disabled=config.points.length>=12;cancelEdit.hidden=true;}
  function renderObjects(){const chosen=object.value;object.replaceChildren();const empty=node('option','Sin objeto relacionado');empty.value='';object.append(empty);for(const item of current?.objects || []){const option=node('option',item.label);option.value=item.id;object.append(option);}object.value=chosen;}
  function modeEvent(){container.dataset.presentationActive=String(active);container.dispatchEvent(new CustomEvent('presentation-mode',{bubbles:true,detail:{active}}));}
  function show(point){setCamera(clone(point.camera));onSelect(point.object_id || null);}
  function render(){
    points.replaceChildren();start.disabled=!current || !config.points.length;save.disabled=!current || !dirty;reload.disabled=!current;routeForm.hidden=active;points.hidden=active;save.hidden=active;reload.hidden=active;start.hidden=active;stage.hidden=!active;
    if(!current){message('Abre un espacio 3D para preparar su visita.');routeForm.hidden=true;return;}
    if(!config.points.length)points.append(node('li','Elige una vista y añade tu primer punto.'));
    config.points.forEach((point,position)=>{const row=node('li');row.dataset.presentationPointId=point.id;const titleButton=button((position+1)+'. '+point.label,()=>show(point));titleButton.className='presentation-point-title';row.append(titleButton);if(point.note){const copy=node('p',point.note);copy.className='presentation-quiet';row.append(copy);}const actions=node('div');actions.className='presentation-toolbar';actions.append(button('Editar',()=>{editing=point.id;label.value=point.label;note.value=point.note;object.value=point.object_id || '';add.textContent='Guardar texto del punto';cancelEdit.hidden=false;label.focus();}),button('Usar vista actual',()=>{point.camera=clone(getCamera());mark();render();}));const up=button('Subir',()=>{[config.points[position-1],config.points[position]]=[point,config.points[position-1]];mark();render();}),down=button('Bajar',()=>{[config.points[position+1],config.points[position]]=[point,config.points[position+1]];mark();render();});up.disabled=position===0;down.disabled=position===config.points.length-1;actions.append(up,down,button('Eliminar',()=>{config.points.splice(position,1);if(editing===point.id)resetEditor();mark();render();}));row.append(actions);points.append(row);});
    add.disabled=config.points.length>=12 && !editing;
    if(active){const point=config.points[index];stageCounter.textContent=(index+1)+' / '+config.points.length;stageTitle.textContent=point.label;stageNote.textContent=point.note;previous.disabled=index===0;next.disabled=index===config.points.length-1;}
  }
  function enter(){if(!config.points.length || !current)return;active=true;index=0;modeEvent();show(config.points[index]);render();message(dirty?'Vista previa de cambios sin guardar.':'Presentación local · usa Anterior y Siguiente.');}
  function leave(){if(!active)return;active=false;modeEvent();render();message(dirty?'Cambios sin guardar.':'Recorrido local.');}
  function step(direction){if(!active)return;index=Math.max(0,Math.min(config.points.length-1,index+direction));show(config.points[index]);render();}
  async function refresh({discard=false}={}){
    const observed=snapshot(),request=++generation;if(!observed){leave();current=null;render();return;}
    let result;
    try{result=await api('/api/spatial/scenes/'+observed.id+'/presentation');}
    catch(exception){if(disposed || request!==generation)return;leave();current=null;render();error.textContent=exception.message || 'No se pudo cargar el recorrido. Puedes seguir explorando el espacio.';error.hidden=false;message('Recorrido no disponible. El visor sigue disponible.');return;}
    if(disposed || request!==generation)return;error.hidden=true;
    const sceneChanged=current?.id!==observed.id;if(sceneChanged){leave();dirty=false;resetEditor();}
    current=observed;renderObjects();
    if(dirty && !discard && !sceneChanged){render();message('Conservamos tus cambios sin guardar. Recarga lo guardado para descartarlos.');return;}
    leave();config=clone(result.config);revision=result.revision;boundRevision=result.scene_revision;title.value=config.title;dirty=false;container.dataset.presentationDirty='false';resetEditor();render();message(result.needs_scene_review?'El espacio cambió desde la última visita guardada. Revisa las vistas y vuelve a guardar.':result.persisted?'Recorrido guardado en este equipo.':'Hasta 12 puntos. Sólo se guardan cuando lo indicas.');
  }
  async function persist(){if(!current)return;const observed=snapshot();if(!observed || observed.id!==current.id || observed.revision!==boundRevision)throw Error('El espacio cambió. Recarga el recorrido y revisa las vistas antes de guardar.');const result=await api('/api/spatial/scenes/'+current.id+'/presentation',{expected_revision:revision,expected_scene_revision:boundRevision,config});config=clone(result.config);revision=result.revision;boundRevision=result.scene_revision;dirty=false;container.dataset.presentationDirty='false';render();message('Recorrido guardado en este equipo.');}
  title.addEventListener('input',()=>{config.title=title.value;mark();});
  routeForm.addEventListener('submit',event=>{event.preventDefault();run(async()=>{const values={label:label.value.trim(),note:note.value.trim(),object_id:object.value || null};if(!values.label)throw Error('Escribe un nombre para la vista.');if(editing){const point=config.points.find(point=>point.id===editing);if(!point)throw Error('El punto cambió.');Object.assign(point,values);}else{if(config.points.length>=12)throw Error('El recorrido admite hasta 12 puntos.');config.points.push({id:crypto.randomUUID(),...values,camera:clone(getCamera())});}resetEditor();mark();render();});});
  const keydown=event=>{if(!active || event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;if(['Escape','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();if(event.key==='Escape')leave();else step(event.key==='ArrowLeft'?-1:1);}};
  window.addEventListener('keydown',keydown);
  function dispose(){disposed=true;++generation;leave();window.removeEventListener('keydown',keydown);}
  render();return {refresh,dispose};
}
