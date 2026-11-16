const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const BrivanyContext = require('../web/context-engine.js');

// No browser, microphone, speech service, or real timers are used by these tests.
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ mediaPromise, museReady } = {}) {
  const timeouts = new Map(), intervals = new Map();
  const recognitions = [], utterances = [], transcripts = [], errors = [], states = [];
  let nextTimer = 0, audioContexts = 0, trackStops = 0;
  const track = { stop() { trackStops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recognition {
    constructor() { this.aborted = false; recognitions.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; }
    result(text) {
      const result = [{ transcript: text }];
      result.isFinal = true;
      this.onresult({ resultIndex: 0, results: [result] });
    }
  }
  class AudioContext {
    constructor() { audioContexts++; }
    async resume() {}
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    close() { return Promise.resolve(); }
  }
  class Utterance { constructor(text) { this.text = text; } }
  const browser = {
    AudioContext, SpeechRecognition: Recognition, SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      getVoices: () => [{ localService: true, lang: 'es-ES', voiceURI: 'test-local-es' }],
      speak: utterance => utterances.push(utterance), cancel() {},
    },
  };
  const sandbox = {
    window: browser, SpeechSynthesisUtterance: Utterance, BrivanyContext, Float32Array,
    performance: { now: () => 1000 },
    navigator: { mediaDevices: { getUserMedia: () => mediaPromise || Promise.resolve(stream) } },
    setTimeout(callback) { const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  if (museReady !== undefined) sandbox.BrivanyLive = { MuseCapture: class {
    async start() { return museReady; }
    stop() {}
  } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/voice-engine.js'), 'utf8'), sandbox);
  const { Microphone, VoiceOutput } = browser.BrivanyVoice;
  const microphone = new Microphone({ onLevel() {}, onStatus() {},
    onTranscript: result => transcripts.push(result), onError: message => errors.push(message) });
  const voice = new VoiceOutput(state => states.push(state));
  return {
    microphone, voice, stream, timeouts, intervals, recognitions, utterances, transcripts, errors, states,
    get audioContexts() { return audioContexts; }, get trackStops() { return trackStops; },
    runNextTimeout() {
      const entry = timeouts.entries().next().value;
      assert.ok(entry, 'Expected a scheduled callback');
      timeouts.delete(entry[0]); entry[1]();
    },
  };
}

test('suspend descarta resultados tardíos del ASR abortado y acepta la nueva instancia', async () => {
  const h = harness();
  try {
    assert.equal(await h.microphone.start({ transcribe: true }), true);
    const old = h.recognitions[0];
    h.microphone.suspend(true);
    assert.equal(old.aborted, true);
    h.microphone.suspend(false);

    // A queued old event can arrive after resuming but before the replacement starts.
    old.result('texto antiguo antes del reinicio');
    assert.equal(h.transcripts.length, 0);

    h.runNextTimeout();
    assert.equal(h.recognitions.length, 2);
    old.result('texto antiguo después del reinicio');
    assert.equal(h.transcripts.length, 0);

    h.recognitions[1].result('fragmento de la instancia actual');
    assert.equal(h.transcripts.length, 1);
    assert.equal(h.transcripts[0].text, 'fragmento de la instancia actual');
  } finally { h.microphone.stop(); }
});

test('stop invalida getUserMedia pendiente y libera el stream que llega después', async () => {
  const media = deferred();
  const h = harness({ mediaPromise: media.promise });
  const pendingStart = h.microphone.start({ transcribe: true });
  h.microphone.stop();
  media.resolve(h.stream);

  assert.equal(await pendingStart, false);
  assert.equal(h.microphone.active, false);
  assert.equal(h.microphone.stream, null);
  assert.equal(h.trackStops, 1);
  assert.equal(h.audioContexts, 0);
  assert.equal(h.recognitions.length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
});

test('un inicio ASR fallido libera el micrófono y su medidor', async () => {
  const h = harness({ museReady: false });
  assert.equal(await h.microphone.start({ transcribe: true, provider: 'muse' }), false);
  assert.equal(h.microphone.active, false);
  assert.equal(h.microphone.stream, null);
  assert.equal(h.microphone.audio, null);
  assert.equal(h.trackStops, 1);
  assert.equal(h.intervals.size, 0);
});

test('voice.cancel invalida el siguiente segmento y callbacks tardíos de la frase anterior', () => {
  const h = harness();
  assert.equal(h.voice.speak([
    { text: 'Primera frase.', pauseAfter: 420 }, { text: 'Segunda frase.' },
  ]), true);
  const first = h.utterances[0];
  first.onend();
  assert.equal(h.timeouts.size, 1);
  const queuedSegment = h.timeouts.values().next().value;

  h.voice.cancel();
  assert.equal(h.voice.speaking, false);
  assert.equal(h.timeouts.size, 0);
  queuedSegment(); // Even an already queued callback cannot resurrect speech.
  first.onend();
  assert.equal(h.utterances.length, 1);
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.states.at(-1), false);

  h.voice.speak([{ text: 'Nuevo turno.' }]);
  assert.equal(h.utterances.length, 2);
  first.onerror(); // The old utterance cannot end the new turn either.
  assert.equal(h.voice.speaking, true);
  h.voice.cancel();
});
