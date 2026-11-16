/* One explicit click captures render audio; never opens the app or microphone. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s),api=()=>window.pywebview?.api;
 const disk=window.BrivanyDesktopPreferenceStore;
 const t=source=>window.BrivanyWorkspaceLocale?.text(source)??source;
 let value={active:false,state:'idle',caption:'',error:''},syncValue={},busy=false,syncMessage='',startError='',preferences={target:'en',voice:'auto',mode:'direct'};
 let controlRevision=-1;
 let cloning={enabled:false,language:'es'};
 try{preferences={...preferences,...(disk?.current('auditory')||JSON.parse(localStorage.getItem('brivany.translation')||'{}'))};}catch{}
 if(!['es','en','fr'].includes(preferences.target))preferences.target='en';if(!['auto','masculine','feminine'].includes(preferences.voice))preferences.voice='auto';
 if(!['direct','preproduction','synchronized'].includes(preferences.mode))preferences.mode='direct';
 if(disk)cloning.language=preferences.cloningLanguage;
 function saveSession(){if(!disk)try{localStorage.setItem('brivany.translation',JSON.stringify(preferences));}catch{}}
 async function savePreference(fields){
  if(disk)await disk.update('auditory',fields);
  Object.assign(preferences,fields);
  saveSession();
 }
 function receive(next){if(!next)return;if(Number.isFinite(next.control_revision)){if(next.control_revision<controlRevision)return;controlRevision=next.control_revision;}if(next.active)startError='';if((!disk||next.active||value.active||next.awaiting_browser)&&['direct','preproduction','synchronized'].includes(next.mode)){preferences.mode=next.mode;saveSession();}if(next.active||value.active){if(['es','en','fr'].includes(next.target))preferences.target=next.target;if(['auto','masculine','feminine'].includes(next.voice))preferences.voice=next.voice;saveSession();}value={...value,...next};paint();}
 function paint(){
  const external=preferences.mode!=='direct';document.querySelectorAll('[data-auditory-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryMode===preferences.mode));b.disabled=busy||value.active||syncValue.active_sessions>0;});
  const browserActive=syncValue.inline_video_active===true;
  const button=$('#workspace-audio');button.setAttribute('aria-pressed',String(value.active||browserActive));button.dataset.translating=String(value.active||browserActive);
  document.querySelectorAll('[data-auditory-target]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryTarget===preferences.target));b.disabled=browserActive||busy&&!value.active;});
  document.querySelectorAll('[data-auditory-voice]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryVoice===preferences.voice));b.disabled=browserActive||busy||cloning.enabled&&b.dataset.auditoryVoice!=='auto';});
  const active=value.active||syncValue.active_sessions>0;
  // Changeable during a direct translation: it restarts with the new setting.
  $('#auditory-clone-enabled').checked=cloning.enabled;$('#auditory-clone-enabled').disabled=busy;
  $('#auditory-clone-language').hidden=!cloning.enabled;
  document.querySelectorAll('[data-clone-language]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.cloneLanguage===cloning.language));b.disabled=busy;});
  const voices=(external||browserActive?syncValue.voice_agents:value.voice_agents)||{},ready=(voices.speakers||[]).filter(s=>s.ready).length;
  const voiceStatus=$('#auditory-clone-status');voiceStatus.hidden=!cloning.enabled||active;
  voiceStatus.textContent=t('Las muestras se envían a Cartesia. Cada voz se elimina al terminar, salvo las que marques Mantener.');
  paintVoices(voices.speakers||[],active);
  $('#auditory-status').textContent=t(browserActive?'Traducción sincronizada en el navegador':external?(syncValue.active_sessions?'Traducción sincronizada activa':syncMessage||'Inicia la extensión en la pestaña del video.'):startError||value.error||(value.state==='selecting'?'Selecciona el video en el navegador':value.state==='starting'?'Conectando…':value.state==='reconnecting'&&value.active?'Reconectando sin detener…':value.active?value.state==='music'?'Música · sin traducir':value.buffered_seconds>3?t('Traduciendo · {seconds} s de retraso').replace('{seconds}',String(Math.round(value.buffered_seconds))):value.state==='listening'?'Escuchando':'Traduciendo':''));
  if(active&&cloning.enabled&&!value.error)$('#auditory-status').textContent+=' · '+(ready?ready+' '+t(ready===1?'voz preparada':'voces preparadas'):t('Preparando voces'));
  $('#auditory-caption').textContent=value.caption||'';
  $('#auditory-speaker').textContent=value.caption?value.speaker_label||'':'';
  $('#auditory-speaker').dataset.speaker=String((value.speaker_index||0)%3);
  const control=$('#auditory-toggle');control.textContent=t(browserActive||syncValue.active_sessions?'Detener':external?(syncValue.paired_browsers?'Preparar':'Vincular navegador'):value.active?'Detener':'Iniciar');control.disabled=busy;
 }
 let kept=[],keepBusy=false,keptLoaded=false;
 function voiceRow(text,button){
  const row=document.createElement('div');row.className='clone-voice';
  const label=document.createElement('span');label.textContent=text;row.append(label);
  if(button)row.append(button);return row;
 }
 function paintVoices(speakers,active){
  // Built with textContent only: speaker labels and names never become markup.
  const box=$('#auditory-clone-voices');if(!box)return;
  const rows=[];
  for(const speaker of speakers){
   if(active&&speaker.ready&&speaker.token){
    const button=document.createElement('button');button.type='button';
    button.textContent=t(speaker.keep?'Se mantendrá':'Mantener');button.setAttribute('aria-pressed',String(!!speaker.keep));button.disabled=keepBusy;
    button.onclick=()=>markKeep(speaker.token,!speaker.keep);
    rows.push(voiceRow(speaker.label+' · '+t('voz clonada en uso'),button));
   }else if(active&&!speaker.cloned){
    rows.push(voiceRow(speaker.label+' · '+(speaker.state==='cloning'?t('clonando…'):speaker.state==='failed'?t('sin clon; voz de catálogo'):t('reuniendo muestra')+' '+Math.round(speaker.sample_seconds||0)+' s')));
   }else if(!active&&speaker.outcome){
    rows.push(voiceRow(speaker.label+' · '+t(speaker.outcome==='kept'?'voz guardada':'voz eliminada')));
   }
  }
  if(!active&&kept.length){
   const title=document.createElement('p');title.className='clone-voices-title';title.textContent=t('Voces guardadas');rows.push(title);
   for(const voice of kept){
    const button=document.createElement('button');button.type='button';button.textContent=t('Eliminar');button.disabled=keepBusy;
    button.onclick=()=>deleteKept(voice.id,voice.name);
    rows.push(voiceRow(voice.name,button));
   }
  }
  box.replaceChildren(...rows);box.hidden=!rows.length;
 }
 async function markKeep(token,keep){
  if(keepBusy)return;keepBusy=true;paint();
  try{await api().work_voice_keep(token,keep);syncValue=await api()?.work_sync_translation_status?.()||syncValue;receiveSnapshot(await api()?.work_status?.());}
  catch(error){value.error=error.message||'No se pudo cambiar la voz.';}
  finally{keepBusy=false;paint();}
 }
 async function loadKept(){
  if(!api()?.work_kept_voices)return;
  try{kept=await api().work_kept_voices()||[];keptLoaded=true;}catch{}
 }
 async function deleteKept(id,name){
  if(keepBusy||!confirm(t('¿Eliminar la voz guardada «{name}»? No se puede deshacer.').replace('{name}',name)))return;
  keepBusy=true;paint();
  try{kept=await api().work_kept_voice_delete(id)||[];}
  catch(error){value.error=error.message||'No se pudo eliminar la voz.';}
  finally{keepBusy=false;paint();}
 }
 async function start(requestedMode){
  if(busy||value.active||syncValue.active_sessions)return;
  busy=true;startError='';paint();
  try{
   try{
    const saved=disk?.current('auditory')||JSON.parse(localStorage.getItem('brivany.translation')||'{}');
    if(['es','en','fr'].includes(saved.target))preferences.target=saved.target;
    if(cloning.enabled)preferences.voice='auto';
    else if(['auto','masculine','feminine'].includes(saved.voice))preferences.voice=saved.voice;
    if(disk)preferences.mode=saved.mode;
   }catch{}
   if(requestedMode==='direct')await savePreference({mode:'direct'});
   try{syncValue=await api()?.work_sync_translation_status?.()||syncValue;if(syncValue.selected_video?.selected){preferences.mode='direct';saveSession();}}catch{}
   if(preferences.mode!=='direct'){
    syncValue=await api().work_sync_translation_prepare(preferences.mode);
    syncMessage='Selecciona el video desde la extensión de Brivany.';
   }else{
    receive({state:'starting',error:'',caption:'',speaker_label:'',speaker_index:0});
    if(!api()?.work_audio_translation_start)throw Error('Inicia desde Brivany Desktop.');
    receive(await api().work_audio_translation_start(preferences.target,preferences.voice));
   }
  }catch(error){
   if(preferences.mode!=='direct')syncMessage=error.message||'No se pudo preparar el navegador.';
   else{startError=error.message||'No se pudo iniciar la traducción.';receive({active:false,state:'error',error:startError});}
  }finally{busy=false;paint();}
 }
 $('#workspace-audio').onclick=event=>{window.BrivanyIsland?.expand('auditory',event.clientX||innerWidth/2);if(!value.active&&!syncValue.inline_video_active&&!syncValue.active_sessions)start('direct');};
 async function configureVoices(enabled,language){
  if(syncValue.inline_video_active||syncValue.active_sessions){
   value.error=t('Detén la traducción del navegador para cambiar la clonación.');paint();return;
  }
  // A running direct translation keeps playing; cloning starts in background.
  busy=true;paint();
  try{
   cloning=await api().work_voice_cloning(enabled,language,enabled);
   if(enabled)preferences.voice='auto';
   else if(disk)preferences.voice=disk.current('auditory').voice;
   if(disk)await savePreference({cloningLanguage:language});else saveSession();
   startError='';
  }catch(error){value.error=error.message||'No se pudieron configurar las voces.';}
  finally{busy=false;paint();}
  try{receiveSnapshot(await api()?.work_status?.());}catch{}
 }
 $('#auditory-clone-enabled').onchange=e=>configureVoices(e.target.checked,cloning.language);
 document.querySelectorAll('[data-clone-language]').forEach(b=>b.onclick=()=>configureVoices(cloning.enabled,b.dataset.cloneLanguage));
 $('#auditory-toggle').onclick=async()=>{
  if(syncValue.inline_video_active||syncValue.active_sessions){try{syncValue=await api().work_sync_translation_stop();startError='';paint();}catch(e){syncMessage=e.message;paint();}return;}
  if(value.active){busy=true;paint();try{receive(await api().work_audio_translation_stop());}catch{receive({error:'No se confirmó la parada.'});}finally{busy=false;paint();}}
  else start();
 };
 document.querySelectorAll('[data-auditory-target]').forEach(button=>button.onclick=async()=>{
  const target=button.dataset.auditoryTarget;if(busy||target===preferences.target)return;
  busy=true;paint();
  try{
   if(api()?.work_audio_translation_target)receive(await api().work_audio_translation_target(target));
   await savePreference({target});value.error='';startError='';
  }catch(error){receive({error:error.message||'No se pudo cambiar el idioma.'});}
  finally{busy=false;paint();}
 });
 document.querySelectorAll('[data-auditory-mode]').forEach(button=>button.onclick=async()=>{
  if(busy)return;
  const mode=button.dataset.auditoryMode;
  busy=true;paint();
  try{if(api()?.work_audio_translation_mode)receive(await api().work_audio_translation_mode(mode));await savePreference({mode});syncMessage='';value.error='';startError='';}
  catch(error){syncMessage=error.message;value.error=error.message;}
  finally{busy=false;paint();}
 });
 document.querySelectorAll('[data-auditory-voice]').forEach(button=>button.onclick=async()=>{
  if(busy)return;
  const mode=button.dataset.auditoryVoice;
  busy=true;paint();
  try{if(api()?.work_audio_translation_voice)receive(await api().work_audio_translation_voice(mode));await savePreference({voice:mode});value.error='';startError='';}
  catch(error){receive({error:error.message||'No se pudo cambiar la voz.'});}
  finally{busy=false;paint();}
 });
 function receiveSnapshot(state){
  if(state?.voice_cloning){
   cloning={...state.voice_cloning};
   if(disk&&!cloning.enabled)cloning.language=disk.current('auditory').cloningLanguage;
  }
  if(state?.audio_translation)receive(state.audio_translation);
 }
 function receivePreferences(event){
  if(!disk||busy||value.active||syncValue.active_sessions||event.type==='storage'&&event.key!=='brivany.translation')return;
  const saved=disk.current('auditory');
  Object.assign(preferences,saved);
  if(cloning.enabled)preferences.voice='auto';
  else cloning.language=saved.cloningLanguage;
  paint();
 }
 let disposed=false,pulling=false,syncTimer;
 const auditoryVisible=()=>!disposed&&!document.hidden&&document.body.dataset.surface!=='bar'&&document.body.dataset.panel==='auditory'&&document.body.dataset.expanded==='true';
 async function pull(){
  clearTimeout(syncTimer);
  if(pulling||!auditoryVisible())return;
  pulling=true;
  try{
   if(!window.BrivanyIsland?.snapshot)receiveSnapshot(await api()?.work_status?.());
   syncValue=await api()?.work_sync_translation_status?.()||{};
   // Local list only (no provider request); refreshed while the panel is idle.
   if(!value.active&&!syncValue.active_sessions&&(cloning.enabled||!keptLoaded||kept.length))await loadKept();
   paint();
  }catch{}finally{
   pulling=false;
   if(auditoryVisible())syncTimer=setTimeout(pull,1500);
  }
 }
 window.addEventListener('pagehide',()=>{
  disposed=true;clearTimeout(syncTimer);
  window.removeEventListener('storage',receivePreferences);
  window.removeEventListener('brivany-workspace-settings',receivePreferences);
  window.removeEventListener('brivany-workspace-locale',paint);
  window.removeEventListener('brivany-island-layout',pull);
  document.removeEventListener('visibilitychange',pull);
  window.removeEventListener('pywebviewready',pull);
 });
 window.addEventListener('storage',receivePreferences);
 window.addEventListener('brivany-workspace-settings',receivePreferences);
 window.addEventListener('brivany-workspace-locale',paint);
 window.addEventListener('brivany-workspace-snapshot',event=>receiveSnapshot(event.detail));window.addEventListener('brivany-island-layout',pull);document.addEventListener('visibilitychange',pull);
 window.BrivanyTranslation={receive};window.addEventListener('pywebviewready',pull);paint();receiveSnapshot(window.BrivanyIsland?.snapshot?.());pull();
})();
