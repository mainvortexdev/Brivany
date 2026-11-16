/* Recording controls: native events; one visible clock, no capture/polling in idle. */
(() => {
 'use strict';
 const host=window,document=host.document,widgets=host.BrivanyWorkspaceWidgets;
 const localization=host.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 if(!widgets?.addTool)return;
 const pane=document.createElement('div');
 if(!widgets.addTool('recording','Grabar',pane))return;
 pane.classList.add('recording-pane');
 pane.innerHTML=`<div class="recording-source-row"><select id="recording-source" aria-label="Fuente de grabación"><option value="">Pantalla o ventana</option></select><button id="recording-refresh" aria-label="Actualizar pantallas y ventanas" title="Actualizar fuentes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></svg></button></div>
 <div class="recording-actions"><time id="recording-elapsed" aria-label="Tiempo de grabación">00:00</time><span id="recording-phase" class="widget-sr-only">Listo para grabar</span><button id="recording-start" class="widget-primary" disabled>Grabar</button><button id="recording-stop" class="recording-danger" hidden>Detener</button><button id="recording-open" hidden>Abrir video</button></div>
 <p id="recording-feedback" class="widget-feedback" role="status"></p>`;
 localization?.mount(pane);
 const $=selector=>pane.querySelector(selector),glance=document.querySelector('#workspace-recording-stop');
 const phases={idle:'Listo para grabar',starting:'Preparando captura…',recording:'Grabando',stopping:'Deteniendo…',saving:'Guardando video…',saved:'Video guardado',error:'Revisa la grabación'};
 let statusMessage='';
 let value={state:'idle',revision:-1,elapsed_ms:0},clock=0,receivedAt=performance.now(),disposed=false,pending=false,loaded=false,available=false,hydrated=false;
 const busy=()=>['starting','recording','stopping','saving'].includes(value.state);
 const visible=()=>!document.hidden&&!pane.hidden&&document.body.dataset.expanded==='true'&&document.body.dataset.panel==='widgets';
 function feedback(text){statusMessage=text;$('#recording-feedback').textContent=t(text)}
 function paintClock(){
  const ms=(Number(value.elapsed_ms)||0)+(value.state==='recording'?Math.max(0,performance.now()-receivedAt):0),seconds=Math.floor(Math.max(0,ms)/1000);
  $('#recording-elapsed').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 }
 function schedule(){host.clearTimeout(clock);clock=0;if(disposed)return;paintClock();if(value.state==='recording'&&visible())clock=host.setTimeout(schedule,1000)}
 function paint(){
  const active=busy();
  for(const id of ['#recording-source','#recording-refresh'])$(id).disabled=active||pending;
  $('#recording-refresh').hidden=active;
  $('#recording-start').hidden=active;$('#recording-start').disabled=pending||!available||!$('#recording-source').value;
  $('#recording-stop').hidden=!active;$('#recording-stop').disabled=pending||['stopping','saving'].includes(value.state);
  $('#recording-phase').textContent=t(phases[value.state]||phases.idle);
  $('#recording-open').hidden=!value.has_file||active;$('#recording-open').title=value.file_name||t('Abrir video');
  pane.dataset.recording=value.state;
  if(glance){glance.hidden=!active;glance.disabled=pending||['stopping','saving'].includes(value.state);glance.textContent=t(value.state==='saving'?'Guardando…':value.state==='stopping'?'Deteniendo…':'● Detener');glance.setAttribute('aria-label',t('Detener grabación de pantalla'));}
  schedule();
 }
 function receive(next){
  if(disposed||!next||!Object.hasOwn(phases,next.state)||!Number.isFinite(next.revision)||next.revision<value.revision)return;
  value={...next};receivedAt=performance.now();feedback(value.error||'');paint();
 }
 async function native(method,...args){const api=host.pywebview?.api;if(disposed)throw Error('Esta vista está cerrada.');if(typeof api?.[method]!=='function')throw Error('Abre Brivany Desktop para grabar.');return api[method](...args)}
 async function action(callback){if(pending||disposed)return;pending=true;feedback('');paint();try{await callback()}catch(error){if(!disposed)feedback(error.message||'No se pudo completar la acción.')}finally{pending=false;if(!disposed)paint()}}
 async function sources(){
  const result=await native('workspace_recording_sources');if(disposed)return;
  const selected=$('#recording-source').value;$('#recording-source').replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=t('Pantalla o ventana');$('#recording-source').append(empty);
  for(const source of (result.sources||[]).slice(0,100)){
   if(typeof source.id!=='string'||typeof source.label!=='string')continue;
   const option=document.createElement('option');option.value=source.id;option.dataset.sourceLabel=source.label;option.dataset.kind=source.kind;option.textContent=(source.kind==='window'?t('Ventana · '):'')+source.label;$('#recording-source').append(option);
  }
  $('#recording-source').value=selected;available=result.available===true;loaded=true;
  if(!available)feedback('Instala FFmpeg y reinicia Brivany para grabar.');
  else if(!result.sources?.length)feedback('No hay fuentes disponibles. Abre una ventana y actualiza.');
 }
 async function hydrate(){
  if(hydrated||disposed||!host.pywebview?.api?.workspace_recording_status)return;
  hydrated=true;try{receive(await native('workspace_recording_status'))}catch{hydrated=false}
 }
 function tab(event){if(event.detail?.id!=='recording'){schedule();return}action(async()=>{await hydrate();if(!busy()&&!loaded)await sources()});schedule()}
 $('#recording-refresh').onclick=()=>action(sources);$('#recording-source').onchange=paint;
 $('#recording-start').onclick=()=>action(async()=>{const prefs=host.BrivanyWorkspacePreferences?.recording()||{fps:15,cursor:true};receive(await native('workspace_recording_start',$('#recording-source').value,prefs.fps,prefs.cursor))});
 const stop=()=>action(async()=>receive(await native('workspace_recording_stop')));
 $('#recording-stop').onclick=stop;if(glance)glance.onclick=stop;
 $('#recording-open').onclick=()=>action(()=>native('workspace_recording_open',false));
 function dispose(){disposed=true;host.removeEventListener('brivany-workspace-locale',localize);host.clearTimeout(clock);clock=0;host.removeEventListener('brivany-widget-tab',tab);host.removeEventListener('brivany-island-layout',schedule);host.removeEventListener('pywebviewready',hydrate);document.removeEventListener('visibilitychange',schedule);if(glance)glance.onclick=null}
 host.addEventListener('brivany-widget-tab',tab);host.addEventListener('brivany-island-layout',schedule);host.addEventListener('pywebviewready',hydrate);document.addEventListener('visibilitychange',schedule);host.addEventListener('pagehide',dispose,{once:true});
 function localize(){
  for(const option of $('#recording-source').options)option.textContent=option.value?(option.dataset.kind==='window'?t('Ventana · '):'')+option.dataset.sourceLabel:t('Pantalla o ventana');
  feedback(statusMessage);paint();
 }
 host.addEventListener('brivany-workspace-locale',localize);
 host.BrivanyWorkspaceRecorder={receive,dispose,state:()=>({...value}),clockScheduled:()=>!!clock};paint();hydrate();
})();
