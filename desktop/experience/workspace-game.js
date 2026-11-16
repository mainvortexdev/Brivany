/* The native strip owns collection. The open tool only reads its latest sample. */
(() => {
 'use strict';
 const widgets = window.BrivanyWorkspaceWidgets;
 if (!widgets || document.body.dataset.surface === 'bar') return;
 const pane = document.createElement('div');
 pane.className = 'game-tool';
 pane.innerHTML = `
  <dl class="game-metrics" aria-label="Métricas de juego">
   <div><dt>FPS</dt><dd id="game-fps">—</dd></div>
   <div><dt>CPU</dt><dd id="game-cpu">—</dd></div>
   <div><dt>GPU</dt><dd id="game-gpu">—</dd></div>
   <div><dt>RAM</dt><dd id="game-ram">—</dd></div>
  </dl>
  <div class="game-source">
   <select id="game-window" aria-label="Ventana del juego"><option value="">Solo uso del equipo</option></select>
   <button id="game-refresh" type="button" aria-label="Actualizar ventanas" title="Actualizar ventanas">↻</button>
  </div>
  <div class="game-actions">
   <button id="game-toggle" class="widget-primary" type="button">Mostrar franja</button>
   <button id="game-prepare" type="button" hidden>Preparar FPS</button>
  </div>
  <p id="game-message" class="widget-feedback" role="status"></p>`;
 if (!widgets.addTool('game', 'Juego', pane)) return;

 const $ = selector => pane.querySelector(selector);
 const select = $('#game-window'), action = $('#game-toggle'), refresh = $('#game-refresh');
 const prepare = $('#game-prepare'), message = $('#game-message');
 const names = ['fps', 'cpu', 'gpu', 'ram'];
 let active = false, busy = false, reading = false, timer = 0;
 let known = false, installed = false, supported = false;
 let state = {revision: -1, state: 'idle'};
 const native = () => window.pywebview?.api;
 const t=source=>window.BrivanyWorkspaceLocale?.text(source)??source;
 const visible = () => !document.hidden && !pane.hidden && document.body.dataset.expanded === 'true' && document.body.dataset.panel === 'widgets';

 function paint() {
  const running = state.state === 'running';
  const idle = state.state === 'idle';
  for (const key of names) {
   const value = state[key];
   const text = Number.isFinite(value) ? String(value) + (key === 'fps' ? '' : '%') : '—';
   const output = $('#game-' + key);
   if (output.textContent !== text) output.textContent = text;
  }
  const label = t(running ? 'Ocultar franja' : state.state === 'starting' ? 'Abriendo…' : idle ? 'Mostrar franja' : 'Cerrando…');
  if (action.textContent !== label) action.textContent = label;
  select.disabled = refresh.disabled = busy || !idle;
  action.disabled = busy || !(idle || running);
  prepare.hidden = !idle || !known || installed || !supported || !select.value;
  prepare.disabled = busy;
 }

 function receive(next) {
  if (!next || !Number.isSafeInteger(next.revision) || next.revision < state.revision) return;
  state = next;
  message.textContent = t(next.message || '');
  paint();
 }

 function schedule() {
  clearTimeout(timer);
  if (visible() && state.state !== 'idle') timer = setTimeout(read, 1000);
 }

 async function read() {
  if (!visible() || reading || !native()?.workspace_game_state) return;
  reading = true;
  try { receive(await native().workspace_game_state()); }
  catch { message.textContent = 'No se pudo leer la franja.'; }
  finally { reading = false; schedule(); }
 }

 async function options() {
  const {windows, ready, supported: available} = await native().workspace_game_options();
  const prior = select.value;
  select.replaceChildren(new Option(t('Solo uso del equipo'), ''));
  for (const entry of windows) select.add(new Option(entry.label, entry.id));
  if ([...select.options].some(option => option.value === prior)) select.value = prior;
  known = true;
  installed = ready === true;
  supported = available === true;
 }

 async function act(task) {
  if (busy) return;
  if (!native()?.workspace_game_state) { message.textContent = 'Disponible en Brivany Desktop.'; return; }
  busy = true;
  message.textContent = '';
  paint();
  try { await task(); }
  catch (error) { message.textContent = error.message || 'No se pudo cambiar la franja.'; }
  finally { busy = false; paint(); schedule(); }
 }

 function sync() {
  if (!visible()) { clearTimeout(timer); active = false; return; }
  if (active) return;
  active = true;
  read().then(() => { if (visible() && !known && state.state === 'idle') act(options); });
 }

 refresh.onclick = () => act(options);
 prepare.onclick = () => act(async () => { await native().workspace_game_prepare(); await options(); });
 action.onclick = () => act(async () => {
  const next = state.state === 'running' ? await native().workspace_game_stop() : await native().workspace_game_start(select.value);
  receive(next);
 });
 select.onchange = paint;
 function localize() {
  if(select.options[0]?.value==='')select.options[0].textContent=t('Solo uso del equipo');
  message.textContent=t(state.message||'');
  paint();
 }
 window.addEventListener('brivany-workspace-locale',localize);
 window.addEventListener('brivany-island-layout', sync);
 window.addEventListener('brivany-widget-tab', sync);
 document.addEventListener('visibilitychange', sync);
 window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  window.removeEventListener('brivany-island-layout', sync);
  window.removeEventListener('brivany-workspace-locale',localize);
  window.removeEventListener('brivany-widget-tab', sync);
  document.removeEventListener('visibilitychange', sync);
 }, {once: true});
 paint();
})();
