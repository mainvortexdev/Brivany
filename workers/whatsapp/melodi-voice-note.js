// Nota de voz de Melodi en WhatsApp, con su voz exacta.
//
// Es la misma voz seleccionada que usa en las llamadas; aquí se sintetiza una
// frase completa en lugar de un flujo. WhatsApp sólo dibuja la burbuja de nota
// de voz con un archivo Ogg/Opus de un solo canal, y el proveedor de voz no
// entrega ese formato, así que se pide sonido sin comprimir y se codifica aquí.
// El texto se prepara para que suene hablado: sin marcas de formato, enlaces ni
// listas. Una nota de voz se envía sólo cuando el titular la pide; nunca
// sustituye la respuesta escrita por iniciativa propia.

import { createOpusEncoder } from './opus-encoder.js';
import { oggOpusFile, oggOpusSeconds, OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE } from './ogg-opus.js';

// Debe coincidir con `workers/calls/protocol.js`; una prueba lo comprueba.
export const MELODI_WHATSAPP_VOICE = Object.freeze({
  id: '3597a26f-80ef-4bd5-8101-9699bc764917',
  model: 'sonic-3.6-2026-08-27',
  version: '2026-08-14',
  language: 'es',
});

export const VOICE_NOTE_LIMITS = Object.freeze({
  characters: 1200,
  // 48 kHz, 16 bits, un canal: dos minutos de audio sin comprimir.
  pcmBytes: 2 * OPUS_SAMPLE_RATE * 120,
  // WhatsApp sólo pone el control de reproducción por debajo de 512 KB.
  fileBytes: 480 * 1024,
  bitrate: 24_000,
  timeoutMs: 45_000,
});

/** Deja el texto en condiciones de leerse en voz alta, sin cambiar lo que dice. */
export function speakableText(value) {
  const text = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' el enlace que te envié ')
    .replace(/[*_~`#>]+/g, '')
    .replace(/^\s*[-·•]\s*/gm, '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s*\.\s*\./g, '.')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!text) throw new TypeError('empty_voice_note');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new TypeError('invalid_voice_note');
  return text.slice(0, VOICE_NOTE_LIMITS.characters);
}

export function voiceConfigured(env) {
  return typeof env?.BRIVANY_CARTESIA_API_KEY === 'string' && env.BRIVANY_CARTESIA_API_KEY.length > 8;
}

/** Convierte el sonido sin comprimir en el archivo que WhatsApp reconoce. */
export function encodeVoiceNote(opusModule, pcm) {
  if (!(pcm instanceof Int16Array) || !pcm.length) throw new TypeError('empty_voice_audio');
  const encoder = createOpusEncoder(opusModule, { channels: 1, sampleRate: OPUS_SAMPLE_RATE, bitrate: VOICE_NOTE_LIMITS.bitrate, application: 'voip' });
  try {
    const packets = [];
    for (let at = 0; at < pcm.length; at += OPUS_FRAME_SAMPLES) {
      let frame = pcm.subarray(at, at + OPUS_FRAME_SAMPLES);
      // El último tramo se completa con silencio: libopus exige tramos enteros.
      if (frame.length < OPUS_FRAME_SAMPLES) {
        const padded = new Int16Array(OPUS_FRAME_SAMPLES);
        padded.set(frame);
        frame = padded;
      }
      packets.push(encoder.encode(frame));
    }
    const bytes = oggOpusFile(packets, { channels: 1, preSkip: encoder.preSkip, vendor: 'brivany' });
    return { bytes, seconds: oggOpusSeconds(packets) };
  } finally { encoder.release(); }
}

async function readAudio(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(Error('voice_synthesis_empty'), { code: 'voice_synthesis_empty' });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw Object.assign(Error('voice_note_too_long'), { code: 'voice_note_too_long' }); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/**
 * Sintetiza la frase y devuelve el archivo de nota de voz.
 * No reintenta: una síntesis incierta no debe producir dos notas.
 */
export async function synthesizeVoiceNote(env, value, { fetcher = fetch, speed = 1, opusModule } = {}) {
  if (!voiceConfigured(env)) throw Object.assign(Error('voice_not_configured'), { code: 'voice_not_configured' });
  if (!Number.isFinite(speed) || speed < 0.75 || speed > 1.15) throw new TypeError('invalid_voice_speed');
  const module = opusModule || (await import('./opus-wasm.js')).default;
  const transcript = speakableText(value);
  const response = await fetcher('https://api.cartesia.ai/tts/bytes', {
    method: 'POST', redirect: 'manual',
    headers: { 'X-API-Key': env.BRIVANY_CARTESIA_API_KEY, 'Cartesia-Version': MELODI_WHATSAPP_VOICE.version, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_id: MELODI_WHATSAPP_VOICE.model, transcript, voice: MELODI_WHATSAPP_VOICE.id,
      language: MELODI_WHATSAPP_VOICE.language, generation_config: { speed },
      // Sin comprimir y a 48 kHz: es lo que Opus codifica sin remuestrear.
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: OPUS_SAMPLE_RATE },
    }),
    signal: AbortSignal.timeout(VOICE_NOTE_LIMITS.timeoutMs),
  });
  if (!response.ok) throw Object.assign(Error('voice_synthesis_rejected'), { code: 'voice_synthesis_rejected', status: response.status });
  const raw = await readAudio(response, VOICE_NOTE_LIMITS.pcmBytes);
  if (raw.length < 2) throw Object.assign(Error('voice_synthesis_empty'), { code: 'voice_synthesis_empty' });
  // El flujo puede terminar en un byte suelto; se descarta la muestra incompleta.
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const { bytes, seconds } = encodeVoiceNote(module, pcm);
  if (bytes.length > VOICE_NOTE_LIMITS.fileBytes) throw Object.assign(Error('voice_note_too_long'), { code: 'voice_note_too_long' });
  return { bytes, mimeType: 'audio/ogg', filename: 'melodi.ogg', voice: true, seconds, characters: transcript.length, transcript };
}

/**
 * Sintetiza y envía. Devuelve el recibo real del envío; si la nota no sale,
 * el error se propaga para que el turno no afirme que se escuchó.
 */
export async function sendVoiceNote(env, phone, value, sendMedia, options = {}) {
  if (typeof sendMedia !== 'function') throw new TypeError('voice_note_transport_required');
  const audio = await synthesizeVoiceNote(env, value, options);
  const receipt = await sendMedia(env, phone, 'audio', audio.bytes, audio.mimeType, audio.filename, '', { voice: true });
  if (receipt?.status !== 'sent') throw Object.assign(Error('voice_note_unconfirmed'), { code: 'voice_note_unconfirmed', uncertain: true });
  return { status: 'sent', messageId: receipt.messageId || null, characters: audio.characters, seconds: audio.seconds, bytes: audio.bytes.length };
}
