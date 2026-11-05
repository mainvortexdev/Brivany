import {SpatialViewer} from './spatial-viewer.js';
import {CaptureReview} from './capture-review.js';
import {SpatialCamera} from './spatial-camera.js';
import {desktopAvailable,desktopCall} from './desktop-client.js';
import {FloorPlan} from './floorplan.js';
import {ReconstructionResults} from './reconstruction-results.js';
import {mountPresentation} from './spatial-presentation.js';
import {mountSpatialAssistant} from './spatial-assistant.js';
import {roomCameraPresets,capturedRoomColors} from './room-view.js';

const $=id=>document.getElementById(id);
let library=[],activeSpace=null,scenePayload=null,selectedId=null,viewer=null,loadId=0,pollTimer=null,activeJob=null,saving=false,physicsActive=false,physicsLoading=false,physicsObjectId=null,presentationActive=false;
let floorPlan=null,planDocument=null,viewKind='3d',planGeneration=0,planBusy=false,planReferences=[],planPoints=[],planSettingsRevision=0,planConfig={references:[],annotations:[],uncertainty_zones:[],cut_height:1.0};
let sceneLoading=false,sceneLoadFailed=false,viewerLoadId=null;
const runningStates=new Set(['queued','running','preparing','cancelling']);
const statusNames={ready:'Demostración · 3D',capture_prepared:'Captura preparada',prepared_not_reconstructed:'Captura preparada',preparing:'Preparando captura',queued:'En cola',running:'Preparando',cancelling:'Cancelando',cancelled:'Cancelado',failed:'Revisar captura',interrupted:'Trabajo interrumpido'};

