(() => {
 'use strict';
 const $ = selector => document.querySelector(selector);
 const $all = selector => [...document.querySelectorAll(selector)];
 const token = location.hash.slice(1);
 if (location.hash) history.replaceState(null, '', location.pathname);

 let state = {state:'idle', scopes:[], paused:false};
 let sequence = 0, view = 'desktop', statusTimer = 0, frameTimer = 0;
 let showingScreen = false, frameBusy = false, frameEpoch = 0, frameURL = '', frameAt = 0;
 let sending = false, moveTimer = 0, dx = 0, dy = 0, scroll = 0;
 let stop = false, statusBusy = false;
 const queue = [];
 const contacts = new Map();
 let moved = false, multi = false;

 function message(value) { $('#status').textContent = value || ''; }
 const has = scope => state.scopes?.includes(scope);
 const active = () => state.state === 'active' && !stop;
 const canSend = () => active() && !state.paused && !document.hidden;

 async function request(path, options = {}) {
  const response = await fetch(path, {credentials:'same-origin', cache:'no-store', ...options});
  if (!response.ok) {
   let value;
   try { value = await response.json(); } catch {}
   const error = new Error(value?.error || 'No se pudo conectar con el PC.');
   error.status = response.status;
   throw error;
  }
  return response;
 }

 function stopScreen() {
  showingScreen = false; frameEpoch++; frameAt = 0;
  clearTimeout(frameTimer);
  $('#screen-wrap').hidden = true;
  $('#screen').removeAttribute('src');
  if (frameURL) URL.revokeObjectURL(frameURL);
  frameURL = '';
  $('#screen-toggle').textContent = 'Ver pantalla';
 }

 function clearInput() {
  contacts.clear(); queue.length = 0;
  dx = dy = scroll = 0;
  clearTimeout(moveTimer); moveTimer = 0;
  delete $('#trackpad').dataset.touch;
 }

 function paint() {
  $('#pairing').hidden = active();
  $('#controls').hidden = !active();
  $('#disconnect').hidden = !active() && state.state !== 'review';
  $('#pair-code').hidden = state.state !== 'review';
  if (state.state === 'review') {
   $('#pair-help').textContent = 'Introduce este código en Brivany.';
   $('#pair-code').textContent = state.code || '';
   $('#claim').hidden = true;
  }
  if (!active()) return;
  const allowed = {desktop:has('input') || has('screen'),music:has('music'),slides:has('slides'),power:has('power')};
  if (!allowed[view]) view = Object.keys(allowed).find(key => allowed[key]);
  for (const button of $all('nav button')) {
   button.hidden = !allowed[button.dataset.view];
   button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  for (const pane of $all('[data-pane]')) {
   pane.hidden = pane.dataset.pane !== view;
   pane.inert = state.paused;
  }
  $('#input-tools').hidden = !has('input');
  $('#screen-tools').hidden = !has('screen');
 }

 function end(text) {
  stop = true; state = {state:'ended',scopes:[]};
  clearTimeout(statusTimer); stopScreen(); clearInput();
  $('#pair-help').textContent = 'Escanea un nuevo QR en el PC.';
  $('#claim').hidden = true;
  message(text); paint();
 }

 async function poll() {
  clearTimeout(statusTimer);
  if (stop || document.hidden || statusBusy) return;
  statusBusy = true;
  try {
   const value = await (await request('/state')).json();
   if (stop) return;
   const wasPaused = state.paused;
   state = value; sequence = Math.max(sequence, value.seq || 0);
   if (state.paused) {
    clearInput(); stopScreen(); message('Espera la decisión en el PC.');
   } else if (wasPaused) message('');
   paint();
  } catch (error) {
   if (stop) return;
   if (state.state !== 'idle') end(error.status === 403 ? 'Conexión finalizada.' : 'Conexión interrumpida.');
  } finally {
   statusBusy = false;
   if (!stop && !document.hidden && state.state !== 'idle') statusTimer = setTimeout(poll, 1400);
  }
 }

 $('#claim').onclick = async () => {
  $('#claim').disabled = true;
  try {
   state = await (await request('/claim', {method:'POST', headers:{Authorization:'Bearer ' + token}})).json();
   message(''); paint(); poll();
  } catch (error) { message(error.message); }
  finally { $('#claim').disabled = false; }
 };
 $('#disconnect').onclick = async () => {
  $('#disconnect').disabled = true;
  try { await request('/disconnect', {method:'POST'}); end('Teléfono desconectado.'); }
  catch (error) {
   if (error.status === 403) end('Conexión finalizada.');
   else message('No se confirmó la desconexión. Puedes terminarla desde Brivany.');
  } finally { $('#disconnect').disabled = false; }
 };

 async function drain() {
  if (sending || !canSend()) return;
  sending = true;
  try {
   while (canSend() && queue.length) {
    const {kind, value} = queue.shift();
    const result = await (await request('/action', {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({seq:++sequence,kind,value})})).json();
    if (stop) return;
    if (result.pending) {
     state.paused = true; stopScreen(); clearInput(); paint(); message('Espera la decisión en el PC.');
    } else message('');
   }
  } catch (error) {
   if (stop) return;
   if (!error.status) { end('Conexión interrumpida.'); return; }
   message(error.message);
   clearInput();
   if (error.status === 403 || error.status === 409) poll();
  } finally { sending = false; }
 }

 function send(kind, value) {
  if (!canSend() || queue.length >= 5) return false;
  queue.push({kind,value}); drain(); return true;
 }

 const clamp = (n, limit) => Math.min(limit, Math.max(-limit, Math.round(n)));
 function flushMovement() {
  moveTimer = 0;
  if (!canSend()) return;
  if (Math.abs(scroll) >= 14) {
   const ticks = clamp(scroll / 18, 5); scroll = 0;
   if (ticks) send('scroll', {ticks});
  }
  const x = clamp(dx, 240), y = clamp(dy, 240);
  dx = dy = 0;
  if (x || y) send('move', {x,y});
 }

 const trackpad = $('#trackpad');
 trackpad.onpointerdown = event => {
  if (!canSend() || !has('input') || contacts.size >= 2 || event.button !== 0) return;
  if (!contacts.size) { moved = false; multi = false; }
  if (contacts.size === 1) { multi = true; dx = dy = 0; }
  contacts.set(event.pointerId, {x:event.clientX,y:event.clientY});
  trackpad.setPointerCapture(event.pointerId);
  trackpad.dataset.touch = 'true';
 };
 trackpad.onpointermove = event => {
  const prior = contacts.get(event.pointerId);
  if (!prior || !canSend()) return;
  const x = event.clientX - prior.x, y = event.clientY - prior.y;
  if (Math.abs(x) + Math.abs(y) >= 2) moved = true;
  contacts.set(event.pointerId, {x:event.clientX,y:event.clientY});
  if (contacts.size > 1) scroll += y / 2;
  else if (!multi) { dx += x * 1.35; dy += y * 1.35; }
  if (!moveTimer) moveTimer = setTimeout(flushMovement, 52);
 };
 function release(event, canceled = false) {
  if (!contacts.delete(event.pointerId)) return;
  if (contacts.size) return;
  delete trackpad.dataset.touch;
  clearTimeout(moveTimer); flushMovement();
  if (!canceled && !moved) send('click', {button:multi?'right':'left'});
 }
 trackpad.onpointerup = event => release(event);
 trackpad.onpointercancel = event => release(event, true);
 trackpad.onlostpointercapture = event => release(event, true);

 async function frame() {
  if (frameBusy || !showingScreen || !canSend() || view !== 'desktop') return;
  frameBusy = true;
  const epoch = frameEpoch;
  try {
   const response = await request('/frame');
   const blob = await response.blob();
   if (epoch !== frameEpoch || !showingScreen || !canSend()) return;
   const next = URL.createObjectURL(blob);
   $('#screen').src = next; $('#screen-wrap').hidden = false;
   if (frameURL) URL.revokeObjectURL(frameURL);
   frameURL = next; frameAt = Date.now();
  } catch (error) {
   if (stop) return;
   if (!error.status) end('Conexión interrumpida.');
   else if (error.status === 403 || error.status === 409) { stopScreen(); poll(); }
   else if (error.status !== 429) message(error.message);
  } finally {
   frameBusy = false;
   if (showingScreen && canSend()) frameTimer = setTimeout(frame, 550);
  }
 }
 $('#screen-toggle').onclick = () => {
  if (showingScreen) { stopScreen(); return; }
  if (!canSend() || !has('screen')) return;
  showingScreen = true;
  $('#screen-toggle').textContent = 'Pausar pantalla';
  frame();
 };
 $('#screen').onclick = event => {
  if (!has('input') || Date.now() - frameAt > 1800 || !$('#screen').complete) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const toPoint = value => Math.max(0, Math.min(65535, Math.round(value * 65535)));
  if (rect.width && rect.height) send('tap-screen',{x:toPoint((event.clientX-rect.left)/rect.width),y:toPoint((event.clientY-rect.top)/rect.height)});
 };

 for (const button of $all('nav button')) button.onclick = () => {
  view = button.dataset.view; stopScreen(); clearInput(); paint();
 };
 for (const button of $all('[data-click]')) button.onclick = () => send('click',{button:button.dataset.click});
 for (const button of $all('[data-key]')) button.onclick = () => send('key',{key:button.dataset.key});
 for (const button of $all('[data-music]')) button.onclick = () => send('music',{key:button.dataset.music});
 for (const button of $all('[data-slide]')) button.onclick = () => send('slides',{key:button.dataset.slide});
 for (const button of $all('[data-power]')) button.onclick = () => send('power',{action:button.dataset.power});
 $('#typing').onsubmit = event => {
  event.preventDefault();
  if (send('text',{text:$('#text').value})) $('#text').value = '';
 };
 document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(statusTimer); clearInput(); stopScreen(); }
  else poll();
 });
 window.addEventListener('pagehide', () => { clearTimeout(statusTimer); clearInput(); stopScreen(); }, {once:true});

 if (/^[A-Za-z0-9_-]{43}$/.test(token)) $('#claim').hidden = false;
 else poll();
 paint();
})();
