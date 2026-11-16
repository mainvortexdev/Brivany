/* Melodi calls and voicemail. Real dialing always follows an explicit review. */
(() => {
 'use strict';
 const widgets = window.BrivanyWorkspaceWidgets;
 if (!widgets || document.body.dataset.surface === 'bar') return;

 const pane = document.createElement('div');
 pane.className = 'telephone-tool';
 pane.innerHTML = `
  <div class="telephone-tabs" role="group" aria-label="Teléfono de Melodi">
   <button type="button" data-telephone-tab="call" aria-pressed="true">Llamar</button>
   <button type="button" data-telephone-tab="mail" aria-pressed="false">Buzón</button>
  </div>
  <div class="telephone-routing"><label>Vía<select id="telephone-channel"><option value="telephone">Teléfono</option><option value="whatsapp_client">WhatsApp</option></select></label><span id="telephone-mode" role="status" hidden>Simulación</span></div>
  <form id="telephone-form">
   <label>Número<input id="telephone-number" type="tel" autocomplete="tel" maxlength="35" placeholder="+1 809 …" required></label>
   <label>Encargo<textarea id="telephone-objective" maxlength="600" rows="2" placeholder="¿Qué quieres que resuelva Melodi?" required></textarea></label>
   <button class="widget-primary" type="submit">Revisar llamada</button>
  </form>
  <div id="telephone-review" hidden>
   <strong id="telephone-review-number"></strong><p id="telephone-review-objective"></p>
   <div class="telephone-actions"><button id="telephone-edit" type="button">Editar</button><button id="telephone-confirm" class="widget-primary" type="button">Llamar ahora</button></div>
  </div>
  <div id="telephone-progress" hidden>
   <strong id="telephone-state"></strong><p id="telephone-result"></p>
   <div class="telephone-actions"><button id="telephone-refresh" type="button">Consultar</button><button id="telephone-cancel" type="button">Colgar</button><button id="telephone-new" class="widget-primary" type="button" hidden>Nueva llamada</button></div>
  </div>
  <div id="telephone-mailbox" hidden>
   <div id="telephone-voicemails" role="list" aria-label="Mensajes de voz"></div>
   <audio id="telephone-audio" controls hidden></audio>
  </div>
  <p id="telephone-feedback" role="status" class="widget-feedback"></p>`;
 if (!widgets.addTool('telephone', 'Llamadas', pane)) return;

 const $ = selector => pane.querySelector(selector);
 const localization=window.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 const terminal = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted', 'not-found']);
 const labels = {preparing:'Conectando', dialing:'Marcando', queued:'En espera', initiated:'Marcando', ringing:'Sonando',
  'in-progress':'En llamada', completed:'Llamada terminada', busy:'Línea ocupada', 'no-answer':'Sin respuesta', failed:'No se pudo llamar',
  canceled:'Llamada cancelada', uncertain:'Estado por confirmar', interrupted:'Conexión interrumpida', 'not-found':'Llamada sin registro'};
 const storageKey = 'brivany.workspace.telephone.receipt.v1';
 let info = null, draft = null, current = null, tab = 'call';
 let channel = 'telephone', channelsLoaded = false, storedReceipts = {}, connectionVersion = 0;
 let shown = false, busy = false, polling = false, disposed = false, timer = 0, audioURL = null;
 let notice='',mailboxLabels=[];

 function feedback(text) { notice=text;$('#telephone-feedback').textContent = t(text); }
 async function invoke(method, ...args) {
  const api = window.pywebview?.api;
  if (typeof api?.[method] !== 'function') throw Error('Abre Llamadas en Brivany Desktop.');
  return api[method](...args);
 }

 function visible() {
  const body = document.body.dataset;
  return !disposed && !document.hidden && body.expanded === 'true' && body.panel === 'widgets' && pane.getClientRects().length > 0;
 }

 function remember(identifier) {
  try {
   if (identifier) localStorage.setItem(storageKey+':'+channel, identifier);
   else {localStorage.removeItem(storageKey+':'+channel);if(channel==='telephone')localStorage.removeItem(storageKey);}
  } catch {}
 }

 function stopAudio() {
  const audio = $('#telephone-audio');
  audio.pause(); audio.removeAttribute('src'); audio.hidden = true;
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = null;
 }

 function render() {
  const isCall = tab === 'call';
  const simulation = (draft || current || info)?.simulation === true;
  $('#telephone-channel').value = channel;
  $('#telephone-channel').disabled = busy || Boolean(draft || current);
  $('.telephone-routing').hidden = !isCall;
  $('#telephone-mode').hidden = !simulation;
  $('#telephone-mode').textContent = t('Simulación');
  $('#telephone-form button').textContent = t(simulation?'Revisar prueba':'Revisar llamada');
  $('#telephone-confirm').textContent = t(simulation?'Probar ahora':'Llamar ahora');
  for (const button of pane.querySelectorAll('[data-telephone-tab]')) button.setAttribute('aria-pressed', String(button.dataset.telephoneTab === tab));
  $('#telephone-form').hidden = !isCall || Boolean(draft || current);
  $('#telephone-review').hidden = !isCall || !draft;
  $('#telephone-progress').hidden = !isCall || !current;
  $('#telephone-mailbox').hidden = isCall;
  $('#telephone-form button').disabled = busy || !info?.outbound;
  $('#telephone-confirm').disabled = busy || !info?.outbound;
  $('#telephone-edit').disabled = busy;
  if (draft) {
   $('#telephone-review-number').textContent = draft.destination;
   $('#telephone-review-objective').textContent = draft.objective;
  }
  if (current) {
   const done = terminal.has(current.state);
   $('#telephone-state').textContent = t(labels[current.state] || 'Estado por confirmar');
   $('#telephone-result').textContent = current.result || current.destination || '';
   $('#telephone-refresh').hidden = done;
   $('#telephone-cancel').hidden = done;
   $('#telephone-cancel').disabled = busy || current.cancel_requested === true;
   $('#telephone-new').hidden = !done;
  }
 }

 function schedule() {
  clearTimeout(timer); timer = 0;
  if (shown && tab === 'call' && current && !terminal.has(current.state) && current.state !== 'uncertain') {
   timer = setTimeout(pull, 1800);
  }
 }

 async function pull() {
  if (!shown || !current || polling) return;
  polling = true;
  const identifier = current.id;
  try {
   const value = await invoke('workspace_telephone_status', identifier, channel);
   if (current?.id === identifier) current = value;
   feedback('');
  } catch (error) {
   feedback(error.message || 'No se pudo consultar la llamada.');
  } finally {
   polling = false;
   render(); schedule();
  }
 }

 async function connect() {
  const version=++connectionVersion;
  try {
   if(!channelsLoaded && typeof window.pywebview?.api?.workspace_telephone_channels==='function'){
    const saved=await invoke('workspace_telephone_channels');if(version!==connectionVersion||disposed)return;
    channel=saved.selected;storedReceipts=saved.receipts||{};channelsLoaded=true;
   }
   const selected=channel,next=await invoke('workspace_telephone_info', selected);
   if(version!==connectionVersion||disposed||selected!==channel)return;
   info = next;
   feedback('');
   if (!info.configured) feedback('La conexión de llamadas todavía no está configurada.');
   else if (!info.outbound && tab === 'call') feedback(info.reason || 'Las llamadas salientes aún no están habilitadas.');
   const mobileIncoming = info.incoming === 'mobile' || channel==='whatsapp_client';
   $('[data-telephone-tab="mail"]').hidden = mobileIncoming;
   if (mobileIncoming && tab === 'mail') tab = 'call';
   if (info.configured && !current && !draft) {
    let id=storedReceipts[channel];
    try { id ||= localStorage.getItem(storageKey+':'+channel)||(channel==='telephone'?localStorage.getItem(storageKey):null); } catch {}
    if (id && /^[a-f0-9-]{36}$/.test(id)) {
     current = {id, state:'uncertain',channel};
     await pull();
    }
   }
  } catch (error) { if(version!==connectionVersion||disposed)return;feedback(error.message || 'No se pudo conectar con la pasarela.'); }
  render();
 }

 async function loadMailbox() {
  const list = $('#telephone-voicemails');
  list.replaceChildren();mailboxLabels=[];
  if (!info?.voicemail) { feedback('El buzón de Melodi aún no está conectado.'); return; }
  try {
   const {messages} = await invoke('workspace_telephone_mailbox', channel);
   if (!shown || tab !== 'mail') return;
   for (const message of messages) {
    const row = document.createElement('div'), label = document.createElement('span'), play = document.createElement('button');
    row.setAttribute('role', 'listitem');
    const paintLabel=()=>{
     const date=new Intl.DateTimeFormat(localization?.current()||'es',{dateStyle:'short',timeStyle:'short'}).format(message.created*1000);
     label.textContent=`${message.caller||t('Número privado')} · ${message.seconds} s · ${date}`;
     play.textContent=t('Escuchar');
    };
    mailboxLabels.push(paintLabel);paintLabel();
    play.type = 'button';
    play.onclick = async () => {
     play.disabled = true;
     try {
      const value = await invoke('workspace_telephone_recording', message.id);
      if (!shown || tab !== 'mail') return;
      stopAudio();
      const bytes = Uint8Array.from(atob(value.audio), char => char.charCodeAt(0));
      audioURL = URL.createObjectURL(new Blob([bytes], {type:'audio/mpeg'}));
      const player = $('#telephone-audio');
      player.src = audioURL; player.hidden = false;
      await player.play().catch(() => {});
     } catch (error) { feedback(error.message || 'No se pudo abrir el mensaje.'); }
     finally { play.disabled = false; }
    };
    row.append(label, play); list.append(row);
   }
   feedback(messages.length ? '' : 'Buzón vacío.');
  } catch (error) { feedback(error.message || 'No se pudo abrir el buzón.'); }
 }

 $('#telephone-form').onsubmit = async event => {
  event.preventDefault();
  if (busy || !info?.outbound) return;
  busy = true; feedback(''); render();
  try { draft = await invoke('workspace_telephone_prepare', $('#telephone-number').value, $('#telephone-objective').value, channel); }
  catch (error) { feedback(error.message || 'No se pudo preparar la llamada.'); }
  finally { busy = false; render(); }
 };
 $('#telephone-edit').onclick = () => {
  if (!draft || busy) return;
  invoke('workspace_telephone_discard', draft.id).catch(() => {});
  draft = null; feedback(''); render(); $('#telephone-number').focus();
 };
 $('#telephone-confirm').onclick = async () => {
  if (!draft || busy || !info?.outbound || !shown) return;
  const review = draft;
  busy = true; feedback(''); render(); remember(review.id);
  try { current = await invoke('workspace_telephone_confirm', review.id); storedReceipts[channel]=review.id; }
  catch (error) {
   feedback(error.message || 'No se pudo confirmar la llamada.');
   remember(null);
  } finally { draft = null; busy = false; render(); schedule(); }
 };
 $('#telephone-refresh').onclick = pull;
 $('#telephone-cancel').onclick = async () => {
  if (!current || busy || current.cancel_requested) return;
  busy = true; render();
  try { current = await invoke('workspace_telephone_cancel', current.id, channel); }
  catch (error) { feedback(error.message || 'No se pudo detener la llamada.'); }
  finally { busy = false; render(); schedule(); }
 };
 $('#telephone-new').onclick = async () => {
  if (busy || !terminal.has(current?.state)) return;
  busy=true;render();
  try{
   if(typeof window.pywebview?.api?.workspace_telephone_forget_receipt==='function')await invoke('workspace_telephone_forget_receipt',channel);
   delete storedReceipts[channel];current = null;remember(null);feedback('');
  }catch(error){feedback(error.message)}finally{busy=false;render();}
 };
 $('#telephone-channel').onchange = async () => {
  if(busy||draft||current){render();return;}
  const selected=$('#telephone-channel').value;
  ++connectionVersion;
  busy=true;render();
  try{
   if(typeof window.pywebview?.api?.workspace_telephone_select_channel!=='function')throw Error('Actualiza Brivany para usar este canal.');
   const saved=await invoke('workspace_telephone_select_channel',selected);
   channel=saved.selected;storedReceipts=saved.receipts||{};await connect();
  }catch(error){feedback(error.message)}finally{busy=false;render();schedule();}
 };
 for (const button of pane.querySelectorAll('[data-telephone-tab]')) {
  button.onclick = () => {
   tab = button.dataset.telephoneTab; feedback('');
   if (tab === 'mail') loadMailbox();
   else { stopAudio(); if (current) pull(); }
   render(); schedule();
  };
 }

 async function visibility() {
  const next = visible();
  if (next === shown) return;
  shown = next;
  if (shown) {
   await connect();
   if (shown && tab === 'mail') loadMailbox();
   if (shown && current && !terminal.has(current.state)) pull();
  } else stopAudio();
  schedule();
 }

 function fromText(text) {
  const match = /^(?:melodi,?\s+)?llama\s+(?:por\s+(whatsapp|tel[eé]fono)\s+)?(?:al\s+|a\s+)?(?:n[uú]mero\s+)?([+(0-9][0-9 .()-]{6,34}?)\s+(?:para|y)\s+(.+)$/i.exec(text.trim());
  if (!match) return false;
  if (!busy && !draft && !current) {
   $('#telephone-number').value = match[2].trim();
   $('#telephone-objective').value = match[3];
   if(match[1]){
    const selected=match[1].toLowerCase()==='whatsapp'?'whatsapp_client':'telephone';
    if(selected!==channel){$('#telephone-channel').value=selected;$('#telephone-channel').onchange();}
   }
  }
  tab = 'call'; widgets.selectTab('telephone');
  window.BrivanyIsland?.expand('widgets');
  render();
  return true;
 }

 const events = ['brivany-widget-tab', 'brivany-island-layout'];
 const localize=()=>{render();feedback(notice);for(const paint of mailboxLabels)paint();};
 window.addEventListener('brivany-workspace-locale',localize);
 for (const event of events) window.addEventListener(event, visibility);
 document.addEventListener('visibilitychange', visibility);
 window.addEventListener('pagehide', () => {
  disposed = true; shown = false; ++connectionVersion;clearTimeout(timer); stopAudio();
  window.removeEventListener('brivany-workspace-locale',localize);
  for (const event of events) window.removeEventListener(event, visibility);
  document.removeEventListener('visibilitychange', visibility);
 }, {once:true});
 window.BrivanyTelephone = {fromText};
 render(); visibility();
})();
