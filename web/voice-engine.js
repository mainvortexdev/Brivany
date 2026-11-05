/* Audio efímero. Voz local o Melodi; transcripción local opcional o Muse con permiso. */
"use strict";
window.BrivanyVoice = (() => {
  class VoiceOutput {
    constructor(onState, onError = () => {}) {
      this.onState = onState; this.token = 0; this.timer = null; this.speaking = false;
      this.remote = window.BrivanyLive ? new BrivanyLive.MelodiOutput(value => { this.speaking = value; this.onState(value); }, onError) : null;
    }
    voices(language = "es") { return (window.speechSynthesis?.getVoices() || []).filter(v => v.localService === true && v.lang.toLowerCase().startsWith(language)); }
    cancel() {
      this.token++; clearTimeout(this.timer); window.speechSynthesis?.cancel();
      this.remote?.cancel();
      this.speaking = false; this.onState(false);
    }
    speak(segments, { voiceURI, language = "es", rate = 1.05, quiet = false, signal } = {}) {
      this.cancel();
      if (voiceURI === "melodi-cartesia" || voiceURI === "melodi-cloudflare") return this.remote?.speak(segments, { language, rate, quiet, signal }) || false;
      const voices = this.voices(language);
      const voice = voices.find(v => v.voiceURI === voiceURI) || voices[0];
      if (!voice || !window.SpeechSynthesisUtterance) return false;
      const token = this.token;
      this.speaking = true; this.onState(true);
      let index = 0;
      const next = () => {
        if (token !== this.token) return;
        if (index >= segments.length) { this.speaking = false; this.onState(false); return; }
        const segment = segments[index++];
        const utterance = new SpeechSynthesisUtterance(segment.text);
        utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = Math.min(1.2, Math.max(0.7, rate));
        utterance.pitch = 1; utterance.volume = quiet ? 0.18 : 0.85;
        utterance.onend = () => { if (token === this.token) this.timer = setTimeout(next, segment.pauseAfter || 0); };
        utterance.onerror = () => { if (token === this.token) { this.speaking = false; this.onState(false); } };
        try { window.speechSynthesis.speak(utterance); }
        catch { if (token === this.token) { this.speaking = false; this.onState(false); } }
      };
      next(); return true;
    }
  }

  class Microphone {
    constructor({ onLevel, onTranscript, onStatus, onError, onSpeechStart = () => {}, onBargeIn = () => {} }) {
      Object.assign(this, { onLevel, onTranscript, onStatus, onError, onSpeechStart, onBargeIn });
      this.generation = 0; this.active = false; this.recognition = null; this.restartTimer = null;
      this.meter = new BrivanyContext.ActivityMeter(); this.suspended = false;
      this.transcriptionEnabled = false; this.recognitionSequence = 0; this.restartCount = 0;
    }
    supportsRecognition() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); }
    async start({ transcribe = false, language = "es-ES", threshold = 0.025, provider = "browser", live = {} } = {}) {
      this.stop(); const generation = this.generation;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no ofrece micrófono en esta dirección. Usa localhost o HTTPS.");
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error("El análisis de audio no está disponible.");
        this.stream = stream; this.audio = new Audio({ sampleRate: 24000 }); await this.audio.resume();
        if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
        this.analyser = this.audio.createAnalyser(); this.analyser.fftSize = 2048;
        this.source = this.audio.createMediaStreamSource(stream); this.source.connect(this.analyser);
        this.samples = new Float32Array(this.analyser.fftSize);
        this.meter = new BrivanyContext.ActivityMeter(threshold); this.started = performance.now();
        this.active = true; this.suspended = false; this.language = language;
        this.transcriptionEnabled = transcribe; this.restartCount = 0;
        stream.getAudioTracks().forEach(track => track.onended = () => { if (this.active) { this.stop(); this.onError("El micrófono se desconectó. La escucha está detenida."); } });
        this.interval = setInterval(() => {
          if (!this.active) return;
          this.analyser.getFloatTimeDomainData(this.samples);
          const rms = Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length);
          this.lastRms = rms;
          const at = performance.now() - this.started;
          if (!this.suspended) this.meter.sample(rms, at);
          const waveform=Array.from({length:48},(_,i)=>{let peak=0;for(let j=Math.floor(i*this.samples.length/48);j<Math.floor((i+1)*this.samples.length/48);j++)peak=Math.max(peak,Math.abs(this.samples[j]));return this.suspended?0:Math.min(1,Math.round(peak*1000)/1000);});
          this.onLevel({ rms: this.suspended ? 0 : rms, samples:waveform, at, active: !this.suspended && rms >= this.meter.threshold, summary: this.meter.summary() });
        }, 50);
        if (transcribe && provider === "muse") {
          this.live = new BrivanyLive.MuseCapture({ onTranscript: this.onTranscript, onStatus: this.onStatus, onSpeechStart: this.onSpeechStart, onBargeIn: this.onBargeIn,
            onError: message => { if (generation === this.generation) { this.stop(); this.onError(message); } } });
          const echoCancelled = stream.getAudioTracks()[0]?.getSettings?.().echoCancellation === true;
          const ready = await this.live.start(this.audio, this.source, { ...live, language, bargeIn: live.bargeIn === true && echoCancelled });
          if (!ready || generation !== this.generation) return false;
        }
        else if (transcribe) this.startRecognition();
        else this.onStatus("Medición acústica local · transcripción desactivada");
        return true;
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        if (generation === this.generation) this.stop();
        throw error;
      }
    }
    startRecognition() {
      if (!this.active || this.suspended || !this.transcriptionEnabled || this.recognition) return;
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { this.transcriptionEnabled = false; this.onError("La transcripción no está disponible aquí. Puedes escribir los fragmentos."); return; }
      const generation = this.generation, recognition = new Recognition(), batch = ++this.recognitionSequence;
      this.recognition = recognition; recognition.lang = this.language; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = event => {
        if (!this.active || this.suspended || generation !== this.generation || this.recognition !== recognition) return;
        this.restartCount = 0;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          this.onTranscript({ text: result[0].transcript, final: result.isFinal,
            id: `speech-${generation}-${batch}-${i}`, at: (performance.now() - this.started) / 1000 });
        }
      };
      recognition.onerror = event => {
        if (generation !== this.generation || this.recognition !== recognition || event.error === "aborted") return;
        if (event.error !== "no-speech") {
          this.transcriptionEnabled = false;
          this.onError("La transcripción se detuvo. El navegador no pudo completar el reconocimiento; puedes seguir escribiendo.");
        }
      };
      recognition.onend = () => {
        if (this.recognition === recognition) this.recognition = null;
        if (this.active && !this.suspended && this.transcriptionEnabled && generation === this.generation) {
          if (++this.restartCount > 3) {
            this.transcriptionEnabled = false; this.onError("La transcripción se interrumpió varias veces. Detén y reinicia la escucha cuando quieras volver a probar.");
          } else this.restartTimer = setTimeout(() => this.startRecognition(), 600);
        }
      };
      try { recognition.start(); this.onStatus("Transcripción del navegador activa · puede usar un servicio externo"); }
      catch { this.recognition = null; this.transcriptionEnabled = false; this.onError("No se pudo iniciar la transcripción. Continúa con texto."); }
    }
    suspend(value) {
      clearTimeout(this.resumeTimer);
      if (!value && this.live && this.suspended && this.active) {
        const generation = this.generation;
        this.resumeTimer = setTimeout(() => {
          if (generation !== this.generation || !this.active) return;
          this.suspended = false; this.live?.suspend(false);
        }, 400);
        return;
      }
      this.suspended = value;
      // No unir una pausa del alumno a un intervalo en que Melodi tomó la palabra.
      this.meter.onset = null; this.meter.silenceStart = null; this.meter.seenActivity = false; this.meter.last = null;
      clearTimeout(this.restartTimer);
      if (this.live) { this.live.suspend(value, { threshold: Math.max(.045, this.meter.threshold*1.8, (this.lastRms||0)*2.5) }); return; }
      if (value) { const recognition = this.recognition; this.recognition = null; recognition?.abort(); }
      else if (this.active && this.transcriptionEnabled) this.restartTimer = setTimeout(() => this.startRecognition(), 450);
    }
    stop() {
      this.generation++; this.active = false; this.transcriptionEnabled = false;
      clearInterval(this.interval); clearTimeout(this.restartTimer); clearTimeout(this.resumeTimer);
      const recognition = this.recognition; this.recognition = null; recognition?.abort();
      this.live?.stop(); this.live = null;
      this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
      this.source?.disconnect(); this.source = null;
      this.audio?.close().catch(() => {}); this.audio = null;
      this.onLevel({ rms: 0, at: 0, active: false, summary: this.meter.summary() });
    }
    async finish() {
      const live = this.live, generation = this.generation, stream = this.stream;
      this.stream = null;
      stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      if (live) await live.finish();
      if (generation === this.generation) this.stop();
    }
  }
  return { VoiceOutput, Microphone };
})();
