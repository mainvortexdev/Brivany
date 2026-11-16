/* Worker side of the silent timeline: one desktop session per YouTube tab.
 * Sends captions (with word onsets) and the playback clock to Brivany's
 * selected-video hub as a timeline-only selection. Never audio, never UI.
 * If Brivany is closed, it retries quietly on the next update.
 */
import {connectDesktop,reply} from './desktop-connect.js';

const BATCH = 8, POSITION_EVERY_MS = 250, RETRY_MS = 15000;

/* Small local diagnostics ring (chrome.storage.local, this browser only):
 * event names, counts and error kinds; never caption text, tokens or audio. */
export class TimelineDiagnostics {
 constructor(storage = globalThis.chrome?.storage?.local, now = () => Date.now()) { this.storage = storage; this.now = now; this.events = []; this.timer = null; }
 record(event, detail = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(detail || {}).slice(0, 8)) if (/^[a-z_]{1,24}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' && v.length <= 40)) safe[k] = v;
  this.events.push({at: new Date(this.now()).toISOString(), event: String(event).slice(0, 32), ...safe});
  if (this.events.length > 60) this.events.splice(0, this.events.length - 60);
  if (!this.timer && this.storage) this.timer = setTimeout(() => { this.timer = null; try { this.storage.set({timelineDiagnostics: this.events}); } catch {} }, 1000);
 }
}
export const diagnostics = new TimelineDiagnostics();

export function captionBatches(cues) {
 const clean = cues.filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.end - c.start <= 30 &&
  typeof c.text === 'string' && c.text.trim()).slice(0, 4000).map(c => {
   const cue = {start: c.start, end: c.end, text: c.text.slice(0, 400), speaker: null};
   if (Array.isArray(c.words)) cue.words = c.words.filter(w => Array.isArray(w) && Number.isFinite(w[0]) && typeof w[1] === 'string' &&
    w[0] >= c.start - .05 && w[0] <= c.end + .05).slice(0, 120).map(w => [w[0], w[1].slice(0, 80)]);
   return cue;
  });
 const batches = [];
 for (let i = 0; i < clean.length; i += BATCH) batches.push({type: 'captions', cues: clean.slice(i, i + BATCH), done: i + BATCH >= clean.length});
 return batches;
}

export class TimelineSession {
 constructor({connect = connectDesktop, socketFactory = url => new WebSocket(url), now = () => Date.now(), diag = diagnostics} = {}) {
  this.connect = connect; this.socketFactory = socketFactory; this.now = now; this.diag = diag;
  this.video = null; this.cues = null; this.socket = null; this.opening = null; this.lastPosition = 0; this.paused = null; this.failedAt = null; this.signature = null;
 }
 close() { try { this.socket?.close(); } catch {} this.socket = null; this.opening = null; }
 async open() {
  if (this.opening) return this.opening;
  if (this.failedAt !== null && this.now() - this.failedAt < RETRY_MS) return null;
  const video = this.video, cues = this.cues;
  this.opening = (async () => {
   let step = 'connect';
   try {
    const grant = await this.connect();
    step = 'protocol';
    if (grant.selected_video_protocol !== 2) throw Error('protocol');
    const socket = this.socketFactory(grant.video_url);
    step = 'authenticate';
    await reply(socket, {type: 'authenticate', token: grant.token}, 'authenticated');
    step = 'select';
    await reply(socket, {type: 'select', selection: 'timeline-' + video + '-' + Math.random().toString(36).slice(2, 10),
     source: 'youtube:' + video, has_captions: true, timeline_only: true}, 'selected');
    if (video !== this.video) { socket.close(); return null; }
    for (const batch of captionBatches(cues)) socket.send(JSON.stringify(batch));
    socket.addEventListener('close', () => { if (this.socket === socket) this.socket = null; });
    this.socket = socket; this.paused = null; this.lastPosition = 0;
    this.diag.record('desktop_connected', {cues: cues.length});
    return socket;
   } catch (error) { this.failedAt = this.now(); this.diag.record('desktop_failed', {step, reason: String(error?.message || error).slice(0, 40)}); return null; }
   finally { this.opening = null; }
  })();
  return this.opening;
 }
 receive(message) {
  if (message.type === 'diag') { this.diag.record(message.event, message.detail); return; }
  if (message.type === 'video') {
   if (message.video !== this.video) this.diag.record('video', {});
   if (message.video !== this.video) { this.close(); this.video = message.video; this.cues = null; this.signature = null; }
   return;
  }
  if (message.type === 'captions') {
   const signature = message.video + ':' + message.cues.length + ':' + message.cues[0]?.start;
   if (signature === this.signature && this.socket) return;
   if (message.video !== this.video || this.signature !== signature) { this.close(); this.video = message.video; }
   this.cues = message.cues; this.signature = signature; this.failedAt = null;
   this.diag.record('captions', {cues: message.cues.length, words: message.cues.some(c => Array.isArray(c.words))});
   this.open();
   return;
  }
  if (message.type === 'position' && message.video === this.video && this.cues) {
   if (!this.socket) { this.open(); return; }
   if (this.socket.readyState !== 1) return;
   if (message.paused !== this.paused) { this.paused = message.paused; this.socket.send(JSON.stringify({type: 'media-state', paused: message.paused})); }
   const now = this.now();
   if (now - this.lastPosition >= POSITION_EVERY_MS || message.paused) {
    this.lastPosition = now; this.socket.send(JSON.stringify({type: 'position', position: message.position}));
   }
  }
 }
}

export function listenForTimelines(runtime = chrome.runtime, factory = () => new TimelineSession()) {
 diagnostics.record('worker_started', {});
 runtime.onConnect.addListener(port => {
  if (port.name !== 'brivany-timeline' || port.sender?.id !== runtime.id || !/^https:\/\/www\.youtube\.com\//.test(port.sender?.url || '')) return;
  diagnostics.record('tab_connected', {});
  const session = factory();
  port.onMessage.addListener(message => { try { session.receive(message); } catch {} });
  port.onDisconnect.addListener(() => session.close());
 });
}