function error(message){$('spatial-error').hidden=!message;$('spatial-error').textContent=message || '';}
function notice(message){$('spatial-status').textContent=message;}
function dialogError(message){$('dialog-error').hidden=!message;$('dialog-error').textContent=message || '';}
async function request(url,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(url,{cache:'no-store',...options,signal:controller.signal});let value;
    try{value=await response.json();}catch{throw Error('El servidor local no devolvió una respuesta válida.');}
    if(!response.ok){const exception=Error(value.error?.message || 'No se pudo completar la acción local.');exception.status=response.status;throw exception;}
    return value;
  }catch(exception){if(exception.name==='AbortError')throw Error('La solicitud local tardó demasiado. Puedes volver a intentarlo.');throw exception;}
  finally{clearTimeout(timer);}
}
const post=(url,value)=>request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const captureReview=new CaptureReview($('capture-review-dialog'),{request,post,onNotice:notice});
const reconstructionResults=new ReconstructionResults($('reconstruction-results'),{request,post,onNotice:notice,onOpen:async id=>{await refresh();await openSpace(id);}});
async function presentationApi(url,value){
  if(scenePayload?.source!=='portable_project')return value===undefined?request(url):post(url,value);
  const expected=scenePayload.revision;
  if(value===undefined){const result=await desktopCall('get_presentation',expected);return result.presentation;}
  const result=await desktopCall('save_presentation',expected,value.config);applySceneMetadata(result.project);return result.presentation;
}
const presentation=mountPresentation($('spatial-presentation'),{api:presentationApi,sceneSnapshot:()=>!sceneLoading && !sceneLoadFailed?scenePayload:null,getCamera:()=>viewer?.cameraPose(),setCamera:pose=>viewer?.setCameraPose(pose),onSelect:id=>viewer?.select(id)});
const spatialAssistant=mountSpatialAssistant($('spatial-assistant'),{request,post,getScene:()=>scenePayload && !presentationActive && !sceneLoading && !sceneLoadFailed?{scene_id:scenePayload.scene.scene_id,revision:scenePayload.revision,object_id:selectedId,portable:scenePayload.source==='portable_project'}:null,onAction:async result=>{
  if(!scenePayload || sceneLoading || sceneLoadFailed || presentationActive || result.action?.scene_id!==scenePayload.scene.scene_id)return;
  if(result.action.kind==='scene_updated' && result.scene){acceptScene(result.scene);await presentation.refresh();notice('Movimiento aplicado. Puedes deshacerlo.');}
  else if(['select','focus'].includes(result.action.kind)){viewer?.select(result.action.object_id);if(result.action.kind==='focus')viewer?.focusSelected();}
}});
$('spatial-presentation').addEventListener('presentation-mode',event=>{
  presentationActive=event.detail.active;if(presentationActive){stopPhysicsPreview();setMode('explore');spatialAssistant.stop();}
  viewer?.setSaving(saving || presentationActive || sceneLoading || sceneLoadFailed);$('spatial-assistant').inert=presentationActive || sceneLoading || sceneLoadFailed;updateSceneActions();updatePhysicsActions();if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));
});
const spatialCamera=new SpatialCamera($('camera-dialog'),{upload:blob=>request('/api/spatial/captures',{method:'POST',headers:{'Content-Type':'video/mp4','X-Filename':'captura.mp4'},body:blob}),onPrepared:async result=>{
  $('new-space-dialog').close();await refresh();await openSpace(unwrapSpace(result).id);
}});
$('open-camera').addEventListener('click',()=>spatialCamera.open());
$('open-capture-review').addEventListener('click',()=>{if(activeSpace?.capture_id)captureReview.open(activeSpace);});
const unwrapSpace=value=>{const space=value.space || value;return {...space,job_id:space.job_id || space.job?.id || null};};
function setSaveState(message,state='saved'){$('save-state').textContent=message;$('save-state').dataset.state=state;}
function sceneMessage(message){stopPhysicsPreview();sceneLoading=false;sceneLoadFailed=true;viewerLoadId=null;clearLoadProgress('error');setSaveState('Revisar carga','error');$('viewport-loading').hidden=true;$('viewport-error').hidden=false;$('viewport-error-message').textContent=message;$('viewport-controls').hidden=true;updateSceneActions();updatePhysicsActions();if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));}
function showLoading(){error('');$('viewport-error').hidden=true;$('capture-panel').hidden=true;$('viewport-loading').hidden=false;$('viewport-controls').hidden=true;}
function clearLoadProgress(phase='idle'){
  $('viewport-progress').hidden=true;$('viewport-shell').dataset.loadPhase=phase;
  $('viewport-shell').setAttribute('aria-busy','false');$('spatial-canvas').setAttribute('aria-busy','false');
}
function beginSceneLoad(){
  const current=++loadId;viewerLoadId=null;viewer?.cancelLoad();sceneLoading=true;sceneLoadFailed=false;
  clearLoadProgress('loading');$('viewport-shell').setAttribute('aria-busy','true');$('spatial-canvas').setAttribute('aria-busy','true');
  $('viewport-progress-bar').value=0;$('viewport-progress-text').textContent='Cargando…';return current;
}
function handleLoadProgress(event){
  if(viewerLoadId!==loadId || viewerLoadId===null)return;
  const active=['loading','partial'].includes(event.phase);sceneLoading=active;
  $('viewport-shell').dataset.loadPhase=event.phase;$('viewport-shell').setAttribute('aria-busy',String(active));$('spatial-canvas').setAttribute('aria-busy',String(active));
  const bar=$('viewport-progress-bar');bar.max=Math.max(1,event.totalAssets);bar.value=event.loadedAssets;
  bar.setAttribute('aria-valuetext',`${event.loadedAssets} de ${event.totalAssets} recursos; ${event.loadedObjects} de ${event.totalObjects} objetos`);
  $('viewport-progress-text').textContent=`Cargando · ${event.loadedAssets}/${event.totalAssets} recursos`;$('viewport-progress').hidden=event.phase!=='partial';
  if(event.phase==='partial'){$('viewport-loading').hidden=true;$('viewport-controls').hidden=false;setSaveState('Cargando…','loading');}
  if(event.phase==='error' || event.phase==='cancelled'){sceneLoadFailed=true;setSaveState(event.phase==='error'?'Carga incompleta':'Carga cancelada','error');}
  viewer?.setSaving(saving || presentationActive || sceneLoading || sceneLoadFailed);updateSceneActions();updatePhysicsActions();
  if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));
}
function symbol(object){const text=(object.label || '').toLowerCase();return object.role==='environment'?'⌑':/sill|sof|chair|butac/.test(text)?'▱':/mesa|table/.test(text)?'⊞':/lámp|lamp/.test(text)?'⌁':'◇';}
function updateLibrary(){
  $('space-list').replaceChildren();
  if(!library.length){const empty=document.createElement('p');empty.className='subtle';empty.textContent='Tus espacios aparecerán aquí.';$('space-list').append(empty);return;}
  for(const space of library){
    const button=document.createElement('button');button.type='button';button.className='space-item';button.dataset.spaceId=space.id;
    button.setAttribute('aria-current',String(activeSpace?.id===space.id));
    const icon=document.createElement('span');icon.className='space-symbol';icon.setAttribute('aria-hidden','true');icon.textContent=space.scene_id?'◇':'▧';
    const label=document.createElement('span'),title=document.createElement('strong'),subtitle=document.createElement('small');
    title.textContent=space.title;subtitle.textContent=space.origin==='reference_interpretation'?'Interpretación · 3D':space.origin==='room_reconstruction'?'Multivista · por revisar':space.origin==='capture_reconstruction'?'Reconstrucción · por revisar':statusNames[space.status] || (space.scene_id?'Vista 3D':'Preparando');
    label.append(title,subtitle);button.append(icon,label);button.addEventListener('click',()=>openSpace(space.id));$('space-list').append(button);
  }
}
async function refresh({select=false}={}){
  const result=await request('/api/spatial/spaces');library=(result.spaces || []).map(unwrapSpace);updateLibrary();
  if(select){const requested=new URLSearchParams(location.search).get('space');const first=library.find(item=>item.id===requested) || library.find(item=>item.scene_id) || library[0];
    if(first)await openSpace(first.id);else{$('viewport-loading').hidden=true;sceneMessage('Crea una demostración o prepara una captura con Nuevo espacio.');$('viewport-error-title').textContent='Un espacio para comenzar.';}}
}
function clearSelection(){selectedId=null;floorPlan?.select(null);$('selection-panel').hidden=true;for(const id of ['mode-move','mode-rotate','apply-position'])$(id).disabled=true;}
function syncObjectList(){
  const objects=scenePayload?.scene.objects || [];$('object-list').replaceChildren();$('object-count').textContent=String(objects.length);
  for(const object of objects){const button=document.createElement('button');button.type='button';button.className='object-button';button.dataset.objectId=object.id;button.setAttribute('aria-pressed',String(object.id===selectedId));
    const icon=document.createElement('span');icon.className='object-icon';icon.textContent=symbol(object);icon.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.textContent=object.label;button.append(icon,title);
    if(object.editable!==true){const lock=document.createElement('span');lock.className='lock-icon';lock.textContent='FIJO';button.append(lock);}
    button.addEventListener('click',()=>viewer?viewer.select(object.id):selectObject(object.id,object));$('object-list').append(button);
  }
}
function selectObject(id,object){
  selectedId=id;floorPlan?.select(id);syncObjectList();updatePhysicsActions();$('selection-panel').hidden=!object;
  spatialAssistant.contextChanged();
  const editable=object?.editable===true && !saving && !sceneLoading && !sceneLoadFailed && !presentationActive && !physicsActive && !physicsLoading && Boolean(viewer) && !viewer.contextUnavailable;
  for(const control of ['mode-move','mode-rotate','apply-position'])$(control).disabled=!editable;
  if(viewKind==='plan'){ $('mode-move').disabled=true;$('mode-rotate').disabled=true; }
  if(!object){setMode('explore');return;}
  $('selected-label').textContent=object.label;$('selected-lock').textContent=object.editable!==true?'Fijo':sceneLoading?'Cargando':sceneLoadFailed || viewer?.contextUnavailable?'Recuperar visor':!viewer?'Vista textual':saving?'Guardando':'Editable';
  const asset=scenePayload.scene.assets.find(item=>item.id===object.asset_id);
  $('selected-note').textContent=asset?.note || 'Geometría de la escena; procedencia en sus detalles.';
  $('transform-fields').hidden=object.editable!==true || !viewer || sceneLoading || sceneLoadFailed || viewer.contextUnavailable;fillPosition(viewer?.transformOf(id) || object.transform);
  if(object.editable!==true)setMode('explore');
}
function fillPosition(transform){if(!transform)return;for(const [index,axis] of ['x','y','z'].entries())$('position-'+axis).value=String(Math.round(transform.position[index]*1000)/1000);}
function renderMetrics(){if(!viewer || viewer.contextUnavailable)return;const stats=viewer.renderStats();$('render-metrics').textContent=`${stats.profile} · ${stats.drawCalls} llamadas de dibujo · ${stats.triangles.toLocaleString()} triángulos. Tiempo CPU de envío: ${stats.cpuSubmissionP50Ms?.toFixed(1) || '—'} ms; GPU no medida.`;}
function configureRenderUI(payload){
  $('camera-preset').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Vista libre';$('camera-preset').append(empty);
  const room=payload.scene?.origin==='room_reconstruction',presets=room?roomCameraPresets(payload.scene):payload.render_config?.camera_presets || [];
  for(const preset of presets){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.label;$('camera-preset').append(option);}
  $('camera-preset').value=room?'':presets[0]?.id || '';
  $('camera-preset').title=room?'Cámaras inferidas; encuadre aproximado, sin ajuste exacto a la fotografía.':'';
  $('daylight').disabled=capturedRoomColors(payload.scene);$('daylight').title=room?'Los colores conservan la luz de la captura.':'';
  const sourceFrames=payload.source_views?.frames || payload.references?.frames || [];
  $('view-references').hidden=!sourceFrames.some(frame=>frame.url);$('view-references').textContent=room?'Ver fotogramas de captura ↗':'Ver imágenes de referencia ↗';
}
function updatePhysicsActions(){const object=scenePayload?.scene.objects.find(item=>item.id===selectedId);
  $('physics-start').disabled=presentationActive || sceneLoading || sceneLoadFailed || viewKind==='plan' || saving || physicsLoading || physicsActive || !viewer || viewer.contextUnavailable || object?.editable!==true || selectedId==='rug';
  $('physics-pause').disabled=!physicsActive;$('physics-drop').disabled=!physicsActive;$('physics-stop').disabled=!physicsActive && !physicsLoading;
}
function stopPhysicsPreview(){if(!physicsActive && !physicsLoading)return;physicsActive=false;physicsLoading=false;physicsObjectId=null;viewer?.resetPhysics();viewer?.setSaving(saving || presentationActive || sceneLoading || sceneLoadFailed);updateSceneActions();updatePhysicsActions();$('physics-pause').textContent='Pausar';$('physics-status').textContent='Vista previa cerrada. Distribución guardada conservada.';}
$('render-quality').addEventListener('change',()=>{try{viewer?.setQuality($('render-quality').value);renderMetrics();}catch(exception){error(exception.message);}});
$('camera-preset').addEventListener('change',()=>{viewer?.setCameraPreset($('camera-preset').value);renderMetrics();});
$('daylight').addEventListener('input',()=>{viewer?.setDaylight(Number($('daylight').value));renderMetrics();});
$('view-references').addEventListener('click',()=>{const gallery=$('reference-gallery');gallery.replaceChildren();const source=scenePayload?.source_views,frames=source?.frames || scenePayload?.references?.frames || [];
  $('reference-title').textContent=source?'La captura de origen.':'Las vistas de origen.';
  $('reference-dialog').querySelector('.dialog-intro').textContent=source?'Fotogramas que apoyan esta superficie. Cámaras y encuadre estimados; compara huecos y geometría antes de medir.':'La escena es una interpretación manual. Cámaras, escala y coherencia multivista siguen sin verificar.';
  for(const frame of frames){const url=new URL(frame.url,location.origin);if(url.origin!==location.origin || !url.pathname.startsWith('/api/spatial/'))continue;
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=url.href;img.alt=frame.label || frame.id;img.loading='lazy';
    caption.textContent=source?`${frame.id} · captura ${frame.at_seconds.toFixed(1)} s · cámara estimada, encuadre sin alinear`:`${frame.label || frame.id} · referencia ${frame.width} × ${frame.height}`;
    figure.append(img,caption);gallery.append(figure);}$('reference-dialog').showModal();});
