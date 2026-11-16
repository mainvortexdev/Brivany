import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {captionBatches, TimelineSession} from '../timeline-relay.js';

async function parser() {
 const source = await readFile(new URL('../timeline-capture.js', import.meta.url), 'utf8');
 const noop = () => {};
 const sandbox = {location: {origin: 'https://www.youtube.com'}, window: {fetch: async () => ({}), postMessage: noop}, XMLHttpRequest: function () {},
  document: {getElementById: () => null, querySelector: () => null, addEventListener: noop, createElement: () => ({}), documentElement: {append: noop}},
  setInterval: noop, setTimeout: noop, performance: {now: () => 0}, URL, Date, Math, JSON, Number, String, Array, Map, Set, Boolean, Object, RegExp};
 sandbox.XMLHttpRequest.prototype = {open: noop, send: noop};
 sandbox.globalThis = sandbox;
 vm.runInNewContext(source, sandbox);
 return sandbox.__brivanyTimeline.parseJson3;
}

test('auto captions become short phrases that keep every word onset', async () => {
 const parse = await parser();
 const cues = parse({events: [
  {tStartMs: 1000, dDurationMs: 3000, segs: [{utf8: 'we'}, {utf8: ' make', tOffsetMs: 300}, {utf8: ' chocolate', tOffsetMs: 700}]},
  {tStartMs: 2000, dDurationMs: 10, aAppend: 1, segs: [{utf8: '\n'}]},
  {tStartMs: 3500, dDurationMs: 2000, segs: [{utf8: 'today', tOffsetMs: 0}, {utf8: ' [Music]', tOffsetMs: 300}]}]});
 assert.equal(cues.length, 2, 'A pause longer than 0.7 s starts a new phrase');
 assert.equal(cues[0].text, 'we make chocolate');
 assert.equal(JSON.stringify(cues[0].words), JSON.stringify([[1, 'we'], [1.3, 'make'], [1.7, 'chocolate']]));
 assert.equal(cues[0].start, 1);
 assert.ok(cues[0].end > 1.7 && cues[0].end <= 2.9);
 assert.equal(cues[1].text, 'today', 'Music markers are not spoken');
});

test('manual captions without word timing keep their blocks', async () => {
 const parse = await parser();
 const cues = parse({events: [{tStartMs: 0, dDurationMs: 2500, segs: [{utf8: 'Hello there.'}]}, {tStartMs: 3000, dDurationMs: 1000, segs: [{utf8: '♪♪'}]}]});
 assert.equal(JSON.stringify(cues), JSON.stringify([{start: 0, end: 2.5, text: 'Hello there.', speaker: null}]));
});

test('caption batches respect the hub limits and keep word onsets inside each cue', () => {
 const cues = Array.from({length: 17}, (_, i) => ({start: i, end: i + .9, text: 'w' + i, speaker: 'ignored', words: [[i + .1, 'w' + i], [i + 5, 'outside']]}));
 const batches = captionBatches(cues);
 assert.equal(batches.length, 3); assert.equal(batches[0].cues.length, 8);
 assert.deepEqual(batches.map(b => b.done), [false, false, true]);
 assert.deepEqual(batches[0].cues[0], {start: 0, end: .9, text: 'w0', speaker: null, words: [[.1, 'w0']]});
});

class FakeSocket {
 constructor() {this.sent = []; this.readyState = 1; this.listeners = {};}
 addEventListener(name, fn) {(this.listeners[name] ||= []).push(fn);}
 removeEventListener(name, fn) {this.listeners[name] = (this.listeners[name] || []).filter(f => f !== fn);}
 send(raw) {
  this.sent.push(JSON.parse(raw));
  const message = this.sent.at(-1), answer = {authenticate: 'authenticated', select: 'selected'}[message.type];
  if (answer) queueMicrotask(() => (this.listeners.message || []).forEach(fn => fn({data: JSON.stringify({type: answer})})));
 }
 close() {this.readyState = 3;}
}

