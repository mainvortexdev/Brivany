// Codificador Opus sobre libopus compilado a WebAssembly.
//
// El módulo viene de `@evan/opus` (MIT, ver `vendor/opus-LICENSE.txt`) y se
// instancia sin runtime de emscripten: sólo necesita los cuatro huecos de WASI
// y el aviso de crecimiento de memoria. Recibe el módulo ya compilado como
// argumento para que el worker lo importe de su paquete y las pruebas lo
// carguen del archivo, sin que este módulo dependa de ninguno de los dos.

export const OPUS_SET_BITRATE = 4002;
export const OPUS_GET_LOOKAHEAD = 4027;
export const OPUS_APPLICATIONS = Object.freeze({ voip: 2048, audio: 2049, restricted_lowdelay: 2051 });

const PACKET_BUFFER = 2 ** 13;
const SAMPLE_BUFFER = 2 ** 15;

function instantiate(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('opus_module_required');
  const state = {};
  const refresh = () => {
    state.memory = new Uint8Array(state.exports.memory.buffer);
    state.packets = state.memory.subarray(state.packetPtr, state.packetPtr + PACKET_BUFFER);
    state.samples = state.memory.subarray(state.samplePtr, state.samplePtr + SAMPLE_BUFFER);
  };
  const instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: { fd_seek() {}, fd_write() {}, fd_close() {}, proc_exit() {} },
    env: { emscripten_notify_memory_growth() { refresh(); } },
  });
  state.exports = instance.exports;
  state.packetPtr = state.exports.malloc(PACKET_BUFFER);
  state.samplePtr = state.exports.malloc(SAMPLE_BUFFER);
  refresh();
  return state;
}

function readError(state, code) {
  if (code >= 0) return code;
  let text = '';
  for (let at = state.exports.opus_strerror(code); at < state.memory.length; at++) {
    const byte = state.memory[at];
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  throw Object.assign(Error('opus_encoder_failed'), { code: 'opus_encoder_failed', detail: text.slice(0, 120) });
}

/**
 * Codificador de una sola voz: un canal, 48 kHz, tramos de 20 ms.
 * `encode` recibe muestras PCM de 16 bits con signo y devuelve un paquete.
 */
export function createOpusEncoder(module, { channels = 1, sampleRate = 48_000, bitrate = 24_000, application = 'voip' } = {}) {
  if (channels !== 1 && channels !== 2) throw new TypeError('opus_invalid_channels');
  if (![8_000, 12_000, 16_000, 24_000, 48_000].includes(sampleRate)) throw new TypeError('opus_invalid_sample_rate');
  if (!Number.isInteger(bitrate) || bitrate < 6_000 || bitrate > 510_000) throw new TypeError('opus_invalid_bitrate');
  if (!Object.hasOwn(OPUS_APPLICATIONS, application)) throw new TypeError('opus_invalid_application');

  const state = instantiate(module);
  const encoder = state.exports.malloc(state.exports.opus_encoder_get_size(channels));
  readError(state, state.exports.opus_encoder_init(encoder, sampleRate, channels, OPUS_APPLICATIONS[application]));
  readError(state, state.exports.opus_encoder_ctl_set(encoder, OPUS_SET_BITRATE, bitrate));
  const preSkip = state.exports.opus_encoder_ctl_get(encoder, OPUS_GET_LOOKAHEAD);

  let released = false;
  return {
    preSkip,
    channels,
    encode(frame) {
      if (released) throw Error('opus_encoder_released');
      if (!(frame instanceof Int16Array)) throw new TypeError('opus_invalid_frame');
      const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      if (bytes.length > SAMPLE_BUFFER) throw new RangeError('opus_frame_too_large');
      state.samples.set(bytes);
      const size = readError(state, state.exports.opus_encode(encoder, state.samplePtr, frame.length / channels, state.packetPtr, PACKET_BUFFER));
      return state.packets.slice(0, size);
    },
    release() {
      if (released) return;
      released = true;
      state.exports.free(encoder);
    },
  };
}
