/* PC-side invitation, permission review and revocation. */
(() => {
 'use strict';
 const widgets = window.BrivanyWorkspaceWidgets;
 const tool = document.querySelector('#tools button[data-panel="widgets"]');
 let value = {state:'idle', revision:0, scopes:[]};
 let refreshBusy = false, busy = false, pane = null;
 const api = () => window.pywebview?.api;
 const t=source=>window.BrivanyWorkspaceLocale?.text(source)??source;
 const active = () => ['waiting','review','active'].includes(value.state);
 const names = {input:'Teclado y trackpad',screen:'Pantalla principal',music:'Música',slides:'Diapositivas',power:'Energía'};

 if (widgets && document.body.dataset.surface !== 'bar') {
  pane = document.createElement('div');
  pane.className = 'phone-control-tool';
  pane.innerHTML = `
   <div id="remote-start-row"><button id="remote-start" class="widget-primary" type="button">Vincular teléfono</button></div>
   <div id="remote-qr" hidden><img alt="QR para vincular el teléfono" width="125" height="125"><p>Escanea desde la misma red.</p></div>
   <form id="remote-review" hidden>
    <label for="remote-code">Código del teléfono</label><input id="remote-code" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" required>
    <fieldset><legend>Permitir</legend>${Object.entries(names).map(([scope,title]) => `<label><input type="checkbox" value="${scope}">${title}</label>`).join('')}</fieldset>
    <button class="widget-primary" type="submit">Autorizar</button>
   </form>
   <div id="remote-connected" hidden><strong>Teléfono conectado</strong><p id="remote-scopes"></p></div>
   <div id="remote-power" hidden><p id="remote-power-question"></p><div><button type="button" id="remote-reject">Rechazar</button><button type="button" id="remote-accept">Confirmar</button></div></div>
   <button type="button" id="remote-stop" hidden>Terminar conexión</button>
   <p id="remote-feedback" class="widget-feedback" role="status"></p>`;
  if (!widgets.addTool('phone-control', 'Control móvil', pane)) pane = null;
 }
 const $ = selector => pane?.querySelector(selector);
 let notice='';
 const feedback = text => { notice=text;if (pane) $('#remote-feedback').textContent = t(text); };

 function paint() {
  if (tool) {
   tool.dataset.phoneControl = value.state === 'active' ? 'active' : value.state === 'review' ? 'review' : 'idle';
   tool.dataset.phonePower = String(Boolean(value.power));
  }
  if (!pane) return;
  const waiting = value.state === 'waiting', review = value.state === 'review';
  $('#remote-start-row').hidden = active();
  $('#remote-start').disabled = busy || value.available === false;
  $('#remote-qr').hidden = !waiting;
  const image = $('#remote-qr img');
  if (waiting && typeof value.qr === 'string' && value.qr.startsWith('data:image/png;base64,')) {
   if (image.getAttribute('src') !== value.qr) image.src = value.qr;
  } else image.removeAttribute('src');
  $('#remote-review').hidden = !review;
  $('#remote-review button').disabled = busy;
  if (!review) {
   $('#remote-code').value = '';
   for (const input of pane.querySelectorAll('#remote-review input[type="checkbox"]')) input.checked = false;
  }
  $('#remote-connected').hidden = value.state !== 'active';
  $('#remote-scopes').textContent = (value.scopes || []).map(scope => t(names[scope])).filter(Boolean).join(' · ');
  $('#remote-power').hidden = !value.power;
  if (value.power) {
   const label = value.power.action === 'shutdown' ? 'Apagar el PC' : 'Bloquear el PC';
   $('#remote-power-question').textContent = t('¿{action}? El teléfono lo solicitó.').replace('{action}',t(label));
   $('#remote-accept').textContent = t(value.power.action === 'shutdown' ? 'Apagar' : 'Bloquear');
  }
  $('#remote-accept').disabled = $('#remote-reject').disabled = busy;
  $('#remote-stop').hidden = !active();
  $('#remote-stop').disabled = busy;
 }

 function receive(next) {
  if (!next || !Number.isSafeInteger(next.revision) || next.revision < value.revision) return;
  const changed = next.state !== value.state;
  value = next; paint();
  if (changed) feedback(next.state === 'expired' ? 'La conexión caducó.' : '');
 }

 async function refresh() {
  if (refreshBusy || !api()?.workspace_phone_control_state) return;
  refreshBusy = true;
  try { receive(await api().workspace_phone_control_state()); }
  catch (error) { feedback(error.message || 'El control móvil no está disponible.'); }
  finally { refreshBusy = false; }
 }

 async function act(method, ...args) {
  if (busy) return;
  if (typeof api()?.[method] !== 'function') { feedback('Abre Control móvil desde Brivany Desktop.'); return; }
  busy = true; feedback(''); paint();
  try { receive(await api()[method](...args)); }
  catch (error) { feedback(error.message || 'El PC no aceptó la solicitud.'); }
  finally { busy = false; paint(); }
 }

 if (pane) {
  $('#remote-start').onclick = () => act('workspace_phone_control_start');
  $('#remote-stop').onclick = () => act('workspace_phone_control_stop');
  $('#remote-review').onsubmit = event => {
   event.preventDefault();
   const scopes = [...pane.querySelectorAll('#remote-review input[type="checkbox"]:checked')].map(input => input.value);
   if (!scopes.length) { feedback('Elige al menos un permiso.'); return; }
   act('workspace_phone_control_approve', $('#remote-code').value, scopes);
  };
  $('#remote-reject').onclick = () => act('workspace_phone_control_power', value.power?.id, false);
  $('#remote-accept').onclick = () => act('workspace_phone_control_power', value.power?.id, true);
  const onTab = event => { if (event.detail?.id === 'phone-control') refresh(); };
  window.addEventListener('brivany-widget-tab', onTab);
  window.addEventListener('pagehide', () => window.removeEventListener('brivany-widget-tab', onTab), {once:true});
 }
 window.BrivanyPhoneControl = {receive};
 const localize=()=>{paint();feedback(notice);};
 window.addEventListener('brivany-workspace-locale',localize);
 window.addEventListener('pagehide',()=>window.removeEventListener('brivany-workspace-locale',localize),{once:true});
 paint();
})();