test('silent session selects a timeline-only video, sends captions then a throttled clock', async () => {
 let clock = 1000; const sockets = [];
 const session = new TimelineSession({connect: async () => ({selected_video_protocol: 2, token: 't'.repeat(20), video_url: 'ws://127.0.0.1:48217/video'}),
  socketFactory: () => {const s = new FakeSocket(); sockets.push(s); return s;}, now: () => clock});
 session.receive({type: 'video', video: 'abcdefghijk'});
 session.receive({type: 'captions', video: 'abcdefghijk', cues: [{start: 1, end: 2, text: 'hola', words: [[1.1, 'hola']]}]});
 await new Promise(resolve => setTimeout(resolve, 10));
 const sent = sockets[0].sent;
 assert.equal(sent[1].type, 'select'); assert.equal(sent[1].timeline_only, true); assert.equal(sent[1].has_captions, true);
 assert.equal(sent[1].source, 'youtube:abcdefghijk'); assert.equal('translate' in sent[1], false);
 assert.equal(sent[2].type, 'captions'); assert.equal(sent[2].done, true);
 session.receive({type: 'position', video: 'abcdefghijk', position: 1.0, paused: false});
 clock += 100; session.receive({type: 'position', video: 'abcdefghijk', position: 1.1, paused: false});
 clock += 200; session.receive({type: 'position', video: 'abcdefghijk', position: 1.3, paused: false});
 const clockMessages = sent.slice(3);
 assert.deepEqual(clockMessages, [{type: 'media-state', paused: false}, {type: 'position', position: 1}, {type: 'position', position: 1.3}]);
 assert.equal(sent.some(m => m.type === 'pcm' || m.data), false, 'Never audio');
});

test('a new video closes the previous timeline and Brivany being closed fails quietly', async () => {
 let attempts = 0; let clock = 0;
 const session = new TimelineSession({connect: async () => {attempts++; throw Error('closed');}, now: () => clock});
 session.receive({type: 'captions', video: 'abcdefghijk', cues: [{start: 1, end: 2, text: 'hola'}]});
 await new Promise(resolve => setTimeout(resolve, 5));
 session.receive({type: 'position', video: 'abcdefghijk', position: 1, paused: false});
 assert.equal(attempts, 1, 'Retries wait instead of hammering the desktop');
 clock += 16000; session.receive({type: 'position', video: 'abcdefghijk', position: 2, paused: false});
 await new Promise(resolve => setTimeout(resolve, 5));
 assert.equal(attempts, 2);
});

async function capture() {
 const source = await readFile(new URL('../timeline-capture.js', import.meta.url), 'utf8');
 const noop = () => {}, posted = [], fetched = [];
 const window = {postMessage: m => posted.push(m), fetch: async url => { fetched.push(String(url)); return {text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 900, segs: [{utf8: 'hello'}, {utf8: ' chocolate', tOffsetMs: 300}]}]}), clone() { return this; }}; }};
 function XMLHttpRequest() {} XMLHttpRequest.prototype = {open: noop, send: noop};
 const sandbox = {location: {origin: 'https://www.youtube.com'}, window, XMLHttpRequest,
  document: {getElementById: () => null, querySelector: () => null, addEventListener: noop, createElement: () => ({}), documentElement: {append: noop}},
  setInterval: noop, setTimeout: noop, performance: {now: () => 0}, URL, Date, Math, JSON, Number, String, Array, Map, Set, Boolean, Object, RegExp};
 sandbox.globalThis = sandbox; vm.runInNewContext(source, sandbox);
 return {window, posted, fetched};
}

test('a machine-translated caption reply is replaced by the original track, never used', async () => {
 const {window, posted, fetched} = await capture();
 await window.fetch('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr&tlang=es&fmt=json3&pot=x');
 await new Promise(resolve => setTimeout(resolve, 10));
 assert.equal(fetched.length, 2, 'One refetch of the original track');
 const again = new URL(fetched[1]);
 assert.equal(again.searchParams.get('tlang'), null); assert.equal(again.searchParams.get('pot'), 'x');
 const captions = posted.filter(m => m.type === 'captions');
 assert.equal(captions.length, 1); assert.equal(captions[0].cues[0].text, 'hello chocolate');
 const diags = posted.filter(m => m.type === 'diag').map(m => m.event);
 assert.ok(diags.includes('translated_track') && diags.includes('refetch') && diags.includes('caption_reply'));
 assert.equal(JSON.stringify(posted.filter(m => m.type === 'diag')).includes('chocolate'), false, 'Diagnostics never carry caption text');
});

test('diagnostics keep only short safe fields and persist locally', async () => {
 const saved = []; const {TimelineDiagnostics} = await import('../timeline-relay.js');
 const d = new TimelineDiagnostics({set: v => saved.push(v)}, () => 0);
 d.record('caption_reply', {bytes: 0, json: false, text: 'x'.repeat(100), Token: 'secret'});
 assert.equal(JSON.stringify(d.events[0]), JSON.stringify({at: '1970-01-01T00:00:00.000Z', event: 'caption_reply', bytes: 0, json: false}));
 await new Promise(resolve => setTimeout(resolve, 1100));
 assert.equal(saved.length, 1);
});
