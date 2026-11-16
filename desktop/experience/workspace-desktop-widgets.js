/* Native clock/timer/notes, shared state and bounded recovery for unsent edits. */
(() => {
 'use strict';
 const widgets=window.BrivanyWorkspaceWidgets,picker=document.querySelector('#widget-tool-picker');
 if(!widgets||!picker)return;
 const editor=document.body.dataset.surface==='panel'?'workspace-panel':'workspace-bar';
 const recoveryKey='brivany.workspace.note-recovery.v1.'+editor;
 const box=document.querySelector('#widget-note'),notePane=document.querySelector('#widget-pane-notes');
 const pin=document.createElement('button');pin.type='button';pin.id='widget-desktop-open';pin.hidden=true;
 pin.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>';
 picker.after(pin);
 const conflict=document.createElement('div');conflict.id='widget-note-conflict';conflict.hidden=true;
 conflict.innerHTML='<span>Hay otra edición guardada.</span><div><button type="button" data-note-resolution="load">Cargar actual</button><button type="button" data-note-resolution="save">Guardar ésta</button></div>';
 notePane.append(conflict);
 const localization=window.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 localization?.mount(conflict);
 let known=null,connected=false,connecting=false,disposed=false,pending=null,inflight=null,dirtyLocal=false,resolving=false,noteTimer=0,timerBusy=false,lastPreferences='',lastError='',editBase=0;
 const api=()=>window.pywebview?.api;
 const names={clock:'Reloj',timer:'Enfoque',notes:'Notas'};
 function recovery(){try{const raw=localStorage.getItem(recoveryKey);if(!raw||raw.length>30000)return null;const v=JSON.parse(raw);return typeof v.text==='string'&&v.text.length<=4000&&Number.isSafeInteger(v.base)&&v.base>=0?v:null}catch{return null}}
 function keepRecovery(value,base){try{localStorage.setItem(recoveryKey,JSON.stringify({text:value,base}))}catch{widgets.message('No se pudo conservar la edición pendiente.')}}
 function clearRecovery(value,base){try{const saved=recovery();if(saved?.text===value&&saved.base===base)localStorage.removeItem(recoveryKey)}catch{}}
 function accept(value){
  if(!value||!Number.isSafeInteger(value.revision)||!Number.isSafeInteger(value.note_revision)||!value.timer||typeof value.note!=='string')throw Error('No se pudo sincronizar el widget.');
  if(!known||value.revision>=known.revision)known=value;
 }
 function controls(locked=false){
  box.disabled=locked||resolving;
  for(const id of ['widget-timer-action','widget-timer-reset'])document.getElementById(id).disabled=locked||timerBusy;
  for(const id of ['widget-timer-minutes','widget-timer-seconds'])document.getElementById(id).disabled=locked||timerBusy||['running','paused'].includes(widgets.state().state);
 }
 function pinState(){
  const kind=picker.value;pin.hidden=!connected||!known?.native_available||!names[kind];
  if(names[kind]){const label=t('Abrir {name} en el escritorio').replace('{name}',t(names[kind]));pin.setAttribute('aria-label',label);pin.title=label;pin.dataset.open=String(known?.windows?.includes(kind)||false)}
 }
 function render(){
  if(disposed||!connected||!known)return;
  const draft=known.drafts?.[editor];
  if(!dirtyLocal&&!resolving)editBase=known.note_revision;
  widgets.adoptCanonical({...known,note:draft?.text??known.note},{preserveNote:dirtyLocal||resolving});
  conflict.hidden=!draft;notePane.dataset.conflict=String(!!draft);
  for(const b of conflict.querySelectorAll('button'))b.disabled=resolving;
  if(known.error!==lastError){if(known.error||lastError)widgets.message(known.error||'');lastError=known.error||''}
  controls();pinState();
 }
 function receive(value){if(disposed)return;try{accept(value);render()}catch(error){widgets.message(error.message)}}
 async function sendPending(){
  clearTimeout(noteTimer);noteTimer=0;if(!connected||disposed||inflight||resolving||!pending)return;
  const request=pending;pending=null;
  const operation=Promise.resolve().then(()=>api().workspace_desktop_widget_note(request.value,request.expected,editor,false));inflight=operation;
  try{
   const result=await operation;accept(result.state);
   if(!result.conflict){
    if(pending&&pending.expected===request.expected)pending.expected=result.state.note_revision;
    if(editBase===request.expected)editBase=result.state.note_revision;
    if(pending&&!disposed)keepRecovery(pending.value,pending.expected);
    clearRecovery(request.value,request.expected);
   }
   if(!pending)dirtyLocal=false;
  }catch{widgets.message('No se pudo guardar la nota. La edición pendiente se conserva en este equipo.')}
  finally{if(inflight===operation)inflight=null;render();if(pending&&!disposed)noteTimer=setTimeout(sendPending,60)}
 }
 function edit(value){
  dirtyLocal=true;
  pending={value,expected:pending?.expected??editBase};
  keepRecovery(value,pending.expected);clearTimeout(noteTimer);noteTimer=setTimeout(sendPending,60);
 }
 async function timer(action,duration){
  if(timerBusy)return;timerBusy=true;controls();
  try{accept(await api().workspace_desktop_widget_timer(action,duration,editor));render()}
  catch(error){widgets.message(error.message||'No se pudo cambiar el temporizador.')}
  finally{timerBusy=false;controls()}
 }
 async function resolveNote(mode){
  if(resolving)return;resolving=true;clearTimeout(noteTimer);noteTimer=0;pending=null;
  const value=box.value,saved=recovery();controls();render();
  try{
   if(inflight)await inflight.catch(()=>{});
   let result;
   if(mode==='load')result=await api().workspace_desktop_widget_discard(editor);
   else{const response=await api().workspace_desktop_widget_note(value,known.note_revision,editor,true);result=response.state}
   accept(result);dirtyLocal=false;if(saved)clearRecovery(saved.text,saved.base);
  }catch{widgets.message('No se pudo resolver la edición. Tu texto se conserva.')}
  finally{resolving=false;render()}
 }
 async function preferences(){
  if(!connected||disposed)return;const value=widgets.preferences(),signature=JSON.stringify(value);if(signature===lastPreferences)return;
  try{await api().workspace_desktop_widgets_preferences(value);lastPreferences=signature}catch(error){widgets.message(error.message||'No se pudo aplicar el aspecto del widget.')}
 }
 async function connect(){
  if(disposed||connected||connecting||typeof api()?.workspace_desktop_widgets_connect!=='function')return;
  connecting=true;controls(true);
  try{
   const prefs=widgets.preferences();accept(await api().workspace_desktop_widgets_connect(widgets.desktopSeed(),prefs,editor));
   connected=true;lastPreferences=JSON.stringify(prefs);widgets.useNative({note:edit,timer});
   const saved=recovery();
   if(saved&&saved.text!==known.note&&saved.text!==known.drafts?.[editor]?.text){
    dirtyLocal=true;editBase=saved.base;pending={value:saved.text,expected:saved.base};box.value=saved.text;box.dispatchEvent(new Event('input'));
   }else if(saved&&!known.drafts?.[editor])clearRecovery(saved.text,saved.base);
   render();if(known.notice)widgets.message(known.notice);
  }catch(error){widgets.message(error.message||'No se pudieron sincronizar los widgets de escritorio.')}
  finally{connecting=false;controls();pinState()}
 }
 pin.onclick=async()=>{pin.disabled=true;try{await api().workspace_desktop_widget_open(picker.value);widgets.message('')}catch(error){widgets.message(error.message||'No se pudo abrir el widget.')}finally{pin.disabled=false}};
 for(const button of conflict.querySelectorAll('button'))button.onclick=()=>resolveNote(button.dataset.noteResolution);
 function dispose(){
  if(disposed)return;clearTimeout(noteTimer);noteTimer=0;
  // Best effort delivery; recovery stays until an actual acknowledgement.
  if(pending&&!inflight)sendPending();disposed=true;
  window.removeEventListener('pywebviewready',connect);window.removeEventListener('brivany-widget-tab',pinState);window.removeEventListener('brivany-workspace-locale',pinState);window.removeEventListener('brivany-workspace-preferences',preferences);
 }
 window.BrivanyDesktopWidgets={receive,connect,flush:sendPending,dispose,state:()=>({connected,editor,revision:known?.revision,noteRevision:known?.note_revision,conflict:!!known?.drafts?.[editor],pending:!!pending||!!inflight,windows:known?.windows||[]})};
 window.addEventListener('pywebviewready',connect);window.addEventListener('brivany-widget-tab',pinState);window.addEventListener('brivany-workspace-locale',pinState);window.addEventListener('brivany-workspace-preferences',preferences);window.addEventListener('pagehide',dispose,{once:true});connect();
})();