$('close-references').addEventListener('click',()=>$('reference-dialog').close());
$('physics-start').addEventListener('click',async()=>{
  if(!viewer || saving || sceneLoading || sceneLoadFailed || physicsActive || physicsLoading || !selectedId)return;const current=loadId,id=selectedId;physicsLoading=true;updateSceneActions();updatePhysicsActions();$('physics-status').textContent='Preparando simulación local…';
  try{const {SpatialPhysics}=await import('./spatial-physics.js');if(current!==loadId || !physicsLoading)return;const spec=viewer.physicsSpec(id,Number($('physics-mass').value),Number($('physics-friction').value));
    const engine=await SpatialPhysics.create(spec);if(current!==loadId || !physicsLoading){engine.dispose();return;}viewer.physics=engine;physicsActive=true;physicsLoading=false;physicsObjectId=id;viewer.setSaving(true);setMode('explore');engine.start();
    $('physics-status').textContent='Física experimental · escala, masa y fricción asumidas. No se guardan cambios.';updateSceneActions();updatePhysicsActions();selectObject(selectedId,scenePayload.scene.objects.find(item=>item.id===selectedId));
  }catch(exception){stopPhysicsPreview();error(exception.message);}
});
$('physics-pause').addEventListener('click',()=>{if(!physicsActive || !viewer?.physics)return;if(viewer.physics.running){viewer.physics.pause();$('physics-pause').textContent='Continuar';}else{viewer.physics.start();$('physics-pause').textContent='Pausar';}});
$('physics-drop').addEventListener('click',()=>{try{if(physicsActive){viewer.physics.liftDrop(physicsObjectId,.6);viewer.applyPhysics(viewer.physics.snapshot());viewer.physics.start();$('physics-pause').textContent='Pausar';}}catch(exception){error(exception.message);}});
$('physics-stop').addEventListener('click',()=>{stopPhysicsPreview();if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));});
$('spatial-canvas').addEventListener('spatial-physics-tick',event=>{const state=event.detail;$('physics-status').textContent=state.halted?'Simulación detenida por límites. Sal de la vista previa.':`Vista previa · ${state.steps} pasos · ${state.contacts.length} contactos · ${state.sleepingBodies} en reposo. Valores asumidos.`;renderMetrics();});
function setMode(mode){if(mode!=='explore' && (!selectedId || saving || sceneLoading || sceneLoadFailed || presentationActive || viewKind==='plan'))return;viewer?.setMode(mode);for(const item of ['explore','move','rotate'])$('mode-'+item).setAttribute('aria-pressed',String(item===mode));
  $('viewport-hint').textContent=mode==='explore'?'Arrastra para orbitar · Desplaza para acercar':mode==='move'?'Arrastra un eje · Los cambios se guardan al soltar':'Arrastra un arco · Los cambios se guardan al soltar';}
