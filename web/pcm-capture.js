/* Mono PCM16 LE, 24 kHz, frames of 80 ms. Runs only after explicit microphone start. */
class BrivanyPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Int16Array(1920); this.index = 0;
    this.phase = 0; this.sum = 0; this.count = 0; this.muted = false; this.detectSpeech = false;
    this.port.onmessage = event => { this.muted = event.data.muted === true; this.detectSpeech = event.data.detectSpeech === true; };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.sum += value / channels.length; this.count++;
      this.phase += 24000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        // With echo cancellation confirmed, the main thread may inspect a
        // short local pre-roll to let the user interrupt. It still sends
        // silence upstream until a sustained input onset is detected.
        const sample = this.muted && !this.detectSpeech ? 0 : Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.index++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.index === this.frame.length) {
          // DataView makes the wire format explicitly little-endian.
          const buffer = new ArrayBuffer(this.frame.length * 2), view = new DataView(buffer);
          for (let j = 0; j < this.frame.length; j++) view.setInt16(j * 2, this.frame[j], true);
          this.port.postMessage(buffer, [buffer]); this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("brivany-pcm", BrivanyPCM);
