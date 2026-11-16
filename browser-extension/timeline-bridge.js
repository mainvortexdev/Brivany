/* Isolated-world relay: page timeline messages -> extension worker. No UI. */
(() => {
 'use strict';
 if (globalThis.__brivanyTimelineBridge) return;
 globalThis.__brivanyTimelineBridge = true;
 const TAG = 'brivany-timeline';
 let port = null;
 const connect = () => {
  try { port = chrome.runtime.connect({ name: TAG }); port.onDisconnect.addListener(() => { port = null; }); } catch { port = null; }
  return port;
 };
 const valid = data => {
  if (!data || data.__brivany !== TAG || typeof data.video !== 'string' || !/^[\w-]{11}$/.test(data.video)) return false;
  if (data.type === 'video') return true;
  if (data.type === 'diag') return typeof data.event === 'string' && /^[a-z_]{1,32}$/.test(data.event) && data.detail && typeof data.detail === 'object';
  if (data.type === 'position') return Number.isFinite(data.position) && data.position >= 0 && data.position <= 604800 && typeof data.paused === 'boolean';
  if (data.type === 'captions') return Array.isArray(data.cues) && data.cues.length > 0 && data.cues.length <= 4000;
  return false;
 };
 window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || !valid(event.data)) return;
  const { __brivany, ...message } = event.data;
  try { (port || connect())?.postMessage(message); } catch { port = null; }
 });
})();