function ensureViewer(){if(viewer?.contextUnavailable){viewer.dispose();viewer=null;}if(!viewer)viewer=new SpatialViewer($('spatial-canvas'),{onSelect:selectObject,onTransform:saveTransform,onError:sceneMessage,onProgress:handleLoadProgress});return viewer;}
async function openPortable(payload){
  spatialAssistant.stop();
  reconstructionResults.setCapture(null);
  stopPhysicsPreview();resetPlan();const current=beginSceneLoad();clearTimeout(pollTimer);activeJob=null;activeSpace=null;clearSelection();scenePayload=null;updateSceneActions();showLoading();setSaveState('Abriendo carpeta…','loading');await presentation.refresh();if(current!==loadId)return;
  try{applySceneMetadata(payload);$('space-title').textContent=payload.project?.title || payload.scene.title;updateLibrary();syncObjectList();viewerLoadId=current;const loaded=await ensureViewer().load(payload);if(current!==loadId)return;
    if(loaded?.cancelled || viewer.contextUnavailable || viewer.loading)throw Error('La carga del espacio no terminó. Vuelve a cargar el visor.');sceneLoading=false;sceneLoadFailed=false;clearLoadProgress('ready');updateSceneActions();updatePhysicsActions();
    $('viewport-loading').hidden=true;$('viewport-controls').hidden=false;$('capture-panel').hidden=true;setMode('explore');renderMetrics();
    await presentation.refresh();if(current!==loadId)return;setSaveState('Carpeta del ordenador');spatialAssistant.contextChanged();notice('Proyecto portátil abierto. Las ediciones se guardan en su carpeta; asistencia contextual y recorridos portátiles pendientes.');
  }catch(exception){if(current===loadId){sceneMessage(exception.message);error(exception.message);}}
}
let desktopPreparing=false,desktopPrepared=false;
async function prepareDesktop(){if(!desktopAvailable() || desktopPreparing || desktopPrepared)return;desktopPreparing=true;$('desktop-project-actions').hidden=false;try{const state=await desktopCall('status');if(state.project)await openPortable(state.project);desktopPrepared=true;}catch(exception){error(exception.message);}finally{desktopPreparing=false;}}
window.addEventListener('pywebviewready',()=>initialLibrary.then(prepareDesktop));
$('desktop-open').addEventListener('click',async()=>{if(saving || physicsActive || physicsLoading)return;try{const result=await desktopCall('pick_project_folder');if(result.project)await openPortable(result.project);}catch(exception){error(exception.message);}});
$('desktop-save').addEventListener('click',async()=>{if(saving || sceneLoading || sceneLoadFailed || physicsActive || physicsLoading || !scenePayload || scenePayload.source==='portable_project')return;try{const result=await desktopCall('save_current_project',scenePayload.scene.scene_id);if(result.project)await openPortable(result.project);}catch(exception){error(exception.message);}});
function applySceneMetadata(payload){
  scenePayload=payload;const scene=payload.scene;
  const interpretation=scene.origin==='reference_interpretation',generated=scene.origin==='generated_demo',room=scene.origin==='room_reconstruction';
  $('space-origin').hidden=!generated && !interpretation && !room;$('space-origin').textContent=room?'Multivista · sin verificar':interpretation?'Interpretación manual':'Demostración';$('detail-origin').textContent=room?'Superficie multivista · cámaras inferidas':interpretation?'Referencias · interpretación':generated?'Generado localmente':'Reconstrucción por revisar';
  $('scene-label').textContent=interpretation?'INTERIOR · REFERENCIAS':generated?'DEMO · ESTUDIO':'VISTA ESPACIAL';$('detail-scale').textContent=scene.units==='meters'?'Escala documentada':'Sin verificar';
  $('space-description').textContent=room?'Superficie parcial · cámaras estimadas y colores de captura.':interpretation?'Interpretación 3D de tus imágenes · geometría sin verificar.':generated?'Escena de demostración. Explora, selecciona y organiza.':'Vista preliminar · revisa procedencia y escala.';
  $('scene-limitations').textContent=(scene.limitations || []).join(' ');configureRenderUI(payload);updateSceneActions();
}
function updateSceneActions(){
  const available=Boolean(scenePayload) && !sceneLoading && !sceneLoadFailed && !presentationActive && !saving && !physicsActive && !physicsLoading;
  const portable=scenePayload?.source==='portable_project';
  $('undo-edit').disabled=!available || scenePayload?.history?.can_undo!==true;$('redo-edit').disabled=!available || scenePayload?.history?.can_redo!==true;
  $('restore-layout').disabled=!available || portable;$('save-layout').disabled=!available || portable;$('export-space').disabled=!available || (portable?!desktopAvailable():typeof scenePayload?.export_url!=='string');
  const selected=$('layout-select').value,layouts=Array.isArray(scenePayload?.layouts)?scenePayload.layouts:[];
  $('layout-select').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=layouts.length?'Elige una variante':'Sin variantes guardadas';$('layout-select').append(placeholder);
  for(const layout of layouts){const option=document.createElement('option');option.value=layout.id;option.textContent=layout.name;$('layout-select').append(option);}
  if(layouts.some(item=>item.id===selected))$('layout-select').value=selected;
  $('layout-select').disabled=!available || portable || !layouts.length;$('apply-layout').disabled=!available || portable || !$('layout-select').value;$('retry-viewer').disabled=saving;
  if($('desktop-save'))$('desktop-save').disabled=!available || portable;
  $('presentation-load-gate').disabled=!available;$('spatial-presentation').inert=sceneLoading || sceneLoadFailed || !scenePayload;
  $('spatial-assistant').inert=presentationActive || sceneLoading || sceneLoadFailed || !scenePayload;
  updatePlanActions();
}
function acceptScene(payload){
  applySceneMetadata(payload);for(const object of payload.scene.objects)viewer?.setTransform(object.id,object.transform);
  const object=payload.scene.objects.find(item=>item.id===selectedId);if(object)selectObject(selectedId,object);else clearSelection();
  syncObjectList();planDocument=null;if(viewKind==='plan')loadPlan();
}
function busyScene(value){saving=value;viewer?.setSaving(value || presentationActive || sceneLoading || sceneLoadFailed);updateSceneActions();if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));if(!value && viewKind==='plan' && !planDocument && scenePayload && !sceneLoading && !sceneLoadFailed)loadPlan();}
async function sceneAction(action,body={},success='Cambio guardado en este equipo.'){
  if(presentationActive || saving || sceneLoading || sceneLoadFailed || physicsActive || physicsLoading || !scenePayload)return null;const current=loadId,scene=scenePayload;busyScene(true);setSaveState('Guardando…','saving');error('');
  try{const result=await post('/api/spatial/scenes/'+scene.scene.scene_id+'/'+action,{expected_revision:scene.revision,...body});
    if(current!==loadId)return null;const payload=result.scene?result:await request('/api/spatial/scenes/'+scene.scene.scene_id);if(current!==loadId)return null;
    acceptScene(payload);setSaveState('Guardado localmente');notice(success);return result;
  }catch(exception){if(current===loadId){setSaveState('No guardado','error');error(exception.status===409?'El espacio cambió en otra ventana. Se recargará la versión guardada.':exception.message);if(exception.status===409){if(scenePayload?.source==='portable_project'){const status=await desktopCall('status');if(status.project)await openPortable(status.project);}else await openSpace(activeSpace.id);}}return null;}
  finally{busyScene(false);}
}
async function openSpace(id){
  spatialAssistant.stop();
  reconstructionResults.setCapture(null);
  stopPhysicsPreview();resetPlan();const current=beginSceneLoad();clearTimeout(pollTimer);activeJob=null;clearSelection();scenePayload=null;updateSceneActions();showLoading();setSaveState('Abriendo…','loading');
  try{
    const space=unwrapSpace(await request('/api/spatial/spaces/'+encodeURIComponent(id)));if(current!==loadId)return;
    activeSpace=space;$('space-title').textContent=space.title;updateLibrary();
    const url=new URL(location.href);url.searchParams.set('space',space.id);history.replaceState(null,'',url.pathname+url.search);
    if(space.scene_id){const payload=await request('/api/spatial/scenes/'+encodeURIComponent(space.scene_id));if(current!==loadId)return;
      applySceneMetadata(payload);syncObjectList();viewerLoadId=current;const loaded=await ensureViewer().load(payload);if(current!==loadId)return;
      if(loaded?.cancelled || viewer.contextUnavailable || viewer.loading)throw Error('La carga del espacio no terminó. Vuelve a cargar el visor.');sceneLoading=false;sceneLoadFailed=false;clearLoadProgress('ready');updateSceneActions();updatePhysicsActions();
      $('viewport-loading').hidden=true;$('viewport-controls').hidden=false;$('capture-panel').hidden=true;setMode('explore');syncObjectList();setSaveState('Guardado localmente');
      await presentation.refresh();spatialAssistant.contextChanged();notice('Selecciona un objeto para inspeccionarlo. La escala y la física todavía no están verificadas.');
    }else{viewer?.clear();await presentation.refresh();spatialAssistant.contextChanged();showCapture(space);if(space.job_id && runningStates.has(space.status))await pollJob(space.job_id,current);}
  }catch(exception){if(current===loadId){sceneMessage(exception.message);setSaveState('Revisar','error');error(exception.message);}}
}
function showCapture(space,job=null){
  sceneLoading=false;sceneLoadFailed=false;viewerLoadId=null;clearLoadProgress('idle');
  $('viewport-loading').hidden=true;$('viewport-error').hidden=true;$('capture-panel').hidden=false;$('viewport-controls').hidden=true;$('space-origin').hidden=true;$('restore-layout').disabled=true;
  $('object-list').replaceChildren();const empty=document.createElement('p');empty.className='subtle';empty.textContent='Los objetos aparecerán después de reconstruir.';$('object-list').append(empty);$('object-count').textContent='0';
  $('detail-origin').textContent='Captura local';$('detail-scale').textContent='Sin verificar';$('scene-limitations').textContent='Fotogramas preparados en este equipo. La reconstrucción con modelos remotos está pendiente.';
  const complete=['capture_prepared','prepared_not_reconstructed'].includes(space.status),failed=['failed','cancelled','interrupted'].includes(space.status);
  reconstructionResults.setCapture(complete?space.capture_id:null);
  $('open-capture-review').hidden=!complete || !space.capture_id || !(space.frames || []).length;
  $('capture-panel').dataset.complete=String(complete);$('capture-progress').hidden=complete || failed;$('capture-progress').value=job?.progress || 0;
  $('cancel-job').hidden=complete || failed || !space.job_id;
  $('capture-title').textContent=complete?'Tu captura está preparada.':space.status==='cancelled'?'Trabajo cancelado.':space.status==='interrupted'?'El trabajo se interrumpió.':space.status==='failed'?'No se pudo preparar el video.':'Preparando fotogramas.';
  $('capture-description').textContent=complete?'Revisa las vistas. La reconstrucción 3D será el siguiente paso.':failed?'Puedes elegir otro video desde Nuevo espacio. No se reintenta automáticamente.':job?.status==='cancelling'?'Terminando la operación local antes de cancelar…':(job?.phase_label || 'Tu video se procesa en este equipo.');
  $('space-description').textContent=complete?'Captura preparada · reconstrucción pendiente.':'Preparación local de captura.';
  $('capture-frames').replaceChildren();
  for(const [index,frame] of (space.frames || []).entries()){const source=frame.url || frame.image_url;if(!source)continue;const url=new URL(source,location.origin);if(url.origin!==location.origin || !url.pathname.startsWith('/api/spatial/'))continue;
    const img=document.createElement('img');img.src=url.href;img.alt='Vista '+(index+1)+' de la captura';img.loading='lazy';$('capture-frames').append(img);}
  setSaveState(complete?'Preparado':failed?'Sin reconstrucción':'Trabajo local');notice(complete?'Fotogramas preparados. Puedes consultar resultados guardados; esta vista no inicia trabajos GPU.':'Trabajo local de preparación de captura.');
}
async function pollJob(id,current){
  if(current!==loadId)return;activeJob=id;
  try{const response=await request('/api/spatial/jobs/'+encodeURIComponent(id));if(current!==loadId)return;const raw=response.job || response,job={...raw,status:raw.status || raw.state};
    if(runningStates.has(job.status)){if(activeSpace)showCapture(activeSpace,job);pollTimer=setTimeout(()=>pollJob(id,current),600);}
    else{activeJob=null;await refresh();if(activeSpace)await openSpace(activeSpace.id);}
  }catch(exception){if(current===loadId){error(exception.message);notice('No se pudo consultar el trabajo. Actualiza la biblioteca para revisar su estado.');}}
}
async function saveTransform(id,transform){
  if(presentationActive || saving || physicsActive || physicsLoading || !scenePayload || !transform)return;const current=loadId,payload=scenePayload,object=payload.scene.objects.find(item=>item.id===id);
  if(!object || object.editable!==true)return;const original=structuredClone(object.transform);busyScene(true);setSaveState('Guardando…','saving');selectObject(selectedId,object);
  try{const result=payload.source==='portable_project'?(await desktopCall('save_open_project',payload.revision,[{id,transform}],null)).project:await post('/api/spatial/scenes/'+payload.scene.scene_id+'/transforms',{expected_revision:payload.revision,objects:[{id,transform}]});
    if(current!==loadId)return;acceptScene(result);setSaveState('Guardado localmente');notice('Cambio guardado en este equipo.');error('');
  }catch(exception){if(current===loadId){viewer.setTransform(id,original);fillPosition(original);setSaveState('No guardado','error');error(exception.status===409?'El espacio cambió en otra ventana. Se recargará su versión actual.':exception.message);if(exception.status===409){if(scenePayload?.source==='portable_project'){const status=await desktopCall('status');if(status.project)await openPortable(status.project);}else await openSpace(activeSpace.id);}}}
  finally{busyScene(false);if(current===loadId)selectObject(selectedId,scenePayload?.scene.objects.find(item=>item.id===selectedId));}
}
function openDialog(){dialogError('');$('new-space-dialog').showModal();$('space-name').focus();}
$('new-space').addEventListener('click',openDialog);$('close-space-dialog').addEventListener('click',()=>$('new-space-dialog').close());
$('demo-form').addEventListener('submit',async event=>{event.preventDefault();$('create-demo').disabled=true;dialogError('');
  try{const result=await post('/api/spatial/spaces/demo',{title:$('space-name').value.trim() || 'Mi estudio'});$('new-space-dialog').close();await refresh();const space=unwrapSpace(result);await openSpace(space.id);}
  catch(exception){dialogError(exception.message);}finally{$('create-demo').disabled=false;}});
