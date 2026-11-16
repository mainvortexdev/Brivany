/* Windows communications microphone, shown only in the existing timer tool. */
(() => {
 'use strict';
 const pane = document.querySelector('#widget-pane-timer');
 const picker = document.querySelector('#widget-tool-picker');
 if (!pane || !picker) return;

 const button = document.createElement('button');
 button.id = 'widget-call-mute';
 button.type = 'button';
 button.hidden = true;
 button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6"/><path class="call-mute-slash" d="M4 4l16 16"/></svg>';
 pane.querySelector('.widget-timer-display').append(button);

 let state = null;
 let reading = false;
 let changing = false;
 let wasVisible = false;
 let disposed = false;
 const api = () => window.pywebview?.api;
 const t=source=>window.BrivanyWorkspaceLocale?.text(source)??source;
 const supported = () => typeof api()?.workspace_call_mute_state === 'function';
 const visible = () => supported() && !document.hidden && document.body.dataset.expanded === 'true' && document.body.dataset.panel === 'widgets' && picker.value === 'timer' && pane.getClientRects().length > 0;
 const message = text => window.BrivanyWorkspaceWidgets?.message(text);

 function paint() {
  button.hidden = !supported();
  const muted = state?.muted === true;
  const ready = state?.available === true;
  button.disabled = reading || changing;
  button.setAttribute('aria-pressed', String(muted));
  const label = ready ? (muted ? 'Reactivar micrófono de llamadas' : 'Silenciar micrófono de llamadas') : 'Consultar micrófono de llamadas';
  button.setAttribute('aria-label', t(label));
  button.title = ready ? t(label) + t(' · predeterminado de Windows') : t('Consultar el micrófono predeterminado de Windows para llamadas');
 }

 function receive(value) {
  if (disposed || !Number.isSafeInteger(value?.revision) || (state && value.revision < state.revision)) return;
  state = value;
  paint();
 }

 async function refresh(explicit = false) {
  if (disposed || !visible() || reading || changing) return;
  reading = true;
  paint();
  try {
   const value = await api().workspace_call_mute_state();
   receive(value);
   if (explicit) message(value.message || '');
  } catch {
   if (explicit) message('No se pudo consultar el micrófono de llamadas.');
  } finally {
   reading = false;
   if (!disposed) paint();
  }
 }

 function visibility() {
  const current = visible();
  if (current && !wasVisible) refresh();
  wasVisible = current;
  paint();
 }

 button.onclick = async () => {
  if (!visible() || reading || changing) return;
  if (!state?.available) {
   await refresh(true);
   return;
  }
  changing = true;
  paint();
  try {
   const value = await api().workspace_call_mute_set(!state.muted, state.token);
   receive(value);
   message(value.message || '');
  } catch (error) {
   message(error.message || 'No se pudo cambiar el micrófono de llamadas.');
  } finally {
   changing = false;
   if (!disposed) paint();
  }
 };

 const focused = () => refresh();
 window.addEventListener('brivany-workspace-locale',paint);
 const events = ['pywebviewready', 'brivany-widget-tab', 'brivany-island-layout'];
 for (const event of events) window.addEventListener(event, visibility);
 window.addEventListener('focus', focused);
 document.addEventListener('visibilitychange', visibility);
 window.addEventListener('pagehide', () => {
  disposed = true;
  window.removeEventListener('brivany-workspace-locale',paint);
  for (const event of events) window.removeEventListener(event, visibility);
  window.removeEventListener('focus', focused);
  document.removeEventListener('visibilitychange', visibility);
 }, {once: true});
 window.BrivanyCallMute = {receive};
 visibility();
})();
