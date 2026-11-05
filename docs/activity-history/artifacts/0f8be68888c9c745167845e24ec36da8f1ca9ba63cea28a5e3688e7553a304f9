/* One explicit click captures render audio; never opens the app or microphone. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s),api=()=>window.pywebview?.api;
 let value={active:false,state:'idle',caption:'',error:''},syncValue={},busy=false,syncMessage='',preferences={target:'en',voice:'auto',mode:'direct'};
 let controlRevision=-1;
 let cloning={enabled:false,language:'es'};
 try{preferences={...preferences,...JSON.parse(localStorage.getItem('brivany.translation')||'{}')};}catch{}
 if(!['es','en','fr'].includes(preferences.target))preferences.target='en';if(!['auto','masculine','feminine'].includes(preferences.voice))preferences.voice='auto';
 if(!['direct','preproduction','synchronized'].includes(preferences.mode))preferences.mode='direct';
 const save=()=>{try{localStorage.setItem('brivany.translation',JSON.stringify(preferences));}catch{}};
 function receive(next){if(!next)return;if(Number.isFinite(next.control_revision)){if(next.control_revision<controlRevision)return;controlRevision=next.control_revision;}if(['direct','preproduction','synchronized'].includes(next.mode)){preferences.mode=next.mode;save();}if(next.active||value.active){if(['es','en','fr'].includes(next.target))preferences.target=next.target;if(['auto','masculine','feminine'].includes(next.voice))preferences.voice=next.voice;save();}value={...value,...next};paint();}
 function paint(){
  const external=preferences.mode!=='direct';document.querySelectorAll('[data-auditory-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryMode===preferences.mode));b.disabled=busy||value.active||syncValue.active_sessions>0;});
  const browserActive=syncValue.inline_video_active===true;
  const button=$('#workspace-audio');button.setAttribute('aria-pressed',String(value.active||browserActive));button.dataset.translating=String(value.active||browserActive);
  document.querySelectorAll('[data-auditory-target]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryTarget===preferences.target));b.disabled=browserActive||busy&&!value.active;});
  document.querySelectorAll('[data-auditory-voice]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.auditoryVoice===preferences.voice));b.disabled=browserActive||busy||cloning.enabled&&b.dataset.auditoryVoice!=='auto';});
  const active=value.active||syncValue.active_sessions>0;
  $('#auditory-clone-enabled').checked=cloning.enabled;$('#auditory-clone-enabled').disabled=busy||active;
  $('#auditory-clone-language').hidden=!cloning.enabled;
  document.querySelectorAll('[data-clone-language]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.cloneLanguage===cloning.language));b.disabled=busy||active;});
  const voices=(external||browserActive?syncValue.voice_agents:value.voice_agents)||{},ready=(voices.speakers||[]).filter(s=>s.ready).length;
  const voiceStatus=$('#auditory-clone-status');voiceStatus.hidden=!cloning.enabled||active;
  voiceStatus.textContent='Las muestras se envían a Cartesia. Voces temporales por sesión.';
  $('#auditory-status').textContent=browserActive?'Traducción sincronizada en el navegador':external?(syncValue.active_sessions?'Traducción sincronizada activa':syncMessage||'Inicia la extensión en la pestaña del video.'):value.error||(value.state==='selecting'?'Selecciona el video en el navegador':value.state==='starting'?'Conectando…':value.active?value.state==='music'?'Música · sin traducir':value.buffered_seconds>3?'Traduciendo · '+Math.round(value.buffered_seconds)+' s de retraso':value.state==='listening'?'Escuchando':'Traduciendo':'');
  if(active&&cloning.enabled&&!value.error)$('#auditory-status').textContent+=' · '+(ready?ready+' '+(ready===1?'voz preparada':'voces preparadas'):'Preparando voces');
  $('#auditory-caption').textContent=value.caption||'';
  $('#auditory-speaker').textContent=value.caption?value.speaker_label||'':'';
  $('#auditory-speaker').dataset.speaker=String((value.speaker_index||0)%3);
  const control=$('#auditory-toggle');control.textContent=browserActive?'Detener':external?(syncValue.active_sessions?'Detener':syncValue.paired_browsers?'Preparar':'Vincular navegador'):value.active?'Detener':'Iniciar';control.disabled=busy;
 }
 async function start(){
  try{const saved=JSON.parse(localStorage.getItem('brivany.translation')||'{}');if(['es','en','fr'].includes(saved.target))preferences.target=saved.target;if(['auto','masculine','feminine'].includes(saved.voice))preferences.voice=saved.voice;}catch{}
  try{syncValue=await api()?.work_sync_translation_status?.()||syncValue;if(syncValue.selected_video?.selected){preferences.mode='direct';save();}}catch{}
  if(preferences.mode!=='direct'){
   if(busy)return;busy=true;paint();try{syncValue=await api().work_sync_translation_prepare(preferences.mode);syncMessage='Selecciona el video desde la extensión de Brivany.';}catch(e){syncMessage=e.message||'No se pudo preparar el navegador.';}finally{busy=false;paint();}return;
  }
  if(busy||value.active)return;busy=true;receive({state:'starting',error:'',caption:'',speaker_label:'',speaker_index:0});
  try{if(!api()?.work_audio_translation_start)throw Error('Inicia desde Brivany Desktop.');const run=api().work_browser_translation_start||api().work_audio_translation_start;receive(await run(preferences.target,preferences.voice));}
  catch(error){receive({active:false,state:'error',error:error.message||'No se pudo iniciar la traducción.'});}
  finally{busy=false;paint();}
 }
 $('#workspace-audio').onclick=event=>{window.BrivanyIsland?.expand('auditory',event.clientX||innerWidth/2);if(!value.active&&!syncValue.inline_video_active){if(api()?.work_browser_translation_start)preferences.mode='direct';start();}};
 async function configureVoices(enabled,language){
  busy=true;paint();try{cloning=await api().work_voice_cloning(enabled,language,enabled);if(enabled){preferences.voice='auto';save();}}catch(e){value.error=e.message||'No se pudieron configurar las voces.';}finally{busy=false;paint();}
 }
 $('#auditory-clone-enabled').onchange=e=>configureVoices(e.target.checked,cloning.language);
 document.querySelectorAll('[data-clone-language]').forEach(b=>b.onclick=()=>configureVoices(cloning.enabled,b.dataset.cloneLanguage));
 $('#auditory-toggle').onclick=async()=>{
  if(syncValue.inline_video_active||preferences.mode!=='direct'&&syncValue.active_sessions){try{syncValue=await api().work_sync_translation_stop();paint();}catch(e){syncMessage=e.message;paint();}return;}
  if(value.active){busy=true;paint();try{receive(await api().work_audio_translation_stop());}catch{receive({error:'No se confirmó la parada.'});}finally{busy=false;paint();}}
  else start();
 };
 document.querySelectorAll('[data-auditory-target]').forEach(button=>button.onclick=async()=>{
  const target=button.dataset.auditoryTarget;if(target===preferences.target)return;
  preferences.target=target;save();paint();
  if(api()?.work_audio_translation_target)try{receive(await api().work_audio_translation_target(target));}catch(error){receive({error:error.message||'No se pudo cambiar el idioma.'});}
 });
 document.querySelectorAll('[data-auditory-mode]').forEach(button=>button.onclick=async()=>{const mode=button.dataset.auditoryMode;try{if(api()?.work_audio_translation_mode)receive(await api().work_audio_translation_mode(mode));else preferences.mode=mode;syncMessage='';save();paint();}catch(e){syncMessage=e.message;paint();}});
 document.querySelectorAll('[data-auditory-voice]').forEach(button=>button.onclick=async()=>{
  const mode=button.dataset.auditoryVoice;
  try{if(api()?.work_audio_translation_voice)receive(await api().work_audio_translation_voice(mode));preferences.voice=mode;save();paint();}
  catch(error){receive({error:error.message||'No se pudo cambiar la voz.'});}
 });
 async function pull(){try{const state=await api()?.work_status?.();if(state?.voice_cloning)cloning=state.voice_cloning;if(state?.audio_translation)receive(state.audio_translation);syncValue=await api()?.work_sync_translation_status?.()||{};paint();}catch{}}
 const syncTimer=setInterval(()=>{if(api()?.work_browser_translation_start||preferences.mode!=='direct')pull();},1500);window.addEventListener('pagehide',()=>clearInterval(syncTimer));
 window.BrivanyTranslation={receive};window.addEventListener('pywebviewready',pull);paint();pull();
})();