$('capture-file').addEventListener('change',async()=>{const file=$('capture-file').files?.[0];$('capture-file').value='';if(!file)return;
  if(!file.name.toLowerCase().endsWith('.mp4') || !file.size || file.size>25*1024*1024){dialogError('Elige un MP4 de hasta 25 MiB.');return;}
  $('create-demo').disabled=true;dialogError('');notice('Enviando el video únicamente al servidor de este equipo…');
  try{const result=await request('/api/spatial/captures',{method:'POST',headers:{'Content-Type':'video/mp4','X-Filename':encodeURIComponent(file.name)},body:file});$('new-space-dialog').close();await refresh();const space=unwrapSpace(result);await openSpace(space.id);}
  catch(exception){dialogError(exception.message);}finally{$('create-demo').disabled=false;}});
$('cancel-job').addEventListener('click',async()=>{const id=activeJob || activeSpace?.job_id;if(!id)return;$('cancel-job').disabled=true;try{await post('/api/spatial/jobs/'+id+'/cancel',{});await refresh();await openSpace(activeSpace.id);}catch(exception){error(exception.message);}finally{$('cancel-job').disabled=false;}});
$('refresh-spaces').addEventListener('click',()=>refresh().then(()=>{if(activeSpace)return openSpace(activeSpace.id);}).catch(exception=>error(exception.message)));
$('retry-viewer').addEventListener('click',()=>{if(saving)return;viewer?.dispose();viewer=null;if(scenePayload?.source==='portable_project')openPortable(scenePayload);else if(activeSpace)openSpace(activeSpace.id);else openDialog();});
$('reset-view').addEventListener('click',()=>viewKind==='plan'?floorPlan?.fit():viewer?.fitAll());$('zoom-in').addEventListener('click',()=>viewKind==='plan'?floorPlan?.zoom(.85):viewer?.zoom(.85));$('zoom-out').addEventListener('click',()=>viewKind==='plan'?floorPlan?.zoom(1.15):viewer?.zoom(1.15));$('focus-object').addEventListener('click',()=>viewKind==='plan'?focusPlanSelection():viewer?.focusSelected());
for(const mode of ['explore','move','rotate'])$('mode-'+mode).addEventListener('click',()=>setMode(mode));
$('apply-position').addEventListener('click',()=>{if(!selectedId || saving || !viewer)return;const values=['x','y','z'].map(axis=>Number($('position-'+axis).value));
  if(values.some(value=>!Number.isFinite(value) || Math.abs(value)>50)){error('Usa posiciones entre −50 y 50 unidades.');return;}
  const transform=viewer.transformOf(selectedId);transform.position=values;viewer.setTransform(selectedId,transform);saveTransform(selectedId,transform);});
