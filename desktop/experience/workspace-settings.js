/* WorkSpace configuration belongs in the existing Settings window. */
(() => {
 'use strict';
 const prefs=window.BrivanyWorkspacePreferences,target=document.querySelector('[data-section="work"]');if(!prefs||!target)return;
 const owner=parent.location.origin===location.origin?parent:window,block=document.createElement('div');
 block.innerHTML=`<h3>Aspecto de WorkSpace</h3>
 <label class="setting-row"><span>Idioma de WorkSpace</span><select id="settings-workspace-locale" aria-label="Idioma de WorkSpace"></select></label>
 <label class="setting-row"><span>Superficie</span><select aria-label="Superficie de WorkSpace" data-workspace-preference="theme"><option value="dark">Negro</option><option value="soft">Grafito</option></select></label>
 <label class="setting-row"><span>Acento</span><select aria-label="Acento de WorkSpace" data-workspace-preference="accent"><option value="blue">Azul Brivany</option><option value="mint">Menta</option><option value="amber">Ámbar</option><option value="rose">Rosa</option></select></label>
 <label class="setting-row"><span>Tamaño</span><select aria-label="Tamaño de WorkSpace" data-workspace-preference="size"><option value="compact">Compacto</option><option value="normal">Normal</option><option value="large">Grande</option></select></label>
 <label class="setting-row"><span>Ahorrar recursos</span><input aria-label="Ahorrar recursos en WorkSpace" type="checkbox" data-workspace-preference="economy" role="switch"></label>
 <label class="setting-row"><span>Animaciones</span><input aria-label="Animaciones de WorkSpace" type="checkbox" data-workspace-preference="motion" role="switch"></label>
 <h3>Música</h3><label class="setting-row"><span>Expansión musical<small>Tras un minuto sin actividad, con música en Spotify o YouTube. Vuelve al mover el ratón o usar el teclado.</small></span><input id="settings-music-expansion" aria-label="Expansión musical" type="checkbox"></label>
 <label class="setting-row"><span>Estilo de Expansión musical</span><select id="settings-music-style" aria-label="Estilo de Expansión musical"><option value="orbital">Luna y órbita</option><option value="amber">Tipografía ámbar</option></select></label>
 <div class="setting-row"><span>Ver cómo luce<small>Usa la canción que está sonando. Esc para volver.</small></span><button id="settings-music-preview" type="button">Vista previa</button></div>
 <h3>Grabación</h3><label class="setting-row"><span>Fluidez</span><select id="settings-recording-fps" aria-label="Fluidez de grabación"><option value="15">15 fps · ahorro</option><option value="30">30 fps · fluido</option></select></label>
 <label class="setting-row"><span>Incluir cursor</span><input id="settings-recording-cursor" type="checkbox" role="switch"></label>
 <div class="setting-row"><span>Carpeta de grabaciones<small id="settings-recording-folder"></small></span><button id="settings-recording-open-folder" type="button">Abrir carpeta</button></div>
 <p class="section-note">MP4 sin audio · hasta 1080p · 30 minutos o 2 GB.</p><h3>Bandeja de archivos</h3><p class="section-note">Hasta ocho archivos de 1 GB; 4 GB en total. Las copias temporales se retiran al salir de Brivany.</p><p id="workspace-settings-status" class="settings-status" role="status"></p>`;
 target.append(block);const $=selector=>block.querySelector(selector),status=text=>$('#workspace-settings-status').textContent=text;
 for(const [code,name] of Object.entries(prefs.languages)){
  const option=new Option(name,code);option.lang=code;$('#settings-workspace-locale').add(option);
 }
 function render(){const value=prefs.widgets();for(const input of block.querySelectorAll('[data-workspace-preference]')){const v=value[input.dataset.workspacePreference];if(input.type==='checkbox')input.checked=v;else input.value=v}const rec=prefs.recording();$('#settings-recording-fps').value=String(rec.fps);$('#settings-recording-cursor').checked=rec.cursor;$('#settings-workspace-locale').value=prefs.locale();$('#settings-music-expansion').checked=prefs.music?.().expansion===true;$('#settings-music-style').value=prefs.music?.().style||'orbital'}
 let saveRevision=0;
 async function save(action){
  const revision=++saveRevision;
  let message='';
  try{await action()}catch{message=prefs.error||'No se pudo guardar el ajuste.'}
  if(revision===saveRevision){render();status(message)}
 }
 for(const input of block.querySelectorAll('[data-workspace-preference]'))input.onchange=()=>save(()=>prefs.setWidgets({[input.dataset.workspacePreference]:input.type==='checkbox'?input.checked:input.value}));
 $('#settings-workspace-locale').onchange=()=>save(()=>prefs.setLocale($('#settings-workspace-locale').value));
 $('#settings-music-expansion').onchange=()=>save(()=>prefs.setMusic({expansion:$('#settings-music-expansion').checked}));
 $('#settings-music-style').onchange=()=>save(()=>prefs.setMusic({style:$('#settings-music-style').value}));
 $('#settings-music-preview').onclick=async()=>{try{await owner.pywebview.api.workspace_music_expansion_preview();status('')}catch(error){status(error.message||'No se pudo abrir la vista musical.')}};
 $('#settings-recording-fps').onchange=()=>save(()=>prefs.setRecording({fps:Number($('#settings-recording-fps').value)}));
 $('#settings-recording-cursor').onchange=()=>save(()=>prefs.setRecording({cursor:$('#settings-recording-cursor').checked}));
 $('#settings-recording-open-folder').onclick=async()=>{try{await owner.pywebview.api.workspace_recording_open(true);status('')}catch{status('La carpeta estará disponible tras la primera grabación.')}};
 async function folder(){try{const value=await owner.pywebview.api.workspace_recording_status();$('#settings-recording-folder').textContent=value.folder||''}catch{}}
 function storage(event){if(['brivany.workspace.widgets.v1','brivany.workspace.recording.v1','brivany.workspace.interface.v1','brivany.workspace.music.v1'].includes(event.key))render()}
 window.addEventListener('storage',storage);window.addEventListener('pagehide',()=>window.removeEventListener('storage',storage),{once:true});render();status(prefs.error);folder();
})();
