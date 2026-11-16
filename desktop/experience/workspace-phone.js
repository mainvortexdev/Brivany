/* One file, one temporary QR. Native events only; no idle network listener. */
(() => {
 'use strict';const mount=document.querySelector('#workspace-files');if(!mount)return;
 const localization=window.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 const panel=document.createElement('section');panel.className='shelf-phone';panel.hidden=true;
 panel.setAttribute('aria-label','Enviar al teléfono');
 panel.innerHTML='<div class="shelf-phone-heading"><strong id="phone-file-name"></strong><button id="phone-cancel" aria-label="Cancelar envío" title="Cancelar envío">×</button></div><img id="phone-qr" alt="Código QR para descargar el archivo"><div id="phone-connected" hidden aria-hidden="true">✓</div><p id="phone-state" role="status"></p><button id="phone-settings" aria-label="Ajustes de envío" title="Ajustes">⚙</button><button id="phone-copy" aria-label="Copiar enlace de envío" title="Copiar enlace">↗</button>';
 mount.append(panel);localization?.mount(panel);const $=id=>panel.querySelector(id);let state={revision:-1,active:false},gone=false,busy=false,lastFocus=null;
 async function native(method,...args){const api=window.pywebview?.api;if(!api?.[method])throw Error('Abre Brivany Desktop para enviar el archivo.');return api[method](...args)}
 function receive(value){
  if(gone||!value||!Number.isFinite(value.revision)||value.revision<state.revision)return;
  const returnFocus=state.active&&!value.active&&panel.contains(document.activeElement)&&document.body.dataset.panel==='files'&&document.body.dataset.expanded==='true';
  state=value;panel.hidden=!value.active;mount.dataset.sharing=String(value.active);document.body.dataset.phoneSharing=String(value.active);
  const tool=document.querySelector('#tools [data-panel="files"]');if(tool)tool.setAttribute('aria-label',t(value.active?'Archivos · Envío activo':'Archivos'));
  window.BrivanyWorkspaceDrop?.receive(value);
  if(!value.active){$('#phone-qr').removeAttribute('src');if(returnFocus&&lastFocus?.isConnected)lastFocus.focus({preventScroll:true});return}
  $('#phone-file-name').textContent=value.name||'';
  const hasQR=typeof value.qr==='string'&&value.qr.startsWith('data:image/png;base64,');$('#phone-qr').hidden=!hasQR;
  if(hasQR)$('#phone-qr').src=value.qr;else $('#phone-qr').removeAttribute('src');
  $('#phone-copy').hidden=!hasQR;$('#phone-settings').hidden=value.official_https===true;$('#phone-connected').hidden=hasQR||!['connected','sent'].includes(value.state);
  if(value.transport==='drop-v2'){
   $('#phone-connected').hidden=true;
   $('#phone-file-name').textContent=value.progress?.name||window.BrivanyWorkspaceFiles?.selected?.()?.name||value.name||t('Conectar teléfono');
   $('#phone-state').textContent=t((value.state==='failed'&&window.BrivanyDropPeer?.failures[value.failure])||({waiting:'Escanea para conectar',preparing:'Preparando conexión…',connecting:'Conectando…',connected:'Listo para enviar o recibir.',reconnecting:'Reconectando…',sending:'Enviando…',receiving:'Recibiendo…',sent:'Archivo enviado.',received:'Guardado en Descargas/Brivany.',declined:'Envío cancelado.',failed:'La conexión se interrumpió.',cancelling:'Desconectando…',cancel_pending:'Cancelación pendiente. Vuelve a intentarlo.'})[value.state]||'');return;
  }
  $('#phone-state').textContent=t(value.state==='cancel_pending'?'Cancelación pendiente. Vuelve a intentarlo.':value.state==='cancelling'?'Cancelando enlace…':value.state==='sent'?'Descarga iniciada':value.state==='connected'?'Teléfono conectado':value.state==='uploading'?'Preparando enlace seguro…':value.official_https?'Escanea para descargar':'Escanea en la misma red');
 }
 async function action(callback){if(gone||busy)return;busy=true;try{await callback()}catch(error){$('#phone-state').textContent=t(error.message||'No se pudo completar el envío.')}finally{busy=false}}
 $('#phone-cancel').onclick=()=>action(async()=>receive(await native('workspace_phone_stop')));
 $('#phone-settings').onclick=()=>action(()=>native('workspace_app_settings','work'));
 $('#phone-copy').onclick=()=>action(async()=>{if(!state.link||!navigator.clipboard?.writeText)throw Error('No se pudo copiar el enlace.');await navigator.clipboard.writeText(state.link);$('#phone-state').textContent=t('Enlace copiado')});
 async function start(identifier){lastFocus=document.activeElement;const value=await native('workspace_phone_share',identifier,localization?.current()||'es');receive(value);if(state.active)$('#phone-cancel').focus({preventScroll:true})}
 async function pull(){if(!window.pywebview?.api?.workspace_phone_state)return;try{receive(await native('workspace_phone_state'))}catch{}}
 function localize(){if(state.active)receive(state)}
 function dispose(){gone=true;window.removeEventListener('brivany-workspace-locale',localize);window.removeEventListener('pywebviewready',pull);$('#phone-qr').removeAttribute('src')}
 window.BrivanyWorkspacePhone={start,receive,dispose};window.addEventListener('brivany-workspace-locale',localize);window.addEventListener('pywebviewready',pull);window.addEventListener('pagehide',dispose,{once:true});pull();
})();