$('spatial-canvas').addEventListener('spatial-object-change',event=>fillPosition(event.detail.transform));
$('restore-layout').addEventListener('click',()=>sceneAction('reset',{},'Distribución original restaurada.'));
$('undo-edit').addEventListener('click',()=>{if(!$('undo-edit').disabled)sceneAction('undo',{},'Cambio deshecho.');});$('redo-edit').addEventListener('click',()=>{if(!$('redo-edit').disabled)sceneAction('redo',{},'Cambio rehecho.');});
$('layout-select').addEventListener('change',()=>{$('apply-layout').disabled=saving || !$('layout-select').value;});
$('save-layout').addEventListener('click',()=>{if(saving || !scenePayload)return;$('layout-error').hidden=true;$('layout-name').value='';$('layout-dialog').showModal();$('layout-name').focus();});
$('close-layout-dialog').addEventListener('click',()=>$('layout-dialog').close());
$('layout-form').addEventListener('submit',async event=>{event.preventDefault();if(saving)return;$('confirm-layout').disabled=true;const sceneId=scenePayload?.scene.scene_id;
  try{const result=await sceneAction('layouts',{name:$('layout-name').value.trim()},'Variante guardada.');if(result && sceneId===scenePayload?.scene.scene_id){$('layout-dialog').close();if(result.layout?.id){$('layout-select').value=result.layout.id;updateSceneActions();}}else{$('layout-error').hidden=false;$('layout-error').textContent='No se pudo guardar la variante. Revisa el aviso del espacio.';}}
  finally{$('confirm-layout').disabled=false;}});
