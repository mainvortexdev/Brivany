/* Silent YouTube timeline: captions (with word onsets) + playback clock.
 * Runs in the page (MAIN world) at document_start. No UI, no overlay, no
 * playback/volume changes. It only reads the caption reply that YouTube's own
 * player receives; if the viewer has captions off, it loads them briefly with
 * the caption window hidden and restores the viewer's setting.
 * Messages go to timeline-bridge.js through window.postMessage (same origin).
 */
(() => {
 'use strict';
 if (globalThis.__brivanyTimeline) return;
 const TAG = 'brivany-timeline', MAX_CUES = 4000, MAX_WORDS = 120;
 const post = message => { try { window.postMessage({ __brivany: TAG, ...message }, location.origin); } catch {} };

 // ---- caption parsing (json3) -------------------------------------------
 const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
 const isNoise = text => !text || /^[\s♪♫♬]+$|^\[(?:music|música|musique|applause|aplausos|risas|laughter)\]$/i.test(text);
 // Auto captions carry word onsets: group them into short phrases at pauses.
 function parseJson3(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const words = [], blocks = [];
  let hasOffsets = false;
  for (const event of events) {
   if (!Array.isArray(event.segs) || !Number.isFinite(event.tStartMs) || event.aAppend) continue;
   const start = event.tStartMs / 1000, duration = Number.isFinite(event.dDurationMs) ? event.dDurationMs / 1000 : 0;
   if (event.segs.some(seg => Number.isFinite(seg.tOffsetMs))) hasOffsets = true;
   const text = clean(event.segs.map(seg => seg.utf8 || '').join(''));
   if (!isNoise(text)) blocks.push({ start, end: start + duration, text });
   for (const seg of event.segs) {
    const word = clean(seg.utf8);
    if (!word || isNoise(word)) continue;
    words.push({ t: start + (Number.isFinite(seg.tOffsetMs) ? seg.tOffsetMs / 1000 : 0), text: word });
   }
  }
  if (!hasOffsets) {
   return blocks.filter(b => b.end > b.start && b.end - b.start <= 30).slice(0, MAX_CUES)
    .map(b => ({ start: b.start, end: b.end, text: b.text.slice(0, 400), speaker: null }));
  }
  words.sort((a, b) => a.t - b.t);
  const cues = []; let current = [];
  const flush = next => {
   if (!current.length) return;
   const last = current[current.length - 1];
   const end = Math.min(Number.isFinite(next) ? next : last.t + .6, last.t + 1.2);
   cues.push({ start: current[0].t, end: Math.max(end, current[0].t + .3), text: current.map(w => w.text).join(' ').slice(0, 400),
    speaker: null, words: current.slice(0, MAX_WORDS).map(w => [Math.round(w.t * 1000) / 1000, w.text.slice(0, 80)]) });
   current = [];
  };
  for (let i = 0; i < words.length; i++) {
   const word = words[i], previous = current[current.length - 1];
   const gap = previous ? word.t - previous.t : 0;
   if (previous && (gap > .7 || current.length >= 14 || word.t - current[0].t > 6 || /[.!?]$/.test(previous.text))) flush(word.t);
   current.push(word);
  }
  flush(null);
  return cues.slice(0, MAX_CUES);
 }

 // ---- capture the player's own caption reply ------------------------------
 const captured = new Map();
 const videoIdOf = url => { try { return new URL(url, location.origin).searchParams.get('v'); } catch { return null; } };
 // Diagnostics: event names and counts only, never caption text.
 const diag = (event, detail = {}) => post({ type: 'diag', video: detail.video || lastId || '00000000000', event, detail });
 const refetched = new Set();
 function refetchOriginal(url, reason) {
  // Same signed player URL without the translation / with json3: the
  // signature does not cover tlang or fmt, and the pot token stays valid.
  let address; try { address = new URL(url, location.origin); } catch { return; }
  const id = address.searchParams.get('v'); if (!id || refetched.has(id) || captured.has(id)) return;
  refetched.add(id); address.searchParams.delete('tlang'); address.searchParams.set('fmt', 'json3');
  diag('refetch', { video: id, reason });
  nativeFetch.call(window, address.href, { credentials: 'include' }).then(r => r.text()).then(text => receive(address.href, text, true)).catch(() => diag('refetch_failed', { video: id }));
 }
 function receive(url, body, retried = false) {
  if (!String(url).includes('/api/timedtext')) return;
  const id = videoIdOf(url); if (!id || captured.has(id)) return;
  let params; try { params = new URL(url, location.origin).searchParams; } catch { return; }
  // YouTube's own machine-translated captions (tlang) are not the speech:
  // Brivany must translate the original words, never a translation.
  if (params.get('tlang')) { diag('translated_track', { video: id }); if (!retried) refetchOriginal(url, 'tlang'); return; }
  let data; try { data = JSON.parse(body); } catch { diag('caption_reply', { video: id, bytes: String(body || '').length, json: false, fmt: params.get('fmt') || '' }); if (!retried && body) refetchOriginal(url, 'format'); return; }
  const cues = parseJson3(data);
  diag('caption_reply', { video: id, bytes: String(body).length, json: true, cues: cues.length, kind: params.get('kind') || '' });
  if (!cues.length) return;
  captured.set(id, cues);
  if (id === lastId) lastCaptionPost = performance.now();
  post({ type: 'captions', video: id, language: new URL(url, location.origin).searchParams.get('lang') || '', cues });
 }
 const nativeFetch = window.fetch;
 window.fetch = async function (...args) {
  const reply = await nativeFetch.apply(this, args);
  try { const url = String(args[0]?.url || args[0]); if (url.includes('/api/timedtext')) reply.clone().text().then(text => receive(url, text)).catch(() => {}); } catch {}
  return reply;
 };
 const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__brivanyUrl = String(url); return open.call(this, method, url, ...rest); };
 XMLHttpRequest.prototype.send = function (...args) {
  if (this.__brivanyUrl?.includes('/api/timedtext')) this.addEventListener('load', () => { try { receive(this.__brivanyUrl, this.responseText); } catch {} });
  return send.apply(this, args);
 };

 // ---- make sure the player requests captions (hidden if the viewer has them off)
 const player = () => document.getElementById('movie_player');
 const adShowing = () => Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'));
 let hideStyle = null;
 const hideCaptions = on => {
  if (on && !hideStyle) { hideStyle = document.createElement('style'); hideStyle.textContent = '.ytp-caption-window-container{visibility:hidden!important}'; document.documentElement.append(hideStyle); }
  if (!on && hideStyle) { hideStyle.remove(); hideStyle = null; }
 };
 const requested = new Set();
 function requestCaptions(id) {
  const p = player(); if (!p || requested.has(id) || captured.has(id) || adShowing()) return;
  let tracks = [];
  try { tracks = (p.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse)?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []; } catch {}
  if (!tracks.length) { if (!requested.has('none:' + id)) { requested.add('none:' + id); diag('no_tracks', { video: id }); } return; }
  requested.add(id);
  const track = tracks.find(t => t.kind === 'asr') || tracks[0];
  let viewerHadCaptions = false;
  try { const current = p.getOption?.('captions', 'track'); viewerHadCaptions = Boolean(current && current.languageCode); } catch {}
  diag('tracks', { video: id, count: tracks.length, asr: tracks.some(t => t.kind === 'asr'), viewer_on: viewerHadCaptions });
  if (viewerHadCaptions) return;  // the player already requests them itself
  hideCaptions(true);
  try { p.loadModule?.('captions'); p.setOption?.('captions', 'track', { languageCode: track.languageCode }); } catch {}
  const deadline = Date.now() + 5000;
  const restore = () => {
   if (!captured.has(id) && Date.now() < deadline) { setTimeout(restore, 150); return; }
   if (!captured.has(id)) diag('no_caption_reply', { video: id });
   try { p.setOption?.('captions', 'track', {}); p.unloadModule?.('captions'); } catch {}
   setTimeout(() => hideCaptions(false), 300);
  };
  setTimeout(restore, 150);
 }

 // ---- playback clock --------------------------------------------------------
 let lastId = null, lastSent = 0, lastPaused = null, lastCaptionPost = 0;
 function tick() {
  const p = player(); const video = document.querySelector('#movie_player video') || document.querySelector('video');
  let id = null; try { id = p?.getVideoData?.()?.video_id || null; } catch {}
  if (!id || !/^[\w-]{11}$/.test(id) || !video) return;
  if (id !== lastId) { lastId = id; lastPaused = null; lastCaptionPost = 0; post({ type: 'video', video: id }); }
  // Re-offer the captions now and then: the extension worker may have
  // restarted (MV3) and lost them. The relay ignores an identical copy.
  if (captured.has(id) && performance.now() - lastCaptionPost > 20000) { lastCaptionPost = performance.now(); post({ type: 'captions', video: id, language: '', cues: captured.get(id) }); }
  requestCaptions(id);
  const ad = adShowing();
  const paused = video.paused || video.ended || video.seeking || ad || video.playbackRate !== 1;
  let position = video.currentTime; try { if (!ad && p?.getCurrentTime) position = p.getCurrentTime(); } catch {}
  const now = performance.now();
  if (paused !== lastPaused || now - lastSent >= 250) {
   lastPaused = paused; lastSent = now;
   post({ type: 'position', video: id, position: Math.round(position * 1000) / 1000, paused });
  }
 }
 setInterval(tick, 100);
 document.addEventListener('seeked', () => { lastSent = 0; tick(); }, true);
 document.addEventListener('play', () => { lastSent = 0; tick(); }, true);
 document.addEventListener('pause', () => { lastSent = 0; tick(); }, true);
 globalThis.__brivanyTimeline = { parseJson3 };
})();