$('apply-layout').addEventListener('click',()=>{const id=$('layout-select').value;if(id)sceneAction('layouts/'+encodeURIComponent(id)+'/apply',{},'Variante aplicada. Puedes deshacer el cambio.');});
$('export-space').addEventListener('click',async()=>{if(scenePayload?.source==='portable_project'){try{const result=await desktopCall('export_open_project');notice(result.cancelled?'Exportación cancelada.':'Proyecto exportado en ZIP.');}catch(exception){error(exception.message);}return;}if(saving || !scenePayload?.export_url)return;const current=loadId,url=new URL(scenePayload.export_url,location.origin);if(url.origin!==location.origin || !url.pathname.startsWith('/api/spatial/'))return;
  $('export-space').disabled=true;notice('Preparando el archivo del espacio…');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(url.href,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(response.status===403?'El enlace de exportación venció. Actualiza la biblioteca.':'No se pudo exportar el espacio.');const bytes=await response.blob();if(current!==loadId)return;
    if(bytes.size>100*1024*1024)throw Error('La exportación supera el límite de este visor.');const link=document.createElement('a'),objectURL=URL.createObjectURL(bytes);link.href=objectURL;link.download='brivany-espacio.zip';link.click();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);notice('Espacio exportado con sus artefactos y procedencia.');
  }catch(exception){if(current===loadId)error(exception.name==='AbortError'?'La exportación tardó demasiado. Puedes volver a intentarlo.':exception.message);}finally{clearTimeout(timeout);if(current===loadId)updateSceneActions();}});
$('fullscreen-view').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('viewport-shell').requestFullscreen)await $('viewport-shell').requestFullscreen();else notice('Este navegador no ofrece pantalla completa. El visor sigue disponible.');}catch{notice('No se pudo abrir pantalla completa en este navegador.');}});
$('spatial-canvas').addEventListener('keydown',event=>{if(!viewer || event.ctrlKey || event.metaKey || event.altKey)return;const actions={r:()=>viewer.fitAll(),f:()=>viewer.focusSelected(),Escape:()=>viewer.select(null),'+':()=>viewer.zoom(.85),'-':()=>viewer.zoom(1.15),g:()=>setMode('move'),e:()=>setMode('explore')};if(actions[event.key]){event.preventDefault();actions[event.key]();}});
document.addEventListener('keydown',event=>{if(!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase()!=='z' || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]'))return;const button=$(event.shiftKey?'redo-edit':'undo-edit');if(!button.disabled){event.preventDefault();button.click();}});
function resetPlan(){
  ++planGeneration;planBusy=false;planDocument=null;planReferences=[];planPoints=[];viewKind='3d';floorPlan?.dispose();floorPlan=null;
  planSettingsRevision=0;planConfig={references:[],annotations:[],uncertainty_zones:[],cut_height:1.0};
  $('floorplan-canvas').dataset.ready='false';$('floorplan-canvas').hidden=true;$('spatial-canvas').hidden=false;$('viewport-shell').dataset.viewKind='3d';
  $('view-three').setAttribute('aria-pressed','true');$('view-plan').setAttribute('aria-pressed','false');$('plan-references').replaceChildren();$('plan-clear-references').hidden=true;
  $('plan-points-status').textContent='Sin tramo seleccionado.';$('plan-reference-form').reset();$('floorplan-status').textContent='Abre una escena para consultar su plano.';
}
function updatePlanActions(){
  const portable=scenePayload?.source==='portable_project',available=Boolean(scenePayload) && (!portable || desktopAvailable()) && !saving && !physicsActive && !physicsLoading && !planBusy;
  $('view-plan').hidden=false;$('floorplan-details').hidden=false;$('view-plan').disabled=!available;
  for(const id of ['plan-refresh','plan-pick-reference'])$(id).disabled=!available;
  $('plan-export').disabled=!available || !planDocument;$('plan-add-reference').disabled=!available || planPoints.length!==2 || planReferences.length>=20;
  $('plan-clear-references').hidden=!planReferences.length;
  $('plan-save').disabled=!available || !planDocument;
}
function ensurePlan(){
  if(!floorPlan)floorPlan=new FloorPlan($('floorplan-canvas'),{onSelect:id=>viewer?viewer.select(id):selectObject(id,scenePayload?.scene.objects.find(object=>object.id===id)),onPoint:point=>{
    if(planPoints.length>=2)planPoints=[];planPoints.push(point);
    if(planPoints.length===2){const distance=floorPlan.measure(planPoints);floorPlan.setMeasureMode(false);$('plan-points-status').textContent='Tramo elegido · '+distance.toFixed(3)+' unidades de escena. Introduce tu medición real.';$('plan-measured-length').focus();}
    else $('plan-points-status').textContent='Primer punto elegido. Selecciona el segundo.';
    updatePlanActions();
  }});
  return floorPlan;
}
function planScaleSummary(value){
  const refs=value.scale.references || [];
  $('floorplan-status').textContent=value.scale.label+' · revisión '+value.scene_revision+'.';
  const host=$('plan-references');host.replaceChildren();
  for(const reference of refs){const item=document.createElement('li');item.textContent=reference.note+' · '+reference.measured_m+' m declarados';host.append(item);}
  const rms=value.scale.rms_residual_m;
  $('plan-calibration-note').textContent=rms!==null?'Residual RMS: '+rms.toFixed(4)+' m. Mide consistencia entre tus referencias; no precisión geométrica. Guarda para conservarlas.':'Una sola medida no permite calcular un residual independiente. Guarda las referencias para conservarlas. SVG conserva procedencia e incertidumbre.';
}
async function loadPlan(references=null){
  if(!scenePayload || saving || physicsActive || physicsLoading)return false;
  const current=loadId,generation=++planGeneration,payload=scenePayload;planBusy=true;updatePlanActions();$('floorplan-status').textContent='Proyectando la geometría guardada…';error('');
  try{
    const parameters=references===null?null:{...planConfig,references};
    const result=payload.source==='portable_project'?(await desktopCall('get_floorplan',payload.revision,parameters)).floorplan:await post('/api/spatial/scenes/'+payload.scene.scene_id+'/floorplan',{expected_revision:payload.revision,...(parameters || {})});
    if(current!==loadId || generation!==planGeneration)return false;
    if(result.scene_revision!==payload.revision)throw Error('El plano no corresponde a la revisión abierta. Actualiza el espacio.');
    planDocument=result;planSettingsRevision=result.settings_revision || 0;planReferences=structuredClone(result.scale.references || []);planConfig=structuredClone(result.config || {...planConfig,references:planReferences});ensurePlan().load(result);floorPlan.select(selectedId);planScaleSummary(result);planPoints=[];floorPlan.setMeasureMode(false);$('plan-points-status').textContent='Sin tramo seleccionado.';
    $('plan-save-status').textContent=result.settings_persisted && references===null?'Configuración guardada en el proyecto.':'Vista previa · guarda para conservar la configuración.';
    if(viewKind==='plan'){$('viewport-loading').hidden=true;$('viewport-error').hidden=true;$('viewport-controls').hidden=false;}
    updatePlanActions();return true;
  }catch(exception){if(current===loadId && generation===planGeneration){$('floorplan-status').textContent=exception.status===409?'La revisión cambió. Actualiza el espacio antes de calibrar.':'No se pudo generar el plano.';error(exception.message);}return false;}
  finally{if(current===loadId && generation===planGeneration){planBusy=false;updatePlanActions();}}
}
async function switchRepresentation(kind){
  if(kind==='plan' && (!scenePayload || saving))return;
  if(kind==='plan')stopPhysicsPreview();viewKind=kind;$('viewport-shell').dataset.viewKind=kind;
  $('view-three').setAttribute('aria-pressed',String(kind==='3d'));$('view-plan').setAttribute('aria-pressed',String(kind==='plan'));
  $('spatial-canvas').hidden=kind!=='3d';$('floorplan-canvas').hidden=kind!=='plan';
  if(kind==='plan'){
    setMode('explore');$('viewport-hint').textContent='Plano de la geometría actual · arrastra para desplazar · medidas sin verificar.';
    $('viewport-error').hidden=true;
    if(!planDocument || planDocument.scene_revision!==scenePayload.revision)await loadPlan();else{$('viewport-loading').hidden=true;$('viewport-controls').hidden=false;floorPlan?.fit();}
  }else{
    ++planGeneration;planBusy=false;floorPlan?.setMeasureMode(false);planPoints=[];setMode('explore');
    $('viewport-loading').hidden=true;$('viewport-controls').hidden=!viewer || viewer.contextUnavailable;
    if(!viewer || viewer.contextUnavailable){$('viewport-error').hidden=false;}
  }
  updatePhysicsActions();updatePlanActions();if(selectedId)selectObject(selectedId,scenePayload?.scene.objects.find(object=>object.id===selectedId));
}
function focusPlanSelection(){
  const polygon=planDocument?.objects.find(object=>object.id===selectedId)?.polygon;if(!polygon?.length)return;
  const xs=polygon.map(point=>point[0]),ys=polygon.map(point=>point[1]),width=Math.max(.1,Math.max(...xs)-Math.min(...xs)),height=Math.max(.1,Math.max(...ys)-Math.min(...ys));
  floorPlan?.setView([Math.min(...xs)-width*.25,Math.min(...ys)-height*.25,width*1.5,height*1.5]);
}
$('view-plan').addEventListener('click',()=>switchRepresentation('plan'));$('view-three').addEventListener('click',()=>switchRepresentation('3d'));
$('plan-refresh').addEventListener('click',async()=>{await switchRepresentation('plan');if(planDocument)await loadPlan();});
$('plan-pick-reference').addEventListener('click',async()=>{
  await switchRepresentation('plan');if(!planDocument)return;planPoints=[];floorPlan.load(planDocument);floorPlan.select(selectedId);floorPlan.setMeasureMode(true);$('plan-points-status').textContent='Selecciona el primer punto del tramo que mediste.';updatePlanActions();$('floorplan-canvas').scrollIntoView({block:'center',behavior:'auto'});$('floorplan-canvas').querySelector('svg').focus();
});
$('plan-reference-form').addEventListener('submit',async event=>{
  event.preventDefault();if(planPoints.length!==2 || saving || planBusy || planReferences.length>=20)return;
  const measured=Number($('plan-measured-length').value),note=$('plan-measure-note').value.trim();
  if(!Number.isFinite(measured) || measured<=0 || measured>1000 || !note){error('Introduce la distancia real medida y describe el tramo.');return;}
  const reference={id:'ref-'+(planReferences.length+1),points:structuredClone(planPoints),measured_m:measured,method:$('plan-measure-method').value,note,provenance:'user_declared'};
  if(await loadPlan([...planReferences,reference])){$('plan-measured-length').value='';$('plan-measure-note').value='';notice('Escala ajustada con una medida declarada. Geometría y precisión profesional sin verificar.');}
});
$('plan-clear-references').addEventListener('click',()=>loadPlan([]));
$('plan-save').addEventListener('click',async()=>{
  if(!planDocument || planBusy || saving)return;const current=loadId,payload=scenePayload;planBusy=true;updatePlanActions();error('');
  try{if(payload.source==='portable_project'){
      const result=await desktopCall('save_floorplan',payload.revision,planConfig);if(current!==loadId)return;
      const originalView=viewKind;viewKind='3d';applySceneMetadata(result.project);viewKind=originalView;planDocument=result.floorplan;planSettingsRevision=result.project.revision;floorPlan.load(planDocument);floorPlan.select(selectedId);planScaleSummary(planDocument);
    }else{const result=await post('/api/spatial/scenes/'+payload.scene.scene_id+'/floorplan/settings',{expected_revision:planSettingsRevision,expected_scene_revision:payload.revision,config:planConfig});if(current!==loadId)return;planSettingsRevision=result.revision;}
    $('plan-save-status').textContent='Configuración guardada en el proyecto.';notice('Referencias y anotaciones guardadas. La escala sigue declarada, sin verificación independiente.');
  }catch(exception){if(current===loadId)error(exception.status===409?'El proyecto o su plano cambió en otra ventana. Actualiza antes de guardar.':exception.message);}
  finally{if(current===loadId){planBusy=false;updatePlanActions();}}
});
$('plan-export').addEventListener('click',()=>{
  try{if(!planDocument || planBusy || saving)return;const blob=floorPlan.exportSVG(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='brivany-plano-'+planDocument.scene_id+'.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('SVG exportado con procedencia, escala declarada e incertidumbre.');}
  catch(exception){error(exception.message);}
});
window.addEventListener('pagehide',()=>{stopPhysicsPreview();++loadId;++planGeneration;clearTimeout(pollTimer);presentation.dispose();spatialAssistant.dispose();floorPlan?.dispose();viewer?.dispose();});
const initialLibrary=refresh({select:true}).catch(exception=>{error(exception.message);sceneMessage('No se pudo consultar la biblioteca local. Comprueba que el servidor esté abierto.');});
initialLibrary.then(prepareDesktop);
